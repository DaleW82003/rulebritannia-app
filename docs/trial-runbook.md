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

- **DiscourseConnect SSO** is functional and can be used for forum login if `DISCOURSE_SSO_ENABLED=true` is set.
- **Discourse group syncing** is **off by default**. The "Sync Discourse Groups Now" button in Admin Panel → Preview Discourse Group Sync should **not** be used during the trial unless Discourse group mappings and the Discourse forum UI/UX have been confirmed as ready.
- An advisory note is shown next to the sync button in the Admin Panel as a reminder.

---

## Troubleshooting

| Issue | Resolution |
|-------|-----------|
| User cannot log in after approval | Check that `email_verified = true` in the database for their account. |
| Wipe button is greyed out or shows an error | Ensure you are logged in as an `admin` role user. |
| Seed data is missing after Wipe + Seed | Check the server logs for errors from the `/api/admin/seed-demo` endpoint. |
| Sim clock is stuck | Use Admin Panel → App Config to adjust the clock rate, or contact the hosting admin to check the Render service logs. |
| Discourse SSO login fails | Verify that `DISCOURSE_SSO_ENABLED=true` is set in the Render environment and that the SSO secret is correct in Admin Panel → Discourse Integration. |
