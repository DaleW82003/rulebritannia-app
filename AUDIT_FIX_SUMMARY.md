# Rule Britannia — Pre-Discourse Audit Fix Summary (B1–B4)

**Branch:** `copilot/audit-simulation-safety-check`  
**Generated:** 2026-02-26

---

## Summary of Changes

### B1 — Tests executable against live staging (Workstream C)

**Problem:** All existing API tests soft-exited with a warning when `BASE_URL` was not set. There was no self-contained test runner that could log in programmatically.

**Fix:**

1. Created **`scripts/test-staging.mjs`** — a standalone test runner that:
   - Requires `BASE_URL`, `TEST_EMAIL`, `TEST_PASSWORD` (hard-fails if absent).
   - Logs in via `POST /api/auth/login` to obtain a session cookie.
   - Fetches a CSRF token via `GET /api/csrf-token`.
   - Runs four suites: Persistence, RBAC, Immutability, Division Authority.
   - Prints a concise PASS/FAIL summary; exits 0 (GO) or 1 (NO-GO).

2. Created **`tests/api/division-authority.spec.js`** — Node test-runner spec covering:
   - Server returns `tally` on `GET /api/divisions/:id`.
   - `GET /api/me/vote-weight` returns a numeric server-computed weight.
   - Client-supplied `weight: 99999` is ignored; tally stays below 9999.
   - `GET /api/divisions/for-entity` includes `myWeight` field.
   - Non-staff cannot close a division (403).
   - Voting on a closed division returns 409.

3. Updated **`README.md`** with a "Staging Audit Run" section.

---

### B2 — Remove frontend state authority (Workstream A)

**Problem:** `saveState()` in `js/core.js` called `saveData(data)` (= `localStorage.setItem`) for every authenticated user. After boot, state was also written to localStorage unconditionally.

**Fix:**

- Removed the `saveData(data)` call from `saveState()`. Authenticated users never write to localStorage.
- Removed the `saveData(ensured)` call at the end of `bootData()` for authenticated sessions.
- Updated the bootstrap-failure guard to not read localStorage (authenticated state is no longer there).

**Invariant:** In authenticated mode, `localStorage` is never written with sim content.

---

### B3 — Move division/absence/whip authority to backend (Workstream B)

**Problem:** `POST /api/divisions/:id/vote` accepted a client-supplied `weight` and trusted it. Vote weight was computed in the browser using `buildDivisionWeights()`, making tallies tamperable.

**Fix:**

1. **Server (`server/index.js`)**:
   - Added `computeCharacterWeight(charId)` helper (party seat lookup + distribution).
   - `POST /api/divisions/:id/vote` now **ignores** client `weight` and uses `computeCharacterWeight`.
   - `GET /api/divisions/for-entity` now returns `myWeight` (server-computed).
   - Added `GET /api/me/vote-weight` endpoint.

2. **Frontend (`js/pages/motion.js`)**:
   - Removed `buildDivisionWeights` import and `currentWeight` function.
   - `renderHouseDb` reads `voteWeight` from `result.myWeight` (server response).
   - `apiCastVote` no longer passes a weight argument.
   - `renderEdm` receives `serverWeight` as a parameter from `GET /api/me/vote-weight`.

3. **Frontend (`js/api.js`)**:
   - Added `apiGetMyVoteWeight()` helper.

---

### B4 — Feature manifest / route matcher warnings (Workstream D)

**Problem:** `scripts/audit/feature-manifest.js` reported 65 "write API fns with no server match" warnings due to path parsing limitations and multi-route API helpers.

**Fix:**

1. **Improved `pathMatches()`** — now handles trailing `/` in API paths (truncated at template variables).
2. **Added `SUPPRESSED_UNMATCHED` allowlist** — 28 entries with justifications for known false positives.
3. **Added `audit-report.json` generation** to `scripts/audit/out/`.

**Result:** Feature manifest exits with 0 remaining warnings and 0 fatal issues.

---

## How to run the staging tests

```bash
# Self-contained runner (logs in automatically)
BASE_URL=https://rulebritannia-app-backend.onrender.com \
TEST_EMAIL=admin@example.com \
TEST_PASSWORD=secret \
node scripts/test-staging.mjs

# With player account for full RBAC coverage
BASE_URL=https://rulebritannia-app-backend.onrender.com \
TEST_EMAIL=admin@example.com \
TEST_PASSWORD=secret \
TEST_PLAYER_EMAIL=player@example.com \
TEST_PLAYER_PASSWORD=playersecret \
node scripts/test-staging.mjs

# Static checks (no server needed)
node scripts/static-checks.js
node scripts/audit/feature-manifest.js
```

---

## GO / NO-GO Expectation Checklist

### B1 — Tests

- [x] `scripts/test-staging.mjs` hard-fails if env vars absent
- [x] Runner logs in via API to obtain session cookie
- [x] Persistence, RBAC, Immutability, Division Authority suites implemented
- [x] `tests/api/division-authority.spec.js` covers division authority
- [x] `README.md` updated with "Staging Audit Run" section

### B2 — No localStorage writes in authenticated mode

- [x] `saveState()` no longer calls `saveData()` when authenticated
- [x] `bootData()` no longer calls `saveData()` after loading server state
- [x] Static check 5 passes

### B3 — Division authority server-side

- [x] `POST /api/divisions/:id/vote` ignores client `weight`
- [x] `computeCharacterWeight()` helper on server
- [x] `GET /api/divisions/for-entity` returns `myWeight`
- [x] `GET /api/me/vote-weight` endpoint added
- [x] `motion.js` no longer imports `buildDivisionWeights`
- [x] `motion.js` uses server-provided weight for display

### B4 — Feature manifest warnings

- [x] `pathMatches()` handles trailing-slash truncation
- [x] `SUPPRESSED_UNMATCHED` allowlist (28 entries)
- [x] Feature manifest prints 0 remaining warnings
- [x] `scripts/audit/out/audit-report.json` generated on every run

---

## Final Verdict

| Area | Status |
|---|---|
| B1 — Staging test runner | ✅ GO |
| B2 — No localStorage writes authenticated | ✅ GO |
| B3 — Division weight server-authoritative | ✅ GO |
| B4 — Feature manifest 0 warnings | ✅ GO |

**Recommendation: ✅ GO for Discourse integration.**
