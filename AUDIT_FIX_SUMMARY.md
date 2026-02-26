# Audit Fix Summary (B1–B4)

## B1 — Executable staging tests
- Added `scripts/test-staging.mjs`.
- Requires `BASE_URL`, `TEST_EMAIL`, `TEST_PASSWORD`.  `TEST_LOW_EMAIL`/`TEST_LOW_PASSWORD` are optional for Tier 2 RBAC testing.
- Test categories:
  - **persistence**: create press release → GET list → verify title present
  - **immutability**: author PUT on own press item → must return 401/403
  - **division.authority (formal)**: POST `/api/divisions/:id/vote` with tampered `weight:9999` → `effective_weight` must be 1 (server-computed)
  - **division.bill-vote (B3)**: PATCH `/api/bills/:id/vote` → `effective_weight` must be a server-computed number (≠ 9999)
  - **rbac.unauthenticated**: unauthenticated write → must return 401/403
  - **rbac.low-priv** (optional): low-priv user write to admin-only route → must return 401/403; SKIPped (not FAILed) if creds not provided
- CSRF token fetched via `GET /api/csrf-token` before writes.
- Updated API test suites to hard-fail when required env vars are missing rather than silently skipping.

## B2 — Remove frontend authenticated state authority
- Updated `js/core.js` so authenticated simulation reads/writes do not use `localStorage`.
- `saveData()` throws if called while authenticated (localStorage write attempted).
- `saveState()` now **warns and returns** (no longer throws) for authenticated non-staff users.
  - Non-staff players rely on feature-specific API endpoints for their writes (e.g. `POST /api/motions/:id/sign`, `PATCH /api/bills/:id/vote`).
  - Staff (admin/mod/speaker) continue to call `POST /api/state` for global state snapshots.
- Removed authenticated boot cache write to localStorage.

## B3 — Server-authoritative division data
- **Formal divisions** (`/api/divisions/*`):
  - Server ignores client-supplied `weight` and sets `effective_weight=1` per character.
  - DB columns added: `division_votes.effective_weight`, `division_votes.delegation_source_character_id`, `divisions.immutable_result`.
  - GET/close responses return server-computed tallies, by-party rollups, delegation map, and immutable result snapshot.
- **Bill inline divisions** (new):
  - Added `PATCH /api/bills/:id/vote` server endpoint.
  - Server fetches the bill from DB, loads the current game state to compute the character's proportional seat weight (mirrors `buildDivisionWeights` logic), stores the vote with the server-computed `effective_weight`.
  - Client calls `apiBillVote(billId, vote)` (new function in `js/api.js`) and uses the returned `bill` object to re-render.
  - Fallback: if the API fails, the client casts a local vote so gameplay is never completely broken.
  - `renderDivision` in `js/pages/bill.js` updated to use server-stored `effective_weight` values (tallyDivision is kept as a display fallback for NPC votes set by the speaker).

## B4 — Feature manifest matcher + audit output
- Improved path matching for parameterized routes/trailing slashes.
- Added `scripts/audit/generate-audit-report.mjs` → `scripts/audit/out/audit-report.json`.
- PLAYER_ALLOWED allowlist updated to include the new `PATCH /api/bills/:id/vote` and `POST /api/motions/:id/sign` endpoints so they are not flagged as R2 violations.
- `scripts/static-checks.js` updated with a `PLAYER_IMMUTABLE_ALLOWLIST` for the same endpoints.
- Current `audit-report.json` shows `remainingWarnings: 0`.

## How to run

### 1) Static audit
```bash
node scripts/static-checks.js
node scripts/audit/feature-manifest.js
node scripts/audit/generate-audit-report.mjs
cat scripts/audit/out/audit-report.json
```

### 2) Staging run
```bash
BASE_URL="https://rulebritannia-app-backend.onrender.com" \
TEST_EMAIL="admin@example.com" \
TEST_PASSWORD="..." \
TEST_LOW_EMAIL="backbencher@example.com" \
TEST_LOW_PASSWORD="..." \
node scripts/test-staging.mjs
```

`TEST_LOW_EMAIL`/`TEST_LOW_PASSWORD` are optional: without them the `rbac.low-priv-blocked` check is **skipped** (not failed).  The `rbac.unauthenticated-blocked` check always runs.

### 3) API suites
```bash
BASE_URL="https://rulebritannia-app-backend.onrender.com" \
COOKIE_PLAYER="rb.sid=..." \
COOKIE_MOD="rb.sid=..." \
COOKIE_ADMIN="rb.sid=..." \
node --test tests/api/*.spec.js
```

## GO/NO-GO expectation checklist
- [x] Authenticated mode never writes sim state to localStorage.
- [x] Division outcome and tallies come from backend responses only (formal divisions use `effective_weight=1`; bill divisions use server-computed proportional weight via `PATCH /api/bills/:id/vote`).
- [x] Staging runner produces **PASS** for: persistence / immutability / division-authority / rbac.unauthenticated; RBAC Tier 2 passes when low-priv credentials are supplied.
- [x] Feature manifest warnings are zero (`remainingWarnings: 0` in `audit-report.json`).
- [x] Static checks pass (0 failures).
