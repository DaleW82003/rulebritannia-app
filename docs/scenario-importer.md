# Scenario Importer — Structured CSV → Constituency JSON

## Overview

The importer converts a scenario's structured election CSV into a committed
constituency seed JSON file that the server loads at initialization time.  The
same script handles every scenario; scenario-specific paths and validation
rules come from the scenario's `manifest.json`, not from the script itself.

**Script:** `scripts/convert-scenario-csv.js`  
**Legacy alias (1997 only):** `scripts/convert-1997-csv.js`

---

## How to run

```bash
# Default scenario (1997)
node scripts/convert-scenario-csv.js

# Explicit scenario key
node scripts/convert-scenario-csv.js 1997
node scripts/convert-scenario-csv.js 2015-beta
```

The script reads all path and validation settings from
`data/scenarios/<key>/manifest.json` and writes the output JSON to the path
declared in the manifest's `constituenciesFile` field.  No arguments other
than the optional `<key>` are needed.

---

## Expected source format

The input is a plain UTF-8 (or Latin-1) CSV file at the path given by
`manifest.electionCsvFile`.  A fixed header row is required; subsequent rows
are typed by a `record_type` discriminator column:

```
record_type,party,region,constituency,seats,votes,vote_pct,majority,turnout_pct,turnout_total,electorate
```

### Comment and blank lines

Lines that are empty or begin with `#` (after any leading whitespace) are
ignored.  Use these freely for editorial notes inside the CSV — they do not
affect parsing or validation.

### Record types

#### `seat_breakdown`

One row per party.  Used to cross-validate that the derived seat count
(counted from `constituency_result` rows) matches the declared totals.

