import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "./db.js";
import { app } from "./index.js";
import {
  createTestSchema,
  dropTestSchema,
  seedUserAndCharacter,
  seedBill,
  startTestServer,
  TestClient,
} from "./test-helpers.js";

let closeServer;
let baseUrl;

before(async () => {
  await createTestSchema();
  const started = await startTestServer(app);
  baseUrl = started.baseUrl;
  closeServer = started.close;
});

after(async () => {
  if (typeof closeServer === "function") {
    try { await closeServer(); } catch {}
  }
  try { await dropTestSchema(); } catch {}
  await pool.end();
});

function client() {
  return new TestClient(baseUrl);
}

test("admin can enable and disable simulation freeze", async () => {
  const { email, password } = await seedUserAndCharacter({ roles: ["admin"] });
  const c = client();
  await c.login(email, password);

  const enable = await c.post("/api/sim/freeze", { is_frozen: true, reason: "Incident response" });
  assert.equal(enable.status, 200);
  assert.equal(enable.body?.freeze?.is_frozen, true);
  assert.equal(enable.body?.freeze?.reason, "Incident response");

  const read = await c.get("/api/sim/freeze");
  assert.equal(read.status, 200);
  assert.equal(read.body?.freeze?.is_frozen, true);

  const disable = await c.post("/api/sim/freeze", { is_frozen: false, reason: "All clear" });
  assert.equal(disable.status, 200);
  assert.equal(disable.body?.freeze?.is_frozen, false);
});

test("non-staff user cannot toggle freeze", async () => {
  const { email, password } = await seedUserAndCharacter({ roles: [] });
  const c = client();
  await c.login(email, password);

  const res = await c.post("/api/sim/freeze", { is_frozen: true, reason: "Nope" });
  assert.equal(res.status, 403);
});

test("automatic/system-driven tick is blocked while frozen", async () => {
  const { email, password } = await seedUserAndCharacter({ roles: ["admin"] });
  const c = client();
  await c.login(email, password);

  await c.post("/api/sim/freeze", { is_frozen: true, reason: "Snapshot restore" });

  const tick = await c.post("/api/clock/tick", {});
  assert.equal(tick.status, 423);
  assert.equal(tick.body?.code, "SIMULATION_FROZEN");
});

test("player mutation route is blocked while frozen but read routes still work", async () => {
  const { charId: adminCharId, email: adminEmail, password: adminPassword } = await seedUserAndCharacter({ roles: ["admin"] });
  const { email, password } = await seedUserAndCharacter({ party: "Labour", role: "backbencher" });
  const billId = await seedBill(adminCharId, { id: "BILL-FREEZE-TEST" });

  const admin = client();
  const player = client();
  await admin.login(adminEmail, adminPassword);
  await admin.post("/api/sim/freeze", { is_frozen: true, reason: "Emergency maintenance" });

  await player.login(email, password);
  const mutation = await player.post(`/api/bills/${encodeURIComponent(billId)}/amendments`, {
    title: "Emergency amendment",
    type: "replace",
    articleNumber: 1,
    text: "Frozen should block this",
  });
  assert.equal(mutation.status, 423);
  assert.equal(mutation.body?.code, "SIMULATION_FROZEN");

  const read = await player.get("/api/clock");
  assert.equal(read.status, 200);
  assert.equal(typeof read.body?.sim_current_month, "number");

  // clean up freeze for test isolation
  await admin.post("/api/sim/freeze", { is_frozen: false, reason: "done" });
});
