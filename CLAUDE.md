# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Next.js 16.0.10 application using TypeScript, React 19.2, and Tailwind CSS v4. The project uses the App Router architecture with Turbopack for development. Requires Node.js 22+.

## Development Commands

```bash
# Start development server with Turbopack
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Run linting
npm run lint
```

## Architecture

### Directory Structure

- `/app` - Next.js App Router directory containing pages and layouts
  - `layout.tsx` - Root layout with Geist font configuration
  - `page.tsx` - Home page component
  - `globals.css` - Global styles with Tailwind CSS v4 imports and CSS variables
- `/public` - Static assets (SVG icons and images)
- `/sql` - All SQL files (migrations, seeds, queries, etc.)
- `/scripts` - All scripts (shell, migration, utility, etc.)
- `/documentation` - All project documentation (guides, specs, etc.)

### Key Technologies

- **Next.js 16.0.10** with App Router
- **React 19.2.3** and **React DOM 19.2.3**
- **TypeScript 5.9** with strict mode enabled
- **Tailwind CSS v4** using PostCSS plugin architecture
- **Turbopack** for fast development builds
- **Node.js 22+** required

### TypeScript Configuration

- Target: ES2022
- Strict mode enabled
- Path alias: `@/*` maps to root directory
- Module resolution: bundler
- JSX: react-jsx

### Styling & UI Components

