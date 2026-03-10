# Rule Britannia — Alpha Launch Checklist

**Date:** March 2026  
**Status:** Ready for invited alpha with watch items noted below

This document is the definitive pre-launch gate for opening alpha testing with real users. Work through every section top-to-bottom before inviting the first alpha participant.

---

## 1. Environment Setup

### Infrastructure requirements

| Requirement | Detail |
|---|---|
| **Node.js** | ≥ 18 (specified in `server/package.json` `engines`) |
| **PostgreSQL** | Neon (recommended) or any Postgres ≥ 14 |
| **Backend host** | Render web service (or equivalent Node.js host with persistent process) |
| **Frontend host** | Cloudflare Pages (static site) |
| **DNS / Proxy** | Cloudflare Workers (`worker/index.js`) for bare-domain routing; Cloudflare Pages Function (`functions/api/[[path]].js`) for `www` routing |
| **Email** | SendGrid account with a verified sender address |
| **Anti-bot** | Cloudflare Turnstile (recommended for registration) |
| **Forum** | Discourse (Communiteq or self-hosted) — optional but recommended for alpha comms |

### Pre-launch environment checklist

- [ ] Server is running and reachable at the production backend URL
- [ ] `NODE_ENV=production` is set on the server (Render: Environment tab)
- [ ] `SESSION_SECRET` is set to a long random string (≥ 32 chars); **not** the default placeholder
- [ ] `DATABASE_URL` points to the correct Neon/Postgres instance
- [ ] `SENDGRID_API_KEY` is set; email delivery is working (test with a registration flow)
- [ ] `TURNSTILE_ENABLED=true`, `TURNSTILE_SITE_KEY`, and `TURNSTILE_SECRET_KEY` are set (if using Turnstile)
- [ ] `ENABLE_DEV_SEED` is **NOT set** (or explicitly `false`) — production must never have this enabled
- [ ] Static site is deployed on Cloudflare Pages and routes correctly to the backend
- [ ] Cloudflare Worker and Pages Function are deployed and routing `/api/*` correctly

---

## 2. Required Environment Variables

Set all of the following in the Render (or equivalent) **Environment** tab before starting the server.

| Variable | Required | Default if unset | Notes |
|---|---|---|---|
| `DATABASE_URL` | **Required** | — | Postgres connection string (`sslmode=require` for Neon) |
| `SESSION_SECRET` | **Required** | — | Long random string; server exits with `FATAL` if this is the placeholder value and `NODE_ENV=production` |
| `NODE_ENV` | **Required** | — | Must be `production` for production guards to activate |
| `SENDGRID_API_KEY` | Required for email | — | Email verification and admin notifications |
| `SENDGRID_FROM` | Optional | `support@rulebritannia.org` | Sender address for outgoing mail |
| `APP_BASE_URL` | Optional | `https://www.rulebritannia.org` | Base URL in email verification links (no trailing slash) |
| `DISCOURSE_SSO_ENABLED` | Optional | disabled | Set to `"true"` to activate DiscourseConnect SSO endpoints |
| `DISCOURSE_ENCRYPTION_KEY` | Optional | derived from `SESSION_SECRET` | 64-char hex AES-256 key for encrypting Discourse credentials stored in `app_config` |
| `TURNSTILE_ENABLED` | Optional | disabled | Set to `"true"` to activate Turnstile anti-bot on registration |
| `TURNSTILE_SITE_KEY` | Optional | — | Public Turnstile key (safe to expose to frontend) |
| `TURNSTILE_SECRET_KEY` | Optional | — | Secret Turnstile key — never commit |
| `PORT` | Optional | `3000` | Server listen port |
| `ENABLE_DEV_SEED` | **Never in production** | — | Enables wipe/seed/repair endpoints — only set on staging instances |

> **Discourse credentials** (API key, API username, base URL, SSO secret) are stored **encrypted in the `app_config` database table** via the Admin Panel UI. Do not set them as environment variables.

---

## 3. Dev vs Alpha Deployment Expectations

