# Workflow Rules

- NEVER commit (`git commit`) or push (`git push`) to GitHub. The user handles all git operations.
- NEVER run `npm run build` unless the user explicitly asks for it.
- Before deleting files, removing dependencies, dropping DB columns/tables, or overwriting existing code with a completely different approach — always ask the user first.
- When fixing a bug or adding a feature, only change what's necessary. Don't "improve" surrounding code, add comments to unrelated functions, or refactor files you weren't asked to work on.
- If a change will break existing functionality, API contracts, or require changes in other parts of the codebase, explain the impact and get approval before proceeding.
- Before introducing a new pattern, library, or approach, check how the codebase already handles similar things. Follow existing conventions unless the user explicitly wants something different.
- Never overwrite or edit a file without reading it first. Understand what's already there before making changes.
- Before installing a new npm package, check if the functionality already exists in the project's current dependencies. Ask the user before adding new dependencies. Prefer well-maintained, small-footprint packages over large frameworks for single-purpose tasks.
- If a component file exceeds ~300 lines, suggest splitting it into smaller components. Ask the user before doing so.
- After completing a task that touched multiple files, provide a brief summary of all files changed and what was done in each.
- If you need to build the same thing on more pages, ask the user if he wants them to always be identical. If so, leverage components rather than building everything twice.
- If you start your own development server to test something, that's fine, but please kill it after since we always have our own dev server running.
- All documentation files (`.md` and similar) must be placed in the `/documentation` folder. The only exceptions are root-level files like `CLAUDE.md` and `README.md`.
- All scripts (shell scripts, migration scripts, utility scripts, etc.) must be placed in the `/scripts` folder.
