-- 0001_mcp-oauth.sql
-- Date: 2026-09-09
--
-- Storage for the MCP (Model Context Protocol) integration's OAuth 2.1
-- authorization server: registered clients, in-flight authorization requests,
-- one-time authorization codes, and the access/refresh tokens an AI client
-- holds afterwards.
--
-- WHY THESE TABLES EXIST
-- Supabase Auth issues cookies for browsers. An AI client (Claude Code) is not
-- a browser: it holds a bearer token, refreshes it unattended, and must be
-- revocable per-machine without signing the human out of the web app. So this
-- app acts as its own OAuth authorization server for the /api/mcp resource,
-- and Supabase Auth remains the identity provider behind the consent screen —
-- the user still signs in with email + password + TOTP exactly as they do for
-- the web app, because the consent page is a normal protected route.
--
-- SECURITY POSTURE — read before changing anything here
--   * Every table is service-role only. RLS is enabled AND the anon /
--     authenticated grants are revoked, so PostgREST cannot reach these rows
--     with a user's JWT even if a policy were added by mistake. All access goes
--     through lib/mcp/store.ts using the admin client, behind checkIsAdmin().
--   * Secrets are stored HASHED (SHA-256, hex), never in plaintext: a database
--     dump must not yield usable tokens. The columns are named `*_hash` so a
--     future writer cannot mistake them for the real value.
--   * Authorization codes and refresh tokens are single-use. Consumption is a
--     conditional UPDATE (... WHERE consumed_at IS NULL) whose affected-row
--     count is checked, never a read-then-write — see .claude/rules/security.md
--     → "Single-use tokens must be consumed atomically".
--
-- Idempotent and transactional: safe to re-run.

BEGIN;

-- =============================================
-- 1. REGISTERED OAUTH CLIENTS
-- =============================================

