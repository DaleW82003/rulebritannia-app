// js/errors.js
// Unified API error handler — log to console + show a user-facing toast.
import { toastError } from "./components/toast.js";

/**
 * Log an error and show a danger toast notification.
 *
 * Use this in every catch block that handles an API or async failure so the
 * user always sees feedback instead of a silent failure or blank page.
 *
 * @param {unknown} err   - The caught error value.
 * @param {string}  label - Short description of the operation that failed
 *                          (e.g. "Save config", "Load snapshots").
 */
export function handleApiError(err, label = "Action failed") {
  const msg = err?.message || String(err) || "Unknown error";
  console.error(`[${label}]`, err);
  toastError(`${label}: ${msg}`);
}

/**
 * Render an inline error tile HTML string.
 * Use when a section of the page fails to load — insert into the container
 * so the user sees a visible error instead of a blank or silent section.
 *
 * @param {unknown} err   - The caught error value.
 * @param {string}  label - Short description of the operation that failed.
 * @returns {string} HTML string for an `.error-tile` element.
 */
export function errorTileHTML(err, label = "Failed to load") {
  const msg = (err?.message || String(err) || "Unknown error")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `
    <div class="error-tile" role="alert">
      <span class="error-tile-icon">⚠</span>
      <div class="error-tile-body">
        <div class="error-tile-title">${label}</div>
        <div class="error-tile-msg">${msg}</div>
      </div>
    </div>
  `;
}
