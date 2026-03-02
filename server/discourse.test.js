/**
 * Unit tests for server/discourse.js — DiscourseConnect SSO helpers.
 *
 * Run with: node --test server/discourse.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { buildSsoPayload, verifySsoPayload, verifyConsumerRequest, buildConsumerResponse, resolveGroupIds, getGroupMembers, addGroupMembers, removeGroupMembers } from "./discourse.js";
import { DISCOURSE_GROUP_MAP } from "./roles.js";

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

// ── verifyConsumerRequest ─────────────────────────────────────────────────────
// In consumer mode Discourse calls our DiscourseConnect URL with a signed
// payload containing nonce + return_sso_url.

test("verifyConsumerRequest extracts nonce and returnSsoUrl from a valid request", () => {
  const ssoSecret    = "consumer-secret";
  const nonce        = "discourse-nonce-1";
  const returnSsoUrl = "https://forum.rulebritannia.org/session/sso_login";

  // Simulate what Discourse sends: base64(nonce=...&return_sso_url=...) + HMAC
  const raw     = `nonce=${nonce}&return_sso_url=${encodeURIComponent(returnSsoUrl)}`;
  const sso     = Buffer.from(raw).toString("base64");
  const sig     = createHmac("sha256", ssoSecret).update(sso).digest("hex");

  const result = verifyConsumerRequest({ ssoSecret, sso, sig });

  assert.equal(result.nonce,        nonce);
  assert.equal(result.returnSsoUrl, returnSsoUrl);
});

test("verifyConsumerRequest throws on invalid signature", () => {
  const ssoSecret = "consumer-secret";
  const raw       = "nonce=abc&return_sso_url=https%3A%2F%2Fforum.example.com%2Fsession%2Fsso_login";
  const sso       = Buffer.from(raw).toString("base64");
  const badSig    = createHmac("sha256", "wrong-secret").update(sso).digest("hex");

  assert.throws(
    () => verifyConsumerRequest({ ssoSecret, sso, sig: badSig }),
    /signature mismatch/i
  );
});

// ── buildConsumerResponse ─────────────────────────────────────────────────────
// After authenticating the user we build a signed payload to redirect back.

test("buildConsumerResponse produces a verifiable payload", () => {
  const ssoSecret  = "consumer-resp-secret";
  const nonce      = "resp-nonce";
  const externalId = "user-uuid-42";
  const email      = "player@example.com";
  const username   = "player42";

  const { sso, sig } = buildConsumerResponse({ ssoSecret, nonce, externalId, email, username });

  // Verify HMAC
  const expected = createHmac("sha256", ssoSecret).update(sso).digest("hex");
  assert.equal(sig, expected);

  // Decode and check fields
  const decoded = Buffer.from(sso, "base64").toString("utf8");
  const params  = new URLSearchParams(decoded);
  assert.equal(params.get("nonce"),       nonce);
  assert.equal(params.get("external_id"), externalId);
  assert.equal(params.get("email"),       email);
  assert.equal(params.get("username"),    username);
});

test("buildConsumerResponse includes groups, admin, and moderator flags", () => {
  const ssoSecret = "consumer-flags-secret";
  const { sso }   = buildConsumerResponse({
    ssoSecret,
    nonce:      "n",
    externalId: "1",
    email:      "a@b.com",
    username:   "ab",
    groups:     ["Labour", "Backbenchers"],
    admin:      true,
    moderator:  false,
  });

  const params = new URLSearchParams(Buffer.from(sso, "base64").toString("utf8"));
  assert.equal(params.get("groups"),    "Labour,Backbenchers");
  assert.equal(params.get("admin"),     "true");
  assert.equal(params.get("moderator"), null);  // omitted when false
});

test("buildConsumerResponse sets moderator flag when true", () => {
  const ssoSecret = "consumer-mod-secret";
  const { sso }   = buildConsumerResponse({
    ssoSecret,
    nonce:      "n",
    externalId: "2",
    email:      "mod@b.com",
    username:   "moduser",
    admin:      false,
    moderator:  true,
  });

  const params = new URLSearchParams(Buffer.from(sso, "base64").toString("utf8"));
  assert.equal(params.get("moderator"), "true");
  assert.equal(params.get("admin"),     null);  // omitted when false
});

test("buildConsumerResponse / verifyConsumerRequest roundtrip: nonce preserved", () => {
  const ssoSecret    = "roundtrip-consumer";
  const nonce        = "rt-nonce-99";
  const returnSsoUrl = "https://forum.rulebritannia.org/session/sso_login";

  // Step 1: simulate Discourse's inbound request
  const raw    = `nonce=${nonce}&return_sso_url=${encodeURIComponent(returnSsoUrl)}`;
  const inSso  = Buffer.from(raw).toString("base64");
  const inSig  = createHmac("sha256", ssoSecret).update(inSso).digest("hex");

  // Step 2: verify inbound
  const { nonce: extractedNonce, returnSsoUrl: extractedUrl } =
    verifyConsumerRequest({ ssoSecret, sso: inSso, sig: inSig });
  assert.equal(extractedNonce, nonce);
  assert.equal(extractedUrl,   returnSsoUrl);

  // Step 3: build outbound response using the extracted nonce
  const { sso: outSso, sig: outSig } = buildConsumerResponse({
    ssoSecret,
    nonce:      extractedNonce,
    externalId: "sim-user-1",
    email:      "test@example.com",
    username:   "testplayer",
  });

  // Verify outbound signature is valid
  const expectedOutSig = createHmac("sha256", ssoSecret).update(outSso).digest("hex");
  assert.equal(outSig, expectedOutSig);

  // Nonce must round-trip correctly
  const outParams = new URLSearchParams(Buffer.from(outSso, "base64").toString("utf8"));
  assert.equal(outParams.get("nonce"), nonce);
});

// ── resolveGroupIds ───────────────────────────────────────────────────────────

test("resolveGroupIds returns name→id map from a single page", async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: (h) => h === "content-type" ? "application/json" : null },
    json: async () => ({
      groups: [
        { id: 1, name: "admins" },
        { id: 2, name: "moderators" },
      ],
      load_more_groups: null,
    }),
  });
  try {
    const map = await resolveGroupIds({ baseUrl: "https://forum.example.com", apiKey: "k", apiUsername: "u" });
    assert.equal(map.get("admins"),     1);
    assert.equal(map.get("moderators"), 2);
    assert.equal(map.size, 2);
  } finally {
    globalThis.fetch = saved;
  }
});

test("resolveGroupIds follows load_more_groups pagination", async () => {
  const saved = globalThis.fetch;
  let calls = 0;
  const jsonHeaders = { get: (h) => h === "content-type" ? "application/json" : null };
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      return {
        ok: true,
        status: 200,
        headers: jsonHeaders,
        json: async () => ({
          groups: [{ id: 1, name: "admins" }],
          load_more_groups: "/groups.json?page=1",
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: jsonHeaders,
      json: async () => ({
        groups: [{ id: 2, name: "moderators" }],
        load_more_groups: null,
      }),
    };
  };
  try {
    const map = await resolveGroupIds({ baseUrl: "https://forum.example.com", apiKey: "k", apiUsername: "u", _pageDelayMs: 0 });
    assert.equal(calls, 2);
    assert.equal(map.get("admins"),     1);
    assert.equal(map.get("moderators"), 2);
  } finally {
    globalThis.fetch = saved;
  }
});

test("resolveGroupIds throws on HTTP error", async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 403, text: async () => "Forbidden" });
  try {
    await assert.rejects(
      () => resolveGroupIds({ baseUrl: "https://forum.example.com", apiKey: "k", apiUsername: "u" }),
      /resolveGroupIds failed: HTTP 403/
    );
  } finally {
    globalThis.fetch = saved;
  }
});

test("resolveGroupIds throws descriptive error when HTTP 200 but content-type is text/html", async () => {
  const saved = globalThis.fetch;
  const htmlBody = "<!DOCTYPE html><html><body>Login required</body></html>";
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: (h) => h === "content-type" ? "text/html; charset=utf-8" : null },
    text: async () => htmlBody,
  });
  try {
    await assert.rejects(
      () => resolveGroupIds({ baseUrl: "https://forum.example.com", apiKey: "k", apiUsername: "u" }),
      (err) => {
        assert.ok(/resolveGroupIds failed/.test(err.message), `expected 'resolveGroupIds failed' in: ${err.message}`);
        assert.ok(/content-type=text\/html/.test(err.message), `expected content-type in: ${err.message}`);
        assert.ok(/Login required/.test(err.message), `expected body snippet in: ${err.message}`);
        return true;
      }
    );
  } finally {
    globalThis.fetch = saved;
  }
});

test("resolveGroupIds succeeds when content-type is application/json", async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: (h) => h === "content-type" ? "application/json; charset=utf-8" : null },
    json: async () => ({ groups: [{ id: 5, name: "staff" }], load_more_groups: null }),
  });
  try {
    const map = await resolveGroupIds({ baseUrl: "https://forum.example.com", apiKey: "k", apiUsername: "u" });
    assert.equal(map.get("staff"), 5);
    assert.equal(map.size, 1);
  } finally {
    globalThis.fetch = saved;
  }
});

// ── getGroupMembers — groupId in URL ──────────────────────────────────────────

test("getGroupMembers uses groupId (not groupName) in URL when provided", async () => {
  const saved = globalThis.fetch;
  let capturedUrl = null;
  globalThis.fetch = async (url) => {
    capturedUrl = url;
    return { ok: true, json: async () => ({ members: [{ id: 10, username: "alice" }] }) };
  };
  try {
    const members = await getGroupMembers({
      baseUrl: "https://forum.example.com", apiKey: "k", apiUsername: "u",
      groupName: "admins", groupId: 42,
    });
    assert.ok(capturedUrl.includes("/groups/42/"), `Expected /groups/42/ in URL, got: ${capturedUrl}`);
    assert.equal(members.length, 1);
    assert.equal(members[0].username, "alice");
  } finally {
    globalThis.fetch = saved;
  }
});

test("getGroupMembers falls back to groupName in URL when groupId is absent", async () => {
  const saved = globalThis.fetch;
  let capturedUrl = null;
  globalThis.fetch = async (url) => {
    capturedUrl = url;
    return { ok: true, json: async () => ({ members: [] }) };
  };
  try {
    await getGroupMembers({
      baseUrl: "https://forum.example.com", apiKey: "k", apiUsername: "u",
      groupName: "admins",
    });
    assert.ok(capturedUrl.includes("/groups/admins/"), `Expected /groups/admins/ in URL, got: ${capturedUrl}`);
  } finally {
    globalThis.fetch = saved;
  }
});

// ── addGroupMembers — groupId in URL ──────────────────────────────────────────

test("addGroupMembers uses groupId in URL when provided", async () => {
  const saved = globalThis.fetch;
  let capturedUrl = null;
  globalThis.fetch = async (url) => { capturedUrl = url; return { ok: true }; };
  try {
    await addGroupMembers({
      baseUrl: "https://forum.example.com", apiKey: "k", apiUsername: "u",
      groupName: "admins", groupId: 7, usernames: ["bob"],
    });
    assert.ok(capturedUrl.includes("/groups/7/"), `Expected /groups/7/ in URL, got: ${capturedUrl}`);
  } finally {
    globalThis.fetch = saved;
  }
});

// ── removeGroupMembers — groupId in URL ───────────────────────────────────────

test("removeGroupMembers uses groupId in URL when provided", async () => {
  const saved = globalThis.fetch;
  let capturedUrl = null;
  globalThis.fetch = async (url) => { capturedUrl = url; return { ok: true }; };
  try {
    await removeGroupMembers({
      baseUrl: "https://forum.example.com", apiKey: "k", apiUsername: "u",
      groupName: "moderators", groupId: 3, usernames: ["carol"],
    });
    assert.ok(capturedUrl.includes("/groups/3/"), `Expected /groups/3/ in URL, got: ${capturedUrl}`);
  } finally {
    globalThis.fetch = saved;
  }
});

// ── redirect: "manual" assertions ────────────────────────────────────────────

test("resolveGroupIds sets redirect: manual", async () => {
  const saved = globalThis.fetch;
  let capturedInit = null;
  globalThis.fetch = async (_url, init) => {
    capturedInit = init;
    return {
      ok: true,
      status: 200,
      headers: { get: (h) => h === "content-type" ? "application/json" : null },
      json: async () => ({ groups: [], load_more_groups: null }),
    };
  };
  try {
    await resolveGroupIds({ baseUrl: "https://forum.example.com", apiKey: "k", apiUsername: "u" });
    assert.equal(capturedInit?.redirect, "manual");
  } finally {
    globalThis.fetch = saved;
  }
});

test("getGroupMembers sets redirect: manual", async () => {
  const saved = globalThis.fetch;
  let capturedInit = null;
  globalThis.fetch = async (_url, init) => { capturedInit = init; return { ok: true, json: async () => ({ members: [] }) }; };
  try {
    await getGroupMembers({ baseUrl: "https://forum.example.com", apiKey: "k", apiUsername: "u", groupName: "staff", groupId: 5 });
    assert.equal(capturedInit?.redirect, "manual");
  } finally {
    globalThis.fetch = saved;
  }
});

test("addGroupMembers sets redirect: manual", async () => {
  const saved = globalThis.fetch;
  let capturedInit = null;
  globalThis.fetch = async (_url, init) => { capturedInit = init; return { ok: true }; };
  try {
    await addGroupMembers({ baseUrl: "https://forum.example.com", apiKey: "k", apiUsername: "u", groupName: "staff", groupId: 5, usernames: ["alice"] });
    assert.equal(capturedInit?.redirect, "manual");
  } finally {
    globalThis.fetch = saved;
  }
});

test("removeGroupMembers sets redirect: manual", async () => {
  const saved = globalThis.fetch;
  let capturedInit = null;
  globalThis.fetch = async (_url, init) => { capturedInit = init; return { ok: true }; };
  try {
    await removeGroupMembers({ baseUrl: "https://forum.example.com", apiKey: "k", apiUsername: "u", groupName: "staff", groupId: 5, usernames: ["alice"] });
    assert.equal(capturedInit?.redirect, "manual");
  } finally {
    globalThis.fetch = saved;
  }
});

test("resolveGroupIds non-JSON error includes res.url", async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async (_url, _init) => ({
    ok:      true,
    status:  200,
    url:     "https://forum.example.com/login",
    headers: { get: () => "text/html" },
    text:    async () => "<html>Login</html>",
  });
  try {
    await assert.rejects(
      () => resolveGroupIds({ baseUrl: "https://forum.example.com", apiKey: "k", apiUsername: "u" }),
      (err) => {
        assert.ok(err.message.includes("https://forum.example.com/login"), `Expected res.url in error: ${err.message}`);
        return true;
      },
    );
  } finally {
    globalThis.fetch = saved;
  }
});

// ── Header assertions ─────────────────────────────────────────────────────────

test("resolveGroupIds sends Api-Key, Api-Username and Accept: application/json headers", async () => {
  const saved = globalThis.fetch;
  let capturedInit = null;
  globalThis.fetch = async (_url, init) => {
    capturedInit = init;
    return {
      ok: true,
      status: 200,
      headers: { get: (h) => h === "content-type" ? "application/json" : null },
      json: async () => ({ groups: [], load_more_groups: null }),
    };
  };
  try {
    await resolveGroupIds({ baseUrl: "https://forum.example.com", apiKey: "mykey", apiUsername: "myuser" });
    assert.equal(capturedInit?.headers?.["Api-Key"],      "mykey");
    assert.equal(capturedInit?.headers?.["Api-Username"], "myuser");
    assert.equal(capturedInit?.headers?.["Accept"],       "application/json");
    assert.equal(capturedInit?.method, "GET");
  } finally {
    globalThis.fetch = saved;
  }
});

test("resolveGroupIds strips trailing slash from baseUrl", async () => {
  const saved = globalThis.fetch;
  let capturedUrl = null;
  globalThis.fetch = async (url, _init) => {
    capturedUrl = url;
    return {
      ok: true,
      status: 200,
      headers: { get: (h) => h === "content-type" ? "application/json" : null },
      json: async () => ({ groups: [], load_more_groups: null }),
    };
  };
  try {
    await resolveGroupIds({ baseUrl: "https://forum.example.com/", apiKey: "k", apiUsername: "u" });
    assert.ok(!capturedUrl.includes("//groups"), `Double slash in URL: ${capturedUrl}`);
    assert.ok(capturedUrl.endsWith("/groups.json"), `Expected /groups.json, got: ${capturedUrl}`);
  } finally {
    globalThis.fetch = saved;
  }
});

test("getGroupMembers sends Api-Key, Api-Username and Accept: application/json headers", async () => {
  const saved = globalThis.fetch;
  let capturedInit = null;
  globalThis.fetch = async (_url, init) => {
    capturedInit = init;
    return { ok: true, json: async () => ({ members: [] }) };
  };
  try {
    await getGroupMembers({ baseUrl: "https://forum.example.com", apiKey: "mykey", apiUsername: "myuser", groupName: "staff", groupId: 5 });
    assert.equal(capturedInit?.headers?.["Api-Key"],      "mykey");
    assert.equal(capturedInit?.headers?.["Api-Username"], "myuser");
    assert.equal(capturedInit?.headers?.["Accept"],       "application/json");
    assert.equal(capturedInit?.method, "GET");
  } finally {
    globalThis.fetch = saved;
  }
});

test("addGroupMembers sends Api-Key, Api-Username and Accept: application/json headers", async () => {
  const saved = globalThis.fetch;
  let capturedInit = null;
  globalThis.fetch = async (_url, init) => { capturedInit = init; return { ok: true }; };
  try {
    await addGroupMembers({ baseUrl: "https://forum.example.com", apiKey: "mykey", apiUsername: "myuser", groupName: "staff", groupId: 5, usernames: ["alice"] });
    assert.equal(capturedInit?.headers?.["Api-Key"],      "mykey");
    assert.equal(capturedInit?.headers?.["Api-Username"], "myuser");
    assert.equal(capturedInit?.headers?.["Accept"],       "application/json");
  } finally {
    globalThis.fetch = saved;
  }
});

test("removeGroupMembers sends Api-Key, Api-Username and Accept: application/json headers", async () => {
  const saved = globalThis.fetch;
  let capturedInit = null;
  globalThis.fetch = async (_url, init) => { capturedInit = init; return { ok: true }; };
  try {
    await removeGroupMembers({ baseUrl: "https://forum.example.com", apiKey: "mykey", apiUsername: "myuser", groupName: "staff", groupId: 5, usernames: ["alice"] });
    assert.equal(capturedInit?.headers?.["Api-Key"],      "mykey");
    assert.equal(capturedInit?.headers?.["Api-Username"], "myuser");
    assert.equal(capturedInit?.headers?.["Accept"],       "application/json");
  } finally {
    globalThis.fetch = saved;
  }
});

// ── DISCOURSE_GROUP_MAP — no automatic groups ─────────────────────────────────

test("DISCOURSE_GROUP_MAP does not contain the Discourse automatic groups admins or moderators", () => {
  const values = Object.values(DISCOURSE_GROUP_MAP);
  assert.ok(!values.includes("admins"),     "admins must not appear in DISCOURSE_GROUP_MAP");
  assert.ok(!values.includes("moderators"), "moderators must not appear in DISCOURSE_GROUP_MAP");
});

// ── 429 retry behaviour ───────────────────────────────────────────────────────

test("resolveGroupIds retries on 429 with wait_seconds and eventually succeeds", async () => {
  const saved = globalThis.fetch;
  let calls = 0;
  const jsonHeaders = { get: (h) => h === "content-type" ? "application/json" : null };
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      return {
        ok: false,
        status: 429,
        headers: jsonHeaders,
        json: async () => ({ errors: ["Too many requests"], error_type: "rate_limit", extras: { wait_seconds: 1 } }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: jsonHeaders,
      json: async () => ({ groups: [{ id: 10, name: "staff" }], load_more_groups: null }),
    };
  };
  const sleepCalls = [];
  const noopSleep = async (ms) => { sleepCalls.push(ms); };
  try {
    const map = await resolveGroupIds({ baseUrl: "https://forum.example.com", apiKey: "k", apiUsername: "u", _sleep: noopSleep });
    assert.equal(calls, 2, "fetch should be called twice (1 retry)");
    assert.equal(map.get("staff"), 10);
    assert.equal(sleepCalls.length, 1, "sleep should be called once");
    assert.equal(sleepCalls[0], 1250, "sleep duration should be wait_seconds*1000 + 250ms");
  } finally {
    globalThis.fetch = saved;
  }
});

test("resolveGroupIds does not retry on non-429 errors (e.g. 401)", async () => {
  const saved = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: false, status: 401, text: async () => "Unauthorized" };
  };
  try {
    await assert.rejects(
      () => resolveGroupIds({ baseUrl: "https://forum.example.com", apiKey: "k", apiUsername: "u" }),
      /resolveGroupIds failed: HTTP 401/
    );
    assert.equal(calls, 1, "fetch should only be called once — no retry on 401");
  } finally {
    globalThis.fetch = saved;
  }
});

test("resolveGroupIds uses exponential fallback when 429 body is not JSON", async () => {
  const saved = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      return {
        ok: false,
        status: 429,
        headers: { get: () => "text/plain" },
        text: async () => "rate limited",
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: (h) => h === "content-type" ? "application/json" : null },
      json: async () => ({ groups: [], load_more_groups: null }),
    };
  };
  const sleepCalls = [];
  const noopSleep = async (ms) => { sleepCalls.push(ms); };
  try {
    await resolveGroupIds({ baseUrl: "https://forum.example.com", apiKey: "k", apiUsername: "u", _sleep: noopSleep });
    assert.equal(calls, 2);
    assert.equal(sleepCalls.length, 1);
    assert.equal(sleepCalls[0], 2000, "fallback delay for attempt 0 should be 2000ms");
  } finally {
    globalThis.fetch = saved;
  }
});

test("resolveGroupIds throws after exhausting max retries on persistent 429", async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 429,
    headers: { get: (h) => h === "content-type" ? "application/json" : null },
    json: async () => ({ extras: { wait_seconds: 1 } }),
  });
  const noopSleep = async () => {};
  try {
    await assert.rejects(
      () => resolveGroupIds({ baseUrl: "https://forum.example.com", apiKey: "k", apiUsername: "u", _sleep: noopSleep }),
      /Discourse API rate-limited: HTTP 429/
    );
  } finally {
    globalThis.fetch = saved;
  }
});

test("getGroupMembers retries on 429 and eventually succeeds", async () => {
  const saved = globalThis.fetch;
  let calls = 0;
  const jsonHeaders = { get: (h) => h === "content-type" ? "application/json" : null };
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      return {
        ok: false,
        status: 429,
        headers: jsonHeaders,
        json: async () => ({ extras: { wait_seconds: 2 } }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ members: [{ id: 5, username: "bob" }] }) };
  };
  const sleepCalls = [];
  const noopSleep = async (ms) => { sleepCalls.push(ms); };
  try {
    const members = await getGroupMembers({
      baseUrl: "https://forum.example.com", apiKey: "k", apiUsername: "u",
      groupName: "staff", groupId: 9, _sleep: noopSleep,
    });
    assert.equal(calls, 2);
    assert.equal(members.length, 1);
    assert.equal(members[0].username, "bob");
    assert.equal(sleepCalls[0], 2250, "wait 2s + 250ms buffer");
  } finally {
    globalThis.fetch = saved;
  }
});

test("addGroupMembers retries on 429 and eventually succeeds", async () => {
  const saved = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      return {
        ok: false,
        status: 429,
        headers: { get: (h) => h === "content-type" ? "application/json" : null },
        json: async () => ({ extras: { wait_seconds: 1 } }),
      };
    }
    return { ok: true, status: 200 };
  };
  const noopSleep = async () => {};
  try {
    await addGroupMembers({
      baseUrl: "https://forum.example.com", apiKey: "k", apiUsername: "u",
      groupName: "staff", groupId: 9, usernames: ["alice"], _sleep: noopSleep,
    });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = saved;
  }
});

test("removeGroupMembers retries on 429 and eventually succeeds", async () => {
  const saved = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      return {
        ok: false,
        status: 429,
        headers: { get: (h) => h === "content-type" ? "application/json" : null },
        json: async () => ({ extras: { wait_seconds: 1 } }),
      };
    }
    return { ok: true, status: 200 };
  };
  const noopSleep = async () => {};
  try {
    await removeGroupMembers({
      baseUrl: "https://forum.example.com", apiKey: "k", apiUsername: "u",
      groupName: "staff", groupId: 9, usernames: ["carol"], _sleep: noopSleep,
    });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = saved;
  }
});

test("addGroupMembers does not retry on non-429 errors (e.g. 403)", async () => {
  const saved = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: false, status: 403, text: async () => "Forbidden" };
  };
  try {
    await assert.rejects(
      () => addGroupMembers({
        baseUrl: "https://forum.example.com", apiKey: "k", apiUsername: "u",
        groupName: "staff", groupId: 9, usernames: ["alice"],
      }),
      /addGroupMembers\(staff\) failed: HTTP 403/
    );
    assert.equal(calls, 1, "no retry on 403");
  } finally {
    globalThis.fetch = saved;
  }
});

// ── Actionable 429 logging ────────────────────────────────────────────────────

test("resolveGroupIds logs URL + attempt + wait on each 429 retry", async () => {
  const saved = globalThis.fetch;
  let calls = 0;
  const jsonHeaders = { get: (h) => h === "content-type" ? "application/json" : null };
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      return {
        ok: false,
        status: 429,
        headers: jsonHeaders,
        json: async () => ({ extras: { wait_seconds: 3 } }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: jsonHeaders,
      json: async () => ({ groups: [], load_more_groups: null }),
    };
  };
  const warnMessages = [];
  const noopSleep = async () => {};
  try {
    await resolveGroupIds({
      baseUrl: "https://forum.example.com", apiKey: "k", apiUsername: "u",
      _sleep: noopSleep, _warn: (msg) => warnMessages.push(msg), _pageDelayMs: 0,
    });
    assert.equal(warnMessages.length, 1, "one warn per 429 retry");
    assert.ok(/forum\.example\.com/.test(warnMessages[0]), `URL missing from warn: ${warnMessages[0]}`);
    assert.ok(warnMessages[0].includes("attempt 1"),       `attempt missing from warn: ${warnMessages[0]}`);
    assert.ok(warnMessages[0].includes("3250ms"),          `wait duration missing from warn: ${warnMessages[0]}`);
  } finally {
    globalThis.fetch = saved;
  }
});

test("resolveGroupIds exhausted error message includes URL, wait_seconds, totalWaitMs and maxTotalWaitMs", async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 429,
    headers: { get: (h) => h === "content-type" ? "application/json" : null },
    json: async () => ({ extras: { wait_seconds: 1 } }),
  });
  const noopSleep = async () => {};
  try {
    await assert.rejects(
      () => resolveGroupIds({
        baseUrl: "https://forum.example.com", apiKey: "k", apiUsername: "u",
        _sleep: noopSleep, _warn: () => {},
      }),
      (err) => {
        assert.ok(/Discourse API rate-limited: HTTP 429/.test(err.message), `wrong prefix: ${err.message}`);
        assert.ok(/forum\.example\.com/.test(err.message),    `URL missing: ${err.message}`);
        assert.ok(/wait_seconds=1/.test(err.message),         `wait_seconds missing: ${err.message}`);
        assert.ok(/totalWaitMs=/.test(err.message),           `totalWaitMs missing: ${err.message}`);
        assert.ok(/maxTotalWaitMs=/.test(err.message),        `maxTotalWaitMs missing: ${err.message}`);
        return true;
      }
    );
  } finally {
    globalThis.fetch = saved;
  }
});

// ── Burst avoidance: inter-page delay in resolveGroupIds ──────────────────────

test("resolveGroupIds inserts inter-page delay between paginated requests", async () => {
  const saved = globalThis.fetch;
  let calls = 0;
  const jsonHeaders = { get: (h) => h === "content-type" ? "application/json" : null };
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      return {
        ok: true,
        status: 200,
        headers: jsonHeaders,
        json: async () => ({ groups: [{ id: 1, name: "alpha" }], load_more_groups: "/groups.json?page=1" }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: jsonHeaders,
      json: async () => ({ groups: [{ id: 2, name: "beta" }], load_more_groups: null }),
    };
  };
  const sleepCalls = [];
  const noopSleep = async (ms) => { sleepCalls.push(ms); };
  try {
    const map = await resolveGroupIds({
      baseUrl: "https://forum.example.com", apiKey: "k", apiUsername: "u",
      _sleep: noopSleep, _pageDelayMs: 300,
    });
    assert.equal(map.size, 2);
    // One inter-page sleep: none before page 0, one before page 1
    assert.equal(sleepCalls.length, 1, "exactly one inter-page sleep");
    assert.equal(sleepCalls[0], 300, "inter-page delay uses _pageDelayMs");
  } finally {
    globalThis.fetch = saved;
  }
});

test("resolveGroupIds does not insert inter-page delay for a single-page response", async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: (h) => h === "content-type" ? "application/json" : null },
    json: async () => ({ groups: [{ id: 5, name: "gamma" }], load_more_groups: null }),
  });
  const sleepCalls = [];
  const noopSleep = async (ms) => { sleepCalls.push(ms); };
  try {
    await resolveGroupIds({
      baseUrl: "https://forum.example.com", apiKey: "k", apiUsername: "u",
      _sleep: noopSleep, _pageDelayMs: 300,
    });
    assert.equal(sleepCalls.length, 0, "no inter-page sleep for single page");
  } finally {
    globalThis.fetch = saved;
  }
});

// ── Redirect handling ─────────────────────────────────────────────────────────

test("resolveGroupIds throws with Location header on 302 redirect", async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 302,
    headers: { get: (h) => h === "location" ? "https://forum.example.com/login" : null },
  });
  try {
    await assert.rejects(
      () => resolveGroupIds({ baseUrl: "https://forum.example.com", apiKey: "k", apiUsername: "u" }),
      (err) => {
        assert.ok(/Discourse API redirect: HTTP 302/.test(err.message), `wrong prefix: ${err.message}`);
        assert.ok(err.message.includes("forum.example.com/login"), `Location missing: ${err.message}`);
        return true;
      }
    );
  } finally {
    globalThis.fetch = saved;
  }
});

test("discourseApiRequest throws with Location header on 301 redirect", async () => {
  // Test via getGroupMembers which proxies to discourseApiRequest
  const saved = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 301,
    headers: { get: (h) => h === "location" ? "https://www.example.com/groups/staff/members.json" : null },
  });
  try {
    await assert.rejects(
      () => getGroupMembers({
        baseUrl: "https://forum.example.com", apiKey: "k", apiUsername: "u",
        groupName: "staff", groupId: 9,
      }),
      (err) => {
        assert.ok(/Discourse API redirect: HTTP 301/.test(err.message), `wrong prefix: ${err.message}`);
        assert.ok(/www\.example\.com/.test(err.message), `Location missing: ${err.message}`);
        return true;
      }
    );
  } finally {
    globalThis.fetch = saved;
  }
});

test("discourseApiRequest throws with '(no Location header)' when Location is absent on redirect", async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 307,
    headers: { get: () => null },
  });
  try {
    await assert.rejects(
      () => getGroupMembers({
        baseUrl: "https://forum.example.com", apiKey: "k", apiUsername: "u",
        groupName: "staff", groupId: 9,
      }),
      (err) => {
        assert.ok(/Discourse API redirect: HTTP 307/.test(err.message), `wrong prefix: ${err.message}`);
        assert.ok(err.message.includes("(no Location header)"), `fallback text missing: ${err.message}`);
        return true;
      }
    );
  } finally {
    globalThis.fetch = saved;
  }
});

// ── resolveGroupIds — non-JSON pagination URL fallback ───────────────────────

test("resolveGroupIds does NOT throw when load_more_groups is a non-JSON path like /groups?page=1; proceeds to /groups.json?page=1", async () => {
  const saved = globalThis.fetch;
  const baseUrl = "https://forum.example.com";
  const requestedUrls = [];
  let calls = 0;
  const jsonHeaders = { get: (h) => h === "content-type" ? "application/json" : null };
  globalThis.fetch = async (url) => {
    requestedUrls.push(url);
    calls++;
    if (calls === 1) {
      return {
        ok: true,
        status: 200,
        url: `${baseUrl}/groups.json`,
        headers: jsonHeaders,
        json: async () => ({
          groups: [{ id: 41, name: "backbencher" }, { id: 49, name: "conservative" }],
          load_more_groups: "/groups?page=1",
        }),
      };
    }
    // Second call (via /groups.json?page=1) — empty groups signals end of pagination
    return {
      ok: true,
      status: 200,
      url: `${baseUrl}/groups.json?page=1`,
      headers: jsonHeaders,
      json: async () => ({ groups: [], load_more_groups: null }),
    };
  };
  try {
    const map = await resolveGroupIds({ baseUrl, apiKey: "k", apiUsername: "u", _pageDelayMs: 0 });
    assert.equal(calls, 2, "should make exactly two requests");
    assert.ok(requestedUrls[1].includes("/groups.json?page=1"), `second request must use JSON endpoint, got: ${requestedUrls[1]}`);
    assert.ok(!requestedUrls.some((u) => u.includes("/groups?page=")), "must never request an HTML groups URL");
    assert.equal(map.get("backbencher"), 41);
    assert.equal(map.get("conservative"), 49);
  } finally {
    globalThis.fetch = saved;
  }
});

test("resolveGroupIds stops paginating when groups array is empty", async () => {
  const saved = globalThis.fetch;
  const baseUrl = "https://forum.example.com";
  let calls = 0;
  const jsonHeaders = { get: (h) => h === "content-type" ? "application/json" : null };
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      return {
        ok: true,
        status: 200,
        url: `${baseUrl}/groups.json`,
        headers: jsonHeaders,
        json: async () => ({ groups: [{ id: 1, name: "admins" }], load_more_groups: "/groups?page=1" }),
      };
    }
    return {
      ok: true,
      status: 200,
      url: `${baseUrl}/groups.json?page=1`,
      headers: jsonHeaders,
      json: async () => ({ groups: [], load_more_groups: null }),
    };
  };
  try {
    const map = await resolveGroupIds({ baseUrl, apiKey: "k", apiUsername: "u", _pageDelayMs: 0 });
    assert.equal(calls, 2, "should stop after receiving empty groups");
    assert.equal(map.size, 1);
  } finally {
    globalThis.fetch = saved;
  }
});

test("resolveGroupIds allows load_more_groups with .json in path", async () => {
  const saved = globalThis.fetch;
  let calls = 0;
  const jsonHeaders = { get: (h) => h === "content-type" ? "application/json" : null };
  const baseUrl = "https://forum.example.com";
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      return {
        ok: true,
        status: 200,
        url: `${baseUrl}/groups.json`,
        headers: jsonHeaders,
        json: async () => ({
          groups: [{ id: 1, name: "admins" }],
          load_more_groups: "/groups.json?page=1",
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      url: `${baseUrl}/groups.json?page=1`,
      headers: jsonHeaders,
      json: async () => ({
        groups: [{ id: 2, name: "moderators" }],
        load_more_groups: null,
      }),
    };
  };
  try {
    const map = await resolveGroupIds({ baseUrl, apiKey: "k", apiUsername: "u", _pageDelayMs: 0 });
    assert.equal(calls, 2);
    assert.equal(map.get("admins"), 1);
    assert.equal(map.get("moderators"), 2);
  } finally {
    globalThis.fetch = saved;
  }
});
