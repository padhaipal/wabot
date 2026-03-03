#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT"

MODE="full"
if [ "${1:-}" = "--fast" ]; then
  MODE="fast"
fi

# ---------------------------------------------------------------------------
# Required tool & env checks (mode-aware)
# ---------------------------------------------------------------------------
missing=()
command -v gitleaks &>/dev/null || missing+=("gitleaks")
if [ "$MODE" = "full" ]; then
  command -v cs       &>/dev/null || missing+=("cs (CodeScene CLI)")
  command -v codeql   &>/dev/null || missing+=("codeql (CodeQL CLI)")
fi
if [ ${#missing[@]} -gt 0 ]; then
  echo "ERROR: Missing required tool(s): ${missing[*]}"
  exit 1
fi
if [ "$MODE" = "full" ] && [ -z "${CS_ACCESS_TOKEN:-}" ]; then
  echo "ERROR: CS_ACCESS_TOKEN environment variable is not set."
  exit 1
fi

# ---------------------------------------------------------------------------
gitleaks_scan() {
  if git rev-parse --verify origin/main &>/dev/null; then
    gitleaks git --exit-code 1 --log-opts "origin/main..HEAD" .
  else
    echo "(origin/main not found — falling back to full-history scan)"
    gitleaks git --exit-code 1 .
  fi
}

if [ "$MODE" = "full" ]; then
  echo "===== Full Gate ====="

  echo "-- [1/16] mkdir -p .ci-tmp ci-baselines --"
  mkdir -p .ci-tmp ci-baselines

  echo "-- [2/16] Gitleaks --"
  gitleaks_scan

  echo "-- [3/16] npm ci --"
  npm ci 2>&1 | tee .ci-tmp/npm-ci.log

  echo "-- [4/16] npm audit --"
  npm audit --json > .ci-tmp/npm-audit-full.json

  echo "-- [5/16] Deprecation baseline check --"
  npm run deps:baseline:check:deprecations

  echo "-- [6/16] Audit baseline check --"
  npm run deps:baseline:check:audit

  echo "-- [7/16] Prettier --"
  npx prettier --check .

  echo "-- [8/16] ESLint --"
  npx eslint . --max-warnings=0 --report-unused-disable-directives

  echo "-- [9/16] TypeScript --"
  npx tsc --noEmit

  echo "-- [10/16] Build --"
  npm run build

  echo "-- [11/16] Unit tests --"
  npm test

  echo "-- [12/16] Coverage --"
  npm run test:cov

  echo "-- [13/16] CodeScene delta --"
  cs delta

  echo "-- [14/16] CodeScene check --"
  find src test -name '*.ts' -print0 | xargs -0 -n1 cs check

  echo "-- [15/16] CodeQL --"
  bash scripts/ci/codeql-scan.sh

  echo "-- [16/16] Stryker --"
  npx stryker run

  echo "===== Full Gate PASSED ====="
else
  echo "===== Fast Gate ====="

  echo "-- [1/7] mkdir -p .ci-tmp ci-baselines --"
  mkdir -p .ci-tmp ci-baselines

  echo "-- [2/7] Gitleaks --"
  gitleaks_scan

  echo "-- [3/7] npm ci --"
  npm ci 2>&1 | tee .ci-tmp/npm-ci.log

  echo "-- [4/7] Prettier --"
  npx prettier --check .

  echo "-- [5/7] ESLint --"
  npx eslint . --max-warnings=0 --report-unused-disable-directives

  echo "-- [6/7] TypeScript --"
  npx tsc --noEmit

  echo "-- [7/7] Unit tests --"
  npm test

  echo "===== Fast Gate PASSED ====="
fi
