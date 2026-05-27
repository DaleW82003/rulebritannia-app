# Scenario Manifest Format

## Overview

Each playable game start ("scenario") in Rule Britannia is described by a
**manifest file** stored under `data/scenarios/<key>/manifest.json`.

The manifest is the single authoritative source of metadata for a scenario:
seed file locations, election data, playable parties, and the expected shape
of the world at game start.  Server code reads manifests through
`server/scenario-manifest-loader.js`; no scenario-specific magic strings
should exist outside of manifest files.

> **Current scope** — The manifest layer is shared across scenario-aware
> loaders.  Most runtime flows still treat `1997` as the only active gameplay
> scenario, but constituency import/initialization now resolves its committed
> JSON dataset by explicit `scenarioKey`.  Other non-default scenario behavior
> remains gated until later phases wire the broader runtime.

---

## Directory layout

```
data/
└── scenarios/
    └── 1997/
        ├── manifest.json
        └── constituencies.json   ← committed constituency seed for 1997
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
| `constituenciesFile` | `string` | ✓ | Repo-root-relative path to the constituencies JSON file (array of constituency objects). |
| `electionCsvFile` | `string` | ✓ | Repo-root-relative path to the structured election CSV (party vote/seat summary). |
| `expectedConstituencyCount` | `number` | ✓ | Number of constituencies the JSON must contain; seeding is rejected if the count doesn't match. |
| `playableParties` | `string[]` | ✓ | Ordered list of party names that have faction infrastructure in this scenario. |

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

The manifest field `constituenciesFile` points to that file.  This keeps the
generated constituency dataset colocated with the scenario definition instead
of relying on a global year-specific filename.

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

`server/index.js` calls `loadScenarioManifest(key)` in three places:

1. **`getScenarioConstituencySeedConfig`** — validates that the manifest has a
   constituency JSON path and expected seat count, then resolves the JSON path.
2. **`parseDefaultScenarioElectionCsv`** — opens
   `resolveManifestPath(manifest.electionCsvFile)` instead of a hardcoded
   string.
3. **`loadScenarioConstituenciesJson`** and
   **`initializeScenarioConstituenciesHandler`** — load the committed
   `constituencies.json` for the selected `scenarioKey`.

`server/political-state-service.js` imports `DEFAULT_SCENARIO_KEY` and
`getDefaultScenarioKey` from the loader, removing the last hardcoded `"1997"`
literal from service logic.

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
3. It opens the scenario's `constituenciesFile`.
4. It validates that the file contains exactly `expectedConstituencyCount`
   entries.
5. It overwrites the `constituencies` table with that scenario's committed
   seed data.

`POST /api/admin/constituencies/initialize-1997` remains as a legacy alias that
always targets the default 1997 scenario.

---

## Adding a new scenario

1. Create `data/scenarios/<newKey>/manifest.json` with all required fields.
2. Place the constituency JSON at `data/scenarios/<newKey>/constituencies.json`
   (or another repo-root-relative path referenced by `constituenciesFile`), and
   place the election CSV at the path listed in `electionCsvFile`.
3. Verify `listScenarioKeys()` returns the new key.
4. Re-generate the constituency JSON with:

   ```bash
   node scripts/convert-scenario-csv.js <newKey>
   ```

5. Update non-constituency runtime guards in `server/political-state-service.js`
   and `server/index.js` once the broader seed pipeline supports the new key.

---

## Remaining debt (post-Phase 3)

- `FACTION_PLAYABLE_PARTIES` in `political-state-service.js` is still a
  hardcoded array; a future phase will derive it from
  `manifest.playableParties`.
- `clockDefault` in the manifest is not yet consumed by `server/clock.js`;
  the fallback `{ month: 8, year: 1997 }` is still hardcoded there.
- Admin UI copy (reset descriptions, seed labels) still references "August
  1997" directly; a future phase will interpolate from manifest metadata.
- The `sim_current_year DEFAULT 1997` in `server/schema.sql` will be removed
  once the bootstrapping migration derives the default from the manifest.
