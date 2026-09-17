# Resource Rules

Reuse-first: this template already contains most of what a feature needs. The
inventory of what exists — every reusable component, hook, utility and script,
with when to use each — is `documentation/resources.md`. These rules keep it
true.

## Before creating anything

- Before writing a new component, hook, utility or script, **check
  `documentation/resources.md`** (and the code it points to). If something
  close exists, reuse it or extend it — never create a parallel version.
  Two implementations of the same thing is the failure this rule exists to
  prevent.
- If you believe nothing fits, say so and name what you checked, so a wrong
  guess costs one correction.

## Canonical resources are not bypassed

Some resources are the single source of truth for their concern. Never inline
a second implementation of what they own:

| Resource                       | Owns                                                                           | Never do                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `lib/company.ts`               | Company name and app description                                               | Hardcode the company name anywhere — import the constant                                   |
| `lib/utils.ts`                 | `formatDate` / `formatNumber` / `formatCurrency` + their project-wide defaults | Format inline (`toLocaleDateString`), add a second constant, thread a locale through props |
| `app/globals.css` theme tokens | All colors (light + dark)                                                      | Hardcode colors without a `dark:` variant (see `ui.md`)                                    |
| `scripts/brand-theme.mjs`      | Brand color math (sRGB → OKLCH, contrast)                                      | Hand-convert colors or hand-pick "close enough" values                                     |
| `app/components/Tooltip.tsx`   | Hover tooltips (custom instant tooltip per `ui.md`)                            | Use browser-native `title` tooltips or add a second tooltip system                         |

## `components/ui/` is vendor code

shadcn/ui files are installed, not authored. Editing them means the next
`npx shadcn add` silently reverts the change (`/start` deliberately leaves
`calendar.tsx` and `chart.tsx` alone for this reason).

- Need a variant or different behavior? **Extend by composition**: wrap the
  primitive in a new component under `app/components/` (or `components/`).
- A new shadcn primitive is added with `npx shadcn add <name>`, never written
  by hand into `components/ui/`.

## Promotion: page-local → shared

Code local to one page stays in that page's folder. The moment a second page
needs the same thing, promote it to a shared location (`app/components/`,
`lib/`) instead of copying it — per `workflow.md`, ask the user first when
this means reworking existing pages.

## Keep the inventory alive

Whenever you add a shared component, hook, utility or script, **register it in
`documentation/resources.md` in the same change** — name, path, one line on
when to use it. An inventory that lags the code is worse than none: it teaches
the next agent that checking it is optional.

## Before calling UI done

Run the `reviewing-ui-before-shipping` skill (`.claude/skills/`) before
declaring a screen finished or handing it to a client. A green build is not a
usable screen.
