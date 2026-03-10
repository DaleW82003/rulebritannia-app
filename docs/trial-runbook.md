# Rule Britannia — Operational Trial Runbook

This document describes how to run live trials and ongoing simulation sessions: environment setup, staff roles, smoke test flows, monitoring, snapshot safety, and rollback procedures.

---

## Staff Roles

| Role | Admin Panel assignment | Responsibilities during trial |
|---|---|---|
| **Admin** | `admin` role | Full access; approves registrations; manages wipe/seed; triggers clock ticks; assigns roles; monitors admin dashboard; monitors support ticket queue |
| **Moderator** | `mod` role | Manages content moderation; can manage bills, motions, statements; edits civil service briefings and cases; approves press items; responds to support tickets |
| **Speaker** | `speaker` role | Controls legislative procedure from the chamber; manages divisions; can advance bills; no vote weight in divisions |
| **Staff / Civil Service** | Admin or Mod with relevant dept. access | Creates civil service briefings and cases; responds to ministerial choices |

> **Identity authority:** All role checks use immutable character IDs, not display names. Staff must not rename characters to gain elevated access.

---

## Environment Setup

- [ ] Server running and accessible at `https://rulebritannia-app-backend.onrender.com` (or your staging URL)
- [ ] `NODE_ENV=production` set on the server
- [ ] `SESSION_SECRET` set (long random string)
- [ ] `DATABASE_URL` pointing to the correct Neon/PostgreSQL instance
- [ ] At least one admin account created and verified
- [ ] Sim clock set to August 1997 (Admin Panel → App Config)
- [ ] Baseline data seeded if needed (Admin Panel → Danger Zone → **Wipe + Seed**)

For alpha/staging environments only:
- [ ] `ENABLE_DEV_SEED=true` set if wipe/seed endpoints are needed
- [ ] `NODE_ENV` **not** set to `production` (or `ENABLE_DEV_SEED=true` explicitly)

> **Production warning:** Never set `ENABLE_DEV_SEED=true` on a real production instance.

---

## Pre-Session Checklist

- [ ] At least one admin account active
- [ ] Trial user accounts registered and approved via Admin Panel → Pending Registrations
- [ ] Appropriate roles assigned to each user (party roles + office roles)
- [ ] Sim clock checked (Admin Panel → App Config → current sim month/year)
- [ ] Faction baseline seeded if needed (Admin Panel → Danger Zone → Seed 1997 Factions)
- [ ] Budget baseline seeded if needed (Admin Panel → Danger Zone → Seed Budget)
- [ ] Discourse SSO readiness checked if forum will be used (Admin Panel → SSO Readiness)
- [ ] Discourse group syncing confirmed **off** unless explicitly tested (do not press "Sync Groups Now" until ready)
- [ ] Admin dashboard checked for stale open divisions (Admin Panel → Dashboard → Open Divisions)
- [ ] Support ticket queue checked — open any unread player tickets before the session begins (`/support.html` → staff view)

---

## Overview

The trial runs with real users who log in through the normal registration and admin-approval flow. There are no automated load testing tools involved.

Users interact with the parliamentary simulation in real time — submitting bills, motions, statements, press items, polling entries, and question-time questions. The admin can observe and moderate from the Admin Panel at `/admin-panel.html`.

---

## Running the Trial

1. Direct each trial user to the registration page (`/register.html`).
2. They complete registration; admin receives a pending registration in the Admin Panel.
3. Admin approves the registration in **Admin Panel → Pending Registrations**.
4. Users log in at `/login.html` and can begin using the simulation.
5. Admin assigns appropriate roles (e.g., `party:labour`, `office:prime_minister`) via **Admin Panel → User Permissions → Edit Roles**.

---

## Smoke Test Flows

Run these manually before or during a trial to verify key paths are working.

### Amendment flow

