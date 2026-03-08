# State Ownership Map

> **Alpha readiness reference.** This document defines the authoritative ownership
> boundaries between the snapshot/app_state system and relational database tables.
> It was produced as part of the Alpha Readiness state-ownership hardening pass.

---

## Overview

The application stores gameplay state in two complementary ways:

| Storage layer | Purpose |
|---|---|
| `state_snapshots` / `app_state_current` | Snapshot-backed: versioned JSONB blobs, used for sim-config and bulk objects like bills/motions |
| Dedicated relational tables | Relational-authoritative: live gameplay systems with their own dedicated API routes |

The golden rule is: **each system has exactly one source of truth**.  Snapshot operations
must not silently compete with or overwrite relational data for systems that have already
been migrated to dedicated tables.

---

## What Remains Snapshot-Backed

The following data is stored in `state_snapshots.data` (JSONB) and served to clients
via `GET /api/state`:

| Field | Description |
|---|---|
| `gameState` | Core simulation clock, pause flag, sim start month/year |
| `orderPaperCommons[]` | Bills on the order paper (also synced to `bills` derived-cache table) |
| `motions.house[]` / `motions.edm[]` | House motions and Early Day Motions (synced to `motions` table) |
| `statements.items[]` | Press statements (synced to `statements` table) |
| `regulations.items[]` | Statutory instruments (synced to `regulations` table) |
| `questionTime.questions[]` | PMQs / departmental QTs (synced to `questiontime_questions` table) |
| `papers`, `news`, `polling`, `economy`, `parliament`, etc. | Supporting sim data |

The `bills`, `motions`, `statements`, `regulations`, and `questiontime_questions`
relational tables are **derived caches** rebuilt from the snapshot by `syncObjectTables()`.
They are **not** the source of truth; the snapshot blob is.

---

## What Is Relational-Authoritative

The following systems are managed exclusively through their dedicated API routes and
relational tables.  They are **never** stored in or rebuilt from the snapshot.

| System | Table(s) | Authoritative routes |
|---|---|---|
| **Divisions** | `divisions`, `division_votes` | `/api/divisions/*`, `/api/bills/:id/vote` |
| **Bill amendments** | `bill_amendments`, `bill_amendment_supporters` | `/api/bills/:id/amendments/*` |
| **Factions** | `party_factions` | `/api/parties/:id/factions/*` |
| **Faction political state** | `faction_political_state` | Faction management routes |
| **Finance** | `character_finance`, `character_additional_revenue`, `finance_config`, `finance_applied` | `/api/admin/finance/*`, `/api/admin/salary-scales/*` |

Any attempt to add these tables to `syncObjectTables()` or to any snapshot
import/rebuild flow must be treated as a **bug** — it would create a competing
source of truth for live gameplay systems.

---

## Routes: Scope and Restrictions

### Snapshot read/write routes

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/state` | Authenticated users | Returns current snapshot blob |
| `POST` | `/api/state` | Admin / Mod / Speaker only | Creates new snapshot; syncs derived caches only |
| `GET` | `/api/snapshots` | Admin only | Lists all snapshots |
| `POST` | `/api/snapshots` | Admin only | Creates named snapshot |
| `POST` | `/api/snapshots/:id/restore` | Admin only | O(1) pointer update; does not touch relational tables |

### Admin maintenance routes

| Method | Path | Auth / Gate | Scope |
|---|---|---|---|
| `POST` | `/api/admin/clear-cache` | Admin + `isDevSeedAllowed()` | Truncates the 5 derived-cache tables only |
| `POST` | `/api/admin/rebuild-cache` | Admin only | Rebuilds 5 derived-cache tables from current snapshot; relational tables untouched |
| `GET` | `/api/admin/export-snapshot` | Admin only | Downloads current snapshot JSON; read-only |
| `POST` | `/api/admin/import-snapshot` | Admin + `isDevSeedAllowed()` | Saves new snapshot; rebuilds 5 derived-cache tables only; relational tables untouched |

`isDevSeedAllowed()` returns `false` when `NODE_ENV=production` and `ENABLE_DEV_SEED`
is not set to `"true"`, so `clear-cache` and `import-snapshot` are disabled in
production unless explicitly enabled.

### `syncObjectTables()` — the enforced boundary

`syncObjectTables(data)` is the sole function that writes from snapshot data to
relational tables.  It writes **only** to:
`bills`, `motions`, `statements`, `regulations`, `questiontime_questions`.

It **explicitly does not** write to:
`divisions`, `bill_amendments`, `party_factions`, `faction_political_state`,
`character_finance`.

The function carries a prominent ownership comment block documenting this contract.

---

## Remaining Follow-Up Risks

| Risk | Severity | Notes |
|---|---|---|
| `POST /api/snapshots/:id/restore` does not call `syncObjectTables()` | Low | Restoring an old snapshot changes the snapshot pointer but does not refresh the derived-cache tables (`bills` etc.).  Run `POST /api/admin/rebuild-cache` after a restore if consistency is needed. |
| `GET /api/admin/export-snapshot` exports the full snapshot blob | Low | Admin-only guard is the sole protection.  Consider rate-limiting or IP allowlisting on production for extra defence. |
| `POST /api/state` is open to mod and speaker roles | Medium | Mods and speakers can create new snapshots and overwrite sim config (gameState, bills, etc.).  This is intentional for game management but worth reviewing as the mod team grows. |
| `isDevSeedAllowed()` returns `true` when `NODE_ENV` is unset | Medium | If the hosting environment does not set `NODE_ENV=production`, import/clear endpoints become accessible to admins.  Verify `NODE_ENV=production` is always set on the Render service. |
| Snapshot blob may contain stale division/amendment/faction data from older exports | Low | Such data is harmlessly ignored because `syncObjectTables()` does not read those fields.  No gameplay impact, but old exports should not be used as a reference for those systems. |
