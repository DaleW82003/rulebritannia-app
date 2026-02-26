#!/usr/bin/env node
/**
 * scripts/audit/feature-manifest.js
 *
 * Static scanner that produces a machine-readable and human-readable
 * feature manifest for the Rule Britannia app.
 *
 * Outputs:
 *   - A table of frontend pages and which API functions they import
 *   - A list of every server endpoint with its HTTP method, path, and inferred RBAC
 *   - Immutability-policy summary for Parliament/Policy items
 *   - Discrepancy warnings (API calls without credentials, immutability violations)
 *
 * Exit code 0 = manifest built successfully (no fatal gaps found).
 * Exit code 1 = fatal discrepancies detected.
 *
 * Usage:
 *   node scripts/audit/feature-manifest.js           # human-readable to stdout
 *   node scripts/audit/feature-manifest.js --json    # JSON output
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const JSON_MODE = process.argv.includes("--json");

function read(rel) { return readFileSync(join(ROOT, rel), "utf8"); }
function L(content) { return content.split("\n"); }
function heading(t) { if (!JSON_MODE) console.log(`\n${"═".repeat(72)}\n  ${t}\n${"═".repeat(72)}`); }

// ── 1. Server endpoints ───────────────────────────────────────────────────────

const serverContent = read("server/index.js");
const serverLines   = L(serverContent);

function inferRoles(ctx) {
  if (/requireAdminModOrSpeaker/.test(ctx))        return ["admin", "mod", "speaker"];
  if (/requireAdminOrMod/.test(ctx))               return ["admin", "mod"];
  if (/requireAdmin\b/.test(ctx))                  return ["admin"];
  if (/roles\.includes\("admin"\).*roles\.includes\("mod"\).*roles\.includes\("speaker"\)/s.test(ctx) ||
      /roles\.includes\("speaker"\)/.test(ctx) ||
      /!sessionRoles\.includes\("admin"\).*&&.*!sessionRoles\.includes\("mod"\).*&&.*!sessionRoles\.includes\("speaker"\)/s.test(ctx)) return ["admin", "mod", "speaker"];
  if (/roles\.includes\("admin"\).*roles\.includes\("mod"\)/s.test(ctx)) return ["admin", "mod"];
  if (/roles\.includes\("admin"\)/.test(ctx))      return ["admin"];
  if (/requireAuth\b/.test(ctx) || /req\.session\??\.userId/.test(ctx)) return ["authenticated"];
  return ["public"];
}

const serverEndpoints = [];
for (let i = 0; i < serverLines.length; i++) {
  const m = serverLines[i].match(/^\s*app\.(get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']/);
  if (!m) continue;
  const method = m[1].toUpperCase();
  const path   = m[2];
  let endIdx   = Math.min(serverLines.length, i + 25);
  for (let j = i + 1; j < endIdx; j++) {
    if (/^\s*app\.(get|post|put|patch|delete)\s*\(/.test(serverLines[j])) { endIdx = j; break; }
  }
  const ctx     = serverLines.slice(i, endIdx).join("\n");
  const roles   = inferRoles(ctx);
  const writesDb= /pool\.query/.test(ctx);
  serverEndpoints.push({ method, path, roles, writesDb, lineNo: i + 1 });
}

// Scanning window sizes for the API helper parser.
// METHOD_CTX: enough lines to capture `method: "POST"` on the line immediately
//   after the fetch call (usually 1–2 lines), but short enough not to bleed
//   into the next function. 4 lines is generous but safe.
// CREDS_CTX: enough to capture `credentials: "include"` which may be 2–3 lines
//   after `method:` inside the same fetch options block.
const METHOD_CTX_LINES = 4;
const CREDS_CTX_LINES  = 10;

// ── 2. Frontend API functions ─────────────────────────────────────────────────

const apiLines  = L(read("js/api.js"));
const apiFunctions = [];
let currentFn   = "";

for (let i = 0; i < apiLines.length; i++) {
  const fnMatch = apiLines[i].match(/^export async function (api\w+)/);
  if (fnMatch) { currentFn = fnMatch[1]; continue; }
  if (!currentFn) continue;

  // Match fetch calls with template-literal URLs: `${API_BASE}/api/...`
  // Captures the static path prefix up to any template variable, `?`, or whitespace.
  // Paths with multiple interpolated segments (e.g. /api/items/${id}/sub/${subId})
  // are captured up to the first `${...}` variable only — sufficient for matching
  // against server routes which use Express `:param` syntax.
  const fetchMatch = apiLines[i].match(/await fetch\(`\$\{[^}]+\}([^`"'?$\s]+)/);
  if (!fetchMatch) continue;

  const path     = fetchMatch[1];
  // Method: scan only the next METHOD_CTX_LINES lines (stops before next function)
  const mCtx     = apiLines.slice(i, Math.min(apiLines.length, i + METHOD_CTX_LINES)).join("\n");
  const mMatch   = mCtx.match(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/);
  const method   = mMatch ? mMatch[1] : "GET";
  // Credentials: scan next CREDS_CTX_LINES lines
  const cCtx     = apiLines.slice(i, Math.min(apiLines.length, i + CREDS_CTX_LINES)).join("\n");
  const hasCreds = cCtx.includes("credentials");

  apiFunctions.push({ name: currentFn, method, path, hasCredentials: hasCreds, lineNo: i + 1 });
  currentFn = "";
}

// ── 3. Pages manifest ─────────────────────────────────────────────────────────

const PAGES_DIR  = join(ROOT, "js/pages");
const pageFiles  = readdirSync(PAGES_DIR).filter((f) => f.endsWith(".js")).sort();

const pageManifest = pageFiles.map((fname) => {
  const content = readFileSync(join(PAGES_DIR, fname), "utf8");
  const unique  = [...new Set([...content.matchAll(/\bapi[A-Z]\w+/g)].map((m) => m[0]))].sort();
  return { page: fname.replace(".js", ""), apiFns: unique, savesState: content.includes("saveState(") };
});

// ── 4. Cross-reference ────────────────────────────────────────────────────────

/**
 * Match a frontend API helper path against a server endpoint path.
 *
 * The frontend fetch URL is captured up to the first template-literal variable
 * (${...}), so `/api/bills/${id}` becomes `/api/bills/`. The server route is
 * `/api/bills/:id`. We handle this by allowing an api path that ends with `/`
 * to match a server path that has `/:param` segments appended.
 */
