import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  MCP_ACCESS_TOKEN_TTL_SECONDS,
  MCP_AUTHORIZATION_CODE_TTL_SECONDS,
  MCP_AUTHORIZATION_REQUEST_TTL_SECONDS,
  MCP_REFRESH_TOKEN_TTL_SECONDS,
} from "./config";
import { expiresAt, generateSecret, hashSecret } from "./tokens";

/**
 * Database access for the MCP OAuth server.
 *
 * SERVER ONLY. Every function here uses the service-role client, because the
 * tables in `sql/0001_mcp-oauth.sql` are deliberately unreachable with a user
 * JWT (grants revoked, deny-all policies). That makes this module the single
 * choke point for MCP token state — authorization decisions live in the
 * callers, not here.
 *
 * Two rules hold throughout:
 *   1. Secrets are hashed before they touch a query. A plaintext token is only
 *      ever in memory, on its way back to the client that will hold it.
 *   2. Anything single-use is consumed with a conditional UPDATE whose
 *      affected-row count is checked. A read-then-write would let two
 *      concurrent redemptions of the same code both succeed.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface OAuthClient {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
}

export interface AuthorizationRequest {
  id: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  state: string | null;
  scope: string;
  resource: string | null;
  expires_at: string;
  consumed_at: string | null;
}

export interface TokenRow {
  id: string;
  token_type: "access" | "refresh";
  client_id: string;
  user_id: string;
  scope: string;
  resource: string | null;
  label: string | null;
  grant_id: string;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  consumed_at: string | null;
  revoked_at: string | null;
}

/**
 * Raised when the MCP tables are absent — i.e. the migration has not been run.
 *
 * Callers turn this into MCP_SETUP_REQUIRED_MESSAGE rather than a 500, because
 * on a deployment nobody has provisioned yet this is the expected state, not a
 * fault — and the reader needs to know who to ask, not see a server error.
 */
export class McpNotProvisionedError extends Error {
  constructor() {
    super(
      "The MCP database tables are missing. Whoever holds Supabase access for " +
        "this project must run sql/0001_mcp-oauth.sql — see documentation/mcp.md. " +
        "This message is for the server log; user-facing copy must use " +
        "MCP_SETUP_REQUIRED_MESSAGE instead."
    );
    this.name = "McpNotProvisionedError";
  }
}

/**
 * "That table does not exist" — i.e. the migration has not been run.
 *
 * Two codes, because PostgREST and Postgres report it differently and which
 * one you get depends on the path:
 *   * `PGRST205` — PostgREST's own schema cache has no such table. This is what
 *     a normal `.from("mcp_oauth_client")` returns, and therefore the one that
 *     actually fires here.
 *   * `42P01` — Postgres' `undefined_table`, which surfaces through RPC and
 *     raw SQL paths.
 * Matching only the second is the easy mistake: it type-checks, it reads
 * correctly, and it silently turns "you forgot to run the migration" into a
 * 500 with no explanation.
 */
function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

function admin(): SupabaseClient {
  return createAdminClient();
}

// ── Provisioning check ──────────────────────────────────────────────────────

/**
 * Whether the migration has been applied and the client row exists.
 *
 * Used by the AI Integration page to decide between the "setup required"
 * banner and the live one. Never throws: an unconfigured Supabase (no secret
 * key) is reported as not-provisioned with a reason, since that is the same
 * problem from the reader's point of view.
 *
 * `reason` is rendered on the page, so it is written for an administrator of
 * the APP — someone with no Supabase project and no repository. It states what
 * is true, not what to type: file names and env var names belong in the server
 * log and in documentation/mcp.md, not in a sentence shown to someone who
 * cannot act on them. It stays specific enough to be useful when they report
 * it to whoever does the setup.
 */
export async function getProvisioningStatus(clientId: string): Promise<{
  ready: boolean;
  tablesPresent: boolean;
  clientRegistered: boolean;
  reason?: string;
}> {
  let db: SupabaseClient;
  try {
    db = admin();
  } catch {
    return {
      ready: false,
      tablesPresent: false,
      clientRegistered: false,
      reason:
        "This deployment is missing its Supabase credentials, so the integration cannot be checked.",
    };
  }

  const { data, error } = await db
    .from("mcp_oauth_client")
    .select("client_id")
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) {
    if (isMissingTable(error)) {
      return {
        ready: false,
        tablesPresent: false,
        clientRegistered: false,
        reason: "The integration has not been enabled in Supabase yet.",
      };
    }
    // Log the raw error server-side only — it names tables and constraints.
    console.error("[mcp:provisioning]", error);
    return {
      ready: false,
      tablesPresent: false,
      clientRegistered: false,
      reason: "The integration's status could not be read from Supabase.",
    };
  }

  const clientRegistered = !!data;
  return {
    ready: clientRegistered,
    tablesPresent: true,
    clientRegistered,
    reason: clientRegistered
      ? undefined
      : "The integration is only half enabled — the connection tables exist, but no AI client is registered.",
  };
}

