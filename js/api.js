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
  const res = await fetch(`${API_BASE}/auth/logout`, {
    method: "POST",
    credentials: "include",
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
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label, data }),
  });
  if (!res.ok) throw new Error(`apiSaveSnapshot failed (${res.status})`);
  return res.json();
}

export async function apiRestoreSnapshot(id) {
  const res = await fetch(`${API_BASE}/api/snapshots/${encodeURIComponent(id)}/restore`, {
    method: "POST",
    credentials: "include",
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
    headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bill),
  });
  if (!res.ok) throw new Error(`apiCreateBill failed (${res.status})`);
  return res.json();
}

export async function apiUpdateBill(id, bill) {
  const res = await fetch(`${API_BASE}/api/bills/${encodeURIComponent(id)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bill),
  });
  if (!res.ok) throw new Error(`apiUpdateBill failed (${res.status})`);
  return res.json();
}

export async function apiDeleteBill(id) {
  const res = await fetch(`${API_BASE}/api/bills/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ motion_type: motionType, ...motion }),
  });
  if (!res.ok) throw new Error(`apiCreateMotion failed (${res.status})`);
  return res.json();
}

export async function apiUpdateMotion(id, motion) {
  const res = await fetch(`${API_BASE}/api/motions/${encodeURIComponent(id)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(motion),
  });
  if (!res.ok) throw new Error(`apiUpdateMotion failed (${res.status})`);
  return res.json();
}

export async function apiDeleteMotion(id) {
  const res = await fetch(`${API_BASE}/api/motions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(stmt),
  });
  if (!res.ok) throw new Error(`apiCreateStatement failed (${res.status})`);
  return res.json();
}

export async function apiUpdateStatement(id, stmt) {
  const res = await fetch(`${API_BASE}/api/statements/${encodeURIComponent(id)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(stmt),
  });
  if (!res.ok) throw new Error(`apiUpdateStatement failed (${res.status})`);
  return res.json();
}

export async function apiDeleteStatement(id) {
  const res = await fetch(`${API_BASE}/api/statements/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reg),
  });
  if (!res.ok) throw new Error(`apiCreateRegulation failed (${res.status})`);
  return res.json();
}

export async function apiUpdateRegulation(id, reg) {
  const res = await fetch(`${API_BASE}/api/regulations/${encodeURIComponent(id)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reg),
  });
  if (!res.ok) throw new Error(`apiUpdateRegulation failed (${res.status})`);
  return res.json();
}

export async function apiDeleteRegulation(id) {
  const res = await fetch(`${API_BASE}/api/regulations/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(q),
  });
  if (!res.ok) throw new Error(`apiCreateQTQuestion failed (${res.status})`);
  return res.json();
}

export async function apiUpdateQTQuestion(id, q) {
  const res = await fetch(`${API_BASE}/api/questiontime-questions/${encodeURIComponent(id)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(q),
  });
  if (!res.ok) throw new Error(`apiUpdateQTQuestion failed (${res.status})`);
  return res.json();
}

export async function apiDeleteQTQuestion(id) {
  const res = await fetch(`${API_BASE}/api/questiontime-questions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
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
  });
  if (!res.ok) throw new Error(`apiClockTick failed (${res.status})`);
  return res.json();
}

export async function apiClockSet({ sim_current_month, sim_current_year, rate } = {}) {
  const res = await fetch(`${API_BASE}/api/clock/set`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
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

export async function apiSaveDiscourseConfig({ base_url, api_key, api_username }) {
  const res = await fetch(`${API_BASE}/api/discourse/config`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base_url, api_key, api_username }),
  });
  if (!res.ok) throw new Error(`apiSaveDiscourseConfig failed (${res.status})`);
  return res.json();
}

export async function apiTestDiscourse() {
  const res = await fetch(`${API_BASE}/api/discourse/test`, {
    method: "POST",
    credentials: "include",
  });
  // Return body regardless of HTTP status so caller can read the error message
  return res.json();
}

export async function apiCreateDebateTopic({ entityType, entityId, title, raw, categoryId, tags } = {}) {
  const res = await fetch(`${API_BASE}/api/debates/create`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
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

// ── ADMIN MAINTENANCE ─────────────────────────────────────────────────────────

function maintPost(path) {
  return async function () {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      credentials: "include",
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label, data }),
  });
  if (!res.ok) throw new Error(`import-snapshot failed (${res.status})`);
  return res.json();
}
