#!/usr/bin/env node
/**
 * Staging smoke runner (GitHub Actions friendly)
 *
 * Fix: CSRF endpoint sometimes returns empty, so we take csrfToken directly
 * from the /api/auth/login JSON response (which your debug step showed works).
 */

const {
  BASE_URL,
  TEST_EMAIL,
  TEST_PASSWORD,
  TEST_LOW_EMAIL,
  TEST_LOW_PASSWORD,
  TEST_BACKBENCHER_EMAIL,
  TEST_BACKBENCHER_PASSWORD,
} = process.env;

if (!BASE_URL || !TEST_EMAIL || !TEST_PASSWORD) {
  console.error("FAIL: BASE_URL, TEST_EMAIL, TEST_PASSWORD are required");
  process.exit(1);
}

const base = BASE_URL.replace(/\/$/, "");

let pass = 0, fail = 0, skip = 0;
function ok(name) { console.log(`PASS ${name}`); pass++; }
function bad(name, why) { console.log(`FAIL ${name}: ${why}`); fail++; }
function skipped(name, why) { console.log(`SKIP ${name}: ${why}`); skip++; }

/**
 * Login and return { cookie, csrfToken }.
 * - cookie comes from Set-Cookie header
 * - csrfToken comes from the JSON body (preferred)
 */
async function login(email, password) {
  const url = `${base}/api/auth/login`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "rb-ci/1.0",
      "Accept": "application/json,text/plain,*/*",
    },
    body: JSON.stringify({ email, password }),
  });

  const text = await res.text().catch(() => "");
  let json = {};
  try { json = JSON.parse(text || "{}"); } catch {}

  if (!res.ok) {
    console.error(`login() failed for email=${String(email || "").slice(0, 3)}***`);
    console.error(`url=${url}`);
    console.error(`status=${res.status}`);
    console.error(`body=${text.slice(0, 800)}`);
    throw new Error(`login failed ${res.status}`);
  }

  const setCookie = res.headers.get("set-cookie") || "";
  const cookie = setCookie.split(";")[0];
  if (!cookie) throw new Error("no set-cookie on login");

  const csrfToken = json?.csrfToken || json?.token || "";
  if (!csrfToken) {
    console.error("Login response JSON:", text.slice(0, 800));
    throw new Error("no csrfToken in login response");
  }

  return { cookie, csrfToken };
}

/**
 * Make an API request.
 * If session is provided, sends Cookie + X-CSRF-Token (for write ops).
 */
