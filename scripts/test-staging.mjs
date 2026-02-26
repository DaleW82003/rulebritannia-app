#!/usr/bin/env node
/**
 * scripts/test-staging.mjs
 *
 * B1 FIX: Executable staging test runner for the Rule Britannia audit.
 *
 * Usage:
 *   BASE_URL=https://rulebritannia-app-backend.onrender.com \
 *   TEST_EMAIL=admin@example.com \
 *   TEST_PASSWORD=secret \
 *   node scripts/test-staging.mjs
 *
 * The runner:
 *  1. Logs in via POST /api/auth/login to obtain a session cookie.
 *  2. Fetches a CSRF token via GET /api/csrf-token.
 *  3. Runs four test suites and prints PASS / FAIL per suite.
 *
 * Required env vars:
 *   BASE_URL       Live server URL (no trailing slash)
 *   TEST_EMAIL     Admin account e-mail
 *   TEST_PASSWORD  Admin account password
 *
 * Optional:
 *   TEST_PLAYER_EMAIL     Player (non-staff) account e-mail (for RBAC tests)
 *   TEST_PLAYER_PASSWORD  Player account password
 */

const BASE_URL   = process.env.BASE_URL;
const ADMIN_EMAIL    = process.env.TEST_EMAIL;
const ADMIN_PASSWORD = process.env.TEST_PASSWORD;
const PLAYER_EMAIL    = process.env.TEST_PLAYER_EMAIL;
const PLAYER_PASSWORD = process.env.TEST_PLAYER_PASSWORD;

if (!BASE_URL || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error(
    "\n❌  FATAL: BASE_URL, TEST_EMAIL and TEST_PASSWORD must all be set.\n" +
    "    Example:\n" +
    "      BASE_URL=https://rulebritannia-app-backend.onrender.com \\\n" +
    "      TEST_EMAIL=admin@example.com \\\n" +
    "      TEST_PASSWORD=secret \\\n" +
    "      node scripts/test-staging.mjs\n"
  );
  process.exit(1);
}

// ── Session cookie store ───────────────────────────────────────────────────────

/** Map<label, cookieHeader> */
const sessions = {};
const csrfTokens = {};

async function login(label, email, password) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ email, password }),
    redirect: "manual",
  });
  const cookies = res.headers.getSetCookie?.() || [];
  // Fallback for older Node versions
  const rawCookie = cookies.length
    ? cookies.join("; ")
    : (res.headers.get("set-cookie") || "");
  const cookieHeader = rawCookie.split(/,\s*(?=[a-zA-Z_-]+=)/).map((c) => c.split(";")[0]).join("; ");
  if (!cookieHeader) throw new Error(`Login failed for ${label} (${res.status})`);
  sessions[label] = cookieHeader;

  // Fetch CSRF token using this session
  const csrfRes = await fetch(`${BASE_URL}/api/csrf-token`, {
    headers: { Cookie: cookieHeader },
  });
  const csrfData = await csrfRes.json().catch(() => ({}));
  csrfTokens[label] = csrfData.csrfToken || csrfData.token || "";
  return cookieHeader;
}

function cookieFor(label) { return sessions[label] || ""; }
function csrfFor(label)   { return csrfTokens[label] || ""; }

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function apiPost(path, body, label) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": csrfFor(label),
      Cookie:          cookieFor(label),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function apiGet(path, label) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Cookie: cookieFor(label) },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function apiPut(path, body, label) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method:  "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": csrfFor(label),
      Cookie:          cookieFor(label),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function apiDelete(path, label) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method:  "DELETE",
    headers: { "x-csrf-token": csrfFor(label), Cookie: cookieFor(label) },
  });
  return { status: res.status };
}

// ── Test runner ───────────────────────────────────────────────────────────────

let totalPass = 0;
let totalFail = 0;
const failReasons = [];

function assert(condition, description, reason = "") {
  if (condition) {
    console.log(`      ✅ ${description}`);
    totalPass++;
  } else {
    console.error(`      ❌ ${description}${reason ? ` — ${reason}` : ""}`);
    totalFail++;
    failReasons.push(`${description}${reason ? ": " + reason : ""}`);
  }
}

