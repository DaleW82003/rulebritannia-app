#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('scripts/audit/out', { recursive: true });
const manifest = JSON.parse(execSync('node scripts/audit/feature-manifest.js --json', { encoding: 'utf8' }));
const summary = manifest.summary;
const remainingWarnings = (
  summary.unmatchedWriteFns +
  summary.missingCredentials +
  summary.immutabilityViolations +
  summary.saveStateOnlyWarnings +
  summary.rbacDriftWarnings
);

const report = {
  generatedAt: new Date().toISOString(),
  remainingWarnings,
  summary,
  suppressedWarnings: [],
};

writeFileSync('scripts/audit/out/audit-report.json', JSON.stringify(report, null, 2));
console.log('wrote scripts/audit/out/audit-report.json');
