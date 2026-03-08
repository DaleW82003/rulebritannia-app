/**
 * Integration tests: finance consistency and speaker/staff parliamentary permissions.
 *
 * Coverage areas:
 *
 * Personal finance
 *   - Admin sets bank balance via POST /api/admin/finance/set-bank
 *   - GET /api/me/finance reflects the authoritative updated value
 *   - Derived values (totalMonthlyUpkeep, financeCostIndex, shopPurchases) are
 *     structurally valid after a bank mutation
 *
 * Party finance
 *   - Admin adds donation via POST /api/parties/:id/donations (treasury cash credited)
 *   - GET /api/parties/:id/donations returns the donation
 *   - RBAC: only admin/mod can add a donation; regular user is rejected
 *
 * Speaker / staff parliamentary permissions
 *   - Speaker can update parliament status via PUT /api/parliament/status
 *   - Admin and mod can also update parliament status
 *   - Regular user cannot update parliament status (403)
 *   - Unauthenticated GET /api/parliament/status returns 401
 *   - Speaker CAN call POST /api/admin/finance/set-bank (requireAdminModOrSpeaker)
 *   - Regular user cannot call POST /api/admin/finance/set-bank (403)
 *
 * Design notes:
 *  - Shared users (admin, mod, speaker, regular) are created once in before() to
 *    stay under the auth rate-limit (20 / 15 min).
 *  - Each test seeds its own character / party with unique IDs to prevent interference.
 *  - Unauthenticated mutation tests receive 403 because the CSRF check fires before
 *    the auth guard.
 *
 * Run with:
 *   NODE_ENV=test \
 *   DATABASE_URL=postgresql://rb_test_user:rb_test_pw@localhost:5432/rb_test \
 *   SESSION_SECRET=test-secret \
 *   node --test server/finance-parliament.integration.test.js
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "./db.js";
import {
  createTestSchema,
  dropTestSchema,
  seedUserAndCharacter,
  seedParty,
  startTestServer,
  TestClient,
} from "./test-helpers.js";
import { app } from "./index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Global setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

let baseUrl;
let closeServer;

// Shared logged-in clients — created once in before() to minimise login requests.
let adminClient;
let modClient;
let speakerClient;
let regularClient;

// Shared character IDs for permission tests (set in before())
let adminCharId;
let speakerCharId;
let regularCharId;

before(async () => {
  await createTestSchema();
  const started = await startTestServer(app);
  baseUrl     = started.baseUrl;
  closeServer = started.close;

  // Create shared users — 4 logins, well under the 20 / 15 min auth limit.
  const adminUser   = await seedUserAndCharacter({ roles: ["admin"],   party: "Labour" });
  const modUser     = await seedUserAndCharacter({ roles: ["mod"],     party: "Labour" });
  const speakerUser = await seedUserAndCharacter({ roles: ["speaker"], party: "Labour" });
  const regularUser = await seedUserAndCharacter({ roles: [],          party: "Labour" });

  adminCharId   = adminUser.charId;
  speakerCharId = speakerUser.charId;
  regularCharId = regularUser.charId;

  adminClient   = new TestClient(baseUrl);
  modClient     = new TestClient(baseUrl);
  speakerClient = new TestClient(baseUrl);
  regularClient = new TestClient(baseUrl);

  await adminClient.login(adminUser.email, adminUser.password);
  await modClient.login(modUser.email, modUser.password);
  await speakerClient.login(speakerUser.email, speakerUser.password);
  await regularClient.login(regularUser.email, regularUser.password);
});

after(async () => {
  if (typeof closeServer === "function") {
    try { await closeServer(); } catch { /* ignore */ }
  }
  try { await dropTestSchema(); } catch { /* ignore */ }
  await pool.end();
});

/** Fresh unauthenticated client (no session). */
function anonClient() { return new TestClient(baseUrl); }