async function req(path, { method = "GET", session, body } = {}) {
  const url = `${base}${path}`;
  const headers = {
    ...(body ? { "Content-Type": "application/json" } : {}),
    ...(session?.cookie ? { Cookie: session.cookie } : {}),
    ...(session?.csrfToken ? { "X-CSRF-Token": session.csrfToken } : {}),
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const raw = await res.text().catch(() => "");
  let json = null;
  try { json = JSON.parse(raw); } catch {}

  // Print debug info when something important fails
  if (res.status === 401 || res.status === 403 || res.status >= 500) {
    const msg = (json && (json.error || json.message)) ? (json.error || json.message) : raw;
    console.log(`DEBUG ${method} ${path} -> ${res.status} ${String(msg || "").slice(0, 200)}`);
  }

  return { res, json, raw };
}

(async () => {
  try {
    // Admin session
    const admin = await login(TEST_EMAIL, TEST_PASSWORD);
    console.log("csrf length:", (admin.csrfToken || "").length);

    // ── Persistence ────────────────────────────────────────────────────────
    const pressId = `press-staging-${Date.now()}`;
    const created = await req("/api/press", {
      method: "POST",
      session: admin,
      body: {
        press_type: "release",
        id: pressId,
        subject: `staging-${Date.now()}`,
        body: "e2e",
      },
    });

    if (![200, 201].includes(created.res.status)) {
      bad("persistence.create", created.res.status);
    } else {
      const id = created.json?.item?.id || created.json?.id || pressId;

      const listed = await req("/api/press", { session: admin });
      const found = JSON.stringify(listed.json || {}).includes(pressId);
      found ? ok("persistence") : bad("persistence", "created entity not found after GET");

      // immutability check: non-admin/mod PUT must be rejected
      if (TEST_BACKBENCHER_EMAIL && TEST_BACKBENCHER_PASSWORD) {
        const bb = await login(TEST_BACKBENCHER_EMAIL, TEST_BACKBENCHER_PASSWORD);

        const patch = await req(`/api/press/${id}`, {
          method: "PUT",
          session: bb,
          body: { subject: `edit-${pressId}` },
        });

        ([401, 403].includes(patch.res.status)
          ? ok("immutability.author-edit-block")
          : bad("immutability.author-edit-block", patch.res.status)
        );
      } else {
        skipped(
          "immutability.author-edit-block",
          "TEST_BACKBENCHER_EMAIL/PASSWORD not set - admin can legitimately update press items"
        );
      }
    }

    // ── Division authority: client-supplied weight is ignored ──────────────
    const divCreate = await req("/api/divisions/create", {
      method: "POST",
      session: admin,
      body: {
        entity_type: "motion",
        entity_id: `m-${Date.now()}`,
        title: "staging division",
      },
    });

    const did = divCreate.json?.division?.id || divCreate.json?.id;
    if (!did) {
      bad("division.create", "no id");
    } else {
      const vote = await req(`/api/divisions/${did}/vote`, {
        method: "POST",
        session: admin,
        body: { vote: "aye", weight: 9999 },
      });

      const ew = vote.json?.vote?.effective_weight;
      (typeof ew === "number" && ew >= 0 && ew !== 9999
        ? ok("division.authority.weight-server")
        : bad("division.authority.weight-server", `effective_weight=${ew}`)
      );
    }

    // ── Bill vote server authority (B3) ────────────────────────────────────
    const billId = `bill-staging-${Date.now()}`;
    const billCreate = await req("/api/bills", {
      method: "POST",
      session: admin,
      body: {
        id: billId,
        title: "Staging Test Bill",
        status: "in-progress",
        stage: "Final Division",
        author: "StagingTest",
        billText: "Test.",
        amendments: [],
      },
    });

    if (![200, 201].includes(billCreate.res.status)) {
      bad("division.bill-vote", "could not create test bill: " + billCreate.res.status);
    } else {
      const billVote = await req(`/api/bills/${billId}/vote`, {
        method: "PATCH",
        session: admin,
        body: { vote: "aye" },
      });

      if (![200, 201].includes(billVote.res.status)) {
        bad("division.bill-vote", `PATCH /api/bills/:id/vote returned ${billVote.res.status}`);
      } else {
        const ew = billVote.json?.vote?.effective_weight;
        (typeof ew === "number" && ew !== 9999
          ? ok("division.bill-vote.server-weight")
          : bad("division.bill-vote.server-weight", `effective_weight=${ew}`)
        );
      }

      // cleanup
      await req(`/api/bills/${billId}`, { method: "DELETE", session: admin });
    }

    // ── RBAC ───────────────────────────────────────────────────────────────
    // Unauthenticated write must be blocked
    const anonWrite = await req("/api/divisions/create", {
      method: "POST",
      body: { entity_type: "motion", entity_id: "anon-test" },
    });

    ([401, 403].includes(anonWrite.res.status)
      ? ok("rbac.unauthenticated-blocked")
      : bad("rbac.unauthenticated-blocked", anonWrite.res.status)
    );

    // Low-priv user must be forbidden from admin-only writes (if configured)
    if (TEST_LOW_EMAIL && TEST_LOW_PASSWORD) {
      const low = await login(TEST_LOW_EMAIL, TEST_LOW_PASSWORD);

      const forbidden = await req("/api/divisions/create", {
        method: "POST",
        session: low,
        body: { entity_type: "motion", entity_id: "x" },
      });

      ([401, 403].includes(forbidden.res.status)
        ? ok("rbac.low-priv-blocked")
        : bad("rbac.low-priv-blocked", forbidden.res.status)
      );
    } else {
      skipped("rbac.low-priv-blocked", "TEST_LOW_EMAIL/TEST_LOW_PASSWORD not set");
    }
  } catch (e) {
    bad("runner", e?.message || String(e));
  }

  console.log(`\nSummary: pass=${pass} fail=${fail} skip=${skip}`);
  process.exit(fail ? 1 : 0);
})();
