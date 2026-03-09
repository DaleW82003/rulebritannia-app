# Rule Britannia – System Overview

## 1. What This Repository Is

Rule Britannia is a browser-based UK parliamentary political simulation set in the post-1997 landslide era. The repository contains the full application: a multi-page browser frontend (54 HTML pages + vanilla ES modules), a Node.js/Express backend API server, a Cloudflare Worker edge proxy, a Cloudflare Pages Function fallback proxy, supporting datasets (1997 election results, constituency data, demo snapshot), developer scripts, and project documentation.

The backend is server-authoritative: all simulation state, roles, and domain logic live in PostgreSQL and are enforced on the server. Browser pages are thin UI clients that call the API and render the result. There is no frontend build step or bundler; pages use native ES module imports directly.

---

## 2. One-Paragraph System Summary

Browser pages load static HTML and import vanilla JS modules. On first load every page calls `/api/bootstrap` — a single round-trip returning clock state, app config, the current user, and the latest simulation snapshot — and falls back to `data/demo.json` for unauthenticated visitors.

All writes go through the Express API server, which enforces session authentication, CSRF protection, and role-based access control before executing domain logic against a PostgreSQL database. Static datasets seed the initial 1997 constituency and election data; `data/demo.json` provides a read-only world for public visitors.

An accelerated simulation clock (two sim-months per real week) is advanced by admin action. Clock ticks trigger side-effects inline: closing expired Discourse debate topics and synchronising application roles to Discourse groups.

A Cloudflare Worker (and a Cloudflare Pages Function backup) proxies all `/api/*` traffic from the public domains to the backend hosted on Render, preserving session cookies across subdomains. Developer scripts handle asset versioning, static code analysis, and data conversion.

---

## Current System Boundaries

### Implemented Systems

- **Parliamentary simulation**
  - bills
  - amendments
  - divisions
  - rebellions

- **Party systems**
  - factions
  - faction allocations
  - faction climate

- **Political state**
  - political capital
  - political pressure
  - character political state

- **Finance**
  - personal finance
  - party finance

- **Staff governance tools**
  - admin and moderator systems
  - Speaker NPC role and powers
  - in-app support ticketing (player queue + staff management queue)

- **State tooling**
  - relational DB authoritative model
  - constrained snapshot/app_state tooling

### Systems Not Yet Fully Implemented

- integrated economic simulation
- national budget system
- polling and public opinion model

The current simulation focuses on political institutions and internal political dynamics. The economic, fiscal, and polling systems will later extend this foundation.

---

## 3. High-Level Architecture Diagram

```
Users / Admins / Moderators
         │
         ▼
 53 Browser HTML Pages
  + Vanilla JS Modules (js/)
         │  HTTP (credentials:include, CSRF token)
         ▼
 Cloudflare Worker  ──(bare domain rulebritannia.org/api/*)
 Cloudflare Pages Function  ──(www.rulebritannia.org/api/*)
         │  Proxy (forward with cookies)
         ▼
 Express API Server  (server/index.js, ~21 k lines, ~392 routes)
         │
         ├── Auth & Session (express-session + PostgreSQL sessions table)
         ├── CSRF Protection (double-submit cookie)
         ├── RBAC Guards (server/roles.js + inline middleware)
         ├── Simulation Domain Logic
         │       Bills / Motions / Regulations / Statements
         │       Divisions / Question Time
         │       Cabinet / Government / Opposition
         │       Civil Service / Budget / Economy
         │       Parties / Elections / Polling
         │       Press / Debates / News
         │       Support Ticketing (support_tickets / support_messages)
         ├── Simulation Clock (server/clock.js)
         │
         ├── PostgreSQL  (~95 tables, bootstrapped on startup)
         │       State snapshots, sessions, users, characters,
         │       constituencies, parties, bills, motions,
         │       divisions, audit logs,
         │       support_tickets, support_messages, ...
         │
         └── Discourse Forum  (server/discourse.js + discourseClient.js)
                 DiscourseConnect SSO
                 Auto group sync (roles → Discourse groups)
                 Debate topic creation / auto-close
```

