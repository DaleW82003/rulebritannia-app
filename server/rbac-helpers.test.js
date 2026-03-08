/**
 * Unit tests for server/rbac-helpers.js
 *
 * These tests confirm that the three shared RBAC utilities correctly derive
 * role membership from the session without mutating any state.
 *
 * Run: node --test rbac-helpers.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getSessionRoles, hasAdminOrMod, hasAdminModOrSpeaker } from "./rbac-helpers.js";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal Express-like req object with the given roles array. */
function makeReq(roles) {
  return { session: { userId: "u1", roles } };
}

/** Build a req with NO session (simulates unauthenticated request). */
function makeNoSessionReq() {
  return {};
}

/** Build a req where session.roles is not an array. */
function makeBadRolesReq(value) {
  return { session: { userId: "u1", roles: value } };
}

// ── getSessionRoles ───────────────────────────────────────────────────────────

test("getSessionRoles: returns roles array when present", () => {
  assert.deepEqual(getSessionRoles(makeReq(["admin", "mod"])), ["admin", "mod"]);
});

test("getSessionRoles: returns empty array when roles is undefined", () => {
  assert.deepEqual(getSessionRoles(makeReq(undefined)), []);
});

test("getSessionRoles: returns empty array when roles is null", () => {
  assert.deepEqual(getSessionRoles(makeBadRolesReq(null)), []);
});

test("getSessionRoles: returns empty array when roles is a string (not array)", () => {
  assert.deepEqual(getSessionRoles(makeBadRolesReq("admin")), []);
});

test("getSessionRoles: returns empty array when session is missing", () => {
  assert.deepEqual(getSessionRoles(makeNoSessionReq()), []);
});

test("getSessionRoles: returns empty array when session is null", () => {
  assert.deepEqual(getSessionRoles({ session: null }), []);
});

test("getSessionRoles: does not mutate the original roles array", () => {
  const roles = ["admin"];
  const result = getSessionRoles(makeReq(roles));
  assert.equal(result, roles); // same reference (no copy needed)
});

// ── hasAdminOrMod ─────────────────────────────────────────────────────────────

test("hasAdminOrMod: true for admin", () => {
  assert.equal(hasAdminOrMod(makeReq(["admin"])), true);
});

test("hasAdminOrMod: true for mod", () => {
  assert.equal(hasAdminOrMod(makeReq(["mod"])), true);
});

test("hasAdminOrMod: true for admin + mod", () => {
  assert.equal(hasAdminOrMod(makeReq(["admin", "mod"])), true);
});

test("hasAdminOrMod: false for speaker alone", () => {
  assert.equal(hasAdminOrMod(makeReq(["speaker"])), false);
});

test("hasAdminOrMod: false for regular user (no system roles)", () => {
  assert.equal(hasAdminOrMod(makeReq(["party:labour"])), false);
});

test("hasAdminOrMod: false for empty roles", () => {
  assert.equal(hasAdminOrMod(makeReq([])), false);
});

test("hasAdminOrMod: false when session is missing", () => {
  assert.equal(hasAdminOrMod(makeNoSessionReq()), false);
});

test("hasAdminOrMod: false when roles is not an array", () => {
  assert.equal(hasAdminOrMod(makeBadRolesReq("admin")), false);
});

test("hasAdminOrMod: true when admin is mixed with non-system roles", () => {
  assert.equal(hasAdminOrMod(makeReq(["party:conservative", "admin"])), true);
});

// ── hasAdminModOrSpeaker ──────────────────────────────────────────────────────

test("hasAdminModOrSpeaker: true for admin", () => {
  assert.equal(hasAdminModOrSpeaker(makeReq(["admin"])), true);
});

test("hasAdminModOrSpeaker: true for mod", () => {
  assert.equal(hasAdminModOrSpeaker(makeReq(["mod"])), true);
});

test("hasAdminModOrSpeaker: true for speaker", () => {
  assert.equal(hasAdminModOrSpeaker(makeReq(["speaker"])), true);
});

test("hasAdminModOrSpeaker: true for admin + mod + speaker", () => {
  assert.equal(hasAdminModOrSpeaker(makeReq(["admin", "mod", "speaker"])), true);
});

test("hasAdminModOrSpeaker: false for regular user (no system roles)", () => {
  assert.equal(hasAdminModOrSpeaker(makeReq(["party:labour"])), false);
});

test("hasAdminModOrSpeaker: false for empty roles", () => {
  assert.equal(hasAdminModOrSpeaker(makeReq([])), false);
});

test("hasAdminModOrSpeaker: false when session is missing", () => {
  assert.equal(hasAdminModOrSpeaker(makeNoSessionReq()), false);
});

test("hasAdminModOrSpeaker: false when roles is not an array", () => {
  assert.equal(hasAdminModOrSpeaker(makeBadRolesReq("speaker")), false);
});

test("hasAdminModOrSpeaker: true when speaker is mixed with party role", () => {
  assert.equal(hasAdminModOrSpeaker(makeReq(["party:conservative", "speaker"])), true);
});

// ── consistent results across helpers ────────────────────────────────────────

test("speaker passes hasAdminModOrSpeaker but not hasAdminOrMod", () => {
  const req = makeReq(["speaker"]);
  assert.equal(hasAdminModOrSpeaker(req), true);
  assert.equal(hasAdminOrMod(req), false);
});

test("admin passes both hasAdminOrMod and hasAdminModOrSpeaker", () => {
  const req = makeReq(["admin"]);
  assert.equal(hasAdminOrMod(req), true);
  assert.equal(hasAdminModOrSpeaker(req), true);
});

test("mod passes both hasAdminOrMod and hasAdminModOrSpeaker", () => {
  const req = makeReq(["mod"]);
  assert.equal(hasAdminOrMod(req), true);
  assert.equal(hasAdminModOrSpeaker(req), true);
});
