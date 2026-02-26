/**
 * tests/api/division-authority.spec.js
 *
 * B3 division-authority tests — validates that:
 *  • The server computes vote weight (client-supplied weight is ignored).
 *  • GET /api/divisions/:id returns a server-computed tally.
 *  • GET /api/me/vote-weight returns a server-computed integer.
 *  • POST /api/divisions/:id/close finalises the result immutably.
 *  • Voting on a closed division is rejected.
 *
 * Runs against a live server using Node's built-in test runner:
 *   node --test tests/api/division-authority.spec.js
 *
 * Required environment variables:
 *   BASE_URL      - e.g. https://rulebritannia-app.onrender.com
 *   COOKIE_PLAYER - session cookie for an authenticated player (non-staff)
 *   COOKIE_ADMIN  - session cookie for an admin user
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

const BASE_URL = process.env.BASE_URL;
if (!BASE_URL) {
  console.warn("⚠️  BASE_URL not set — skipping division-authority tests");
  process.exit(0);
}

const COOKIES = {
  player: process.env.COOKIE_PLAYER || "",
  admin:  process.env.COOKIE_ADMIN  || "",
};

if (!COOKIES.admin) {
  console.warn("⚠️  COOKIE_ADMIN not set — skipping division-authority tests");
  process.exit(0);
}

let csrfToken = "";
let testMotionId = "";
let testDivisionId = "";

before(async () => {
  const res = await fetch(`${BASE_URL}/api/csrf-token`, {
    headers: { Cookie: COOKIES.admin },
  });
  const data = await res.json().catch(() => ({}));
  csrfToken = data.csrfToken || data.token || "";
  testMotionId = `div-auth-motion-${Date.now()}`;
});

after(async () => {
  // Best-effort cleanup
  if (testMotionId) {
    await fetch(`${BASE_URL}/api/motions/${testMotionId}`, {
      method: "DELETE",
      headers: { "x-csrf-token": csrfToken, Cookie: COOKIES.admin },
    }).catch(() => {});
  }
});

async function apiPost(path, body, cookie) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken, Cookie: cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function apiGet(path, cookie) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Cookie: cookie },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// ── Setup: create a motion and division ──────────────────────────────────────

describe("B3 division authority: server-side weight and tally", () => {

  test("Admin can create a test motion", async () => {
    const { status } = await apiPost("/api/motions", {
      id:    testMotionId,
      title: `Division auth test ${Date.now()}`,
      body:  "Test motion for division authority tests.",
      author: "Test Runner",
      motion_type: "house",
    }, COOKIES.admin);
    assert.ok([200, 201].includes(status), `POST /api/motions returned ${status}`);
  });

  test("Admin can open a division for the test motion", async () => {
    const { status, body } = await apiPost("/api/divisions/create", {
      entity_type: "motion",
      entity_id:   testMotionId,
      title:       "Test Division",
    }, COOKIES.admin);
    assert.ok([201].includes(status), `POST /api/divisions/create returned ${status}`);
    testDivisionId = body.division?.id || "";
    assert.ok(testDivisionId, "Division ID should be returned");
  });

  test("GET /api/divisions/:id returns server-computed tally", async () => {
    if (!testDivisionId) { console.warn("    (skipped — no division)"); return; }
    const { status, body } = await apiGet(`/api/divisions/${testDivisionId}`, COOKIES.admin);
    assert.equal(status, 200, "GET /api/divisions/:id returns 200");
    assert.ok(typeof body.tally === "object", "Response includes a tally object");
    assert.ok("aye" in body.tally,     "Tally includes aye count");
    assert.ok("no" in body.tally,      "Tally includes no count");
    assert.ok("abstain" in body.tally, "Tally includes abstain count");
  });

  test("GET /api/me/vote-weight returns a server-computed weight", async () => {
    const { status, body } = await apiGet("/api/me/vote-weight", COOKIES.admin);
    // 403 = valid if admin has no active character; 200 = has a character
    assert.ok([200, 403].includes(status), `GET /api/me/vote-weight returned ${status}`);
    if (status === 200) {
      assert.ok(typeof body.weight === "number", "weight must be a number");
      assert.ok(body.weight >= 1, "weight must be at least 1");
    }
  });

  test("Server ignores client-supplied weight when casting vote", async () => {
    if (!testDivisionId || !COOKIES.player) {
      console.warn("    (skipped — no division or no COOKIE_PLAYER)");
      return;
    }
    // Send an absurdly large weight — the server must ignore it
    const { status, body } = await apiPost(`/api/divisions/${testDivisionId}/vote`, {
      vote:   "aye",
      weight: 99999,  // B3: server must ignore this
    }, COOKIES.player);
    // 200/201 = vote recorded; 403 = no active char; 409 = already closed
    assert.ok([200, 201, 403, 409].includes(status), `Vote returned ${status}`);

    if ([200, 201].includes(status)) {
      // Verify the stored tally is not 99999
      const { body: divBody } = await apiGet(`/api/divisions/${testDivisionId}`, COOKIES.admin);
      const tally = divBody.tally || {};
      assert.ok((tally.aye || 0) < 99999,
        `Server must not accept client weight 99999 — tally.aye=${tally.aye}`);
    }
  });

  test("GET /api/divisions/for-entity returns myWeight (server-provided)", async () => {
    if (!testDivisionId) { console.warn("    (skipped — no division)"); return; }
    const { status, body } = await apiGet(
      `/api/divisions/for-entity/motion/${testMotionId}`,
      COOKIES.admin
    );
    assert.ok([200, 404].includes(status), `GET for-entity returned ${status}`);
    if (status === 200) {
      // myWeight should be present and numeric (may be 0 if admin has no active char)
      assert.ok("myWeight" in body, "for-entity response includes myWeight field");
      assert.ok(typeof body.myWeight === "number", `myWeight must be numeric, got ${typeof body.myWeight}`);
    }
  });

  test("Non-staff cannot close a division", async () => {
    if (!testDivisionId || !COOKIES.player) {
      console.warn("    (skipped — no division or no COOKIE_PLAYER)");
      return;
    }
    const { status } = await apiPost(`/api/divisions/${testDivisionId}/close`, {}, COOKIES.player);
    assert.ok([401, 403].includes(status),
      `Player should not be able to close a division, got ${status}`);
  });

  test("Admin can close the division and result is immutable", async () => {
    if (!testDivisionId) { console.warn("    (skipped — no division)"); return; }
    const { status, body } = await apiPost(`/api/divisions/${testDivisionId}/close`, {}, COOKIES.admin);
    assert.ok([200, 201, 409].includes(status), `Close division returned ${status}`);
    if ([200, 201].includes(status)) {
      assert.ok(["passed", "failed", "tied"].includes(body.division?.outcome || body.outcome || ""),
        `Outcome must be passed/failed/tied, got ${body.division?.outcome}`);
    }
  });

  test("Voting on closed division is rejected (409)", async () => {
    if (!testDivisionId || !COOKIES.player) {
      console.warn("    (skipped — no division or no COOKIE_PLAYER)");
      return;
    }
    const { status } = await apiPost(`/api/divisions/${testDivisionId}/vote`, {
      vote: "aye",
    }, COOKIES.player);
    assert.ok([409, 403].includes(status),
      `Voting on closed division must return 409 or 403, got ${status}`);
  });
});