---

## 4. Major Components at a Glance

| Component | Location | Responsibility | Key Files |
|---|---|---|---|
| **Browser UI pages** | `/*.html` | Static multi-page app; 54 pages covering every simulation domain | `dashboard.html`, `bill.html`, `admin-panel.html`, `budget.html`, `cabinet.html`, `civilservice.html`, `bodies.html`, `support.html`, … |
| **Frontend JS modules** | `js/` | API communication, auth guards, permission checks, UI logic, simulation engines | `js/api.js`, `js/auth.js`, `js/core.js`, `js/permissions.js`, `js/clock.js`, `js/divisions.js`, `js/bill-drafting.js`, `js/audit.js` |
| **Page initialisation** | `js/pages/` | Per-page boot scripts wired to HTML | `js/pages/bills.js`, `js/pages/motions.js`, `js/pages/bodies.js`, … |
| **UI components** | `js/components/` | Reusable UI widgets | Various component modules |
| **Simulation engines** | `js/engines/` | Client-side permission engine and helpers | `js/engines/permission-engine.js` |
| **API server** | `server/index.js` | Express app: all 392 HTTP routes, domain logic, middleware | `server/index.js` (~21 k lines) |
| **Database layer** | `server/db.js` | PostgreSQL connection pool; schema auto-bootstrapped (~95 tables) | `server/db.js` |
| **Simulation clock** | `server/clock.js`, `js/clock.js` | Maps real calendar days to simulated parliamentary months (2 sim-months/week) | Both files implement identical algorithm |
| **Role & permission map** | `server/roles.js` | Canonical role constants, Discourse group mapping, `PERMISSION_MAP` | `server/roles.js` |
| **Edge proxy (Worker)** | `worker/index.js` | Cloudflare Worker: proxies `rulebritannia.org/api/*` to Render backend; bare-domain redirect | `worker/index.js`, `wrangler.toml` |
| **Edge proxy (Pages)** | `functions/api/[[path]].js` | Cloudflare Pages Function: proxies `www.rulebritannia.org/api/*`; fallback | `functions/api/[[path]].js` |
| **Discourse integration** | `server/discourse.js`, `server/discourseClient.js` | DiscourseConnect SSO, auto group sync, debate topic lifecycle | Both files |
| **Scripts** | `scripts/` | Asset versioning, static analysis, data conversion | `scripts/render-version-assets.mjs`, `scripts/static-checks.js`, `scripts/convert-1997-csv.js` |
| **RBAC audit** | `scripts/audit/` | Feature manifest scanner + RBAC matrix drift detection | `scripts/audit/feature-manifest.js`, `scripts/audit/rbac-matrix.json` |
| **Static datasets** | `data/` | 1997 election CSV, 650-constituency JSON, read-only demo snapshot | `data/1997_structured.csv`, `data/constituencies_1997.json`, `data/demo.json` |
| **Documentation** | `docs/` | Architecture, dev guide, simulation model, audit reports, runbook | See §11 |
| **Tests** | `server/tests/` | Server-side unit tests (Node built-in test runner) | `server/discourse.test.js`, … |
| **CI** | `.github/workflows/` | Static checks + manifest on every push/PR | `static-checks.yml` |

---

## 5. Request and Data Flow

### Page Load

1. The browser requests a static HTML page (e.g. `bill.html`) from Cloudflare Pages.
2. The page script imports its JS modules and calls `bootData()` in `js/core.js`.
3. `bootData()` sends a single `GET /api/bootstrap` request. This returns the simulation clock state, app config, the authenticated user's profile and roles, and the latest simulation snapshot — all in one round-trip.
4. If the user is not logged in, `bootData()` fetches `data/demo.json` instead and renders in read-only demo mode.

