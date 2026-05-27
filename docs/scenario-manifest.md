# Scenario Manifest Format

## Overview

Each playable game start ("scenario") in Rule Britannia is described by a
**manifest file** stored under `data/scenarios/<key>/manifest.json`.

The manifest is the single authoritative source of metadata for a scenario:
seed file locations, election data, playable parties, scenario-owned world
seed packs, and the expected shape of the world at game start. Server code reads manifests through
`server/scenario-manifest-loader.js`; no scenario-specific magic strings
should exist outside of manifest files.

> **Current scope** — The manifest layer is shared across scenario-aware
> loaders.  Most runtime flows still treat `1997` as the only active gameplay
> scenario, but constituency import/initialization plus base-world seed loading
> now resolve their committed JSON datasets by explicit `scenarioKey`.  Other
> non-default scenario behavior remains gated until later phases wire the
> broader runtime.

---

## Directory layout

```
data/
└── scenarios/
    └── 1997/
        ├── manifest.json
        ├── constituencies.json   ← committed constituency seed for 1997
        └── world-seed.json       ← parties/factions/governance/economy seed pack
```

Additional scenarios live as sibling directories:

```
data/scenarios/
├── 1997/
│   ├── manifest.json
│   └── constituencies.json
└── 2015/           ← future scenario
    ├── manifest.json
    └── constituencies.json
```

---

## Manifest fields

| Field | Type | Required | Description |
|---|---|---|---|
| `key` | `string` | ✓ | Unique scenario identifier, matches the directory name. |
| `title` | `string` | ✓ | Human-readable name shown in the admin UI. |
| `description` | `string` | ✓ | One-paragraph summary of the scenario context. |
| `startDate` | `object` | ✓ | Month and year of the general election that starts this scenario. |
| `startDate.month` | `number` | ✓ | 1–12. |
| `startDate.year` | `number` | ✓ | e.g. `1997`. |
| `clockDefault` | `object` | ✓ | Fallback sim date used when game state is absent (month the simulation opens). |
| `clockDefault.month` | `number` | ✓ | 1–12. |
| `clockDefault.year` | `number` | ✓ | e.g. `1997`. |
| `status` | `string` | ✓ | One of `"default"`, `"beta"`, or `"legacy"`. Only `"default"` is loaded automatically. |
| `parentScenario` | `string` |  | Optional base scenario key. Child manifests inherit unspecified manifest fields from this parent. `baseScenario` is accepted as a legacy alias. |
| `inheritance` | `object` |  | Optional per-asset inheritance modes for child scenarios. Supported keys are `worldSeed` and `constituencies`; values must be `"merge"` or `"replace"`. |
| `constituenciesFile` | `string` | ✓* | Repo-root-relative path to the constituencies JSON file (array of constituency objects, or an overrides file when `inheritance.constituencies` is `"merge"`). |
| `worldSeedFile` | `string` | ✓* | Repo-root-relative path to the world-seed JSON file (full seed, or an overrides file when `inheritance.worldSeed` is `"merge"`). |
| `electionCsvFile` | `string` | ✓ | Repo-root-relative path to the structured election CSV (party vote/seat summary). |
| `expectedConstituencyCount` | `number` | ✓ | Number of constituencies the JSON must contain; seeding is rejected if the count doesn't match. |
| `playableParties` | `string[]` | ✓ | Ordered list of party names that have faction infrastructure in this scenario. |

\* A child scenario may omit one of these file fields and inherit the parent's file unchanged. If it supplies its own file, the loader applies the configured inheritance mode for that asset.

### Example — `data/scenarios/1997/manifest.json`

```json
{
  "key": "1997",
  "title": "May 1997 General Election",
  "description": "The default scenario. Labour wins a landslide majority in the May 1997 UK general election. The simulation begins in August 1997 with players entering a newly-formed Parliament.",
  "startDate": { "month": 5, "year": 1997 },
  "clockDefault": { "month": 8, "year": 1997 },
  "status": "default",
  "constituenciesFile": "data/scenarios/1997/constituencies.json",
  "worldSeedFile": "data/scenarios/1997/world-seed.json",
  "electionCsvFile": "assets/1997_structured.csv",
  "expectedConstituencyCount": 659,
  "playableParties": ["Conservative", "Labour", "Liberal Democrat"]
}
```

---

## Loader API — `server/scenario-manifest-loader.js`

```js
import {
  DEFAULT_SCENARIO_KEY,    // "1997"
  getDefaultScenarioKey,   // () => "1997"
  loadScenarioManifest,    // (key: string) => manifest object (cached)
  loadScenarioWorldSeed,   // (key: string) => scenario-owned world seed object
  loadScenarioConstituenciesSeed, // (key: string) => merged/replaced constituencies seed object
  resolveManifestPath,     // (relPath: string) => absolute path
  listScenarioKeys,        // () => string[]  — all keys with a manifest on disk
} from "./scenario-manifest-loader.js";
```

