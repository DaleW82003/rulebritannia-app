# Rule Britannia – System Overview

## 1. What This Repository Is

Rule Britannia is a browser-based UK parliamentary political simulation set in the post-1997 landslide era. The repository contains the full application: a multi-page browser frontend (53 HTML pages + vanilla ES modules), a Node.js/Express backend API server, a Cloudflare Worker edge proxy, a Cloudflare Pages Function fallback proxy, supporting datasets (1997 election results, constituency data, demo snapshot), developer scripts, and project documentation.

The backend is server-authoritative: all simulation state, roles, and domain logic live in PostgreSQL and are enforced on the server. Browser pages are thin UI clients that call the API and render the result. There is no frontend build step or bundler; pages use native ES module imports directly.

---

## 2. One-Paragraph System Summary

Browser pages load static HTML and import vanilla JS modules. On first load every page calls `/api/bootstrap` — a single round-trip returning clock state, app config, the current user, and the latest simulation snapshot — and falls back to `data/demo.json` for unauthenticated visitors.

All writes go through the Express API server, which enforces session authentication, CSRF protection, and role-based access control before executing domain logic against a PostgreSQL database. Static datasets seed the initial 1997 constituency and election data; `data/demo.json` provides a read-only world for public visitors.

An accelerated simulation clock (two sim-months per real week) is advanced by admin action. Clock ticks trigger side-effects inline: closing expired Discourse debate topics and synchronising application roles to Discourse groups.

A Cloudflare Worker (and a Cloudflare Pages Function backup) proxies all `/api/*` traffic from the public domains to the backend hosted on Render, preserving session cookies across subdomains. Developer scripts handle asset versioning, static code analysis, and data conversion.

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
 Express API Server  (server/index.js, ~21 k lines, 373 routes)
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
         ├── Simulation Clock (server/clock.js)
         │
         ├── PostgreSQL  (~92 tables, bootstrapped on startup)
         │       State snapshots, sessions, users, characters,
         │       constituencies, parties, bills, motions,
         │       divisions, audit logs, ...
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
| **Browser UI pages** | `/*.html` | Static multi-page app; 53 pages covering every simulation domain | `dashboard.html`, `bill.html`, `admin-panel.html`, `budget.html`, `cabinet.html`, `civilservice.html`, `bodies.html`, … |
| **Frontend JS modules** | `js/` | API communication, auth guards, permission checks, UI logic, simulation engines | `js/api.js`, `js/auth.js`, `js/core.js`, `js/permissions.js`, `js/clock.js`, `js/divisions.js`, `js/bill-drafting.js`, `js/audit.js` |
| **Page initialisation** | `js/pages/` | Per-page boot scripts wired to HTML | `js/pages/bills.js`, `js/pages/motions.js`, `js/pages/bodies.js`, … |
| **UI components** | `js/components/` | Reusable UI widgets | Various component modules |
| **Simulation engines** | `js/engines/` | Client-side permission engine and helpers | `js/engines/permission-engine.js` |
| **API server** | `server/index.js` | Express app: all 373 HTTP routes, domain logic, middleware | `server/index.js` (~21 k lines) |
| **Database layer** | `server/db.js` | PostgreSQL connection pool; schema auto-bootstrapped (~92 tables) | `server/db.js` |
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
| **Constituencies** | All 650 UK constituencies seeded from 1997 election data, each assigned a party and MP character. |
| **Parties** | Conservative, Labour, Liberal Democrat, SNP, Plaid Cymru, and others. Each has leadership roles (leader, chief whip, treasury spokesperson) and an internal whipping system. |
| **Parliament** | Seat counts derived from 1997 results. Party strength drives division outcomes and bill passage. |
| **Government & Opposition** | A formed government (PM + Cabinet) and official opposition (LOTO + Shadow Cabinet) with assigned office roles. |
| **Cabinet / Civil Service** | Cabinet ministers and civil servants have special roles, briefing powers, and case-handling responsibilities. |
| **Bills** | Legislative proposals going through reading → committee → report → division → Royal Assent. Amendments can be tabled and decided. |
| **Motions & EDMs** | Procedural motions and Early Day Motions; EDMs can be signed by characters. |
| **Statements & Regulations** | Ministerial statements and secondary legislation routes. |
| **Divisions/Votes** | Formal votes in the chamber. Each character votes Aye/No/Abstain (one vote each, whipped). Bill divisions use proportional seat-weight counting. |
| **Question Time** | Parliamentary question-and-answer sessions with scheduling and transcript recording. |
| **Budget** | Government fiscal controls: revenue, expenditure, bank balances, salary overrides, inflation tracking. |
| **Economy** | Economy indicators and polling data tracking public opinion. |
| **Press & Debates** | Press releases, newspaper articles, and Discourse-backed debate threads linked to legislative items. |
| **Simulation Clock** | Accelerated time: Mon–Wed = one sim-month, Thu–Sat = one sim-month, Sunday frozen. Starting point: August 1997. |

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
3. **`docs/architecture.md`** — Deeper architectural decisions: CORS, session configuration, rate limiting, schema design, caching, and security hardening.
4. **`docs/dev-guide.md`** — Developer handbook: full workflow, backend internals, frontend patterns, testing, known limitations.
5. **`docs/simulation-model.md`** — Simulation domain deep-dive: parliamentary procedure, roles, legislative lifecycle, divisions, budget, economy.
6. **`server/index.js`** — The main server entry point and every API route. Start with the top ~300 lines for middleware setup, then navigate by route category.
7. **`js/api.js`** and **`js/core.js`** — How browser pages talk to the backend and how simulation state is loaded and cached.
8. **`server/roles.js`** — Canonical role constants and the Discourse group mapping.
9. **`scripts/audit/rbac-matrix.json`** — Machine-readable RBAC matrix; read alongside `server/roles.js` to understand what each endpoint requires.
10. **`ALPHA_HARDENING_SUMMARY.md`** — Security policy for production-disabled dev endpoints.

---

## 12. Known Gaps or Ambiguities

| Area | Status |
|---|---|
| **Database migration strategy** | No migrations framework is used. Schema is bootstrapped on startup via `ensureSchema()`. Behaviour on schema drift between deployments is not fully documented — implied by code but not explicitly specified. |
| **Worker vs Pages Function precedence** | Both `worker/index.js` and `functions/api/[[path]].js` proxy `/api/*`. The README and `functions/` source note the Pages Function is a fallback, but the exact failover behaviour is not verifiable from the repository alone. |
| **Clock tick trigger** | The simulation clock is advanced only by explicit `POST /api/clock/tick` calls. Whether this is called by a scheduled job, a cron, or manual admin action is not verifiable from the repository alone. |
| **Session store at scale** | Sessions are stored in PostgreSQL (`sessions` table via `connect-pg-simple`). Behaviour under high connection load on Render's free tier is behaviour implied by architecture but not documented. |
| **Turnstile bypass in dev** | Registration Turnstile verification is conditional on `TURNSTILE_ENABLED=true`. The exact fallback behaviour when the env var is absent is implied by code but not explicitly tested. |
| **Email delivery in dev** | SendGrid integration is skipped when `SENDGRID_API_KEY` is absent. Whether this is documented for local dev setup is not verifiable from README alone. |
| **Discourse credential encryption** | Discourse credentials are encrypted with AES-256 using a key derived from `SESSION_SECRET` when `DISCOURSE_ENCRYPTION_KEY` is not set. The derivation mechanism is not described in docs. |
| **`data/demo.json` freshness** | The demo snapshot is a static file. How and when it is updated relative to the live simulation state is not verifiable from the repository alone. |
