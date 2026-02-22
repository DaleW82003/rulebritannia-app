// js/api.js
function resolveApiBase() {
  if (typeof window !== "undefined" && window.RB_API_BASE) return window.RB_API_BASE;
  if (typeof window !== "undefined") {
    const h = window.location.hostname;
    if (
      h === "rulebritannia.org" ||
      h.endsWith(".rulebritannia.org") ||
      h === "rulebritannia-app.onrender.com"
    ) {
      return "https://rulebritannia-app-backend.onrender.com";
    }
  }
  return "";
}
const API_BASE = resolveApiBase();

let _csrfToken = null;
export function setCsrfToken(token) { _csrfToken = token; }
function csrfHeaders() { return _csrfToken ? { "X-CSRF-Token": _csrfToken } : {}; }

/**
 * Fetch the backend permission map.
 *
 * @param {string[]} [roles] - optional array of role strings to filter to
 *   only actions the caller is permitted to perform.
 * @returns {Promise<{ permissions: Record<string, string[]> }>}
 */
export async function apiGetPermissions(roles) {
  const qs = roles?.length ? `?roles=${encodeURIComponent(roles.join(","))}` : "";
  const res = await fetch(`${API_BASE}/api/permissions${qs}`);
  if (!res.ok) throw new Error(`apiGetPermissions failed (${res.status})`);
  return res.json();
}

export async function apiLogin(email, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`apiLogin failed (${res.status})`);
  return res.json();
}

export async function apiMe() {
  const res = await fetch(`${API_BASE}/auth/me`, {
    credentials: "include",
  });
  if (res.status === 401 || res.status === 404) return { user: null };
  if (!res.ok) throw new Error(`apiMe failed (${res.status})`);
  return res.json();
}

export async function apiBootstrap() {
  const res = await fetch(`${API_BASE}/api/bootstrap`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`apiBootstrap failed (${res.status})`);
  return res.json();
}

export async function apiLogout() {
  // Fetch the CSRF token required for state-changing POST requests.
  const tokenRes = await fetch(`${API_BASE}/csrf-token`, { credentials: "include" });
  if (!tokenRes.ok) throw new Error(`apiLogout failed: could not fetch CSRF token (${tokenRes.status})`);
  const { csrfToken } = await tokenRes.json();
  const res = await fetch(`${API_BASE}/auth/logout`, {
    method: "POST",
    credentials: "include",
    headers: { "X-CSRF-Token": csrfToken },
  });
  if (!res.ok) throw new Error(`apiLogout failed (${res.status})`);
  return res.json();
}

