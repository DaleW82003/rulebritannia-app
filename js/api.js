// js/api.js
function resolveApiBase() {
  if (typeof window !== "undefined" && window.RB_API_BASE) return window.RB_API_BASE;
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
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`apiLogin failed (${res.status})`);
  return res.json();
}

export async function apiMe() {
  const res = await fetch(`${API_BASE}/api/auth/me`, {
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
  const tokenRes = await fetch(`${API_BASE}/api/csrf-token`, { credentials: "include" });
  if (!tokenRes.ok) throw new Error(`apiLogout failed: could not fetch CSRF token (${tokenRes.status})`);
  const { csrfToken } = await tokenRes.json();
  const res = await fetch(`${API_BASE}/api/auth/logout`, {
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

// ── Characters ─────────────────────────────────────────────────────────────

export async function apiGetCharacters(params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)).toString();
  const res = await fetch(`${API_BASE}/api/characters${qs ? "?" + qs : ""}`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetCharacters failed (${res.status})`);
  return res.json();
}

export async function apiGetCharacter(id) {
  const res = await fetch(`${API_BASE}/api/characters/${encodeURIComponent(id)}`, { credentials: "include" });
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

export async function apiPatchCharacter(id, updates) {
  const res = await fetch(`${API_BASE}/api/characters/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`apiPatchCharacter failed (${res.status})`);
  return res.json();
}

export async function apiGetMyCharacters() {
  const res = await fetch(`${API_BASE}/api/characters/mine`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetMyCharacters failed (${res.status})`);
  return res.json();
}

export async function apiSelectCharacter(character_id) {
  const res = await fetch(`${API_BASE}/api/characters/select`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ character_id }),
  });
  if (!res.ok) throw new Error(`apiSelectCharacter failed (${res.status})`);
  return res.json();
}

export async function apiApplyCharacter(fields) {
  const res = await fetch(`${API_BASE}/api/characters/apply`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiApplyCharacter failed (${res.status})`);
  }
  return res.json();
}

export async function apiGetMyApplications() {
  const res = await fetch(`${API_BASE}/api/characters/applications/mine`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetMyApplications failed (${res.status})`);
  return res.json();
}

export async function apiGetCharacterApplications(status) {
  const url = status
    ? `${API_BASE}/api/admin/characters/applications?status=${encodeURIComponent(status)}`
    : `${API_BASE}/api/admin/characters/applications`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetCharacterApplications failed (${res.status})`);
  return res.json();
}

export async function apiApproveCharacterApplication(id) {
  const res = await fetch(`${API_BASE}/api/admin/characters/applications/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiApproveCharacterApplication failed (${res.status})`);
  }
  return res.json();
}

export async function apiRejectCharacterApplication(id) {
  const res = await fetch(`${API_BASE}/api/admin/characters/applications/${encodeURIComponent(id)}/reject`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiRejectCharacterApplication failed (${res.status})`);
  }
  return res.json();
}

export async function apiAdminSetCharacterInactive(id) {
  const res = await fetch(`${API_BASE}/api/admin/characters/${encodeURIComponent(id)}/set-inactive`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiAdminSetCharacterInactive failed (${res.status})`);
  }
  return res.json();
}

export async function apiAdminRepairCharacterOwners() {
  const res = await fetch(`${API_BASE}/api/admin/repair/character-owner-pointers`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = body.error || `apiAdminRepairCharacterOwners failed (${res.status})`;
    throw new Error(body.errId ? `${msg} (errId: ${body.errId})` : msg);
  }
  return res.json();
}

export async function apiSubmitBioChange(proposed_bio) {
  const res = await fetch(`${API_BASE}/api/characters/bio-change`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ proposed_bio }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiSubmitBioChange failed (${res.status})`);
  }
  return res.json();
}

export async function apiGetMyBioChanges() {
  const res = await fetch(`${API_BASE}/api/characters/bio-changes/mine`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetMyBioChanges failed (${res.status})`);
  return res.json();
}

