# Rule Britannia — Backend Server

## Entrypoint

```
server/index.js
```

The backend is a single-file Express application (`server/index.js`) that:

- Serves all `/api/*` REST endpoints
- Manages PostgreSQL schema via `ensureSchema()` (runs automatically on start)
- Handles session authentication, CSRF protection, and rate limiting

## Quick Start (local development)

```bash
cd server
npm install
cp .env.example .env   # fill in DATABASE_URL and SESSION_SECRET
node index.js
```

The server listens on `http://localhost:3000` by default (override with `PORT`).

## Required Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres connection string (e.g. Neon: `postgres://user:pw@host/db?sslmode=require`) |
| `SESSION_SECRET` | ✅ | Long random string to sign session cookies. In production the server will refuse to start without it. |
| `PORT` | — | Port to listen on (default: `3000`) |
| `NODE_ENV` | — | Set to `production` on Render/hosting to enable production guards |
| `ENABLE_DEV_SEED` | — | Set to `true` to enable destructive seed/wipe/reset endpoints in non-production environments like staging. **Never set in real production.** |
| `DISCOURSE_SSO_ENABLED` | — | `true` to activate DiscourseConnect SSO endpoints |
| `DISCOURSE_ENCRYPTION_KEY` | — | 64-char hex AES-256 key for encrypting stored Discourse credentials |
| `RESEND_API_KEY` | — | Resend key for email verification messages |
| `EMAIL_FROM` | — | Sender address for outgoing emails (default: `Rule Britannia <support@rulebritannia.org>`) |
| `APP_BASE_URL` | — | Base URL for email links (default: `https://www.rulebritannia.org`) |
| `TURNSTILE_ENABLED` | — | `true` to enable Cloudflare Turnstile anti-bot on registration |
| `TURNSTILE_SITE_KEY` | — | Turnstile site key (public) |
| `TURNSTILE_SECRET_KEY` | — | Turnstile secret key — **never commit** |

See `server/.env.example` for a commented template.

## Production-Disabled Endpoints

The following endpoints are **disabled in production** (`NODE_ENV=production`) unless `ENABLE_DEV_SEED=true` is explicitly set. They return `404 Not Found` in production. This is enforced by the `isDevSeedAllowed()` helper in `server/index.js`.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/admin/clear-cache` | Truncates all parliamentary content tables |
| `POST` | `/api/admin/import-snapshot` | Overwrites entire game state from uploaded JSON |
| `POST` | `/api/admin/repair/character-owner-pointers` | Reconciles character owner pointers by patching data |
| `POST` | `/api/admin/elections/seed-scenario` | Seeds the current default scenario general election baseline (currently 1997) |
| `POST` | `/api/admin/elections/seed-1997` | Legacy alias for the current default scenario election seed |
| `POST` | `/api/admin/budget/seed` | Seeds 1996–97 budget baseline |
| `POST` | `/api/admin/reset-baseline` | Wipes all election/constituency data and re-seeds baseline |
| `POST` | `/api/admin/wipe-content` | Deletes all gameplay content |
| `POST` | `/api/admin/wipe-with-characters` | Deletes all content AND all characters |
| `POST` | `/api/admin/seed-demo` | Resets and populates the database with demo data |
| `POST` | `/api/admin/seed` | Alias for `/api/admin/seed-demo` |
| `POST` | `/api/admin/constituencies/initialize-scenario` | Overwrites all default-scenario constituencies (currently the 659-seat 1997 baseline) |
| `POST` | `/api/admin/constituencies/initialize-1997` | Legacy alias for the current default scenario constituency initializer |
| `DELETE` | `/api/admin/constituencies/clear` | Deletes all constituencies |

### Environment flag

Set `ENABLE_DEV_SEED=true` **only** on non-production environments (local dev, staging) that need to run seeding or wipe operations.  Never set this on a real production instance.

## Admin-Only Endpoints (safe in production)

The following sensitive endpoints are available in production but require the `admin` role:

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/admin/export-snapshot` | Downloads current game state as a JSON attachment |
| `POST` | `/api/admin/rotate-sessions` | Regenerates the caller's session ID and CSRF token |
| `POST` | `/api/admin/force-logout-all` | Terminates all sessions except the caller's |

