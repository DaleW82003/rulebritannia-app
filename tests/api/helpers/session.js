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

/** Statuses that indicate a transient upstream/edge error worth retrying. */
const TRANSIENT_STATUSES = new Set([502, 503, 504, 520, 521, 522, 523, 524]);

/**
 * Pause for `ms` milliseconds.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with automatic retry/backoff for transient server errors.
 * Retries up to `maxRetries` times with exponential backoff (1s, 2s, 4s …).
 * Only retries for statuses in TRANSIENT_STATUSES — definitive errors are
 * returned immediately.
 */
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  let attempt = 0;
  while (true) {
    const res = await fetch(url, options);
    if (!TRANSIENT_STATUSES.has(res.status) || attempt >= maxRetries) {
      return res;
    }
    const delayMs = 1000 * Math.pow(2, attempt);
    console.warn(`⚠️  fetchWithRetry: transient ${res.status} for ${url} — retry ${attempt + 1}/${maxRetries} in ${delayMs}ms`);
    await sleep(delayMs);
    attempt++;
  }
}

/**
 * Log in as the given role and return a session object { cookie, csrfToken }.
 * Returns null if the required env vars are not set.
 * Results are cached so each role only logs in once per process.
 *
 * Retries on transient upstream/edge errors (502/503/504/520-524) for both
 * the login POST and the CSRF GET.  Only caches null for missing credentials
 * or definitive auth failures (401/403).
 */
export async function loginAs(role) {
  if (_cache[role] !== undefined) return _cache[role];

  const creds = CREDS[role] || CREDS.admin;
  if (!creds.email || !creds.password) {
    _cache[role] = null;
    return null;
  }

  const loginRes = await fetchWithRetry(`${BASE_URL}/api/auth/login`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ email: creds.email, password: creds.password }),
  });

  if (!loginRes.ok) {
    console.warn(`⚠️  loginAs("${role}") failed: HTTP ${loginRes.status}`);
    // Only permanently cache null for definitive/auth failures, not transient ones.
    // (TRANSIENT_STATUSES are exhausted by fetchWithRetry before reaching here.)
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

  const csrfRes = await fetchWithRetry(`${BASE_URL}/api/csrf-token`, {
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

/**
 * Log a non-2xx response to aid debugging in CI.
 * Reads the raw text once and returns parsed JSON (or empty object).
 */
async function debugResponse(method, path, res) {
  const text = await res.text().catch(() => "");
  if (res.status < 200 || res.status >= 300) {
    const snippet = text.slice(0, 500);
    let extra = "";
    try { extra = " — " + JSON.stringify(JSON.parse(text)).slice(0, 500); } catch {}
    console.warn(`⚠️  ${method} ${path} → ${res.status}: ${snippet}${extra}`);
  }
  try { return JSON.parse(text); } catch { return {}; }
}

export async function apiGet(path, session) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: authHeaders(session),
  });
  return { status: res.status, body: await debugResponse("GET", path, res) };
}

export async function apiPost(path, body, session) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method:  "POST",
    headers: authHeaders(session, { "Content-Type": "application/json" }),
    body:    JSON.stringify(body),
  });
  return { status: res.status, body: await debugResponse("POST", path, res) };
}

export async function apiPut(path, body, session) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method:  "PUT",
    headers: authHeaders(session, { "Content-Type": "application/json" }),
    body:    JSON.stringify(body),
  });
  return { status: res.status, body: await debugResponse("PUT", path, res) };
}

export async function apiDelete(path, session) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method:  "DELETE",
    headers: authHeaders(session),
  });
  if (res.status < 200 || res.status >= 300) {
    const text = await res.text().catch(() => "");
    console.warn(`⚠️  DELETE ${path} → ${res.status}: ${text.slice(0, 500)}`);
  }
  return { status: res.status };
}

export async function apiPatch(path, body, session) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method:  "PATCH",
    headers: authHeaders(session, { "Content-Type": "application/json" }),
    body:    JSON.stringify(body),
  });
  if (res.status < 200 || res.status >= 300) {
    const text = await res.text().catch(() => "");
    console.warn(`⚠️  PATCH ${path} → ${res.status}: ${text.slice(0, 500)}`);
  }
  return { status: res.status };
}

export { BASE_URL };
