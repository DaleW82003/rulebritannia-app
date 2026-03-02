/**
 * Unit tests for server/roles.js — computeDiscourseGroups helper.
 *
 * Run with: node --test server/roles.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDiscourseGroups } from "./roles.js";

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
