/**
 * Unit tests for server/discourse.js — DiscourseConnect SSO helpers.
 *
 * Run with: node --test server/discourse.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { buildSsoPayload, verifySsoPayload } from "./discourse.js";

// ── buildSsoPayload ───────────────────────────────────────────────────────────

test("buildSsoPayload returns sso and sig strings", () => {
  const result = buildSsoPayload({
    ssoSecret: "test-secret",
    returnUrl: "https://example.com/api/discourse/sso/callback",
    nonce: "abc123",
  });
  assert.equal(typeof result.sso, "string");
  assert.equal(typeof result.sig, "string");
  assert.ok(result.sso.length > 0, "sso payload should be non-empty");
  assert.ok(result.sig.length > 0, "sig should be non-empty");
});

test("buildSsoPayload encodes nonce and return_sso_url in payload", () => {
  const nonce     = "mynonce";
  const returnUrl = "https://example.com/api/discourse/sso/callback";
  const { sso }   = buildSsoPayload({ ssoSecret: "s", returnUrl, nonce });

  const decoded = Buffer.from(sso, "base64").toString("utf8");
  const params  = new URLSearchParams(decoded);

  assert.equal(params.get("nonce"), nonce);
  assert.equal(params.get("return_sso_url"), returnUrl);
});

// ── verifySsoPayload ──────────────────────────────────────────────────────────

test("buildSsoPayload / verifySsoPayload roundtrip succeeds", () => {
  const ssoSecret   = "shared-secret-roundtrip";
  const nonce       = "roundtrip-nonce-42";
  const returnUrl   = "https://app.example.com/api/discourse/sso/callback";

  // Step 1: build the outgoing payload (simulates what our server sends to Discourse)
  const { sso: outboundSso } = buildSsoPayload({ ssoSecret, returnUrl, nonce });

  // Step 2: simulate Discourse returning a payload for a user
  //         (in the real flow Discourse re-signs with the same secret and adds user fields)
  const raw     = Buffer.from(outboundSso, "base64").toString("utf8");
  const params  = new URLSearchParams(raw);
  params.set("external_id", "12345");
  params.set("email",       "user@example.com");
  params.set("username",    "testuser");
  params.set("name",        "Test User");

  const returnSso = Buffer.from(params.toString()).toString("base64");
  const returnSig = createHmac("sha256", ssoSecret).update(returnSso).digest("hex");

  // Step 3: verify the returned payload
  const user = verifySsoPayload({ ssoSecret, sso: returnSso, sig: returnSig, expectedNonce: nonce });

  assert.equal(user.externalId, "12345");
  assert.equal(user.email,      "user@example.com");
  assert.equal(user.username,   "testuser");
  assert.equal(user.name,       "Test User");
  assert.deepEqual(user.groups, []);
});

test("verifySsoPayload throws on signature mismatch", () => {
  const ssoSecret     = "correct-secret";
  const wrongSecret   = "wrong-secret";
  const nonce         = "nonce-sig-test";
  const returnUrl     = "https://app.example.com/callback";

  const { sso } = buildSsoPayload({ ssoSecret, returnUrl, nonce });

  // Build a sig using the wrong secret — should cause mismatch
  const badSig = createHmac("sha256", wrongSecret).update(sso).digest("hex");

  assert.throws(
    () => verifySsoPayload({ ssoSecret, sso, sig: badSig, expectedNonce: nonce }),
    /signature mismatch/i
  );
});

test("verifySsoPayload throws on nonce mismatch", () => {
  const ssoSecret = "secret-nonce-test";
  const nonce     = "correct-nonce";
  const returnUrl = "https://app.example.com/callback";

  const { sso, sig } = buildSsoPayload({ ssoSecret, returnUrl, nonce });

  assert.throws(
    () => verifySsoPayload({ ssoSecret, sso, sig, expectedNonce: "wrong-nonce" }),
    /nonce mismatch/i
  );
});

test("verifySsoPayload parses groups list", () => {
  const ssoSecret = "secret-groups";
  const nonce     = "grp-nonce";
  const returnUrl = "https://app.example.com/callback";

  const { sso: baseSso } = buildSsoPayload({ ssoSecret, returnUrl, nonce });

  const params = new URLSearchParams(Buffer.from(baseSso, "base64").toString("utf8"));
  params.set("external_id", "1");
  params.set("email",       "g@example.com");
  params.set("groups",      "moderators,trust_level_3");

  const sso = Buffer.from(params.toString()).toString("base64");
  const sig = createHmac("sha256", ssoSecret).update(sso).digest("hex");

  const user = verifySsoPayload({ ssoSecret, sso, sig, expectedNonce: nonce });
  assert.deepEqual(user.groups, ["moderators", "trust_level_3"]);
});

// ── SSO init / callback URL invariant ────────────────────────────────────────
// The provider-init endpoint always builds a payload whose return_sso_url
// points to the CALLBACK endpoint (/api/discourse/sso/callback), never back
// to the init endpoint (/api/discourse/sso).  These tests validate that
// buildSsoPayload correctly encodes whichever returnUrl is passed, and that
// the server must pass the callback path (enforced by endpoint logic).

test("buildSsoPayload return_sso_url ends with /api/discourse/sso/callback", () => {
  const returnUrl = "https://example.com/api/discourse/sso/callback";
  const { sso } = buildSsoPayload({ ssoSecret: "s", returnUrl, nonce: "n" });

  const decoded = Buffer.from(sso, "base64").toString("utf8");
  const params  = new URLSearchParams(decoded);

  assert.equal(params.get("return_sso_url"), returnUrl);
  assert.ok(
    params.get("return_sso_url").endsWith("/api/discourse/sso/callback"),
    "return_sso_url must end with /api/discourse/sso/callback"
  );
});

test("buildSsoPayload return_sso_url does NOT point to the init endpoint", () => {
  // The init endpoint path must never be used as return_sso_url.
  // Passing it here is a programmer error that the server-side logic prevents;
  // this test documents the distinction.
  const baseUrl     = "https://example.com";
  const initUrl      = `${baseUrl}/api/discourse/sso`;
  const callbackUrl  = `${baseUrl}/api/discourse/sso/callback`;

  const { sso: initSso } = buildSsoPayload({ ssoSecret: "s", returnUrl: initUrl,     nonce: "n1" });
  const { sso: cbSso }   = buildSsoPayload({ ssoSecret: "s", returnUrl: callbackUrl, nonce: "n2" });

  const initDecoded = new URLSearchParams(Buffer.from(initSso, "base64").toString("utf8"));
  const cbDecoded   = new URLSearchParams(Buffer.from(cbSso,   "base64").toString("utf8"));

  // Verify they differ — the callback URL is the only valid return_sso_url
  assert.notEqual(initDecoded.get("return_sso_url"), cbDecoded.get("return_sso_url"));
  assert.ok(
    cbDecoded.get("return_sso_url").endsWith("/api/discourse/sso/callback"),
    "callback payload must use the /callback path"
  );
  assert.ok(
    !initDecoded.get("return_sso_url").endsWith("/api/discourse/sso/callback"),
    "init URL must NOT match the callback pattern"
  );
});
