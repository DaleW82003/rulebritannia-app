import { esc } from "../ui.js";
import { canAdminOrMod } from "../permissions.js";
import {
  apiGetElectionBodiesCurrent,
  apiGetElectionBodiesArchive,
  apiSubmitElectionBodyResult,
  apiDeleteElectionBodyResult,
} from "../api.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const ELECTION_BODIES = [
  { type: "general",                  label: "General Election" },
  { type: "european_parliament",      label: "European Parliament" },
  { type: "scottish_parliament",      label: "Scottish Parliament" },
  { type: "welsh_assembly",           label: "Welsh Assembly (Senedd)" },
  { type: "northern_irish_assembly",  label: "Northern Irish Assembly" },
  { type: "english_locals",           label: "English Locals" },
  { type: "scottish_locals",          label: "Scottish Locals" },
  { type: "welsh_locals",             label: "Welsh Locals" },
  { type: "northern_irish_locals",    label: "Northern Irish Locals" },
];

const BODY_LABEL = Object.fromEntries(ELECTION_BODIES.map(b => [b.type, b.label]));

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return "—";
  const s = String(d).slice(0, 10);
  const [y, m, dy] = s.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${Number(dy)} ${months[Number(m) - 1] || ""} ${y}`;
}

function fmtNum(n) {
  if (!n) return "—";
  return Number(n).toLocaleString("en-GB");
}

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  current: [],      // [{type, label, polling_day, party_summary, turnout_total, turnout_pct, ...}]
  archive: [],      // non-current finalized results
  showArchive: false,
  showSubmitForm: false,
  submitPartyRows: [{ party: "", seats: "", votes: "", vote_share: "" }],
  error: null,
};

// ── Render helpers ────────────────────────────────────────────────────────────

function renderPartySummaryTable(partySummary, compact) {
  const rows = (partySummary || []).slice().sort((a, b) => b.seats - a.seats);
  if (!rows.length) return `<div class="muted" style="font-size:13px;">No party data.</div>`;
  if (compact) {
    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:6px;margin-top:8px;">
        ${rows.map(ps => `
          <div style="background:#f4f7fb;border-radius:8px;padding:6px 10px;">
            <div style="font-weight:700;font-size:13px;">${esc(ps.party)}</div>
            <div style="font-size:12px;color:#555;">
              ${ps.seats ? `${esc(String(ps.seats))} seats` : ""}
              ${ps.vote_share ? ` &nbsp;·&nbsp; ${Number(ps.vote_share).toFixed(1)}%` : ""}
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }
  const hasVotes = rows.some(r => r.votes);
  return `
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px;">
      <thead>
        <tr style="border-bottom:1px solid #dde3ee;">
          <th style="text-align:left;padding:4px 8px;">Party</th>
          <th style="text-align:right;padding:4px 8px;">Seats</th>
          ${hasVotes ? `<th style="text-align:right;padding:4px 8px;">Votes</th>` : ""}
          <th style="text-align:right;padding:4px 8px;">Vote share</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(ps => `
          <tr style="border-bottom:1px solid #f0f2f6;">
            <td style="padding:4px 8px;font-weight:600;">${esc(ps.party)}</td>
            <td style="padding:4px 8px;text-align:right;">${esc(String(ps.seats || 0))}</td>
            ${hasVotes ? `<td style="padding:4px 8px;text-align:right;">${ps.votes ? fmtNum(ps.votes) : "—"}</td>` : ""}
            <td style="padding:4px 8px;text-align:right;">${ps.vote_share ? `${Number(ps.vote_share).toFixed(1)}%` : "—"}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderTurnout(el) {
  if (!el.turnout_total && !el.turnout_pct) return "";
  const parts = [];
  if (el.turnout_total) parts.push(`${fmtNum(el.turnout_total)} votes cast`);
  if (el.turnout_pct)   parts.push(`Turnout: ${Number(el.turnout_pct).toFixed(2)}%`);
  return `<div style="font-size:13px;color:#555;margin-top:6px;">${parts.join(" &nbsp;·&nbsp; ")}</div>`;
}

function renderLastGE() {
  const ge = state.current.find(r => r.type === "general");
  if (!ge) return `<div class="muted">No General Election result recorded yet.</div>`;
  return `
    <div style="margin-bottom:6px;">
      <span style="font-weight:700;font-size:16px;">${esc(ge.label || fmtDate(ge.polling_day))}</span>
      <span style="margin-left:8px;font-size:13px;color:#666;">Polling day: ${fmtDate(ge.polling_day)}</span>
    </div>
    ${renderTurnout(ge)}
    ${renderPartySummaryTable(ge.party_summary, false)}
  `;
}

