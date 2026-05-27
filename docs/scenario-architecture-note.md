# Scenario Architecture Note

## Finalized model (this phase)

- Scenario data is rooted at `data/scenarios/<key>/manifest.json`.
- Manifests define initialization inputs (`worldSeed`, `constituenciesFile`, `electionCsvFile`) and scenario clock metadata (`startDate`, `clockDefault`).
- Admin initialization flows are scenario-first:
  - `POST /api/admin/elections/seed-scenario`
  - `POST /api/admin/constituencies/initialize-scenario`
  - `POST /api/admin/seed-scenario-factions`
  - `POST /api/admin/seed-scenario-bodies-locals`
- Reset/wipe flows now describe resets in terms of the configured **default scenario start**, not a fixed year string.

## Compatibility shims intentionally retained

- Legacy 1997 routes remain as aliases for existing admin scripts/integrations:
  - `/api/admin/elections/seed-1997`
  - `/api/admin/constituencies/initialize-1997`
  - `/api/admin/seed-1997-factions`
  - `/api/admin/seed-1997-bodies-locals`
- `scripts/convert-1997-csv.js` remains as a wrapper to `convert-scenario-csv.js 1997`.

## Remaining technical debt blocking full multi-scenario initialization

1. **Election seeding is default-scenario constrained.**  
   `assertSupportedScenarioKey()` in `server/index.js` currently rejects non-default scenario keys for election seeding paths.

2. **Client-side emergency clock fallbacks are runtime-generic, not scenario-resolved.**  
   Browser-only fallback paths use runtime-safe defaults when scenario metadata is unavailable; they do not yet fetch per-scenario fallback metadata directly.

3. **Some endpoint names remain year-coded by design.**  
   Legacy `*-1997*` aliases are still present to avoid breaking external operators/tests and should be removed only after consumers are migrated.