### Authentication and CSRF

5. Login is via `POST /api/auth/login`. A `HttpOnly` session cookie is set scoped to `.rulebritannia.org`; it is forwarded through the Cloudflare proxy transparently.
6. On every page load `js/auth.js` calls `requireLogin()` (or `requireAdmin()` for admin pages). These check the cached user session and redirect to `login.html` if unauthenticated.
7. All mutating requests (POST/PUT/PATCH/DELETE) include a CSRF token header. `js/api.js` auto-refreshes the token on `403 CSRF` responses and retries once.

### Simulation Actions

8. A player action (e.g. voting on a division) calls an API wrapper in `js/api.js` (e.g. `apiBillVote()`).
9. The request is proxied through Cloudflare Worker/Pages Function to the Express server.
10. The server validates the session, checks the CSRF token, then runs the RBAC guard for the endpoint (checking roles such as `admin`, `mod`, `speaker`, or party/office roles).
11. Business logic executes: state is read from and written to PostgreSQL. Responses use `{ error: "…" }` on failure.
12. The browser receives the JSON response and updates the UI.

### Background and Async Tasks

13. When the simulation clock ticks (via `POST /api/clock/tick`), the server runs side-effects inline: it closes expired Discourse debate topics (`runDebateAutoClose()`) and triggers Discourse group sync (`enqueueDiscourseGroupSync()`, debounced).
14. Discourse group sync is also triggered whenever roles change. The sync walks each user's roles, maps them to Discourse groups via `computeDiscourseGroups()`, and calls the Discourse API to add/remove memberships.

---

## 6. Simulation Domain Overview

The simulation models UK parliamentary government circa 1997. The core concepts and their relationships are:

| Concept | Description |
|---|---|
| **Characters** | Named political figures owned by players or staff. Each character has a party, constituency, career background, and accumulated post-nominals (MP, PC). |
| **Constituencies** | All 659 UK constituencies seeded from 1997 election data, each assigned a party and MP character. |
| **Parties** | Conservative, Labour, Liberal Democrat, SNP, Plaid Cymru, and others. Each has leadership roles (leader, chief whip, treasury spokesperson) and an internal whipping system. |
| **Parliament** | Seat counts derived from 1997 results. Party strength drives division outcomes and bill passage. |
| **Government & Opposition** | A formed government (PM + Cabinet) and official opposition (LOTO + Shadow Cabinet) with assigned office roles. |
| **Cabinet / Civil Service** | Cabinet ministers and civil servants have special roles, briefing powers, and case-handling responsibilities. |
| **Bills** | Legislative proposals going through reading → committee → report → division → Royal Assent. Amendments can be tabled and decided. |
| **Motions & EDMs** | Procedural motions and Early Day Motions; EDMs can be signed by characters. |
| **Statements & Regulations** | Ministerial statements and secondary legislation routes. |
| **Divisions/Votes** | Formal votes in the chamber. Each character votes Aye/No/Abstain (one vote each, whipped). Bill divisions use proportional seat-weight counting. |
| **Question Time** | Parliamentary question-and-answer sessions with scheduling and transcript recording. |
| **Factions** | Intra-party ideological groupings (e.g., Labour Campaign Group, Conservative 1922 Committee, ERG). Each faction has an `internal_power`, `momentum`, `leadership_pressure`, and `cohesion` score computed server-side. |
| **Political capital** | Per-character accumulated influence score computed from office, press coverage, party roles, work plans, and scandal exposure. Stored in `character_political_state`. |
| **Political pressure** | Per-character pressure channels (party, constituency, media, group, institutional, rebellion risk) computed at the same time as capital. Influences character behaviour and resilience. |
| **Faction climate** | Party-level climate derived from its factions' aggregate `leadership_pressure` scores. A hostile climate increases party pressure on all characters; an aligned climate provides a capital resilience bonus. |
| **Personal finance** | Per-character salary bands, bank balances, additional revenue, property costs, and purchase history. Computed server-side from `finance_config` and stored in `character_finance`. |
| **Party finance** | Party treasury balances, membership fee schedules, donation tracking, and fundraising. Managed through party API routes. |
| **Budget** | Government fiscal controls: seven revenue lines, fifteen expenditure lines, aggregate fiscal metrics (deficit, debt, GDP ratios). The Chancellor drafts; admins/mods approve or reject. |
| **Economy** | Admin-editable economic indicators (GDP growth, inflation, unemployment). Partial implementation; dynamic modelling is a planned extension. |
| **Press & Debates** | Press releases, newspaper articles, and Discourse-backed debate threads linked to legislative items. |
| **Simulation Clock** | Accelerated time: Mon–Wed = one sim-month, Thu–Sat = one sim-month, Sunday frozen. Starting point: August 1997. |
| **Speaker NPC** | The Speaker of the House holds a special role: no vote weight in divisions (tie-break only), manages legislative procedure, assigned by admins/mods. |
| **Snapshot / state tooling** | Versioned `state_snapshots` JSONB blobs with `app_state_current` pointer provide bulk-object snapshots for bills, motions, and other derived-cache tables. Relational gameplay systems (divisions, factions, political state, finance) are excluded from snapshot flows. |
| **Support ticketing** | Players open support tickets from `support.html`. Each ticket has a subject, category, status (`open` → `finished` → `closed`), staff labels, and a chronological message thread. Staff (admin/mod) access a separate queue showing all players' tickets with status/label filters, per-side unread tracking, and a 25-second polling loop. Two PostgreSQL tables: `support_tickets` and `support_messages`. |

