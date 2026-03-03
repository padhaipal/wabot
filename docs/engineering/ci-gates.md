# CI Gates

All gate logic lives in `scripts/ci/all.sh`. Local hooks, npm scripts, and GitHub Actions CI all delegate to this single file.

## Running the gates locally

### Full gate (16 steps)

Runs in a disposable git worktree so your working tree stays clean:

```bash
bash scripts/ci/pre-push-worktree.sh
```

This is also what the Husky `pre-push` hook runs automatically on every `git push`.

Steps: `npm ci` &rarr; `npm audit` &rarr; deprecation baseline check &rarr; audit baseline check &rarr; Prettier &rarr; ESLint &rarr; TypeScript &rarr; build &rarr; unit tests &rarr; coverage &rarr; Gitleaks &rarr; CodeScene delta &rarr; CodeScene check &rarr; CodeQL &rarr; Stryker mutation testing.

**Required tools on PATH:** `gitleaks`, `cs`, `codeql`
**Required env:** `CS_ACCESS_TOKEN`

### Fast gate (7 steps)

A lighter subset for quicker feedback:

```bash
bash scripts/ci/fast-worktree.sh
```

Steps: `npm ci` &rarr; Prettier &rarr; ESLint &rarr; TypeScript &rarr; unit tests &rarr; Gitleaks.

**Required tools on PATH:** `gitleaks`

### npm script aliases

```bash
npm run ci:all    # bash scripts/ci/all.sh        (full gate, no worktree)
npm run ci:fast   # bash scripts/ci/all.sh --fast  (fast gate, no worktree)
```

## Freezing baselines (once per repo)

Baselines capture the current state of known deprecations and audit findings so the gate only fails when **new** items appear. Run these once after initial setup, then commit the generated files in `ci-baselines/`.

```bash
# 1. Install deps and capture the npm ci log
mkdir -p .ci-tmp
npm ci 2>&1 | tee .ci-tmp/npm-ci.log

# 2. Freeze the deprecation baseline
npm run deps:baseline:freeze:deprecations

# 3. Capture the audit JSON
npm audit --json > .ci-tmp/npm-audit-full.json || true

# 4. Freeze the audit baseline
npm run deps:baseline:freeze:audit

# 5. Commit the baselines
git add ci-baselines/
git commit -m "chore: freeze CI baselines"
```

After freezing, the gate will pass as long as no **new** deprecations or audit findings are introduced.

## Troubleshooting baseline failures

### "new npm audit findings introduced"

The audit baseline check failed because `npm audit` now reports vulnerabilities that were not in the frozen baseline.

1. **Review the new findings:**

   ```bash
   npm audit
   ```

2. **Fix if possible** &mdash; update the offending package:

   ```bash
   npm update <package>
   # or
   npm install <package>@latest
   ```

3. **Re-freeze if the finding is accepted** (e.g. no fix available, risk accepted by the team):

   ```bash
   mkdir -p .ci-tmp
   npm audit --json > .ci-tmp/npm-audit-full.json || true
   npm run deps:baseline:freeze:audit
   git add ci-baselines/audit.json
   git commit -m "chore: update audit baseline"
   ```

### "New deprecation warnings introduced"

Same pattern: a newly-installed or updated package is deprecated.

1. Check `.ci-tmp/npm-ci.log` for the exact deprecation warnings.
2. Replace the deprecated package if a maintained alternative exists.
3. If the deprecation must be accepted, re-freeze:

   ```bash
   npm run deps:baseline:freeze:deprecations
   git add ci-baselines/deprecations.json
   git commit -m "chore: update deprecation baseline"
   ```

## Self-check

After generating or modifying any CI scripts, verify both gates pass:

```bash
bash scripts/ci/fast-worktree.sh
bash scripts/ci/pre-push-worktree.sh
```

Both commands must exit 0. If either fails, fix the reported issue before pushing.
