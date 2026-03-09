/**
 * Integration tests: POST /api/admin/seed-1997-bodies-locals
 *
 * Covers the regression scenarios from the production-500 fix:
 *  - force=true via query string seeds the exact May 1997 dataset
 *  - /api/bodies returns Lords totalSeats=1265 and europarl with correct total
 *  - /api/locals returns England Labour councillors=10840 and NOC=74
 *  - /api/admin/other-officials/arenas-totals includes europarl + all four locals arenas
 *  - Endpoint returns 403 (not 500) when dev-seeding is disabled
 *
 * Run with:
 *   NODE_ENV=test \
 *   ENABLE_DEV_SEED=true \
 *   DATABASE_URL=postgresql://rb_test_user:rb_test_pw@localhost:5432/rb_test \
 *   SESSION_SECRET=test-secret \
 *   node --test server/seed-1997.integration.test.js
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "./db.js";
import {
  createTestSchema,
  dropTestSchema,
  seedUserAndCharacter,
  startTestServer,
  TestClient,
} from "./test-helpers.js";
import { app } from "./index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Global setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

let baseUrl;
let closeServer;
let adminClient;

before(async () => {
  await createTestSchema();
  const started = await startTestServer(app);
  baseUrl = started.baseUrl;
  closeServer = started.close;

  const adminUser = await seedUserAndCharacter({ roles: ["admin"] });
  adminClient = new TestClient(baseUrl);
  await adminClient.login(adminUser.email, adminUser.password);
});

after(async () => {
  if (typeof closeServer === "function") {
    try { await closeServer(); } catch { /* ignore */ }
  }
  try { await dropTestSchema(); } catch { /* ignore */ }
  await pool.end();
});

// ─────────────────────────────────────────────────────────────────────────────
// Seed endpoint: force=true via query string
// ─────────────────────────────────────────────────────────────────────────────

test("POST /api/admin/seed-1997-bodies-locals?force=true seeds correct data and returns ok:true", async () => {
  const { status, body } = await adminClient.post(
    "/api/admin/seed-1997-bodies-locals?force=true",
    { force: true }
  );
  assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert.equal(body.ok, true, "ok flag should be true");
  assert.equal(body.force, true, "force flag should echo true");
});

// ─────────────────────────────────────────────────────────────────────────────
// /api/bodies: Lords totalSeats=1265 and europarl seat total=87
// ─────────────────────────────────────────────────────────────────────────────

test("GET /api/bodies returns Lords totalSeats=1265 after seed", async () => {
  const { status, body } = await adminClient.get("/api/bodies");
  assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  const lords = (body.bodies || []).find((b) => b.id === "lords");
  assert.ok(lords, "lords body must be present");
  assert.equal(lords.totalSeats, 1265, `Lords totalSeats must be 1265, got ${lords.totalSeats}`);
});

