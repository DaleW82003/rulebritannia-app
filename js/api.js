// js/api.js
function resolveApiBase() {
  if (typeof window !== "undefined" && window.RB_API_BASE) return window.RB_API_BASE;
  return "";
}
const API_BASE = resolveApiBase();

let _csrfToken = null;
export function setCsrfToken(token) { _csrfToken = token; }
function csrfHeaders() { return _csrfToken ? { "X-CSRF-Token": _csrfToken } : {}; }

/** Fetch (or lazily create) the CSRF token for the current session. */
export async function apiGetCsrfToken() {
  const res = await fetch(`${API_BASE}/api/csrf-token`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetCsrfToken failed (${res.status})`);
  const { csrfToken } = await res.json();
  if (csrfToken) setCsrfToken(csrfToken);
  return csrfToken;
}

/**
 * Internal fetch wrapper with one-shot CSRF-retry.
 * If a state-changing request (POST / PUT / DELETE / PATCH) is rejected with
 * "CSRF token missing or invalid" (403), the CSRF token is refreshed from the
 * server and the request is retried exactly once.  GET / HEAD / OPTIONS pass
 * straight through.  This handles the case where the client's cached token
 * drifts out of sync with the server session (e.g. after a session rotation or
 * a server restart that cleared in-memory state).
 */
const _MUTATION_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);
async function _fetch(url, init = {}) {
  const res = await fetch(url, init);
  if (res.status !== 403 || !_MUTATION_METHODS.has((init.method || "GET").toUpperCase())) return res;
  let body;
  try { body = await res.clone().json(); } catch { return res; }
  if (body?.error !== "CSRF token missing or invalid") return res;
  // Refresh the CSRF token best-effort; if the session is gone this will 401.
  await apiGetCsrfToken().catch(() => {});
  // Retry once with the freshly-fetched (or null-guarded) token.
  return fetch(url, { ...init, headers: { ...(init.headers ?? {}), ...csrfHeaders() } });
}

/**
 * Fetch the backend permission map.
 *
 * @param {string[]} [roles] - optional array of role strings to filter to
 *   only actions the caller is permitted to perform.
 * @returns {Promise<{ permissions: Record<string, string[]> }>}
 */
export async function apiGetPermissions(roles) {
  const qs = roles?.length ? `?roles=${encodeURIComponent(roles.join(","))}` : "";
  const res = await _fetch(`${API_BASE}/api/permissions${qs}`);
  if (!res.ok) throw new Error(`apiGetPermissions failed (${res.status})`);
  return res.json();
}

export async function apiLogin(email, password) {
  const res = await _fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`apiLogin failed (${res.status})`);
  return res.json();
}

export async function apiMe() {
  const res = await _fetch(`${API_BASE}/api/auth/me`, {
    credentials: "include",
  });
  if (res.status === 401 || res.status === 404) return { user: null };
  if (!res.ok) throw new Error(`apiMe failed (${res.status})`);
  return res.json();
}

export async function apiBootstrap() {
  const res = await _fetch(`${API_BASE}/api/bootstrap`, {
    credentials: "include",
  });
  // 401/403 means unauthenticated — treat as a successful logged-out response
  // rather than throwing, since the server may return these before sessions initialise.
  if (res.status === 401 || res.status === 403) {
    return { user: null, clock: null, config: {}, is_demo: true };
  }
  if (!res.ok) throw new Error(`apiBootstrap failed (${res.status})`);
  return res.json();
}

export async function apiLogout() {
  // Fetch the CSRF token required for state-changing POST requests.
  const tokenRes = await fetch(`${API_BASE}/api/csrf-token`, { credentials: "include" });
  if (!tokenRes.ok) throw new Error(`apiLogout failed: could not fetch CSRF token (${tokenRes.status})`);
  const { csrfToken } = await tokenRes.json();
  const res = await _fetch(`${API_BASE}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
    headers: { "X-CSRF-Token": csrfToken },
  });
  if (!res.ok) throw new Error(`apiLogout failed (${res.status})`);
  return res.json();
}

export async function apiGetState() {
  const res = await _fetch(`${API_BASE}/api/state`, {
    credentials: "include",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetState failed (${res.status})`);
  return res.json();
}

export async function apiSaveState(data) {
  const res = await _fetch(`${API_BASE}/api/state`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ data }),
  });
  if (!res.ok) throw new Error(`apiSaveState failed (${res.status})`);
  return res.json();
}

export async function apiGetSnapshots() {
  const res = await _fetch(`${API_BASE}/api/snapshots`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`apiGetSnapshots failed (${res.status})`);
  return res.json();
}

export async function apiSaveSnapshot(label, data) {
  const res = await _fetch(`${API_BASE}/api/snapshots`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ label, data }),
  });
  if (!res.ok) throw new Error(`apiSaveSnapshot failed (${res.status})`);
  return res.json();
}

export async function apiRestoreSnapshot(id) {
  const res = await _fetch(`${API_BASE}/api/snapshots/${encodeURIComponent(id)}/restore`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiRestoreSnapshot failed (${res.status})`);
  return res.json();
}

export async function apiGetConfig() {
  const res = await _fetch(`${API_BASE}/api/config`);
  if (!res.ok) throw new Error(`apiGetConfig failed (${res.status})`);
  return res.json();
}

export async function apiSaveConfig(config) {
  const res = await _fetch(`${API_BASE}/api/config`, {
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
    const res = await _fetch(`${API_BASE}/api/audit-log`, {
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
  const res = await _fetch(`${API_BASE}/api/audit-log?${params}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`apiGetAuditLog failed (${res.status})`);
  return res.json();
}

// ── BILLS ────────────────────────────────────────────────────────────────────

export async function apiGetBills() {
  const res = await _fetch(`${API_BASE}/api/bills`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetBills failed (${res.status})`);
  return res.json();
}

export async function apiGetBill(id) {
  const res = await _fetch(`${API_BASE}/api/bills/${encodeURIComponent(id)}`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetBill failed (${res.status})`);
  return res.json();
}

export async function apiCreateBill(bill) {
  const res = await _fetch(`${API_BASE}/api/bills`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(bill),
  });
  if (!res.ok) throw new Error(`apiCreateBill failed (${res.status})`);
  return res.json();
}

export async function apiUpdateBill(id, bill) {
  const res = await _fetch(`${API_BASE}/api/bills/${encodeURIComponent(id)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(bill),
  });
  if (!res.ok) throw new Error(`apiUpdateBill failed (${res.status})`);
  return res.json();
}

/**
 * Cast a division vote on a bill (server-authoritative weight computation).
 * @param {string} billId - The bill ID
 * @param {"aye"|"no"|"abstain"} vote - The vote choice
 */
export async function apiBillVote(billId, vote) {
  const res = await _fetch(`${API_BASE}/api/bills/${encodeURIComponent(billId)}/vote`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ vote }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `apiBillVote failed (${res.status})`);
  }
  return res.json();
}

export async function apiDeleteBill(id) {
  const res = await _fetch(`${API_BASE}/api/bills/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiDeleteBill failed (${res.status})`);
  return res.json();
}

/** Grant or refuse Second Reading for a bill (PM / Leader of House / admin / mod). */
export async function apiBillFirstReading(id, action) {
  const res = await _fetch(`${API_BASE}/api/bills/${encodeURIComponent(id)}/first-reading`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `apiBillFirstReading failed (${res.status})`); }
  return res.json();
}

/** Submit the mod/admin/speaker report for the Report Stage (advances to Report Debate). */
export async function apiBillSubmitReport(id, { content, attachmentUrl } = {}) {
  const res = await _fetch(`${API_BASE}/api/bills/${encodeURIComponent(id)}/report`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ content, attachmentUrl }),
  });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `apiBillSubmitReport failed (${res.status})`); }
  return res.json();
}

/** Withdraw a bill (author / PM / admin / mod). */
export async function apiBillWithdraw(id) {
  const res = await _fetch(`${API_BASE}/api/bills/${encodeURIComponent(id)}/withdraw`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({}),
  });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `apiBillWithdraw failed (${res.status})`); }
  return res.json();
}

/** Grant Royal Assent (admin / mod). */
export async function apiBillGrantAssent(id) {
  const res = await _fetch(`${API_BASE}/api/bills/${encodeURIComponent(id)}/assent`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({}),
  });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `apiBillGrantAssent failed (${res.status})`); }
  return res.json();
}

/** Open the Final Division for a bill (admin / mod / speaker). */
export async function apiBillOpenFinalDivision(id) {
  const res = await _fetch(`${API_BASE}/api/bills/${encodeURIComponent(id)}/final-division`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({}),
  });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `apiBillOpenFinalDivision failed (${res.status})`); }
  return res.json();
}

/** Fetch all amendments for a bill. */
export async function apiGetBillAmendments(id) {
  const res = await _fetch(`${API_BASE}/api/bills/${encodeURIComponent(id)}/amendments`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetBillAmendments failed (${res.status})`);
  return res.json();
}

/** Submit a new amendment to a bill. */
export async function apiSubmitBillAmendment(id, { articleNumber, type, title, text }) {
  const res = await _fetch(`${API_BASE}/api/bills/${encodeURIComponent(id)}/amendments`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ articleNumber, type, title, text }),
  });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `apiSubmitBillAmendment failed (${res.status})`); }
  return res.json();
}

/** Author accepts or refuses an amendment. */
export async function apiBillAmendmentDecide(billId, amendmentId, decision) {
  const res = await _fetch(`${API_BASE}/api/bills/${encodeURIComponent(billId)}/amendments/${encodeURIComponent(amendmentId)}/decide`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ decision }),
  });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `apiBillAmendmentDecide failed (${res.status})`); }
  return res.json();
}

/** Party leader declares support for an amendment. */
export async function apiBillAmendmentSupport(billId, amendmentId) {
  const res = await _fetch(`${API_BASE}/api/bills/${encodeURIComponent(billId)}/amendments/${encodeURIComponent(amendmentId)}/support`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({}),
  });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `apiBillAmendmentSupport failed (${res.status})`); }
  return res.json();
}

// ── MOTIONS ───────────────────────────────────────────────────────────────────

export async function apiGetMotions(type) {
  const params = type ? `?type=${encodeURIComponent(type)}` : "";
  const res = await _fetch(`${API_BASE}/api/motions${params}`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetMotions failed (${res.status})`);
  return res.json();
}

export async function apiGetMotion(id) {
  const res = await _fetch(`${API_BASE}/api/motions/${encodeURIComponent(id)}`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetMotion failed (${res.status})`);
  return res.json();
}

export async function apiCreateMotion(motionType, motion) {
  const res = await _fetch(`${API_BASE}/api/motions`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ motion_type: motionType, ...motion }),
  });
  if (!res.ok) throw new Error(`apiCreateMotion failed (${res.status})`);
  return res.json();
}

export async function apiUpdateMotion(id, motion) {
  const res = await _fetch(`${API_BASE}/api/motions/${encodeURIComponent(id)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(motion),
  });
  if (!res.ok) throw new Error(`apiUpdateMotion failed (${res.status})`);
  return res.json();
}

export async function apiDeleteMotion(id) {
  const res = await _fetch(`${API_BASE}/api/motions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiDeleteMotion failed (${res.status})`);
  return res.json();
}


export async function apiSignEdm(id) {
  const res = await _fetch(`${API_BASE}/api/motions/${encodeURIComponent(id)}/sign`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiSignEdm failed (${res.status})`);
  }
  return res.json();
}

// ── STATEMENTS ────────────────────────────────────────────────────────────────

export async function apiGetStatements() {
  const res = await _fetch(`${API_BASE}/api/statements`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetStatements failed (${res.status})`);
  return res.json();
}

