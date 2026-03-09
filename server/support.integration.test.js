/**
 * Integration tests: Support ticketing system.
 *
 * Covers:
 *  - ticket creation and retrieval
 *  - permissions: player cannot access other user's ticket; staff can
 *  - status transitions: player finish/reopen; staff close/reopen
 *  - unread markers update as expected
 *  - staff labels and filtering
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
let playerClient;
let otherPlayerClient;

let adminUserId;
let playerUserId;

before(async () => {
  await createTestSchema();
  const started = await startTestServer(app);
  baseUrl     = started.baseUrl;
  closeServer = started.close;

  const adminUser       = await seedUserAndCharacter({ roles: ["admin"] });
  const playerUser      = await seedUserAndCharacter({ roles: [] });
  const otherPlayerUser = await seedUserAndCharacter({ roles: [] });

  adminUserId  = adminUser.userId;
  playerUserId = playerUser.userId;

  adminClient       = new TestClient(baseUrl);
  playerClient      = new TestClient(baseUrl);
  otherPlayerClient = new TestClient(baseUrl);

  await adminClient.login(adminUser.email, adminUser.password);
  await playerClient.login(playerUser.email, playerUser.password);
  await otherPlayerClient.login(otherPlayerUser.email, otherPlayerUser.password);
});

after(async () => {
  if (typeof closeServer === "function") {
    try { await closeServer(); } catch { /* ignore */ }
  }
  try { await dropTestSchema(); } catch { /* ignore */ }
  await pool.end();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Ticket creation
// ─────────────────────────────────────────────────────────────────────────────

test("PLAYER: can create a support ticket", async () => {
  const { status, body } = await playerClient.post("/api/support/tickets", {
    subject: "My first issue",
    category: "General",
    message: "This is my support message.",
  });

  assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  assert.ok(body.ok, "ok flag should be true");
  assert.ok(body.id, "id should be returned");

  // Verify in DB
  const { rows } = await pool.query("SELECT * FROM support_tickets WHERE id = $1", [body.id]);
  assert.equal(rows.length, 1, "ticket row must exist");
  assert.equal(rows[0].subject, "My first issue");
  assert.equal(rows[0].status, "open");

  const { rows: msgRows } = await pool.query(
    "SELECT * FROM support_messages WHERE ticket_id = $1", [body.id]
  );
  assert.equal(msgRows.length, 1, "initial message must exist");
  assert.equal(msgRows[0].body, "This is my support message.");
  assert.equal(msgRows[0].author_role, "player");
});

test("PLAYER: subject is required to create ticket", async () => {
  const { status, body } = await playerClient.post("/api/support/tickets", {
    message: "No subject",
  });
  assert.equal(status, 400, `Expected 400, got ${status}`);
  assert.ok(body.error, "error field must be present");
});