function renderHistoricGE() {
  const historicGEs = state.archive.filter(r => r.type === "general")
    .slice().sort((a, b) => new Date(b.polling_day) - new Date(a.polling_day));
  if (!historicGEs.length) return `<div class="muted">No historic General Elections recorded.</div>`;
  return `
    <div class="docket-list">
      ${historicGEs.map(ge => `
        <details style="border:1px solid #dde3ee;border-radius:8px;padding:0;margin-bottom:6px;overflow:hidden;">
          <summary style="padding:10px 14px;cursor:pointer;font-weight:700;list-style:none;display:flex;align-items:center;gap:10px;">
            <span style="flex:1;">${esc(ge.label || fmtDate(ge.polling_day))}</span>
            <span style="font-size:12px;color:#888;font-weight:400;">${fmtDate(ge.polling_day)}</span>
          </summary>
          <div style="padding:10px 14px;border-top:1px solid #eef0f5;">
            ${renderTurnout(ge)}
            ${renderPartySummaryTable(ge.party_summary, false)}
          </div>
        </details>
      `).join("")}
    </div>
  `;
}

function renderBodyGrid(canManage = false) {
  const bodyTypes = ELECTION_BODIES.filter(b => b.type !== "general");
  return `
    <div class="wgo-grid" style="gap:12px;">
      ${bodyTypes.map(b => {
        const result = state.current.find(r => r.type === b.type);
        return `
          <div class="wgo-tile">
            <div class="wgo-kicker">${esc(b.label)}</div>
            ${result ? `
              <div class="wgo-title" style="font-size:14px;">${esc(result.label || fmtDate(result.polling_day))}</div>
              <div class="wgo-strap">${fmtDate(result.polling_day)}</div>
              ${renderTurnout(result)}
              ${renderPartySummaryTable(result.party_summary, true)}
              ${canManage ? `<button class="btn danger" type="button" data-action="delete-election-result" data-id="${esc(String(result.id))}" style="margin-top:6px;font-size:12px;">Delete</button>` : ""}
            ` : `<div class="wgo-strap muted" style="margin-top:8px;">No result recorded yet.</div>`}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderArchiveSection(canManage = false) {
  const archived = state.archive.slice().sort((a, b) => new Date(b.polling_day) - new Date(a.polling_day));
  return `
    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;display:flex;align-items:center;gap:10px;">
        Archive
        <button class="btn" type="button" id="toggle-archive" style="font-size:12px;padding:4px 10px;">
          ${state.showArchive ? "Hide" : "Show all"}
        </button>
      </h2>
      ${state.showArchive ? (archived.length ? `
        <div class="docket-list">
          ${archived.map(el => `
            <details style="border:1px solid #dde3ee;border-radius:8px;padding:0;margin-bottom:6px;overflow:hidden;">
              <summary style="padding:10px 14px;cursor:pointer;font-weight:600;list-style:none;display:flex;align-items:center;gap:10px;">
                <span style="flex:1;">${esc(el.label || fmtDate(el.polling_day))}</span>
                <span style="font-size:12px;color:#888;font-weight:400;">${esc(BODY_LABEL[el.type] || el.type)} &nbsp;·&nbsp; ${fmtDate(el.polling_day)}</span>
                ${canManage ? `<button class="btn danger" type="button" data-action="delete-election-result" data-id="${esc(String(el.id))}" style="font-size:11px;padding:2px 8px;" onclick="event.preventDefault()">Delete</button>` : ""}
              </summary>
              <div style="padding:10px 14px;border-top:1px solid #eef0f5;">
                ${renderTurnout(el)}
                ${renderPartySummaryTable(el.party_summary, false)}
              </div>
            </details>
          `).join("")}
        </div>
      ` : `<div class="muted">No archived results yet.</div>`) : ""}
    </section>
  `;
}

function renderSubmitForm() {
  return `
    <div id="submit-election-form" style="margin-top:10px;">
      <div class="form-grid" style="grid-template-columns:1fr 1fr 1fr;gap:8px;align-items:end;margin-bottom:8px;">
        <div>
          <label class="label" for="eb-type">Election Body</label>
          <select id="eb-type" class="input">
            ${ELECTION_BODIES.map(b => `<option value="${esc(b.type)}">${esc(b.label)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="label" for="eb-polling-day">Polling Day</label>
          <input id="eb-polling-day" class="input" type="date" required>
        </div>
        <div>
          <label class="label" for="eb-label">Label</label>
          <input id="eb-label" class="input" placeholder="e.g. June 2001 General Election">
        </div>
      </div>
      <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
        <div>
          <label class="label" for="eb-turnout-total">Turnout Total (optional)</label>
          <input id="eb-turnout-total" class="input" type="number" min="0" placeholder="e.g. 31286284">
        </div>
        <div>
          <label class="label" for="eb-turnout-pct">Turnout % (optional)</label>
          <input id="eb-turnout-pct" class="input" type="number" min="0" max="100" step="0.01" placeholder="e.g. 71.46">
        </div>
      </div>

      <h4 style="margin:10px 0 6px;">Party Results</h4>
      <p class="muted" style="font-size:12px;margin:0 0 8px;">Add one row per party. Seats, votes, and vote share are all optional where not applicable.</p>
      <div id="party-rows-container">
        ${renderPartyRows()}
      </div>
      <button class="btn" type="button" id="add-party-row-btn" style="margin-top:6px;">+ Add Party</button>

      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn primary" type="button" id="submit-election-btn">Submit Result</button>
        <button class="btn" type="button" id="cancel-submit-btn">Cancel</button>
      </div>
      <div id="submit-election-msg" class="muted" style="margin-top:6px;"></div>
    </div>
  `;
}

function renderPartyRows() {
  return state.submitPartyRows.map((row, i) => `
    <div class="form-grid" style="grid-template-columns:2fr 1fr 1fr 1fr auto;gap:6px;align-items:end;margin-bottom:4px;" data-row="${i}">
      <input class="input party-row-party" type="text" placeholder="Party name" value="${esc(row.party)}" data-i="${i}">
      <input class="input party-row-seats" type="number" min="0" placeholder="Seats" value="${esc(row.seats)}" data-i="${i}">
      <input class="input party-row-votes" type="number" min="0" placeholder="Votes" value="${esc(row.votes)}" data-i="${i}">
      <input class="input party-row-share" type="number" min="0" max="100" step="0.01" placeholder="Vote %" value="${esc(row.vote_share)}" data-i="${i}">
      <button class="btn danger" type="button" data-remove-row="${i}" style="padding:6px 8px;font-size:12px;" ${state.submitPartyRows.length <= 1 ? "disabled" : ""}>✕</button>
    </div>
  `).join("");
}

function renderAdminPanel(canManage) {
  if (!canManage) return "";
  return `
    <section class="panel" style="margin-bottom:12px;border-left:4px solid #0052a3;">
      <h2 style="margin-top:0;">Elections Control Panel</h2>
      <p class="muted" style="font-size:13px;margin-top:0;">
        Election Development is not part of current Phase 1; election creation remains mod-controlled via UK Elect.
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
        <button class="btn" type="button" id="toggle-submit-form">
          ${state.showSubmitForm ? "Cancel" : "Submit New Election Result"}
        </button>
      </div>
      ${state.showSubmitForm ? renderSubmitForm() : ""}
    </section>
  `;
}

function render(data) {
  const root = document.getElementById("elections-root");
  if (!root) return;

  const canManage = canAdminOrMod(data);

  root.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Elections</div></div>

    ${state.error ? `<div class="panel" style="border-left:4px solid #9d1d1d;margin-bottom:12px;color:#9d1d1d;">${esc(state.error)}</div>` : ""}

    ${renderAdminPanel(canManage)}

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Last General Election Result</h2>
      ${renderLastGE()}
    </section>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Historic General Elections</h2>
      ${renderHistoricGE()}
    </section>

    <section style="margin-bottom:12px;">
      <h2 style="margin-top:0;margin-bottom:12px;">Devolved &amp; Local Elections</h2>
      ${renderBodyGrid(canManage)}
    </section>

    ${renderArchiveSection(canManage)}
  `;

  // ── Event bindings ────────────────────────────────────────────────────────

  root.querySelector("#toggle-archive")?.addEventListener("click", () => {
    state.showArchive = !state.showArchive;
    render(data);
  });

  root.querySelector("#toggle-submit-form")?.addEventListener("click", () => {
    state.showSubmitForm = !state.showSubmitForm;
    state.submitPartyRows = [{ party: "", seats: "", votes: "", vote_share: "" }];
    render(data);
  });

  root.querySelector("#cancel-submit-btn")?.addEventListener("click", () => {
    state.showSubmitForm = false;
    render(data);
  });

  root.querySelector("#add-party-row-btn")?.addEventListener("click", () => {
    state.submitPartyRows.push({ party: "", seats: "", votes: "", vote_share: "" });
    // Re-render only the party rows container for efficiency.
    const container = root.querySelector("#party-rows-container");
    if (container) container.innerHTML = renderPartyRows();
    bindPartyRowEvents(root, data);
  });

  bindPartyRowEvents(root, data);

  root.querySelector("#submit-election-btn")?.addEventListener("click", async () => {
    const msgEl = root.querySelector("#submit-election-msg");
    const body_type     = root.querySelector("#eb-type")?.value || "";
    const polling_day   = root.querySelector("#eb-polling-day")?.value || "";
    const label         = root.querySelector("#eb-label")?.value?.trim() || "";
    const turnout_total = Number(root.querySelector("#eb-turnout-total")?.value || 0);
    const turnout_pct   = Number(root.querySelector("#eb-turnout-pct")?.value   || 0);

    if (!polling_day) { if (msgEl) msgEl.textContent = "Polling day is required."; return; }

    // Collect party rows from DOM (live state).
    const partyRows = [];
    root.querySelectorAll("[data-row]").forEach(rowEl => {
      const party      = rowEl.querySelector(".party-row-party")?.value?.trim() || "";
      const seats      = Number(rowEl.querySelector(".party-row-seats")?.value || 0);
      const votes      = Number(rowEl.querySelector(".party-row-votes")?.value || 0);
      const vote_share = Number(rowEl.querySelector(".party-row-share")?.value || 0);
      if (party) partyRows.push({ party, seats, votes, vote_share });
    });

    try {
      if (msgEl) msgEl.textContent = "Submitting…";
      const r = await apiSubmitElectionBodyResult({
        body_type, polling_day, label, turnout_total, turnout_pct, party_summary: partyRows,
      });
      if (r.error) throw new Error(r.error);
      state.showSubmitForm = false;
      state.submitPartyRows = [{ party: "", seats: "", votes: "", vote_share: "" }];
      await reload(data);
    } catch (err) {
      if (msgEl) msgEl.textContent = `Error: ${err.message}`;
    }
  });

  root.querySelectorAll("[data-action='delete-election-result']").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!canManage) return;
      const id = String(btn.getAttribute("data-id") || "");
      if (!id) return;
      btn.disabled = true;
      try {
        await apiDeleteElectionBodyResult(id);
        await reload(data);
      } catch (err) {
        btn.disabled = false;
        alert(`Delete failed: ${err.message}`);
      }
    });
  });
}

