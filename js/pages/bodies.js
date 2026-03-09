import { setHTML, esc } from "../ui.js";
import { canManage } from "../permissions.js";
import { apiGetBodies, apiUpdateBody } from "../api.js";

const BODY_ORDER = [
  "lords",
  "europarl",
  "scottish-parliament",
  "welsh-assembly",
  "ni-assembly",
  "directly-elected-mayors"
];

const BODY_DEFAULTS = [
  { id: "lords", name: "House of Lords", type: "standard", desc: "The upper chamber of the UK Parliament.", visible: true, totalSeats: 800, parties: [], controlType: "majority", controlParty: "" },
  { id: "europarl", name: "European Parliament", type: "standard", desc: "The directly elected legislature of the European Union.", visible: true, totalSeats: 87, parties: [], controlType: "majority", controlParty: "" },
  { id: "scottish-parliament", name: "Scottish Parliament", type: "standard", desc: "The devolved legislature for Scotland.", visible: true, totalSeats: 129, parties: [], controlType: "majority", controlParty: "" },
  { id: "welsh-assembly", name: "Welsh Assembly (Senedd)", type: "standard", desc: "The devolved legislature for Wales.", visible: true, totalSeats: 60, parties: [], controlType: "majority", controlParty: "" },
  { id: "ni-assembly", name: "Northern Irish Assembly", type: "standard", desc: "The devolved legislature for Northern Ireland.", visible: true, totalSeats: 108, parties: [], controlType: "minority", controlParty: "" },
  { id: "directly-elected-mayors", name: "Directly Elected Mayors", type: "mayors", desc: "Directly elected mayoralties relevant to the simulation period.", visible: true, mayors: [] }
];

const OTHERS_PARTY = "Others";
const ALWAYS_INCLUDE_COMMONS = ["Conservative", "Labour", "Liberal Democrat"];
const SPEAKER_PARTIES = new Set(["Speaker", "The Speaker"]);

const BODY_PARTY_SCHEMA = {
  lords: { mode: "fixed", parties: ["Conservative", "Labour", "Liberal Democrat", "SNP", "Plaid Cymru", "Green", "UKIP", "DUP", "Sinn Fein", "SDLP", "Alliance", "TP", "UUP", "Independents"] },
  europarl: { mode: "fixed", parties: ["Conservative", "Labour", "Liberal Democrat", "SNP", "Plaid Cymru", "Green", "UKIP", "DUP", "Sinn Fein", "SDLP", "Alliance", "TP", "UUP", "Independents"] },
  "scottish-parliament": { mode: "fixed", parties: ["Conservative", "Labour", "Liberal Democrat", "SNP", "Green", "UKIP", "Independents"] },
  "welsh-assembly": { mode: "fixed", parties: ["Conservative", "Labour", "Liberal Democrat", "Plaid Cymru", "Green", "UKIP", "Independents"] },
  "ni-assembly": { mode: "fixed", parties: ["DUP", "Sinn Fein", "SDLP", "Alliance", "TP", "UUP", "Independents"] }
};

function labelControl(control) {
  if (control === "coalition") return "Coalition";
  if (control === "minority") return "Minority";
  return "Majority";
}

function ensureBodyDefaults(data) {
  data.bodies ??= { list: [] };
  if (!Array.isArray(data.bodies.list)) data.bodies.list = [];
  const existingIds = new Set(data.bodies.list.map((b) => b.id));
  for (const def of BODY_DEFAULTS) {
    if (!existingIds.has(def.id)) {
      data.bodies.list.push({ ...def, parties: [...(def.parties || [])], mayors: [...(def.mayors || [])] });
    }
  }
}

function parseLegacyPartyText(text) {
  return String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const idx = l.indexOf("=");
      const name = idx >= 0 ? l.slice(0, idx).trim() : l.trim();
      const seats = idx >= 0 ? Number(l.slice(idx + 1).trim()) : 0;
      return { name, seats: Number.isFinite(seats) ? Math.max(0, seats) : 0 };
    })
    .filter((p) => p.name);
}