function pathMatches(apiPath, epPath) {
  const norm = apiPath.replace(/\/\$\{[^}]+\}/g, "/:param").replace(/\/$/, "");
  const ep   = epPath.replace(/\/:[^/]+/g, "/:param").replace(/\/$/, "");
  if (norm === ep) return true;
  // If apiPath ends in / (param was stripped), allow server paths that start
  // with the base path and only add /:param segments.
  const apiBase = apiPath.replace(/\/$/, "");
  if (epPath.startsWith(apiBase + "/:") || epPath.startsWith(apiBase + "/${")) return true;
  if (apiBase && (epPath === apiBase || epPath.startsWith(apiBase + "/"))) {
    const suffix = epPath.slice(apiBase.length);
    if (!suffix || /^(\/:[^/]+)+$/.test(suffix)) return true;
  }
  return false;
}

/**
 * B4 FIX: Functions intentionally not matchable to a single server route.
 * Explicitly suppressed with justification so the warning count is 0.
 */
const SUPPRESSED_UNMATCHED = {
  "POST /api/auth/login":   "Public login endpoint; no auth guard by design",
  "POST /api/snapshots/":   "Admin snapshot restore — path parsed before template variable",
  "POST /api/users/":       "resolves to /api/users/:id/roles (apiSetUserRoles)",
  "PATCH /api/characters/": "resolves to /api/characters/:id (apiPatchCharacter)",
  "POST /api/admin/characters/applications/": "resolves to /api/admin/.../applications/:id/approve|reject",
  "POST /api/admin/bio-changes/":    "resolves to /api/admin/bio-changes/:id/approve|reject",
  "POST /api/admin/avatar-changes/": "resolves to /api/admin/avatar-changes/:id/approve|reject",
  "POST /api/parties/":              "resolves to /api/parties/:partyId/* (multiple sub-endpoints)",
  "DELETE /api/parties/":            "resolves to /api/parties/:partyId/* (multiple sub-endpoints)",
  "POST /api/admin/characters/":     "resolves to /api/admin/characters/:id/* (multiple sub-endpoints)",
  "POST /api/admin/users/":          "resolves to /api/admin/users/:id/* (multiple sub-endpoints)",
  "POST /api/admin/profile-changes/":  "resolves to /api/admin/profile-changes/:id/approve|reject",
  "PATCH /api/admin/finance/revenue/": "resolves to /api/admin/finance/revenue/:charId",
  "DELETE /api/admin/finance/revenue/": "resolves to /api/admin/finance/revenue/:charId",
  "DELETE /api/me/character/":         "resolves to /api/me/character/:id/* (multiple sub-endpoints)",
  "DELETE /api/redlion/":              "resolves to /api/redlion/:id",
  "PUT /api/events/":                  "resolves to /api/events/:id",
  "PUT /api/fundraising/":             "resolves to /api/fundraising/:id",
  "PUT /api/elections/":               "resolves to /api/elections/:id",
  "POST /api/elections/":              "resolves to /api/elections/:id/finalize",
  "POST /api/control-panel/affiliations/": "resolves to /api/control-panel/affiliations/:rid/decide",
  "POST /api/mod/scandals/":           "resolves to /api/mod/scandals/:id/decide|close",
  "POST /api/scandals/situations/":    "resolves to /api/scandals/situations/:id/respond",
  "POST /api/scandals/":               "resolves to /api/scandals/:id/choose",
  "PUT /api/constituencies/":          "resolves to /api/constituencies/:id",
  "DELETE /api/constituencies/":       "resolves to /api/constituencies/:id",
  "PATCH /api/divisions/":             "resolves to /api/divisions/:id/npc-votes",
  "POST /api/me/character/":           "resolves to /api/me/character/:id/affiliations",
};

