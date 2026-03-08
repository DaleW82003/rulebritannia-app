# State Ownership Map

> **Alpha readiness reference.** This document defines the authoritative ownership
> boundaries between the snapshot/app_state system and relational database tables.
> It was produced as part of the Alpha Readiness state-ownership hardening pass.
> Runtime enforcement was added in the subsequent pass — see [Runtime Enforcement](#runtime-enforcement) below.

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
| `GET` | `/api/state` | Authenticated users | Returns snapshot blob with relational keys stripped (runtime enforcement) |
| `POST` | `/api/state` | Admin / Mod / Speaker only | Strips relational keys before saving; syncs derived caches only |
| `GET` | `/api/snapshots` | Admin only | Lists all snapshots |
| `POST` | `/api/snapshots` | Admin only | Creates named snapshot; relational keys stripped before saving |
| `POST` | `/api/snapshots/:id/restore` | Admin only | O(1) pointer update; does not touch relational tables |

### Admin maintenance routes

| Method | Path | Auth / Gate | Scope |
|---|---|---|---|
| `POST` | `/api/admin/clear-cache` | Admin + `isDevSeedAllowed()` | Truncates the 5 derived-cache tables only |
| `POST` | `/api/admin/rebuild-cache` | Admin only | Rebuilds 5 derived-cache tables from current snapshot; relational tables untouched |
| `GET` | `/api/admin/export-snapshot` | Admin only | Downloads current snapshot JSON; read-only |
| `POST` | `/api/admin/import-snapshot` | Admin + `isDevSeedAllowed()` | Strips relational keys; saves snapshot; rebuilds 5 derived-cache tables only |

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

The function now uses `assertSnapshotDerivedTable()` (from `server/state-contracts.js`)
before every upsert, throwing an error at runtime if a non-allowlisted table name is
ever passed.

---

## Runtime Enforcement

All ownership rules are enforced in code, not just comments.  The enforcement lives in
`server/state-contracts.js` which is the single source of truth for the boundary.

### `SNAPSHOT_DERIVED_TABLES` allowlist

An explicit `Set` of the five tables that may be written via snapshot flows.
`syncObjectTables()` calls `assertSnapshotDerivedTable(table)` before every upsert —
this throws if a table not in the allowlist is passed, making it impossible to
accidentally add a relational-authoritative table without a deliberate edit.

### `RELATIONAL_AUTHORITATIVE_SNAPSHOT_KEYS` set

Defines the top-level JSON keys (`divisions`, `amendments`, `factions`, `politicalState`,
`finance`) that correspond to relational-authoritative systems.

### `stripRelationalKeys()` applied at every write and read point

| Route | Strip applied |
|---|---|
| `POST /api/state` | ✅ Before snapshot insert; warnings logged + caller notified via response |
| `GET /api/state` | ✅ Before response, removing any forbidden keys from legacy snapshots |
| `POST /api/snapshots` | ✅ Before snapshot insert |
| `POST /api/admin/import-snapshot` | ✅ Before snapshot insert; `strippedKeys` array included in response |

If any forbidden key is present, it is removed silently (with a server-side warning log)
rather than rejecting the request.  This matches the existing architecture: the
caller's game state may still contain stale fields from older exports, and hard
rejection would break legitimate staff workflows.  The important guarantee is that
the stripped data is **never persisted to the snapshot**.

### `assertSnapshotDerivedTable()` applied in `syncObjectTables()`

Each `upsertRows(table, rows)` call now begins with `assertSnapshotDerivedTable(table)`.
This throws a descriptive error with a pointer to `state-contracts.js` if a developer
accidentally passes a table name that is not in `SNAPSHOT_DERIVED_TABLES`.

### Tests

`server/state-contracts.test.js` (run with `node --test server/state-contracts.test.js`)
covers:

- `SNAPSHOT_DERIVED_TABLES` contains all expected derived-cache tables
- `SNAPSHOT_DERIVED_TABLES` does not overlap with any relational-authoritative table
- `assertSnapshotDerivedTable` passes for all allowlisted tables
- `assertSnapshotDerivedTable` throws `FORBIDDEN` for every relational-authoritative table
- `assertSnapshotDerivedTable` throws for arbitrary unknown tables
- `stripRelationalKeys` removes each forbidden key individually
- `stripRelationalKeys` strips all forbidden keys at once
- `stripRelationalKeys` does not mutate the original data object
- `stripRelationalKeys` handles null, undefined, non-object, and array inputs gracefully

---

## Remaining Follow-Up Risks

| Risk | Severity | Notes |
|---|---|---|
| `POST /api/snapshots/:id/restore` does not call `syncObjectTables()` | Low | Restoring an old snapshot changes the snapshot pointer but does not refresh the derived-cache tables (`bills` etc.).  Run `POST /api/admin/rebuild-cache` after a restore if consistency is needed. |
| `GET /api/admin/export-snapshot` exports the full snapshot blob | Low | Admin-only guard is the sole protection.  Consider rate-limiting or IP allowlisting on production for extra defence. |
| `POST /api/state` is open to mod and speaker roles | Medium | Mods and speakers can create new snapshots and overwrite sim config (gameState, bills, etc.).  This is intentional for game management but worth reviewing as the mod team grows. |
| `isDevSeedAllowed()` returns `true` when `NODE_ENV` is unset | Medium | If the hosting environment does not set `NODE_ENV=production`, import/clear endpoints become accessible to admins.  Verify `NODE_ENV=production` is always set on the Render service. |
| Snapshot blob may contain stale division/amendment/faction data from older exports | Mitigated | `stripRelationalKeys()` now removes those keys on every read and write, so legacy snapshot blobs are cleaned at runtime. |
