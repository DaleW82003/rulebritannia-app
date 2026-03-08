# Finance & Parliament Integration Tests — Summary

## Tests Added

**File:** `server/finance-parliament.integration.test.js` (21 tests)

| # | Test Name | Category |
|---|-----------|----------|
| 1 | PERSONAL FINANCE: admin set-bank is reflected in GET /api/me/finance | Finance mutation → read consistency |
| 2 | PERSONAL FINANCE: derived values are structurally valid after bank mutation | Finance derived-value validation |
| 3 | PERSONAL FINANCE: second admin mutation overwrites the first | Finance idempotency |
| 4 | PERSONAL FINANCE RBAC: regular user cannot call set-bank (403) | Finance RBAC boundary |
| 5 | PERSONAL FINANCE RBAC: speaker CAN call set-bank (requireAdminModOrSpeaker) | Speaker permission boundary |
| 6 | PERSONAL FINANCE RBAC: unauthenticated set-bank returns 403 (CSRF fires before auth) | Finance unauthenticated guard |
| 7 | ADMIN FINANCE READ: admin can read any character finance via GET /api/admin/characters/:id/finance | Finance admin read consistency |
| 8 | ADMIN FINANCE READ: regular user cannot read admin character finance (403) | Finance read RBAC boundary |
| 9 | PARTY FINANCE: admin adds donation, treasury cash increases, donation is readable | Party finance mutation → read consistency |
| 10 | PARTY FINANCE: two donations are cumulative in treasury.cash | Party finance cumulative correctness |
| 11 | PARTY FINANCE RBAC: regular user cannot add donation (403) | Party finance write RBAC |
| 12 | PARTY FINANCE RBAC: regular user cannot read donations without party role (403) | Party finance read RBAC |
| 13 | PARTY FINANCE RBAC: mod can add donation | Party finance mod access |
| 14 | PARTY FINANCE RBAC: unauthenticated donation POST returns 403 (CSRF fires before auth) | Party finance unauthenticated guard |
| 15 | PARLIAMENT STATUS: speaker can update government type, GET reflects the change | Speaker parliamentary power |
| 16 | PARLIAMENT STATUS: admin can update parliament status | Admin parliamentary power |
| 17 | PARLIAMENT STATUS: mod can update parliament status | Mod parliamentary power |
| 18 | PARLIAMENT STATUS RBAC: regular user cannot update parliament status (403) | Parliamentary RBAC boundary |
| 19 | PARLIAMENT STATUS RBAC: unauthenticated PUT returns 403 (CSRF fires before auth) | Parliamentary unauthenticated guard |
| 20 | PARLIAMENT STATUS RBAC: unauthenticated GET returns 401 | Parliamentary read unauthenticated guard |
| 21 | PARLIAMENT STATUS: invalid governmentType returns 400 | Input validation |

## Infrastructure Changes

**File:** `server/test-helpers.js`

- Added property columns to `characters` table: `home`, `rentals`, `financial_background_level`, `education`, `career_background`, `family` — required by `computePropertyFinance()` called inside `/api/me/finance`
- Added `treasury`, `membership_fee_annual`, `last_members_update_sim_index`, `hq_url`, `updated_at` columns to the `parties` table — required by party treasury/donation endpoints
- Added `character_finance` table (bank balance, salary override, shop upkeep, overspend, positions-override)
- Added `character_additional_revenue` table
- Added `character_shop_purchases` table (minimal, used by finance read endpoints)
- Added `salary_scales` + `salary_scale_roles` tables — required by `resolvedAnnualSalary()`
- Added `character_positions` table — required by `computeCharacterAnnualSalary()`
- Added `finance_config` table (with `updated_by` FK) and seeded 'main' row — required by `getFinanceConfig()`
- Added `party_donations` table
- Added `parliament_status` table and seeded 'main' row
- Updated `dropTestSchema()` to include all new tables in reverse FK order
- Added `seedParty(opts)` factory: inserts a `parties` row with configurable slug, name, and initial cash

## Pathways Covered

| Pathway | Endpoints | RBAC roles tested |
|---------|-----------|-------------------|
| Personal finance mutation | `POST /api/admin/finance/set-bank` | admin ✔, speaker ✔, regular ✖ |
| Personal finance read | `GET /api/me/finance` | owner (authenticated) ✔, unauthenticated ✖ |
| Admin character finance read | `GET /api/admin/characters/:id/finance` | admin ✔, regular ✖ |
| Party finance donation | `POST /api/parties/:id/donations` | admin ✔, mod ✔, regular ✖ |
| Party finance donation read | `GET /api/parties/:id/donations` | admin ✔, regular ✖ |
| Parliament status write | `PUT /api/parliament/status` | speaker ✔, admin ✔, mod ✔, regular ✖ |
| Parliament status read | `GET /api/parliament/status` | authenticated ✔, unauthenticated ✖ |

## Remaining Gaps / Assumptions

- **Party treasury direct update** (`POST /api/parties/:id/treasury`) is not tested here; it requires leader/chairman character linkage or admin override and is covered separately by the chairman/leader role logic.
- **Salary computation pathway** is exercised indirectly through `GET /api/me/finance` (no salary scale rows seeded → `annualSalary = 0` is the expected fallback). A dedicated salary-scale integration test could be added to cover the salary-bands uprate pathway.
- **Finance cost index / inflation** (`PATCH /api/admin/finance/apply-inflation`) is not tested; this is an admin-only batch operation that modifies `finance_config.finance_cost_index`.
- **Character shop purchases** create/sell/dismiss pathways are not covered; these are part of the personal finance write surface and could be added as a follow-up.
- The `parliament_status` table is reset between test runs via `dropTestSchema()`. The speaker-vs-admin-vs-mod parliament tests share the same `main` row, so they run sequentially and each asserts the state they themselves wrote. If tests are parallelised in future, an isolation strategy (per-test row or snapshot rollback) would be needed.
- Tests assume `NODE_ENV=test` to activate the session cookie settings (`sameSite=lax`, `secure=false`) and bypass production-only domain restrictions.
