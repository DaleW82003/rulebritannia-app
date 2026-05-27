# 1997 Scenario Hardcoding Audit (Phase 1 follow-up)

## Summary

This audit is now stored at a normal tracked repository path: `docs/1997-scenario-hardcoding-audit.md`.

Phase 1 follow-up result: 1997 coupling is concentrated in server initialization/reset/seed flows, constituency pipeline assets, and admin/API/UI wiring that still uses `*1997*` route and field names.

Phase 2 note: route/helper naming seams now use "scenario" terminology where safe, but full multi-scenario runtime support is intentionally not implemented yet; 1997 remains the active default scenario.

## File-by-file findings

### A) scripts/importers

| Exact file path | Category | Coupling (short) | Recommended refactor direction | Risk |
|---|---|---|---|---|
| `scripts/convert-1997-csv.js` | scripts/importers | Script name, input/output files, and seat count validation are all 1997-specific (`assets/1997_structured.csv` → `data/constituencies_1997.json`, expected `659`). | Replace with scenario-agnostic converter that reads scenario manifest (input file, output file, seat constraints). | high |
| `scripts/audit/rbac-matrix.json` | scripts/importers | RBAC inventory hardcodes `/api/admin/*1997*` route paths and 659-seat rationale text. | Generate route inventory from generic endpoint names; keep scenario in metadata, not route string. | medium |
| `scripts/audit/feature-manifest.js` | scripts/importers | Minimal/no direct 1997 coupling found. | Keep unchanged; ensure future scenario checks remain generic. | low |
| `scripts/static-checks.js` | scripts/importers | Minimal/no direct 1997 coupling found. | Keep unchanged; avoid adding year-specific checks. | low |

### B) data files

| Exact file path | Category | Coupling (short) | Recommended refactor direction | Risk |
|---|---|---|---|---|
| `data/constituencies_1997.json` | data files | Canonical baseline file is year-bound and used as implicit default constituency source. | Move to `data/scenarios/<scenarioId>/constituencies.json` + manifest pointer. | high |
| `data/1997_structured.csv` | data files | Raw constituency/election source dataset is year-bound and naming-coupled. | Store as scenario dataset referenced by manifest. | medium |
| `assets/1997_structured.csv` | data files | Duplicate year-bound source asset increases coupling and drift risk. | Collapse to single canonical scenario source path. | medium |
| `data/demo.json` | data files | Demo payload includes start year, election labels, and content timeline tied to 1997 progression. | Split demo content from scenario timeline defaults; inject scenario-specific chronology at seed time. | high |

### C) server routes/services

| Exact file path | Category | Coupling (short) | Recommended refactor direction | Risk |
|---|---|---|---|---|
| `server/index.js` | server routes/services | Year-specific admin routes (`/seed-1997`, `/initialize-1997`), fixed election date/label, hardcoded reset to August 1997, fallback year defaults, 659-seat checks, and `constituencies_1997.json` loader. | Introduce scenario manifest + generic seed/reset routes (`/seed-scenario`, `/initialize-constituencies`) and move defaults to scenario initializer. | high |
| `server/political-state-service.js` | server routes/services | `seed1997Factions`, fixed playable parties array, and index math anchored to 1997 baseline. | Move faction seeds and playable-party list into scenario config and compute index from scenario start metadata. | high |
| `server/clock.js` | server routes/services | Fallback date defaults to month/year in 1997. | Resolve fallback from scenario start metadata instead of hardcoded year. | medium |
| `server/schema.sql` | server routes/services | `sim_current_year` DB default is 1997. | Remove fixed year default or derive from scenario bootstrapping migration. | medium |
| `server/finance-service.js` | server routes/services | Comments/reference naming still encode 1997 baseline conventions. | Rename baseline economics terms to neutral naming while preserving backward compatibility. | low |

### D) admin/control-panel flows

| Exact file path | Category | Coupling (short) | Recommended refactor direction | Risk |
|---|---|---|---|---|
| `js/api.js` | admin/control-panel flows | Admin client methods call year-specific route URLs (`initialize-1997`, `seed-1997*`). | Replace with generic admin API methods that pass scenario id as payload/query. | high |
| `js/pages/admin-panel.js` | admin/control-panel flows | Reset UX copy explicitly promises reset to August 1997. | Bind copy to active scenario metadata (`startLabel`, `baselineLabel`). | medium |
| `js/pages/control-panel.js` | admin/control-panel flows | “Seed 1997 Factions” action and hardcoded playable-party trio in control logic. | Make seed action scenario-selected; load playable parties from server metadata. | high |
| `js/pages/bodies.js` | admin/control-panel flows | Includes “Seed May 1997 Bodies/Locals” behavior/copy. | Use generic seed action + scenario label interpolation. | medium |
| `js/pages/locals.js` | admin/control-panel flows | Includes “Seed May 1997 Bodies/Locals” behavior/copy. | Use generic seed action + scenario label interpolation. | medium |

### E) UI/client code

