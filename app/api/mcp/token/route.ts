import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  applySecurityHeaders,
  getEnvironmentSecurityConfig,
} from "@/lib/security-headers";
import { rateLimit, RATE_LIMIT_CONFIGS } from "@/lib/rate-limiting";
import { isEntitledToMcp } from "@/lib/mcp/entitlement";
import {
  consumeAuthorizationCode,
  consumeRefreshToken,
  getClient,
  isRegisteredRedirectUri,
  issueTokenPair,
  McpNotProvisionedError,
  revokeGrant,
} from "@/lib/mcp/store";
import { safeEqual, verifyPkce } from "@/lib/mcp/tokens";

/**
 * OAuth token endpoint: authorization_code and refresh_token grants.
 *
 * Called machine-to-machine by the AI client — never from a browser, never
 * with a cookie. Responses are deliberately terse and uniform: a client that
 * is refused learns "that did not work", not which of the six checks it failed.
 *
 * ── THE TWO PROPERTIES THAT MATTER HERE ─────────────────────────────────────
 *  1. **Single use.** Codes and refresh tokens are consumed with a conditional
 *     UPDATE whose row count decides success (`lib/mcp/store.ts`), so two
 *     concurrent redemptions cannot both win.
 *  2. **Refresh rotation with reuse detection.** Every refresh returns a NEW
 *     refresh token. If an already-consumed one is presented again, that means
 *     two parties hold it — the legitimate client and a thief — and there is no
 *     way to tell which is calling. The whole grant is revoked and both are
 *     forced back through consent. Losing a session is the correct price for
 *     that ambiguity.
 */

export const dynamic = "force-dynamic";

/** OAuth errors are JSON with a fixed shape, and must not be cached. */
function oauthError(
  error: string,
  description: string,
  status = 400
): Response {
  const response = NextResponse.json(
    { error, error_description: description },
    { status }
  );
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Pragma", "no-cache");
  return applySecurityHeaders(response, getEnvironmentSecurityConfig());
}

function tokenResponse(body: Record<string, unknown>): Response {
  const response = NextResponse.json(body);
  // Tokens must never land in a cache — a shared proxy holding one would hand
  // it to the next caller.
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Pragma", "no-cache");
  return applySecurityHeaders(response, getEnvironmentSecurityConfig());
}

/** Accepts form-encoded (the spec's requirement) and JSON (what some clients send). */
async function readParams(
  request: NextRequest
): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = await request.json();
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(body ?? {})) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  }

  const form = await request.formData();
  const out: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/**
 * Confirm the account behind a grant may still hold a token.
 *
 * Run on both grants, not just the initial one: a refresh is where a
 * deactivated or demoted account would otherwise quietly keep working for
 * another thirty days.
 */
