import { esc } from "../ui.js";
import { canAdminOrMod, isAdmin } from "../permissions.js";
import {
  apiGetCurrentElection,
  apiGetElections,
  apiGetElectionSeatTotals,
  apiGetElectionChanges,
  apiCreateElection,
  apiSaveElectionChanges,
  apiFinalizeElection,
  apiSeedElection1997,
  apiGetConstituencies,
} from "../api.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return "—";
  const s = String(d).slice(0, 10);
  const [y, m, dy] = s.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${Number(dy)} ${months[Number(m) - 1] || ""} ${y}`;
}

function statusBadge(status) {
  const colors = { pending: "#8a6d3b", finalized: "#0a7f2e" };
  const color = colors[status] || "#444";
  return `<span style="display:inline-block;padding:1px 6px;border-radius:3px;background:${color};color:#fff;font-size:11px;">${esc(status)}</span>`;
}

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  currentElection: null,
  partySummary: [],
  seatTotals: [],
  elections: [],
  editElectionId: null,        // pending election being edited
  editChanges: [],             // [{constituency_id, party_from, party_to, notes}]
  constituencies: [],          // full list for autocomplete / lookup
  showArchive: false,
  showAdminPanel: false,
  createFormVisible: false,
  error: null,
};

// ── Render ────────────────────────────────────────────────────────────────────

function renderCurrentGe(data) {
  const el = state.currentElection;
  if (!el) return `<div class="muted">No General Election recorded yet.</div>`;
  const summary = state.partySummary.slice().sort((a, b) => b.seats - a.seats);
  return `
    <div><b>${esc(el.label || fmtDate(el.polling_day))}</b> &nbsp; ${statusBadge(el.status)}</div>
    <div class="muted" style="margin-bottom:8px;">Polling day: ${fmtDate(el.polling_day)}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px;margin-top:8px;">
      ${summary.map(ps => `
        <div class="tile" style="padding:8px 12px;">
          <div style="font-weight:600;">${esc(ps.party)}</div>
          <div style="font-size:13px;">${esc(String(ps.seats))} seats${ps.voteShare ? ` — ${Number(ps.voteShare).toFixed(1)}%` : ""}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderSeatTotals() {
  const totals = state.seatTotals.slice().sort((a, b) => b.seats - a.seats);
  if (!totals.length) return `<div class="muted">No constituency data yet.</div>`;
  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px;">
      ${totals.map(t => `
        <div class="tile" style="padding:8px 12px;">
          <div style="font-weight:600;">${esc(t.party)}</div>
          <div style="font-size:13px;">${esc(String(t.seats))} constituencies</div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderElectionsList(canManage) {
  if (!state.elections.length) return `<div class="muted">No elections recorded.</div>`;
  return `
    <div class="docket-list">
      ${state.elections.map(e => `
        <div class="docket-item">
          <div class="docket-left"><div>
            <div class="docket-title">${esc(e.label || fmtDate(e.polling_day))}</div>
            <div class="docket-detail">${fmtDate(e.polling_day)} &nbsp; ${statusBadge(e.status)}</div>
          </div></div>
          ${canManage && e.status !== "finalized" ? `
            <div class="tile-bottom" style="padding-top:0;margin-top:0;">
              <button class="btn" type="button" data-edit-election="${esc(e.id)}">Edit / Add Flips</button>
            </div>
          ` : ""}
        </div>
      `).join("")}
    </div>
  `;
}

function renderFlipEditor() {
  const election = state.elections.find(e => e.id === state.editElectionId);
  if (!election) return "";
  const changes = state.editChanges;
  return `
    <section class="panel" style="margin-bottom:12px;border-left:4px solid #0052a3;">
      <h3 style="margin-top:0;">Editing: ${esc(election.label || fmtDate(election.polling_day))}</h3>
      <p class="muted">Add seat changes (flips) for this election. Only changed constituencies need to be entered.</p>

      <div id="flip-list" style="margin-bottom:10px;">
        ${changes.length ? `
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead><tr>
              <th style="text-align:left;padding:4px 8px;">Constituency</th>
              <th style="text-align:left;padding:4px 8px;">From</th>
              <th style="text-align:left;padding:4px 8px;">To</th>
              <th style="text-align:left;padding:4px 8px;">Notes</th>
              <th></th>
            </tr></thead>
            <tbody>
              ${changes.map((ch, i) => `
                <tr>
                  <td style="padding:3px 8px;">${esc(resolveConstituencyName(ch.constituency_id))}</td>
                  <td style="padding:3px 8px;">${esc(ch.party_from || "—")}</td>
                  <td style="padding:3px 8px;">${esc(ch.party_to)}</td>
                  <td style="padding:3px 8px;">${esc(ch.notes || "")}</td>
                  <td style="padding:3px 4px;"><button class="btn danger" type="button" data-remove-flip="${i}" style="padding:2px 6px;font-size:11px;">✕</button></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        ` : `<div class="muted">No flips added yet.</div>`}
      </div>

      <div class="form-grid" style="grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;align-items:end;">
        <div>
          <label class="label" for="flip-constituency">Constituency</label>
          <input id="flip-constituency" class="input" list="flip-const-list" placeholder="Type constituency name…">
          <datalist id="flip-const-list">
            ${state.constituencies.map(c => `<option value="${esc(c.id)}" label="${esc(c.name)}">${esc(c.name)}</option>`).join("")}
          </datalist>
        </div>
        <div>
          <label class="label" for="flip-party-from">From party</label>
          <input id="flip-party-from" class="input" placeholder="(auto-filled)">
        </div>
        <div>
          <label class="label" for="flip-party-to">To party</label>
          <input id="flip-party-to" class="input" placeholder="Labour, Conservative…">
        </div>
        <div>
          <label class="label" for="flip-notes">Notes (optional)</label>
          <input id="flip-notes" class="input" placeholder="">
        </div>
      </div>
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn" type="button" id="flip-add-btn">Add Flip</button>
        <button class="btn primary" type="button" id="flip-save-btn">Save All Flips</button>
        <button class="btn danger" type="button" id="flip-finalize-btn">Finalize Election (apply flips)</button>
        <button class="btn" type="button" id="flip-cancel-btn">Cancel</button>
      </div>
      <div id="flip-msg" class="muted" style="margin-top:6px;"></div>
    </section>
  `;
}

function resolveConstituencyName(id) {
  return state.constituencies.find(c => c.id === id)?.name || id;
}

function resolveConstituencyParty(id) {
  return state.constituencies.find(c => c.id === id)?.party || "";
}

function render(data) {
  const root = document.getElementById("elections-root");
  if (!root) return;

  const canManage = canAdminOrMod(data);

  root.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Elections</div></div>

    ${state.error ? `<div class="panel" style="border-left:4px solid #9d1d1d;margin-bottom:12px;color:#9d1d1d;">${esc(state.error)}</div>` : ""}

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Last General Election</h2>
      ${renderCurrentGe(data)}
    </section>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Current Seat Totals (from Constituencies)</h2>
      ${renderSeatTotals()}
    </section>

    ${state.editElectionId ? renderFlipEditor() : ""}

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">All Elections</h2>
      <button class="btn" type="button" id="toggle-archive">${state.showArchive ? "Hide" : "Show"} Archive</button>
      ${state.showArchive ? renderElectionsList(canManage) : ""}
    </section>

    ${canManage ? `
      <section class="panel" style="margin-bottom:12px;">
        <h2 style="margin-top:0;">Admin / Mod Controls</h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
          <button class="btn" type="button" id="toggle-create-form">${state.createFormVisible ? "Cancel" : "Create New Election"}</button>
          <button class="btn" type="button" id="seed-1997-btn">Re-seed 1997 GE Baseline</button>
        </div>
        ${state.createFormVisible ? `
          <form id="create-election-form" style="margin-top:8px;">
            <div class="form-grid" style="grid-template-columns:1fr 1fr 1fr;gap:8px;align-items:end;">
              <div>
                <label class="label" for="ce-type">Type</label>
                <select id="ce-type" class="input">
                  <option value="general">General Election</option>
                  <option value="by-election">By-Election</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label class="label" for="ce-polling-day">Polling Day</label>
                <input id="ce-polling-day" class="input" type="date" required>
              </div>
              <div>
                <label class="label" for="ce-label">Label</label>
                <input id="ce-label" class="input" placeholder="e.g. May 1997 General Election">
              </div>
            </div>
            <div style="margin-top:8px;">
              <button class="btn primary" type="submit">Create Election</button>
            </div>
            <div id="create-election-msg" class="muted" style="margin-top:6px;"></div>
          </form>
        ` : ""}
        <div id="admin-msg" class="muted" style="margin-top:6px;"></div>
      </section>
    ` : ""}
  `;

  // Event bindings
  root.querySelector("#toggle-archive")?.addEventListener("click", () => {
    state.showArchive = !state.showArchive;
    render(data);
  });

  root.querySelector("#toggle-create-form")?.addEventListener("click", () => {
    state.createFormVisible = !state.createFormVisible;
    render(data);
  });

  root.querySelector("#seed-1997-btn")?.addEventListener("click", async () => {
    const msgEl = root.querySelector("#admin-msg");
    if (msgEl) msgEl.textContent = "Seeding…";
    try {
      const r = await apiSeedElection1997();
      if (r.error) throw new Error(r.error);
      if (msgEl) msgEl.textContent = "✓ 1997 GE baseline seeded / updated.";
      await reload(data);
    } catch (err) {
      if (msgEl) msgEl.textContent = `Error: ${err.message}`;
    }
  });

  root.querySelector("#create-election-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msgEl = root.querySelector("#create-election-msg");
    const type = root.querySelector("#ce-type")?.value || "general";
    const polling_day = root.querySelector("#ce-polling-day")?.value || "";
    const label = root.querySelector("#ce-label")?.value?.trim() || "";
    if (!polling_day) { if (msgEl) msgEl.textContent = "Polling day is required."; return; }
    try {
      const r = await apiCreateElection({ type, polling_day, label });
      if (r.error) throw new Error(r.error);
      if (msgEl) msgEl.textContent = "✓ Election created.";
      state.createFormVisible = false;
      await reload(data);
    } catch (err) {
      if (msgEl) msgEl.textContent = `Error: ${err.message}`;
    }
  });

  // Edit election buttons
  root.querySelectorAll("[data-edit-election]").forEach(btn => {
    btn.addEventListener("click", async () => {
      state.editElectionId = btn.getAttribute("data-edit-election");
      try {
        const r = await apiGetElectionChanges(state.editElectionId);
        state.editChanges = (r.changes || []).map(ch => ({
          constituency_id: ch.constituency_id,
          party_from: ch.party_from || "",
          party_to: ch.party_to,
          notes: ch.notes || "",
        }));
      } catch { state.editChanges = []; }
      render(data);
    });
  });

  // Flip editor actions
  if (state.editElectionId) {
    const constInput = root.querySelector("#flip-constituency");
    // Auto-fill party_from when constituency changes.
    constInput?.addEventListener("change", () => {
      const val = constInput.value.trim();
      // Try exact id match first, then name match.
      const c = state.constituencies.find(x => x.id === val)
             || state.constituencies.find(x => x.name.toLowerCase() === val.toLowerCase());
      if (c) {
        constInput.value = c.id;
        const fromInput = root.querySelector("#flip-party-from");
        if (fromInput) fromInput.value = c.party;
      }
    });

    root.querySelector("#flip-add-btn")?.addEventListener("click", () => {
      const constId = root.querySelector("#flip-constituency")?.value?.trim() || "";
      const partyFrom = root.querySelector("#flip-party-from")?.value?.trim() || "";
      const partyTo = root.querySelector("#flip-party-to")?.value?.trim() || "";
      const notes = root.querySelector("#flip-notes")?.value?.trim() || "";
      if (!constId || !partyTo) {
        root.querySelector("#flip-msg").textContent = "Constituency and To Party are required.";
        return;
      }
      // Resolve by name if needed.
      const resolved = state.constituencies.find(x => x.id === constId)
                    || state.constituencies.find(x => x.name.toLowerCase() === constId.toLowerCase());
      const finalId = resolved ? resolved.id : constId;
      const finalFrom = partyFrom || resolveConstituencyParty(finalId);

      // Replace if same constituency already in list.
      const existingIdx = state.editChanges.findIndex(ch => ch.constituency_id === finalId);
      const entry = { constituency_id: finalId, party_from: finalFrom, party_to: partyTo, notes };
      if (existingIdx >= 0) state.editChanges[existingIdx] = entry;
      else state.editChanges.push(entry);

      root.querySelector("#flip-msg").textContent = "";
      render(data);
    });

    root.querySelectorAll("[data-remove-flip]").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-remove-flip"));
        state.editChanges.splice(idx, 1);
        render(data);
      });
    });

    root.querySelector("#flip-save-btn")?.addEventListener("click", async () => {
      const msgEl = root.querySelector("#flip-msg");
      try {
        const r = await apiSaveElectionChanges(state.editElectionId, { changes: state.editChanges });
        if (r.error) throw new Error(r.error);
        if (msgEl) msgEl.textContent = `✓ ${state.editChanges.length} flip(s) saved.`;
      } catch (err) {
        if (msgEl) msgEl.textContent = `Error: ${err.message}`;
      }
    });

    root.querySelector("#flip-finalize-btn")?.addEventListener("click", async () => {
      const msgEl = root.querySelector("#flip-msg");
      if (!confirm(`Finalize this election? This will apply ${state.editChanges.length} constituency flip(s) and cannot be undone.`)) return;
      try {
        // Save changes first.
        await apiSaveElectionChanges(state.editElectionId, { changes: state.editChanges });
        const r = await apiFinalizeElection(state.editElectionId);
        if (r.error) throw new Error(r.error);
        state.editElectionId = null;
        state.editChanges = [];
        await reload(data);
      } catch (err) {
        if (msgEl) msgEl.textContent = `Error: ${err.message}`;
      }
    });

    root.querySelector("#flip-cancel-btn")?.addEventListener("click", () => {
      state.editElectionId = null;
      state.editChanges = [];
      render(data);
    });
  }
}

async function reload(data) {
  try {
    const [cur, totals, elections, consts] = await Promise.all([
      apiGetCurrentElection().catch(() => ({ election: null, partySummary: [] })),
      apiGetElectionSeatTotals().catch(() => ({ totals: [] })),
      apiGetElections().catch(() => ({ elections: [] })),
      apiGetConstituencies().catch(() => ({ constituencies: [] })),
    ]);
    state.currentElection = cur.election || null;
    state.partySummary = cur.partySummary || [];
    state.seatTotals = totals.totals || [];
    state.elections = elections.elections || [];
    state.constituencies = consts.constituencies || [];
    state.error = null;
  } catch (e) {
    state.error = e.message;
  }
  render(data);
}

export async function initElectionsPage(data) {
  await reload(data);
}