async function suite(name, fn) {
  console.log(`\n  📋 ${name}`);
  const t0 = Date.now();
  try {
    await fn();
  } catch (err) {
    console.error(`      ❌ Suite error: ${err.message}`);
    totalFail++;
    failReasons.push(`${name}: ${err.message}`);
  }
  console.log(`     (${Date.now() - t0}ms)`);
}

// ── Suite 1: Persistence ──────────────────────────────────────────────────────

async function testPersistence() {
  const ts = Date.now();

  // Press release: create → read back
  const pressId = `staging-press-${ts}`;
  const pressSubject = `Staging test press ${ts}`;
  {
    const { status } = await apiPost("/api/press", {
      press_type: "release",
      id: pressId,
      reference: "STAGING-TEST-1",
      subject: pressSubject,
      body: "Automated staging test press release.",
      author: "Staging Bot",
      createdAtSim: "August 1997",
      score: null,
      impact: [],
    }, "admin");
    assert([200, 201].includes(status), "POST /api/press → 200/201", `got ${status}`);
  }
  {
    const { status, body } = await apiGet("/api/press", "admin");
    assert(status === 200, "GET /api/press → 200", `got ${status}`);
    const items = body.items || [];
    const found = items.find((p) => p.id === pressId || p.subject === pressSubject);
    assert(!!found, "Press release persists after GET reload", `id=${pressId} not found`);
  }

  // Bill: create → read back by ID
  const billId = `staging-bill-${ts}`;
  const billTitle = `Staging Test Bill ${ts}`;
  {
    const { status } = await apiPost("/api/bills", {
      id:      billId,
      title:   billTitle,
      body:    "This is a staging test bill.",
      author:  "Staging Bot",
      party:   "Labour",
      status:  "draft",
    }, "admin");
    assert([200, 201].includes(status), "POST /api/bills → 200/201", `got ${status}`);
  }
  {
    const { status, body } = await apiGet(`/api/bills/${billId}`, "admin");
    assert([200].includes(status), "GET /api/bills/:id → 200", `got ${status}`);
    const bill = body.bill || body;
    assert(bill?.title === billTitle || bill?.id === billId, "Bill persists after reload", `expected id=${billId}`);
  }

  // Motion: create → read back
  const motionId = `staging-motion-${ts}`;
  {
    const { status } = await apiPost("/api/motions", {
      id:    motionId,
      title: `Staging Test Motion ${ts}`,
      body:  "This is a staging test motion.",
      author: "Staging Bot",
      motion_type: "house",
    }, "admin");
    assert([200, 201].includes(status), "POST /api/motions → 200/201", `got ${status}`);
  }
  {
    const { status } = await apiGet(`/api/motions/${motionId}`, "admin");
    assert(status === 200, "GET /api/motions/:id → 200 (motion persists)", `got ${status}`);
  }

  // Clean up (best-effort)
  await apiDelete(`/api/bills/${billId}`, "admin").catch(() => {});
  await apiDelete(`/api/motions/${motionId}`, "admin").catch(() => {});
  await apiDelete(`/api/press/${pressId}`, "admin").catch(() => {});
}

// ── Suite 2: RBAC ─────────────────────────────────────────────────────────────

async function testRbac() {
  // Unauthenticated requests to authenticated endpoints → 401/403/404
  for (const path of ["/api/bills", "/api/motions", "/api/state", "/api/divisions"]) {
    const res = await fetch(`${BASE_URL}${path}`);
    assert(
      [401, 403].includes(res.status),
      `Anonymous GET ${path} → 401/403`,
      `got ${res.status}`
    );
  }

  // Anonymous POST to parliament item → 401/403
  {
    const res = await fetch(`${BASE_URL}/api/bills`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "anon-test", title: "Anon", body: "X" }),
    });
    assert([401, 403].includes(res.status), "Anonymous POST /api/bills → 401/403", `got ${res.status}`);
  }

  // Player cannot PUT parliament items (if player session available)
  if (sessions.player) {
    const testMotionId = `rbac-test-motion-${Date.now()}`;
    await apiPost("/api/motions", { id: testMotionId, title: "RBAC Test", body: "Test", motion_type: "house" }, "admin");
    const { status } = await apiPut(`/api/motions/${testMotionId}`, { title: "HACKED" }, "player");
    assert([401, 403].includes(status), "Player PUT /api/motions/:id → 401/403", `got ${status}`);
    await apiDelete(`/api/motions/${testMotionId}`, "admin").catch(() => {});
  } else {
    console.log("      ⚠️  COOKIE_PLAYER not set — skipping player RBAC sub-tests");
  }

  // Non-staff cannot POST to divisions/create
  if (sessions.player) {
    const { status } = await apiPost("/api/divisions/create", {
      entity_type: "motion", entity_id: "test", title: "RBAC Test"
    }, "player");
    assert([401, 403].includes(status), "Player POST /api/divisions/create → 401/403", `got ${status}`);
  }
}

