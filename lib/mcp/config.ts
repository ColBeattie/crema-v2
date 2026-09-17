/**
 * Client-safe configuration for the MCP integration.
 *
 * Nothing secret may be added to this file — it is imported by the AI
 * Integration page, which renders in the browser. The signing/hashing helpers
 * live in `lib/mcp/tokens.ts` and the database access in `lib/mcp/store.ts`,
 * neither of which is reachable from a client component.
 */

import { COMPANY_NAME } from "@/lib/company";

/**
 * The MCP protocol revision this server implements.
 *
 * Sent back from `initialize`. Bump it only alongside a real change to the
 * message handling in `lib/mcp/protocol.ts` — claiming a revision we do not
 * implement is worse than claiming an older one, which clients handle by
 * negotiating down.
 */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

/** Path this app serves MCP on. Also the OAuth resource identifier. */
export const MCP_PATH = "/api/mcp";

/**
 * The name the server is added under in the AI client
 * (`claude mcp add … <name> …`), and the name the user picks in `/mcp`.
 *
 * Derived from the company name so a project built from this template gets a
 * sensible default the moment `/start` sets `COMPANY_NAME`. It is a CLI
 * identifier, so it is slugified: lowercase, non-alphanumerics collapsed to a
 * single dash, no leading/trailing dash.
 */
export const MCP_SERVER_SLUG =
  COMPANY_NAME.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "app";

/** Human-readable server name, reported by `initialize`. */
export const MCP_SERVER_NAME = `${COMPANY_NAME} MCP`;

/**
 * The OAuth client id the AI client presents.
 *
 * Must match the row seeded by `sql/0001_mcp-oauth.sql`. Overridable by env
 * for a project that registers a differently-named client, but changing it
 * means adding the matching row — the token endpoint looks the client up and
 * refuses an unknown one.
 */
export const MCP_CLIENT_ID =
  process.env.NEXT_PUBLIC_MCP_CLIENT_ID || "claude-code";

/**
 * The fixed loopback port the AI client listens on for the OAuth callback.
 *
 * OAuth compares redirect URIs as exact strings, so a pre-registered client
 * needs a known port — hence `--callback-port` in the setup command rather
 * than letting the CLI pick a free one. Must match the `redirect_uris` seeded
 * in the migration.
 */
export const MCP_CALLBACK_PORT = Number(
  process.env.NEXT_PUBLIC_MCP_CALLBACK_PORT || 51703
);

/** The redirect URIs that go with `MCP_CALLBACK_PORT`, for display and docs. */
export const MCP_REDIRECT_URIS = [
  `http://localhost:${MCP_CALLBACK_PORT}/callback`,
  `http://127.0.0.1:${MCP_CALLBACK_PORT}/callback`,
];

/**
 * The only scope this server issues.
 *
 * Read-only by design — see `lib/mcp/tools.ts`. A project that adds mutating
 * tools should add a second scope rather than widening this one, so existing
 * tokens do not silently gain write access on deploy.
 */
export const MCP_SCOPE_READ = "mcp:read";
export const MCP_SUPPORTED_SCOPES = [MCP_SCOPE_READ];

/**
 * Who provisions this integration — and, just as importantly, who does not.
 *
 * Enabling it is a database change in Supabase. The people reading
 * `/ai-integration` are administrators OF THE APP, not of the Supabase project:
 * they have no SQL Editor and no repository, so copy that tells them to "run
 * the migration" is an instruction they cannot act on. It reads as their
 * problem, they try to find the button, and there isn't one.
 *
 * So every user-facing string about setup names the party who actually does it
 * and gives the reader something they CAN do — ask. Defined once here because
 * it appears on the page, in the authorize endpoint's error and in the revoke
 * action, and those three drifting apart is how a reader ends up with
 * contradictory instructions.
 *
 * The counterpart technical instructions live in `documentation/mcp.md`, which
 * is written for whoever holds Supabase access.
 */
export const MCP_SETUP_OWNER = "Productivity Tools";

/** One sentence, for an error or a status line where a paragraph won't fit. */
export const MCP_SETUP_REQUIRED_MESSAGE =
  `This AI integration has not been switched on for this deployment yet. ` +
  `${MCP_SETUP_OWNER} — or a team member with Supabase access — needs to enable it.`;

/** Token lifetimes. Short access token, rotating refresh token. */
export const MCP_AUTHORIZATION_REQUEST_TTL_SECONDS = 10 * 60;
export const MCP_AUTHORIZATION_CODE_TTL_SECONDS = 60;
export const MCP_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const MCP_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Build the `claude mcp add` command shown on the AI Integration page.
 *
 * Kept here rather than inlined in the page so the command, the seeded client
 * row and the token endpoint can never drift apart — there is one definition
 * of the client id and port, and everything reads it.
 */
export function buildAddCommand(baseUrl: string): string {
  return [
    "claude mcp add --transport http \\",
    "  --scope user \\",
    `  --client-id ${MCP_CLIENT_ID} \\`,
    `  --callback-port ${MCP_CALLBACK_PORT} \\`,
    `  ${MCP_SERVER_SLUG} ${baseUrl}${MCP_PATH}`,
  ].join("\n");
}