| Column | Used | Description |
|--------|------|-------------|
| `party` | ✓ | Party name (normalised — see [Party normalisation](#party-normalisation)) |
| `seats` | ✓ | Expected seat count for this party |

All other columns are ignored.

```
seat_breakdown,Conservative,,,331,,,,,,
seat_breakdown,Labour,,,232,,,,,,
```

#### `vote_summary`

One row per party.  Captured into the `voteSummary` map in the output JSON.

| Column | Used | Description |
|--------|------|-------------|
| `party` | ✓ | Party name (normalised) |
| `seats` | ✓ | Total seats won |
| `votes` | ✓ | Total votes cast for this party (integer) |
| `vote_pct` | ✓ | Share of the national vote (e.g. `36.9%`) |

All other columns are ignored.

```
vote_summary,Conservative,,,331,11334576,36.9%,,,,
vote_summary,Labour,,,232,9347304,30.4%,,,,
```

#### `constituency_result`

**One row per constituency** — this is the primary data feed.  There must be
exactly `manifest.expectedConstituencyCount` rows of this type.

| Column | Used | Description |
|--------|------|-------------|
| `party` | ✓ | Winning party (normalised) |
| `region` | ✓ | CSV region name — mapped to `nation`/`region` (see [Region mapping](#region-mapping)) |
| `constituency` | ✓ | Constituency name (trimmed) |

All other columns (`majority`, `turnout_pct`, etc.) are present in the file
but are **not** currently captured in the output JSON.  Add them later if the
server model requires them.

```
constituency_result,Conservative,South East,Guildford,,,,,,, 
constituency_result,Labour,London,Hackney North and Stoke Newington,,,,,,,
constituency_result,SNP,Scotland,Dundee East,,,,,,,
```

#### `overall_total`

Aggregated national totals.  Two rows are expected:

- First `overall_total` row: `turnout_pct` column captures the national
  turnout percentage (ignored in output).
- Second `overall_total` row: `electorate` column captures the total
  registered electorate; `turnout_total` captures the total votes cast.

Both values land in the top-level `electorate` and `turnoutTotal` fields of
the output JSON.

```
overall_total,,,,,,,,66.1%,,
overall_total,,,,,,,,,,46425386,30691380
```

---

## Transformation rules

### Party normalisation

Raw party names from the CSV are normalised before being stored.  The mapping
table is defined at the top of `scripts/convert-scenario-csv.js`:

| Raw (CSV) | Normalised |
|-----------|------------|
| `Sinn Fein` | `Sinn Féin` |
| `Sinn F?in` | `Sinn Féin` |
| `UK Unionist` | `Independents` |
| `Independent` | `Independents` |

Any name not present in the map is stored as-is (after trimming).

To add a new normalisation rule for a future scenario, extend the `PARTY_MAP`
object near the top of the script.

### Region mapping

The `region` column in the CSV maps to two output fields — `nation` and
`region` — according to a fixed devolution rule:

| CSV `region` value | Output `nation` | Output `region` |
|--------------------|-----------------|-----------------|
| `Scotland` | `Scotland` | `Scotland` |
| `Wales` | `Wales` | `Wales` |
| `Northern Ireland` | `Northern Ireland` | `Northern Ireland` |
| anything else | `England` | (value as-is) |

The devolved-region set is `DEVOLVED_REGIONS` in the script; extend it if a
future scenario requires a different mapping.

### Slug generation

Each constituency receives an `id` field that is a URL-safe slug derived from
the constituency name:

1. Lower-case the name.
2. Remove apostrophes and curly apostrophes (`'`, `'`).
3. Replace all runs of non-alphanumeric characters with `-`.
4. Strip any leading or trailing `-`.

Examples:

| Constituency name | Slug |
|-------------------|------|
| `Hackney North and Stoke Newington` | `hackney-north-and-stoke-newington` |
| `St Helens North` | `st-helens-north` |
| `Ynys Môn` | `ynys-m-n` |

---

## Validation

After parsing, two checks are enforced — the script aborts with a non-zero
exit code on any failure:

1. **Constituency count** — the number of `constituency_result` rows must
   equal `manifest.expectedConstituencyCount` exactly.
2. **Seat-breakdown cross-check** — for every party listed in
   `seat_breakdown` rows with a non-zero count, the number of
   `constituency_result` rows won by that party must match.  Parties with
   `seats = 0` in the breakdown are skipped (they can still appear in
   `vote_summary`).

---

## Output file

The script writes a single JSON file at the path given by
`manifest.constituenciesFile` (e.g. `data/scenarios/2015-beta/constituencies.json`).

```jsonc
{
  "generatedAt": "2026-05-27T12:00:00.000Z",   // ISO timestamp of the run
  "constituencies": [                            // one object per seat
    {
      "id": "guildford",                         // URL-safe slug
      "name": "Guildford",                       // display name (trimmed)
      "nation": "England",                       // derived from region
      "region": "South East",                    // CSV region value
      "party": "Conservative",                   // normalised winning party
      "mpType": "",                              // placeholder — not in CSV
      "mpName": ""                               // placeholder — not in CSV
    }
    // ... 649 more entries
  ],
  "voteSummary": {                               // keyed by normalised party name
    "Conservative": { "seats": 331, "votes": 11334576, "vote_pct": 36.9 },
    "Labour":       { "seats": 232, "votes":  9347304, "vote_pct": 30.4 }
    // ...
  },
  "electorate":   46425386,                      // from overall_total row
  "turnoutTotal": 30691380                       // from overall_total row
}
```

The file is committed to the repository alongside the scenario manifest and
world-seed files.  The server reads it directly at seed time — no runtime CSV
parsing occurs.

---

## Adding a new scenario

1. Create `data/scenarios/<key>/manifest.json` with at minimum:
   - `electionCsvFile` — path to the source CSV
   - `constituenciesFile` — output path for the generated JSON
   - `expectedConstituencyCount` — exact seat count for validation

2. Place the source CSV at `electionCsvFile`.  Use `#` comment lines freely
   during authoring; they are stripped by the parser.

3. Run:
   ```bash
   node scripts/convert-scenario-csv.js <key>
   ```

4. Commit the generated `constituencies.json` alongside the manifest.

5. Continue with the remaining world-seed domains (`world-seed.json`) as
   described in `docs/scenario-manifest.md`.

---

## File locations summary

| File | Purpose |
|------|---------|
| `scripts/convert-scenario-csv.js` | Generic importer (all scenarios) |
| `scripts/convert-1997-csv.js` | Legacy alias targeting the 1997 scenario |
| `assets/1997_structured.csv` | 1997 source election CSV |
| `assets/2015-beta_structured.csv` | 2015-beta source CSV (placeholder — populate before running) |
| `data/scenarios/1997/constituencies.json` | Generated output for 1997 |
| `data/scenarios/2015-beta/constituencies.json` | Generated output for 2015-beta (empty until CSV is populated) |
| `data/scenarios/<key>/manifest.json` | Manifest controlling all importer paths and counts |