export async function apiGetState() {
  const res = await fetch(`${API_BASE}/api/state`, {
    credentials: "include",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetState failed (${res.status})`);
  return res.json();
}

export async function apiSaveState(data) {
  const res = await fetch(`${API_BASE}/api/state`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ data }),
  });
  if (!res.ok) throw new Error(`apiSaveState failed (${res.status})`);
  return res.json();
}

export async function apiGetSnapshots() {
  const res = await fetch(`${API_BASE}/api/snapshots`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`apiGetSnapshots failed (${res.status})`);
  return res.json();
}

export async function apiSaveSnapshot(label, data) {
  const res = await fetch(`${API_BASE}/api/snapshots`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ label, data }),
  });
  if (!res.ok) throw new Error(`apiSaveSnapshot failed (${res.status})`);
  return res.json();
}

export async function apiRestoreSnapshot(id) {
  const res = await fetch(`${API_BASE}/api/snapshots/${encodeURIComponent(id)}/restore`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiRestoreSnapshot failed (${res.status})`);
  return res.json();
}

export async function apiGetConfig() {
  const res = await fetch(`${API_BASE}/api/config`);
  if (!res.ok) throw new Error(`apiGetConfig failed (${res.status})`);
  return res.json();
}

export async function apiSaveConfig(config) {
  const res = await fetch(`${API_BASE}/api/config`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(`apiSaveConfig failed (${res.status})`);
  return res.json();
}

export async function apiLogAction({ action, target = "", details = {} }) {
  try {
    const res = await fetch(`${API_BASE}/api/audit-log`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({ action, target, details }),
    });
    if (!res.ok) console.warn(`apiLogAction failed (${res.status})`);
  } catch (err) {
    console.warn("apiLogAction error:", err);
  }
}

export async function apiGetAuditLog({ action = "", target = "", actor = "", limit = 50, offset = 0 } = {}) {
  const params = new URLSearchParams();
  if (action) params.set("action", action);
  if (target) params.set("target", target);
  if (actor) params.set("actor", actor);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  const res = await fetch(`${API_BASE}/api/audit-log?${params}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`apiGetAuditLog failed (${res.status})`);
  return res.json();
}

// ── BILLS ────────────────────────────────────────────────────────────────────

export async function apiGetBills() {
  const res = await fetch(`${API_BASE}/api/bills`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetBills failed (${res.status})`);
  return res.json();
}

export async function apiGetBill(id) {
  const res = await fetch(`${API_BASE}/api/bills/${encodeURIComponent(id)}`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetBill failed (${res.status})`);
  return res.json();
}

export async function apiCreateBill(bill) {
  const res = await fetch(`${API_BASE}/api/bills`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(bill),
  });
  if (!res.ok) throw new Error(`apiCreateBill failed (${res.status})`);
  return res.json();
}

export async function apiUpdateBill(id, bill) {
  const res = await fetch(`${API_BASE}/api/bills/${encodeURIComponent(id)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(bill),
  });
  if (!res.ok) throw new Error(`apiUpdateBill failed (${res.status})`);
  return res.json();
}

export async function apiDeleteBill(id) {
  const res = await fetch(`${API_BASE}/api/bills/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiDeleteBill failed (${res.status})`);
  return res.json();
}

// ── MOTIONS ───────────────────────────────────────────────────────────────────

export async function apiGetMotions(type) {
  const params = type ? `?type=${encodeURIComponent(type)}` : "";
  const res = await fetch(`${API_BASE}/api/motions${params}`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetMotions failed (${res.status})`);
  return res.json();
}

export async function apiGetMotion(id) {
  const res = await fetch(`${API_BASE}/api/motions/${encodeURIComponent(id)}`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetMotion failed (${res.status})`);
  return res.json();
}

export async function apiCreateMotion(motionType, motion) {
  const res = await fetch(`${API_BASE}/api/motions`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ motion_type: motionType, ...motion }),
  });
  if (!res.ok) throw new Error(`apiCreateMotion failed (${res.status})`);
  return res.json();
}

export async function apiUpdateMotion(id, motion) {
  const res = await fetch(`${API_BASE}/api/motions/${encodeURIComponent(id)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(motion),
  });
  if (!res.ok) throw new Error(`apiUpdateMotion failed (${res.status})`);
  return res.json();
}

export async function apiDeleteMotion(id) {
  const res = await fetch(`${API_BASE}/api/motions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiDeleteMotion failed (${res.status})`);
  return res.json();
}

// ── STATEMENTS ────────────────────────────────────────────────────────────────

export async function apiGetStatements() {
  const res = await fetch(`${API_BASE}/api/statements`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetStatements failed (${res.status})`);
  return res.json();
}

export async function apiGetStatement(id) {
  const res = await fetch(`${API_BASE}/api/statements/${encodeURIComponent(id)}`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetStatement failed (${res.status})`);
  return res.json();
}

export async function apiCreateStatement(stmt) {
  const res = await fetch(`${API_BASE}/api/statements`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(stmt),
  });
  if (!res.ok) throw new Error(`apiCreateStatement failed (${res.status})`);
  return res.json();
}

export async function apiUpdateStatement(id, stmt) {
  const res = await fetch(`${API_BASE}/api/statements/${encodeURIComponent(id)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(stmt),
  });
  if (!res.ok) throw new Error(`apiUpdateStatement failed (${res.status})`);
  return res.json();
}

export async function apiDeleteStatement(id) {
  const res = await fetch(`${API_BASE}/api/statements/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiDeleteStatement failed (${res.status})`);
  return res.json();
}

// ── REGULATIONS ───────────────────────────────────────────────────────────────

export async function apiGetRegulations() {
  const res = await fetch(`${API_BASE}/api/regulations`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetRegulations failed (${res.status})`);
  return res.json();
}

export async function apiGetRegulation(id) {
  const res = await fetch(`${API_BASE}/api/regulations/${encodeURIComponent(id)}`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetRegulation failed (${res.status})`);
  return res.json();
}

export async function apiCreateRegulation(reg) {
  const res = await fetch(`${API_BASE}/api/regulations`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(reg),
  });
  if (!res.ok) throw new Error(`apiCreateRegulation failed (${res.status})`);
  return res.json();
}