| Concern | Dev | Alpha / Production |
|---|---|---|
| `NODE_ENV` | `test` or unset | `production` |
| `ENABLE_DEV_SEED` | `true` (optional) | **Never set** |
| Seed/wipe endpoints | Available | Return `404` (production-disabled) |
| `SESSION_SECRET` | Any value | Long random string — server exits on placeholder |
| Cookie security | `sameSite=lax`, `secure=false`, no domain | `sameSite=none`, `secure=true`, `domain=.rulebritannia.org` |
| Database | Local Postgres or dev Neon branch | Production Neon branch |
| Turnstile | Disabled | Enabled (recommended) |
| Email | Optional / SendGrid test mode | Live SendGrid — verify sender before launch |
| Discourse SSO | Not required | Enable when forum is ready |
| `isDevSeedAllowed()` | Returns `true` | Returns `false` (unless `ENABLE_DEV_SEED=true`, which must not occur) |

**Key rule:** If `NODE_ENV` is unset, `isDevSeedAllowed()` returns `true` — the server is permissive by default. Always set `NODE_ENV=production` on the alpha host.

---

## 4. Database Expectations

### Schema bootstrap

The server calls `ensureSchema()` on startup. It creates all tables if they do not exist and runs any pending idempotent migrations. **No manual schema migration is required** for a fresh database.

### Startup migrations (automatic, idempotent)

| Migration | What it does |
|---|---|
| Legacy `app_state` → `state_snapshots` | Migrates any single-row legacy state into the snapshot system |
| Email verification backfill | Sets `email_verified = true` for accounts created before email verification was introduced |
| Users table UUID PK migration | Recreates `users` with UUID primary key if still on the legacy TEXT PK |
| `characters` UUID PK migration | Same as above for `characters` |
| Faction slug backfill | Sets `slug = name` for any faction with a NULL slug |
| Salary position backfill (`backfillSalaryPositions`) | Seeds backbencher salary position for any character without one |
| Predefined guides seed (`seedPredefinedGuides`) | Inserts the 15 canonical onboarding guide entries into `guides_items` if absent; updates `sort_order` to enforce stable ordering on re-run |

### Tables at launch

| Category | Tables |
|---|---|
| Parliamentary content (snapshot-derived) | `bills`, `motions`, `statements`, `regulations`, `questiontime_questions` |
| Relational-authoritative | `divisions`, `division_votes`, `party_factions`, `party_faction_allocations`, `faction_political_state`, `character_political_state`, `character_finance`, `office_assignments`, `parties`, `support_tickets`, `support_messages`, `other_officials_faction_allocations`, `party_donations`, `guides_items` |
| User management | `users`, `pending_registrations`, `characters` |
| Simulation state | `state_snapshots`, `app_state_current`, `game_state` |
| Configuration | `app_config` (includes `bodies_data`, `locals_data`, `starter_pack_html` stored as JSON values), `finance_config` |
| Audit | `audit_log` |
| Sessions | `session` (managed by `connect-pg-simple`) |

### Database expectations checklist

- [ ] Production Neon project is on a paid plan or has sufficient capacity for alpha user load
- [ ] Neon point-in-time restore is available (required for full database rollback in emergencies)
- [ ] Schema bootstrapped: server started once and logs show `[schema] ensureSchema complete` (or equivalent) with no errors
- [ ] At least one named snapshot exists before the first trial session (create via Admin Panel → Snapshots)
- [ ] Simulation freeze control verified (Admin/Mod can view and toggle; set reason; disable before session start unless incident active)

---

## 5. Staff / Admin / Mod / Speaker Account Setup

All role assignments are made via **Admin Panel → User Permissions → Edit Roles**.

### Required accounts at launch

| Role | Count | How to set up |
|---|---|---|
| `admin` | ≥ 1 | Register normally; admin approves in Pending Registrations; assign `admin` role; attach a character |
| `mod` | ≥ 1 recommended | Same flow; assign `mod` role |
| `speaker` | ≥ 1 if running formal divisions | Same flow; assign `speaker` role |

### Account setup checklist

- [ ] At least one `admin` account is active and verified (`email_verified = true`)
- [ ] Admin can log in and reach `/admin-panel.html`
- [ ] At least one `mod` account is set up (can be the same person as admin for early alpha)
- [ ] If formal divisions will be run: at least one `speaker` account is ready
- [ ] Each staff character has an appropriate party role (e.g. `party:labour`) if they are playing as a character — or no party role if acting purely as staff
- [ ] All staff accounts have been confirmed end-to-end: login → Admin Panel access → role assignment flow tested

