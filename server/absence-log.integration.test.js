/**
 * Integration tests: absence / delegation log.
 *
 * Exercises PATCH /api/me/absent (which must write audit_log entries) and
 * GET /api/control-panel/absence-log (staff-only read endpoint).
 *
 * Requirements tested:
 *  1. PATCH absent=true with valid delegatedTo → audit_log entry created, correct fields.
 *  2. PATCH absent=false → audit_log entry created marking "returned active".
 *  3. Delegating to a same-party, active character → logged with resolved target.
 *  4. Delegating to an invalid target (other party / non-existent) → target nulled,
 *     log entry captures the attempted value.
 *  5. GET /api/control-panel/absence-log requires staff access (401/403 otherwise).
 *  6. GET /api/control-panel/absence-log returns entries + currentAbsent.
 *
 * Run with:
 *   NODE_ENV=test \
 *   DATABASE_URL=postgresql://rb_test_user:rb_test_pw@localhost:5432/rb_test \
 *   SESSION_SECRET=test-secret \
 *   node --test server/absence-log.integration.test.js
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
import { app, ensureSchema } from "./index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Global setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

let server;
let baseUrl;
let closeServer;

before(async () => {
  await createTestSchema();
  const started = await startTestServer(app);
  server      = started.server;
  baseUrl     = started.baseUrl;
  closeServer = started.close;
});

after(async () => {
  if (typeof closeServer === "function") {
    try { await closeServer(); } catch { /* ignore */ }
  }
  try { await dropTestSchema(); } catch { /* ignore */ }
  await pool.end();
});

