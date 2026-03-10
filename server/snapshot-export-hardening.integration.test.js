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

process.env.SNAPSHOT_EXPORT_RATE_LIMIT_MAX = "2";

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
    [snapshotId, "test-seed", "test-snapshot", JSON.stringify({ gameState: { month: "August", year: 1997 }, bills: [] })]
  );
  await pool.query(
    `INSERT INTO app_state_current (id, snapshot_id)
     VALUES ('main', $1)
     ON CONFLICT (id) DO UPDATE SET snapshot_id = EXCLUDED.snapshot_id`,
    [snapshotId]
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

test("admin can export snapshot", async () => {
  const admin = await seedUserAndCharacter({ roles: ["admin"] });
  const c = client();
  await c.login(admin.email, admin.password);

  const { status, body, response } = await c.get("/api/admin/export-snapshot");

  assert.equal(status, 200);
  assert.equal(typeof body, "object");
  assert.ok(body.snapshotId, "response should include snapshotId");
  assert.equal(body.meta?.exportType, "state_snapshot");
  assert.ok(Number(body.meta?.estimatedDataSizeBytes) >= 0);
  assert.match(response.headers.get("content-disposition") || "", /attachment; filename=/);
});

test("non-admin actor is rejected from snapshot export", async () => {
  const player = await seedUserAndCharacter({ roles: [] });
  const c = client();
  await c.login(player.email, player.password);

  const { status, body } = await c.get("/api/admin/export-snapshot");

  assert.equal(status, 403);
  assert.match(String(body.error || ""), /admin role required/i);
});

test("repeated export attempts are rate-limited", async () => {
  const admin = await seedUserAndCharacter({ roles: ["admin"] });
  const c = client();
  await c.login(admin.email, admin.password);

  const first = await c.get("/api/admin/export-snapshot");
  const second = await c.get("/api/admin/export-snapshot");
  const third = await c.get("/api/admin/export-snapshot");

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(third.status, 429);
  assert.match(String(third.body.error || ""), /too many snapshot export requests/i);
});

test("snapshot export writes an audit entry", async () => {
  const admin = await seedUserAndCharacter({ roles: ["admin"] });
  const c = client();
  await c.login(admin.email, admin.password);

  const { status } = await c.get("/api/admin/export-snapshot");
  assert.equal(status, 200);

  const { rows } = await pool.query(
    `SELECT action, target, details
       FROM audit_log
      WHERE action = 'admin.export-snapshot.success'
      ORDER BY created_at DESC
      LIMIT 1`
  );

  assert.equal(rows.length, 1, "expected one success audit row");
  assert.equal(rows[0].target.startsWith("state_snapshots:"), true);
  assert.equal(rows[0].details?.action, "admin.export-snapshot");
  assert.equal(rows[0].details?.success, true);
  assert.ok(rows[0].details?.eventAt, "eventAt should be present");
});