> **Identity authority note:** All role checks use immutable character UUIDs. Staff must not rename characters in an attempt to alter their access level — it has no effect on server-side authority.

---

## 6. 1997 Faction Seed Verification

The `seed1997Factions()` function seeds the initial faction political state for Labour, Conservative, and Liberal Democrat parties as they stood in August 1997.

### How to seed

1. Navigate to **Admin Panel → Danger Zone → Seed 1997 Factions**
2. Confirm the action
3. The server calls `seed1997Factions()` which inserts baseline rows into `party_factions`, `party_faction_allocations`, and `faction_political_state`

> **Note:** `POST /api/admin/seed-1997-factions` is protected by `requireAdminOrMod` and has **no** `isDevSeedAllowed()` guard — it is accessible in production. Run this once on a fresh production database before inviting users. The operation is idempotent: re-running it will skip factions that already exist.

### Faction seed checklist

- [ ] `GET /api/parties/:slug/factions` returns faction data for `labour`, `conservative`, and `liberal-democrat`
- [ ] `faction_political_state` table has rows for all three party factions
- [ ] Faction internal power, momentum, leadership pressure, and cohesion values are within expected ranges
- [ ] Faction management is confirmed locked to playable-party set (no extraneous parties visible in faction admin)

---

## 7. Legacy Identity Report and Backfill Status

The identity hardening passes replaced mutable name-string authority checks with immutable character UUID checks. Some existing database records may still have `NULL` `author_character_id` fields if they were created before the column existed.

### How to check

Run the legacy identity report via the admin endpoint:

```
GET /api/admin/legacy-identity-report
```

This returns counts of records still using legacy name-based identity:

```json
{
  "ok": true,
  "bills": { "total": N, "missing_author_id": N },
  "press_items": { "total": N, "missing_author_id_non_npc": N },
  "group_drafts": {
    "cabinet": { "total_drafts": N, "legacy_author_id": N },
    "shadowcabinet": { "total_drafts": N, "legacy_author_id": N }
  }
}
```

### How to backfill

If any counts are non-zero, run the repair endpoint (requires `admin` or `mod` role — no `isDevSeedAllowed()` guard; accessible in production):

```
POST /api/admin/repair/backfill-author-ids
```

This idempotently backfills `author_character_id` in `bills`, `press_items`, and `group_drafts` by resolving character names to UUIDs.

### Legacy identity checklist

- [ ] `GET /api/admin/legacy-identity-report` returns `missing_author_id: 0` for bills, press_items, and group_drafts (or legacy records are understood and accepted)
- [ ] If non-zero: `POST /api/admin/repair/backfill-author-ids` has been run
- [ ] If backfill leaves ambiguous records (multiple characters with the same name): these have been manually resolved or accepted as non-blocking for alpha scope
- [ ] For a fresh alpha database with no legacy content, all counts will be 0 with no action required

> **For a clean alpha database** (no pre-existing bills or press items): this section is automatically satisfied — no backfill is needed.

---

## 8. Snapshot Restore and Rebuild — Operational Rules

### What snapshots cover

Snapshots capture the **parliamentary content** stored in the JSONB `state_snapshots` table. Restoring a snapshot rebuilds the five derived-cache tables:

| Rebuilt on restore | NOT touched on restore |
|---|---|
| `bills` | `divisions`, `division_votes` |
| `motions` | `faction_political_state` |
| `statements` | `character_political_state` |
| `regulations` | `character_finance` |
| `questiontime_questions` | `users`, `characters`, `parties` |

### Operational rules

