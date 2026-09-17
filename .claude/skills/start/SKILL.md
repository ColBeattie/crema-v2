---
name: start
description: First-run setup for this template — asks for the company name, the company website, whether the app should be indexed by Google, which user roles may raise support tickets, and the date/number/currency formats, then applies all of it (company name, brand colours extracted from the site, the noindex configuration, the branded Supabase email templates with an uploaded logo, the display formats, and the support entitlement gate).
---

# /start — template setup

Run this once on a freshly-copied template. It collects seven answers plus a logo
file, and then edits the repo. Nothing here is guesswork-free: state what you
detected and what you changed, so the user can correct you in one message.

## Step 1 — ask the questions

If the user already supplied answers in the invocation (e.g. `/start Acme,
acme.com, no indexing`), parse those and only ask for what's missing. If they
supplied everything, skip straight to step 2.

### 1a. Look for the answers first

Don't ask cold — spend one round of tool calls looking for candidates, so the
questions come pre-filled with real options instead of a blank field:

```bash
git -C . remote get-url origin 2>/dev/null   # org/repo name
grep -m1 '"name"' package.json               # package name
basename "$PWD"                              # folder name
```

A git remote like `git@github.com:acme-bv/portal.git` gives you both a likely
company name (`Acme B.V.`) and a likely domain (`acme.com` / `acmebv.com`).
Treat all of it as a guess — never as an answer.

### 1b. Ask with the AskUserQuestion tool, not prose

Seven questions, and the tool takes at most four per call, so this is **two
calls**: setup first, then formatting (1c). Make the first call, **stop and
wait**, then make the second. Do not start editing before both are back.

Free-text answers (a company name you didn't guess, a domain, a hex code, the
name of a role) arrive through the "Other" choice the tool always appends — so
say so in the question text, and keep every option a complete, selectable answer
on its own.