export async function apiUpdateRegulation(id, reg) {
  const res = await fetch(`${API_BASE}/api/regulations/${encodeURIComponent(id)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(reg),
  });
  if (!res.ok) throw new Error(`apiUpdateRegulation failed (${res.status})`);
  return res.json();
}

export async function apiDeleteRegulation(id) {
  const res = await fetch(`${API_BASE}/api/regulations/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiDeleteRegulation failed (${res.status})`);
  return res.json();
}

// ── QUESTION TIME QUESTIONS ───────────────────────────────────────────────────

export async function apiGetQTQuestions() {
  const res = await fetch(`${API_BASE}/api/questiontime-questions`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetQTQuestions failed (${res.status})`);
  return res.json();
}

export async function apiGetQTQuestion(id) {
  const res = await fetch(`${API_BASE}/api/questiontime-questions/${encodeURIComponent(id)}`, {
    credentials: "include",
  });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetQTQuestion failed (${res.status})`);
  return res.json();
}

export async function apiCreateQTQuestion(q) {
  const res = await fetch(`${API_BASE}/api/questiontime-questions`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(q),
  });
  if (!res.ok) throw new Error(`apiCreateQTQuestion failed (${res.status})`);
  return res.json();
}

export async function apiUpdateQTQuestion(id, q) {
  const res = await fetch(`${API_BASE}/api/questiontime-questions/${encodeURIComponent(id)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(q),
  });
  if (!res.ok) throw new Error(`apiUpdateQTQuestion failed (${res.status})`);
  return res.json();
}

export async function apiDeleteQTQuestion(id) {
  const res = await fetch(`${API_BASE}/api/questiontime-questions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiDeleteQTQuestion failed (${res.status})`);
  return res.json();
}

// ── CLOCK ─────────────────────────────────────────────────────────────────────

export async function apiGetClock() {
  const res = await fetch(`${API_BASE}/api/clock`);
  if (!res.ok) throw new Error(`apiGetClock failed (${res.status})`);
  return res.json();
}

export async function apiClockTick() {
  const res = await fetch(`${API_BASE}/api/clock/tick`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiClockTick failed (${res.status})`);
  return res.json();
}

export async function apiClockSet({ sim_current_month, sim_current_year, rate } = {}) {
  const res = await fetch(`${API_BASE}/api/clock/set`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ sim_current_month, sim_current_year, rate }),
  });
  if (!res.ok) throw new Error(`apiClockSet failed (${res.status})`);
  return res.json();
}

// ── DISCOURSE INTEGRATION ─────────────────────────────────────────────────────

export async function apiGetDiscourseConfig() {
  const res = await fetch(`${API_BASE}/api/discourse/config`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`apiGetDiscourseConfig failed (${res.status})`);
  return res.json();
}

export async function apiSaveDiscourseConfig({ base_url, api_key, api_username, sso_secret }) {
  const res = await fetch(`${API_BASE}/api/discourse/config`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ base_url, api_key, api_username, sso_secret }),
  });
  if (!res.ok) throw new Error(`apiSaveDiscourseConfig failed (${res.status})`);
  return res.json();
}

export async function apiTestDiscourse() {
  const res = await fetch(`${API_BASE}/api/discourse/test`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  // Return body regardless of HTTP status so caller can read the error message
  return res.json();
}

export async function apiCreateDebateTopic({ entityType, entityId, title, raw, categoryId, tags } = {}) {
  const res = await fetch(`${API_BASE}/api/debates/create`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ entityType, entityId, title, raw, categoryId, tags }),
  });
  if (!res.ok) throw new Error(`apiCreateDebateTopic failed (${res.status})`);
  return res.json();
}

// ── ROLES SERVICE ─────────────────────────────────────────────────────────────

export async function apiGetMyRoles() {
  const res = await fetch(`${API_BASE}/api/me/roles`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`apiGetMyRoles failed (${res.status})`);
  return res.json();
}

export async function apiSetUserRoles(userId, roles) {
  const res = await fetch(`${API_BASE}/api/users/${encodeURIComponent(userId)}/roles`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ roles }),
  });
  if (!res.ok) throw new Error(`apiSetUserRoles failed (${res.status})`);
  return res.json();
}

export async function apiGetDiscourseSyncPreview() {
  const res = await fetch(`${API_BASE}/api/admin/discourse-sync-preview`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`apiGetDiscourseSyncPreview failed (${res.status})`);
  return res.json();
}

export async function apiGetSsoReadiness() {
  const res = await fetch(`${API_BASE}/api/admin/sso-readiness`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`apiGetSsoReadiness failed (${res.status})`);
  return res.json();
}

export async function apiAdminSyncDiscourseGroups() {
  const res = await fetch(`${API_BASE}/api/admin/discourse-sync-groups`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiAdminSyncDiscourseGroups failed (${res.status})`);
  return res.json();
}

