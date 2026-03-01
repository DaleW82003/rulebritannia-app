# Dynamic Third Party + Parliamentary Naming Notes

## Third Party selection
- The backend now computes a ranked party list from `parties.seat_count` via `getPartiesRankedBySeats()`.
- Ordering is deterministic:
  1. Higher seat count first.
  2. If tied, lexicographically by `slug` ascending.
- The third entry in that ranking is treated as the current "Third Party" (`getThirdPartySlug()`).
- Third-party salary/RH qualification checks now use this computed slug rather than a hard-coded party constant.

## Parliamentary display names
- Added canonical formatting on the server:
  - `formatParliamentaryName({ bareName, isRH, isMP, isPC })`
- Added metadata computation:
  - `getCharacterParliamentaryMeta()` computes `is_mp`, `is_pc`, `is_privy_current`, `is_rh`.
- Character APIs now include:
  - `display_name`, `is_mp`, `is_pc`, `is_privy`, `is_rh`.
- Press, motions, statements, and QT read paths now include server-computed display-name fields.

## Privy Council history handling
- `privy_council_members` now supports soft removal metadata (`removed_at`, `removed_by`, `removal_reason`).
- Removal endpoint now soft-removes active membership (no hard delete), preserving history for persistent `PC` naming.
- Appoint endpoint reactivates a previously removed member record.