| Exact file path | Category | Coupling (short) | Recommended refactor direction | Risk |
|---|---|---|---|---|
| `js/core.js` | UI/client code | Default game state start year set to 1997. | Hydrate defaults from server scenario manifest. | high |
| `js/clock.js` | UI/client code | Fallback year defaults to 1997 in clock resolution. | Use scenario start fallback from manifest/bootstrap payload. | medium |
| `js/pages/user.js` | UI/client code | Default `lastGeneralElection` and `startSimYear` both assume 1997 baseline. | Use scenario-provided election label/year defaults. | medium |
| `js/pages/press.js` | UI/client code | Legacy parser defaults to “August 1997” and `1997` year fallback. | Parse against scenario start date fallback (not fixed literal). | low |
| `js/pages/constituencies.js` | UI/client code | Canonical-party/playable assumptions align to current 3-party baseline behavior. | Source playable/canonical parties from API metadata per scenario. | high |
| `js/pages/personal.js` | UI/client code | Schema fields (`basePrice1997`, `baseMonthlyUpkeep1997`) encode year in data model. | Rename to scenario-neutral baseline fields via migration/adapter layer. | medium |
| `js/pages/party.js` | UI/client code | Same year-bound pricing fields plus `STAFF_COST_1997` constant naming. | Migrate to neutral baseline economics naming and scenario baseline config. | medium |
| `js/pages/playerbase.js` | UI/client code | Comments/labels reference 1997 salary baseline assumptions. | Reword to scenario-baseline terminology and central constants. | low |
| `js/pages/questiontime.js` | UI/client code | Minimal coupling: comments show sample JSON with year 1997, but no fixed year logic. | Optional comment cleanup only; no functional refactor needed now. | low |

### F) docs/comments

| Exact file path | Category | Coupling (short) | Recommended refactor direction | Risk |
|---|---|---|---|---|
| `README.md` | docs/comments | Documents 1997 baseline as default world framing. | Update docs to describe scenario-based initialization model. | medium |
| `server/README.md` | docs/comments | Operational/admin seed instructions still reference year-specific endpoints. | Document generic scenario seed/reset APIs and scenario id usage. | medium |
| `docs/dev-guide.md` | docs/comments | Developer guidance contains 1997 baseline assumptions. | Replace with scenario-manifest terminology and generic startup flow. | low |
| `docs/system-overview.md` | docs/comments | Architecture narrative still anchored to single 1997 baseline. | Add scenario abstraction layer in system docs. | low |
| `docs/simulation-model.md` | docs/comments | Simulation examples and default progression tied to 1997 baseline. | Generalize examples to scenario-driven start points. | low |
| `docs/architecture.md` | docs/comments | References year-specific reset/seed behavior. | Update architecture sections after route/generalization refactor. | low |
| `docs/trial-runbook.md` | docs/comments | Runbook steps reference year-specific seed/reset operations. | Replace with scenario selection + generic reset/seed procedure. | medium |
| `docs/alpha-launch-checklist.md` | docs/comments | Checklist includes 1997-era baseline assumptions. | Reword checklist to scenario-agnostic launch criteria. | low |
| `docs/extraction-summary.md` | docs/comments | Extraction notes include 1997-specific framing. | Keep historical references but mark as scenario-specific legacy context. | low |
| `docs/recompute-observability.md` | docs/comments | Mentions 1997-coupled baseline states in observability context. | Update language to “active scenario baseline”. | low |

## Highest-risk areas

1. **Initialization/reset flows (high)**
   `server/index.js` reset/wipe/bootstrap routes and startup defaults still hard-reset to August 1997 and reseed May 1997 election baseline.

2. **Constituency seed pipeline (high)**
   `scripts/convert-1997-csv.js` + `data/constituencies_1997.json` + `POST /api/admin/constituencies/initialize-1997` enforce a single 659-seat historical dataset.

3. **Party-count/playable-party assumptions (high)**
   `server/political-state-service.js`, `server/index.js`, and `js/pages/control-panel.js` assume a fixed playable-party set and current party structure.

4. **Defaults tied to 1997 date/state progression (high)**
   Server/client fallbacks (`sim_current_year`, sim start dates, parser fallbacks) repeatedly default to 1997, creating hidden coupling.

5. **659-seat / pre-boundary-review assumptions (high)**
   Validation and operational messaging rely on exactly 659 constituencies, which blocks alternate constituency maps without schema/logic changes.

## Phased implementation order (concrete)

1. **Terminology cleanup**
   Rename year-coded identifiers/messages (`*1997*`, “August 1997 baseline”) in internal constants/comments/UI copy where safe, while preserving behavior.

2. **Scenario manifest layer**
   Add a single scenario manifest source (id, start date, election seed source, constituency source, playable parties, economy baseline).

3. **Generic scenario initializer**
   Replace route/function naming that hardcodes year with scenario-parameterized initializer/seed/reset endpoints.

4. **Constituency migration**
   Move constituency loading/validation from fixed `constituencies_1997.json` + `659` checks to manifest-driven dataset constraints.

5. **Broader seed-domain extraction**
   Externalize faction seeds, salary/economy baselines, and other year-bound defaults into scenario data packs.

6. **Admin scenario selection**
   Update admin UI/API wrappers so operators choose scenario id rather than invoking year-specific controls.

7. **2015 beta onboarding**
   Add a 2015 scenario pack using the same manifest/initializer pipeline; run parity checks against 1997 scenario behavior.

## Change confirmation for this phase

- **Code files modified:** none.
- **Documentation files modified:** `docs/1997-scenario-hardcoding-audit.md` only.
- **This phase is documentation-only.**
