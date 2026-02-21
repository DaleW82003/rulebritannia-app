/**
 * Roles service: canonical role constants, Discourse group mapping,
 * and a pure helper to compute Discourse groups from a set of roles.
 *
 * Role naming conventions:
 *   System/moderation  — plain string: "admin" | "mod" | "speaker"
 *   Party membership   — "party:<slug>"
 *   Government office  — "office:<slug>"
 *
 * Government offices are subdivided into four areas for QT / government /
 * opposition / civil service display purposes (see ROLES_BY_AREA below).
 */

// ── System / moderation roles ────────────────────────────────────────────────

export const SYSTEM_ROLES = Object.freeze(["admin", "mod", "speaker"]);

// ── Party membership ─────────────────────────────────────────────────────────

export const PARTY_ROLES = Object.freeze([
  "party:labour",
  "party:conservative",
  "party:liberal_democrat",
]);

// ── Government offices ───────────────────────────────────────────────────────

/** Roles that appear in the Government area */
export const GOVERNMENT_OFFICE_ROLES = Object.freeze([
  "office:prime_minister",
  "office:secretary_of_state",
  "office:backbencher",
]);

/** Roles that appear in the Opposition area */
export const OPPOSITION_OFFICE_ROLES = Object.freeze([
  "office:leader_of_opposition",
  "office:shadow_secretary_of_state",
  "office:leader_of_third_party",
  "office:backbencher",
]);

/** Roles relevant to Question Time */
export const QUESTION_TIME_ROLES = Object.freeze([
  "office:prime_minister",
  "office:leader_of_opposition",
  "office:leader_of_third_party",
  "office:secretary_of_state",
  "office:shadow_secretary_of_state",
]);

/** Civil service roles */
export const CIVIL_SERVICE_ROLES = Object.freeze([
  "office:permanent_secretary",
  "office:civil_servant",
]);

/** All office roles (superset) */
export const ALL_OFFICE_ROLES = Object.freeze([
  "office:prime_minister",
  "office:leader_of_opposition",
  "office:secretary_of_state",
  "office:shadow_secretary_of_state",
  "office:leader_of_third_party",
  "office:backbencher",
  "office:permanent_secretary",
  "office:civil_servant",
]);

/**
 * Roles organised by their functional area.
 * Useful for UI grouping and for determining which QT / government /
 * opposition / civil service sections a player participates in.
 */
export const ROLES_BY_AREA = Object.freeze({
  question_time:  QUESTION_TIME_ROLES,
  government:     GOVERNMENT_OFFICE_ROLES,
  opposition:     OPPOSITION_OFFICE_ROLES,
  civil_service:  CIVIL_SERVICE_ROLES,
});

/** Complete set of all valid role strings */
export const ALL_VALID_ROLES = Object.freeze([
  ...SYSTEM_ROLES,
  ...PARTY_ROLES,
  ...ALL_OFFICE_ROLES,
]);

// ── Discourse group mapping ──────────────────────────────────────────────────

/**
 * Maps each canonical role to its Discourse group name.
 *
 * SSO sync is NOT enabled yet — this mapping layer is defined here so that
 * the "Preview Discourse Group Sync" admin tool can show what would happen
 * before the feature is turned on.
 */
export const DISCOURSE_GROUP_MAP = Object.freeze({
  "admin":                          "admins",
  "mod":                            "moderators",
  "speaker":                        "Speaker",
  "party:labour":                   "Labour",
  "party:conservative":             "Conservative",
  "party:liberal_democrat":         "Liberal_Democrats",
  "office:prime_minister":          "Prime_Minister",
  "office:leader_of_opposition":    "Leader_of_Opposition",
  "office:secretary_of_state":      "Cabinet",
  "office:shadow_secretary_of_state": "Shadow_Cabinet",
  "office:leader_of_third_party":   "Liberal_Democrat_Leadership",
  "office:backbencher":             "Backbenchers",
  "office:permanent_secretary":     "Civil_Service",
  "office:civil_servant":           "Civil_Service",
});

/**
 * Compute the set of Discourse groups a user should belong to based on
 * their current roles.  Returns a sorted, deduplicated array of group names.
 *
 * @param {string[]} roles - array of canonical role strings
 * @returns {string[]}
 */
export function computeDiscourseGroups(roles) {
  const groups = new Set();
  for (const role of roles) {
    const group = DISCOURSE_GROUP_MAP[role];
    if (group) groups.add(group);
  }
  return [...groups].sort();
}

// ── Permission map ───────────────────────────────────────────────────────────

/**
 * Maps named UI/API actions to the set of roles that are permitted to
 * perform them.  The backend uses this as the authoritative source of truth;
 * the frontend fetches it at boot to drive UI visibility.
 *
 * Format: { [actionName]: string[] }
 *   - An empty array means "any authenticated user".
 *   - "admin", "mod", "speaker" are the three system roles.
 */
export const PERMISSION_MAP = Object.freeze({
  // ── Content management ─────────────────────────────────────────────────
  "post_news":              ["admin", "mod"],
  "manage_agenda":          ["admin", "mod"],
  "manage_bodies":          ["admin", "mod", "speaker"],
  "manage_budget":          ["admin", "mod"],
  "manage_cabinet":         ["admin", "mod"],
  "manage_civil_service":   ["admin", "mod"],
  "manage_constituencies":  ["admin", "mod", "speaker"],
  "manage_economy":         ["admin", "mod"],
  "manage_elections":       ["admin", "mod"],
  "manage_events":          ["admin", "mod"],
  "manage_fundraising":     ["admin", "mod"],
  "manage_government":      ["admin", "mod"],
  "manage_locals":          ["admin", "mod", "speaker"],
  "manage_online":          ["admin", "mod"],
  "manage_opposition":      ["admin", "mod"],
  "manage_party":           ["admin", "mod"],
  "manage_personal":        ["admin", "mod"],
  "manage_polling":         ["admin", "mod"],
  "manage_press":           ["admin", "mod"],
  "manage_redlion":         ["admin", "mod"],
  "manage_statements":      ["admin", "mod"],
  "manage_user_profiles":   ["admin", "mod", "speaker"],

  // ── Parliament / procedural ────────────────────────────────────────────
  "moderate_debate":        ["admin", "mod", "speaker"],
  "close_question":         ["admin", "mod", "speaker"],
  "grant_assent":           ["admin", "mod"],
  "speaker_casting_vote":   ["admin", "mod", "speaker"],
  "speaker_pass_amendment": ["admin", "mod", "speaker"],
  "speaker_fail_amendment": ["admin", "mod", "speaker"],

  // ── Admin-only ─────────────────────────────────────────────────────────
  "admin_panel":            ["admin"],
  "admin_maintenance":      ["admin"],
  "control_panel":          ["admin"],
  "manage_snapshots":       ["admin"],
  "manage_config":          ["admin"],
  "manage_roles":           ["admin"],
  "force_logout_all":       ["admin"],
  "rotate_sessions":        ["admin"],
});
