# Rule Britannia – System Architecture

> **Document status:** Derived from source code as of the current repository HEAD.
> All claims are grounded in observed code; nothing is speculated or invented.

---

## 1. System Purpose

Rule Britannia is a browser-based multiplayer political simulation of the United Kingdom parliament. Players take roles as MPs, cabinet ministers, shadow cabinet ministers, party leaders, or civil servants and participate in a continuously running simulation set in 1997. The simulation includes formal parliamentary procedures (bills, amendments, divisions, motions, statements, question time), party management (leadership elections, whipping, fundraising), a press corps, polling, a public economy, and a budget.

The application is designed for a relatively small player base (tens to low hundreds of concurrent users) organised around a staff/player privilege separation, with admins and moderators controlling the pacing and content of the simulation.

---

## 1a. High-Level Architecture Diagram

The diagram below shows the five architectural layers and their relationships. Read it top-to-bottom: every user action originates in the Client/UI layer and ultimately lands in PostgreSQL, which is the sole authoritative source of truth for all live gameplay state.

```mermaid
flowchart TD
    subgraph CLIENT["Client / UI Layer"]
        direction TB
        PAGES["54 × HTML pages\n(Cloudflare Pages)"]
        JSPAGES["js/pages/* — per-page init modules"]
        APIHELPERS["js/api.js — ~351 API call wrappers\njs/auth.js · js/permissions.js · js/core.js"]
    end

    subgraph API["API Layer  (server/index.js)"]
        direction TB
        ROUTES["~392 Express route handlers"]
        RBAC["Auth / CSRF / Rate-limiting / RBAC guards\n(requireAdmin · requireAdminOrMod · requireAdminModOrSpeaker)"]
    end

    subgraph DOMAIN["Domain Logic Layer"]
        direction TB
        PARL["Parliamentary systems\n(bills · amendments · divisions · motions · statements · QT)"]
        FACTIONS["Faction systems\n(party_factions · faction_political_state)"]
        POLSTATE["Political-state recompute\n(recomputeCharacterPoliticalState)"]
        FINANCE["Finance systems\n(character_finance · finance_config · party treasury)"]
        STAFF["Staff / admin systems\n(civil service · budget · elections · clock)"]
    end

    subgraph PERSIST["Persistence Layer  ★ authoritative source of truth"]
        direction TB
        PG[("PostgreSQL  (Neon)\n~92 tables — auto-bootstrapped by ensureSchema()")]
        RELTABLES["Relational tables (authoritative)\nbills · amendments · divisions · factions\npolitical_state · finance · characters · parties\nconstituencies · sessions · audit_log · …"]
    end

    subgraph DERIVED["Derived State Layer  (secondary / tooling only)"]
        direction TB
        SNAP["state_snapshots  +  app_state_current\n(versioned JSONB blobs — sim-config and bulk objects)"]
        CACHE["Derived-cache tables rebuilt from snapshot\nbills · motions · statements · regulations\nquestiontime_questions\n(syncObjectTables — NOT authoritative)"]
    end

    CLIENT -->|"HTTPS  /api/*  +  CSRF token"| API
    API --> DOMAIN
    DOMAIN -->|"reads / writes"| PERSIST
    DOMAIN -.->|"snapshot write/restore triggers\nsyncObjectTables() only"| DERIVED
    DERIVED -. "never overwrites\nauthoritative tables" .-> PERSIST
```

