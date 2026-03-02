/**
 * Unit tests for server/roles.js — computeDiscourseGroups helper.
 *
 * Run with: node --test server/roles.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDiscourseGroups, partyRoleForPartyName, computeApprovalRolesToAdd, officeRoleFromSpecId } from "./roles.js";

// ── computeDiscourseGroups ───────────────────────────────────────────────────

test("computeDiscourseGroups: party:conservative → includes conservative and backbencher", () => {
  const groups = computeDiscourseGroups(["party:conservative"]);
  assert.ok(groups.includes("conservative"), "should include conservative");
  assert.ok(groups.includes("backbencher"),  "should include backbencher for non-admin/mod party member");
});

test("computeDiscourseGroups: party:labour → includes labour and backbencher", () => {
  const groups = computeDiscourseGroups(["party:labour"]);
  assert.ok(groups.includes("labour"),      "should include labour");
  assert.ok(groups.includes("backbencher"), "should include backbencher for non-admin/mod party member");
});

test("computeDiscourseGroups: party:liberal_democrat → includes libdem and backbencher", () => {
  const groups = computeDiscourseGroups(["party:liberal_democrat"]);
  assert.ok(groups.includes("libdem"),      "should include libdem");
  assert.ok(groups.includes("backbencher"), "should include backbencher for non-admin/mod party member");
});

test("computeDiscourseGroups: admin with party role → does NOT include backbencher", () => {
  const groups = computeDiscourseGroups(["admin", "party:conservative"]);
  assert.ok(!groups.includes("backbencher"), "admin should NOT receive backbencher via auto-assign");
});

test("computeDiscourseGroups: mod with party role → does NOT include backbencher", () => {
  const groups = computeDiscourseGroups(["mod", "party:labour"]);
  assert.ok(!groups.includes("backbencher"), "mod should NOT receive backbencher via auto-assign");
});

test("computeDiscourseGroups: speaker with party role → includes backbencher (speaker is not admin/mod)", () => {
  const groups = computeDiscourseGroups(["speaker", "party:conservative"]);
  assert.ok(groups.includes("backbencher"), "speaker with party role should get backbencher");
  assert.ok(groups.includes("speaker"),     "should include speaker group");
  assert.ok(groups.includes("conservative"), "should include conservative group");
});

test("computeDiscourseGroups: no party role → no backbencher auto-assigned", () => {
  const groups = computeDiscourseGroups(["office:secretary_of_state"]);
  assert.ok(!groups.includes("backbencher"), "non-party role without party membership should not get backbencher");
});

test("computeDiscourseGroups: party:conservative with office → includes conservative, backbencher, and office group", () => {
  const groups = computeDiscourseGroups(["party:conservative", "office:secretary_of_state"]);
  assert.ok(groups.includes("conservative"), "should include conservative");
  assert.ok(groups.includes("backbencher"),  "should include backbencher");
  assert.ok(groups.includes("government"),   "should include government (secretary_of_state office)");
});

test("computeDiscourseGroups: result is sorted", () => {
  const groups = computeDiscourseGroups(["party:conservative"]);
  const sorted = [...groups].sort();
  assert.deepEqual(groups, sorted, "result should be sorted alphabetically");
});

// ── partyRoleForPartyName ────────────────────────────────────────────────────

test("partyRoleForPartyName: Conservative → party:conservative", () => {
  assert.equal(partyRoleForPartyName("Conservative"), "party:conservative");
});

test("partyRoleForPartyName: Labour → party:labour", () => {
  assert.equal(partyRoleForPartyName("Labour"), "party:labour");
});

test("partyRoleForPartyName: Liberal Democrat → party:liberal_democrat", () => {
  assert.equal(partyRoleForPartyName("Liberal Democrat"), "party:liberal_democrat");
});

test("partyRoleForPartyName: liberal_democrat (slug) → party:liberal_democrat", () => {
  assert.equal(partyRoleForPartyName("liberal_democrat"), "party:liberal_democrat");
});

test("partyRoleForPartyName: Independents → null", () => {
  assert.equal(partyRoleForPartyName("Independents"), null);
});

test("partyRoleForPartyName: empty string → null", () => {
  assert.equal(partyRoleForPartyName(""), null);
});

test("partyRoleForPartyName: null → null", () => {
  assert.equal(partyRoleForPartyName(null), null);
});

// ── computeApprovalRolesToAdd ────────────────────────────────────────────────

test("computeApprovalRolesToAdd: adds party role and backbencher when user has neither", () => {
  const toAdd = computeApprovalRolesToAdd([], "party:conservative");
  assert.ok(toAdd.includes("party:conservative"), "should add party role");
  assert.ok(toAdd.includes("office:backbencher"),  "should add backbencher");
});

test("computeApprovalRolesToAdd: does NOT override existing party:* role", () => {
  const toAdd = computeApprovalRolesToAdd(["party:labour"], "party:conservative");
  assert.ok(!toAdd.includes("party:conservative"), "should not override existing party role");
  assert.ok(!toAdd.includes("party:labour"),       "should not add redundant existing role");
});

test("computeApprovalRolesToAdd: still adds backbencher even when party role is skipped", () => {
  const toAdd = computeApprovalRolesToAdd(["party:labour"], "party:conservative");
  assert.ok(toAdd.includes("office:backbencher"), "should always ensure backbencher");
});

test("computeApprovalRolesToAdd: idempotent — no roles added when user already has both", () => {
  const toAdd = computeApprovalRolesToAdd(["party:conservative", "office:backbencher"], "party:conservative");
  assert.deepEqual(toAdd, [], "nothing to add when roles already present");
});

test("computeApprovalRolesToAdd: adds only backbencher when partyRole is null", () => {
  const toAdd = computeApprovalRolesToAdd([], null);
  assert.deepEqual(toAdd, ["office:backbencher"], "should add only backbencher for independent");
});

// ── officeRoleFromSpecId ─────────────────────────────────────────────────────

test("officeRoleFromSpecId: prime-minister → office:prime_minister", () => {
  assert.equal(officeRoleFromSpecId("prime-minister", "cabinet"), "office:prime_minister");
});

test("officeRoleFromSpecId: leader-opposition → office:leader_of_opposition", () => {
  assert.equal(officeRoleFromSpecId("leader-opposition", "shadow"), "office:leader_of_opposition");
});

test("officeRoleFromSpecId: cabinet type (non-PM) → office:secretary_of_state", () => {
  assert.equal(officeRoleFromSpecId("chancellor", "cabinet"), "office:secretary_of_state");
});

test("officeRoleFromSpecId: shadow type (non-LOTO) → office:shadow_secretary_of_state", () => {
  assert.equal(officeRoleFromSpecId("shadow-chancellor", "shadow"), "office:shadow_secretary_of_state");
});

test("officeRoleFromSpecId: parliamentary type → null (no group role)", () => {
  assert.equal(officeRoleFromSpecId("some-role", "parliamentary"), null);
});

test("officeRoleFromSpecId: other type → null (no group role)", () => {
  assert.equal(officeRoleFromSpecId(null, "other"), null);
});