export async function apiGetAllBioChanges(status) {
  const url = status
    ? `${API_BASE}/api/admin/bio-changes?status=${encodeURIComponent(status)}`
    : `${API_BASE}/api/admin/bio-changes`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetAllBioChanges failed (${res.status})`);
  return res.json();
}

export async function apiApproveBioChange(id) {
  const res = await fetch(`${API_BASE}/api/admin/bio-changes/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiApproveBioChange failed (${res.status})`);
  }
  return res.json();
}

export async function apiRejectBioChange(id) {
  const res = await fetch(`${API_BASE}/api/admin/bio-changes/${encodeURIComponent(id)}/reject`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiRejectBioChange failed (${res.status})`);
  }
  return res.json();
}

export async function apiSubmitAvatarChange(proposed_avatar) {
  const res = await fetch(`${API_BASE}/api/characters/avatar-change`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ proposed_avatar }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiSubmitAvatarChange failed (${res.status})`);
  }
  return res.json();
}

export async function apiGetAllAvatarChanges(status) {
  const url = status
    ? `${API_BASE}/api/admin/avatar-changes?status=${encodeURIComponent(status)}`
    : `${API_BASE}/api/admin/avatar-changes`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetAllAvatarChanges failed (${res.status})`);
  return res.json();
}

export async function apiApproveAvatarChange(id) {
  const res = await fetch(`${API_BASE}/api/admin/avatar-changes/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiApproveAvatarChange failed (${res.status})`);
  }
  return res.json();
}

export async function apiRejectAvatarChange(id) {
  const res = await fetch(`${API_BASE}/api/admin/avatar-changes/${encodeURIComponent(id)}/reject`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiRejectAvatarChange failed (${res.status})`);
  }
  return res.json();
}

export async function apiSetProperty(character_id, home, rentals) {
  const res = await fetch(`${API_BASE}/api/mod/property/set`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ character_id, home, rentals }),
  });
  if (!res.ok) throw new Error(`apiSetProperty failed (${res.status})`);
  return res.json();
}

export async function apiGetParty(partyId) {
  const res = await fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetParty failed (${res.status})`);
  return res.json();
}

export async function apiSetPartyLeadership(partyId, role, character_id) {
  const res = await fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}/leadership`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ role, character_id }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiSetPartyLeadership failed (${res.status})`);
  }
  return res.json();
}

// ── Shop price index ────────────────────────────────────────────────────────

export async function apiGetShopPriceIndex() {
  const res = await fetch(`${API_BASE}/api/shop/price-index`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetShopPriceIndex failed (${res.status})`);
  return res.json();
}

export async function apiApplyShopInflation() {
  const res = await fetch(`${API_BASE}/api/shop/apply-inflation`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiApplyShopInflation failed (${res.status})`);
  return body;
}

export async function apiUpdateCharacterShopUpkeep(upkeep) {
  const res = await fetch(`${API_BASE}/api/finance/shop-upkeep`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ upkeep }),
  });
  if (!res.ok) throw new Error(`apiUpdateCharacterShopUpkeep failed (${res.status})`);
  return res.json();
}

// ── Party structure ─────────────────────────────────────────────────────────

export async function apiGetPartyStructure(partyId) {
  const res = await fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}/structure`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetPartyStructure failed (${res.status})`);
  return res.json();
}

export async function apiSavePartyStructure(partyId, structure) {
  const res = await fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}/structure`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ structure }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiSavePartyStructure failed (${res.status})`);
  return body;
}

// ── Offices ────────────────────────────────────────────────────────────────

export async function apiGetOffices() {
  const res = await fetch(`${API_BASE}/api/offices`, { credentials: "include" });
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

export async function apiAssignOffice(officeId, character_id) {
  const res = await fetch(`${API_BASE}/api/offices/${encodeURIComponent(officeId)}/assign`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ character_id }),
  });
  if (!res.ok) throw new Error(`apiAssignOffice failed (${res.status})`);
  return res.json();
}

// ── Divisions ──────────────────────────────────────────────────────────────

export async function apiGetDivisions(params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)).toString();
  const res = await fetch(`${API_BASE}/api/divisions${qs ? "?" + qs : ""}`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetDivisions failed (${res.status})`);
  return res.json();
}

export async function apiGetDivision(id) {
  const res = await fetch(`${API_BASE}/api/divisions/${encodeURIComponent(id)}`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetDivision failed (${res.status})`);
  return res.json();
}