- **shadcn/ui** for component design (via [ui.shadcn.com](https://ui.shadcn.com))
- Tailwind CSS v4 with PostCSS integration
- CSS variables for theming (light/dark mode support)
- Custom fonts: Geist Sans and Geist Mono from Google Fonts
- Dark mode responsive via `prefers-color-scheme`

### shadcn/ui Registry Best Practices

- **Clear Descriptions**: Add concise, informative descriptions that help AI assistants understand what a registry item is for and how to use it.
- **Proper Dependencies**: List all dependencies accurately so MCP can install them automatically.
- **Registry Dependencies**: Use `registryDependencies` to indicate relationships between items.
- **Consistent Naming**: Use kebab-case for component names and maintain consistency across the registry.

## Routing middleware

- Use `proxy.ts`, not `middleware.ts`. In Next.js 16+ `middleware.ts` is deprecated — routing middleware lives in `proxy.ts`. Add new request-interception logic there. See `.claude/rules/middleware.md`.

## Git

- The default branch is `main` (not `master`). Always use `main` for PRs, merges, and references.

## React Compiler compatibility

The React Compiler (Next.js 16+) emits `react-hooks/incompatible-library` warnings for third-party hooks that return functions which cannot be safely memoized (e.g. TanStack Table's `useReactTable`, some form libraries).

- Treat these warnings as informational about a library limitation, not a bug to fix.
- Do not restructure the call site to "work around" it unless explicitly asked.
- Suppress at the call site with a targeted disable and a one-line reason:

  ```ts
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table returns non-memoizable functions
  const table = useReactTable({ ... });
  ```

- If the same library triggers the warning in many places, ask before adding a global rule override.

## Dependency audit

CI fails on HIGH or CRITICAL advisories. Unfixable / non-exploitable advisories may be allowlisted in `.audit-ci.jsonc`. Every allowlist entry requires (1) a written reason explaining why the advisory is not exploitable in this codebase, and (2) an expiry date — typically 3 months out — at which point the entry must be re-evaluated. Aikido provides ongoing monitoring for advisories that drop against existing dependencies. Run `npm run audit` locally (or `npm run check`) to mirror the CI gate — the bare `npm audit` command is a different built-in and will report MODERATE/LOW findings the gate intentionally ignores.

## Passkeys

Passwordless sign-in via Supabase's first-factor passkey API ships wired up but **needs per-project config**: Authentication → Passkeys in the Supabase dashboard (RP display name, RP ID, RP origins). Nothing works until that's on. Full guide: `/documentation/passkeys.md`.

- **A passkey is not a second factor.** It replaces the password. Passkeys live in `supabase.auth.passkey.*` and never appear in `auth.mfa.listFactors()`, so registering one does not satisfy the MFA requirement. Never offer "passkey" as an alternative to TOTP on `/auth/mfa-setup` — it creates no factor, so middleware would loop the user back there forever.
- Supabase issues **AAL1** for a passkey sign-in while forcing `nextLevel = aal2` for anyone with a verified factor, so `checkAal2Enforcement()` in `lib/supabase/middleware.ts` exempts sessions whose `amr` contains `passkey`. Without that exemption every passkey user is bounced to `/auth/mfa-verify`. Password sign-ins still complete TOTP as before.
- GoTrue refuses passkey add/remove on an AAL1 session **only when the account already has a verified MFA factor**. The profile page checks first (`getStepUpFactorId()`) and steps up with a TOTP dialog when needed. **Accounts without 2FA must never be asked to step up** — that path has to register straight away, or a first passkey can't be added at all.
- Requires `@supabase/supabase-js` v2.105+ and `auth.experimental.passkey: true` on **both** the browser client and the admin client (`lib/supabase/admin.ts` — `auth.admin.passkey.*` throws without it). Changing the Relying Party ID invalidates every passkey already registered.
- Admin recovery for a lost device lives in Settings → User management: a Passkey column per user plus `resetUserPasskeys()`. It removes **all** of a user's passkeys and is separate from `resetUserMfa()` — resetting one credential type never touches the other.

## Support widget

The in-app support widget (Productivity Tools Support) ships wired up in this template but **not provisioned**. Full guide: `/documentation/support-widget.md`.

- All ticket UI is rendered remotely in an iframe — **never build ticket forms, lists, status logic or local ticket storage here**, and never modify or fork the SDK.
- The support origin is hardcoded as `SUPPORT_URL` in `lib/support.ts` (it's the same for every project). What's per-project is `NEXT_PUBLIC_SUPPORT_INSTALLATION_KEY` plus the three server-only values (`SUPPORT_SIGNING_SECRET`, `SUPPORT_ISSUER_ID`, `SUPPORT_KEY_ID`). Issue a **separate installation per environment**; rotation changes **both** the secret and the key id.
- `SUPPORT_SIGNING_SECRET` is read in exactly one file (`lib/support-token.ts`, imported only by `app/api/support-token/route.ts`). If it reaches the browser, anyone can impersonate any user in our support system — keep it out of client components and never give it a public prefix.
- **Re-decide the entitlement gate in every project built from this template** — `/start` asks the question and rewrites the comment with the answer. A support token grants read access to the _whole_ support inbox for the app, not just the holder's own tickets. `isEntitledToSupport()` in `app/api/support-token/route.ts` returns `true` for any authenticated user by default, which is correct only while every login is company staff. As soon as a project has non-staff users (clients, contractors, partners), narrow it to a server-controlled `app_metadata` flag — not `user_metadata`, and not the email domain. Hiding the sidebar button is not a boundary.
- **Adding a new user role? ASK the user whether that role may submit support tickets — every time, before writing the code.** Roles enter the app through the `z.enum(["user", "admin"])` schemas in `app/admin/users/actions.ts`, and a new one inherits whatever `isEntitledToSupport()` returns today — by default `true`, so it silently gains read access to every ticket ever filed for the app. Nothing errors and no test fails, which is exactly why it needs a question rather than an inference. Never guess from the role's name. Encode the answer in `isEntitledToSupport()` and record it in that function's comment.
- Before a new project tests the widget, send us its **development origin** (`http://localhost:3000` etc.) for the allowed-origins list, or the panel opens blank.
- The signer uses Node's built-in HMAC rather than a JWT library and is pinned to the canonical jwt.io vector in `lib/support-token.test.ts` — re-run that test if you touch the encoding.

## AI Integration (MCP)

The app can be connected to an AI client (Claude Code and friends) over MCP. The page is `/ai-integration`, in the account menu under the profile picture. Full guide: `/documentation/mcp.md`.

- **It needs `sql/0001_mcp-oauth.sql` run in Supabase before anything works.** Until then `/ai-integration` shows a setup banner and sign-in fails — that is the designed state on a fresh copy of this template, not a bug. Run the security advisor afterwards.
- **Read-only, admins only.** The tools in `lib/mcp/tools.ts` read accounts, the audit log, login attempts and settings. Nothing writes. `isEntitledToMcp()` in `lib/mcp/entitlement.ts` is the single gate, re-checked on **every** request — losing the admin role or being deactivated cuts an AI client off on its next call.
- **Adding a new user role? ASK the user whether that role may connect an AI client** — same rule as the support gate, and for the same reason. Encode the answer in `isEntitledToMcp()` and record it in that function's comment. Never infer it from the role's name.
- **Adding a tool that writes? Ask first, and add a second scope.** This server issues one coarse scope (`mcp:read`), so a mutating tool added to the registry becomes available to every token already in the wild on the next deploy. Audit-log every write with the acting user's id.
- **Tokens are opaque and stored SHA-256 hashed**; PKCE S256 is mandatory; refresh tokens rotate and reuse revokes the whole grant; redirect URIs are exact-match against the seeded list. Dynamic Client Registration is deliberately not implemented — add clients by migration. Don't "simplify" any of these away.
- Two bits of wiring are easy to break: the `/.well-known/oauth-*` rewrites in `next.config.ts`, and the `.well-known` exclusion in the `proxy.ts` matcher. Middleware runs before rewrites, so without the exclusion an unauthenticated client's discovery request gets redirected to `/auth/login` and it can never authenticate.
- The `claude mcp add` command, the seeded `redirect_uris` and `MCP_CALLBACK_PORT`/`MCP_CLIENT_ID` in `lib/mcp/config.ts` must agree, or sign-in fails with `redirect_uri_mismatch`.

## Formatting (Prettier)

Always run `npm run format` (Prettier `--write`) before finishing a task. The pre-push hook (`npm run check:fast`) and CI both run `prettier --check .` across the **entire repo**, so any unformatted file blocks the push and fails CI — even a file you didn't touch. If `prettier --check` (or `npm run format:check`) flags files, fix them with `npm run format` regardless of whether they're part of your change; do not leave them for someone else. Run `npm run check:fast` (typecheck + lint + format) locally to mirror what the pre-push hook enforces.

## Development Notes

The application currently contains a default Next.js landing page. The main entry point for modifications is `app/page.tsx`. The project supports hot module replacement through Turbopack during development.

## Project Skills

Skills that ship with this template (`.claude/skills/`). Invoke them at their
moment — they are the sanctioned path for what they cover:

| Skill                          | Invoke when                                                                                                                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/start`                       | Once, on a freshly-copied template — company name, brand, indexing, formats, support gate                                                                                                |
| `/comments`                    | The app needs collaboration/discussion on records — designs the comment system (threads, @mentions, central inbox) via scoping questions. Never build ad-hoc comment features outside it |
| `reviewing-ui-before-shipping` | Before calling any screen finished or handing UI to a client — the usability checklist a green build cannot replace                                                                      |

## Important Rules

- **Reuse before building.** Before creating any component, hook, utility or script, check the resource inventory in `documentation/resources.md` — if something close exists, reuse or extend it, never create a parallel version; register every new shared resource there in the same change. The full policy (canonical single-source resources, `components/ui/` as vendor code, page-local → shared promotion) is `.claude/rules/resources.md`. Before calling a screen finished, run the `reviewing-ui-before-shipping` skill.
- Make sure the dates we store in the DB are the ones shown, don't convert to local timezone.
- **Format dates, numbers and money with `formatDate()` / `formatNumber()` / `formatCurrency()` from `@/lib/utils`** — never `toLocaleDateString()` / `toLocaleString()` at the call site, and never hand-concatenate a currency symbol. Both read the project's `DATE_FORMAT` / `NUMBER_FORMAT` constants, set once in `lib/utils.ts` and chosen during `/start`. A bare `toLocale*()` with no locale renders in the **viewer's** locale, so the same record reads `03/04/2026` for one colleague and `04/03/2026` for another with nothing on screen to say which; a hardcoded `"en-US"` quietly ignores the project's choice. `formatDate` reads in UTC so the value shown is the value stored. `CURRENCY` is `null` by default, meaning the app shows no money — that is a finished answer, not a placeholder, so don't set a currency speculatively; symbol placement (`€ 1.234,56` in NL vs `1.234,56 €` in DE) follows the country, not the currency, which is why it's explicit config rather than inferred. The vendored shadcn/ui files (`components/ui/calendar.tsx`, `chart.tsx`) are the exception — leave their internal `toLocaleString` calls alone, since `npx shadcn add` overwrites them.
- Make sure that any hover effects/pop ups are not overlapped by other parts of the UI and are not going out of the screen.
- When creating number input fields (e.g. quantity, price, amount), disable scroll-to-change-value by default using `onWheel={(e) => e.currentTarget.blur()}`.
- When creating a file upload field, always support drag & drop in addition to the click-to-browse flow.
- Upload files **directly from the client to Supabase Storage** (`supabase.storage.from(bucket).upload(...)`), never by POSTing the file through a Next.js route handler / Server Action. Routing bytes through the server hits the request-body size cap (Vercel ~4.5MB, plus our `serverActions.bodySizeLimit`), which silently breaks larger uploads. Direct-to-Storage avoids that ceiling entirely. The limit is then the bucket's configured `file_size_limit`, which (per `.claude/rules/security.md` → File Uploads) must be set server-side along with the MIME allowlist — client-side checks are not a security boundary.
- Enforce the size cap before/around the upload and surface a clear, specific error when exceeded — e.g. "File too large. Maximum size is 5 MB." (state the actual MB limit, default 5MB). Use the solid-red error style (`bg-red-600` / `text-white`) per `.claude/rules/ui.md`, never a silent failure or a native browser alert.
- **Choose the storage bucket's privacy deliberately — default to PRIVATE, and never store documents or any user-specific/sensitive file in a public bucket.** A `public = true` bucket serves object bytes through the CDN with **no auth check**, so RLS `SELECT` policies are bypassed for reads and anyone with (or who guesses) the URL gets the file — no comment may claim RLS protects a public bucket's contents. Decide per bucket: **PRIVATE (signed URLs)** for documents, contracts, invoices, IDs, anything user-uploaded, anything user- or tenant-scoped, anything you wouldn't paste into a public Slack — read it server-side or via short-lived `createSignedUrl(...)`, and gate access with your own ownership/role check first. **PUBLIC** ONLY for genuinely world-readable, non-sensitive assets where the URL leaking is a non-event (e.g. the app logo, marketing images, public avatars you've decided are intentionally public). When in doubt, make it private — you can always sign a URL, but you can't un-leak a public one. Set the privacy, `file_size_limit`, and MIME allowlist server-side at bucket creation (these are config, not code, so they're easy to forget), and after any change run the Supabase security advisor and confirm `public_bucket_allows_listing` is clear. See `.claude/rules/database.md` → "Storage buckets" and `.claude/rules/security.md` → "File Uploads".
- Do not use legacy Supabase API keys (`anon`, `service_role`). Use the new publishable and secret API keys instead, unless there is really no other way.
- Run `npm i -g vercel@latest` whenever you think it has no major breaking impact.
- When creating new pages or components, always verify they work in BOTH light and dark mode. Use the theme tokens (`bg-background`, `text-foreground`, `bg-card`, `border-border`, `text-muted-foreground`, etc.) rather than hardcoded colors (`bg-white`, `text-black`, `bg-gray-900`) so both themes are covered automatically. If you must hardcode a color, pair it with a `dark:` variant. Theme is class-based (`.dark` on `<html>`) and follows the OS preference by default — see `components/theme-provider.tsx`.
- **Settings is ONE page (`app/settings/page.tsx`), filtered by role — never build a second, parallel settings page.** Add new settings as tabs inside the existing `/settings` page and gate each tab by user type (the page already does this: the tab list is built with `...(isAdmin ? [...] : [])`, and the sidebar link is rendered with `{isAdmin && ...}`). When you need user-facing (non-admin) settings, add user-visible tabs to this same page and show the nav link to those users — do NOT create a separate `/admin/settings`, `/account`, or similar surface. Two disconnected settings UIs (one admin, one general) is the anti-pattern this rule exists to prevent. The same applies to any "settings-like" hub: prefer one role-filtered page over parallel admin/non-admin versions. (Account-level profile fields — name, avatar, password, personal MFA — stay on `/profile`; `/settings` is for app/admin configuration.)

## SQL Files Log

Keep a running, ordered log of every SQL file in `/sql` here so past migrations are easy to review back on. The full rules (location, `NNNN_short-description.sql` naming, idempotent/transactional, don't delete applied migrations) live in `.claude/rules/database.md` → "SQL files & migrations".

**Whenever you add a new `.sql` file to `/sql`, append it to the list below.** Log each file on its own numbered line, in order, where the number matches the file's 4-digit prefix and the latest migration is the highest number:

1. `0001_mcp-oauth.sql` — OAuth 2.1 storage for the MCP / AI Integration feature (registered clients, pending authorization requests, one-time codes, access + refresh tokens). Service-role only; seeds the `claude-code` client.

## Security

The security rules are in `.claude/rules/security.md` (also `database.md` and `middleware.md`). Two things to internalize before touching auth, RLS, middleware, or validation:

- **Patterns we get right are ON PURPOSE — keep them.** Roles from `app_metadata` (never `user_metadata`), per-action `checkIsAdmin()`, `getUser()` for authz, server-side sign-in + login-attempt recording, server-side MFA enforcement that fails closed, three-layer file-upload validation, Zod `z.enum` (no `.passthrough()`), append-only audit logs, DB-backed lockout, locked-down `SECURITY DEFINER` functions, origin-validated redirects, single-source CSP. Don't "simplify" these away. See `.claude/rules/security.md` → "Patterns we get right".
- **Anti-patterns must not be reintroduced** — e.g. PUBLIC-executable `SECURITY DEFINER` RPCs, client-trusted login outcomes, `startsWith("//")`-only redirect checks (backslash bypass), outbound network calls in middleware, claiming RLS protects reads on a public storage bucket. See `.claude/rules/security.md` → "Anti-patterns".
- **RLS is the authorization boundary, not server-side role checks.** No `USING(true)`/`FOR ALL` policies on entity or financial tables; every policy carries an ownership/role predicate; a role check is never an ownership check (verify the caller owns the specific resource); run the Supabase security advisor after any schema change. See `.claude/rules/database.md` → "RLS policies".

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
