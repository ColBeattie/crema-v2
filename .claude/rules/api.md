# API Design Rules

- Use a consistent response shape for all API routes (e.g. `{ data, error }` pattern).
- Always return appropriate HTTP status codes — don't return 200 for errors.
- Validate request body with Zod or similar before processing.
- **Authentication is not authorization.** Every route handler must independently re-verify the session (`getUser()`) AND check the caller's ownership/role for the specific object — do not assume middleware did it. A missing route-level check is a real IDOR; the DB's RLS is the backstop, not a license to skip it.
- **Wrap handlers with `withApiSecurity()`** (`lib/api-security.ts`) — auth + headers + rate limit — so a new route can't silently ship with no protection. API routes sit outside the proxy matcher and are the most common source of unprotected endpoints.
- Webhook routes must verify their signature before processing (see `security.md` → "Webhooks").
- **Recompute financially-significant fields** (amounts, deposit counts, prices) server-side; never spread the request body into a DB write (mass-assignment / price tampering).