-- Clients are seeded here, not self-registered. Dynamic Client Registration
-- (RFC 7591) is deliberately NOT implemented: it is an unauthenticated write
-- endpoint, and this integration has exactly one known client shape (a CLI on
-- the user's machine listening on a loopback port). To support another client,
-- INSERT a row here in a new migration.
CREATE TABLE IF NOT EXISTS public.mcp_oauth_client (
    client_id TEXT PRIMARY KEY CHECK (client_id != ''),
    client_name TEXT NOT NULL CHECK (client_name != ''),
    -- Exact-match allowlist. The token exchange re-checks the redirect_uri
    -- against this list, so an attacker cannot swap in their own callback.
    redirect_uris TEXT[] NOT NULL CHECK (array_length(redirect_uris, 1) > 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

ALTER TABLE public.mcp_oauth_client ENABLE ROW LEVEL SECURITY;

-- =============================================
-- 2. PENDING AUTHORIZATION REQUESTS
-- =============================================

-- The OAuth parameters are parked here for the duration of the login.
--
-- WHY: /api/mcp/authorize receives the OAuth query string, but the visitor is
-- usually not signed in yet. The routing middleware sends them to
-- /auth/login?redirectTo=<path> — PATH ONLY, the query string is dropped — so
-- carrying the parameters through the login + MFA round trip in the URL is not
-- possible. Instead they are stored under an unguessable id which travels as a
-- PATH SEGMENT (/ai-integration/authorize/<id>) and therefore survives.
CREATE TABLE IF NOT EXISTS public.mcp_authorization_request (
    id TEXT PRIMARY KEY CHECK (id != ''),
    client_id TEXT NOT NULL REFERENCES public.mcp_oauth_client(client_id) ON DELETE CASCADE,
    redirect_uri TEXT NOT NULL CHECK (redirect_uri != ''),
    -- PKCE is mandatory (S256 only); a request without it is rejected before
    -- a row is ever written.
    code_challenge TEXT NOT NULL CHECK (code_challenge != ''),
    code_challenge_method TEXT NOT NULL CHECK (code_challenge_method = 'S256'),
    state TEXT,
    scope TEXT NOT NULL DEFAULT 'mcp:read',
    -- RFC 8707 resource indicator, echoed back into the token's audience.
    resource TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    consumed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_mcp_authorization_request_expires_at
    ON public.mcp_authorization_request(expires_at);

ALTER TABLE public.mcp_authorization_request ENABLE ROW LEVEL SECURITY;

-- =============================================
-- 3. ONE-TIME AUTHORIZATION CODES
-- =============================================

-- Written when the user approves the consent screen, exchanged once at
-- /api/mcp/token, then dead. Short-lived by design (60 seconds) — the code
-- never leaves the user's machine, so it has no reason to live longer.
CREATE TABLE IF NOT EXISTS public.mcp_authorization_code (
    -- SHA-256 of the code. The code itself is never stored.
    code_hash TEXT PRIMARY KEY CHECK (code_hash != ''),
    client_id TEXT NOT NULL REFERENCES public.mcp_oauth_client(client_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    redirect_uri TEXT NOT NULL CHECK (redirect_uri != ''),
    code_challenge TEXT NOT NULL CHECK (code_challenge != ''),
    code_challenge_method TEXT NOT NULL CHECK (code_challenge_method = 'S256'),
    scope TEXT NOT NULL DEFAULT 'mcp:read',
    resource TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    consumed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_mcp_authorization_code_expires_at
    ON public.mcp_authorization_code(expires_at);

ALTER TABLE public.mcp_authorization_code ENABLE ROW LEVEL SECURITY;

-- =============================================
-- 4. ACCESS AND REFRESH TOKENS
-- =============================================

-- One row per issued token. Access tokens are short (1 hour); refresh tokens
-- are long (30 days) and ROTATE on every use — the old row is marked consumed
-- and a new one issued, so a stolen refresh token stops working the moment the
-- legitimate client refreshes.
--
-- `label` is what the user sees on the AI Integration page ("Claude Code on
-- this machine"), so a connection can be revoked without guessing which is
-- which.
CREATE TABLE IF NOT EXISTS public.mcp_token (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    -- SHA-256 of the token. Unique so a lookup is a single index hit.
    token_hash TEXT NOT NULL UNIQUE CHECK (token_hash != ''),
    token_type TEXT NOT NULL CHECK (token_type IN ('access', 'refresh')),
    client_id TEXT NOT NULL REFERENCES public.mcp_oauth_client(client_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    scope TEXT NOT NULL DEFAULT 'mcp:read',
    resource TEXT,
    label TEXT,
    -- Groups every token minted from one consent, so revoking a connection
    -- revokes the whole family in one statement.
    grant_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_used_at TIMESTAMP WITH TIME ZONE,
    consumed_at TIMESTAMP WITH TIME ZONE,
    revoked_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_mcp_token_user_id ON public.mcp_token(user_id);
CREATE INDEX IF NOT EXISTS idx_mcp_token_grant_id ON public.mcp_token(grant_id);
CREATE INDEX IF NOT EXISTS idx_mcp_token_expires_at ON public.mcp_token(expires_at);

ALTER TABLE public.mcp_token ENABLE ROW LEVEL SECURITY;

-- =============================================
-- 5. LOCK DOWN ACCESS
-- =============================================

-- Two independent layers, because either alone is one mistake away from
-- exposure:
--   (a) REVOKE removes the table from PostgREST's reach for anon/authenticated
--       entirely — no policy can accidentally open it up.
--   (b) An explicit deny-all policy so the table is never "RLS enabled, no
--       policy" (which the Supabase security advisor flags, and which reads
--       ambiguously to the next person). The service role bypasses RLS, which
--       is how lib/mcp/store.ts reaches these rows.
REVOKE ALL ON public.mcp_oauth_client FROM anon, authenticated;
REVOKE ALL ON public.mcp_authorization_request FROM anon, authenticated;
REVOKE ALL ON public.mcp_authorization_code FROM anon, authenticated;
REVOKE ALL ON public.mcp_token FROM anon, authenticated;

DROP POLICY IF EXISTS "Service role only" ON public.mcp_oauth_client;
CREATE POLICY "Service role only" ON public.mcp_oauth_client
    FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "Service role only" ON public.mcp_authorization_request;
CREATE POLICY "Service role only" ON public.mcp_authorization_request
    FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "Service role only" ON public.mcp_authorization_code;
CREATE POLICY "Service role only" ON public.mcp_authorization_code
    FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "Service role only" ON public.mcp_token;
CREATE POLICY "Service role only" ON public.mcp_token
    FOR ALL USING (false) WITH CHECK (false);

-- =============================================
-- 6. SEED THE CLAUDE CODE CLIENT
-- =============================================

-- Matches lib/mcp/config.ts. The AI Integration page prints the same client id
-- and port into the `claude mcp add` command, so these three must agree — if
-- you change the port here, change MCP_CALLBACK_PORT too, or sign-in fails
-- with redirect_uri_mismatch.
--
-- Both loopback spellings are registered because OAuth compares redirect URIs
-- as exact strings, and clients differ on which one they use.
INSERT INTO public.mcp_oauth_client (client_id, client_name, redirect_uris)
VALUES (
    'claude-code',
    'Claude Code',
    ARRAY[
        'http://localhost:51703/callback',
        'http://127.0.0.1:51703/callback'
    ]::text[]
)
ON CONFLICT (client_id) DO UPDATE SET
    client_name = EXCLUDED.client_name,
    redirect_uris = EXCLUDED.redirect_uris,
    updated_at = NOW();

COMMIT;