## Whip System Endpoints

The following endpoints implement the party whip system used by the frontend (`js/api.js`).

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/parties/:partyId/chief-whip` | Party leader or admin/mod | Set chief whip (+ optional deputy) for a party |
| `GET` | `/api/divisions/:divisionId/party-instruction/:partySlug` | Authenticated | Get the whip instruction for a party on a division |
| `POST` | `/api/divisions/:divisionId/party-instruction` | Party leader/chief whip or admin/mod | Set/update party instruction for a division |
| `GET` | `/api/divisions/:divisionId/rebel-request` | Authenticated | Get the caller's rebel request for a division |
| `POST` | `/api/divisions/:divisionId/rebel-request` | Authenticated MP | Submit a rebel request for a division |
| `POST` | `/api/divisions/:divisionId/rebel-request/:requestId/decide` | Party leader/chief whip or admin/mod | Grant or refuse a rebel request |

### Request/Response shapes

**POST /api/parties/:partyId/chief-whip**
```json
// Request body
{ "chiefWhipId": "<uuid>", "deputyWhipId": "<uuid|null>" }

// 200 response
{ "ok": true, "party": { ... } }
```

**GET /api/divisions/:divisionId/party-instruction/:partySlug**
```json
// 200 response
{ "instruction": { "id": "...", "division_id": "...", "party_slug": "...",
  "position": "aye|no|abstain|free", "whip_level": 0,
  "note": "...", "set_by_name": "...", "set_at_sim": "1997-08", ... } }
// (instruction is null when none has been set)
```

**POST /api/divisions/:divisionId/party-instruction**
```json
// Request body
{ "partySlug": "labour", "position": "aye|no|abstain|free", "whipLevel": 3, "note": "optional" }

// 200 response
{ "ok": true, "instruction": { ... } }
```

**GET /api/divisions/:divisionId/rebel-request**
```json
// 200 response — caller's most recent request (null if none)
{ "request": { "id": "...", "status": "pending|granted|refused|cancelled", ... } }
```

**POST /api/divisions/:divisionId/rebel-request**
```json
// Request body
{ "requestedVote": "aye|no|abstain", "message": "optional reason" }

// 201 response
{ "ok": true, "request": { ... } }
```

**POST /api/divisions/:divisionId/rebel-request/:requestId/decide**
```json
// Request body
{ "status": "granted|refused" }

// 200 response
{ "ok": true, "request": { ... } }
```

## Database Schema (whip system tables)

Tables are created automatically by `ensureSchema()` in `server/index.js`.

| Table | Purpose |
|---|---|
| `parties.chief_whip_character_id` | UUID FK → characters; the party's chief whip |
| `parties.deputy_whip_character_id` | UUID FK → characters; the party's deputy whip |
| `division_party_instructions` | One row per division+party: position, whip level, note, who set it |
| `division_rebel_requests` | Rebel requests by individual MPs; status lifecycle: pending → granted/refused/cancelled |
| `division_rebellion_log` | Immutable audit record of every vote that deviated from party instruction |

Key constraints:
- `UNIQUE (division_id, party_slug)` on `division_party_instructions` — one instruction per division per party
- `CHECK (status IN ('pending','granted','refused','cancelled'))` on `division_rebel_requests`
- `CHECK (position IN ('aye','no','abstain','free'))` on `division_party_instructions`

## Verification

A route-wiring verification script is available at `server/verify-whip-routes.js`.  
Run it without a live server to check route shapes and JSON contracts statically:

```bash
cd server
node verify-whip-routes.js
```
