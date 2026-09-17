# Productivity Tools Support widget

The in-app support widget lets users report bugs, request features and ask
questions from any page, and track the replies — without leaving the app. All
ticket UI is rendered remotely inside an iframe served from
`https://nexus.productivitytools.io`; this app only loads it and proves who the
user is.

**Do not build ticket UI here** — no forms, no lists, no status handling, no
local ticket storage. That is what lets the support platform ship improvements
without every project redeploying. Likewise, do not modify or fork the SDK; if
something is missing, ask for it to be changed centrally.

---

## Per-project checklist

This is the template, so the integration ships wired up but **not provisioned**.
For each new project built from it:

1. **Request an installation** per environment (production and staging get
   separate installations and separate secrets — never share one).
2. **Send the allowed origins before testing**, including the development
   origin (`http://localhost:3000` and whatever port the project actually
   uses). If the origin isn't registered, the panel opens blank with a
   `frame-ancestors` error and nothing you change locally will fix it. This is
   the single most common setup failure.
3. **Paste the env block** (below) into `.env.local` / the hosting provider.
4. **Decide the entitlement gate** in `app/api/support-token/route.ts` — see
   [Entitlement](#entitlement-read-this-one) below. This is the step that
   actually needs thought. `/start` asks the question on a fresh template and
   rewrites the comment with the answer; if that comment still says the decision
   is pending, it hasn't been made.
5. **Restart the dev server or redeploy.** Environment variables are read at
   boot; without a restart you are testing the old values.

## Configuration

```
# SERVER ONLY — must never reach the browser
SUPPORT_SIGNING_SECRET=<from Nexus → Admin → Support installations>
SUPPORT_ISSUER_ID=<installation id>
SUPPORT_KEY_ID=<key id>

# Safe in the browser
NEXT_PUBLIC_SUPPORT_INSTALLATION_KEY=<installation key>
```

`NEXT_PUBLIC_SUPPORT_URL` is deliberately **not** an environment variable — the
support origin is the same for every project, so it is hardcoded as
`SUPPORT_URL` in `lib/support.ts`.

⚠️ **Rotation changes TWO values**, `SUPPORT_SIGNING_SECRET` _and_
`SUPPORT_KEY_ID`. The key id selects which stored secret to verify against, so
updating only the secret fails with `unauthorized:no_matching_key`. The previous
secret keeps working for 24h, so rotation causes no outage.

### Until the installation key is set

`lib/support.ts` exports `isSupportConfigured`. When the installation key is
absent (a fresh clone), the SDK script is **not** rendered — so there is no 404
to the support origin.

The **Help & support** entry is still shown in both the desktop account menu and
the mobile drawer. Clicking it surfaces the styled error "Support isn't set up
for this deployment: `NEXT_PUBLIC_SUPPORT_INSTALLATION_KEY` is not set." That is
on purpose: a visible entry that names the missing variable is easier to act on
than a menu item that silently isn't there, and it keeps the provisioning step
from being forgotten. Remember `NEXT_PUBLIC_*` values are inlined at build time
— restart the dev server after adding the key.

None of this is a security boundary. `/api/support-token` enforces auth and
entitlement independently and identically whether or not the button is visible.

## Entitlement — read this one

A support token is read access to the **whole support inbox for this
application**, not just the holder's own tickets. Colleagues seeing each other's
reports is intended (it prevents duplicate reports), but it means anyone who can
call `/api/support-token` can read every bug report raised for the app, along
with whatever operational detail those reports contain.

In the **bare template every login is company staff**, so
`isEntitledToSupport()` in `app/api/support-token/route.ts` returns `true` for
any authenticated user.

**That is only correct while it stays true.** The moment a project gains users
who are not the customer's own staff — clients, contractors, partners, end
customers — narrow that function:

```ts
function isEntitledToSupport(user: User): boolean {
  return (
    user.app_metadata?.role === "admin" || user.app_metadata?.is_staff === true
  );
}
```

Rules:

- Gate on a **server-controlled** flag in `app_metadata`, never
  `user_metadata` (the row owner can edit that one).
- Don't gate on email domain — contractors have company addresses and staff
  have personal ones.
- **Hiding the sidebar button is not a boundary.** Any logged-in user can call
  the endpoint directly, so the check has to live in the route.

### Every time a new role is added, ask

Roles enter this app through the `z.enum(["user", "admin"])` schemas in
`app/admin/users/actions.ts`. **When you add one, stop and ask whether that role
may submit support tickets** — before writing the code that creates it, and
without inferring the answer from the role's name.

A new role inherits whatever `isEntitledToSupport()` returns at that moment.
Under the default `return true` that means adding `"contractor"` or `"client"`
hands the new role read access to every ticket ever filed for this application.
The grant is silent: nothing throws, no test fails, and the sidebar looks
identical. There is no signal that would prompt someone to notice later, which
is precisely why it has to be a question at the time.

Once answered, encode it in `isEntitledToSupport()` and write the decision into
that function's comment, so the next role added has a stated precedent to
extend rather than a default to inherit.

## How it fits together

| File                               | Role                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `lib/support-token.ts`             | **Server only.** HS256 signing, claim building, env reading.                    |
| `lib/support-token.test.ts`        | Pins the signer to the canonical jwt.io vector.                                 |
| `app/api/support-token/route.ts`   | Authenticated endpoint that mints the token. Entitlement gate lives here.       |
| `lib/support.ts`                   | Client-safe config — hardcoded support URL, installation key, release metadata. |
| `app/components/SupportWidget.tsx` | Renders the SDK `<script>`, from the authenticated layout only.                 |
| `app/components/AuthLayout.tsx`    | Mounts `<SupportWidget />` in the authenticated branch.                         |
| `app/components/Sidebar.tsx`       | The "Help & support" entry point, above Settings, for **all** users.            |
| `lib/security-headers.ts`          | CSP `script-src` + `frame-src` for the support origin.                          |
| `next.config.ts`                   | Maps CI build variables to the public ones the SDK reads.                       |
| `types/pt-support.d.ts`            | `window.PTSupport` typings.                                                     |

### Signing without a JWT library

`lib/support-token.ts` signs with Node's built-in HMAC rather than `jose`,
because this repo requires asking before adding a dependency
(`.claude/rules/workflow.md`) and this code only ever _signs_, never verifies —
about fifteen lines. `lib/support-token.test.ts` proves the implementation
against the canonical jwt.io reference vector. **Do not change the encoding
without re-running that test.**

If you later install `jose`, the signer can be swapped for `SignJWT`; keep the
vector test either way.

### Token shape

Header `{ alg: "HS256", kid: SUPPORT_KEY_ID }`; claims `iss`, `aud`
(`"nexus-support"`), `sub` (the Supabase user UUID — stable across email
changes), `email`, `name`, `role`, `iat`, `exp` (+10 min), `jti` (fresh UUID per
call).

`role` is `customer_admin` when `app_metadata.role === "admin"`, otherwise
`customer_user`. `customer_admin` sees tickets company-wide across every
application and environment; `customer_user` sees tickets for this application.

A fresh token is minted on **every** request — never cached, stored or reused.

## Entry point

"Help & support" sits directly above the Settings icon in the sidebar (desktop
rail and mobile drawer) and is shown to **every** user, unlike Settings and
Security which are admin-only.

The floating launcher is suppressed with `data-hide-launcher="true"` so there is
one entry point, in the navigation, rather than a button floating over page
content.

`Sidebar.openSupport()` checks `window.PTSupport` explicitly and surfaces a
styled error if it's missing. **Never write `window.PTSupport?.open()`** — the
optional chain swallows the most common failure (SDK not loaded, or bailed out
on a missing installation key) and turns a diagnosable problem into a button
that silently does nothing.

## Action-count badge

A red count on the support entry point: how many requests are waiting on **this
user** — work we finished and handed back for them to check, plus questions we
asked and are waiting on an answer to. Requests we are still working on are not
counted, so every number is something only that person can move. It clears
itself when they reply or accept, in the widget or by email; there is nothing
to mark as read.

`app/components/SupportBadge.tsx` owns both halves:

- `useSupportActionCount()` — subscribes to the SDK's `badge` event and returns
  `number | null`. Called **once**, in `Sidebar`, which owns every support entry
  point. A second call site is a second subscription, not a second count.
- `<SupportBadge count={…} />` — the circle. Renders nothing for `null`
  (not known yet) _and_ for `0`.

Four things here are load-bearing:

1. **`null` ≠ `0`.** `null` is "the first count hasn't arrived, or the check
   failed". Both render nothing, but conflating them is how you end up shipping
   a red circle containing "0".
2. **Render from the event every time it fires, including zero.** That event is
   what clears the badge. Never react only to non-zero values.
3. **Never poll, never fetch it yourself.** The SDK checks at most once an hour
   per tab, pauses in a background tab, and re-checks when the widget closes.
   There is no endpoint here you may call — the SDK's own one consumes a
   single-use token. `getActionCount()` is for reading the current value on
   demand, not for a timer.
4. **The badge must never break the button.** Every access is optional-chained
   and every failure degrades to "no badge"; `openSupport()` is deliberately
   the opposite (see above), because there the silence _is_ the bug.

### Why it is mirrored onto the avatar and the hamburger

Both support entry points live inside menus that are shut by default — the
desktop account menu and the mobile drawer. A badge only on the menu item would
be visible exclusively to someone who already went looking, which is precisely
the loop the count exists to close. So the count is also drawn on each menu's
always-visible trigger.

Those copies are `decorative` (`aria-hidden`): the spoken count belongs on the
"Help & support" control itself, not on a Profile link. The mobile hamburger is
the exception — it carries the count in its own `aria-label`, since a screen
reader user otherwise gets no cue to open the drawer at all.

### Why `SupportWidget` dispatches a ready event

The SDK loads `afterInteractive`, i.e. _after_ hydration. `Sidebar` mounts
first, so a plain `if (!window.PTSupport) return;` in a mount effect would find
nothing and never subscribe. `SupportWidget`'s `onReady` dispatches
`ptsupport:ready` (exported as `SUPPORT_SDK_READY_EVENT`); the hook tries once
immediately, then waits for that event. Both orderings are covered.

### When the user changes

`AuthLayout` calls `window.PTSupport?.refreshActionCount?.()` on the
`SIGNED_IN` and `SIGNED_OUT` auth events. The count is cached per browser tab
for an hour, so without this a second person signing in on a shared machine
briefly sees the first person's number. Deliberately **not** on
`TOKEN_REFRESHED`, which fires on a timer and would turn this into polling.

## Passing business context (optional, high value)

When the user is looking at a specific record, pass it — it arrives attached to
the ticket:

```ts
window.PTSupport.open({
  type: "bug",
  context: {
    entityType: "invoice",
    entityId: invoice.id,
    entityName: invoice.reference,
  },
});
```

**Identifiers and names only.** Never personal data, financial figures,
credentials or tokens.

## Content Security Policy

Both directives are set in `lib/security-headers.ts`, which is the single CSP
source for this app:

```
script-src  … https://nexus.productivitytools.io   (the SDK)
connect-src … https://nexus.productivitytools.io   (the action-count badge)
frame-src     https://nexus.productivitytools.io   (the ticket UI)
```

`script-src` and `connect-src` each had to be added in **three** places —
`DEFAULT_CSP_DIRECTIVES`, `DEVELOPMENT_CSP_OVERRIDES` and
`PRODUCTION_CSP_OVERRIDES` — because the override objects replace the array
rather than merging with it. `frame-src` appears only in the default (the
overrides don't touch it).

`connect-src` is the one whose absence fails **silently**: the widget keeps
working and the badge simply never appears, so it presents as "we built the
badge and nothing happened" rather than as a broken feature. The other two fail
loudly.

Verify by observation, not by reading the source:

```bash
curl -sD - http://localhost:3000/ -o /dev/null | grep -i content-security-policy
```

⚠️ **After changing the CSP, hard-reload (⌘⇧R).** CSP arrives as a response
header on the HTML document; HMR swaps JavaScript without re-requesting that
document, so the browser keeps enforcing the _old_ policy and a correct change
looks like it did nothing. This is the most common reason a correct CSP edit
gets reverted and re-debugged.

## Release identification

Every ticket records which build was running. `next.config.ts` maps the
server-side CI variables to public ones at build time:

| Public variable           | Source                                      |
| ------------------------- | ------------------------------------------- |
| `NEXT_PUBLIC_APP_VERSION` | `npm_package_version` (from `package.json`) |
| `NEXT_PUBLIC_GIT_COMMIT`  | `VERCEL_GIT_COMMIT_SHA` or `GITHUB_SHA`     |
| `NEXT_PUBLIC_RELEASE_ID`  | `VERCEL_DEPLOYMENT_ID` or `GITHUB_RUN_ID`   |

Locally these are empty, which is correct and honest — an empty attribute is
fine, a made-up `1.0.0` is not.

## Verifying an installation

Once the real secret is in place, log in and post your own token to the
platform's verify endpoint:

```bash
curl -s -X POST https://nexus.productivitytools.io/api/widget/v1/verify \
  -H 'Content-Type: application/json' \
  -d "{\"token\":\"$(curl -s --cookie "<session cookie>" \
      http://localhost:3000/api/support-token | jq -r .token)\"}"
```

`ok: true` means the handshake works. **Read the `warnings` array even then** —
it flags things that work but are probably unintended (missing `email`, missing
`name`, no allowed origins configured). The endpoint does not consume the
token's `jti`, so it can be called repeatedly.

### Structural probe without the real secret

If the secret hasn't been pasted yet, sign with a throwaway one and post that.
Expect:

```jsonc
{ "data": { "ok": false, "reason": "bad_signature" }, "error": null }
```

`bad_signature` — and nothing before it — is a **pass** at that stage: reaching
the signature check proves `iss` resolved to a real installation, `kid` matched
a live key, and `alg` is HS256, which are the three settings most often wrong.
It does **not** validate `aud`, `exp`, `iat` or `sub`; those are checked only
after the signature passes. Re-run the full check once the real secret is in.

Other reasons at that stage are real problems: `malformed_token` (not sending
the JWT string), `missing_iss` / `unknown_installation` (wrong
`SUPPORT_ISSUER_ID`), `no_matching_key` (wrong or stale `SUPPORT_KEY_ID` —
remember rotation changes both values), `unsupported_algorithm` (not HS256).

## Troubleshooting — whose problem is it

| Symptom                                                                                  | Cause                                                                    | Fixed by                                              |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------- |
| Script tag present with correct `src` and key, but `window.PTSupport` is `undefined`     | Browser still enforcing the pre-change CSP header; HMR didn't refresh it | **You** — hard-reload (⌘⇧R) _before_ editing anything |
| `Refused to frame … violates … frame-ancestors`                                          | This origin isn't registered on the platform side                        | **Support platform** — send them the exact origin     |
| `Refused to load the script … support-sdk.js`                                            | This app's CSP is missing the directives                                 | **You** — `lib/security-headers.ts`                   |
| Widget works, but the action-count badge never appears (CSP violations in the console)   | `connect-src` is missing the support origin                              | **You** — `lib/security-headers.ts`, all three arrays |
| Badge never appears and there is **no** `/api/widget/v1/badge` request at all            | The SDK got no token — user not entitled, or signed out                  | **You** — `isEntitledToSupport()`                     |
| `/api/widget/v1/badge` returns `{"data":{"enabled":false}}`                              | The badge is switched off for this installation                          | **Support platform** — ask them to enable it          |
| Panel opens but **spins forever**, with errors originating from the `embed?k=…` document | A fault inside the widget, not this app                                  | **Support platform** — send the exact messages        |

The first row costs the most time because it presents exactly as "my CSP fix
didn't work". Hard-reload before touching config. The last row is the other one
to watch: everything on this side is correct, so don't go hunting through your
own CSP — report it.

## Screenshots

Screenshot capture is **disabled by default** for every installation and is
enabled by the support platform only after the customer approves it and the
contract covers the processing. There is nothing to configure here and it cannot
be turned on from this side; it will start working with no code change if
enabled.

When requesting an installation, flag any screen that displays personal,
medical or financial data so they can decide whether screenshots should ever be
enabled for it.

## Rules that must not be broken

1. `SUPPORT_SIGNING_SECRET` never leaves the server — not in a client
   component, a public env var, a bundle, or git.
2. The user id always comes from the server-side session, never a request
   parameter.
3. Mint a fresh token per request. No caching.
4. No ticket UI in this app.
5. Don't modify or fork the SDK.
6. The script tag stays in the shared authenticated layout, not on individual
   pages.
7. The action count comes from the SDK's `badge` event and nowhere else — never
   from our own tables, an email count, or a guess, and never by polling or
   calling the badge endpoint directly.
