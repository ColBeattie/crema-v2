import { NextResponse, type NextRequest } from "next/server";
import {
  MCP_PATH,
  MCP_SERVER_NAME,
  MCP_SUPPORTED_SCOPES,
} from "@/lib/mcp/config";
import { getBaseUrl } from "@/lib/mcp/url";

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728).
 *
 * Served at `/.well-known/oauth-protected-resource` via a rewrite in
 * `next.config.ts` — the well-known path is fixed by the spec, and this is the
 * route that answers it.
 *
 * This is step one of the AI client's discovery: it gets a 401 from
 * `/api/mcp`, reads the `resource_metadata` URL out of the `WWW-Authenticate`
 * header, fetches this document, and learns which authorization server to talk
 * to. Public and unauthenticated by necessity — it is what an unauthenticated
 * client reads in order to find out how to authenticate.
 *
 * It contains no secrets: an origin, a path and a scope name.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const baseUrl = getBaseUrl(request);

  const response = NextResponse.json({
    resource: `${baseUrl}${MCP_PATH}`,
    // This app is its own authorization server (Supabase Auth is the identity
    // provider behind the consent screen, not the OAuth AS for MCP).
    authorization_servers: [baseUrl],
    scopes_supported: MCP_SUPPORTED_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: MCP_SERVER_NAME,
    resource_documentation: `${baseUrl}/ai-integration`,
  });

  // Cross-origin readable: some clients fetch discovery documents from a
  // browser context. Safe — the document is public by design and carries no
  // credentials.
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
