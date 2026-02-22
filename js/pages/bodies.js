import { setHTML, esc } from "../ui.js";
import { isAdmin, isMod, isSpeaker, canAdminModOrSpeaker } from "../permissions.js";
import { saveState } from "../core.js";

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

function canManage(data) {
  return canAdminModOrSpeaker(data);
}

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

  const partyRows = (body.parties || []).map((p) => `<div class="kv"><span>${esc(p.name)}</span><b>${Number(p.seats || 0)} seats</b></div>`).join("");

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

  const partyLines = (body.parties || []).map((p) => `${p.name}=${p.seats}`).join("\n");
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

        <label>Seat Breakdown<br><span class="small">One per line:<br>Party=Seats</span></label>
        <textarea name="parties" rows="8" placeholder="Labour=25&#10;Conservative=20">${esc(partyLines)}</textarea>

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
        const partyText = String(fd.get("parties") || "");
        body.parties = partyText.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
          const idx = l.indexOf("="); // split on first '=' so party names cannot contain '='
          const name = idx >= 0 ? l.slice(0, idx).trim() : l.trim();
          const seats = idx >= 0 ? Number(l.slice(idx + 1).trim()) : 0;
          return { name, seats: Number.isFinite(seats) ? seats : 0 };
        }).filter((p) => p.name);
      }

      saveState(data);
      state.editingBodyId = null;
      refreshBodies(data);
      renderControlPanel(data, state);
    });
  });
}

function bindEditor(data, state) {
  const btn = document.getElementById("bodiesEditorBtn");
  const panel = document.getElementById("bodiesEditorPanel");
  if (!btn || !panel) return;

  const allowed = canManage(data);
  btn.style.display = allowed ? "" : "none";
  if (!allowed) return;

  renderControlPanel(data, state);

  btn.addEventListener("click", () => {
    panel.style.display = panel.style.display === "none" ? "" : "none";
  });
}

export function initBodiesPage(data) {
  ensureBodyDefaults(data);
  const state = { editingBodyId: null };
  refreshBodies(data);
  bindEditor(data, state);
}