export async function apiCreateDivision(entityType, entityId, title = "", closesAtSim = null) {
  const res = await fetch(`${API_BASE}/api/divisions/create`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ entity_type: entityType, entity_id: entityId, title, closes_at_sim: closesAtSim }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiCreateDivision failed (${res.status})`);
  }
  return res.json();
}

export async function apiVoteDivision(id, character_id, vote, weight) {
  const res = await fetch(`${API_BASE}/api/divisions/${encodeURIComponent(id)}/vote`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ character_id, vote, weight }),
  });
  if (!res.ok) throw new Error(`apiVoteDivision failed (${res.status})`);
  return res.json();
}

export async function apiCloseDivision(id) {
  const res = await fetch(`${API_BASE}/api/divisions/${encodeURIComponent(id)}/close`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: "{}",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiCloseDivision failed (${res.status})`);
  }
  return res.json();
}

export async function apiCastVote(divisionId, vote, weight = 1) {
  const res = await fetch(`${API_BASE}/api/divisions/${encodeURIComponent(divisionId)}/vote`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ vote, weight }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiCastVote failed (${res.status})`);
  }
  return res.json();
}

// ── Question Time (DB-driven) ──────────────────────────────────────────────

export async function apiGetQtQuestions(params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)).toString();
  const res = await fetch(`${API_BASE}/api/qt/questions${qs ? "?" + qs : ""}`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetQtQuestions failed (${res.status})`);
  return res.json();
}

export async function apiGetQtQuestion(id) {
  const res = await fetch(`${API_BASE}/api/qt/questions/${encodeURIComponent(id)}`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetQtQuestion failed (${res.status})`);
  return res.json();
}

export async function apiSubmitQtQuestion(payload) {
  const res = await fetch(`${API_BASE}/api/qt/questions`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`apiSubmitQtQuestion failed (${res.status})`);
  return res.json();
}

export async function apiPatchQtQuestion(id, updates) {
  const res = await fetch(`${API_BASE}/api/qt/questions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`apiPatchQtQuestion failed (${res.status})`);
  return res.json();
}

export async function apiAnswerQtQuestion(id, payload) {
  const res = await fetch(`${API_BASE}/api/qt/questions/${encodeURIComponent(id)}/answer`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`apiAnswerQtQuestion failed (${res.status})`);
  return res.json();
}

export async function apiFollowupQtQuestion(id, payload) {
  const res = await fetch(`${API_BASE}/api/qt/questions/${encodeURIComponent(id)}/followup`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`apiFollowupQtQuestion failed (${res.status})`);
  return res.json();
}

// ── Question Time (legacy CRUD endpoint) ────────────────────────────────────

export async function apiGetQtLegacyQuestions() {
  const res = await fetch(`${API_BASE}/api/questiontime-questions`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetQtLegacyQuestions failed (${res.status})`);
  return res.json();
}

export async function apiCreateQtLegacyQuestion(question) {
  const res = await fetch(`${API_BASE}/api/questiontime-questions`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(question),
  });
  if (!res.ok) throw new Error(`apiCreateQtLegacyQuestion failed (${res.status})`);
  return res.json();
}

export async function apiUpdateQtLegacyQuestion(id, question) {
  const res = await fetch(`${API_BASE}/api/questiontime-questions/${encodeURIComponent(id)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(question),
  });
  if (!res.ok) throw new Error(`apiUpdateQtLegacyQuestion failed (${res.status})`);
  return res.json();
}

// ── Simulation State ───────────────────────────────────────────────────────

export async function apiGetSim() {
  const res = await fetch(`${API_BASE}/api/sim`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetSim failed (${res.status})`);
  return res.json();
}

export async function apiSimTick() {
  const res = await fetch(`${API_BASE}/api/sim/tick`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiSimTick failed (${res.status})`);
  return res.json();
}

export async function apiSimSet(payload) {
  const res = await fetch(`${API_BASE}/api/sim/set`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`apiSimSet failed (${res.status})`);
  return res.json();
}

// ── Admin Dashboard ────────────────────────────────────────────────────────

export async function apiGetAdminDashboard() {
  const res = await fetch(`${API_BASE}/api/admin/dashboard`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetAdminDashboard failed (${res.status})`);
  return res.json();
}

export async function apiAdminDiscourseSyncBills() {
  const res = await fetch(`${API_BASE}/api/admin/discourse-sync-bills`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiAdminDiscourseSyncBills failed (${res.status})`);
  return res.json();
}

