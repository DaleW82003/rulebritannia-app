import { requireAdmin } from "../auth.js";
import { esc } from "../ui.js";
import {
  apiLogout, apiGetState, apiGetConfig, apiSaveConfig,
  apiGetSnapshots, apiSaveSnapshot, apiRestoreSnapshot,
  apiGetAuditLog,
} from "../api.js";
import { logAction } from "../audit.js";

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

  async function loadConfig() {
    try {
      const result = await apiGetConfig();
      currentConfig = result?.config || {};
    } catch (err) {
      console.error("Failed to load config:", err);
      currentConfig = {};
    }
  }

  async function loadSnapshots() {
    try {
      const result = await apiGetSnapshots();
      snapshots = result?.snapshots || [];
      currentSnapshotId = result?.currentId ?? null;
    } catch (err) {
      console.error("Failed to load snapshots:", err);
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
      auditEntries = [];
      auditTotal = 0;
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
        render(`cfg:Error saving config: ${err.message}`);
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

    host.querySelector("#btn-logout")?.addEventListener("click", async () => {
      try {
        await apiLogout();
        window.location.href = "login.html";
      } catch (err) {
        render(`Error logging out: ${err.message}`);
      }
    });
  }

  await Promise.all([loadConfig(), loadSnapshots(), loadAuditLog()]);
  render("");
}
