"use server";

import { createClient } from "@/lib/supabase/server";
import { createAuditLog } from "@/app/admin/audit/actions";
import { MCP_CLIENT_ID, MCP_SETUP_REQUIRED_MESSAGE } from "@/lib/mcp/config";
import { isEntitledToMcp } from "@/lib/mcp/entitlement";
import {
  getProvisioningStatus,
  listConnections,
  McpNotProvisionedError,
  revokeGrant,
  type ConnectionSummary,
} from "@/lib/mcp/store";

/**
 * Server actions behind the AI Integration page.
 *
 * Every action re-derives the caller with `getUser()` and re-checks
 * entitlement. The page already gates on the same thing and the routing
 * middleware gates the route — none of that is trusted here, because a server
 * action is directly callable and layout-level checks are not authorization
 * (`.claude/rules/security.md`).
 */

interface Caller {
  id: string;
  email: string | null;
}

/** The authenticated, entitled caller — or null. Never throws on "not allowed". */
async function requireEntitledCaller(): Promise<Caller | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isEntitledToMcp(user)) return null;
  return { id: user.id, email: user.email ?? null };
}

export interface McpPageState {
  entitled: boolean;
  /** Whether the Supabase migration has been run and the client registered. */
  ready: boolean;
  /** Plain-language reason when `ready` is false; safe to show the user. */
  setupReason?: string;
  connections: ConnectionSummary[];
  /**
   * Set when the connection list could not be read.
   *
   * Kept separate from an empty list on purpose: rendering a failed read as
   * "no AI clients connected" tells the user something false about their own
   * security posture, and they would have no reason to doubt it.
   */
  connectionsError?: string;
}

/**
 * Everything the page needs about this deployment's MCP state.
 *
 * Deliberately returns a shaped result rather than throwing, because "not set
 * up yet" is the expected state on a fresh clone of this template — the page
 * renders a setup banner from it, not an error boundary.
 */
export async function getMcpPageState(): Promise<McpPageState> {
  const caller = await requireEntitledCaller();
  if (!caller) {
    return { entitled: false, ready: false, connections: [] };
  }

  const status = await getProvisioningStatus(MCP_CLIENT_ID);
  if (!status.ready) {
    return {
      entitled: true,
      ready: false,
      setupReason: status.reason,
      connections: [],
    };
  }

  try {
    return {
      entitled: true,
      ready: true,
      connections: await listConnections(caller.id),
    };
  } catch (error) {
    console.error("[mcp:getMcpPageState]", error);
    return {
      entitled: true,
      ready: true,
      connections: [],
      connectionsError:
        "Your connected clients could not be loaded, so this list may be incomplete. Reload the page to try again.",
    };
  }
}

/**
 * Disconnect one AI client.
 *
 * Scoped to the caller's own user id inside the query (`revokeGrant` takes
 * both), so an admin cannot revoke someone else's connection by supplying
 * their grant id — a role check is not an ownership check.
 */
export async function revokeConnection(
  grantId: string
): Promise<{ success: boolean; error?: string }> {
  const caller = await requireEntitledCaller();
  if (!caller) {
    return { success: false, error: "You are not allowed to do that." };
  }

  // Grant ids are UUIDs; anything else is not worth a database round trip.
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      grantId
    )
  ) {
    return {
      success: false,
      error: "That connection could not be found.",
    };
  }

  try {
    const revoked = await revokeGrant(grantId, caller.id);
    if (revoked === 0) {
      return {
        success: false,
        error:
          "That connection could not be found — it may already have been disconnected. Reload the page to see the current list.",
      };
    }

    // Revoking access is a security-relevant act, so it joins the same
    // append-only audit trail as the admin actions.
    await createAuditLog("mcp_connection_revoked", caller.id, {
      grant_id: grantId,
      tokens_revoked: revoked,
    });

    return { success: true };
  } catch (error) {
    if (error instanceof McpNotProvisionedError) {
      return { success: false, error: MCP_SETUP_REQUIRED_MESSAGE };
    }
    console.error("[mcp:revokeConnection]", error);
    return {
      success: false,
      error:
        "Could not disconnect that client. Please try again — if it keeps failing, the connection expires on its own within 30 days.",
    };
  }
}
