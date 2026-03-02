#!/usr/bin/env node
/**
 * render-version-assets.mjs
 *
 * Rewrites *.html files in the static publish directory so that references to
 * `styles.css` and `js/main.js` carry a `?v=<sha>` cache-busting parameter.
 *
 * Version source priority:
 *   1. RENDER_GIT_COMMIT  (set automatically by Render)
 *   2. GITHUB_SHA         (set automatically by GitHub Actions)
 *   3. Current timestamp  (fallback for local runs)
 *
 * Flags:
 *   --dry-run   Print what would change without writing any files.
 *
 * Usage (Render Build Command):
 *   node scripts/render-version-assets.mjs
 *
 * Usage (local dry-run):
 *   node scripts/render-version-assets.mjs --dry-run
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Version resolution ──────────────────────────────────────────────────────
const rawSha =
  process.env.RENDER_GIT_COMMIT ||
  process.env.GITHUB_SHA ||
  null;

const version = rawSha
  ? rawSha.slice(0, 8)
  : `ts${Date.now()}`;

// ── Config ──────────────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes('--dry-run');

/** Root of the static site (one level up from scripts/) */
const ROOT = resolve(__dirname, '..');

/**
 * Directories to skip entirely when collecting HTML files.
 * These either contain server-side code or are not part of the static site.
 */
const SKIP_DIRS = new Set(['server', 'node_modules', '.git', 'scripts']);

// ── Asset URL patterns ──────────────────────────────────────────────────────
// Matches href/src attribute values that point to styles.css or js/main.js,
// with optional leading ./ or /, and an optional existing ?v=… to replace.
// Prefix group matches ./, /, or empty — but NOT ../ (parent-directory refs).
const ASSET_RE = /((?:href|src)=["'])((?:\.\/|\/)?)(styles\.css|js\/main\.js)(?:\?v=[^"'#]*)?/g;

/**
 * Rewrite asset references in an HTML string.
 * @param {string} html  Original HTML content.
 * @returns {string}     Rewritten HTML content.
 */
function rewriteHtml(html) {
  return html.replace(ASSET_RE, (_, attrPrefix, pathPrefix, asset) => {
    return `${attrPrefix}${pathPrefix}${asset}?v=${version}`;
  });
}

/**
 * Recursively collect *.html files under `dir`, skipping SKIP_DIRS.
 * @param {string} dir
 * @returns {string[]}  Absolute paths.
 */
function collectHtmlFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...collectHtmlFiles(full));
    } else if (entry.endsWith('.html')) {
      results.push(full);
    }
  }
  return results;
}

// ── Main ────────────────────────────────────────────────────────────────────
const htmlFiles = collectHtmlFiles(ROOT);

if (htmlFiles.length === 0) {
  console.error('No HTML files found under', ROOT);
  process.exit(1);
}

console.log(`Cache-busting version: ${version}${DRY_RUN ? ' (dry-run)' : ''}`);

let modifiedCount = 0;

for (const file of htmlFiles) {
  const original = readFileSync(file, 'utf8');
  const rewritten = rewriteHtml(original);

  if (rewritten === original) continue;

  modifiedCount++;
  const rel = file.slice(ROOT.length + 1);
  console.log(`  updated: ${rel}`);

  if (!DRY_RUN) {
    writeFileSync(file, rewritten, 'utf8');
  }
}

console.log(
  `\nDone. ${modifiedCount} file(s) ${DRY_RUN ? 'would be' : 'were'} updated.`
);
