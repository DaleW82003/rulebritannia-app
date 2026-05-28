# Scenario Architecture Note

## Final scenario model

- Scenario data is defined under `data/scenarios/<key>/` and driven by `manifest.json`.
- `server/scenario-manifest-loader.js` is the authority for default scenario key resolution, manifest loading, inheritance, and seed file validation.
- Server initialization/reset APIs are scenario-first:
  - `POST /api/admin/elections/seed-scenario`
  - `POST /api/admin/constituencies/initialize-scenario`
  - `POST /api/admin/seed-scenario-factions`
  - `POST /api/admin/seed-scenario-bodies-locals`
- Wipe/reset messaging is tied to default-scenario metadata (scenario title/start label/expected constituency count), not fixed `"1997"` strings.

## Compatibility shims retained on purpose

- Legacy route aliases remain for existing operators/integrations:
  - `/api/admin/elections/seed-1997`
  - `/api/admin/constituencies/initialize-1997`
  - `/api/admin/seed-1997-factions`
  - `/api/admin/seed-1997-bodies-locals`
- Deprecated helper wrappers remain in API/service layers:
  - `apiInitialize1997Constituencies()`
  - `apiSeedElection1997()`
  - `apiAdminSeed1997Factions()`
  - `apiAdminSeed1997BodiesLocals()`
  - `seed1997Factions()`
- `scripts/convert-1997-csv.js` remains a compatibility wrapper around `scripts/convert-scenario-csv.js 1997`.

## Technical debt still blocking fully scenario-driven initialization

1. **Election and faction seed execution is still default-scenario constrained.**  
   `assertDefaultScenarioSeedKey()` currently rejects non-default scenario keys in seed paths.

2. **Legacy sim-index compatibility is still anchored to the old 1997 offset format.**  
   Backward-compat conversion remains in political-state recompute and should be removed after migrating old `last_saved_sim_index` values.

3. **Year-coded aliases remain in public/admin route contracts.**  
   They should be removed only after external scripts/tests fully migrate to scenario-first names.
