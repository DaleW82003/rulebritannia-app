# Parliamentary Integration Test Summary

## Overview

This document summarises the true HTTP + database integration tests added for the
parliamentary-to-political-state flow.  These tests complement the 111 pure-logic
unit tests in `server/parliamentary-political-state.integration.test.js` and prove
that the **actual route layer, session handling, CSRF wiring, and DB persistence**
all work end-to-end.

---

## Files added / changed

| File | Purpose |
|------|---------|
| `server/parliamentary.integration.test.js` | Integration test suite (11 tests) |
| `server/test-helpers.js` | Test server lifecycle, minimal DB schema, user/bill seeds, HTTP client |
| `server/index.js` | 3 minimal changes: test-mode cookie override, `pending_registrations` guard, and `export { app, ensureSchema }` |
| `server/package.json` | Added `test` and `test:integration` npm scripts |
| `PARLIAMENTARY_INTEGRATION_TEST_SUMMARY.md` | This file |

---

## How to run

```bash
# Prerequisites: PostgreSQL with test DB and user
sudo service postgresql start
sudo -u postgres psql -c "CREATE DATABASE rb_test;"
sudo -u postgres psql -c "CREATE USER rb_test_user WITH PASSWORD 'rb_test_pw';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE rb_test TO rb_test_user;"

# Run integration tests
cd server
DATABASE_URL=postgresql://rb_test_user:rb_test_pw@localhost:5432/rb_test \
SESSION_SECRET=test-secret \
npm run test:integration

# Run all unit tests (no DB required)
npm test
```

---

## Tests added (11)

### 1. Amendment submission — row persisted and retrievable
**Route flow:** `POST /api/bills/:id/amendments` → `GET /api/bills/:id/amendments`

**What is proven:**
- Authenticated user can submit an amendment to a bill in "Second Reading" stage
- The author's amendment is auto-accepted (status = `"accepted"`)
- The amendment row is written to `bill_amendments` with the correct `bill_id`, `title`, and `status`
- The row is retrievable via the read API (`GET /api/bills/:id/amendments`)

---

### 2. Amendment submission — non-author gets `proposed` status
**Route flow:** `POST /api/bills/:id/amendments` (as a different MP)

**What is proven:**
- A non-author MP can also submit amendments
- The submission is recorded with `status = "proposed"` (not auto-accepted)
- `autoAccepted: false` is returned in the response

---

### 3. PERMISSIONS — authorised bill author can accept a proposed amendment
**Route flow:** `POST /api/bills/:id/amendments/:aid/decide` (as bill author)

**What is proven:**
- The bill author can call the decide endpoint to accept a proposed amendment
- Response returns `ok: true` and the updated amendment object with `status: "accepted"`
- The DB row is updated to `status = "accepted"`

---

### 4. PERMISSIONS — non-author rejected with 403 on amendment decide
**Route flow:** `POST /api/bills/:id/amendments/:aid/decide` (as unrelated MP)

**What is proven:**
- A user who is neither the bill author nor a staff member cannot decide on an amendment
- The server rejects with HTTP **403**
- The amendment `status` in the DB remains `"proposed"` (unchanged)

---

### 5. PERMISSIONS — admin can decide an amendment they didn't author
**Route flow:** `POST /api/bills/:id/amendments/:aid/decide` (as admin)

**What is proven:**
- Admin role is treated as authorised for amendment management
- Admin can refuse a proposed amendment → response returns `status: "refused"`

---

### 6. Division close — stable persisted `immutable_result`
**Route flow:** `POST /api/divisions/:id/vote` → `POST /api/divisions/:id/close`

**What is proven:**
- A vote can be cast on an open division
- An admin can close the division
- `immutableResult` is returned in the response with `tally`, `outcome`, and `closedAt`
- `outcome` is one of `"passed"`, `"failed"`, or `"tied"`
- The `immutable_result` JSON is persisted to the `divisions` row and matches the HTTP response exactly
- Attempting to close an already-closed division returns **409**

---

### 7. Rebellion log — row created when MP votes against whip
**Route flow:** `POST /api/divisions/:id/vote` (defiant vote)

**What is proven:**
- When an MP votes against the party instruction (e.g. "no" vs "aye" 3-line whip)
- A row is written to `division_rebellion_log`
- The row records the correct `mp_vote`, `party_position`, and `whip_level`

---

### 8. Rebellion log — no duplicates when vote is changed
**Route flow:** `POST /api/divisions/:id/vote` (twice, different defiant votes)

