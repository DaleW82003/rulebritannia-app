# Recompute Observability: Summary

This document records the recompute observability and failure-logging hardening
pass applied to the server-side political-state and related derived-state paths.

---

## What changed

### New utility module: `server/recompute-helpers.js`

Two exports:

| Export | Signature | Purpose |
|--------|-----------|---------|
| `fireRecompute` | `(type, trigger, fn) → void` | Fire-and-forget wrapper — runs `fn()` non-blocking, guarantees a `.catch()` handler so rejections can never silently disappear |
| `awaitedRecompute` | `(type, trigger, fn) → Promise` | Awaited wrapper — like `fireRecompute` but blocks and re-throws, for routes that need the result before responding |

**Structured log format** (all three events use the same `[recompute]` prefix so they are easy to `grep` or forward to a log aggregator):

```
[recompute] start  type=<type> trigger=<trigger>
[recompute] ok     type=<type> trigger=<trigger> dur=<N>ms
[recompute] FAILED type=<type> trigger=<trigger> dur=<N>ms err=<message>
```

---

## Recompute paths covered

### `character-political-state` (via `recomputeCharacterPoliticalState`)

All 11 existing fire-and-forget callers migrated from ad-hoc `.catch()` to
`fireRecompute`:

| Trigger label | Route / context |
|---------------|-----------------|
| `press.mark` | `POST /api/press/:id/mark` — press item marked |
| `work_plan` | Work-plan save / update |
| `office.assign` | `POST /api/offices/assign` |
| `office.unassign` | `POST /api/offices/unassign` |
| `division.vote` | Vote cast in a division (rebellion may be logged) |
| `rebel-request.submit` | Rebel request submitted |
| `rebel-request.decide` | Rebel request refused |
| `scandal.choose` | Character makes a scandal choice |
| `scandal.decision` | Mod decision on a scandal |
| `scandal.close` | Scandal closed |
| `affiliations.decide` | Group affiliation accepted/rejected |

The one **awaited** caller (`GET /api/me/political-state`) migrated to
`awaitedRecompute` with trigger `"me.political-state.get"`.

### `faction-political-state` (via `computeFactionPoliticalState`)

Previously, `computeFactionPoliticalState` was defined but never called
automatically from any route trigger — faction political state was only
recomputed if directly requested. Two fire-and-forget triggers added:

| Trigger label | Route / context |
|---------------|-----------------|
| `faction.allocation.update` | `PATCH /api/admin/factions/:id/allocation` — MP count or influence bonus changed |
| `faction.metadata.update` | `PATCH /api/admin/factions/:id` — only when `leadershipAlignment` or `rebellionBias` fields change (both directly affect faction state formulas) |

### `salary-crediting` (via `runSalaryCrediting`)

Two fire-and-forget callers migrated to `fireRecompute`:

| Trigger label | Route / context |
|---------------|-----------------|
| `clock.tick` | Sim clock advance (`POST /api/admin/clock/tick`) |
| `sim.tick` | Manual sim tick (`POST /api/admin/sim/tick`) |

---

## Logging / wrapper utilities introduced

- **`server/recompute-helpers.js`** — `fireRecompute` and `awaitedRecompute`
- **`server/recompute-helpers.test.js`** — 12 unit tests

---

## Recompute paths intentionally left uninstrumented

| Path | Reason |
|------|--------|
| `recomputeSalaryPositions` (awaited calls) | These are blocking `await`ed calls already — errors surface naturally via the enclosing try/catch. Each already logs via `.catch()` with `[salary positions]` or `[office.*]` tags. No structural change needed. |
| `recomputeUserOfficeRoles` | Blocking, awaited. Errors are already handled with `console.warn("[office.*] recomputeUserOfficeRoles failed ...")`. No silent-swallow risk. |
| `recomputeLeaderOfThirdPartyRole` | Blocking, awaited with `.catch(() => false)` fallback. Result used by callers; no silent-swallow risk. |
| Bulk salary recompute in salary-bands PATCH | Uses a `pool.query().then(...).catch()` chain that is not easily wrapped with `fireRecompute` without restructuring the chain. Risk is low (not political state). |
| `getPartyFactionClimate` | Read-only helper called inside `recomputeCharacterPoliticalState`. Errors propagate to the caller's own handler. |

---

## Remaining operational caveats

- **Log volume at alpha scale**: `fireRecompute` now emits a `start` log for
  every trigger. At high traffic this may increase log volume noticeably. The
  logs are plain `console.log`/`console.error` — no rate limiting or sampling.
  If log volume becomes noisy, consider demoting `start` to `debug` level once
  a structured logger is introduced.

- **No job queue / retry**: Recomputes are still best-effort. A failure is now
  always logged, but the recompute is not retried. This is intentional
  (requirement 4: "Do not build a full queueing system").

- **`faction-political-state` seeding gap**: `seed1997Factions()` inserts
  factions with zero MP counts; `computeFactionPoliticalState` is not called
  after seeding. The first allocation PATCH will trigger a fresh compute. This
  is acceptable for alpha; add a post-seed batch recompute when the production
  seeding flow is finalised.
