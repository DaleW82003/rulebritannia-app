#!/usr/bin/env node
/**
 * scripts/static-checks.js
 *
 * Static analysis for the Rule Britannia codebase.  Runs without a live DB or
 * any environment secrets — can be used as a CI gate.
 *
 * Checks:
 *  1. All fetch() calls in js/api.js use credentials:"include" on non-public GETs
 *  2. Every POST/PUT/PATCH/DELETE fetch call uses credentials:"include"
 *  3. Every server write endpoint (POST/PUT/PATCH/DELETE) has an auth check
 *  4. Motion/EDM update (PUT) and delete endpoints are staff-only
 *  5. No player-only pages have saveState() without a nearby API write call
 *  6. All server error responses use { error: <string> } shape
 *
 *  7. No fire-and-forget mutating API calls in any js/ file (repo-wide)
 *  8. No double-release of pg-pool clients in server/index.js
 * Exit code 1 = at least one check failed.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

let failures = 0;
function fail(msg) {
  console.error(`  ❌ ${msg}`);
  failures++;
}
function pass(msg) {
  console.log(`  ✅ ${msg}`);
}
function section(title) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 70 - title.length))}`);
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. credentials:"include" on all mutating fetch calls in js/api.js
// ──────────────────────────────────────────────────────────────────────────────

section("1. All POST/PUT/PATCH/DELETE fetch calls use credentials:\"include\"");

const apiContent = read("js/api.js");
const apiLines   = apiContent.split("\n");

let mutatingMissingCreds = 0;
for (let i = 0; i < apiLines.length; i++) {
  const line = apiLines[i];
  if (!line.includes('method:') || line.trim().startsWith("//")) continue;
  if (!/method:\s*["'](POST|PUT|PATCH|DELETE)["']/.test(line)) continue;
  // Scan same context window (11 lines) as the GET check
  const ctx = apiLines.slice(Math.max(0, i - 3), Math.min(apiLines.length, i + 8)).join("\n");
  if (!ctx.includes("credentials")) {
    fail(`js/api.js line ${i + 1}: write call missing credentials (context: ${line.trim().slice(0, 60)})`);
    mutatingMissingCreds++;
  }
}
if (!mutatingMissingCreds) pass("All mutating fetch calls include credentials:\"include\"");

// ──────────────────────────────────────────────────────────────────────────────
// 2. All non-public GET fetch calls include credentials:"include"
// ──────────────────────────────────────────────────────────────────────────────

section("2. Non-public GET fetch calls include credentials:\"include\"");

// These endpoint path prefixes are intentionally public — no auth required.
const PUBLIC_PATH_PREFIXES = [
  "/api/permissions",
  "/api/config",
  "/api/clock",
  "/health",
];

let missingGetCreds = 0;
for (let i = 0; i < apiLines.length; i++) {
  const line = apiLines[i];
  if (!line.includes("await fetch(") || line.trim().startsWith("//")) continue;
  // Use same 11-line window as the mutating check above
  const ctx = apiLines.slice(i, Math.min(apiLines.length, i + 8)).join("\n");
  if (ctx.includes("credentials")) continue;
  // Extract the path — handle template literals (`${BASE}/api/...`), plain strings, and bare paths
  const pathMatch =
    line.match(/fetch\([`'"]?\$\{[^}]+\}(\/api\/[^`"'?\s$]+)/) ||
    line.match(/fetch\([`'"](\/api\/[^`"'?\s]+)/);
  const path = pathMatch?.[1];
  if (path && PUBLIC_PATH_PREFIXES.some((p) => path.startsWith(p))) continue;
  // If the path resolves to an exact public probe path (e.g. /health), skip.
  if (!path) {
    // Check for the exact liveness probe path: ends with `/health` with no trailing chars.
    const probeMatch = line.match(/fetch\([`'"]?\$\{[^}]+\}(\/health)[`"')\s]/);
    if (probeMatch) continue;
    // Path could not be resolved statically — skip; cannot determine auth requirement.
    continue;
  }
  fail(`js/api.js line ${i + 1}: GET missing credentials (${line.trim().slice(0, 70)})`);
  missingGetCreds++;
}
if (!missingGetCreds) pass("All non-public GET calls include credentials:\"include\"");

// ──────────────────────────────────────────────────────────────────────────────
// 3. Server write endpoints all enforce auth
// ──────────────────────────────────────────────────────────────────────────────

section("3. Server write endpoints enforce authentication");

const serverContent = read("server/index.js");
const serverLines   = serverContent.split("\n");

// Public write paths that legitimately have no auth
const SERVER_PUBLIC_WRITE = new Set([
  "/api/register",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/resend-verification",
  "/api/reset-password",
  "/api/verify-email",
  "/api/auth/verify-email",
  "/api/register/verify",
  "/api/register/resend",
]);

const AUTH_INDICATORS = [
  "requireAuth", "requireAdmin", "requireAdminOrMod",
  "requireAdminModOrSpeaker", "session?.userId", "req.session.userId",
  "session.userId", "handleSeedDemo",
];

let unauthWriteEndpoints = 0;
for (let i = 0; i < serverLines.length; i++) {
  const line = serverLines[i];
  const m = line.match(/^\s*app\.(post|put|delete|patch)\s*\(\s*["'`]([^"'`]+)["'`]/);
  if (!m) continue;
  const method = m[1].toUpperCase();
  const path   = m[2];
  if (SERVER_PUBLIC_WRITE.has(path)) continue;

  const ctx = serverLines.slice(i, Math.min(serverLines.length, i + 20)).join("\n");
  const hasAuth = AUTH_INDICATORS.some((s) => ctx.includes(s));
  if (!hasAuth) {
    fail(`server/index.js line ${i + 1}: ${method} ${path} — no auth check found`);
    unauthWriteEndpoints++;
  }
}
if (!unauthWriteEndpoints) pass("All server write endpoints enforce authentication");

// ──────────────────────────────────────────────────────────────────────────────
// 4. Motion/EDM/bill update & delete endpoints are STAFF-ONLY
// ──────────────────────────────────────────────────────────────────────────────

section("4. Motion/EDM/bill mutating endpoints are staff-only");

const STAFF_CHECKS = ["requireAdminOrMod", "requireAdminModOrSpeaker", "requireAdmin"];
const PLAYER_IMMUTABLE_PATHS = [/\/api\/motions\//, /\/api\/bills\//];
// Paths that are intentionally player-accessible despite matching the above patterns.
// These are narrow, validated action endpoints — not free-form edit/delete endpoints.
const PLAYER_IMMUTABLE_ALLOWLIST = [
  /\/api\/motions\/[^/]+\/sign/,    // POST /api/motions/:id/sign — player EDM signing
  /\/api\/bills\/[^/]+\/vote/,      // PATCH /api/bills/:id/vote — player bill division vote (B3: server-authoritative weight)
  /\/api\/bills\/[^/]+\/withdraw/,  // POST /api/bills/:id/withdraw — bill author withdrawal
  /\/api\/bills\/[^/]+\/amendments$/, // POST /api/bills/:id/amendments — MP amendment submission
  /\/api\/bills\/[^/]+\/amendments\/[^/]+\/decide/, // POST /api/bills/:id/amendments/:id/decide — author decides
  /\/api\/bills\/[^/]+\/amendments\/[^/]+\/support/, // POST /api/bills/:id/amendments/:id/support — leader support
];

let playerCanMutate = 0;
for (let i = 0; i < serverLines.length; i++) {
  const line = serverLines[i];
  const m = line.match(/^\s*app\.(put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/);
  if (!m) continue;
  const method = m[1].toUpperCase();
  const path   = m[2];

  if (!PLAYER_IMMUTABLE_PATHS.some((re) => re.test(path))) continue;
  if (PLAYER_IMMUTABLE_ALLOWLIST.some((re) => re.test(path))) continue;

  const ctx = serverLines.slice(i, Math.min(serverLines.length, i + 12)).join("\n");
  const isStaff = STAFF_CHECKS.some((s) => ctx.includes(s));
  if (!isStaff) {
    fail(`server/index.js line ${i + 1}: ${method} ${path} — not restricted to staff-only`);
    playerCanMutate++;
  }
}
if (!playerCanMutate) pass("Motion/EDM/bill update+delete endpoints are all staff-only");

// ──────────────────────────────────────────────────────────────────────────────
// 5. Player-facing pages do not rely on saveState() alone for critical writes
// ──────────────────────────────────────────────────────────────────────────────

section("5. Player-facing pages use API calls for critical writes");

// Pages where saveState is the ONLY allowed mechanism (admin-only game state).
// These pages handle admin/mod/speaker-only gameplay operations that correctly
// rely on the shared state snapshot API (POST /api/state).
const ADMIN_ONLY_PAGES = new Set([
  "admin-panel.js", "bill.js", "bodies.js", "cabinet.js",
  "civilservice.js", "economy.js", "guides.js", "government.js",
  "budget.js", "regulation.js", "polls.js", "papers.js",
  "hansard.js", "locals.js", "news.js", "polling.js", "rules.js",
  "regulations.js", "opposition.js", "shadowcabinet.js",
  // dashboard: liveDocket seenActivityTs is acceptable UI-state (not game-critical data)
  "dashboard.js",
]);

const PAGES_DIR = join(ROOT, "js/pages");
const pageFiles = readdirSync(PAGES_DIR).filter((f) => f.endsWith(".js"));

let saveStateOnlyIssues = 0;
for (const pageFile of pageFiles) {
  if (ADMIN_ONLY_PAGES.has(pageFile)) continue;
  const content = readFileSync(join(PAGES_DIR, pageFile), "utf8");
  const lines = content.split("\n");

  // Split the file into logical "blocks" (event listeners / functions)
  // by tracking brace depth when we see addEventListener
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes("saveState(data)") || line.trim().startsWith("//")) continue;

    // Collect the surrounding "block" — walk back until we find the function/listener open
    // and forward until we exit it (max 60 lines total window)
    const blockStart = Math.max(0, i - 50);
    const blockEnd   = Math.min(lines.length, i + 10);
    const block      = lines.slice(blockStart, blockEnd).join("\n");

    // Skip pure init/normalise patterns: saveState at the very start of an async init function
    const isInitCall = /export\s+async\s+function\s+init/.test(
      lines.slice(Math.max(0, i - 5), i + 1).join("\n")
    );
    if (isInitCall) continue;

    // 1. Has any API call anywhere in the block?
    const hasApi = /await api[A-Z]/.test(block) ||
                   /apiSave|apiCreate|apiUpdate|apiAdd|apiRemove|apiSet|apiPatch|apiDelete|apiSubmit/.test(block);

    // 2. Is the whole block staff-gated (mod, manager, admin, marker, speaker checks)?
    const staffGated = /if\s*\(!(?:mod|manager|marker|speaker|admin|canManage|canArchive|canDeleteQ)\)/.test(block) ||
                       /canAdminOrMod|requireAdminOrMod|isAdmin|isMod|isSpeaker/.test(block) ||
                       /\.includes\("admin"\)|\.includes\("mod"\)|\.includes\("speaker"\)/.test(block) ||
                       /allowBarkeep|barkeep/.test(block);

    if (!hasApi && !staffGated) {
      fail(`${pageFile}:${i + 1} — saveState() with no API call and no staff gate in surrounding block`);
      saveStateOnlyIssues++;
    }
  }
}
if (!saveStateOnlyIssues) pass("No player-facing saveState-only writes detected");

// ──────────────────────────────────────────────────────────────────────────────
// 6. Consistent error response shapes in server endpoints
// ──────────────────────────────────────────────────────────────────────────────

section("6. Server error responses use { error: <string> } shape");

// Scan for res.status(4xx/5xx).json() that don't use error key
const BAD_SHAPE = /res\.status\((?:4\d\d|5\d\d)\)\.json\(\s*\{(?![^}]*error:)/g;
const badShapeMatches = [...serverContent.matchAll(BAD_SHAPE)];

// Allow a small number of known legacy patterns
const MAX_SHAPE_ISSUES = 5;
if (badShapeMatches.length > MAX_SHAPE_ISSUES) {
  fail(`server/index.js: ${badShapeMatches.length} error responses missing "error" key (allowed: ${MAX_SHAPE_ISSUES})`);
} else {
  pass(`Error response shapes look consistent (${badShapeMatches.length} minor variances ≤${MAX_SHAPE_ISSUES})`);
}

// ──────────────────────────────────────────────────────────────────────────────
// 7. No fire-and-forget API calls anywhere in js/ tree (pessimistic policy)
// ──────────────────────────────────────────────────────────────────────────────

section("7. No fire-and-forget API calls across all js/ files");

/**
 * Walks a directory tree and returns all .js file paths.
 * Skips js/vendor/** if it exists.
 */