function bindPartyRowEvents(root, data) {
  root.querySelectorAll("[data-remove-row]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-remove-row"));
      // Read current DOM state before removing.
      syncPartyRowsFromDOM(root);
      if (state.submitPartyRows.length > 1) {
        state.submitPartyRows.splice(idx, 1);
        const container = root.querySelector("#party-rows-container");
        if (container) container.innerHTML = renderPartyRows();
        bindPartyRowEvents(root, data);
      }
    });
  });
}

function syncPartyRowsFromDOM(root) {
  root.querySelectorAll("[data-row]").forEach(rowEl => {
    const i = Number(rowEl.getAttribute("data-row"));
    if (state.submitPartyRows[i]) {
      state.submitPartyRows[i].party      = rowEl.querySelector(".party-row-party")?.value?.trim() || "";
      state.submitPartyRows[i].seats      = rowEl.querySelector(".party-row-seats")?.value || "";
      state.submitPartyRows[i].votes      = rowEl.querySelector(".party-row-votes")?.value || "";
      state.submitPartyRows[i].vote_share = rowEl.querySelector(".party-row-share")?.value || "";
    }
  });
}

async function reload(data) {
  try {
    const [curr, arch] = await Promise.all([
      apiGetElectionBodiesCurrent().catch(() => ({ results: [] })),
      apiGetElectionBodiesArchive().catch(() =>  ({ results: [] })),
    ]);
    state.current = curr.results || [];
    state.archive = arch.results || [];
    state.error = null;
  } catch (e) {
    state.error = e.message;
  }
  render(data);
}

export async function initElectionsPage(data) {
  await reload(data);
}
