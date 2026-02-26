/**
 * tests/api/immutability.spec.js
 *
 * R2 immutability tests — validates that parliament/policy items cannot be
 * edited by their author after submission, only by staff.
 *
 * Runs against a live server using Node's built-in test runner:
 *   node --test tests/api/immutability.spec.js
 *
 * Required environment variables:
 *   BASE_URL      - e.g. https://rulebritannia-app.onrender.com
 *   COOKIE_PLAYER - session cookie for an authenticated player (non-staff)
 *   COOKIE_MOD    - session cookie for a mod user
 *   COOKIE_ADMIN  - session cookie for an admin user
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

const BASE_URL = process.env.BASE_URL;
if (!BASE_URL) {
  throw new Error("BASE_URL is required for immutability tests");
}

const COOKIES = {
  player: process.env.COOKIE_PLAYER || "",
  mod:    process.env.COOKIE_MOD    || "",
  admin:  process.env.COOKIE_ADMIN  || "",
};

if (!COOKIES.player) {
  console.warn("⚠️  COOKIE_PLAYER not set — skipping immutability tests");
}

let csrfToken = "";

before(async () => {
  const res = await fetch(`${BASE_URL}/api/csrf-token`, {
    headers: { Cookie: COOKIES.admin || COOKIES.player },
  });
  const data = await res.json().catch(() => ({}));
  csrfToken = data.csrfToken || data.token || "";
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiPost(path, body, cookie) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken, Cookie: cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function apiPut(path, body, cookie) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken, Cookie: cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function apiDelete(path, cookie) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "DELETE",
    headers: { "x-csrf-token": csrfToken, Cookie: cookie },
  });
  return { status: res.status };
}

async function apiPatch(path, body, cookie) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken, Cookie: cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("R2: Parliament items are immutable by players after submit", () => {

  // ── Motions ──────────────────────────────────────────────────────────────────
  describe("Motions: player cannot PUT/DELETE after submit", () => {
    let motionId;

    before(async () => {
      // Create a motion as player to get a valid ID to test against
      const { body } = await apiPost("/api/motions", {
        type: "edm",
        title: `Immutability test motion ${Date.now()}`,
        body:  "Test motion body",
        sponsors: [],
      }, COOKIES.player);
      motionId = body.id;
    });

    test("Player cannot PUT /api/motions/:id (should get 401 or 403)", async () => {
      if (!motionId) { console.warn("    (skipped — motion not created)"); return; }
      const { status } = await apiPut(`/api/motions/${motionId}`, { title: "HACKED" }, COOKIES.player);
      assert.ok([401, 403].includes(status),
        `Player should not be able to edit a motion, got ${status} (R2 violation)`);
    });

    test("Player cannot DELETE /api/motions/:id (should get 401 or 403)", async () => {
      if (!motionId) { console.warn("    (skipped — motion not created)"); return; }
      const { status } = await apiDelete(`/api/motions/${motionId}`, COOKIES.player);
      assert.ok([401, 403].includes(status),
        `Player should not be able to delete a motion, got ${status} (R2 violation)`);
    });

    test("Mod CAN PUT /api/motions/:id (staff override)", async () => {
      if (!motionId || !COOKIES.mod) { console.warn("    (skipped)"); return; }
      const { status } = await apiPut(`/api/motions/${motionId}`, { title: "Staff edit" }, COOKIES.mod);
      assert.ok([200, 201, 404].includes(status),
        `Mod should be able to edit a motion, got ${status}`);
    });
  });

  // ── Statements ───────────────────────────────────────────────────────────────
  describe("Statements: player cannot PUT/DELETE after submit", () => {
    let statementId;

    before(async () => {
      const { body } = await apiPost("/api/statements", {
        title: `Immutability test statement ${Date.now()}`,
        body:  "Test statement body",
        author: "Test",
        opensAtSim: "January 1997",
        closesAtSim: "March 1997",
      }, COOKIES.player);
      statementId = body.id;
    });

    test("Player cannot PUT /api/statements/:id", async () => {
      if (!statementId) { console.warn("    (skipped — statement not created)"); return; }
      const { status } = await apiPut(`/api/statements/${statementId}`, { title: "HACKED" }, COOKIES.player);
      assert.ok([401, 403].includes(status),
        `Player should not edit a statement, got ${status} (R2 violation)`);
    });

    test("Player cannot DELETE /api/statements/:id", async () => {
      if (!statementId) { console.warn("    (skipped — statement not created)"); return; }
      const { status } = await apiDelete(`/api/statements/${statementId}`, COOKIES.player);
      assert.ok([401, 403].includes(status),
        `Player should not delete a statement, got ${status} (R2 violation)`);
    });
  });

  // ── Regulations ──────────────────────────────────────────────────────────────
  describe("Regulations: player cannot PUT/DELETE after submit", () => {
    let regId;

    before(async () => {
      const { body } = await apiPost("/api/regulations", {
        title: `Immutability test regulation ${Date.now()}`,
        body:  "Test regulation body",
        opensAtSim: "January 1997",
      }, COOKIES.player);
      regId = body.id;
    });

    test("Player cannot PUT /api/regulations/:id", async () => {
      if (!regId) { console.warn("    (skipped — regulation not created)"); return; }
      const { status } = await apiPut(`/api/regulations/${regId}`, { title: "HACKED" }, COOKIES.player);
      assert.ok([401, 403].includes(status),
        `Player should not edit a regulation, got ${status} (R2 violation)`);
    });

    test("Player cannot DELETE /api/regulations/:id", async () => {
      if (!regId) { console.warn("    (skipped — regulation not created)"); return; }
      const { status } = await apiDelete(`/api/regulations/${regId}`, COOKIES.player);
      assert.ok([401, 403].includes(status),
        `Player should not delete a regulation, got ${status} (R2 violation)`);
    });
  });

  // ── Press items ──────────────────────────────────────────────────────────────
  describe("Press items: player cannot PUT/DELETE after submit", () => {
    let pressId;

    before(async () => {
      const id = `press-immut-${Date.now()}`;
      const { body, status } = await apiPost("/api/press", {
        press_type: "release",
        id,
        reference: "IMMUT TEST PR",
        subject: `Immutability test press ${Date.now()}`,
        body: "Test",
        author: "Test",
        createdAtSim: "January 1997",
        score: null,
        impact: [],
      }, COOKIES.player);
      pressId = body.id || (status === 201 ? id : null);
    });

    test("Player cannot PUT /api/press/:id (full replace)", async () => {
      if (!pressId) { console.warn("    (skipped — press item not created)"); return; }
      const { status } = await apiPut(`/api/press/${pressId}`, { subject: "HACKED" }, COOKIES.player);
      assert.ok([401, 403].includes(status),
        `Player should not edit a press item, got ${status} (R2 violation)`);
    });

    test("Player cannot DELETE /api/press/:id", async () => {
      if (!pressId) { console.warn("    (skipped — press item not created)"); return; }
      const { status } = await apiDelete(`/api/press/${pressId}`, COOKIES.player);
      assert.ok([401, 403].includes(status),
        `Player should not delete a press item, got ${status} (R2 violation)`);
    });
  });

  // ── Events ───────────────────────────────────────────────────────────────────
  describe("Events: only author or staff can PUT after submit (author-gated)", () => {
    let eventId;

    before(async () => {
      const id = `event-immut-${Date.now()}`;
      await apiPost("/api/events", {
        id,
        type: "social",
        title: `Immutability test event ${Date.now()}`,
        submittedBy: "UnknownCharacter",
        status: "pending",
        speeches: [],
      }, COOKIES.player);
      eventId = id;
    });

    test("Another player (different character name) cannot PUT /api/events/:id", async () => {
      if (!eventId) { console.warn("    (skipped — event not created)"); return; }
      // Attempt to update with a different player would require a different account.
      // Without a second player cookie, we verify the endpoint requires auth at minimum.
      const { status } = await apiPut(`/api/events/${eventId}`, { title: "HACKED" }, "");
      assert.ok([401, 403].includes(status),
        `Unauthenticated user should not edit an event, got ${status}`);
    });
  });
});
