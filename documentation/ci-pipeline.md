# CI Pipeline Plan

## Current State

- Next.js 16 / TypeScript 5.9 / React 19 / Tailwind v4
- ESLint configured (next/core-web-vitals + next/typescript)
- No Prettier, no test runner, no git hooks, no GitHub Actions, no security scanning
- Deployed via Vercel (git integration)
- No `npm run check` script

---

## What We Are Going to Build

### 1. `npm run check` — The Single Quality Gate

One command that every developer, git hook, and CI workflow runs. If this fails, nothing ships.

**Checks included (in order):**

| Step             | Tool                           | What it catches                                           | Speed  |
| ---------------- | ------------------------------ | --------------------------------------------------------- | ------ |
| TypeScript       | `tsc --noEmit`                 | Type errors                                               | ~5s    |
| ESLint           | `eslint .`                     | Code quality, React bugs, a11y                            | ~5s    |
| Prettier         | `prettier --check .`           | Formatting inconsistencies                                | ~3s    |
| Unit tests       | `vitest run`                   | Broken logic                                              | varies |
| Secret scan      | `gitleaks detect`              | Leaked API keys, passwords                                | ~2s    |
| Dependency audit | `npm audit --audit-level=high` | Known vulnerable packages (informational, does not block) | ~3s    |

**Why this order:** Fast checks first so you fail early. No point running tests if the code doesn't compile.

**Also add `npm run check:fast`** — a lightweight version for local pre-push hooks:

- TypeScript + ESLint + Prettier only
- Target: under 30 seconds

### 2. Prettier — Formatting

**Why add it:** ESLint handles code quality, not formatting. Without Prettier, every PR has formatting noise. Prettier eliminates all formatting debates.

**Setup:**

- Install `prettier` + `eslint-config-prettier` (disables ESLint rules that conflict)
- Config: minimal `.prettierrc` — just set `semi`, `singleQuote`, `tabWidth` to match what the codebase already uses
- Add `prettier --check .` to `npm run check`
- Add `prettier --write .` as `npm run format` for quick fixes

### 3. Vitest — Unit Testing

**Why Vitest over Jest:** Native TypeScript and ESM support, faster, works with the same Vite/Turbopack ecosystem. Zero config needed for our stack.

**Setup:**

- Install `vitest` as devDependency
- Add `vitest.config.ts` with path aliases matching `tsconfig.json`
- Add `npm run test` (watch mode) and `npm run test:run` (single pass for CI)
- Start with utility function tests — no need to test every component on day one

**Convention:** Test files live next to the code they test as `*.test.ts` / `*.test.tsx`.

### 4. Gitleaks — Secret Scanning

**Why:** One accidental `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` push and your database is compromised. Gitleaks catches secrets before they hit the remote.

**Setup:**

- Install via Homebrew (`brew install gitleaks`) — team members install once
- Add `.gitleaks.toml` config to the repo (to allow known false positives)
- Runs in `npm run check` via `gitleaks detect --source . --no-git`
- Runs in GitHub Actions via the official `gitleaks/gitleaks-action`

**Note:** Gitleaks is a Go binary, not an npm package. It must be installed on every developer's machine. The `npm run check` script will fail with a clear error message if gitleaks is not found, with instructions to install it (`brew install gitleaks` on macOS). No skipping — if you can't scan for secrets, you can't push.

### 5. Husky + Pre-Push Hook — Block Broken Pushes Locally

**Why pre-push and not pre-commit:** Pre-commit hooks that run on every commit slow developers down and lead to people skipping hooks. Pre-push is the right balance — you catch issues before they reach GitHub, but you don't interrupt the flow of committing work-in-progress.

**Setup:**

- Install `husky` as devDependency
- `npx husky init` to set up `.husky/` directory
- Pre-push hook runs `npm run check:fast`
- Target: under 30 seconds so developers don't bypass it

### 6. GitHub Actions — The Real Gate

This is the gate that actually blocks merges. Local hooks are a courtesy; CI is the law.

**Workflow: `.github/workflows/ci.yml`**