export async function apiGetStatement(id) {
  const res = await _fetch(`${API_BASE}/api/statements/${encodeURIComponent(id)}`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetStatement failed (${res.status})`);
  return res.json();
}

export async function apiCreateStatement(stmt) {
  const res = await _fetch(`${API_BASE}/api/statements`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(stmt),
  });
  if (!res.ok) throw new Error(`apiCreateStatement failed (${res.status})`);
  return res.json();
}

export async function apiUpdateStatement(id, stmt) {
  const res = await _fetch(`${API_BASE}/api/statements/${encodeURIComponent(id)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(stmt),
  });
  if (!res.ok) throw new Error(`apiUpdateStatement failed (${res.status})`);
  return res.json();
}

export async function apiDeleteStatement(id) {
  const res = await _fetch(`${API_BASE}/api/statements/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiDeleteStatement failed (${res.status})`);
  return res.json();
}

// ── REGULATIONS ───────────────────────────────────────────────────────────────

export async function apiGetRegulations() {
  const res = await _fetch(`${API_BASE}/api/regulations`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetRegulations failed (${res.status})`);
  return res.json();
}

export async function apiGetRegulation(id) {
  const res = await _fetch(`${API_BASE}/api/regulations/${encodeURIComponent(id)}`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetRegulation failed (${res.status})`);
  return res.json();
}

export async function apiCreateRegulation(reg) {
  const res = await _fetch(`${API_BASE}/api/regulations`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(reg),
  });
  if (!res.ok) throw new Error(`apiCreateRegulation failed (${res.status})`);
  return res.json();
}

export async function apiUpdateRegulation(id, reg) {
  const res = await _fetch(`${API_BASE}/api/regulations/${encodeURIComponent(id)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(reg),
  });
  if (!res.ok) throw new Error(`apiUpdateRegulation failed (${res.status})`);
  return res.json();
}

export async function apiDeleteRegulation(id) {
  const res = await _fetch(`${API_BASE}/api/regulations/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiDeleteRegulation failed (${res.status})`);
  return res.json();
}

// ── CLOCK ─────────────────────────────────────────────────────────────────────

export async function apiGetClock() {
  const res = await _fetch(`${API_BASE}/api/clock`);
  if (!res.ok) throw new Error(`apiGetClock failed (${res.status})`);
  return res.json();
}

export async function apiClockTick() {
  const res = await _fetch(`${API_BASE}/api/clock/tick`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiClockTick failed (${res.status})`);
  return res.json();
}

export async function apiClockSet({ sim_current_month, sim_current_year, rate } = {}) {
  const res = await _fetch(`${API_BASE}/api/clock/set`, {
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
  const res = await _fetch(`${API_BASE}/api/discourse/config`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`apiGetDiscourseConfig failed (${res.status})`);
  return res.json();
}

export async function apiSaveDiscourseConfig({ base_url, api_key, api_username, sso_secret }) {
  const res = await _fetch(`${API_BASE}/api/discourse/config`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ base_url, api_key, api_username, sso_secret }),
  });
  if (!res.ok) throw new Error(`apiSaveDiscourseConfig failed (${res.status})`);
  return res.json();
}

export async function apiGetDiscourseCategoryIds() {
  const res = await _fetch(`${API_BASE}/api/admin/discourse-category-ids`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`apiGetDiscourseCategoryIds failed (${res.status})`);
  return res.json();
}

export async function apiSaveDiscourseCategoryIds({ bills, motions, statements, regulations }) {
  const res = await _fetch(`${API_BASE}/api/admin/discourse-category-ids`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ bills, motions, statements, regulations }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiSaveDiscourseCategoryIds failed (${res.status})`);
  }
  return res.json();
}

export async function apiTestDiscourse() {
  const res = await _fetch(`${API_BASE}/api/discourse/test`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  // Return body regardless of HTTP status so caller can read the error message
  return res.json();
}

export async function apiCreateDebateTopic({ entityType, entityId, title, raw, categoryId, tags } = {}) {
  const res = await _fetch(`${API_BASE}/api/debates/create`, {
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
  const res = await _fetch(`${API_BASE}/api/me/roles`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`apiGetMyRoles failed (${res.status})`);
  return res.json();
}

export async function apiSetUserRoles(userId, roles) {
  const res = await _fetch(`${API_BASE}/api/users/${encodeURIComponent(userId)}/roles`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ roles }),
  });
  if (!res.ok) throw new Error(`apiSetUserRoles failed (${res.status})`);
  return res.json();
}

export async function apiGetDiscourseSyncPreview() {
  const res = await _fetch(`${API_BASE}/api/admin/discourse-sync-preview`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`apiGetDiscourseSyncPreview failed (${res.status})`);
  return res.json();
}

export async function apiGetSsoReadiness() {
  const res = await _fetch(`${API_BASE}/api/admin/sso-readiness`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`apiGetSsoReadiness failed (${res.status})`);
  return res.json();
}

export async function apiAdminSyncDiscourseGroups() {
  const res = await _fetch(`${API_BASE}/api/admin/discourse-sync-groups`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiAdminSyncDiscourseGroups failed (${res.status})`);
  return res.json();
}

export async function apiAdminSyncDiscourseGroupsStatus(jobId) {
  const url = jobId
    ? `${API_BASE}/api/admin/discourse-sync-groups/status?jobId=${encodeURIComponent(jobId)}`
    : `${API_BASE}/api/admin/discourse-sync-groups/status`;
  const res = await _fetch(url, { credentials: "include" });
  if (!res.ok) {
    const err = new Error(`apiAdminSyncDiscourseGroupsStatus failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ── ADMIN MAINTENANCE ─────────────────────────────────────────────────────────

function maintPost(path) {
  return async function () {
    const res = await _fetch(`${API_BASE}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { ...csrfHeaders() },
    });
    if (!res.ok) throw new Error(`${path} failed (${res.status})`);
    return res.json();
  };
}

export const apiAdminClearCache          = maintPost("/api/admin/clear-cache");
export const apiAdminRebuildCache        = maintPost("/api/admin/rebuild-cache");
export const apiAdminRotateSessions      = maintPost("/api/admin/rotate-sessions");
export const apiAdminForceLogoutAll      = maintPost("/api/admin/force-logout-all");
export const apiAdminCloseStaleDiv       = maintPost("/api/admin/close-stale-divisions");
export const apiAdminCloseOrphanMotionDivisions = maintPost("/api/admin/close-orphan-motion-divisions");

export async function apiAdminExportSnapshot() {
  const res = await _fetch(`${API_BASE}/api/admin/export-snapshot`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`export-snapshot failed (${res.status})`);
  // Returns the raw Response so the caller can read blob + filename header
  return res;
}

export async function apiAdminImportSnapshot(label, data) {
  const res = await _fetch(`${API_BASE}/api/admin/import-snapshot`, {
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
  const res = await _fetch(`${API_BASE}/api/characters${qs ? "?" + qs : ""}`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetCharacters failed (${res.status})`);
  return res.json();
}

export async function apiGetCharacter(id) {
  const res = await _fetch(`${API_BASE}/api/characters/${encodeURIComponent(id)}`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetCharacter failed (${res.status})`);
  return res.json();
}

export async function apiCreateCharacter(character) {
  const res = await _fetch(`${API_BASE}/api/characters`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(character),
  });
  if (!res.ok) throw new Error(`apiCreateCharacter failed (${res.status})`);
  return res.json();
}

export async function apiPatchCharacter(id, updates) {
  const res = await _fetch(`${API_BASE}/api/characters/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`apiPatchCharacter failed (${res.status})`);
  return res.json();
}

export async function apiGetMyCharacters() {
  const res = await _fetch(`${API_BASE}/api/characters/mine`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetMyCharacters failed (${res.status})`);
  return res.json();
}

export async function apiSelectCharacter(character_id) {
  const res = await _fetch(`${API_BASE}/api/characters/select`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ character_id }),
  });
  if (!res.ok) throw new Error(`apiSelectCharacter failed (${res.status})`);
  return res.json();
}

export async function apiApplyCharacter(fields) {
  const res = await _fetch(`${API_BASE}/api/characters/apply`, {
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

export async function apiApplyNpcCharacter(fields) {
  const res = await _fetch(`${API_BASE}/api/characters/apply-npc`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiApplyNpcCharacter failed (${res.status})`);
  }
  return res.json();
}

export async function apiGetMyApplications() {
  const res = await _fetch(`${API_BASE}/api/characters/applications/mine`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetMyApplications failed (${res.status})`);
  return res.json();
}

export async function apiGetCharacterApplications(status) {
  const url = status
    ? `${API_BASE}/api/admin/characters/applications?status=${encodeURIComponent(status)}`
    : `${API_BASE}/api/admin/characters/applications`;
  const res = await _fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetCharacterApplications failed (${res.status})`);
  return res.json();
}

export async function apiApproveCharacterApplication(id) {
  const res = await _fetch(`${API_BASE}/api/admin/characters/applications/${encodeURIComponent(id)}/approve`, {
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
  const res = await _fetch(`${API_BASE}/api/admin/characters/applications/${encodeURIComponent(id)}/reject`, {
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
  const res = await _fetch(`${API_BASE}/api/admin/characters/${encodeURIComponent(id)}/set-inactive`, {
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
  const res = await _fetch(`${API_BASE}/api/admin/repair/character-owner-pointers`, {
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
  const res = await _fetch(`${API_BASE}/api/characters/bio-change`, {
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
  const res = await _fetch(`${API_BASE}/api/characters/bio-changes/mine`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetMyBioChanges failed (${res.status})`);
  return res.json();
}

export async function apiGetAllBioChanges(status) {
  const url = status
    ? `${API_BASE}/api/admin/bio-changes?status=${encodeURIComponent(status)}`
    : `${API_BASE}/api/admin/bio-changes`;
  const res = await _fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetAllBioChanges failed (${res.status})`);
  return res.json();
}

export async function apiApproveBioChange(id) {
  const res = await _fetch(`${API_BASE}/api/admin/bio-changes/${encodeURIComponent(id)}/approve`, {
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
  const res = await _fetch(`${API_BASE}/api/admin/bio-changes/${encodeURIComponent(id)}/reject`, {
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

export async function apiSubmitAvatarChange(proposed_avatar, proposed_avatar_attribution) {
  const res = await _fetch(`${API_BASE}/api/characters/avatar-change`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ proposed_avatar, proposed_avatar_attribution }),
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
  const res = await _fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetAllAvatarChanges failed (${res.status})`);
  return res.json();
}

export async function apiApproveAvatarChange(id) {
  const res = await _fetch(`${API_BASE}/api/admin/avatar-changes/${encodeURIComponent(id)}/approve`, {
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
  const res = await _fetch(`${API_BASE}/api/admin/avatar-changes/${encodeURIComponent(id)}/reject`, {
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
  const res = await _fetch(`${API_BASE}/api/mod/property/set`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ character_id, home, rentals }),
  });
  if (!res.ok) throw new Error(`apiSetProperty failed (${res.status})`);
  return res.json();
}

export async function apiGetParty(partyId) {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetParty failed (${res.status})`);
  return res.json();
}

export async function apiSetPartyLeadership(partyId, role, character_id) {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}/leadership`, {
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

export async function apiSetPartyLeader(partyId, character_id) {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}/set-leader`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ character_id }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiSetPartyLeader failed (${res.status})`);
  }
  return res.json();
}

// ── Shop price index ────────────────────────────────────────────────────────

export async function apiGetShopPriceIndex() {
  const res = await _fetch(`${API_BASE}/api/shop/price-index`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetShopPriceIndex failed (${res.status})`);
  return res.json();
}

export async function apiApplyShopInflation(inflationPct) {
  const requestBody = inflationPct != null ? JSON.stringify({ inflationPct: Number(inflationPct) }) : undefined;
  const res = await _fetch(`${API_BASE}/api/shop/apply-inflation`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: requestBody,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiApplyShopInflation failed (${res.status})`);
  return body;
}

export async function apiUpdateCharacterShopUpkeep(upkeep) {
  const res = await _fetch(`${API_BASE}/api/finance/shop-upkeep`, {
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
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}/structure`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetPartyStructure failed (${res.status})`);
  return res.json();
}

export async function apiSavePartyStructure(partyId, structure) {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}/structure`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ structure }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiSavePartyStructure failed (${res.status})`);
  return body;
}

