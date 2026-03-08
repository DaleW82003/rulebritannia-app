# Rule Britannia GO/NO-GO Audit (Pre-Discourse)

> **Historical audit — issues resolved.** This audit was generated on 2026-02-26 and returned a NO-GO verdict due to four blocking issues (B1–B4). All four issues have since been resolved. See [`AUDIT_FIX_SUMMARY.md`](../AUDIT_FIX_SUMMARY.md) for the fixes applied and [`docs/dev-guide.md §13`](dev-guide.md) for current security status.

_Generated: 2026-02-26T00:27:38.478481Z_

## Executive Verdict
- **Final verdict: NO-GO** (critical validation gaps + architectural rule violations).
- Dynamic authenticated persistence/RBAC/immutability test matrix was **not executable in this environment** (no BASE_URL + no role-session cookies), so required non-negotiable proof is missing.
- Frontend still contains state mutation paths and simulation math, conflicting with the stated backend-SoT + no-frontend-logic constraints.

## Section Results (PASS/FAIL)
| Section | Result | Notes |
|---|---|---|
| Part 1 – System Inventory | **PASS** | Repository/static inventory complete via code scan. |
| Part 2 – End-to-End Persistence Testing | **FAIL** | Automated API persistence tests skipped without BASE_URL/session cookies; cannot verify create→refresh→logout→login persistence. |
| Part 3 – Permission Enforcement Test | **FAIL** | RBAC test suite skipped (missing live target + role cookies); cannot prove 401/403 enforcement for all requested roles/routes. |
| Part 4 – Immutability Audit | **FAIL** | Immutability spec skipped in this run; static checks pass for key parliament endpoints but no live proof for all entities. |
| Part 5 – Division + Absence + Whip Integration | **FAIL** | Vote weighting + delegation implemented client-side (`js/divisions.js`), violating no-hardcoded-frontend-logic rule. |
| Part 6 – Economy + Finance Consistency | **FAIL** | Core state writes for non-staff can remain local (`localStorage`) via `saveState`, conflicting with DB-only source-of-truth rule. |
| Part 7 – Press + Media System | **FAIL** | No live persistence/immutability execution evidence for all press/media flows in this environment. |
| Part 8 – Party + Government Structure | **FAIL** | No full role-matrix execution evidence (all required actor roles/routes not tested live). |
| Part 9 – Events + Scandals + Constituency Work | **FAIL** | No live end-to-end execution evidence; cannot certify cooldown/outcome persistence under auth. |
| Part 10 – Navigation + UI Integrity | **FAIL** | No full browser crawl or console-scan run for every page in this audit pass. |
| Part 11 – Discourse Readiness Check | **FAIL** | Structural placeholders appear present in backend docs/code, but blocking test gaps prevent GO certification. |

## Blocking Issues
| ID | Severity | Evidence | Impact | Minimal patch required |
|---|---|---|---|---|
| B1 | Critical | `tests/api/*.spec.js` all report skipped when `BASE_URL` is unset. | Mandatory persistence/RBAC/immutability proof absent. | Run test suites against staging with authenticated cookies for all required roles; archive results in CI artifacts. |
| B2 | Critical | `js/core.js` `saveState` persists local state for authenticated non-staff users. | Violates “DB sole source of truth in authenticated mode” and “no live-mode frontend mutation”. | Remove local-only write path; route all writes through API and enforce server authorization. |
| B3 | High | `js/divisions.js` performs weighting/delegation/tally logic client-side. | Violates “no hardcoded simulation logic in frontend”; risk of drift/tampering. | Move authoritative division math/delegation to backend endpoint; frontend should render server-computed outcomes only. |
| B4 | High | Manifest reports unmatched dynamic API functions and saveState-only warnings (`scripts/audit/feature-manifest.js --json`). | Audit blind spots; potential route drift or write bypass risks. | Improve route matcher for parameterized endpoints; resolve or suppress each warning with explicit justification/tests. |

