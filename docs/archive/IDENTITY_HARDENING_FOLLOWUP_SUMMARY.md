# Identity & Authority Hardening — Follow-up Summary

> Companion document to `IDENTITY_HARDENING_SUMMARY.md`.  
> Records the second pass: backfill migration, tightened client logic, and visibility tooling.

---

## Tables / Fields Audited

| Table | Field | Status |
|-------|-------|--------|
| `bills` | `author_character_id` | ✅ Backfill added; already queried immutably on server authority paths |
| `bills` | `data->>'author'` (name) | ℹ Name used only for display; all authority checks now use `author_character_id` |
| `press_items` | `author_character_id` | ✅ Backfill added; transcript endpoint already uses ID-based check |
| `press_items` | `data->>'author'` (name) | ℹ Display-only; NPC items correctly excluded from backfill |
| `group_drafts` | `drafts[*].authorId` | ✅ Backfill added (in-place JSONB update); new drafts now store `char.id` |
| `group_drafts` | `drafts[*].authorName` | ℹ Display-only; unchanged |
| `characters` | `name` | ℹ Primary key is UUID `id`; name used only for name-resolution during backfill |
| `office_assignments` | `character_id` | ✅ Already immutable; no change |
| `parties` | `leader_character_id`, `chief_whip_character_id` | ✅ Already immutable; no change |

---

## What Was Backfilled

### Server: `POST /api/admin/repair/backfill-author-ids`

An idempotent admin repair endpoint that:

1. **`bills.author_character_id`** — For each bill with a NULL `author_character_id`, looks up `data->>'author'` in `characters.name`. Sets the column when exactly one active character matches (case-insensitive, trimmed). Bills with NPC flag or ambiguous name matches are left untouched.

2. **`press_items.author_character_id`** — Same approach. NPC press items (`data->>'npcAuthor' IS NOT NULL`) are excluded.

3. **`group_drafts.drafts[*].authorId`** — Iterates the JSONB array for both `'cabinet'` and `'shadowcabinet'` keys. For each draft where `authorId` is not already a UUID, calls `resolveCharacterIdByName()` against all active characters. Updates the JSONB array in-place when an unambiguous match is found.

All resolution uses `resolveCharacterIdByName(characters, targetName)` — a pure, tested helper that returns `null` for zero matches or more than one match.

---

## Where Fallback Was Removed

### Client: `js/pages/cabinet.js`

| Before | After |
|--------|-------|
| `authorId: authorName` (mutable name stored) | `authorId: char?.id \|\| authorName` (immutable UUID preferred, name as fallback for legacy) |
| `d.authorId === String(char?.name \|\| "")` | `isDraftAuthor(d, char)` — prefers UUID match, falls back to name for legacy drafts |
| Inline `userId = String(char?.name \|\| "")` comparisons | `isDraftAuthor(draft, char)` helper |

### Client: `js/pages/shadowcabinet.js`

Identical changes to `cabinet.js` — same `isDraftAuthor` helper, same `authorId` storage fix, same form handler updates.

---

## Where Fallback Still Remains (and Why)

| Location | Fallback | Reason |
|----------|----------|--------|
| `cabinet.js` / `shadowcabinet.js` `isDraftAuthor` | Falls back to name comparison when `draft.authorId` is not a UUID | Existing persisted drafts in `group_drafts` have name-based `authorId`; backfill migrates these, but until that endpoint is run in production, name-based drafts must still resolve correctly |
| `js/pages/bill.js` `canAuthorManageAmendments` | Falls back to `bill.author` name when `bill.author_character_id` is absent | Bills submitted before the `author_character_id` column existed have NULL in that column; backfill migrates these |
| `js/pages/cabinet.js` `canAccessCabinet` | Falls back to `holderName` set when `holderCharId` is absent | `holderCharId` is populated from DB at page load; only absent in stale/offline state |
| `js/pages/shadowcabinet.js` `canAccessShadowCabinet` | Same as above | Same reason |
| `js/pages/government.js` all checks | Fall back to name comparison when `holderCharId` is absent | Same as cabinet above |

All of these fallbacks are narrowly scoped: they only activate when the immutable ID is explicitly absent (NULL / undefined), and they will naturally become dead code as the backfill runs and new records always carry immutable IDs.

---

## Visibility Tooling

### `GET /api/admin/legacy-identity-report`

Read-only admin endpoint. Returns:

```json
{
  "ok": true,
  "bills": {
    "total": 10,
    "missing_author_id": 2
  },
  "press_items": {
    "total": 45,
    "missing_author_id_non_npc": 1
  },
  "group_drafts": {
    "cabinet": { "total_drafts": 4, "legacy_author_id": 2 },
    "shadowcabinet": { "total_drafts": 3, "legacy_author_id": 1 }
  }
}
```

`legacy_author_id` counts draft entries where `authorId` is not a UUID (i.e. still stored as a name). After running the backfill endpoint, this should reach 0.

---

## Any Unresolved Legacy Data Requiring Manual Cleanup

After running `POST /api/admin/repair/backfill-author-ids`:

- **Bills with ambiguous author names** — Two or more active characters share the same `bills.data->>'author'` name. These cannot be auto-resolved. Manual admin action required: update `bills.author_character_id` directly via the admin interface or database tool.

- **Press items with ambiguous author names** — Same as bills.

- **Group draft entries with unresolvable `authorId`** — The name stored in `authorId` matches no active character at all (deleted account, NPC, or renamed). These drafts will fall back to name comparison (never matching any active player) until manually updated. Since these are internal working documents with no critical gameplay consequence, this is acceptable.

---

## Tests Added

**`server/identity-hardening.test.js`** — 14 new tests (104 total):

### `resolveCharacterIdByName` (backfill helper)
- Unambiguous exact match → returns id
- Case-insensitive and whitespace-trimmed match
- No match → null
- Ambiguous (2 characters same name) → null
- Empty target name → null
- Empty character list → null
- UUID-like target (no accidental match) → null

### `isDraftAuthor` (cabinet / shadow cabinet draft helper)
- UUID `authorId` match by id
- UUID `authorId`, different char → no match
- Legacy name-based `authorId` → match by name (fallback)
- Legacy name-based `authorId`, same name different char → still matches (documented legacy limitation)
- UUID `authorId`, char with matching name but wrong id → not matched (ID check is strict)
- New draft after backfill → correct author recognised
- Null inputs → false

Run with:
```bash
node --test server/identity-hardening.test.js
```