---

### 6a. How Systems Interact During Gameplay

The following describes how a player action flows through connected systems:

**Legislative action → political capital**
When a character tables an amendment, casts a division vote, or submits a press release, `recomputeCharacterPoliticalState()` is triggered asynchronously. The function re-derives the character's `capital_current`, pressure channels, `momentum`, and `reputation` from the current state of the database and stores the result in `character_political_state`.

**Division rebellion → party pressure**
If a character votes against a whipped party instruction, a rebellion log entry is created in `division_rebellion_log`. The next time `recomputeCharacterPoliticalState()` runs for that character, the rebellion history is included in the party pressure calculation, increasing `party_pressure`.

**Faction climate → capital and pressure**
When political state is recomputed for a character in a playable party, the server calls `getPartyFactionClimate()`. If the party's factions are in a hostile climate (high aggregate `leadership_pressure` from opposing factions), `party_pressure` for all characters in that party rises. If the climate is aligned (supporting factions dominate), a `capital_resilience_bonus` is applied to each character's total capital.

**Scandal → capital**
When a scandal is opened against a character or a mod decision is recorded, `recomputeCharacterPoliticalState()` is triggered. Active scandals subtract from capital; major resolved scandals leave a lasting penalty.

**Office assignment → capital**
When a character is assigned or removed from a cabinet, shadow cabinet, or parliamentary office, `recomputeCharacterPoliticalState()` is triggered. Cabinet roles add 20 points; the Prime Minister adds 30 points; shadow roles add 10 points.

**Recompute timing caution:** All `recomputeCharacterPoliticalState()` calls are non-blocking (`.catch()` wrapped). This means character political state may briefly show a stale value immediately after a triggering action. The value self-corrects on the next API read that triggers recomputation.

---

## 7. Permissions and Roles Overview

### System Roles

| Role | Holder | Access |
|---|---|---|
| `admin` | Site administrators | Full access to all endpoints; can approve registrations, manage all data, run maintenance operations |
| `mod` | Moderators | Elevated access; can manage most content, similar to admin but not all destructive operations |
| `speaker` | Speaker of the House character | Controls legislative procedure: manage bills, motions, statements, regulations, divisions |

### Party Roles