## Minimal Patch Diffs Required (Pre-GO)
1. **State authority hardening**: delete localStorage fallback mutation behavior for authenticated players; use backend round-trip for every write.
2. **Server-side simulation authority**: implement division/whip/absence calculations in API layer; return immutable recorded results.
3. **Comprehensive RBAC E2E suite**: execute write-route matrix for backbencher/minister/party-leader/chief-whip/speaker/mod/admin.
4. **Immutability enforcement tests**: explicit PATCH/PUT denial tests after submission for bills/motions/regulations/statements/press/amendments/divisions/EDM signatures.
5. **Discourse field contract**: ensure debate entities include stable `id`, `slug`, `author_role`, `submitted_at`, `stage`, and nullable `discourse_topic_id/thread_url` in API payload contracts.

## Risk Assessment
- **Overall risk: CRITICAL**.
- Reason: missing live proof for core non-negotiables plus architecture-level frontend authority leakage.

## Inventory
- HTML pages: **50**
- JS modules: **66**
- API routes: **225**
- DB tables: **14**

### HTML pages
- `admin-panel.html`
- `bill.html`
- `bodies.html`
- `budget.html`
- `cabinet.html`
- `civilservice.html`
- `community-rules.html`
- `constituencies.html`
- `constituency-work.html`
- `control-panel.html`
- `dashboard.html`
- `debates.html`
- `economy.html`
- `elections.html`
- `events.html`
- `fundraising.html`
- `government.html`
- `guides.html`
- `hansard.html`
- `index.html`
- `locals.html`
- `login.html`
- `motion.html`
- `motions.html`
- `news.html`
- `online.html`
- `opposition.html`
- `papers.html`
- `party.html`
- `personal.html`
- `playerbase.html`
- `polling.html`
- `press.html`
- `privacy.html`
- `profile.html`
- `questiontime.html`
- `redlion.html`
- `register.html`
- `regulation.html`
- `regulations.html`
- `report.html`
- `rules.html`
- `shadowcabinet.html`
- `statement.html`
- `statements.html`
- `submit-bill.html`
- `team.html`
- `terms.html`
- `user.html`
- `verify-email.html`

### JS modules
- `js/api.js`
- `js/audit.js`
- `js/auth.js`
- `js/bill-drafting.js`
- `js/clock.js`
- `js/components/form-row.js`
- `js/components/modal.js`
- `js/components/tile.js`
- `js/components/toast.js`
- `js/core.js`
- `js/divisions.js`
- `js/engines/control-panel-engine.js`
- `js/engines/core-engine.js`
- `js/engines/division-engine.js`
- `js/engines/permission-engine.js`
- `js/errors.js`
- `js/main.js`
- `js/pages/admin-panel.js`
- `js/pages/bill.js`
- `js/pages/bodies.js`
- `js/pages/budget.js`
- `js/pages/cabinet.js`
- `js/pages/civilservice.js`
- `js/pages/constituencies.js`
- `js/pages/constituency-work.js`
- `js/pages/control-panel.js`
- `js/pages/dashboard.js`
- `js/pages/debates.js`
- `js/pages/economy.js`
- `js/pages/elections.js`
- `js/pages/events.js`
- `js/pages/fundraising.js`
- `js/pages/government.js`
- `js/pages/guides.js`
- `js/pages/hansard.js`
- `js/pages/landing.js`
- `js/pages/locals.js`
- `js/pages/login.js`
- `js/pages/motion.js`
- `js/pages/motions.js`
- `js/pages/news.js`
- `js/pages/online.js`
- `js/pages/opposition.js`
- `js/pages/papers.js`
- `js/pages/party.js`
- `js/pages/personal.js`
- `js/pages/playerbase.js`
- `js/pages/polling.js`
- `js/pages/press.js`
- `js/pages/profile.js`
- `js/pages/questiontime.js`
- `js/pages/redlion.js`
- `js/pages/register.js`
- `js/pages/regulation.js`
- `js/pages/regulations.js`
- `js/pages/rules.js`
- `js/pages/shadowcabinet.js`
- `js/pages/statement.js`
- `js/pages/statements.js`
- `js/pages/submit-bill.js`
- `js/pages/team.js`
- `js/pages/user.js`
- `js/pages/verify-email.js`
- `js/parties.js`
- `js/permissions.js`
- `js/ui.js`