// ── ADMIN MAINTENANCE ─────────────────────────────────────────────────────────

function maintPost(path) {
  return async function () {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { ...csrfHeaders() },
    });
    if (!res.ok) throw new Error(`${path} failed (${res.status})`);
    return res.json();
  };
}

export const apiAdminClearCache     = maintPost("/api/admin/clear-cache");
export const apiAdminRebuildCache   = maintPost("/api/admin/rebuild-cache");
export const apiAdminRotateSessions = maintPost("/api/admin/rotate-sessions");
export const apiAdminForceLogoutAll = maintPost("/api/admin/force-logout-all");

export async function apiAdminExportSnapshot() {
  const res = await fetch(`${API_BASE}/api/admin/export-snapshot`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`export-snapshot failed (${res.status})`);
  // Returns the raw Response so the caller can read blob + filename header
  return res;
}

export async function apiAdminImportSnapshot(label, data) {
  const res = await fetch(`${API_BASE}/api/admin/import-snapshot`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ label, data }),
  });
  if (!res.ok) throw new Error(`import-snapshot failed (${res.status})`);
  return res.json();
}

// ── CHARACTERS ────────────────────────────────────────────────────────────────

export async function apiGetCharacters() {
  const res = await fetch(`${API_BASE}/api/characters`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetCharacters failed (${res.status})`);
  return res.json();
}

export async function apiGetCharacter(id) {
  const res = await fetch(`${API_BASE}/api/characters/${encodeURIComponent(id)}`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetCharacter failed (${res.status})`);
  return res.json();
}

export async function apiCreateCharacter(character) {
  const res = await fetch(`${API_BASE}/api/characters`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(character),
  });
  if (!res.ok) throw new Error(`apiCreateCharacter failed (${res.status})`);
  return res.json();
}

export async function apiUpdateCharacter(id, updates) {
  const res = await fetch(`${API_BASE}/api/characters/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`apiUpdateCharacter failed (${res.status})`);
  return res.json();
}

// ── OFFICES ───────────────────────────────────────────────────────────────────

export async function apiGetOffices() {
  const res = await fetch(`${API_BASE}/api/offices`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetOffices failed (${res.status})`);
  return res.json();
}

export async function apiCreateOffice(office) {
  const res = await fetch(`${API_BASE}/api/offices`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(office),
  });
  if (!res.ok) throw new Error(`apiCreateOffice failed (${res.status})`);
  return res.json();
}

export async function apiAssignOffice(officeId, characterId) {
  const res = await fetch(`${API_BASE}/api/offices/${encodeURIComponent(officeId)}/assign`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ character_id: characterId }),
  });
  if (!res.ok) throw new Error(`apiAssignOffice failed (${res.status})`);
  return res.json();
}

// ── DIVISIONS ─────────────────────────────────────────────────────────────────

export async function apiGetDivisions(status) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await fetch(`${API_BASE}/api/divisions${qs}`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetDivisions failed (${res.status})`);
  return res.json();
}

export async function apiGetDivision(id) {
  const res = await fetch(`${API_BASE}/api/divisions/${encodeURIComponent(id)}`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetDivision failed (${res.status})`);
  return res.json();
}

export async function apiCreateDivision({ entity_type, entity_id, title, closes_at } = {}) {
  const res = await fetch(`${API_BASE}/api/divisions/create`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ entity_type, entity_id, title, closes_at }),
  });
  if (!res.ok) throw new Error(`apiCreateDivision failed (${res.status})`);
  return res.json();
}

export async function apiCastVote(divisionId, { character_id, vote, weight = 1 } = {}) {
  const res = await fetch(`${API_BASE}/api/divisions/${encodeURIComponent(divisionId)}/vote`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ character_id, vote, weight }),
  });
  if (!res.ok) throw new Error(`apiCastVote failed (${res.status})`);
  return res.json();
}

export async function apiCloseDivision(divisionId) {
  const res = await fetch(`${API_BASE}/api/divisions/${encodeURIComponent(divisionId)}/close`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiCloseDivision failed (${res.status})`);
  return res.json();
}

// ── STRUCTURED QUESTION TIME (/api/qt) ────────────────────────────────────────

export async function apiQtGetQuestions({ office_id, status } = {}) {
  const params = new URLSearchParams();
  if (office_id) params.set("office_id", office_id);
  if (status) params.set("status", status);
  const qs = params.toString() ? `?${params}` : "";
  const res = await fetch(`${API_BASE}/api/qt/questions${qs}`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiQtGetQuestions failed (${res.status})`);
  return res.json();
}

