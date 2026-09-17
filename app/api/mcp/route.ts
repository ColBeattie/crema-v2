import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  applySecurityHeaders,
  getEnvironmentSecurityConfig,
} from "@/lib/security-headers";
import { rateLimit, RATE_LIMIT_CONFIGS } from "@/lib/rate-limiting";
import { MCP_PATH, MCP_PROTOCOL_VERSION } from "@/lib/mcp/config";
import { isEntitledToMcp } from "@/lib/mcp/entitlement";
import {
  findLiveAccessToken,
  McpNotProvisionedError,
  touchToken,
} from "@/lib/mcp/store";
import {
  handleMessage,
  jsonRpcError,
  JSON_RPC,
  type JsonRpcRequest,
} from "@/lib/mcp/protocol";
import { getBaseUrl } from "@/lib/mcp/url";
import type { ToolContext } from "@/lib/mcp/tools";

/**
 * The MCP endpoint. Streamable HTTP transport, stateless.
 *
 * This route is NOT wrapped in `withApiSecurity()`, and that is deliberate:
 * that wrapper authenticates from the Supabase session cookie, and an AI client
 * has no cookie — it presents a bearer token this app issued. Everything the
 * wrapper provides is therefore done explicitly below (rate limit, auth,
 * security headers, error sanitization). If you add another MCP route, copy
 * this shape rather than reaching for the cookie-based wrapper.
 *
 * Authorization is re-derived on EVERY request from the live account:
 *   token → user id → Supabase account → role + deactivation + entitlement.
 * Nothing about the caller's rights is baked into the token, so removing
 * someone's admin role or deactivating them cuts their AI client off on its
 * next call rather than whenever the token happened to expire.
 */

// Bearer tokens are per-request; there is nothing to cache and a cached
// response would leak one caller's data to another.
export const dynamic = "force-dynamic";

interface AuthSuccess {
  ok: true;
  ctx: ToolContext;
  tokenId: string;
}
interface AuthFailure {
  ok: false;
  response: Response;
}

/**
 * Every rejection is the same 401 with the same body.
 *
 * Unknown token, expired token, revoked token, deactivated account, role
 * removed — all indistinguishable from the outside. The `WWW-Authenticate`
 * header is what makes the client re-run the OAuth flow instead of giving up:
 * it points at the protected-resource metadata, which points at the
 * authorization server.
 */
function unauthorized(request: NextRequest): Response {
  const baseUrl = getBaseUrl(request);
  const response = NextResponse.json(
    { error: "invalid_token", error_description: "Authentication required." },
    { status: 401 }
  );
  response.headers.set(
    "WWW-Authenticate",
    `Bearer realm="mcp", error="invalid_token", resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`
  );
  return applySecurityHeaders(response, getEnvironmentSecurityConfig());
}

function json(body: unknown, status = 200): Response {
  return applySecurityHeaders(
    NextResponse.json(body, { status }),
    getEnvironmentSecurityConfig()
  );
}