/** Read treasury.cash for a party directly from the DB. */
async function getPartyCash(partySlug) {
  const { rows } = await pool.query(
    "SELECT treasury FROM parties WHERE slug = $1",
    [partySlug]
  );
  return Number(rows[0]?.treasury?.cash ?? 0);
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. Personal finance — mutation → read consistency
// ═════════════════════════════════════════════════════════════════════════════

test("PERSONAL FINANCE: admin set-bank is reflected in GET /api/me/finance", async () => {
  const { charId, email, password } = await seedUserAndCharacter({ party: "Labour" });

  // Admin sets the bank balance
  const setRes = await adminClient.post("/api/admin/finance/set-bank", {
    character_id: charId,
    bank_balance: 75000,
  });
  assert.equal(setRes.status, 200, `set-bank failed: ${JSON.stringify(setRes.body)}`);
  assert.ok(setRes.body.ok, "set-bank response should have ok:true");
  assert.equal(setRes.body.bank_balance, 75000, "set-bank should echo the new balance");

  // Character reads their own finance state
  const ownerClient = new TestClient(baseUrl);
  await ownerClient.login(email, password);
  const getRes = await ownerClient.get("/api/me/finance");
  assert.equal(getRes.status, 200, `GET /api/me/finance failed: ${JSON.stringify(getRes.body)}`);
  assert.equal(getRes.body.bankBalance, 75000, "bankBalance must reflect the admin mutation");
  assert.equal(getRes.body.characterId, charId, "characterId must match");
});

test("PERSONAL FINANCE: derived values are structurally valid after bank mutation", async () => {
  const { charId, email, password } = await seedUserAndCharacter({ party: "Labour" });

  await adminClient.post("/api/admin/finance/set-bank", {
    character_id: charId,
    bank_balance: 12345,
  });

  const ownerClient = new TestClient(baseUrl);
  await ownerClient.login(email, password);
  const { status, body } = await ownerClient.get("/api/me/finance");
  assert.equal(status, 200);

  // Derived numeric fields must be present and finite
  assert.ok(Number.isFinite(body.totalMonthlyUpkeep),  "totalMonthlyUpkeep must be a finite number");
  assert.ok(Number.isFinite(body.financeCostIndex),    "financeCostIndex must be a finite number");
  assert.ok(body.financeCostIndex > 0,                 "financeCostIndex must be positive");
  assert.ok(Number.isFinite(body.annualSalary),        "annualSalary must be a finite number");

  // Array-typed fields must be present
  assert.ok(Array.isArray(body.shopPurchases),         "shopPurchases must be an array");
  assert.ok(Array.isArray(body.additionalRevenue),     "additionalRevenue must be an array");
  assert.ok(Array.isArray(body.affiliationsMonthlyFeesItems), "affiliationsMonthlyFeesItems must be an array");

  // totalMonthlyUpkeep = shopUpkeep + propertyUpkeep + affiliationFees ≥ 0
  assert.ok(body.totalMonthlyUpkeep >= 0, "totalMonthlyUpkeep must be non-negative");
});

test("PERSONAL FINANCE: second admin mutation overwrites the first", async () => {
  const { charId, email, password } = await seedUserAndCharacter({ party: "Labour" });

  await adminClient.post("/api/admin/finance/set-bank", {
    character_id: charId,
    bank_balance: 1000,
  });
  await adminClient.post("/api/admin/finance/set-bank", {
    character_id: charId,
    bank_balance: 99999,
  });

  const ownerClient = new TestClient(baseUrl);
  await ownerClient.login(email, password);
  const { status, body } = await ownerClient.get("/api/me/finance");
  assert.equal(status, 200);
  assert.equal(body.bankBalance, 99999, "second mutation must overwrite the first");
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Personal finance — RBAC boundaries
// ═════════════════════════════════════════════════════════════════════════════

test("PERSONAL FINANCE RBAC: regular user cannot call set-bank (403)", async () => {
  const { charId } = await seedUserAndCharacter({ party: "Labour" });
  const { status } = await regularClient.post("/api/admin/finance/set-bank", {
    character_id: charId,
    bank_balance: 500,
  });
  assert.equal(status, 403, "regular user must be rejected with 403");
});

test("PERSONAL FINANCE RBAC: speaker CAN call set-bank (requireAdminModOrSpeaker)", async () => {
  const { charId } = await seedUserAndCharacter({ party: "Labour" });
  const { status, body } = await speakerClient.post("/api/admin/finance/set-bank", {
    character_id: charId,
    bank_balance: 8000,
  });
  assert.equal(status, 200, `speaker should be allowed; got: ${JSON.stringify(body)}`);
  assert.ok(body.ok, "speaker set-bank response should have ok:true");
});

test("PERSONAL FINANCE RBAC: unauthenticated set-bank returns 403 (CSRF fires before auth)", async () => {
  const { charId } = await seedUserAndCharacter({ party: "Labour" });
  const { status } = await anonClient().post("/api/admin/finance/set-bank", {
    character_id: charId,
    bank_balance: 100,
  });
  assert.equal(status, 403, "unauthenticated request must be rejected before reaching auth guard");
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Admin finance read — RBAC
// ═════════════════════════════════════════════════════════════════════════════

test("ADMIN FINANCE READ: admin can read any character finance via GET /api/admin/characters/:id/finance", async () => {
  const { charId } = await seedUserAndCharacter({ party: "Labour" });
  await adminClient.post("/api/admin/finance/set-bank", {
    character_id: charId,
    bank_balance: 25000,
  });

  const { status, body } = await adminClient.get(`/api/admin/characters/${charId}/finance`);
  assert.equal(status, 200, `admin finance read failed: ${JSON.stringify(body)}`);
  assert.equal(body.bankBalance, 25000, "admin read should reflect the authoritative balance");
  assert.ok(Number.isFinite(body.totalMonthlyUpkeep), "totalMonthlyUpkeep must be finite");
});

test("ADMIN FINANCE READ: regular user cannot read admin character finance (403)", async () => {
  const { charId } = await seedUserAndCharacter({ party: "Labour" });
  const { status } = await regularClient.get(`/api/admin/characters/${charId}/finance`);
  assert.equal(status, 403, "regular user must be rejected from admin finance read");
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Party finance — donation mutation and read consistency
// ═════════════════════════════════════════════════════════════════════════════

test("PARTY FINANCE: admin adds donation, treasury cash increases, donation is readable", async () => {
  const initialCash = 5000;
  const donationAmount = 2500;
  const { partySlug } = await seedParty({ initialCash });

  // Admin adds donation
  const postRes = await adminClient.post(`/api/parties/${partySlug}/donations`, {
    fromName: "Integration Test Donor",
    amount:   donationAmount,
    note:     "Test donation",
  });
  assert.equal(postRes.status, 200, `donation POST failed: ${JSON.stringify(postRes.body)}`);
  assert.ok(postRes.body.ok, "donation POST response should have ok:true");

  // Admin reads back the donations list
  const getRes = await adminClient.get(`/api/parties/${partySlug}/donations`);
  assert.equal(getRes.status, 200, `donations GET failed: ${JSON.stringify(getRes.body)}`);
  assert.ok(Array.isArray(getRes.body.donations), "donations must be an array");
  assert.equal(getRes.body.donations.length, 1, "exactly one donation should exist");
  assert.equal(getRes.body.donations[0].fromName, "Integration Test Donor");
  assert.equal(getRes.body.donations[0].amount, donationAmount);

  // Treasury cash should have increased by the donation amount
  const cash = await getPartyCash(partySlug);
  assert.equal(cash, initialCash + donationAmount, "treasury.cash must increase by the donation amount");
});

test("PARTY FINANCE: two donations are cumulative in treasury.cash", async () => {
  const { partySlug } = await seedParty({ initialCash: 0 });

  await adminClient.post(`/api/parties/${partySlug}/donations`, {
    fromName: "Donor A", amount: 1000,
  });
  await adminClient.post(`/api/parties/${partySlug}/donations`, {
    fromName: "Donor B", amount: 2000,
  });

  const cash = await getPartyCash(partySlug);
  assert.equal(cash, 3000, "treasury.cash must be the sum of both donations");
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Party finance — RBAC boundaries
// ═════════════════════════════════════════════════════════════════════════════

test("PARTY FINANCE RBAC: regular user cannot add donation (403)", async () => {
  const { partySlug } = await seedParty();
  const { status } = await regularClient.post(`/api/parties/${partySlug}/donations`, {
    fromName: "Unauthorized Donor",
    amount:   100,
  });
  assert.equal(status, 403, "regular user must be rejected from adding a donation");
});

test("PARTY FINANCE RBAC: regular user cannot read donations without party role (403)", async () => {
  const { partySlug } = await seedParty();
  const { status } = await regularClient.get(`/api/parties/${partySlug}/donations`);
  assert.equal(status, 403, "regular user must be rejected from reading donations");
});

test("PARTY FINANCE RBAC: mod can add donation", async () => {
  const { partySlug } = await seedParty();
  const { status, body } = await modClient.post(`/api/parties/${partySlug}/donations`, {
    fromName: "Mod Donor",
    amount:   500,
  });
  assert.equal(status, 200, `mod donation POST should succeed; got: ${JSON.stringify(body)}`);
  assert.ok(body.ok);
});

test("PARTY FINANCE RBAC: unauthenticated donation POST returns 403 (CSRF fires before auth)", async () => {
  const { partySlug } = await seedParty();
  const { status } = await anonClient().post(`/api/parties/${partySlug}/donations`, {
    fromName: "Anon",
    amount:   1,
  });
  assert.equal(status, 403, "unauthenticated donation must be rejected before auth guard");
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. Parliament status — speaker write, read consistency
// ═════════════════════════════════════════════════════════════════════════════

test("PARLIAMENT STATUS: speaker can update government type, GET reflects the change", async () => {
  const update = {
    governmentType:           "Minority",
    governingParties:         ["Labour"],
    confidenceSupplyParties:  ["Liberal Democrat"],
    oppositionParties:        ["Conservative"],
  };

  const putRes = await speakerClient.put("/api/parliament/status", update);
  assert.equal(putRes.status, 200, `speaker PUT failed: ${JSON.stringify(putRes.body)}`);
  assert.ok(putRes.body.ok, "PUT response should have ok:true");

  // Read back with any authenticated client
  const getRes = await regularClient.get("/api/parliament/status");
  assert.equal(getRes.status, 200, `GET /api/parliament/status failed: ${JSON.stringify(getRes.body)}`);
  assert.equal(getRes.body.governmentType, "Minority", "governmentType must reflect the speaker's update");
  assert.deepEqual(getRes.body.governingParties, ["Labour"], "governingParties must be persisted");
  assert.deepEqual(getRes.body.confidenceSupplyParties, ["Liberal Democrat"]);
  assert.deepEqual(getRes.body.oppositionParties, ["Conservative"]);
});

test("PARLIAMENT STATUS: admin can update parliament status", async () => {
  const { status, body } = await adminClient.put("/api/parliament/status", {
    governmentType:          "Majority",
    governingParties:        ["Labour"],
    confidenceSupplyParties: [],
    oppositionParties:       ["Conservative"],
  });
  assert.equal(status, 200, `admin PUT failed: ${JSON.stringify(body)}`);
  assert.ok(body.ok);
});

test("PARLIAMENT STATUS: mod can update parliament status", async () => {
  const { status, body } = await modClient.put("/api/parliament/status", {
    governmentType:          "Coalition",
    governingParties:        ["Labour", "Liberal Democrat"],
    confidenceSupplyParties: [],
    oppositionParties:       ["Conservative"],
  });
  assert.equal(status, 200, `mod PUT failed: ${JSON.stringify(body)}`);
  assert.ok(body.ok);
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. Parliament status — RBAC boundaries
// ═════════════════════════════════════════════════════════════════════════════

test("PARLIAMENT STATUS RBAC: regular user cannot update parliament status (403)", async () => {
  const { status } = await regularClient.put("/api/parliament/status", {
    governmentType:          "Majority",
    governingParties:        ["Labour"],
    confidenceSupplyParties: [],
    oppositionParties:       [],
  });
  assert.equal(status, 403, "regular user must be rejected from updating parliament status");
});

test("PARLIAMENT STATUS RBAC: unauthenticated PUT returns 403 (CSRF fires before auth)", async () => {
  const { status } = await anonClient().put("/api/parliament/status", {
    governmentType:          "Majority",
    governingParties:        [],
    confidenceSupplyParties: [],
    oppositionParties:       [],
  });
  assert.equal(status, 403, "unauthenticated PUT must be rejected before reaching auth guard");
});

test("PARLIAMENT STATUS RBAC: unauthenticated GET returns 401", async () => {
  const { status } = await anonClient().get("/api/parliament/status");
  assert.equal(status, 401, "unauthenticated GET must return 401");
});

test("PARLIAMENT STATUS: invalid governmentType returns 400", async () => {
  const { status, body } = await adminClient.put("/api/parliament/status", {
    governmentType:          "InvalidType",
    governingParties:        [],
    confidenceSupplyParties: [],
    oppositionParties:       [],
  });
  assert.equal(status, 400, `invalid governmentType should be rejected with 400; got: ${JSON.stringify(body)}`);
});
