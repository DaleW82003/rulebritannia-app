# 1997 Baseline Hardcoding Audit (Phase 1)

## Summary

This phase audited where the app is hard-wired to a May/August 1997 baseline and where logic assumes a single historical starting scenario.

The most critical coupling is concentrated in:
- server bootstrap/seed/reset paths (`server/index.js`)
- scenario datasets and conversion script (`data/`, `assets/`, `scripts/convert-1997-csv.js`)
- admin seed/reset routes and corresponding frontend controls (`js/api.js`, `js/pages/*`)
- faction/party assumptions for the “big three” playable parties
- economy/shop naming that encodes 1997 as the baseline pricing model

---

## File inventory by category

### 1) Seed / import scripts

- `/tmp/workspace/DaleW82003/rulebritannia-app/scripts/convert-1997-csv.js`  
  Converts `assets/1997_structured.csv` to `data/constituencies_1997.json`; enforces exactly 659 seats.
- `/tmp/workspace/DaleW82003/rulebritannia-app/server/index.js`  
  Contains `seedElection1997`, `seedConstituencies1997`, `seedSalaryScale1997`, `seedPlayableParties` baseline structures, `BODIES_1997_SEED`, `LOCALS_1997_SEED`, wipe/reset reseeding flows, and demo seed data.
- `/tmp/workspace/DaleW82003/rulebritannia-app/server/political-state-service.js`  
  Contains `seed1997Factions` with hard-coded 1997 party/faction distributions.

### 2) Data files

- `/tmp/workspace/DaleW82003/rulebritannia-app/data/constituencies_1997.json`
- `/tmp/workspace/DaleW82003/rulebritannia-app/data/1997_structured.csv`
- `/tmp/workspace/DaleW82003/rulebritannia-app/assets/1997_structured.csv`
- `/tmp/workspace/DaleW82003/rulebritannia-app/data/demo.json`  
  Demo state includes start year 1997, `May 1997` election label, and 1997-timestamped narrative content.

### 3) Server routes

- `/tmp/workspace/DaleW82003/rulebritannia-app/server/index.js`
  - `POST /api/admin/elections/seed-1997`
  - `POST /api/admin/constituencies/initialize-1997`
  - `POST /api/admin/seed-1997-bodies-locals`
  - `POST /api/admin/seed-1997-factions`
  - `POST /api/admin/reset-baseline` (explicitly reseeds May 1997 + 659 constituencies)
  - `POST /api/admin/wipe-content` and `POST /api/admin/wipe-with-characters` (reset to August 1997)
  - `POST /api/admin/seed-demo` / `/api/admin/seed` (injects 1997-era content)

### 4) Admin tools

- `/tmp/workspace/DaleW82003/rulebritannia-app/js/pages/admin-panel.js`  
  Danger Zone copy and expectations explicitly reference August 1997 reset and 1997 baseline reseeding.
- `/tmp/workspace/DaleW82003/rulebritannia-app/js/pages/control-panel.js`  
  “Seed 1997 Factions” control and 3-party assumption in other-officials allocation UI.
- `/tmp/workspace/DaleW82003/rulebritannia-app/js/pages/bodies.js`  
  “Seed May 1997 Bodies/Locals” controls.
- `/tmp/workspace/DaleW82003/rulebritannia-app/js/pages/locals.js`  
  “Seed May 1997 Bodies/Locals” controls.
- `/tmp/workspace/DaleW82003/rulebritannia-app/js/api.js`  
  Admin API wrappers bound to year-specific route names (`initialize-1997`, `seed-1997*`).
- `/tmp/workspace/DaleW82003/rulebritannia-app/scripts/audit/rbac-matrix.json`  
  RBAC inventory includes year-specific route paths/rationales.

### 5) UI pages

- `/tmp/workspace/DaleW82003/rulebritannia-app/js/pages/user.js`  
  Defaults `lastGeneralElection` to `May 1997` and default start year to `1997`.
- `/tmp/workspace/DaleW82003/rulebritannia-app/js/core.js`  
  Global default game state uses `startSimYear: 1997`.
- `/tmp/workspace/DaleW82003/rulebritannia-app/js/clock.js`  
  Fallback year defaults to `1997`.
- `/tmp/workspace/DaleW82003/rulebritannia-app/js/pages/press.js`  
  Legacy date fallback/parsing assumes `"August 1997"` and year `1997`.
- `/tmp/workspace/DaleW82003/rulebritannia-app/js/pages/constituencies.js`  
  Fixed canonical party list and fixed playable-party assumptions in seat rendering.
- `/tmp/workspace/DaleW82003/rulebritannia-app/js/pages/playerbase.js`  
  Position comments tied to “1997 salary scale”.
- `/tmp/workspace/DaleW82003/rulebritannia-app/js/pages/personal.js`  
  Catalog schema and pricing fields encode `basePrice1997` and `baseMonthlyUpkeep1997`.
- `/tmp/workspace/DaleW82003/rulebritannia-app/js/pages/party.js`  
  Same `basePrice1997`/`baseMonthlyUpkeep1997` model plus `STAFF_COST_1997` naming.

### 6) Business logic

- `/tmp/workspace/DaleW82003/rulebritannia-app/server/index.js`
  - startup defaults: `sim_start_date = 1997-08-01`, `sim_clock`/`sim_state` year defaults
  - salary scale anchored as `"1997 Baseline"` with hard-coded sim indices
  - election seed fixed to polling day `1997-05-01` and label `"May 1997 General Election"`
  - constituency loader locked to `constituencies_1997.json` and 659-seat expectation
  - baseline reset/wipe reseed flows rely on 1997 constants/messages
  - canonical party and playable-party assumptions tightly coupled to current scenario model
