import { requireAdmin } from "../auth.js";
import { esc } from "../ui.js";
import { runSundayRoll } from "../engines/core-engine.js";
import { saveState } from "../core.js";
import {
  apiLogout, apiGetState, apiGetConfig, apiSaveConfig,
  apiGetSnapshots, apiSaveSnapshot, apiRestoreSnapshot,
  apiGetAuditLog,
  apiGetDiscourseConfig, apiSaveDiscourseConfig, apiTestDiscourse,
  apiGetDiscourseCategoryIds, apiSaveDiscourseCategoryIds,
  apiGetDiscourseSyncPreview, apiAdminSyncDiscourseGroups, apiAdminSyncDiscourseGroupsStatus, apiSetUserRoles,
  apiAdminClearCache, apiAdminRebuildCache, apiAdminRotateSessions,
  apiAdminForceLogoutAll, apiAdminCloseStaleDiv, apiAdminCloseOrphanMotionDivisions,
  apiGetSsoReadiness,
  apiGetAdminDashboard, apiAdminDiscourseSyncDebates,
  apiGetPendingRegistrations, apiApproveRegistration, apiRejectRegistration,
  apiWipeContent, apiWipeWithCharacters,
  apiAdminRepairCharacterOwners,
  apiAdminGetUsers, apiAdminGetCharacters,
  apiAdminAssignCharacterOwner, apiAdminSetUserActiveCharacter,
  apiAdminAssignNpcManager,
  apiGetHealth,
  apiGetAdminSnapshotStatus,
  apiGetSimFreeze, apiSetSimFreeze,
  apiClockStart, apiClockPause, apiClockUnpause,
} from "../api.js";
import { logAction } from "../audit.js";
import { toastError } from "../components/toast.js";
import { toastSuccess } from "../components/toast.js";

function isSundayToday() { return new Date().getDay() === 0; }
function nextSundayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const add = (7 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + add);
  return d.toISOString();
}

const SYNC_POLL_INTERVAL_MS = 2000;

const DISCOURSE_CATEGORY_KINDS = [
  { key: "bills",       label: "Bills Debate Category ID" },
  { key: "motions",     label: "Motions Debate Category ID" },
  { key: "statements",  label: "Statements Debate Category ID" },
  { key: "regulations", label: "Regulations Debate Category ID" },
];

