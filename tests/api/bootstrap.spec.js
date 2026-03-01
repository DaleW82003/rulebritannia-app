/**
 * tests/api/bootstrap.spec.js
 *
 * Smoke test: GET /api/bootstrap must return 200 with the expected shape,
 * both for anonymous and authenticated callers.
 *
 * Run with BASE_URL configured (e.g. in CI with a live backend):
 *   BASE_URL=https://... node --test tests/api/bootstrap.spec.js
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { BASE_URL, apiGet, loginAs } from "./helpers/session.js";

describe("GET /api/bootstrap", () => {
  test("returns 200 with clock, config, and null user when not authenticated", async () => {
    const { status, body } = await apiGet("/api/bootstrap", null);
    assert.strictEqual(status, 200, `/api/bootstrap should return 200, got ${status}`);
    assert.ok(body.clock, "response should include a clock object");
    assert.ok(body.config !== undefined, "response should include config");
    assert.strictEqual(body.user, null, "user should be null when not authenticated");
    // is_demo:true is returned by server/index.js when !isLoggedIn (see GET /api/bootstrap handler)
    assert.strictEqual(body.is_demo, true, "is_demo should be true when not authenticated");
  });

  describe("when authenticated", () => {
    let adminSession;

    before(async () => {
      adminSession = await loginAs("admin");
    });

    test("returns 200 with user and clock when authenticated", async () => {
      if (!adminSession) {
        // Skip if credentials not configured
        return;
      }
      const { status, body } = await apiGet("/api/bootstrap", adminSession);
      assert.strictEqual(status, 200, `/api/bootstrap should return 200 when authenticated, got ${status}`);
      assert.ok(body.clock, "response should include a clock object when authenticated");
      assert.ok(body.user, "response should include user when authenticated");
      assert.ok(body.csrfToken, "response should include csrfToken when authenticated");
    });
  });
});