async function authenticate(
  request: NextRequest
): Promise<AuthSuccess | AuthFailure> {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");

  // Scheme compared case-insensitively per RFC 7235; a missing or malformed
  // header is the same 401 as a bad token.
  if (!token || scheme?.toLowerCase() !== "bearer") {
    return { ok: false, response: unauthorized(request) };
  }

  const tokenRow = await findLiveAccessToken(token);
  if (!tokenRow) return { ok: false, response: unauthorized(request) };

  // Resolve the live account. A token row alone says nothing about whether the
  // account still exists, still has its role, or has since been deactivated.
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(tokenRow.user_id);
  if (error || !data?.user) {
    return { ok: false, response: unauthorized(request) };
  }
  const user = data.user;

  // Deactivation is an app-level flag in `profiles`, exactly as the routing
  // middleware treats it for browser sessions — a deactivated admin must lose
  // their AI client too, not just their browser session.
  const { data: profile } = await admin
    .from("profiles")
    .select("deactivated_at")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.deactivated_at) {
    return { ok: false, response: unauthorized(request) };
  }

  // The entitlement gate, re-checked live. See lib/mcp/entitlement.ts.
  if (!isEntitledToMcp(user)) {
    return { ok: false, response: unauthorized(request) };
  }

  return {
    ok: true,
    tokenId: tokenRow.id,
    ctx: { user, isAdmin: user.app_metadata?.role === "admin" },
  };
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    // Rate limit per IP, before any database work — an unauthenticated flood
    // must not be able to make us do token lookups.
    const rl = rateLimit("mcp", RATE_LIMIT_CONFIGS.API_CALLS)(request);
    if (!rl.allowed) {
      return json({ error: "Too many requests. Please try again later." }, 429);
    }

    const auth = await authenticate(request);
    if (!auth.ok) return auth.response;

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return json(
        jsonRpcError(
          null,
          JSON_RPC.PARSE_ERROR,
          "Request body is not valid JSON."
        ),
        400
      );
    }

    // Record use for the "last used" column, without blocking the response.
    void touchToken(auth.tokenId);

    // A batch is a JSON array of messages; a single message is an object.
    const messages: JsonRpcRequest[] = Array.isArray(payload)
      ? (payload as JsonRpcRequest[])
      : [payload as JsonRpcRequest];

    if (messages.length === 0) {
      return json(
        jsonRpcError(null, JSON_RPC.INVALID_REQUEST, "Empty batch."),
        400
      );
    }

    const responses = [];
    for (const message of messages) {
      const response = await handleMessage(message, auth.ctx);
      if (response) responses.push(response);
    }

    // Every message was a notification: acknowledge with 202 and no body, as
    // the transport requires. Returning `{}` here makes some clients treat the
    // notification as having been answered.
    if (responses.length === 0) {
      return applySecurityHeaders(
        new NextResponse(null, { status: 202 }),
        getEnvironmentSecurityConfig()
      );
    }

    const body = Array.isArray(payload) ? responses : responses[0];
    return json(body);
  } catch (error) {
    if (error instanceof McpNotProvisionedError) {
      // The migration has not been run. Say so plainly — on a fresh clone of
      // this template it is the expected state, and a 500 would send whoever
      // hits it hunting for a bug instead of a setup step.
      console.error("[mcp] not provisioned:", error.message);
      return json(
        {
          error: "server_not_configured",
          error_description:
            "The MCP integration is not set up in this deployment's database yet.",
        },
        503
      );
    }

    console.error("[mcp]", error);
    Sentry.captureException(error, { tags: { route: "mcp" } });
    return json(
      jsonRpcError(null, JSON_RPC.INTERNAL_ERROR, "Internal server error."),
      500
    );
  }
}

/**
 * GET opens the server-to-client notification stream in the Streamable HTTP
 * transport. This server never initiates messages (stateless, no
 * subscriptions), so it declines the stream — which the spec allows, and which
 * clients handle by simply not opening one.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const auth = await authenticate(request);
  if (!auth.ok) return auth.response;

  return applySecurityHeaders(
    new NextResponse(null, { status: 405, headers: { Allow: "POST, DELETE" } }),
    getEnvironmentSecurityConfig()
  );
}

/** Session teardown. There are no sessions to tear down, so this always succeeds. */
export async function DELETE(request: NextRequest): Promise<Response> {
  const auth = await authenticate(request);
  if (!auth.ok) return auth.response;

  return applySecurityHeaders(
    new NextResponse(null, { status: 204 }),
    getEnvironmentSecurityConfig()
  );
}

/**
 * Preflight, for MCP clients that run in a browser.
 *
 * `Access-Control-Allow-Origin: *` is safe here precisely because this
 * endpoint is bearer-authenticated and never reads cookies: a browser sending
 * a cross-origin request carries no ambient credentials, so there is nothing
 * for a malicious page to ride on. Do NOT add
 * `Access-Control-Allow-Credentials` — that would turn this into a CSRF hole.
 */
export async function OPTIONS(): Promise<Response> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Authorization, Content-Type, MCP-Protocol-Version",
      "Access-Control-Expose-Headers": "WWW-Authenticate",
      "Access-Control-Max-Age": "86400",
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
      "MCP-Endpoint": MCP_PATH,
    },
  });
}
