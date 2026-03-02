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
    const map = await resolveGroupIds({ baseUrl: "https://forum.example.com", apiKey: "k", apiUsername: "u" });
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
