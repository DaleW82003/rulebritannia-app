/**
 * True HTTP+DB integration tests: parliamentary-to-political-state flow.
 *
 * Tests use the real Express application, a real PostgreSQL database, and
 * Node's built-in fetch to exercise the actual route → handler → DB → response
 * wiring — not just the isolated logic covered by the pure unit tests in
 * parliamentary-political-state.integration.test.js.
 *
 * Each test suite:
 *  1. Starts the server on a free port (no collision risk)
 *  2. Seeds the minimal DB state it needs
 *  3. Makes real HTTP requests using TestClient (session cookies + CSRF managed)
 *  4. Asserts on the HTTP response AND on the DB rows directly
 *  5. Tears down its own data so tests don't interfere
 *
 * Run with:
 *   NODE_ENV=test \
 *   DATABASE_URL=postgresql://rb_test_user:rb_test_pw@localhost:5432/rb_test \
 *   SESSION_SECRET=test-secret \
 *   node --test server/parliamentary.integration.test.js
 */

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { pool } from "./db.js";
import {
  createTestSchema,
  dropTestSchema,
  seedUserAndCharacter,
  seedBill,
  startTestServer,
  TestClient,
  waitFor,
} from "./test-helpers.js";
import { app, ensureSchema } from "./index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Global setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

let server;
let baseUrl;
let closeServer;

before(async () => {
  // Run our test-specific schema (correct FK ordering for a fresh DB)
  await createTestSchema();
  const started = await startTestServer(app);
  server      = started.server;
  baseUrl     = started.baseUrl;
  closeServer = started.close;
});