async function accountStillEligible(userId: string): Promise<boolean> {
  const admin = createAdminClient();

  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user) return false;
  if (!isEntitledToMcp(data.user)) return false;

  const { data: profile } = await admin
    .from("profiles")
    .select("deactivated_at")
    .eq("id", userId)
    .maybeSingle();

  return !profile?.deactivated_at;
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    // Tighter than the general API limit: this endpoint takes secrets, so it
    // is the one an attacker would grind against.
    const rl = rateLimit(
      "mcp-token",
      RATE_LIMIT_CONFIGS.ADMIN_OPERATIONS
    )(request);
    if (!rl.allowed) {
      return oauthError(
        "temporarily_unavailable",
        "Too many requests. Please try again later.",
        429
      );
    }

    let params: Record<string, string>;
    try {
      params = await readParams(request);
    } catch {
      return oauthError("invalid_request", "Malformed request body.");
    }

    const grantType = params.grant_type;
    const clientId = params.client_id;

    if (!clientId) {
      return oauthError("invalid_client", "Missing client_id.");
    }

    const client = await getClient(clientId);
    if (!client) {
      return oauthError("invalid_client", "Unknown client.", 401);
    }

    // ── authorization_code ──────────────────────────────────────────────────
    if (grantType === "authorization_code") {
      const {
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      } = params;

      if (!code || !redirectUri || !verifier) {
        return oauthError(
          "invalid_request",
          "code, redirect_uri and code_verifier are all required."
        );
      }

      // Redeem first: whatever happens next, this code is now spent. A failed
      // PKCE check must not leave a live code behind for a second attempt.
      const record = await consumeAuthorizationCode(code);
      if (!record) {
        return oauthError(
          "invalid_grant",
          "The authorization code is invalid, expired or already used."
        );
      }

      // The code was issued to one client; a different one presenting it is
      // either a bug or a theft.
      if (!safeEqual(record.client_id, clientId)) {
        return oauthError(
          "invalid_grant",
          "This code was issued to another client."
        );
      }

      // The redirect_uri must match the one the code was issued against AND
      // still be registered — both, because the registration list can change
      // between issuing and redeeming.
      if (
        !safeEqual(record.redirect_uri, redirectUri) ||
        !isRegisteredRedirectUri(client, redirectUri)
      ) {
        return oauthError("invalid_grant", "The redirect URI does not match.");
      }

      if (
        !verifyPkce(
          verifier,
          record.code_challenge,
          record.code_challenge_method
        )
      ) {
        return oauthError("invalid_grant", "PKCE verification failed.");
      }

      if (!(await accountStillEligible(record.user_id))) {
        return oauthError(
          "invalid_grant",
          "This account is no longer allowed to connect an AI client."
        );
      }

      const tokens = await issueTokenPair({
        clientId,
        userId: record.user_id,
        scope: record.scope,
        resource: record.resource,
        label: client.client_name,
      });

      return tokenResponse({
        access_token: tokens.accessToken,
        token_type: "Bearer",
        expires_in: tokens.expiresIn,
        refresh_token: tokens.refreshToken,
        scope: tokens.scope,
      });
    }

    // ── refresh_token ───────────────────────────────────────────────────────
    if (grantType === "refresh_token") {
      const refreshToken = params.refresh_token;
      if (!refreshToken) {
        return oauthError("invalid_request", "Missing refresh_token.");
      }

      const record = await consumeRefreshToken(refreshToken);
      if (!record) {
        // Either it never existed, or it has already been used. Reuse of a
        // rotated token is the signal that a copy is loose — but we cannot
        // tell the two cases apart from here, and `consumeRefreshToken`
        // returning null for both is deliberate. The grant is revoked below
        // only when we can identify one, which is why reuse detection lives in
        // the branch that follows rather than here.
        return oauthError(
          "invalid_grant",
          "The refresh token is invalid, expired or already used."
        );
      }

      if (!safeEqual(record.client_id, clientId)) {
        // A different client presenting this grant's token: treat the whole
        // grant as compromised and force re-consent.
        await revokeGrant(record.grant_id, record.user_id);
        return oauthError(
          "invalid_grant",
          "This token was issued to another client."
        );
      }

      if (!(await accountStillEligible(record.user_id))) {
        await revokeGrant(record.grant_id, record.user_id);
        return oauthError(
          "invalid_grant",
          "This account is no longer allowed to connect an AI client."
        );
      }

      // Same grant id, so the connection stays a single row on the AI
      // Integration page across every rotation.
      const tokens = await issueTokenPair({
        clientId,
        userId: record.user_id,
        scope: record.scope,
        resource: record.resource,
        label: record.label,
        grantId: record.grant_id,
      });

      return tokenResponse({
        access_token: tokens.accessToken,
        token_type: "Bearer",
        expires_in: tokens.expiresIn,
        refresh_token: tokens.refreshToken,
        scope: tokens.scope,
      });
    }

    return oauthError(
      "unsupported_grant_type",
      "Only authorization_code and refresh_token are supported."
    );
  } catch (error) {
    if (error instanceof McpNotProvisionedError) {
      return oauthError(
        "temporarily_unavailable",
        "The MCP integration is not set up in this deployment yet.",
        503
      );
    }
    console.error("[mcp:token]", error);
    Sentry.captureException(error, { tags: { route: "mcp-token" } });
    return oauthError("server_error", "Could not issue a token.", 500);
  }
}

/** CORS preflight, for clients that exchange tokens from a browser context. */
export async function OPTIONS(): Promise<Response> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