### API routes (method path [roles])
- `GET /health [public]`
- `GET /api/permissions [public]`
- `POST /api/register [public]`
- `GET /api/auth/verify-email [public]`
- `POST /api/auth/resend-verification [public]`
- `GET /api/admin/registrations [admin]`
- `POST /api/admin/registrations/:id/approve [admin]`
- `POST /api/admin/registrations/:id/reject [admin]`
- `GET /api/state [authenticated]`
- `POST /api/state [admin,mod,speaker]`
- `GET /api/snapshots [admin]`
- `POST /api/snapshots [admin]`
- `POST /api/snapshots/:id/restore [admin]`
- `GET /api/config [public]`
- `PUT /api/config [admin]`
- `GET /api/discourse/config [admin]`
- `PUT /api/discourse/config [admin]`
- `POST /api/discourse/test [admin]`
- `GET /api/discourse/sso [public]`
- `GET /api/discourse/sso/callback [public]`
- `GET /api/admin/sso-readiness [admin]`
- `POST /api/audit-log [authenticated]`
- `GET /api/audit-log [admin]`
- `GET /api/bills [authenticated]`
- `GET /api/bills/:id [authenticated]`
- `POST /api/bills [authenticated]`
- `PUT /api/bills/:id [admin,mod]`
- `DELETE /api/bills/:id [admin,mod,speaker]`
- `GET /api/motions [authenticated]`
- `GET /api/motions/:id [authenticated]`
- `POST /api/motions [authenticated]`
- `PUT /api/motions/:id [admin,mod]`
- `DELETE /api/motions/:id [admin,mod,speaker]`
- `GET /api/statements [authenticated]`
- `GET /api/statements/:id [authenticated]`
- `POST /api/statements [authenticated]`
- `PUT /api/statements/:id [admin,mod]`
- `DELETE /api/statements/:id [admin,mod,speaker]`
- `GET /api/regulations [authenticated]`
- `GET /api/regulations/:id [authenticated]`
- `POST /api/regulations [authenticated]`
- `PUT /api/regulations/:id [admin,mod]`
- `DELETE /api/regulations/:id [admin,mod,speaker]`
- `GET /api/questiontime-questions [authenticated]`
- `GET /api/questiontime-questions/:id [authenticated]`
- `POST /api/questiontime-questions [authenticated]`
- `PUT /api/questiontime-questions/:id [admin,mod]`
- `DELETE /api/questiontime-questions/:id [admin,mod]`
- `GET /api/clock [public]`
- `POST /api/clock/tick [admin]`
- `POST /api/clock/set [admin]`
- `GET /api/press [public]`
- `GET /api/press/:id [public]`
- `POST /api/press [authenticated]`
- `PUT /api/press/:id [admin,mod]`
- `DELETE /api/press/:id [admin,mod]`
- `PATCH /api/press/:id/transcript [authenticated]`
- `GET /api/polling [public]`
- `GET /api/polling/:id [public]`
- `POST /api/polling [admin,mod]`
- `PUT /api/polling/:id [admin,mod]`
- `DELETE /api/polling/:id [admin,mod]`
- `POST /api/debates/create [admin,mod]`
- `GET /api/debates/payload/:entityType/:entityId [authenticated]`
- `GET /api/me/roles [authenticated]`
- `POST /api/users/:id/roles [admin]`
- `GET /api/admin/discourse-sync-preview [admin]`
- `POST /api/admin/discourse-sync-groups [admin]`
- `GET /api/bootstrap [authenticated]`
- `POST /api/admin/clear-cache [admin]`
- `POST /api/admin/rebuild-cache [admin]`
- `POST /api/admin/rotate-sessions [admin]`
- `POST /api/admin/force-logout-all [admin]`
- `GET /api/admin/export-snapshot [admin]`
- `POST /api/admin/import-snapshot [admin]`
- `GET /api/characters [authenticated]`
- `GET /api/characters/mine [authenticated]`
- `GET /api/characters/:id [authenticated]`
- `POST /api/characters [admin]`
- `PATCH /api/characters/:id [admin]`
- `POST /api/admin/characters/:id/profile [admin,mod,speaker]`
- `POST /api/characters/select [authenticated]`
- `POST /api/characters/apply [authenticated]`
- `GET /api/characters/applications/mine [authenticated]`
- `GET /api/admin/characters/applications [admin,mod]`
- `POST /api/admin/characters/applications/:id/approve [admin,mod]`
- `POST /api/admin/characters/applications/:id/reject [admin,mod]`
- `POST /api/admin/characters/:id/set-inactive [admin,mod]`
- `POST /api/admin/repair/character-owner-pointers [admin,mod]`
- `POST /api/characters/bio-change [authenticated]`
- `GET /api/characters/bio-changes/mine [authenticated]`
- `GET /api/admin/bio-changes [admin,mod,speaker]`
- `POST /api/admin/bio-changes/:id/approve [admin,mod,speaker]`
- `POST /api/admin/bio-changes/:id/reject [admin,mod,speaker]`
- `POST /api/characters/avatar-change [authenticated]`
- `GET /api/characters/avatar-changes/mine [authenticated]`
- `GET /api/admin/avatar-changes [admin,mod,speaker]`
- `POST /api/admin/avatar-changes/:id/approve [admin,mod,speaker]`
- `POST /api/admin/avatar-changes/:id/reject [admin,mod,speaker]`
- `POST /api/mod/property/set [admin,mod]`
- `GET /api/parties/canonical [authenticated]`
- `GET /api/parties/:partyId [authenticated]`
- `POST /api/parties/:partyId/leadership [authenticated]`
- `POST /api/parties/:partyId/chief-whip [authenticated]`
- `GET /api/shop/price-index [authenticated]`
- `POST /api/shop/apply-inflation [admin,mod]`
- `POST /api/finance/shop-upkeep [authenticated]`
- `GET /api/me/finance [authenticated]`
- `POST /api/characters/profile-change [authenticated]`
- `GET /api/characters/profile-changes/mine [authenticated]`
- `GET /api/admin/profile-changes [admin,mod,speaker]`
- `POST /api/admin/profile-changes/:id/approve [admin,mod,speaker]`
- `POST /api/admin/profile-changes/:id/reject [admin,mod,speaker]`
- `POST /api/me/character/shop-purchases [authenticated]`
- `DELETE /api/me/character/shop-purchases/:id [authenticated]`
- `POST /api/me/character/additional-revenue [admin,mod,speaker]`
- `DELETE /api/me/character/additional-revenue/:id [admin,mod,speaker]`
- `GET /api/parties/:partyId/structure [authenticated]`
- `POST /api/parties/:partyId/structure [authenticated]`
- `POST /api/parties/:partyId/treasury [authenticated]`
- `GET /api/parties/:partyId/shop-purchases [authenticated]`
- `POST /api/parties/:partyId/shop-purchases [authenticated]`
- `DELETE /api/parties/:partyId/shop-purchases/:id [authenticated]`
- `POST /api/parties/:partyId/drafts [authenticated]`
- `GET /api/me/work-plan [authenticated]`
- `POST /api/me/work-plan [authenticated]`
- `GET /api/offices [authenticated]`
- `POST /api/offices [admin]`
- `POST /api/offices/:id/assign [admin]`
- `DELETE /api/offices/:id/assign/:characterId [admin]`
- `GET /api/divisions [authenticated]`
- `GET /api/divisions/:id [authenticated]`
- `POST /api/divisions/create [authenticated]`
- `GET /api/divisions/for-entity/:entityType/:entityId [authenticated]`
- `POST /api/divisions/:id/vote [authenticated]`
- `POST /api/divisions/:id/close [authenticated]`
- `PATCH /api/divisions/:id/npc-votes [authenticated]`
- `POST /api/divisions/:divisionId/party-instruction [authenticated]`
- `GET /api/divisions/:divisionId/party-instruction/:partySlug [authenticated]`
- `POST /api/divisions/:divisionId/rebel-request [authenticated]`
- `GET /api/divisions/:divisionId/rebel-request [authenticated]`
- `POST /api/divisions/:divisionId/rebel-request/:requestId/decide [authenticated]`
- `GET /api/qt/questions [authenticated]`
- `GET /api/qt/questions/:id [authenticated]`
- `POST /api/qt/questions [authenticated]`
- `PATCH /api/qt/questions/:id [admin]`
- `POST /api/qt/questions/:id/answer [authenticated]`
- `POST /api/qt/questions/:id/followup [authenticated]`
- `GET /api/sim [authenticated]`
- `POST /api/sim/tick [admin]`
- `POST /api/sim/set [admin]`
- `PATCH /api/bills/:id [admin,mod]`
- `POST /api/admin/discourse-sync-bills [admin]`
- `POST /api/admin/wipe-content [admin]`
- `POST /api/admin/seed-demo [public]`
- `POST /api/admin/seed [public]`
- `GET /api/admin/dashboard [admin]`
- `GET /api/scandals/mine [authenticated]`
- `POST /api/scandals/optin [authenticated]`
- `POST /api/scandals/situations/:id/respond [authenticated]`
- `POST /api/scandals/:id/choose [authenticated]`
- `GET /api/mod/scandal-templates [admin,mod]`
- `GET /api/mod/scandals/opted-in-characters [admin,mod]`
- `POST /api/mod/scandal-templates [admin,mod]`
- `POST /api/mod/scandals/situations/create [admin,mod]`
- `GET /api/mod/scandals/open [admin,mod]`
- `POST /api/mod/scandals/:id/decision [admin,mod]`
- `POST /api/mod/scandals/:id/close [admin,mod]`
- `GET /api/elections/seat-totals [authenticated]`
- `GET /api/elections/current [authenticated]`
- `GET /api/elections [authenticated]`
- `POST /api/elections [admin,mod]`
- `PUT /api/elections/:id [admin,mod]`
- `GET /api/elections/:id/changes [authenticated]`
- `PUT /api/elections/:id/changes [admin,mod]`
- `POST /api/elections/:id/finalize [admin,mod]`
- `POST /api/admin/elections/seed-1997 [admin,mod]`
- `GET /api/elections/bodies/current [authenticated]`
- `GET /api/elections/bodies/archive [authenticated]`
- `POST /api/elections/bodies [admin,mod]`
- `GET /api/constituencies/:id/events [authenticated]`
- `GET /api/constituencies [authenticated]`
- `POST /api/constituencies [admin,mod,speaker]`
- `PUT /api/constituencies/:id [admin,mod,speaker]`
- `DELETE /api/constituencies/:id [admin,mod,speaker]`
- `POST /api/admin/constituencies/initialize-1997 [admin,mod,speaker]`
- `DELETE /api/admin/constituencies/clear [admin]`
- `GET /api/parliament/status [authenticated]`
- `PUT /api/parliament/status [admin,mod,speaker]`
- `GET /api/budget [authenticated]`
- `POST /api/admin/budget/seed [admin]`
- `PUT /api/admin/budget/controls [admin]`
- `POST /api/budget/draft [admin,mod]`
- `POST /api/admin/budget/approve [admin]`
- `POST /api/admin/budget/reject [admin]`
- `GET /api/team [authenticated]`
- `GET /api/profile [authenticated]`
- `GET /api/me/character/:id/affiliations [authenticated]`
- `POST /api/me/character/:id/affiliations [authenticated]`
- `GET /api/control-panel/affiliations/pending [admin,mod,speaker]`
- `POST /api/control-panel/affiliations/:rid/decide [admin,mod,speaker]`
- `GET /api/admin/users [admin]`
- `GET /api/admin/characters [admin]`
- `POST /api/admin/characters/:id/assign-owner [admin]`
- `POST /api/admin/users/:id/active-character [admin]`
- `POST /api/admin/reset-baseline [admin]`
- `GET /api/admin/playerbase [admin,mod,speaker]`
- `POST /api/admin/finance/set-bank [admin,mod,speaker]`
- `POST /api/admin/finance/set-salary-override [admin,mod,speaker]`
- `POST /api/admin/finance/set-positions [admin,mod,speaker]`
- `POST /api/admin/finance/revenue [admin,mod,speaker]`
- `PATCH /api/admin/finance/revenue/:id [admin,mod,speaker]`
- `DELETE /api/admin/finance/revenue/:id [admin,mod,speaker]`
- `POST /api/admin/salary-scales/uprate [admin,mod,speaker]`
- `GET /api/redlion [authenticated]`
- `POST /api/redlion [authenticated]`
- `DELETE /api/redlion/:id [admin,mod]`
- `GET /api/events [authenticated]`
- `POST /api/events [authenticated]`
- `PUT /api/events/:id [authenticated]`
- `GET /api/online [authenticated]`
- `POST /api/online [authenticated]`
- `GET /api/fundraising [authenticated]`
- `POST /api/fundraising [authenticated]`
- `PUT /api/fundraising/:id [authenticated]`

