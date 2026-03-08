/**
 * STATE OWNERSHIP CONTRACTS
 *
 * This module is the single source of truth for the runtime boundary between
 * snapshot-backed state and relational-authoritative gameplay systems.
 *
 * It is imported by server/index.js wherever state is read, written, or synced
 * so the boundary is enforced in code rather than only in comments.
 *
 * See also: docs/state-ownership.md for the human-readable policy.
 */

/**
 * Tables that may be populated from snapshot data (derived read-model caches).
 *
 * syncObjectTables() may ONLY write to tables in this set.
 * Adding a table here is a deliberate, intentional decision to make it
 * snapshot-derived.  Do NOT add relational-authoritative tables here.
 *
 * @type {Set<string>}
 */
export const SNAPSHOT_DERIVED_TABLES = new Set([
  "bills",
  "motions",
  "statements",
  "regulations",
  "questiontime_questions",
]);

/**
 * Tables that are RELATIONAL-AUTHORITATIVE — they have their own dedicated
 * API routes and lifecycle and must NEVER be written via snapshot flows.
 *
 * This set is used defensively: the allowlist (SNAPSHOT_DERIVED_TABLES) is
 * the primary guard, but this set documents the forbidden side for tests and
 * future readers.
 *
 * @type {Set<string>}
 */
export const RELATIONAL_AUTHORITATIVE_TABLES = new Set([
  "divisions",
  "division_votes",
  "bill_amendments",
  "bill_amendment_supporters",
  "party_factions",
  "faction_political_state",
  "character_finance",
  "character_additional_revenue",
  "finance_config",
  "finance_applied",
]);

/**
 * Top-level keys in a snapshot payload that correspond to relational-authoritative
 * systems.  These keys must be stripped from any snapshot write or read so they
 * cannot be treated as snapshot-authoritative by callers.
 *
 * @type {Set<string>}
 */
export const RELATIONAL_AUTHORITATIVE_SNAPSHOT_KEYS = new Set([
  "divisions",
  "amendments",
  "factions",
  "politicalState",
  "finance",
]);

/**
 * Staff roles that are permitted to write the global state snapshot via
 * POST /api/state.
 *
 * Why these three roles?
 *   admin   — full game administration; manages all snapshot-backed state
 *   mod     — game moderation; manages sim control (pause/unpause, dates,
 *             economy, polling, government offices, etc.)
 *   speaker — manages parliamentary procedure state (parliament bucket,
 *             question time, order of business) through the control panel;
 *             has a distinct, documented parliamentary management workflow
 *             that legitimately mutates snapshot-backed state
 *
 * All other roles (player roles, civil-service, etc.) must use dedicated
 * feature APIs rather than the global state snapshot.
 *
 * Changing this set is a deliberate access-control decision.  Do not widen
 * it without auditing whether the new role actually needs global-snapshot
 * write access rather than a scoped feature endpoint.
 *
 * @type {Set<string>}
 */
export const ALLOWED_STATE_WRITE_ROLES = new Set([
  "admin",
  "mod",
  "speaker",
]);

/**
 * Assert that `table` is in the snapshot-derived allowlist.
 * Throws synchronously if the table is not permitted.
 *
 * Called by syncObjectTables() before every upsert so that a future developer
 * cannot accidentally write a relational-authoritative table through snapshot
 * flows without explicitly adding it to SNAPSHOT_DERIVED_TABLES.
 *
 * @param {string} table - DB table name to validate
 * @throws {Error} if the table is not in SNAPSHOT_DERIVED_TABLES
 */
export function assertSnapshotDerivedTable(table) {
  if (!SNAPSHOT_DERIVED_TABLES.has(table)) {
    throw new Error(
      `[state-ownership] FORBIDDEN: table '${table}' is not in SNAPSHOT_DERIVED_TABLES. ` +
      `To add a new derived-cache table, explicitly add it to SNAPSHOT_DERIVED_TABLES in server/state-contracts.js.`
    );
  }
}

/**
 * Strip relational-authoritative keys from a snapshot payload and return the
 * cleaned copy along with the list of stripped keys.
 *
 * Called before every snapshot write (POST /api/state, POST /api/snapshots,
 * POST /api/admin/import-snapshot) and before every snapshot read response
 * (GET /api/state) as belt-and-suspenders protection for legacy snapshots.
 *
 * If no forbidden keys are present the original `data` reference is returned
 * unchanged (no unnecessary copy).
 *
 * @param {unknown} data - raw snapshot payload
 * @param {string} [context] - call-site label used in log messages
 * @returns {{ clean: unknown, stripped: string[] }}
 */
export function stripRelationalKeys(data, context = "snapshot") {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { clean: data, stripped: [] };
  }
  const stripped = [];
  for (const key of RELATIONAL_AUTHORITATIVE_SNAPSHOT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      stripped.push(key);
    }
  }
  if (stripped.length === 0) {
    return { clean: data, stripped: [] };
  }
  console.warn(
    `[state-ownership][${context}] Stripping relational-authoritative keys from snapshot: ${stripped.join(", ")}`
  );
  const clean = { ...data };
  for (const key of stripped) delete clean[key];
  return { clean, stripped };
}
