# Rule Britannia Backend

A browser-based UK parliamentary political simulation.

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
│  ~21 000 lines, 100+ REST endpoints                        │
│  Auth / CSRF / Sessions / Rate-limiting / RBAC             │
│  Email (SendGrid)  ·  Discourse API  ·  Turnstile          │
└──────────────────┬─────────────────────────────────────────┘
                   │  pg (node-postgres)
                   ▼
┌────────────────────────────────────────────────────────────┐
│  PostgreSQL (Neon recommended)                             │
│  40+ tables: users, bills, motions, divisions, sessions,   │
│  discourse_topics, audit_logs, app_config, finance_config, │
│  characters, parties, constituencies, …                    │
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
│   ├── trial-runbook.md            # 3-user live trial guide
│   ├── pre-discourse-go-no-go-audit.md
│   ├── ui-polish-notes.md
│   ├── third-party-naming-notes.md
│   └── audits/                    # Dated audit snapshots
│
├── .github/
│   └── workflows/
│       └── static-checks.yml      # CI: static-checks + feature-manifest + discourse tests
│
├── ALPHA_HARDENING_SUMMARY.md      # Security hardening log (dev endpoint guards)
└── AUDIT_FIX_SUMMARY.md            # Audit fix log (B1–B4 findings)
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

### `worker/index.js` — Cloudflare Worker

The Cloudflare Worker handles three responsibilities:

1. **API proxy** — all `/api/*` requests are forwarded to `https://rulebritannia-app-backend.onrender.com`. This allows the frontend to use relative `/api/...` paths in production.
2. **Apex domain redirect** — `GET`/`HEAD` requests to `rulebritannia.org` (without `www`) are 301-redirected to `https://www.rulebritannia.org`. `POST`/`PUT`/`PATCH`/`DELETE` requests are proxied directly (browsers won't navigate bare-domain on mutations).
3. **Health check** — responds to `GET /api/worker-test` with `"WORKER_OK rb-api-proxy"`.

Session cookies are scoped to `.rulebritannia.org` so they work on both the apex and `www` subdomains.

Deploy with:
```bash
wrangler deploy
```

### `functions/api/[[path]].js` — Cloudflare Pages Function

An always-on fallback API proxy deployed automatically as part of the Cloudflare Pages build. It serves `www.rulebritannia.org/api/*` when the standalone Worker is not yet deployed. Once the Worker is live, the Worker takes precedence for `rulebritannia.org/api/*` while this Pages Function continues handling `www.rulebritannia.org/api/*`.

No separate deployment step is needed — it is included in the Pages publish directory.

---

## Discourse Integration

### Architecture

Rule Britannia acts as the **DiscourseConnect identity provider** (not consumer). The flow is:

```
1. User clicks "Login with Discourse" on the sim
2. Browser → GET /api/discourse/sso  (no params — starts SSO)
3. Server generates nonce + HMAC-signed payload → redirects to:
      https://forum.rulebritannia.org/session/sso_provider?sso=…&sig=…
4. Discourse authenticates the user, then redirects back to:
      /api/discourse/sso/callback?sso=…&sig=…
5. Server verifies signature + nonce, finds or creates local account,
   sets session, redirects to the sim dashboard
```

> ⚠️ **Common misconfiguration:** Do **not** set Discourse's `discourse_connect_url` — that enables *Discourse-as-consumer* mode and will cause Discourse to send `sso`/`sig` parameters to `/api/discourse/sso`, which the server rejects with HTTP 400. The correct Discourse setting is `enable_discourse_connect_provider`.

### Discourse credentials

Credentials (base URL, API key, API username, SSO secret) are stored **encrypted** in the `app_config` database table and managed through **Admin Panel → Discourse Integration**. They are never read from environment variables.

The only Discourse-related environment variables are:
- `DISCOURSE_SSO_ENABLED=true` — activates the SSO endpoints
- `DISCOURSE_ENCRYPTION_KEY` — optional AES-256 key override for encrypted DB storage

### Discourse modules

Two client modules coexist in `server/`:

| Module | Style | Used for |
|---|---|---|
| `discourse.js` | Object-param style (`opts` argument) | `closeDiscTopic`, SSO payload helpers, group management, `resolveGroupIds` |
| `discourseClient.js` | Positional-arg style | `dcCreateTopic`, `dcCreatePost`, `dcWithRetry` |

Both have a `closeTopic` function; only the `discourse.js` version is currently called from `server/index.js`.

### Group sync

`enqueueDiscourseGroupSync()` maintains Discourse group membership in sync with application roles. It uses a debounce timer and single-flight mechanism to avoid redundant syncs. Groups in `DISCOURSE_GROUP_MAP` (defined in `server/roles.js`) correspond to application roles; Discourse automatic groups (`admins`/`moderators`) are excluded — admin/mod status is conveyed via DiscourseConnect SSO flags.

### Debate topics

`POST /api/debates/create` creates a Discourse topic and persists its `topicId`/`topicUrl` to both the `discourse_topic_id`/`discourse_topic_url` columns and the `data` JSONB field. The auto-close cron (`runDebateAutoClose()`) closes topics on the clock tick using the `discourse_topic_id` column.

### SSO URL reference

| URL | Purpose |
|---|---|
| `GET /api/discourse/sso` | Starts SSO flow — **no params**. Returns 400 if `sso`/`sig` are present. |
| `GET /api/discourse/sso/callback` | SSO callback — Discourse redirects here after auth. Never call directly. |

To enable SSO:
1. Fill in Discourse credentials in the Admin Panel.
2. In Discourse Admin → Settings → Login: enable `enable_discourse_connect_provider` and add the shared secret under `discourse_connect_provider_secrets`.
3. Set `DISCOURSE_SSO_ENABLED=true` in server env and restart.
4. Use **Admin Panel → SSO Readiness** to verify all prerequisites are met.

---

## Testing

### Unit tests

Located in `server/`:

| File | Description |
|---|---|
| `server/clock.test.js` | Unit tests for `computeSimDateFromGameState` — covers null input, sim-not-started, paused, and running states. |
| `server/discourse.test.js` | Unit tests for DiscourseConnect SSO helpers — `buildSsoPayload`, `verifySsoPayload`, `verifyConsumerRequest`, `buildConsumerResponse`, group management. |
| `server/roles.test.js` | Unit tests for `computeDiscourseGroups`, `partyRoleForPartyName`, `computeApprovalRolesToAdd`, `officeRoleFromSpecId`. |

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

### Staging integration tests

Requires a live staging server and valid credentials:

```bash
BASE_URL="https://rulebritannia-app-backend.onrender.com" \
TEST_EMAIL="admin@example.com" \
TEST_PASSWORD="..." \
TEST_LOW_EMAIL="backbencher@example.com" \
TEST_LOW_PASSWORD="..." \
node scripts/test-staging.mjs
```

Tests: persistence, immutability, division authority, bill vote authority, RBAC.

CSRF tokens are fetched automatically via `GET /api/csrf-token`.

### API test suites

```bash
BASE_URL="https://rulebritannia-app-backend.onrender.com" \
COOKIE_PLAYER="rb.sid=..." \
COOKIE_MOD="rb.sid=..." \
COOKIE_ADMIN="rb.sid=..." \
node --test tests/api/*.spec.js
```

### CI

GitHub Actions runs on every push and pull request (`.github/workflows/static-checks.yml`):
- `scripts/static-checks.js`
- `scripts/audit/feature-manifest.js`
- `server/discourse.test.js`
- Uploads the feature manifest as a build artefact

---

## Registration & Approval Flow

Rule Britannia uses a **gated registration** model. A new account requires both email verification and admin approval.

1. Applicant submits the registration form (`register.html`) — display name, username, email, password, 16+ attestation, optional marketing opt-in. If Turnstile is enabled the anti-bot challenge is verified server-side first.
2. Server stores a **pending registration** and sends a verification email (single-use token, expires 24 hours).
3. Applicant clicks the link → `GET /api/auth/verify-email?token=…` → `email_verified = true` on the pending record.
4. Admin reviews **Pending Registrations** in the Admin Panel and clicks **Approve** or **Reject**.
5. On approval a live `users` row is created; login becomes available only after both verification and approval.

**Email resend** is rate-limited to 3 requests/hour per IP and a 5-minute minimum between resends per address (`POST /api/auth/resend-verification`).

**Marketing opt-in** (unchecked by default) is stored as `marketing_opt_in` / `marketing_opt_in_at` on the pending registration. Transactional emails are sent regardless of this setting.

---

## Simulation Clock

The simulation clock maps real calendar time to simulated months:

| Real days | Sim advance |
|---|---|
| Monday / Tuesday / Wednesday | 1 sim month |
| Thursday / Friday / Saturday | 1 sim month |
| Sunday | Frozen (no advance) |

This yields **2 sim months per real week**. The default start date is **August 1997**.

The clock algorithm is implemented in both `js/clock.js` (frontend) and `server/clock.js` (backend) and must be kept in sync. The server exposes `GET /api/clock` (read), `POST /api/clock/tick` (advance), and `POST /api/clock/set` (set directly). The clock can be paused and resumed; while paused, the sim date is frozen at `pausedAtRealDate`.

---

## Development Notes

### Alpha Safety Hardening (ALPHA_HARDENING_SUMMARY.md)

Before alpha testing, all dangerous dev/admin endpoints were audited and hardened:

- **Production-disabled** (`wipe` / `reset` / `clear` / `seed` / `initialize` / `import` / `repair`) — return `404` unless `ENABLE_DEV_SEED=true`. Guard via `isDevSeedAllowed()` called as the **first** check on each endpoint.
- **Admin-only in production** (`export-snapshot`, `force-logout-all`, `rotate-sessions`, `discourse/test`, `government/reset`, `opposition/reset`) — available in production, require `admin` (or `admin`/`mod`) role.

The `isDevSeedAllowed()` helper is defined once in `server/index.js`:

```javascript
function isDevSeedAllowed() {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_SEED === "true";
}
```

> ⚠️ If `NODE_ENV` is unset, `isDevSeedAllowed()` returns `true` (permissive). Always set `NODE_ENV=production` on your hosting environment.

### Audit Fixes (AUDIT_FIX_SUMMARY.md)

Four audit findings (B1–B4) were addressed:

- **B1** — Staging test script (`scripts/test-staging.mjs`) added, covering persistence, immutability, division authority, bill vote authority, and RBAC.
- **B2** — Frontend authenticated state no longer cached in `localStorage`; `saveData()` throws and `saveState()` warns if called when authenticated.
- **B3** — Division voting is now server-authoritative: `effective_weight` and `immutable_result` are computed and stored server-side; new `PATCH /api/bills/:id/vote` endpoint handles proportional seat-weight voting.
- **B4** — Feature manifest matcher improved; RBAC allowlist updated; `remainingWarnings: 0` achieved.

---

## Security / Hardening Notes

### Authentication

- Email + password login with bcrypt password hashing.
- DiscourseConnect SSO available as an alternative login method when `DISCOURSE_SSO_ENABLED=true`.
- Sessions use a PostgreSQL session store (`connect-pg-simple`). `session.rolling = true` keeps active sessions alive.
- In `NODE_ENV=production` the server refuses to start if `SESSION_SECRET` is missing or uses the default placeholder value.

### CSRF protection

All mutation endpoints require a CSRF token (double-submit cookie pattern). The frontend `js/api.js` `_fetch()` wrapper auto-refreshes the token and retries once on `403 "CSRF token missing or invalid"`.

### Role-based access control (RBAC)

The server enforces the following role hierarchy on relevant endpoints:

| Middleware | Roles granted |
|---|---|
| `requireAdmin` | `admin` |
| `requireAdminOrMod` | `admin`, `mod` |
| `requireAdminModOrSpeaker` | `admin`, `mod`, `speaker` |
| `requireLogin` | any authenticated user |

Additional office-level roles (e.g. `office:prime_minister`, `office:secretary_of_state`) are granted on office assignment and checked per endpoint.

Party roles (`party:leader`, `party:whip`, etc.) are managed via `server/roles.js` helpers and reflected in Discourse group membership.

The RBAC matrix (`scripts/audit/rbac-matrix.json`) documents every endpoint with its required roles, `production_disabled` flag, and rationale. Run `node scripts/audit/feature-manifest.js` to check for drift.

### Discourse credential encryption

Discourse API credentials are encrypted with AES-256 before being stored in the `app_config` database table. The encryption key defaults to a value derived from `SESSION_SECRET` and can be overridden with `DISCOURSE_ENCRYPTION_KEY`.

### Rate limiting

`express-rate-limit` is applied to sensitive endpoints:
- Email verification resend: 3 requests/hour per IP; 5-minute minimum between resends per email address.
- Additional limits are applied to registration and authentication endpoints.

---

## Live Trial

See **[docs/trial-runbook.md](docs/trial-runbook.md)** for the 3-user live trial runbook, including:

- Pre-trial checklist
- User registration and admin approval steps
- Role assignment (admin → player characters)
- Danger Zone reset tools (wipe/seed) for resetting between rounds
- Discourse SSO setup and group-sync notes

---

## Staging Audit Run

Run the full pre-deploy verification (persistence, RBAC, immutability, division authority):

```bash
BASE_URL="https://rulebritannia-app-backend.onrender.com" \
TEST_EMAIL="admin@example.com" \
TEST_PASSWORD="..." \
TEST_LOW_EMAIL="backbencher@example.com" \
TEST_LOW_PASSWORD="..." \
node scripts/test-staging.mjs
```

Then run API test suites:

```bash
BASE_URL="https://rulebritannia-app-backend.onrender.com" \
COOKIE_PLAYER="rb.sid=..." \
COOKIE_MOD="rb.sid=..." \
COOKIE_ADMIN="rb.sid=..." \
node --test tests/api/*.spec.js
```

---

## Manual Testing Scenarios

### Demo mode (unauthenticated)

1. Open any page (e.g. `dashboard.html`) without logging in.
2. Verify the topbar shows "Not logged in" and a "Login" link.
3. State is sourced from `data/demo.json` (read-only). No network calls to `/api/state` are made.
4. Reload — demo state is always fresh; local edits do not persist.
5. Confirm `GET /api/state` returns `401` without a session cookie.

### Authenticated admin experience

1. Navigate to `login.html` and log in with admin credentials.
2. Verify the topbar shows the logged-in username.
3. State is loaded from `GET /api/state`. Confirm the request returns `200` in DevTools → Network.
4. Open `admin-panel.html` and verify email and roles are displayed.
5. Click **Save current state to server** — confirm `POST /api/state` returns `200 { ok: true }`.
6. Logout — session cleared, topbar reverts, `GET /api/auth/me` returns `401`.

### API endpoint smoke tests

```bash
# Register
curl -s -X POST https://www.rulebritannia.org/api/register \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Test","username":"testuser","email":"test@example.com","password":"Str0ng#P!","ageConfirmed":true}' | jq .

# Login
curl -s -c /tmp/rb-cookies.txt -X POST https://www.rulebritannia.org/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Str0ng#P!"}' | jq .

# Check session
curl -s -b /tmp/rb-cookies.txt https://www.rulebritannia.org/api/auth/me | jq .

# Public bootstrap config
curl -s https://www.rulebritannia.org/api/bootstrap | jq .
```

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

---

## Known Limitations

- **Single-file server** — `server/index.js` is ~21 000 lines. There is no module splitting or router separation; navigating the codebase requires familiarity with the file.
- **`NODE_ENV` default** — if `NODE_ENV` is unset, `isDevSeedAllowed()` returns `true`, exposing dev/seed endpoints. Always set `NODE_ENV=production` in hosted environments.
- **Discourse group sync concurrency** — the manual admin `POST /api/admin/discourse-sync-groups` endpoint creates a sync job via `setImmediate` without updating the debounce timer. If `enqueueDiscourseGroupSync()` fires concurrently, two sync jobs may run in parallel.
- **`parsePaginationParams` NaN handling** — the shared pagination helper passes non-numeric `?limit` / `?offset` values through `parseInt("abc", 10)` which returns `NaN`. This propagates through `Math.min`/`Math.max` without validation.
- **`recomputeUserOfficeRoles()` coverage** — office roles are recomputed on assignment/unassignment but not on fire/resign/government-reset/opposition-reset endpoints.
- **Discourse `closeTopic` duplication** — both `discourse.js` and `discourseClient.js` export a `closeTopic` function, but only the `discourse.js` version is used. The `discourseClient.js` version is dead code.
- **Export endpoint** — `GET /api/admin/export-snapshot` exposes the full game state JSON. The only protection is the `admin` role guard. Rate-limiting or IP allowlisting is recommended for production hardening.
- **Staging test script** — `scripts/test-staging.mjs` requires manually obtained session cookies for the API suite tests; there is no automated credential exchange.
- **Demo data staleness** — `data/demo.json` is a static snapshot. It does not automatically update when the simulation schema evolves.