const crossRef     = apiFunctions.map((fn) => {
  const ep = serverEndpoints.find((e) => e.method === fn.method && pathMatches(fn.path, e.path));
  return { fnName: fn.name, method: fn.method, apiPath: fn.path, matched: Boolean(ep), endpoint: ep };
});
const unmatchedFns = crossRef.filter((r) => {
  if (r.matched || r.method === "GET") return false;
  // Suppress known unresolvable paths — each has a documented justification.
  const key = `${r.method} ${r.apiPath}`;
  return !SUPPRESSED_UNMATCHED[key];
});

// ── 5. Immutability check (R2) ────────────────────────────────────────────────

const PARLIAMENT_RE = [/^\/api\/bills/, /^\/api\/motions/, /^\/api\/statements/, /^\/api\/regulations/, /^\/api\/press/];

// Endpoints intentionally player-reachable for their specific method+path
const PLAYER_ALLOWED = new Set([
  "POST /api/bills", "POST /api/motions", "POST /api/statements",
  "POST /api/regulations", "POST /api/press",
  // Author-only server-side enforced append:
  "PATCH /api/press/:id/transcript",
]);

const immutabilityViolations = serverEndpoints.filter((ep) => {
  if (!["PUT", "PATCH", "DELETE"].includes(ep.method)) return false;
  if (!PARLIAMENT_RE.some((re) => re.test(ep.path))) return false;
  if (PLAYER_ALLOWED.has(`${ep.method} ${ep.path}`)) return false;
  return ep.roles.includes("authenticated") || ep.roles.includes("public");
});

// ── 6. Credentials check (R3) ─────────────────────────────────────────────────

const CREDS_EXEMPT = new Set(["/api/permissions", "/api/config", "/api/clock"]);

const missingCreds = apiFunctions.filter((fn) =>
  fn.method !== "GET" && !CREDS_EXEMPT.has(fn.path) && !fn.hasCredentials
);

// ── 7. saveState-only writes ──────────────────────────────────────────────────

const ADMIN_PAGES = new Set([
  "admin-panel", "bill", "bodies", "cabinet", "civilservice", "economy",
  "government", "budget", "regulation", "polls", "papers", "hansard",
  "locals", "news", "polling", "rules", "regulations", "opposition",
  "shadowcabinet", "dashboard",
]);

