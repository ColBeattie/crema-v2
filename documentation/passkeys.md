# Passkeys (passwordless sign-in)

Users can register a passkey (Face ID, Touch ID, Windows Hello, or a hardware
security key) and use it instead of their password to sign in. Passkeys are
phishing-resistant and there is no shared secret to leak.

The implementation uses Supabase Auth's **first-factor passkey API**
(`auth.registerPasskey()` / `auth.signInWithPasskey()` / `auth.passkey.*`),
which requires `@supabase/supabase-js` **v2.105+**. It is still marked
experimental by Supabase, so the client has to opt in explicitly.

---

## A passkey is NOT a second factor

This is the single most important thing to understand before changing anything
here.

- A first-factor passkey replaces the **password**, not the MFA step.
- Passkeys live in their own namespace (`supabase.auth.passkey.list()`). They
  **never** appear in `auth.mfa.listFactors()` and do not create an MFA factor.
- Therefore registering a passkey does **not** satisfy the app's MFA
  requirement (`Settings → MFA requirement`). A user for whom MFA is required
  still has to enrol an authenticator app at `/auth/mfa-setup`.
- Do **not** offer "passkey" as an alternative to TOTP on the MFA setup screen.
  Because a passkey creates no factor, the middleware would keep sending the
  user back to `/auth/mfa-setup` in a loop.

What a passkey sign-in _does_ get is an exemption from the AAL2 bounce — see
below.

## Files

| File                         | Role                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `lib/webauthn.ts`            | Capability detection, `registerPasskey()`, `signInWithPasskey()`, error translation. |
| `lib/auth-methods.ts`        | `signedInWithPasskey()` — the pure AMR check middleware relies on.                   |
| `lib/supabase/client.ts`     | `auth.experimental.passkey: true` — without this the passkey methods don't exist.    |
| `app/auth/login/page.tsx`    | "Sign in with a passkey" button (rendered wherever WebAuthn exists).                 |
| `app/profile/page.tsx`       | Passkeys section: list, add, remove, plus the AAL2 step-up dialog.                   |
| `lib/supabase/middleware.ts` | AAL2 enforcement exempts sessions whose `amr` contains `passkey`.                    |

Unit tests: `lib/webauthn.test.ts` (error translation, step-up detection) and
`lib/auth-methods.test.ts` (both AMR shapes). The ceremony itself isn't testable
without a browser, but the logic around it is — and that's where the subtle bugs
are.

## Which check gates which UI

Two different questions, two different functions — mixing them up hides working
features:

- **`isWebAuthnSupported()`** — "can this browser do WebAuthn at all?" This is
  what gates the sign-in button and the profile Passkeys section. A USB security
  key, or signing in cross-device by scanning a QR code with a phone, works on
  machines with no Face ID / Touch ID / Windows Hello.
- **`isPasskeyAvailable()`** — "is a _platform_ authenticator present?" Use it
  only for wording ("Use Face ID or Touch ID", a "recommended" badge). Gating
  sign-in on it hides passkeys from every desktop without built-in biometrics.

Both must be read in an effect, never during render — they touch `window`, and
using them as initial state causes a hydration mismatch.

## Supabase project setup (required — this is config, not code)

Nothing works until passkeys are enabled on the project. **Authentication →
Passkeys** in the dashboard:

1. Turn on **Enable Passkey authentication**.
2. **Relying Party Display Name** — shown in the OS prompt, e.g. the company name.
3. **Relying Party ID** — the bare domain, e.g. `app.example.com`. No scheme,
   port or path.
4. **Relying Party Origins** — comma-separated, e.g.
   `https://app.example.com,http://localhost:3000`. HTTPS required except for
   loopback. Max 5. Each origin's host must equal or be a subdomain of the RP ID.

> **Changing the RP ID invalidates every existing passkey.** They are
> cryptographically bound to it. Pick it before users start enrolling and keep
> it stable.

Local development: `localhost` only works if it is in the origins list **and**
the RP ID covers it. If the RP ID is your production domain, passkey buttons
will fail on localhost with "Passkeys aren't available on this domain" — that
message is expected, not a bug.

## AAL / MFA interaction (the tricky part)

Supabase issues an **AAL1** session for a passkey sign-in, and sets
`nextLevel = "aal2"` for any account that has a verified MFA factor. Taken
literally that means a user with both a passkey and TOTP would sign in with the
passkey and be bounced straight to the MFA prompt — every time.

