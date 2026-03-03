#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const LOG_FILE = resolve(ROOT, '.ci-tmp/npm-ci.log');
const BASELINES_DIR = resolve(ROOT, 'ci-baselines');
const BASELINE_FILE = resolve(BASELINES_DIR, 'deprecations.json');

const DEPRECATION_RE = /^npm warn deprecated\s+(\S+):/i;

function extractDeprecations() {
  if (!existsSync(LOG_FILE)) {
    console.error(`ERROR: ${LOG_FILE} not found.`);
    console.error(
      'Run "npm ci" and capture its stderr to .ci-tmp/npm-ci.log first.',
    );
    process.exit(1);
  }
  const lines = readFileSync(LOG_FILE, 'utf8').split('\n');
  const deps = new Set();
  for (const line of lines) {
    const m = line.match(DEPRECATION_RE);
    if (m) deps.add(m[1]);
  }
  return [...deps].sort();
}

function freeze() {
  const deprecations = extractDeprecations();
  mkdirSync(BASELINES_DIR, { recursive: true });
  const payload = { deprecations };
  writeFileSync(BASELINE_FILE, JSON.stringify(payload, null, 2) + '\n');
  console.log(
    `Baseline frozen: ${deprecations.length} deprecation(s) -> ${BASELINE_FILE}`,
  );
}

function check() {
  if (!existsSync(BASELINE_FILE)) {
    console.error(`ERROR: Baseline file not found: ${BASELINE_FILE}`);
    console.error('Run "npm run deps:baseline:freeze:deprecations" first.');
    process.exit(1);
  }
  const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
  const current = extractDeprecations();
  const baselineSet = new Set(baseline.deprecations);
  const newItems = current.filter((d) => !baselineSet.has(d));

  if (newItems.length > 0) {
    console.error('New deprecation warnings introduced:');
    for (const item of newItems) console.error(`  - ${item}`);
    console.error(
      `\nBaseline: ${baseline.deprecations.length}, current: ${current.length}.`,
    );
    console.error('To accept, run: npm run deps:baseline:freeze:deprecations');
    process.exit(1);
  }
  console.log(
    `No new deprecations (baseline: ${baseline.deprecations.length}, current: ${current.length}).`,
  );
}

const mode = process.argv[2];
if (mode === 'freeze') freeze();
else if (mode === 'check') check();
else {
  console.error('Usage: node npm-ci-deprecations-baseline.mjs <freeze|check>');
  process.exit(1);
}