export async function apiPatchBill(id, updates) {
  const res = await fetch(`${API_BASE}/api/bills/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`apiPatchBill failed (${res.status})`);
  return res.json();
}


// ── Press items ────────────────────────────────────────────────────────────

export async function apiGetPressItems(type) {
  const url = type
    ? `${API_BASE}/api/press?type=${encodeURIComponent(type)}`
    : `${API_BASE}/api/press`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetPressItems failed (${res.status})`);
  return res.json();
}

export async function apiCreatePressItem(payload) {
  const res = await fetch(`${API_BASE}/api/press`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`apiCreatePressItem failed (${res.status})`);
  return res.json();
}

export async function apiUpdatePressItem(id, payload) {
  const res = await fetch(`${API_BASE}/api/press/${encodeURIComponent(id)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`apiUpdatePressItem failed (${res.status})`);
  return res.json();
}

export async function apiDeletePressItem(id) {
  const res = await fetch(`${API_BASE}/api/press/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
    headers: csrfHeaders(),
  });
  if (!res.ok) throw new Error(`apiDeletePressItem failed (${res.status})`);
  return res.json();
}

// ── Polling entries ────────────────────────────────────────────────────────

export async function apiGetPollingEntries() {
  const res = await fetch(`${API_BASE}/api/polling`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetPollingEntries failed (${res.status})`);
  return res.json();
}

export async function apiCreatePollingEntry(payload) {
  const res = await fetch(`${API_BASE}/api/polling`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`apiCreatePollingEntry failed (${res.status})`);
  return res.json();
}

// ── Admin seed-demo ────────────────────────────────────────────────────────

export async function apiSeedDemo() {
  const res = await fetch(`${API_BASE}/api/admin/seed-demo`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiSeedDemo failed (${res.status})`);
  return res.json();
}

// ── Admin wipe-content ─────────────────────────────────────────────────────

export async function apiWipeContent() {
  const res = await fetch(`${API_BASE}/api/admin/wipe-content`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ confirm: "WIPE CONTENT" }),
  });
  if (!res.ok) throw new Error(`apiWipeContent failed (${res.status})`);
  return res.json();
}


// ── Pending Registrations (admin) ─────────────────────────────────────────

export async function apiGetPendingRegistrations(status = "pending") {
  const res = await fetch(`${API_BASE}/api/admin/registrations?status=${encodeURIComponent(status)}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`apiGetPendingRegistrations failed (${res.status})`);
  return res.json();
}

export async function apiApproveRegistration(id) {
  const res = await fetch(`${API_BASE}/api/admin/registrations/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiApproveRegistration failed (${res.status})`);
  return res.json();
}

export async function apiRejectRegistration(id) {
  const res = await fetch(`${API_BASE}/api/admin/registrations/${encodeURIComponent(id)}/reject`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiRejectRegistration failed (${res.status})`);
  return res.json();
}

// ── Scandal system ─────────────────────────────────────────────────────────

export async function apiScandalsMine() {
  const res = await fetch(`${API_BASE}/api/scandals/mine`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiScandalsMine failed (${res.status})`);
  return res.json();
}

export async function apiScandalsOptIn(opted_in) {
  const res = await fetch(`${API_BASE}/api/scandals/optin`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ opted_in }),
  });
  if (!res.ok) throw new Error(`apiScandalsOptIn failed (${res.status})`);
  return res.json();
}

export async function apiScandalSituationRespond(situationId, action) {
  const res = await fetch(`${API_BASE}/api/scandals/situations/${encodeURIComponent(situationId)}/respond`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) throw new Error(`apiScandalSituationRespond failed (${res.status})`);
  return res.json();
}

export async function apiScandalChoose(scandalId, choice_id) {
  const res = await fetch(`${API_BASE}/api/scandals/${encodeURIComponent(scandalId)}/choose`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ choice_id }),
  });
  if (!res.ok) throw new Error(`apiScandalChoose failed (${res.status})`);
  return res.json();
}

export async function apiModScandalSituationCreate(payload) {
  const res = await fetch(`${API_BASE}/api/mod/scandals/situations/create`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`apiModScandalSituationCreate failed (${res.status})`);
  return res.json();
}

export async function apiModScandalsOpen() {
  const res = await fetch(`${API_BASE}/api/mod/scandals/open`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiModScandalsOpen failed (${res.status})`);
  return res.json();
}

