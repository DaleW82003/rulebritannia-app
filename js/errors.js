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
