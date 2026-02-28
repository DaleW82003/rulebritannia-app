/**
 * tests/api/helpers/session.js
 *
 * Shared test helper for API spec tests.
 *
 * Provides loginAs(role) which POST /api/auth/login with the appropriate
 * env credentials, captures the Set-Cookie header, then fetches /api/csrf-token
 * and returns a session object { cookie, csrfToken }.
 *
 * Role → env var mapping:
 *   "admin" / "mod" → TEST_EMAIL + TEST_PASSWORD
 *   "player"        → TEST_BACKBENCHER_EMAIL + TEST_BACKBENCHER_PASSWORD
 *
 * Sessions are cached per role so each role only logs in once per test run.
 *
 * Helper functions apiGet / apiPost / apiPut / apiDelete / apiPatch accept a
 * session object (or null for anonymous requests) and automatically attach the
 * Cookie and x-csrf-token headers.
 */

const BASE_URL = (process.env.BASE_URL || "").replace(/\/$/, "");

if (!BASE_URL) {
  throw new Error("BASE_URL is required (e.g. https://rulebritannia-app.onrender.com)");
}

const CREDS = {
  admin:  { email: process.env.TEST_EMAIL,            password: process.env.TEST_PASSWORD },
  mod:    { email: process.env.TEST_EMAIL,            password: process.env.TEST_PASSWORD },
  player: { email: process.env.TEST_BACKBENCHER_EMAIL, password: process.env.TEST_BACKBENCHER_PASSWORD },
};

const _cache = {};

/**
 * Log in as the given role and return a session object { cookie, csrfToken }.
 * Returns null if the required env vars are not set.
 * Results are cached so each role only logs in once per process.
 */
export async function loginAs(role) {
  if (_cache[role] !== undefined) return _cache[role];

  const creds = CREDS[role] || CREDS.admin;
  if (!creds.email || !creds.password) {
    _cache[role] = null;
    return null;
  }

  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ email: creds.email, password: creds.password }),
  });

  if (!loginRes.ok) {
    console.warn(`⚠️  loginAs("${role}") failed: HTTP ${loginRes.status}`);
    _cache[role] = null;
    return null;
  }

  const setCookie = loginRes.headers.get("set-cookie") || "";
  const cookie = setCookie.split(";")[0];

  if (!cookie) {
    console.warn(`⚠️  loginAs("${role}") got no Set-Cookie header`);
    _cache[role] = null;
    return null;
  }

  const csrfRes = await fetch(`${BASE_URL}/api/csrf-token`, {
    headers: { Cookie: cookie },
  });
  const csrfData = await csrfRes.json().catch(() => ({}));
  const csrfToken = csrfData.csrfToken || csrfData.token || "";

  const session = { cookie, csrfToken };
  _cache[role] = session;
  return session;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function authHeaders(session, extra = {}) {
  return {
    ...extra,
    ...(session ? { Cookie: session.cookie, "x-csrf-token": session.csrfToken } : {}),
  };
}

export async function apiGet(path, session) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: authHeaders(session),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

export async function apiPost(path, body, session) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method:  "POST",
    headers: authHeaders(session, { "Content-Type": "application/json" }),
    body:    JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

export async function apiPut(path, body, session) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method:  "PUT",
    headers: authHeaders(session, { "Content-Type": "application/json" }),
    body:    JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

export async function apiDelete(path, session) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method:  "DELETE",
    headers: authHeaders(session),
  });
  return { status: res.status };
}

export async function apiPatch(path, body, session) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method:  "PATCH",
    headers: authHeaders(session, { "Content-Type": "application/json" }),
    body:    JSON.stringify(body),
  });
  return { status: res.status };
}

export { BASE_URL };