export async function apiSetPartyTreasury(partyId, fields) {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}/treasury`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(fields),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiSetPartyTreasury failed (${res.status})`);
  return body;
}

export async function apiSetPartyMembershipFee(partyId, fee) {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}/membership-fee`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ fee }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiSetPartyMembershipFee failed (${res.status})`);
  return body;
}

export async function apiGetPartyLedger(partyId, limit = 100) {
  const res = await _fetch(
    `${API_BASE}/api/parties/${encodeURIComponent(partyId)}/donations?limit=${limit}`,
    { credentials: "include" }
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiGetPartyLedger failed (${res.status})`);
  return body;
}

export async function apiAddPartyDonation(partyId, { fromName, amount, note = "" }) {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}/donations`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ fromName, amount, note }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiAddPartyDonation failed (${res.status})`);
  return body;
}

export async function apiGetPartyShopPurchases(partyId) {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}/shop-purchases`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetPartyShopPurchases failed (${res.status})`);
  return res.json();
}

export async function apiAddPartyShopPurchase(partyId, purchase) {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}/shop-purchases`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(purchase),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiAddPartyShopPurchase failed (${res.status})`);
  return body;
}

export async function apiRemovePartyShopPurchase(partyId, id) {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}/shop-purchases/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiRemovePartyShopPurchase failed (${res.status})`);
  return body;
}

export async function apiSellPartyShopPurchase(partyId, id) {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}/shop-purchases/${encodeURIComponent(id)}/sell`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiSellPartyShopPurchase failed (${res.status})`);
  return body;
}

export async function apiDismissPartyShopPurchase(partyId, id) {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}/shop-purchases/${encodeURIComponent(id)}/dismiss`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiDismissPartyShopPurchase failed (${res.status})`);
  return body;
}

export async function apiSavePartyDrafts(partyId, drafts) {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}/drafts`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ drafts }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiSavePartyDrafts failed (${res.status})`);
  return body;
}

export async function apiGetCabinetDrafts() {
  const res = await _fetch(`${API_BASE}/api/cabinet/drafts`, { credentials: "include" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiGetCabinetDrafts failed (${res.status})`);
  return body;
}

export async function apiSaveCabinetDrafts(drafts) {
  const res = await _fetch(`${API_BASE}/api/cabinet/drafts`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ drafts }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiSaveCabinetDrafts failed (${res.status})`);
  return body;
}

export async function apiGetShadowCabinetDrafts() {
  const res = await _fetch(`${API_BASE}/api/shadowcabinet/drafts`, { credentials: "include" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiGetShadowCabinetDrafts failed (${res.status})`);
  return body;
}

export async function apiSaveShadowCabinetDrafts(drafts) {
  const res = await _fetch(`${API_BASE}/api/shadowcabinet/drafts`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ drafts }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiSaveShadowCabinetDrafts failed (${res.status})`);
  return body;
}

// ── Offices ────────────────────────────────────────────────────────────────

export async function apiGetOffices() {
  const res = await _fetch(`${API_BASE}/api/offices`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetOffices failed (${res.status})`);
  return res.json();
}

export async function apiCreateOffice(office) {
  const res = await _fetch(`${API_BASE}/api/offices`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(office),
  });
  if (!res.ok) throw new Error(`apiCreateOffice failed (${res.status})`);
  return res.json();
}

export async function apiAssignOffice(officeId, character_id) {
  const res = await _fetch(`${API_BASE}/api/offices/${encodeURIComponent(officeId)}/assign`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ character_id }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiAssignOffice failed (${res.status})`);
  }
  return res.json();
}

export async function apiUnassignOffice(officeId, characterId) {
  const res = await _fetch(
    `${API_BASE}/api/offices/${encodeURIComponent(officeId)}/assign/${encodeURIComponent(characterId)}`,
    { method: "DELETE", credentials: "include", headers: { ...csrfHeaders() } }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiUnassignOffice failed (${res.status})`);
  }
  return res.json();
}

export async function apiGetCharacterOfficesHeld(characterId) {
  const res = await _fetch(
    `${API_BASE}/api/characters/${encodeURIComponent(characterId)}/offices-held`,
    { credentials: "include" }
  );
  if (!res.ok) throw new Error(`apiGetCharacterOfficesHeld failed (${res.status})`);
  return res.json();
}

export async function apiFireOffice(officeId) {
  const res = await _fetch(`${API_BASE}/api/offices/${encodeURIComponent(officeId)}/fire`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiFireOffice failed (${res.status})`);
  }
  return res.json();
}

export async function apiResignOffice(officeId) {
  const res = await _fetch(`${API_BASE}/api/offices/${encodeURIComponent(officeId)}/resign`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiResignOffice failed (${res.status})`);
  }
  return res.json();
}

export async function apiResetGovernment(newPmCharId) {
  const res = await _fetch(`${API_BASE}/api/government/reset`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ newPmCharId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiResetGovernment failed (${res.status})`);
  }
  return res.json();
}

export async function apiResetOpposition(newLotoCharId) {
  const res = await _fetch(`${API_BASE}/api/opposition/reset`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ newLotoCharId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiResetOpposition failed (${res.status})`);
  }
  return res.json();
}

export async function apiGetReshuffleStatus(type) {
  const res = await _fetch(`${API_BASE}/api/${encodeURIComponent(type)}/reshuffle`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetReshuffleStatus failed (${res.status})`);
  return res.json();
}

export async function apiGetGovernmentEvents() {
  const res = await _fetch(`${API_BASE}/api/government/events`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetGovernmentEvents failed (${res.status})`);
  return res.json();
}

export async function apiDeclareReshuffle(type) {
  const res = await _fetch(`${API_BASE}/api/${encodeURIComponent(type)}/reshuffle`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiDeclareReshuffle failed (${res.status})`);
  }
  return res.json();
}

export async function apiEndReshuffle(type) {
  const res = await _fetch(`${API_BASE}/api/${encodeURIComponent(type)}/reshuffle/end`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiEndReshuffle failed (${res.status})`);
  }
  return res.json();
}

// ── Divisions ──────────────────────────────────────────────────────────────

export async function apiGetDivisions(params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)).toString();
  const res = await _fetch(`${API_BASE}/api/divisions${qs ? "?" + qs : ""}`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetDivisions failed (${res.status})`);
  return res.json();
}

export async function apiGetDivision(id) {
  const res = await _fetch(`${API_BASE}/api/divisions/${encodeURIComponent(id)}`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetDivision failed (${res.status})`);
  return res.json();
}

export async function apiCreateDivision(entityType, entityId, title = "", closesAtSim = null) {
  const res = await _fetch(`${API_BASE}/api/divisions/create`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ entity_type: entityType, entity_id: entityId, title, closes_at_sim: closesAtSim }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `apiCreateDivision failed (${res.status})`);
    err.status = res.status;
    if (body.divisionId) err.divisionId = body.divisionId;
    throw err;
  }
  return res.json();
}

export async function apiVoteDivision(id, character_id, vote, weight) {
  const res = await _fetch(`${API_BASE}/api/divisions/${encodeURIComponent(id)}/vote`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ character_id, vote }),
  });
  if (!res.ok) throw new Error(`apiVoteDivision failed (${res.status})`);
  return res.json();
}

export async function apiCloseDivision(id) {
  const res = await _fetch(`${API_BASE}/api/divisions/${encodeURIComponent(id)}/close`, {
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
  const res = await _fetch(`${API_BASE}/api/divisions/${encodeURIComponent(divisionId)}/vote`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ vote }),
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
  const res = await _fetch(`${API_BASE}/api/qt/questions${qs ? "?" + qs : ""}`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetQtQuestions failed (${res.status})`);
  return res.json();
}

export async function apiGetQtQuestion(id) {
  const res = await _fetch(`${API_BASE}/api/qt/questions/${encodeURIComponent(id)}`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetQtQuestion failed (${res.status})`);
  return res.json();
}

export async function apiSubmitQtQuestion(payload) {
  const res = await _fetch(`${API_BASE}/api/qt/questions`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiSubmitQtQuestion failed (${res.status})`);
  return body;
}

export async function apiPatchQtQuestion(id, updates) {
  const res = await _fetch(`${API_BASE}/api/qt/questions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(updates),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiPatchQtQuestion failed (${res.status})`);
  return body;
}

export async function apiAnswerQtQuestion(id, payload) {
  const res = await _fetch(`${API_BASE}/api/qt/questions/${encodeURIComponent(id)}/answer`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiAnswerQtQuestion failed (${res.status})`);
  return body;
}

export async function apiFollowupQtQuestion(id, payload) {
  const res = await _fetch(`${API_BASE}/api/qt/questions/${encodeURIComponent(id)}/followup`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiFollowupQtQuestion failed (${res.status})`);
  return body;
}

export async function apiAnswerQtFollowup(id, payload) {
  const res = await _fetch(`${API_BASE}/api/qt/followups/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiAnswerQtFollowup failed (${res.status})`);
  return body;
}

export async function apiDeleteQtQuestion(id) {
  const res = await _fetch(`${API_BASE}/api/qt/questions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
    headers: csrfHeaders(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiDeleteQtQuestion failed (${res.status})`);
  return body;
}

// ── Question Time (legacy CRUD endpoint) ────────────────────────────────────

export async function apiGetQtLegacyQuestions() {
  // Dashboard live docket should use the canonical structured QT endpoint so
  // deleted/closed questions are removed immediately and stale legacy sessions
  // do not persist in alerts.
  const res = await _fetch(`${API_BASE}/api/qt/questions`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetQtLegacyQuestions failed (${res.status})`);
  const body = await res.json();

  const questions = Array.isArray(body?.questions)
    ? body.questions.map((q) => ({
        id: q.id,
        office: q.office_id,
        askedBy: q.asked_by_display_name || q.asked_by_name || "",
        text: q.question_text || "",
        answer: q.answer_text || "",
        archived: q.status === "archived",
        _status: q.status,
        followUps: Array.isArray(q.followups)
          ? q.followups.map((f) => ({
              id: f.id,
              askedBy: f.asked_by_display_name || f.asked_by_name || "",
              text: f.followup_text || "",
              answer: f.answer_text || "",
            }))
          : [],
      }))
    : [];

  return { questions };
}

export async function apiCreateQtLegacyQuestion(question) {
  const res = await _fetch(`${API_BASE}/api/questiontime-questions`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(question),
  });
  if (!res.ok) throw new Error(`apiCreateQtLegacyQuestion failed (${res.status})`);
  return res.json();
}

export async function apiUpdateQtLegacyQuestion(id, question) {
  const res = await _fetch(`${API_BASE}/api/questiontime-questions/${encodeURIComponent(id)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(question),
  });
  if (!res.ok) throw new Error(`apiUpdateQtLegacyQuestion failed (${res.status})`);
  return res.json();
}

export async function apiDeleteQtLegacyQuestion(id) {
  const res = await _fetch(`${API_BASE}/api/questiontime-questions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
    headers: csrfHeaders(),
  });
  if (!res.ok) throw new Error(`apiDeleteQtLegacyQuestion failed (${res.status})`);
  return res.json();
}

// ── Simulation State ───────────────────────────────────────────────────────

export async function apiGetSim() {
  const res = await _fetch(`${API_BASE}/api/sim`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetSim failed (${res.status})`);
  return res.json();
}

export async function apiSimTick() {
  const res = await _fetch(`${API_BASE}/api/sim/tick`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiSimTick failed (${res.status})`);
  return res.json();
}

export async function apiSimSet(payload) {
  const res = await _fetch(`${API_BASE}/api/sim/set`, {
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
  const res = await _fetch(`${API_BASE}/api/admin/dashboard`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetAdminDashboard failed (${res.status})`);
  return res.json();
}

