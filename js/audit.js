// js/audit.js
// Thin wrapper around the audit-log API.
// Call logAction() from any page to record an admin/mod action.
import { apiLogAction } from "./api.js";

/**
 * Record an admin or moderator action in the persistent audit log.
 *
 * @param {object} opts
 * @param {string} opts.action  - Short action name, e.g. "question-closed"
 * @param {string} [opts.target]  - What was affected, e.g. a bill title or polling id
 * @param {object} [opts.details] - Any extra structured context (will be stored as JSONB)
 */
export function logAction({ action, target = "", details = {} }) {
  // Fire-and-forget; errors are swallowed inside apiLogAction so they never
  // block the UI.  actor_id is resolved server-side from the session.
  apiLogAction({ action, target, details });
}