1. Log in as a character with an MP role.
2. Navigate to an open bill in Second Reading stage (`/bills.html`).
3. Submit an amendment via the bill page.
4. Log in as admin/mod. Navigate to the bill. The amendment should appear in the amendments list.
5. As the bill author (or admin/mod), decide on the amendment (accept/reject).
6. Verify the amendment status updates and the bill page reflects the decision.

**Expected:** Amendment created, visible to other users, decidable by author/admin. Decision is immutable after recording.

### Division flow

1. As admin/mod or Speaker, open a division on a bill (Final Division) or standalone motion.
2. As an MP character, navigate to the division and cast a vote (Aye/No/Abstain).
3. Verify the vote is recorded server-side (check Admin Panel → relevant bill/division).
4. As admin/mod, close the division (or wait for the sim deadline).
5. Verify the `immutable_result` is set and the division shows the correct tally.

**Expected:** Votes are recorded with server-computed `effective_weight` (not client-supplied). Result is immutable after close.

### Faction admin edit

1. Log in as admin/mod.
2. Navigate to Control Panel → Factions (or Admin Panel → Faction Management).
3. Edit a faction's MP count or influence bonus.
4. Verify `faction_political_state` is updated for that faction (check Admin Panel or via API: `GET /api/parties/:slug/factions`).

**Expected:** Faction state recomputes on save. Party climate score updates accordingly.

### Political-state update

1. Log in as a character.
2. Navigate to a division and cast a vote against the party whip instruction.
3. Check the character's political state (Admin Panel → Character → Political State or `GET /api/characters/:id`).
4. Verify `party_pressure` has increased.

**Expected:** Political state reflects the rebellion. `party_pressure` channel shows the rebellion as a contributor.

### Finance update

1. Log in as admin.
2. Navigate to Admin Panel → Finance → set a salary override for a character.
3. Check `GET /api/me/finance` for that character's session.
4. Verify the bank balance and salary reflect the update.

**Expected:** Finance changes persist in `character_finance`. Owner sees updated values on next load.

### Speaker actions

1. Log in as a Speaker-role character.
2. Navigate to an open division.
3. Verify the Speaker has no vote weight in the division (their effective_weight shows 0).
4. As Speaker, advance a bill to a new stage (e.g., Second Reading → Report Stage).

**Expected:** Speaker can manage legislative procedure but cannot cast a weighted vote. The division tally excludes the Speaker.

---

## Resetting the Sim Between Trial Rounds

The Admin Panel includes a **Danger Zone** section (red-bordered, clearly labelled) for performing a safe content wipe between trial rounds.

> **Important:** These actions wipe gameplay content only. **User accounts and pending registrations are never deleted.**

### What is wiped

| Table | Content |
|-------|---------|
| `bills` | All bills |
| `motions` | All motions |
| `statements` | All ministerial statements |
| `regulations` | All regulations |
| `questiontime_questions` | All question time questions |
| `press_items` | All press releases and conferences |
| `polling_entries` | All polling data |

### What is reset

- Sim clock → **August 1997**
- Sim state → **paused**
- App state pointer → **fresh empty snapshot**

### What is NOT touched

- User accounts (`users` table)
- Pending registrations (`pending_registrations` table)
- Character political state or finance records
- Audit log
- Discourse credentials
- App configuration
- **Support tickets and messages** (`support_tickets`, `support_messages`) — these persist across wipes

### How to perform a wipe

1. Navigate to **Admin Panel** (`/admin-panel.html`).
2. Scroll to the **Danger Zone — Trial Reset** section at the bottom of the page.
3. Choose one of the two options:
   - **Wipe Content** — clears all gameplay data, sim starts blank at August 1997.
   - **Wipe + Seed** — clears all gameplay data, then seeds the August 1997 demo baseline (bills, motions, press items, polling, etc.).
4. Type `WIPE CONTENT` exactly into the confirmation box.
5. Click the red button to proceed.
6. A success message will confirm what was wiped and that the sim has been reset.

---

## Monitoring Guidance