### `loadScenarioManifest(key)`

Reads and returns the parsed `manifest.json` for the given scenario key.
Results are cached in-process; repeated calls are cheap.

Throws with `err.code === "SCENARIO_MANIFEST_NOT_FOUND"` if no manifest
exists for the key, and `"SCENARIO_MANIFEST_INVALID_JSON"` if the file
cannot be parsed.

The loader also validates the effective manifest and throws
`"SCENARIO_MANIFEST_INVALID_DATA"` for invalid metadata/linked file
references and `"SCENARIO_MANIFEST_INVALID_INHERITANCE"` for invalid parent
or inheritance configuration.

If the manifest declares `parentScenario`/`baseScenario`, the loader first
loads the parent manifest and then applies the child manifest on top:

- child scalar values override parent scalar values
- child objects merge by key
- child arrays replace parent arrays

This keeps manifest inheritance explicit and predictable.

### `loadScenarioWorldSeed(key)`

Reads and returns the effective world-seed JSON for the scenario.

If the scenario has no parent, the loader simply parses `worldSeedFile`.
If the scenario has a parent:

- `inheritance.worldSeed = "merge"` (default) → merge the parent seed with the
  child seed
- `inheritance.worldSeed = "replace"` → use only the child seed
- no child `worldSeedFile` → reuse the parent seed unchanged

After loading, the effective world seed is validated. Invalid canonical-party
registries, broken party references, missing required IDs (for example faction
slugs or office `specId`s), and malformed runtime-owned domains throw
`"SCENARIO_WORLD_SEED_INVALID_DATA"`.

### `loadScenarioConstituenciesSeed(key)`

Reads and returns the effective constituencies seed JSON for the scenario.

If the scenario has a parent:

- `inheritance.constituencies = "merge"` (default) → merge the parent
  constituencies JSON with the child JSON
- `inheritance.constituencies = "replace"` → use only the child JSON
- no child `constituenciesFile` → reuse the parent JSON unchanged

After loading, the effective constituency seed is validated. Invalid
constituency IDs, unsupported nation values, and constituency/vote-summary
party references that do not exist in the effective canonical-party registry
throw `"SCENARIO_CONSTITUENCIES_INVALID_DATA"`.

This lets a child scenario override only selected constituency winners while
keeping the parent seat map as a baseline.

## Seed precedence rules

The override model is intentionally narrow:

1. **Parent loads first.**
2. **Child object properties override matching parent properties.**
3. **Arrays replace by default.**
4. **A small set of record arrays merge by stable identifiers instead of
   replacing wholesale.**

Record-array merge rules are currently:

- `constituencies` by `id` (fallback `name`)
- `canonicalParties` by `slug` (fallback `name`)
- `factions` by `slug`
- `officeSpecs.cabinet` / `officeSpecs.shadow` by `specId`
- `locals.countries` by `country`
- `locals.countries[*].partyBreakdown` by `party`
- `bodies.<body>.partyBreakdown` by `party`
- `bodies.<body>.compositionBreakdown` by `name`
- `bodies.<body>.mayors` by `id` (fallback `name`)

Everything else follows the normal object/array rules above.

There is deliberately **no delete/remove syntax** in this phase. If a future
scenario needs to drop inherited records, add an explicit rule in code rather
than introducing an implicit magic patch language.

## Validation expectations

Current validation is intentionally practical rather than schema-heavy:

- manifest metadata must be complete (`key`, title/description, dates, status,
  expected constituency count, playable parties)
- linked manifest files must exist and stay repo-root-relative
- parent scenarios and inheritance keys must be valid
- effective world seeds must provide a valid canonical-party registry plus
  required IDs/keys for factions and office specs
- party references inside world/constituency seed data must resolve against the
  effective canonical-party registry (except explicit `"Others"` buckets)
- effective constituency data must contain well-formed constituency records

The constituency loader does **not** enforce
`expectedConstituencyCount` by itself, because blocked/incomplete scenarios may
still exist in preview form. That count is still enforced by the admin
initialization flow before any DB overwrite happens.

The current default scenario uses it for:

- canonical party registry
- party organisation/treasury defaults
- faction seed data
- House of Lords / European Parliament / locals baseline state
- budget baseline values
- cabinet and shadow-cabinet office spec registry
- salary-scale baseline seed values
- party HQ baseline upkeep defaults

### `resolveManifestPath(relPath)`

Converts a repo-root-relative path stored in a manifest field (e.g.
`"data/scenarios/1997/constituencies.json"`) to an absolute filesystem path that can
be passed to `readFileSync`.

