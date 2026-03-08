# UI Polish Notes

## What changed
- Standardised theme tokens in `styles.css` for spacing, typography, radii, shadows, and focus ring.
- Added a small shared UI kit layer with reusable classes and aliases:
  - Buttons: `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-ghost` (kept compatibility with legacy `.btn.primary` / `.btn.danger`).
  - Cards: `.card`, `.card-header`, `.card-body` with shared visual treatment across existing tiles/panels.
  - Forms: `.input`, `.select`, `.textarea`, `.help-text`, plus unified focus/hover behaviour.
  - Tables: `.table`, `.table-striped`, `.table-responsive` with consistent cell padding, headers, and zebra striping.
  - Labels: `.badge`, `.pill`, `.chip`.
- Improved global typographic rhythm (line-height, heading sizing/weight) and standardized page-header subtitle styling.
- Refined nav/topbar hover + active states and added subtle light-theme gradient polish.
- Added mobile adjustments for <=480px (wrap spacing, panel padding, button tap sizing, modal fit).

## HTML adjustments
- Replaced inline footer styling on `login.html` and `register.html` with shared classes (`.site-footer`, `.site-footer-link`) to reduce one-off styling and improve consistency.

## Special handling
- Maintained compatibility with existing dynamic markup from page scripts by using class aliases and shared base selectors rather than changing app logic.
