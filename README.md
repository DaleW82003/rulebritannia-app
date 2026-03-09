# Rule Britannia

A browser-based UK parliamentary political simulation — **alpha-ready**.

> **Project status:** Core parliamentary systems, factions, political capital/pressure, character political state, personal and party finance, the Discourse integration, and the in-app support ticketing system are all implemented and in use. Upcoming: expanded economy model, budget workflow enhancements, and live polling simulation.

---

## Overview

Rule Britannia is a full-stack political simulation platform that models the UK Westminster parliamentary system. Players take on roles as Members of Parliament, Cabinet ministers, party leaders, or civil servants and participate in an ongoing simulation of UK politics — drafting and debating legislation, managing government and opposition, attending Question Time, tracking polling and the economy, and interacting through a connected Discourse forum.

This repository contains the complete application: an Express/PostgreSQL backend, a multi-page vanilla-JS frontend, Cloudflare Worker/Pages proxy code, build scripts, constituency data, and documentation.

---

## Project Purpose

Rule Britannia recreates the mechanics of British parliamentary democracy as an interactive game:

- **Legislation** — players draft bills, table amendments, and cast votes in formal divisions.
- **Government formation** — a Prime Minister forms a Cabinet; an opposition Leader of the Opposition appoints a Shadow Cabinet.
- **Political parties** — parties hold seats, elect leaders, and maintain whipping systems.
- **Constituency representation** — each MP holds a 1997-era constituency mapped to a region and historical result.
- **Civil service** — ministers receive departmental briefings and make policy decisions.
- **Economy & polling** — macroeconomic indicators drive approval ratings tracked through a polling engine.
- **Press & media** — players submit press releases; coverage is modelled with character-level impact modifiers.
- **Discourse forum** — debates and motions are automatically threaded as topics on a linked Discourse instance with SSO.
- **In-app support ticketing** — players raise support tickets from `support.html`; staff (admin/mod) manage them from a dedicated staff queue with status transitions, label tagging, per-side unread tracking, and 25-second polling.
- **Onboarding Guides** — 15 predefined guides are seeded server-side on startup (`server/guides-seed.js`) and displayed as collapsible panels on `guides.html`; staff can edit, reorder, or add guides through the Control Panel.
- **Starter Pack** — a short "5 first-week actions" guide displayed to new players on the player dropon; editable by staff via the Control Panel without code changes.

The simulation clock runs at an accelerated pace: 2 sim-months per real week (Mon–Wed = 1 month, Thu–Sat = 1 month; Sunday frozen). The default starting point is August 1997 (shortly after the Labour landslide).

---

## Key Features

