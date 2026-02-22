import { esc } from "../ui.js";
import {
  apiAdminDashboard,
  apiAdminSyncDiscourseBills,
  apiAdminSyncDiscourseGroups,
  apiQtArchiveQuestion,
  apiCloseDivision,
  apiGetAuditLog,
} from "../api.js";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  } catch { return String(iso); }
}

let _state = {
  data: null,
  loading: false,
  error: null,
  auditOffset: 0,
  auditTotal: 0,
  toast: null,
};

function showToast(msg, ok = true) {
  _state.toast = { msg, ok };
  render();
  setTimeout(() => { _state.toast = null; render(); }, 4000);
}

function render() {
  const root = document.getElementById("moderator-dashboard-root");
  if (!root) return;

  if (_state.loading) {
    root.innerHTML = `<p class="muted">Loading dashboard data…</p>`;
    return;
  }

  if (_state.error) {
    root.innerHTML = `
      <div class="tile" style="color:var(--danger,#c00);">
        <b>Error loading dashboard:</b> ${esc(_state.error)}
      </div>
      <button class="btn" id="mod-refresh-btn" type="button">Retry</button>
    `;
    root.querySelector("#mod-refresh-btn")?.addEventListener("click", load);
    return;
  }

  const d = _state.data;
  if (!d) {
    root.innerHTML = `<p class="muted">Not available — admin login required.</p>`;
    return;
  }

  const { pendingQtQuestions = [], openDivisions = [], billsMissingDebate = [], recentAuditLog = [] } = d;

  root.innerHTML = `
    ${_state.toast ? `<div class="toast ${_state.toast.ok ? "toast-ok" : "toast-err"}" style="position:fixed;top:16px;right:16px;padding:10px 16px;border-radius:6px;background:${_state.toast.ok ? "#1a7f37" : "#c00"};color:#fff;z-index:9999;">${esc(_state.toast.msg)}</div>` : ""}

    <div class="bbc-masthead"><div class="bbc-title">Moderator Dashboard</div></div>

    <section class="panel" style="margin-bottom:16px;">
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button class="btn" id="mod-refresh-btn" type="button">↻ Refresh</button>
        <button class="btn" id="mod-sync-discourse-btn" type="button">Sync Discourse Topics</button>
        <button class="btn" id="mod-sync-groups-btn" type="button">Sync Discourse Groups</button>
      </div>
    </section>

    <!-- Pending QT Questions -->
    <section class="panel tile" style="margin-bottom:16px;">
      <h2 style="margin-top:0;">Pending Question Time Questions (${pendingQtQuestions.length})</h2>
      ${pendingQtQuestions.length ? `
        <table style="width:100%;border-collapse:collapse;font-size:0.9em;">
          <thead><tr style="text-align:left;border-bottom:2px solid #ccc;">
            <th style="padding:6px;">Office</th>
            <th style="padding:6px;">Asked By</th>
            <th style="padding:6px;">Question</th>
            <th style="padding:6px;">Asked</th>
            <th style="padding:6px;">Action</th>
          </tr></thead>
          <tbody>
            ${pendingQtQuestions.map((q) => `
              <tr style="border-bottom:1px solid #eee;">
                <td style="padding:6px;">${esc(q.office_id)}</td>
                <td style="padding:6px;">${esc(q.asked_by_name || "—")}</td>
                <td style="padding:6px;">${esc((q.text || "").slice(0, 80))}${(q.text || "").length > 80 ? "…" : ""}</td>
                <td style="padding:6px;">${esc(q.asked_at_sim || fmtDate(q.created_at))}</td>
                <td style="padding:6px;">
                  <button class="btn" type="button" data-action="archive-qt" data-id="${esc(q.id)}">Archive</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      ` : `<p class="muted">No pending questions.</p>`}
    </section>

    <!-- Open Divisions -->
    <section class="panel tile" style="margin-bottom:16px;">
      <h2 style="margin-top:0;">Open Divisions (${openDivisions.length})</h2>
      ${openDivisions.length ? `
        <table style="width:100%;border-collapse:collapse;font-size:0.9em;">
          <thead><tr style="text-align:left;border-bottom:2px solid #ccc;">
            <th style="padding:6px;">Title</th>
            <th style="padding:6px;">Entity</th>
            <th style="padding:6px;">Votes</th>
            <th style="padding:6px;">Closes</th>
            <th style="padding:6px;">Action</th>
          </tr></thead>
          <tbody>
            ${openDivisions.map((div) => `
              <tr style="border-bottom:1px solid #eee;">
                <td style="padding:6px;">${esc(div.title || "—")}</td>
                <td style="padding:6px;">${esc(div.entity_type)} / ${esc(div.entity_id)}</td>
                <td style="padding:6px;">${div.vote_count ?? 0}</td>
                <td style="padding:6px;">${div.closes_at ? fmtDate(div.closes_at) : "No deadline"}</td>
                <td style="padding:6px;">
                  <button class="btn" type="button" data-action="close-division" data-id="${esc(div.id)}">Close</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      ` : `<p class="muted">No open divisions.</p>`}
    </section>

    <!-- Bills Awaiting Debate -->
    <section class="panel tile" style="margin-bottom:16px;">
      <h2 style="margin-top:0;">Bills at Second Reading Without Debate Topic (${billsMissingDebate.length})</h2>
      ${billsMissingDebate.length ? `
        <table style="width:100%;border-collapse:collapse;font-size:0.9em;">
          <thead><tr style="text-align:left;border-bottom:2px solid #ccc;">
            <th style="padding:6px;">Bill ID</th>
            <th style="padding:6px;">Title</th>
            <th style="padding:6px;">Stage</th>
            <th style="padding:6px;">Updated</th>
          </tr></thead>
          <tbody>
            ${billsMissingDebate.map((b) => `
              <tr style="border-bottom:1px solid #eee;">
                <td style="padding:6px;">${esc(b.id)}</td>
                <td style="padding:6px;">${esc(b.title || "—")}</td>
                <td style="padding:6px;">${esc(b.stage || "—")}</td>
                <td style="padding:6px;">${fmtDate(b.updated_at)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        <p class="muted" style="margin-top:8px;">Use the "Sync Discourse Topics" button above to automatically create missing debate topics.</p>
      ` : `<p class="muted">All Second Reading bills have debate topics.</p>`}
    </section>

    <!-- Recent Audit Log -->
    <section class="panel tile" style="margin-bottom:16px;">
      <h2 style="margin-top:0;">Recent Audit Log</h2>
      ${recentAuditLog.length ? `
        <table style="width:100%;border-collapse:collapse;font-size:0.85em;">
          <thead><tr style="text-align:left;border-bottom:2px solid #ccc;">
            <th style="padding:5px;">Time</th>
            <th style="padding:5px;">Actor</th>
            <th style="padding:5px;">Action</th>
            <th style="padding:5px;">Entity</th>
          </tr></thead>
          <tbody>
            ${recentAuditLog.map((e) => `
              <tr style="border-bottom:1px solid #eee;">
                <td style="padding:5px;white-space:nowrap;">${fmtDate(e.created_at)}</td>
                <td style="padding:5px;">${esc(e.actor_id)}</td>
                <td style="padding:5px;">${esc(e.action)}</td>
                <td style="padding:5px;">${esc(e.entity_type || e.target || "")} ${e.entity_id ? `/ ${esc(e.entity_id)}` : ""}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        <div style="margin-top:10px;display:flex;gap:8px;">
          <button class="btn" id="mod-audit-prev" type="button" ${_state.auditOffset === 0 ? "disabled" : ""}>← Prev</button>
          <span class="muted" style="align-self:center;">Page ${Math.floor(_state.auditOffset / 20) + 1}</span>
          <button class="btn" id="mod-audit-next" type="button" ${_state.auditOffset + 20 >= _state.auditTotal ? "disabled" : ""}>Next →</button>
        </div>
      ` : `<p class="muted">No audit log entries.</p>`}
    </section>
  `;

  // Wire buttons
  root.querySelector("#mod-refresh-btn")?.addEventListener("click", load);

  root.querySelector("#mod-sync-discourse-btn")?.addEventListener("click", async () => {
    try {
      const result = await apiAdminSyncDiscourseBills();
      showToast(`Synced ${result.total} bill(s). ${result.results?.filter((r) => r.ok).length || 0} topic(s) created.`);
      await load();
    } catch (e) {
      showToast(`Sync failed: ${e.message}`, false);
    }
  });

  root.querySelector("#mod-sync-groups-btn")?.addEventListener("click", async () => {
    try {
      const result = await apiAdminSyncDiscourseGroups();
      showToast(`Groups synced. Added ${result.totalAdded}, removed ${result.totalRemoved}.`);
    } catch (e) {
      showToast(`Groups sync failed: ${e.message}`, false);
    }
  });

  root.querySelectorAll("[data-action='archive-qt']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      try {
        await apiQtArchiveQuestion(id);
        showToast("Question archived.");
        await load();
      } catch (e) {
        showToast(`Archive failed: ${e.message}`, false);
      }
    });
  });

  root.querySelectorAll("[data-action='close-division']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      try {
        const result = await apiCloseDivision(id);
        showToast(`Division closed. Ayes: ${result.tally?.aye || 0}, Noes: ${result.tally?.no || 0}.`);
        await load();
      } catch (e) {
        showToast(`Close failed: ${e.message}`, false);
      }
    });
  });

  root.querySelector("#mod-audit-prev")?.addEventListener("click", async () => {
    _state.auditOffset = Math.max(0, _state.auditOffset - 20);
    await loadAuditPage();
  });

  root.querySelector("#mod-audit-next")?.addEventListener("click", async () => {
    _state.auditOffset += 20;
    await loadAuditPage();
  });
}

async function loadAuditPage() {
  try {
    const { entries, total } = await apiGetAuditLog({ limit: 20, offset: _state.auditOffset });
    _state.data.recentAuditLog = entries;
    _state.auditTotal = total;
    render();
  } catch (e) {
    showToast(`Audit log load failed: ${e.message}`, false);
  }
}

async function load() {
  _state.loading = true;
  _state.error = null;
  render();

  try {
    const data = await apiAdminDashboard();
    const auditData = await apiGetAuditLog({ limit: 20, offset: _state.auditOffset });
    _state.data = { ...data, recentAuditLog: auditData.entries };
    _state.auditTotal = auditData.total;
    _state.loading = false;
  } catch (e) {
    _state.error = e.message;
    _state.loading = false;
  }
  render();
}

export function initModeratorDashboardPage(_data) {
  load();
}
