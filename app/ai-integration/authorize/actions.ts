"use server";

import { createClient } from "@/lib/supabase/server";
import { createAuditLog } from "@/app/admin/audit/actions";
import { MCP_SETUP_REQUIRED_MESSAGE } from "@/lib/mcp/config";
import { isEntitledToMcp } from "@/lib/mcp/entitlement";
import {
  consumeAuthorizationRequest,
  getClient,
  getPendingAuthorizationRequest,
  isRegisteredRedirectUri,
  issueAuthorizationCode,
  McpNotProvisionedError,
} from "@/lib/mcp/store";

/**
 * The consent decision.
 *
 * These actions return a URL for the browser to navigate to rather than
 * calling `redirect()`. The target is the AI client's loopback callback — an
 * origin outside this app — and handing it back for an explicit
 * `window.location.assign` keeps the cross-origin hop visible in one place
 * instead of buried in a framework redirect.
 *
 * The URL is always built from the redirect URI stored on the request row and
 * re-checked against the client's registration, never from anything the
 * browser sends with the form.
 */

export interface ConsentResult {
  redirectUrl?: string;
  error?: string;
}

/** Re-derive the caller. The page checked too; a server action is callable directly. */
async function getEntitledUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isEntitledToMcp(user)) return null;
  return user;
}

/**
 * Approve the request: mint a one-time authorization code and send the browser
 * back to the AI client with it.
 */
export async function approveAuthorization(
  requestId: string
): Promise<ConsentResult> {
  try {
    const user = await getEntitledUser();
    if (!user) {
      return { error: "You are not allowed to approve this request." };
    }

    // Consume and read in one atomic step. Approving twice — a double-click, a
    // resubmitted form, two tabs — must produce exactly one code.
    const pending = await consumeAuthorizationRequest(requestId);
    if (!pending) {
      return {
        error:
          "This authorization request has expired or was already used. Run /mcp in your AI client and authenticate again.",
      };
    }

    // Re-validate the redirect against the registration at approval time: the
    // request row was written minutes ago and the client's registered URIs
    // could have changed since.
    const client = await getClient(pending.client_id);
    if (!client || !isRegisteredRedirectUri(client, pending.redirect_uri)) {
      return {
        error: "This AI client is no longer registered with this application.",
      };
    }

    const code = await issueAuthorizationCode({
      clientId: pending.client_id,
      userId: user.id,
      redirectUri: pending.redirect_uri,
      codeChallenge: pending.code_challenge,
      codeChallengeMethod: pending.code_challenge_method,
      scope: pending.scope,
      resource: pending.resource,
    });

    // Granting an AI client standing read access is security-relevant, so it
    // is recorded in the append-only audit log alongside admin actions. The
    // code itself is NOT logged — an audit trail must never contain a live
    // credential.
    await createAuditLog("mcp_client_authorized", user.id, {
      client_id: pending.client_id,
      scope: pending.scope,
    });

    const url = new URL(pending.redirect_uri);
    url.searchParams.set("code", code);
    if (pending.state) url.searchParams.set("state", pending.state);

    return { redirectUrl: url.toString() };
  } catch (error) {
    if (error instanceof McpNotProvisionedError) {
      return { error: MCP_SETUP_REQUIRED_MESSAGE };
    }
    console.error("[mcp:approveAuthorization]", error);
    return {
      error:
        "Could not complete the authorization. Run /mcp in your AI client and choose Authenticate to start over.",
    };
  }
}

/**
 * Deny the request.
 *
 * The client is told explicitly rather than left to time out — a CLI waiting on
 * a callback that never arrives looks like a broken integration, not a
 * decision. `access_denied` is the spec's word for "the user said no".
 */
export async function denyAuthorization(
  requestId: string
): Promise<ConsentResult> {
  try {
    const user = await getEntitledUser();
    if (!user) {
      return { error: "You are not allowed to act on this request." };
    }

    // Read before consuming, so a denial on an already-dead request still has
    // somewhere to send the browser.
    const pending = await getPendingAuthorizationRequest(requestId);
    if (!pending) {
      return {
        error: "This authorization request has expired or was already used.",
      };
    }

    await consumeAuthorizationRequest(requestId);

    const client = await getClient(pending.client_id);
    if (!client || !isRegisteredRedirectUri(client, pending.redirect_uri)) {
      // Nowhere safe to send them; the page shows this instead.
      return { error: "Request denied." };
    }

    const url = new URL(pending.redirect_uri);
    url.searchParams.set("error", "access_denied");
    url.searchParams.set(
      "error_description",
      "The user declined the authorization request."
    );
    if (pending.state) url.searchParams.set("state", pending.state);

    return { redirectUrl: url.toString() };
  } catch (error) {
    console.error("[mcp:denyAuthorization]", error);
    return {
      error:
        "Could not complete the request. You can close this tab — nothing was granted.",
    };
  }
}
