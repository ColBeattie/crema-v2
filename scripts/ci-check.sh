#!/usr/bin/env bash
set -uo pipefail

# CI Quality Gate
# This script runs all checks that must pass before code can be merged.
# Exit code 0 = all checks passed. Non-zero = something failed.

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

passed=0
failed=0

run_check() {
  local name="$1"
  shift
  printf "${YELLOW}▶ Running: %s${NC}\n" "$name"
  if "$@"; then
    printf "${GREEN}✓ Passed: %s${NC}\n\n" "$name"
    passed=$((passed + 1))
  else
    printf "${RED}✗ Failed: %s${NC}\n\n" "$name"
    failed=$((failed + 1))
  fi
}

# 1. TypeScript type check
run_check "TypeScript" npx tsc --noEmit

# 2. ESLint
run_check "ESLint" npx eslint .

# 3. Prettier
run_check "Prettier" npx prettier --check .

# 4. Unit tests
run_check "Unit Tests" npx vitest run

# 5. Gitleaks secret scan
if ! command -v gitleaks &> /dev/null; then
  printf "${RED}✗ gitleaks is not installed.${NC}\n"
  printf "  Install it with: brew install gitleaks\n"
  printf "  Gitleaks is required — secret scanning cannot be skipped.\n\n"
  failed=$((failed + 1))
else
  run_check "Secret Scan (gitleaks)" gitleaks detect --source . --no-git --verbose
fi

# 6. Dependency audit (gated — fails on HIGH/CRITICAL unless allowlisted in .audit-ci.jsonc)
run_check "Dependency Audit" npm run audit

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
printf "${GREEN}Passed: %d${NC}  ${RED}Failed: %d${NC}\n" "$passed" "$failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$failed" -gt 0 ]; then
  printf "\n${RED}Quality gate FAILED. Fix the issues above before merging.${NC}\n"

  # Show actionable hints for common failures
  if ! command -v gitleaks &> /dev/null; then
    printf "\n${YELLOW}Hint: Install gitleaks with:${NC}\n"
    printf "  brew install gitleaks\n"
  fi

  exit 1
else
  printf "\n${GREEN}All checks passed. Good to merge.${NC}\n"
  exit 0
fi