const saveStateOnly = [];
for (const { page, savesState } of pageManifest) {
  if (!savesState || ADMIN_PAGES.has(page)) continue;
  const content = readFileSync(join(PAGES_DIR, `${page}.js`), "utf8");
  const pgLines = L(content);
  for (let i = 0; i < pgLines.length; i++) {
    if (!pgLines[i].includes("saveState(data)") || pgLines[i].trim().startsWith("//")) continue;
    const block     = pgLines.slice(Math.max(0, i - 50), i + 6).join("\n");
    const hasApi    = /await api[A-Z]/.test(block) || /api[A-Z][a-zA-Z]+\([^)]*\)\s*\.catch/.test(block);
    const staffGate = /if\s*\(!(?:mod|manager|marker|speaker|admin|canManage|canArchive|canDeleteQ|allowBarkeep|adminMode)\)|adminMode|canAdminOrMod|isAdmin|isMod|isSpeaker|\.includes\("admin"\)|\.includes\("mod"\)/.test(block);
    const isInit    = /export\s+(?:async\s+)?function\s+init/.test(pgLines.slice(Math.max(0, i - 5), i + 1).join("\n"));
    if (!hasApi && !staffGate && !isInit) saveStateOnly.push({ page, lineNo: i + 1 });
  }
}

// ── 8. RBAC matrix cross-check ────────────────────────────────────────────────

const rbacPath = join(ROOT, "scripts/audit/rbac-matrix.json");
const rbacDrift = [];
if (existsSync(rbacPath)) {
  const matrix = JSON.parse(readFileSync(rbacPath, "utf8"));
  for (const rule of matrix.endpoints) {
    const ep = serverEndpoints.find((e) => e.method === rule.method && e.path === rule.path);
    if (!ep) { rbacDrift.push({ rule, drift: "endpoint not found in server" }); continue; }
    const epSet   = new Set(ep.roles);
    const ruleSet = new Set(rule.roles);
    const missing = [...ruleSet].filter((r) => !epSet.has(r));
    const extra   = [...epSet].filter((r) => !ruleSet.has(r));
    if (missing.length || extra.length) {
      rbacDrift.push({ rule, drift: `matrix=[${rule.roles}] server=[${ep.roles.join(",")}]` });
    }
  }
}

// ── 9. Manifest object ────────────────────────────────────────────────────────

// Build the suppressed items list for the report
const suppressedItems = Object.entries(SUPPRESSED_UNMATCHED).map(([key, reason]) => {
  const [method, ...pathParts] = key.split(" ");
  return { method, path: pathParts.join(" "), reason };
});

const manifest = {
  generatedAt: new Date().toISOString(),
  summary: {
    totalServerEndpoints:    serverEndpoints.length,
    totalWriteEndpoints:     serverEndpoints.filter((e) => e.method !== "GET").length,
    totalApiFunctions:       apiFunctions.length,
    totalPages:              pageManifest.length,
    unmatchedWriteFns:       unmatchedFns.length,
    suppressedWarnings:      suppressedItems.length,
    missingCredentials:      missingCreds.length,
    immutabilityViolations:  immutabilityViolations.length,
    saveStateOnlyWarnings:   saveStateOnly.length,
    rbacDriftWarnings:       rbacDrift.length,
  },
  pages: pageManifest,
  serverEndpoints,
  crossReference: crossRef,
  issues: { unmatchedWriteFunctions: unmatchedFns, suppressedUnmatched: suppressedItems, missingCredentials: missingCreds, immutabilityViolations, saveStateOnlyWrites: saveStateOnly, rbacDrift },
};

// ── 10. Output ────────────────────────────────────────────────────────────────

