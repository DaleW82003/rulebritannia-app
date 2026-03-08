# Alpha Readiness Audit Report

## 1. Executive Summary

The repository is **substantially advanced** and already includes strong server-authoritative patterns across parliamentary, faction/political-state, and finance systems. The core political simulation can run, and key pathways are mostly wired end-to-end through DB tables + API routes + frontend API clients.

However, this audit finds the project is **not yet fully alpha-ready without cautions** due to architectural dual-state complexity (snapshot + relational), uneven guard patterns in some staff/political workflows, and limited integration-test coverage for newer political-state and faction mechanics.

**Readiness level:** High beta-hardening quality, but with pre-alpha blockers still present (listed in Section 8).

---

## 2. Architecture Health

### DB/API-backed assessment

- The codebase clearly uses PostgreSQL as primary persistence for bills, divisions, finance, factions, and political state, with corresponding API routes for reads/writes and server-side calculations. 
- Political-state and faction systems are persisted in dedicated relational tables (`party_factions`, `party_faction_allocations`, `faction_political_state`, `character_political_state`) and computed server-side.

### Remaining save-state/snapshot/app_state concerns

- The app still retains a **parallel snapshot architecture** (`state_snapshots`, `app_state_current`) with `/api/state` and import/export snapshot routes.
- This coexists with relational object tables and requires sync/rebuild flows. This is functional but raises drift risk and operational complexity during fast feature expansion.
- This is the largest architectural friction point for adding tightly coupled Economy/Budget/Polling systems.

### Server/client responsibility split

- Critical authority (division tally, vote weighting, political pressure/capital computation, faction climate effects) is server-owned.
- Frontend mainly consumes APIs via `js/api.js`, which is consistent with target architecture.

### Consistency of implementation patterns

- RBAC is broadly consistent (`requireAuth`, `requireAdmin`, `requireAdminOrMod`, `requireAdminModOrSpeaker`) and used widely.
- Some endpoint-level policy checks are still hand-rolled and differ by feature area; this increases drift risk.

---

## 3. System-by-System Findings

### Parliamentary systems (bills, amendments, divisions, voting, whips, rebellions)

**What is solid**
- Amendments are persisted in dedicated tables and exposed via bill amendment APIs.
- Divisions have robust lifecycle handling and immutable results on close.
- Voting weight is server-computed from authoritative seat/state context.
- Party instructions, rebel requests, and rebellion logs are implemented server-side.

**Findings**
- Amendment decision authority currently checks bill authorship by character name equality rather than immutable character id in one path, which is fragile.
- Rebellion logging previously allowed stale/multiple records from vote changes; this audit pass fixed it by normalising to one active rebellion record per `(division, character)`.
- Party-instruction and rebel-request workflows now block against closed divisions (fixed in this pass).

### Political state systems (capital, pressure, character political state)

**What is solid**
- Core political pressure and capital are server-computed and persisted.
- Recompute hooks trigger from major events (division vote, rebel request submit/decision, scandal flows, office assignment changes).

**Findings**
- Recompute is frequently non-blocking/asynchronous. This helps latency but can temporarily surface stale values immediately after mutations.
- There is no end-to-end test coverage validating recompute correctness across multiple chained flows.

### Faction system

**What is solid**
- Factions, allocations, climate, and party-facing/admin-facing APIs are present.
- Allocation guard prevents active allocations exceeding party constituency MP totals.

**Findings**
- Faction slug normalisation allowed edge-case malformed slugs (tightened in this pass).
- Faction management remains restricted to playable-party set, which is good for alpha control.

### Personal finances

**What is solid**
- Personal finance model includes DB-backed config (`finance_config`), salary bands, starting balances, and derived property finance computation server-side.
- Owner/admin pathways are separated (`/api/me/finance` vs admin character finance routes).

**Findings**
- Finance calculations are centralised server-side, but due to monolithic server file size, maintainability and accidental coupling risks are high.

### Party finances

**What is solid**
- Party treasury/financial fields are DB-backed and integrated with party-level APIs.

**Findings**
- Party and personal finance concerns are in the same broad server module; service/module extraction would reduce regression risk for economy/budget expansion.

### Character pathways

**What is solid**
- Character-specific state, division voting, amendment participation, scandal/political-state updates, and finance visibility are connected through API-first flows.

**Findings**
- Some authority checks still rely on mutable descriptive fields (name/party strings) in selected pathways rather than immutable IDs/slugs.

### Party pathways

**What is solid**
- Party page-related APIs exist for factions, whip systems, leadership controls, and party-specific tools.