1. **Create a named snapshot before every trial session.** Use Admin Panel → Snapshots → Create Named Snapshot. Name it descriptively (e.g. `pre-session-1-2026-03-10`).
2. **Never use snapshot restore to fix relational data.** Restoring a snapshot does not touch divisions, faction state, or finance. If those tables are corrupted, use the Neon point-in-time restore (full DB restore) or manual admin API calls.
3. **Rebuild Cache** (`POST /api/admin/rebuild-cache`) re-derives the five derived-cache tables from the current snapshot pointer. Use this only after a database incident, not as a routine operation.
4. **Snapshot import** (`POST /api/admin/import-snapshot`) is production-disabled (`isDevSeedAllowed()` guard). Do not plan to use it in production.
5. **Snapshot export** (`GET /api/admin/export-snapshot`) is admin-only and production-accessible. Use it to back up the current state blob before major changes.
6. **Snapshot export hardening (alpha):** export requests are rate-limited per actor (default `12/minute` via `SNAPSHOT_EXPORT_RATE_LIMIT_MAX`) and emit structured `snapshot-export-audit` logs plus `audit_log` rows (`admin.export-snapshot.success|failed|rate-limited`).

### Snapshot checklist

- [ ] At least one named snapshot created before the first session (captures fresh 1997 baseline content)
- [ ] Snapshot restore has been tested end-to-end in staging: restore → verify derived-cache tables updated → verify relational data untouched
- [ ] Team knows the rollback procedure: Admin Panel → Snapshots → select → Restore → confirm
- [ ] Neon point-in-time restore access is confirmed for emergency full-DB rollback

---

## 9. Test Suite Commands

Run these before every significant deployment or before inviting new alpha users.

### Static checks (no database required)

```bash
# 8 static analysis checks: credential scan, auth patterns, RBAC coverage,
# CSRF enforcement, session security, immutability, JSON shape, endpoint naming
node scripts/static-checks.js

# RBAC drift detection: compares live endpoint surface against rbac-matrix.json
node scripts/audit/feature-manifest.js
```

### Unit tests (no database required)

```bash
# All unit test files (clock, discourse SSO, roles, state-contracts,
# service-modules, identity-hardening, recompute-helpers, rbac-helpers)
cd server && node --test *.test.js
```

Or run individual suites for faster feedback:

```bash
cd server
node --test clock.test.js
node --test discourse.test.js
node --test roles.test.js
node --test state-contracts.test.js
node --test service-modules.test.js            # political-state-service + division-helpers
node --test identity-hardening.test.js         # immutable identity authority (21 tests)
node --test recompute-helpers.test.js          # fireRecompute / awaitedRecompute helpers
node --test rbac-helpers.test.js               # RBAC guard helpers
node --test parliamentary-political-state.integration.test.js  # pure (no DB) political-state tests
```

### Integration tests (requires a test PostgreSQL database)

> **Important:** Each integration test file calls `pool.end()` in its `after()` hook. Run files separately to avoid cross-contamination.

```bash
cd server

# Parliamentary system integration tests
NODE_ENV=test node --test parliamentary.integration.test.js

# Faction system integration tests
NODE_ENV=test node --test factions.integration.test.js

# Finance + parliament integration tests
NODE_ENV=test node --test finance-parliament.integration.test.js

# Party treasury integration tests
NODE_ENV=test node --test party-treasury.integration.test.js

# Guides seed idempotency and ordering tests
NODE_ENV=test node --test guides-seed.test.js

# Bodies / locals 1997 seed integration tests
NODE_ENV=test node --test seed-1997.integration.test.js

# Support ticketing integration tests
NODE_ENV=test node --test support.integration.test.js
```

### Expected outcomes before launch

- [ ] `node scripts/static-checks.js` — all 8 checks pass, no errors
- [ ] `node scripts/audit/feature-manifest.js` — `rbacDriftWarnings` is 0 (or all drift is explained and documented)
- [ ] `node --test *.test.js` — all unit tests pass (no failures)
- [ ] Integration tests — all pass against a clean test database

---

## 10. Manual Smoke-Test Flows

Run these in a staging or pre-production environment before inviting the first alpha user. Use a browser in a normal window (not incognito) to maintain session state across steps.

### Flow 1 — User registration and approval

1. Navigate to `/register.html` in an incognito window.
2. Complete registration (email, password, character name, party selection).
3. If Turnstile is enabled, complete the challenge.
4. Verify the email confirmation email is received (check SendGrid activity).
5. Click the verification link.
6. In the admin account: Admin Panel → Pending Registrations → approve the new user.
7. Log in as the new user. Confirm access to the main simulation pages.