### `listScenarioKeys()`

Returns a sorted array of all scenario keys that have a manifest file under
`data/scenarios/`.  Returns `[]` if the directory doesn't exist yet (e.g.
in test environments that don't clone data files).

---

## Scenario constituency storage

Each scenario owns its committed constituency seed JSON:

```text
data/scenarios/<key>/constituencies.json
```

The manifest field `constituenciesFile` points to that file. This keeps the
generated constituency dataset colocated with the scenario definition instead
of relying on a global year-specific filename.

For child scenarios using `inheritance.constituencies = "merge"`, the file may
contain only the constituencies that differ from the parent plus any top-level
summary fields (`voteSummary`, `electorate`, `turnoutTotal`) that also need to
change. The loader materializes the full effective dataset before validation
and seeding.

For the current default scenario:

```text
data/scenarios/1997/manifest.json
data/scenarios/1997/constituencies.json
```

The raw CSV input may still live elsewhere (for 1997 it remains
`assets/1997_structured.csv`), but the committed JSON consumed by the server is
now stored per scenario.

---

## How the loader is used

`server/index.js` and `server/political-state-service.js` now use the manifest
and world-seed loader in these places:

1. **`getScenarioConstituencySeedConfig`** — validates that the manifest has a
   constituency JSON path and expected seat count, then resolves the JSON path.
2. **`parseDefaultScenarioElectionCsv`** — opens
   `resolveManifestPath(manifest.electionCsvFile)` instead of a hardcoded
   string.
3. **`loadScenarioConstituenciesSeed`** and
   **`initializeScenarioConstituenciesHandler`** — load the committed
   `constituencies.json` for the selected `scenarioKey`, including any parent
   overrides.

4. **`seedPlayableParties`** — reads canonical parties, party structure
   defaults, and treasury baselines from `worldSeedFile`.
5. **`seedDefaultScenarioFactions`** — reads faction seed rows from
   `worldSeedFile`.
6. **`seedScenarioBodiesLocalsHandler`** — reads bodies/locals baseline data
   from `worldSeedFile`.
7. **`seedBudgetBaseline`** — reads budget baseline/admin-control values from
   `worldSeedFile`.
8. **`FACTION_PLAYABLE_PARTIES`** — now resolves directly from
   `manifest.playableParties`.
9. **Clock bootstrap/reset fallbacks** — resolve from `manifest.clockDefault`.
10. **Election seed metadata** — polling day/label derive from
   `manifest.startDate` + `manifest.title`.
11. **`seedOfficeSpecs`** — office spec rows resolve from
   `worldSeedFile.officeSpecs`.
12. **`initializeDefaultScenarioSalaryScale`** — salary baseline seed resolves
   from `worldSeedFile.salaryScale`.
13. **Party upkeep baseline in monthly finance tick** — resolves from
   `worldSeedFile.economy.hqBaselineUpkeep`.

---

## Initializing constituencies for a selected scenario

The admin seed route is:

```text
POST /api/admin/constituencies/initialize-scenario
```

Request body:

```json
{
  "confirm": true,
  "scenarioKey": "1997"
}
```

Behavior:

1. The route resolves the requested `scenarioKey`.
2. It loads `data/scenarios/<key>/manifest.json`.
3. It resolves the scenario's effective constituencies seed (base + overrides
   if configured).
4. It validates that the effective dataset contains exactly
   `expectedConstituencyCount`
   entries.
5. It overwrites the `constituencies` table with that scenario's committed
   seed data.

`POST /api/admin/constituencies/initialize-1997` remains as a legacy alias that
always targets the default 1997 scenario.

---

## Adding a new scenario

1. Create `data/scenarios/<newKey>/manifest.json` with all required fields.
   Add `parentScenario` if the new scenario should inherit an existing one.
2. Place the constituency JSON at `data/scenarios/<newKey>/constituencies.json`
   (or another repo-root-relative path referenced by `constituenciesFile`),
   place the base-world seed JSON or overrides JSON at the path listed in
   `worldSeedFile`, and
   place the election CSV at the path listed in `electionCsvFile`.
3. Verify `listScenarioKeys()` returns the new key.
4. Re-generate the constituency JSON with:

   ```bash
   node scripts/convert-scenario-csv.js <newKey>
   ```

5. Copy or author only the world-seed domains you need to change. Omitted
   domains inherit from the parent when `parentScenario` is set; otherwise the
   file must provide the complete seed.

6. When overriding only selected constituency winners, set
   `inheritance.constituencies` to `"merge"` and commit a partial
   `constituencies.json` containing just the changed seats.