### Admin Dashboard

The Admin Panel dashboard (`/admin-panel.html` → Dashboard) shows:
- Count of open divisions (with close deadlines)
- Pending registrations
- Recent audit log entries

Check this before each session to ensure no stale divisions are blocking gameplay.

### Server logs (Render)

Access server logs via the Render dashboard → Service → Logs. Look for:
- `[political-state]` error lines — indicate a recompute failure (non-fatal but worth noting)
- `[discourse]` error lines — indicate a Discourse API failure
- `500` responses — indicate unhandled server errors

### Discourse sync

Discourse group sync is manual. If role assignments have changed and Discourse groups should be updated:
1. Admin Panel → Discourse Integration → Preview Discourse Group Sync
2. Review the preview, then apply if correct.

Do not sync Discourse groups unless you have confirmed the group mappings are correct.

---

## Support Ticket Handling

All staff (admin and mod) access the same support queue at `/support.html`. The page auto-detects the staff role and renders the staff view.

### Staff workflow

| Step | Action |
|---|---|
| **Open queue** | Navigate to `/support.html`. Tickets with unread messages are highlighted with an unread dot. |
| **Review** | Click (or press Enter/Space) on a ticket to open the thread panel. |
| **Reply** | Type a response and press **Send**. The ticket's `last_message_at` is updated; the player sees it as unread on their next page refresh or poll. |
| **Label** | Use the inline label buttons to tag tickets (`bug`, `rules`, `appeal`, `billing`, `urgent`, `wontfix`, `duplicate`). Labels are staff-only. |
| **Close** | When the issue is resolved, click **Close Ticket**. Closed tickets cannot receive new messages from either side. |
| **Reopen** | If a player or staff member needs to continue a closed ticket, click **Reopen**. |
| **Filter** | Use the status and label dropdowns at the top of the list to filter the queue. |

### Status transitions

| From | To | Who |
|---|---|---|
| `open` | `finished` | Player (marks their issue done) |
| `finished` | `open` | Player (reopens) or staff |
| `finished` | `closed` | Staff |
| `closed` | `open` | Staff |
| `open` | `closed` | Staff (direct close) |

### Notes for alpha

- Staff are notified of new replies only by the 25-second polling toast. Check the queue regularly during active sessions.
- There is no email notification when a new message arrives. Players will see a toast only if they have `/support.html` open.
- Support ticket data is **not** cleared by the content wipe (`Wipe Content` / `Wipe + Seed`). Tickets persist across trial rounds unless manually deleted from the database.

---

## Snapshot Restore / Rebuild Safety

### When to use snapshot restore

Snapshot restore (`POST /api/snapshots/:id/restore`) updates the `app_state_current` pointer and rebuilds the five derived-cache tables (`bills`, `motions`, `statements`, `regulations`, `questiontime_questions`).

**Snapshot restore does NOT:**
- Restore or overwrite relational-authoritative tables (divisions, factions, political state, finance)
- Touch user accounts, characters, or session data

Use snapshot restore only to recover a known-good snapshot of parliamentary content (bills on the order paper, motions, etc.).

### Creating a named snapshot

Before a significant trial session, create a named snapshot:
1. Admin Panel → Snapshots → Create Named Snapshot
2. Give it a descriptive name (e.g., "pre-trial-round-2-2026-03-08")
3. The snapshot captures the current state blob (not relational data)

### Rebuild cache

If the derived-cache tables become out of sync with the snapshot (e.g., after a database incident), use:
- Admin Panel → Maintenance → Rebuild Cache (`POST /api/admin/rebuild-cache`)

This rebuilds the five derived-cache tables from the current snapshot. It does not affect relational-authoritative tables.


### Exporting a snapshot (operator backup)