export async function initAdminPanelPage(data) {
  const user = await requireAdmin();
  if (!user) return;

  const host = document.getElementById("admin-panel-root") || document.querySelector("main.wrap");
  if (!host) return;

  let currentConfig = {};
  let snapshots = [];
  let currentSnapshotId = null;
  let snapshotStatus = null;
  let auditEntries = [];
  let auditTotal = 0;
  let auditFilters = { action: "", target: "", limit: 50, offset: 0 };
  let discourseConfig = { base_url: "", has_api_key: false, has_api_username: false, has_sso_secret: false };
  let discourseCategoryIds = { bills: null, motions: null, statements: null, regulations: null };
  let syncPreview = [];
  let syncResults = null;  // null = never run; object = last sync results
  let _syncPollTimer = null;  // active polling interval; hoisted so re-renders don't orphan it
  let ssoReadiness = null; // null = not yet loaded; object = readiness check results
  let dashboardData = null; // moderator dashboard summary
  let debateSyncResults = {}; // map kind -> last sync result
  let pendingRegistrations = []; // pending registration applications
  let simFreeze = { is_frozen: false, reason: null, updated_at: null };

  // ── User–Character Management state ─────────────────────────────────────
  let charMgmtUsers = [];        // users with active_character info
  let charMgmtUnowned = [];      // unowned characters
  let charMgmtUserChars = {};    // map userId → owned characters (loaded on demand)

  async function loadDashboard() {
    try {
      dashboardData = await apiGetAdminDashboard();
    } catch (err) {
      console.error("Failed to load dashboard:", err);
      dashboardData = null;
    }
  }

  function renderPendingRegistrations() {
    const rows = pendingRegistrations.map((r) => `
      <tr data-reg-id="${esc(r.id)}">
        <td style="padding:6px 8px;">${esc(r.display_name || "")}</td>
        <td style="padding:6px 8px;">${esc(r.username)}</td>
        <td style="padding:6px 8px;">${esc(r.email)}</td>
        <td style="padding:6px 8px;">${r.age_attested ? "✓" : "✗"}</td>
        <td style="padding:6px 8px;">${r.email_verified ? "✓" : "✗"}</td>
        <td style="padding:6px 8px;">${r.created_at ? new Date(r.created_at).toLocaleString("en-GB") : ""}</td>
        <td style="padding:6px 8px;white-space:nowrap;">
          <button class="btn btn-approve" data-id="${esc(r.id)}" style="margin-right:6px;">Approve</button>
          <button class="btn danger btn-reject" data-id="${esc(r.id)}">Reject</button>
        </td>
      </tr>`).join("");

    return `<section class="panel" style="max-width:900px;margin-top:12px;" id="pending-reg-section">
      <h2 style="margin-top:0;">Pending Registrations
        <span style="font-size:14px;font-weight:400;color:var(--muted);margin-left:8px;">(${pendingRegistrations.length} pending)</span>
      </h2>
      ${pendingRegistrations.length === 0
        ? `<p class="muted">No pending applications.</p>`
        : `<div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
              <thead>
                <tr style="border-bottom:2px solid var(--line);">
                  <th style="text-align:left;padding:6px 8px;">Name</th>
                  <th style="text-align:left;padding:6px 8px;">Username</th>
                  <th style="text-align:left;padding:6px 8px;">Email</th>
                  <th style="text-align:left;padding:6px 8px;">16+</th>
                  <th style="text-align:left;padding:6px 8px;">Email ✓</th>
                  <th style="text-align:left;padding:6px 8px;">Applied</th>
                  <th style="text-align:left;padding:6px 8px;">Actions</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`
      }
    </section>`;
  }

  function renderModDashboard() {
    if (!dashboardData) {
      return `<section class="panel" style="margin-top:12px;">
        <h2 style="margin-top:0;">Moderator Dashboard</h2>
        <p class="muted">Loading dashboard data…</p>
      </section>`;
    }
    const { pendingQtQuestions, openDivisions, awaitingDebates = {}, ongoingDebates = {}, recentAuditLog, pendingRegistrations: pendingRegsCount } = dashboardData;
    const auditRows = (recentAuditLog || []).map((e) => {
      const details = typeof e.details === "object" && e.details ? e.details : {};
      const headline = details.headline || "";
      const simDate = (details.simMonth && details.simYear)
        ? `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(details.simMonth) - 1] || details.simMonth} ${details.simYear}`
        : "";
      const characterName = details.characterName || "";
      const officeName = details.officeName || "";
      const detailHint = [characterName && `👤 ${characterName}`, officeName && `🏛 ${officeName}`, simDate && `📅 ${simDate}`].filter(Boolean).join(" · ");
      return `<tr>
        <td>${esc(e.created_at ? new Date(e.created_at).toLocaleString("en-GB") : "")}</td>
        <td style="font-size:12px;" title="${esc(e.actor_id || "")}">${esc(e.actor_name || "")}</td>
        <td>${esc(e.action || "")}</td>
        <td>${esc(e.target || "")}</td>
        <td style="font-size:12px;">
          ${headline ? `<div style="font-weight:500;">${esc(headline)}</div>` : ""}
          ${detailHint ? `<div style="color:#666;margin-top:2px;">${esc(detailHint)}</div>` : ""}
        </td>
      </tr>`;
    }).join("");

    const syncKinds = ["bills", "motions", "statements", "regulations"];
    const syncMsg = syncKinds
      .filter((k) => debateSyncResults[k])
      .map((k) => {
        const r = debateSyncResults[k];
        return r.ok
          ? `<span class="sync-ok">✓ ${k}: synced ${r.synced}</span>`
          : `<span class="sync-err">✗ ${k}: ${esc(r.error || "sync failed")}</span>`;
      })
      .join(" &nbsp;·&nbsp; ");

    return `<section class="panel" style="margin-top:12px;">
      <h2 style="margin-top:0;">Moderator Dashboard</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-bottom:16px;">
        <div class="tile card-flex" style="text-align:center;">
          <div style="font-size:2rem;font-weight:700;">${pendingRegsCount ?? "—"}</div>
          <div>Pending Registrations</div>
          <div class="tile-bottom"><a href="#pending-reg-section" class="btn btn-sm">Review</a></div>
        </div>
        <div class="tile card-flex" style="text-align:center;">
          <div style="font-size:2rem;font-weight:700;">${pendingQtQuestions ?? "—"}</div>
          <div>Pending QT Questions</div>
          <div class="tile-bottom"><a href="questiontime.html" class="btn btn-sm">View</a></div>
        </div>
        <div class="tile card-flex" style="text-align:center;">
          <div style="font-size:2rem;font-weight:700;">${openDivisions ?? "—"}</div>
          <div>Open Divisions</div>
          <div class="tile-bottom"></div>
        </div>
      </div>

      <h3 style="margin:0 0 8px 0;">Parliament Control Panel</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-bottom:4px;">
        <div class="tile card-flex" style="text-align:center;">
          <div style="font-size:1.6rem;font-weight:700;">${ongoingDebates.bills ?? "—"}</div>
          <div>Ongoing Bill Debates</div>
          <div class="muted" style="font-size:12px;margin-top:4px;">Awaiting: ${awaitingDebates.bills ?? "—"}</div>
          <div class="tile-bottom"><button class="btn btn-sm btn-sync-debate-kind" data-kind="bills">Sync Missing</button></div>
        </div>
        <div class="tile card-flex" style="text-align:center;">
          <div style="font-size:1.6rem;font-weight:700;">${ongoingDebates.motions ?? "—"}</div>
          <div>Ongoing House Motion Debates</div>
          <div class="muted" style="font-size:12px;margin-top:4px;">Awaiting: ${awaitingDebates.motions ?? "—"}</div>
          <div class="tile-bottom"><button class="btn btn-sm btn-sync-debate-kind" data-kind="motions">Sync Missing</button></div>
        </div>
        <div class="tile card-flex" style="text-align:center;">
          <div style="font-size:1.6rem;font-weight:700;">${ongoingDebates.statements ?? "—"}</div>
          <div>Ongoing Statement Debates</div>
          <div class="muted" style="font-size:12px;margin-top:4px;">Awaiting: ${awaitingDebates.statements ?? "—"}</div>
          <div class="tile-bottom"><button class="btn btn-sm btn-sync-debate-kind" data-kind="statements">Sync Missing</button></div>
        </div>
        <div class="tile card-flex" style="text-align:center;">
          <div style="font-size:1.6rem;font-weight:700;">${ongoingDebates.regulations ?? "—"}</div>
          <div>Ongoing Regulation Debates</div>
          <div class="muted" style="font-size:12px;margin-top:4px;">Awaiting: ${awaitingDebates.regulations ?? "—"}</div>
          <div class="tile-bottom"><button class="btn btn-sm btn-sync-debate-kind" data-kind="regulations">Sync Missing</button></div>
        </div>
      </div>
      ${syncMsg ? `<div style="margin-bottom:12px;font-size:13px;padding:6px 0;">${syncMsg}</div>` : `<div style="margin-bottom:12px;"></div>`}
      <h3 style="margin-top:0;">Recent Audit Log</h3>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="border-bottom:2px solid #ddd;">
              <th style="text-align:left;padding:4px 8px;">Time</th>
              <th style="text-align:left;padding:4px 8px;">Actor</th>
              <th style="text-align:left;padding:4px 8px;">Action</th>
              <th style="text-align:left;padding:4px 8px;">Target</th>
              <th style="text-align:left;padding:4px 8px;">Details</th>
            </tr>
          </thead>
          <tbody>${auditRows || `<tr><td colspan="5" class="muted" style="padding:8px;">No recent audit entries.</td></tr>`}</tbody>
        </table>
      </div>
      <a href="#audit-log-section" style="font-size:13px;display:block;margin-top:8px;">View full audit log ↓</a>
    </section>`;
  }

  async function loadConfig() {
    try {
      const result = await apiGetConfig();
      currentConfig = result?.config || {};
    } catch (err) {
      console.error("Failed to load config:", err);
      toastError("Failed to load config.");
      currentConfig = {};
    }
  }

  async function loadDiscourseConfig() {
    try {
      discourseConfig = await apiGetDiscourseConfig();
    } catch (err) {
      console.error("Failed to load discourse config:", err);
      toastError("Failed to load Discourse config.");
    }
  }

  async function loadDiscourseCategoryIds() {
    try {
      discourseCategoryIds = await apiGetDiscourseCategoryIds();
    } catch (err) {
      console.error("Failed to load Discourse category IDs:", err);
      // Non-fatal; silently keep defaults
    }
  }

  async function loadSnapshots() {
    try {
      const result = await apiGetSnapshots();
      snapshots = result?.snapshots || [];
      currentSnapshotId = result?.currentId ?? null;
    } catch (err) {
      console.error("Failed to load snapshots:", err);
      toastError("Failed to load snapshots.");
      snapshots = [];
      currentSnapshotId = null;
    }
  }

  async function loadSnapshotStatus() {
    try {
      snapshotStatus = await apiGetAdminSnapshotStatus();
    } catch (err) {
      console.error("Failed to load snapshot status:", err);
      snapshotStatus = null;
    }
  }

  async function loadAuditLog() {
    try {
      const result = await apiGetAuditLog(auditFilters);
      auditEntries = result?.entries || [];
      auditTotal = result?.total ?? 0;
    } catch (err) {
      console.error("Failed to load audit log:", err);
      toastError("Failed to load audit log.");
      auditEntries = [];
      auditTotal = 0;
    }
  }

  async function loadSyncPreview() {
    try {
      const result = await apiGetDiscourseSyncPreview();
      syncPreview = result?.preview || [];
    } catch (err) {
      console.error("Failed to load Discourse sync preview:", err);
      toastError("Failed to load Discourse sync preview.");
      syncPreview = [];
    }
  }

  async function loadSsoReadiness() {
    try {
      ssoReadiness = await apiGetSsoReadiness();
    } catch (err) {
      console.error("Failed to load SSO readiness:", err);
      ssoReadiness = null;
    }
  }

  function renderConfigFields() {
    const fields = [
      { key: "discourse_base_url", label: "Discourse Base URL", placeholder: "https://forum.rulebritannia.org" },
      { key: "ui_base_url",        label: "UI Base URL",        placeholder: "https://rulebritannia.org" },
      { key: "sim_start_date",     label: "Sim Start Date",     placeholder: "1997-08-01" },
      { key: "clock_rate",         label: "Clock Rate (sim months/week)", placeholder: "2" },
    ];
    return fields
      .map(
        ({ key, label, placeholder }) => `
      <div class="kv" style="align-items:center;gap:8px;">
        <label for="cfg-${esc(key)}" style="min-width:200px;">${esc(label)}</label>
        <input id="cfg-${esc(key)}" name="${esc(key)}" type="text"
               value="${esc(currentConfig[key] ?? "")}"
               placeholder="${esc(placeholder)}"
               style="flex:1;padding:4px 8px;border:1px solid #ccc;border-radius:4px;" />
      </div>`
      )
      .join("\n");
  }

  function renderDiscourseSection(status) {
    const keyPlaceholder     = discourseConfig.has_api_key      ? "(already set — leave blank to keep)" : "Paste API key…";
    const userPlaceholder    = discourseConfig.has_api_username  ? "(already set — leave blank to keep)" : "system";
    const ssoSecretPh        = discourseConfig.has_sso_secret    ? "(already set — leave blank to keep)" : "Paste DiscourseConnect secret…";
    const testResult         = status && status.startsWith("disc-test:") ? status.slice(10) : "";
    const saveResult         = status && status.startsWith("disc-save:") ? status.slice(10) : "";
    const catSaveResult      = status && status.startsWith("disc-cat:") ? status.slice(9) : "";

    return `
      <section class="panel" style="max-width:600px;margin-top:12px;">
        <h2 style="margin-top:0;">Discourse Integration</h2>
        <form id="discourse-config-form" style="display:flex;flex-direction:column;gap:10px;">
          <div class="kv" style="align-items:center;gap:8px;">
            <label for="disc-base-url" style="min-width:200px;">Discourse Base URL</label>
            <input id="disc-base-url" name="base_url" type="url"
                   value="${esc(discourseConfig.base_url || "")}"
                   placeholder="https://forum.rulebritannia.org"
                   style="flex:1;padding:4px 8px;border:1px solid #ccc;border-radius:4px;" />
          </div>
          <div class="kv" style="align-items:center;gap:8px;">
            <label for="disc-api-key" style="min-width:200px;">API Key</label>
            <input id="disc-api-key" name="api_key" type="password"
                   placeholder="${esc(keyPlaceholder)}"
                   autocomplete="new-password"
                   style="flex:1;padding:4px 8px;border:1px solid #ccc;border-radius:4px;" />
          </div>
          <div class="kv" style="align-items:center;gap:8px;">
            <label for="disc-api-username" style="min-width:200px;">API Username</label>
            <input id="disc-api-username" name="api_username" type="text"
                   placeholder="${esc(userPlaceholder)}"
                   style="flex:1;padding:4px 8px;border:1px solid #ccc;border-radius:4px;" />
          </div>
          <div class="kv" style="align-items:center;gap:8px;">
            <label for="disc-sso-secret" style="min-width:200px;">DiscourseConnect SSO Secret</label>
            <input id="disc-sso-secret" name="sso_secret" type="password"
                   placeholder="${esc(ssoSecretPh)}"
                   autocomplete="off"
                   style="flex:1;padding:4px 8px;border:1px solid #ccc;border-radius:4px;" />
          </div>
          <p style="font-size:12px;color:#777;margin:0;">
            Find the SSO secret in your Discourse admin under Settings → Login → sso secret.
            Leave blank to keep the current value.
          </p>
          <p style="font-size:12px;color:#555;margin:4px 0 0;">
            See <strong>SSO Readiness</strong> below for the exact DiscourseConnect URL to configure in Discourse,
            and for a checklist of all prerequisites.
          </p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn" type="submit">Save</button>
            <button class="btn" id="btn-discourse-test" type="button">Test Connection</button>
          </div>
        </form>
        ${saveResult ? `<div style="margin-top:10px;font-size:13px;">${esc(saveResult)}</div>` : ""}
        <div id="discourse-test-result" style="margin-top:10px;font-size:13px;">${esc(testResult)}</div>

        <h3 style="margin:18px 0 8px;">Debate Category IDs</h3>
        <p style="font-size:12px;color:#555;margin:0 0 10px;">
          Numeric Discourse category IDs used when creating debate topics for each entity type.
          Must be a positive integer. Find these in your Discourse admin under Categories.
        </p>
        <form id="discourse-category-ids-form" style="display:flex;flex-direction:column;gap:10px;">
          ${DISCOURSE_CATEGORY_KINDS.map(({ key, label }) => `
          <div class="kv" style="align-items:center;gap:8px;">
            <label for="disc-cat-${esc(key)}" style="min-width:200px;">${esc(label)}</label>
            <input id="disc-cat-${esc(key)}" name="${esc(key)}" type="number" min="1" step="1"
                   value="${discourseCategoryIds[key] != null ? esc(String(discourseCategoryIds[key])) : ""}"
                   placeholder="e.g. 9"
                   style="flex:1;padding:4px 8px;border:1px solid #ccc;border-radius:4px;" />
          </div>`).join("")}
          <div>
            <button class="btn" type="submit">Save Category IDs</button>
          </div>
        </form>
        ${catSaveResult ? `<div id="disc-cat-status" style="margin-top:10px;font-size:13px;">${esc(catSaveResult)}</div>` : ""}
      </section>`;
  }

  function renderSnapshotStatusSummary() {
    const st = snapshotStatus;
    if (!st) {
      return `<p class="muted-block" style="margin-bottom:10px;">Snapshot status unavailable.</p>`;
    }
    const freezeText = st.freeze?.isFrozen
      ? `Frozen${st.freeze?.reason ? ` — ${esc(st.freeze.reason)}` : ""}`
      : "Not frozen";
    const lastRestoreText = st.lastRestore?.at
      ? `${new Date(st.lastRestore.at).toLocaleString()}${st.lastRestore.snapshotId ? ` (${esc(String(st.lastRestore.snapshotId).slice(0, 8))}…)` : ""}`
      : "Never";
    const lastRebuildText = st.lastRebuild?.at
      ? `${new Date(st.lastRebuild.at).toLocaleString()}${st.lastRebuild?.status ? ` (${esc(st.lastRebuild.status)})` : ""}`
      : "Never";
    return `
      <div class="muted-block" style="margin-bottom:10px;font-size:12px;line-height:1.4;">
        <div><b>Current snapshot:</b> ${st.currentSnapshot?.label ? esc(st.currentSnapshot.label) : "—"} ${st.currentSnapshot?.id ? `<span style="font-family:monospace;">(${esc(String(st.currentSnapshot.id).slice(0, 8))}…)</span>` : ""}</div>
        <div><b>Last restore:</b> ${lastRestoreText}</div>
        <div><b>Last rebuild:</b> ${lastRebuildText}</div>
        <div><b>Freeze state:</b> ${freezeText}</div>
      </div>`;
  }

  function renderSnapshotsList() {
    if (!snapshots.length) return '<p class="muted-block">No snapshots saved yet.</p>';
    const recent = snapshots.slice(0, 5);
    return `
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="border-bottom:1px solid #ccc;">
            <th style="text-align:left;padding:4px 8px;">Label</th>
            <th style="text-align:left;padding:4px 8px;">Created</th>
            <th style="text-align:left;padding:4px 8px;">ID</th>
            <th style="padding:4px 8px;"></th>
          </tr>
        </thead>
        <tbody>
          ${recent.map((s) => `
            <tr style="border-bottom:1px solid #eee;${s.id === currentSnapshotId ? "background:#f0f8f0;" : ""}">
              <td style="padding:4px 8px;">
                ${esc(s.label)}
                ${s.id === currentSnapshotId ? ' <span style="color:#2a7;font-size:11px;">(current)</span>' : ""}
              </td>
              <td style="padding:4px 8px;">${esc(new Date(s.created_at).toLocaleString())}</td>
              <td style="padding:4px 8px;font-family:monospace;font-size:11px;">${esc(s.id.slice(0, 8))}…</td>
              <td style="padding:4px 8px;">
                ${s.id !== currentSnapshotId
                  ? `<button class="btn btn-restore" data-id="${esc(s.id)}" type="button" style="font-size:12px;padding:2px 8px;">Restore</button>`
                  : ""}
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
      ${snapshots.length > 5 ? `<p style="font-size:12px;color:#888;margin-top:6px;">Showing 5 most recent of ${snapshots.length} snapshots.</p>` : ""}`;
  }

  function renderAuditLog() {
    const actionOptions = [
      "", "config-saved", "snapshot-saved", "snapshot-restored",
      "economy-saved", "question-answered", "question-closed", "speaker-demand",
      "poll-published", "bill-stage-changed", "office-assigned", "faction.switch",
    ];

    const pageCount = Math.max(1, Math.ceil(auditTotal / auditFilters.limit));
    const currentPage = Math.floor(auditFilters.offset / auditFilters.limit) + 1;

    const entryTiles = auditEntries.length
      ? auditEntries.map((e) => `
          <article class="tile" style="margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:12px;" class="muted">
              <span><b>${esc(e.action)}</b>${e.target ? ` &mdash; ${esc(e.target)}` : ""}</span>
              <span>${esc(new Date(e.created_at).toLocaleString())}</span>
            </div>
            <div style="font-size:12px;margin-top:4px;">Actor: <code>${esc(e.actor_id)}</code></div>
            ${Object.keys(e.details || {}).length
              ? `<pre style="margin:6px 0 0;font-size:11px;white-space:pre-wrap;background:#f5f5f5;padding:4px 8px;border-radius:4px;">${esc(JSON.stringify(e.details, null, 2))}</pre>`
              : ""}
          </article>`).join("")
      : '<p class="muted-block">No audit log entries match the current filters.</p>';

    return `
      <section id="audit-log-section" class="panel" style="max-width:800px;margin-top:12px;">
        <h2 style="margin-top:0;">Audit Log</h2>

        <form id="audit-filter-form" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px;">
          <div style="display:flex;flex-direction:column;gap:4px;">
            <label style="font-size:12px;">Action</label>
            <select id="audit-filter-action" name="action" style="padding:4px 8px;border:1px solid #ccc;border-radius:4px;">
              ${actionOptions.map((a) => `<option value="${esc(a)}" ${a === auditFilters.action ? "selected" : ""}>${esc(a || "— all actions —")}</option>`).join("")}
            </select>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;">
            <label style="font-size:12px;">Target contains</label>
            <input type="text" id="audit-filter-target" name="target" value="${esc(auditFilters.target)}"
                   placeholder="bill title, office…"
                   style="padding:4px 8px;border:1px solid #ccc;border-radius:4px;min-width:160px;" />
          </div>
          <button class="btn" type="submit" style="align-self:flex-end;">Filter</button>
          <button class="btn" type="button" id="audit-clear-filters" style="align-self:flex-end;">Clear</button>
        </form>

        <div id="audit-entries" style="max-height:320px;overflow-y:auto;overflow-x:hidden;">${entryTiles}</div>

        <div style="display:flex;gap:8px;align-items:center;margin-top:10px;font-size:13px;">
          <span>${esc(String(auditTotal))} total</span>
          ${currentPage > 1 ? `<button class="btn" id="audit-prev" type="button" style="font-size:12px;padding:2px 10px;">← Prev</button>` : ""}
          <span>Page ${esc(String(currentPage))} / ${esc(String(pageCount))}</span>
          ${currentPage < pageCount ? `<button class="btn" id="audit-next" type="button" style="font-size:12px;padding:2px 10px;">Next →</button>` : ""}
        </div>
      </section>`;
  }

  function renderSyncResults(results) {
    if (!results) return "";
    const { groups = [], totalAdded = 0, totalRemoved = 0, totalSkipped = 0 } = results;
    const changedGroups = groups.filter((g) => g.added.length || g.removed.length || g.skipped);
    return `
      <div id="sync-results" style="margin-top:16px;padding:12px;background:#f9f9f9;border:1px solid #ddd;border-radius:6px;">
        <b>Last Sync Results</b>
        <p style="font-size:13px;margin:6px 0;">
          Added: <b>${esc(String(totalAdded))}</b> user–group memberships &nbsp;|&nbsp;
          Removed: <b>${esc(String(totalRemoved))}</b> &nbsp;|&nbsp;
          Groups with errors: <b>${esc(String(totalSkipped))}</b>
        </p>
        ${changedGroups.length ? `
          <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px;">
            <thead>
              <tr style="border-bottom:1px solid #ccc;">
                <th style="text-align:left;padding:3px 8px;">Group</th>
                <th style="text-align:left;padding:3px 8px;">Added</th>
                <th style="text-align:left;padding:3px 8px;">Removed</th>
                <th style="text-align:left;padding:3px 8px;">Error</th>
              </tr>
            </thead>
            <tbody>
              ${changedGroups.map((g) => `
                <tr style="border-bottom:1px solid #eee;${g.skipped ? "color:#b00;" : ""}">
                  <td style="padding:3px 8px;">${esc(g.group)}</td>
                  <td style="padding:3px 8px;">${esc(g.added.join(", ") || "—")}</td>
                  <td style="padding:3px 8px;">${esc(g.removed.join(", ") || "—")}</td>
                  <td style="padding:3px 8px;">${esc(g.skipped || "")}</td>
                </tr>`).join("")}
            </tbody>
          </table>` : `<p style="font-size:13px;color:#555;margin:6px 0;">No membership changes needed.</p>`}
      </div>`;
  }

  function renderDiscourseSyncPreview() {
    const VALID_ROLES = [
      "admin", "mod", "speaker",
      "party:labour", "party:conservative", "party:liberal_democrat",
      "office:prime_minister", "office:leader_of_opposition",
      "office:secretary_of_state", "office:shadow_secretary_of_state",
      "office:leader_of_third_party", "office:backbencher",
      "office:permanent_secretary", "office:civil_servant",
    ];

    const rows = syncPreview.length
      ? syncPreview.map((u) => `
          <tr style="border-bottom:1px solid #eee;">
            <td style="padding:4px 8px;font-size:13px;">${esc(u.username)}</td>
            <td style="padding:4px 8px;font-size:12px;">${esc(u.email)}</td>
            <td style="padding:4px 8px;font-size:12px;">${esc((u.roles || []).join(", ") || "—")}</td>
            <td style="padding:4px 8px;font-size:12px;">${esc((u.discourseGroups || []).join(", ") || "—")}</td>
            <td style="padding:4px 8px;">
              <button class="btn btn-edit-roles" data-userid="${esc(u.userId)}"
                      data-username="${esc(u.username)}"
                      data-roles="${esc(JSON.stringify(u.roles || []))}"
                      type="button" style="font-size:12px;padding:2px 8px;">Edit</button>
            </td>
          </tr>`).join("")
      : `<tr><td colspan="5" style="padding:8px;font-size:13px;color:#888;">No users found.</td></tr>`;

    return `
      <section class="panel" style="max-width:900px;margin-top:12px;">
        <h2 style="margin-top:0;">Preview Discourse Group Sync</h2>
        <p style="font-size:13px;color:#555;margin-top:0;">
          Shows what Discourse groups each user would be assigned to based on their current roles.
          Use "Sync Now" to apply these groups via the Discourse API.
        </p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
          <button class="btn" id="btn-refresh-sync-preview" type="button">Refresh Preview</button>
          <button class="btn" id="btn-sync-discourse-groups" type="button">Sync Discourse Groups Now</button>
        </div>
        <div id="sync-preview-table-wrap" style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="border-bottom:2px solid #ccc;">
                <th style="text-align:left;padding:4px 8px;">Username</th>
                <th style="text-align:left;padding:4px 8px;">Email</th>
                <th style="text-align:left;padding:4px 8px;">Roles</th>
                <th style="text-align:left;padding:4px 8px;">Discourse Groups</th>
                <th style="padding:4px 8px;"></th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>

        ${renderSyncResults(syncResults)}

        <div id="role-editor" style="display:none;margin-top:16px;padding:12px;background:#f9f9f9;border:1px solid #ddd;border-radius:6px;">
          <h3 style="margin-top:0;font-size:14px;">Edit roles for: <span id="role-editor-username"></span></h3>
          <div id="role-checkboxes" style="display:flex;flex-wrap:wrap;gap:8px 16px;margin-bottom:12px;">
            ${VALID_ROLES.map((r) => `
              <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;">
                <input type="checkbox" class="role-checkbox" value="${esc(r)}" /> ${esc(r)}
              </label>`).join("")}
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn" id="btn-save-roles" type="button">Save Roles</button>
            <button class="btn" id="btn-cancel-roles" type="button">Cancel</button>
          </div>
          <div id="role-editor-status" style="font-size:13px;margin-top:8px;"></div>
        </div>
      </section>`;
  }

  function renderSsoReadinessSection() {
    if (!ssoReadiness) {
      return `
        <section class="panel" style="max-width:700px;margin-top:12px;">
          <h2 style="margin-top:0;">SSO Readiness</h2>
          <p style="font-size:13px;color:#888;">Loading…</p>
          <button class="btn" id="btn-refresh-sso-readiness" type="button">Refresh</button>
        </section>`;
    }

    const { allOk, checks = [], ssoEntryUrl, callbackUrl } = ssoReadiness;
    const rows = checks.map((c) => {
      const icon = c.ok ? "✅" : "❌";
      return `
        <tr style="border-bottom:1px solid #eee;">
          <td style="padding:6px 10px;font-size:20px;line-height:1;">${icon}</td>
          <td style="padding:6px 10px;font-size:13px;font-weight:600;color:${c.ok ? "#2a7030" : "#b00000"};">${esc(c.label)}</td>
          <td style="padding:6px 10px;font-size:12px;color:#555;">${esc(c.detail || "")}</td>
        </tr>`;
    }).join("");

    const urlHint = ssoEntryUrl ? `
      <div style="margin-top:12px;padding:10px 14px;background:#f5f8ff;border:1px solid #c5d5f0;border-radius:6px;font-size:13px;">
        <p style="margin:0 0 6px;font-weight:600;">Discourse DiscourseConnect URL to configure:</p>
        <p style="margin:0 0 4px;">In Discourse → Admin → Settings → Login, enable <b>DiscourseConnect</b> and set <b>DiscourseConnect URL</b> to:</p>
        <code style="display:block;padding:4px 8px;background:#fff;border:1px solid #dde;border-radius:4px;word-break:break-all;">${esc(ssoEntryUrl)}</code>
        <p style="margin:6px 0 0;font-size:12px;color:#666;">No separate callback URL is required. Do <strong>not</strong> enable the <em>DiscourseConnect Provider</em> checkbox — that is for the reverse direction.</p>
      </div>` : "";

    return `
      <section class="panel" style="max-width:750px;margin-top:12px;">
        <h2 style="margin-top:0;">SSO Readiness</h2>
        <p style="font-size:13px;color:#555;margin-top:0;">
          Checks whether all prerequisites for DiscourseConnect SSO are satisfied.
          The SSO endpoints are only active when <code>DISCOURSE_SSO_ENABLED=true</code> is set on the server.
        </p>
        <div style="margin-bottom:10px;padding:8px 12px;border-radius:6px;font-weight:600;font-size:13px;
                    background:${allOk ? "#eaf6ea" : "#fdf2f2"};color:${allOk ? "#2a7030" : "#b00000"};">
          ${allOk ? "✅ All checks passed — SSO is ready to enable." : "❌ One or more checks failed — see details below."}
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <tbody>${rows}</tbody>
        </table>
        ${urlHint}
        <div style="margin-top:10px;">
          <button class="btn" id="btn-refresh-sso-readiness" type="button">Refresh</button>
        </div>
      </section>`;
  }

  function renderSystemHealthSection() {
    return `
      <section class="panel" style="max-width:700px;margin-top:12px;" id="system-health-section">
        <h2 style="margin-top:0;">System Sanity Check</h2>
        <p style="font-size:13px;color:#555;margin-top:0;">
          Verify the server liveness probe and the shared game-state record are accessible.
        </p>
        <button class="btn" id="btn-system-health-check" type="button">Run Check</button>
        <div id="system-health-results" style="margin-top:12px;font-size:13px;"></div>
      </section>`;
  }

  function renderMaintenanceSection() {
    return `
      <section class="panel" style="max-width:700px;margin-top:12px;">
        <h2 style="margin-top:0;">Maintenance</h2>

        <div style="display:flex;flex-direction:column;gap:14px;">

          <div class="muted-block" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
            <div>
              <b>Clear Object Cache</b>
              <p style="margin:4px 0 0;font-size:13px;color:#555;">
                Truncates the object-cache tables (bills, motions, statements, regulations, question-time).
                Does not affect user accounts, characters, or gameplay history.
                Use before a rebuild or to free space.
              </p>
            </div>
            <button class="btn" id="btn-clear-cache" type="button">Clear Cache</button>
          </div>

          <div class="muted-block" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
            <div>
              <b>Rebuild Derived State</b>
              <p style="margin:4px 0 0;font-size:13px;color:#555;">
                Re-syncs only derived object-cache tables from the current active snapshot.
                It does not overwrite relational-authoritative gameplay tables.
              </p>
            </div>
            <button class="btn" id="btn-rebuild-cache" type="button">Rebuild Cache</button>
          </div>

          <div class="muted-block" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
            <div>
              <b>Rotate My Session</b>
              <p style="margin:4px 0 0;font-size:13px;color:#555;">
                Issues a new session ID and CSRF token for your current login.
                Invalidates the old session cookie.
              </p>
            </div>
            <button class="btn" id="btn-rotate-session" type="button">Rotate Session</button>
          </div>

          <div class="muted-block" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
            <div>
              <b>Repair Character Owner Pointers</b>
              <p style="margin:4px 0 0;font-size:13px;color:#555;">
                Reconciles approved character applications whose created characters have a missing or
                incorrect <code>user_id</code>, and repairs missing <code>users.active_character_id</code> pointers.
                Safe to run multiple times — only fixes records that need it.
              </p>
              <div id="repair-char-owners-status" style="font-size:13px;margin-top:6px;"></div>
              <div id="repair-char-owners-diagnostics" style="font-size:12px;margin-top:4px;color:#555;"></div>
            </div>
            <button class="btn" id="btn-repair-char-owners" type="button">Run Repair</button>
          </div>

          <div class="muted-block" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
            <div>
              <b>Close Stale Divisions</b>
              <p style="margin:4px 0 0;font-size:13px;color:#555;">
                Closes all divisions whose status is still <code>open</code> (marks them as abandoned).
                Use this to clear stale divisions that were never properly closed.
              </p>
              <div id="close-stale-div-status" style="font-size:13px;margin-top:4px;"></div>
            </div>
            <button class="btn" id="btn-close-stale-div" type="button">Close Stale</button>
          </div>

          <div class="muted-block" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
            <div>
              <b>Close Orphan Motion Divisions</b>
              <p style="margin:4px 0 0;font-size:13px;color:#555;">
                Closes all open divisions for motions whose motion record no longer exists (orphaned).
                Updates status to <code>closed</code>, sets <code>closes_at</code> to now, and writes an audit entry.
              </p>
              <div id="close-orphan-motion-div-status" style="font-size:13px;margin-top:4px;"></div>
            </div>
            <button class="btn" id="btn-close-orphan-motion-div" type="button">Close Orphans</button>
          </div>

          <div class="muted-block" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
            <div>
              <b>Force Logout All Users</b>
              <p style="margin:4px 0 0;font-size:13px;color:#555;">
                Terminates every active session except yours. All other users will be logged out immediately.
              </p>
            </div>
            <button class="btn" id="btn-force-logout-all" type="button" style="border-color:rgba(212,0,26,.3);color:#b00;">Force Logout All</button>
          </div>

        </div>
      </section>`;
  }

  function renderUserCharacterManagement() {
    const unownedRows = charMgmtUnowned.map((c) => {
      const npcBadge = c.is_npc
        ? `<span style="display:inline-block;background:#0b2d6b;color:#fff;font-size:.7em;padding:1px 5px;border-radius:8px;margin-right:4px;vertical-align:middle;">NPC</span>`
        : "";
      const managedByInfo = c.is_npc && c.managed_by_username
        ? `<div style="font-size:11px;color:#888;margin-top:2px;">Manager: ${esc(c.managed_by_username)}</div>`
        : "";
      return `
      <tr data-char-id="${esc(c.id)}">
        <td style="padding:6px 8px;">${npcBadge}${esc(c.name)}${managedByInfo}</td>
        <td style="padding:6px 8px;">${esc(c.party || "—")}</td>
        <td style="padding:6px 8px;">${esc(c.constituency || "—")}</td>
        <td style="padding:6px 8px;">${c.is_active ? "✓ Active" : "Inactive"}</td>
        <td style="padding:6px 8px;white-space:nowrap;">
          <select class="input ucm-user-select" style="font-size:12px;padding:2px 6px;margin-right:4px;" data-char-id="${esc(c.id)}">
            <option value="">— select user —</option>
            ${charMgmtUsers.map((u) => `<option value="${esc(u.id)}">${esc(u.username)}</option>`).join("")}
          </select>
          ${c.is_npc
            ? `<button class="btn ucm-assign-npc-manager-btn" data-char-id="${esc(c.id)}" type="button" style="font-size:12px;padding:2px 8px;margin-right:4px;" title="Set this user as the manager of this NPC (managed_by_user_id). Intended for party leaders or other eligible users.">Assign NPC Manager</button>`
            : ""}
          <button class="btn ucm-assign-btn" data-char-id="${esc(c.id)}" type="button" style="font-size:12px;padding:2px 8px;margin-right:4px;">Assign as Active PC</button>
          <button class="btn ucm-assign-active-btn" data-char-id="${esc(c.id)}" type="button" style="font-size:12px;padding:2px 8px;">Assign + Set Active</button>
        </td>
      </tr>`;
    }).join("");

    const userRows = charMgmtUsers.map((u) => `
      <tr data-user-id="${esc(u.id)}">
        <td style="padding:6px 8px;">${esc(u.username)}</td>
        <td style="padding:6px 8px;">${u.activeCharacterId ? `${esc(u.activeCharacter || u.activeCharacterId)}` : '<span style="color:#aaa;">None</span>'}</td>
        <td style="padding:6px 8px;white-space:nowrap;">
          ${u.activeCharacterId ? `<button class="btn ucm-clear-active-btn" data-user-id="${esc(u.id)}" type="button" style="font-size:12px;padding:2px 8px;margin-right:4px;">Clear</button>` : ""}
          <select class="input ucm-set-active-select" style="font-size:12px;padding:2px 6px;margin-right:4px;" data-user-id="${esc(u.id)}">
            <option value="">— owned characters —</option>
          </select>
          <button class="btn ucm-set-active-btn" data-user-id="${esc(u.id)}" type="button" style="font-size:12px;padding:2px 8px;">Set Active</button>
        </td>
      </tr>`).join("");

    return `
      <section class="panel" style="max-width:960px;margin-top:12px;" id="ucm-section">
        <h2 style="margin-top:0;">User–Character Management <span class="admin-badge">Admin/Mod</span></h2>
        <p style="font-size:13px;color:#555;margin-top:0;">
          Assign unowned characters to users and manage active character pointers. Use this as a backup if the
          normal approval flow did not correctly set ownership.
          NPCs show an <b>[NPC]</b> badge — use <b>Assign NPC Manager</b> to give a party leader control of an NPC
          without changing their main active character. Use <b>Assign + Set Active</b> to set an NPC (or PC) as a
          user's main active character.
        </p>
        <div style="margin-bottom:10px;">
          <button class="btn" id="btn-ucm-reload" type="button" style="font-size:12px;">↺ Reload</button>
          <span id="ucm-load-status" style="font-size:12px;color:#555;margin-left:8px;"></span>
        </div>

        <h3 style="margin:16px 0 6px;font-size:14px;">Unowned Characters</h3>
        ${charMgmtUnowned.length === 0
          ? `<p class="muted" style="font-size:13px;">No unowned characters found.</p>`
          : `<div style="overflow-x:auto;">
              <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead>
                  <tr style="border-bottom:2px solid var(--line);">
                    <th style="text-align:left;padding:6px 8px;">Name</th>
                    <th style="text-align:left;padding:6px 8px;">Party</th>
                    <th style="text-align:left;padding:6px 8px;">Constituency</th>
                    <th style="text-align:left;padding:6px 8px;">Status</th>
                    <th style="text-align:left;padding:6px 8px;">Actions</th>
                  </tr>
                </thead>
                <tbody>${unownedRows}</tbody>
              </table>
            </div>`
        }

        <h3 style="margin:20px 0 6px;font-size:14px;">Users — Active Character Management</h3>
        ${charMgmtUsers.length === 0
          ? `<p class="muted" style="font-size:13px;">No users loaded.</p>`
          : `<div style="overflow-x:auto;">
              <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead>
                  <tr style="border-bottom:2px solid var(--line);">
                    <th style="text-align:left;padding:6px 8px;">Username</th>
                    <th style="text-align:left;padding:6px 8px;">Active Character</th>
                    <th style="text-align:left;padding:6px 8px;">Actions</th>
                  </tr>
                </thead>
                <tbody>${userRows}</tbody>
              </table>
            </div>`
        }
        <div id="ucm-action-status" style="font-size:13px;margin-top:8px;"></div>
      </section>`;
  }

  function renderDangerZone() {
    return `
      <section class="panel" style="max-width:700px;margin-top:12px;border:2px solid #c00;background:#fff8f8;">
        <h2 style="margin-top:0;color:#c00;">&#9888; Danger Zone &#8212; Trial Reset</h2>
        <p style="font-size:13px;color:#555;margin-top:0;">
          These actions perform a <b>full sim content wipe</b> to reset the simulation after trial testing.
          <b>User accounts and pending registrations are never deleted.</b>
        </p>

        <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:10px 14px;font-size:13px;margin-bottom:14px;">
          <b>What will be wiped:</b> bills, motions, statements, regulations, question time questions,
          press items, polling entries.<br>
          <b>What will be reset:</b> sim clock &#8594; August 1997, sim state &#8594; paused, app state pointer &#8594; fresh empty snapshot.<br>
          <b>What will NOT be touched:</b> user accounts, pending registrations, audit log, Discourse credentials, app config.
        </div>

        <div style="display:flex;flex-direction:column;gap:14px;">

          <div style="padding:12px;background:#fff;border:1px solid #e0a0a0;border-radius:6px;">
            <b>Wipe Content</b>
            <p style="margin:4px 0 8px;font-size:13px;color:#555;">
              ⚠️ Deletes <strong>all in-character sim content</strong>: bills, motions, statements, regulations, questions,
              polling, news, papers, press, Red Lion posts, online posts, fundraisers, events, scandals, elections (1997 base
              re-seeded), CS briefings/cases, Privy Council posts. Also vacates all government &amp; opposition offices,
              clears cabinet/shadow-cabinet drafts, and resets the budget to the 1997 baseline.
              <br>Characters and user accounts are <strong>preserved</strong>.
              <br><strong>This cannot be undone.</strong>
            </p>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <input id="wipe-confirm-input" type="text" placeholder="Type WIPE CONTENT to confirm"
                     style="flex:1;min-width:220px;padding:4px 8px;border:1px solid #c00;border-radius:4px;font-size:13px;" />
              <button class="btn" id="btn-wipe-content" type="button"
                      style="background:#c00;color:#fff;border-color:#c00;">Wipe Content</button>
            </div>
            <div id="wipe-status" style="margin-top:8px;font-size:13px;"></div>
          </div>

          <div style="padding:12px;background:#fff;border:1px solid #e0a0a0;border-radius:6px;">
            <b>Wipe Content with Characters</b>
            <p style="margin:4px 0 8px;font-size:13px;color:#555;">
              ⚠️ <strong>Danger:</strong> Does everything "Wipe Content" does, <em>and additionally</em> deletes
              <strong>all characters</strong> — their histories, office assignments, Privy Council memberships, shop
              purchases, work plans, scandal records, and personal affiliations. All users will have no characters.
              <br>User accounts (including mod/admin/speaker roles) are <strong>preserved</strong>.
              <br><strong>This cannot be undone.</strong>
            </p>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <input id="wipe-chars-confirm-input" type="text" placeholder="Type WIPE WITH CHARACTERS to confirm"
                     style="flex:1;min-width:260px;padding:4px 8px;border:1px solid #c00;border-radius:4px;font-size:13px;" />
              <button class="btn" id="btn-wipe-with-chars" type="button"
                      style="background:#7b0000;color:#fff;border-color:#7b0000;">Wipe + Characters</button>
            </div>
            <div id="wipe-chars-status" style="margin-top:8px;font-size:13px;"></div>
          </div>

        </div>
      </section>`;
  }

  function renderUserPermissions() {
    if (!syncPreview.length) {
      return `
        <section class="panel" style="max-width:900px;margin-top:12px;">
          <h2 style="margin-top:0;">User Permissions</h2>
          <p style="font-size:13px;color:#888;">No users loaded. Refresh the Discourse Sync Preview above to populate.</p>
        </section>`;
    }

    const rows = syncPreview.map((u) => `
      <tr style="border-bottom:1px solid #eee;">
        <td style="padding:6px 10px;font-size:13px;">${esc(u.username)}</td>
        <td style="padding:6px 10px;font-size:12px;">${esc(u.email)}</td>
        <td style="padding:6px 10px;font-size:12px;">${esc((u.roles || []).join(", ") || "—")}</td>
        <td style="padding:6px 10px;">
          <button class="btn btn-edit-user-roles" data-userid="${esc(u.userId)}"
                  data-username="${esc(u.username)}"
                  data-roles="${esc(JSON.stringify(u.roles || []))}"
                  type="button" style="font-size:12px;padding:2px 8px;">Edit Roles</button>
        </td>
      </tr>`).join("");

    return `
      <section class="panel" style="max-width:900px;margin-top:12px;" id="user-permissions-section">
        <h2 style="margin-top:0;">User Permissions</h2>
        <p style="font-size:13px;color:#555;margin-top:0;">
          Assign admin, mod, and speaker roles to live users.
        </p>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="border-bottom:2px solid #ccc;">
                <th style="text-align:left;padding:6px 10px;">Username</th>
                <th style="text-align:left;padding:6px 10px;">Email</th>
                <th style="text-align:left;padding:6px 10px;">Current Roles</th>
                <th style="padding:6px 10px;"></th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>

        <div id="user-role-editor" style="display:none;margin-top:16px;padding:12px;background:#f9f9f9;border:1px solid #ddd;border-radius:6px;">
          <h3 style="margin-top:0;font-size:14px;">Edit roles for: <span id="user-role-editor-username"></span></h3>
          <div id="user-role-checkboxes" style="display:flex;flex-wrap:wrap;gap:8px 16px;margin-bottom:12px;">
            ${["admin", "mod"].map((r) => `
              <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;">
                <input type="checkbox" class="user-role-checkbox" value="${esc(r)}" /> ${esc(r)}
              </label>`).join("")}
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn" id="btn-save-user-roles" type="button">Save Roles</button>
            <button class="btn" id="btn-cancel-user-roles" type="button">Cancel</button>
          </div>
          <div id="user-role-editor-status" style="font-size:13px;margin-top:8px;"></div>
        </div>
      </section>`;
  }


  function renderSimControl() {
    const gs = data?.gameState || {};
    const as = data?.adminSettings || {};
    return `
      <section class="panel" style="max-width:700px;margin-top:12px;">
        <h2 style="margin-top:0;">Simulation Control <span class="admin-badge">Admin only</span></h2>
        <div style="display:grid;gap:8px;">
          <div class="muted">Simulation must be started by an admin on Sunday. Sunday is frozen for polls and work; the clock advances Mon–Sat in two blocks (see Tick Rate below).</div>
          <div class="kv"><span>Simulation status</span><b>${gs.started ? "Running" : "Not started"}</b></div>
          <div class="kv"><span>Clock anchor (real date)</span><b>${esc(String(gs.startRealDate || "Not set"))}</b></div>
          <div class="kv"><span>Tick Rate</span><b>2 sim months per real week (Mon–Wed: 1 month, Thu–Sat: 1 month, Sun: frozen)</b></div>
          <div class="kv"><span>Simulation Freeze</span><b>${simFreeze?.is_frozen ? "ACTIVE" : "Off"}</b></div>
          ${simFreeze?.reason ? `<div class="kv"><span>Freeze Reason</span><b>${esc(String(simFreeze.reason))}</b></div>` : ""}
          ${simFreeze?.updated_at ? `<div class="kv"><span>Freeze Updated</span><b>${esc(new Date(simFreeze.updated_at).toLocaleString("en-GB"))}</b></div>` : ""}
          <div style="display:grid;gap:6px;">
            <label class="label" style="margin:0;">
              <span class="muted">Freeze reason/message (optional)</span>
              <input id="sim-freeze-reason" type="text" class="input" maxlength="240"
                     value="${simFreeze?.reason ? esc(String(simFreeze.reason)) : ""}"
                     placeholder="Emergency maintenance, snapshot restore, hotfix rollout…" />
            </label>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn danger" type="button" id="sim-freeze-enable">Enable Freeze</button>
              <button class="btn" type="button" id="sim-freeze-disable">Disable Freeze</button>
              <span id="sim-freeze-status" class="muted"></span>
            </div>
          </div>
          <label class="label" style="margin:0;"><input type="checkbox" id="sim-pause-clock-check" ${gs.isPaused ? "checked" : ""}> Pause game clock (unpause on Sunday only)</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn" type="button" id="sim-save-pause-clock">Save Pause Setting</button>
            <button class="btn" type="button" id="sim-start-simulation" ${gs.started || !isSundayToday() ? "disabled" : ""}>Start Simulation (Sunday Only)</button>
          </div>
          ${!gs.started && !isSundayToday() ? `<div class="muted">Start unlocks on Sunday. Next Sunday anchor: <b>${esc(nextSundayIso().slice(0, 10))}</b>.</div>` : ""}
          <details style="margin-top:8px;border:1px solid #c00;border-radius:6px;padding:8px 12px;">
            <summary style="cursor:pointer;color:#c00;font-weight:600;">⚠ Danger Zone — Clock Tools</summary>
            <div style="margin-top:10px;display:grid;gap:8px;">
              <p style="margin:0;font-size:13px;color:#555;">
                These actions affect the simulation clock in ways that cannot be easily undone.
                Use only for testing or emergency correction.
              </p>
              <div>
                <button class="btn" type="button" id="sim-force-sunday-roll"
                        style="background:#c00;color:#fff;border-color:#c00;">Force Sunday Roll</button>
              </div>
            </div>
          </details>
          <form id="sim-monarch-form" style="display:grid;grid-template-columns:minmax(220px,1fr) auto;gap:8px;align-items:end;">
            <div>
              <label class="label" for="sim-monarchGender">Monarch</label>
              <select id="sim-monarchGender" class="input" name="monarchGender">
                <option value="Queen" ${as.monarchGender === "Queen" ? "selected" : ""}>Queen</option>
                <option value="King" ${as.monarchGender === "King" ? "selected" : ""}>King</option>
              </select>
            </div>
            <button class="btn" type="submit">Save Monarch</button>
          </form>
          <form id="sim-libdem-toggle-form" style="display:grid;grid-template-columns:minmax(220px,1fr) auto;gap:8px;align-items:end;">
            <div>
              <label class="label" for="sim-libDemClosed">Liberal Democrat — Open to New Characters</label>
              <select id="sim-libDemClosed" class="input" name="libDemClosed">
                <option value="open" ${!as.libDemClosedToNewChars ? "selected" : ""}>Open (new characters can join)</option>
                <option value="closed" ${as.libDemClosedToNewChars ? "selected" : ""}>Closed (no new characters)</option>
              </select>
            </div>
            <button class="btn" type="submit">Save</button>
          </form>
          <div id="sim-control-status" style="font-size:13px;"></div>
        </div>
      </section>`;
  }

  function render(status) {
    host.innerHTML = `
      <div class="bbc-masthead"><div class="bbc-title">Admin Panel</div></div>

      ${renderSimControl()}

      ${renderModDashboard()}

      ${renderPendingRegistrations()}

      <section class="panel" style="max-width:600px;margin-top:12px;">
        <h2 style="margin-top:0;">App Config</h2>
        <form id="config-form" style="display:flex;flex-direction:column;gap:10px;">
          ${renderConfigFields()}
          <div>
            <button class="btn" type="submit">Save Config</button>
          </div>
        </form>
        ${status && status.startsWith("cfg:") ? `<div id="status-msg" style="margin-top:10px;font-size:13px;">${esc(status.slice(4))}</div>` : ""}
      </section>

      ${renderDiscourseSection(status)}

      <section class="panel" style="max-width:700px;margin-top:12px;">
        <h2 style="margin-top:0;">State Snapshots</h2>
        <p style="font-size:12px;color:#555;margin:6px 0 10px;">Snapshots cover snapshot-backed state only. Divisions, amendments, factions, finance, and political-state stay relational-authoritative.</p>
        <p style="font-size:12px;color:#555;margin:0 0 10px;">Restore switches the active snapshot and auto-rebuilds derived caches. Rebuild cache repopulates derived tables only.</p>

        ${renderSnapshotStatusSummary()}

        <form id="snapshot-form" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;">
          <input id="snapshot-label" type="text" placeholder="Snapshot label…"
                 required minlength="1" maxlength="120"
                 style="flex:1;min-width:180px;padding:4px 8px;border:1px solid #ccc;border-radius:4px;" />
          <button class="btn" type="submit">Save Snapshot</button>
        </form>

        <div id="snapshots-list">${renderSnapshotsList()}</div>

        ${status && status.startsWith("snap:") ? `<div id="status-msg" style="margin-top:10px;font-size:13px;">${esc(status.slice(5))}</div>` : ""}
      </section>

      ${renderAuditLog()}

      ${renderUserPermissions()}

      ${renderUserCharacterManagement()}

      ${renderDiscourseSyncPreview()}

      ${renderSsoReadinessSection()}

      ${renderSystemHealthSection()}

      ${renderMaintenanceSection()}

      ${renderDangerZone()}

      <section class="panel" style="max-width:600px;margin-top:12px;">
        <h2 style="margin-top:0;">Session</h2>
        <button id="btn-logout" class="btn" type="button">Logout</button>
      </section>
    `;

    host.querySelector("#config-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target;
      const updates = {};
      for (const input of form.querySelectorAll("input[name]")) {
        updates[input.name] = input.value;
      }
      try {
        await apiSaveConfig(updates);
        logAction({ action: "config-saved", target: "app-config", details: updates });
        currentConfig = { ...currentConfig, ...updates };

        // If sim_start_date was updated and the sim has not yet started (or is paused),
        // update gameState's anchor so the masthead clock reflects the new date immediately.
        if (updates.sim_start_date && !data.gameState?.started) {
          const parsed = new Date(updates.sim_start_date);
          if (!Number.isNaN(parsed.getTime())) {
            data.gameState ??= {};
            data.gameState.startSimMonth = parsed.getMonth() + 1; // 1-12
            data.gameState.startSimYear  = parsed.getFullYear();
            // Persist the updated gameState so sim_clock is synced server-side
            // and all content creation endpoints use the same sim date as the navbar.
            saveState(data).catch((err) => console.error("[admin-panel] saveState after sim_start_date update failed:", err));
          }
        }

        render("cfg:Config saved.");
      } catch (err) {
        toastError(`Save config: ${err.message}`);
        render(`cfg:Error saving config: ${err.message}`);
      }
    });

    host.querySelector("#discourse-config-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target;
      const payload = {};
      const baseUrl   = form.querySelector("#disc-base-url")?.value?.trim();
      const apiKey    = form.querySelector("#disc-api-key")?.value;
      const apiUser   = form.querySelector("#disc-api-username")?.value?.trim();
      const ssoSecret = form.querySelector("#disc-sso-secret")?.value;
      if (baseUrl   !== undefined) payload.base_url     = baseUrl;
      if (apiKey)                  payload.api_key      = apiKey;
      if (apiUser)                 payload.api_username = apiUser;
      if (ssoSecret)               payload.sso_secret   = ssoSecret;
      try {
        await apiSaveDiscourseConfig(payload);
        logAction({ action: "discourse-config-saved", target: "discourse" });
        await loadDiscourseConfig();
        await loadSsoReadiness();
        render("disc-save:Discourse config saved.");
      } catch (err) {
        toastError(`Save Discourse config: ${err.message}`);
        render(`disc-save:Error saving Discourse config: ${err.message}`);
      }
    });

    host.querySelector("#btn-discourse-test")?.addEventListener("click", async () => {
      const resultEl = host.querySelector("#discourse-test-result");
      if (resultEl) resultEl.textContent = "Testing…";
      try {
        const result = await apiTestDiscourse();
        const msg = result.ok
          ? `✓ Connected${result.discourse_title ? ` — "${result.discourse_title}"` : ""}`
          : `✗ Failed: ${result.error || `HTTP ${result.status}`}`;
        if (resultEl) resultEl.textContent = msg;
      } catch (err) {
        if (resultEl) resultEl.textContent = `Test error: ${err.message}`;
      }
    });

    host.querySelector("#discourse-category-ids-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target;
      const payload = {};
      for (const { key } of DISCOURSE_CATEGORY_KINDS) {
        const val = form.querySelector(`[name="${key}"]`)?.value?.trim();
        if (val !== "" && val !== undefined) payload[key] = val;
      }
      try {
        await apiSaveDiscourseCategoryIds(payload);
        logAction({ action: "discourse-category-ids-saved", target: "discourse" });
        await loadDiscourseCategoryIds();
        render("disc-cat:✓ Debate category IDs saved.");
      } catch (err) {
        toastError(`Save category IDs: ${err.message}`);
        render(`disc-cat:Error: ${err.message}`);
      }
    });

    host.querySelector("#snapshot-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const label = host.querySelector("#snapshot-label")?.value?.trim();
      if (!label) return;
      try {
        await apiSaveSnapshot(label, data);
        logAction({ action: "snapshot-saved", target: label });
        await loadSnapshots();
        render("snap:Snapshot saved.");
      } catch (err) {
        toastError(`Save snapshot: ${err.message}`);
        render(`snap:Error saving snapshot: ${err.message}`);
      }
    });

    host.querySelectorAll(".btn-restore").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        if (!id) return;
        if (!confirm("Restore this snapshot now? This only changes snapshot-backed state and will auto-rebuild derived caches. Relational-authoritative gameplay systems are unchanged.")) return;
        try {
          const restoreResult = await apiRestoreSnapshot(id);
          logAction({ action: "snapshot-restored", target: id, details: restoreResult || {} });
          // Reload state data into the shared data object
          const result = await apiGetState();
          if (result?.data) Object.assign(data, result.data);
          await Promise.all([loadSnapshots(), loadSnapshotStatus()]);
          const statusMsg = restoreResult?.cacheRebuilt
            ? "Snapshot restored. Derived cache auto-rebuild: OK."
            : `Snapshot restored with warning: ${restoreResult?.warning || "derived cache rebuild failed; run Rebuild Cache now."}`;
          render(`snap:${statusMsg}`);
        } catch (err) {
          toastError(`Restore snapshot: ${err.message}`);
          render(`snap:Error restoring snapshot: ${err.message}`);
        }
      });
    });

    // Audit log filters
    host.querySelector("#audit-filter-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target;
      auditFilters.action = form.querySelector("#audit-filter-action")?.value || "";
      auditFilters.target = form.querySelector("#audit-filter-target")?.value || "";
      auditFilters.offset = 0;
      await loadAuditLog();
      render(status);
    });

    host.querySelector("#audit-clear-filters")?.addEventListener("click", async () => {
      auditFilters = { action: "", target: "", limit: 50, offset: 0 };
      await loadAuditLog();
      render(status);
    });

    host.querySelector("#audit-prev")?.addEventListener("click", async () => {
      auditFilters.offset = Math.max(0, auditFilters.offset - auditFilters.limit);
      await loadAuditLog();
      render(status);
    });

    host.querySelector("#audit-next")?.addEventListener("click", async () => {
      auditFilters.offset += auditFilters.limit;
      await loadAuditLog();
      render(status);
    });

    // Discourse sync preview
    host.querySelector("#btn-refresh-sync-preview")?.addEventListener("click", async () => {
      await loadSyncPreview();
      render(status);
    });

    host.querySelector("#btn-sync-discourse-groups")?.addEventListener("click", async () => {
      const btn = host.querySelector("#btn-sync-discourse-groups");
      if (btn) { btn.disabled = true; btn.textContent = "Syncing…"; }

      let jobId = null;

      // Clear any timer left over from a previous click or re-render
      if (_syncPollTimer) { clearInterval(_syncPollTimer); _syncPollTimer = null; }

      function stopPolling() {
        if (_syncPollTimer) { clearInterval(_syncPollTimer); _syncPollTimer = null; }
      }

      async function pollStatus() {
        // Stop polling if the host element is no longer in the document (page navigated away)
        if (!document.contains(host)) { stopPolling(); return; }
        try {
          const jobState = await apiAdminSyncDiscourseGroupsStatus(jobId);
          // Show progress log in the sync results area
          const logLines = (jobState.logs || []).join("\n");
          const logsDiv = host.querySelector("#sync-progress-log");
          if (logsDiv) logsDiv.textContent = logLines;

          if (jobState.status === "succeeded" || jobState.status === "failed") {
            stopPolling();
            if (jobState.status === "succeeded") {
              syncResults = jobState;
              logAction({ action: "discourse-groups-synced", details: {
                totalAdded: jobState.totalAdded, totalRemoved: jobState.totalRemoved, totalSkipped: jobState.totalSkipped
              }});
              toastSuccess(`Discourse sync complete — ${jobState.totalAdded} added, ${jobState.totalRemoved} removed.`);
              await loadSyncPreview();
            } else {
              toastError(`Discourse sync failed: ${jobState.lastError || "unknown error"}`);
            }
            render(status);
            const b = host.querySelector("#btn-sync-discourse-groups");
            if (b) { b.disabled = false; b.textContent = "Sync Discourse Groups Now"; }
          }
        } catch (pollErr) {
          stopPolling();
          // 404 means the server restarted and the job was lost
          const isRestart = pollErr.status === 404;
          toastError(isRestart
            ? "Sync job lost — the server may have restarted. Please try again."
            : `Failed to poll sync status: ${String(pollErr.message || pollErr)}`);
          const b = host.querySelector("#btn-sync-discourse-groups");
          if (b) { b.disabled = false; b.textContent = "Sync Discourse Groups Now"; }
        }
      }

      try {
        const startResult = await apiAdminSyncDiscourseGroups();
        jobId = startResult.jobId;

        if (startResult.alreadyRunning) {
          toastSuccess("A sync job is already running — monitoring progress…");
        }

        // Show a live progress log container
        const progressContainer = host.querySelector("#sync-results");
        if (progressContainer) {
          progressContainer.innerHTML = `<b>Sync in progress…</b><pre id="sync-progress-log" style="font-size:12px;max-height:200px;overflow-y:auto;background:#f5f5f5;padding:8px;margin-top:8px;border-radius:4px;"></pre>`;
        } else {
          // Append a temporary progress block after the button row
          const btnRow = host.querySelector("#btn-sync-discourse-groups")?.closest("div");
          if (btnRow) {
            let prog = host.querySelector("#sync-progress-wrap");
            if (!prog) {
              prog = document.createElement("div");
              prog.id = "sync-progress-wrap";
              prog.style.marginTop = "12px";
              btnRow.insertAdjacentElement("afterend", prog);
            }
            prog.innerHTML = `<b>Sync in progress…</b><pre id="sync-progress-log" style="font-size:12px;max-height:200px;overflow-y:auto;background:#f5f5f5;padding:8px;margin-top:8px;border-radius:4px;"></pre>`;
          }
        }

        // Poll every SYNC_POLL_INTERVAL_MS
        _syncPollTimer = setInterval(pollStatus, SYNC_POLL_INTERVAL_MS);
        // Also poll immediately
        await pollStatus();
      } catch (err) {
        toastError(`Discourse sync failed: ${err.message}`);
        const b = host.querySelector("#btn-sync-discourse-groups");
        if (b) { b.disabled = false; b.textContent = "Sync Discourse Groups Now"; }
      }
    });

    // SSO Readiness
    host.querySelector("#btn-refresh-sso-readiness")?.addEventListener("click", async () => {
      await loadSsoReadiness();
      render(status);
    });

    let roleEditorUserId = null;
    host.querySelectorAll(".btn-edit-roles").forEach((btn) => {
      btn.addEventListener("click", () => {
        roleEditorUserId = btn.dataset.userid;
        const username = btn.dataset.username || roleEditorUserId;
        const currentRoles = JSON.parse(btn.dataset.roles || "[]");
        const editor = host.querySelector("#role-editor");
        if (!editor) return;
        editor.style.display = "block";
        const nameEl = editor.querySelector("#role-editor-username");
        if (nameEl) nameEl.textContent = username;
        editor.querySelectorAll(".role-checkbox").forEach((cb) => {
          cb.checked = currentRoles.includes(cb.value);
        });
        editor.querySelector("#role-editor-status").textContent = "";
      });
    });

    host.querySelector("#btn-cancel-roles")?.addEventListener("click", () => {
      const editor = host.querySelector("#role-editor");
      if (editor) editor.style.display = "none";
      roleEditorUserId = null;
    });

    host.querySelector("#btn-save-roles")?.addEventListener("click", async () => {
      if (!roleEditorUserId) return;
      const statusEl = host.querySelector("#role-editor-status");
      const roles = [...host.querySelectorAll(".role-checkbox:checked")].map((cb) => cb.value);
      try {
        if (statusEl) statusEl.textContent = "Saving…";
        await apiSetUserRoles(roleEditorUserId, roles);
        logAction({ action: "roles-assigned", target: roleEditorUserId, details: { roles } });
        if (statusEl) statusEl.textContent = "✓ Roles saved.";
        await loadSyncPreview();
        render(status);
      } catch (err) {
        toastError(`Save roles: ${err.message}`);
        if (statusEl) statusEl.textContent = `Error: ${err.message}`;
      }
    });

    // ── Simulation Control ────────────────────────────────────────────────────
    host.querySelector("#sim-save-pause-clock")?.addEventListener("click", async () => {
      const wantPaused = !!host.querySelector("#sim-pause-clock-check")?.checked;
      const wasPaused = !!data.gameState.isPaused;
      const statusEl = host.querySelector("#sim-control-status");
      if (wantPaused !== wasPaused) {
        if (wantPaused && !wasPaused) {
          data.gameState.isPaused = true;
          data.gameState.pausedAtRealDate = new Date().toISOString();
          try {
            await Promise.all([
              saveState(data),
              apiClockPause(),
            ]);
          } catch (err) {
            console.error("[admin-panel] pause failed:", err);
            if (statusEl) statusEl.textContent = `Pause failed: ${err.message}`;
            return;
          }
        } else if (!wantPaused && wasPaused) {
          if (!isSundayToday()) {
            if (statusEl) statusEl.textContent = "Cannot unpause: the simulation may only be unpaused on a Sunday.";
            return;
          }
          const pausedAt = new Date(data.gameState.pausedAtRealDate || new Date().toISOString());
          const now = new Date();
          const pauseDurationMs = now.getTime() - pausedAt.getTime();
          data.gameState.startRealDate = new Date(new Date(data.gameState.startRealDate).getTime() + pauseDurationMs).toISOString();
          data.gameState.isPaused = false;
          data.gameState.pausedAtRealDate = "";
          try {
            await Promise.all([
              saveState(data),
              apiClockUnpause(),
            ]);
          } catch (err) {
            console.error("[admin-panel] unpause failed:", err);
            if (statusEl) statusEl.textContent = `Unpause failed: ${err.message}`;
            return;
          }
        }
        if (statusEl) statusEl.textContent = `Game clock ${data.gameState.isPaused ? "paused" : "unpaused"}.`;
        render();
      }
    });

    host.querySelector("#sim-force-sunday-roll")?.addEventListener("click", () => {
      if (!confirm("⚠ Force Sunday Roll will trigger all Sunday roll logic immediately. This cannot be undone. Proceed?")) return;
      runSundayRoll(data);
      const statusEl = host.querySelector("#sim-control-status");
      if (statusEl) statusEl.textContent = "Sunday roll forced.";
    });

    host.querySelector("#sim-start-simulation")?.addEventListener("click", async () => {
      if (data.gameState.started || !isSundayToday()) return;
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      data.gameState.started = true;
      data.gameState.startRealDate = now.toISOString();
      data.gameState.isPaused = false;
      const statusEl = host.querySelector("#sim-control-status");
      try {
        await Promise.all([
          saveState(data),
          apiClockStart(),
        ]);
      } catch (err) {
        console.error("[admin-panel] sim start failed:", err);
        if (statusEl) statusEl.textContent = `Start failed: ${err.message}`;
        return;
      }
      render();
    });

    host.querySelector("#sim-freeze-enable")?.addEventListener("click", async () => {
      const reasonInput = host.querySelector("#sim-freeze-reason");
      const statusEl = host.querySelector("#sim-freeze-status");
      try {
        if (statusEl) statusEl.textContent = "Applying…";
        const result = await apiSetSimFreeze({ is_frozen: true, reason: String(reasonInput?.value || "").trim() || null });
        simFreeze = result?.freeze ?? simFreeze;
        if (statusEl) statusEl.textContent = "Freeze enabled.";
        render();
      } catch (e) {
        if (statusEl) statusEl.textContent = `Failed: ${e.message}`;
      }
    });

    host.querySelector("#sim-freeze-disable")?.addEventListener("click", async () => {
      const reasonInput = host.querySelector("#sim-freeze-reason");
      const statusEl = host.querySelector("#sim-freeze-status");
      try {
        if (statusEl) statusEl.textContent = "Applying…";
        const result = await apiSetSimFreeze({ is_frozen: false, reason: String(reasonInput?.value || "").trim() || null });
        simFreeze = result?.freeze ?? simFreeze;
        if (statusEl) statusEl.textContent = "Freeze disabled.";
        render();
      } catch (e) {
        if (statusEl) statusEl.textContent = `Failed: ${e.message}`;
      }
    });

    host.querySelector("#sim-monarch-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const gender = String(new FormData(e.currentTarget).get("monarchGender") || "Queen");
      data.adminSettings ??= {};
      data.adminSettings.monarchGender = gender === "King" ? "King" : "Queen";
      const statusEl = host.querySelector("#sim-control-status");
      if (statusEl) statusEl.textContent = `Monarch updated to ${data.adminSettings.monarchGender}.`;
    });

    host.querySelector("#sim-libdem-toggle-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const closed = String(new FormData(e.currentTarget).get("libDemClosed") || "open") === "closed";
      data.adminSettings ??= {};
      data.adminSettings.libDemClosedToNewChars = closed;
      const statusEl = host.querySelector("#sim-control-status");
      if (statusEl) statusEl.textContent = `Liberal Democrat is now ${closed ? "closed" : "open"} to new characters.`;
    });

    host.querySelector("#btn-logout")?.addEventListener("click", async () => {
      try {
        await apiLogout();
        window.location.href = "login.html";
      } catch (err) {
        toastError(`Logout failed: ${err.message}`);
        render(`Error logging out: ${err.message}`);
      }
    });

    // ── Sync Discourse debate buttons ─────────────────────────────────────────
    host.querySelectorAll(".btn-sync-debate-kind").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const kind = btn.getAttribute("data-kind") || "";
        if (!kind) return;
        btn.disabled = true;
        try {
          const result = await apiAdminDiscourseSyncDebates(kind);
          debateSyncResults[kind] = result;
          if (result.ok) {
            toastSuccess(`Synced ${result.synced} ${kind} debate topic(s).`);
          } else {
            toastError(`${kind} sync: ${result.error || "sync failed"}`);
          }
          await loadDashboard();
          render("");
        } catch (err) {
          debateSyncResults[kind] = { ok: false, error: err.message };
          toastError(`Discourse ${kind} sync failed: ${err.message}`);
          render("");
        } finally {
          btn.disabled = false;
        }
      });
    });

    // ── Maintenance buttons ────────────────────────────────────────────────────

    host.querySelector("#btn-clear-cache")?.addEventListener("click", async () => {
      if (!confirm("Clear all object-cache tables? Data is not lost — it can be rebuilt from the current snapshot.")) return;
      try {
        const result = await apiAdminClearCache();
        logAction({ action: "admin-clear-cache" });
        await loadSnapshotStatus();
        render("snap:Object cache cleared. Snapshot-backed relational-authoritative systems were not changed.");
        toastSuccess(result.message || "Cache cleared.");
      } catch (err) {
        toastError(`Clear cache: ${err.message}`);
      }
    });

    host.querySelector("#btn-rebuild-cache")?.addEventListener("click", async () => {
      if (!confirm("Rebuild derived cache now from the current snapshot? This does not overwrite relational-authoritative gameplay systems.")) return;
      try {
        const result = await apiAdminRebuildCache();
        logAction({ action: "admin-rebuild-cache" });
        await loadSnapshotStatus();
        render("snap:Derived cache rebuilt from current snapshot.");
        toastSuccess(result.message || "Cache rebuilt.");
      } catch (err) {
        toastError(`Rebuild cache: ${err.message}`);
      }
    });

    host.querySelector("#btn-rotate-session")?.addEventListener("click", async () => {
      try {
        const result = await apiAdminRotateSessions();
        logAction({ action: "admin-rotate-session" });
        toastSuccess(result.message || "Session rotated.");
        // Reload after a short delay so the success toast is visible before the
        // page refreshes and the browser picks up the new session cookie + CSRF token.
        setTimeout(() => window.location.reload(), 1000);
      } catch (err) {
        toastError(`Rotate session: ${err.message}`);
      }
    });

    host.querySelector("#btn-repair-char-owners")?.addEventListener("click", async () => {
      const btn = host.querySelector("#btn-repair-char-owners");
      const statusEl = host.querySelector("#repair-char-owners-status");
      const diagEl = host.querySelector("#repair-char-owners-diagnostics");
      if (btn) { btn.disabled = true; btn.textContent = "Running…"; }
      if (statusEl) statusEl.textContent = "";
      if (diagEl) diagEl.textContent = "";
      try {
        const result = await apiAdminRepairCharacterOwners();
        logAction({ action: "admin.repair.character-owner-pointers", details: { fixed_count: result.fixed_count } });
        if (statusEl) {
          statusEl.style.color = (result.fixed_count || result.active_pointer_fixed_count) ? "#1a7a1a" : "#555";
          statusEl.textContent = result.message || "Done.";
          if (result.fixed_count && result.fixed?.length) {
            statusEl.textContent += " Fixed: " + result.fixed.map((r) => `${r.name} → ${r.applicant_username}`).join(", ");
          }
        }
        if (diagEl) {
          const diag = [
            `Orphans: ${result.orphans_count ?? 0}`,
            `Approved apps: ${result.approved_applications_count ?? 0}`,
            `Matched by app ID: ${result.matched_by_application_id_count ?? 0}`,
            `Matched by name: ${result.matched_by_name_fallback_count ?? 0}`,
            `Active pointer fixed: ${result.active_pointer_fixed_count ?? 0}`,
            `Sessions cleared: ${result.sessions_cleared ?? 0}`,
          ].join(" | ");
          diagEl.textContent = diag;
          if (result.orphans_count > 0 && result.orphans?.length) {
            diagEl.textContent += ` — Orphans: ${result.orphans.slice(0, 5).map((o) => o.name).join(", ")}${result.orphans_count > 5 ? " …" : ""}`;
          }
        }
        toastSuccess(result.message || "Repair complete.");
      } catch (err) {
        if (statusEl) { statusEl.style.color = "#c00"; statusEl.textContent = err.message; }
        toastError(`Repair failed: ${err.message}`);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Run Repair"; }
      }
    });

    // ── Close Stale Divisions handler ────────────────────────────────────────────
    host.querySelector("#btn-close-stale-div")?.addEventListener("click", async () => {
      const btn = host.querySelector("#btn-close-stale-div");
      const statusEl = host.querySelector("#close-stale-div-status");
      if (!confirm("Close all currently open divisions? This will mark them as abandoned. Only do this to clear stale data.")) return;
      if (btn) { btn.disabled = true; btn.textContent = "Closing…"; }
      if (statusEl) statusEl.textContent = "";
      try {
        const result = await apiAdminCloseStaleDiv();
        toastSuccess(result.message || "Done.");
        if (statusEl) { statusEl.style.color = "#1a7a1a"; statusEl.textContent = `✓ ${result.message}`; }
        logAction({ action: "admin.close-stale-divisions", details: { closed: result.closed } });
        await loadDashboard();
        render();
      } catch (err) {
        toastError(`Close stale divisions: ${err.message}`);
        if (statusEl) { statusEl.style.color = "#c00"; statusEl.textContent = `Error: ${err.message}`; }
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Close Stale"; }
      }
    });

    // ── Close Orphan Motion Divisions handler ───────────────────────────────────
    host.querySelector("#btn-close-orphan-motion-div")?.addEventListener("click", async () => {
      const btn = host.querySelector("#btn-close-orphan-motion-div");
      const statusEl = host.querySelector("#close-orphan-motion-div-status");
      if (!confirm("Close all open divisions for motions that no longer exist? These will be marked as abandoned.")) return;
      if (btn) { btn.disabled = true; btn.textContent = "Closing…"; }
      if (statusEl) statusEl.textContent = "";
      try {
        const result = await apiAdminCloseOrphanMotionDivisions();
        toastSuccess(result.message || "Done.");
        if (statusEl) { statusEl.style.color = "#1a7a1a"; statusEl.textContent = `✓ ${result.message}`; }
        logAction({ action: "admin.close-orphan-motion-divisions", details: { closed: result.closed } });
        await loadDashboard();
        render();
      } catch (err) {
        toastError(`Close orphan motion divisions: ${err.message}`);
        if (statusEl) { statusEl.style.color = "#c00"; statusEl.textContent = `Error: ${err.message}`; }
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Close Orphans"; }
      }
    });

    // ── System Health Check handler ──────────────────────────────────────────
    host.querySelector("#btn-system-health-check")?.addEventListener("click", async () => {
      const btn = host.querySelector("#btn-system-health-check");
      const resultsEl = host.querySelector("#system-health-results");
      if (btn) { btn.disabled = true; btn.textContent = "Checking…"; }
      if (resultsEl) resultsEl.innerHTML = "";
      const checks = [];
      try {
        const health = await apiGetHealth();
        checks.push({ label: "GET /api/health (liveness)", ok: Boolean(health?.ok), detail: health?.ok ? "Server is alive" : "Unexpected response" });
      } catch (err) {
        checks.push({ label: "GET /api/health (liveness)", ok: false, detail: err.message });
      }
      try {
        const state = await apiGetState();
        checks.push({ label: "GET /api/state (game state)", ok: state !== null, detail: state !== null ? "State readable" : "No state record found" });
      } catch (err) {
        checks.push({ label: "GET /api/state (game state)", ok: false, detail: err.message });
      }
      if (resultsEl) {
        const rows = checks.map((c) =>
          `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;">
            <span style="font-size:16px;">${c.ok ? "✅" : "❌"}</span>
            <span><b>${esc(c.label)}</b> — ${esc(c.detail)}</span>
          </div>`
        ).join("");
        const allOk = checks.every((c) => c.ok);
        resultsEl.innerHTML = rows + `<div style="margin-top:8px;font-weight:600;color:${allOk ? "#1a7a1a" : "#c00"};">${allOk ? "All checks passed." : "One or more checks failed."}</div>`;
      }
      if (btn) { btn.disabled = false; btn.textContent = "Run Check"; }
    });

    // ── User–Character Management handlers ──────────────────────────────────────

    async function loadUcmData() {
      const statusEl = host.querySelector("#ucm-load-status");
      if (statusEl) statusEl.textContent = "Loading…";
      try {
        const [usersResult, unownedResult] = await Promise.all([
          apiAdminGetUsers(),
          apiAdminGetCharacters({ owned: "unowned" }),
        ]);
        charMgmtUsers = usersResult.users || [];
        charMgmtUnowned = unownedResult.characters || [];
        if (statusEl) statusEl.textContent = "";
        // Re-render the UCM section in place
        const section = host.querySelector("#ucm-section");
        if (section) section.outerHTML = renderUserCharacterManagement();
        attachUcmHandlers();
        // Populate owned-character dropdowns for each user
        await loadOwnedCharDropdowns();
      } catch (err) {
        if (statusEl) statusEl.textContent = `Load failed: ${err.message}`;
        toastError(`UCM load failed: ${err.message}`);
      }
    }

    async function loadOwnedCharDropdowns() {
      const selects = host.querySelectorAll(".ucm-set-active-select");
      await Promise.all(Array.from(selects).map(async (sel) => {
        const userId = sel.dataset.userId;
        if (!userId) return;
        try {
          const result = await apiAdminGetCharacters({ owned: "owned" });
          const userChars = (result.characters || []).filter((c) => c.user_id === userId);
          sel.innerHTML = `<option value="">— owned characters —</option>` +
            userChars.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}${c.is_active ? " ✓" : ""}</option>`).join("");
        } catch (_) { /* non-fatal */ }
      }));
    }

    function attachUcmHandlers() {
      const actionStatus = host.querySelector("#ucm-action-status");
      function setStatus(msg, ok = true) {
        if (!actionStatus) return;
        actionStatus.style.color = ok ? "#1a7a1a" : "#c00";
        actionStatus.textContent = msg;
      }

      host.querySelector("#btn-ucm-reload")?.addEventListener("click", () => loadUcmData());

      // Assign NPC Manager button — sets managed_by_user_id without changing user_id or is_active
      host.querySelectorAll(".ucm-assign-npc-manager-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const charId = btn.dataset.charId;
          const sel = host.querySelector(`.ucm-user-select[data-char-id="${CSS.escape(charId)}"]`);
          const userId = sel?.value;
          if (!userId) { setStatus("Select a user first.", false); return; }
          try {
            btn.disabled = true;
            await apiAdminAssignNpcManager(charId, userId);
            toastSuccess("NPC manager assigned.");
            setStatus("NPC manager assigned.");
            await loadUcmData();
          } catch (err) {
            setStatus(err.message, false);
            toastError(err.message);
            btn.disabled = false;
          }
        });
      });

      // Assign / Assign+Active buttons for unowned characters
      host.querySelectorAll(".ucm-assign-btn,.ucm-assign-active-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const charId = btn.dataset.charId;
          const setActive = btn.classList.contains("ucm-assign-active-btn");
          const sel = host.querySelector(`.ucm-user-select[data-char-id="${CSS.escape(charId)}"]`);
          const userId = sel?.value;
          if (!userId) { setStatus("Select a user first.", false); return; }
          try {
            btn.disabled = true;
            await apiAdminAssignCharacterOwner(charId, userId, setActive);
            toastSuccess(`Character assigned${setActive ? " and set active" : ""}.`);
            setStatus(`Character assigned${setActive ? " and set active" : ""}.`);
            await loadUcmData();
          } catch (err) {
            setStatus(err.message, false);
            toastError(err.message);
            btn.disabled = false;
          }
        });
      });

      // Clear active character
      host.querySelectorAll(".ucm-clear-active-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const userId = btn.dataset.userId;
          try {
            btn.disabled = true;
            await apiAdminSetUserActiveCharacter(userId, null);
            toastSuccess("Active character cleared.");
            setStatus("Active character cleared.");
            await loadUcmData();
          } catch (err) {
            setStatus(err.message, false);
            toastError(err.message);
            btn.disabled = false;
          }
        });
      });

      // Set active character from dropdown
      host.querySelectorAll(".ucm-set-active-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const userId = btn.dataset.userId;
          const sel = host.querySelector(`.ucm-set-active-select[data-user-id="${CSS.escape(userId)}"]`);
          const charId = sel?.value;
          if (!charId) { setStatus("Select an owned character first.", false); return; }
          try {
            btn.disabled = true;
            await apiAdminSetUserActiveCharacter(userId, charId);
            toastSuccess("Active character updated.");
            setStatus("Active character updated.");
            await loadUcmData();
          } catch (err) {
            setStatus(err.message, false);
            toastError(err.message);
            btn.disabled = false;
          }
        });
      });
    }

    // Initial load
    loadUcmData();

    host.querySelector("#btn-force-logout-all")?.addEventListener("click", async () => {
      if (!confirm("Force-logout all other users? Every active session except yours will be terminated immediately.")) return;
      try {
        const result = await apiAdminForceLogoutAll();
        logAction({ action: "admin-force-logout-all", details: { sessionsDeleted: result.sessionsDeleted } });
        toastSuccess(result.message || "All other sessions terminated.");
      } catch (err) {
        toastError(`Force logout all: ${err.message}`);
      }
    });

    // ── Danger Zone buttons ────────────────────────────────────────────────────

    host.querySelector("#btn-wipe-content")?.addEventListener("click", async () => {
      const confirmInput = host.querySelector("#wipe-confirm-input");
      const statusEl     = host.querySelector("#wipe-status");
      if (confirmInput?.value !== "WIPE CONTENT") {
        if (statusEl) statusEl.textContent = "Type WIPE CONTENT in the box above to confirm.";
        return;
      }
      const btn = host.querySelector("#btn-wipe-content");
      if (btn) { btn.disabled = true; btn.textContent = "Wiping…"; }
      if (statusEl) statusEl.textContent = "";
      try {
        const result = await apiWipeContent();
        logAction({ action: "admin.wipe-content", details: { wiped: result.wiped } });
        toastSuccess(result.message);
        if (statusEl) statusEl.textContent = `✓ ${result.message}`;
        if (confirmInput) confirmInput.value = "";
      } catch (err) {
        toastError(`Wipe failed: ${err.message}`);
        if (statusEl) statusEl.textContent = `Error: ${err.message}`;
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Wipe Content"; }
      }
    });

    // ── Wipe with Characters button ─────────────────────────────────────────────
    host.querySelector("#btn-wipe-with-chars")?.addEventListener("click", async () => {
      const confirmInput = host.querySelector("#wipe-chars-confirm-input");
      const statusEl     = host.querySelector("#wipe-chars-status");
      if (confirmInput?.value !== "WIPE WITH CHARACTERS") {
        if (statusEl) statusEl.textContent = "Type WIPE WITH CHARACTERS in the box above to confirm.";
        return;
      }
      if (!confirm("⚠️ This will wipe all content AND all character data. User accounts are preserved. This cannot be undone. Continue?")) return;
      const btn = host.querySelector("#btn-wipe-with-chars");
      if (btn) { btn.disabled = true; btn.textContent = "Wiping…"; }
      if (statusEl) statusEl.textContent = "";
      try {
        const result = await apiWipeWithCharacters();
        logAction({ action: "admin.wipe-with-characters", details: { wiped: result.wiped } });
        toastSuccess(result.message);
        if (statusEl) statusEl.textContent = `✓ ${result.message}`;
        if (confirmInput) confirmInput.value = "";
      } catch (err) {
        toastError(`Wipe failed: ${err.message}`);
        if (statusEl) statusEl.textContent = `Error: ${err.message}`;
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Wipe + Characters"; }
      }
    });

    // ── User Permissions editor ────────────────────────────────────────────────
    let userRoleEditorUserId = null;
    host.querySelectorAll(".btn-edit-user-roles").forEach((btn) => {
      btn.addEventListener("click", () => {
        userRoleEditorUserId = btn.dataset.userid;
        const username = btn.dataset.username || userRoleEditorUserId;
        const currentRoles = JSON.parse(btn.dataset.roles || "[]");
        const editor = host.querySelector("#user-role-editor");
        if (!editor) return;
        editor.style.display = "block";
        const nameEl = editor.querySelector("#user-role-editor-username");
        if (nameEl) nameEl.textContent = username;
        editor.querySelectorAll(".user-role-checkbox").forEach((cb) => {
          cb.checked = currentRoles.includes(cb.value);
        });
        editor.querySelector("#user-role-editor-status").textContent = "";
      });
    });

    host.querySelector("#btn-cancel-user-roles")?.addEventListener("click", () => {
      const editor = host.querySelector("#user-role-editor");
      if (editor) editor.style.display = "none";
      userRoleEditorUserId = null;
    });

    host.querySelector("#btn-save-user-roles")?.addEventListener("click", async () => {
      if (!userRoleEditorUserId) return;
      const statusEl = host.querySelector("#user-role-editor-status");
      const roles = [...host.querySelectorAll(".user-role-checkbox:checked")].map((cb) => cb.value);
      try {
        if (statusEl) statusEl.textContent = "Saving…";
        await apiSetUserRoles(userRoleEditorUserId, roles);
        logAction({ action: "roles-assigned", target: userRoleEditorUserId, details: { roles } });
        if (statusEl) statusEl.textContent = "✓ Roles saved.";
        await loadSyncPreview();
        render(status);
      } catch (err) {
        toastError(`Save roles: ${err.message}`);
        if (statusEl) statusEl.textContent = `Error: ${err.message}`;
      }
    });
  }

  async function loadPendingRegistrations() {
    try {
      const res = await apiGetPendingRegistrations("pending");
      pendingRegistrations = res.registrations || [];
    } catch (err) {
      console.error("Failed to load pending registrations:", err);
      pendingRegistrations = [];
    }
  }

  async function loadSimFreeze() {
    try {
      const result = await apiGetSimFreeze();
      simFreeze = result?.freeze ?? { is_frozen: false, reason: null, updated_at: null };
    } catch (err) {
      console.error("Failed to load sim freeze:", err);
    }
  }

  await Promise.all([loadConfig(), loadDiscourseConfig(), loadDiscourseCategoryIds(), loadSnapshots(), loadSnapshotStatus(), loadAuditLog(), loadSyncPreview(), loadSsoReadiness(), loadDashboard(), loadPendingRegistrations(), loadSimFreeze()]);
  render("");

  // Event delegation for pending registration approve/reject buttons
  host.addEventListener("click", async (e) => {
    const approveBtn = e.target.closest(".btn-approve");
    const rejectBtn  = e.target.closest(".btn-reject");
    if (!approveBtn && !rejectBtn) return;

    const id = (approveBtn || rejectBtn).dataset.id;
    if (!id) return;

    if (approveBtn) {
      approveBtn.disabled = true;
      try {
        await apiApproveRegistration(id);
        toastSuccess("Registration approved — user account created.");
        await loadPendingRegistrations();
        const section = host.querySelector("#pending-reg-section");
        if (section) section.outerHTML = renderPendingRegistrations();
      } catch (err) {
        toastError(`Approve failed: ${err.message}`);
        approveBtn.disabled = false;
      }
    } else {
      rejectBtn.disabled = true;
      try {
        await apiRejectRegistration(id);
        toastSuccess("Registration rejected.");
        await loadPendingRegistrations();
        const section = host.querySelector("#pending-reg-section");
        if (section) section.outerHTML = renderPendingRegistrations();
      } catch (err) {
        toastError(`Reject failed: ${err.message}`);
        rejectBtn.disabled = false;
      }
    }
  });
}
