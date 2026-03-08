/**
 * Unit tests for server/state-contracts.js — state ownership boundary enforcement.
 *
 * Run with: node --test server/state-contracts.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SNAPSHOT_DERIVED_TABLES,
  RELATIONAL_AUTHORITATIVE_TABLES,
  RELATIONAL_AUTHORITATIVE_SNAPSHOT_KEYS,
  assertSnapshotDerivedTable,
  stripRelationalKeys,
} from "./state-contracts.js";

// ── SNAPSHOT_DERIVED_TABLES allowlist ────────────────────────────────────────

test("SNAPSHOT_DERIVED_TABLES contains all expected derived-cache tables", () => {
  const expected = ["bills", "motions", "statements", "regulations", "questiontime_questions"];
  for (const t of expected) {
    assert.ok(SNAPSHOT_DERIVED_TABLES.has(t), `Expected '${t}' in SNAPSHOT_DERIVED_TABLES`);
  }
});

test("SNAPSHOT_DERIVED_TABLES does NOT include any relational-authoritative tables", () => {
  for (const t of RELATIONAL_AUTHORITATIVE_TABLES) {
    assert.ok(
      !SNAPSHOT_DERIVED_TABLES.has(t),
      `Relational-authoritative table '${t}' must NOT appear in SNAPSHOT_DERIVED_TABLES`
    );
  }
});

test("SNAPSHOT_DERIVED_TABLES does not overlap with known forbidden table names", () => {
  const forbidden = [
    "divisions",
    "division_votes",
    "bill_amendments",
    "bill_amendment_supporters",
    "party_factions",
    "faction_political_state",
    "character_finance",
    "character_additional_revenue",
    "finance_config",
    "finance_applied",
  ];
  for (const t of forbidden) {
    assert.ok(
      !SNAPSHOT_DERIVED_TABLES.has(t),
      `'${t}' must not be in SNAPSHOT_DERIVED_TABLES`
    );
  }
});

// ── RELATIONAL_AUTHORITATIVE_TABLES ─────────────────────────────────────────

test("RELATIONAL_AUTHORITATIVE_TABLES contains expected gameplay tables", () => {
  const expected = [
    "divisions",
    "division_votes",
    "bill_amendments",
    "party_factions",
    "faction_political_state",
    "character_finance",
  ];
  for (const t of expected) {
    assert.ok(RELATIONAL_AUTHORITATIVE_TABLES.has(t), `Expected '${t}' in RELATIONAL_AUTHORITATIVE_TABLES`);
  }
});

// ── assertSnapshotDerivedTable ───────────────────────────────────────────────

test("assertSnapshotDerivedTable does not throw for every table in SNAPSHOT_DERIVED_TABLES", () => {
  for (const t of SNAPSHOT_DERIVED_TABLES) {
    assert.doesNotThrow(() => assertSnapshotDerivedTable(t), `Should allow '${t}'`);
  }
});

test("assertSnapshotDerivedTable throws for each RELATIONAL_AUTHORITATIVE table", () => {
  for (const t of RELATIONAL_AUTHORITATIVE_TABLES) {
    assert.throws(
      () => assertSnapshotDerivedTable(t),
      /FORBIDDEN/,
      `Should throw FORBIDDEN for relational table '${t}'`
    );
  }
});

test("assertSnapshotDerivedTable throws for arbitrary unknown table name", () => {
  assert.throws(
    () => assertSnapshotDerivedTable("some_unknown_table"),
    /FORBIDDEN/
  );
});

test("assertSnapshotDerivedTable error message references state-contracts.js", () => {
  try {
    assertSnapshotDerivedTable("divisions");
    assert.fail("Expected throw");
  } catch (e) {
    assert.ok(
      e.message.includes("state-contracts.js"),
      "Error should mention state-contracts.js so devs know where to edit"
    );
  }
});

// ── stripRelationalKeys ──────────────────────────────────────────────────────

test("stripRelationalKeys returns original reference when no forbidden keys present", () => {
  const data = { gameState: { started: false }, orderPaperCommons: [] };
  const { clean, stripped } = stripRelationalKeys(data, "test");
  assert.equal(clean, data, "Should return same reference when nothing to strip");
  assert.deepEqual(stripped, []);
});

test("stripRelationalKeys removes 'divisions' key and reports it in stripped list", () => {
  const data = { gameState: {}, divisions: [{ id: "d1" }] };
  const { clean, stripped } = stripRelationalKeys(data, "test");
  assert.ok(!Object.hasOwn(clean, "divisions"), "divisions should be removed");
  assert.ok(Object.hasOwn(clean, "gameState"), "gameState should remain");
  assert.ok(stripped.includes("divisions"), "divisions should be in stripped list");
});

test("stripRelationalKeys removes 'amendments' key and reports it in stripped list", () => {
  const data = { gameState: {}, amendments: [{ id: "a1" }] };
  const { clean, stripped } = stripRelationalKeys(data, "test");
  assert.ok(!Object.hasOwn(clean, "amendments"), "amendments should be removed");
  assert.ok(stripped.includes("amendments"));
});

test("stripRelationalKeys removes 'factions' key and reports it in stripped list", () => {
  const data = { gameState: {}, factions: [{ id: "f1" }] };
  const { clean, stripped } = stripRelationalKeys(data, "test");
  assert.ok(!Object.hasOwn(clean, "factions"), "factions should be removed");
  assert.ok(stripped.includes("factions"));
});

test("stripRelationalKeys removes 'politicalState' key and reports it in stripped list", () => {
  const data = { gameState: {}, politicalState: { power: 50 } };
  const { clean, stripped } = stripRelationalKeys(data, "test");
  assert.ok(!Object.hasOwn(clean, "politicalState"), "politicalState should be removed");
  assert.ok(stripped.includes("politicalState"));
});

test("stripRelationalKeys removes 'finance' key and reports it in stripped list", () => {
  const data = { gameState: {}, finance: { balance: 1000 } };
  const { clean, stripped } = stripRelationalKeys(data, "test");
  assert.ok(!Object.hasOwn(clean, "finance"), "finance should be removed");
  assert.ok(stripped.includes("finance"));
});

test("stripRelationalKeys strips all RELATIONAL_AUTHORITATIVE_SNAPSHOT_KEYS at once", () => {
  const data = { gameState: {}, orderPaperCommons: [] };
  for (const key of RELATIONAL_AUTHORITATIVE_SNAPSHOT_KEYS) {
    data[key] = [{ id: `test-${key}` }];
  }
  const { clean, stripped } = stripRelationalKeys(data, "test");
  assert.equal(stripped.length, RELATIONAL_AUTHORITATIVE_SNAPSHOT_KEYS.size);
  assert.ok(Object.hasOwn(clean, "gameState"), "safe key should remain");
  assert.ok(Object.hasOwn(clean, "orderPaperCommons"), "safe key should remain");
  for (const key of RELATIONAL_AUTHORITATIVE_SNAPSHOT_KEYS) {
    assert.ok(!Object.hasOwn(clean, key), `'${key}' should be removed`);
  }
});

test("stripRelationalKeys does not mutate the original data object", () => {
  const data = { gameState: {}, divisions: [{ id: "d1" }] };
  const original = { ...data };
  stripRelationalKeys(data, "test");
  assert.deepEqual(data, original, "Original data must not be mutated");
});

test("stripRelationalKeys handles null input gracefully", () => {
  const { clean, stripped } = stripRelationalKeys(null, "test");
  assert.equal(clean, null);
  assert.deepEqual(stripped, []);
});

test("stripRelationalKeys handles undefined input gracefully", () => {
  const { clean, stripped } = stripRelationalKeys(undefined, "test");
  assert.equal(clean, undefined);
  assert.deepEqual(stripped, []);
});

test("stripRelationalKeys handles non-object string input gracefully", () => {
  const { clean, stripped } = stripRelationalKeys("invalid", "test");
  assert.equal(clean, "invalid");
  assert.deepEqual(stripped, []);
});

test("stripRelationalKeys handles array input gracefully (arrays are not snapshot objects)", () => {
  const arr = [{ id: "x" }];
  const { clean, stripped } = stripRelationalKeys(arr, "test");
  assert.equal(clean, arr, "Arrays should be returned unchanged");
  assert.deepEqual(stripped, []);
});