export async function apiAdminDiscourseSyncBills() {
  const res = await _fetch(`${API_BASE}/api/admin/discourse-sync-bills`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiAdminDiscourseSyncBills failed (${res.status})`);
  return res.json();
}

export async function apiAdminDiscourseSyncDebates(kind) {
  const res = await _fetch(`${API_BASE}/api/admin/discourse-sync-debates`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ kind }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiAdminDiscourseSyncDebates failed (${res.status})`);
  }
  return res.json();
}

export async function apiPatchBill(id, updates) {
  const res = await _fetch(`${API_BASE}/api/bills/${encodeURIComponent(id)}`, {
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
  const res = await _fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetPressItems failed (${res.status})`);
  return res.json();
}

export async function apiCreatePressItem(payload) {
  const res = await _fetch(`${API_BASE}/api/press`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`apiCreatePressItem failed (${res.status})`);
  return res.json();
}

export async function apiUpdatePressItem(id, payload) {
  const res = await _fetch(`${API_BASE}/api/press/${encodeURIComponent(id)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`apiUpdatePressItem failed (${res.status})`);
  return res.json();
}

export async function apiDeletePressItem(id) {
  const res = await _fetch(`${API_BASE}/api/press/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
    headers: csrfHeaders(),
  });
  if (!res.ok) throw new Error(`apiDeletePressItem failed (${res.status})`);
  return res.json();
}

export async function apiAddPressTranscriptEntry(id, entry) {
  const res = await _fetch(`${API_BASE}/api/press/${encodeURIComponent(id)}/transcript`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ entry }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiAddPressTranscriptEntry failed (${res.status})`);
  return body;
}

export async function apiMarkPressItem(id, payload) {
  const res = await _fetch(`${API_BASE}/api/press/${encodeURIComponent(id)}/mark`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiMarkPressItem failed (${res.status})`);
  return body;
}

// ── Polling entries ────────────────────────────────────────────────────────

export async function apiGetPollingEntries() {
  const res = await _fetch(`${API_BASE}/api/polling`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetPollingEntries failed (${res.status})`);
  return res.json();
}

export async function apiCreatePollingEntry(payload) {
  const res = await _fetch(`${API_BASE}/api/polling`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`apiCreatePollingEntry failed (${res.status})`);
  return res.json();
}

export async function apiDeletePollingEntry(id) {
  const res = await _fetch(`${API_BASE}/api/polling/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
    headers: csrfHeaders(),
  });
  if (!res.ok) throw new Error(`apiDeletePollingEntry failed (${res.status})`);
  return res.json();
}

// ── Admin seed-demo ────────────────────────────────────────────────────────

export async function apiSeedDemo() {
  const res = await _fetch(`${API_BASE}/api/admin/seed-demo`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiSeedDemo failed (${res.status})`);
  return res.json();
}

// ── Admin wipe-content ─────────────────────────────────────────────────────

export async function apiWipeContent() {
  const res = await _fetch(`${API_BASE}/api/admin/wipe-content`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ confirm: "WIPE CONTENT" }),
  });
  if (!res.ok) throw new Error(`apiWipeContent failed (${res.status})`);
  return res.json();
}

export async function apiWipeWithCharacters() {
  const res = await _fetch(`${API_BASE}/api/admin/wipe-with-characters`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ confirm: "WIPE WITH CHARACTERS" }),
  });
  if (!res.ok) throw new Error(`apiWipeWithCharacters failed (${res.status})`);
  return res.json();
}


// ── Pending Registrations (admin) ─────────────────────────────────────────

export async function apiGetPendingRegistrations(status = "pending") {
  const res = await _fetch(`${API_BASE}/api/admin/registrations?status=${encodeURIComponent(status)}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`apiGetPendingRegistrations failed (${res.status})`);
  return res.json();
}

export async function apiApproveRegistration(id) {
  const res = await _fetch(`${API_BASE}/api/admin/registrations/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiApproveRegistration failed (${res.status})`);
  return res.json();
}

export async function apiRejectRegistration(id) {
  const res = await _fetch(`${API_BASE}/api/admin/registrations/${encodeURIComponent(id)}/reject`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiRejectRegistration failed (${res.status})`);
  return res.json();
}

// ── Scandal system ─────────────────────────────────────────────────────────

export async function apiScandalsMine() {
  const res = await _fetch(`${API_BASE}/api/scandals/mine`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiScandalsMine failed (${res.status})`);
  return res.json();
}

export async function apiScandalsOptIn(opted_in) {
  const res = await _fetch(`${API_BASE}/api/scandals/optin`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ opted_in }),
  });
  if (!res.ok) throw new Error(`apiScandalsOptIn failed (${res.status})`);
  return res.json();
}

export async function apiScandalSituationRespond(situationId, action) {
  const res = await _fetch(`${API_BASE}/api/scandals/situations/${encodeURIComponent(situationId)}/respond`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) throw new Error(`apiScandalSituationRespond failed (${res.status})`);
  return res.json();
}

export async function apiScandalChoose(scandalId, choice_id) {
  const res = await _fetch(`${API_BASE}/api/scandals/${encodeURIComponent(scandalId)}/choose`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ choice_id }),
  });
  if (!res.ok) throw new Error(`apiScandalChoose failed (${res.status})`);
  return res.json();
}

export async function apiModScandalSituationCreate(payload) {
  const res = await _fetch(`${API_BASE}/api/mod/scandals/situations/create`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`apiModScandalSituationCreate failed (${res.status})`);
  return res.json();
}

export async function apiModScandalsOpen() {
  const res = await _fetch(`${API_BASE}/api/mod/scandals/open`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiModScandalsOpen failed (${res.status})`);
  return res.json();
}

export async function apiModScandalDecision(scandalId, payload) {
  const res = await _fetch(`${API_BASE}/api/mod/scandals/${encodeURIComponent(scandalId)}/decision`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`apiModScandalDecision failed (${res.status})`);
  return res.json();
}

export async function apiModScandalClose(scandalId) {
  const res = await _fetch(`${API_BASE}/api/mod/scandals/${encodeURIComponent(scandalId)}/close`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiModScandalClose failed (${res.status})`);
  return res.json();
}

export async function apiModScandalDelete(scandalId) {
  const res = await _fetch(`${API_BASE}/api/mod/scandals/${encodeURIComponent(scandalId)}`, {
    method: "DELETE",
    credentials: "include",
    headers: csrfHeaders(),
  });
  if (!res.ok) throw new Error(`apiModScandalDelete failed (${res.status})`);
  return res.json();
}

export async function apiModSituationClose(situationId) {
  const res = await _fetch(`${API_BASE}/api/mod/scandals/situations/${encodeURIComponent(situationId)}/close`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
  });
  if (!res.ok) throw new Error(`apiModSituationClose failed (${res.status})`);
  return res.json();
}

export async function apiModSituationDelete(situationId) {
  const res = await _fetch(`${API_BASE}/api/mod/scandals/situations/${encodeURIComponent(situationId)}`, {
    method: "DELETE",
    credentials: "include",
    headers: csrfHeaders(),
  });
  if (!res.ok) throw new Error(`apiModSituationDelete failed (${res.status})`);
  return res.json();
}

export async function apiModScandalTemplates() {
  const res = await _fetch(`${API_BASE}/api/mod/scandal-templates`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiModScandalTemplates failed (${res.status})`);
  return res.json();
}

export async function apiModScandalOptedInCharacters() {
  const res = await _fetch(`${API_BASE}/api/mod/scandals/opted-in-characters`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiModScandalOptedInCharacters failed (${res.status})`);
  return res.json();
}

export async function apiModScandalTemplateUpsert(payload) {
  const res = await _fetch(`${API_BASE}/api/mod/scandal-templates`, {
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
  const res = await _fetch(
    `${API_BASE}/api/divisions/for-entity/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`,
    { credentials: "include" }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetDivisionForEntity failed (${res.status})`);
  return res.json();
}

export async function apiSetNpcVotes(divisionId, npcVotes, rebelsByParty = {}, rebelsByPartyChoice = {}) {
  const res = await _fetch(`${API_BASE}/api/divisions/${encodeURIComponent(divisionId)}/npc-votes`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ npc_votes: npcVotes, rebels_by_party: rebelsByParty, rebels_by_party_choice: rebelsByPartyChoice }),
  });
  if (!res.ok) throw new Error(`apiSetNpcVotes failed (${res.status})`);
  return res.json();
}

// ── Whip system ───────────────────────────────────────────────────────────

export async function apiSetChiefWhip(partyId, chiefWhipId, deputyWhipId = null) {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}/chief-whip`, {
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
  const res = await _fetch(
    `${API_BASE}/api/divisions/${encodeURIComponent(divisionId)}/party-instruction/${encodeURIComponent(partySlug)}`,
    { credentials: "include" }
  );
  if (!res.ok) throw new Error(`apiGetPartyInstruction failed (${res.status})`);
  return res.json();
}

export async function apiSetPartyInstruction(divisionId, body) {
  const res = await _fetch(
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
  const res = await _fetch(
    `${API_BASE}/api/divisions/${encodeURIComponent(divisionId)}/rebel-request`,
    { credentials: "include" }
  );
  if (!res.ok) throw new Error(`apiGetRebelRequest failed (${res.status})`);
  return res.json();
}

export async function apiSubmitRebelRequest(divisionId, requestedVote, message = "") {
  const res = await _fetch(
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
  const res = await _fetch(
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
  const res = await _fetch(`${API_BASE}/api/constituencies`, { credentials: "include" });
  return res.json();
}

export async function apiSaveConstituency(c) {
  const res = await _fetch(`${API_BASE}/api/constituencies`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(c),
  });
  return res.json();
}

export async function apiUpdateConstituency(id, updates) {
  const res = await _fetch(`${API_BASE}/api/constituencies/${encodeURIComponent(id)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(updates),
  });
  return res.json();
}

export async function apiDeleteConstituency(id) {
  const res = await _fetch(`${API_BASE}/api/constituencies/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  return res.json();
}

export async function apiInitialize1997Constituencies(confirmOverwrite) {
  const res = await _fetch(`${API_BASE}/api/admin/constituencies/initialize-1997`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ confirm: confirmOverwrite }),
  });
  return res.json();
}

export async function apiClearConstituencies() {
  const res = await _fetch(`${API_BASE}/api/admin/constituencies/clear`, {
    method: "DELETE",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  return res.json();
}

// ── Elections (DB-backed) ─────────────────────────────────────────────────────

export async function apiGetParliamentStatus() {
  const res = await _fetch(`${API_BASE}/api/parliament/status`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetParliamentStatus failed (${res.status})`);
  return res.json();
}

