# Rule Britannia – Developer Handbook

> **Audience:** Developers joining the project. This document describes the system at an architectural and implementation level, not as an end-user feature guide.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture Diagram (Textual)](#2-architecture-diagram-textual)
3. [Backend Architecture](#3-backend-architecture)
4. [Frontend Interaction Model](#4-frontend-interaction-model)
5. [Simulation Systems](#5-simulation-systems)
6. [Data Model](#6-data-model)
7. [Worker Process](#7-worker-process)
8. [Authentication & Permissions](#8-authentication--permissions)
9. [Discourse Integration](#9-discourse-integration)
10. [Scripts and Tooling](#10-scripts-and-tooling)
11. [Testing](#11-testing)
12. [Development Workflow](#12-development-workflow)
13. [Security & Hardening](#13-security--hardening)
14. [Operational Notes](#14-operational-notes)
15. [Known Limitations](#15-known-limitations)
16. [Future Development Areas](#16-future-development-areas)

---

## 1. System Overview

> For the full system map including architecture diagram, component table, data flow, roles, and background tasks, see **[`docs/system-overview.md`](system-overview.md)**.

Rule Britannia is a browser-based UK parliamentary political simulation set in 1997. The system has four main runtime components: the Express API server (`server/`), the static browser UI (`*.html` + `js/`), the Cloudflare Worker edge proxy (`worker/index.js`), and the Cloudflare Pages Function fallback proxy (`functions/api/[[path]].js`).

---

## 2. Architecture Diagram (Textual)

> A detailed architecture diagram is in **[`docs/system-overview.md §3`](system-overview.md)** and **[`docs/architecture.md`](architecture.md)**. The diagram below is a concise developer reference.

```
┌──────────────────────────────────────────────────────────┐
│                     Browser (Player)                     │
│  *.html pages + js/* modules                             │
│  No simulation logic: all reads/writes go to /api/*      │
└──────────────────┬───────────────────────────────────────┘
                   │  HTTPS /api/*
                   ▼
┌──────────────────────────────────────────────────────────┐
│               Cloudflare Edge                            │
│  rulebritannia.org/api/*  → Cloudflare Worker            │
│  www.rulebritannia.org/api/* → Pages Function            │
│  Both forward to the Render backend unchanged            │
└──────────────────┬───────────────────────────────────────┘
                   │  HTTP proxy (credentials forwarded)
                   ▼
┌──────────────────────────────────────────────────────────┐
│              Express API Server  (Render)                │
│  server/index.js  — ~422 routes                         │
│  server/db.js     — pg Pool (Neon / Postgres)            │
│  server/clock.js  — sim-date calculation                 │
│  server/discourse.js  — Discourse API client (full)      │
│  server/discourseClient.js — Discourse client (focused)  │
│  server/roles.js  — role constants + permission map      │
└──────────────────┬───────────────────────────────────────┘
                   │  pg wire protocol (SSL)
                   ▼
┌──────────────────────────────────────────────────────────┐
│              Neon (Postgres)                             │
│  ~95 tables: users, characters, bills, motions,          │
│  statements, regulations, divisions, press_items, …      │
└──────────────────────────────────────────────────────────┘

External services:
  Discourse forum — DiscourseConnect SSO + REST API (topics, posts, groups)
  Resend          — Transactional email (email verification)
  Cloudflare Turnstile — Anti-bot widget on registration
```

**Responsibilities by layer:**

- **Browser UI** — renders pages, calls `/api/*` endpoints, never stores game state in `localStorage` during authenticated sessions. Demo mode reads `/data/demo.json` (read-only).
- **Cloudflare edge** — routes traffic, preserves session cookies, redirects bare domain to `www`. Does not alter request bodies.
- **Express API server** — single source of truth for all simulation state. Enforces auth, RBAC, CSRF, rate-limiting, and business rules. Returns JSON.
- **Neon/Postgres** — persistent store for all game entities and user data.

---

## 3. Backend Architecture

### API Server (`server/index.js`)

The server is a monolithic Express.js application (~24,700+ lines) written as an ES module (`"type": "module"` in `server/package.json`). It requires Node.js ≥ 18.

**Start command:**
```bash
cd server && node index.js
```

**Key middleware stack (applied globally):**

| Middleware | Purpose |
|-----------|---------|
| `cors` | Allows cross-origin requests from configured origins |
| `cookie-parser` | Parses signed/unsigned cookies |
| `express-session` + `connect-pg-simple` | Server-side sessions stored in Postgres; `rolling: true` keeps active sessions alive |
| `express-rate-limit` | Per-route rate limiters (auth, CRUD reads/writes, discourse sync, etc.) |
| `verifyCsrfToken` (custom) | Validates `X-CSRF-Token` header on all state-changing requests |

**CSRF protection:** Every `POST`/`PUT`/`PATCH`/`DELETE` route runs the `verifyCsrfToken` middleware. Tokens are session-scoped, available via `GET /api/csrf-token`. The frontend's `_fetch()` wrapper auto-retries on 403 "CSRF token missing or invalid" by refreshing the token and resending once.

**Auth middleware pattern:**

```javascript
// Example: route that requires admin or mod
app.post("/api/some-route", requireAdminOrMod, verifyCsrfToken, async (req, res) => { … });

// Dev-only destructive route
app.post("/api/admin/seed", async (req, res) => {
  if (!isDevSeedAllowed()) return res.status(404).json({ error: "Not found" });
  requireAdmin(req, res, next);
  …
});
```

Auth guards used throughout:

| Guard | Who it permits |
|-------|---------------|
| `requireAdmin` | `admin` role only |
| `requireAdminOrMod` | `admin` or `mod` |
| `requireAdminModOrSpeaker` | `admin`, `mod`, or `speaker` |
| `requireLogin` | Any authenticated session |
| `isDevSeedAllowed()` | Returns `false` in production unless `ENABLE_DEV_SEED=true` |

**Error response shape:** All error responses use `{ error: "<string>" }` — this is enforced by `static-checks.js`.

**Route count (from feature manifest):** ~422 endpoints total.

**Navigation aid inside `server/index.js`:** The file now includes a maintained top-level "navigation map" comment plus searchable `SECTION:` markers for the highest-traffic domains (core auth/session/csrf, state/snapshots, parliamentary/divisions, discourse integration, finance/economy, factions/political-state, support/internal tickets, staff/admin operations, sim clock/freeze, and bootstrap/schema/startup).

#### Post-alpha extraction roadmap (`server/index.js`)

This pass intentionally avoided broad modularisation and route-file splitting. The next low-risk extraction targets are:

1. **Audit logging helpers** — consolidate repeated `audit_log` write/read patterns (including payload-shaping and guard rails).
2. **Clock tick runners** — isolate month-rollover orchestration and side-effect sequencing from route handlers.
3. **Parliamentary authority/eligibility helpers** — centralise remaining permission and eligibility checks still embedded in parliamentary routes.
4. **Shared admin route utilities** — extract repeated admin guard + response boilerplate used across `/api/admin/*` maintenance endpoints.

These are documentation-first recommendations intended to reduce edit risk during alpha while preserving existing runtime behaviour.

**Major route groups:**

| Prefix | Domain |
|--------|--------|
| `/api/auth/*` | Login, logout, registration, email verification, `/api/auth/me` |
| `/api/bootstrap` | Combined startup response (user, clock, config) |
| `/api/state` | Global simulation state snapshot (admin/mod writes only) |
| `/api/bills/*` | Bill lifecycle (first reading → report → assent → division/vote) |
| `/api/motions/*` | House motions and EDMs |
| `/api/statements/*` | Ministerial statements |
| `/api/regulations/*` | Statutory instruments |
| `/api/divisions/*` | Formal division votes (server-authoritative weight) |
| `/api/qt/*` | Question Time questions, answers, follow-ups |
| `/api/press/*` | Press items (releases, conferences, comments, speeches, letters) |
| `/api/polling/*` | Polling entries |
| `/api/debates/*` | Discourse debate topic creation |
| `/api/elections/*` | Election management and seat totals |
| `/api/constituencies/*` | Constituency data |
| `/api/budget/*` | Budget drafting and approval |
| `/api/bodies` + `/api/bodies/:id` | Parliamentary bodies registry (with `NO_CONTROL_BODY_IDS` stripping) |
| `/api/locals` | Local authority data (four-nation council/councillor breakdown) |
| `/api/parties/:slug/factions` | Party factions: CRUD, allocation, climate, trigger-freeze |
| `/api/parties/:slug/faction-climate` | Party climate (includes `lastFreezeAt`, `viewerRole`, `pendingFreezeCount`) |
| `/api/parties/:slug/internal-tickets` | Internal Policy Management tickets (party leadership → staff) |
| `/api/staff/internal-tickets` | Staff-side IPM ticket management (costing, outcome, messages) |
| `/api/admin/other-officials/*` | Other-officials faction allocations and arena totals |
| `/api/admin/seed-1997-bodies-locals` | 1997 bodies/locals seed (dev/staging only, `isDevSeedAllowed()` guarded) |
| `/api/admin/seed-1997-factions` | 1997 faction seed (admin/mod only, production-accessible) |
| `/api/guides` + `/api/guides/:id` | Guides CRUD (staff-managed; public read) |
| `/api/rules` + `/api/rules/:id` | Rules CRUD (staff-managed; authenticated read) |
| `/api/support/*` | Support ticketing (player and staff queues) |
| `/api/redlion` + `/api/redlion/:id` | Red Lion social channel (authenticated posts; admin/mod delete) |
| `/api/events` + `/api/events/:id` | In-game events log |
| `/api/online` + `/api/online/:id` | Online activity campaigns; `PATCH /api/online/settings` |
| `/api/fundraising` + `/api/fundraising/:id` | Fundraising activities; credit-party / credit-character |
| `/api/news` + `/api/news/:id` | Staff-authored news items; comments; reply requests |
| `/api/papers/*` | In-sim newspapers: articles, comments, player submissions |
| `/api/scandals/*` | Player scandal lifecycle (opt-in, situations, choices) |
| `/api/mod/scandals/*` | Mod scandal management (templates, situations, decisions, close) |
| `/api/privy-council` + `/api/privy-council/posts` | Privy Council membership and posts |
| `/api/mod/privy-council/*` | Mod privy council appointment/removal |
| `/api/shop/*` | Shop price index and inflation |
| `/api/me/character/shop-purchases` | Character shop purchases (buy, sell, dismiss) |
| `/api/parties/:id/shop-purchases` | Party shop purchases (buy, sell, dismiss) |
| `/api/me/work-plan` | Character weekly work plan (GET/POST) |
| `/api/discourse/*` | SSO, group sync, test |
| `/api/admin/*` | Admin panel operations |
| `/api/civil-service/*` | Civil service briefings and cases |
| `/api/parliament/status` | Parliament open/dissolved/prorogued status |
| `/api/sim/*` | Sim clock management: freeze, tick, set (aliases for `/api/clock/*`) |

### Database Layer (`server/db.js`)

The database module exports a single `pg.Pool` instance:

```javascript
import { pool } from "./db.js";
```

**Configuration:**
- Connection string from `DATABASE_URL` environment variable.
- SSL is automatically enabled when the URL carries an `sslmode` parameter or the host is `*.neon.tech`.
- Pool limits: `max: 10` connections, `idleTimeoutMillis: 30_000`, `connectionTimeoutMillis: 5_000`.

**Usage pattern in routes:**
```javascript
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const result = await client.query("SELECT …", [param]);
  await client.query("COMMIT");
  res.json(result.rows[0]);
} catch (err) {
  await client.query("ROLLBACK");
  res.status(500).json({ error: "Database error" });
} finally {
  client.release();
}
```

Session storage also uses the same `pool` via `connect-pg-simple`, which creates a `session` table automatically.

**Known tables (from audit inventory):** `users`, `characters`, `bills`, `motions`, `statements`, `regulations`, `divisions`, `division_votes`, `press_items`, `polling_entries`, `questiontime_questions`, `constituencies`, `pending_registrations`, `privy_council_members`, `app_config`, `finance_config`, `party_factions`, `party_faction_allocations`, `faction_political_state`, `character_political_state`, `character_finance`, `party_donations`, `other_officials_faction_allocations`, `guides_items`, `rules_items`, `support_tickets`, `support_messages`, `red_lion_posts`, `game_events`, `fundraising_entries`, `online_entries`, `online_settings`, `news_items`, `news_comments`, `news_reply_requests`, `paper_articles`, `paper_article_comments`, `paper_submissions`, `scandal_templates`, `scandal_situations`, `scandals`, `scandal_player_choices`, `scandal_mod_decisions`, `scandal_opt_in`, `party_shop_purchases`, `character_shop_purchases`, `shop_price_index`, `character_work_plans`, `party_internal_tickets`, `party_internal_ticket_messages`, and others.

### Extracted Service Modules

Several service-layer modules have been extracted from `server/index.js` for testability and reuse:

| Module | Exports | Purpose |
|--------|---------|---------|
| `server/political-state-service.js` | `FACTION_PLAYABLE_PARTIES`, `clamp100`, `computeFactionPoliticalState`, `getPartyFactionClimate`, `DOMINANCE_STABILISER` | Faction political state computation; party climate with dominance stabiliser |
| `server/division-helpers.js` | `SPEAKER_REGEX`, `SINN_FEIN_REGEX`, vote weight helpers, tally | Vote weight calculation and tallying logic |
| `server/finance-service.js` | `resolveActiveSalaryScale`, `computeCharacterAnnualSalary`, `resolvedAnnualSalary` | Salary band resolution and character annual salary computation |
| `server/recompute-helpers.js` | `fireRecompute`, `awaitedRecompute` | Non-blocking and awaited recompute wrappers with observability (`entity=<id>` logging) |
| `server/rbac-helpers.js` | RBAC guard utilities | Role-based access helpers used across routes |
| `server/state-contracts.js` | `assertSnapshotDerivedTable`, `stripRelationalKeys` | Enforces the state-ownership boundary at runtime |
| `server/guides-seed.js` | `PREDEFINED_GUIDES`, `seedPredefinedGuides` | 15 predefined onboarding guides; called during `ensureSchema()` on startup |

### Simulation Clock (`server/clock.js`)

The simulation clock converts real-world dates into simulation dates. The algorithm is shared between the server (`server/clock.js`) and the browser (`js/clock.js`) — both must be kept in sync.

**Algorithm:**
- The simulation starts at a configured `startSimMonth` / `startSimYear` (default: August 1997).
- Two simulation months elapse per real week — one boundary on **Monday** and one on **Thursday**.
- When the sim is paused, the clock freezes at `pausedAtRealDate`.
- When the sim has not yet started (`started === false`), returns the configured start date.

**Server helper:**
```javascript
import { computeSimDateFromGameState } from "./clock.js";
const { month, year } = computeSimDateFromGameState(gameState);
```

The server also exposes `GET /api/clock` for the browser to read the current sim date, and `POST /api/clock/tick` / `POST /api/clock/set` for admin control.

### Discourse Integration (`server/discourse.js`, `server/discourseClient.js`)

Two Discourse client modules coexist (see §9 for full details):

- **`discourse.js`** — object-parameter style client. Used by `server/index.js` for `closeDiscTopic()` and for SSO (`buildSsoPayload`, `verifySsoPayload`, `verifyConsumerRequest`, `buildConsumerResponse`), group sync (`resolveGroupIds`, `addGroupMembers`, `removeGroupMembers`), and topic/post creation.
- **`discourseClient.js`** — positional-argument style client. Used for `dcCreateTopic`, `dcCreatePost`, `dcWithRetry` (debate topic creation with retry logic).

Discourse credentials (API key, username, base URL, SSO secret) are stored **encrypted in the `app_config` database table**, not in environment variables. They are managed through the Admin Panel UI.

---

## 4. Frontend Interaction Model

The frontend is entirely static HTML + vanilla JavaScript (ES modules). There is no bundler or framework — pages load individual JS modules directly via `<script type="module">`.

**Page load model:**
1. Page JS imports needed modules from `js/`.
2. Calls `bootData()` from `js/core.js`, which calls `GET /api/bootstrap` to get the current user, clock state, and config.
3. Calls `getState()` from `js/core.js` to load simulation data:
   - If logged in → `GET /api/state` (authoritative DB snapshot).
   - If not logged in → `fetch("/data/demo.json")` (read-only demo).
4. Renders the page using the returned data.
5. User actions call feature-specific API endpoints directly.

**No simulation logic in the frontend.** The browser never computes game outcomes. It calls the backend and renders the response.

### Key JS modules

#### `js/api.js`
Central HTTP client. Every API call in the application goes through a function in this file.

- `resolveApiBase()` — reads `window.RB_API_BASE` to support pointing at a non-local backend.
- `_fetch(url, init)` — internal wrapper. Automatically retries once on 403 "CSRF token missing or invalid" by calling `apiGetCsrfToken()` and resending.
- `setCsrfToken(token)` / `csrfHeaders()` — manage the cached CSRF token for the session.
- All exported functions (`apiLogin`, `apiMe`, `apiBootstrap`, `apiGetBills`, `apiBillVote`, etc.) call `_fetch()` with `credentials: "include"` for authenticated endpoints.

Example:
```javascript
import { apiGetBills, apiBillVote } from "./api.js";
const bills = await apiGetBills();
const updated = await apiBillVote(billId, "aye");
```

#### `js/auth.js`
Session guard helpers for page-level auth enforcement.

- `requireLogin()` — calls `apiMe()`; redirects to `login.html` if unauthenticated.
- `requireAdmin()` — calls `requireLogin()` then checks `user.roles.includes("admin")`; renders a "Forbidden" message if the role is absent.

These are called at the top of page scripts that require auth:
```javascript
const user = await requireAdmin();
if (!user) return; // already redirected/shown error
```

#### `js/core.js`
Global session state and data loading.

- `bootData()` — calls `GET /api/bootstrap`, caches `_user` and `_bootstrapConfig`, fetches and sets the CSRF token. Must be called before any data reads.
- `isLoggedIn()` — returns `true` if `_user.id` is set.
- `getState()` — loads sim state from API (logged in) or demo JSON (not logged in).
- `saveState(data)` — calls `POST /api/state`. Only staff (admin/mod/speaker) should call this; non-staff players use feature-specific API endpoints.
- `saveData()` — permanently disabled no-op. Local simulation state persistence is never used in authenticated mode.
- `requireLoginForWrite(actionLabel)` — guard for submit handlers; shows a toast and returns `false` if the user is not logged in.

#### `js/divisions.js`
Client-side rendering support for division votes. The `buildDivisionWeights(data)` function computes display weights for the division UI based on party seat counts and player roles. **This is used for rendering only — the server computes all authoritative `effective_weight` values** via `PATCH /api/bills/:id/vote` and `/api/divisions/*` endpoints.

The weighting logic:
- Players in a party whose seats > 0 share those seat votes proportionally.
- The Speaker and Sinn Féin MPs receive weight 0 (they do not vote).
- New backbenchers (joined within 2 weeks) receive weight 1 each; remaining seats are split among established members.
- Party leaders receive odd remainder seats.

#### `js/bill-drafting.js`
Shared component for the bill-drafting UI. Exports:
- `renderDraftingBuilder(prefix, draft)` — renders the HTML form for a multi-article bill.
- `wireDraftingBuilder(form, prefix)` — attaches a change listener to repaint article editors when the article count changes.
- `parseDraftingForm(form, data)` — reads a submitted form back into a bill data object.
- `DEPARTMENTS` — canonical list of government departments.
- `EXTENT_OPTIONS` / `COMMENCE_OPTIONS` — commencement and territorial extent options.

#### `js/audit.js`
Thin wrapper around `POST /api/audit-log`. Use `logAction({ action, target, details })` from any admin/mod page to record an action in the persistent audit log. Fire-and-forget — errors are swallowed internally so they never block the UI.

#### `js/clock.js`
Client-side sim-date computation (mirrors `server/clock.js`).

Key exports:
- `getSimDate(gameState, now)` — returns `{ monthIndex, monthName, year }`.
- `formatSimMonthYear(gameState)` — returns a display string like `"August 1997"`.
- `createDeadline(gameState, n)` — returns a `{ month, year }` object for a deadline N sim months from now.
- `countdownToSimMonth(m, y, gameState)` — returns a human-readable countdown string.
- `compareSimDates(a, b)` — compares two `{ month, year }` objects.

#### `js/character-enums.js`
Fallback arrays for character profile dropdowns (education, career, family status). The server provides canonical lists via `GET /api/config/enums`; these are used when that response is unavailable.

#### `js/constituency-utils.js`
Shared helpers for constituency dropdowns:
- `seatTaken(data, name)` — returns `true` if a constituency already has a player or NPC occupant.
- `allConstituenciesForPartyWithStatus(data, pendingApps, partyName)` — returns constituencies sorted available-first.
- `renderConstituencyOptions(constituencies, fallbackMsg)` — renders `<option>` HTML, greying out taken seats.

### HTML pages

There are ~50 HTML pages in the root directory. Key pages include:

| Page | Purpose |
|------|---------|
| `admin-panel.html` | Full admin interface (users, registrations, config, danger zone) |
| `bill.html` | Individual bill view with division voting |
| `bodies.html` | Parliamentary bodies overview |
| `budget.html` | Budget page |
| `cabinet.html` | Government cabinet |
| `civilservice.html` | Civil service briefings and cases |
| `constituencies.html` | Constituency data |
| `dashboard.html` | Player dashboard |
| `debates.html` | Discourse debate management |
| `elections.html` | Election management |
| `motions.html` / `motion.html` | Motions list and individual motion |
| `questiontime.html` | Question Time |
| `register.html` / `login.html` | Auth pages |
| `statements.html` / `statement.html` | Ministerial statements |
| `submit-bill.html` | Bill drafting and submission |

---

## 5. Simulation Systems

### Parliamentary Bodies

`GET /api/bodies` returns the current parliamentary bodies from the game state. Bodies are tracked as part of the overall state snapshot managed via `POST /api/state` (admin/mod only). The `GET /api/parliament/status` endpoint returns whether Parliament is open, dissolved, or prorogued, controlling which actions are permitted.

**Key implementation details:**
- `NO_CONTROL_BODY_IDS = new Set(["lords", "europarl"])` — `controlType`/`controlParty` fields are stripped via `stripControlFields()` in `GET /api/bodies` and `PUT /api/bodies/:id`.
- `BODY_PARTY_SCHEMA` in `js/pages/bodies.js` defines the canonical party list for each body type, ensuring seat breakdowns are consistent and include an explicit `Others` bucket.
- `compositionBreakdown` is used for the House of Lords (Crossbenchers, Lords Spiritual, Law Lords); `partyBreakdown` is used for standard elected bodies.
- Directly Elected Mayors use a structured editor (`parseLegacyMayorLines` / `normalizeMayorData`) rather than freeform text.

### Legislation

Bills follow a lifecycle managed entirely through the backend:

1. **Draft** — `POST /api/bills` (any authenticated user)
2. **First Reading** — `POST /api/bills/:id/first-reading` (admin/mod/speaker)
3. **Report Stage** — `POST /api/bills/:id/report`
4. **Final Division** — `POST /api/bills/:id/final-division` (creates a division record)
5. **Royal Assent** — `POST /api/bills/:id/assent` (admin/mod/speaker)
6. **Withdrawal** — `POST /api/bills/:id/withdraw`

**Bill voting** (`PATCH /api/bills/:id/vote`): The server computes the voter's `effective_weight` from the current game state (mirroring `buildDivisionWeights` logic). The client-supplied vote direction (`aye`/`no`/`abstain`) is stored alongside the server-computed weight. This makes bill vote tallies server-authoritative and tamper-resistant.

**Amendments** are added via `POST /api/bills/:id/amendments` and decided via `POST /api/bills/:id/amendments/:aid/decide`.

### Formal Divisions

Formal divisions are created for motions, statements, regulations, and bills at the appropriate stage.

- `GET /api/divisions` / `GET /api/divisions/:id`
- `POST /api/divisions` — create a division
- `POST /api/divisions/:id/vote` — cast a vote; server ignores any client-supplied `weight` and sets `effective_weight = 1` per character (one member, one vote for formal divisions).
- Division records include `immutable_result` (set on close), party rollups, and delegation map.

### Motions and EDMs

House motions are submitted via `POST /api/motions` and can be signed by other MPs via `POST /api/motions/:id/sign`. EDMs follow the same table but use `closesAtSimObj` for deadline tracking, while house motions use `debateEndSimObj`.

### Cabinet and Offices

Government offices are managed through the character/office system. Office roles (`office:prime_minister`, `office:secretary_of_state`, etc.) are assigned via the admin panel role editor. The `recomputeUserOfficeRoles()` helper on the server keeps user roles in sync with their assigned offices.

Privy Council membership is managed via a dedicated `privy_council_members` table with soft-removal support (removed members are preserved for historical PC post-nominal display).

### Civil Service

The civil service system has two entity types:
- **Briefings** — `GET/POST/PATCH/DELETE /api/civil-service/briefings`
- **Cases** — `GET/POST/PATCH/DELETE /api/civil-service/cases`

Both support `?limit` (default 200, max 500) and `?offset` pagination via the `parsePaginationParams` helper.

### Question Time

Question Time is managed through:
- `GET/POST /api/qt/questions` — submit questions
- `POST /api/qt/questions/:id/answer` — minister answers a question
- `POST /api/qt/questions/:id/followup` — supplementary questions
- `PATCH /api/qt/followups/:id` — edit follow-up
- `DELETE /api/qt/questions/:id` — remove question

### Constituencies

Constituency data is seeded from the 1997 election dataset (see §6). Individual constituencies are managed via `GET/POST/PUT/DELETE /api/constituencies/:id`. The `seatTaken` check (in `js/constituency-utils.js`) prevents double-assignment.

### Characters

Characters represent parliamentary personas. Each user account can have an active character. Character applications go through an approval workflow:
- `GET /api/admin/characters/applications` — list pending applications (paginated)
- `POST /api/admin/registrations/:id/approve` — approve registration and assign party/backbencher roles
- `POST /api/admin/characters/:id/assign-owner` — link a character to a user account

`formatParliamentaryName()` on the server builds display names with post-nominals:
- All MPs append `MP`.
- `PC` is appended for characters with `rh_ever` (PM or LOTO history) or `tpl_ever` (third-party leader history).

### Scandals

The scandal system allows mods to create scenario templates and assign them to opted-in characters:
- `GET /api/scandals/mine` — player's active scandal state (opt-in status, situations, scandals, player choices)
- `POST /api/scandals/optin` — toggle opt-in flag for the active character
- `POST /api/scandals/situations/:id/respond` — player responds to a situation
- `POST /api/scandals/:id/choose` — player selects a branching choice for an active scandal stage

**Mod routes:**
- `GET /api/mod/scandal-templates` — list templates
- `POST /api/mod/scandal-templates` — create a template
- `GET /api/mod/scandals/opted-in-characters` — list characters who have opted in
- `POST /api/mod/scandals/situations/create` — create a situation for a character
- `GET /api/mod/scandals/open` — list open scandals
- `POST /api/mod/scandals/:id/decision` — record mod decision
- `POST /api/mod/scandals/:id/close` — close a scandal
- `DELETE /api/mod/scandals/:id` — delete a scandal
- `POST /api/mod/scandals/situations/:id/close` — close a situation
- `DELETE /api/mod/scandals/situations/:id` — delete a situation

**Tables:** `scandal_templates`, `scandal_situations`, `scandals`, `scandal_player_choices`, `scandal_mod_decisions`, `scandal_opt_in`

### Support Ticketing

The support ticketing system allows players to raise issues with staff and staff (admin/mod) to manage the queue.

**Player endpoints (requires any authenticated session):**
- `GET /api/support/tickets` — list the player's own tickets (ordered by `updated_at DESC`)
- `POST /api/support/tickets` — create a new ticket (`subject` ≤ 200 chars, `category` ≤ 100 chars, `message` ≤ 10,000 chars — all validated before any DB write)
- `GET /api/support/tickets/:id` — fetch a single ticket and its messages; automatically marks `player_last_read_at`
- `POST /api/support/tickets/:id/messages` — append a message to a ticket; blocked on `closed` tickets
- `PATCH /api/support/tickets/:id` — player status transitions (`open ↔ finished`)

**Staff endpoints (requires `admin` or `mod` role):**
- `GET /api/support/staff/tickets` — paginated list of all tickets; accepts `?status=`, `?label=`, `?limit=` (max 200), `?offset=`; returns `{ tickets, total, limit, offset }`. The `COUNT(*)` uses identical filter parameters to the data query.
- `GET /api/support/staff/tickets/:id` — fetch any ticket and messages; marks `staff_last_read_at`
- `POST /api/support/staff/tickets/:id/messages` — staff reply (`message` ≤ 10,000 chars; blocked on `closed` tickets)
- `PATCH /api/support/staff/tickets/:id` — update `status` (with enforced transition matrix) and/or `staff_labels` array

**Status lifecycle:**

```
open  ──(player marks finished)──▶  finished  ──(staff closes)──▶  closed
 ▲                                     │
 └──────────(player/staff reopens)──────┘
                                       ▲
 closed ──(staff reopens)──────────────┘
```

**Unread tracking:**
- Player unread: `last_message_at > player_last_read_at` (or `player_last_read_at IS NULL`)
- Staff unread: `last_message_at > staff_last_read_at` (or `staff_last_read_at IS NULL`)
- `GET` on a ticket automatically clears the appropriate side's unread flag.

**Frontend (`js/pages/support.js`):**
- Dual-panel layout: ticket list (left) + thread view (right).
- Polls every 25 seconds (`setInterval`) when the tab is visible; also re-polls on `visibilitychange`.
- Keyboard accessibility: list items have `tabindex="0"` and respond to both `click` and `keydown` (Enter / Space).
- Toast notifications for new unreads use a `hasLoaded` boolean flag to suppress the first-load toast; the currently-open ticket is excluded from unread notifications.
- Staff view shows status/label filters, ticket owner, and an inline label-toggle editor.

**Database tables:**

```sql
support_tickets (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by_user_id    UUID NOT NULL REFERENCES users(id),
  created_by_character_id UUID REFERENCES characters(id),
  subject               TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','finished','closed')),
  category              TEXT,
  staff_labels          TEXT[] NOT NULL DEFAULT '{}',
  last_message_at       TIMESTAMPTZ,
  player_last_read_at   TIMESTAMPTZ,
  staff_last_read_at    TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
)

support_messages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id      UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL REFERENCES users(id),
  author_role    TEXT NOT NULL CHECK (author_role IN ('player','staff')),
  body           TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
)
```

Both tables are bootstrapped by `ensureSchema()` and are **relational-authoritative** (not subject to snapshot flows).

### Guides

The Guides system stores staff-managed onboarding articles for players.

- `GET /api/guides` — public read (no auth required)
- `POST /api/guides` — create a guide (admin/mod)
- `PATCH /api/guides/:id` — update a guide (admin/mod)
- `DELETE /api/guides/:id` — delete a guide (admin/mod)

On startup, `seedPredefinedGuides(pool)` (from `server/guides-seed.js`) inserts any of the 15 predefined guides that are absent and corrects `sort_order` values. This ensures the default onboarding content is always present without requiring an explicit seeding step.

**Frontend (`js/pages/guides.js`):** Displays guides as collapsible panels. Uses the HTML `hidden` attribute (not inline `display` style) so collapsing works correctly even when the panel has `display:grid` set. **Never** set `element.style.display = 'none'` for show/hide in this page — use `element.hidden = bool` instead.

### Rules

The Rules system is a staff-managed CMS for game rules, displayed to all authenticated players on `rules.html`.

- `GET /api/rules` — list all rules (authenticated)
- `POST /api/rules` — create a rule (admin/mod)
- `PATCH /api/rules/:id` — edit a rule (admin/mod)
- `DELETE /api/rules/:id` — delete a rule (admin/mod)

**Table:** `rules_items` — same schema as `guides_items` (`id SERIAL PK`, `title TEXT`, `body TEXT`, `sort_order INTEGER`, `created_at`, `updated_at`). Uses the same collapsible-panel UI pattern as `guides.html`.

### Shop System

The Shop system provides strategic modifier purchases for both parties and individual characters.

**Party Shop:**
- `GET /api/parties/:partyId/shop-purchases` — list party purchases
- `POST /api/parties/:partyId/shop-purchases` — buy a modifier (deducted from party treasury)
- `DELETE /api/parties/:partyId/shop-purchases/:id` — cancel a purchase
- `POST /api/parties/:partyId/shop-purchases/:id/sell` — sell back a purchase
- `POST /api/parties/:partyId/shop-purchases/:id/dismiss` — dismiss an expired purchase

**Character Shop:**
- `GET /api/me/character/shop-purchases` — list active character's purchases
- `POST /api/me/character/shop-purchases` — buy a modifier (deducted from character balance)
- `DELETE /api/me/character/shop-purchases/:id` — cancel a purchase
- `POST /api/me/character/shop-purchases/:id/sell` — sell back
- `POST /api/me/character/shop-purchases/:id/dismiss` — dismiss expired

**Price index:** `GET /api/shop/price-index` returns current price multiplier. `POST /api/shop/apply-inflation` (admin/mod) steps the index up. `POST /api/finance/shop-upkeep` applies periodic maintenance costs to active purchases.

### Red Lion, Events, Fundraising, Online

**Red Lion** (`GET/POST /api/redlion`, `DELETE /api/redlion/:id`): Authenticated social channel for informal player posts. Table: `red_lion_posts`.

**Events** (`GET/POST/PUT/DELETE /api/events`): In-game event log. Table: `game_events`.

**Fundraising** (`GET/POST/PUT/DELETE /api/fundraising`, `POST /api/fundraising/:id/credit-party`, `POST /api/fundraising/:id/credit-character`): Fundraising entries with idempotent party/character credit. Table: `fundraising_entries`.

**Online** (`GET/POST/DELETE /api/online`, `PATCH /api/online/:id`, `PATCH /api/online/settings`): Online campaign entries with per-character settings. Tables: `online_entries`, `online_settings`.

### News and Papers

**News** (`GET/POST/PATCH/DELETE /api/news`): Staff-authored news items with comments (`GET/POST/DELETE /api/news/:id/comments`) and reply requests. Tables: `news_items`, `news_comments`.

**Papers** (`GET /api/papers`): In-sim newspapers. Articles (`POST/PATCH/DELETE /api/papers/:key/articles`), article comments (`GET/POST/DELETE /api/papers/:paperKey/articles/:articleId/comments`), and article submissions (`POST/GET/GET-single/PATCH/DELETE /api/papers/submissions`). Tables: `paper_articles`, `paper_article_comments`, `paper_submissions`.

### Privy Council

- `GET /api/privy-council` — list all members
- `POST /api/mod/privy-council/appoint` — appoint a character (mod)
- `POST /api/mod/privy-council/remove` — remove a character (mod)
- `GET/POST/DELETE /api/privy-council/posts` — Privy Council channel posts
- **Table:** `privy_council_members`

### Work Plan

- `GET /api/me/work-plan` — retrieve active character's plan
- `POST /api/me/work-plan` — upsert plan (hours object, optional second job title)
- **Table:** `character_work_plans`
- An active plan (saved within 3 sim months) contributes +5 capital. Stale/absent plan raises constituency pressure.

### Internal Party Management (IPM) Tickets

- `POST /api/parties/:slug/internal-tickets` — create a ticket (party leader/whip/chairman)
- `GET /api/parties/:slug/internal-tickets` — list tickets (role-filtered)
- `POST /api/parties/:slug/internal-tickets/:id/approval` — party-side approval
- `GET /api/parties/:slug/internal-tickets/:id/messages` — message thread
- `POST /api/parties/:slug/internal-tickets/:id/dismiss` — dismiss
- `GET/POST /api/staff/internal-tickets` — staff-side ticket list / create
- `PUT /api/staff/internal-tickets/:id/costing` — record costing
- `PUT /api/staff/internal-tickets/:id/outcome` — record outcome
- `POST /api/staff/internal-tickets/:id/cancel` — cancel
- `GET/POST /api/staff/internal-tickets/:id/messages` — staff message thread
- **Tables:** `party_internal_tickets`, `party_internal_ticket_messages`



Local authority data (`GET/PUT /api/locals`) is stored as a JSON object in `app_config` with a `countries` array. Each country entry includes `totalCouncils`, `totalCouncillors`, `noOverallControlCouncils`, and a `partyBreakdown`.

The server validates that party sums match declared totals on every PUT. The 1997 seed (England: 386 councils / 22,580 councillors; Scotland: 32/1,306; Wales: 22/1,272; Northern Ireland: 26/582) is applied via `POST /api/admin/seed-1997-bodies-locals` (protected by `isDevSeedAllowed()`, dev/staging only).

### Other Officials Faction Allocations

The `other_officials_faction_allocations` table tracks how non-Commons official positions (body seats, councillors, DEMs) are allocated across parties and factions. Only `FACTION_PLAYABLE_PARTIES` (Labour, Conservative, Lib Dem) have rows; other parties have no allocations.

- `GET /api/admin/other-officials/arenas-totals` — derives arena totals from the current bodies and locals data
- `GET /api/admin/other-officials/faction-allocations?arena_type=&arena_id=&party_slug=` — read allocations
- `POST /api/admin/other-officials/faction-allocations` — create an allocation
- `PATCH /api/admin/other-officials/faction-allocations/:id` — update an allocation
- `DELETE /api/admin/other-officials/faction-allocations/:id` — remove an allocation

---

## 6. Data Model

### 1997 Constituency Dataset

**Source CSV:** `assets/1997_structured.csv` — the canonical input read by `scripts/convert-1997-csv.js`. A copy also exists at `data/1997_structured.csv` for reference, but the conversion script always reads from the `assets/` path.

**Generated JSON:** `data/constituencies_1997.json`

The CSV contains one row per constituency with fields including constituency name, region, elected party, vote counts, and a seat breakdown summary. The `convert-1997-csv.js` script processes this into a structured JSON array consumed by `POST /api/admin/constituencies/initialize-1997`.

The conversion script performs:
1. **Party normalisation** — maps ASCII variants (`Sinn Fein`) and mojibake (`Sinn F?in`) to canonical Unicode (`Sinn Féin`). Maps `UK Unionist` and `Independent` to `Independents`.
2. **Nation/region resolution** — Scotland, Wales, and Northern Ireland are their own nations; all others are `England` with a regional sub-field.
3. **Slug generation** — converts constituency names to URL-safe slugs (lowercased, apostrophes removed, non-alphanumeric → dash).

**Run the conversion script:**
```bash
node scripts/convert-1997-csv.js
```

This regenerates `data/constituencies_1997.json`. Do not edit the JSON directly; edit the CSV and re-run the script.

### Demo Data (`data/demo.json`)

`demo.json` is a static snapshot of simulation state used when no user is logged in. It contains representative data for all major game entities (parliament, parties, characters, bills, motions, etc.) so new visitors can explore the simulation without an account.

The demo is read-only on the client. `getState()` in `js/core.js` serves this file when `isLoggedIn()` is `false`.

A fresh demo baseline can be seeded from the Admin Panel (Danger Zone → Wipe + Seed), which calls `POST /api/admin/seed-demo`. This endpoint is production-disabled unless `ENABLE_DEV_SEED=true`.

### Game State

Live simulation state is stored in the `state_snapshots` table (one row per snapshot, JSONB `data` column). The `app_state_current` table holds a single pointer (`snapshot_id`) to the active snapshot. `GET /api/state` resolves the current pointer and returns `{ data: { … } }`. Staff-level saves write a new `state_snapshots` row and update the pointer. The legacy `app_state` table is retained only for migration purposes.

The state object includes (non-exhaustive):
- `gameState` — clock config (`startRealDate`, `startSimMonth`, `startSimYear`, `isPaused`, `pausedAtRealDate`, `started`)
- `parliament` — parties with seat counts
- `players` / `currentCharacter` — character data
- `adminSettings` — monarch gender and other overrides
- Economy page data (if managed via the state)

---

## 7. Worker Process

### Cloudflare Worker (`worker/index.js`)

The Cloudflare Worker is an edge proxy, not a background job runner. It handles two tasks:

1. **API proxy** — All `GET` and `POST` requests to `/api/*` on `rulebritannia.org` are forwarded unchanged to the Render backend (`https://rulebritannia-app-backend.onrender.com`). This includes the body and all headers (credentials, cookies). Only `GET`/`HEAD` requests have no body per HTTP spec.

2. **Bare-domain redirect** — Non-API `GET`/`HEAD` requests on `rulebritannia.org` are 308-redirected to `www.rulebritannia.org`. This preserves cookie forwarding (cookies are set on `.rulebritannia.org`) while maintaining a canonical `www` URL for the static site.

3. **Health check** — `GET /api/worker-test` returns `200 WORKER_OK rb-api-proxy` for liveness checks.

The Worker is deployed to Cloudflare via `wrangler` using `wrangler.toml`:
```toml
name = "rb-api-proxy"
main = "worker/index.js"
[[routes]]
pattern = "rulebritannia.org/api/*"
zone_name = "rulebritannia.org"
```

**`www.rulebritannia.org/api/*`** is handled by the Cloudflare Pages Function at `functions/api/[[path]].js`. Both paths forward to the same Render backend.

### Background Tasks in the API Server

The Express server itself handles background-style tasks inline:

- **`runDebateAutoClose()`** — called on each `/api/clock/tick`. Closes Discourse topics for motions/statements/regulations whose debate deadline has passed. Uses `discourse_topic_id` column (not JSONB) to find topics.
- **`enqueueDiscourseGroupSync()`** — debounced group sync trigger. Uses a single-flight pattern with a debounce timer. Called after role changes.
- **Sim clock** — the server computes the current sim date on every request that needs it (`computeSimDateFromGameState`). There is no scheduled background tick; ticks are triggered manually by admin via `POST /api/clock/tick`.

---

## 8. Authentication & Permissions

### Login Flow

1. User submits email + password to `POST /api/auth/login` (rate-limited).
2. Server verifies the bcrypt hash and checks `email_verified = true`.
3. On success, creates a server-side session (stored in Postgres via `connect-pg-simple`). Session cookie is `HttpOnly`, `sameSite: "none"` (required for cross-origin Cloudflare proxy), `secure: true`, domain `.rulebritannia.org`.
4. `GET /api/auth/me` returns the current user object (id, email, roles). Returns `{ user: null }` if unauthenticated.
5. `POST /api/auth/logout` destroys the session.

**Session management:** `rolling: true` is set so active sessions stay alive. `POST /api/admin/rotate-sessions` (admin-only) regenerates all session secrets. `POST /api/admin/force-logout-all` (admin-only) destroys all sessions.

### Registration Flow

1. User submits registration form at `POST /api/register` (rate-limited). Optional Cloudflare Turnstile token is verified server-side if `TURNSTILE_ENABLED=true`.
2. Server sends a verification email via Resend (`POST /api/auth/verify-email` confirms the token).
3. Account sits in `pending_registrations` until an admin approves it (`POST /api/admin/registrations/:id/approve`) or rejects it (`POST /api/admin/registrations/:id/reject`).
4. On approval, the server calls `computeApprovalRolesToAdd()` to assign initial roles (`party:*` and `office:backbencher`).

### Roles

Roles are stored as an array of strings on the user record. Valid roles are defined in `server/roles.js`:

| Category | Roles |
|----------|-------|
| System | `admin`, `mod`, `speaker` |
| Party | `party:labour`, `party:conservative`, `party:liberal_democrat` |
| Government offices | `office:prime_minister`, `office:secretary_of_state`, `office:leader_of_opposition`, `office:shadow_secretary_of_state`, `office:leader_of_third_party`, `office:backbencher` |
| Civil service | `office:permanent_secretary`, `office:civil_servant` |

Roles are assigned through the Admin Panel via `POST /api/users/:id/roles` (admin only).

### RBAC Pattern

Permission checks are performed at the route level using middleware guards. The `PERMISSION_MAP` in `server/roles.js` maps named actions to the set of allowed roles, and is served to the frontend via `GET /api/permissions`.

Frontend pages use `js/permissions.js` to drive UI visibility (e.g. showing or hiding edit buttons). `permissions.canManage(data)` is the standard admin/mod/speaker check for resource management.

**Key rule:** `isDevSeedAllowed()` gates 12 destructive endpoints. Any new destructive admin endpoint must call `isDevSeedAllowed()` as its **first** check before any auth guard:

```javascript
function isDevSeedAllowed() {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_SEED === "true";
}
```

### Server-Authoritative Division Weights

The server ignores any client-supplied `weight` for division votes:
- **Formal divisions** (`/api/divisions/:id/vote`): `effective_weight = 1` per character.
- **Bill inline votes** (`PATCH /api/bills/:id/vote`): server computes proportional seat weight using `buildDivisionWeights` logic from the current game state.

---

## 9. Discourse Integration

### Why Discourse

Discourse serves as the out-of-character forum and (optionally) the debate platform for parliamentary proceedings. Two main integration points:

1. **DiscourseConnect SSO** — the simulation is the identity provider. Players log into the simulation and are automatically authenticated into the Discourse forum.
2. **Discourse API** — the backend creates, posts to, and closes Discourse topics for parliamentary debates (bills, motions, statements, regulations).

### SSO Flow

The simulation implements the DiscourseConnect **provider** (Discourse is the consumer):

```
Player clicks "Discourse Forum"
→ GET /api/discourse/go
→ If authenticated: redirect to {forum}/session/sso?return_path=/latest
→ Discourse calls back to GET /api/discourse/sso with signed payload
→ Server verifies HMAC, builds user payload, redirects to return_sso_url
→ Discourse logs player in

If not authenticated:
→ GET /api/discourse/go redirects to /login.html?next=/api/discourse/go
→ After login, flow continues from above
```

The SSO secret is stored in `app_config` (encrypted), not in environment variables. `DISCOURSE_SSO_ENABLED=true` must be set in the environment to activate the SSO endpoints.

### Group Sync

Discourse groups mirror simulation roles via `DISCOURSE_GROUP_MAP` in `server/roles.js`. The mapping:

| Role | Discourse group |
|------|----------------|
| `speaker` | `speaker` |
| `party:labour` | `labour` |
| `party:conservative` | `conservative` |
| `party:liberal_democrat` | `libdem` |
| `office:prime_minister` | `primeminister` |
| `office:leader_of_opposition` | `loto` |
| `office:secretary_of_state` | `government` |
| `office:shadow_secretary_of_state` | `opposition` |
| `office:backbencher` | `backbencher` |
| `office:permanent_secretary` | `civil_service` |
| `office:civil_servant` | `civil_service` |

`admin` and `mod` roles are NOT mapped to Discourse groups — these are conveyed via SSO flags, not the groups API.

Any party role holder who is not admin/mod is auto-added to the `backbencher` group by `computeDiscourseGroups()`.

Group sync is triggered via `POST /api/admin/discourse-sync-groups` (uses `setImmediate`) or through the debounce mechanism (`enqueueDiscourseGroupSync()`) after role changes. The preview of what would sync is available at `GET /api/admin/discourse-sync-preview`.

### Discourse Client Modules

Two modules coexist with slightly different APIs:

**`server/discourse.js`** (object-param style):
```javascript
import { createTopic, closeTopic, buildSsoPayload, resolveGroupIds } from "./discourse.js";
await createTopic({ baseUrl, apiKey, apiUsername, title, raw, categoryId, tags });
```

**`server/discourseClient.js`** (positional-arg style):
```javascript
import { createTopic as dcCreateTopic, withRetry as dcWithRetry } from "./discourseClient.js";
await dcWithRetry(() => dcCreateTopic(baseUrl, apiKey, apiUsername, title, raw, categoryId, tags));
```

`discourseClient.js` is the newer focused client used for debate topic creation. `discourse.js` is the full client used for SSO and group management. Both have `closeTopic` but only the one in `discourse.js` is currently used.

**Rate limiting:** `discourse.js` includes `discourseApiRequest()`, a fetch wrapper with automatic retry on HTTP 429 (reads `extras.wait_seconds` from the Discourse response body, falls back to exponential backoff). Max retries: 10, max total wait: 5 minutes.

### Debate Topics

When a debate is created for a parliamentary entity (`POST /api/debates/create`):
1. Server calls `dcCreateTopic` (with `dcWithRetry` for resilience).
2. `discourse_topic_id` and `discourse_topic_url` are persisted to the entity row AND to its `data` JSONB field (for legacy compatibility).
3. Idempotency: if `discourse_topic_id` already exists, the request is skipped.
4. Debate auto-close: `runDebateAutoClose()` uses `discourse_topic_id` column to find and close topics when the sim-date deadline passes.

---

## 10. Scripts and Tooling

### `scripts/convert-1997-csv.js`

Converts `assets/1997_structured.csv` → `data/constituencies_1997.json`.

```bash
node scripts/convert-1997-csv.js
```

Run after modifying the CSV. Handles party name normalisation, nation/region resolution, and slug generation. The output JSON is consumed by `POST /api/admin/constituencies/initialize-1997`.

### `scripts/render-version-assets.mjs`

Cache-busting script for static assets. Rewrites `href`/`src` references to `styles.css` and `js/main.js` in every `*.html` file to append `?v=<sha>`.

Version source priority:
1. `RENDER_GIT_COMMIT` (set automatically by Render)
2. `GITHUB_SHA` (set by GitHub Actions)
3. `ts<timestamp>` (local fallback)

```bash
# Production build (run by Render)
node scripts/render-version-assets.mjs

# Dry run — shows what would change without writing
node scripts/render-version-assets.mjs --dry-run
```

### `scripts/static-checks.js`

Static analysis CI gate. Runs without a live DB or secrets. Checks:

1. All `POST/PUT/PATCH/DELETE` fetch calls in `js/api.js` use `credentials: "include"`.
2. All non-public `GET` calls use `credentials: "include"`.
3. Every write endpoint in `server/index.js` has an auth check.
4. Motion/EDM update and delete endpoints are staff-only.
5. No player-only pages call `saveState()` without a nearby API write.
6. All server error responses use `{ error: <string> }` shape.
7. No fire-and-forget mutating API calls in any `js/` file.
8. No double-release of pg-pool clients.

```bash
node scripts/static-checks.js
```

Exit code 1 if any check fails. This is run in CI on every push.

### `scripts/audit/feature-manifest.js`

Generates a manifest of all API routes, frontend API functions, and pages. Reports:
- Unmatched write functions (API functions with no matching server route)
- Missing credentials
- Immutability violations
- `saveStateOnly` warnings
- RBAC drift warnings

```bash
node scripts/audit/feature-manifest.js
node scripts/audit/feature-manifest.js --json | python3 -c "
import sys, json; d=json.load(sys.stdin)
print('rbacDriftWarnings:', d['summary']['rbacDriftWarnings'])
"
```

### `scripts/audit/generate-audit-report.mjs`

Generates `scripts/audit/out/audit-report.json` — a comprehensive audit report combining the feature manifest results.

```bash
node scripts/audit/generate-audit-report.mjs
cat scripts/audit/out/audit-report.json
```

### `scripts/test-staging.mjs`

Executable staging integration tests (requires a live backend). Tests:
- **persistence** — create press release → GET list → verify title present
- **immutability** — author PUT on own press item → must return 401/403
- **division.authority** — POST vote with tampered `weight: 9999` → `effective_weight` must be 1
- **division.bill-vote** — PATCH bill vote → `effective_weight` must be server-computed
- **rbac.unauthenticated** — unauthenticated write → must return 401/403
- **rbac.low-priv** (optional) — low-priv write to admin route → must return 401/403

```bash
BASE_URL="https://rulebritannia-app-backend.onrender.com" \
TEST_EMAIL="admin@example.com" \
TEST_PASSWORD="..." \
node scripts/test-staging.mjs
```

---

## 11. Testing

For pre-alpha signoff, run the full verification workflow from the repository root:

```bash
npm run verify:alpha
```

Database target expectations for this workflow:

- **Local dev DB**: use for quick unit iteration and targeted checks.
- **Staging/test DB**: required for meaningful `test:integration:all` results; should mirror alpha schema and key config toggles.
- **Alpha DB**: do **not** run destructive test suites directly; validate on staging/test first, then run manual smoke flows against alpha.


### Unit Tests

Node's built-in test runner is used:

```bash
npm --prefix server run test:unit
```

Unit test files cover core server-side modules without requiring a live database or Discourse instance:

| File | Coverage |
|------|---------|
| `server/clock.test.js` | `computeSimDateFromGameState` — null input, sim-not-started, paused, running |
| `server/discourse.test.js` | DiscourseConnect SSO helpers — HMAC verification, payload building, group management |
| `server/roles.test.js` | `computeDiscourseGroups`, `partyRoleForPartyName`, `computeApprovalRolesToAdd`, `officeRoleFromSpecId` |
| `server/state-contracts.test.js` | `assertSnapshotDerivedTable()`, `stripRelationalKeys()` — state-ownership boundary enforcement |
| `server/service-modules.test.js` | `political-state-service.js` and `division-helpers.js` (34 tests) |
| `server/identity-hardening.test.js` | Immutable identity authority checks (21 tests) |
| `server/recompute-helpers.test.js` | `fireRecompute`/`awaitedRecompute` observability helpers |
| `server/rbac-helpers.test.js` | RBAC guard helper utilities |
| `server/parliamentary-political-state.integration.test.js` | Pure (no-DB) political-state correctness tests |

### Integration Tests

Integration tests require a live PostgreSQL test database. They run against a dedicated test schema created by `createTestSchema()` within the test DB.

```bash
DATABASE_URL=postgres://... NODE_ENV=test npm --prefix server run test:integration:all
```

If `DATABASE_URL` or `NODE_ENV=test` is missing, the preflight check fails with a clear message before test execution.

**Why a wrapper?** The integration runner executes each file in its own `node --test` process. This avoids connection-pool cross-contamination because each file calls `pool.end()` in `after()`.

| File | Coverage |
|------|---------|
| `server/parliamentary.integration.test.js` | Bill lifecycle, amendments, divisions, whipping, rebellions, political state triggers |
| `server/factions.integration.test.js` | Faction CRUD, allocation guards, `computeFactionPoliticalState()`, `getPartyFactionClimate()` |
| `server/finance-parliament.integration.test.js` | Finance config, salary bands, character finance, party finance |
| `server/party-treasury.integration.test.js` | Party treasury, `party_donations` ledger, idempotent fundraising/membership credits |
| `server/guides-seed.test.js` | `seedPredefinedGuides()` idempotency, ordering, insert/update behaviour |
| `server/seed-1997.integration.test.js` | Bodies and locals 1997 seed endpoint, merge vs force behaviour, validation |
| `server/support.integration.test.js` | Support ticket and message lifecycle, status transitions, unread tracking |

**Test schema note:** `createTestSchema()` creates a minimal subset of the production schema. Some production-only constraints (e.g., `CHECK (momentum IN ('rising','stable','falling'))` on `faction_political_state`) are not replicated. Tests and production schemas are not identical.

### Static Analysis

```bash
node scripts/static-checks.js
```

Run this after any change to `js/api.js`, `server/index.js`, or any page JS file to catch credential, auth, and immutability regressions.

### Feature Manifest

```bash
node scripts/audit/feature-manifest.js
```

Run to check for RBAC drift (mismatches between frontend API calls and server routes/protections). The CI workflow uploads the manifest as an artefact.

### Staging Integration Tests

```bash
BASE_URL="..." TEST_EMAIL="..." TEST_PASSWORD="..." node scripts/test-staging.mjs
```

Requires a running backend and valid admin credentials. Optional: `TEST_LOW_EMAIL` / `TEST_LOW_PASSWORD` for Tier 2 RBAC testing.

### API Suite Tests (`tests/api/*.spec.js`)

Require `BASE_URL` and session cookies for multiple roles:

```bash
BASE_URL="https://rulebritannia-app-backend.onrender.com" \
COOKIE_PLAYER="rb.sid=..." \
COOKIE_MOD="rb.sid=..." \
COOKIE_ADMIN="rb.sid=..." \
node --test tests/api/*.spec.js
```

### CI Workflow (`.github/workflows/static-checks.yml`)

Runs on every push and pull request:
1. `node scripts/static-checks.js` — static analysis
2. `node scripts/audit/feature-manifest.js` — RBAC/write-path audit
3. `node --test server/clock.test.js server/discourse.test.js server/roles.test.js server/state-contracts.test.js server/service-modules.test.js server/identity-hardening.test.js server/recompute-helpers.test.js server/rbac-helpers.test.js` — server unit tests
4. Uploads `scripts/audit/rbac-matrix.json` as a workflow artefact (retained 30 days)

Integration tests are not run in CI (require a live database). Run them manually before significant releases.

---

## 12. Development Workflow

### Environment Setup

1. Clone the repository.
2. Set up Postgres (Neon recommended — connection string with `sslmode=require`).
3. Copy `server/.env.example` to `server/.env` and fill in:
   - `DATABASE_URL` — your Postgres connection string
   - `SESSION_SECRET` — a long random string (min 32 chars in production)
   - `NODE_ENV=development` (or omit for permissive mode)
   - Optional: `RESEND_API_KEY`, `EMAIL_FROM`, `TURNSTILE_ENABLED`, Discourse env vars

### Starting the Server

```bash
cd server
node index.js
# or with a PORT override:
PORT=4000 node index.js
```

The server defaults to port 3000.

### Serving the Frontend

The frontend is static HTML. Any static file server works locally:

```bash
# From repo root
npx serve .
# or
python3 -m http.server 8080
```

If the backend is on a different port, set `window.RB_API_BASE` in the browser console or create a local `js/config.js` that sets it.

### Running Scripts

```bash
# Convert constituency CSV (after editing assets/1997_structured.csv)
node scripts/convert-1997-csv.js

# Cache-bust HTML files (dry run)
node scripts/render-version-assets.mjs --dry-run

# Run static checks
node scripts/static-checks.js

# Run feature manifest audit
node scripts/audit/feature-manifest.js
```

### Modifying UI Pages

1. Edit the relevant `*.html` page or `js/pages/*.js` module.
2. Reload the browser — no build step required.
3. Run `node scripts/static-checks.js` to verify no regressions.
4. Run `node scripts/audit/feature-manifest.js` if you added or changed API calls.

### Modifying the Backend

1. Edit `server/index.js` or supporting server modules.
2. Restart the server (`node index.js`).
3. Run `node scripts/static-checks.js`.
4. Run staging tests if you changed auth or RBAC logic.

### Adding a New API Endpoint

1. Add the route in `server/index.js` with appropriate auth middleware.
2. Add the corresponding API function in `js/api.js` (with `credentials: "include"` on all calls).
3. Update `scripts/audit/rbac-matrix.json` if the endpoint has specific RBAC semantics.
4. If the endpoint is destructive/dev-only, call `isDevSeedAllowed()` as the first check.
5. Run `node scripts/static-checks.js` and `node scripts/audit/feature-manifest.js`.

### Cache Busting (Render Deployments)

Render's build command should include:
```bash
node scripts/render-version-assets.mjs
```

This appends `?v=<commit-sha>` to `styles.css` and `js/main.js` references in all HTML files, forcing cache invalidation on deploy.

---

## 13. Security & Hardening

### Alpha Hardening

Before the invited alpha phase, all dangerous dev/admin endpoints were audited for production safety:

**Policy enforced:**

| Endpoint type | Protection |
|---------------|-----------|
| `wipe`, `reset`, `clear`, `seed`, `initialize`, `import`, `repair` | Returns `404` in production unless `ENABLE_DEV_SEED=true` |
| `export`, `force-logout`, `rotate-sessions` | Admin-only in production; never disabled |
| Normal simulation routes | Unaffected |

**12 production-disabled endpoints** are gated by `isDevSeedAllowed()`. The function:
```javascript
function isDevSeedAllowed() {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_SEED === "true";
}
```

> ⚠️ If `NODE_ENV` is unset, `isDevSeedAllowed()` returns `true` (permissive). Always set `NODE_ENV=production` on hosted instances.

### Audit Fixes (B1–B4)

Four blocking issues were identified and resolved before the trial:

| Issue | Fix |
|-------|-----|
| **B1** — Tests were skipped without `BASE_URL` | `scripts/test-staging.mjs` now hard-fails on missing required env vars |
| **B2** — Authenticated `saveState` persisted locally | `saveData()` is permanently disabled; `saveState()` warns and returns for non-staff |
| **B3** — Client-side division weights could be tampered | Server now ignores client `weight`; `effective_weight` is always server-computed |
| **B4** — Feature manifest had unmatched routes | Path matching improved; `PLAYER_ALLOWED` and `PLAYER_IMMUTABLE_ALLOWLIST` updated |

### CSRF

All state-changing requests require an `X-CSRF-Token` header containing the session-scoped token from `GET /api/csrf-token`. The frontend `_fetch()` wrapper automatically refreshes and retries on CSRF failure.

### Rate Limiting

Every route group has a dedicated `express-rate-limit` instance. Auth endpoints (`/api/auth/login`, `/api/register`) are significantly more restricted than read endpoints.

### Remaining Watch Items

- `GET /api/admin/export-snapshot` exposes the full game state. Consider rate-limiting or IP allowlisting in production.
- `NODE_ENV` must be set to `production` on Render; if unset, `isDevSeedAllowed()` permits destructive endpoints.
- `ENABLE_DEV_SEED=true` must **never** be set on a real production instance.

---

## 13a. Working with Political-State Recomputes

Character political state (`character_political_state`) is computed on-demand by `recomputeCharacterPoliticalState(characterId)` in `server/index.js`. This function:
1. Queries offices, press items, scandals, work plans, party roles, and faction climate from the database.
2. Computes `capital_current`, `capital_trend`, `momentum`, `reputation`, and all pressure channels.
3. Upserts the result into `character_political_state`.

**When it is called (event triggers):**
- Division vote cast or updated
- Office assigned or unassigned
- Scandal opened, decided, or closed
- Press item marked (approved coverage)
- Work plan submitted or updated
- Rebel request submitted or decided
- Constituency work plan updated

**Important:** most mutation-triggered calls are intentionally non-blocking (fire-and-forget). The response to the mutation may return before recompute completes, so a follow-up read can briefly show the prior derived values.

The server now standardises these recompute fields via `server/recompute-helpers.js`:
- `type` (e.g. `character-political-state`, `faction-political-state`)
- `triggerSource` (e.g. `division.vote`, `admin.factions.allocation.patch`)
- `target.scope` / `target.id`
- `executionMode` (`async` or `scheduled-freeze`)
- `status` (`queued` or `deferred`)
- `staleReadWindow` (`brief` or `until-next-freeze`)

For user/staff clarity, selected mutation routes now return `recompute` metadata and selected read routes return `recomputeRead` metadata. Treat this as transparency metadata only — it does **not** change recompute semantics.

**Adding a new recompute trigger:** when adding a route that mutates data feeding derived values, call `fireRecompute(...)` (or `awaitedRecompute(...)` when semantically required), and include stable trigger/target context in logs and response metadata.

---

## 13b. State-Ownership Rules

Every developer must respect the state-ownership boundary between snapshot-backed and relational-authoritative systems. Full details are in `docs/state-ownership.md` and `server/state-contracts.js`.

**Golden rule:** Each system has exactly one source of truth. Never add relational-authoritative tables to snapshot flows.

**Relational-authoritative tables** (never in snapshot blobs):
- `divisions`, `division_votes`
- `bill_amendments`, `bill_amendment_supporters`
- `party_factions`, `party_faction_allocations`
- `faction_political_state`
- `character_political_state`
- `character_finance`, `character_additional_revenue`, `finance_config`, `finance_applied`

**When adding a new schema safely:**
1. Add the table to `ensureSchema()` in `server/index.js` with an `IF NOT EXISTS` guard.
2. For additive column changes, use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
3. If the table is relational-authoritative, add it to `RELATIONAL_AUTHORITATIVE_SNAPSHOT_KEYS` in `server/state-contracts.js` if it has a corresponding key in snapshot blobs.
4. If the table is snapshot-derived, add it to `SNAPSHOT_DERIVED_TABLES` in `server/state-contracts.js` and update `syncObjectTables()`.
5. Run `node --test server/state-contracts.test.js` to verify the boundary is not broken.

---

## 13c. Avoiding Name-Based Authority Checks

A previous audit identified fragile name-string comparisons for ownership/authority checks. The codebase now uses immutable character IDs for all authority decisions. **Do not reintroduce name-based checks.**

**Wrong pattern (do not use):**
```javascript
// Fragile: name can change; two characters may share a name
if (char.name === bill.author) { /* grant access */ }
```

**Correct pattern:**
```javascript
// Immutable: character ID cannot change
if (String(charId) === String(bill.author_character_id)) { /* grant access */ }
```

All bill, amendment, and press authority checks now compare `author_character_id` (UUID) against `req.session.characterId`. The pattern is established in the amendment decision, bill withdrawal, and press transcript routes. Follow the same pattern for any new ownership-gated route.

---

### Running Trials

See `docs/trial-runbook.md` for the full checklist. Key points:
- Admin approves registrations via Admin Panel → Pending Registrations.
- Roles (party, office) are assigned via Admin Panel → User Permissions → Edit Roles.
- Content wipe between rounds: Admin Panel → Danger Zone → "Wipe Content" or "Wipe + Seed". Requires typing `WIPE CONTENT` as confirmation.
- User accounts and pending registrations are **never** deleted by the wipe.

### Resetting the Simulation

A content wipe clears: `bills`, `motions`, `statements`, `regulations`, `questiontime_questions`, `press_items`, `polling_entries`. It resets the sim clock to August 1997 (paused) and creates a fresh empty state snapshot. User accounts, audit log, Discourse credentials, and app config are untouched.

### Moderation

- Mods have access to admin panel read operations and moderation-specific endpoints.
- The audit log (`GET /api/audit-log`) records all admin/mod actions with actor, action, target, and details.
- Scandal templates are created and managed by mods via `/api/mod/scandals/*`.

### Managing the Simulation Clock

- `POST /api/clock/tick` — advance the sim by one month (triggers debate auto-close).
- `POST /api/clock/set` — set the sim date directly.
- `GET /api/clock` — read the current sim date.
- The Admin Panel → App Config section provides UI controls.

### DiscourseConnect SSO Setup

1. Set `DISCOURSE_SSO_ENABLED=true` in Render environment.
2. Configure `ui_base_url` in Admin Panel → App Config (the backend's public URL).
3. Configure Discourse base URL, API key, API username, and SSO secret in Admin Panel → Discourse Integration.
4. In Discourse admin: enable `enable_discourse_connect`, set `discourse_connect_url` to `<backend>/api/discourse/sso`, set `discourse_connect_secret` to match.
5. Verify via Admin Panel → SSO Readiness (all checks should show ✅).

---

## 15. Known Limitations

- **No real-time push.** There is no WebSocket or SSE layer. Pages must be manually refreshed to see new content from other players.
- **Single-process server.** The Express server is stateless per request but uses in-memory state for the Discourse sync debounce timer and CSRF tokens. Running multiple instances without a shared store would break these.
- **Monolithic `server/index.js`.** At ~24,700+ lines, the file is large. Several service modules have been extracted (`political-state-service.js`, `division-helpers.js`, `finance-service.js`, `recompute-helpers.js`, `guides-seed.js`) but the majority of routes remain in the main file.
- **Manual sim clock ticking.** The sim clock does not advance automatically. An admin must trigger ticks via the Admin Panel or API.
- **`parsePaginationParams` NaN edge case (untracked bug).** When a non-numeric string is passed as `?limit` or `?offset`, `parseInt("abc", 10)` returns `NaN`, which propagates through `Math.min`/`Math.max`. This affects `GET /api/admin/characters/applications`, `GET /api/civil-service/briefings`, and `GET /api/civil-service/cases`. A fix would add explicit `isNaN` guards in `parsePaginationParams` before the min/max clamp.
- **Concurrent discourse sync race.** The manual `POST /api/admin/discourse-sync-groups` endpoint uses `setImmediate` (not the debounce timer), which can cause concurrent sync jobs if `enqueueDiscourseGroupSync()` fires while that job is queued.
- **`recomputeUserOfficeRoles()` not called on fire/resign.** Office roles are recomputed on assign/unassign but not on government-reset or opposition-reset endpoints.
- **No frontend build pipeline.** Assets are served as-is; cache-busting is a post-process script rather than an integrated build step.
- **Party roles limited to three parties.** `party:labour`, `party:conservative`, `party:liberal_democrat` are the only canonical party roles. Independent and other parties are represented in game state but have no role counterpart.
- **Staging tests require manual credential setup.** The `scripts/test-staging.mjs` tests cannot be run in CI without live session cookies for multiple role tiers.

---

## 16. Future Development Areas

Based on the current codebase, the following areas are natural candidates for expansion:

- **Real-time updates (WebSockets/SSE).** A `socket.io` or native SSE layer would allow division results, clock ticks, and debate posts to push to connected players without manual refresh.
- **Automated clock ticking.** A scheduler (e.g. `node-cron`) or a Render Cron Job could call `POST /api/clock/tick` at configured intervals, removing the need for manual advancement.
- **Server decomposition.** Breaking `server/index.js` into domain-specific route modules (`routes/bills.js`, `routes/motions.js`, etc.) would improve maintainability.
- **Additional party roles.** Extending `PARTY_ROLES` and `DISCOURSE_GROUP_MAP` to support additional parties (SNP, Plaid Cymru, DUP, etc.) as the simulation expands beyond the 1997 big-three.
- **Election simulation engine.** The elections infrastructure (`/api/elections/*`, seat-totals, body management) is present but the simulation of election results (swing modelling, boundary changes) is not yet implemented.
- **Economy simulation.** Economy data is currently a static JSONB document updated manually. A server-side model that computes GDP, inflation, and employment figures from budget decisions and time elapsed would add depth.
- **Automated Discourse group sync on role change.** Currently the sync is manual or debounce-triggered. Integrating a reliable post-role-change sync (with idempotency checks) would keep Discourse groups accurate without admin intervention.
- **Pagination UI in frontend.** The `/api/admin/characters/applications`, `/api/civil-service/briefings`, and `/api/civil-service/cases` endpoints support `?limit`/`?offset` pagination, but the frontend clients do not yet pass these parameters.
- **Comprehensive RBAC E2E test suite.** A full authenticated API test matrix covering all role tiers (backbencher, minister, party leader, chief whip, speaker, mod, admin) would provide ongoing confidence in permission enforcement.
- **Split `discourse.js` / `discourseClient.js`.** The two coexisting client modules should be consolidated into a single well-tested module to reduce confusion and maintenance overhead.
- **Support ticket email notifications.** When a staff member posts a reply to a player's ticket, an email notification should be sent via Resend to inform the player. Similarly, players could optionally receive a notification when a ticket is closed or reopened.
- **Real-time support updates.** The current 25-second polling loop in `js/pages/support.js` is a reasonable alpha approach, but a WebSocket or SSE channel would allow instant delivery of new messages without polling overhead.
- **Support ticket pagination in staff view.** The staff list endpoint (`GET /api/support/staff/tickets`) already supports `?limit` and `?offset`, but the frontend does not yet pass pagination parameters — the staff view loads up to the default page size only.

---

*Document generated from repository inspection. See also: `docs/trial-runbook.md` (operational), `docs/state-ownership.md` (state ownership reference), `docs/archive/` (historical audit records).*
