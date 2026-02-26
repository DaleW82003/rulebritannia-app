#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('scripts/audit/out', { recursive: true });
const manifest = JSON.parse(execSync('node scripts/audit/feature-manifest.js --json', { encoding: 'utf8' }));
const suppressed = [
  {
    key: 'apiLogin/apiMe/apiLogout path detection',
    reason: 'Auth helper functions include mixed fetch sequences where static parser can bind wrong URL for function boundary; operationally covered by endpoint existence + auth tests.'
  }
];
const remainingWarnings = (
  manifest.summary.unmatchedWriteFns +
  manifest.summary.missingCredentials +
  manifest.summary.immutabilityViolations +
  manifest.summary.saveStateOnlyWarnings +
  manifest.summary.rbacDriftWarnings
);
const report = {
  generatedAt: new Date().toISOString(),
  remainingWarnings,
  summary: manifest.summary,
  suppressedWarnings: suppressed,
};
writeFileSync('scripts/audit/out/audit-report.json', JSON.stringify(report, null, 2));
console.log('wrote scripts/audit/out/audit-report.json');