export async function apiUpdateParliamentStatus(payload) {
  const res = await _fetch(`${API_BASE}/api/parliament/status`, {
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
  const res = await _fetch(`${API_BASE}/api/parties/canonical`, { credentials: "include" });
  return res.json();
}

export async function apiGetElectionSeatTotals() {
  const res = await _fetch(`${API_BASE}/api/elections/seat-totals`, { credentials: "include" });
  return res.json();
}

export async function apiGetCurrentElection() {
  const res = await _fetch(`${API_BASE}/api/elections/current`, { credentials: "include" });
  return res.json();
}

export async function apiGetElections() {
  const res = await _fetch(`${API_BASE}/api/elections`, { credentials: "include" });
  return res.json();
}

export async function apiCreateElection(payload) {
  const res = await _fetch(`${API_BASE}/api/elections`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function apiUpdateElection(id, payload) {
  const res = await _fetch(`${API_BASE}/api/elections/${encodeURIComponent(id)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function apiGetElectionChanges(id) {
  const res = await _fetch(`${API_BASE}/api/elections/${encodeURIComponent(id)}/changes`, { credentials: "include" });
  return res.json();
}

export async function apiSaveElectionChanges(id, payload) {
  const res = await _fetch(`${API_BASE}/api/elections/${encodeURIComponent(id)}/changes`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function apiFinalizeElection(id) {
  const res = await _fetch(`${API_BASE}/api/elections/${encodeURIComponent(id)}/finalize`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({}),
  });
  return res.json();
}

export async function apiSeedElection1997() {
  const res = await _fetch(`${API_BASE}/api/admin/elections/seed-1997`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({}),
  });
  return res.json();
}

export async function apiGetElectionBodiesCurrent() {
  const res = await _fetch(`${API_BASE}/api/elections/bodies/current`, { credentials: "include" });
  return res.json();
}

export async function apiGetElectionBodiesArchive() {
  const res = await _fetch(`${API_BASE}/api/elections/bodies/archive`, { credentials: "include" });
  return res.json();
}

export async function apiSubmitElectionBodyResult(payload) {
  const res = await _fetch(`${API_BASE}/api/elections/bodies`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function apiUpdateElectionBodyResult(id, payload) {
  const res = await _fetch(`${API_BASE}/api/elections/bodies/${encodeURIComponent(id)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`apiUpdateElectionBodyResult failed (${res.status})`);
  return res.json();
}

export async function apiDeleteElectionBodyResult(id) {
  const res = await _fetch(`${API_BASE}/api/elections/bodies/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
    headers: csrfHeaders(),
  });
  if (!res.ok) throw new Error(`apiDeleteElectionBodyResult failed (${res.status})`);
  return res.json();
}

export async function apiResetBaseline() {
  const res = await _fetch(`${API_BASE}/api/admin/reset-baseline`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ confirm: "RESET BASELINE" }),
  });
  return res.json();
}

export async function apiGetConstituencyEvents(id) {
  const res = await _fetch(`${API_BASE}/api/constituencies/${encodeURIComponent(id)}/events`, { credentials: "include" });
  return res.json();
}

// ── Budget (DB-backed) ─────────────────────────────────────────────────────

export async function apiGetBudget() {
  const res = await _fetch(`${API_BASE}/api/budget`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetBudget failed (${res.status})`);
  return res.json();
}

export async function apiAdminSeedBudget(force = false) {
  const res = await _fetch(`${API_BASE}/api/admin/budget/seed`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ force }),
  });
  return res.json();
}

export async function apiAdminUpdateBudgetControls(controls) {
  const res = await _fetch(`${API_BASE}/api/admin/budget/controls`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(controls),
  });
  if (!res.ok) throw new Error(`apiAdminUpdateBudgetControls failed (${res.status})`);
  return res.json();
}

export async function apiSubmitBudgetDraft(budget, submittedBy) {
  const res = await _fetch(`${API_BASE}/api/budget/draft`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ budget, submittedBy }),
  });
  if (!res.ok) throw new Error(`apiSubmitBudgetDraft failed (${res.status})`);
  return res.json();
}

export async function apiAdminApproveBudget() {
  const res = await _fetch(`${API_BASE}/api/admin/budget/approve`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`apiAdminApproveBudget failed (${res.status})`);
  return res.json();
}