export async function apiModScandalDecision(scandalId, payload) {
  const res = await fetch(`${API_BASE}/api/mod/scandals/${encodeURIComponent(scandalId)}/decision`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`apiModScandalDecision failed (${res.status})`);
  return res.json();
}

export async function apiModScandalClose(scandalId) {
  const res = await fetch(`${API_BASE}/api/mod/scandals/${encodeURIComponent(scandalId)}/close`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiModScandalClose failed (${res.status})`);
  return res.json();
}

export async function apiModScandalTemplates() {
  const res = await fetch(`${API_BASE}/api/mod/scandal-templates`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiModScandalTemplates failed (${res.status})`);
  return res.json();
}

export async function apiModScandalOptedInCharacters() {
  const res = await fetch(`${API_BASE}/api/mod/scandals/opted-in-characters`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiModScandalOptedInCharacters failed (${res.status})`);
  return res.json();
}

export async function apiModScandalTemplateUpsert(payload) {
  const res = await fetch(`${API_BASE}/api/mod/scandal-templates`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`apiModScandalTemplateUpsert failed (${res.status})`);
  return res.json();
}

// ── Divisions (DB-backed) ──────────────────────────────────────────────────

export async function apiGetDivisionForEntity(entityType, entityId) {
  const res = await fetch(
    `${API_BASE}/api/divisions/for-entity/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`,
    { credentials: "include" }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetDivisionForEntity failed (${res.status})`);
  return res.json();
}

export async function apiSetNpcVotes(divisionId, npcVotes, rebelsByParty = {}) {
  const res = await fetch(`${API_BASE}/api/divisions/${encodeURIComponent(divisionId)}/npc-votes`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ npc_votes: npcVotes, rebels_by_party: rebelsByParty }),
  });
  if (!res.ok) throw new Error(`apiSetNpcVotes failed (${res.status})`);
  return res.json();
}

// ── Whip system ───────────────────────────────────────────────────────────

export async function apiSetChiefWhip(partyId, chiefWhipId, deputyWhipId = null) {
  const res = await fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}/chief-whip`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ chiefWhipId, deputyWhipId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiSetChiefWhip failed (${res.status})`);
  }
  return res.json();
}

export async function apiGetPartyInstruction(divisionId, partySlug) {
  const res = await fetch(
    `${API_BASE}/api/divisions/${encodeURIComponent(divisionId)}/party-instruction/${encodeURIComponent(partySlug)}`,
    { credentials: "include" }
  );
  if (!res.ok) throw new Error(`apiGetPartyInstruction failed (${res.status})`);
  return res.json();
}

export async function apiSetPartyInstruction(divisionId, body) {
  const res = await fetch(
    `${API_BASE}/api/divisions/${encodeURIComponent(divisionId)}/party-instruction`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.error || `apiSetPartyInstruction failed (${res.status})`);
  }
  return res.json();
}

export async function apiGetRebelRequest(divisionId) {
  const res = await fetch(
    `${API_BASE}/api/divisions/${encodeURIComponent(divisionId)}/rebel-request`,
    { credentials: "include" }
  );
  if (!res.ok) throw new Error(`apiGetRebelRequest failed (${res.status})`);
  return res.json();
}

export async function apiSubmitRebelRequest(divisionId, requestedVote, message = "") {
  const res = await fetch(
    `${API_BASE}/api/divisions/${encodeURIComponent(divisionId)}/rebel-request`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({ requestedVote, message }),
    }
  );
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.error || `apiSubmitRebelRequest failed (${res.status})`);
  }
  return res.json();
}

export async function apiDecideRebelRequest(divisionId, requestId, decision) {
  const res = await fetch(
    `${API_BASE}/api/divisions/${encodeURIComponent(divisionId)}/rebel-request/${encodeURIComponent(requestId)}/decide`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({ status: decision }),
    }
  );
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.error || `apiDecideRebelRequest failed (${res.status})`);
  }
  return res.json();
}


// ── Constituencies ──────────────────────────────────────────────────────────

export async function apiGetConstituencies() {
  const res = await fetch(`${API_BASE}/api/constituencies`, { credentials: "include" });
  return res.json();
}

export async function apiSaveConstituency(c) {
  const res = await fetch(`${API_BASE}/api/constituencies`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(c),
  });
  return res.json();
}

