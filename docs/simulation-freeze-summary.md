# Simulation Freeze Switch — First Version Summary

## Freeze state storage

- Stored in PostgreSQL table `simulation_freeze_state` (single authoritative row: `id='main'`).
- Fields: `is_frozen`, `reason`, `updated_by`, `updated_at`.

## Flows paused or blocked

- **Paused/blocked automatic/system-driven mutation flows:**
  - `POST /api/clock/tick`
  - `POST /api/sim/tick`
- **Blocked selected player mutation flows:**
  - `POST /api/bills/:id/amendments`
  - `POST /api/divisions/:id/vote`
- Blocked routes return `423` with `{ code: "SIMULATION_FROZEN" }` and freeze metadata.

## Routes that remain available while frozen

- Read routes continue to work (e.g. `GET /api/clock`, `GET /api/sim`).
- Staff controls remain available (e.g. `POST /api/sim/set`, `POST /api/clock/set`, freeze toggle routes).

## API / control-panel changes

- Added staff endpoints (admin/mod):
  - `GET /api/sim/freeze` — inspect freeze state
  - `POST /api/sim/freeze` — set `is_frozen` and optional `reason`
- Included freeze data in `GET /api/sim` response (`sim.freeze`).
- Control Panel sim status block now shows freeze status/reason and provides enable/disable controls.

## Logging added

- Audit log entries for freeze state toggles:
  - `sim.freeze.enabled`
  - `sim.freeze.disabled`
- Audit + console logging for blocked mutations:
  - `sim.freeze.blocked` (route, method, roles, reason)

## Tests added

- `server/simulation-freeze.integration.test.js`:
  - authorised staff can enable/disable freeze
  - unauthorised users cannot toggle freeze
  - at least one automatic/system flow respects freeze (`/api/clock/tick`)
  - at least one player mutation route is blocked (`/api/bills/:id/amendments`)
  - read route remains available while frozen (`GET /api/clock`)

## Intentional first-version limitations

- Freeze gating is targeted (not every mutation route is blocked yet).
- No distributed lock orchestration; this is a single authoritative DB switch.
- Existing non-tick background jobs triggered outside the gated routes are not globally intercepted in this version.