export async function apiAdminRejectBudget() {
  const res = await _fetch(`${API_BASE}/api/admin/budget/reject`, {
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
  const res = await _fetch(`${API_BASE}/api/team`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetTeam failed (${res.status})`);
  return res.json();
}

// ── Public profile read-only ────────────────────────────────────────────────

export async function apiGetPublicProfile(username) {
  const res = await _fetch(`${API_BASE}/api/profile?user=${encodeURIComponent(username)}`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetPublicProfile failed (${res.status})`);
  return res.json();
}

// ── Affiliations workflow ───────────────────────────────────────────────────

export async function apiGetCharacterAffiliations(characterId) {
  const res = await _fetch(`${API_BASE}/api/me/character/${encodeURIComponent(characterId)}/affiliations`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetCharacterAffiliations failed (${res.status})`);
  return res.json();
}

export async function apiSubmitCharacterAffiliations(characterId, requestedAffiliationIds) {
  const res = await _fetch(`${API_BASE}/api/me/character/${encodeURIComponent(characterId)}/affiliations`, {
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
  const res = await _fetch(`${API_BASE}/api/control-panel/affiliations/pending`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetPendingAffiliations failed (${res.status})`);
  return res.json();
}

export async function apiDecideAffiliation(requestId, decision, note) {
  const res = await _fetch(`${API_BASE}/api/control-panel/affiliations/${encodeURIComponent(requestId)}/decide`, {
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
  const res = await _fetch(`${API_BASE}/api/admin/users`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiAdminGetUsers failed (${res.status})`);
  return res.json();
}

export async function apiAdminGetCharacters(params = {}) {
  const qs = new URLSearchParams();
  if (params.owned !== undefined) qs.set("owned", params.owned);
  if (params.active !== undefined) qs.set("active", String(params.active));
  const url = `${API_BASE}/api/admin/characters${qs.toString() ? `?${qs}` : ""}`;
  const res = await _fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`apiAdminGetCharacters failed (${res.status})`);
  return res.json();
}

export async function apiAdminAssignCharacterOwner(characterId, userId, setActive = false) {
  const res = await _fetch(`${API_BASE}/api/admin/characters/${encodeURIComponent(characterId)}/assign-owner`, {
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
  const res = await _fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(userId)}/active-character`, {
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

export async function apiAdminAssignNpcManager(characterId, userId) {
  const res = await _fetch(`${API_BASE}/api/admin/characters/${encodeURIComponent(characterId)}/assign-npc-manager`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ user_id: userId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiAdminAssignNpcManager failed (${res.status})`);
  }
  return res.json();
}

// ── Playerbase & Finance APIs ──────────────────────────────────────────────

export async function apiGetPlayerbase() {
  const res = await _fetch(`${API_BASE}/api/admin/playerbase`, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiGetPlayerbase failed (${res.status})`);
  }
  return res.json();
}

export async function apiAdminSetBank(characterId, bankBalance) {
  const res = await _fetch(`${API_BASE}/api/admin/finance/set-bank`, {
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
  const res = await _fetch(`${API_BASE}/api/admin/finance/set-salary-override`, {
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

export async function apiAdminUpdateCharacterProfile(characterId, fields) {
  const res = await _fetch(`${API_BASE}/api/admin/characters/${encodeURIComponent(characterId)}/profile`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(fields),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiAdminUpdateCharacterProfile failed (${res.status})`);
  return body;
}

export async function apiAdminSetPositions(characterId, positions) {
  const res = await _fetch(`${API_BASE}/api/admin/finance/set-positions`, {
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
  const res = await _fetch(`${API_BASE}/api/admin/finance/revenue`, {
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
  const res = await _fetch(`${API_BASE}/api/admin/finance/revenue/${encodeURIComponent(id)}`, {
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
  const res = await _fetch(`${API_BASE}/api/admin/finance/revenue/${encodeURIComponent(id)}`, {
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
  const res = await _fetch(`${API_BASE}/api/admin/salary-scales/uprate`, {
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

// ── Finance Config (admin) ────────────────────────────────────────────────────

export async function apiGetFinanceConfig() {
  const res = await _fetch(`${API_BASE}/api/admin/finance/config`, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiGetFinanceConfig failed (${res.status})`);
  }
  return res.json();
}

export async function apiUpdateFinanceSalaryBands(salaryBands, adminOverride = false) {
  const res = await _fetch(`${API_BASE}/api/admin/finance/salary-bands`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ salaryBands, adminOverride }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiUpdateFinanceSalaryBands failed (${res.status})`);
  }
  return res.json();
}

export async function apiUpdateFinanceStartingBalances(startingBalances, adminOverride = false) {
  const res = await _fetch(`${API_BASE}/api/admin/finance/starting-balances`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ startingBalances, adminOverride }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiUpdateFinanceStartingBalances failed (${res.status})`);
  }
  return res.json();
}

export async function apiApplyFinanceInflation(inflationPct, adminOverride = false, dryRun = false) {
  const res = await _fetch(`${API_BASE}/api/admin/finance/apply-inflation`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ inflationPct, adminOverride, dryRun }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiApplyFinanceInflation failed (${res.status})`);
  }
  return res.json();
}

export async function apiGetRedLionPosts() {
  const res = await _fetch(`${API_BASE}/api/redlion`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetRedLionPosts failed (${res.status})`);
  return res.json();
}
export async function apiCreateRedLionPost(post) {
  const res = await _fetch(`${API_BASE}/api/redlion`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(post),
  });
  if (!res.ok) throw new Error(`apiCreateRedLionPost failed (${res.status})`);
  return res.json();
}
export async function apiDeleteRedLionPost(id) {
  const res = await _fetch(`${API_BASE}/api/redlion/${encodeURIComponent(id)}`, {
    method: "DELETE", credentials: "include", headers: csrfHeaders(),
  });
  if (!res.ok) throw new Error(`apiDeleteRedLionPost failed (${res.status})`);
  return res.json();
}

// ── Events ───────────────────────────────────────────────────────────────────
export async function apiGetEvents() {
  const res = await _fetch(`${API_BASE}/api/events`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetEvents failed (${res.status})`);
  return res.json();
}
export async function apiCreateEvent(event) {
  const res = await _fetch(`${API_BASE}/api/events`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(event),
  });
  if (!res.ok) throw new Error(`apiCreateEvent failed (${res.status})`);
  return res.json();
}
export async function apiUpdateEvent(id, event) {
  const res = await _fetch(`${API_BASE}/api/events/${encodeURIComponent(id)}`, {
    method: "PUT", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(event),
  });
  if (!res.ok) throw new Error(`apiUpdateEvent failed (${res.status})`);
  return res.json();
}
export async function apiDeleteEvent(id) {
  const res = await _fetch(`${API_BASE}/api/events/${encodeURIComponent(id)}`, {
    method: "DELETE", credentials: "include", headers: csrfHeaders(),
  });
  if (!res.ok) throw new Error(`apiDeleteEvent failed (${res.status})`);
  return res.json();
}

// ── Character work plan ──────────────────────────────────────────────────────

export async function apiGetMyWorkPlan() {
  const res = await _fetch(`${API_BASE}/api/me/work-plan`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetMyWorkPlan failed (${res.status})`);
  return res.json();
}

export async function apiSaveMyWorkPlan(plan) {
  const res = await _fetch(`${API_BASE}/api/me/work-plan`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(plan),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiSaveMyWorkPlan failed (${res.status})`);
  return body;
}

// ── Online posts ─────────────────────────────────────────────────────────────
export async function apiGetOnlinePosts(type) {
  const url = type ? `${API_BASE}/api/online?type=${encodeURIComponent(type)}` : `${API_BASE}/api/online`;
  const res = await _fetch(url, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetOnlinePosts failed (${res.status})`);
  return res.json();
}
export async function apiCreateOnlinePost(postType, post) {
  const res = await _fetch(`${API_BASE}/api/online`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ post_type: postType, ...post }),
  });
  if (!res.ok) throw new Error(`apiCreateOnlinePost failed (${res.status})`);
  return res.json();
}
export async function apiDeleteOnlinePost(id) {
  const res = await _fetch(`${API_BASE}/api/online/${encodeURIComponent(id)}`, {
    method: "DELETE", credentials: "include", headers: csrfHeaders(),
  });
  if (!res.ok) throw new Error(`apiDeleteOnlinePost failed (${res.status})`);
  return res.json();
}

// ── Fundraising ───────────────────────────────────────────────────────────────
export async function apiGetFundraisingItems() {
  const res = await _fetch(`${API_BASE}/api/fundraising`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetFundraisingItems failed (${res.status})`);
  return res.json();
}
export async function apiCreateFundraisingItem(item) {
  const res = await _fetch(`${API_BASE}/api/fundraising`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new Error(`apiCreateFundraisingItem failed (${res.status})`);
  return res.json();
}
export async function apiUpdateFundraisingItem(id, item) {
  const res = await _fetch(`${API_BASE}/api/fundraising/${encodeURIComponent(id)}`, {
    method: "PUT", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new Error(`apiUpdateFundraisingItem failed (${res.status})`);
  return res.json();
}
export async function apiDeleteFundraisingItem(id) {
  const res = await _fetch(`${API_BASE}/api/fundraising/${encodeURIComponent(id)}`, {
    method: "DELETE", credentials: "include", headers: csrfHeaders(),
  });
  if (!res.ok) throw new Error(`apiDeleteFundraisingItem failed (${res.status})`);
  return res.json();
}
export async function apiCreditFundraisingToParty(id, { partySlug, amount, note = "" }) {
  const res = await _fetch(`${API_BASE}/api/fundraising/${encodeURIComponent(id)}/credit-party`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ partySlug, amount, note }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiCreditFundraisingToParty failed (${res.status})`);
  return body;
}

export async function apiCreditFundraisingToCharacter(id, { characterName, amount, note = "" }) {
  const res = await _fetch(`${API_BASE}/api/fundraising/${encodeURIComponent(id)}/credit-character`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ characterName, amount, note }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiCreditFundraisingToCharacter failed (${res.status})`);
  return body;
}

// ── Player finance (DB-backed) ───────────────────────────────────────────────

export async function apiGetMyFinance() {
  const res = await _fetch(`${API_BASE}/api/me/finance`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetMyFinance failed (${res.status})`);
  return res.json();
}

export async function apiGetCharacterFinance(characterId) {
  const res = await _fetch(`${API_BASE}/api/admin/characters/${encodeURIComponent(characterId)}/finance`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetCharacterFinance failed (${res.status})`);
  return res.json();
}

export async function apiGetMyFinanceSummary() {
  const res = await _fetch(`${API_BASE}/api/me/finance/summary`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetMyFinanceSummary failed (${res.status})`);
  return res.json();
}

// ── Config enums ────────────────────────────────────────────────────────────
// Fetches canonical dropdown option arrays from the server (single source of truth).
export async function apiGetEnums() {
  const res = await _fetch(`${API_BASE}/api/config/enums`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetEnums failed (${res.status})`);
  return res.json();
}


export async function apiSubmitProfileChange(fields) {
  const res = await _fetch(`${API_BASE}/api/characters/profile-change`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(fields),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiSubmitProfileChange failed (${res.status})`);
  return body;
}

export async function apiGetMyProfileChanges() {
  const res = await _fetch(`${API_BASE}/api/characters/profile-changes/mine`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetMyProfileChanges failed (${res.status})`);
  return res.json();
}

export async function apiGetAllProfileChanges(status) {
  const url = status
    ? `${API_BASE}/api/admin/profile-changes?status=${encodeURIComponent(status)}`
    : `${API_BASE}/api/admin/profile-changes`;
  const res = await _fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetAllProfileChanges failed (${res.status})`);
  return res.json();
}

export async function apiApproveProfileChange(id) {
  const res = await _fetch(`${API_BASE}/api/admin/profile-changes/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiApproveProfileChange failed (${res.status})`);
  return body;
}

export async function apiRejectProfileChange(id) {
  const res = await _fetch(`${API_BASE}/api/admin/profile-changes/${encodeURIComponent(id)}/reject`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiRejectProfileChange failed (${res.status})`);
  return body;
}

export async function apiAddShopPurchase(purchase) {
  const res = await _fetch(`${API_BASE}/api/me/character/shop-purchases`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(purchase),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiAddShopPurchase failed (${res.status})`);
  return body;
}

export async function apiRemoveShopPurchase(id) {
  const res = await _fetch(`${API_BASE}/api/me/character/shop-purchases/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiRemoveShopPurchase failed (${res.status})`);
  return body;
}

export async function apiSellShopPurchase(id) {
  const res = await _fetch(`${API_BASE}/api/me/character/shop-purchases/${encodeURIComponent(id)}/sell`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiSellShopPurchase failed (${res.status})`);
  return body;
}

export async function apiDismissShopPurchase(id) {
  const res = await _fetch(`${API_BASE}/api/me/character/shop-purchases/${encodeURIComponent(id)}/dismiss`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiDismissShopPurchase failed (${res.status})`);
  return body;
}

export async function apiAddAdditionalRevenue(characterId, label, annualAmount) {
  const res = await _fetch(`${API_BASE}/api/me/character/additional-revenue`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ character_id: characterId, label, annual_amount: annualAmount }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiAddAdditionalRevenue failed (${res.status})`);
  return body;
}

export async function apiRemoveAdditionalRevenue(id) {
  const res = await _fetch(`${API_BASE}/api/me/character/additional-revenue/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiRemoveAdditionalRevenue failed (${res.status})`);
  return body;
}

/**
 * GET /api/health — liveness probe (no auth required).
 * @returns {Promise<{ ok: boolean }>}
 */
export async function apiGetHealth() {
  const res = await _fetch(`${API_BASE}/api/health`);
  if (!res.ok) throw new Error(`Health check failed (${res.status})`);
  return res.json();
}

/**
 * GET /api/debates/payload/:entityType/:entityId — retrieve the structured debate
 * payload for a given entity without making any external Discourse calls.
 * @param {string} entityType - one of: bill, motion, statement, regulation, question
 * @param {string} entityId
 * @returns {Promise<object>}
 */
export async function apiGetDebatePayload(entityType, entityId) {
  const res = await _fetch(
    `${API_BASE}/api/debates/payload/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`,
    { credentials: "include" }
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiGetDebatePayload failed (${res.status})`);
  return body;
}

// ── News Stories API ─────────────────────────────────────────────────────────
export async function apiGetNews() {
  const res = await _fetch(`${API_BASE}/api/news`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetNews failed (${res.status})`);
  return res.json();
}
export async function apiCreateNewsStory(story) {
  const res = await _fetch(`${API_BASE}/api/news`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify(story) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiCreateNewsStory failed (${res.status})`);
  return body;
}
export async function apiUpdateNewsStory(id, patch) {
  const res = await _fetch(`${API_BASE}/api/news/${encodeURIComponent(id)}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify(patch) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiUpdateNewsStory failed (${res.status})`);
  return body;
}
export async function apiDeleteNewsStory(id) {
  const res = await _fetch(`${API_BASE}/api/news/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include", headers: { ...csrfHeaders() } });
  if (!res.ok) throw new Error(`apiDeleteNewsStory failed (${res.status})`);
  return res.json();
}

// ── News Story Comments API ───────────────────────────────────────────────────
export async function apiGetNewsComments(storyId) {
  const res = await _fetch(`${API_BASE}/api/news/${encodeURIComponent(storyId)}/comments`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetNewsComments failed (${res.status})`);
  return res.json();
}
export async function apiCreateNewsComment(storyId, text) {
  const res = await _fetch(`${API_BASE}/api/news/${encodeURIComponent(storyId)}/comments`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify({ text }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiCreateNewsComment failed (${res.status})`);
  return body;
}
export async function apiDeleteNewsComment(storyId, commentId) {
  const res = await _fetch(`${API_BASE}/api/news/${encodeURIComponent(storyId)}/comments/${encodeURIComponent(commentId)}`, { method: "DELETE", credentials: "include", headers: { ...csrfHeaders() } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiDeleteNewsComment failed (${res.status})`);
  return body;
}
export async function apiReportNewsComment(storyId, commentId) {
  const res = await _fetch(`${API_BASE}/api/news/${encodeURIComponent(storyId)}/comments/${encodeURIComponent(commentId)}/report`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify({}) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiReportNewsComment failed (${res.status})`);
  return body;
}
export async function apiCreateNewsReplyRequest(storyId, textDraft = "") {
  const res = await _fetch(`${API_BASE}/api/news/${encodeURIComponent(storyId)}/reply-request`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify({ textDraft }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiCreateNewsReplyRequest failed (${res.status})`);
  return body;
}
export async function apiGetNewsReplyRequests() {
  const res = await _fetch(`${API_BASE}/api/news/reply-requests`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetNewsReplyRequests failed (${res.status})`);
  return res.json();
}
export async function apiGetMyReplyRequests() {
  const res = await _fetch(`${API_BASE}/api/news/my-reply-requests`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetMyReplyRequests failed (${res.status})`);
  return res.json();
}
export async function apiResolveNewsReplyRequest(storyId, requestId, payload) {
  const res = await _fetch(`${API_BASE}/api/news/${encodeURIComponent(storyId)}/reply-requests/${encodeURIComponent(requestId)}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify(payload) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiResolveNewsReplyRequest failed (${res.status})`);
  return body;
}

// ── Rules API ────────────────────────────────────────────────────────────────
export async function apiGetRules() {
  const res = await _fetch(`${API_BASE}/api/rules`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetRules failed (${res.status})`);
  return res.json();
}
export async function apiCreateRule(rule) {
  const res = await _fetch(`${API_BASE}/api/rules`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify(rule) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiCreateRule failed (${res.status})`);
  return body;
}
export async function apiUpdateRule(id, patch) {
  const res = await _fetch(`${API_BASE}/api/rules/${encodeURIComponent(id)}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify(patch) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiUpdateRule failed (${res.status})`);
  return body;
}
export async function apiDeleteRule(id) {
  const res = await _fetch(`${API_BASE}/api/rules/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include", headers: { ...csrfHeaders() } });
  if (!res.ok) throw new Error(`apiDeleteRule failed (${res.status})`);
  return res.json();
}

// ── Guides API ───────────────────────────────────────────────────────────────
export async function apiGetGuides() {
  const res = await _fetch(`${API_BASE}/api/guides`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetGuides failed (${res.status})`);
  return res.json();
}
export async function apiCreateGuide(guide) {
  const res = await _fetch(`${API_BASE}/api/guides`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify(guide) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiCreateGuide failed (${res.status})`);
  return body;
}
export async function apiUpdateGuide(id, patch) {
  const res = await _fetch(`${API_BASE}/api/guides/${encodeURIComponent(id)}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify(patch) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiUpdateGuide failed (${res.status})`);
  return body;
}
export async function apiDeleteGuide(id) {
  const res = await _fetch(`${API_BASE}/api/guides/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include", headers: { ...csrfHeaders() } });
  if (!res.ok) throw new Error(`apiDeleteGuide failed (${res.status})`);
  return res.json();
}

// ── Civil Service API ────────────────────────────────────────────────────────
export async function apiGetCsBriefings() {
  const res = await _fetch(`${API_BASE}/api/civil-service/briefings`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetCsBriefings failed (${res.status})`);
  return res.json();
}
export async function apiCreateCsBriefing(briefing) {
  const res = await _fetch(`${API_BASE}/api/civil-service/briefings`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify(briefing) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiCreateCsBriefing failed (${res.status})`);
  return body;
}
export async function apiUpdateCsBriefing(id, patch) {
  const res = await _fetch(`${API_BASE}/api/civil-service/briefings/${encodeURIComponent(id)}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify(patch) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiUpdateCsBriefing failed (${res.status})`);
  return body;
}
export async function apiDeleteCsBriefing(id) {
  const res = await _fetch(`${API_BASE}/api/civil-service/briefings/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include", headers: { ...csrfHeaders() } });
  if (!res.ok) throw new Error(`apiDeleteCsBriefing failed (${res.status})`);
  return res.json();
}
export async function apiGetCsCases() {
  const res = await _fetch(`${API_BASE}/api/civil-service/cases`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetCsCases failed (${res.status})`);
  return res.json();
}
export async function apiCreateCsCase(csCase) {
  const res = await _fetch(`${API_BASE}/api/civil-service/cases`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify(csCase) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiCreateCsCase failed (${res.status})`);
  return body;
}
export async function apiUpdateCsCase(id, patch) {
  const res = await _fetch(`${API_BASE}/api/civil-service/cases/${encodeURIComponent(id)}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify(patch) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiUpdateCsCase failed (${res.status})`);
  return body;
}
export async function apiDeleteCsCase(id) {
  const res = await _fetch(`${API_BASE}/api/civil-service/cases/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include", headers: { ...csrfHeaders() } });
  if (!res.ok) throw new Error(`apiDeleteCsCase failed (${res.status})`);
  return res.json();
}

// ── Bodies API ───────────────────────────────────────────────────────────────
export async function apiGetBodies() {
  const res = await _fetch(`${API_BASE}/api/bodies`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetBodies failed (${res.status})`);
  return res.json();
}
export async function apiUpdateBody(id, bodyData) {
  const res = await _fetch(`${API_BASE}/api/bodies/${encodeURIComponent(id)}`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify(bodyData) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiUpdateBody failed (${res.status})`);
  return body;
}

// ── Newspaper articles API ───────────────────────────────────────────────────
export async function apiGetPaperArticles() {
  const res = await _fetch(`${API_BASE}/api/papers`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetPaperArticles failed (${res.status})`);
  return res.json();
}
export async function apiCreatePaperArticle(paperKey, article) {
  const res = await _fetch(`${API_BASE}/api/papers/${encodeURIComponent(paperKey)}/articles`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify(article) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiCreatePaperArticle failed (${res.status})`);
  return body;
}
export async function apiUpdatePaperArticle(paperKey, id, patch) {
  const res = await _fetch(`${API_BASE}/api/papers/${encodeURIComponent(paperKey)}/articles/${encodeURIComponent(id)}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify(patch) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiUpdatePaperArticle failed (${res.status})`);
  return body;
}
export async function apiDeletePaperArticle(paperKey, id) {
  const res = await _fetch(`${API_BASE}/api/papers/${encodeURIComponent(paperKey)}/articles/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include", headers: { ...csrfHeaders() } });
  if (!res.ok) throw new Error(`apiDeletePaperArticle failed (${res.status})`);
  return res.json();
}

// ── Paper Article Comments API ────────────────────────────────────────────────
export async function apiGetPaperComments(paperKey, articleId) {
  const res = await _fetch(`${API_BASE}/api/papers/${encodeURIComponent(paperKey)}/articles/${encodeURIComponent(articleId)}/comments`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetPaperComments failed (${res.status})`);
  return res.json();
}
export async function apiCreatePaperComment(paperKey, articleId, text) {
  const res = await _fetch(`${API_BASE}/api/papers/${encodeURIComponent(paperKey)}/articles/${encodeURIComponent(articleId)}/comments`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify({ text }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiCreatePaperComment failed (${res.status})`);
  return body;
}
export async function apiDeletePaperComment(paperKey, articleId, commentId) {
  const res = await _fetch(`${API_BASE}/api/papers/${encodeURIComponent(paperKey)}/articles/${encodeURIComponent(articleId)}/comments/${encodeURIComponent(commentId)}`, { method: "DELETE", credentials: "include", headers: { ...csrfHeaders() } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiDeletePaperComment failed (${res.status})`);
  return body;
}

// ── Paper Submissions API (Leaks + Editorials) ────────────────────────────────
export async function apiGetPaperSubmissions(filters = {}) {
  const params = new URLSearchParams();
  if (filters.paper)  params.set("paper",  filters.paper);
  if (filters.status) params.set("status", filters.status);
  if (filters.type)   params.set("type",   filters.type);
  if (filters.risk)   params.set("risk",   filters.risk);
  const qs = params.toString();
  const res = await _fetch(`${API_BASE}/api/papers/submissions${qs ? `?${qs}` : ""}`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetPaperSubmissions failed (${res.status})`);
  return res.json();
}
export async function apiCreatePaperSubmission(payload) {
  const res = await _fetch(`${API_BASE}/api/papers/submissions`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify(payload) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiCreatePaperSubmission failed (${res.status})`);
  return body;
}
export async function apiResolvePaperSubmission(id, payload) {
  const res = await _fetch(`${API_BASE}/api/papers/submissions/${encodeURIComponent(id)}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify(payload) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiResolvePaperSubmission failed (${res.status})`);
  return body;
}
export async function apiDeletePaperSubmission(id) {
  const res = await _fetch(`${API_BASE}/api/papers/submissions/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include", headers: { ...csrfHeaders() } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiDeletePaperSubmission failed (${res.status})`);
  return body;
}

// ── Online post edit (PATCH) ─────────────────────────────────────────────────
export async function apiUpdateOnlinePost(id, patch) {
  const res = await _fetch(`${API_BASE}/api/online/${encodeURIComponent(id)}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify(patch) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiUpdateOnlinePost failed (${res.status})`);
  return body;
}

export async function apiUpdateOnlineSettings(settings) {
  const res = await _fetch(`${API_BASE}/api/online/settings`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify({ settings }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiUpdateOnlineSettings failed (${res.status})`);
  return body;
}

export async function apiUpdateMyAbsent(absent, delegatedTo) {
  const res = await _fetch(`${API_BASE}/api/me/absent`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify({ absent, delegatedTo }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiUpdateMyAbsent failed (${res.status})`);
  return body;
}

export async function apiGetAbsenceLog(params = {}) {
  const q = new URLSearchParams();
  if (params.limit)         q.set("limit",         String(params.limit));
  if (params.since)         q.set("since",         params.since);
  if (params.party)         q.set("party",         params.party);
  if (params.characterId)   q.set("characterId",   params.characterId);
  if (params.characterName) q.set("characterName", params.characterName);
  const res = await _fetch(`${API_BASE}/api/control-panel/absence-log?${q}`, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `apiGetAbsenceLog failed (${res.status})`);
  }
  return res.json();
}

// ── Economy page data ────────────────────────────────────────────────────────
export async function apiGetEconomyData() {
  const res = await _fetch(`${API_BASE}/api/admin/economy`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetEconomyData failed (${res.status})`);
  return res.json();
}
export async function apiSaveEconomyData(data) {
  const res = await _fetch(`${API_BASE}/api/admin/economy`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify(data) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiSaveEconomyData failed (${res.status})`);
  return body;
}

// ── Locals page data ─────────────────────────────────────────────────────────
export async function apiGetLocals() {
  const res = await _fetch(`${API_BASE}/api/locals`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetLocals failed (${res.status})`);
  return res.json();
}
export async function apiSaveLocals(data) {
  const res = await _fetch(`${API_BASE}/api/locals`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify(data) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiSaveLocals failed (${res.status})`);
  return body;
}

// ── Cabinet/Shadow Cabinet headline ──────────────────────────────────────────
export async function apiSaveCabinetHeadline(headline) {
  const res = await _fetch(`${API_BASE}/api/cabinet/headline`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify(headline) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiSaveCabinetHeadline failed (${res.status})`);
  return body;
}
export async function apiGetCabinetHeadline() {
  const res = await _fetch(`${API_BASE}/api/cabinet/headline`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetCabinetHeadline failed (${res.status})`);
  return res.json();
}
export async function apiSaveShadowCabinetHeadline(headline) {
  const res = await _fetch(`${API_BASE}/api/shadowcabinet/headline`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify(headline) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiSaveShadowCabinetHeadline failed (${res.status})`);
  return body;
}

// ── Whip discipline ──────────────────────────────────────────────────────────
export async function apiWithdrawWhip(characterId, note = "") {
  const res = await _fetch(`${API_BASE}/api/characters/${encodeURIComponent(characterId)}/whip/withdraw`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify({ note }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiWithdrawWhip failed (${res.status})`);
  return body;
}
export async function apiRestoreWhip(characterId) {
  const res = await _fetch(`${API_BASE}/api/characters/${encodeURIComponent(characterId)}/whip/restore`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify({}) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiRestoreWhip failed (${res.status})`);
  return body;
}
export async function apiGetWhipRequests(partyId, status = "pending") {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}/whip-requests?status=${encodeURIComponent(status)}`, { credentials: "include" });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `apiGetWhipRequests failed (${res.status})`); }
  return res.json();
}
export async function apiApproveWhipRequest(partyId, requestId) {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}/whip-requests/${encodeURIComponent(requestId)}/approve`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify({}) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiApproveWhipRequest failed (${res.status})`);
  return body;
}
export async function apiDenyWhipRequest(partyId, requestId) {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}/whip-requests/${encodeURIComponent(requestId)}/deny`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify({}) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiDenyWhipRequest failed (${res.status})`);
  return body;
}

