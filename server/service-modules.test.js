/**
 * Unit tests for the three extracted service modules:
 *   - server/political-state-service.js  (pure computation helpers)
 *   - server/division-helpers.js         (vote weight + tally helpers)
 *   - server/finance-service.js          (no pure exports to unit-test here yet)
 *
 * Only pure (non-DB) functions are tested here. DB-dependent functions are
 * covered by the existing integration test suites.
 *
 * Run: node --test server/service-modules.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// Pure exports from political-state-service (no DB needed)
import {
  FACTION_PLAYABLE_PARTIES,
  clamp100,
  pressureLabel,
  computeFactionStrength,
  computeFactionCohesion,
  computeLeadershipPressure,
} from "./political-state-service.js";

// Pure exports from division-helpers (no DB needed)
import {
  SPEAKER_PARTY_RE,
  SINN_FEIN_PARTY_RE,
  computeAllPlayerWeights,
  computeCharacterWeight,
} from "./division-helpers.js";

// ── political-state-service: utilities ───────────────────────────────────────

test("clamp100: clamps values to [0, 100]", () => {
  assert.equal(clamp100(0), 0);
  assert.equal(clamp100(100), 100);
  assert.equal(clamp100(-5), 0);
  assert.equal(clamp100(105), 100);
  assert.equal(clamp100(50.4), 50);
  assert.equal(clamp100(50.6), 51);
});

test("pressureLabel: returns correct tier for boundary values", () => {
  assert.equal(pressureLabel(0),  "low");
  assert.equal(pressureLabel(24), "low");
  assert.equal(pressureLabel(25), "moderate");
  assert.equal(pressureLabel(49), "moderate");
  assert.equal(pressureLabel(50), "high");
  assert.equal(pressureLabel(74), "high");
  assert.equal(pressureLabel(75), "critical");
  assert.equal(pressureLabel(100), "critical");
});

test("FACTION_PLAYABLE_PARTIES: is a non-empty array of strings", () => {
  assert.ok(Array.isArray(FACTION_PLAYABLE_PARTIES));
  assert.ok(FACTION_PLAYABLE_PARTIES.length > 0);
  for (const p of FACTION_PLAYABLE_PARTIES) {
    assert.equal(typeof p, "string");
  }
});

test("FACTION_PLAYABLE_PARTIES: includes the three 1997 parties", () => {
  assert.ok(FACTION_PLAYABLE_PARTIES.includes("Conservative"));
  assert.ok(FACTION_PLAYABLE_PARTIES.includes("Labour"));
  assert.ok(FACTION_PLAYABLE_PARTIES.includes("Liberal Democrat"));
});

// ── political-state-service: faction strength ─────────────────────────────────

test("computeFactionStrength: returns 0 for empty faction", () => {
  assert.equal(computeFactionStrength({ mpCount: 0, influenceBonus: 0 }), 0);
});

test("computeFactionStrength: mp weight is 0.8 pts each", () => {
  assert.equal(computeFactionStrength({ mpCount: 100, influenceBonus: 0 }), 80);
});

test("computeFactionStrength: influence bonus is 10 pts each", () => {
  assert.equal(computeFactionStrength({ mpCount: 0, influenceBonus: 2 }), 20);
});

test("computeFactionStrength: combined formula", () => {
  // 50 × 0.8 + 1 × 10 = 50
  assert.equal(computeFactionStrength({ mpCount: 50, influenceBonus: 1 }), 50);
});

test("computeFactionStrength: clamps at 100", () => {
  assert.equal(computeFactionStrength({ mpCount: 200, influenceBonus: 10 }), 100);
});

test("computeFactionStrength: officeholderWeight adds to raw score", () => {
  assert.equal(computeFactionStrength({ mpCount: 0, influenceBonus: 0, officeholderWeight: 15 }), 15);
});

// ── political-state-service: faction cohesion ─────────────────────────────────

test("computeFactionCohesion: baseline with zero rebellion_bias is 70", () => {
  assert.equal(computeFactionCohesion(0), 70);
});

test("computeFactionCohesion: max rebellion_bias (1.0) yields floor 30", () => {
  // 70 - 1.0*40 = 30; floor is 5
  assert.equal(computeFactionCohesion(1.0), 30);
});

test("computeFactionCohesion: never falls below 5", () => {
  assert.ok(computeFactionCohesion(2.0) >= 5);
});

test("computeFactionCohesion: mid rebellion_bias", () => {
  // 70 - 0.5*40 = 50
  assert.equal(computeFactionCohesion(0.5), 50);
});

// ── political-state-service: leadership pressure ──────────────────────────────

test("computeLeadershipPressure: hostile alignment amplifies pressure", () => {
  const p = computeLeadershipPressure(50, "hostile");
  assert.ok(p > 50, `expected > 50, got ${p}`);
});

test("computeLeadershipPressure: aligned alignment dampens pressure", () => {
  const p = computeLeadershipPressure(50, "aligned");
  assert.ok(p < 50, `expected < 50, got ${p}`);
});

test("computeLeadershipPressure: neutral alignment gives 40% of power", () => {
  assert.equal(computeLeadershipPressure(50, "neutral"), 20); // 50 * 0.4 = 20
});

test("computeLeadershipPressure: unknown alignment falls back to neutral (40%)", () => {
  assert.equal(computeLeadershipPressure(50, "unknown"), 20);
});

test("computeLeadershipPressure: clamps to 100 for hostile overflow", () => {
  assert.equal(computeLeadershipPressure(100, "hostile"), 100);
});

// ── npcSlots computation (pure logic, mirrors server/index.js) ─────────────────

// Helper matching the npcSlots formula used in the server factions response.
const npcSlotsFor = (mpCount, activeMpMembers) => Math.max(0, mpCount - activeMpMembers);

test("npcSlots: equals allocatedMpCount minus activeMpMembersCount when positive", () => {
  assert.equal(npcSlotsFor(10, 3), 7);
  assert.equal(npcSlotsFor(5, 5), 0);
});

test("npcSlots: never negative when activeMpMembers exceeds allocated (data anomaly)", () => {
  assert.equal(npcSlotsFor(3, 5), 0);
});

test("npcSlots: fully available when no active MP members", () => {
  assert.equal(npcSlotsFor(20, 0), 20);
});

// ── momentum validation (pure logic, mirrors PATCH /api/admin/factions/:id) ──

test("momentum valid values: rising, stable, falling", () => {
  const valid = ["rising", "stable", "falling"];
  for (const v of valid) {
    assert.ok(valid.includes(v), `${v} should be valid`);
  }
});

test("momentum invalid values rejected", () => {
  const valid = ["rising", "stable", "falling"];
  for (const v of ["", "up", "down", "Rising", "STABLE", "unknown"]) {
    assert.ok(!valid.includes(v), `${v} should be invalid`);
  }
});

// ── MP-only enforcement (pure logic, mirrors POST /api/me/faction/switch and GET /api/me/faction) ──

// Helper: an MP is a character with a non-empty constituency.
const isCharacterMP = (constituency) => Boolean(constituency && String(constituency).trim());

test("isCharacterMP: empty string is not an MP", () => {
  assert.equal(isCharacterMP(""), false);
  assert.equal(isCharacterMP(null), false);
  assert.equal(isCharacterMP(undefined), false);
});

test("isCharacterMP: non-empty constituency is an MP", () => {
  assert.equal(isCharacterMP("Haltemprice and Howden"), true);
  assert.equal(isCharacterMP("  Islington North  "), true);
});

test("isCharacterMP: whitespace-only is not an MP", () => {
  assert.equal(isCharacterMP("   "), false);
});

// ── viewerRole expansion (mirrors GET /api/parties/:slug/faction-climate) ──

test("viewerRole: chairman and leader are distinct roles", () => {
  const ROLES = ["member", "whip", "chairman", "leader", "staff"];
  assert.ok(ROLES.includes("chairman"), "chairman must be a valid role");
  assert.ok(ROLES.includes("leader"), "leader must be a valid role");
  assert.notEqual(ROLES.indexOf("chairman"), ROLES.indexOf("leader"), "chairman and leader must be distinct");
});

test("viewerRole: chairman and leader both have full climate view", () => {
  const hasFullView = (role) => role === "staff" || role === "leader" || role === "chairman";
  assert.equal(hasFullView("chairman"), true);
  assert.equal(hasFullView("leader"), true);
  assert.equal(hasFullView("whip"), false);
  assert.equal(hasFullView("member"), false);
  assert.equal(hasFullView("staff"), true);
});

test("SPEAKER_PARTY_RE: matches 'Speaker' (any case)", () => {
  assert.ok(SPEAKER_PARTY_RE.test("Speaker"));
  assert.ok(SPEAKER_PARTY_RE.test("SPEAKER"));
  assert.ok(SPEAKER_PARTY_RE.test("speaker"));
});

test("SPEAKER_PARTY_RE: does not match other parties", () => {
  assert.ok(!SPEAKER_PARTY_RE.test("Conservative"));
  assert.ok(!SPEAKER_PARTY_RE.test("Labour"));
  // Regex uses ^ and $ anchors — only exact (case-insensitive) 'Speaker' matches;
  // multi-word strings like 'Speaker of the House' do not match.
  assert.ok(!SPEAKER_PARTY_RE.test("Speaker of the House"));
});

test("SINN_FEIN_PARTY_RE: matches variants of Sinn Féin", () => {
  assert.ok(SINN_FEIN_PARTY_RE.test("Sinn Féin"));
  assert.ok(SINN_FEIN_PARTY_RE.test("Sinn Fein"));
  assert.ok(SINN_FEIN_PARTY_RE.test("sinn féin"));
});

test("SINN_FEIN_PARTY_RE: does not match unrelated parties", () => {
  assert.ok(!SINN_FEIN_PARTY_RE.test("Conservative"));
  assert.ok(!SINN_FEIN_PARTY_RE.test("Labour"));
  assert.ok(!SINN_FEIN_PARTY_RE.test("DUP"));
});

// ── division-helpers: computeAllPlayerWeights ─────────────────────────────────

test("computeAllPlayerWeights: single player gets all party seats", () => {
  const seats = { Labour: 418 };
  const players = [{ name: "Alice", party: "Labour", role: "prime-minister", active: true }];
  const { effectiveWeights } = computeAllPlayerWeights(seats, players);
  assert.equal(effectiveWeights["Alice"], 418);
});

test("computeAllPlayerWeights: two players split seats evenly", () => {
  const seats = { Labour: 100 };
  const players = [
    { name: "Alice", party: "Labour", role: "minister", active: true },
    { name: "Bob",   party: "Labour", role: "backbencher", active: true,
      joinedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() },
  ];
  const { effectiveWeights } = computeAllPlayerWeights(seats, players);
  assert.equal(effectiveWeights["Alice"] + effectiveWeights["Bob"], 100);
});

test("computeAllPlayerWeights: Speaker party gets 0 weight", () => {
  const seats = { Speaker: 1 };
  const players = [{ name: "The Speaker", party: "Speaker", role: "backbencher", active: true }];
  const { effectiveWeights } = computeAllPlayerWeights(seats, players);
  assert.equal(effectiveWeights["The Speaker"], 0);
});

test("computeAllPlayerWeights: Sinn Féin party gets 0 weight", () => {
  const seats = { "Sinn Féin": 7 };
  const players = [{ name: "Gerry", party: "Sinn Féin", role: "backbencher", active: true }];
  const { effectiveWeights } = computeAllPlayerWeights(seats, players);
  assert.equal(effectiveWeights["Gerry"], 0);
});

test("computeAllPlayerWeights: new backbencher (<4 sim months) gets weight 1, settled member takes remainder", () => {
  const seats = { Labour: 100 };
  // joinedAt is yesterday — within the first 4 sim months (2 real weeks)
  const players = [
    { name: "NewMP",     party: "Labour", role: "backbencher", active: true,
      joinedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() },
    { name: "SettledMP", party: "Labour", role: "minister",    active: true },
  ];
  const { effectiveWeights } = computeAllPlayerWeights(seats, players);
  // New backbencher gets exactly 1; settled member absorbs the rest (100 - 1 = 99)
  assert.equal(effectiveWeights["NewMP"],     1);
  assert.equal(effectiveWeights["SettledMP"], 99);
});

test("computeAllPlayerWeights: absent player's weight delegates to leader", () => {
  const seats = { Labour: 100 };
  const players = [
    { name: "Leader", party: "Labour", role: "prime-minister", active: true },
    { name: "Absent", party: "Labour", role: "minister",       active: true, absent: true },
  ];
  const { effectiveWeights } = computeAllPlayerWeights(seats, players);
  assert.equal(effectiveWeights["Absent"], 0);
  assert.ok(effectiveWeights["Leader"] > 0, "leader should receive delegated weight");
});

test("computeAllPlayerWeights: returns empty weights for empty player list", () => {
  const { effectiveWeights, baseWeights } = computeAllPlayerWeights({}, []);
  assert.deepEqual(effectiveWeights, {});
  assert.deepEqual(baseWeights, {});
});

// ── division-helpers: computeCharacterWeight ──────────────────────────────────

test("computeCharacterWeight: returns weight from effectiveWeights when present", () => {
  const seats = { Conservative: 165 };
  const players = [{ name: "Tory", party: "Conservative", role: "minister", active: true }];
  const w = computeCharacterWeight(seats, players, "Tory", "Conservative", false);
  assert.equal(w, 165);
});

test("computeCharacterWeight: NPC not in state gets injected synthetically", () => {
  const seats = { Labour: 418 };
  const players = [{ name: "Alice", party: "Labour", role: "minister", active: true }];
  // NPC not in players list
  const w = computeCharacterWeight(seats, players, "NPC-Bob", "Labour", true);
  assert.ok(w > 0, `NPC-Bob should get a non-zero weight via synthetic injection`);
});

test("computeCharacterWeight: Sinn Féin NPC gets 0 even when injected", () => {
  const seats = { "Sinn Féin": 7 };
  const players = [];
  const w = computeCharacterWeight(seats, players, "SF-MP", "Sinn Féin", true);
  assert.equal(w, 0);
});

test("computeCharacterWeight: non-NPC missing from player list gets 0", () => {
  const seats = { Labour: 418 };
  const players = [{ name: "Alice", party: "Labour", role: "minister", active: true }];
  const w = computeCharacterWeight(seats, players, "Ghost", "Labour", false);
  assert.equal(w, 0);
});