```
Trigger: push to any branch + pull_request to master

Steps:
1. Checkout code
2. Setup Node 22
3. Install dependencies (npm ci)
4. Run npm run check (full quality gate)
5. Run next build (catches build-time errors that dev mode misses)
6. Run gitleaks scan
```

**Why also run `next build`:** Dev mode with Turbopack is lenient. Production builds catch issues like:

- Missing environment variables
- Server/client component boundary violations
- Dynamic import issues
- CSS purging problems

### 7. Branch Protection — Enforce the Rules

Configure on GitHub (Settings > Branches > Branch protection rules for `master`):

- **Require pull request before merging** — no direct pushes to master
- **Require status checks to pass** — the CI workflow must be green
- **Require branches to be up to date** — no stale merges
- **Require at least 1 approval** (optional, depends on team size)

### 8. Vercel Deployment Protection

**Recommendation: Option A (simple) — keep Vercel git integration as-is.**

- Vercel already waits for GitHub checks before deploying to production
- Enable "Required Checks" in Vercel project settings to block deploy on CI failure
- Preview deploys still work on PRs (useful for design review)

Option B (CI-controlled deploy) is overkill for most projects. Only consider it if you need custom deployment logic like database migrations before deploy.

---

## What We Are NOT Including (and Why)

| Tool                                  | Why not                                                                                                                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Semgrep**                           | Adds 30-60s to CI, complex to configure, high false-positive rate for Next.js apps. ESLint security rules + Gitleaks cover the most important cases. Can add later if needed. |
| **lint-staged**                       | We are using pre-push, not pre-commit. lint-staged is designed for pre-commit partial file checking. Not needed.                                                              |
| **Commitlint / Conventional Commits** | Adds friction without clear value for small-medium teams. Nice to have, not a priority. Can add later.                                                                        |
| **E2E tests (Playwright/Cypress)**    | Important but a separate initiative. The CI pipeline supports adding them later — just add another step to `npm run check`.                                                   |
| **Docker-based CI**                   | Unnecessary overhead. GitHub Actions runners with Node.js are sufficient.                                                                                                     |

---

## New npm Scripts Summary

```json
{
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "tsc --noEmit",
    "test": "vitest",
    "test:run": "vitest run",
    "check:fast": "npm run typecheck && npm run lint && npm run format:check",
    "check": "npm run typecheck && npm run lint && npm run format:check && npm run test:run && npm audit --audit-level=high"
  }
}
```

---

## New Dependencies

| Package                  | Type          | Purpose                         |
| ------------------------ | ------------- | ------------------------------- |
| `prettier`               | devDependency | Code formatting                 |
| `eslint-config-prettier` | devDependency | Disable ESLint formatting rules |
| `vitest`                 | devDependency | Unit test runner                |
| `husky`                  | devDependency | Git hooks                       |

System-level (not npm):

- `gitleaks` — installed via Homebrew or downloaded in CI

---

## New Files

```
.prettierrc                    — Prettier config
.prettierignore                — Exclude node_modules, .next, etc.
.gitleaks.toml                 — Gitleaks config (allowlist for false positives)
vitest.config.ts               — Vitest config with path aliases
.husky/pre-push               — Runs npm run check:fast
.github/workflows/ci.yml      — GitHub Actions CI workflow
```

---

## Implementation Order

1. **Prettier** — install, configure, format the entire codebase once
2. **Vitest** — install, configure, add one example test
3. **npm scripts** — add all the new scripts to package.json
4. **Gitleaks config** — add `.gitleaks.toml`
5. **Husky** — install, add pre-push hook
6. **GitHub Actions** — create the CI workflow
7. **Branch protection** — configure on GitHub (manual step)
8. **Vercel check** — verify deployment waits for CI (manual step)

---

## The Developer Flow After Setup

```
Write code
    |
    v
git commit (no hook — fast commits, WIP allowed)
    |
    v
git push
    |
    v
Pre-push hook runs check:fast (~20s)
    |--- FAIL --> fix and push again
    |
    v
PR created on GitHub
    |
    v
GitHub Actions runs full check + build (~2-3 min)
    |--- FAIL --> fix, push, CI re-runs
    |
    v
PR approved + checks green
    |
    v
Merge to master
    |
    v
Vercel deploys to production
```