test("PLAYER: message is required to create ticket", async () => {
  const { status, body } = await playerClient.post("/api/support/tickets", {
    subject: "No message",
  });
  assert.equal(status, 400, `Expected 400, got ${status}`);
  assert.ok(body.error, "error field must be present");
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Ticket retrieval
// ─────────────────────────────────────────────────────────────────────────────

test("PLAYER: can list own tickets", async () => {
  // Create a ticket first
  const { body: createBody } = await playerClient.post("/api/support/tickets", {
    subject: "List test ticket",
    category: "General",
    message: "Check I can list this.",
  });
  const ticketId = createBody.id;

  const { status, body } = await playerClient.get("/api/support/tickets");
  assert.equal(status, 200, `Expected 200, got ${status}`);
  assert.ok(Array.isArray(body.tickets), "tickets must be an array");
  const found = body.tickets.find((t) => t.id === ticketId);
  assert.ok(found, "created ticket must appear in list");
});

test("PLAYER: can get own ticket with messages", async () => {
  const { body: createBody } = await playerClient.post("/api/support/tickets", {
    subject: "Thread test ticket",
    category: "Bug",
    message: "First message here.",
  });
  const ticketId = createBody.id;

  const { status, body } = await playerClient.get(`/api/support/tickets/${ticketId}`);
  assert.equal(status, 200, `Expected 200, got ${status}`);
  assert.equal(body.ticket.id, ticketId);
  assert.ok(Array.isArray(body.messages), "messages must be an array");
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].body, "First message here.");
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Permissions
// ─────────────────────────────────────────────────────────────────────────────

test("PLAYER: cannot access another player's ticket", async () => {
  // Player creates a ticket
  const { body: createBody } = await playerClient.post("/api/support/tickets", {
    subject: "Private ticket",
    category: "General",
    message: "Only I should see this.",
  });
  const ticketId = createBody.id;

  // Other player tries to access it
  const { status } = await otherPlayerClient.get(`/api/support/tickets/${ticketId}`);
  assert.equal(status, 403, `Expected 403 for unauthorized access, got ${status}`);
});

test("PLAYER: unauthenticated cannot access player endpoints", async () => {
  const anonClient = new TestClient(baseUrl);
  const { status } = await anonClient.get("/api/support/tickets");
  assert.equal(status, 401, `Expected 401 for unauthenticated, got ${status}`);
});

test("STAFF: admin can access any ticket", async () => {
  const { body: createBody } = await playerClient.post("/api/support/tickets", {
    subject: "Staff accessible ticket",
    category: "General",
    message: "Staff should see this.",
  });
  const ticketId = createBody.id;

  const { status, body } = await adminClient.get(`/api/support/staff/tickets/${ticketId}`);
  assert.equal(status, 200, `Staff should access any ticket, got ${status}`);
  assert.equal(body.ticket.id, ticketId);
});

test("PLAYER: cannot access staff endpoints", async () => {
  const { status } = await playerClient.get("/api/support/staff/tickets");
  assert.equal(status, 403, `Expected 403 for player on staff endpoint, got ${status}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Status transitions
// ─────────────────────────────────────────────────────────────────────────────

test("PLAYER: can mark ticket as finished (open → finished)", async () => {
  const { body: createBody } = await playerClient.post("/api/support/tickets", {
    subject: "Finish me",
    category: "General",
    message: "I will finish this.",
  });
  const ticketId = createBody.id;

  const { status, body } = await playerClient.patch(`/api/support/tickets/${ticketId}`, {
    status: "finished",
  });
  assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert.equal(body.status, "finished");

  const { rows } = await pool.query("SELECT status FROM support_tickets WHERE id = $1", [ticketId]);
  assert.equal(rows[0].status, "finished");
});

test("PLAYER: can reopen a finished ticket (finished → open)", async () => {
  const { body: createBody } = await playerClient.post("/api/support/tickets", {
    subject: "Reopen me",
    category: "General",
    message: "I will reopen this.",
  });
  const ticketId = createBody.id;

  // First finish it
  await playerClient.patch(`/api/support/tickets/${ticketId}`, { status: "finished" });

  // Then reopen
  const { status, body } = await playerClient.patch(`/api/support/tickets/${ticketId}`, {
    status: "open",
  });
  assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert.equal(body.status, "open");
});

test("PLAYER: can reopen a closed ticket (closed → open)", async () => {
  const { body: createBody } = await playerClient.post("/api/support/tickets", {
    subject: "Closed reopen test",
    category: "General",
    message: "Staff will close, player will reopen.",
  });
  const ticketId = createBody.id;

  // Staff closes it
  await adminClient.patch(`/api/support/staff/tickets/${ticketId}`, { status: "closed" });

  // Player reopens
  const { status, body } = await playerClient.patch(`/api/support/tickets/${ticketId}`, {
    status: "open",
  });
  assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert.equal(body.status, "open");
});

test("STAFF: can close a ticket (open → closed)", async () => {
  const { body: createBody } = await playerClient.post("/api/support/tickets", {
    subject: "Staff close test",
    category: "General",
    message: "Staff will close this.",
  });
  const ticketId = createBody.id;

  const { status, body } = await adminClient.patch(`/api/support/staff/tickets/${ticketId}`, {
    status: "closed",
  });
  assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);

  const { rows } = await pool.query("SELECT status FROM support_tickets WHERE id = $1", [ticketId]);
  assert.equal(rows[0].status, "closed");
});

test("STAFF: can reopen a closed ticket (closed → open)", async () => {
  const { body: createBody } = await playerClient.post("/api/support/tickets", {
    subject: "Staff reopen test",
    category: "General",
    message: "Staff will close then reopen.",
  });
  const ticketId = createBody.id;

  await adminClient.patch(`/api/support/staff/tickets/${ticketId}`, { status: "closed" });

  const { status } = await adminClient.patch(`/api/support/staff/tickets/${ticketId}`, {
    status: "open",
  });
  assert.equal(status, 200, `Expected 200 on staff reopen, got ${status}`);

  const { rows } = await pool.query("SELECT status FROM support_tickets WHERE id = $1", [ticketId]);
  assert.equal(rows[0].status, "open");
});

test("PLAYER: invalid transition is rejected", async () => {
  const { body: createBody } = await playerClient.post("/api/support/tickets", {
    subject: "Bad transition",
    category: "General",
    message: "Player cannot close directly.",
  });
  const ticketId = createBody.id;

  // Player cannot close (only staff can close)
  const { status } = await playerClient.patch(`/api/support/tickets/${ticketId}`, {
    status: "closed",
  });
  assert.equal(status, 400, `Expected 400 for invalid transition, got ${status}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Messaging
// ─────────────────────────────────────────────────────────────────────────────

test("PLAYER: can post a message to own ticket", async () => {
  const { body: createBody } = await playerClient.post("/api/support/tickets", {
    subject: "Messaging test",
    category: "General",
    message: "First message.",
  });
  const ticketId = createBody.id;

  const { status, body } = await playerClient.post(
    `/api/support/tickets/${ticketId}/messages`,
    { message: "Follow-up message." }
  );
  assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  assert.ok(body.ok);

  const { rows } = await pool.query(
    "SELECT * FROM support_messages WHERE ticket_id = $1 ORDER BY created_at",
    [ticketId]
  );
  assert.equal(rows.length, 2, "Should have 2 messages now");
  assert.equal(rows[1].body, "Follow-up message.");
});

test("STAFF: can post a message to any ticket", async () => {
  const { body: createBody } = await playerClient.post("/api/support/tickets", {
    subject: "Staff reply test",
    category: "General",
    message: "Player message.",
  });
  const ticketId = createBody.id;

  const { status, body } = await adminClient.post(
    `/api/support/staff/tickets/${ticketId}/messages`,
    { message: "Staff reply here." }
  );
  assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);

  const { rows } = await pool.query(
    "SELECT * FROM support_messages WHERE ticket_id = $1 AND author_role = 'staff'",
    [ticketId]
  );
  assert.equal(rows.length, 1, "Staff message should exist");
  assert.equal(rows[0].body, "Staff reply here.");
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Unread markers
// ─────────────────────────────────────────────────────────────────────────────

test("UNREAD: staff reply marks ticket unread for player", async () => {
  const { body: createBody } = await playerClient.post("/api/support/tickets", {
    subject: "Unread test",
    category: "General",
    message: "Initial.",
  });
  const ticketId = createBody.id;

  // Player loads the ticket (sets player_last_read_at)
  await playerClient.get(`/api/support/tickets/${ticketId}`);

  // Staff replies
  await adminClient.post(`/api/support/staff/tickets/${ticketId}/messages`, {
    message: "Staff says hello.",
  });

  // Player list should show unread=true
  const { body: listBody } = await playerClient.get("/api/support/tickets");
  const found = listBody.tickets.find((t) => t.id === ticketId);
  assert.ok(found, "Ticket must appear in list");
  assert.equal(found.unread, true, "Should be unread after staff reply");
});

test("UNREAD: loading ticket marks it as read", async () => {
  const { body: createBody } = await playerClient.post("/api/support/tickets", {
    subject: "Read marker test",
    category: "General",
    message: "Initial.",
  });
  const ticketId = createBody.id;

  // Staff replies
  await adminClient.post(`/api/support/staff/tickets/${ticketId}/messages`, {
    message: "Staff reply.",
  });

  // Confirm it's unread
  const { body: listBefore } = await playerClient.get("/api/support/tickets");
  const foundBefore = listBefore.tickets.find((t) => t.id === ticketId);
  assert.equal(foundBefore.unread, true, "Should be unread before loading");

  // Player loads ticket (updates player_last_read_at)
  await playerClient.get(`/api/support/tickets/${ticketId}`);

  // Now should be read
  const { body: listAfter } = await playerClient.get("/api/support/tickets");
  const foundAfter = listAfter.tickets.find((t) => t.id === ticketId);
  assert.equal(foundAfter.unread, false, "Should be read after loading ticket");
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Staff labels and filtering
// ─────────────────────────────────────────────────────────────────────────────

test("STAFF: can set labels on a ticket", async () => {
  const { body: createBody } = await playerClient.post("/api/support/tickets", {
    subject: "Label test",
    category: "Bug",
    message: "This is a bug report.",
  });
  const ticketId = createBody.id;

  const { status, body } = await adminClient.patch(
    `/api/support/staff/tickets/${ticketId}`,
    { staff_labels: ["bug", "urgent"] }
  );
  assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);

  const { rows } = await pool.query(
    "SELECT staff_labels FROM support_tickets WHERE id = $1", [ticketId]
  );
  assert.deepEqual(rows[0].staff_labels, ["bug", "urgent"]);
});

test("STAFF: can filter tickets by label", async () => {
  const labelSlug = `testlabel-${Date.now()}`;

  const { body: createBody } = await playerClient.post("/api/support/tickets", {
    subject: "Filtered label ticket",
    category: "General",
    message: "For label filtering test.",
  });
  const ticketId = createBody.id;

  await adminClient.patch(`/api/support/staff/tickets/${ticketId}`, {
    staff_labels: [labelSlug],
  });

  const { status, body } = await adminClient.get(
    `/api/support/staff/tickets?label=${encodeURIComponent(labelSlug)}`
  );
  assert.equal(status, 200);
  assert.ok(body.tickets.some((t) => t.id === ticketId), "Filtered list must include labelled ticket");
});

test("STAFF: can filter tickets by status", async () => {
  const { body: createBody } = await playerClient.post("/api/support/tickets", {
    subject: "Status filter ticket",
    category: "General",
    message: "For status filtering test.",
  });
  const ticketId = createBody.id;

  const { body: openList } = await adminClient.get("/api/support/staff/tickets?status=open");
  assert.ok(openList.tickets.some((t) => t.id === ticketId), "Should appear in open filter");

  await adminClient.patch(`/api/support/staff/tickets/${ticketId}`, { status: "closed" });

  const { body: closedList } = await adminClient.get("/api/support/staff/tickets?status=closed");
  assert.ok(closedList.tickets.some((t) => t.id === ticketId), "Should appear in closed filter");

  const { body: openListAfter } = await adminClient.get("/api/support/staff/tickets?status=open");
  assert.ok(!openListAfter.tickets.some((t) => t.id === ticketId), "Should NOT appear in open after closing");
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Input validation (max lengths)
// ─────────────────────────────────────────────────────────────────────────────

test("VALIDATION: subject exceeding 200 chars is rejected", async () => {
  const longSubject = "x".repeat(201);
  const { status, body } = await playerClient.post("/api/support/tickets", {
    subject: longSubject,
    message: "Valid message.",
  });
  assert.equal(status, 400, `Expected 400, got ${status}`);
  assert.ok(body.error, "error field must be present");
  assert.ok(body.error.includes("200"), "error must mention limit");
});

test("VALIDATION: message exceeding 10,000 chars is rejected on ticket creation", async () => {
  const longMsg = "x".repeat(10001);
  const { status, body } = await playerClient.post("/api/support/tickets", {
    subject: "Valid subject",
    message: longMsg,
  });
  assert.equal(status, 400, `Expected 400, got ${status}`);
  assert.ok(body.error, "error field must be present");
  assert.ok(body.error.includes("10,000"), "error must mention limit");
});

test("VALIDATION: message exceeding 10,000 chars is rejected on reply", async () => {
  const { body: createBody } = await playerClient.post("/api/support/tickets", {
    subject: "Reply length test",
    message: "Initial message.",
  });
  const ticketId = createBody.id;

  const longMsg = "y".repeat(10001);
  const { status, body } = await playerClient.post(
    `/api/support/tickets/${ticketId}/messages`,
    { message: longMsg }
  );
  assert.equal(status, 400, `Expected 400, got ${status}`);
  assert.ok(body.error.includes("10,000"), "error must mention limit");
});

test("VALIDATION: staff message exceeding 10,000 chars is rejected", async () => {
  const { body: createBody } = await playerClient.post("/api/support/tickets", {
    subject: "Staff reply length test",
    message: "Initial message.",
  });
  const ticketId = createBody.id;

  const longMsg = "z".repeat(10001);
  const { status, body } = await adminClient.post(
    `/api/support/staff/tickets/${ticketId}/messages`,
    { message: longMsg }
  );
  assert.equal(status, 400, `Expected 400, got ${status}`);
  assert.ok(body.error.includes("10,000"), "error must mention limit");
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. updated_at set on ticket creation
// ─────────────────────────────────────────────────────────────────────────────

test("CREATION: updated_at is explicitly set (matches last_message_at) on ticket creation", async () => {
  const before = new Date();
  const { body: createBody } = await playerClient.post("/api/support/tickets", {
    subject: "updated_at test",
    message: "Checking timestamp.",
  });
  const after = new Date();
  const ticketId = createBody.id;

  const { rows } = await pool.query(
    "SELECT updated_at, last_message_at FROM support_tickets WHERE id = $1", [ticketId]
  );
  const ticket = rows[0];
  const updatedAt = new Date(ticket.updated_at);
  const lastMsgAt = new Date(ticket.last_message_at);

  // Both should be within the test window
  assert.ok(updatedAt >= before, "updated_at must be >= test start");
  assert.ok(updatedAt <= after,  "updated_at must be <= test end");
  // updated_at and last_message_at should be the same value (set together in insert)
  assert.equal(
    updatedAt.toISOString(),
    lastMsgAt.toISOString(),
    "updated_at and last_message_at must match at creation"
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Pagination on staff list
// ─────────────────────────────────────────────────────────────────────────────

test("PAGINATION: staff list returns total count and pagination metadata", async () => {
  // Create at least one ticket so there's something to page through
  await playerClient.post("/api/support/tickets", {
    subject: "Pagination test ticket",
    message: "For pagination.",
  });

  const { status, body } = await adminClient.get("/api/support/staff/tickets?limit=1&offset=0");
  assert.equal(status, 200, `Expected 200, got ${status}`);
  assert.ok(typeof body.total === "number", "total must be a number");
  assert.ok(typeof body.limit === "number", "limit must be returned");
  assert.ok(typeof body.offset === "number", "offset must be returned");
  assert.ok(Array.isArray(body.tickets), "tickets must be an array");
  assert.ok(body.tickets.length <= 1, "With limit=1, at most 1 ticket returned");
  assert.ok(body.total >= 1, "total must be >= 1");
});

test("PAGINATION: hard cap prevents limit > 200", async () => {
  const { status, body } = await adminClient.get("/api/support/staff/tickets?limit=999");
  assert.equal(status, 200);
  assert.equal(body.limit, 200, "limit must be capped at 200");
});

test("PAGINATION: offset skips rows", async () => {
  // Create two tickets quickly
  await playerClient.post("/api/support/tickets", { subject: "Offset A", message: "msg" });
  await playerClient.post("/api/support/tickets", { subject: "Offset B", message: "msg" });

  const { body: page1 } = await adminClient.get("/api/support/staff/tickets?limit=50&offset=0");
  const { body: page2 } = await adminClient.get(
    `/api/support/staff/tickets?limit=50&offset=${page1.tickets.length}`
  );

  // page2 should have no IDs that also appear in page1
  const page1Ids = new Set(page1.tickets.map((t) => t.id));
  const overlap  = page2.tickets.filter((t) => page1Ids.has(t.id));
  assert.equal(overlap.length, 0, "Pages must not overlap");
});
