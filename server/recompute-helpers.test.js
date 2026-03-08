/**
 * Unit tests for server/recompute-helpers.js
 *
 * Verifies wrapper behaviour, structured logging, failure logging, and the
 * no-silent-swallow guarantee for fire-and-forget recomputes.
 *
 * Run: node --test recompute-helpers.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { fireRecompute, awaitedRecompute } from "./recompute-helpers.js";

// ── log capture utilities ─────────────────────────────────────────────────────

function captureConsoleLogs() {
  const logs = [];
  const errors = [];
  const origLog   = console.log;
  const origError = console.error;

  console.log   = (...args) => logs.push(args.join(" "));
  console.error = (...args) => errors.push(args.join(" "));

  return {
    logs,
    errors,
    restore() {
      console.log   = origLog;
      console.error = origError;
    },
  };
}

// ── fireRecompute ─────────────────────────────────────────────────────────────

test("fireRecompute: logs start immediately", async () => {
  const cap = captureConsoleLogs();
  try {
    let resolve;
    const p = new Promise((r) => { resolve = r; });
    fireRecompute("char-state", "test.start", () => p);
    assert.ok(cap.logs.some((l) => l.includes("[recompute] start") && l.includes("char-state") && l.includes("test.start")));
    resolve();
    await p.catch(() => {});
  } finally {
    cap.restore();
  }
});

test("fireRecompute: logs ok with dur on success", async () => {
  const cap = captureConsoleLogs();
  try {
    await new Promise((resolve) => {
      fireRecompute("char-state", "test.ok", () => Promise.resolve("done"));
      // wait a tick for the .then() to run
      setImmediate(resolve);
    });
    await new Promise((r) => setImmediate(r)); // second tick for .then() logging
    assert.ok(cap.logs.some((l) => l.includes("[recompute] ok") && l.includes("char-state") && l.includes("test.ok") && l.includes("dur=")));
  } finally {
    cap.restore();
  }
});

test("fireRecompute: logs FAILED on rejection — never swallows silently", async () => {
  const cap = captureConsoleLogs();
  try {
    await new Promise((resolve) => {
      fireRecompute("char-state", "test.fail", () => Promise.reject(new Error("boom")));
      setImmediate(resolve);
    });
    await new Promise((r) => setImmediate(r)); // second tick for .catch() logging
    assert.ok(cap.errors.some((l) => l.includes("[recompute] FAILED") && l.includes("char-state") && l.includes("test.fail") && l.includes("boom")));
  } finally {
    cap.restore();
  }
});

test("fireRecompute: FAILED log includes dur= field", async () => {
  const cap = captureConsoleLogs();
  try {
    await new Promise((resolve) => {
      fireRecompute("faction-state", "test.dur", () => Promise.reject(new Error("err")));
      setImmediate(resolve);
    });
    await new Promise((r) => setImmediate(r));
    assert.ok(cap.errors.some((l) => l.includes("dur=")));
  } finally {
    cap.restore();
  }
});

test("fireRecompute: does not throw synchronously on rejection", () => {
  // fireRecompute must not propagate rejection to the caller
  assert.doesNotThrow(() => {
    fireRecompute("char-state", "test.nothrow", () => Promise.reject(new Error("nothrow")));
  });
});

test("fireRecompute: handles non-Error rejection (string) without crashing", async () => {
  const cap = captureConsoleLogs();
  try {
    await new Promise((resolve) => {
      // eslint-disable-next-line prefer-promise-reject-errors
      fireRecompute("char-state", "test.string-err", () => Promise.reject("plain-string-error"));
      setImmediate(resolve);
    });
    await new Promise((r) => setImmediate(r));
    assert.ok(cap.errors.some((l) => l.includes("[recompute] FAILED") && l.includes("plain-string-error")));
  } finally {
    cap.restore();
  }
});

test("fireRecompute: includes type and trigger in start + ok logs", async () => {
  const cap = captureConsoleLogs();
  try {
    await new Promise((resolve) => {
      fireRecompute("faction-political-state", "faction.allocation.update", () => Promise.resolve());
      setImmediate(resolve);
    });
    await new Promise((r) => setImmediate(r));
    const startLine = cap.logs.find((l) => l.includes("[recompute] start"));
    const okLine    = cap.logs.find((l) => l.includes("[recompute] ok"));
    assert.ok(startLine?.includes("faction-political-state"));
    assert.ok(startLine?.includes("faction.allocation.update"));
    assert.ok(okLine?.includes("faction-political-state"));
    assert.ok(okLine?.includes("faction.allocation.update"));
  } finally {
    cap.restore();
  }
});

// ── awaitedRecompute ──────────────────────────────────────────────────────────

test("awaitedRecompute: returns fn result on success", async () => {
  const cap = captureConsoleLogs();
  try {
    const result = await awaitedRecompute("char-state", "test.await-ok", () => Promise.resolve({ capital: 42 }));
    assert.deepEqual(result, { capital: 42 });
  } finally {
    cap.restore();
  }
});

test("awaitedRecompute: logs start and ok", async () => {
  const cap = captureConsoleLogs();
  try {
    await awaitedRecompute("char-state", "test.await-log", () => Promise.resolve());
    assert.ok(cap.logs.some((l) => l.includes("[recompute] start") && l.includes("test.await-log")));
    assert.ok(cap.logs.some((l) => l.includes("[recompute] ok")    && l.includes("test.await-log")));
  } finally {
    cap.restore();
  }
});

test("awaitedRecompute: ok log includes dur=", async () => {
  const cap = captureConsoleLogs();
  try {
    await awaitedRecompute("char-state", "test.dur-ok", () => Promise.resolve());
    assert.ok(cap.logs.some((l) => l.includes("[recompute] ok") && l.includes("dur=")));
  } finally {
    cap.restore();
  }
});

test("awaitedRecompute: rethrows on failure and logs FAILED", async () => {
  const cap = captureConsoleLogs();
  try {
    await assert.rejects(
      () => awaitedRecompute("char-state", "test.await-fail", () => Promise.reject(new Error("db-error"))),
      /db-error/
    );
    assert.ok(cap.errors.some((l) => l.includes("[recompute] FAILED") && l.includes("db-error")));
  } finally {
    cap.restore();
  }
});

test("awaitedRecompute: FAILED log includes type, trigger, dur", async () => {
  const cap = captureConsoleLogs();
  try {
    await assert.rejects(
      () => awaitedRecompute("faction-state", "test.fields", () => Promise.reject(new Error("oops"))),
      /oops/
    );
    const failLine = cap.errors.find((l) => l.includes("[recompute] FAILED"));
    assert.ok(failLine?.includes("faction-state"));
    assert.ok(failLine?.includes("test.fields"));
    assert.ok(failLine?.includes("dur="));
    assert.ok(failLine?.includes("oops"));
  } finally {
    cap.restore();
  }
});
