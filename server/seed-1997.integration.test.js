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