function getCommonsParties(data) {
  const counts = new Map();
  for (const c of (data?.constituencies || [])) {
    const party = String(c?.party || "").trim();
    if (!party || SPEAKER_PARTIES.has(party)) continue;
    counts.set(party, (counts.get(party) || 0) + 1);
  }
  for (const party of ALWAYS_INCLUDE_COMMONS) {
    if (!counts.has(party)) counts.set(party, 0);
  }
  return Array.from(counts.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .map(([party]) => party);
}

function getBodyPartyList(bodyId, commonsParties) {
  const schema = BODY_PARTY_SCHEMA[bodyId];
  if (!schema || schema.mode === "commons") return commonsParties;
  return [...(schema.parties || [])];
}

function normalizeBodyParties(body, canonicalParties) {
  const canonical = new Set(canonicalParties);
  const sourceParties = Array.isArray(body?.parties)
    ? body.parties
    : typeof body?.parties === "string"
      ? parseLegacyPartyText(body.parties)
      : [];
  const totals = new Map(canonicalParties.map((name) => [name, 0]));
  let others = 0;

  for (const p of sourceParties) {
    const name = String(p?.name || "").trim();
    const seats = Number(p?.seats || 0);
    const cleanSeats = Number.isFinite(seats) ? Math.max(0, seats) : 0;
    if (!name || cleanSeats <= 0) continue;
    if (canonical.has(name)) totals.set(name, (totals.get(name) || 0) + cleanSeats);
    else others += cleanSeats;
  }

  body.parties = canonicalParties.map((name) => ({ name, seats: totals.get(name) || 0 }));
  body.othersSeats = others;
}

function normalizeAllStandardBodies(data) {
  const commonsParties = getCommonsParties(data);
  for (const body of (data?.bodies?.list || [])) {
    if (body?.type !== "standard") continue;
    normalizeBodyParties(body, getBodyPartyList(body.id, commonsParties));
  }
}

function getOrderedBodies(data) {
  const list = Array.isArray(data?.bodies?.list) ? data.bodies.list : [];
  return BODY_ORDER.map((id) => list.find((b) => b.id === id)).filter(Boolean);
}

function renderBodyTile(body) {
  if (body.type === "mayors") {
    return `
      <article class="body-tile" style="margin-bottom:12px;${body.visible === false ? "opacity:.55;" : ""}">
        <div class="body-head">
          <div class="body-name">${esc(body.name)}</div>
          <span class="commons-badge">${body.visible === false ? "Hidden" : "Visible"}</span>
        </div>
        <div class="body-desc">${esc(body.desc || "")}</div>
        <div class="muted-block" style="margin-top:12px;">
          ${(body.mayors || []).length ? `
            <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px;font-weight:700;padding-bottom:6px;border-bottom:1px solid var(--line);margin-bottom:6px;">
              <span>Mayoralty</span><span>Mayor</span><span>Party</span>
            </div>
            ${(body.mayors || []).map((m) => `
              <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px;padding:4px 0;">
                <span>${esc(m.mayoralty)}</span><span>${esc(m.name)}</span><span>${esc(m.party)}</span>
              </div>
            `).join("")}
          ` : `<span class="muted">No mayor data configured.</span>`}
        </div>
      </article>
    `;
  }

  const partyRows = [
    ...(body.parties || []),
    { name: OTHERS_PARTY, seats: Number(body.othersSeats || 0) }
  ].map((p) => `<div class="kv"><span>${esc(p.name)}</span><b>${Number(p.seats || 0)} seats</b></div>`).join("");

  return `
    <article class="body-tile" style="margin-bottom:12px;${body.visible === false ? "opacity:.55;" : ""}">
      <div class="body-head">
        <div class="body-name">${esc(body.name)}</div>
        <span class="commons-badge">${body.visible === false ? "Hidden" : "Visible"}</span>
      </div>
      <div class="body-desc">${esc(body.desc || "")}</div>
      <div class="muted-block" style="margin-top:10px;">
        <div class="kv"><span>Total Seats</span><b>${Number(body.totalSeats || 0)}</b></div>
        <div class="kv"><span>Control</span><b>${esc(labelControl(body.controlType))} — ${esc(body.controlParty || "—")}</b></div>
        ${partyRows || `<div class="muted">No seat breakdown configured.</div>`}
      </div>
    </article>
  `;
}

function refreshBodies(data) {
  const ordered = getOrderedBodies(data);
  const visibleBodies = ordered.filter((b) => b.visible !== false);
  setHTML("bodies-root", visibleBodies.length ? visibleBodies.map(renderBodyTile).join("") : `<div class="muted-block">No visible bodies configured.</div>`);
}

function renderBodyEditorRow(body, editingId) {
  const isEditing = editingId === body.id;

  if (!isEditing) {
    return `
      <div class="muted-block" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <div>
          <b>${esc(body.name)}</b>
          <span class="commons-badge" style="margin-left:8px;${body.visible === false ? "opacity:.6;" : ""}">${body.visible === false ? "Hidden" : "Visible"}</span>
        </div>
        <button class="btn" type="button" data-edit-body="${esc(body.id)}">Edit</button>
      </div>
    `;
  }

  if (body.type === "mayors") {
    const mayorLines = (body.mayors || []).map((m) => `${m.mayoralty}|${m.name}|${m.party}`).join("\n");
    return `
      <div class="tile" style="margin-bottom:12px;">
        <h3 style="margin-top:0;">${esc(body.name)}</h3>
        <form data-save-body="${esc(body.id)}" class="form-grid" style="align-items:start;">
          <label>Visible</label>
          <div><input type="checkbox" name="visible" style="width:auto;" ${body.visible !== false ? "checked" : ""}> Show this body to users</div>

          <label>Mayors<br><span class="small">One per line:<br>Mayoralty|Name|Party</span></label>
          <textarea name="mayors" rows="5" placeholder="Greater Manchester|Andy Burnham|Labour">${esc(mayorLines)}</textarea>

          <div></div>
          <div class="tile-bottom" style="padding-top:0;margin-top:0;">
            <button class="btn primary" type="submit">Save</button>
            <button class="btn" type="button" data-cancel-edit="${esc(body.id)}">Cancel</button>
          </div>
        </form>
      </div>
    `;
  }

  const rows = [
    ...(body.parties || []),
    { name: OTHERS_PARTY, seats: Number(body.othersSeats || 0) }
  ];
  const allocatedSeats = rows.reduce((sum, p) => sum + Math.max(0, Number(p.seats || 0)), 0);
  const unallocatedSeats = Math.max(0, Number(body.totalSeats || 0) - allocatedSeats);

  return `
    <div class="tile" style="margin-bottom:12px;">
      <h3 style="margin-top:0;">${esc(body.name)}</h3>
      <form data-save-body="${esc(body.id)}" class="form-grid" style="align-items:start;">
        <label>Visible</label>
        <div><input type="checkbox" name="visible" style="width:auto;" ${body.visible !== false ? "checked" : ""}> Show this body to users</div>

        <label>Total Seats</label>
        <input type="number" name="totalSeats" value="${esc(String(body.totalSeats || 0))}" min="0" max="9999">

        <label>Control Type</label>
        <select name="controlType">
          <option value="majority" ${body.controlType === "majority" ? "selected" : ""}>Majority</option>
          <option value="minority" ${body.controlType === "minority" ? "selected" : ""}>Minority</option>
          <option value="coalition" ${body.controlType === "coalition" ? "selected" : ""}>Coalition</option>
        </select>

        <label>Governing Party/Parties</label>
        <input type="text" name="controlParty" value="${esc(body.controlParty || "")}" placeholder="Party name(s)">

        <label>Seat Breakdown</label>
        <div>
          ${(rows || []).map((p) => `
            <div class="docket-item" style="margin-bottom:6px;">
              <div class="docket-left"><div class="docket-title">${esc(p.name)}</div></div>
              <label class="label" style="min-width:160px;">Seats
                <input class="input" type="number" min="0" step="1" name="party-seats-${esc(p.name)}" value="${Number(p.seats || 0)}">
              </label>
            </div>
          `).join("")}
          ${unallocatedSeats > 0 ? `<div class="small muted">Unallocated seats: <b>${unallocatedSeats}</b></div>` : ""}
        </div>

        <div></div>
        <div class="tile-bottom" style="padding-top:0;margin-top:0;">
          <button class="btn primary" type="submit">Save</button>
          <button class="btn" type="button" data-cancel-edit="${esc(body.id)}">Cancel</button>
        </div>
      </form>
    </div>
  `;
}

function renderControlPanel(data, state) {
  const panel = document.getElementById("bodiesEditorPanel");
  if (!panel) return;
  const ordered = getOrderedBodies(data);
  panel.innerHTML = `
    <h2>Bodies Control Panel</h2>
    <div class="muted-block" style="margin-bottom:12px;">Set visibility and edit seat data for each elected body.</div>
    ${ordered.map((body) => renderBodyEditorRow(body, state.editingBodyId)).join("")}
  `;
  bindControlPanelEvents(data, state);
}

function bindControlPanelEvents(data, state) {
  const panel = document.getElementById("bodiesEditorPanel");
  if (!panel) return;

  panel.querySelectorAll("[data-edit-body]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.editingBodyId = btn.getAttribute("data-edit-body");
      renderControlPanel(data, state);
    });
  });

  panel.querySelectorAll("[data-cancel-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.editingBodyId = null;
      renderControlPanel(data, state);
    });
  });

  panel.querySelectorAll("form[data-save-body]").forEach((form) => {
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const bodyId = form.getAttribute("data-save-body");
      const body = (data.bodies?.list || []).find((b) => b.id === bodyId);
      if (!body) return;

      const fd = new FormData(form);
      body.visible = form.querySelector('[name="visible"]')?.checked ?? true;

      if (body.type === "mayors") {
        const lines = String(fd.get("mayors") || "").split("\n").map((l) => l.trim()).filter(Boolean);
        body.mayors = lines.map((l) => {
          const parts = l.split("|").map((p) => p.trim());
          return { mayoralty: parts[0] || "", name: parts[1] || "", party: parts[2] || "" };
        });
      } else {
        body.totalSeats = Number(fd.get("totalSeats") || 0);
        body.controlType = String(fd.get("controlType") || "majority");
        body.controlParty = String(fd.get("controlParty") || "").trim();
        const rows = [
          ...(body.parties || []),
          { name: OTHERS_PARTY, seats: Number(body.othersSeats || 0) }
        ].map((p) => {
          const raw = Number(fd.get(`party-seats-${p.name}`) || 0);
          return { name: p.name, seats: Number.isFinite(raw) ? Math.max(0, raw) : 0 };
        });

        const totalAllocated = rows.reduce((sum, p) => sum + Number(p.seats || 0), 0);
        if (totalAllocated > body.totalSeats) {
          window.alert(`Seat breakdown exceeds total seats by ${totalAllocated - body.totalSeats}.`);
          return;
        }

        body.parties = rows.filter((p) => p.name !== OTHERS_PARTY);
        body.othersSeats = rows.find((p) => p.name === OTHERS_PARTY)?.seats || 0;
      }

      apiUpdateBody(bodyId, body).catch((err) => console.error("[bodies] save failed:", err)); // UI_ONLY_OK: admin config update; non-simulation-critical body data
      state.editingBodyId = null;
      refreshBodies(data);
      renderControlPanel(data, state);
    });
  });
}

function bindEditor(data, state) {
  const btn = document.getElementById("bodiesEditorBtn");
  const panel = document.getElementById("bodiesEditorPanel");
  const notice = document.getElementById("bodies-staff-notice");
  if (!btn || !panel) return;

  const allowed = canManage(data);
  btn.style.display = allowed ? "" : "none";
  if (notice) notice.style.display = allowed ? "" : "none";
  if (!allowed) return;

  renderControlPanel(data, state);

  btn.addEventListener("click", () => {
    panel.style.display = panel.style.display === "none" ? "" : "none";
  });
}

export async function initBodiesPage(data) {
  ensureBodyDefaults(data);
  try {
    const r = await apiGetBodies();
    if (r.bodies && r.bodies.length) {
      data.bodies = data.bodies || { list: [] };
      for (const b of r.bodies) {
        const idx = data.bodies.list.findIndex((x) => x.id === b.id);
        if (idx >= 0) Object.assign(data.bodies.list[idx], b);
        else data.bodies.list.push(b);
      }
    }
  } catch (err) {
    console.error("[bodies] load failed:", err);
  }
  normalizeAllStandardBodies(data);
  const state = { editingBodyId: null };
  refreshBodies(data);
  bindEditor(data, state);
}
