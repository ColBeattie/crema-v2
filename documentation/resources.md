# Resource Inventory

The living inventory of every reusable resource in this project. Check it
before building anything new; register every new shared resource here in the
same change (see `.claude/rules/resources.md`).

## UI primitives — `components/ui/` (vendor, do not edit)

shadcn/ui files. Extend by composition; add new ones with `npx shadcn add`.

| Resource                  | Use for                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `button.tsx`              | Every button and button-shaped link                                                                                      |
| `calendar.tsx`            | Date picking (leave its internal locale calls alone — see `/start`)                                                      |
| `card.tsx`                | Grouped content on a surface                                                                                             |
| `chart.tsx`               | All charts (Recharts wrapper wired to theme tokens)                                                                      |
| `checkbox.tsx`            | Boolean inputs                                                                                                           |
| `command.tsx`             | Searchable command/picker lists — the base for filterable dropdowns                                                      |
| `dialog.tsx`              | Modals and confirmations (never browser-native popups, per `ui.md`)                                                      |
| `empty.tsx`               | Empty states (every data view needs one, per `ui.md`)                                                                    |
| `input.tsx` / `label.tsx` | Form fields and their labels                                                                                             |
| `loading.tsx`             | Loading states and skeleton composition for data views                                                                   |
| `popover.tsx`             | Anchored floating panels                                                                                                 |
| `progress.tsx`            | Determinate progress                                                                                                     |
| `radio-group.tsx`         | Single choice among few options                                                                                          |
| `select.tsx`              | Dropdown choice (pair with `command.tsx` when the list needs filtering)                                                  |
| `separator.tsx`           | Visual dividers                                                                                                          |
| `skeleton.tsx`            | Skeleton loaders (preferred over spinners, per `ui.md`)                                                                  |
| `table.tsx`               | Data tables                                                                                                              |
| `tooltip.tsx`             | shadcn tooltip primitive — for hover tooltips prefer `app/components/Tooltip.tsx` (the instant tooltip `ui.md` mandates) |

## App components — `app/components/` and `components/`

| Resource                           | Use for                                                                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/components/AuthLayout.tsx`    | The shell of every auth-flow page                                                                                                                                                |
| `app/components/Sidebar.tsx`       | The app's navigation — add nav entries here, don't build parallel navs. Owns the desktop rail's expand/collapse state; `AuthLayout` mirrors its width via `SIDEBAR_TOGGLE_EVENT` |
| `app/components/SupportBadge.tsx`  | The "requests waiting on you" count on the support entry point — and `useSupportActionCount()`, the only sanctioned way to read that number                                      |
| `app/components/SupportWidget.tsx` | The support-ticket widget (entitlement is server-side — see CLAUDE.md)                                                                                                           |
| `app/components/Tooltip.tsx`       | Instant hover tooltips anywhere in the app (the `ui.md` standard)                                                                                                                |
| `app/ai-integration/`              | The AI Integration (MCP) page, its consent screen and their server actions — the only surface for connecting an AI client                                                        |
| `components/auth/MfaChallenge.tsx` | The MFA verification step in auth flows                                                                                                                                          |
| `components/theme-provider.tsx`    | Light/dark theming — already wired in the root layout                                                                                                                            |

## Utilities — `lib/`

| Resource                                                            | Use for                                                                        |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `company.ts`                                                        | Company name + app description — the only place they are defined               |
| `utils.ts`                                                          | `cn()`, `formatDate`, `formatNumber`, `formatCurrency` + project defaults      |
| `input-validation.ts`                                               | All input validation (Zod schemas; `z.enum`, no `.passthrough()`)              |
| `error-handling.ts`                                                 | Turning failures into user-facing messages and Sentry reports                  |
| `api-security.ts`                                                   | Wrapping API routes: auth, role checks, standard error responses               |
| `rate-limiting.ts`                                                  | Rate limits on any endpoint that can be hammered                               |
| `login-security.ts`                                                 | Login attempt recording and lockout                                            |
| `auth-methods.ts`                                                   | Reading a session's authentication methods (AMR / MFA state)                   |
| `webauthn.ts`                                                       | Passkey enrolment and verification                                             |
| `safe-redirect.ts`                                                  | Validating redirect targets (never hand-roll a `startsWith` check)             |
| `security-headers.ts`                                               | The single-source CSP and security headers                                     |
| `sentry-options.ts`                                                 | Shared Sentry configuration                                                    |
| `support.ts` / `support-token.ts`                                   | Support-widget config and entitlement tokens                                   |
| `mcp/config.ts`                                                     | MCP client-safe constants (server slug, client id, callback port, scopes)      |
| `mcp/entitlement.ts`                                                | **Who may connect an AI client** — the single MCP gate (admins only)           |
| `mcp/tools.ts`                                                      | The tools exposed over MCP — add new ones here, never a parallel registry      |
| `mcp/store.ts` / `mcp/tokens.ts` / `mcp/protocol.ts` / `mcp/url.ts` | MCP OAuth storage, secret hashing + PKCE, JSON-RPC handling, origin resolution |
| `email/postmark.ts`                                                 | Sending transactional email                                                    |
| `supabase/client.ts`                                                | Supabase in client components                                                  |
| `supabase/server.ts`                                                | Supabase in server components / route handlers (authz via `getUser()`)         |
| `supabase/admin.ts`                                                 | Service-role operations — server-only, use sparingly                           |
| `supabase/middleware.ts` / `jwt.ts` / `config.ts` / `auth-flow.ts`  | Session plumbing — extend, don't fork                                          |

## Scripts — `scripts/`

| Resource          | Use for                                                        |
| ----------------- | -------------------------------------------------------------- |
| `brand-theme.mjs` | All brand-color math (app tokens and email hex) — see `/start` |
| `ci-check.sh`     | Mirroring the CI gate locally                                  |

## Built on demand

- **Comment system** — comment threads on records with @mentions and a
  central inbox of your mentions and replies. Not prebuilt: run the
  `/comments` skill, which scopes it to this project (who participates, which
  records, who sees what, where the inbox lives) and guides the build. Never
  build ad-hoc comment features outside that skill.