// ── Clients ─────────────────────────────────────────────────────────────────

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  const { data, error } = await admin()
    .from("mcp_oauth_client")
    .select("client_id, client_name, redirect_uris")
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) {
    if (isMissingTable(error)) throw new McpNotProvisionedError();
    throw error;
  }
  return data;
}

/**
 * Exact-string redirect URI match.
 *
 * Deliberately not a prefix or host comparison: OAuth redirect validation is
 * one of the classic places a "close enough" check becomes an open redirect
 * that hands an attacker the authorization code.
 */
export function isRegisteredRedirectUri(
  client: OAuthClient,
  redirectUri: string
): boolean {
  return client.redirect_uris.includes(redirectUri);
}

// ── Authorization requests (the pending consent) ─────────────────────────────

export async function createAuthorizationRequest(input: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string | null;
  scope: string;
  resource: string | null;
}): Promise<string> {
  const id = generateSecret("request");

  const { error } = await admin()
    .from("mcp_authorization_request")
    .insert({
      id,
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      code_challenge: input.codeChallenge,
      code_challenge_method: input.codeChallengeMethod,
      state: input.state,
      scope: input.scope,
      resource: input.resource,
      expires_at: expiresAt(MCP_AUTHORIZATION_REQUEST_TTL_SECONDS),
    });

  if (error) {
    if (isMissingTable(error)) throw new McpNotProvisionedError();
    throw error;
  }
  return id;
}

/**
 * Load a pending request for display on the consent screen.
 *
 * Returns null when it is unknown, already used or expired — the page treats
 * all three identically ("this link is no longer valid"), because telling them
 * apart would confirm the existence of an id to whoever is guessing.
 */
export async function getPendingAuthorizationRequest(
  id: string
): Promise<AuthorizationRequest | null> {
  const { data, error } = await admin()
    .from("mcp_authorization_request")
    .select(
      "id, client_id, redirect_uri, code_challenge, code_challenge_method, state, scope, resource, expires_at, consumed_at"
    )
    .eq("id", id)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    if (isMissingTable(error)) throw new McpNotProvisionedError();
    throw error;
  }
  return data;
}

/**
 * Consume a pending request, atomically.
 *
 * The `.is("consumed_at", null)` predicate is inside the UPDATE, and the
 * returned row count is what decides success — so two browser tabs racing on
 * the same consent screen produce exactly one authorization code.
 */
export async function consumeAuthorizationRequest(
  id: string
): Promise<AuthorizationRequest | null> {
  const { data, error } = await admin()
    .from("mcp_authorization_request")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", id)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select(
      "id, client_id, redirect_uri, code_challenge, code_challenge_method, state, scope, resource, expires_at, consumed_at"
    );

  if (error) {
    if (isMissingTable(error)) throw new McpNotProvisionedError();
    throw error;
  }
  return data && data.length === 1 ? data[0] : null;
}

// ── Authorization codes ─────────────────────────────────────────────────────

/** Mint a code for an approved request. The plaintext is returned once. */
export async function issueAuthorizationCode(input: {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
  resource: string | null;
}): Promise<string> {
  const code = generateSecret("code");

  const { error } = await admin()
    .from("mcp_authorization_code")
    .insert({
      code_hash: hashSecret(code),
      client_id: input.clientId,
      user_id: input.userId,
      redirect_uri: input.redirectUri,
      code_challenge: input.codeChallenge,
      code_challenge_method: input.codeChallengeMethod,
      scope: input.scope,
      resource: input.resource,
      expires_at: expiresAt(MCP_AUTHORIZATION_CODE_TTL_SECONDS),
    });

  if (error) {
    if (isMissingTable(error)) throw new McpNotProvisionedError();
    throw error;
  }
  return code;
}

/** Redeem a code exactly once. Null means invalid, expired or already used. */
export async function consumeAuthorizationCode(code: string): Promise<{
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
  resource: string | null;
} | null> {
  const { data, error } = await admin()
    .from("mcp_authorization_code")
    .update({ consumed_at: new Date().toISOString() })
    .eq("code_hash", hashSecret(code))
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select(
      "client_id, user_id, redirect_uri, code_challenge, code_challenge_method, scope, resource"
    );

  if (error) {
    if (isMissingTable(error)) throw new McpNotProvisionedError();
    throw error;
  }
  return data && data.length === 1 ? data[0] : null;
}

// ── Tokens ──────────────────────────────────────────────────────────────────

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
}

/**
 * Issue an access + refresh token pair for one grant.
 *
 * `grantId` ties every token minted from a single consent together, so
 * revoking a connection is one statement rather than a hunt through rotations.
 * Pass the previous pair's grant id when refreshing.
 */
