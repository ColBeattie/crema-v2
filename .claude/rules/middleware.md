# Middleware / Edge Rules

Routing middleware (`middleware.ts` in Next.js ≤15, `proxy.ts` in Next.js 16+, or the equivalent in any framework) runs as a function on every matched request, bounded by the platform's function timeout. On Vercel the default is **300 seconds** — anything that blocks here stalls the user's request for up to 5 minutes before the platform kills the function. Failures present as multi-minute UX hangs, not crashes, which makes them hard to attribute to the offending commit.

## Hard rules

- **No outbound HTTP from middleware.** No `fetch` to third-party APIs, no SDK calls that perform I/O. Move that work to a Route Handler / Server Action / API route where the user isn't blocked behind it.
- Reading and validating request cookies/headers locally is fine. Calling out to validate them with a remote auth server is not — use the SDK's local validation if it has one.
- Never `await` a Promise in middleware that you can't bound with a known-fast timeout.

## If using Supabase Auth

- `supabase.auth.getUser()` is allowed — it's the SSR cookie validator and does not call out by default.
- `supabase.auth.signOut()` defaults to `scope: 'global'`, which POSTs to `/auth/v1/logout` and **will hang** the request if Supabase is slow. Use `supabase.auth.signOut({ scope: 'local' })` when cookie clearing is required from middleware.
- Treat `AuthSessionMissingError` as "no user, proceed" — it is the expected response for any logged-out visitor and any stale-cookie state. Must NOT trigger signOut, network cleanup, or revocation calls.

## How `lib/supabase/middleware.ts` complies (keep it this way)

These were the two violations the June 2026 audit fixed — the patterns to preserve:

- Auth-error cleanup uses **`supabase.auth.signOut({ scope: 'local' })`** (cookie clear only, no `/auth/v1/logout` round-trip), and detects the benign logged-out case via **`error.name === "AuthSessionMissingError"`**, not a message substring.
- The MFA-requirement read goes through **`getMfaRequirementCached()`** — a per-instance cached, `AbortSignal.timeout`-bounded, fail-closed getter — instead of an unbounded `from("setting")` query on every request.

If you add logic here, hold this line: no unbounded outbound calls, local-scope sign-out only.

## Why this exists

Failure mode is user-state-dependent — users whose request happens to skip the blocking branch don't see it, so the bug presents as "some users are broken, some aren't." Classic regression: introduced in a "security update / hardening" PR that looked harmless in code review.