export async function apiUpdateConstituency(id, updates) {
  const res = await fetch(`${API_BASE}/api/constituencies/${encodeURIComponent(id)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(updates),
  });
  return res.json();
}

export async function apiDeleteConstituency(id) {
  const res = await fetch(`${API_BASE}/api/constituencies/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  return res.json();
}

export async function apiInitialize1997Constituencies(confirmOverwrite) {
  const res = await fetch(`${API_BASE}/api/admin/constituencies/initialize-1997`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ confirm: confirmOverwrite }),
  });
  return res.json();
}

export async function apiClearConstituencies() {
  const res = await fetch(`${API_BASE}/api/admin/constituencies/clear`, {
    method: "DELETE",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  return res.json();
}

// ── Elections (DB-backed) ─────────────────────────────────────────────────────

export async function apiGetParliamentStatus() {
  const res = await fetch(`${API_BASE}/api/parliament/status`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetParliamentStatus failed (${res.status})`);
  return res.json();
}

export async function apiUpdateParliamentStatus(payload) {
  const res = await fetch(`${API_BASE}/api/parliament/status`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.error || `apiUpdateParliamentStatus failed (${res.status})`);
  }
  return res.json();
}

export async function apiGetCanonicalParties() {
  const res = await fetch(`${API_BASE}/api/parties/canonical`, { credentials: "include" });
  return res.json();
}

export async function apiGetElectionSeatTotals() {
  const res = await fetch(`${API_BASE}/api/elections/seat-totals`, { credentials: "include" });
  return res.json();
}

export async function apiGetCurrentElection() {
  const res = await fetch(`${API_BASE}/api/elections/current`, { credentials: "include" });
  return res.json();
}

export async function apiGetElections() {
  const res = await fetch(`${API_BASE}/api/elections`, { credentials: "include" });
  return res.json();
}

export async function apiCreateElection(payload) {
  const res = await fetch(`${API_BASE}/api/elections`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function apiUpdateElection(id, payload) {
  const res = await fetch(`${API_BASE}/api/elections/${encodeURIComponent(id)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function apiGetElectionChanges(id) {
  const res = await fetch(`${API_BASE}/api/elections/${encodeURIComponent(id)}/changes`, { credentials: "include" });
  return res.json();
}

export async function apiSaveElectionChanges(id, payload) {
  const res = await fetch(`${API_BASE}/api/elections/${encodeURIComponent(id)}/changes`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function apiFinalizeElection(id) {
  const res = await fetch(`${API_BASE}/api/elections/${encodeURIComponent(id)}/finalize`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({}),
  });
  return res.json();
}

export async function apiSeedElection1997() {
  const res = await fetch(`${API_BASE}/api/admin/elections/seed-1997`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({}),
  });
  return res.json();
}

export async function apiGetElectionBodiesCurrent() {
  const res = await fetch(`${API_BASE}/api/elections/bodies/current`, { credentials: "include" });
  return res.json();
}

export async function apiGetElectionBodiesArchive() {
  const res = await fetch(`${API_BASE}/api/elections/bodies/archive`, { credentials: "include" });
  return res.json();
}

export async function apiSubmitElectionBodyResult(payload) {
  const res = await fetch(`${API_BASE}/api/elections/bodies`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function apiResetBaseline() {
  const res = await fetch(`${API_BASE}/api/admin/reset-baseline`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ confirm: "RESET BASELINE" }),
  });
  return res.json();
}

export async function apiGetConstituencyEvents(id) {
  const res = await fetch(`${API_BASE}/api/constituencies/${encodeURIComponent(id)}/events`, { credentials: "include" });
  return res.json();
}

// ── Budget (DB-backed) ─────────────────────────────────────────────────────

export async function apiGetBudget() {
  const res = await fetch(`${API_BASE}/api/budget`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetBudget failed (${res.status})`);
  return res.json();
}

export async function apiAdminSeedBudget(force = false) {
  const res = await fetch(`${API_BASE}/api/admin/budget/seed`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ force }),
  });
  return res.json();
}

export async function apiAdminUpdateBudgetControls(controls) {
  const res = await fetch(`${API_BASE}/api/admin/budget/controls`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(controls),
  });
  if (!res.ok) throw new Error(`apiAdminUpdateBudgetControls failed (${res.status})`);
  return res.json();
}

export async function apiSubmitBudgetDraft(budget, submittedBy) {
  const res = await fetch(`${API_BASE}/api/budget/draft`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ budget, submittedBy }),
  });
  if (!res.ok) throw new Error(`apiSubmitBudgetDraft failed (${res.status})`);
  return res.json();
}

export async function apiAdminApproveBudget() {
  const res = await fetch(`${API_BASE}/api/admin/budget/approve`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`apiAdminApproveBudget failed (${res.status})`);
  return res.json();
}

export async function apiAdminRejectBudget() {
  const res = await fetch(`${API_BASE}/api/admin/budget/reject`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`apiAdminRejectBudget failed (${res.status})`);
  return res.json();
}

// ── Public team read-only ───────────────────────────────────────────────────

export async function apiGetTeam() {
  const res = await fetch(`${API_BASE}/api/team`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetTeam failed (${res.status})`);
  return res.json();
}

// ── Public profile read-only ────────────────────────────────────────────────

export async function apiGetPublicProfile(username) {
  const res = await fetch(`${API_BASE}/api/profile?user=${encodeURIComponent(username)}`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetPublicProfile failed (${res.status})`);
  return res.json();
}

// ── Affiliations workflow ───────────────────────────────────────────────────

export async function apiGetCharacterAffiliations(characterId) {
  const res = await fetch(`${API_BASE}/api/me/character/${encodeURIComponent(characterId)}/affiliations`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetCharacterAffiliations failed (${res.status})`);
  return res.json();
}

export async function apiSubmitCharacterAffiliations(characterId, requestedAffiliationIds) {
  const res = await fetch(`${API_BASE}/api/me/character/${encodeURIComponent(characterId)}/affiliations`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ requestedAffiliationIds }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiSubmitCharacterAffiliations failed (${res.status})`);
  }
  return res.json();
}

export async function apiGetPendingAffiliations() {
  const res = await fetch(`${API_BASE}/api/control-panel/affiliations/pending`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetPendingAffiliations failed (${res.status})`);
  return res.json();
}

export async function apiDecideAffiliation(requestId, decision, note) {
  const res = await fetch(`${API_BASE}/api/control-panel/affiliations/${encodeURIComponent(requestId)}/decide`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ decision, note: note || "" }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiDecideAffiliation failed (${res.status})`);
  }
  return res.json();
}

// ── Admin: user management ─────────────────────────────────────────────────

export async function apiAdminGetUsers() {
  const res = await fetch(`${API_BASE}/api/admin/users`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiAdminGetUsers failed (${res.status})`);
  return res.json();
}

export async function apiAdminGetCharacters(params = {}) {
  const qs = new URLSearchParams();
  if (params.owned !== undefined) qs.set("owned", params.owned);
  if (params.active !== undefined) qs.set("active", String(params.active));
  const url = `${API_BASE}/api/admin/characters${qs.toString() ? `?${qs}` : ""}`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`apiAdminGetCharacters failed (${res.status})`);
  return res.json();
}

export async function apiAdminAssignCharacterOwner(characterId, userId, setActive = false) {
  const res = await fetch(`${API_BASE}/api/admin/characters/${encodeURIComponent(characterId)}/assign-owner`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ user_id: userId, set_active: setActive }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiAdminAssignCharacterOwner failed (${res.status})`);
  }
  return res.json();
}

export async function apiAdminSetUserActiveCharacter(userId, characterId) {
  const res = await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(userId)}/active-character`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ character_id: characterId || null }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiAdminSetUserActiveCharacter failed (${res.status})`);
  }
  return res.json();
}

// ── Playerbase & Finance APIs ──────────────────────────────────────────────

export async function apiGetPlayerbase() {
  const res = await fetch(`${API_BASE}/api/admin/playerbase`, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiGetPlayerbase failed (${res.status})`);
  }
  return res.json();
}

