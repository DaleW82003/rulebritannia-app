import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "./db.js";
import {
  createTestSchema,
  dropTestSchema,
  seedUserAndCharacter,
  startTestServer,
  TestClient,
} from "./test-helpers.js";

const { app } = await import("./index.js");

let baseUrl;
let closeServer;

before(async () => {
  await createTestSchema();
  const started = await startTestServer(app);
  baseUrl = started.baseUrl;
  closeServer = started.close;
});

beforeEach(async () => {
  const snapshotId = randomUUID();
  await pool.query(
    `INSERT INTO state_snapshots (id, created_by, label, data)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [snapshotId, "test-seed", "status-snapshot", JSON.stringify({ gameState: { month: "August", year: 1997 }, bills: [] })]
  );
  await pool.query(
    `INSERT INTO app_state_current (id, snapshot_id)
     VALUES ('main', $1)
     ON CONFLICT (id) DO UPDATE SET snapshot_id = EXCLUDED.snapshot_id`,
    [snapshotId]
  );
  await pool.query(
    `INSERT INTO audit_log (actor_id, action, target, details)
     VALUES
       ('tester-1', 'snapshot.restore', 'state_snapshots:' || $1, $2::jsonb),
       ('tester-2', 'admin.rebuild-cache', 'state_snapshots:main', $3::jsonb)`,
    [
      snapshotId,
      JSON.stringify({ snapshotId, cacheRebuilt: false, cacheWarning: "manual rebuild needed" }),
      JSON.stringify({ status: "failed", message: "sync failed" }),
    ]
  );
});

after(async () => {
  if (typeof closeServer === "function") {
    try { await closeServer(); } catch { /* ignore */ }
  }
  try { await dropTestSchema(); } catch { /* ignore */ }
  await pool.end();
});

function client() {
  return new TestClient(baseUrl);
}

test("admin can read snapshot status telemetry", async () => {
  const admin = await seedUserAndCharacter({ roles: ["admin"] });
  const c = client();
  await c.login(admin.email, admin.password);

  const { status, body } = await c.get("/api/admin/snapshot-status");

  assert.equal(status, 200);
  assert.ok(body.currentSnapshot?.id, "current snapshot id should be present");
  assert.equal(typeof body.currentSnapshot?.label, "string");
  assert.equal(body.lastRestore?.cacheRebuilt, false);
  assert.equal(body.lastRestore?.warning, "manual rebuild needed");
  assert.equal(body.lastRebuild?.status, "failed");
  assert.equal(body.freeze?.isFrozen, false);
});

test("non-admin cannot read snapshot status telemetry", async () => {
  const user = await seedUserAndCharacter({ roles: [] });
  const c = client();
  await c.login(user.email, user.password);

  const { status, body } = await c.get("/api/admin/snapshot-status");

  assert.equal(status, 403);
  assert.match(String(body.error || ""), /admin role required/i);
});