- **Gated registration** — email verification + admin approval before a user can log in.
- **Server-authoritative state** — all simulation state persists in PostgreSQL; no game-critical data lives in `localStorage`.
- **CSRF protection** — double-submit cookie pattern with auto-refresh on mutation requests.
- **Role-based access control** — `admin`, `mod`, `speaker`, party roles, and per-office roles enforced server-side on every route.
- **Formal divisions** — server-computed `effective_weight = 1` per character; whipped party votes with delegation support.
- **Bill divisions** — proportional seat-weight voting with server-authoritative tallying.
- **Discourse integration** — DiscourseConnect SSO (sim = provider, Discourse = consumer); automatic group sync; debate topics auto-created and auto-closed on the clock tick.
- **Simulation clock** — configurable accelerated calendar with pause/resume; consistent implementation mirrored across client and server.
- **Demo mode** — all pages are fully usable without a backend using `data/demo.json`; writes are disabled and a banner is shown.
- **Debug mode** — append `?debug=1` or `localStorage.setItem('rb_debug','1')` to expose live data-source health panels.
- **Asset versioning** — build script appends `?v=<git-sha>` to CSS/JS references for cache-busting on Render Static Site.
- **Static audit tooling** — `scripts/static-checks.js` and the RBAC feature-manifest pipeline catch drift before deploy.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────┐
│  Browser                                                   │
│  54 × .html (multi-page)  +  js/  (vanilla ES2020+)       │
│  Served by: Cloudflare Pages (www.rulebritannia.org)       │
└──────────────────┬─────────────────────────────────────────┘
                   │  /api/*  (relative, same-origin)
                   ▼
┌────────────────────────────────────────────────────────────┐
│  Cloudflare Worker  (worker/index.js)                      │
│  Route: rulebritannia.org/api/*                            │
│  + Cloudflare Pages Function  (functions/api/[[path]].js)  │
│  Route: www.rulebritannia.org/api/*  (Pages fallback)      │
│  → proxies to Render backend                               │
└──────────────────┬─────────────────────────────────────────┘
                   │  HTTPS
                   ▼
┌────────────────────────────────────────────────────────────┐
│  Express server  (server/index.js, Node ≥ 18)              │
│  ~21 000 lines, ~392 REST endpoints                        │
│  Auth / CSRF / Sessions / Rate-limiting / RBAC             │
│  Email (SendGrid)  ·  Discourse API  ·  Turnstile          │
└──────────────────┬─────────────────────────────────────────┘
                   │  pg (node-postgres)
                   ▼
┌────────────────────────────────────────────────────────────┐
│  PostgreSQL (Neon recommended)                             │
│  ~95 tables: users, bills, motions, divisions, sessions,   │
│  discourse_topics, audit_logs, app_config, finance_config, │
│  characters, parties, constituencies,                      │
│  support_tickets, support_messages, …                      │
└────────────────────────────────────────────────────────────┘
```

**Key design decisions:**

- No frontend bundler — HTML pages are served directly; `js/` uses native ES modules.
- Single CSS file (`styles.css`) with CSS custom properties for theming.
- The backend is a single large Express file (`server/index.js`); schema is bootstrapped automatically via `ensureSchema()` on start.
- All API calls from the frontend are relative `/api/...` paths; the Cloudflare layer handles routing to the Render backend transparently.

---

## Repository Structure

```
rulebritannia-app/
├── *.html                  # 54 multi-page HTML routes
├── styles.css              # Global stylesheet (CSS custom properties)
├── wrangler.toml           # Cloudflare Worker configuration
│
├── js/                     # Frontend application code (ES2020+, no bundler)
│   ├── main.js             # Entry point + data-page router (38+ pages)
│   ├── api.js              # ~351 backend API call wrappers
│   ├── core.js             # Boot sequence, state helpers, ensureDefaults
│   ├── ui.js               # Nav init, HTML escaping, toast/modal rendering
│   ├── clock.js            # Real-time → sim-time mapping (mirrors server/clock.js)
│   ├── auth.js             # Login/logout/session helpers
│   ├── permissions.js      # Role/office permission checks
│   ├── divisions.js        # Vote weighting and delegation logic
│   ├── bill-drafting.js    # Bill text parsing and formatting
│   ├── audit.js            # Audit log helpers
│   ├── character-enums.js  # Character class/background enum definitions
│   ├── constituency-utils.js # Constituency lookup and filtering
│   ├── errors.js           # Error handling utilities
│   ├── parties.js          # Party enum definitions
│   ├── components/         # Reusable UI components (form-row, modal, tile, toast)
│   ├── engines/            # Game logic modules (core, division, permission, control-panel)
│   └── pages/              # Per-page init modules (one file per .html route)
│
├── server/                 # Express backend
│   ├── index.js            # Main server (~21 000 lines, all routes, schema bootstrap)
│   ├── db.js               # PostgreSQL connection pool (pg)
│   ├── discourse.js        # Discourse API client + DiscourseConnect SSO helpers
│   ├── discourseClient.js  # Stateless positional-arg Discourse HTTP client
│   ├── clock.js            # Server-side sim clock (mirrors js/clock.js)
│   ├── roles.js            # Role assignment helpers + Discourse group mapping
│   ├── guides-seed.js      # 15 predefined guide entries + seedPredefinedGuides() startup seeder
│   ├── political-state-service.js  # FACTION_PLAYABLE_PARTIES, faction/character political-state compute
│   ├── division-helpers.js         # Vote weight helpers, SPEAKER/SINN_FEIN regex, tally logic
│   ├── finance-service.js          # resolveActiveSalaryScale, computeCharacterAnnualSalary
│   ├── recompute-helpers.js        # fireRecompute / awaitedRecompute with observability
│   ├── rbac-helpers.js             # RBAC guard utilities
│   ├── state-contracts.js          # State-ownership boundary enforcement
│   ├── .env.example        # Environment variable reference
│   ├── package.json        # Node dependencies
│   ├── *.test.js           # Unit tests (Node native test runner)
│   └── README.md           # Server-specific notes (env vars, production guards)
│
├── worker/
│   └── index.js            # Cloudflare Worker: API proxy + apex domain redirect
│
├── functions/
│   └── api/[[path]].js     # Cloudflare Pages Function: always-on API proxy fallback
│
├── scripts/
│   ├── convert-1997-csv.js         # Convert 1997 CSV → constituencies_1997.json
│   ├── render-version-assets.mjs   # Cache-bust: appends ?v=<sha> to asset refs in HTML
│   ├── static-checks.js            # 8 static analysis checks (no DB needed)
│   └── audit/
│       ├── rbac-matrix.json         # RBAC reference: 100+ endpoints with roles + flags
│       ├── feature-manifest.js      # Scan routes, compare against RBAC matrix
│       └── generate-audit-report.mjs # Generate audit-report.json
│
├── data/
│   ├── demo.json                   # ~284 KB seed data for read-only demo mode
│   ├── constituencies_1997.json    # 1997 UK constituency data (generated)
│   └── 1997_structured.csv         # Source CSV for constituencies (in assets/ too)
│
├── assets/
│   ├── RB System Logo.png
│   ├── red-lion.svg
│   ├── top_bar_refined_600x80.png
│   ├── 1997_structured.csv         # Source CSV also mirrored here
│   └── landing/                   # Landing page assets
│
├── docs/
│   ├── system-overview.md          # High-level architecture map and component guide
│   ├── architecture.md             # Deep architecture: schema, security, CORS, sessions
│   ├── dev-guide.md                # Developer handbook: workflow, patterns, testing
│   ├── simulation-model.md         # Simulation domain: legislation, divisions, political state, finance
│   ├── trial-runbook.md            # Operational runbook: live trial, smoke tests, rollback
│   ├── state-ownership.md          # State-ownership boundary reference (snapshot vs relational)
│   └── archive/                    # Historical planning and audit documents (not current)
│
├── .github/
│   └── workflows/
│       └── static-checks.yml      # CI: static-checks + feature-manifest + server unit tests
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Vanilla JavaScript (ES2020+, native ES modules), multi-page HTML, single CSS file |
| **Backend** | Node.js ≥ 18, Express 4.19 |
| **Database** | PostgreSQL (Neon recommended); schema auto-created via `ensureSchema()` |
| **Sessions** | `express-session` + `connect-pg-simple` (PostgreSQL session store) |
| **Password hashing** | `bcryptjs` |
| **Email** | SendGrid (`@sendgrid/mail`) |
| **Anti-bot** | Cloudflare Turnstile |
| **Forum integration** | Discourse (DiscourseConnect SSO + REST API) |
| **CDN / Proxy** | Cloudflare Workers + Cloudflare Pages Functions |
| **Hosting** | Render (backend web service + static site) |
| **Rate limiting** | `express-rate-limit` |
| **CI** | GitHub Actions |
| **Test runner** | Node.js native test runner (`node --test`) |

---

## Documentation

| Document | Purpose |
|---|---|
| **[`docs/system-overview.md`](docs/system-overview.md)** | High-level system map: architecture diagram, component table, data flow, roles, background tasks |
| **[`docs/architecture.md`](docs/architecture.md)** | Deep architecture reference: schema design, state-ownership, session config, CORS, security hardening, testing |
| **[`docs/dev-guide.md`](docs/dev-guide.md)** | Developer handbook: backend internals, frontend patterns, development workflow, testing guide |
| **[`docs/simulation-model.md`](docs/simulation-model.md)** | Simulation domain: parliamentary procedure, factions, political capital/pressure, character political state, finance |
| **[`docs/trial-runbook.md`](docs/trial-runbook.md)** | Operational runbook: live trial setup, smoke test flows, monitoring, snapshot restore, rollback |
| **[`docs/state-ownership.md`](docs/state-ownership.md)** | State-ownership boundary reference: snapshot vs relational tables, route scope, runtime enforcement |
| **[`server/README.md`](server/README.md)** | Server-specific notes: env vars, production-disabled endpoints, whip system API |
| **[`docs/archive/`](docs/archive/)** | Historical planning and audit documents retained for reference |

---

## Local Development Setup

### Prerequisites

- **Node.js ≥ 18**
- A **PostgreSQL** database (local or a free [Neon](https://neon.tech) account)
- _(Optional)_ A static file server for the frontend (e.g. `npx serve`)

### 1 — Clone and install backend dependencies

```bash
git clone https://github.com/DaleW82003/rulebritannia-app.git
cd rulebritannia-app/server
npm install
```

### 2 — Configure environment variables

```bash
cp .env.example .env
# Edit .env with your values (see Environment Configuration below)
```

At minimum you need `DATABASE_URL` and `SESSION_SECRET`.

### 3 — Start the backend

```bash
node index.js
# Server listens on PORT (default: 3000)
# Schema tables are created automatically on first start
```

### 4 — Serve the frontend

Serve the project root (not `server/`) with any static file server:

```bash
cd ..          # back to repo root
npx serve .
# Open http://localhost:3000 (or whichever port serve uses)
```

If the backend is on a different port, either:

- Set `window.RB_API_BASE = "http://localhost:4000"` in your browser console before navigating, or
- Add the following before `js/main.js` in the relevant HTML:

```html
<script>window.RB_API_BASE = "http://localhost:4000";</script>
<script type="module" src="js/main.js"></script>
```

### 5 — Demo mode (no backend required)

To browse the UI without running a server at all:

```bash
npx serve .
```

Open `dashboard.html`. Without a backend session every page loads read-only data from `data/demo.json` and displays a **DEMO MODE** banner. Writes are disabled.

---

## Environment Configuration

Copy `server/.env.example` to `server/.env` and fill in the values below.

> **Important:** `server/.env` is in `.gitignore`. Never commit secrets to source control.

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string (e.g. `postgres://user:pass@host/db?sslmode=require`). Neon strings are auto-detected for SSL. |
| `SESSION_SECRET` | ✅ | — | Long random string for signing session cookies. In `production` mode the server **refuses to start** if this is missing or set to the default placeholder. Generate with: `openssl rand -hex 32` |
| `PORT` | ✗ | `3000` | Port the server listens on. |
| `NODE_ENV` | ✗ | _(unset)_ | Set to `production` on Render/hosting. Enables startup validation, production CORS rules, and `isDevSeedAllowed()` guards. If unset, behaves permissively (dev-seed endpoints are accessible). |
| `DISCOURSE_SSO_ENABLED` | ✗ | `false` | Set to `true` to activate DiscourseConnect SSO endpoints (`/api/discourse/sso` and callback). |
| `DISCOURSE_ENCRYPTION_KEY` | ✗ | derived from `SESSION_SECRET` | 64-char hex AES-256 key for encrypting stored Discourse credentials in the DB. Only needed if rotating the key independently of the session secret. |
| `SENDGRID_API_KEY` | ✗ | — | SendGrid API key for email verification messages. **Never commit this.** |
| `SENDGRID_FROM` | ✗ | `support@rulebritannia.org` | Sender address for outgoing emails. |
| `APP_BASE_URL` | ✗ | `https://www.rulebritannia.org` | Base URL used to build links in emails (no trailing slash). |
| `TURNSTILE_ENABLED` | ✗ | `false` | Set to `true` to activate the Cloudflare Turnstile anti-bot widget on the registration form. |
| `TURNSTILE_SITE_KEY` | ✗ | — | Cloudflare Turnstile site key (public; safe to expose to the frontend via `/api/config`). |
| `TURNSTILE_SECRET_KEY` | ✗ | — | Cloudflare Turnstile secret key. **Never commit this.** |
| `ENABLE_DEV_SEED` | ✗ | `false` | Set to `true` on a non-production environment to re-enable dev/seed/wipe endpoints that are disabled in production. **Never set this in production.** |

> **Note:** Discourse credentials (API key, API username, base URL, SSO secret) are stored **encrypted in the `app_config` database table** and managed through the Admin Panel UI — not through environment variables.

---

## Running the Application

### Start the backend

```bash
cd server
node index.js
```

On first run `ensureSchema()` creates all required database tables automatically.

The server exposes:

- `GET /health` — health check (no auth)
- `GET /api/health` — API health check
- `GET /api/bootstrap` — public config, clock state, and (when logged in) user + simulation state

### Serve the frontend

Serve the repo root as a static site. The frontend is pure HTML + vanilla JS; no build step is needed for local development (the `render-version-assets.mjs` script is only needed for Render Static Site deploys).

### Accessing the pages

| Page | URL | Notes |
|---|---|---|
| Landing / home | `index.html` | Public |
| Registration | `register.html` | Public; email + admin approval required |
| Login | `login.html` | Supports email/password and (if enabled) Discourse SSO |
| Dashboard | `dashboard.html` | Works in demo mode unauthenticated |
| Admin Panel | `admin-panel.html` | Requires `admin` role |
| Control Panel | `control-panel.html` | Requires `admin` or `mod` role |
| Support | `support.html` | Requires login; players see own tickets; staff (admin/mod) see all tickets |

### API communication

All frontend API calls use relative `/api/...` paths via the wrappers in `js/api.js`. A CSRF token is fetched automatically on the first mutation request and refreshed on 403 responses. In production the Cloudflare Worker/Pages Function proxies these calls to the Render backend invisibly.

### Debug mode

The **API Sources** health panel is hidden by default. Enable it during development:

```bash
# URL flag (per-page)
http://localhost:3000/dashboard.html?debug=1

# Persistent (browser console)
localStorage.setItem('rb_debug', '1');
localStorage.removeItem('rb_debug');  # to disable
```

---

## Data and Assets

### `data/demo.json`

~284 KB JSON file seeded with a representative parliament snapshot (parties, characters, bills, motions, economy, etc.). Used exclusively for **read-only demo mode** when no authenticated session exists. This file is never written by the server; it is a static asset.

### `data/constituencies_1997.json`

~133 KB JSON array of 1997 UK Westminster constituencies. Each entry includes constituency name, region, winning party, and MP name. Generated from the CSV source by `scripts/convert-1997-csv.js`.

Used by:
- `POST /api/admin/constituencies/initialize-1997` — seeds the constituencies table from this file (dev/staging only, guarded by `isDevSeedAllowed()`).
- `js/constituency-utils.js` — lookup and filtering helpers for the frontend.

### `assets/1997_structured.csv` / `data/1997_structured.csv`

Source CSV file for the 1997 constituency data. The canonical copy lives in `assets/`; a duplicate is also present in `data/`. Convert to JSON with:

```bash
node scripts/convert-1997-csv.js
```

This regenerates `data/constituencies_1997.json`.

---

## Scripts

### `scripts/render-version-assets.mjs`

**Purpose:** Cache-busting for Render Static Site deploys.

Rewrites every `*.html` file to replace `styles.css` and `js/main.js` references with versioned equivalents (`?v=<sha>`). Version is derived from (in priority order):
1. `RENDER_GIT_COMMIT` — set automatically by Render
2. `GITHUB_SHA` — set automatically by GitHub Actions
3. A fallback timestamp string

Re-running the script is idempotent (replaces any existing `?v=` parameter).

**Usage:**

```bash
node scripts/render-version-assets.mjs           # applies changes in-place
node scripts/render-version-assets.mjs --dry-run # prints changes without writing
```

**Render Static Site settings:**

| Setting | Value |
|---|---|
| Build Command | `node scripts/render-version-assets.mjs` |
| Publish Directory | `.` |

### `scripts/convert-1997-csv.js`

**Purpose:** Convert the raw `assets/1997_structured.csv` into `data/constituencies_1997.json`.

Normalises party name variants (e.g. multiple spellings of "Sinn Féin") and outputs structured JSON.

```bash
node scripts/convert-1997-csv.js
```

### `scripts/static-checks.js`

**Purpose:** 8 static analysis checks that require no database connection.

| Check | What it verifies |
|---|---|
| Fetch credentials | All `fetch()` calls in `js/` include `credentials: 'include'` where required |
| Auth guards | Sensitive routes have auth middleware |
| Error shapes | All JSON error responses use the standard `{ error: "..." }` shape |
| Player immutability | Player-facing endpoints do not mutate fields reserved for admin/server |
| Fire-and-forget | Async calls are awaited (no unhandled promise drops) |
| pg-pool double-release | `client.release()` is not called twice in the same code path |
| CSRF | Mutation endpoints use the CSRF middleware |
| Dev-seed guards | All `wipe/seed/clear/import/repair` endpoints call `isDevSeedAllowed()` first |

```bash
node scripts/static-checks.js
```

### `scripts/audit/feature-manifest.js`

**Purpose:** Scan `server/index.js` for registered routes and compare against `scripts/audit/rbac-matrix.json` to detect RBAC drift (routes with no matrix entry, or entries with no matching route).

```bash
node scripts/audit/feature-manifest.js
```

### `scripts/audit/generate-audit-report.mjs`

**Purpose:** Produce `scripts/audit/out/audit-report.json` from the feature manifest output. Used for CI artefact upload.

```bash
node scripts/audit/generate-audit-report.mjs
```

---

## Worker Process

`worker/index.js` (Cloudflare Worker) proxies all `/api/*` requests from `rulebritannia.org` to the Render backend and 308-redirects bare-domain `GET`/`HEAD` traffic to `www.rulebritannia.org`. The Cloudflare Pages Function at `functions/api/[[path]].js` provides the same proxy for `www.rulebritannia.org/api/*`. Both forward cookies and headers unchanged.

Deploy the Worker with:
```bash
wrangler deploy
```

For detailed proxy configuration and background-task architecture, see **[`docs/architecture.md`](docs/architecture.md)**.

---

## Discourse Integration

Rule Britannia acts as the **DiscourseConnect identity provider** — users log in to the sim and are seamlessly authenticated into the Discourse forum. Credentials (Discourse base URL, API key, SSO secret) are stored **encrypted** in the `app_config` database table and managed through **Admin Panel → Discourse Integration**. They are never read from environment variables.

The only Discourse-related environment variables are:
- `DISCOURSE_SSO_ENABLED=true` — activates the SSO endpoints
- `DISCOURSE_ENCRYPTION_KEY` — optional AES-256 key override for encrypted DB storage

> ⚠️ **Common misconfiguration:** In Discourse admin, enable `enable_discourse_connect_provider` (the sim is the provider). Do **not** enable `enable_discourse_connect` (that sets Discourse as the consumer and sends `sso`/`sig` params to the sim, which the server rejects with HTTP 400).

For the full SSO setup guide, group sync details, and server module reference, see **[`docs/trial-runbook.md`](docs/trial-runbook.md)** and **[`docs/dev-guide.md §9`](docs/dev-guide.md)**.

---

## Testing

### Unit tests

Located in `server/`:

| File | Description |
|---|---|
| `server/clock.test.js` | Unit tests for `computeSimDateFromGameState` — covers null input, sim-not-started, paused, and running states. |
| `server/discourse.test.js` | Unit tests for DiscourseConnect SSO helpers — `buildSsoPayload`, `verifySsoPayload`, `verifyConsumerRequest`, `buildConsumerResponse`, group management. |
| `server/roles.test.js` | Unit tests for `computeDiscourseGroups`, `partyRoleForPartyName`, `computeApprovalRolesToAdd`, `officeRoleFromSpecId`. |
| `server/state-contracts.test.js` | Unit tests for `assertSnapshotDerivedTable()`, `stripRelationalKeys()` — state-ownership boundary enforcement. |
| `server/service-modules.test.js` | Unit tests for `political-state-service.js` and `division-helpers.js` (34 tests). |
| `server/identity-hardening.test.js` | Unit tests for immutable identity authority checks (21 tests). |
| `server/recompute-helpers.test.js` | Unit tests for `fireRecompute`/`awaitedRecompute` observability helpers. |
| `server/rbac-helpers.test.js` | Unit tests for RBAC guard helper utilities. |
| `server/parliamentary-political-state.integration.test.js` | Pure (no-DB) political-state tests. |

Run all unit tests:

```bash
node --test server/*.test.js
```

### Static checks

```bash
node scripts/static-checks.js
```

Runs 8 pattern-based checks on the source code (no database or server required). All checks must pass before deployment.

### RBAC feature manifest

```bash
node scripts/audit/feature-manifest.js
node scripts/audit/generate-audit-report.mjs
```

Compares registered Express routes against `scripts/audit/rbac-matrix.json` and reports drift warnings. Target: `rbacDriftWarnings: 0`.

### CI

GitHub Actions runs on every push and pull request (`.github/workflows/static-checks.yml`): static checks, feature manifest, all three server unit tests (`clock.test.js`, `discourse.test.js`, `roles.test.js`), and RBAC matrix artefact upload.

For staging integration tests, API suite tests, and manual testing scenarios, see **[`docs/dev-guide.md §11`](docs/dev-guide.md)**.

---

## Registration & Approval Flow

Rule Britannia uses a **gated registration** model. A new account requires both email verification and admin approval.

1. Applicant submits the registration form (`register.html`) — display name, username, email, password, 16+ attestation, optional marketing opt-in. If Turnstile is enabled the anti-bot challenge is verified server-side first.
2. Server stores a **pending registration** and sends a verification email (single-use token, expires 24 hours).
3. Applicant clicks the link → `GET /api/auth/verify-email?token=…` → `email_verified = true` on the pending record.
4. Admin reviews **Pending Registrations** in the Admin Panel and clicks **Approve** or **Reject**.
5. On approval a live `users` row is created; login becomes available only after both verification and approval.

**Email resend** is rate-limited to 3 requests/hour per IP and a 5-minute minimum between resends per address (`POST /api/auth/resend-verification`).

---

## Simulation Clock

The simulation clock maps real calendar time to simulated months:

| Real days | Sim advance |
|---|---|
| Monday / Tuesday / Wednesday | 1 sim month |
| Thursday / Friday / Saturday | 1 sim month |
| Sunday | Frozen (no advance) |

This yields **2 sim months per real week**. The default start date is **August 1997**.

The clock algorithm is implemented in both `js/clock.js` (frontend) and `server/clock.js` (backend) and must be kept in sync. The server exposes `GET /api/clock` (read), `POST /api/clock/tick` (advance), and `POST /api/clock/set` (set directly).

---

## Security Notes

- All mutation endpoints require a CSRF token (double-submit cookie). The `js/api.js` `_fetch()` wrapper auto-refreshes on `403 "CSRF token missing or invalid"`.
- Sessions use `connect-pg-simple` (PostgreSQL store); `sameSite: "none"`, `secure: true`, `httpOnly: true`, scoped to `.rulebritannia.org`.
- `isDevSeedAllowed()` gates all destructive endpoints — returns `404` in `NODE_ENV=production` unless `ENABLE_DEV_SEED=true`. Always set `NODE_ENV=production` on hosted instances.
- Discourse API credentials are AES-256-encrypted in the `app_config` table. Never stored in environment variables.

For the full security reference (CORS, rate limiting, RBAC, audit hardening), see **[`docs/architecture.md §10`](docs/architecture.md)**.

---

## Live Trial

See **[docs/trial-runbook.md](docs/trial-runbook.md)** for the 3-user live trial runbook, including:

- Pre-trial checklist
- User registration and admin approval steps
- Role assignment (admin → player characters)
- Danger Zone reset tools (wipe/seed) for resetting between rounds
- Discourse SSO setup and group-sync notes

---

## Development Notes

Alpha safety hardening (production-disabled dev/seed endpoints via `isDevSeedAllowed()`) is documented in **[`docs/dev-guide.md §13`](docs/dev-guide.md)** and **[`docs/architecture.md §10`](docs/architecture.md)**. The historical hardening summary is in [`docs/archive/ALPHA_HARDENING_SUMMARY.md`](docs/archive/ALPHA_HARDENING_SUMMARY.md).

Pre-launch audit fixes (B1–B4: state authority, server-authoritative division weights, staging tests, RBAC manifest) are described in [`docs/archive/AUDIT_FIX_SUMMARY.md`](docs/archive/AUDIT_FIX_SUMMARY.md).

---

## Adding a New Page

1. Create `newpage.html` with `<body data-page="newpage">`.
2. Create `js/pages/newpage.js` exporting `initNewpagePage(data)`.
3. Import and register the init function in the route table in `js/main.js`.

---

## Contributing Guidelines

- **No bundler** — the frontend uses native ES modules. Do not introduce a build step for frontend code.
- **Server changes** — the backend is a single Express file (`server/index.js`). All new routes must be added to `scripts/audit/rbac-matrix.json` with their required roles and rationale.
- **Run static checks before committing:**
  ```bash
  node scripts/static-checks.js
  node scripts/audit/feature-manifest.js
  ```
- **Tests** — add unit tests in `server/*.test.js` for any new server-side logic. Run with `node --test server/*.test.js`.
- **Secrets** — never commit `.env`, API keys, session secrets, or Discourse credentials. All secrets go in environment variables or encrypted DB storage.
- **Dev-seed endpoints** — any new destructive endpoint (wipe/seed/clear/import/repair/reset) **must** call `isDevSeedAllowed()` as its first check.
- **CSRF** — all mutation (`POST`/`PATCH`/`PUT`/`DELETE`) endpoints must use the CSRF middleware.
- **Clock algorithm** — if you change `js/clock.js`, update `server/clock.js` to match, and vice versa.

For the full development workflow (environment setup, modifying backend/frontend, adding API endpoints, cache busting), see **[`docs/dev-guide.md §12`](docs/dev-guide.md)**.

---

## Known Limitations

- **Single-file server** — `server/index.js` is ~21 000 lines. There is no module splitting or router separation.
- **`NODE_ENV` default** — if `NODE_ENV` is unset, `isDevSeedAllowed()` returns `true`, exposing dev/seed endpoints. Always set `NODE_ENV=production` in hosted environments.
- **Manual sim clock** — the clock does not tick automatically; an admin must trigger `POST /api/clock/tick`.
- **No real-time push** — there is no WebSocket or SSE layer; pages must be manually refreshed.

For the full list of known limitations and future development areas, see **[`docs/dev-guide.md §15–16`](docs/dev-guide.md)**.

---

## Upcoming Work

The following systems are partially implemented or planned for the next development phase:

| Area | Status | Notes |
|---|---|---|
| **Economy** | Partially implemented | Economy indicators (GDP, inflation, unemployment) exist as admin-editable fields. Dynamic modelling linking policy choices to economic outcomes is not yet implemented. |
| **Budget** | Implemented (draft/approve flow) | Budget draft, approval, and rejection workflows are live. Automatic effect propagation from budget decisions to economic indicators is upcoming. |
| **Polling** | Implemented (entry recording) | Polling entries can be created and archived. A live polling engine driven by gameplay events (legislation, scandal, economic conditions) is upcoming. |
| **Support ticketing** | Implemented | Players open tickets from `support.html`; staff (admin/mod) manage the queue with status transitions (`open → finished → closed`), label tagging, per-side unread tracking, and 25-second auto-polling. Future: email notification on new staff reply, real-time push, support ticket pagination in the staff view. |
| **House of Lords** | Body tracked | The Lords exist as a tracked parliamentary body but do not participate in bill passage. A Lords stage is a planned extension. |
| **Onboarding Guides** | Implemented | 15 predefined guides seeded on startup. Collapsible panels on `guides.html`. Staff-editable via Control Panel. |
| **Starter Pack** | Implemented | "5 first-week actions" guide shown to new players with no active character. Staff-editable from Control Panel. |
| **Bodies / Locals admin** | Implemented | Parliamentary bodies and local authority data editable via Control Panel. 1997 seed via `POST /api/admin/seed-1997-bodies-locals` (dev/staging only). House of Lords uses `compositionBreakdown`; Lords and EuroParl have no Control fields. |
| **Other Officials allocations** | Implemented | `other_officials_faction_allocations` table tracks non-Commons official slots per party and faction. Admin UI in Control Panel. |
| **Elections** | Seed data only | The 1997 result is seeded at setup. A general election mechanism allowing seat redistribution mid-simulation is a planned extension. |
