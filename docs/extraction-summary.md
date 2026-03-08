# Modular Extraction Summary — Political State, Division, Finance

**Date:** March 2026  
**Scope:** Political-state, division, and finance service extraction  
**Index.js reduction:** ~56,600 chars / ~1,200 lines removed from server/index.js

---

## What was extracted

### `server/political-state-service.js` (new)

| Symbol | Type | Reason for extraction |
|---|---|---|
| `FACTION_PLAYABLE_PARTIES` | constant | Sole definition moved here; re-exported and imported in `index.js` at 8 call sites |
| `clamp100(v)` | pure fn | Used in character state, faction state, and test files; single definition eliminates mirroring |
| `pressureLabel(v)` | pure fn | Used in test mirrors; now importable directly |
| `recomputeCharacterPoliticalState(characterId)` | async fn (DB) | 440-line function called from 12 route handlers; highest regression risk |
| `computeFactionStrength({...})` | pure fn | Reused in `computeFactionPoliticalState` and `getPartyFactionClimate`; testable in isolation |
| `computeFactionCohesion(rebellionBias)` | pure fn | Same as above |
| `computeLeadershipPressure(internalPower, alignment)` | pure fn | Same as above |
| `computeFactionPoliticalState(factionId)` | async fn (DB) | Called from 2 admin route handlers + faction allocation PATCH |
| `getPartyFactionClimate(partySlug)` | async fn (DB) | Called from faction API + character political state |
| `seed1997Factions(actorUserId)` | async fn (DB) | Admin-only seed; extracted with the rest of the faction block |

### `server/division-helpers.js` (new)

| Symbol | Type | Reason for extraction |
|---|---|---|
| `SPEAKER_PARTY_RE` | regex constant | Used in tally, weight, and display functions |
| `SINN_FEIN_PARTY_RE` | regex constant | Same |
| `RH_QUALIFYING_SPEC_IDS` | constant | Parliamentary meta |
| `PC_QUALIFYING_SPEC_IDS` | constant | Parliamentary meta |
| `getPartySeatsFromConstituencies(pool)` | async fn (DB) | Called from 5+ route handlers; canonical seat source |
| `getPartiesRankedBySeats(pool)` | async fn (DB) | Used by `getThirdPartySlug` |
| `getThirdPartySlug(pool)` | async fn (DB) | Used in parliamentary meta + party admin |
| `getCharacterParliamentaryMeta(pool, id)` | async fn (DB) | Used in display name + character admin |
| `formatParliamentaryName({...})` | pure fn | Used in all display name paths |
| `getCharacterDisplayName(pool, id, fallback)` | async fn (DB) | Single-character display name; 6+ call sites |
| `batchGetCharacterDisplayNames(pool, entries)` | async fn (DB) | Multi-character display; 6+ call sites |
| `enrichCharacterRowWithDisplay(row)` | async fn (DB) | Uses module-level `pool` import (backward compat) |
| `batchEnrichCharacterRows(pool, rows)` | async fn (DB) | Used in character admin and party elections |
| `computeAllPlayerWeights(seatsByParty, players)` | pure fn | Core division weight algorithm; 5+ call sites |
| `computeCharacterWeight(seatsByParty, players, name, party, isNpc)` | pure fn | Wraps `computeAllPlayerWeights`; 3 route call sites |
| `computeDivisionTallyFromDb(db, divisionId, ...)` | async fn (explicit db) | Used in GET /divisions/:id, GET /divisions/for-entity, POST /divisions/:id/close |

### `server/finance-service.js` (new)

| Symbol | Type | Reason for extraction |
|---|---|---|
| `resolveActiveSalaryScale(simIndex)` | async fn (DB) | Called from 4 locations: runSalaryCrediting, 2 finance admin routes, salary-bands API |
| `computeCharacterAnnualSalary(characterId, simIndex)` | async fn (DB) | Intermediate helper; called by `resolvedAnnualSalary` |
| `resolvedAnnualSalary(characterId, simIndex)` | async fn (DB) | Override > computed; called from 2 character finance routes |

---

## What stayed in `server/index.js` and why

| Area | Reason |
|---|---|
| `writeAuditLog(...)` | ~100 call sites in route handlers; extracting it would require a second pass that touches every mutating endpoint. Worth extracting post-alpha but not in this surgical pass. |
| `runSalaryCrediting(month, year)` | Depends on `writeAuditLog`-less batch, but also on `resolveActiveSalaryScale` (now extracted). Left in place; a trivial follow-up once `writeAuditLog` is modularised. |
| `runShopUpkeep(month, year)` | Uses `writeAuditLog` and the `HQ_BASELINE_UPKEEP_1997` constant. Same reasoning. |
| `runRevenuePayouts(simMonth, simYear)` | DB-only (no `writeAuditLog`), but operationally interleaved with `runSalaryCrediting` on the clock tick — extract together as a group. |
| `runMembershipIntake(month, year)` | Same as above. |
| `runDebateAutoClose / runDivisionAutoClose` | Clock-tick utilities; not reused outside the clock handler. |
| All route handlers | Route-level concerns are not part of this extraction. No route surface changed. |
| `amendmentWindowOpen(bill, simMonth, simYear)` | Pure fn, but used only in 2 adjacent amendment routes; not reused elsewhere. Extraction would add a file without reducing complexity. |
| `getWhipAuthority / canManageWhip` | Used only in whip-discipline routes; not reused. |
| `applyAmendmentToBillText(...)` | Single call site in each of 2 bill-amendment handlers; not reused. |

---

## Behaviour-preservation notes

- **No route surface changed.** All `app.get(...)` / `app.post(...)` handlers remain in `index.js`. URL paths, HTTP methods, request/response shapes, and status codes are unchanged.
- **No permission changes.** Every `hasAdminOrMod`, `hasAdminModOrSpeaker`, `requireAuth`, `requireAdmin` call is untouched.
- **No persistence changes.** Schema, table names, column names, and SQL queries are identical to the originals — copied verbatim, not rewritten.
- **No formula changes.** All computation weights (`mp_count × 0.8`, `influence_bonus × 10`, WHIP_REBELLION_WEIGHT, etc.) are preserved exactly.
- **`enrichCharacterRowWithDisplay` backward compat.** This function previously closed over the global `pool`. In the new module it imports `pool` from `./db.js` using the same singleton, so behaviour is identical. The public signature is unchanged.
- **`FACTION_PLAYABLE_PARTIES` moved.** The constant now lives in `political-state-service.js` and is re-exported. `index.js` imports it and the 6 faction API guards using it continue to work as before.
- **Reference in `computeFactionPoliticalState` breakdown note** updated from "see `server/index.js`" to "see `server/political-state-service.js`" — only cosmetic.

---

## Service areas that should wait until post-alpha

| Area | Reason to wait |
|---|---|
| `writeAuditLog` | Central to ~100 route handlers; requires a careful pass across all mutating endpoints. Extraction is high value but high surface area. |
| Clock-tick runners | Extraction is blocked on `writeAuditLog`. |
| Route handler splitting | A larger architectural decision; no urgent regression risk while handlers remain testable via integration tests. |
| Budget / economy / polling helpers | Insufficient real-world usage to know which helpers will be reused; premature extraction risks wrong abstraction boundaries. |