function walkJsFiles(dir, results = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "vendor") continue; // skip js/vendor/**
      walkJsFiles(full, results);
    } else if (entry.endsWith(".js")) {
      results.push(full);
    }
  }
  return results;
}

const JS_DIR = join(ROOT, "js");
const allJsFiles = walkJsFiles(JS_DIR);

/**
 * Detects fire-and-forget mutating API calls across all js/**\/*.js files.
 *
 * Flagged patterns (without `await` and without `// UI_ONLY_OK:` on the line):
 *  A. Same-line: apiWriteX(...).catch(   or   apiWriteX(...).then(
 *  B. Chained continuation: a line that is a `.then(` or `.catch(` continuation
 *     whose preceding context (≤20 lines) contains an un-awaited write API call.
 *
 * Write API prefix: apiCreate*, apiUpdate*, apiDelete*, apiSave*, apiPatch*,
 *                   apiMark*, apiClose*, apiCredit*, apiSubmit*, apiSet*,
 *                   apiAdd*, apiRemove*, apiApprove*, apiReject*, apiGrant*,
 *                   apiRevoke*, apiDismiss*, apiSell*, apiVote*, apiSign*.
 *
 * Exception: Lines annotated with `// UI_ONLY_OK: <reason>` are permitted.
 * This replaces the old allowlist mechanism — all exceptions must be explicitly
 * documented inline in the source file.
 */