**Findings**
- Policy rules differ slightly by endpoint (leader/chief-whip fallback logic, staff override variants), requiring clearer shared guard helpers.

### Staff/mod/admin systems

**What is solid**
- Staff and admin capability surface is broad and mostly RBAC-protected.
- Maintenance routes, approval workflows, and control-panel style endpoints are present.

**Findings**
- Staff permissions include snapshot import/export + rebuild mechanisms that are operationally powerful and should be governed tightly in alpha operations.

### Speaker NPC system

**What is solid**
- Speaker is recognised as a distinct privileged role and included in relevant parliamentary/staff actions.

**Findings**
- Speaker permissions are mostly coherent; however, because several checks are inline and route-specific, there is drift risk if new staff features are added rapidly.

---

## 4. Duplication and Code Quality Issues

- `server/index.js` centralises schema bootstrapping, business logic, and route handlers in a very large single file, creating coupling and review burden.
- Dual architecture (snapshot + relational tables) duplicates state responsibilities and requires sync/rebuild pathways.
- Guard logic is duplicated across many routes with slight behavioural variation.
- Frontend API wrapper layer is mostly consistent, but system growth is making route-surface management harder without stronger modular boundaries.

---

## 5. Broken, Fragile, or Incomplete Features

| Issue | Severity | Status |
|---|---|---|
| Rebellion log could accumulate stale/multiple entries when MPs changed vote, skewing pressure calculations | High | **Fixed in this audit pass** |
| Party instruction mutation against closed divisions not blocked | Medium | **Fixed in this audit pass** |
| Rebel request submit/decide against closed divisions not blocked | Medium | **Fixed in this audit pass** |
| Faction slug canonicalisation permitted malformed slugs in edge cases | Low | **Fixed in this audit pass** |
| Amendment decision authority compares author by name string in one flow | Medium | Outstanding |
| Snapshot+relational dual-source model increases drift and integration complexity | High | Outstanding (architectural) |

---

## 6. Security and Permissions Review

### Positive
- Core mutating routes are authenticated.
- Staff-only pathways are generally enforced.
- Division creation/closure and NPC vote overrides are staff-gated.
- Rebel-request decisions are restricted to chief whip / party leader fallback / staff.

### Risks / drift points
- Inconsistent guard composition across endpoints (some use helper functions, some inline checks).
- Authority checks based on display attributes (e.g., names) in selected parliamentary paths should be replaced with immutable IDs.
- Powerful maintenance/snapshot endpoints are correctly restricted but remain high-impact operations requiring operational controls.

---

## 7. Performance and Stability Risks

- **Monolithic handler file** increases cognitive load and regression risk under alpha velocity.
- Snapshot/object-table sync pathways can become expensive and drift-prone as data grows.
- Non-blocking recompute hooks may lead to short-lived read-after-write inconsistency for political state.
- Some route handlers perform multi-query orchestration without shared service-layer abstractions, making optimisation difficult.

---

## 8. Alpha Blocking Issues

1. **Parallel authoritative state model (snapshot + relational)** should be constrained with explicit ownership rules before opening to broad alpha users.
2. **Author identity comparison by mutable name** in amendment decision flow should be migrated to immutable character-id based ownership checks.
3. **Lack of targeted end-to-end tests** for political-state/faction/division integrations leaves high-risk regressions undetected.

---

## 9. Non-Blocking Tightening Recommendations

1. Extract modular service layers for divisions, parliamentary amendments, political-state recompute, and finance.
2. Introduce shared RBAC guard helpers for party-leader/chief-whip/staff patterns.
3. Add integration tests for:
   - amendment submit → support/decision → division close → political pressure updates
   - faction allocation change → faction climate response → party/character political state reads
   - finance mutation → recompute/read consistency
4. Add observability for recompute lag/failures (queue depth or retry counters if async hooks grow).

---

## 10. Fixes Applied During Audit

1. Hardened faction slug normalisation to trim/canonicalise and reject invalid slugs.
2. Added closed-division guards for:
   - party instruction set endpoint
   - rebel request submission endpoint
   - rebel request decision endpoint
3. Normalised rebellion logging during vote updates by deleting stale rebellion entries before insert, preventing duplicate/stale pressure contributions.

---

## 11. Final Alpha Verdict

## **Not yet ready for Alpha**

The simulation layer is close, and many systems are well implemented, but architectural dual-state complexity plus remaining authority/integration hardening items create avoidable risk for first real-user alpha. Fixing the blocker list first will materially reduce instability before Economy/Budget/Polling expansion.