export async function issueTokenPair(input: {
  clientId: string;
  userId: string;
  scope: string;
  resource: string | null;
  label: string | null;
  grantId?: string;
}): Promise<IssuedTokens> {
  const accessToken = generateSecret("access");
  const refreshToken = generateSecret("refresh");
  const grantId = input.grantId ?? crypto.randomUUID();

  const base = {
    client_id: input.clientId,
    user_id: input.userId,
    scope: input.scope,
    resource: input.resource,
    label: input.label,
    grant_id: grantId,
  };

  const { error } = await admin()
    .from("mcp_token")
    .insert([
      {
        ...base,
        token_hash: hashSecret(accessToken),
        token_type: "access",
        expires_at: expiresAt(MCP_ACCESS_TOKEN_TTL_SECONDS),
      },
      {
        ...base,
        token_hash: hashSecret(refreshToken),
        token_type: "refresh",
        expires_at: expiresAt(MCP_REFRESH_TOKEN_TTL_SECONDS),
      },
    ]);

  if (error) {
    if (isMissingTable(error)) throw new McpNotProvisionedError();
    throw error;
  }

  return {
    accessToken,
    refreshToken,
    expiresIn: MCP_ACCESS_TOKEN_TTL_SECONDS,
    scope: input.scope,
  };
}

/**
 * Look up a live access token.
 *
 * Returns null for unknown, expired or revoked — the caller answers all three
 * with the same 401, so an attacker learns nothing from the response about
 * which of them applied.
 */
export async function findLiveAccessToken(
  accessToken: string
): Promise<TokenRow | null> {
  const { data, error } = await admin()
    .from("mcp_token")
    .select("*")
    .eq("token_hash", hashSecret(accessToken))
    .eq("token_type", "access")
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    if (isMissingTable(error)) throw new McpNotProvisionedError();
    throw error;
  }
  return data;
}

/**
 * Record that a token was just used.
 *
 * Best-effort: a failure here must not fail the MCP call the user is making.
 * It only feeds the "last used" column on the AI Integration page.
 */
export async function touchToken(id: string): Promise<void> {
  try {
    await admin()
      .from("mcp_token")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", id);
  } catch (error) {
    console.error("[mcp:touchToken]", error);
  }
}

/**
 * Redeem a refresh token, rotating it.
 *
 * Consumed with the same conditional-UPDATE pattern as authorization codes, so
 * a refresh token works exactly once. The caller then issues a fresh pair
 * under the same grant id.
 */
export async function consumeRefreshToken(
  refreshToken: string
): Promise<TokenRow | null> {
  const { data, error } = await admin()
    .from("mcp_token")
    .update({ consumed_at: new Date().toISOString() })
    .eq("token_hash", hashSecret(refreshToken))
    .eq("token_type", "refresh")
    .is("consumed_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("*");

  if (error) {
    if (isMissingTable(error)) throw new McpNotProvisionedError();
    throw error;
  }
  return data && data.length === 1 ? data[0] : null;
}

/**
 * Revoke every token in a grant — what "disconnect this machine" means.
 *
 * Scoped to `userId` as well as `grantId` so an admin cannot revoke another
 * account's connection by guessing an id: a role check is not an ownership
 * check (`.claude/rules/security.md`). Returns how many rows were affected so
 * the caller can distinguish "revoked" from "there was nothing to revoke".
 */
export async function revokeGrant(
  grantId: string,
  userId: string
): Promise<number> {
  const { data, error } = await admin()
    .from("mcp_token")
    .update({ revoked_at: new Date().toISOString() })
    .eq("grant_id", grantId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .select("id");

  if (error) {
    if (isMissingTable(error)) throw new McpNotProvisionedError();
    throw error;
  }
  return data?.length ?? 0;
}

export interface ConnectionSummary {
  grantId: string;
  /**
   * What to call this connection on screen — "Claude Code", not "claude-code".
   * Falls back to the client id only when the label is missing, which is the
   * honest thing to show rather than inventing a name.
   */
  displayName: string;
  clientId: string;
  connectedAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
}

/**
 * The caller's own live connections, newest first — one entry per grant.
 *
 * Rotation means a grant accumulates many token rows; they are folded down to
 * the grant here rather than in SQL to keep the migration free of views.
 */
export async function listConnections(
  userId: string
): Promise<ConnectionSummary[]> {
  const { data, error } = await admin()
    .from("mcp_token")
    .select("grant_id, client_id, label, created_at, last_used_at, expires_at")
    .eq("user_id", userId)
    .eq("token_type", "refresh")
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingTable(error)) throw new McpNotProvisionedError();
    throw error;
  }

  const byGrant = new Map<string, ConnectionSummary>();
  for (const row of data ?? []) {
    const existing = byGrant.get(row.grant_id);
    if (!existing) {
      byGrant.set(row.grant_id, {
        grantId: row.grant_id,
        displayName: row.label || row.client_id,
        clientId: row.client_id,
        connectedAt: row.created_at,
        lastUsedAt: row.last_used_at,
        expiresAt: row.expires_at,
      });
      continue;
    }
    // Keep the earliest connection time and the most recent use across the
    // grant's rotations, so the row reads as one continuous connection.
    if (row.created_at < existing.connectedAt) {
      existing.connectedAt = row.created_at;
    }
    if (
      row.last_used_at &&
      (!existing.lastUsedAt || row.last_used_at > existing.lastUsedAt)
    ) {
      existing.lastUsedAt = row.last_used_at;
    }
    if (row.expires_at > existing.expiresAt) {
      existing.expiresAt = row.expires_at;
    }
  }

  return [...byGrant.values()];
}