// Regex to detect write-API function names
const WRITE_API_NAME_RE = /api(?:Create|Update|Delete|Save|Patch|Mark|Close|Credit|Submit|Set|Add|Remove|Approve|Reject|Grant|Revoke|Dismiss|Sell|Vote|Sign)[A-Z]/;

// Same-line fire-and-forget: apiWriteX(...).catch( or apiWriteX(...).then(
// (without `await` immediately before the api call)
const FF_SAME_LINE_RE = /(?<!\bawait\b\s+)api[A-Z]\w*\s*\([^)]*\)\s*\.(?:catch|then)\s*\(/;

// Continuation line: starts with optional whitespace, optional closing braces/parens, then .then( or .catch(
const FF_CONTINUATION_RE = /^\s*(?:\}\s*)?\)?\s*\.\s*(?:then|catch)\s*\(/;

// Context that indicates a safe init/data-load pattern (not a UI handler)
const INIT_CONTEXT_RE = /\basync\s+function\s+init[A-Z]|\bPromise\.all\b/;

let fireAndForgetIssues = 0;

for (const filePath of allJsFiles) {
  const relPath = filePath.replace(join(ROOT, "/"), "");
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip blank lines and pure comments
    if (!line.trim() || line.trim().startsWith("//")) continue;
    // Exception: line has explicit UI_ONLY_OK marker
    if (line.includes("// UI_ONLY_OK:")) continue;

    // ── Pattern A: same-line fire-and-forget ──────────────────────────────
    if (FF_SAME_LINE_RE.test(line) && WRITE_API_NAME_RE.test(line)) {
      // Skip read-only / init / parallel-fetch contexts
      const ctxStart = Math.max(0, i - 8);
      const ctx = lines.slice(ctxStart, i + 1).join("\n");
      if (!INIT_CONTEXT_RE.test(ctx)) {
        fail(`${relPath}:${i + 1} — fire-and-forget write API (same-line): ${line.trim().slice(0, 80)}`);
        fireAndForgetIssues++;
        continue;
      }
    }

    // ── Pattern B: chained continuation (.then / .catch on its own line) ──
    if (FF_CONTINUATION_RE.test(line)) {
      // Determine if this .then()/.catch() chains on a write API call
      // by scanning backwards up to 20 lines for un-awaited write API opening
      let found = false;
      for (let j = i - 1; j >= Math.max(0, i - 20) && !found; j--) {
        const prevLine = lines[j];
        if (WRITE_API_NAME_RE.test(prevLine)) {
          // Confirm it's not awaited
          if (!/\bawait\b/.test(prevLine)) {
            found = true;
          }
          break; // either way, stop scanning at the first write API line found
        }
      }
      if (found) {
        // Skip if it's inside an init/parallel-fetch context
        const ctxStart = Math.max(0, i - 8);
        const ctx = lines.slice(ctxStart, i + 1).join("\n");
        if (INIT_CONTEXT_RE.test(ctx)) continue;
        // Also skip if the continuation line itself has UI_ONLY_OK
        // (already checked above) — reached here so it doesn't, flag it
        fail(`${relPath}:${i + 1} — fire-and-forget write API (chained .then/.catch): ${line.trim().slice(0, 80)}`);
        fireAndForgetIssues++;
      }
    }
  }
}
if (!fireAndForgetIssues) pass("No fire-and-forget mutating API calls detected in js/**/*.js");