// ── Suite 3: Immutability ─────────────────────────────────────────────────────

async function testImmutability() {
  const ts = Date.now();

  // Create parliament items as admin, then attempt to modify as player
  const motionId = `immut-motion-${ts}`;
  await apiPost("/api/motions", { id: motionId, title: `Immut Test ${ts}`, body: "test", motion_type: "house" }, "admin");

  if (sessions.player) {
    const { status: putStatus } = await apiPut(`/api/motions/${motionId}`, { title: "HACKED" }, "player");
    assert([401, 403].includes(putStatus), "Player cannot PUT motion after submit", `got ${putStatus}`);

    const { status: delStatus } = await apiDelete(`/api/motions/${motionId}`, "player");
    assert([401, 403].includes(delStatus), "Player cannot DELETE motion after submit", `got ${delStatus}`);
  } else {
    console.log("      ⚠️  No player session — skipping player immutability sub-tests");
  }

  // Staff CAN update
  const { status: modPutStatus } = await apiPut(`/api/motions/${motionId}`, {
    id: motionId, title: "Staff Edit OK", body: "test", motion_type: "house"
  }, "admin");
  assert([200, 201].includes(modPutStatus), "Admin can PUT motion (staff override)", `got ${modPutStatus}`);

  // Staff CAN delete
  const { status: modDelStatus } = await apiDelete(`/api/motions/${motionId}`, "admin");
  assert([200, 404].includes(modDelStatus), "Admin can DELETE motion (staff override)", `got ${modDelStatus}`);

  // Press items are immutable by players
  const pressId = `immut-press-${ts}`;
  await apiPost("/api/press", {
    press_type: "release", id: pressId, reference: "IMMUT-1",
    subject: `Immut Test ${ts}`, body: "test", author: "Staging Bot",
    createdAtSim: "August 1997", score: null, impact: [],
  }, "admin");
  if (sessions.player) {
    const { status } = await apiPut(`/api/press/${pressId}`, { subject: "HACKED" }, "player");
    assert([401, 403].includes(status), "Player cannot PUT press item", `got ${status}`);
  }
  await apiDelete(`/api/press/${pressId}`, "admin").catch(() => {});
}

// ── Suite 4: Division authority ────────────────────────────────────────────────