**Data flow summary:** A player action in the browser calls a wrapper in `js/api.js`, which sends an authenticated, CSRF-protected `fetch` request to an Express route in `server/index.js`. The route enforces RBAC, executes domain logic (parliamentary, faction, political-state, finance, or staff/admin), and reads/writes directly to PostgreSQL — the sole authoritative store for all live gameplay state. A small set of snapshot and derived-cache operations (`syncObjectTables`, snapshot restore) exist as operational tooling; they operate on a separate JSONB snapshot layer and are explicitly prevented from overwriting the relational-authoritative tables by `server/state-contracts.js`.

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (53 × .html pages + vanilla ES2020+ JS, no bundler)    │
│  www.rulebritannia.org  (Cloudflare Pages)                      │
└────────────────────────┬────────────────────────────────────────┘
                         │  /api/*  (relative, same-origin)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Cloudflare Worker  (worker/index.js)                           │
│  Route: rulebritannia.org/api/*                                 │
│                                                                 │
│  Cloudflare Pages Function  (functions/api/[[path]].js)         │
│  Route: www.rulebritannia.org/api/*  (always-on fallback)       │
└────────────────────────┬────────────────────────────────────────┘
                         │  HTTPS  (credential-passthrough proxy)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Express Server  (server/index.js, Node ≥ 18)                   │
│  Hosted: Render  (https://rulebritannia-app-backend.onrender.com)│
│  ~21,000 lines · 392 registered route handlers                  │
│  Auth · CSRF · Sessions · Rate-limiting · RBAC                  │
│  Email (SendGrid) · Discourse API · Cloudflare Turnstile        │
└────────────────────────┬────────────────────────────────────────┘
                         │  node-postgres (pg)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  PostgreSQL  (Neon recommended)                                  │
│  ~92 tables, auto-bootstrapped by ensureSchema() on startup     │
└─────────────────────────────────────────────────────────────────┘
```

**Key design decisions:**

- No frontend bundler — HTML pages served directly by Cloudflare Pages; ES modules used natively by the browser.
- Single global CSS file (`styles.css`) with CSS custom properties for theming.
- Backend is a single large Express module (`server/index.js`). All database schema is defined and migrated via `ensureSchema()` called at startup.
- All API calls from the frontend use relative `/api/...` paths. The Cloudflare edge layer proxies them to the Render origin, transparent to the browser.
- Session cookies are set with `domain=".rulebritannia.org"` so they are valid on both the bare domain and `www`.

---

## 3. Major Components

### 3.1 API Server (server/index.js)

**Location:** `server/index.js`  
**Size:** ~21,000 lines, 392 route handlers  
**Runtime:** Node.js ≥ 18, ES module format (`"type": "module"`)

**Framework and middleware stack (in order):**

| Layer | Implementation |
|---|---|
| HTTP framework | Express 4.x |
| JSON body parser | `express.json({ limit: "2mb" })` |
| CORS | `cors` package, credentials-aware, origin allow-list |
| Sessions | `express-session` backed by `connect-pg-simple` (PostgreSQL `sessions` table) |
| CSRF protection | Custom synchronizer-token middleware (`verifyCsrfToken`) — per-session token, `timingSafeEqual` comparison, applied to POST/PUT/PATCH/DELETE |
| Rate limiting | `express-rate-limit`, multiple named limiters per endpoint group |
| Bot protection | Cloudflare Turnstile token verification on registration |

**CORS allow-list (hard-coded):**
```
https://rulebritannia.org
https://www.rulebritannia.org
https://rulebritannia-app.onrender.com
https://rulebritannia-app-backend.onrender.com
```

**Auth middleware helpers** (defined at line ~3843):

| Function | Behaviour |
|---|---|
| `requireAuth(req, res)` | Returns 401 if `req.session.userId` is absent; used inline in handlers |
| `requireAdmin(req, res)` | 401 if not logged in; 403 if `roles` array lacks `"admin"` |
| `requireAdminOrMod(req, res)` | 401 / 403 unless `"admin"` or `"mod"` role present |
| `requireAdminModOrSpeaker(req, res)` | 401 / 403 unless `"admin"`, `"mod"`, or `"speaker"` role present |

**Production guard:**

```js
function isDevSeedAllowed() {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_SEED === "true";
}
```

Twelve destructive/seed/wipe endpoints return `404` in production unless `ENABLE_DEV_SEED=true` is set explicitly (e.g., on a staging environment).

**Discourse credential encryption:**  
Discourse API key and SSO secret are stored encrypted in the `app_config` PostgreSQL table using AES-256-GCM. The encryption key is derived from `SESSION_SECRET` via `scryptSync` (salt `"rb-discourse-v1"`) unless `DISCOURSE_ENCRYPTION_KEY` is provided explicitly as a 64-char hex string.

**Schema bootstrap:**  
`ensureSchema()` is called once at server startup and creates all tables if missing, then applies idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migrations. No external migration tool is used.

**Email:**  
Verification emails are sent via SendGrid (`@sendgrid/mail`). If `SENDGRID_API_KEY` is absent, the email step is skipped with a console warning (email verification is not enforced as a hard gate in development).

**Complete API endpoint surface** (grouped by resource):

| Group | Paths |
|---|---|
| Health | `GET /health`, `GET /api/health` |
| Permissions / CSRF | `GET /api/permissions`, `GET /api/csrf-token` |
| Bootstrap | `GET /api/bootstrap` |
| Auth | `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout` |
| Registration | `POST /api/register`, `GET /api/auth/verify-email`, `POST /api/auth/resend-verification` |
| Admin – registrations | `GET`, `POST /:id/approve`, `POST /:id/reject` under `/api/admin/registrations` |
| State / snapshots | `GET /api/state`, `POST /api/state`, `GET/POST /api/snapshots`, `POST /api/snapshots/:id/restore` |
| Config | `GET/PUT /api/config`, `GET /api/config/enums` |
| Mods message | `GET/POST /api/mods-message` |
| Discourse | `GET/PUT /api/discourse/config`, `POST /api/discourse/test`, `GET /api/discourse/sso`, `GET /api/discourse/sso/callback`, `GET /api/discourse/go`, SSO readiness, sync-preview, sync-groups, sync-bills, sync-debates, category IDs |
| Audit log | `GET/POST /api/audit-log` |
| Bills | `GET /api/bills`, `GET/PUT/DELETE /api/bills/:id`, `POST /api/bills`, lifecycle actions (`/first-reading`, `/report`, `/withdraw`, `/assent`, `/final-division`), amendments (`/amendments`, `/amendments/:aid/decide`, `/amendments/:aid/support`), `PATCH /api/bills/:id/vote` (server-authoritative) |
| Motions | `GET/POST /api/motions`, `GET/PUT/DELETE /api/motions/:id`, `POST /api/motions/:id/sign`, `POST /api/motions/:id/npc-sign` |
| Statements | `GET /api/statements`, `GET/PUT/DELETE /api/statements/:id`, `POST /api/statements` |
| Regulations | `GET /api/regulations`, `GET/PUT/DELETE /api/regulations/:id`, `POST /api/regulations` |
| Question Time (simple) | `GET/POST /api/questiontime-questions`, `GET/PUT/DELETE /api/questiontime-questions/:id` |
| Question Time (rich) | `GET/POST /api/qt/questions`, `GET /api/qt/questions/:id`, `/answer`, `/followup`; `GET /api/qt/followups/:id` |
| Clock | `GET /api/clock`, `POST /api/clock/tick`, `POST /api/clock/set`; also `GET /api/sim`, `POST /api/sim/tick`, `POST /api/sim/set` (aliases) |
| Press | `GET/POST /api/press`, `GET/PUT/DELETE /api/press/:id`, `PATCH /api/press/:id/transcript`, `POST /api/press/:id/mark` |
| Polling | `GET/POST /api/polling`, `GET/PUT/DELETE /api/polling/:id` |
| Debates (Discourse) | `POST /api/debates/create`, `GET /api/debates/payload/:entityType/:entityId` |
| Roles | `GET /api/me/roles`, `POST /api/users/:id/roles` |
| Characters | `GET /api/characters`, `GET /api/characters/mine`, `GET/PATCH /api/characters/:id`, `POST /api/characters`, `POST /api/characters/select`, `POST /api/characters/apply`, `POST /api/characters/apply-npc`, `PATCH /api/me/absent`, bio/avatar/profile change workflows |
| Admin – characters | Applications (approve/reject), profile overrides, set-inactive, assign-owner, assign-npc-manager, active-character |
| Property (mod) | `POST /api/mod/property/set` |
| Whip | Withdraw/restore whip, whip requests (approve/deny), per-party |
| Parties | `GET /api/parties/canonical`, `GET /api/parties/:partyId`, structure, leader, chief-whip, leadership election (open/nominate/vote/runoff/close), expulsions, membership-fee, donations, shop-purchases, treasury, drafts |
| Finance (player) | `GET /api/me/finance`, `GET /api/me/finance/summary`, `POST /api/me/character/shop-purchases` |
| Finance (admin) | Set-bank, set-salary-override, set-positions, revenue CRUD, salary-scales uprate, `GET/PATCH /api/admin/finance/config`, salary-bands, starting-balances, apply-inflation |
| Shop | `GET /api/shop/price-index`, `POST /api/shop/apply-inflation`, `POST /api/finance/shop-upkeep` |
| Scandals | Opt-in, mine, choose, situation respond |
| Admin – maintenance | clear-cache, rebuild-cache, rotate-sessions, force-logout-all, close-stale-divisions, close-orphan-motion-divisions, export-snapshot, import-snapshot, reset-baseline, wipe-content, wipe-with-characters, seed, seed-demo, repair/character-owner-pointers |
| Admin – elections | `POST /api/admin/elections/seed-1997` |
| Constituencies | `POST /api/admin/constituencies/initialize-1997`, `DELETE /api/admin/constituencies/clear` |
| Budget | `GET /api/budget`, `POST /api/admin/budget/seed`, `PUT /api/admin/budget/controls`, `POST /api/budget/draft`, `POST /api/admin/budget/approve`, `POST /api/admin/budget/reject` |
| Parliament status | `GET/PUT /api/parliament/status` |
| Profile / Team | `GET /api/profile`, `GET /api/team` |
| Affiliations | `GET/POST /api/me/character/:id/affiliations`, `GET /api/control-panel/affiliations/pending`, `POST /api/control-panel/affiliations/:rid/decide` |
| Admin – users | `GET /api/admin/users`, `GET /api/admin/characters`, assign-owner, active-character, assign-npc-manager |
| Admin – playerbase / dashboard | `GET /api/admin/playerbase`, `GET /api/admin/dashboard` |
| Admin – economy | `GET/PUT /api/admin/economy` |
| Red Lion | `GET/POST /api/redlion`, `DELETE /api/redlion/:id` |
| Events | `GET/POST /api/events`, `PUT/DELETE /api/events/:id` |
| Online status | `GET/POST /api/online`, `DELETE /api/online/:id`, `PATCH /api/online/settings`, `PATCH /api/online/:id` |
| Fundraising | `GET/POST /api/fundraising`, `PUT/DELETE /api/fundraising/:id`, `POST /api/fundraising/:id/credit-party`, `POST /api/fundraising/:id/credit-character` |
| News | `GET/POST /api/news`, `PATCH/DELETE /api/news/:id`, comments (CRUD, report), reply-requests |
| Rules / Guides | `GET/POST/PATCH/DELETE /api/rules`, `GET/POST/PATCH/DELETE /api/guides` |
| Civil service | Briefings (GET/POST/PATCH/DELETE), cases (GET/POST/PATCH/DELETE) |
| Bodies | `GET /api/bodies`, `PUT /api/bodies/:id` |
| Papers | `GET /api/papers`, articles CRUD, comments, submissions (full lifecycle) |
| Cabinet / Shadow cabinet | `GET/PUT /api/cabinet/headline`, `GET/PUT /api/shadowcabinet/headline`, `/drafts` endpoints, opposition reshuffle |
| Privy council | `GET /api/privy-council`, `GET/POST /api/privy-council/posts`, `DELETE /api/privy-council/posts/:id` |
| Locals | `GET/PUT /api/locals` |
| Support (player) | `GET /api/support/tickets`, `POST /api/support/tickets`, `GET /api/support/tickets/:id`, `POST /api/support/tickets/:id/messages`, `PATCH /api/support/tickets/:id` |
| Support (staff) | `GET /api/support/staff/tickets` (paginated, filterable by status/label), `GET /api/support/staff/tickets/:id`, `POST /api/support/staff/tickets/:id/messages`, `PATCH /api/support/staff/tickets/:id` |

### 3.1a Server-Side Service Modules

High-value business logic has been extracted from `server/index.js` into focused service/helper modules under `server/`. All exports are ES-module named exports; DB-dependent functions import `pool` from `./db.js`.

| Module | Exports | Purpose |
|---|---|---|
| `server/political-state-service.js` | `FACTION_PLAYABLE_PARTIES`, `clamp100`, `pressureLabel`, `recomputeCharacterPoliticalState`, `computeFactionStrength`, `computeFactionCohesion`, `computeLeadershipPressure`, `computeFactionPoliticalState`, `getPartyFactionClimate`, `seed1997Factions` | All character and faction political-state computation. Formula weights are documented inline. |
| `server/division-helpers.js` | `SPEAKER_PARTY_RE`, `SINN_FEIN_PARTY_RE`, `RH_QUALIFYING_SPEC_IDS`, `PC_QUALIFYING_SPEC_IDS`, `getPartySeatsFromConstituencies`, `getPartiesRankedBySeats`, `getThirdPartySlug`, `getCharacterParliamentaryMeta`, `formatParliamentaryName`, `getCharacterDisplayName`, `batchGetCharacterDisplayNames`, `enrichCharacterRowWithDisplay`, `batchEnrichCharacterRows`, `computeAllPlayerWeights`, `computeCharacterWeight`, `computeDivisionTallyFromDb` | Division vote-weight computation, parliamentary display-name enrichment, and seat helpers. |
| `server/finance-service.js` | `resolveActiveSalaryScale`, `computeCharacterAnnualSalary`, `resolvedAnnualSalary` | Salary scale resolution and per-character annual salary computation (override-first). |
| `server/rbac-helpers.js` | `getSessionRoles`, `hasAdminOrMod`, `hasAdminModOrSpeaker` | RBAC helpers replacing inline `Array.isArray(req.session.roles)` patterns. |
| `server/recompute-helpers.js` | `fireRecompute`, `awaitedRecompute` | Structured logging wrapper for political-state and salary recompute triggers; accepts optional `entityId` for per-entity log correlation. |
| `server/roles.js` | `ALL_VALID_ROLES`, `PARTY_ROLES`, `PERMISSION_MAP`, and Discourse group helpers | Role constants, PERMISSION_MAP, and Discourse group mapping. |
| `server/state-contracts.js` | `SNAPSHOT_DERIVED_TABLES`, `assertSnapshotDerivedTable`, `stripRelationalKeys` | Runtime source of truth for state-ownership boundaries. |

**Not yet extracted (post-alpha candidates):**
- `runSalaryCrediting`, `runShopUpkeep`, `runRevenuePayouts`, `runMembershipIntake` — clock-tick runners; depend on `writeAuditLog` (still inline in `index.js`); worth extracting once `writeAuditLog` is modularised.
- `writeAuditLog` itself — called from ~100 route handlers; extraction requires a separate pass.

### 3.2 Simulation Clock (server/clock.js)

**Location:** `server/clock.js`  
**Mirrored in:** `js/clock.js` (client-side, identical algorithm)

The simulation runs at a compressed timescale where every Monday and every Thursday in real time marks the start of a new simulation month. Sunday is frozen (no new sim month begins on a Sunday).

**Core function:**

```js
computeSimDateFromGameState(gameState, now = new Date())
// Returns: { month: number (1–12), year: number }
```

**Algorithm:**

1. If the sim has not started (`gameState.started === false`), return `{startSimMonth, startSimYear}`.
2. If the sim is paused (`gameState.isPaused`), substitute `pausedAtRealDate` for the current date.
3. Count the number of Mondays (weekday 1) and Thursdays (weekday 4) in the half-open interval `(startRealDate, now]` using O(1) arithmetic (full weeks × 1 + remainder day scan).
4. Add `simMonthsElapsed` to the starting month, rolling over years.

**Persistence:** The clock state (`started`, `startRealDate`, `startSimMonth`, `startSimYear`, `isPaused`, `pausedAtRealDate`) is stored in the `sim_clock` table and surfaced via `GET /api/clock`. Admin endpoints (`POST /api/clock/tick`, `POST /api/clock/set`) allow manual advancement or override.

**Rate:** `POST /api/clock/tick` advances the sim by the configured `monthsPerTick` (defaults to 1). The real-world Monday/Thursday boundary mechanism means the sim advances automatically without a cron job — the server re-derives the current sim date on every request using `computeSimDateFromGameState`.

### 3.3 Data Layer (server/db.js)

**Location:** `server/db.js`

Exports a single `pool` instance (node-postgres `Pool`) shared across all route handlers in `server/index.js`.

**Configuration:**

- `DATABASE_URL` from environment (required).
- SSL is enabled when the URL contains an explicit `sslmode` query parameter, or the hostname contains `neon.tech`.
- Pool: `max: 10`, `idleTimeoutMillis: 30_000`, `connectionTimeoutMillis: 5_000`.

**Database tables** (92 tables, all created by `ensureSchema()`):

| Category | Tables |
|---|---|
| Core state | `app_state`, `app_state_current`, `state_snapshots`, `app_config`, `sessions` |
| Users | `users`, `user_roles`, `pending_registrations` |
| Characters | `characters`, `offices`, `office_assignments`, `office_assignment_history`, `pending_character_applications`, `pending_bio_changes`, `pending_avatar_changes`, `pending_profile_changes`, `character_affiliations`, `affiliations_catalog`, `character_work_plans` |
| Parliament | `bills`, `bill_amendments`, `bill_amendment_supporters`, `bill_stage_reports`, `bill_opposition_quota`, `motions`, `statements`, `regulations`, `questiontime_questions`, `qt_questions`, `qt_answers`, `qt_followups`, `divisions`, `division_votes`, `division_party_instructions`, `division_rebellion_log`, `division_rebel_requests`, `parliament_status` |
| Parties | `parties`, `whip_withdrawal_requests`, `party_leader_elections`, `party_leader_election_nominations`, `party_leader_election_votes`, `party_expulsion_requests`, `party_donations`, `party_shop_purchases`, `frontbench_reshuffles`, `group_drafts` |
| Clock | `sim_clock`, `sim_state` |
| Press / Media | `press_items`, `news_stories`, `news_story_comments`, `news_reply_requests`, `newspaper_articles`, `paper_article_comments`, `paper_submissions` |
| Finance | `character_finance`, `character_positions`, `character_additional_revenue`, `character_shop_purchases`, `character_shop_revenue_payouts`, `salary_scales`, `salary_scale_roles`, `fundraising_items`, `finance_config`, `finance_applied`, `budget_data` |
| Shop | `shop_price_index` |
| Polling | `polling_entries` |
| Discourse | (topic IDs stored as columns on `bills`, `motions`, `statements`, `regulations`) |
| Scandals | `scandals`, `scandal_templates`, `scandal_situations`, `scandal_player_choices`, `scandal_mod_decisions`, `scandal_opt_in` |
| Elections | `elections`, `election_party_summary`, `election_constituency_results`, `election_constituency_changes`, `constituency_events`, `app_state_elections` |
| Constituencies | `constituencies` |
| Other | `audit_log`, `online_posts`, `redlion_posts` (via `redlion` table), `events` (via `events_list`), `bodies_data`, `rules_items`, `guides_items`, `cs_briefings`, `cs_cases`, `privy_council_members`, `privy_council_posts`, `support_tickets`, `support_messages` |

### 3.4 Worker Process (worker/index.js)

**Location:** `worker/index.js`  
**Platform:** Cloudflare Worker  
**Deployment:** via `wrangler deploy` (configuration in `wrangler.toml`)  
**Route:** `rulebritannia.org/api/*`

The worker is a thin reverse proxy with two responsibilities:

1. **API proxy:** All `/api/*` requests (any method) are forwarded to `https://rulebritannia-app-backend.onrender.com`, preserving headers and body. GET/HEAD requests never carry a body (HTTP spec compliance). The proxy check is placed *before* the bare-domain redirect to prevent `GET /api/*` bootstrap requests from being redirected cross-origin before reaching the backend (which would break session-cookie forwarding and CSRF checks).

2. **Canonical domain redirect:** Non-API `GET`/`HEAD` requests to `rulebritannia.org` (bare domain) are redirected `308` to `www.rulebritannia.org`. This ensures DiscourseConnect SSO callbacks land on the canonical origin.

3. **Health check:** `GET /api/worker-test` returns `"WORKER_OK rb-api-proxy"` without proxying.

```toml
# wrangler.toml
name = "rb-api-proxy"
main = "worker/index.js"
compatibility_date = "2026-02-24"
workers_dev = false

[[routes]]
pattern = "rulebritannia.org/api/*"
zone_name = "rulebritannia.org"
```

### 3.5 Discourse Integration (server/discourse.js + server/discourseClient.js)

**Location:** `server/discourse.js`, `server/discourseClient.js`

Rule Britannia integrates with a Discourse forum instance for threaded debate. The integration has two modes:

**DiscourseConnect SSO (SIM is provider):**
- Players sign in to the SIM → click "Discourse Forum" → arrive on Discourse already authenticated.
- SSO flow: `GET /api/discourse/sso` builds an HMAC-signed payload; `GET /api/discourse/sso/callback` verifies Discourse's response and sets the session.
- `GET /api/discourse/go` redirects the logged-in player directly to Discourse with a pre-signed SSO URL.
- SSO secrets stored encrypted (AES-256-GCM) in `app_config`.
- `verifyConsumerRequest`, `buildConsumerResponse`, `buildSsoPayload`, `verifySsoPayload` are pure helpers imported from `server/discourse.js`.

**Discourse topic creation (SIM → Discourse):**
- When a bill, motion, statement, or regulation is advanced to a suitable stage, the server creates a Discourse topic via the API and stores `discourse_topic_id` / `discourse_topic_url` back on the entity row.
- `server/discourse.js` exposes: `createTopic()`, `createTopicWithRetry()`, `closeTopic()`, `createPost()`, `resolveGroupIds()`, `getGroupMembers()`, `addGroupMembers()`, `removeGroupMembers()`.
- `server/discourseClient.js` is a stateless lower-level client with positional-arg signatures, used directly in some endpoints for fine-grained control.
- Retry strategy: exponential back-off; does not retry definitive 4xx errors except 429 (rate-limit).
- Credentials (API key, username, base URL) are injected at call-time from the decrypted `app_config` values.

**Discourse group sync:**
- `GET /api/admin/discourse-sync-preview` computes the expected group memberships without applying them.
- `POST /api/admin/discourse-sync-groups` applies the sync.
- Group sync is disabled by default; toggled in Admin Panel.
- Mapping defined in `server/roles.js` `DISCOURSE_GROUP_MAP`.

---

## 4. Frontend Architecture

**Delivery:** Cloudflare Pages (static hosting), URL `https://www.rulebritannia.org`.  
**Pages:** 54 `.html` files, each a self-contained multi-page application route.  
**Styling:** Single `styles.css` with CSS custom properties.  
**JavaScript:** ES2020+ modules, no bundler, no framework. Loaded with `<script type="module">`.

**JS module structure (`js/`):**

| Module | Responsibility |
|---|---|
| `main.js` | Top-level entry point, router for 38+ page-specific init modules |
| `api.js` | ~351 typed wrappers around every backend endpoint (~3,421 lines); manages CSRF token cache and one-shot 403-retry |
| `core.js` | Boot sequence (`bootData()` → `GET /api/bootstrap`), `getState()`, `saveState()`, `ensureDefaults()`, `deepFreeze()` for demo mode |
| `auth.js` | `requireLogin()`, `requireAdmin()` — redirect guards |
| `ui.js` | Navigation, HTML-escaping, modals, toast notifications |
| `clock.js` | Client-side sim date computation (mirrors `server/clock.js`); `getSimDate()`, `formatSimMonthYear()`, `countdownToSimMonth()`, `realDateOfSimMonth()` |
| `permissions.js` | Client-side role/office checks against `PERMISSION_MAP` |
| `divisions.js` | Vote weight computation: `buildDivisionWeights()`, `currentCharacterWeight()`, `tallyDivisionVotes()` |
| `bill-drafting.js` | Bill text parser/formatter; `renderDraftingBuilder()`, `parseDraftingForm()`, department/extent/commencement enums |
| `character-enums.js` | Education/career/family dropdown enum fallbacks |
| `constituency-utils.js` | `seatTaken()`, `allConstituenciesForPartyWithStatus()`, `renderConstituencyOptions()` |
| `audit.js` | Fire-and-forget audit log wrapper (`logAction()` → `POST /api/audit-log`) |
| `components/` | Reusable UI components: form-row, modal, tile, toast |
| `engines/` | Game logic modules (economy, elections, etc.) |
| `pages/` | 40+ per-page init modules loaded by `main.js` |

**Boot sequence (authenticated user):**

```
page load
  → main.js
    → bootData() → GET /api/bootstrap
        returns: { user, roles, character, clock, config, state }
    → applyBootstrapParliament(state)    // rebuild party data from DB
    → ensureDefaults(state)              // inject missing top-level keys
    → page-specific init module
```

**Boot sequence (unauthenticated / demo mode):**

```
page load
  → main.js
    → getState() → GET /data/demo.json  // read-only static file
    → deepFreeze(state)                 // prevent accidental mutation
    → page-specific init module
```

**CSRF handling in api.js:**

```
_csrfToken (module-level cache)
  → populated by apiGetCsrfToken() → GET /api/csrf-token
  → injected as X-CSRF-Token header on all mutating requests
  → on 403 response: token refreshed once and request retried
```

**Key HTML pages:**

| Page | Purpose |
|---|---|
| `index.html` | Landing / marketing |
| `login.html`, `register.html`, `verify-email.html` | Auth flow |
| `dashboard.html` | Player home / character office |
| `admin-panel.html` | Admin tools (1,920 lines) |
| `control-panel.html` | Mod/speaker tools (952 lines) |
| `submit-bill.html`, `bill.html` | Bill drafting and reading |
| `motions.html`, `motion.html` | Motions and EDMs |
| `hansard.html` | Formal division records |
| `statements.html`, `statement.html` | Ministerial/opposition statements |
| `questiontime.html` | Question Time proceedings |
| `regulations.html` | Statutory instruments |
| `government.html`, `opposition.html`, `cabinet.html`, `shadowcabinet.html` | Executive structure |
| `party.html` | Party management |
| `elections.html` | Party leadership elections |
| `press.html` | Press items and transcripts |
| `polling.html` | Polling data |
| `economy.html` | Public economic data |
| `budget.html` | Budget drafting and approval |
| `civilservice.html` | Civil service briefings and cases |
| `constituencies.html` | Constituency data |
| `bodies.html` | Constitutional and advisory bodies |
| `redlion.html` | Informal social space |
| `online.html` | Player presence board |
| `news.html`, `papers.html` | In-game media |
| `profile.html`, `user.html` | Character and user profiles |
| `playerbase.html` | Admin player list |
| `privacy.html`, `terms.html`, `rules.html`, `guides.html` | Legal / meta |

---

## 5. Simulation Domain Model

**Characters vs. Users:**  
A `user` is an account (email, password hash, verified flag, roles). A `character` is the in-game persona played by that user. A user may have at most one active character. Characters have a name, party, constituency, bio, avatar, and a set of office assignments.

**Offices and office assignments:**  
`offices` defines the catalogue of government and opposition positions (Prime Minister, Secretary of State, Leader of the Opposition, etc.). `office_assignments` links a character to an office for a period; `office_assignment_history` tracks past assignments.

**Bills lifecycle:**
```
draft → first reading → committee/report stage → final division → Royal Assent
```
Each stage transition is a separate API call. Amendments can be submitted during report stage, with author accept/reject and supporter sign-on. The `PATCH /api/bills/:id/vote` endpoint is server-authoritative: it ignores the client's claimed `effective_weight` and recomputes it server-side.

**Divisions:**  
`divisions` records a formal parliamentary vote. `division_votes` records each member's vote (aye/no/abstain) with `effective_weight` (server-computed, 1 per character). `divisions.immutable_result` is written once at close and cannot be changed. `division_party_instructions` records the whip. `division_rebellion_log` records rebels.

**Motions and EDMs:**  
Simple text items that players can sign. `motions/:id/sign` is player-accessible (allowed without staff role). NPC signing via `motions/:id/npc-sign`.

**Question Time:**  
Two parallel implementations: the legacy `questiontime_questions` table and the richer `qt_questions`/`qt_answers`/`qt_followups` schema used by the current `qt/*` endpoints.

**Parties:**  
`parties` table stores the canonical party list. Party roles (`party:labour`, etc.) are stored in `user_roles`. Leadership elections run through a full workflow: open → nominate → vote → optional runoff → close.

**Finance and shop:**  
Characters have a `character_finance` record (salary, bank balance). `character_positions` defines salary rates per office. `shop_price_index` tracks purchasable items with inflationary adjustments. `fundraising_items` support party fundraising events. `character_shop_purchases` and `party_shop_purchases` record transactions.

**Factions and faction political state:**  
`party_factions` stores intra-party ideological groupings with fields: `slug`, `name`, `description`, `alignment` (`aligned`/`hostile`/`neutral`), `rebellion_bias`, `mp_count`, `influence_bonus`. `party_faction_allocations` records editable allocation data (MP count, influence bonus, notes). `faction_political_state` stores the computed state per faction: `internal_power`, `momentum` (`rising`/`stable`/`falling`), `leadership_pressure`, `cohesion`, and a JSONB `breakdown`. Computed by `computeFactionPoliticalState()` and `getPartyFactionClimate()`.

**Character political state:**  
`character_political_state` stores per-character computed state: `capital_current`, `capital_trend`, `momentum`, `reputation`, `breakdown` (JSONB array of contributing factors), plus pressure channel columns: `party_pressure`, `constituency_pressure`, `media_pressure`, `group_pressure`, `institutional_pressure`, `rebellion_risk`. Computed by `recomputeCharacterPoliticalState()`, called non-blocking from event triggers (division vote, office assignment, scandal, press mark, work plan update, etc.).

**Recompute timing caution:** `recomputeCharacterPoliticalState()` is always called with `.catch()` in a fire-and-forget pattern. State values may be briefly stale immediately after a triggering action. Do not rely on the return value of the triggering route for freshly-computed political state — fetch it separately if needed.

**Finance:**  
`finance_config` stores global salary bands and starting balance parameters. `character_finance` stores per-character salary, bank balance, and additional revenue. `character_positions` defines salary rates per office spec. `finance_applied` tracks when finance was last computed. `character_additional_revenue` records supplemental revenue sources.

**Scandals:**  
Template-driven scandal system: `scandal_templates` → `scandal_situations` → `scandals` (per-player instances) → `scandal_player_choices` / `scandal_mod_decisions`.

**Elections (general/by-election):**  
`elections` / `election_party_summary` / `election_constituency_changes` support constituency-level election results. Seeded from 1997 data.

**Press:**  
`press_items` with transcript support and mark/unmark (read/unread tracking). `news_stories` and `newspaper_articles` for in-game newspapers.

**Privy Council:**  
`privy_council_members` and `privy_council_posts` for a restricted discussion area.

---

## 5a. State-Ownership Rules

The application stores gameplay state in two complementary ways. **Each system has exactly one source of truth.**

| Storage layer | Purpose |
|---|---|
| `state_snapshots` / `app_state_current` | Versioned JSONB blobs for sim-config and bulk objects (bills, motions, statements, regulations, QT questions) |
| Dedicated relational tables | Live gameplay systems with their own dedicated API routes and DB tables |

### What is snapshot-backed

The following data is stored in `state_snapshots.data` (JSONB) and served via `GET /api/state`:

- `gameState` — simulation clock config, pause flag, start month/year
- `orderPaperCommons[]` — bills on the order paper (derived-cache also in `bills` table)
- `motions.house[]` / `motions.edm[]` — motions and EDMs (derived-cache in `motions` table)
- `statements.items[]` — ministerial statements (derived-cache in `statements` table)
- `regulations.items[]` — statutory instruments (derived-cache in `regulations` table)
- `questionTime.questions[]` — QT questions (derived-cache in `questiontime_questions` table)
- Supporting data: `papers`, `news`, `polling`, `economy`, `parliament`, etc.

The `bills`, `motions`, `statements`, `regulations`, and `questiontime_questions` relational tables are **derived caches** rebuilt from the snapshot by `syncObjectTables()`. They are not the source of truth; the snapshot blob is.

### What is relational-authoritative

These systems are managed exclusively through their dedicated API routes and relational tables, and are **never stored in or rebuilt from the snapshot**:

| System | Table(s) |
|---|---|
| Divisions | `divisions`, `division_votes` |
| Bill amendments | `bill_amendments`, `bill_amendment_supporters` |
| Factions | `party_factions`, `party_faction_allocations` |
| Faction political state | `faction_political_state` |
| Character political state | `character_political_state` |
| Finance | `character_finance`, `character_additional_revenue`, `finance_config`, `finance_applied` |

Any attempt to add these tables to `syncObjectTables()` or any snapshot import/rebuild flow must be treated as a **bug** — it would create a competing source of truth for live gameplay systems.

### Runtime enforcement

`server/state-contracts.js` is the runtime source of truth for state-ownership boundaries:
- `SNAPSHOT_DERIVED_TABLES` — allowlist of tables that may be written from snapshot data
- `RELATIONAL_AUTHORITATIVE_SNAPSHOT_KEYS` — keys that must not appear in snapshot blobs
- `assertSnapshotDerivedTable(tableName)` — throws if a table is not on the allowlist
- `stripRelationalKeys(data)` — removes relational-authoritative keys before saving a snapshot

`POST /api/state` and `POST /api/snapshots` both call `stripRelationalKeys()` before writing. `syncObjectTables()` calls `assertSnapshotDerivedTable()` for each table it writes. See `server/state-contracts.test.js` for the unit tests.

### Snapshot tooling limitations

- **Snapshot restore does not rebuild relational data.** Restoring a snapshot via `POST /api/snapshots/:id/restore` updates the pointer and rebuilds the five derived-cache tables only (`bills`, `motions`, `statements`, `regulations`, `questiontime_questions`). Divisions, factions, finance, and political state are not touched.
- **Import is dev/staging only.** `POST /api/admin/import-snapshot` is gated by `isDevSeedAllowed()` and returns `404` in production unless `ENABLE_DEV_SEED=true`.

See `docs/state-ownership.md` for the full reference.

---

## 6. Data Sources

**`data/constituencies_1997.json`**  
659 UK constituencies from the 1997 general election, generated by `scripts/convert-1997-csv.js` from `data/1997_structured.csv`. Each entry has: `id` (slug), `name`, `nation`, `region`, `party` (winning party), `mpType`, `mpName`.

```json
{
  "generatedAt": "2026-02-25T11:06:46.399Z",
  "constituencies": [
    { "id": "barking", "name": "Barking", "nation": "England",
      "region": "London", "party": "Labour", "mpType": "", "mpName": "" }
  ]
}
```

**`data/1997_structured.csv`**  
Structured UK 1997 election results with columns: `record_type`, `party`, `region`, `constituency`, `seats`, `votes`, `vote_pct`, `majority`, `turnout_pct`, `turnout_total`, `electorate`. Used as input to the conversion script.

**`data/demo.json`**  
~284 KB read-only seed snapshot served to unauthenticated visitors as the demo state. Contains: `version`, `adminSettings`, `gameState` (sim clock start values), `parliament` (parties with seat counts), `bills`, `motions`, and other top-level domain keys. Deep-frozen client-side to prevent mutation.

---

## 7. Permissions and Roles

**Role system (server/roles.js):**

Roles are stored as strings in the `user_roles` table (one row per user/role pair). They are loaded into `req.session.roles` on login and refreshed on bootstrap.

**System/moderation roles:**

| Role | Description |
|---|---|
| `"admin"` | Full system access, all admin endpoints |
| `"mod"` | Moderation access, shared with admin on many endpoints |
| `"speaker"` | Speaker of the House — specific procedural powers |

**Party roles:**

| Role | Description |
|---|---|
| `"party:labour"` | Labour party member |
| `"party:conservative"` | Conservative party member |
| `"party:liberal_democrat"` | Liberal Democrat party member |

**Office roles (functional areas):**

| Area | Roles |
|---|---|
| Government | `office:prime_minister`, `office:secretary_of_state`, `office:backbencher` |
| Opposition | `office:leader_of_opposition`, `office:shadow_secretary_of_state`, `office:leader_of_third_party`, `office:backbencher` |
| Civil service | `office:permanent_secretary`, `office:civil_servant` |
| Question Time | PM, Leader of Opposition, Third Party Leader, SoS, Shadow SoS |

**`PERMISSION_MAP`** (in `server/roles.js`) defines 40+ named UI actions (e.g., `"submit_bill"`, `"sign_motion"`, `"manage_cabinet"`) and the set of roles that may perform each. The client-side `permissions.js` mirrors this for UI gating; all server endpoints re-check independently.

**`computeApprovalRolesToAdd(character)`** computes which roles to assign when a character application is approved (party + office roles from the character spec).

**`officeRoleFromSpecId(spec_id, office_type)`** maps a character spec identifier to the corresponding office role string.

**RBAC audit:**  
`scripts/audit/rbac-matrix.json` documents every endpoint with its required roles and production flags. `scripts/audit/feature-manifest.js` generates this matrix and is run in CI. `scripts/audit/generate-audit-report.mjs` produces a JSON report; current status is `remainingWarnings: 0`.

---

## 8. Background Processing

There is **no dedicated background worker process** or message queue. All simulation state advances are either:

1. **Demand-driven:** The sim clock is re-derived on every request from stored `gameState` fields using `computeSimDateFromGameState()`. No cron job or ticker is needed for the basic time advance.

2. **Admin-triggered:** `POST /api/clock/tick` and `POST /api/clock/set` allow admins to manually step or override the clock. `POST /api/admin/close-stale-divisions` and `POST /api/admin/close-orphan-motion-divisions` clean up hanging divisions on demand.

3. **Finance cycles:** Salary uprating, inflation application, and shop-upkeep are triggered by explicit admin API calls rather than scheduled jobs.

4. **Discourse sync:** Group membership sync is triggered manually from the Admin Panel.

The `worker/index.js` Cloudflare Worker is a *routing proxy*, not a background processor.

---

## 9. External Integrations

| Service | Purpose | Configuration |
|---|---|---|
| **Cloudflare Pages** | Static frontend hosting | Deployment target for `.html`, `js/`, `styles.css`, `data/` |
| **Cloudflare Workers** | API routing proxy + bare-domain redirect | `wrangler.toml`, deployed separately |
| **Render** | Express server hosting | Backend URL hard-coded in `worker/index.js` and `functions/api/[[path]].js` |
| **Neon (PostgreSQL)** | Database | `DATABASE_URL` env var; SSL auto-detected for `neon.tech` hosts |
| **SendGrid** | Transactional email (verification) | `SENDGRID_API_KEY`, `SENDGRID_FROM`, `APP_BASE_URL` env vars |
| **Cloudflare Turnstile** | Bot protection on registration | `TURNSTILE_ENABLED`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` env vars; disabled by default |
| **Discourse** | Forum with SSO and API-created topics | Credentials stored encrypted in `app_config` DB table; configured via Admin Panel UI |

**Backend origin (hard-coded):**  
`https://rulebritannia-app-backend.onrender.com` — referenced in both `worker/index.js` and `functions/api/[[path]].js`. Must be updated in both places if the backend hosting provider changes.

---

## 10. Security and Hardening

### Authentication

- Password hashing: `bcryptjs` (default cost factor).
- Sessions: DB-backed via `connect-pg-simple`; `sameSite: "none"` (required for cross-origin Cloudflare proxy), `secure: true`, `httpOnly: true`.
- Session cookies scoped to `domain=".rulebritannia.org"`.
- Email verification required before admin approval; registrations go through a `pending_registrations` queue.

### CSRF

Custom synchronizer-token pattern:
- Token generated with `crypto.randomBytes(32)` on session creation.
- Stored server-side in session.
- Sent to client via `GET /api/csrf-token`.
- Submitted in `X-CSRF-Token` header on all mutating requests.
- Verified with `timingSafeEqual` — not a string equality check.
- Client-side `api.js` auto-refreshes token and retries once on 403.

### Rate Limiting

Named limiters applied per endpoint group:

| Group | Limit (examples) |
|---|---|
| `authLimit` | 8 requests/min per IP (login, me, logout) |
| `registerLimit` | Registration |
| `verifyEmailLimit`, `resendVerifyLimit` | Email verification |
| `crudReadLimit`, `crudWriteLimit` | Standard CRUD |
| `auditWriteLimit`, `auditReadLimit` | Audit log |
| `clockReadLimit`, `clockWriteLimit` | Clock endpoints |
| `maintLimit` | Admin maintenance |
| `ssoRateLimit` | Discourse SSO |
| `discourseSyncLimit` | Discourse group sync |
| `regAdminLimit` | Registration admin |
| `bootstrapLimit` | Bootstrap endpoint |

### Production Guards

- `isDevSeedAllowed()` gates 12 destructive endpoints; returns `404` unless `NODE_ENV !== "production"` or `ENABLE_DEV_SEED === "true"`.
- Three admin-only endpoints available in production: `GET /api/admin/export-snapshot`, `POST /api/admin/force-logout-all`, `POST /api/admin/rotate-sessions`.

### CORS

Hard-coded allow-list of 4 origins. `credentials: true` required for session cookies. Server-to-server requests (no `Origin` header) are allowed.

### Server-Authoritative Game Data (Audit Fix B3)

- `PATCH /api/bills/:id/vote` and `/api/bills/:id/final-division` ignore any client-supplied `effective_weight`. The server recomputes `effective_weight = 1` per character from the authoritative character/division data.
- `divisions.immutable_result` is written once at division close and cannot be overwritten.

### Discourse Credential Security

Discourse API key and SSO secret are never stored in environment variables or plaintext. They are encrypted with AES-256-GCM (key derived from `SESSION_SECRET`) and stored in the `app_config` table. Set via Admin Panel UI.

### Frontend State Integrity (Audit Fix B2)

- `saveData()` is a no-op; `localStorage` is not used for authenticated state.
- `saveState()` is staff-only; non-staff calls return silently.
- Unauthenticated demo state is deep-frozen to prevent accidental writes.

---

## 11. Development Architecture

### Environment Variables (server/.env.example)

```
DATABASE_URL=postgres://user:password@host/dbname?sslmode=require
SESSION_SECRET=<long-random-string>
NODE_ENV=production

# Optional
SENDGRID_API_KEY=SG.xxx
SENDGRID_FROM=support@rulebritannia.org
APP_BASE_URL=https://www.rulebritannia.org

TURNSTILE_ENABLED=true
TURNSTILE_SITE_KEY=...
TURNSTILE_SECRET_KEY=...

# Discourse stored in DB, not env — no DISCOURSE_* vars needed in .env
DISCOURSE_ENCRYPTION_KEY=<64-char-hex>  # only if overriding key derivation
```

### Server Start

```sh
cd server && node index.js
```

No build step. `package.json` `"type": "module"` + `"main": "index.js"`.

### CI (GitHub Actions)

One workflow: `.github/workflows/static-checks.yml`  
Triggers on push/PR to any branch.

Steps:
1. `node scripts/static-checks.js` — 8 static analysis checks (no secrets needed).
2. `node scripts/audit/feature-manifest.js` — RBAC matrix generation.
3. `node --test server/discourse.test.js` — Discourse SSO unit tests.
4. Upload `scripts/audit/rbac-matrix.json` as a workflow artifact (retained 30 days).

### Static Analysis (`scripts/static-checks.js`)

Eight checks run without a database:

1. All `POST`/`PUT`/`PATCH`/`DELETE` fetch calls include `credentials: "include"`.
2. Non-public `GET` fetch calls include `credentials: "include"`.
3. Server write endpoints enforce authentication.
4. Motion/EDM/bill update+delete are staff-only.
5. Player-facing pages use API calls, not raw `saveState()`.
6. All server error responses use `{ error: <string> }` JSON shape.
7. No fire-and-forget mutating API calls in `js/`.
8. No double-release of pg-pool clients.

### Scripts

| Script | Purpose |
|---|---|
| `scripts/convert-1997-csv.js` | Converts `data/1997_structured.csv` → `data/constituencies_1997.json` |
| `scripts/render-version-assets.mjs` | Appends `?v=<git-sha>` to CSS/JS `<link>`/`<script>` tags in `.html` files (cache busting) |
| `scripts/static-checks.js` | Static analysis (see above) |
| `scripts/audit/feature-manifest.js` | Generates RBAC matrix |
| `scripts/audit/generate-audit-report.mjs` | Produces `audit-report.json` |

### Cloudflare Worker Development

```sh
wrangler dev          # local tunnel
wrangler deploy       # production deploy
```

---

## 11a. Testing Architecture

### Unit tests

| File | What it tests |
|---|---|
| `server/discourse.test.js` | Discourse client helpers |
| `server/state-contracts.test.js` | `assertSnapshotDerivedTable()`, `stripRelationalKeys()` |
| `server/roles.test.js` | Role constant correctness |
| `server/rbac-helpers.test.js` | `getSessionRoles`, `hasAdminOrMod`, `hasAdminModOrSpeaker` |
| `server/recompute-helpers.test.js` | `fireRecompute`, `awaitedRecompute`, entity correlation token |
| `server/service-modules.test.js` | Pure exports from `political-state-service.js` and `division-helpers.js` (faction strength/cohesion/pressure, clamp100, vote weights, regex constants) |
| `server/parliamentary-political-state.integration.test.js` | Pure parliamentary logic mirrors (amendment authority, rebellion pressure, political-state composition) |

Run with:
```bash
cd server && node --test *.test.js
```

### Integration tests

Integration tests require a live PostgreSQL database. They run against a dedicated test schema created within the test database.

| File | Coverage |
|---|---|
| `server/parliamentary.integration.test.js` | Bill lifecycle, amendments, divisions, whipping, rebellions, political state triggers |
| `server/factions.integration.test.js` | Faction CRUD, allocation guards, `computeFactionPoliticalState()`, `getPartyFactionClimate()` |
| `server/finance-parliament.integration.test.js` | Finance config, salary bands, character finance, party finance |

**Important:** Each integration test file calls `pool.end()` in its `after()` hook. The files must be run **separately** — running them together in a single `node --test` invocation causes connection pool contamination:

```bash
# Run each file separately
node --test server/parliamentary.integration.test.js
node --test server/factions.integration.test.js
node --test server/finance-parliament.integration.test.js
```

**Test schema vs. production schema:** The integration test `createTestSchema()` helper creates a minimal subset of the production schema. Some production-only constraints (e.g., `CHECK (momentum IN ('rising','stable','falling'))` on `faction_political_state`) are not replicated in the test schema. Test schemas and production schemas are not identical.

### Staging smoke tests

`scripts/test-staging.mjs` exercises key paths against a running staging environment:

- Persistence: create press release → GET list → verify title present
- Immutability: author PUT on own press item → must return 401/403
- Division authority: POST vote with tampered `weight:9999` → `effective_weight` must be server-computed
- Bill vote authority: PATCH bill vote → `effective_weight` must be server-computed
- RBAC: unauthenticated write → must return 401/403

Requires environment variables: `BASE_URL`, `TEST_EMAIL`, `TEST_PASSWORD`.

### CI

The GitHub Actions workflow (`.github/workflows/static-checks.yml`) runs on every push and PR:
1. `node scripts/static-checks.js` — 8 static analysis checks
2. `node scripts/audit/feature-manifest.js` — RBAC matrix drift check
3. `node --test server/*.test.js` — unit tests

Integration tests are not run in CI (require a live database). They are run manually before significant releases.

---

## 12. Architectural Constraints

1. **Large monolithic server.** `server/index.js` is the primary API entry-point (~18,000 lines post-extraction). Route handlers, middleware, and schema bootstrap remain co-located. The highest-risk business logic has been extracted into focused service modules (see §3.1a); route-level concerns and the remaining large helper functions (`writeAuditLog`, clock-tick runners) are not yet extracted.

2. **No message queue or background jobs.** Simulation advances and finance cycles require manual admin invocation. There is no cron scheduler, no task queue (no Redis, no BullMQ, no Temporal).

3. **No frontend build step.** ES module imports are resolved by the browser at runtime. Circular dependency risk is managed by convention, not a bundler's module graph.

4. **Hard-coded backend origin.** The Render backend URL is embedded in two Cloudflare edge files. Changing the hosting provider requires updating `worker/index.js` and `functions/api/[[path]].js` and redeploying the Cloudflare edge.

5. **PostgreSQL connection cap.** Pool is limited to 10 connections, chosen to avoid exhausting Render/Neon's connection limits. Under high concurrency this may become a bottleneck.

6. **Schema managed via inline DDL.** There is no migration tool (no Flyway, Liquibase, or db-migrate). `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements accumulate in `ensureSchema()`. Column drops and renames require manual intervention.

7. **No horizontal scaling.** The session store is PostgreSQL-backed (shareable), but some in-memory state (rate limiter counters) lives per-process. Multiple server instances would not share rate-limit state.

8. **Discourse SSO group sync is manual.** Automatic real-time group membership propagation is not implemented. Admins must trigger sync from the Admin Panel.

---

## 13. Future Architecture Evolution

1. **Discourse SSO enablement:** The SSO provider infrastructure is complete. Enabling it requires setting `DISCOURSE_SSO_ENABLED=true` and configuring credentials in the Admin Panel. It is currently off by default pending UX confirmation.

2. **Discourse group sync:** `DISCOURSE_GROUP_MAP` and the sync preview/apply endpoints are ready. Enabling live sync after SSO is confirmed stable is a planned step.

3. **Cloudflare Pages Function retirement:** `functions/api/[[path]].js` is noted as potentially removable once the Cloudflare Worker deployment is confirmed stable, since the Worker takes routing priority.

4. **Staging test suite:** `scripts/test-staging.mjs` (Audit Fix B1) provides an executable staging smoke-test covering persistence, immutability, division authority, bill votes, and RBAC. Intended to run against a staging deployment before each trial.

5. **Server modularisation:** The highest-risk business logic has been extracted into `political-state-service.js`, `division-helpers.js`, and `finance-service.js` (see §3.1a). The next candidates are `writeAuditLog` (needed to enable extraction of the clock-tick runners) and the route handler groups themselves once the codebase is past alpha.

6. **Scheduled simulation ticks:** If the player base grows and manual clock management becomes burdensome, adding a scheduled Cloudflare Worker cron trigger or an external cron calling `POST /api/clock/tick` would be straightforward given the current stateless clock algorithm.