// ──────────────────────────────────────────────────────────────────────────────
// 8. No double-release of pg-pool clients in server/index.js
//
// Each `const client = await pool.connect()` block must release in exactly one
// place.  The only valid release site is `finally { client.release(); }`.
// Any `client.release()` that appears OUTSIDE a `} finally {` block in the
// same handler is a double-release bug that crashes the process.
// ──────────────────────────────────────────────────────────────────────────────

section("8. No double-release of pg-pool clients in server/index.js");

let doubleReleaseIssues = 0;

for (let i = 0; i < serverLines.length; i++) {
  if (!serverLines[i].includes("client.release()")) continue;

  // Determine if this release is inside a `} finally {` block by scanning
  // up to 5 non-blank, non-comment lines above it.
  let inFinally = false;
  let scanned = 0;
  for (let j = i - 1; j >= 0 && scanned < 5; j--) {
    const trimmed = serverLines[j].trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    scanned++;
    // Match the actual code construct, not a comment containing the word "finally"
    if (/^\}\s*finally\s*\{/.test(trimmed) || /^finally\s*\{/.test(trimmed)) {
      inFinally = true;
      break;
    }
    // If we hit a non-finally structural keyword, stop scanning
    if (/^\}/.test(trimmed) || /^\s*(try|catch|if|for|while|return|const|let|var|await)\b/.test(trimmed)) break;
  }

  if (!inFinally) {
    fail(
      `server/index.js line ${i + 1}: client.release() outside a finally block — ` +
      `potential double-release (use try/catch/finally and release only in finally)`
    );
    doubleReleaseIssues++;
  }
}
if (!doubleReleaseIssues) pass("All pg-pool client.release() calls are inside finally blocks");

// ──────────────────────────────────────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────────────────────────────────────

console.log(`\n${"═".repeat(72)}`);
if (failures === 0) {
  console.log("✅  All static checks passed.");
} else {
  console.error(`❌  ${failures} check(s) failed.`);
  process.exit(1);
}
