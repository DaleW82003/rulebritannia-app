# Scenario Manifest Format

## Overview

Each playable game start ("scenario") in Rule Britannia is described by a
**manifest file** stored under `data/scenarios/<key>/manifest.json`.

The manifest is the single authoritative source of metadata for a scenario:
seed file locations, election data, playable parties, and the expected shape
of the world at game start.  Server code reads manifests through
`server/scenario-manifest-loader.js`; no scenario-specific magic strings
should exist outside of manifest files.

> **Phase 3 scope** — This document describes the manifest *format* and
> *loader* introduced in Phase 3.  Multi-scenario runtime support (admin-UI
> scenario selection, seeding pipelines for non-default scenarios) is **not
> yet implemented**.  Only the `1997` scenario manifest is active; non-default
> scenario keys are explicitly rejected at runtime by `assertSupportedScenarioKey`
> in `server/index.js` and `server/political-state-service.js`.  Phase 4 will
> lift that restriction once the full seed pipeline is ready.

---

## Directory layout

```
data/
└── scenarios/
    └── 1997/
        └── manifest.json   ← the 1997 (default) scenario
```

Additional scenarios live as sibling directories:

```
data/scenarios/
├── 1997/
│   └── manifest.json
└── 2015/           ← future scenario
    └── manifest.json
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
  "constituenciesFile": "data/constituencies_1997.json",
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
`"data/constituencies_1997.json"`) to an absolute filesystem path that can
be passed to `readFileSync`.

### `listScenarioKeys()`

Returns a sorted array of all scenario keys that have a manifest file under
`data/scenarios/`.  Returns `[]` if the directory doesn't exist yet (e.g.
in test environments that don't clone data files).

---

## How the loader is used

`server/index.js` calls `loadScenarioManifest(key)` in three places:

1. **`getDefaultScenarioConstituenciesPath`** — returns
   `resolveManifestPath(manifest.constituenciesFile)` instead of a hardcoded
   string.
2. **`parseDefaultScenarioElectionCsv`** — opens
   `resolveManifestPath(manifest.electionCsvFile)` instead of a hardcoded
   string.
3. **`getScenarioExpectedConstituencyCount`** — returns
   `manifest.expectedConstituencyCount` instead of a hardcoded `659`.

`server/political-state-service.js` imports `DEFAULT_SCENARIO_KEY` and
`getDefaultScenarioKey` from the loader, removing the last hardcoded `"1997"`
literal from service logic.

---

## Adding a new scenario

1. Create `data/scenarios/<newKey>/manifest.json` with all required fields.
2. Place (or symlink) the constituency JSON and election CSV at the paths
   listed in the manifest, relative to the repo root.
3. Verify `listScenarioKeys()` returns the new key.
4. Update `assertSupportedScenarioKey` in `server/political-state-service.js`
   and `server/index.js` to accept the new key once the full seed pipeline
   supports it.

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