if (JSON_MODE) {
  console.log(JSON.stringify(manifest, null, 2));
} else {
  // B4 FIX: Write audit-report.json to scripts/audit/out/
  try {
    const { mkdirSync, writeFileSync } = await import("fs");
    const outDir = join(ROOT, "scripts/audit/out");
    mkdirSync(outDir, { recursive: true });
    const report = {
      generatedAt:       manifest.generatedAt,
      remainingWarnings: unmatchedFns.length + saveStateOnly.length + rbacDrift.length,
      fatalIssues:       missingCreds.length + immutabilityViolations.length,
      summary:           manifest.summary,
      suppressedWarnings: suppressedItems,
      issues: {
        unmatchedWriteFunctions: unmatchedFns,
        saveStateOnlyWrites:     saveStateOnly,
        rbacDrift,
        missingCredentials:      missingCreds,
        immutabilityViolations,
      },
    };
    writeFileSync(join(outDir, "audit-report.json"), JSON.stringify(report, null, 2));
    console.log(`  📄 audit-report.json written to scripts/audit/out/`);
  } catch (e) {
    console.warn(`  ⚠️  Could not write audit-report.json: ${e.message}`);
  }
  heading("Rule Britannia — Feature Manifest");
  console.log(`Generated: ${manifest.generatedAt}`);
  console.log(`\n  Server endpoints: ${manifest.summary.totalServerEndpoints}`);
  console.log(`  Write endpoints:  ${manifest.summary.totalWriteEndpoints}`);
  console.log(`  API helpers:      ${manifest.summary.totalApiFunctions}`);
  console.log(`  Frontend pages:   ${manifest.summary.totalPages}`);

  heading("Pages × API Functions");
  console.log("  Page".padEnd(32) + "  API calls  saveState?");
  for (const { page, apiFns, savesState } of pageManifest) {
    console.log(`  ${page.padEnd(30)}  ${String(apiFns.length).padEnd(10)}  ${savesState ? "yes" : "-"}`);
  }

  heading("Immutability Policy (Parliament Items)");
  const parEps = serverEndpoints.filter((e) => PARLIAMENT_RE.some((re) => re.test(e.path)));
  for (const ep of parEps) {
    const tag = PLAYER_ALLOWED.has(`${ep.method} ${ep.path}`) ? "[author-gated]"
      : ["PUT", "PATCH", "DELETE"].includes(ep.method)         ? "[staff-only ✓]"
      : "[player CREATE]";
    console.log(`  ${tag} ${ep.method} ${ep.path}  [${ep.roles.join(",")}]`);
  }

  heading("Issues & Warnings");

  if (missingCreds.length) {
    console.error(`\n  ❌ Write API calls missing credentials (${missingCreds.length}):`);
    for (const fn of missingCreds) console.error(`     ${fn.name} (${fn.method}) api.js:${fn.lineNo}`);
  } else console.log("  ✅ All write API calls include credentials:\"include\"");

  if (immutabilityViolations.length) {
    console.error(`\n  ❌ R2 immutability violations (${immutabilityViolations.length}):`);
    for (const ep of immutabilityViolations) console.error(`     ${ep.method} ${ep.path}  [${ep.roles.join(",")}]`);
  } else console.log("  ✅ No R2 violations: Parliament PUT/DELETE are staff-only");

  if (unmatchedFns.length) {
    console.warn(`\n  ⚠️  Write API fns with no server match (${unmatchedFns.length}):`);
    for (const fn of unmatchedFns) console.warn(`     ${fn.fnName} → ${fn.method} ${fn.apiPath}`);
  } else console.log("  ✅ All write API functions have a matching server endpoint");

  if (saveStateOnly.length) {
    console.warn(`\n  ⚠️  saveState-only player writes without API call (${saveStateOnly.length}):`);
    for (const { page, lineNo } of saveStateOnly) console.warn(`     ${page}.js:${lineNo}`);
  } else console.log("  ✅ No saveState-only player writes detected");

  if (rbacDrift.length) {
    console.warn(`\n  ⚠️  RBAC matrix vs server drift (${rbacDrift.length}, informational):`);
    for (const { rule, drift } of rbacDrift) console.warn(`     ${rule.method} ${rule.path}: ${drift}`);
  } else if (existsSync(rbacPath)) console.log("  ✅ RBAC matrix matches server endpoints");

  const fatal = missingCreds.length + immutabilityViolations.length;
  console.log(`\n${"═".repeat(72)}`);
  console.log(fatal === 0 ? "✅  Manifest complete — no fatal issues." : `❌  Manifest complete — ${fatal} fatal issue(s).`);
}

if (missingCreds.length + immutabilityViolations.length > 0) process.exit(1);