**What is proven:**
- Changing a defiant vote (e.g. "no" → "abstain") replaces the rebellion log entry
- There is always exactly **one** row per `(division_id, character_id)` pair
- The row reflects the **latest** vote

---

### 9. Rebellion log — row removed when MP votes back to party line
**Route flow:** `POST /api/divisions/:id/vote` (defiant, then compliant)

**What is proven:**
- After a defiant vote creates a rebellion log row
- Changing the vote back to the whip position removes the row from `division_rebellion_log`
- No stale rebellion rows persist

---

### 10. Political state — structured response via GET /api/me/political-state
**Route flow:** `POST /api/divisions/:id/vote` → `GET /api/me/political-state`

**What is proven:**
- `GET /api/me/political-state` returns HTTP 200 with `ok: true`
- The `politicalState` object includes all required fields:
  `capital_current`, `capital_trend`, `momentum`, `reputation`,
  `party_pressure`, `rebellion_risk`, `constituency_pressure`
- All pressure values are in `[0, 100]`
- `momentum` is one of `"rising"`, `"stable"`, `"falling"`
- `reputation` is one of `"excellent"`, `"good"`, `"neutral"`, `"poor"`, `"damaged"`

---

### 11. Political state — rebellion increases `party_pressure` via read API
**Route flow:** baseline read → whipped division → defiant vote → rebellion log written → read API

**What is proven:**
- A defiant vote on a 3-line whipped division writes a rebellion log entry
- After the rebellion log is persisted, `GET /api/me/political-state` reflects a
  **higher `party_pressure`** than the pre-rebellion baseline
- This validates the complete parliamentary-action → political-state pipeline

---

## Pathways covered at integration level

| Layer | Coverage |
|-------|---------|
| Session / login (CSRF exempt) | ✅ — login returns cookie + csrfToken |
| CSRF header on mutations | ✅ — all POST requests send X-CSRF-Token |
| Bill read + write | ✅ — POST /api/bills/:id/amendments, GET /api/bills/:id/amendments |
| Amendment decision (authorised) | ✅ — POST /api/bills/:id/amendments/:aid/decide |
| Amendment decision (rejected) | ✅ — 403 for non-author |
| Division vote | ✅ — POST /api/divisions/:id/vote |
| Division close | ✅ — POST /api/divisions/:id/close, 409 on re-close |
| Rebellion log write | ✅ — vote handler writes `division_rebellion_log` |
| Rebellion log deduplication | ✅ — single row invariant |
| Rebellion log cleanup | ✅ — row removed on party-line reversion |
| Political state recompute | ✅ — GET /api/me/political-state triggers `recomputeCharacterPoliticalState` |
| Pressure after rebellion | ✅ — pressure increase visible via read API |

---

## Server changes (minimal)

Three surgical changes to `server/index.js`:

1. **Test-mode session cookie override** — `NODE_ENV=test` sets
   `{ secure: false, sameSite: "lax", domain: undefined }` so plain-HTTP
   localhost requests can carry session cookies. Production values are unchanged.

2. **`pending_registrations` guard in `ensureSchema()`** — the `UPDATE users`
   backfill query at startup now checks whether `pending_registrations` exists
   before referencing it, fixing a fresh-DB FK-ordering bug that would have
   caused any new production deployment to fail.

3. **`export { app, ensureSchema }`** and `app.listen` guarded by
   `NODE_ENV !== "test"` — allows test files to import the app without
   immediately binding a port.

---

## Remaining gaps / assumptions

| Gap | Notes |
|-----|-------|
| Amendment support → division trigger | The `POST /api/bills/:id/amendments/:aid/support` route (requires ≥2 party leaders to trigger a division) is exercised by pure unit tests but not by this integration suite — seeding the required party-leader characters is non-trivial. |
| `GET /api/bills/:id/amendments` author display names | Exercised; depends on `batchGetCharacterDisplayNames` which uses several character columns — the test schema now includes them all. |
| Division NPC vote injection | NPC vote counting is exercised at unit level; the integration tests use player characters only (NPC injection from `state_snapshots` is silently skipped when no snapshot is seeded). |
| Faction climate → party pressure | `getPartyFactionClimate()` is a no-op when `faction_political_state` table is absent; faction pressure modifier is not tested at integration level. |
| Constituency pressure | `constituency_events` table is present; no events are seeded so this path returns 0 — which is correct for the baseline. |
| Real-world HTTPS cookies | Tests run over plain HTTP; in production cookies require HTTPS. The test-mode override covers this gap for local/CI runs. |
