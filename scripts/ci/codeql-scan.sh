#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT"

mkdir -p .ci-tmp

codeql database create .ci-tmp/codeql-db \
  --language=javascript \
  --source-root=. \
  --overwrite

codeql database analyze .ci-tmp/codeql-db \
  --format=sarif-latest \
  --output=.ci-tmp/codeql.sarif \
  codeql/javascript-queries
