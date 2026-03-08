# Faction & Political-State Integration Tests — Summary

## Tests Added

**File:** `server/factions.integration.test.js` (26 tests)

| # | Test Name | Category |
|---|-----------|----------|
| 1 | FACTION CREATION: admin can create a faction for a playable party | Faction creation |
| 2 | FACTION CREATION: slug is normalised to lowercase-hyphen form | Faction creation |
| 3 | FACTION CREATION: returns 409 for duplicate slug within same party | Faction creation |
| 4 | FACTION CREATION: rejects unsupported party slug | Faction creation |
| 5 | ALLOCATION: admin can update faction mp_count within party MP ceiling | Allocation |
| 6 | ALLOCATION: rejects allocation that would exceed party MP ceiling | Allocation |
| 7 | ALLOCATION: two factions combined cannot exceed party MP ceiling | Allocation |
| 8 | ALLOCATION: rejects negative mp_count | Allocation |
| 9 | ALLOCATION: returns 404 for non-existent faction id | Allocation |
| 10 | CLIMATE RECOMPUTE: faction climate reflects allocation change for Labour | Climate |
| 11 | CLIMATE RECOMPUTE: faction climate endpoint rejects non-playable party | Climate |
| 12 | PARTY-FACING LIST: authenticated player can list active factions for playable party | Player read |
| 13 | PARTY-FACING LIST: inactive factions are excluded | Player read |
| 14 | ADMIN LIST: includes leadershipAlignment, rebellionBias, and MP totals | Admin read |
| 15 | CHARACTER POLITICAL STATE: capital_resilience_bonus appears when aligned faction has MPs | Char state |
| 16 | CHARACTER POLITICAL STATE: hostile faction increases party_pressure for Conservative | Char state |
| 17 | CHARACTER POLITICAL STATE: no faction_climate for non-playable party character | Char state |
| 18 | PERMISSIONS: admin can create faction and update allocation | Permissions |
| 19 | PERMISSIONS: mod can create faction and update allocation | Permissions |
| 20 | PERMISSIONS: regular user cannot create faction (must get 403) | Permissions |
| 21 | PERMISSIONS: regular user cannot update faction allocation (must get 403) | Permissions |
| 22 | PERMISSIONS: unauthenticated mutation is rejected (CSRF guard returns 403) | Permissions |
| 23 | PERMISSIONS: unauthenticated request cannot read player-facing faction-climate (must get 401) | Permissions |
| 24 | METADATA UPDATE: admin can update faction name and alignment | Metadata |
| 25 | METADATA UPDATE: returns 404 for non-existent faction id | Metadata |
| 26 | SEED 1997: admin can seed 1997 factions idempotently | Seeding |

## Test Infrastructure Changes

**File:** `server/test-helpers.js`

- Added `patch()` method to `TestClient` (mirrors `post/put/delete`)
- Added `party_factions`, `party_faction_allocations`, and `faction_political_state` tables to `createTestSchema()` and `dropTestSchema()`
- Added `seedConstituencies(partySlug, count)` helper — inserts N constituency rows for a party so allocation validation has a ceiling to check against
- Added `seedFaction(opts)` helper — creates a `party_factions` + `party_faction_allocations` row pair for test setup

## Pathways Covered

| Pathway | Tests |
|---------|-------|
| Admin creates faction for Labour / Conservative / LibDem | 1, 2, 3, 4 |
| Admin PATCHes faction allocation; DB row updated | 5 |
| Allocation validation enforces party MP ceiling | 6, 7 |
| Negative / invalid mp_count rejected | 8 |
| Unknown faction ID returns 404 | 9, 25 |
| Allocation change flows into GET /api/parties/:slug/faction-climate | 10 |
| Non-playable party returns 400 on climate endpoint | 11 |
| Player-facing faction list: active only, no sensitive fields | 12, 13 |
| Admin-facing faction list: includes alignment, rebellion_bias, MP totals | 14 |
| Character in Labour with aligned faction gets capitalResilienceBonus > 0 | 15 |
| Character in Conservative with hostile faction gets partyPressureModifier > 0 | 16 |
| Character in non-playable party gets faction_climate = null | 17 |
| Admin + Mod access works for create and allocation update | 18, 19 |
| Regular user blocked (403) on admin endpoints | 20, 21 |
| Unauthenticated POST blocked by CSRF middleware (403) | 22 |
| Unauthenticated GET blocked by auth middleware (401) | 23 |
| Admin can update faction metadata; persisted in DB | 24 |
| seed-1997-factions is idempotent (insert then skip) | 26 |

## Assumptions

- The auth rate-limit (`20 / 15 min`) is enforced per IP. Tests use 6 logins (4 shared + 2 per-test for Conservative and Plaid Cymru characters), staying comfortably under the limit.
- The CSRF middleware runs before `requireAdminOrMod`, so unauthenticated mutations receive 403 (CSRF error) rather than 401. Tests assert the correct observed behaviour.
- `seedConstituencies` inserts rows directly via `pool.query`. Because multiple tests seed for the same party, totals accumulate across tests. Tests that rely on a specific ceiling read the live `remainingMPs` from the admin API rather than assuming a fixed number.
- `computeFactionPoliticalState` is not triggered automatically on allocation PATCH; the climate endpoint (`getPartyFactionClimate`) computes on the fly from allocation data when no cached `faction_political_state` row exists. Tests validate the end-to-end result at the API boundary regardless.

## Remaining Gaps

| Area | Notes |
|------|-------|
| `computeFactionPoliticalState` caching | Direct unit tests for `computeFactionPoliticalState` (momentum trending, breakdown JSON) are covered by the pure-function layer but not via HTTP. Could add an admin trigger-recompute endpoint test if that endpoint is added. |
| Inactive-faction allocation preservation | Tests verify inactive factions are hidden from the player list but do not validate that their `mp_count` is preserved in the DB and not counted against the ceiling. |
| Multi-party climate interactions | Tests cover Labour and Conservative separately. A single test combining all three playable parties in one climate read is not included. |
| Rate-limit boundary testing | No test exercises the rate-limiter exhaustion path; this would require a separate test run with a clean rate-limiter state. |
| Faction deletion | There is no DELETE endpoint for factions; deactivation via PATCH `active=false` is the intended workflow. No test for the edge case of deactivating a faction that has existing allocation. |