// ── Party expulsion workflow ──────────────────────────────────────────────────
export async function apiRequestExpulsion(partyId, characterId, reason = "") {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}/expulsions`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify({ character_id: characterId, reason }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiRequestExpulsion failed (${res.status})`);
  return body;
}
export async function apiGetExpulsions(status = "pending") {
  const res = await _fetch(`${API_BASE}/api/mod/expulsions?status=${encodeURIComponent(status)}`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetExpulsions failed (${res.status})`);
  return res.json();
}
export async function apiApproveExpulsion(id) {
  const res = await _fetch(`${API_BASE}/api/mod/expulsions/${encodeURIComponent(id)}/approve`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify({}) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiApproveExpulsion failed (${res.status})`);
  return body;
}
export async function apiDenyExpulsion(id) {
  const res = await _fetch(`${API_BASE}/api/mod/expulsions/${encodeURIComponent(id)}/deny`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify({}) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiDenyExpulsion failed (${res.status})`);
  return body;
}

// ── Party leader elections ────────────────────────────────────────────────────
export async function apiGetPartyElections(partyId) {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}/elections`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetPartyElections failed (${res.status})`);
  return res.json();
}
export async function apiStartPartyElection(partyId) {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}/elections`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify({}) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiStartPartyElection failed (${res.status})`);
  return body;
}
export async function apiGetPartyElection(partyId, electionId) {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}/elections/${encodeURIComponent(electionId)}`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetPartyElection failed (${res.status})`);
  return res.json();
}
export async function apiNominateForElection(partyId, electionId, characterId) {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}/elections/${encodeURIComponent(electionId)}/nominate`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify({ character_id: characterId }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiNominateForElection failed (${res.status})`);
  return body;
}
export async function apiVoteInElection(partyId, electionId, nomineeId) {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}/elections/${encodeURIComponent(electionId)}/vote`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify({ nominee_id: nomineeId }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiVoteInElection failed (${res.status})`);
  return body;
}
export async function apiOpenElectionVoting(partyId, electionId) {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}/elections/${encodeURIComponent(electionId)}/open-voting`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify({}) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiOpenElectionVoting failed (${res.status})`);
  return body;
}
export async function apiCloseElection(partyId, electionId) {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}/elections/${encodeURIComponent(electionId)}/close`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify({}) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiCloseElection failed (${res.status})`);
  return body;
}
export async function apiRunoffElection(partyId, electionId) {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(partyId)}/elections/${encodeURIComponent(electionId)}/runoff`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify({}) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiRunoffElection failed (${res.status})`);
  return body;
}

// ── Privy Council ────────────────────────────────────────────────────────────
export async function apiGetPrivyCouncil() {
  const res = await _fetch(`${API_BASE}/api/privy-council`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetPrivyCouncil failed (${res.status})`);
  return res.json();
}
export async function apiAppointPrivyCouncillor(characterId, reason = "") {
  const res = await _fetch(`${API_BASE}/api/mod/privy-council/appoint`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify({ character_id: characterId, reason }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiAppointPrivyCouncillor failed (${res.status})`);
  return body;
}
export async function apiRemovePrivyCouncillor(characterId, { force = false } = {}) {
  const res = await _fetch(`${API_BASE}/api/mod/privy-council/remove`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify({ character_id: characterId, force }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiRemovePrivyCouncillor failed (${res.status})`);
  return body;
}
export async function apiGetPrivyCouncilPosts() {
  const res = await _fetch(`${API_BASE}/api/privy-council/posts`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetPrivyCouncilPosts failed (${res.status})`);
  return res.json();
}
export async function apiCreatePrivyCouncilPost(postData) {
  const res = await _fetch(`${API_BASE}/api/privy-council/posts`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify(postData) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiCreatePrivyCouncilPost failed (${res.status})`);
  return body;
}
export async function apiDeletePrivyCouncilPost(postId) {
  const res = await _fetch(`${API_BASE}/api/privy-council/posts/${encodeURIComponent(postId)}`, { method: "DELETE", credentials: "include", headers: { ...csrfHeaders() } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiDeletePrivyCouncilPost failed (${res.status})`);
  return body;
}

// ── Mods Message ─────────────────────────────────────────────────────────────
export async function apiGetModsMessage() {
  const res = await _fetch(`${API_BASE}/api/mods-message`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetModsMessage failed (${res.status})`);
  return res.json();
}
export async function apiSetModsMessage(playerMessage, staffMessage, playerStarterPackHtml) {
  const res = await _fetch(`${API_BASE}/api/mods-message`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ playerMessage, staffMessage, playerStarterPackHtml }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiSetModsMessage failed (${res.status})`);
  return body;
}


// ── Party Faction API ─────────────────────────────────────────────────────────

/** Admin: list factions + allocations for a party */
export async function apiGetAdminPartyFactions(slug) {
  const res = await _fetch(`${API_BASE}/api/admin/parties/${encodeURIComponent(slug)}/factions`, { credentials: "include" });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `apiGetAdminPartyFactions failed (${res.status})`); }
  return res.json();
}

/** Admin: create a new faction for a party */
export async function apiCreatePartyFaction(slug, payload) {
  const res = await _fetch(`${API_BASE}/api/admin/parties/${encodeURIComponent(slug)}/factions`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiCreatePartyFaction failed (${res.status})`);
  return body;
}

/** Admin: update faction metadata */
export async function apiUpdatePartyFaction(id, patch) {
  const res = await _fetch(`${API_BASE}/api/admin/factions/${encodeURIComponent(id)}`, {
    method: "PATCH", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(patch),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiUpdatePartyFaction failed (${res.status})`);
  return body;
}

/** Admin: update faction MP allocation */
export async function apiUpdatePartyFactionAllocation(id, payload) {
  const res = await _fetch(`${API_BASE}/api/admin/factions/${encodeURIComponent(id)}/allocation`, {
    method: "PATCH", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiUpdatePartyFactionAllocation failed (${res.status})`);
  return body;
}

export async function apiGetMyFaction() {
  const res = await _fetch(`${API_BASE}/api/me/faction`, { credentials: "include" });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `apiGetMyFaction failed (${res.status})`); }
  return res.json();
}

export async function apiSwitchMyFaction(faction_id) {
  const res = await _fetch(`${API_BASE}/api/me/faction/switch`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ faction_id }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiSwitchMyFaction failed (${res.status})`);
  return body;
}

/** Player-facing: list active factions for a party */
export async function apiGetPartyFactions(slug) {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(slug)}/factions`, { credentials: "include" });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `apiGetPartyFactions failed (${res.status})`); }
  return res.json();
}

