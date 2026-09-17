# AI Integration (MCP)

This app can be connected to an AI client — Claude Code, Claude Desktop, or
anything else that speaks the [Model Context Protocol](https://modelcontextprotocol.io) —
so the assistant can read app data on the user's behalf.

The user-facing page is **`/ai-integration`**, reachable from the account menu
under the profile picture (admins only). It walks through setup and lists the
machines currently connected.

---

## Before it works: run the migration

> **This page is for whoever holds Supabase access** — Productivity Tools, or a
> team member with the Supabase project. The app's own administrators cannot
> enable this themselves, and `/ai-integration` deliberately does not tell them
> to: its banner says who to ask instead. Keep that split when editing copy —
> file names, env vars and SQL belong here, not on the page.

**Nothing works until `sql/0001_mcp-oauth.sql` has been run in the Supabase SQL
Editor for this project.** It creates the four tables that store AI client
connections and registers the `claude-code` OAuth client. Until then
`/ai-integration` shows a "not switched on yet" banner and the sign-in step
fails.

This is deliberate — it is a schema change, and this template does not apply
those automatically.

After running it, run the Supabase **security advisor** and confirm
`rls_policy_always_true` and `rls_enabled_no_policy` are clear.

Then tell the client it is live. Their administrators can follow the four steps
on `/ai-integration` unaided from that point.

---

## What is exposed

Read-only tools, admins only. Defined in `lib/mcp/tools.ts`:

| Tool                  | Returns                                                      |
| --------------------- | ------------------------------------------------------------ |
| `whoami`              | The connected account and its role                           |
| `list_users`          | Accounts with role, created date, last sign-in, deactivation |
| `get_user`            | One account, by id or email                                  |
| `list_audit_log`      | Administrative audit entries, filterable by action           |
| `list_login_attempts` | Sign-in attempts with outcome, IP and location               |
| `get_settings`        | The `setting` key/value table                                |

Nothing writes. There are no create, update or delete tools, and no access to
Storage, email, passwords, MFA secrets or session tokens.

## Who may connect

Admins only — `isEntitledToMcp()` in `lib/mcp/entitlement.ts` is the single
decision, and it is re-checked on **every** request rather than baked into the
token. Removing someone's admin role, or deactivating them, cuts their AI
client off on its next call.

> **Adding a new role?** Ask the user whether that role may connect an AI
> client, then encode the answer in `isEntitledToMcp()` and record it in that
> function's comment. Never infer it from the role's name — see the note in
> that file.

---

## How the pieces fit

```
Claude Code                          This app                        Supabase
    │                                    │                              │
    │ 1. POST /api/mcp (no token)        │                              │
    │───────────────────────────────────>│                              │
    │ <── 401 + WWW-Authenticate ────────│                              │
    │      resource_metadata=…           │                              │
    │                                    │                              │
    │ 2. GET /.well-known/oauth-protected-resource                      │
    │    GET /.well-known/oauth-authorization-server                    │
    │───────────────────────────────────>│  (discovery, public)         │
    │                                    │                              │
    │ 3. browser → /api/mcp/authorize    │                              │
    │───────────────────────────────────>│ parks the request,           │
    │                                    │ redirects to the consent page│
    │                                    │───── login + TOTP ──────────>│
    │                                    │ (normal protected route)     │
    │ <── redirect to localhost:51703 ───│ with a one-time code         │
    │                                    │                              │
    │ 4. POST /api/mcp/token (PKCE)      │                              │
    │───────────────────────────────────>│ access + refresh token       │
    │                                    │                              │
    │ 5. POST /api/mcp  Bearer …         │ token → user → role check    │
    │───────────────────────────────────>│─────────────────────────────>│
```

### Files

| Path                             | Role                                                    |
| -------------------------------- | ------------------------------------------------------- |
| `sql/0001_mcp-oauth.sql`         | The four tables + the seeded `claude-code` client       |
| `lib/mcp/config.ts`              | Client-safe constants (client id, port, scopes, slug)   |
| `lib/mcp/entitlement.ts`         | **Who may connect** — the single gate                   |
| `lib/mcp/tokens.ts`              | Secret generation, hashing, PKCE verification           |
| `lib/mcp/store.ts`               | All database access (service role)                      |
| `lib/mcp/tools.ts`               | **The tools** — extend here                             |
| `lib/mcp/protocol.ts`            | JSON-RPC message handling                               |
| `lib/mcp/url.ts`                 | This deployment's public origin                         |
| `app/api/mcp/route.ts`           | The MCP endpoint (bearer auth)                          |
| `app/api/mcp/authorize/route.ts` | OAuth authorize — parks the request, hands off to login |
| `app/api/mcp/token/route.ts`     | OAuth token — code exchange + refresh rotation          |
| `app/api/mcp/oauth/*/route.ts`   | The two discovery documents                             |
| `app/ai-integration/`            | The page, the consent screen, and their actions         |

Two pieces of wiring are easy to miss:

- **`next.config.ts` rewrites** map `/.well-known/oauth-*` to the handlers
  under `/api/mcp/oauth/`. Those paths are fixed by RFC 8414 / RFC 9728.
- **`proxy.ts` excludes `.well-known`** from the middleware matcher. Middleware
  runs before rewrites, so without the exclusion a discovery request from an
  unauthenticated client would be answered with a redirect to `/auth/login`.

---

## Security decisions worth knowing

These are deliberate. Don't undo them without reading why.

- **Opaque tokens, not JWTs.** Revocation must be instant ("that laptop is
  gone"), and every request already loads the user, so a random token plus an
  indexed hash lookup costs nothing and needs no signing key.
- **Tokens are stored SHA-256 hashed.** A database dump yields no usable
  credentials. Unsalted SHA-256 is correct here _because these are 256-bit
  random strings, not passwords_ — do not copy the pattern for anything a human
  chooses.
- **PKCE S256 is mandatory.** `plain` is refused at both the authorize endpoint
  and in `verifyPkce()`.
- **Refresh tokens rotate, and reuse revokes the grant.** Presenting a consumed
  refresh token means two parties hold it; the whole grant is cut.
- **Redirect URIs are exact-match** against the registered list, checked again
  at approval and again at token exchange.
- **No Dynamic Client Registration.** It is an unauthenticated write endpoint
  and this integration has one known client. Add clients by migration.
- **The consent screen is a normal protected route**, so login and the TOTP
  challenge come from the app's existing middleware — none of it is
  reimplemented here.
- **Every table is service-role only** (grants revoked _and_ deny-all
  policies), so PostgREST cannot reach token state with a user's JWT.

### Why the OAuth parameters go through the database

The routing middleware redirects an unauthenticated visitor to
`/auth/login?redirectTo=<path>` — **path only, the query string is dropped**. So
the OAuth parameters cannot survive login + MFA in the URL. `/api/mcp/authorize`
parks them in `mcp_authorization_request` under an unguessable id, which travels
as a _path segment_ (`/ai-integration/authorize/<id>`) and comes back intact.

If you ever change that middleware redirect to preserve the query string, this
indirection can go — but nothing else depends on it, and the current shape also
keeps the OAuth parameters out of the login page's URL bar.

---

## Extending it

### Adding a read-only tool

Add an entry to `MCP_TOOLS` in `lib/mcp/tools.ts`. `tools/list` and
`tools/call` pick it up automatically. Write the description for a model that
will read it literally: say what it returns **and what it does not**.

### Adding a tool that writes

Stop and think first, then ask the user. This server issues one coarse scope
(`mcp:read`), so a mutating tool added to the registry becomes available to
every token already in the wild on the next deploy.

1. Introduce a second scope (e.g. `mcp:write`) in `lib/mcp/config.ts`.
2. Require it on the tool, so existing tokens do not silently gain it.
3. Audit-log every write with the acting user's id, as the admin server actions
   do.

### Widening who may connect

Do **not** loosen `isEntitledToMcp()` on its own. Gate each tool on the
caller's role in `lib/mcp/tools.ts` first (scope queries by `user.id` inside
the query, not after the fetch), then widen the entitlement.

---

## Changing the callback port or client id

They appear in three places and must agree, or sign-in fails with
`redirect_uri_mismatch`:

1. `redirect_uris` seeded in `sql/0001_mcp-oauth.sql`
2. `MCP_CALLBACK_PORT` / `MCP_CLIENT_ID` in `lib/mcp/config.ts`
   (overridable by `NEXT_PUBLIC_MCP_CALLBACK_PORT` / `NEXT_PUBLIC_MCP_CLIENT_ID`)
3. The command the page prints — which reads from (2), so it follows

---

## Troubleshooting

| Symptom                                  | Cause                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| Setup banner stays on `/ai-integration`  | The migration has not been run, or `SUPABASE_SECRET_KEY` is missing                       |
| The server does not appear in `/mcp`     | Claude Code was not restarted after `claude mcp add`                                      |
| `redirect_uri_mismatch`                  | `--callback-port` does not match the seeded `redirect_uris`                               |
| Browser lands on `/auth/login` and stops | Expected on first connect — sign in; the consent screen follows                           |
| "This request is no longer valid"        | The request expired (10 min) or was already used. Re-run `/mcp` → Authenticate            |
| Tools list is empty after connecting     | The account is not an admin. `whoami` still works; everything else requires the role      |
| 401 on every call after it worked        | The account's admin role was removed, or it was deactivated — both cut access immediately |

The `NEXT_PUBLIC_SITE_URL` env var pins the origin advertised in the discovery
documents. It is optional: without it the origin is derived from the request's
forwarded headers, which is correct on localhost, preview deployments and
custom domains alike.
