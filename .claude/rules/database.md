# Database Rules

## Schema Design

- **Always check existing tables first** before creating a new one — avoid duplicate or near-duplicate tables (e.g. "user" vs "users").
- Always enable RLS when you create a new table, unless there's a very good reason not to. If you think that's the case, confirm it with the user.
- Strict schemas: NOT NULL, CHECK constraints, enums for statuses, foreign keys with ON DELETE behavior defined.
- Admin/role lives in `auth.users` `app_metadata` (server-controlled), NOT in a `profiles.role` column the row owner could update via PostgREST. RLS reads it via `auth.jwt() -> 'app_metadata' ->> 'role'`. This is on purpose — keep it that way.

## RLS policies — no always-true on entity/financial tables

RLS is the real authorization boundary; server-side `checkIsAdmin()` is defense-in-depth, not a substitute. A client with the anon key + their own JWT can hit PostgREST directly and bypass every server action.

- **Never ship `USING (true)` (or `WITH CHECK (true)`) for SELECT/UPDATE/DELETE/ALL on a table that holds user, financial, or cross-tenant data.** It silently disables RLS for every authenticated user. `FOR ALL USING(true)` on entity tables (`users`, `operators`, `models`, `invoices`, `expenses`) is the worst case — full horizontal + vertical privilege escalation at the data layer.
- A bare `WITH CHECK (true)` on INSERT is sometimes acceptable (e.g. a public lead form, or notifications written by the service role) — but only when SELECT/UPDATE are separately locked down. Default to scoping it.
- Every policy needs an ownership or role predicate. Standard shape:
  ```sql
  USING (
    owner_id = auth.uid()
    OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin','manager')
  )
  ```
- Split read vs write into separate policies; don't reach for `FOR ALL`.
- "The app does role filtering in the UI / server action" is NOT a reason to leave RLS open. RLS must hold even if the app layer is bypassed.

After any DDL/policy change, run the Supabase security advisor (see "Run the security advisor after schema changes" below) and confirm `rls_policy_always_true` is empty.

## Run the security advisor after schema changes

After any DDL or RLS/policy change, run the Supabase **security advisor** (MCP `get_advisors` type `security`, or the dashboard linter). Treat these as must-fix before considering the change done:

- `rls_policy_always_true`, `rls_enabled_no_policy`
- `anon_security_definer_function_executable` / `authenticated_security_definer_function_executable`
- `function_search_path_mutable`, `public_bucket_allows_listing`, `extension_in_public`

Include the remediation URL the advisor returns when reporting back.

## SQL files & migrations (ALWAYS follow)

Every piece of SQL you generate MUST be saved to a file — never hand the user inline SQL to "just paste" without also writing it to disk. This keeps a complete, ordered migration history.

- **Location:** all `.sql` files go in `/sql`. (The one-time baseline `setup/database-setup.sql` and `setup/add-admin-role.sql` stay where they are; everything incremental after them is a numbered migration in `/sql`.)
- **Naming:** `NNNN_short-description.sql` with a zero-padded 4-digit sequence prefix, e.g. `0001_add-orders-table.sql`, `0002_add-order-status-enum.sql`. **The highest number is the latest migration** — that's how we know the order.
- **Next number:** list `/sql`, take the current max prefix, add 1. If `/sql` has no numbered files yet, start at `0001`. Never reuse or renumber an existing prefix.
- **Idempotent + transactional:** wrap each migration in `BEGIN; … COMMIT;` and prefer `CREATE … IF NOT EXISTS`, `CREATE OR REPLACE`, and `DROP POLICY IF EXISTS` before `CREATE POLICY`, so re-running is safe.
- **Header comment:** start each file with what it does and the date.
- **Don't delete applied migrations** — they are the history. (A throwaway scratch file the user explicitly asks to remove is the only exception.)
- After writing a migration, tell the user it's at `/sql/NNNN_…sql` and that they run it in the Supabase SQL Editor.
- **Every database object must be version-controlled.** Every function, trigger, policy, and table on the live database must exist in a `/sql` migration in this repo. If you find a live object with no migration (legacy carry-over), dump its definition into a migration before modifying or relying on it — unversioned objects can't be audited or safely changed.

## SECURITY DEFINER functions

A `SECURITY DEFINER` function runs as its owner and bypasses RLS, so every one is a potential privilege-escalation primitive. Two rules, no exceptions:

- **`REVOKE` execute from public.** Postgres grants `EXECUTE` to `PUBLIC` by default, and PostgREST exposes any RPC the caller's role can run — so a definer function is callable by the anon key (i.e. unauthenticated) unless you revoke it. Always add `REVOKE ALL ON FUNCTION <fn>(<args>) FROM PUBLIC, anon, authenticated;` and grant only the role that needs it (usually `service_role`). Better still, do privileged work through the server-side admin client behind `checkIsAdmin()` instead of a DB function.
- **Lock the search_path.** Add `SET search_path = ''` and schema-qualify every object (`auth.mfa_factors`, `public.profiles`) so a shadowed object can't hijack the definer's privileges. This applies even to trigger-only functions (`handle_new_user`) — the Supabase linter flags them.
- **Keep default privileges revoked.** After the initial REVOKE migration, keep `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;` in place so newly created functions are not anon-callable by default. When adding an RPC, explicitly `GRANT EXECUTE` to the role(s) that need it — nothing else.
- **Every RPC needs an internal auth guard, regardless of grants.** Check `auth.uid() IS NULL` (or `public.is_admin()`) in the function body even if EXECUTE grants look right — grants and bodies drift independently, and PostgREST exposes whatever the caller's role can run.
- **Never expose a generic `exec_sql` / dynamic-SQL RPC.** A function that runs caller-supplied SQL is a remote-code primitive against the database; do privileged DDL through versioned migrations, not a callable RPC.

(`delete_user_mfa_factors()` is the worked example — it's now locked down with both REVOKE and `search_path`. Follow that pattern for any new definer function.)

## Storage buckets

- A `public = true` bucket serves object bytes via the CDN with **no auth check** — RLS `SELECT` policies are bypassed for reads. Never rely on RLS to protect contents of a public bucket, and never write a comment claiming it does.
- For anything sensitive, use a private bucket + signed URLs. Public buckets are only for genuinely world-readable assets.

## New Supabase project checklist

Configuration, not code — easy to forget and not caught by code review:

- Enable leaked-password protection (Auth → Passwords).
- Keep storage buckets **private by default**; make a bucket public only for genuinely world-readable assets.
- Enable network restrictions (see below).
- Run the security advisors once after initial schema setup, then again after any DDL.

## Supabase Network Restrictions

Network restrictions are enabled on our Supabase project. Direct database connections (e.g., running scripts locally that use a Postgres connection string) will be blocked unless your IP is allowlisted. If a script fails to connect to the database, ask the user to add their IP address via:

**Supabase → Project → Database → Settings → Network restrictions → "Add restriction" → Choose IPv4 or IPv6 → Add IP**

This does not affect the Supabase client SDK (PostgREST, Auth, Storage), which works over HTTPS regardless of network restrictions.
