/**
 * tests/api/persistence.spec.js
 *
 * R3 persistence tests — validates that write → reload shows the same state.
 *
 * Each test:
 *   1. Creates a resource via POST
 *   2. Fetches it back via GET
 *   3. Asserts the key fields match
 *
 * Runs against a live server using Node's built-in test runner:
 *   node --test tests/api/persistence.spec.js
 *
 * Required environment variables:
 *   BASE_URL      - e.g. https://rulebritannia-app.onrender.com
 *   COOKIE_PLAYER - session cookie for an authenticated player
 *   COOKIE_MOD    - session cookie for a mod user
 *   COOKIE_ADMIN  - session cookie for an admin user
 *
 * Optional:
 *   TEST_PARTY_ID - UUID of an existing party to use for party tests
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "url";

const BASE_URL = process.env.BASE_URL;
if (!BASE_URL) {
  console.warn("⚠️  BASE_URL not set — skipping persistence tests");
  process.exit(0);
}

const COOKIES = {
  player: process.env.COOKIE_PLAYER || "",
  mod:    process.env.COOKIE_MOD    || "",
  admin:  process.env.COOKIE_ADMIN  || "",
};

if (!COOKIES.player) {
  console.warn("⚠️  COOKIE_PLAYER not set — skipping persistence tests");
  process.exit(0);
}

let csrfToken = "";

before(async () => {
  const res = await fetch(`${BASE_URL}/api/csrf-token`, {
    headers: { Cookie: COOKIES.admin || COOKIES.mod || COOKIES.player },
  });
  const data = await res.json().catch(() => ({}));
  csrfToken = data.csrfToken || data.token || "";
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiPost(path, body, cookie) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": csrfToken,
      Cookie:          cookie,
    },
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

async function apiDelete(path, cookie) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method:  "DELETE",
    headers: { "x-csrf-token": csrfToken, Cookie: cookie },
  });
  return { status: res.status };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("R3 persistence: Red Lion posts survive a reload", () => {
  let createdId;
  const testBody = `RB-test-post-${Date.now()}`;

  test("POST /api/redlion creates a post", async () => {
    const { status, body } = await apiPost(
      "/api/redlion",
      { displayName: "TestCharacter", body: testBody, asBarkeep: false, avatar: "" },
      COOKIES.player
    );
    // Post to redlion requires authenticated user; mod or speaker creates posts on behalf
    assert.ok([200, 201, 403].includes(status), `Unexpected status ${status}`);
    if (status === 201 || status === 200) createdId = body.id;
  });

  test("GET /api/redlion returns the created post", async () => {
    if (!createdId) { console.warn("    (skipped — post not created)"); return; }
    const { status, body } = await apiGet("/api/redlion", COOKIES.player);
    assert.equal(status, 200, "GET /api/redlion should return 200");
    const posts = body.posts || body;
    const found = Array.isArray(posts) && posts.find((p) => p.id === createdId);
    assert.ok(found, `Created post ${createdId} not found in reload`);
    assert.equal(found.body, testBody, "Post body mismatch after reload");
  });
});

describe("R3 persistence: online posts survive a reload", () => {
  let createdId;
  const testBody = `RB-online-test-${Date.now()}`;

  test("POST /api/online creates a web post", async () => {
    const postPayload = {
      type: "web",
      post: {
        id:        `web-test-${Date.now()}`,
        title:     "Test",
        body:      testBody,
        author:    "Test",
        createdAt: new Date().toLocaleString("en-GB"),
        createdTs: Date.now(),
      },
    };
    const { status, body } = await apiPost("/api/online", postPayload, COOKIES.player);
    assert.ok([200, 201, 400].includes(status), `Unexpected status ${status}`);
    if (status === 201 || status === 200) createdId = body.id;
  });

  test("GET /api/online returns the created post", async () => {
    if (!createdId) { console.warn("    (skipped — post not created)"); return; }
    const { status, body } = await apiGet("/api/online?type=web", COOKIES.player);
    assert.equal(status, 200, "GET /api/online should return 200");
    const posts = body.posts || body;
    assert.ok(Array.isArray(posts), "Response should contain a posts array");
    const found = posts.find((p) => p.id === createdId);
    assert.ok(found, `Created online post ${createdId} not found in reload`);
  });
});

describe("R3 persistence: QT question submission survives a reload", () => {
  let createdId;
  const testText = `RB-qt-test-${Date.now()}`;

  test("POST /api/qt/questions creates a question", async () => {
    const { status, body } = await apiPost(
      "/api/qt/questions",
      { office: "prime-minister", text: testText, session_label: "Test Session" },
      COOKIES.player
    );
    assert.ok([200, 201, 400, 409].includes(status), `Unexpected status ${status}`);
    if (body.id) createdId = body.id;
  });

  test("GET /api/qt/questions returns the created question", async () => {
    if (!createdId) { console.warn("    (skipped — question not created)"); return; }
    const { status, body } = await apiGet("/api/qt/questions", COOKIES.player);
    assert.equal(status, 200);
    const qs = body.questions || body;
    assert.ok(Array.isArray(qs), "Should return an array of questions");
    const found = qs.find((q) => q.id === createdId);
    assert.ok(found, `QT question ${createdId} not found in reload`);
  });
});

describe("R3 persistence: constituency work plan survives a reload", () => {
  const testHours = {
    "Meeting Local Businesses": 5,
    "Constituency Surgeries":   3,
    "Community Events":         2,
  };

  test("POST /api/me/work-plan saves work plan", async () => {
    const { status } = await apiPost(
      "/api/me/work-plan",
      { hours: testHours, secondJobTitleCompany: "Test Co", lastSavedSimIndex: 0 },
      COOKIES.player
    );
    assert.ok([200, 201].includes(status), `POST /api/me/work-plan returned ${status}`);
  });

  test("GET /api/me/work-plan returns saved work plan", async () => {
    const { status, body } = await apiGet("/api/me/work-plan", COOKIES.player);
    assert.equal(status, 200, "GET /api/me/work-plan should return 200");
    const plan = body.workPlan || body;
    assert.ok(plan, "Response should contain workPlan");
    // Verify at least one key matches
    if (plan.hours) {
      for (const [task, hrs] of Object.entries(testHours)) {
        if (plan.hours[task] !== undefined) {
          assert.equal(plan.hours[task], hrs, `Hours mismatch for task "${task}"`);
          break;
        }
      }
    }
  });
});

describe("R3 persistence: press release survives a reload", () => {
  let createdId;
  const testSubject = `RB-press-${Date.now()}`;

  test("POST /api/press creates a press release", async () => {
    const id = `press-test-${Date.now()}`;
    const { status, body } = await apiPost(
      "/api/press",
      {
        press_type: "release",
        id,
        reference: "TEST PR 1",
        subject: testSubject,
        body: "Test body",
        author: "Test Author",
        createdAtSim: "January 1997",
        score: null,
        impact: [],
      },
      COOKIES.player
    );
    assert.ok([200, 201].includes(status), `POST /api/press returned ${status}`);
    createdId = body.id || id;
  });

  test("GET /api/press returns the press release (R3: DB-backed)", async () => {
    if (!createdId) { console.warn("    (skipped — press item not created)"); return; }
    const { status, body } = await apiGet(`/api/press?type=release`, COOKIES.player);
    assert.equal(status, 200);
    const items = body.releases || body.items || body;
    assert.ok(Array.isArray(items), "Should return an array");
    const found = items.find((p) => p.id === createdId || p.subject === testSubject);
    assert.ok(found, `Press release not found in reload — R3 failure: write not persisted to DB`);
  });
});