| Role | Assigned to |
|---|---|
| `party:labour` | Labour party members |
| `party:conservative` | Conservative party members |
| `party:liberal_democrat` | Liberal Democrat members |
| (and others for smaller parties) | SNP, Plaid Cymru, etc. |

### Office Roles

| Role | Assigned to |
|---|---|
| `office:prime_minister` | Serving Prime Minister |
| `office:leader_of_opposition` | Leader of the Opposition |
| `office:secretary_of_state` | Cabinet ministers |
| `office:shadow_secretary_of_state` | Shadow ministers |
| `office:civil_servant` | Civil service characters |
| `office:backbencher` | All other party members |

### Role Enforcement

- **Server-side**: Every route in `server/index.js` has an inline auth middleware. System/staff roles are checked via session `req.session.roles`; the `isDevSeedAllowed()` helper gates all destructive dev/seed endpoints before any auth check.
- **Client-side**: `js/permissions.js` and `js/engines/permission-engine.js` provide helpers (`isAdmin()`, `isMod()`, `isSpeaker()`, `canManage()`, etc.) used by page modules to show/hide UI elements. These are UI guards only; server-side enforcement is authoritative.
- **Discourse groups**: `server/roles.js:computeDiscourseGroups()` maps application roles to Discourse groups automatically on role changes and clock ticks.

---

## 8. Data Sources and Supporting Assets

| Asset | Location | Purpose |
|---|---|---|
| **1997 election CSV** | `data/1997_structured.csv` | Raw 1997 general election results by party, region, constituency, votes, and majority. Used by `scripts/convert-1997-csv.js` to produce the JSON file. |
| **Constituency JSON** | `data/constituencies_1997.json` | 650 structured constituency records (id, name, nation, region, winning party, MP name) used to seed the database via admin endpoints. |
| **Demo snapshot** | `data/demo.json` | A read-only world snapshot. Served directly to unauthenticated visitors at `data/demo.json` so the site is explorable without an account. The server never writes to this file. |
| **styles.css** | `styles.css` | Single global stylesheet. Versioned at build time by `scripts/render-version-assets.mjs` appending `?v=<git-sha>` to all HTML references for cache-busting. |
| **Static HTML** | `/*.html` | 53 static pages served by Cloudflare Pages. No server-side rendering. |

---

## 9. Background Processing and Integrations

### Simulation Clock Side-Effects

Clock ticks (`POST /api/clock/tick`) are admin/staff actions. On each tick the server runs:

- **`runDebateAutoClose()`**: Finds expired motions, statements, and regulations with linked Discourse topics and calls `closeTopic()` on each via `server/discourse.js`.
- **`enqueueDiscourseGroupSync()`**: Debounced queue that batches role-change-driven group sync operations to avoid flooding the Discourse API.

### Discourse Integration

| Feature | Implementation |
|---|---|
| **DiscourseConnect SSO** | `GET /api/discourse/sso` + `/callback` verify HMAC payload, create/link Discourse accounts, redirect back |
| **Debate topic creation** | `POST /api/debates/create` calls `createTopicWithRetry()` and persists the Discourse `topicId`/`topicUrl` to the database |
| **Debate topic auto-close** | `runDebateAutoClose()` calls `closeTopic()` on clock tick |
| **Group sync** | `enqueueDiscourseGroupSync()` reconciles application roles → Discourse groups on role changes |
| **Credentials** | Discourse URL, API key, and SSO secret stored as encrypted env vars; exposed via per-request decryption |

### Email (SendGrid)

Registration verification and approval notification emails are sent via SendGrid when `SENDGRID_API_KEY` is set. If not set, email steps are skipped silently (dev mode).

### Cloudflare Turnstile

Bot-protection on the registration form when `TURNSTILE_ENABLED=true`. Verification happens server-side in `POST /api/register`.

---

## 10. Repository Map