export async function apiAdminSetBank(characterId, bankBalance) {
  const res = await fetch(`${API_BASE}/api/admin/finance/set-bank`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ character_id: characterId, bank_balance: bankBalance }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiAdminSetBank failed (${res.status})`);
  }
  return res.json();
}

export async function apiAdminSetSalaryOverride(characterId, override) {
  const res = await fetch(`${API_BASE}/api/admin/finance/set-salary-override`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ character_id: characterId, annual_salary_override: override }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiAdminSetSalaryOverride failed (${res.status})`);
  }
  return res.json();
}

export async function apiAdminSetPositions(characterId, positions) {
  const res = await fetch(`${API_BASE}/api/admin/finance/set-positions`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ character_id: characterId, positions }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiAdminSetPositions failed (${res.status})`);
  }
  return res.json();
}

export async function apiAdminCreateRevenue(characterId, label, annualAmount) {
  const res = await fetch(`${API_BASE}/api/admin/finance/revenue`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ character_id: characterId, label, annual_amount: annualAmount }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiAdminCreateRevenue failed (${res.status})`);
  }
  return res.json();
}

export async function apiAdminUpdateRevenue(id, updates) {
  const res = await fetch(`${API_BASE}/api/admin/finance/revenue/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiAdminUpdateRevenue failed (${res.status})`);
  }
  return res.json();
}