**Expected:** User can register, verify email, be approved, and log in. Admin approval flow is smooth.

### Flow 2 — Amendment flow

1. Log in as an MP character.
2. Navigate to an open bill in Second Reading stage (`/bills.html`).
3. Submit an amendment.
4. Log in as admin/mod. Navigate to the bill. The amendment appears in the list.
5. As the bill author (or admin/mod), decide on the amendment (accept or reject).
6. Verify the amendment status updates and the bill page reflects the decision.

**Expected:** Amendment is created, visible to others, decidable by the bill author or staff. Decision is immutable after recording.

### Flow 3 — Division flow

1. As admin/mod or Speaker, open a division on a bill (Final Division) or standalone motion.
2. As an MP character, navigate to the division and cast a vote (Aye / No / Abstain).
3. Verify the vote is recorded server-side (Admin Panel → relevant bill / division).
4. As admin/mod, close the division.
5. Verify `immutable_result` is set and the tally is correct.

**Expected:** Votes recorded with server-computed `effective_weight` (not client-supplied). Result is immutable after close.

### Flow 4 — Faction admin edit and recompute

1. Log in as admin/mod.
2. Navigate to Admin Panel → Faction Management (or Control Panel → Factions).
3. Edit a faction's MP count or influence bonus and save.
4. Verify `faction_political_state` is updated (`GET /api/parties/:slug/factions`).

**Expected:** Faction state recomputes on save. Party climate score updates accordingly.

### Flow 5 — Political state update (rebellion)

1. Log in as an MP character.
2. Navigate to an open division that has a party whip instruction.
3. Cast a vote against the whip instruction.
4. Check the character's political state (Admin Panel → Character or `GET /api/characters/:id`).
5. Verify `party_pressure` has increased.

**Expected:** Rebellion is recorded. `party_pressure` channel shows the rebellion as a contributor.

### Flow 6 — Finance update

1. Log in as admin.
2. Admin Panel → Finance → set a salary override for a character.
3. Check `GET /api/me/finance` for that character's session.
4. Verify the bank balance and salary reflect the update.

**Expected:** Finance changes persist in `character_finance`. Owner sees updated values on next load.

### Flow 7 — Speaker actions

1. Log in as a Speaker-role character.
2. Navigate to an open division.
3. Verify the Speaker has no vote weight (`effective_weight` = 0).
4. As Speaker, advance a bill to a new stage (e.g., Second Reading → Report Stage).

**Expected:** Speaker can manage legislative procedure but cannot cast a weighted vote. Tally excludes the Speaker.

### Flow 8 — Discourse SSO (if Discourse is active)

1. Ensure `DISCOURSE_SSO_ENABLED=true` and Discourse credentials are configured in Admin Panel → Discourse Integration.
2. Open Admin Panel → SSO Readiness and confirm all checks show ✅.
3. In an incognito window, log in to the SIM.
4. Click "Discourse Forum" in the navigation bar.
5. Confirm you are signed in to Discourse without a second login prompt.

**Expected:** SSO handshake completes; user lands on the forum already authenticated.

### Flow 9 — Wipe and re-seed (staging only)

1. Ensure `ENABLE_DEV_SEED=true` (staging only — never production).
2. Admin Panel → Danger Zone → type `WIPE CONTENT` → confirm.
3. Verify all gameplay content is cleared; sim clock resets to August 1997.
4. Run Wipe + Seed to restore the demo baseline.
5. Verify bills, motions, and press items are present.

**Expected:** Wipe and seed complete cleanly. Sim clock is at August 1997. User accounts are preserved.

### Flow 10 — Support ticket (player and staff)

1. Log in as a player character.
2. Navigate to `/support.html`.
3. Click **+ New Ticket**. Enter a subject, select a category, enter a message body, and submit.
4. Verify the ticket appears in the list with status `open` and the thread is readable.
5. Log in as an admin or mod account (separate browser window or incognito).
6. Navigate to `/support.html`. Confirm the staff view shows the new ticket in the queue.
7. Open the ticket. Post a reply as staff.
8. Switch back to the player session (or refresh). Verify the staff reply is visible and the ticket shows as unread.
9. As the player, post a reply and click **Mark Finished**.
10. As staff, verify the ticket now shows status `finished`. Close the ticket.
11. Verify neither the player nor staff can post further messages to the closed ticket.