```
/                      – Static HTML pages (53 files) + styles.css
/js/                   – Browser-side JS modules (api, auth, core, permissions, engines, pages, components)
/server/               – Express API server, database layer, clock, Discourse clients, roles, unit tests
/worker/               – Cloudflare Worker edge proxy (bare domain)
/functions/            – Cloudflare Pages Function edge proxy (www subdomain)
/scripts/              – Developer utilities: asset versioning, static analysis, data conversion, RBAC audit
/data/                 – Source datasets (1997 CSV + JSON, demo snapshot)
/docs/                 – Project documentation (architecture, dev guide, simulation model, audit reports)
/.github/workflows/    – CI: static checks + feature manifest on every push/PR
```

---

## 11. Recommended Reading Order

1. **`README.md`** — Project overview, setup instructions, environment variables, and deployment notes.
2. **`docs/system-overview.md`** *(this file)* — High-level map of the whole system.
3. **`docs/architecture.md`** — Deeper architectural decisions: CORS, session configuration, rate limiting, schema design, state-ownership, and security hardening.
4. **`docs/dev-guide.md`** — Developer handbook: full workflow, backend internals, frontend patterns, testing, known limitations.
5. **`docs/simulation-model.md`** — Simulation domain deep-dive: parliamentary procedure, factions, political capital/pressure, character political state, finance, divisions.
6. **`docs/state-ownership.md`** — State-ownership boundary reference: which tables are snapshot-backed vs relational-authoritative and the runtime enforcement contract.
7. **`server/index.js`** — The main server entry point and every API route. Start with the top ~300 lines for middleware setup, then navigate by route category.
8. **`js/api.js`** and **`js/core.js`** — How browser pages talk to the backend and how simulation state is loaded and cached.
9. **`server/roles.js`** — Canonical role constants and the Discourse group mapping.
10. **`scripts/audit/rbac-matrix.json`** — Machine-readable RBAC matrix; read alongside `server/roles.js` to understand what each endpoint requires.
11. **`docs/archive/`** — Historical planning and audit documents retained for reference.

---

## 12. Known Gaps or Ambiguities

| Area | Status |
|---|---|
| **Database migration strategy** | No migrations framework is used. Schema is bootstrapped on startup via `ensureSchema()` using idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements for additive changes. Destructive schema changes require manual intervention. |
| **Worker vs Pages Function precedence** | Both `worker/index.js` and `functions/api/[[path]].js` proxy `/api/*`. The Pages Function is the always-on fallback; the Worker handles the bare domain. Exact failover order is controlled by Cloudflare routing, not verifiable from the repository alone. |
| **Clock tick trigger** | The simulation clock is advanced only by explicit `POST /api/clock/tick` calls. This is a **manual admin action**; there is no automated cron scheduler. See `docs/dev-guide.md §14`. |
| **Recompute timing** | `recomputeCharacterPoliticalState()` is called non-blocking (fire-and-forget). Political state values may briefly show stale data immediately after a triggering action. |
| **Email delivery in dev** | SendGrid integration is skipped when `SENDGRID_API_KEY` is absent. Email verification is not enforced as a hard gate in development. |
| **Discourse credential encryption** | Discourse credentials are encrypted with AES-256-GCM. The key is derived from `SESSION_SECRET` via `scryptSync` (salt `"rb-discourse-v1"`) unless `DISCOURSE_ENCRYPTION_KEY` is provided as a 64-char hex string. |
| **`data/demo.json` freshness** | The demo snapshot is a static file. It must be manually regenerated using the export-snapshot endpoint and committed when the live world changes significantly. |
| **Economy modelling** | Economic indicators (GDP, inflation, unemployment) are admin-editable fields. A dynamic model linking policy choices to economic outcomes is not yet implemented. |
| **Support ticket notifications** | Staff and players are not sent an email when a new message arrives in a support ticket. The frontend polls every 25 seconds and shows a toast notification for new unreads, but there is no push or email channel for support updates. |