function client() { return new TestClient(baseUrl); }

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function getLatestAbsenceEntry(charId) {
  const { rows } = await pool.query(
    `SELECT * FROM audit_log
      WHERE action = 'absence.updated'
        AND details->>'characterId' = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [charId]
  );
  return rows[0] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. absent=true with valid same-party delegate → log entry written
// ─────────────────────────────────────────────────────────────────────────────

test("PATCH /api/me/absent: absent=true with valid same-party delegatee writes audit log", async () => {
  const { charId: actorId, email, password } = await seedUserAndCharacter({ party: "Labour", role: "backbencher" });
  const { charId: targetId }                 = await seedUserAndCharacter({ party: "Labour", role: "backbencher" });

  // Fetch target name to use as delegatedTo
  const { rows: targetRows } = await pool.query(`SELECT name FROM characters WHERE id = $1`, [targetId]);
  const targetName = targetRows[0].name;

  const c = client();
  await c.login(email, password);

  const { status, body } = await c.patch("/api/me/absent", { absent: true, delegatedTo: targetName });
  assert.equal(status, 200);
  assert.equal(body.ok, true);

  const entry = await getLatestAbsenceEntry(actorId);
  assert.ok(entry, "Audit log entry should exist");
  assert.equal(entry.action, "absence.updated");

  const details = entry.details;
  assert.equal(details.after.absent, true,        "after.absent should be true");
  assert.equal(details.after.delegatedTo, targetName, "after.delegatedTo should be the target name");
  assert.equal(details.resolvedTargetName, targetName, "resolvedTargetName should be captured");
  assert.equal(details.party, "Labour",           "party should be recorded");
  assert.equal(details.characterId, actorId,      "characterId should be recorded");
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. absent=false → log entry marking return active
// ─────────────────────────────────────────────────────────────────────────────

test("PATCH /api/me/absent: absent=false writes audit log entry with absent=false", async () => {
  const { charId: actorId, email, password } = await seedUserAndCharacter({ party: "Conservative", role: "backbencher" });
  const { charId: targetId }                 = await seedUserAndCharacter({ party: "Conservative", role: "backbencher" });

  const { rows: targetRows } = await pool.query(`SELECT name FROM characters WHERE id = $1`, [targetId]);
  const targetName = targetRows[0].name;

  const c = client();
  await c.login(email, password);

  // First go absent
  await c.patch("/api/me/absent", { absent: true, delegatedTo: targetName });

  // Then return active
  const { status, body } = await c.patch("/api/me/absent", { absent: false, delegatedTo: null });
  assert.equal(status, 200);
  assert.equal(body.ok, true);

  const entry = await getLatestAbsenceEntry(actorId);
  assert.ok(entry, "Audit log entry should exist");
  assert.equal(entry.details.after.absent,       false, "after.absent should be false");
  assert.equal(entry.details.after.delegatedTo,  null,  "after.delegatedTo should be null");
  assert.equal(entry.details.before.absent,      true,  "before.absent should record previous state");
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Delegating to a same-party active character is accepted and logged
// ─────────────────────────────────────────────────────────────────────────────

test("PATCH /api/me/absent: valid same-party delegation accepted and target stored in DB", async () => {
  const { charId: actorId, email, password } = await seedUserAndCharacter({ party: "Liberal Democrat", role: "backbencher" });
  const { charId: targetId }                 = await seedUserAndCharacter({ party: "Liberal Democrat", role: "backbencher" });

  const { rows: targetRows } = await pool.query(`SELECT name FROM characters WHERE id = $1`, [targetId]);
  const targetName = targetRows[0].name;

  const c = client();
  await c.login(email, password);

  const { status } = await c.patch("/api/me/absent", { absent: true, delegatedTo: targetName });
  assert.equal(status, 200);

  // Verify DB state
  const { rows: charRows } = await pool.query(
    `SELECT absent, delegated_to FROM characters WHERE id = $1`,
    [actorId]
  );
  assert.equal(charRows[0].absent,       true,       "DB absent should be true");
  assert.equal(charRows[0].delegated_to, targetName, "DB delegated_to should be the target name");

  const entry = await getLatestAbsenceEntry(actorId);
  assert.ok(entry);
  assert.equal(entry.details.resolvedTargetName, targetName);
  assert.equal(entry.details.attemptedDelegatedTo, targetName);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Delegating to an invalid target is nulled; attempted value is logged
// ─────────────────────────────────────────────────────────────────────────────

test("PATCH /api/me/absent: invalid delegation target is nulled but attempted value is logged", async () => {
  const { charId: actorId, email, password } = await seedUserAndCharacter({ party: "Labour",       role: "backbencher" });
  const { charId: otherId }                  = await seedUserAndCharacter({ party: "Conservative", role: "backbencher" });

  const { rows: otherRows } = await pool.query(`SELECT name FROM characters WHERE id = $1`, [otherId]);
  const otherPartyName = otherRows[0].name; // other-party character

  const c = client();
  await c.login(email, password);

  // Delegate to a character in a different party — should be nulled
  const { status, body } = await c.patch("/api/me/absent", { absent: true, delegatedTo: otherPartyName });
  assert.equal(status, 200);
  assert.equal(body.ok, true);

  // DB should have delegated_to = null (invalid target cleared)
  const { rows: charRows } = await pool.query(
    `SELECT absent, delegated_to FROM characters WHERE id = $1`,
    [actorId]
  );
  assert.equal(charRows[0].absent,       true, "absent should still be set to true");
  assert.equal(charRows[0].delegated_to, null, "delegated_to should be null (invalid target cleared)");

  // Log entry should capture the attempted value
  const entry = await getLatestAbsenceEntry(actorId);
  assert.ok(entry);
  assert.equal(entry.details.attemptedDelegatedTo, otherPartyName, "attempted target should be logged");
  assert.equal(entry.details.after.delegatedTo,    null,           "effective delegatedTo should be null");
  assert.equal(entry.details.resolvedTargetName,   null,           "resolvedTargetName should be null");
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. GET /api/control-panel/absence-log requires staff access
// ─────────────────────────────────────────────────────────────────────────────

test("GET /api/control-panel/absence-log: 401 when not logged in", async () => {
  const c = client();
  const { status } = await c.get("/api/control-panel/absence-log");
  assert.equal(status, 401);
});

test("GET /api/control-panel/absence-log: 403 when logged in as a non-staff player", async () => {
  const { email, password } = await seedUserAndCharacter({ party: "Labour", role: "backbencher" });
  const c = client();
  await c.login(email, password);
  const { status } = await c.get("/api/control-panel/absence-log");
  assert.equal(status, 403);
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. GET /api/control-panel/absence-log returns entries + currentAbsent
// ─────────────────────────────────────────────────────────────────────────────

test("GET /api/control-panel/absence-log: returns entries and currentAbsent for mod user", async () => {
  // Seed a mod user
  const { charId: modCharId, email: modEmail, password: modPassword } = await seedUserAndCharacter({
    party: "Labour",
    role: "backbencher",
    roles: ["mod"],
  });

  // Seed a regular player and their delegate, then set absent
  const { charId: playerCharId, email: playerEmail, password: playerPassword } = await seedUserAndCharacter({ party: "Labour", role: "backbencher" });
  const { charId: delegateId }                                                  = await seedUserAndCharacter({ party: "Labour", role: "backbencher" });
  const { rows: delegateRows } = await pool.query(`SELECT name FROM characters WHERE id = $1`, [delegateId]);
  const delegateName = delegateRows[0].name;

  const playerClient = client();
  await playerClient.login(playerEmail, playerPassword);
  await playerClient.patch("/api/me/absent", { absent: true, delegatedTo: delegateName });

  // Fetch the log as a mod
  const modClient = client();
  await modClient.login(modEmail, modPassword);
  const { status, body } = await modClient.get("/api/control-panel/absence-log");

  assert.equal(status, 200);
  assert.ok(Array.isArray(body.entries),      "entries should be an array");
  assert.ok(Array.isArray(body.currentAbsent), "currentAbsent should be an array");

  // At least one entry should exist (the one we just created)
  assert.ok(body.entries.length > 0, "entries should not be empty");

  // currentAbsent should include the player character
  const absent = body.currentAbsent.find((c) => c.id === playerCharId);
  assert.ok(absent,                    "currently absent character should appear in currentAbsent");
  assert.equal(absent.delegated_to, delegateName, "delegated_to should be the delegate name");
});
