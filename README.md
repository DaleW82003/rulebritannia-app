# Rule Britannia

A browser-based UK parliamentary political simulation.

## Quick Start

### Demo mode (no server required)

Serve the project directory with any static file server:

```bash
npx serve .
```

Open `dashboard.html` in your browser. Without a backend session, all pages load read-only data from `data/demo.json`. Write actions are disabled and a **DEMO MODE** banner is shown.

### Full live simulation (server required)

1. Start the backend (see [Backend](#backend-server) below).
2. Serve the frontend from the same origin as the backend, or set `window.RB_API_BASE` before `js/main.js` runs.
3. Navigate to `login.html` and sign in. All state is now loaded from, and saved to, the PostgreSQL backend.

## Architecture

- **Vanilla JavaScript** (ES2020+, native ES modules) — no framework, no bundler
- **Multi-page HTML** — one `.html` file per route
- **Single CSS file** — `styles.css` with CSS custom properties for theming
- **Full-stack** — Express + PostgreSQL backend handles authentication, state persistence, and Discourse integration. `data/demo.json` is used only as a read-only preview for unauthenticated visitors.

## File Structure

```
├── data/demo.json          # Seed data (parliament, parties, economy, etc.)
├── js/
│   ├── main.js             # Entry point + data-page router
│   ├── core.js             # Boot, backend API calls, ensureDefaults, state helpers
│   ├── ui.js               # Nav init, HTML escaping, demo banner
│   ├── clock.js            # Real-time → sim-time mapping
│   ├── permissions.js      # Role/office permission checks
│   ├── divisions.js        # Vote weighting and delegation
│   ├── bill-drafting.js    # Bill text parsing
│   ├── engines/
│   │   ├── core-engine.js          # Party seat maps, Sunday Roll
│   │   ├── division-engine.js      # Vote casting, tallying, results
│   │   ├── permission-engine.js    # Access control rules
│   │   └── control-panel-engine.js # Admin state mutation helpers
│   └── pages/              # One module per page (38 files)
├── *.html                  # Page files (38 routes)
├── styles.css              # Global stylesheet
└── assets/                 # Logo, icons
```

## API Base Configuration

The frontend calls the backend API (authentication, state persistence) using a base URL resolved at runtime by `js/api.js`:

1. **`window.RB_API_BASE`** — if this global is set before `js/main.js` runs, it is used as-is.
2. **Fallback** — all other origins (including production) default to `""`, meaning every `fetch('/api/...')` call goes to the same origin as the page. This is correct for both production and local development when the backend runs on the same host/port.

All frontend code — including the admin panel — therefore calls `/api/...` relative to the current origin. There are no hard-coded backend hostnames in the frontend.

### Production deployment (Cloudflare + Render)

> **Canonical host:** `www.rulebritannia.org` — `rulebritannia.org` (apex) redirects to the `www` subdomain.

The production frontend is served from `https://www.rulebritannia.org`. The Render backend is a separate service at `https://rulebritannia-app-backend.onrender.com`. A **Cloudflare Worker** route (`www.rulebritannia.org/api/*`) proxies all `/api/*` requests to the backend, so the frontend only ever needs to call relative `/api/...` paths.

Example Cloudflare Worker snippet:

```js
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const backendUrl = "https://rulebritannia-app-backend.onrender.com" + url.pathname + url.search;
      return fetch(new Request(backendUrl, request));
    }
    return fetch(request);
  },
};
```

With this in place the frontend only ever calls `/api/*` and Cloudflare transparently forwards those requests to Render. Both the registration UI and the admin panel hit the same backend and therefore the same database.

### Debug mode

The **API Sources** status panel (showing live data-source health) is hidden from normal users. To enable it during development or debugging, use either method:

**URL flag** — append `?debug=1` to any page URL:
```
http://localhost:3000/dashboard.html?debug=1
```

**localStorage flag** — run this once in the browser console:
```js
localStorage.setItem('rb_debug', '1');
```

To disable, remove the query param or run `localStorage.removeItem('rb_debug')` in the console.

### Local development

If you are running the backend on a different port (e.g. `http://localhost:4000`), add a `<script>` tag in the relevant HTML file **before** `js/main.js`:

```html
<script>window.RB_API_BASE = "http://localhost:4000";</script>
<script type="module" src="js/main.js"></script>
```

Or set it once in your browser console before navigating to the page.

## Backend (server/)

The Express backend lives in `server/`. It requires Node ≥ 18 and a PostgreSQL database (Neon recommended).

### Environment variables

Copy `server/.env.example` to `server/.env` and fill in real values:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres connection string (e.g. Neon) |
| `SESSION_SECRET` | ✅ | Long random string used to sign session cookies. **In production (`NODE_ENV=production`) the server will refuse to start if this is missing or uses the default value.** |
| `PORT` | ✗ | Port to listen on (default: `3000`) |
| `NODE_ENV` | ✗ | Set to `production` on Render to enable production-mode guards |
| `DISCOURSE_SSO_ENABLED` | ✗ | Set to `true` to activate DiscourseConnect SSO endpoints (see below) |
| `DISCOURSE_ENCRYPTION_KEY` | ✗ | 64-char hex AES-256 key for encrypting stored Discourse credentials (defaults to a key derived from `SESSION_SECRET`) |
| `SENDGRID_API_KEY` | ✗ | SendGrid API key for sending email verification messages — **never commit this** |
| `SENDGRID_FROM` | ✗ | Sender address used in outgoing emails (default: `support@rulebritannia.org`) |
| `APP_BASE_URL` | ✗ | Base URL for building links in emails (default: `https://www.rulebritannia.org`) |
| `TURNSTILE_ENABLED` | ✗ | Set to `true` to activate the Cloudflare Turnstile anti-bot widget on registration |
| `TURNSTILE_SITE_KEY` | ✗ | Cloudflare Turnstile site key (public; safe to expose to the frontend) |
| `TURNSTILE_SECRET_KEY` | ✗ | Cloudflare Turnstile secret key — **never commit this** |

#### Setting SESSION_SECRET on Render

1. Open your backend service in the [Render dashboard](https://dashboard.render.com).
2. Go to **Environment** → **Environment Variables**.
3. Add `SESSION_SECRET` with a long random value (e.g. generate with `openssl rand -hex 32`).
4. Add `NODE_ENV` = `production`.
5. **Never commit** the secret to source control. `server/.env` is in `.gitignore` and should stay there.

### Starting the server locally

```bash
cd server
npm install
cp .env.example .env   # then edit .env with real values
node index.js
```

### Discourse integration (DiscourseConnect SSO)

The backend supports DiscourseConnect, where **Discourse acts as the SSO provider** and the Rule Britannia app is the **identity consumer**. When enabled, users on the sim click **"Login with Discourse"**, are redirected to Discourse to authenticate, and then returned to the sim with a verified identity.

> ⚠️ **Common misconfiguration**: Do **not** set Discourse's `discourse_connect_url` to our endpoint. That setting enables *Discourse-as-consumer* mode and will cause Discourse to send `sso`/`sig` parameters to `/api/discourse/sso`, which the server rejects with HTTP 400. The correct Discourse setting is `enable_discourse_connect_provider` (see below).

**SSO flow:**

```
1. User clicks "Login with Discourse" on the sim
2. Browser → GET https://www.rulebritannia.org/api/discourse/sso   (no params)
3. Server generates nonce + signed payload, redirects browser to:
      https://forum.rulebritannia.org/session/sso_provider?sso=…&sig=…
4. Discourse authenticates the user (login if needed), then redirects browser to:
      https://www.rulebritannia.org/api/discourse/sso/callback?sso=…&sig=…
5. Server verifies signature + nonce, finds/creates local account, sets session,
   redirects to the sim dashboard.
```

Discourse credentials (base URL, API key, API username, SSO secret) are stored **encrypted** in the `app_config` database table and managed through the **Admin Panel → Discourse Integration** section — never in environment variables.

**To enable SSO:**

1. In the Admin Panel, fill in *Discourse Base URL*, *API Key*, *API Username*, and *SSO Secret*.
2. In your Discourse admin settings (**Admin → Settings → Login**):
   - Enable **DiscourseConnect Provider** (`enable_discourse_connect_provider = true`).
   - Add the shared secret under `discourse_connect_provider_secrets`.
   - **Do NOT** set `discourse_connect_url` — that enables the opposite (Discourse-as-consumer) direction and will break this integration.
3. Set `DISCOURSE_SSO_ENABLED=true` in your server's environment variables and restart.
4. Use **Admin Panel → SSO Readiness** to verify all prerequisites are satisfied.

**URL reference:**

| URL | Purpose |
|---|---|
| `https://www.rulebritannia.org/api/discourse/sso` | Provider-init — sim calls this to start login. **No params.** Calling with `sso`/`sig` returns 400. |
| `https://www.rulebritannia.org/api/discourse/sso/callback` | Callback — Discourse redirects here after auth. Contains `sso`/`sig`. Never call this directly. |

When `DISCOURSE_SSO_ENABLED=true`, the login page automatically shows a **"Login with Discourse"** button alongside the email/password form.

## Manual Testing

### Civil Service — minister-only access and briefings

1. Log in as a character who holds a government office (e.g. Home Secretary with `office: "home"`).
2. Navigate to `civilservice.html`.
3. Confirm you see **only** the Home Office department tile — all other departments are hidden.
4. Click "Open Office" and open a case ticket in the Home Office.
5. Log out. Log in as a mod/admin. Verify all departments are visible.
6. As mod/admin, use the "Create Briefing" form on `civilservice.html`:
   - Set Target Office to `home` (Home Secretary).
   - Add `prime-minister` to the CC list.
   - Create the briefing with a title, stage text, and two options.
7. Log out. Log in as the Home Secretary character. Verify the briefing appears and you can choose an option. The decision is logged.
8. Log out. Log in as a PM character (office `prime-minister`). Verify the same briefing appears (because it was CC'd to PM).
9. Log out. Log in as a character with a different office (e.g. Chancellor). Verify the briefing does **not** appear — PM visibility is CC-based, not global.
10. As mod/admin, close the briefing and confirm the minister can no longer act on it.

### Shop purchases and modifiers

1. Log in as any character. Navigate to `personal.html`.
2. Confirm the **Active Modifiers** tile shows 0% press impact, 0% polling boost, Scrutiny Score: 0.
3. Purchase "Media Training Session" (£5,000). Confirm:
   - Bank balance decreases by £5,000.
   - Active Modifiers tile updates to +10% press impact.
   - The item appears in "Purchased Items".
4. Purchase "Luxury Car" (£45,000). Confirm scrutiny score increases (e.g. to 5).
5. Navigate to `press.html` and submit a press release. The modifier (+10% press impact) is stored in `effects.modifiers` and visible in the Personal page. (The modifier is a soft signal; integration in press impact calculations is available via `getPressImpactModifier()` in `personal.js`.)
6. As mod/admin, click "Remove" on a purchased item and verify the modifiers recompute.

### Constituency Work — scandal opt-in and progression

1. Log in as any character. Navigate to `constituency-work.html`.
2. Confirm the **Local Scandal Opt-In** section shows the opt-in checkbox (unchecked by default).
3. Check the box and click "Save Preference". Verify the preference persists on reload.
4. Log out. Log in as mod/admin. Navigate to `constituency-work.html`.
5. In "Moderator: Trigger Scandal", enter the character's name, select the "Planning Permission Controversy" template, and submit.
6. Log out. Log in as the player character. Navigate to `constituency-work.html`.
7. Confirm the scandal appears with a stage title and narrative text.
8. Click one of the response options. Verify:
   - The decision is logged in the audit trail (expandable "Decision log").
   - The reputation impact updates.
   - If the chosen option has `nextStageIdx: null`, the scandal closes.
9. As mod/admin, verify all characters' scandals are visible and you can close any scandal manually.
10. Attempt to trigger a scandal for a character who has NOT opted in — verify an alert prevents this.

### Finance Controls (Admin/Mod)

The Control Panel (`control-panel.html`) includes a **Finance Controls** section (visible to admin and mod roles) that allows management of the player financial system.

#### Finance Cost Inflation

- Located under "Finance Controls → Finance Cost Inflation".
- Applies the economy inflation rate to the **finance cost index** (`financeCostIndex`), which multiplies:
  - Home living cost bases
  - Rental property monthly cost bases
  - Affiliation membership monthly fees
- **Not applied to**: MP salaries, character starting bank balances, or rental income.
- Can only be applied **once per sim year** (enforced server-side). Check "Admin override" to re-apply within the same year.
- Inflation rate is sourced from the Economy page topline. Set it there first.

#### MP Salary Bands

- Located under "Finance Controls → MP Salary Bands".
- Allows editing the annual salary for each MP position key (Prime Minister, Speaker, Backbencher, etc.).
- Values are used when computing character annual salaries via `/api/me/finance`.
- Can be updated **once per sim year**. Check "Admin override" to update again within the same year.

#### Character Starting Balances

- Located under "Finance Controls → Character Starting Balances".
- Allows editing the starting bank balance for each financial background level (1–10).
- Values are applied when a new character is approved (if their current bank balance is 0).
- Can be updated **once per sim year**. Check "Admin override" to update again within the same year.

#### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/finance/config` | Returns current salary bands, starting balances, cost index, and last-updated metadata |
| PATCH | `/api/admin/finance/salary-bands` | Update MP salary bands (once per sim year) |
| PATCH | `/api/admin/finance/starting-balances` | Update character starting bank balance map (once per sim year) |
| POST | `/api/admin/finance/apply-inflation` | Apply economy inflation to finance cost index (once per sim year); supports `dryRun: true` for preview |

All endpoints require admin or mod role. Once-per-year enforcement uses `last_*_sim_year` fields in the `finance_config` DB table and can be bypassed with `adminOverride: true` in the request body.

1. Open any page (e.g. `dashboard.html`) **without** logging in.
2. Verify the topbar shows "Not logged in" and a "Login" link.
3. State is sourced from `/data/demo.json` (read-only). No network calls to `/api/state` are made and no writes occur in `localStorage`.
4. Reload the page — demo state is always fresh from `demo.json`; local edits do not persist.
5. Confirm that `GET /api/state` on the backend returns **401** when called without a session cookie (e.g. `curl https://www.rulebritannia.org/api/state`).

### Authenticated admin experience

1. Navigate to `login.html` and log in with valid admin credentials.
2. Verify the topbar now shows "Logged in as \<username\>" and a "Logout" button.
3. State is loaded from the backend via `GET /api/state` (not `demo.json`). Open DevTools → Network and confirm the `/api/state` request returns `200` with a `data` payload.
4. Open `admin-panel.html` and verify the logged-in user's email and roles are displayed.
5. Click **Save current state to server** — confirm the request to `POST /api/state` returns `200 { ok: true }`.
6. Click **Reload from server** — confirm the page reflects the server state.
7. Click **Logout** — session cookie is cleared, topbar reverts to "Not logged in", and `GET /api/state` returns `401` again.
8. Verify `GET /api/auth/me` returns `{ ok: true, user: {...} }` while logged in, and `401` after logout.

### API endpoint smoke tests

Use `curl` (or a REST client) against `https://www.rulebritannia.org` to verify every auth endpoint is reachable under the `/api/*` prefix:

```bash
# 1. Register a new applicant
curl -s -X POST https://www.rulebritannia.org/api/register \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Test User","username":"testuser","email":"test@example.com","password":"Str0ng#P@ssw0rd!","ageConfirmed":true}' | jq .

# 2. Verify email (replace TOKEN with the token from the verification email)
curl -s "https://www.rulebritannia.org/api/auth/verify-email?token=TOKEN" | jq .

# 3. Log in (returns csrfToken in the response body)
curl -s -c /tmp/rb-cookies.txt -X POST https://www.rulebritannia.org/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Str0ng#P@ssw0rd!"}' | jq .

# 4. Check session / current user (uses the session cookie)
curl -s -b /tmp/rb-cookies.txt https://www.rulebritannia.org/api/auth/me | jq .

# 5. Bootstrap config (public — no cookie needed)
curl -s https://www.rulebritannia.org/api/bootstrap | jq .

# 6. Logout (replace CSRF_TOKEN with the csrfToken from step 3 or from /api/csrf-token)
curl -s -b /tmp/rb-cookies.txt -X POST https://www.rulebritannia.org/api/auth/logout \
  -H "X-CSRF-Token: CSRF_TOKEN" | jq .
```

Expected responses:
- **POST /api/register** → `{ "ok": true }` (or a descriptive error)
- **GET /api/auth/verify-email?token=…** → `{ "ok": true }` (or 400 if expired/invalid)
- **POST /api/auth/login** → `{ "ok": true, "csrfToken": "…", "user": { … } }`
- **GET /api/auth/me** → `{ "ok": true, "csrfToken": "…", "user": { … } }` (401 when not logged in)
- **GET /api/bootstrap** → `{ "sso_enabled": false, "ui_base_url": "…", … }`
- **POST /api/auth/logout** → `{ "ok": true }` (401 or error if CSRF token is wrong)


Each HTML file has a `data-page` attribute on `<body>`. On load, `js/main.js`:

1. Calls `bootData()`, which hits `GET /api/bootstrap` for clock + config + (when logged in) user + state
2. When **not** logged in: loads read-only data from `data/demo.json`; writes are blocked
3. When **logged in**: state comes from the PostgreSQL backend; every `saveState()` call persists to `POST /api/state`
4. Reads `document.body.dataset.page`
5. Dispatches to the matching `init*Page(data)` function from the route table

## Simulation Clock

Real calendar days map to simulated months:

- Monday/Tuesday/Wednesday = 1 sim month
- Thursday/Friday/Saturday = 1 sim month
- Sunday = frozen (no advancement)

This yields **2 sim months per real week**, starting from a configurable base year (default: 1997).

## Adding a New Page

1. Create `newpage.html` with `<body data-page="newpage">`
2. Create `js/pages/newpage.js` exporting `initNewpagePage(data)`
3. Import and register in `js/main.js` route table

## Data Flow

```
Not logged in:
  demo.json → ensureDefaults() → page init(data)  [read-only; no writes]

Logged in:
  GET /api/bootstrap → ensureDefaults() → page init(data)
    → user action → mutate data → saveState() → POST /api/state
```

## Registration & Approval Flow

Rule Britannia uses a **gated registration** model. New users must both **verify their email** and be **approved by an admin** before they can log in.

### How it works

1. **Applicant** visits `/register.html` and submits the registration form (display name, username, email, password, 16+ attestation, optional marketing opt-in). No date of birth is collected. If Cloudflare Turnstile is enabled, the anti-bot challenge is verified server-side before the application is stored.
2. The server stores the application as a **pending registration** and sends a **verification email** containing a single-use token link (expires after 24 hours).
3. **Applicant** clicks the link in the email, which loads `/verify-email.html` and calls `GET /api/auth/verify-email?token=…`. This marks `email_verified = true` on the pending registration.
4. **Admin** visits the Admin Panel (`/admin-panel.html`) and reviews the _Pending Registrations_ section.
5. Admin clicks **Approve** — this creates a live `users` record from the pending registration data (including the `email_verified` status) and marks the application as approved. An audit log entry is created.
6. Admin clicks **Reject** — the application is marked rejected without creating a user account.
7. An approved user can log in **only if their email is also verified**. If verification is outstanding, login is blocked with a clear message.

### Email verification resend

Applicants may request a new verification email via `POST /api/auth/resend-verification` (rate-limited: 3 requests/hour per IP; 5-minute minimum between resends per email). The endpoint is non-disclosing — it always returns a generic success message.

### Marketing opt-in

The registration form includes an **opt-in** checkbox for marketing emails (unchecked by default). Consent and its timestamp are stored in `pending_registrations.marketing_opt_in` / `marketing_opt_in_at`. Transactional emails (e.g. verification) are sent regardless of this preference.

### Enabling / operating

No additional configuration is required for basic operation. The relevant tables are created automatically on server start via `ensureSchema()`. For email sending and Turnstile, set the corresponding environment variables (see [Environment variables](#environment-variables) above).

### Policy pages

The following static pages are included:

| Page | URL |
|---|---|
| Privacy Notice | `/privacy.html` |
| Terms of Use | `/terms.html` |
| Community Rules | `/community-rules.html` |
| Moderation & Reporting | `/report.html` |
| Email Verification | `/verify-email.html` |

### Entry pages

The four entry pages (`/index.html`, `/register.html`, `/login.html`, `/verify-email.html`) display a **minimal topbar** and a footer linking to the policy pages.

## Live Trial

See **[docs/trial-runbook.md](docs/trial-runbook.md)** for the 3-user live trial runbook, including:

- Pre-trial checklist
- How to approve users and assign roles
- How to reset the sim between rounds using the Admin Panel **Danger Zone** tools
- Discourse integration notes (SSO enabled; group syncing off-by-default)

## Staging Audit Run

Run the pre-Discourse staging verification (persistence, RBAC, immutability, division authority):

```bash
BASE_URL="https://rulebritannia-app-backend.onrender.com" \
TEST_EMAIL="admin@example.com" \
TEST_PASSWORD="..." \
TEST_LOW_EMAIL="backbencher@example.com" \
TEST_LOW_PASSWORD="..." \
node scripts/test-staging.mjs
```

Then run API test suites (these now hard-fail if required env vars are missing):

```bash
BASE_URL="https://rulebritannia-app-backend.onrender.com" \
COOKIE_PLAYER="rb.sid=..." \
COOKIE_MOD="rb.sid=..." \
COOKIE_ADMIN="rb.sid=..." \
node --test tests/api/*.spec.js
```
