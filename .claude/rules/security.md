# Security Rules

> This template was hardened in a full security audit (June 2026). The two sections below — "Patterns we get right" and "Anti-patterns" — are the distilled, must-keep-in-mind version. Read them before touching auth, RLS, middleware, or validation.

- Always think about security. If you're not sure if your request is secure, think through it more. If you want the user to decide, ask him before continuing.
- CSRF: Not needed for this single-domain app. SameSite=strict cookies + Next.js Server Action origin checks provide sufficient protection.
- Secrets: never prefixed NEXT*PUBLIC* unless truly public; rotate keys; read from env at boot only.
- Never hardcode credentials, secrets, API keys, or passwords anywhere — not in code, not in `.md` files, not in scripts. Always use environment variables.
- Never store API keys unencrypted in a database table. If the user wants to store an API key, require encryption.
- Rate limiting (per IP and per user) for auth, mutations, and webhooks.
- Security headers: Content-Security-Policy, Strict-Transport-Security, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy. Also set `poweredByHeader: false` in `next.config.ts` so the framework version isn't advertised.

- Never log sensitive data (tokens, passwords, PII) even in development. Use `console.error` for actual errors only, not for debugging.

## CSP Checklist

- [ ] CSP defined in ONLY ONE place
- [ ] No CSP in vercel.json
- [ ] No CSP in proxy.ts (unless using nonces)
- [ ] No CSP in API routes
- [ ] Security utilities have CSP disabled
- [ ] `curl` shows only one CSP header
- [ ] CSP includes `'unsafe-inline'` for scripts (or nonces)
- [ ] No duplicate directives in the CSP string

**Always check for multiple CSP sources first!** The browser combining multiple CSP headers is the most common cause of "mysterious" CSP restrictions that don't match your configuration.

## Authentication & Sessions

- User roles must come from `app_metadata` (server-controlled), never `user_metadata` (client-editable).
- All admin server actions must call `checkIsAdmin()` before any logic — layout-level checks are not enough since server actions can be called directly.
- Open redirect prevention: validate `next`/`redirectTo` by parsing — `new URL(next, origin)` and confirm `.origin === origin`, else fall back to `/`. A `startsWith("/") && !startsWith("//")` check is NOT enough: WHATWG `URL` normalizes backslashes to slashes, so `/\evil.com` passes the string check but resolves cross-origin. Reject backslashes and control chars too. Apply the same on the client validators (`login`, `mfa-verify`).
- MFA sessions and rate limit counters are stored in-memory — they not only reset on deploy/restart, they are also **per serverless instance**, so the effective limit is multiplied by instance count and a `getClientId` that mixes in user-agent lets an attacker rotate UA for fresh buckets. Treat the in-memory limiter as dev-only. Before relying on it (or scaling), migrate to Supabase/Upstash/Vercel KV keyed by IP for auth endpoints.
- Never trust client-reported authentication outcomes. An endpoint must not accept `success`/`userId`/`email` from the request body and feed them into lockout, audit, or alert logic — the browser can forge them (lockout DoS, log poisoning, fake alerts). Derive the outcome server-side from the real auth result.
- **A role check is not an ownership check.** After confirming the caller's role, also verify they own / are assigned to the specific resource (`model_assignments`, `conversation_participant`, company scope, etc.) before reading or mutating it. Any action that takes an `id` from the client is an IDOR candidate — non-admin roles must be scoped to their own rows, and ownership must be enforced in the same query (`.eq('owner_id', user.id)`), not checked after the fetch. RLS is the backstop, not a substitute — see `database.md` → "RLS policies".
- **Derive client IP from the platform-trusted header** (`x-real-ip` on Vercel), never the leftmost `x-forwarded-for` entry, which is client-spoofable. If a rate-limit config exists (e.g. `MFA_VERIFY`), it must be referenced by the code path it protects — an unused config is a false sense of coverage.

## Input Validation