Rules the tool enforces: 1–4 questions per call, 2–4 options each, `header` ≤ 12
characters, and no "Other" option of your own (it's automatic).

```
questions: [
  {
    header: "Company",
    question: "What is the name of the company? It becomes the browser tab
               title, the name in WhatsApp/Slack link previews, and the entry
               your authenticator app shows after scanning the 2FA QR code.
               Pick Other to type the exact name.",
    options: [
      { label: "<candidate from git remote>",  description: "From the git remote — <url>" },
      { label: "<candidate from package.json>", description: "From package.json \"name\"" },
    ],
  },
  {
    header: "Brand colour",
    question: "Where should I take the brand colour from? Pick Other to paste
               your website domain (acme.com) or a hex code (#1d4ed8).",
    options: [
      { label: "<detected domain>", description: "I'll fetch it and extract the brand colour" },
      { label: "Skip — keep neutral", description: "Leaves the default grey theme, which is a fine starting point" },
    ],
  },
  {
    header: "Indexing",
    question: "Should the platform be indexed by Google?",
    options: [
      { label: "No — keep it private (Recommended)",
        description: "Right answer for an internal or customer-facing app. Ships this way already." },
      { label: "Yes — allow indexing",
        description: "Only for a public marketing surface that should appear in search results." },
    ],
  },
  {
    header: "Support",
    question: "Will everyone who can log in be allowed to raise support
               tickets? A support token is read access to the WHOLE support
               inbox for this app — anyone entitled can read every bug report
               colleagues have filed, not just their own. That is intended for
               staff, but wrong for clients, contractors or end customers. Pick
               Other to name the role or flag that decides it.",
    options: [
      { label: "Yes — every login is staff",
        description: "Only true if this app has no client/contractor/customer logins at all. Ships this way." },
      { label: "No — admins only",
        description: "Restricts support to app_metadata.role === 'admin'. Safe default when you're unsure." },
      { label: "No — I'll name the role/flag",
        description: "Pick this if entitlement is some other server-controlled flag; I'll ask which one." },
    ],
  },
]
```

If a question has fewer than two real candidates, still give two genuine
options rather than padding — for the company name that's usually the folder
name plus a legal-suffix variant of it (`Acme` / `Acme B.V.`); for the colour
it's the detected domain plus "Skip". If you found nothing at all for the
company name, drop that question from the call and ask for it in one plain
sentence alongside the tool's other three.

### 1c. Second call — date, number and currency formatting

**Put a recommendation in the labels, don't ask cold.** You already know the
domain from the first call, and its TLD is a good first guess at the audience:
`.nl` `.de` `.fr` `.es` `.it` → Europe; `.com` with a US company → US; a company
selling across regions → the unambiguous option. Mark your pick
`(Recommended)` and say in the description _why_ you picked it, so the user is
correcting a reasoned guess rather than answering from scratch.

Both defaults live in `lib/utils.ts` and are applied in step 6.

```
questions: [
  {
    header: "Dates",
    question: "How should dates be shown? This is display only — dates are
               always stored unchanged in the database. Pick Other for
               something else (e.g. YYYY-MM-DD).",
    options: [
      { label: "04/03/2026 — DD/MM/YYYY",
        description: "Europe, Latin America, Africa, most of Asia. <mark Recommended if the domain/company looks European>" },
      { label: "03/04/2026 — MM/DD/YYYY",
        description: "United States. <mark Recommended for a US audience>" },
      { label: "Mar 4th 2026 — written month",
        description: "Unambiguous everywhere. <mark Recommended when readers span several regions> Costs a little width in dense tables." },
    ],
  },
  {
    header: "Numbers",
    question: "How should numbers be shown — which thousands and decimal
               separators?",
    options: [
      { label: "1.234.567,89 — dot / comma",
        description: "Germany, Netherlands, Spain, Italy, Portugal, Brazil, Indonesia, Turkey." },
      { label: "1,234,567.89 — comma / dot",
        description: "US, UK, Ireland, Australia, India, Japan, China, Mexico." },
      { label: "1 234 567,89 — space / comma",
        description: "France, the Nordics, Poland, Czechia, South Africa. The SI-style convention." },
    ],
  },
  {
    header: "Currency",
    question: "Does this app show money anywhere — prices, invoices, budgets,
               salaries? If so, which currency by default? Pick Other for a
               currency not listed (any ISO code works).",
    options: [
      { label: "No money in this app",
        description: "Ships this way. Nothing to configure, and you can add it later. <mark Recommended unless you know there are amounts>" },
      { label: "EUR — €",
        description: "<mark Recommended if the company looks European>" },
      { label: "USD — $", description: "" },
      { label: "GBP — £", description: "" },
    ],
  },
]
```

Three things worth saying if the user hesitates:

- The date choice is **display only**. Dates are stored unchanged either way —
  this never touches what's in the database (`CLAUDE.md` → Important Rules).
- The written-month option is the safe one when in doubt, because `03/04/2026`
  is silently wrong rather than obviously wrong: a reader in the other
  convention sees a plausible date and never learns they misread it.
- **"No money" is a real answer, not a deferral.** Most apps built on this
  template never show an amount, and `CURRENCY` stays `null` — which is better
  than picking a plausible currency "just in case", because a wrong symbol on a
  real figure is worse than a feature nobody uses.

The answers are independent — a `.fr` company might want `Mar 4th 2026` dates
alongside `1 234 567,89` numbers. Don't collapse them into one "locale" choice.

If the currency answer is anything other than "No money", ask one follow-up in
plain prose (it's a detail, not a menu): **is the app single-currency, or will
it hold amounts in several?** Multi-currency is not a formatting setting — it
means every stored amount needs its own currency column, and totals can't be
summed across rows. Say that plainly and flag it as a design decision for
later; do NOT try to build it during `/start`.

Echo the answers back in one line before you start editing, so a wrong guess
costs one correction and not a whole run.

One thing the tool can't collect is the **logo file** for the email templates
(step 5). Ask for it in the same message you echo the answers back in, so it's
in hand by the time you get there rather than stalling the run halfway.

## Step 2 — apply the company name

`lib/company.ts` is the single source of truth. Replace the placeholder, drop
the TODO comment, and write a real description:

```ts
// TODO: Replace with your actual company name
export const COMPANY_NAME = "Company Name";

/** One short sentence — used for the meta description and link previews. */
export const APP_DESCRIPTION = "Modern app template with Supabase";
```

becomes:

```ts
export const COMPANY_NAME = "<answer>";

/** One short sentence — used for the meta description and link previews. */
export const APP_DESCRIPTION = "<one short, accurate sentence for the company>";
```

Everything that shows the app's name reads from there, so this one edit covers
all of it — **verify each of these actually picks it up**, they are the places
users notice a leftover placeholder:

| Where it surfaces                               | Comes from                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Browser tab                                     | `metadata.title` in `app/layout.tsx`                                                       |
| **Link preview** (WhatsApp, Slack, iMessage)    | `metadata.openGraph` / `metadata.twitter` in the layout                                    |
| Install prompt / OS app name                    | `metadata.applicationName`                                                                 |
| **Authenticator app** after scanning the 2FA QR | TOTP `issuer` + `friendlyName` in `app/auth/mfa-setup/page.tsx` and `app/profile/page.tsx` |

The 2FA one is the easiest to miss and the most annoying to fix later: the
issuer is baked into the QR code at enrolment, so anyone who enrolled while it
still said the placeholder keeps seeing the placeholder in Google
Authenticator / 1Password forever — they'd have to re-enrol. Get the name right
before the first real user sets up MFA.

Then check nothing still hardcodes a name instead of importing the constant:

```bash
grep -rn "Company Name\|Custom Application\|Modern app template" \
  --include="*.ts" --include="*.tsx" . --exclude-dir=node_modules
```

Fix any hit by importing `COMPANY_NAME` from `@/lib/company`, never by adding a
second hardcoded string.

Link previews currently ship without an image, so WhatsApp/Slack render the
name and description as text only. Step 5 collects and hosts a logo for the
email templates — once you have that URL, mention that an `openGraph.images`
entry plus `metadataBase` would reuse it here. A logo is the wrong aspect ratio
for a 1200x630 preview card, so offer it as a follow-up rather than wiring the
same file in; either way, don't invent an image path that doesn't exist.

## Step 3 — apply the brand colour

**Skip this step entirely if they chose "Skip — keep neutral"** — the neutral
default theme is a perfectly good starting point. If their answer was a hex
code, jump to 3c; if it was a domain, start at 3a.

### 3a. Fetch the site

Fetch raw HTML (not a summarised read — you need the markup and CSS):

```bash
curl -sL --max-time 20 -A "Mozilla/5.0" "https://<domain>" -o /tmp/brand.html
```

### 3b. Find the brand colour

Look in this order and take the first confident hit:

1. `<meta name="theme-color" content="#…">` — the most reliable single signal.
2. CSS custom properties with brand-ish names — `--brand`, `--primary`,
   `--color-primary`, `--accent`. Check inline `<style>` blocks and fetch the
   linked stylesheets (`<link rel="stylesheet">`) with the same `curl`.
3. The dominant non-neutral colour in the CSS — count hex occurrences and ignore
   greys (R≈G≈B), pure black, and pure white.
4. Fills in an inline logo `<svg>`.

```bash
grep -oiE '#[0-9a-f]{6}|#[0-9a-f]{3}\b' /tmp/brand.html | sort | uniq -c | sort -rn | head -20
```

If nothing convincing turns up (a JS-rendered site often yields nothing), **say
so and ask the user for the hex code** rather than picking a colour at random.

### 3c. Convert and apply

`scripts/brand-theme.mjs` does the colour maths — sRGB → OKLab → the `oklch()`
values `app/globals.css` uses, with lightness clamped into a readable band and
the foreground picked by contrast. Do not hand-convert.

```bash
node scripts/brand-theme.mjs "#1d4ed8"
```

It prints two blocks. Apply them to `app/globals.css`:

- the `/* --- :root (light) --- */` block → replace those same tokens inside `:root`
- the `/* --- .dark --- */` block → replace those same tokens inside `.dark`

Only the tokens the script emits change (`--primary`, `--primary-foreground`,
`--ring`, `--chart-1..5`, `--sidebar-primary`, `--sidebar-primary-foreground`,
`--sidebar-ring`). **Leave `--background`, `--foreground`, `--card`, `--muted`,
`--accent`, `--border`, `--input` and `--destructive` alone** — they are the
neutral surface scale and the error colour, and tinting them is how a theme
starts failing contrast in dark mode.

Tell the user which hex you detected and where you found it.

## Step 4 — apply the indexing choice

The app ships **de-indexed**, in three coordinated places. Get all three
consistent with the answer.

### If the answer is NO (keep it out of Google) — the default

Verify these are all present; they should already be:

| File             | What must be there                                                           |
| ---------------- | ---------------------------------------------------------------------------- |
| `app/layout.tsx` | `robots: { index: false, follow: false }` in the exported `metadata`         |
| `next.config.ts` | the `headers()` entry setting `X-Robots-Tag: noindex, nofollow` on `/:path*` |
| `app/robots.ts`  | allow-all rules — **no** `Disallow: /`                                       |

This does not affect the link previews from step 2 — WhatsApp, Slack and
iMessage fetch the Open Graph tags directly and ignore `noindex`, so a
de-indexed app still shows the company name when someone shares a link.

The `Disallow` omission is deliberate: a crawler must be able to fetch a URL to
see the `noindex`. Blocking the crawl can strand already-known URLs in the index
as bare links. A `Disallow` can be added later, once they've dropped out.

### If the answer is YES (allow indexing)

1. `app/layout.tsx` — remove the `robots` key from `metadata` (and the comment
   block above it explaining the noindex). Omitting it is the correct "index
   normally" state; there's no need for `index: true`.
2. `next.config.ts` — remove the whole `async headers()` block that sets
   `X-Robots-Tag`. Leave the rest of the config untouched.
3. `app/robots.ts` — keep it, and rewrite the docblock so it no longer claims the
   app is de-indexed. Consider adding a `sitemap` entry if a sitemap exists.

Then say this out loud to the user: **`noindex` is a search directive, not access
control.** Everything behind auth stays behind auth — allowing indexing only
affects the pages a logged-out visitor can already reach (`/auth/login`,
`/auth/reset-password`). If they expected marketing pages to be indexed, those
pages need to exist and be public first.

## Step 5 — restyle the email templates

`setup/email-templates/` holds the ten Supabase auth emails. They ship in a
generic near-black style with no logo, and they are the first thing a new user
sees — the confirm-signup and invite mails arrive before the app does.

**Read this before editing anything:** nothing in the codebase reads these
files. `grep -rn "email-templates" app lib` returns nothing. They are artifacts
to paste into **Supabase → Authentication → Emails**, one per template. Editing
them here changes nothing until someone pastes them. Say that to the user at the
end of this step, or they will send a test mail and report that your change
didn't work.

Templates 1–5 have a call-to-action button; 6–10 are notifications with no
button. All ten get the logo. The mapping of file → dashboard template, and
the note that 7–10 must also be _enabled_ per project, is in
`documentation/email-templates.md`.

### 5a. Get the logo

The template ships with no `public/` folder and no image anywhere, so this must
come from the user. Ask for it plainly (this is a file, not a multiple choice —
don't try to fit it into AskUserQuestion):

> Send me the logo as a PNG and tell me where it should be hosted — I'll upload
> it and point the emails at it.

What to ask for, and why each one bites:

- **PNG or JPG, never SVG.** Gmail, Outlook and Yahoo all strip `<img>` tags
  pointing at SVG. An SVG logo looks perfect in your own testing and is missing
  for most real recipients.
- **Upload at ~2× the display size** (about 280px wide for a 140px logo), so it
  isn't soft on retina screens. Always set `width` in the tag, never rely on the
  file's intrinsic size.
- **It must read on white.** The card behind it is `background:#ffffff`, so a
  white or very light logo disappears. If they only have a light-on-dark logo,
  ask for the dark-on-light variant rather than putting a coloured panel behind
  it — several clients strip background colours on images.

If they don't have a logo to hand, **skip this step entirely and leave the
templates as they are.** A broken image icon in a signup email is worse than no
logo, and this is a step that's easy to come back to.

### 5b. Host it and get an absolute URL

Email clients fetch images over the public internet from a mail app that has no
session on your app. So:

- The URL must be **absolute and HTTPS**. No relative paths — there is no page
  for them to be relative to.
- It must need **no authentication**, or every recipient sees a broken image.
- **Do not build it from `{{ .SiteURL }}`.** Only 4 of the 10 templates
  reference that variable today; the notification ones (6–10) don't, and a
  template variable that doesn't resolve renders as literal text in the `src`.
  Use one absolute URL in all ten.

**Recommended — a public Supabase Storage bucket.** It's stable, works before
the app is ever deployed, and survives a domain change. `CLAUDE.md` restricts
public buckets to "genuinely world-readable, non-sensitive assets (e.g. the app
logo)", which is exactly this — a logo in a public bucket is the sanctioned
case, not an exception to argue for. Do NOT use a signed URL: they expire, and a
signup email read a week later would show a broken image.

The project ref is already in `.env.local` as `NEXT_PUBLIC_SUPABASE_URL`, and it
is the slug the final URL is built from:

```
https://<project-ref>.supabase.co/storage/v1/object/public/<bucket>/<file>
```

Create the bucket **as a migration**, not by clicking in the dashboard —
`.claude/rules/database.md` requires every database object to be
version-controlled, and bucket privacy / size cap / MIME allowlist are exactly
the server-side config that gets forgotten otherwise. Write
`/sql/NNNN_create-brand-assets-bucket.sql` (next free 4-digit prefix), append it
to the **SQL Files Log** in `CLAUDE.md`, and tell the user to run it in the
Supabase SQL Editor:

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brand-assets', 'brand-assets', true, 2097152,
        array['image/png','image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
```

Public **on purpose** here, and worth stating in the migration's header comment
so nobody "fixes" it later: the bucket holds only the logo, and email clients
cannot authenticate. Never put anything else in it. Run the Supabase security
advisor afterwards and expect `public_bucket_allows_listing` to flag —
acknowledge it in your report rather than silently ignoring it.

**Alternative — the app's own domain.** Drop the file at `public/email-logo.png`
and use `https://<production-domain>/email-logo.png`. Simpler and versioned in
git, but it only works **after** a production deploy, and every already-sent
email breaks if the domain changes. Fine if they already have a stable domain
and would rather not add a bucket.

Whichever you use, **fetch the final URL and confirm it returns 200 with an
image content-type** before writing it into ten files:

```bash
curl -sI "<logo-url>" | head -1
curl -sI "<logo-url>" | grep -i content-type
```

### 5c. Compute the button colours

Only if step 3 produced a brand colour — if they chose "Skip — keep neutral",
leave the buttons at `#111827` and skip to 5d.

Email clients can't parse `oklch()` or CSS custom properties (Outlook renders
through Word), so the templates need literal hex. Don't hand-convert the theme
tokens — the script does it:

```bash
node scripts/brand-theme.mjs "#1d4ed8" --email
```

It prints the button background and the text colour that stays readable on it,
derived from the same clamped colour the app's `--primary` uses, so the email
button matches the in-app button. A very light brand (yellow) comes back
darkened with near-black text; a neutral brand (black, grey) comes back as the
existing `#111827`, because a neutral has no hue to tint with.

### 5d. Apply to all ten templates

Two edits per file. **The logo goes in all ten; the button recolour only in
1–5.**

**Logo** — insert as a new first row inside the white card table, immediately
before the row holding the `<h2>`:

```html
<tr>
  <td style="padding: 28px 24px 0 24px">
    <img
      src="<LOGO_URL>"
      width="140"
      alt="<COMPANY_NAME>"
      style="display:block; width:140px; max-width:140px; height:auto; border:0;"
    />
  </td>
</tr>
```

Then change the `<h2>` row's padding from `28px 24px 8px 24px` to
`20px 24px 8px 24px`, or the heading sits too far from the logo.

Use the real company name from `lib/company.ts` as the `alt` text — it is what
recipients see when images are blocked, which for a large share of Outlook users
is the default.

**Button** — in templates 1–5 only, replace both colours. The fill is on the
`<td>` (with the padding — Outlook drops padding on the `<a>`), the text colour
on the `<a>`:

```html
<!-- before -->
<td
  class="em-btn"
  style="border-radius: 10px; background: #111827; padding: 12px 18px"
>
  <a href="…" style="…; color: #ffffff">…</a>
</td>

<!-- after -->
<td
  class="em-btn"
  style="border-radius: 10px; background: <BUTTON_BG>; padding: 12px 18px"
>
  <a href="…" style="…; color: <BUTTON_TEXT>">…</a>
</td>
```

Change **both** — leaving `color:#ffffff` on a light brand fill is how you ship
a white-on-yellow button that nobody can read.

Leave the `em-btn` class and the `@media (prefers-color-scheme: dark)` block in
the `<head>` alone. That block inverts the button for dark-mode clients, and it
assumes the light-mode fill is dark. If the brand colour is very light, also
flip `.em-btn` / `.em-btn a` in **both** the media query and its `[data-ogsc]`
copy, or dark-mode readers get the light fill twice over.

### 5e. Check the work

These files are Prettier-formatted (`style="background: #111827"`, with the
space), so grep for that spelling — the unspaced form matches nothing:

```bash
cd setup/email-templates
grep -L "<img" *.html                          # print nothing — all 10 have the logo
grep -c "<img" *.html                          # exactly 1 each — no double-inserted rows
grep -A4 'class="em-btn"' *.html | grep background:   # the 5 button fills
```

The last one reads the button fill specifically. Don't grep bare
`background: #111827` — that also hits the dark-mode footer rule in all ten
files and looks like the recolour failed when it didn't.

Then run `npm run format` — Prettier reflows HTML, and CI checks the whole repo.

Then tell the user, in this order: the logo URL you used and where it's hosted,
the button hex, that a migration is waiting at `/sql/NNNN_…sql` if you wrote
one, and — the part they'll otherwise miss — that **all ten templates must
be pasted into Supabase → Authentication → Emails**, and that templates 7–10 are
security notifications which must additionally be **enabled** per project before
they send anything. `documentation/email-templates.md` has the file → template
mapping to hand them.

## Step 6 — apply the date, number and currency formats

All three defaults are constants at the bottom of `lib/utils.ts`. Set them to
the answers from step 1c:

```ts
export const DATE_FORMAT: DateFormat = "MMM_D_YYYY"; // or "DD/MM/YYYY" | "MM/DD/YYYY"
export const NUMBER_FORMAT: NumberFormat = "1,234.56"; // or "1.234,56" | "1 234,56"
export const CURRENCY: CurrencyConfig | null = null; // null = this app shows no money
```

`formatDate()`, `formatNumber()` and `formatCurrency()` read them, so that is
the whole change — **do not** add a second constant elsewhere or thread a
locale through props.

### The currency, if there is one

Leave `CURRENCY` as `null` if the answer was "No money in this app". That is a
finished answer, not a placeholder.

Otherwise copy the matching entry from `CURRENCY_PRESETS` (same file) and set
`position` / `space` to the local convention — **the presets get `symbol` and
`decimals` right, but placement follows the country, not the currency**, which
is why it isn't inferred:

| Written as   | Where          | `position` | `space` |
| ------------ | -------------- | ---------- | ------- |
| `€ 1.234,56` | Netherlands    | `prefix`   | `true`  |
| `1.234,56 €` | Germany, Spain | `suffix`   | `true`  |
| `1 234,56 €` | France         | `suffix`   | `true`  |
| `$1,234.56`  | US, UK, AU     | `prefix`   | `false` |

```ts
export const CURRENCY: CurrencyConfig | null = {
  ...CURRENCY_PRESETS.EUR,
  position: "prefix", // Dutch convention
  space: true,
};
```

Then show the user one rendered amount (`€ 1.234,56`) and ask them to confirm
it looks right — placement is the part people notice instantly and specs get
wrong.

Two things not to do here: don't set a currency "just in case" when the answer
was no money, and don't try to build multi-currency support. If they said
amounts come in several currencies, note it as a schema decision (each amount
needs its own currency column; totals can't be summed across rows) and move on.

### Then fix the call sites that bypass them

Setting the constants is not enough on its own: the template still has places
that format inline, and those will ignore the answer. Find them:

```bash
grep -rn "toLocaleDateString\|toLocaleString" app components --include="*.tsx"
```

Triage each hit into one of three buckets:

1. **`toLocaleDateString()` / `toLocaleString()` with no locale argument** —
   fix these first. They render in the _viewer's_ locale, so the same record
   reads `03/04/2026` for one colleague and `04/03/2026` for another, with
   nothing on screen to say which. Replace with `formatDate(...)` /
   `formatNumber(...)` from `@/lib/utils`.
2. **A hardcoded `"en-US"`** — replace with the helpers too, otherwise a
   European project still shows US dates in those spots.
3. **Genuinely locale-independent uses** — `components/ui/calendar.tsx` uses
   `toLocaleString` for month names and a `data-day` attribute, and
   `components/ui/chart.tsx` for tooltip values. These are shadcn/ui vendor
   files: leave them alone unless the user asks. Editing them means every
   future `npx shadcn add` overwrite silently reverts your change.

Say which files you changed and which you deliberately left, so nobody
re-reports the ones in bucket 3 as a bug.

### Check it

```bash
npx vitest run lib/utils.test.ts
```

The tests cover both helpers, including the case that matters most: a date read
in **UTC**, not the viewer's timezone, so the value shown is the value stored
(`CLAUDE.md` → Important Rules). If you changed `DATE_FORMAT`, the tests still
pass — they pass the format explicitly rather than relying on the default, which
is deliberate so setting a project's format never turns the suite red.

Show the user one real example of each in your report (`Mar 4th 2026`,
`1,234,567.89`), rather than just naming the constant — it is a lot easier to
spot a wrong choice from the rendered form.

## Step 7 — apply the support entitlement decision

`isEntitledToSupport()` in `app/api/support-token/route.ts` decides who may
raise support tickets. It ships returning `true` for every authenticated user,
which is correct **only** while every login belongs to the customer's own staff.

Why this is worth a question rather than a default: a support token grants read
access to the whole support inbox for the app, not just the holder's own
tickets. Colleagues seeing each other's reports prevents duplicates — but the
same property means an external user with a token can read every bug report and
whatever operational detail it contains. Whichever way this is answered, **write
the decision into the comment** so the next person knows it was considered
rather than skipped.

Two things to say out loud, in every case:

- **Hiding the sidebar button is not a boundary.** Any logged-in user can `curl`
  the endpoint. The check has to live in the route.
- The widget stays invisible until `NEXT_PUBLIC_SUPPORT_INSTALLATION_KEY` is
  set, so nothing here is testable in the browser until an installation is
  provisioned — but the gate is still live and must be right before it is.

### If the answer is "every login is staff"

Leave the function returning `true` and replace the "review this in every
project" framing with the recorded decision:

```ts
/**
 * ENTITLEMENT GATE — decided during /start on <YYYY-MM-DD>: every login on this
 * application is company staff, so every authenticated user may raise tickets.
 *
 * Revisit the moment this app gains logins that are NOT the customer's own
 * staff — clients, contractors, partners, end customers. A support token is
 * read access to the whole support inbox, so an external user holding one can
 * read every bug report filed for this app.
 */
function isEntitledToSupport(user: User): boolean {
  void user;
  return true;
}
```

### If the answer names a role or flag

Narrow it to a **server-controlled** value:

```ts
function isEntitledToSupport(user: User): boolean {
  return user.app_metadata?.role === "admin";
}
```

Rules to hold, and to check before you write the line:

- Read from **`app_metadata`**, never `user_metadata` — the row owner can edit
  the latter through PostgREST, which would make the gate self-granting.
- Never gate on the email domain. Contractors have company addresses and staff
  have personal ones; it is a lossy proxy that fails in both directions.
- **Verify the flag actually exists** before gating on it. `grep -rn
"app_metadata" app lib` shows what this project really sets — if the answer
  names something that isn't there yet, say so and gate on `role === "admin"`
  until it is, rather than shipping a gate that locks everyone out.

Then update the two places that describe the decision so they don't contradict
the code: the **Support widget** section in `CLAUDE.md` and the
**Entitlement** section in `documentation/support-widget.md`.

## Step 8 — verify and report

```bash
npm run format
npm run check:fast
```

Confirm the gate does what the answer said. Logged out it must be `401`
regardless:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3100/api/support-token
```

If the answer restricted support, note in the report that the `403` path still
needs one check with a real non-entitled session — that needs a logged-in
browser and is a human's job.

Then give a short summary: the company name set, the brand hex used and where it
came from, the indexing decision, who may raise support tickets, the email
templates' logo URL and button hex, the date, number and currency formats **shown as a
rendered example** (`Mar 4th 2026`, `1,234,567.89`, `€ 1.234,56` — or "no
currency configured") rather than as constant names, and every file touched.

Finish with what the user still has to do by hand, because none of it happens
from this repo:

- **Paste all ten templates** into Supabase → Authentication → Emails.
- **Run any migration** you wrote (`/sql/NNNN_…sql`) in the SQL Editor.
- Send one real test email and confirm the logo renders — ideally in Gmail and
  Outlook, which are where image handling differs most.

And close by pointing at the project's other skills, so they surface when
their moment comes rather than being discovered by accident: **`/comments`**
designs this project's comment system (threads on records, @mentions, central
inbox) through scoping questions when the app needs collaboration on records —
never build ad-hoc comment features outside it; and
**`reviewing-ui-before-shipping`** is the checklist to run before calling any
screen finished. Both are listed with the resource inventory in `CLAUDE.md` →
Project Skills.

If you want to eyeball the result, start a dev server on a **non-default port**
(the user runs their own on 3000) and kill it when you're done:

```bash
npx next dev -p 3100
# …check /auth/login in both light and dark mode…
pkill -f "next dev -p 3100"
```
