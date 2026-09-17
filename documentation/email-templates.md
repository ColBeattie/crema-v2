# Supabase email templates

`setup/email-templates/` holds the thirteen auth emails as standalone HTML files.
**Nothing in the codebase reads them** — `grep -rn "email-templates" app lib`
returns nothing. They are artifacts to paste into
**Supabase → Authentication → Emails**, one per template. Editing a file here
changes nothing until someone pastes it, so a test mail will keep showing the old
content until you do.

Paste them per environment. A staging project and a production project each have
their own copy.

## Which file goes where

The first six are the standard auth emails and are on by default. Set the subject
line in the field above the HTML box — the file only supplies the body.

| File                              | Dashboard template   | Suggested subject              |
| --------------------------------- | -------------------- | ------------------------------ |
| `1-confirm-signup.html`           | Confirm signup       | Confirm your email address     |
| `2-invite-user.html`              | Invite user          | You have been invited          |
| `3-magic-link.html`               | Magic Link           | Your login link                |
| `4-change-email.html`             | Change Email Address | Confirm your new email address |
| `5-reset-password.html`           | Reset Password       | Reset your password            |
| `6-confirm-reauthentication.html` | Reauthentication     | Your verification code         |

The remaining seven are **security notification** emails. These are **disabled
by default** — pasting the HTML does nothing on its own. Enable each one in
**Authentication → Emails → notification templates** (locally:
`[auth.email.notification.<key>] enabled = true` in `supabase/config.toml`).

| File                             | Dashboard template          | `config.toml` key       |
| -------------------------------- | --------------------------- | ----------------------- |
| `7-password-changed.html`        | Password changed            | `password_changed`      |
| `8-email-changed.html`           | Email address changed       | `email_changed`         |
| `9-phone-changed.html`           | Phone number changed        | `phone_changed`         |
| `10-sign-in-method-linked.html`  | Sign-in method linked       | `identity_linked`       |
| `11-sign-in-method-changed.html` | Sign-in method removed      | `identity_unlinked`     |
| `12-MFA-added.html`              | Verification method added   | `mfa_factor_enrolled`   |
| `13-MFA-removed.html`            | Verification method removed | `mfa_factor_unenrolled` |

Templates 9, 10 and 11 cover notification slots that may not have appeared in
every project's dashboard yet. They are styled and ready regardless — paste
them in when the slots show up, rather than leaving those notifications on
Supabase's unstyled defaults.

## How the links are built (don't "make these consistent")

All five link templates (1, 2, 3, 4, 5) build their own link to `/auth/confirm`
from `{{ .TokenHash }}`, which `app/auth/confirm/route.ts` verifies with
`verifyOtp`. Consequences worth knowing before editing:

- **The `redirectTo` / `emailRedirectTo` passed in code is ignored** for all of
  them. Supabase never redirects through its own verify endpoint, so the link
  goes exactly where the template says. `app/auth/login/page.tsx` and
  `app/admin/users/actions.ts` carry comments saying so.
- **`next=` must be a path, not `{{ .RedirectTo }}`.** That variable renders an
  absolute URL, and `sanitizeNextPath()` (`lib/safe-redirect.ts`) rejects
  absolutes and falls back to `/`.
- **Recovery and invite accept only two `next` values** —
  `/auth/reset-password` and `/auth/set-password` (`RECOVERY_ALLOWED_NEXT` in
  `app/auth/confirm/route.ts`). Anything else is silently rewritten.
- **Template 3 (Magic Link) is on `token_hash` too, and must stay there.** It
  used to keep `{{ .ConfirmationURL }}` so the round-trip through
  `/auth/callback` would preserve the login page's `redirectTo` deep link. That
  round-trip hands `/auth/callback` a **PKCE `code`, redeemable only in the
  browser that requested the link** — that browser holds the `code_verifier`
  cookie. Mobile mail apps open links in their own in-app WebView with a
  separate cookie jar, so magic-link login failed on phones every time (and
  whenever a link was requested on desktop and opened on mobile). `verifyOtp`
  on a `token_hash` stores nothing client-side and works from any browser or
  device.
  The cost is that magic-link users always land on `/` — `{{ .RedirectTo }}`
  can't win the deep link back, since it renders an absolute URL that
  `sanitizeNextPath()` rejects. Working-everywhere beat deep-linking.
  `/auth/callback` still handles OAuth and standard PKCE login, and now reports
  a missing verifier as `reason=wrong_browser` instead of the generic error.

Recovery going through `/auth/confirm` rather than `/auth/callback` is
deliberate and load-bearing — see the comment at the top of
`app/auth/callback/route.ts`.

## Editing the HTML

All thirteen share one skeleton, so keep them uniform:

- **Dark mode is declared and implemented.** Each file sets
  `<meta name="color-scheme" content="light dark">`, which opts the mail _in_ to
  the client's dark rendering. Every inline colour therefore has a counterpart
  in the `@media (prefers-color-scheme: dark)` block and its `[data-ogsc]`
  duplicate (Outlook.com rewrites inline styles instead of honouring the media
  query). If you add an element with an inline `background` or `color`, give it
  one of the `em-*` classes — a partial dark palette is worse than none, because
  the client darkens the card and leaves the text dark on top of it.
- **Button padding lives on the `<td>`, not the `<a>`.** Outlook renders through
  Word, which drops padding on an inline-block anchor and collapses the button
  into bare text on the fill colour.
- **Use `&amp;` in link URLs.** A bare `&` is an unterminated entity reference;
  mail-client link rewriters are much less forgiving of it than a browser.
- **No SVG images.** Gmail, Outlook and Yahoo strip `<img>` pointing at SVG. Any
  logo must be a PNG/JPG at an absolute, unauthenticated HTTPS URL — see step 5
  of `.claude/skills/start/SKILL.md`.

## Template variables

Verified against the Supabase docs; each is only available in the templates
listed.

| Variable                                                                                       | Available in                                      |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `{{ .SiteURL }}`, `{{ .ConfirmationURL }}`, `{{ .Token }}`, `{{ .TokenHash }}`, `{{ .Email }}` | all auth templates                                |
| `{{ .NewEmail }}`                                                                              | Change Email Address only                         |
| `{{ .OldEmail }}`                                                                              | Email address changed notification only           |
| `{{ .OldPhone }}`, `{{ .Phone }}`                                                              | Phone number changed notification only            |
| `{{ .FactorType }}`                                                                            | Verification method added / removed notifications |
| `{{ .Provider }}`                                                                              | Sign-in method linked / removed notifications     |

A variable used in the wrong template renders as literal text in the email
rather than erroring.

Note on Change Email Address: with **Secure Email Change** enabled (the default)
Supabase sends that one template to **both** the old and the new address, each
with its own token. The copy names both addresses so it reads correctly either
way.