- `/tmp/workspace/DaleW82003/rulebritannia-app/server/political-state-service.js`
  - `FACTION_PLAYABLE_PARTIES` fixed to Labour/Conservative/Liberal Democrat
  - calculations derive indexes relative to 1997 (`simYear - 1997`)
  - faction seed content hard-coded to post-May-1997 distributions
- `/tmp/workspace/DaleW82003/rulebritannia-app/server/clock.js`
  - fallback sim date defaults to `{ month: 8, year: 1997 }`
- `/tmp/workspace/DaleW82003/rulebritannia-app/server/schema.sql`
  - DB defaults for `sim_clock.sim_current_year` set to 1997
- `/tmp/workspace/DaleW82003/rulebritannia-app/server/finance-service.js`
  - comments and dependencies reference `HQ_BASELINE_UPKEEP_1997` in index module

### 7) Docs / comments

Primary docs with explicit 1997 coupling:
- `/tmp/workspace/DaleW82003/rulebritannia-app/README.md`
- `/tmp/workspace/DaleW82003/rulebritannia-app/server/README.md`
- `/tmp/workspace/DaleW82003/rulebritannia-app/docs/dev-guide.md`
- `/tmp/workspace/DaleW82003/rulebritannia-app/docs/system-overview.md`
- `/tmp/workspace/DaleW82003/rulebritannia-app/docs/simulation-model.md`
- `/tmp/workspace/DaleW82003/rulebritannia-app/docs/architecture.md`
- `/tmp/workspace/DaleW82003/rulebritannia-app/docs/trial-runbook.md`
- `/tmp/workspace/DaleW82003/rulebritannia-app/docs/alpha-launch-checklist.md`
- `/tmp/workspace/DaleW82003/rulebritannia-app/docs/extraction-summary.md`
- `/tmp/workspace/DaleW82003/rulebritannia-app/docs/recompute-observability.md`
- archive references:  
  `/tmp/workspace/DaleW82003/rulebritannia-app/docs/archive/ALPHA_HARDENING_SUMMARY.md`  
  `/tmp/workspace/DaleW82003/rulebritannia-app/docs/archive/pre-discourse-go-no-go-audit.md`  
  `/tmp/workspace/DaleW82003/rulebritannia-app/docs/archive/pre-discourse-structural-inventory.json`  
  `/tmp/workspace/DaleW82003/rulebritannia-app/docs/archive/FACTIONS_INTEGRATION_TESTS.md`

---

## Hard-coded reference checklist

### Explicit year/date labels
- `1997`, `May 1997`, `August 1997` appear in route names, labels, seed values, default config, reset copy, and docs.

### Year-specific route names
- `/api/admin/elections/seed-1997`
- `/api/admin/constituencies/initialize-1997`
- `/api/admin/seed-1997-bodies-locals`
- `/api/admin/seed-1997-factions`

### Year-specific seed filenames
- `assets/1997_structured.csv`
- `data/1997_structured.csv`
- `data/constituencies_1997.json`

### Structural assumptions (starting election/parties/government/leaders/constituencies)
- Election baseline locked to 1 May 1997 and “May 1997 General Election” label.
- Constituency baseline locked to 659-seat historical dataset.
- Faction model and character creation constrained to three playable parties.
- Multiple defaults and resets assume sim starts/resets to August 1997.
- Demo seed content is authored as 1997-era political world content.

---

## Risk areas

1. **Route/API compatibility risk**  
   Frontend and backend are tightly coupled via year-specific admin endpoints.

2. **Data-contract risk**  
   Many checks assume exactly 659 constituencies and one canonical baseline dataset.

3. **Reset/ops risk**  
   Wipe/reset/admin operations are semantically tied to a single baseline and could mis-seed if generalized partially.

4. **Gameplay-balance risk**  
   Salary, treasury, faction, and shop baselines are tuned with 1997 naming/values and could drift if scenario metadata is not centralized.

5. **Documentation drift risk**  
   1997 framing is repeated in many docs; partial refactor will quickly desync docs and runtime behavior.

---

## Recommended refactor order (for later phases)

1. **Introduce scenario model + identifiers**  
   Define canonical scenario metadata (id, label, startSimMonth/year, election seed source, constituency source, salary baseline source).

2. **Decouple seed loaders from year-specific filenames/routes**  
   Replace hard-coded `*1997*` loaders with scenario-driven loaders and generic route names.

3. **Refactor reset/wipe/demo flows to scenario-aware reset targets**  
   Make reset endpoints use active/default scenario config instead of embedded August/May 1997 constants.

4. **Refactor party/faction/playable-party assumptions**  
   Move playable-party lists and faction seed bundles under scenario config.

5. **Refactor economy nomenclature and baseline constants**  
   Rename `basePrice1997`-style fields to generic baseline semantics while preserving migration compatibility.

6. **Update admin/UI copy and API wrappers**  
   Replace 1997-specific labels/buttons/routes in `js/pages/*` and `js/api.js`.

7. **Update docs and archived operational guidance**  
   Document scenario-aware behavior and deprecate year-specific guidance.

---

## What can remain generic vs what must become scenario-aware

### Can remain generic
- Core CRUD patterns for elections/constituencies/content.
- Clock progression algorithm (Mon/Thu tick rule) itself.
- Most UI rendering components and permission framework.
- General admin safety patterns (confirm text, role checks, rate limits).

### Must become scenario-aware
- Baseline dataset selection (CSV/JSON paths and expectations).
- Seed route naming and API wrappers.
- Startup defaults (`sim_start_date`, sim fallback year/month).
- Reset/wipe/demo reseed target values and messages.
- Faction, salary, treasury, and playable-party baseline packs.
- Docs that currently present 1997 as invariant platform behavior.

