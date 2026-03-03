#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_DIR="$(mktemp -d)"

cleanup() {
  cd "$REPO_ROOT"
  git worktree remove --force "$WORKTREE_DIR" 2>/dev/null || true
  rm -rf "$WORKTREE_DIR" 2>/dev/null || true
}
trap cleanup EXIT

echo "Creating disposable worktree at $WORKTREE_DIR ..."
git worktree add --detach "$WORKTREE_DIR" HEAD --quiet

cd "$WORKTREE_DIR"
bash scripts/ci/all.sh --fast