**Expected:** Full ticket lifecycle works. Player sees own tickets only; staff sees all. Status transitions enforce the allowed-transition matrix. Closed tickets block new messages.

---

## 11. Final Operational and Deployment Risks

These are not code blockers but should be handled before inviting alpha users.

| Risk | Severity | Recommended action |
|---|---|---|
| `ENABLE_DEV_SEED` not set but `NODE_ENV` also not set — `isDevSeedAllowed()` returns `true` by default | **High** | Always set `NODE_ENV=production` on the production host. Never leave it unset. |
| `GET /api/admin/export-snapshot` exposes full game state JSON to admins | Medium | Mitigated: per-actor export rate limit (default 12/min), structured export audit logs, and `audit_log` entries for success/failure/rate-limit events. Consider IP allowlisting for production if your threat model requires it. |
| `POST /api/government/reset` and `/api/opposition/reset` are admin/mod-only but destructive to government formation state | Medium | Brief all moderators on when and why these endpoints should be used. |
| Non-blocking recompute (`fireRecompute`) may cause short-lived stale reads immediately after a political-state mutation | Low | Acceptable for alpha. Log `[recompute]` error lines; investigate any `FAILED` entries promptly. |
| Snapshot+relational dual-state model — rebuild/sync can drift if a database incident occurs mid-session | Medium | Create named snapshots before each session. Know the Neon point-in-time restore procedure. |
| Amendment author name-fallback still present for legacy bills with `NULL author_character_id` | Low | Run `POST /api/admin/repair/backfill-author-ids` before launch. For a fresh DB, this is a non-issue. |
| Large monolithic `server/index.js` (~21K lines) increases regression risk under fast feature expansion | Low | Post-alpha: continue the modular extraction work documented in `docs/extraction-summary.md`. |
| Discourse group sync is a manual action — if run prematurely it may create unexpected group memberships | Low | Keep "Sync Groups Now" **off** until Discourse group mappings are confirmed. Brief all admins. |
| SendGrid sender domain not verified — emails land in spam or are rejected | Medium | Verify the sender domain in SendGrid Dashboard before launch. Send a test verification email. |
| `POST /api/press` is restricted to `admin, mod, speaker` — matrix says `[authenticated]` | Low (documented) | RBAC matrix drift is documented and intentional (stricter than matrix). No action required. |

---

## Summary

### What must be done before inviting alpha users

1. ✅ **Set all required environment variables** — `DATABASE_URL`, `SESSION_SECRET`, `NODE_ENV=production`
2. ✅ **Set `ENABLE_DEV_SEED` to nothing** — confirm it is absent from the production environment
3. ✅ **Verify email delivery** — register a test account and confirm the verification email arrives and the link works
4. ✅ **Create at least one admin account** and confirm Admin Panel access
5. ✅ **Seed 1997 factions** and verify faction state (or confirm the database already has faction data)
6. ✅ **Run the legacy identity report** — confirm zero or acceptable legacy records; run backfill if needed
7. ✅ **Create a named snapshot** before the first session
8. ✅ **Run all unit and static checks** and confirm they pass
9. ✅ **Run manual smoke tests** (Flows 1–10 above) in staging
10. ✅ **Brief all staff** on the trial-runbook, Danger Zone cautions, Discourse sync policy, and the support ticket workflow

### What can wait until after alpha starts

- Full modular extraction of `server/index.js` remaining code (`writeAuditLog`, clock runners, route handlers)
- Economy / budget / polling system expansion
- Automated end-to-end integration tests for faction recompute chaining
- RBAC matrix alignment for `POST /api/offices/:id/assign` (documented drift, not a bypass)
- Email notifications on support ticket replies
- Real-time push (WebSocket/SSE) for support ticket updates
- Pagination UI in the staff support ticket list

---

*See also: [`docs/trial-runbook.md`](trial-runbook.md) for session-by-session operational procedures, [`docs/architecture.md`](architecture.md) for system design, and [`docs/dev-guide.md`](dev-guide.md) for developer workflow.*
