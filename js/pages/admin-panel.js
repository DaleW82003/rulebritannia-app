import { requireAdmin } from "../auth.js";
import { esc } from "../ui.js";
import {
  apiLogout, apiGetState, apiGetConfig, apiSaveConfig,
  apiGetSnapshots, apiSaveSnapshot, apiRestoreSnapshot,
  apiGetAuditLog,
  apiGetDiscourseConfig, apiSaveDiscourseConfig, apiTestDiscourse,
  apiGetDiscourseSyncPreview, apiSetUserRoles,
} from "../api.js";
import { logAction } from "../audit.js";
import { toastError } from "../components/toast.js";

export async function initAdminPanelPage(data) {
  const user = await requireAdmin();
  if (!user) return;

  const host = document.getElementById("admin-panel-root") || document.querySelector("main.wrap");
  if (!host) return;

  let currentConfig = {};
  let snapshots = [];
  let currentSnapshotId = null;
  let auditEntries = [];
  let auditTotal = 0;
  let auditFilters = { action: "", target: "", limit: 50, offset: 0 };
  let discourseConfig = { base_url: "", has_api_key: false, has_api_username: false };
  let syncPreview = [];

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
    const testResult         = status && status.startsWith("disc-test:") ? status.slice(10) : "";
    const saveResult         = status && status.startsWith("disc-save:") ? status.slice(10) : "";

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
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn" type="submit">Save</button>
            <button class="btn" id="btn-discourse-test" type="button">Test Connection</button>
          </div>
        </form>
        ${saveResult ? `<div style="margin-top:10px;font-size:13px;">${esc(saveResult)}</div>` : ""}
        <div id="discourse-test-result" style="margin-top:10px;font-size:13px;">${esc(testResult)}</div>
      </section>`;
  }

  function renderSnapshotsList() {
    if (!snapshots.length) return '<p class="muted-block">No snapshots saved yet.</p>';
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
          ${snapshots.map((s) => `
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
      </table>`;
  }

  function renderAuditLog() {
    const actionOptions = [
      "", "config-saved", "snapshot-saved", "snapshot-restored",
      "economy-saved", "question-answered", "question-closed", "speaker-demand",
      "poll-published", "bill-stage-changed", "office-assigned",
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
      <section class="panel" style="max-width:800px;margin-top:12px;">
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

        <div id="audit-entries">${entryTiles}</div>

        <div style="display:flex;gap:8px;align-items:center;margin-top:10px;font-size:13px;">
          <span>${esc(String(auditTotal))} total</span>
          ${currentPage > 1 ? `<button class="btn" id="audit-prev" type="button" style="font-size:12px;padding:2px 10px;">← Prev</button>` : ""}
          <span>Page ${esc(String(currentPage))} / ${esc(String(pageCount))}</span>
          ${currentPage < pageCount ? `<button class="btn" id="audit-next" type="button" style="font-size:12px;padding:2px 10px;">Next →</button>` : ""}
        </div>
      </section>`;
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
          SSO sync is not yet enabled — use this view to manage roles and preview the resulting Discourse group membership.
        </p>
        <button class="btn" id="btn-refresh-sync-preview" type="button" style="margin-bottom:10px;">Refresh</button>
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

  function render(status) {
    host.innerHTML = `
      <h1 class="page-title">Admin Panel</h1>

      <section class="panel" style="max-width:600px;">
        <h2 style="margin-top:0;">Logged-in User</h2>
        <div class="kv"><span>Email</span><b>${esc(user.email || "—")}</b></div>
        <div class="kv"><span>Roles</span><b>${esc((user.roles || []).join(", ") || "—")}</b></div>
      </section>

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

      ${renderDiscourseSyncPreview()}

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
      const baseUrl  = form.querySelector("#disc-base-url")?.value?.trim();
      const apiKey   = form.querySelector("#disc-api-key")?.value;
      const apiUser  = form.querySelector("#disc-api-username")?.value?.trim();
      if (baseUrl   !== undefined) payload.base_url     = baseUrl;
      if (apiKey)                  payload.api_key      = apiKey;
      if (apiUser)                 payload.api_username = apiUser;
      try {
        await apiSaveDiscourseConfig(payload);
        logAction({ action: "discourse-config-saved", target: "discourse" });
        await loadDiscourseConfig();
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
        if (!confirm("Restore this snapshot? The current state will change immediately.")) return;
        try {
          await apiRestoreSnapshot(id);
          logAction({ action: "snapshot-restored", target: id });
          // Reload state data into the shared data object
          const result = await apiGetState();
          if (result?.data) Object.assign(data, result.data);
          await loadSnapshots();
          render("snap:Snapshot restored.");
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

    host.querySelector("#btn-logout")?.addEventListener("click", async () => {
      try {
        await apiLogout();
        window.location.href = "login.html";
      } catch (err) {
        toastError(`Logout failed: ${err.message}`);
        render(`Error logging out: ${err.message}`);
      }
    });
  }

  await Promise.all([loadConfig(), loadDiscourseConfig(), loadSnapshots(), loadAuditLog(), loadSyncPreview()]);
  render("");
}