/** Player-facing: get faction climate (balance, pressure, resilience) for a party */
export async function apiGetPartyFactionClimate(slug, { debug = false } = {}) {
  const q = debug ? "?debug=1" : "";
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(slug)}/faction-climate${q}`, { credentials: "include" });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `apiGetPartyFactionClimate failed (${res.status})`); }
  return res.json();
}

/** Admin/mod: idempotent seed of 1997 baseline factions for Labour, Conservative, Liberal Democrat */
export async function apiAdminSeed1997Factions() {
  const res = await _fetch(`${API_BASE}/api/admin/seed-1997-factions`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({}),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiAdminSeed1997Factions failed (${res.status})`);
  return body;
}

/** Admin/mod: seed 1997 bodies + locals baseline data (merge by default, force optional). */
export async function apiAdminSeed1997BodiesLocals(force = false) {
  const query = force ? "?force=true" : "";
  const res = await _fetch(`${API_BASE}/api/admin/seed-1997-bodies-locals${query}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ force: !!force }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiAdminSeed1997BodiesLocals failed (${res.status})`);
  return body;
}

/** Admin/mod: totals for other-official arenas (visible bodies + all locals). */
export async function apiGetOtherOfficialsArenasTotals() {
  const res = await _fetch(`${API_BASE}/api/admin/other-officials/arenas-totals`, { credentials: "include" });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `apiGetOtherOfficialsArenasTotals failed (${res.status})`); }
  return res.json();
}

/** Admin/mod: get current faction allocations for one arena+party. */
export async function apiGetOtherOfficialsFactionAllocations(arena_type, arena_id, party_slug) {
  const q = new URLSearchParams({ arena_type: String(arena_type || ""), arena_id: String(arena_id || ""), party_slug: String(party_slug || "") });
  const res = await _fetch(`${API_BASE}/api/admin/other-officials/faction-allocations?${q.toString()}`, { credentials: "include" });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `apiGetOtherOfficialsFactionAllocations failed (${res.status})`); }
  return res.json();
}

/** Admin/mod: run faction/IPM freeze now. */
export async function apiAdminTriggerFactionFreeze() {
  const res = await _fetch(`${API_BASE}/api/admin/factions/trigger-freeze`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({}),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiAdminTriggerFactionFreeze failed (${res.status})`);
  return body;
}

/** Admin/mod: IPC integrity diagnostics for playable parties. */
export async function apiAdminIpcIntegrityCheck() {
  const res = await _fetch(`${API_BASE}/api/admin/ipc-integrity-check`, { credentials: "include" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiAdminIpcIntegrityCheck failed (${res.status})`);
  return body;
}

/** Admin/mod: replace faction allocations for one arena+party. */
export async function apiPutOtherOfficialsFactionAllocations(payload) {
  const res = await _fetch(`${API_BASE}/api/admin/other-officials/faction-allocations`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiPutOtherOfficialsFactionAllocations failed (${res.status})`);
  return body;
}



// ─── Internal Party Management (IPM) ───────────────────────────────────────

export async function apiGetPartyInternalTickets(slug) {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(slug)}/internal-tickets`, { credentials: "include" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiGetPartyInternalTickets failed (${res.status})`);
  return body;
}

export async function apiCreatePartyInternalTicket(slug, payload) {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(slug)}/internal-tickets`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload || {}),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiCreatePartyInternalTicket failed (${res.status})`);
  return body;
}

export async function apiApproveOrRejectPartyInternalTicket(slug, id, action, note = "") {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(slug)}/internal-tickets/${encodeURIComponent(id)}/approval`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ action, note }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiApproveOrRejectPartyInternalTicket failed (${res.status})`);
  return body;
}

export async function apiDismissPartyInternalTicket(slug, id, note = "") {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(slug)}/internal-tickets/${encodeURIComponent(id)}/dismiss`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ note }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiDismissPartyInternalTicket failed (${res.status})`);
  return body;
}

export async function apiGetPartyInternalTicketMessages(slug, id) {
  const res = await _fetch(`${API_BASE}/api/parties/${encodeURIComponent(slug)}/internal-tickets/${encodeURIComponent(id)}/messages`, { credentials: "include" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiGetPartyInternalTicketMessages failed (${res.status})`);
  return body;
}

export async function apiStaffListInternalTickets(filters = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(filters || {})) {
    if (v !== undefined && v !== null && String(v).trim() !== "") q.set(k, String(v));
  }
  const res = await _fetch(`${API_BASE}/api/staff/internal-tickets${q.toString() ? `?${q.toString()}` : ""}`, { credentials: "include" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiStaffListInternalTickets failed (${res.status})`);
  return body;
}

export async function apiStaffCreateInternalTicket(payload) {
  const res = await _fetch(`${API_BASE}/api/staff/internal-tickets`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload || {}),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiStaffCreateInternalTicket failed (${res.status})`);
  return body;
}

export async function apiStaffSetInternalTicketCosting(id, payload) {
  const res = await _fetch(`${API_BASE}/api/staff/internal-tickets/${encodeURIComponent(id)}/costing`, {
    method: "PUT", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload || {}),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiStaffSetInternalTicketCosting failed (${res.status})`);
  return body;
}

export async function apiStaffSetInternalTicketOutcome(id, payload) {
  const res = await _fetch(`${API_BASE}/api/staff/internal-tickets/${encodeURIComponent(id)}/outcome`, {
    method: "PUT", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload || {}),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiStaffSetInternalTicketOutcome failed (${res.status})`);
  return body;
}

export async function apiStaffCancelInternalTicket(id, reason = "") {
  const res = await _fetch(`${API_BASE}/api/staff/internal-tickets/${encodeURIComponent(id)}/cancel`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ reason }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiStaffCancelInternalTicket failed (${res.status})`);
  return body;
}

export async function apiStaffCreateInternalTicketMessage(id, payload) {
  const res = await _fetch(`${API_BASE}/api/staff/internal-tickets/${encodeURIComponent(id)}/messages`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(payload || {}),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiStaffCreateInternalTicketMessage failed (${res.status})`);
  return body;
}

export async function apiStaffGetInternalTicketMessages(id) {
  const res = await _fetch(`${API_BASE}/api/staff/internal-tickets/${encodeURIComponent(id)}/messages`, { credentials: "include" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiStaffGetInternalTicketMessages failed (${res.status})`);
  return body;
}
/** Fetch the active character's political capital state from the server. */
export async function apiGetMyPoliticalState() {
  const res = await _fetch(`${API_BASE}/api/me/political-state`, { credentials: "include" });
  if (!res.ok) throw new Error(`apiGetMyPoliticalState failed (${res.status})`);
  return res.json();
}

// ─── Support ticketing system ──────────────────────────────────────────────────

/** Player: list my support tickets */
export async function apiGetMyTickets() {
  const res = await _fetch(`${API_BASE}/api/support/tickets`, { credentials: "include" });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `apiGetMyTickets failed (${res.status})`); }
  return res.json();
}

/** Player: create a new support ticket */
export async function apiCreateTicket(subject, category, message) {
  const res = await _fetch(`${API_BASE}/api/support/tickets`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ subject, category, message }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiCreateTicket failed (${res.status})`);
  return body;
}

/** Player: get a specific ticket + messages */
export async function apiGetTicket(id) {
  const res = await _fetch(`${API_BASE}/api/support/tickets/${encodeURIComponent(id)}`, { credentials: "include" });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `apiGetTicket failed (${res.status})`); }
  return res.json();
}

/** Player: post a message to a ticket */
export async function apiPostTicketMessage(id, message) {
  const res = await _fetch(`${API_BASE}/api/support/tickets/${encodeURIComponent(id)}/messages`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ message }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiPostTicketMessage failed (${res.status})`);
  return body;
}

/** Player: update ticket status (finish / reopen) */
export async function apiPatchTicket(id, status) {
  const res = await _fetch(`${API_BASE}/api/support/tickets/${encodeURIComponent(id)}`, {
    method: "PATCH", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ status }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiPatchTicket failed (${res.status})`);
  return body;
}

/** Staff: list all support tickets (optional ?status= and ?label= filters) */
export async function apiStaffGetTickets(filters = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.label)  params.set("label", filters.label);
  if (filters.limit  != null) params.set("limit",  String(filters.limit));
  if (filters.offset != null) params.set("offset", String(filters.offset));
  const qs = params.toString() ? `?${params}` : "";
  const res = await _fetch(`${API_BASE}/api/support/staff/tickets${qs}`, { credentials: "include" });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `apiStaffGetTickets failed (${res.status})`); }
  return res.json();
}

/** Staff: get any ticket + messages */
export async function apiStaffGetTicket(id) {
  const res = await _fetch(`${API_BASE}/api/support/staff/tickets/${encodeURIComponent(id)}`, { credentials: "include" });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `apiStaffGetTicket failed (${res.status})`); }
  return res.json();
}

/** Staff: post a message to any ticket */
export async function apiStaffPostMessage(id, message) {
  const res = await _fetch(`${API_BASE}/api/support/staff/tickets/${encodeURIComponent(id)}/messages`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ message }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiStaffPostMessage failed (${res.status})`);
  return body;
}

/** Staff: patch ticket status and/or labels */
export async function apiStaffPatchTicket(id, updates) {
  const res = await _fetch(`${API_BASE}/api/support/staff/tickets/${encodeURIComponent(id)}`, {
    method: "PATCH", credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(updates),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `apiStaffPatchTicket failed (${res.status})`);
  return body;
}