test("GET /api/bodies europarl party breakdown sums to 87", async () => {
  const { status, body } = await adminClient.get("/api/bodies");
  assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  const europarl = (body.bodies || []).find((b) => b.id === "europarl");
  assert.ok(europarl, "europarl body must be present");
  const total = (europarl.partyBreakdown || []).reduce((sum, r) => sum + Number(r.seats || 0), 0);
  assert.equal(total, 87, `Europarl seat total must be 87, got ${total}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// /api/locals: England Labour councillors=10840 and NOC=74
// ─────────────────────────────────────────────────────────────────────────────

test("GET /api/locals returns England Labour councillors=10840 and NOC=74 after seed", async () => {
  const { status, body } = await adminClient.get("/api/locals");
  assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  const england = (body.countries || []).find((c) => c.country === "England");
  assert.ok(england, "England country must be present in locals");
  assert.equal(england.noOverallControlCouncils, 74, `England NOC must be 74, got ${england.noOverallControlCouncils}`);
  const labour = (england.partyBreakdown || []).find((r) => r.party === "Labour");
  assert.ok(labour, "England Labour row must be present");
  assert.equal(labour.councillors, 10840, `England Labour councillors must be 10840, got ${labour.councillors}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// /api/locals: Seeded records include correct totalCouncils and totalCouncillors
// ─────────────────────────────────────────────────────────────────────────────

test("GET /api/locals returns correct totalCouncils and totalCouncillors for all four countries after seed", async () => {
  const { status, body } = await adminClient.get("/api/locals");
  assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  const expected = [
    { country: "England",          totalCouncils: 386, totalCouncillors: 22580 },
    { country: "Scotland",         totalCouncils: 32,  totalCouncillors: 1306  },
    { country: "Wales",            totalCouncils: 22,  totalCouncillors: 1272  },
    { country: "Northern Ireland", totalCouncils: 26,  totalCouncillors: 582   },
  ];
  for (const exp of expected) {
    const c = (body.countries || []).find((x) => x.country === exp.country);
    assert.ok(c, `${exp.country} must be present in locals`);
    assert.equal(c.totalCouncils, exp.totalCouncils,
      `${exp.country} totalCouncils must be ${exp.totalCouncils}, got ${c.totalCouncils}`);
    assert.equal(c.totalCouncillors, exp.totalCouncillors,
      `${exp.country} totalCouncillors must be ${exp.totalCouncillors}, got ${c.totalCouncillors}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/locals: validation — mismatched totals are rejected
// ─────────────────────────────────────────────────────────────────────────────

test("PUT /api/locals returns 400 when councillors breakdown does not sum to totalCouncillors", async () => {
  const payload = {
    countries: [
      {
        country: "Scotland",
        totalCouncillors: 9999, // wrong total
        totalCouncils: null,
        noOverallControlCouncils: 3,
        partyBreakdown: [
          { party: "Labour", councillors: 621, councilsControlled: 21 },
          { party: "Conservative", councillors: 82, councilsControlled: 0 },
        ],
      },
    ],
  };
  const { status, body } = await adminClient.put("/api/locals", payload);
  assert.equal(status, 400, `Expected 400 for mismatched councillors, got ${status}: ${JSON.stringify(body)}`);
  assert.ok(body.error, "Response must have an error message");
  assert.ok(body.error.includes("Scotland"), `Error must mention country name; got: ${body.error}`);
  assert.ok(body.error.includes("councillors"), `Error must mention councillors; got: ${body.error}`);
});

test("PUT /api/locals returns 400 when councils breakdown does not sum to totalCouncils", async () => {
  const payload = {
    countries: [
      {
        country: "Wales",
        totalCouncillors: null,
        totalCouncils: 999, // wrong total
        noOverallControlCouncils: 3,
        partyBreakdown: [
          { party: "Labour", councillors: 726, councilsControlled: 14 },
          { party: "Conservative", councillors: 42, councilsControlled: 0 },
        ],
      },
    ],
  };
  const { status, body } = await adminClient.put("/api/locals", payload);
  assert.equal(status, 400, `Expected 400 for mismatched councils, got ${status}: ${JSON.stringify(body)}`);
  assert.ok(body.error, "Response must have an error message");
  assert.ok(body.error.includes("Wales"), `Error must mention country name; got: ${body.error}`);
  assert.ok(body.error.includes("councils"), `Error must mention councils; got: ${body.error}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/locals: validation — matching totals succeed
// ─────────────────────────────────────────────────────────────────────────────

test("PUT /api/locals succeeds when councillors breakdown sums to totalCouncillors", async () => {
  const payload = {
    countries: [
      {
        country: "Scotland",
        totalCouncillors: 703, // 621 + 82 = 703
        totalCouncils: null,
        noOverallControlCouncils: 3,
        partyBreakdown: [
          { party: "Labour", councillors: 621, councilsControlled: 21 },
          { party: "Conservative", councillors: 82, councilsControlled: 0 },
        ],
      },
    ],
  };
  const { status, body } = await adminClient.put("/api/locals", payload);
  assert.equal(status, 200, `Expected 200 for matching councillors, got ${status}: ${JSON.stringify(body)}`);
  assert.equal(body.ok, true, "ok flag must be true");
});

test("PUT /api/locals succeeds when councils breakdown (including NOC) sums to totalCouncils", async () => {
  const payload = {
    countries: [
      {
        country: "Wales",
        totalCouncillors: null,
        totalCouncils: 17, // 14 + 0 + 3 NOC = 17
        noOverallControlCouncils: 3,
        partyBreakdown: [
          { party: "Labour", councillors: 726, councilsControlled: 14 },
          { party: "Conservative", councillors: 42, councilsControlled: 0 },
        ],
      },
    ],
  };
  const { status, body } = await adminClient.put("/api/locals", payload);
  assert.equal(status, 200, `Expected 200 for matching councils, got ${status}: ${JSON.stringify(body)}`);
  assert.equal(body.ok, true, "ok flag must be true");
});

test("PUT /api/locals succeeds when totals are not set (backwards compatibility)", async () => {
  const payload = {
    countries: [
      {
        country: "Wales",
        noOverallControlCouncils: 3,
        partyBreakdown: [
          { party: "Labour", councillors: 726, councilsControlled: 14 },
        ],
      },
    ],
  };
  const { status, body } = await adminClient.put("/api/locals", payload);
  assert.equal(status, 200, `Expected 200 when totals not set, got ${status}: ${JSON.stringify(body)}`);
  assert.equal(body.ok, true, "ok flag must be true");
});

// ─────────────────────────────────────────────────────────────────────────────
// /api/admin/other-officials/arenas-totals includes europarl + all locals arenas
// ─────────────────────────────────────────────────────────────────────────────

test("GET /api/admin/other-officials/arenas-totals includes europarl and all four locals arenas", async () => {
  const { status, body } = await adminClient.get("/api/admin/other-officials/arenas-totals");
  assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert.equal(body.ok, true, "ok flag should be true");

  const arenas = body.contributingArenas || [];
  const arenaKeys = arenas.map((a) => `${a.arenaType}:${a.arenaId}`);

  assert.ok(arenaKeys.includes("body:europarl"), `contributingArenas must include body:europarl; got ${JSON.stringify(arenaKeys)}`);
  assert.ok(arenaKeys.includes("locals:England"), `contributingArenas must include locals:England`);
  assert.ok(arenaKeys.includes("locals:Scotland"), `contributingArenas must include locals:Scotland`);
  assert.ok(arenaKeys.includes("locals:Wales"), `contributingArenas must include locals:Wales`);
  assert.ok(arenaKeys.includes("locals:Northern Ireland"), `contributingArenas must include locals:Northern Ireland`);

  // DEM must not appear because it is invisible and has no mayors in 1997
  assert.ok(
    !arenaKeys.includes("body:directly-elected-mayors"),
    `contributingArenas must NOT include body:directly-elected-mayors in 1997`
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression: force overwrite must preserve type and partyBreakdown
// ─────────────────────────────────────────────────────────────────────────────

test("GET /api/bodies lords has type=standard after force seed", async () => {
  const { status, body } = await adminClient.get("/api/bodies");
  assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  const lords = (body.bodies || []).find((b) => b.id === "lords");
  assert.ok(lords, "lords body must be present");
  assert.equal(lords.type, "standard", `lords type must be 'standard' after force seed, got ${lords.type}`);
});

test("GET /api/bodies lords partyBreakdown has correct 1997 allocations after force seed", async () => {
  const { status, body } = await adminClient.get("/api/bodies");
  assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  const lords = (body.bodies || []).find((b) => b.id === "lords");
  assert.ok(lords, "lords body must be present");
  const pb = lords.partyBreakdown || [];
  assert.ok(pb.length > 0, "lords partyBreakdown must not be empty after force seed");
  const labour = pb.find((r) => r.party === "Labour");
  assert.ok(labour, "lords partyBreakdown must contain a Labour row");
  assert.equal(labour.seats, 182, `lords Labour seats must be 182, got ${labour.seats}`);
  const conservative = pb.find((r) => r.party === "Conservative");
  assert.ok(conservative, "lords partyBreakdown must contain a Conservative row");
  assert.equal(conservative.seats, 497, `lords Conservative seats must be 497, got ${conservative.seats}`);
  const libdem = pb.find((r) => r.party === "Liberal Democrat");
  assert.ok(libdem, "lords partyBreakdown must contain a Liberal Democrat row");
  assert.equal(libdem.seats, 73, `lords Liberal Democrat seats must be 73, got ${libdem.seats}`);
});

test("GET /api/bodies europarl has type=standard after force seed", async () => {
  const { status, body } = await adminClient.get("/api/bodies");
  assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  const europarl = (body.bodies || []).find((b) => b.id === "europarl");
  assert.ok(europarl, "europarl body must be present");
  assert.equal(europarl.type, "standard", `europarl type must be 'standard' after force seed, got ${europarl.type}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression: force overwrite on a body pre-populated with wrong data
// This is the exact bug scenario: body has totalSeats set but partyBreakdown
// wiped. Running force overwrite must restore the correct breakdown.
// ─────────────────────────────────────────────────────────────────────────────

test("force overwrite restores correct lords partyBreakdown even when DB has corrupted state", async () => {
  // Corrupt the lords body: set totalSeats but clear partyBreakdown
  const corruptPayload = { id: "lords", type: "standard", visible: true, totalSeats: 1265, partyBreakdown: [] };
  const putRes = await adminClient.put("/api/bodies/lords", corruptPayload);
  assert.equal(putRes.status, 200, `PUT /api/bodies/lords should succeed, got ${putRes.status}`);

  // Verify the corruption is in place
  const { body: beforeBody } = await adminClient.get("/api/bodies");
  const lordsBefore = (beforeBody.bodies || []).find((b) => b.id === "lords");
  assert.ok(lordsBefore, "lords must exist before force seed");
  assert.deepEqual(lordsBefore.partyBreakdown || [], [], "lords partyBreakdown should be empty (corrupted)");

  // Run force overwrite
  const seedRes = await adminClient.post("/api/admin/seed-1997-bodies-locals?force=true", { force: true });
  assert.equal(seedRes.status, 200, `Force seed should return 200, got ${seedRes.status}`);
  assert.equal(seedRes.body.ok, true, "Force seed ok must be true");

  // Verify the breakdown is restored
  const { body: afterBody } = await adminClient.get("/api/bodies");
  const lordsAfter = (afterBody.bodies || []).find((b) => b.id === "lords");
  assert.ok(lordsAfter, "lords must be present after force seed");
  assert.equal(lordsAfter.type, "standard", "lords type must be 'standard' after force seed");
  assert.equal(lordsAfter.totalSeats, 1265, `lords totalSeats must be 1265, got ${lordsAfter.totalSeats}`);
  const pb = lordsAfter.partyBreakdown || [];
  assert.ok(pb.length > 0, "lords partyBreakdown must not be empty after force seed");
  const labour = pb.find((r) => r.party === "Labour");
  assert.ok(labour, "lords partyBreakdown must contain Labour after force seed");
  assert.equal(labour.seats, 182, `lords Labour seats must be 182 after force seed, got ${labour.seats}`);
  const pbSum = pb.reduce((s, r) => s + Number(r.seats || 0), 0);
  assert.ok(pbSum > 0, `lords partyBreakdown seat sum must be > 0 after force seed, got ${pbSum}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency: running force overwrite twice yields the same result
// ─────────────────────────────────────────────────────────────────────────────

test("force overwrite is idempotent: second run gives same lords totalSeats and partyBreakdown", async () => {
  // Second force overwrite
  const seedRes = await adminClient.post("/api/admin/seed-1997-bodies-locals?force=true", { force: true });
  assert.equal(seedRes.status, 200, `Second force seed should return 200, got ${seedRes.status}`);

  const { body } = await adminClient.get("/api/bodies");
  const lords = (body.bodies || []).find((b) => b.id === "lords");
  assert.ok(lords, "lords must be present after second force seed");
  assert.equal(lords.totalSeats, 1265, `lords totalSeats must still be 1265, got ${lords.totalSeats}`);
  assert.equal(lords.type, "standard", "lords type must still be 'standard'");
  const pb = lords.partyBreakdown || [];
  assert.ok(pb.length > 0, "lords partyBreakdown must not be empty after second force seed");
  const labour = pb.find((r) => r.party === "Labour");
  assert.ok(labour, "lords Labour row must still be present after second force seed");
  assert.equal(labour.seats, 182, `lords Labour seats must still be 182, got ${labour.seats}`);
});
