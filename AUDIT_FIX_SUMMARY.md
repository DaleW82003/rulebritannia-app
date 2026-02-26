# Audit Fix Summary (B1–B4)

## B1 — Executable staging tests
- Added `scripts/test-staging.mjs`.
- Uses `BASE_URL`, `TEST_EMAIL`, `TEST_PASSWORD` (+ optional low-priv creds) to log in and run:
  - persistence create/get check
  - RBAC forbidden write check
  - immutability author edit rejection check
  - division authority (client weight tamper ignored)
- Updated API test suites to hard-fail when required env vars are missing rather than silently skipping for missing `BASE_URL`.

## B2 — Remove frontend authenticated state authority
- Updated `js/core.js` so authenticated simulation reads/writes do not use `localStorage`.
- `saveData()` now throws if called while authenticated.
- `saveState()` now throws for authenticated non-staff calls and only uses API persistence for staff.
- Removed authenticated boot cache write to localStorage.

## B3 — Server-authoritative division data
- Updated server division vote handling to ignore client-supplied weight and set `weight/effective_weight=1` server-side.
- Added DB columns for division vote authority trail:
  - `division_votes.effective_weight`
  - `division_votes.delegation_source_character_id`
  - `divisions.immutable_result`
- Updated division GET/close responses to return server-computed tallies, by-party rollups, delegation map, and immutable result snapshot.

## B4 — Feature manifest matcher + audit output
- Improved path matching in `scripts/audit/feature-manifest.js` for parameterized routes/trailing slashes.
- Added `scripts/audit/generate-audit-report.mjs` to produce `scripts/audit/out/audit-report.json` with warning counts + suppression justifications.

## How to run

### 1) Static audit
```bash
node scripts/static-checks.js
node scripts/audit/feature-manifest.js --json > /tmp/manifest.json
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

### 3) API suites
```bash
BASE_URL="https://rulebritannia-app-backend.onrender.com" \
COOKIE_PLAYER="rb.sid=..." \
COOKIE_MOD="rb.sid=..." \
COOKIE_ADMIN="rb.sid=..." \
node --test tests/api/*.spec.js
```

## GO/NO-GO expectation checklist
- [ ] Authenticated mode never writes sim state to localStorage.
- [ ] Division outcome and tallies come from backend responses only.
- [ ] Staging runner passes all four categories: persistence/RBAC/immutability/division-authority.
- [ ] Feature manifest warnings are either zero or documented suppressions in `audit-report.json`.