### DB tables
- `app_state`
- `state_snapshots`
- `app_state_current`
- `bills`
- `motions`
- `statements`
- `regulations`
- `questiontime_questions`
- `press_items`
- `polling_entries`
- `sim_clock`
- `user_roles`
- `audit_log`
- `pending_registrations`

### Role definitions (canonical)

### Entity types (route-derived)
- `admin`
- `audit-log`
- `auth`
- `bills`
- `bootstrap`
- `budget`
- `characters`
- `clock`
- `config`
- `constituencies`
- `control-panel`
- `debates`
- `discourse`
- `divisions`
- `elections`
- `events`
- `finance`
- `fundraising`
- `me`
- `mod`
- `motions`
- `offices`
- `online`
- `parliament`
- `parties`
- `permissions`
- `polling`
- `press`
- `profile`
- `qt`
- `questiontime-questions`
- `redlion`
- `register`
- `regulations`
- `scandals`
- `shop`
- `sim`
- `snapshots`
- `state`
- `statements`
- `team`
- `users`

## Feature → API → DB → UI dependency graph (sample high-risk paths)
- Bill submission → `POST /api/bills` → `bills` → `submit-bill.html` + `js/pages/submit-bill.js`
- Motion submission → `POST /api/motions` → `motions` → `motions.html` + `js/pages/motions.js`
- Regulation submission → `POST /api/regulations` → `regulations` → `regulations.html` + `js/pages/regulations.js`
- Statement submission → `POST /api/statements` → `statements` → `statements.html` + `js/pages/statements.js`
- QT question submission → `POST /api/qt/questions` → `questiontime_questions` → `questiontime.html` + `js/pages/questiontime.js`
- Press publication → `POST /api/press` → `press_items` → `press.html` + `js/pages/press.js`
- Global state admin save → `POST /api/state` → `app_state`/`app_state_current` → `admin-panel.html` + `js/pages/admin-panel.js`

## Final GO/NO-GO
**NO-GO for Discourse integration** until blocking issues B1–B4 are remediated and full authenticated E2E evidence is captured.
