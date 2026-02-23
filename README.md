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
2. **Hostname inference** — if the page is served from `rulebritannia.org`, `*.rulebritannia.org`, or `rulebritannia-app.onrender.com`, the base is automatically set to `https://rulebritannia-app-backend.onrender.com`.
3. **Fallback** — all other origins (e.g. `localhost`) default to `""`, meaning API requests go to the same origin. This is the correct behaviour for local development when you also run the backend on the same host/port.

### Local development

If you are running the backend on a different port (e.g. `http://localhost:4000`), add a `<script>` tag in the relevant HTML file **before** `js/main.js`:

```html
<script>window.RB_API_BASE = "http://localhost:4000";</script>
<script type="module" src="js/main.js"></script>
```

Or set it once in your browser console before navigating to the page.

### Production (Render)

No extra configuration is needed. The hostname-inference rule in `js/api.js` automatically resolves the correct backend URL when the frontend is served from `rulebritannia.org` or `rulebritannia-app.onrender.com`.

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

The backend supports DiscourseConnect, where the Rule Britannia app acts as the **identity provider** for your Discourse forum. When enabled, users who visit your Discourse forum are redirected to `GET /api/discourse/sso`, authenticate there, and are returned to Discourse with a signed identity payload.

Discourse credentials (base URL, API key, API username, SSO secret) are stored **encrypted** in the `app_config` database table and managed through the **Admin Panel → Discourse Integration** section — never in environment variables.

**To enable SSO:**

1. In the Admin Panel, fill in *Discourse Base URL*, *API Key*, *API Username*, and *SSO Secret*.
2. In your Discourse admin settings, enable DiscourseConnect and set the SSO URL to `https://<your-backend>/api/discourse/sso`.
3. Set `DISCOURSE_SSO_ENABLED=true` in your server's environment variables and restart.
4. Use **Admin Panel → SSO Readiness** to verify all prerequisites are satisfied.

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



1. Open any page (e.g. `dashboard.html`) **without** logging in.
2. Verify the topbar shows "Not logged in" and a "Login" link.
3. State is sourced from `/data/demo.json` (read-only). No network calls to `/api/state` are made and no writes occur in `localStorage`.
4. Reload the page — demo state is always fresh from `demo.json`; local edits do not persist.
5. Confirm that `GET /api/state` on the backend returns **401** when called without a session cookie (e.g. `curl https://rulebritannia-app-backend.onrender.com/api/state`).

### Authenticated admin experience

1. Navigate to `login.html` and log in with valid admin credentials.
2. Verify the topbar now shows "Logged in as \<username\>" and a "Logout" button.
3. State is loaded from the backend via `GET /api/state` (not `demo.json`). Open DevTools → Network and confirm the `/api/state` request returns `200` with a `data` payload.
4. Open `admin-panel.html` and verify the logged-in user's email and roles are displayed.
5. Click **Save current state to server** — confirm the request to `POST /api/state` returns `200 { ok: true }`.
6. Click **Reload from server** — confirm the page reflects the server state.
7. Click **Logout** — session cookie is cleared, topbar reverts to "Not logged in", and `GET /api/state` returns `401` again.
8. Verify `GET /auth/me` returns `{ ok: true, user: {...} }` while logged in, and `401` after logout.


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

Rule Britannia uses a **gated registration** model — new users apply and must be approved by an admin before they can log in.

### How it works

1. **Applicant** visits `/register.html` and submits the registration form (display name, username, email, password, 16+ attestation). No date of birth is collected.
2. The server stores the application as a **pending registration** in the `pending_registrations` table (password is bcrypt-hashed immediately; the email/username uniqueness check is intentionally non-disclosing).
3. **Admin** visits the Admin Panel (`/admin-panel.html`) and reviews the _Pending Registrations_ section.
4. Admin clicks **Approve** — this creates a live `users` record from the pending registration data and marks the application as approved. An audit log entry is created.
5. Admin clicks **Reject** — the application is marked rejected without creating a user account. An audit log entry is created.
6. Approved users can now log in via `/login.html`. Pending or rejected applicants cannot log in (no account exists until approval).

### Enabling / operating

No additional configuration is required. The `pending_registrations` table is created automatically on server start via `ensureSchema()`. The registration endpoint (`POST /api/register`) is public and rate-limited to 5 requests per hour per IP. Admin endpoints require an authenticated session with the `admin` role and a valid CSRF token.

### Entry pages

The three entry pages (`/index.html`, `/register.html`, `/login.html`) display a **minimal topbar** containing only the logo, the live simulation clock, a Register link, and a Login link. The "Not logged in" auth-status element and the "Back to Your Office" affordance are suppressed on these pages.
