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

function canManage(data) {
  return canAdminModOrSpeaker(data);
}

function labelControl(control) {
  if (control === "coalition") return "Coalition";
  if (control === "minority") return "Minority";
  return "Majority";
}

function renderBodyTile(body) {
  if (body.type === "mayors") {
    return `
      <article class="body-tile" style="margin-bottom:12px;">
        <div class="body-head">
          <div class="body-name">${esc(body.name)}</div>
          <div class="commons-badge">Visible</div>
        </div>
        <div class="body-desc">Directly elected mayoralties relevant to the simulation period.</div>
        <div class="muted-block" style="margin-top:12px;">
          ${(body.mayors || []).map((m) => `<div class="kv"><span>${esc(m.mayoralty)}</span><b>${esc(m.name)} (${esc(m.party)})</b></div>`).join("") || "No mayor data."}
        </div>
      </article>
    `;
  }

  const visibleBadge = body.visible === false ? "Hidden" : "Visible";
  const partyRows = (body.parties || []).map((p) => `<div class="kv"><span>${esc(p.name)}</span><b>${Number(p.seats || 0)}</b></div>`).join("");

  return `
    <article class="body-tile" style="margin-bottom:12px; ${body.visible === false ? "opacity:.55;" : ""}">
      <div class="body-head">
        <div class="body-name">${esc(body.name)}</div>
        <div class="commons-badge">${esc(visibleBadge)}</div>
      </div>
      <div class="body-desc">${esc(body.desc || "")}</div>
      <div class="kv" style="margin-top:10px;"><span>Control Setup</span><b>${esc(labelControl(body.controlType))} (${esc(body.controlParty || "—")})</b></div>
      <div class="kv"><span>Total Seats</span><b>${Number(body.totalSeats || 0)}</b></div>
      <div class="muted-block" style="margin-top:10px;">${partyRows || "No seat breakdown configured."}</div>
    </article>
  `;
}

function refreshBodies(data) {
  const list = Array.isArray(data?.bodies?.list) ? data.bodies.list : [];
  const ordered = list.slice().sort((a, b) => BODY_ORDER.indexOf(a.id) - BODY_ORDER.indexOf(b.id));
  const visibleOnly = ordered.filter((b) => b.visible !== false);
  setHTML("bodies-root", visibleOnly.length ? visibleOnly.map(renderBodyTile).join("") : `<div class="muted-block">No visible bodies configured.</div>`);

  const bodySelect = document.getElementById("bodySelect");
  if (bodySelect) {
    bodySelect.innerHTML = ordered.filter((b) => b.type !== "mayors").map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("");
  }
}

function bindEditor(data) {
  const btn = document.getElementById("bodiesEditorBtn");
  const panel = document.getElementById("bodiesEditorPanel");
  const form = document.getElementById("bodiesEditorForm");
  const select = document.getElementById("bodySelect");
  if (!btn || !panel || !form || !select) return;

  const allowed = canManage(data);
  btn.style.display = allowed ? "" : "none";
  if (!allowed) return;

  const getBody = () => (data.bodies?.list || []).find((b) => b.id === select.value);
  const loadForm = () => {
    const body = getBody();
    if (!body) return;
    form.querySelector("#bodyVisible").checked = body.visible !== false;
    form.querySelector("#bodyControl").value = body.controlType || "majority";
    form.querySelector("#bodyControlParty").value = body.controlParty || "";
  };

  btn.addEventListener("click", () => {
    panel.style.display = panel.style.display === "none" ? "" : "none";
    loadForm();
  });

  select.addEventListener("change", loadForm);

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const body = getBody();
    if (!body) return;
    body.visible = form.querySelector("#bodyVisible").checked;
    body.controlType = form.querySelector("#bodyControl").value;
    body.controlParty = form.querySelector("#bodyControlParty").value.trim();
    saveState(data);
    refreshBodies(data);
  });
}

export function initBodiesPage(data) {
  data.bodies ??= { list: [] };
  refreshBodies(data);
  bindEditor(data);
}
