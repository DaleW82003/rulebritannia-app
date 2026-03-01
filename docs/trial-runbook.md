# Rule Britannia — 3-User Live Trial Runbook

This document describes how to run the 3-user live trial and how to reset the simulation between rounds using the Admin Panel Danger Zone tools.

---

## Overview

The trial runs with **3 real users** who log in through the normal registration and admin-approval flow. There are no automated load testing tools involved.

Users interact with the parliamentary simulation in real time — submitting bills, motions, statements, press items, polling entries, and question-time questions. The admin can observe and moderate from the Admin Panel at `/admin-panel.html`.

---

## Pre-trial checklist

- [ ] At least one user account has the `admin` role assigned (via Admin Panel → User Permissions).
- [ ] The sim clock is set to the desired start date (default: August 1997). Check in Admin Panel → App Config.
- [ ] Demo baseline data has been seeded if required (Admin Panel → Danger Zone → **Wipe + Seed**).
- [ ] DiscourseConnect SSO is working if the Discourse forum will be used during the trial (check Admin Panel → SSO Readiness).
- [ ] **Discourse group syncing is NOT enabled by default** — do not press "Sync Discourse Groups Now" until the UI/UX and group role mappings have been confirmed as ready.

---

## Running the trial

1. Direct each trial user to the registration page (`/register.html`).
2. They complete registration; admin receives a pending registration in the Admin Panel.
3. Admin approves the registration in **Admin Panel → Pending Registrations**.
4. Users log in at `/login.html` and can begin using the simulation.
5. Admin assigns appropriate roles (e.g., `party:labour`, `office:prime_minister`) via **Admin Panel → User Permissions → Edit Roles**.

---

## Resetting the sim between trial rounds

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
- Audit log
- Discourse credentials
- App configuration

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

## Discourse integration during the trial

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

> **Note:** The "Discourse Forum" link in the SIM navigation bar now points to `/api/discourse/go`.  If the user is logged in to the SIM, they are redirected to the forum and DiscourseConnect signs them in automatically.  If not yet logged in, they are taken to the SIM login page first.

### Verifying the setup

1. Navigate to **Admin Panel → SSO Readiness** (requires admin login).
2. All checks should show ✅. The panel also displays the exact URL to paste into Discourse (`discourse_connect_url`).
3. Test by opening an incognito window, logging in to the SIM, then clicking **Discourse Forum** in the top navigation.

### What the SSO flow looks like

```
Logged-in SIM user clicks "Discourse Forum"
  → browser GET /api/discourse/go
  → server sees user is authenticated, redirects to forum
  → forum redirects to /api/discourse/sso?sso=…&sig=… (DiscourseConnect handshake)
  → server verifies signature, builds signed user-info payload, redirects back to return_sso_url
  → Discourse logs the user in and returns them to the forum

Unauthenticated user clicks "Discourse Forum"
  → browser GET /api/discourse/go
  → server redirects to /login.html?next=/api/discourse/go
  → user logs in to the SIM
  → browser returns to /api/discourse/go, which redirects to the forum
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