Use `GET /api/admin/export-snapshot` only from authenticated admin sessions. Operational hardening now applies:
- Rate limit: per actor/session, default `12` exports per minute (`SNAPSHOT_EXPORT_RATE_LIMIT_MAX`).
- Audit visibility: each attempt logs structured `snapshot-export-audit` details and writes `audit_log` events (`admin.export-snapshot.success|failed|rate-limited`).
- Export payload includes lightweight metadata (`meta.exportType`, `meta.estimatedDataSizeBytes`) and still preserves the existing core schema (`exportedAt`, `snapshotId`, `label`, `createdAt`, `createdBy`, `data`).

If a staff member sees HTTP `429`, wait for the next minute window and retry; this is expected abuse resistance, not a workflow failure.

---

## Rollback Procedures

### Rollback parliamentary content to a snapshot

1. Admin Panel → Snapshots → select the target snapshot.
2. Click **Restore** and confirm.
3. The derived-cache tables (`bills`, `motions`, `statements`, `regulations`, `questiontime_questions`) are rebuilt from the snapshot.
4. Relational data (divisions, factions, political state, finance) is untouched — manual cleanup may be needed for those systems.

### Rollback the full database (Neon)

For catastrophic failures, use the Neon Console to restore the database to a point-in-time backup:
1. Log in to Neon Console → select the project.
2. Go to Branches → choose a restore point.
3. This is a full database restore — all tables are affected including user accounts.

> ⚠️ Full database restore will lose all changes since the restore point, including new user registrations. Only use as a last resort.

### Clear and re-seed

If the database is in an inconsistent state that cannot be fixed by snapshot restore:
1. Ensure `ENABLE_DEV_SEED=true` is set on the server (staging only).
2. Admin Panel → Danger Zone → **Wipe Content** or **Wipe + Seed**.
3. Re-assign roles to all user accounts.
4. Re-seed faction data if needed (Admin Panel → Danger Zone → Seed 1997 Factions).

---

## Discourse Integration During the Trial

- **DiscourseConnect SSO** is functional and can be used for seamless forum login if `DISCOURSE_SSO_ENABLED=true` is set.  The **SIM is the identity source** — users log in to the SIM with their email/password and are automatically authenticated into Discourse via DiscourseConnect.
- **Discourse group syncing** is **off by default**. The "Sync Discourse Groups Now" button in Admin Panel → Preview Discourse Group Sync should **not** be used during the trial unless Discourse group mappings and the Discourse forum UI/UX have been confirmed as ready.
- An advisory note is shown next to the sync button in the Admin Panel as a reminder.
- **Email/password login always works** regardless of whether SSO is configured.

---

## Setting up DiscourseConnect SSO (hosted Discourse / Communiteq)

The **SIM is the DiscourseConnect provider** (identity source); Discourse is the consumer. Users log in to the SIM and are automatically signed in to Discourse when they visit the forum.

### Prerequisites

1. **Set environment variable** `DISCOURSE_SSO_ENABLED=true` on the server (Render: Environment tab → Add variable).
2. **Set a strong `SESSION_SECRET`** environment variable (required for secure session cookies).
3. **Configure in Admin Panel → App Config:**
   - `UI Base URL` — the public HTTPS URL of this app's **backend** (e.g. `https://rulebritannia-app-backend.onrender.com`). No trailing slash. This determines the `discourse_connect_url` Discourse must call.
4. **Configure in Admin Panel → Discourse Integration:**
   - `Discourse Base URL` — your Discourse forum URL (e.g. `https://forum.rulebritannia.org`). No trailing slash.
   - `API Key` — a Discourse API key with global scope (Discourse Admin → API → New API Key).
   - `API Username` — the Discourse system user for API calls (usually `system`).
   - `DiscourseConnect SSO Secret` — a long random string shared between the app and Discourse. Generate one with `openssl rand -hex 32`.

### Configuring Discourse (Communiteq)

In your Discourse admin panel (`/admin/site_settings/category/login`):