7. When a child scenario should *not* inherit a parent asset, set that asset's
   inheritance mode to `"replace"` and provide a full child-owned file.

The currently-supported world-seed domains remain:

   - `canonicalParties`
   - `partyStructures`
   - `partyTreasuryCash`
   - `factions`
   - `bodies`
   - `locals`
   - `budget`
   - `officeSpecs`
   - `salaryScale`
   - `economy.hqBaselineUpkeep`

8. Update remaining non-scenario-owned runtime guards in
   `server/political-state-service.js` and `server/index.js` once the broader
   seed pipeline supports the new key.

---

## Scenario-driven domains vs pending domains

### Now scenario-driven

- Constituency seed file (`constituenciesFile`)
- Canonical party registry
- Playable-party list
- Party structure defaults
- Party treasury cash defaults
- Faction seed rows
- Lords / European Parliament / local-government baseline seed data
- Budget baseline/admin-control defaults
- Cabinet and shadow-cabinet office spec defaults
- Salary-scale baseline defaults
- Party HQ baseline upkeep defaults
- Default scenario clock fallback/reset metadata
- Default scenario election metadata (polling day/label)

### Still pending

- Party leaders
- Government / opposition formation
- Cabinet / shadow-cabinet office assignments
- NPC/character baseline roster
- Starting news / events / polling
- Economy page baseline defaults (`app_config.economy_page_data`)

---

## Remaining debt (post-Phase 5)

- `clockDefault` in the manifest is not yet consumed by `server/clock.js`;
  the fallback `{ month: 8, year: 1997 }` is still hardcoded there.
- Admin UI copy (reset descriptions, seed labels) still references "August
  1997" directly; a future phase will interpolate from manifest metadata.
- The `sim_current_year DEFAULT 1997` in `server/schema.sql` will be removed
  once the bootstrapping migration derives the default from the manifest.
- Cabinet/shadow cabinet, party-leader, NPC, and starting-news/polling defaults
  are still global runtime concerns; later phases should move them behind
  scenario-owned seed files or initializer logic.

---

## Admin Scenario Initialization (Phase 6)

### Overview

Admins can initialize or reseed all world baseline data from the Admin Panel
without touching the server CLI or running individual seed endpoints manually.

### How to use

1. Navigate to **Admin Panel** (`/admin-panel.html`).
2. Scroll to the **World Initialization — Scenario Seeding** section (between
   the Maintenance section and the Danger Zone).
3. Select a scenario from the dropdown. Currently only **May 1997 General
   Election** is available.
4. Read the description and confirmation warning.
5. Type `INITIALIZE SCENARIO 1997` (substituting the key shown) in the
   confirmation box.
6. Click **Initialize Scenario**.
7. A browser confirm dialog will appear — accept it to proceed.
8. The panel shows per-step progress as each seed step runs:
   - ✓ / ✗ Election record
   - ✓ / ✗ Constituencies
   - ✓ / ✗ Budget baseline
   - ✓ / ✗ Party factions
   - ✓ / ✗ Bodies & locals
9. A toast notification reports overall success or failure.

### Safety protections

- Typed confirmation string (`INITIALIZE SCENARIO <key>`) must match exactly
  before the button becomes functional.
- A browser `window.confirm()` dialog provides a second explicit gate.
- All five seed steps are idempotent — running them on an already-seeded world
  adds missing data without destroying existing rows, **except** for the
  constituencies step which wipes and reloads the full constituency table.
- Per-step results are displayed so failures are immediately visible.

### API

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `GET` | `/api/admin/scenarios` | Admin | Returns `{ scenarios: [...] }` with manifest summary fields: `key`, `title`, `description`, `status`, `startDate`, `clockDefault`, `playableParties`, `isDefault`. No `isDevSeedAllowed` gate (read-only). |

The individual seed endpoints called by the UI remain unchanged:

| Method | Path | Auth | Gated by `isDevSeedAllowed` |
|--------|------|------|----------------------------|
| `POST` | `/api/admin/elections/seed-scenario` | Admin/Mod | Yes |
| `POST` | `/api/admin/constituencies/initialize-scenario` | Admin/Mod/Speaker | Yes |
| `POST` | `/api/admin/budget/seed` | Admin | Yes |
| `POST` | `/api/admin/seed-scenario-factions` | Admin/Mod | Yes |
| `POST` | `/api/admin/seed-scenario-bodies-locals` | Admin/Mod | Yes |

### Limitations (Phase 6 scope)

- Only the `1997` scenario is currently available. Adding a new scenario key
  requires authoring all seed files and updating `assertSupportedScenarioKey`
  in `server/index.js`.
- The initialization flow does **not** seed demo polling data, characters,
  government formation, party leaders, or NPC rosters. Those remain manual or
  handled by later phases.
