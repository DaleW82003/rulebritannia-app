# Identity & Authority Hardening Summary

> Tracks the immutable-identity pass described in the Alpha Readiness Audit.  
> Every change below replaces a mutable descriptive field check with an immutable identifier check.

---

## Changes Made

### 1. Amendment decision authority — `server/index.js`
**Route:** `POST /api/bills/:id/amendments/:aid/decide`

| Before | After |
|--------|-------|
| Queried `SELECT name FROM characters WHERE id = $1`, then compared `cRows[0].name !== bill.author` (mutable string) | Queries `author_character_id` from the `bills` table column; compares `charId === billAuthorCharId` (immutable UUID) |

**Why fragile:** A character whose display name was changed would lose the ability to decide on their own amendments, or an attacker who happened to share a name with the bill author could gain access.

---

### 2. Amendment auto-accept on submission — `server/index.js`
**Route:** `POST /api/bills/:id/amendments`

| Before | After |
|--------|-------|
| `const isAuthor = String(char.name) === String(bill.author)` | `const isAuthor = !!(billAuthorCharId && String(charId) === String(billAuthorCharId))` |

Same fragility as (1): name comparison determines whether a newly submitted amendment is auto-accepted.

---

### 3. Bill withdrawal authority — `server/index.js`
**Route:** `POST /api/bills/:id/withdraw`

| Before | After |
|--------|-------|
| `String(char.name) === String(bill.author)` | `billAuthorCharId && String(charId) === String(billAuthorCharId)` |

Also removed the unnecessary `SELECT name` column from the characters query (only `office` and `role` are needed now).

---

### 4. Press conference transcript authority — `server/index.js`
**Route:** `PATCH /api/press/:id/transcript`

| Before | After |
|--------|-------|
| `SELECT name FROM characters WHERE id = $1 AND user_id = $2`, then `item.author !== charRows[0].name` | Queries `author_character_id` from `press_items`; compares `req.session.characterId === pressAuthorCharId` |

---

### 5. Bill API responses expose `author_character_id` — `server/index.js`
**Routes:** `GET /api/bills` and `GET /api/bills/:id`

| Before | After |
|--------|-------|
| Response included only `author_display_name` | Response now also includes `author_character_id` (the immutable UUID) |

This allows the client to perform ID-based author checks without a round-trip.

---

### 6. Cabinet access check — `js/pages/cabinet.js`
**Function:** `canAccessCabinet(data)`

| Before | After |
|--------|-------|
| Collected all `office.holderName` strings into a Set; checked whether `char.name` was in that set | Collects `office.holderCharId` UUIDs into a Set; checks whether `char.id` is in that set |

A safe name-based fallback is retained for legacy data states where `holderCharId` is not yet populated.

---

### 7. Shadow cabinet access check — `js/pages/shadowcabinet.js`
**Function:** `canAccessShadowCabinet(data)`

| Before | After |
|--------|-------|
| Same pattern as cabinet (holderName Set comparison) | Uses `holderCharId` Set comparison; name fallback retained |

---

### 8. Government page PM / resign / fire checks — `js/pages/government.js`
**Functions:** `canEditOffice`, `render` (inline `isPM`, `isPmSelfInNonPmOffice`, `canResignOffice`, `heldOffices` computation)

| Before | After |
|--------|-------|
| `pm.holderName === getCurrentName(data)` | `pm.holderCharId === getCurrentCharId(data)` (with name fallback) |
| `office.holderName === currentName` (for resign/fire) | `office.holderCharId === currentCharId` (with name fallback) |
| `o.holderName === data.currentCharacter.name` (office list filter) | `o.holderCharId === currentCharId` (with name fallback) |

Added `getCurrentCharId(data)` helper alongside the existing `getCurrentName(data)`.

---

### 9. Amendment authorship — `js/pages/bill.js`
**Functions:** `canAuthorManageAmendments`, `renderAmendments`

| Before | After |
|--------|-------|
| `String(c.name) === String(bill.author)` | `String(c.id) === String(bill.author_character_id)` (with name fallback) |

---

## Remaining Edge Cases

1. **Legacy bills without `author_character_id`:** Bills submitted before the `author_character_id` column was added to the schema will have `NULL` in that column. All hardened checks fall back to the name comparison in this case, preserving backwards-compatible behaviour. Over time, as bills are re-submitted or the column is back-filled, the fallback path will shrink to zero.

2. **Press items without `author_character_id`:** Same situation as bills. If `author_character_id` is NULL (NPC press items, or legacy items), the transcript endpoint returns a 403 for all non-staff callers. This is the correct conservative default — staff can still post questions via the NPC path. If backward compatibility for player-authored legacy items is required, a one-time migration setting `author_character_id` from `press_items.data->>'author'` (name lookup via the characters table) should be run.

3. **`government.js` `activeCharacters` roster:** Some downstream uses of the `activeCharacters` array still join by name (e.g., `avatarFromCharacterProfile`). These are display-only lookups with no security consequence. They can be migrated to ID-based lookups in a future pass.

4. **`canRightOfReply` (permission-engine.js):** Already uses role flags (`office:prime_minister`, etc.), not name strings. No change needed.

5. **Party instruction and rebel-request decide endpoints (server):** Already use `leader_character_id` and `chief_whip_character_id` from the parties table. No change needed.

6. **Party treasury / leadership endpoints (server):** Already use `leader_character_id` / `chairman_character_id`. No change needed.

---

## Tests Added

**`server/identity-hardening.test.js`** — 21 unit tests covering:

- `canAuthorManageAmendments`: id match, id mismatch (even when name matches), renamed character still matches by id, graceful fallback when IDs absent
- `isAmendmentDecisionAuthorised`: author allowed, non-author denied, staff override, null billAuthorCharId handling
- `isBillWithdrawalAuthorised`: author match, non-author denied, PM by office allowed, staff override
- `canAccessCabinetById`: holder allowed, non-holder denied, name-collision imposter denied
- `canAccessShadowCabinetById`: holder allowed, non-holder denied, empty charId denied

Run with:

```bash
node --test server/identity-hardening.test.js
```
