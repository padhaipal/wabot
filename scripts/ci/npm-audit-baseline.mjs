#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const AUDIT_FILE = resolve(ROOT, '.ci-tmp/npm-audit-full.json');
const BASELINES_DIR = resolve(ROOT, 'ci-baselines');
const BASELINE_FILE = resolve(BASELINES_DIR, 'audit.json');

function extractFindings() {
  if (!existsSync(AUDIT_FILE)) {
    console.error(`ERROR: ${AUDIT_FILE} not found.`);
    console.error(
      'Run "npm audit --json > .ci-tmp/npm-audit-full.json" first.',
    );
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(AUDIT_FILE, 'utf8'));
  const vulns = raw.vulnerabilities || {};
  const findings = Object.entries(vulns)
    .map(([name, v]) => ({
      name,
      severity: v.severity,
      isDirect: v.isDirect,
      range: v.range,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return findings;
}

function fingerprint(f) {
  return `${f.name}|${f.severity}|${f.range}`;
}

function freeze() {
  const findings = extractFindings();
  mkdirSync(BASELINES_DIR, { recursive: true });
  const payload = { findings };
  writeFileSync(BASELINE_FILE, JSON.stringify(payload, null, 2) + '\n');
  console.log(
    `Baseline frozen: ${findings.length} finding(s) -> ${BASELINE_FILE}`,
  );
}

function check() {
  if (!existsSync(BASELINE_FILE)) {
    console.error(`ERROR: Baseline file not found: ${BASELINE_FILE}`);
    console.error('Run "npm run deps:baseline:freeze:audit" first.');
    process.exit(1);
  }
  const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
  const current = extractFindings();
  const baselineFP = new Set(baseline.findings.map(fingerprint));
  const newItems = current.filter((f) => !baselineFP.has(fingerprint(f)));

  if (newItems.length > 0) {
    console.error('new npm audit findings introduced:');
    for (const item of newItems) {
      console.error(`  - ${item.name} (${item.severity}) range: ${item.range}`);
    }
    console.error(
      `\nBaseline: ${baseline.findings.length}, current: ${current.length}.`,
    );
    console.error('To accept, run: npm run deps:baseline:freeze:audit');
    process.exit(1);
  }
  console.log(
    `No new audit findings (baseline: ${baseline.findings.length}, current: ${current.length}).`,
  );
}

const mode = process.argv[2];
if (mode === 'freeze') freeze();
else if (mode === 'check') check();
else {
  console.error('Usage: node npm-audit-baseline.mjs <freeze|check>');
  process.exit(1);
}