1. **Enable `enable_discourse_connect`** — this makes Discourse a DiscourseConnect **consumer**, redirecting unauthenticated users to the SIM for login.  **Do NOT enable `enable_discourse_connect_provider`** (that is the outbound-SSO direction and is not used here).
2. Set **`discourse_connect_url`** to: `https://<your-backend>/api/discourse/sso`
   (The exact URL is shown in Admin Panel → SSO Readiness once `UI Base URL` is configured.)
3. Set **`discourse_connect_secret`** (under Settings → Login → discourse connect secret) to the same value you pasted as the SSO Secret in the app Admin Panel.

> **Note:** The "Discourse Forum" link in the SIM navigation bar now points to `/api/discourse/go`.  If the user is logged in to the SIM, they are redirected to `{forum}/session/sso?return_path=/latest`, which triggers the DiscourseConnect handshake immediately so the user lands on the forum already signed in.  If not yet logged in, they are taken to the SIM login page first.

### Verifying the setup

1. Navigate to **Admin Panel → SSO Readiness** (requires admin login).
2. All checks should show ✅. The panel also displays the exact URL to paste into Discourse (`discourse_connect_url`).
3. Test by opening an incognito window, logging in to the SIM, then clicking **Discourse Forum** in the top navigation.

### What the SSO flow looks like

```
Logged-in SIM user clicks "Discourse Forum"
  → browser GET /api/discourse/go
  → server sees user is authenticated, redirects to {forum}/session/sso?return_path=/latest
  → Discourse processes the DiscourseConnect handshake (redirects to /api/discourse/sso)
  → server verifies signature, builds signed user-info payload, redirects back to return_sso_url
  → Discourse logs the user in and returns them to /latest

Unauthenticated user clicks "Discourse Forum"
  → browser GET /api/discourse/go
  → server redirects to /login.html?next=/api/discourse/go
  → user logs in to the SIM
  → browser returns to /api/discourse/go, which redirects to {forum}/session/sso?return_path=/latest
  → same DiscourseConnect handshake as above completes seamlessly
```

---

## Troubleshooting

| Issue | Resolution |
|-------|-----------|
| User cannot log in after approval | Check that `email_verified = true` in the database for their account. |
| Wipe button is greyed out or shows an error | Ensure you are logged in as an `admin` role user. |
| Seed data is missing after Wipe + Seed | Check the server logs for errors from the `/api/admin/seed-demo` endpoint. |
| Sim clock is stuck | Use Admin Panel → App Config to adjust the clock rate, or contact the hosting admin to check the Render service logs. |
| Discourse SSO fails / user sent to login page | Verify that `DISCOURSE_SSO_ENABLED=true` is set in the Render environment and that the SSO secret in Admin Panel → Discourse Integration matches `discourse_connect_secret` in Discourse. |
| "That page doesn't exist or is private" on Discourse | `enable_discourse_connect` is not enabled in Discourse, or `discourse_connect_url` is not set. Enable it under Discourse Admin → Settings → Login and point it to `<backend>/api/discourse/sso`. |
| "Authentication failed due to missing secret" on Discourse | The SSO secret in Discourse does not match the one saved in Admin Panel → Discourse Integration. Re-copy the secret to both places. |
| SSO login redirects back to login page with an error | Read the error message. Common causes: SSO secret not set, UI base URL not configured, or the `return_sso_url` doesn't match the configured Discourse domain. |
| Login page shows "SSO session expired" | The user's browser session cookie was cleared between starting and completing the SSO flow. Return to the Discourse forum and try logging in again. |
| `UI base URL not configured` error | Set `ui_base_url` in Admin Panel → App Config to the app's public backend HTTPS URL. |
| Player cannot see support tickets they created | Confirm the player is logged in as the same user account that created the tickets. Players can only see their own tickets. |
| Staff cannot see any tickets in the queue | Confirm the staff account has the `admin` or `mod` role assigned in Admin Panel → User Permissions. |
| Support ticket reply button is disabled | The ticket is closed. Staff can reopen it via **Reopen**; players cannot post to closed tickets. |