- All server actions and API routes must validate input with Zod via `validateInput()` before processing.
- Run dangerous pattern detection (SQL injection, XSS, command injection, path traversal) on all user-provided strings — this is handled by `lib/input-validation.ts`. Treat this as defense-in-depth ONLY: the real protection is parameterized PostgREST queries (no dynamic SQL anywhere) + contextual output encoding (`sanitizeHTML`). Do not rely on the blocklist as a primary control — it is bypassable and over-broad.
- Regex pattern matching for validation must NOT use module-level `/g` regexes with `.test()`. A global regex advances `lastIndex` between calls, so reused patterns intermittently return `false` for input that actually matches, silently passing payloads. Drop the `g` flag for `.test()`, reset `lastIndex = 0` before each test, or build fresh regexes per call.
- Sanitize filenames, HTML, and emails using the dedicated sanitize functions — never roll your own.
- **Never interpolate user input into PostgREST `.or()` / `.filter()` strings** — commas and parentheses are filter syntax and inject extra conditions. Escape PostgREST reserved characters (`,` `(` `)` `*` `\`) first, or use separate parameterized `.ilike()` / `.eq()` calls. Single-column `.eq()`/`.ilike()` calls with a bound value are safe.
- **Escape user input in every HTML email template, not just audit/alert emails.** Any user-controlled value (name, note, subject) interpolated into an HTML body must go through the `escapeHtml`/`sanitizeHTML` helper. Attacker-chosen display names are a stored-injection vector into whoever opens the mail.
- **Sanitize on the way in for any rich-text/`contentEditable`/Markdown-HTML field** that is stored and later rendered via `dangerouslySetInnerHTML`. Run DOMPurify (or an allow-list of formatting tags) at save time. "Only admins can edit it" is not sufficient — a compromised admin or direct DB write becomes stored XSS against every viewer.

## File Uploads

- Validate all three layers: MIME type whitelist, file extension check, and magic byte verification.
- Max file size: 5MB unless explicitly changed. Enforce server-side, not just client-side.
- Never use user-provided filenames for storage — generate timestamp-based names.
- **Never render user-uploaded SVG inline** (`image/svg+xml` can carry scripts) — link it, serve it from a separate origin, or sanitize it.
- **Client-SDK uploads still need server-enforced limits.** An upload performed via the client SDK must have the bucket's size cap and MIME allowlist configured, or be routed through a server action. Client-side checks alone count as zero layers.

## Error Handling

- Never expose stack traces, DB errors, file paths, or environment details to the client.
- Use `lib/error-handling.ts` to sanitize all errors before returning them in API responses.
- Return generic messages for auth failures — avoid distinguishing "user not found" from "wrong password" to prevent account enumeration.
- **Server actions and route handlers must never return Supabase/PostgREST `error.message` to the client** — it leaks table/column/constraint names. Always pass through `sanitizeErrorMessage()` / `handleSecureError()`; log the raw error server-side only.
- **A sanitizer must not log what it redacts.** When a sanitizer detects sensitive content in an error, log only metadata (pattern name, length, context) — never the flagged message body, or the sanitizer itself becomes the leak.

## Admin Operations

- All admin actions must be audit-logged with the acting user's ID, action type, and timestamp.
- Admin email notifications for security alerts should be throttled to prevent flood attacks.

### Nonce-based CSP and 'strict-dynamic'

Do NOT add `'strict-dynamic'` to `script-src` or strip `'unsafe-inline'` in favor of a per-request nonce without first verifying every `<script>` tag in the rendered HTML carries the matching nonce. `'strict-dynamic'` instructs the browser to ignore `'self'` and host allowlists — any non-nonced script (Sentry, Google Maps loader, third-party libs, anything injected by client code via `document.createElement('script')`) silently fails. React hydration dies and users get stuck on Suspense fallbacks or blank "Loading…" screens.

Required before re-enabling:

- [ ] Hard-reload the login page (or any page with a Suspense boundary) in a clean profile; confirm the form renders.
- [ ] Open every page that uses third-party scripts (Maps, Stripe, analytics, chat widgets) and confirm no `Refused to execute … CSP` errors in the console.
- [ ] If Sentry is wired up, trigger a deliberate error and confirm the event arrives.
- [ ] `view-source` on the rendered page: every `<script>` tag has a matching `nonce` attribute.
- [ ] If using Next.js: confirm middleware forwards `x-nonce` via `NextResponse.next({ request: { headers: ... } })` so the framework can apply the nonce to its own script tags.

Failure mode: users see "Loading…" or a blank Suspense fallback forever. Some users (those whose page didn't render the offending script) work fine — same "some have it, some don't" pattern as the middleware-hang class of bug.

## Webhooks

- Verify webhook **authenticity with a signature** (HMAC-SHA256 over the raw body, or the provider's native signature like Stripe's), not just a static shared secret in a header. A static bearer key has no replay protection and leaks permanently once exposed. A rate limit is not authentication.
- Compare signatures/secrets with a constant-time compare (`crypto.timingSafeEqual`), never `===`.
- Enforce a timestamp window to prevent replay; reject stale requests.
- Make any side effect idempotent — especially webhooks that create accounts or assign roles. Never let a forged/duplicated webhook mint privileged users.
- Rotate webhook secrets on a schedule and on any suspected exposure.

## Cron, internal & single-use tokens

- **Secret-gated endpoints must fail closed.** Cron / internal routes that check a shared secret must reject when the secret is unset in production (`if (NODE_ENV === 'production' && !secret) return 403`), never fall open. Compare secrets in constant time.
- **Dev-only auth bypasses must use a dedicated low-value token** (e.g. `DEV_SYNC_TOKEN`), never a production secret like the Supabase secret key, and must be gated on `NODE_ENV !== "production"`.
- **Single-use tokens must be consumed atomically.** Enforce "used once" with a conditional update (`UPDATE … WHERE status = 'pending'` and check the affected-row count) or `SELECT … FOR UPDATE` in a transaction — not a read-then-write, which races under concurrent submissions (double-submit of intake/contract/reset tokens).

## Observability

- Sentry (or any error reporter) must scrub PII before sending: add a `beforeSend` that strips query strings, headers, and request bodies, and set `sendDefaultPii: false`.

## Email endpoints

- Endpoints that send email must validate recipients against known contacts and apply per-recipient/day caps — never accept an arbitrary `to[]` from the request body. An authenticated-but-unscoped send endpoint is a spam relay.

## Patterns we get right — these are ON PURPOSE, keep them

These were verified in the security audit. Do not "simplify" or refactor them away; they are deliberate.

- **Roles from `app_metadata` everywhere**, never `user_metadata`. Admin column is NOT a `profiles.role` row a user could update — it lives in `auth.users.raw_app_meta_data`, read via `auth.jwt() -> 'app_metadata' ->> 'role'` in RLS and `checkIsAdmin()` in code. Not client-spoofable.
- **Per-action authorization.** Every mutating admin server action calls `checkIsAdmin()` at the top; layout checks are treated as non-authoritative; API routes re-verify `getUser()` + role independently.
- **`getUser()` (not `getSession()`) for any authz decision.** `getSession()` is only used to decode `amr` for recovery detection, never to grant access.
- **Server-side sign-in.** Password login runs in a route handler (`app/api/auth/login/route.ts`): the lockout check, the credential check, and login-attempt recording all happen server-side, so the outcome can't be forged by the client. Never accept a client-reported `success`/`userId`. Credentials go in the POST body, not Server Action args — Next.js prints action args to the dev console (a password-disclosure footgun); the browser session is hydrated with `setSession` from the returned tokens.
- **Server-side MFA/AAL2 enforcement that fails closed** (defaults to `all_users` on error). MFA cannot be skipped client-side; the "Skip" button is gated by independent server enforcement.
- **Origin-validated redirects.** All `next`/`redirectTo` go through `sanitizeNextPath()` (`lib/safe-redirect.ts`), which resolves against an origin and rejects backslashes/control chars — not a `startsWith("//")` string check.
- **`SECURITY DEFINER` functions are locked down** — `REVOKE` execute from `public/anon/authenticated`, `GRANT` only to `service_role`, and `SET search_path = ''`. The recovery/invite marker cookie is `httpOnly` (read/cleared via server actions), so the client can't tamper with the middleware gate.
- **File upload validates three layers** (MIME + extension + magic bytes), enforces 5MB server-side, validates the target as a UUID, generates timestamp filenames (never user-supplied), and rejects `..`/`\`. No fetch-by-URL (no SSRF surface).
- **No mass assignment** — Zod schemas use `z.enum` for roles and explicit fields, no `.passthrough()`. A client cannot smuggle extra `app_metadata`/role fields.
- **Last-admin / self-action protections** — can't delete yourself, can't delete or demote the only admin; role changes force a global sign-out.
- **Audit logs are append-only** (no UPDATE/DELETE policy), written via the service role with the server-derived acting user ID; email content is HTML-encoded against injection.
- **Account lockout is DB-backed and persistent** (survives restarts), with a partial unique index for one active lockout per email.
- **CSP defined in exactly one place** (`lib/security-headers.ts`), strong header baseline (HSTS preload, `frame-ancestors 'none'`, `object-src 'none'`, `nosniff`), and a clean secrets posture (nothing in tree or git history; strong `.gitignore` + `.claude/settings.json` deny-list).

## Anti-patterns — these were found and FIXED; never reintroduce them

The June 2026 audit found and fixed each of these. They are the classic mistakes for this stack — if you find yourself writing one (here or in a derived project), stop.

- **PUBLIC-executable `SECURITY DEFINER` RPC.** A definer function with no `REVOKE` is callable by the anon key via PostgREST. `delete_user_mfa_factors()` could strip MFA off any account. Always REVOKE from `public, anon, authenticated`, GRANT only `service_role`, and `SET search_path = ''`. See `database.md`.
- **Client-trusted login outcomes.** The old `/api/auth/login-attempt` accepted `success`/`userId` from the body → lockout DoS + audit/alert poisoning. Login outcomes are now recorded only from the real server-side auth result; that route (and the `check-lockout` oracle) were deleted.
- **`startsWith("//")`-only redirect validation.** Misses the backslash bypass (`/\evil.com`). Use `sanitizeNextPath()`.
- **Outbound network calls in middleware** — global `signOut()` and a `from("setting")` query on the hot path. Now `signOut({ scope: 'local' })` + a cached, time-bounded MFA-requirement read. See `middleware.md`.
- **Claiming RLS protects reads on a `public = true` storage bucket.** It does not — the CDN serves bytes with no auth check. Use a private bucket + signed URLs for anything sensitive.
- **Stateful `/g` regexes with `.test()`** (advancing `lastIndex` → intermittent false negatives). Reset `lastIndex` or drop `g`.
- **Rate-limit key that includes the User-Agent** (attacker rotates it for fresh buckets). Key on IP (anonymous) or user id (actions).
- **Secret env var with a `NEXT_` prefix** (one typo from `NEXT_PUBLIC_` bundling it client-side). Use `SUPABASE_SECRET_KEY`.

New API routes: wrap handlers with `withApiSecurity()` (`lib/api-security.ts`) — they're outside the proxy matcher, so they own their auth + headers + rate limit.

## Accepted residual risk (deliberate, do not "fix" without discussion)

- **`'unsafe-inline'` in `script-src`** — residual XSS risk; nonce migration is the eventual fix (see the nonce checklist above), but don't enable `'strict-dynamic'` without following it.
- **In-memory rate limiting** (`lib/rate-limiting.ts`) is best-effort and per-instance. Durable, security-critical lockout is DB-backed; before relying on the limiter as a real control, back it with Redis/Upstash/Vercel KV.
- **`.mcp.json` runs `npx shadcn@latest`** — dev-only tooling, intentionally left unpinned.