export async function apiQtGetQuestion(id) {
  const res = await fetch(`${API_BASE}/api/qt/questions/${encodeURIComponent(id)}`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiQtGetQuestion failed (${res.status})`);
  return res.json();
}

export async function apiQtSubmitQuestion({ office_id, asked_by_character_id, asked_by_name, asked_by_role, text, asked_at_sim, due_at_sim } = {}) {
  const res = await fetch(`${API_BASE}/api/qt/questions`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ office_id, asked_by_character_id, asked_by_name, asked_by_role, text, asked_at_sim, due_at_sim }),
  });
  if (!res.ok) throw new Error(`apiQtSubmitQuestion failed (${res.status})`);
  return res.json();
}

export async function apiQtAnswerQuestion(questionId, { answered_by_character_id, answered_by_name, text, answered_at_sim } = {}) {
  const res = await fetch(`${API_BASE}/api/qt/questions/${encodeURIComponent(questionId)}/answer`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ answered_by_character_id, answered_by_name, text, answered_at_sim }),
  });
  if (!res.ok) throw new Error(`apiQtAnswerQuestion failed (${res.status})`);
  return res.json();
}

export async function apiQtSubmitFollowup(questionId, { asked_by_character_id, asked_by_name, asked_by_role, text, asked_at_sim } = {}) {
  const res = await fetch(`${API_BASE}/api/qt/questions/${encodeURIComponent(questionId)}/followup`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ asked_by_character_id, asked_by_name, asked_by_role, text, asked_at_sim }),
  });
  if (!res.ok) throw new Error(`apiQtSubmitFollowup failed (${res.status})`);
  return res.json();
}

export async function apiQtAnswerFollowup(questionId, followupId, { text, answered_by_name } = {}) {
  const res = await fetch(`${API_BASE}/api/qt/questions/${encodeURIComponent(questionId)}/followup/${encodeURIComponent(followupId)}/answer`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ text, answered_by_name }),
  });
  if (!res.ok) throw new Error(`apiQtAnswerFollowup failed (${res.status})`);
  return res.json();
}

export async function apiQtArchiveQuestion(questionId) {
  const res = await fetch(`${API_BASE}/api/qt/questions/${encodeURIComponent(questionId)}/archive`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiQtArchiveQuestion failed (${res.status})`);
  return res.json();
}

export async function apiQtSpeakerDemand(questionId) {
  const res = await fetch(`${API_BASE}/api/qt/questions/${encodeURIComponent(questionId)}/speaker-demand`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiQtSpeakerDemand failed (${res.status})`);
  return res.json();
}

// ── SIMULATION STATE (/api/sim) ───────────────────────────────────────────────

export async function apiGetSim() {
  const res = await fetch(`${API_BASE}/api/sim`);
  if (!res.ok) throw new Error(`apiGetSim failed (${res.status})`);
  return res.json();
}

export async function apiSimTick() {
  const res = await fetch(`${API_BASE}/api/sim/tick`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiSimTick failed (${res.status})`);
  return res.json();
}

export async function apiSimSet({ year, month, is_paused } = {}) {
  const res = await fetch(`${API_BASE}/api/sim/set`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ year, month, is_paused }),
  });
  if (!res.ok) throw new Error(`apiSimSet failed (${res.status})`);
  return res.json();
}

// ── BILL STAGE ────────────────────────────────────────────────────────────────

export async function apiBillSetStage(billId, stage) {
  const res = await fetch(`${API_BASE}/api/bills/${encodeURIComponent(billId)}/stage`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ stage }),
  });
  if (!res.ok) throw new Error(`apiBillSetStage failed (${res.status})`);
  return res.json();
}

// ── ADMIN DASHBOARD ───────────────────────────────────────────────────────────

export async function apiAdminDashboard() {
  const res = await fetch(`${API_BASE}/api/admin/dashboard`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiAdminDashboard failed (${res.status})`);
  return res.json();
}

export async function apiAdminSyncDiscourseBills() {
  const res = await fetch(`${API_BASE}/api/admin/sync-discourse-bills`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiAdminSyncDiscourseBills failed (${res.status})`);
  return res.json();
}
