/**
 * Unit tests for press-page helper logic.
 *
 * Tests cover:
 *   - timestamp extraction used by sortChronological
 *   - sim-month age computation used by isItemArchived
 *   - addPressLabels numbering (including archived items counted)
 *
 * These functions are defined in js/core.js and js/pages/press.js (browser ESM),
 * so the core logic is replicated inline here for Node-native testing.
 *
 * Run with: node --test server/press-helpers.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// ── Replicated helpers (mirrors js/core.js) ──────────────────────────────────

function _tsFromItem(item) {
  for (const key of ["createdAtReal", "createdAt", "createdTs", "ts", "timestamp", "created", "date"]) {
    const v = item?.[key];
    if (v == null) continue;
    const n = typeof v === "number" ? v : Date.parse(v);
    if (!Number.isNaN(n) && Number.isFinite(n)) return n;
  }
  return -Infinity;
}

function sortChronological(items) {
  if (!Array.isArray(items)) return [];
  return items.slice().sort((a, b) => _tsFromItem(b) - _tsFromItem(a));
}

function addPressLabels(items, prefix) {
  if (!Array.isArray(items)) return [];
  const n = items.length;
  return items.map((item, i) => ({ ...item, _categoryLabel: `${prefix}${n - i}` }));
}

// ── Replicated helpers (mirrors js/pages/press.js + js/clock.js) ─────────────

const PRESS_ARCHIVE_MONTHS = 4;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function parseSimLabel(label) {
  const parts = String(label || "").trim().split(" ");
  if (parts.length < 2) return null;
  const m = MONTH_NAMES.indexOf(parts[0]) + 1;
  const y = Number(parts[1]);
  if (m < 1 || !y) return null;
  return { month: m, year: y };
}

function compareSimDates(a, b) {
  return (a.year * 12 + (a.month - 1)) - (b.year * 12 + (b.month - 1));
}

function isItemArchived(item, nowSimDate) {
  if (item.archived === true) return true;
  const created = parseSimLabel(item.createdAtSim);
  if (!created) return false;
  return compareSimDates(nowSimDate, created) >= PRESS_ARCHIVE_MONTHS;
}

// ── timestamp extraction tests ───────────────────────────────────────────────

test("_tsFromItem: returns numeric createdAt directly", () => {
  assert.equal(_tsFromItem({ createdAt: 1_000_000 }), 1_000_000);
});

test("_tsFromItem: parses ISO string createdAt", () => {
  const iso = "2024-01-15T10:00:00.000Z";
  assert.equal(_tsFromItem({ createdAt: iso }), Date.parse(iso));
});

test("_tsFromItem: prefers createdAtReal over createdAt", () => {
  const item = { createdAtReal: 9999, createdAt: 1111 };
  assert.equal(_tsFromItem(item), 9999);
});

test("_tsFromItem: falls back through candidate keys in order", () => {
  assert.equal(_tsFromItem({ ts: 5555 }), 5555);
  assert.equal(_tsFromItem({ timestamp: 7777 }), 7777);
});

test("_tsFromItem: returns -Infinity when no recognised key", () => {
  assert.equal(_tsFromItem({ createdAtSim: "August 1997" }), -Infinity);
});

test("_tsFromItem: returns -Infinity for null item", () => {
  assert.equal(_tsFromItem(null), -Infinity);
});

// ── sortChronological tests ───────────────────────────────────────────────────

test("sortChronological: returns empty array for non-array input", () => {
  assert.deepEqual(sortChronological(null), []);
  assert.deepEqual(sortChronological(undefined), []);
  assert.deepEqual(sortChronological("string"), []);
});

test("sortChronological: sorts newest-first by createdAt", () => {
  const items = [
    { id: "a", createdAt: 1000 },
    { id: "b", createdAt: 3000 },
    { id: "c", createdAt: 2000 },
  ];
  const sorted = sortChronological(items);
  assert.deepEqual(sorted.map((i) => i.id), ["b", "c", "a"]);
});

test("sortChronological: does not mutate the input array", () => {
  const items = [{ createdAt: 1 }, { createdAt: 3 }, { createdAt: 2 }];
  const copy = [...items];
  sortChronological(items);
  assert.deepEqual(items, copy);
});

test("sortChronological: items without timestamps sink to bottom", () => {
  const items = [
    { id: "no-ts" },
    { id: "has-ts", createdAt: 500 },
  ];
  const sorted = sortChronological(items);
  assert.equal(sorted[0].id, "has-ts");
  assert.equal(sorted[1].id, "no-ts");
});

// ── sim-month age / isItemArchived tests ─────────────────────────────────────

test("parseSimLabel: parses valid 'Month YYYY' label", () => {
  assert.deepEqual(parseSimLabel("August 1997"), { month: 8, year: 1997 });
  assert.deepEqual(parseSimLabel("January 2000"), { month: 1, year: 2000 });
  assert.deepEqual(parseSimLabel("December 2025"), { month: 12, year: 2025 });
});

test("parseSimLabel: returns null for invalid input", () => {
  assert.equal(parseSimLabel(""), null);
  assert.equal(parseSimLabel("BadMonth 1997"), null);
  assert.equal(parseSimLabel("August"), null);
  assert.equal(parseSimLabel(null), null);
});

test("compareSimDates: same date returns 0", () => {
  assert.equal(compareSimDates({ month: 5, year: 1997 }, { month: 5, year: 1997 }), 0);
});

test("compareSimDates: later date is positive", () => {
  assert.ok(compareSimDates({ month: 9, year: 1997 }, { month: 5, year: 1997 }) > 0);
});

test("compareSimDates: measures months correctly across year boundary", () => {
  const diff = compareSimDates({ month: 2, year: 1998 }, { month: 10, year: 1997 });
  assert.equal(diff, 4); // Oct 1997 → Feb 1998 = 4 months
});

test("isItemArchived: explicit archived flag", () => {
  const now = { month: 9, year: 1997 };
  assert.equal(isItemArchived({ archived: true, createdAtSim: "August 1997" }, now), true);
  assert.equal(isItemArchived({ archived: false, createdAtSim: "August 1997" }, now), false);
});

test("isItemArchived: not archived when item is < 4 sim months old", () => {
  const now = { month: 11, year: 1997 };
  // 3 months old: August → November = 3 months
  const item = { createdAtSim: "August 1997" };
  assert.equal(isItemArchived(item, now), false);
});

test("isItemArchived: archived when item is exactly 4 sim months old", () => {
  const now = { month: 12, year: 1997 };
  // August 1997 → December 1997 = 4 months
  const item = { createdAtSim: "August 1997" };
  assert.equal(isItemArchived(item, now), true);
});

test("isItemArchived: archived when item is > 4 sim months old", () => {
  const now = { month: 3, year: 1998 };
  // August 1997 → March 1998 = 7 months
  const item = { createdAtSim: "August 1997" };
  assert.equal(isItemArchived(item, now), true);
});

test("isItemArchived: not archived when createdAtSim is missing", () => {
  const now = { month: 12, year: 1997 };
  assert.equal(isItemArchived({}, now), false);
});

// ── addPressLabels + archive split numbering tests ───────────────────────────

test("addPressLabels: assigns PR1 to oldest and PRN to newest", () => {
  const sorted = [
    { id: "new", createdAt: 3000 },
    { id: "mid", createdAt: 2000 },
    { id: "old", createdAt: 1000 },
  ]; // already sorted newest-first
  const labelled = addPressLabels(sorted, "PR");
  assert.equal(labelled[0]._categoryLabel, "PR3"); // newest
  assert.equal(labelled[1]._categoryLabel, "PR2");
  assert.equal(labelled[2]._categoryLabel, "PR1"); // oldest
});

test("addPressLabels: archived items retain their labels when split", () => {
  const now = { month: 12, year: 1997 };
  const items = [
    { id: "new", createdAt: 3000, createdAtSim: "November 1997" },
    { id: "mid", createdAt: 2000, createdAtSim: "September 1997" },
    { id: "old", createdAt: 1000, createdAtSim: "July 1997" }, // 5 months old → archived
  ];
  const sorted = sortChronological(items);
  const labelled = addPressLabels(sorted, "PR"); // labels all 3

  const active   = labelled.filter((i) => !isItemArchived(i, now));
  const archived = labelled.filter((i) => isItemArchived(i, now));

  // Active: new (PR3) and mid (PR2); archived: old (PR1)
  assert.equal(active.length, 2);
  assert.equal(archived.length, 1);
  assert.equal(archived[0]._categoryLabel, "PR1"); // numbering preserved
  assert.equal(active[0]._categoryLabel, "PR3");   // newest still PR3
});

test("addPressLabels: returns empty array for non-array input", () => {
  assert.deepEqual(addPressLabels(null, "PR"), []);
  assert.deepEqual(addPressLabels(undefined, "PC"), []);
});

test("addPressLabels: single item gets label prefix+1", () => {
  const labelled = addPressLabels([{ id: "x" }], "SP");
  assert.equal(labelled[0]._categoryLabel, "SP1");
});
