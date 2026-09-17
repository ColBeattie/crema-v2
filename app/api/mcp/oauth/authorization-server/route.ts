import { NextResponse, type NextRequest } from "next/server";
import { MCP_SUPPORTED_SCOPES } from "@/lib/mcp/config";
import { getBaseUrl } from "@/lib/mcp/url";

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414).
 *
 * Served at `/.well-known/oauth-authorization-server` via a rewrite in
 * `next.config.ts`. Step two of discovery: having learned from the
 * protected-resource document that this origin is the authorization server,
 * the AI client fetches this to find the authorize and token endpoints.
 *
 * Three declarations here are load-bearing, and each is a deliberate
 * restriction rather than an omission:
 *
 *   * `code_challenge_methods_supported: ["S256"]` — PKCE is mandatory and
 *     `plain` is not offered. A public client on a user's machine keeps no
 *     secret, so PKCE is the only thing binding the authorization code to the
 *     process that requested it.
 *   * `token_endpoint_auth_methods_supported: ["none"]` — this is a public
 *     client; there is no client secret to check, and pretending otherwise
 *     would be security theatre (the "secret" would sit in a config file on
 *     every user's laptop).
 *   * No `registration_endpoint` — Dynamic Client Registration is deliberately
 *     not implemented. See `sql/0001_mcp-oauth.sql`; clients are seeded by
 *     migration, and the setup command passes `--client-id` for that reason.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const baseUrl = getBaseUrl(request);

  const response = NextResponse.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/api/mcp/authorize`,
    token_endpoint: `${baseUrl}/api/mcp/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: MCP_SUPPORTED_SCOPES,
    service_documentation: `${baseUrl}/ai-integration`,
  });

  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Cache-Control", "public, max-age=3600");
  return response;
}

export async function OPTIONS(): Promise<Response> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, MCP-Protocol-Version",
      "Access-Control-Max-Age": "86400",
    },
  });
}