after(async () => {
  // Best-effort teardown — use try/catch so a setup failure doesn't prevent cleanup.
  if (typeof closeServer === "function") {
    try { await closeServer(); } catch { /* ignore */ }
  }
  try { await dropTestSchema(); } catch { /* ignore */ }
  await pool.end();
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build a fresh client for each test case
// ─────────────────────────────────────────────────────────────────────────────
function client() { return new TestClient(baseUrl); }

// ═════════════════════════════════════════════════════════════════════════════
// 1. Amendment submission — DB persistence and retrieval
// ═════════════════════════════════════════════════════════════════════════════

test("amendment submission: row is persisted and retrievable after POST /api/bills/:id/amendments", async () => {
  // Seed: author user + character + bill
  const { charId, email, password } = await seedUserAndCharacter({ party: "Labour", role: "backbencher" });
  const billId = await seedBill(charId);

  const c = client();
  await c.login(email, password);

  // Submit amendment as the bill author — auto-accepted path
  const { status, body } = await c.post(
    `/api/bills/${billId}/amendments`,
    { title: "Integration Test Amendment", type: "replace", articleNumber: 1, text: "New text." }
  );

  assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  assert.ok(body.ok,                        "response body should have ok:true");
  assert.ok(body.amendment,                 "response should include amendment object");
  assert.equal(body.amendment.bill_id,  billId,   "amendment bill_id mismatch");
  assert.equal(body.amendment.title,    "Integration Test Amendment", "title mismatch");
  assert.equal(body.amendment.status,   "accepted",  "author-submitted amendment should be auto-accepted");
  assert.ok(body.autoAccepted,          "autoAccepted flag should be true for author");

  // Verify the row is actually in the DB
  const { rows: dbRows } = await pool.query(
    "SELECT * FROM bill_amendments WHERE bill_id = $1",
    [billId]
  );
  assert.equal(dbRows.length, 1, "exactly one amendment row should exist in DB");
  assert.equal(dbRows[0].title,  "Integration Test Amendment");
  assert.equal(dbRows[0].status, "accepted");

  // Verify it is retrievable via the read API
  const { status: getStatus, body: getBody } = await c.get(
    `/api/bills/${billId}/amendments`
  );
  assert.equal(getStatus, 200);
  assert.ok(Array.isArray(getBody.amendments), "GET should return amendments array");
  assert.equal(getBody.amendments.length, 1);
  assert.equal(getBody.amendments[0].title, "Integration Test Amendment");
});

test("amendment submission: non-author gets 'proposed' status", async () => {
  const author = await seedUserAndCharacter({ party: "Labour",       role: "backbencher" });
  const other  = await seedUserAndCharacter({ party: "Conservative", role: "backbencher" });
  const billId = await seedBill(author.charId);

  const c = client();
  await c.login(other.email, other.password);

  const { status, body } = await c.post(
    `/api/bills/${billId}/amendments`,
    { title: "Opposition Amendment", type: "insert", articleNumber: 2, text: "Additional text." }
  );

  assert.equal(status, 201);
  assert.equal(body.amendment.status, "proposed",  "non-author amendment must start as proposed");
  assert.equal(body.autoAccepted,     false,        "autoAccepted must be false for non-author");
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Amendment decision — permissions (authorised / unauthorised)
// ═════════════════════════════════════════════════════════════════════════════

test("PERMISSIONS: authorised bill author can accept a proposed amendment", async () => {
  const author = await seedUserAndCharacter({ party: "Labour", role: "backbencher" });
  const other  = await seedUserAndCharacter({ party: "Conservative", role: "backbencher" });
  const billId = await seedBill(author.charId);

  // Other MP submits amendment → proposed
  const otherClient = client();
  await otherClient.login(other.email, other.password);
  const { body: subBody } = await otherClient.post(
    `/api/bills/${billId}/amendments`,
    { title: "Proposed Amendment", type: "replace", articleNumber: 1, text: "Replaced text." }
  );
  const amendId = subBody.amendment.id;

  // Author accepts
  const authorClient = client();
  await authorClient.login(author.email, author.password);
  const { status, body } = await authorClient.post(
    `/api/bills/${billId}/amendments/${amendId}/decide`,
    { decision: "accept" }
  );

  assert.equal(status, 200,      `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert.ok(body.ok,             "response body should have ok:true");
  assert.equal(body.amendment.status, "accepted", "amendment must be accepted after author decision");

  // Verify DB
  const { rows } = await pool.query(
    "SELECT status FROM bill_amendments WHERE bill_id = $1 AND id = $2",
    [billId, amendId]
  );
  assert.equal(rows[0].status, "accepted", "DB must reflect accepted status");
});

test("PERMISSIONS: non-author without staff role is rejected with 403 on amendment decide", async () => {
  const author    = await seedUserAndCharacter({ party: "Labour",       role: "backbencher" });
  const other     = await seedUserAndCharacter({ party: "Conservative", role: "backbencher" });
  const interloper = await seedUserAndCharacter({ party: "Labour",      role: "backbencher" });
  const billId    = await seedBill(author.charId);

  // Other MP submits amendment
  const otherClient = client();
  await otherClient.login(other.email, other.password);
  const { body: subBody } = await otherClient.post(
    `/api/bills/${billId}/amendments`,
    { title: "Some Amendment", type: "delete", articleNumber: 2, text: "" }
  );
  const amendId = subBody.amendment.id;

  // Interloper (not the author, not staff) tries to decide — must be rejected
  const interloperClient = client();
  await interloperClient.login(interloper.email, interloper.password);
  const { status, body } = await interloperClient.post(
    `/api/bills/${billId}/amendments/${amendId}/decide`,
    { decision: "refuse" }
  );

  assert.equal(status, 403, `Expected 403 for non-authorised actor, got ${status}`);
  assert.ok(body.error,     "error message should be present");

  // Amendment remains proposed in DB
  const { rows } = await pool.query(
    "SELECT status FROM bill_amendments WHERE bill_id = $1 AND id = $2",
    [billId, amendId]
  );
  assert.equal(rows[0].status, "proposed", "DB status must be unchanged");
});

test("PERMISSIONS: admin staff can decide on an amendment they did not author", async () => {
  const author = await seedUserAndCharacter({ party: "Labour",       role: "backbencher" });
  const admin  = await seedUserAndCharacter({ party: "Conservative", role: "backbencher", roles: ["admin"] });
  const billId = await seedBill(author.charId);

  const authorClient = client();
  await authorClient.login(author.email, author.password);
  await authorClient.post(
    `/api/bills/${billId}/amendments`,
    { title: "Author's Own Amendment", type: "insert", articleNumber: 1, text: "Extra clause." }
  );

  // Get a separate proposed amendment — seed one directly in DB for admin to decide on
  const other = await seedUserAndCharacter({ party: "Plaid Cymru", role: "backbencher" });
  const otherC = client();
  await otherC.login(other.email, other.password);
  const { body: subBody } = await otherC.post(
    `/api/bills/${billId}/amendments`,
    { title: "Third Party Amendment", type: "replace", articleNumber: 2, text: "Admin decides." }
  );
  const amendId = subBody.amendment.id;

  // Admin decides
  const adminClient = client();
  await adminClient.login(admin.email, admin.password);
  const { status, body } = await adminClient.post(
    `/api/bills/${billId}/amendments/${amendId}/decide`,
    { decision: "refuse" }
  );

  assert.equal(status, 200,       `Admin should be authorised, got ${status}: ${JSON.stringify(body)}`);
  assert.equal(body.amendment.status, "refused", "amendment should be refused by admin decision");
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Division close — stable persisted immutable_result
// ═════════════════════════════════════════════════════════════════════════════

test("division close: immutable_result is persisted and stable after POST /api/divisions/:id/close", async () => {
  // Seed an admin user (required to close a division)
  const admin = await seedUserAndCharacter({ roles: ["admin"], party: "Labour", role: "backbencher" });
  const voter = await seedUserAndCharacter({ party: "Labour", role: "backbencher" });

  // Seed a division row directly (simulating a pre-existing open division)
  const { rows: divRows } = await pool.query(
    `INSERT INTO divisions (entity_type, entity_id, title, status)
     VALUES ('bill', 'BILL-TEST-CLOSE', 'Test Division for Close', 'open')
     RETURNING id`
  );
  const divisionId = divRows[0].id;

  // Cast a vote (must be authenticated as the voter)
  const voterClient = client();
  await voterClient.login(voter.email, voter.password);
  const voteResp = await voterClient.post(`/api/divisions/${divisionId}/vote`, { vote: "aye" });
  assert.equal(voteResp.status, 200, `Vote cast failed: ${JSON.stringify(voteResp.body)}`);

  // Close the division (admin only)
  const adminClient = client();
  await adminClient.login(admin.email, admin.password);
  const { status, body } = await adminClient.post(`/api/divisions/${divisionId}/close`, {});

  assert.equal(status, 200,             `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert.ok(body.ok,                    "response body should have ok:true");
  assert.ok(body.immutableResult,       "response must include immutableResult");
  assert.ok("tally"    in body.immutableResult, "immutableResult must have tally");
  assert.ok("outcome"  in body.immutableResult, "immutableResult must have outcome");
  assert.ok("closedAt" in body.immutableResult, "immutableResult must have closedAt");
  assert.ok(["passed","failed","tied"].includes(body.immutableResult.outcome));

  // Verify it is persisted in the DB
  const { rows: dbDiv } = await pool.query(
    "SELECT status, outcome, immutable_result FROM divisions WHERE id = $1",
    [divisionId]
  );
  assert.equal(dbDiv[0].status,  "closed",                       "division must be closed in DB");
  assert.equal(dbDiv[0].outcome, body.immutableResult.outcome,   "DB outcome must match response");
  assert.ok(dbDiv[0].immutable_result,                           "immutable_result must be persisted");
  assert.equal(
    dbDiv[0].immutable_result.outcome,
    body.immutableResult.outcome,
    "persisted JSON outcome must match HTTP response"
  );
  assert.equal(
    dbDiv[0].immutable_result.tally.aye,
    body.immutableResult.tally.aye,
    "persisted tally.aye must match response"
  );

  // Attempting to close again must return 409
  const { status: reopenStatus } = await adminClient.post(`/api/divisions/${divisionId}/close`, {});
  assert.equal(reopenStatus, 409, "Closing an already-closed division must be 409");
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Rebellion logging — row written on defiant vote, no duplicates
// ═════════════════════════════════════════════════════════════════════════════

test("rebellion log: row created when MP votes against a 3-line whip", async () => {
  const mp    = await seedUserAndCharacter({ party: "Labour", role: "backbencher" });
  const admin = await seedUserAndCharacter({ roles: ["admin"], party: "Labour", role: "backbencher" });

  // Create a division and set a 3-line whip instruction.
  // party_slug must match characters.party exactly (case-sensitive in the DB query).
  const { rows: divRows } = await pool.query(
    `INSERT INTO divisions (entity_type, entity_id, title) VALUES ('motion', 'MOTION-1', 'Rebellion Test')
     RETURNING id`
  );
  const divId = divRows[0].id;
  await pool.query(
    `INSERT INTO division_party_instructions (division_id, party_slug, position, whip_level)
     VALUES ($1, 'Labour', 'aye', 3)`,
    [divId]
  );

  // MP votes "no" — against the 3-line "aye" instruction
  const mpClient = client();
  await mpClient.login(mp.email, mp.password);
  const { status: voteStatus } = await mpClient.post(`/api/divisions/${divId}/vote`, { vote: "no" });
  assert.equal(voteStatus, 200);

  // Rebellion row must be in DB
  const { rows: rebRows } = await pool.query(
    "SELECT * FROM division_rebellion_log WHERE division_id = $1 AND character_id = $2",
    [divId, mp.charId]
  );
  assert.equal(rebRows.length, 1,      "exactly one rebellion row per (division, character)");
  assert.equal(rebRows[0].mp_vote,     "no",    "rebellion row must record the actual vote");
  assert.equal(rebRows[0].party_position, "aye", "rebellion row must record the party position");
  assert.equal(Number(rebRows[0].whip_level), 3,  "rebellion row must record the whip level");
});

test("rebellion log: no duplicate — changing vote replaces the rebellion entry", async () => {
  const mp = await seedUserAndCharacter({ party: "Conservative", role: "backbencher" });

  const { rows: divRows } = await pool.query(
    `INSERT INTO divisions (entity_type, entity_id, title) VALUES ('motion', 'MOTION-2', 'No Duplicate Test')
     RETURNING id`
  );
  const divId = divRows[0].id;
  await pool.query(
    `INSERT INTO division_party_instructions (division_id, party_slug, position, whip_level)
     VALUES ($1, 'Conservative', 'aye', 2)`,
    [divId]
  );

  const mpClient = client();
  await mpClient.login(mp.email, mp.password);

  // Vote #1: defiant ("no" vs whip "aye")
  await mpClient.post(`/api/divisions/${divId}/vote`, { vote: "no" });

  // Vote #2: change to abstain (still defiant)
  await mpClient.post(`/api/divisions/${divId}/vote`, { vote: "abstain" });

  // Still exactly one rebellion row
  const { rows } = await pool.query(
    "SELECT * FROM division_rebellion_log WHERE division_id = $1 AND character_id = $2",
    [divId, mp.charId]
  );
  assert.equal(rows.length, 1, "changing a defiant vote must not create duplicate rebellion rows");
  assert.equal(rows[0].mp_vote, "abstain", "rebellion row must reflect the latest vote");
});

test("rebellion log: row removed when MP votes back to party line", async () => {
  const mp = await seedUserAndCharacter({ party: "Labour", role: "backbencher" });

  const { rows: divRows } = await pool.query(
    `INSERT INTO divisions (entity_type, entity_id, title) VALUES ('motion', 'MOTION-3', 'Reversion Test')
     RETURNING id`
  );
  const divId = divRows[0].id;
  await pool.query(
    `INSERT INTO division_party_instructions (division_id, party_slug, position, whip_level)
     VALUES ($1, 'Labour', 'no', 1)`,
    [divId]
  );

  const mpClient = client();
  await mpClient.login(mp.email, mp.password);

  // First defiant vote
  await mpClient.post(`/api/divisions/${divId}/vote`, { vote: "aye" });
  const { rows: afterDefiant } = await pool.query(
    "SELECT * FROM division_rebellion_log WHERE division_id = $1 AND character_id = $2",
    [divId, mp.charId]
  );
  assert.equal(afterDefiant.length, 1, "rebellion row created after defiant vote");

  // Revert to party line
  await mpClient.post(`/api/divisions/${divId}/vote`, { vote: "no" });
  const { rows: afterRevert } = await pool.query(
    "SELECT * FROM division_rebellion_log WHERE division_id = $1 AND character_id = $2",
    [divId, mp.charId]
  );
  assert.equal(afterRevert.length, 0, "rebellion row must be removed when MP votes back to party line");
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Political state — recompute triggered and visible via GET /api/me/political-state
// ═════════════════════════════════════════════════════════════════════════════

test("political state: GET /api/me/political-state returns structured state after division vote", async () => {
  const mp    = await seedUserAndCharacter({ party: "Labour", role: "backbencher" });
  const admin = await seedUserAndCharacter({ roles: ["admin"], party: "Labour", role: "backbencher" });

  // Create a division, cast a vote (triggers non-blocking recompute)
  const { rows: divRows } = await pool.query(
    `INSERT INTO divisions (entity_type, entity_id, title) VALUES ('bill', 'BILL-PS-1', 'PS Test Division')
     RETURNING id`
  );
  const divId = divRows[0].id;

  const mpClient = client();
  await mpClient.login(mp.email, mp.password);
  await mpClient.post(`/api/divisions/${divId}/vote`, { vote: "aye" });

  // GET /api/me/political-state triggers a fresh recompute synchronously
  const { status, body } = await mpClient.get("/api/me/political-state");

  assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert.ok(body.ok,                    "response must have ok:true");
  assert.ok(body.politicalState,        "politicalState object must be present");

  const ps = body.politicalState;
  assert.ok("capital_current"        in ps, "capital_current required");
  assert.ok("capital_trend"          in ps, "capital_trend required");
  assert.ok("momentum"               in ps, "momentum required");
  assert.ok("reputation"             in ps, "reputation required");
  assert.ok("party_pressure"         in ps, "party_pressure required");
  assert.ok("rebellion_risk"         in ps, "rebellion_risk required");
  assert.ok("constituency_pressure"  in ps, "constituency_pressure required");

  // Value bounds: pressures 0-100
  assert.ok(ps.party_pressure        >= 0 && ps.party_pressure        <= 100, "party_pressure out of bounds");
  assert.ok(ps.rebellion_risk        >= 0 && ps.rebellion_risk        <= 100, "rebellion_risk out of bounds");
  assert.ok(ps.constituency_pressure >= 0 && ps.constituency_pressure <= 100, "constituency_pressure out of bounds");

  // Momentum and reputation use only canonical label values
  assert.ok(["rising","stable","falling"].includes(ps.momentum),
    `unexpected momentum: ${ps.momentum}`);
  assert.ok(["excellent","good","neutral","poor","damaged"].includes(ps.reputation),
    `unexpected reputation: ${ps.reputation}`);
});

test("political state: rebellion increases party_pressure visible via the read API", async () => {
  const mp = await seedUserAndCharacter({ party: "Labour", role: "backbencher" });

  // Read baseline state (no rebellions yet)
  const mpClient = client();
  await mpClient.login(mp.email, mp.password);
  const { body: baseline } = await mpClient.get("/api/me/political-state");
  const baselinePressure = baseline.politicalState.party_pressure;

  // Create a 3-line whipped division and vote against it
  const { rows: divRows } = await pool.query(
    `INSERT INTO divisions (entity_type, entity_id, title)
     VALUES ('motion', 'MOTION-PS-2', 'Rebellion PS Test')
     RETURNING id`
  );
  const divId = divRows[0].id;
  await pool.query(
    `INSERT INTO division_party_instructions (division_id, party_slug, position, whip_level)
     VALUES ($1, 'Labour', 'aye', 3)`,
    [divId]
  );

  await mpClient.post(`/api/divisions/${divId}/vote`, { vote: "no" }); // defiant vote

  // Poll until rebellion row appears (non-blocking recompute might lag slightly)
  await waitFor(async () => {
    const { rows } = await pool.query(
      "SELECT id FROM division_rebellion_log WHERE character_id = $1 AND division_id = $2",
      [mp.charId, divId]
    );
    return rows.length > 0;
  }, { timeoutMs: 3000 });

  // Read political state after rebellion
  const { body: afterRebellion } = await mpClient.get("/api/me/political-state");
  const afterPressure = afterRebellion.politicalState.party_pressure;

  // Party pressure must have increased
  assert.ok(
    afterPressure > baselinePressure,
    `party_pressure should increase after rebellion: was ${baselinePressure}, now ${afterPressure}`
  );
});