export async function apiAdminDeleteRevenue(id) {
  const res = await fetch(`${API_BASE}/api/admin/finance/revenue/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiAdminDeleteRevenue failed (${res.status})`);
  }
  return res.json();
}

export async function apiAdminUprateScale(name, effectiveFromSimIndex, pctUplift) {
  const res = await fetch(`${API_BASE}/api/admin/salary-scales/uprate`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ name, effective_from_sim_index: effectiveFromSimIndex, pct_uplift: pctUplift }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiAdminUprateScale failed (${res.status})`);
  }
  return res.json();
}

// ── Red Lion ─────────────────────────────────────────────────────────────────
export async function apiGetRedLionPosts() {
  const res = await fetch(`${API_BASE}/api/redlion`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetRedLionPosts failed (${res.status})`);
  return res.json();
}
export async function apiCreateRedLionPost(post) {
  const res = await fetch(`${API_BASE}/api/redlion`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(post),
  });
  if (!res.ok) throw new Error(`apiCreateRedLionPost failed (${res.status})`);
  return res.json();
}
export async function apiDeleteRedLionPost(id) {
  const res = await fetch(`${API_BASE}/api/redlion/${encodeURIComponent(id)}`, {
    method: "DELETE", credentials: "include", headers: csrfHeaders(),
  });
  if (!res.ok) throw new Error(`apiDeleteRedLionPost failed (${res.status})`);
  return res.json();
}

// ── Events ───────────────────────────────────────────────────────────────────
export async function apiGetEvents() {
  const res = await fetch(`${API_BASE}/api/events`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetEvents failed (${res.status})`);
  return res.json();
}
export async function apiCreateEvent(event) {
  const res = await fetch(`${API_BASE}/api/events`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(event),
  });
  if (!res.ok) throw new Error(`apiCreateEvent failed (${res.status})`);
  return res.json();
}
export async function apiUpdateEvent(id, event) {
  const res = await fetch(`${API_BASE}/api/events/${encodeURIComponent(id)}`, {
    method: "PUT", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(event),
  });
  if (!res.ok) throw new Error(`apiUpdateEvent failed (${res.status})`);
  return res.json();
}

// ── Online posts ─────────────────────────────────────────────────────────────
export async function apiGetOnlinePosts(type) {
  const url = type ? `${API_BASE}/api/online?type=${encodeURIComponent(type)}` : `${API_BASE}/api/online`;
  const res = await fetch(url, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetOnlinePosts failed (${res.status})`);
  return res.json();
}
export async function apiCreateOnlinePost(postType, post) {
  const res = await fetch(`${API_BASE}/api/online`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ post_type: postType, ...post }),
  });
  if (!res.ok) throw new Error(`apiCreateOnlinePost failed (${res.status})`);
  return res.json();
}

// ── Fundraising ───────────────────────────────────────────────────────────────
export async function apiGetFundraisingItems() {
  const res = await fetch(`${API_BASE}/api/fundraising`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetFundraisingItems failed (${res.status})`);
  return res.json();
}
export async function apiCreateFundraisingItem(item) {
  const res = await fetch(`${API_BASE}/api/fundraising`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new Error(`apiCreateFundraisingItem failed (${res.status})`);
  return res.json();
}
export async function apiUpdateFundraisingItem(id, item) {
  const res = await fetch(`${API_BASE}/api/fundraising/${encodeURIComponent(id)}`, {
    method: "PUT", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new Error(`apiUpdateFundraisingItem failed (${res.status})`);
  return res.json();
}
