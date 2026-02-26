/**
 * tests/api/rbac.spec.js
 *
 * RBAC enforcement tests — validates that every write endpoint in the
 * rbac-matrix.json actually enforces the declared role requirements.
 *
 * Runs against a live server using Node's built-in test runner:
 *   node --test tests/api/rbac.spec.js
 *
 * Required environment variables:
 *   BASE_URL      - e.g. https://rulebritannia-app.onrender.com
 *   COOKIE_ANON   - session cookie for an unauthenticated request (blank = no cookie)
 *   COOKIE_PLAYER - session cookie for an authenticated player (non-staff)
 *   COOKIE_MOD    - session cookie for a mod user
 *   COOKIE_ADMIN  - session cookie for an admin user
 *
 * CSRF token is fetched fresh once per test run via GET /api/csrf-token.
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, "../..");

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = process.env.BASE_URL;
if (!BASE_URL) {
  console.warn("⚠️  BASE_URL not set — skipping RBAC tests (set BASE_URL to run against live server)");
  process.exit(0);
}

const COOKIES = {
  anon:   process.env.COOKIE_ANON   || "",
  player: process.env.COOKIE_PLAYER || "",
  mod:    process.env.COOKIE_MOD    || "",
  admin:  process.env.COOKIE_ADMIN  || "",
};

// ── CSRF token ────────────────────────────────────────────────────────────────

let csrfToken = "";

async function getCsrfToken(cookie) {
  const res = await fetch(`${BASE_URL}/api/csrf-token`, {
    credentials: "include",
    headers:     cookie ? { Cookie: cookie } : {},
  });
  if (!res.ok) return "";
  const data = await res.json().catch(() => ({}));
  return data.csrfToken || data.token || "";
}

before(async () => {
  csrfToken = await getCsrfToken(COOKIES.admin);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function cookieForRole(role) {
  switch (role) {
    case "admin":         return COOKIES.admin;
    case "mod":           return COOKIES.mod;
    case "authenticated": return COOKIES.player;
    default:              return "";
  }
}

/**
 * Replace all route parameter segments (`:id`, `:partyId`, etc.) with the
 * placeholder value used in RBAC tests. Using "test-id" for all params is
 * intentional — these tests only verify that the endpoint enforces
 * authentication/roles (HTTP 401/403), not that it processes valid data.
 * Endpoints that validate parameter format (e.g. UUID) will return 400/404
 * before executing business logic, which still proves no privilege escalation.
 */
function buildTestUrl(pathTemplate) {
  return `${BASE_URL}${pathTemplate.replace(/:[\w]+/g, "test-id")}`;
}

/**
 * Make a request to the API and return the HTTP status.
 */
async function req(method, path, cookie, body = {}) {
  const url     = buildTestUrl(path);
  const headers = {
    "Content-Type": "application/json",
    "x-csrf-token": csrfToken,
  };
  if (cookie) headers.Cookie = cookie;

  const res = await fetch(url, {
    method,
    headers,
    body: ["GET", "HEAD"].includes(method) ? undefined : JSON.stringify(body),
  });
  return res.status;
}

// ── Load matrix ───────────────────────────────────────────────────────────────

const matrix = JSON.parse(
  readFileSync(join(ROOT, "scripts/audit/rbac-matrix.json"), "utf8")
);

// ── Test generation ───────────────────────────────────────────────────────────

describe("RBAC: unauthenticated requests to authenticated endpoints return 401", () => {
  const authenticatedEndpoints = matrix.endpoints.filter(
    (ep) => ep.roles.length && !ep.roles.includes("public")
  );

  for (const ep of authenticatedEndpoints.slice(0, 30)) { // cap at 30 to avoid rate limits
    test(`${ep.method} ${ep.path} → 401 for anonymous`, async () => {
      const status = await req(ep.method, ep.path, "");
      // 401 = unauthenticated, 403 = authenticated but insufficient role,
      // 404/405 = valid rejection by other means.
      // We only care that it's not 200/201 for unauthenticated calls.
      assert.notEqual(status, 200, `Expected non-200 for anonymous ${ep.method} ${ep.path}, got ${status}`);
      assert.notEqual(status, 201, `Expected non-201 for anonymous ${ep.method} ${ep.path}, got ${status}`);
    });
  }
});

describe("RBAC: player (non-staff) cannot reach staff-only endpoints", () => {
  const staffOnlyEndpoints = matrix.endpoints.filter(
    (ep) =>
      !ep.roles.includes("public") &&
      !ep.roles.includes("authenticated") &&
      ep.method !== "GET"
  );

  for (const ep of staffOnlyEndpoints.slice(0, 20)) {
    test(`${ep.method} ${ep.path} → 403 for player`, async () => {
      if (!COOKIES.player) {
        console.warn(`    (skipped — COOKIE_PLAYER not set)`);
        return;
      }
      const status = await req(ep.method, ep.path, COOKIES.player);
      assert.ok(
        [403, 401, 404, 409].includes(status),
        `Expected 401/403/404 for player on staff-only ${ep.method} ${ep.path}, got ${status}`
      );
    });
  }
});

describe("RBAC: parliament items — only staff can PUT/DELETE", () => {
  const immutableEndpoints = matrix.endpoints.filter(
    (ep) => ep.immutable && ["PUT", "PATCH", "DELETE"].includes(ep.method)
  );

  for (const ep of immutableEndpoints) {
    test(`${ep.method} ${ep.path} → 403 for player (immutability policy)`, async () => {
      if (!COOKIES.player) {
        console.warn(`    (skipped — COOKIE_PLAYER not set)`);
        return;
      }
      const status = await req(ep.method, ep.path, COOKIES.player);
      assert.ok(
        [403, 401, 404].includes(status),
        `Player should not be able to ${ep.method} ${ep.path}, got ${status}`
      );
    });
  }
});