async function testDivisionAuthority() {
  const ts = Date.now();

  // Create a motion for division testing
  const motionId = `div-test-motion-${ts}`;
  await apiPost("/api/motions", { id: motionId, title: `Division Test ${ts}`, body: "test", motion_type: "house" }, "admin");

  // Admin creates division
  let divId;
  {
    const { status, body } = await apiPost("/api/divisions/create", {
      entity_type: "motion",
      entity_id:   motionId,
      title:       `Division Test ${ts}`,
    }, "admin");
    assert([201].includes(status), "Admin can create division", `got ${status}`);
    divId = body.division?.id;
  }

  if (!divId) {
    console.log("      ⚠️  Division not created — skipping division sub-tests");
    await apiDelete(`/api/motions/${motionId}`, "admin").catch(() => {});
    return;
  }

  // GET /api/divisions/:id returns tally (server-computed)
  {
    const { status, body } = await apiGet(`/api/divisions/${divId}`, "admin");
    assert(status === 200, "GET /api/divisions/:id returns 200", `got ${status}`);
    assert(typeof body.tally === "object" && "aye" in (body.tally || {}),
      "Division response includes server-computed tally", `tally=${JSON.stringify(body.tally)}`);
  }

  // GET /api/me/vote-weight — B3: server computes weight
  {
    const { status, body } = await apiGet("/api/me/vote-weight", "admin");
    assert(status === 200 || status === 403, "GET /api/me/vote-weight → 200 or 403 (no char)",
      `got ${status}`);
    if (status === 200) {
      assert(typeof body.weight === "number", "vote-weight response includes numeric weight",
        `got ${JSON.stringify(body)}`);
    }
  }

  // Player cannot supply a manipulated weight (server ignores client weight)
  // We test this by verifying the server-computed tally after a vote
  if (sessions.player) {
    const { status: voteStatus, body: voteBody } = await apiPost(
      `/api/divisions/${divId}/vote`,
      { vote: "aye", weight: 9999 },  // attempt to manipulate weight
      "player"
    );
    // 200/201 = vote recorded; 403 = no active character; 409 = division closed
    assert([200, 201, 403, 409].includes(voteStatus), "POST /api/divisions/:id/vote accepted or 403/409",
      `got ${voteStatus}`);

    if ([200, 201].includes(voteStatus)) {
      // The tally should NOT include 9999 — it should use the server-computed weight
      const { body: tallyBody } = await apiGet(`/api/divisions/${divId}`, "admin");
      const tally = tallyBody.tally || {};
      assert((tally.aye || 0) < 9999, "Server ignores client-supplied weight (tally < 9999)",
        `tally.aye=${tally.aye}`);
    }
  } else {
    console.log("      ⚠️  No player session — skipping division vote sub-tests");
  }

  // Close division (staff only)
  {
    const { status } = await apiPost(`/api/divisions/${divId}/close`, {}, "admin");
    assert([200, 201, 409].includes(status), "Admin can close division", `got ${status}`);
  }

  // Attempt to vote on closed division → 409
  if (sessions.player) {
    const { status } = await apiPost(`/api/divisions/${divId}/vote`, { vote: "aye" }, "player");
    assert(status === 409 || status === 403, "Closed division rejects further votes (409/403)",
      `got ${status}`);
  }

  // Clean up
  await apiDelete(`/api/motions/${motionId}`, "admin").catch(() => {});
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${"═".repeat(72)}`);
  console.log("  Rule Britannia — Staging Audit Test Runner");
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Time:   ${new Date().toISOString()}`);
  console.log(`${"═".repeat(72)}\n`);

  // Authenticate
  console.log("  🔐 Authenticating sessions…");
  try {
    await login("admin", ADMIN_EMAIL, ADMIN_PASSWORD);
    console.log("      ✅ Admin session established");
  } catch (err) {
    console.error(`      ❌ Admin login failed: ${err.message}`);
    console.error("\n  Cannot continue without admin session. Exiting.\n");
    process.exit(1);
  }

  if (PLAYER_EMAIL && PLAYER_PASSWORD) {
    try {
      await login("player", PLAYER_EMAIL, PLAYER_PASSWORD);
      console.log("      ✅ Player session established");
    } catch (err) {
      console.warn(`      ⚠️  Player login failed (${err.message}) — player RBAC tests will be skipped`);
    }
  } else {
    console.warn("      ⚠️  TEST_PLAYER_EMAIL/PASSWORD not set — player RBAC tests will be skipped");
  }

  // Run suites
  await suite("Suite 1: Persistence  (create → reload → verify)", testPersistence);
  await suite("Suite 2: RBAC         (anonymous + player access)", testRbac);
  await suite("Suite 3: Immutability (parliament items locked after submit)", testImmutability);
  await suite("Suite 4: Division authority (server-computed weight + outcome)", testDivisionAuthority);

  // Summary
  console.log(`\n${"═".repeat(72)}`);
  const verdict = totalFail === 0 ? "✅  GO  — all tests passed" : `❌  NO-GO  — ${totalFail} test(s) failed`;
  console.log(`  ${verdict}`);
  console.log(`  Passed: ${totalPass}   Failed: ${totalFail}`);
  if (failReasons.length) {
    console.log("\n  Failing assertions:");
    failReasons.forEach((r) => console.log(`    • ${r}`));
  }
  console.log(`${"═".repeat(72)}\n`);
  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