`checkAal2Enforcement()` in `lib/supabase/middleware.ts` therefore skips the
AAL2 redirect when `currentAuthenticationMethods` contains `passkey`. The
rationale: the passkey ceremony already proves possession of the device _and_
performs user verification (biometric or PIN), and it is phishing-resistant.
Password sign-ins are untouched and still have to complete TOTP.

`currentAuthenticationMethods` is typed `AMREntry[] | string[]`; GoTrue may
return either shape, so the check handles both. If you "simplify" it to one
shape, passkey users start getting bounced.

### Managing passkeys from the profile page

GoTrue refuses passkey add/remove on an AAL1 session **once the account has a
verified MFA factor**. Two consequences:

- **No MFA enrolled → no step-up.** `getStepUpFactorId()` returns `null`
  (because `nextLevel` is `aal1`) and the registration runs immediately. This
  path must stay open: without it, nobody could add their first passkey unless
  they enabled 2FA first.
- **MFA enrolled + AAL1 session** (i.e. signed in with a passkey or magic link)
  → the profile page opens a dialog asking for the authenticator code, steps the
  session up to AAL2, then runs the pending action. The same applies to
  _listing_: when `passkey.list()` errors we show "Verify this session" rather
  than an empty list that reads as "you have no passkeys".

There is also a fallback: if a registration attempt comes back with
`insufficient_aal` despite the pre-check, the step-up dialog opens — but only
when a verified TOTP factor exists to step up with.

## Admin recovery (lost device)

A user whose only passkey was on a lost laptop can still sign in with their
password, and remove the stale passkey themselves from `/profile`. When they
can't — or when the device is stolen and you want the credential dead now —
an admin does it from **Settings → User management**:

- The **Passkey** column shows a fingerprint icon per user, coloured when they
  have at least one passkey, with the count when there is more than one. The
  data comes from `passkey_count` on `getUsers()`.
- The fingerprint button in the row's actions runs `resetUserPasskeys(userId)`
  (`app/admin/users/actions.ts`), after a confirmation dialog.

`resetUserPasskeys` follows the same shape as `resetUserMfa`: `checkIsAdmin()`
first, rate-limited per acting admin, the recipient email resolved from the
server-side user record (never from a client argument), an append-only
`reset_passkeys` audit row with the number removed, and a notification email to
the user. It removes **all** of that user's passkeys — there is no per-device
admin revocation, because the case this serves is "the device is gone".

Two things to know:

- **`resetUserMfa` does not touch passkeys, and this does not touch MFA.** They
  are separate credential types; resetting one leaves the other in place. If an
  admin is recovering a user who lost a device holding both, they need both
  actions.
- **The user list makes one passkey call per user.** It runs alongside the
  existing per-user `getUserById`, so it doesn't add a second round of latency,
  but both are N+1 against the admin API. If a project's user list grows past a
  few hundred, that pair is the thing to batch.

If passkeys are switched off in the Supabase dashboard, the lookup errors for
every user and the column reports zero rather than breaking the list.

## Login attempts and lockout

Password sign-in goes through `app/api/auth/login/route.ts`, which records the
attempt and enforces the DB-backed lockout server-side. A passkey sign-in
happens entirely between the browser and GoTrue, so it is **not** recorded there
and is not subject to that lockout. This is acceptable — there is no password to
brute-force, and WebAuthn assertions can't be guessed — but bear it in mind if a
project needs a complete sign-in audit trail; the hook would be a server call
after `signInWithPasskey()` that derives the outcome from `getUser()`, never
from a client-reported result.

## Limitations (from Supabase)

- SSO users cannot register passkeys.
- Anonymous users cannot register passkeys.
- The account's email or phone must be confirmed.

## Error codes

`lib/webauthn.ts` translates these into user-facing copy; the raw codes are
`passkey_disabled`, `insufficient_aal`, `too_many_passkeys`,
`webauthn_credential_exists`, `webauthn_credential_not_found`,
`webauthn_challenge_expired`, `webauthn_challenge_not_found`,
`webauthn_verification_failed`, plus the browser's `NotAllowedError`,
`InvalidStateError`, `NotSupportedError` and `ConstraintError`.

Note that a dismissed prompt and "no passkey saved for this site" are both
reported by the browser as `NotAllowedError` — which is why we show a message
for both instead of failing silently. Only a ceremony aborted in code
(`aborted === true` on `PasskeyOperationError`) is swallowed.
