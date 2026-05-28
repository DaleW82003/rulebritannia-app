/**
 * Unit tests for server/clock.js — computeSimDateFromGameState helper.
 *
 * Run with: node --test server/clock.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSimDateFromGameState } from "./clock.js";

// ── null / undefined / empty input ──────────────────────────────────────────

function getFallbackClock() {
  return computeSimDateFromGameState(null);
}

test("returns default-scenario fallback for null gameState", () => {
  const fallback = getFallbackClock();
  const result = computeSimDateFromGameState(null);
  assert.deepEqual(result, fallback);
});

test("returns default-scenario fallback for undefined gameState", () => {
  const fallback = getFallbackClock();
  const result = computeSimDateFromGameState(undefined);
  assert.deepEqual(result, fallback);
});

test("returns default-scenario fallback for non-object gameState", () => {
  const fallback = getFallbackClock();
  const result = computeSimDateFromGameState("bad-value");
  assert.deepEqual(result, fallback);
});

// ── sim not yet started (started === false) ──────────────────────────────────

test("returns configured start date when sim not started", () => {
  const gs = {
    started: false,
    startSimMonth: 5,
    startSimYear: 1997,
    startRealDate: "",
    isPaused: false,
    pausedAtRealDate: "",
  };
  const result = computeSimDateFromGameState(gs);
  assert.deepEqual(result, { month: 5, year: 1997 }, "should return May 1997");
});

test("returns configured start date when sim not started — different month", () => {
  const gs = {
    started: false,
    startSimMonth: 11,
    startSimYear: 2001,
    startRealDate: "",
    isPaused: false,
    pausedAtRealDate: "",
  };
  const result = computeSimDateFromGameState(gs);
  assert.deepEqual(result, { month: 11, year: 2001 }, "should return November 2001");
});

test("returns default-scenario fallback when started=false but no valid start values", () => {
  const fallback = getFallbackClock();
  const gs = { started: false };
  const result = computeSimDateFromGameState(gs);
  assert.deepEqual(result, fallback);
});

// ── sim started: dynamic Monday/Thursday computation ────────────────────────

test("returns start date when now == startRealDate (zero sim months elapsed)", () => {
  // Wednesday 2024-01-10 — not a Monday or Thursday, so 0 sim months elapsed
  const startDate = new Date("2024-01-10T00:00:00Z");
  const gs = {
    started: true,
    startSimMonth: 5,
    startSimYear: 1997,
    startRealDate: startDate.toISOString(),
    isPaused: false,
    pausedAtRealDate: "",
  };
  const result = computeSimDateFromGameState(gs, startDate);
  assert.deepEqual(result, { month: 5, year: 1997 }, "should remain at May 1997");
});

test("advances by 1 month after first Thursday since startRealDate", () => {
  // Wednesday 2024-01-10 → Thursday 2024-01-11: only 1 sim boundary (Thursday)
  const startDate = new Date("2024-01-10T12:00:00Z"); // Wednesday
  const now       = new Date("2024-01-11T12:00:00Z"); // Thursday
  const gs = {
    started: true,
    startSimMonth: 5,
    startSimYear: 1997,
    startRealDate: startDate.toISOString(),
    isPaused: false,
    pausedAtRealDate: "",
  };
  const result = computeSimDateFromGameState(gs, now);
  assert.deepEqual(result, { month: 6, year: 1997 }, "should advance to June 1997 after first Thursday");
});

test("advances by 2 months after Thursday then Monday in same week", () => {
  // Wednesday 2024-01-10 → Monday 2024-01-15: Thursday Jan-11 (1) + Monday Jan-15 (1) = 2 sim months
  const startDate = new Date("2024-01-10T12:00:00Z"); // Wednesday
  const now       = new Date("2024-01-15T12:00:00Z"); // Monday
  const gs = {
    started: true,
    startSimMonth: 5,
    startSimYear: 1997,
    startRealDate: startDate.toISOString(),
    isPaused: false,
    pausedAtRealDate: "",
  };
  const result = computeSimDateFromGameState(gs, now);
  assert.deepEqual(result, { month: 7, year: 1997 }, "should advance to July 1997 after Thu + Mon");
});

test("rolls over year boundary correctly", () => {
  // Start December 1997; advance 1 sim month (Wed→Thu) → January 1998
  const startDate = new Date("2024-01-10T12:00:00Z"); // Wednesday
  const now       = new Date("2024-01-11T12:00:00Z"); // Thursday
  const gs = {
    started: true,
    startSimMonth: 12,
    startSimYear: 1997,
    startRealDate: startDate.toISOString(),
    isPaused: false,
    pausedAtRealDate: "",
  };
  const result = computeSimDateFromGameState(gs, now);
  assert.deepEqual(result, { month: 1, year: 1998 }, "should roll over to January 1998");
});

// ── paused ───────────────────────────────────────────────────────────────────

test("uses pausedAtRealDate when paused, ignoring current real time", () => {
  // Sim started on Wednesday 2024-01-10. Paused on Thursday 2024-01-11 (1 sim month elapsed).
  // Real "now" is 2024-02-01 (much later), but should be ignored.
  const startDate  = new Date("2024-01-10T12:00:00Z"); // Wednesday
  const pausedDate = new Date("2024-01-11T12:00:00Z"); // Thursday (1 sim month)
  const laterDate  = new Date("2024-02-01T12:00:00Z");
  const gs = {
    started: true,
    startSimMonth: 5,
    startSimYear: 1997,
    startRealDate: startDate.toISOString(),
    isPaused: true,
    pausedAtRealDate: pausedDate.toISOString(),
  };
  const result = computeSimDateFromGameState(gs, laterDate);
  assert.deepEqual(result, { month: 6, year: 1997 }, "should use pausedAtRealDate, not laterDate");
});

// ── sim started but missing startRealDate ────────────────────────────────────

test("falls back to start month/year when started=true but startRealDate missing", () => {
  const gs = {
    started: true,
    startSimMonth: 5,
    startSimYear: 1997,
    startRealDate: "",
    isPaused: false,
    pausedAtRealDate: "",
  };
  const result = computeSimDateFromGameState(gs);
  assert.deepEqual(result, { month: 5, year: 1997 });
});
