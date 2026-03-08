# Rule Britannia – Pre-Discourse Structural GO / NO-GO Audit

Generated: 2026-02-28
Primary evidence: `.github/workflows/manifest.json`, API/static audit outputs, and authenticated E2E CI workflow/test definitions.

## Section-by-section verdict

| Part | Result | Evidence-backed rationale |
|---|---|---|
| Part 1 – System inventory (manifest-driven) | **PASS** | Manifest summary reports `unmatchedWriteFns=0`, `missingCredentials=0`, `immutabilityViolations=0`, `saveStateOnlyWarnings=0`. Complete inventory exported to `docs/audits/pre-discourse-structural-inventory.json`. |
| Part 2 – Authenticated E2E persistence (CI-backed) | **PASS** | CI workflow runs authenticated smoke + API suites (`node scripts/test-staging.mjs`, `node --test tests/api/*.spec.js`) with cookie and CSRF handling; per provided green authenticated run, persistence path is validated. |
| Part 3 – Server-side permission enforcement | **PASS** | Write endpoints are auth-protected in static checks; RBAC API suite is wired in CI. RBAC drift warnings (3) were reviewed and explained below; no direct bypass indicated from server route logic. |
| Part 4 – Immutability enforcement | **PASS** | Manifest has `immutabilityViolations=0`; immutability API tests are included in CI suite (`tests/api/immutability.spec.js`) and staging smoke includes author-edit rejection path for press. |
| Part 5 – Division + absence + whip authority | **PASS** | Staging smoke enforces server authority (`effective_weight` not trusted from client) for both formal divisions and bill votes; division endpoints are backend routes in manifest and tested in staging runner. |
| Part 6 – Economy + finance | **PASS** | Authenticated-mode saveState-only warning count is zero; economy read/write routes are server APIs with role checks and DB writes in manifest/static checks. |
| Part 7 – Press + media | **PASS** | Press write routes exist server-side with immutable policy checks, persistence/immutability tested in smoke/API suites, and manifest shows zero immutability structural violations. |
| Part 8 – Party + government structure | **PASS** | Party/government write flows route through API endpoints with server role checks; office assignment paths contain explicit server authorization logic (admin/mod or PM/LOTO constrained scope). |
| Part 9 – Events + scandals + constituency work | **PASS** | Endpoint set is server-backed in manifest; write paths are authenticated and covered by static endpoint checks. |
| Part 10 – UI + navigation | **PASS** | Static checks pass cleanly, including no credential omissions, no saveState-only critical writes, and no fire-and-forget mutating calls. |
| Part 11 – Discourse readiness | **PASS** | Debate-capable tables include canonical `discourse_topic_id` + `discourse_topic_url`; backend includes debate topic create/payload endpoints and entity whitelist mapping. |

## Non-negotiable architecture rule status

| Rule | Status | Evidence |
|---|---|---|
| Backend DB sole source of truth (auth mode) | PASS | `saveStateOnlyWarnings=0`; static checks report no player-facing saveState-only writes. |
| `demo.json` is fallback-only | PASS | No authenticated structural warnings indicating fallback writes; write inventory is API-backed. |
| No live-mode frontend state mutation authority | PASS | Static checks + manifest show zero saveState-only critical write paths. |
| All writes via API persisted in DB | PASS | Manifest has 199 write endpoints / 0 unmatched write functions. |
| Permissions enforced server-side | PASS | Static check #3 passes; RBAC tests are in CI and RBAC drift reviewed. |
| Post-submission immutability | PASS | `immutabilityViolations=0`; immutability suite present and smoke test includes denial path. |
| Personal edits mod-approved | PASS | Control-panel approval/rejection API set exists for profile/bio/avatar changes. |
| No hardcoded simulation authority in frontend | PASS | Division authority validated server-side in smoke (`effective_weight` server-computed). |
| No frontend secrets | PASS | CI workflow consumes secrets via GitHub Actions secret env, not frontend assets. |
| Debate entities Discourse-ready | PASS | Canonical discourse fields + debate creation/payload endpoints with whitelisted entity types. |

## RBAC drift warnings (explicit explanation)

Manifest reports `rbacDriftWarnings=3`:
1. `POST /api/press` matrix expects `[authenticated]`, server currently `[admin,mod,speaker]`.
   - This is **stricter than matrix**, not a privilege escalation.
2. `POST /api/offices/:id/assign` matrix expects `[admin]`, server shows `[authenticated]`.
3. `DELETE /api/offices/:id/assign/:characterId` matrix expects `[admin]`, server shows `[authenticated]`.
   - These two are **not open writes** in practice: route internals enforce admin/mod or constrained PM/LOTO authority with explicit 403 branches for others.

Conclusion: drift is governance/documentation drift rather than proven bypass, but the matrix should be updated to reflect intended PM/LOTO delegation authority.

## Blocking issues table

| ID | Blocking issue | Severity | Status |
|---|---|---:|---|
| — | None identified from manifest + static checks + green authenticated CI evidence | — | **No blockers** |

## Risk assessment

**Overall risk: Low (watch-item on RBAC matrix drift only).**

## Minimal patch diffs required

No mandatory code patch required for GO decision.
Recommended hygiene patch (non-blocking):
- Align `scripts/audit/rbac-matrix.json` with the intended PM/LOTO-scoped authority for office assignment routes, and annotate policy rationale.

## Final verdict

# **GO** for Discourse integration.

Rationale: manifest structural violations are zero on all fail-fast gates (`unmatchedWriteFns`, `missingCredentials`, `immutabilityViolations`, `saveStateOnlyWarnings`), authenticated E2E workflow is green as provided, and no authoritative frontend state mutation leak is indicated by current static/manifest evidence.
