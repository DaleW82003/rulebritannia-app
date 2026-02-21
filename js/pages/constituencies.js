import { setHTML, esc } from "../ui.js";
import { saveData } from "../core.js";
import { isAdmin, isMod, isSpeaker, canAdminModOrSpeaker } from "../permissions.js";

const REGION_TEMPLATE = [
  ["England", "North East", 25],
  ["England", "North West", 70],
  ["England", "Yorkshire and The Humber", 50],
  ["England", "East Midlands", 40],
  ["England", "West Midlands", 55],
  ["England", "East of England", 52],
  ["England", "London", 70],
  ["England", "South East", 85],
  ["England", "South West", 73],
  ["Scotland", "Scotland", 72],
  ["Wales", "Wales", 40],
  ["Northern Ireland", "Northern Ireland", 18]
];

function slugify(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function canManage(data) {
  return canAdminModOrSpeaker(data);
}

function activeMpNameForConstituency(data, constituencyName) {
  const cName = String(constituencyName || "").toLowerCase();
  const player = (data.players || []).find((p) => String(p.constituency || "").toLowerCase() === cName);
  return player?.name || "";
}

function seatLabel(c, data) {
  const existingChar = activeMpNameForConstituency(data, c.name);
  if (existingChar) return `${existingChar} (Character)`;
  if (c.mpType === "npc" && c.mpName) return `${c.mpName} (NPC)`;
  if (c.mpType === "character" && c.mpName) return `${c.mpName} (Character)`;
  return "Available";
}

function ensureConstituencyAssignments(data) {
  data.constituencies ??= [];
  data.players ??= [];
  data.constituencies.forEach((c) => {
    const charName = activeMpNameForConstituency(data, c.name);
    if (charName) {
      c.mpType = "character";
      c.mpName = charName;
    } else {
      c.mpType = c.mpType || "";
      c.mpName = c.mpName || "";
    }
  });
}

function buildSynthetic650(data) {
  const parties = Array.isArray(data?.parliament?.parties) ? data.parliament.parties : [];
  const bySeats = parties.slice().sort((a, b) => Number(b.seats || 0) - Number(a.seats || 0));
  const bag = [];
  bySeats.forEach((p) => {
    const seats = Math.max(0, Number(p.seats || 0));
    for (let i = 0; i < seats; i += 1) bag.push(p.name);
  });
  while (bag.length < 650) bag.push("Others");

  let idx = 0;
  const output = [];
  REGION_TEMPLATE.forEach(([nation, region, count]) => {
    for (let i = 1; i <= count; i += 1) {
      const name = `${region} Constituency ${String(i).padStart(2, "0")}`;
      output.push({
        id: slugify(`${nation}-${region}-${i}`),
        name,
        nation,
        region,
        party: bag[idx] || "Others",
        mpType: "",
        mpName: ""
      });
      idx += 1;
    }
  });
  return output;
}

function groupedByNationRegion(constituencies) {
  const grouped = {};
  constituencies.forEach((c) => {
    grouped[c.nation] ??= {};
    grouped[c.nation][c.region] ??= [];
    grouped[c.nation][c.region].push(c);
  });
  Object.values(grouped).forEach((regions) => Object.values(regions).forEach((list) => list.sort((a, b) => a.name.localeCompare(b.name))));
  return grouped;
}

function renderOpenConstituencies(data) {
  const grouped = groupedByNationRegion(data.constituencies || []);
  const nations = ["England", "Scotland", "Wales", "Northern Ireland"];
  return nations.filter((n) => grouped[n]).map((nation) => {
    const regionNames = Object.keys(grouped[nation]).sort((a, b) => a.localeCompare(b));
    return `
      <section class="panel" style="margin-bottom:12px;">
        <h3 style="margin-top:0;">${esc(nation)}</h3>
        ${regionNames.map((region) => `
          <div class="muted-block" style="margin-bottom:10px;">
            <div class="wgo-kicker">${esc(region)}</div>
            <div class="small" style="margin:6px 0 8px;">${grouped[nation][region].length} seats</div>
            <div style="display:grid;gap:4px;">
              ${grouped[nation][region].map((c) => `<div class="kv"><span>${esc(c.name)}</span><b>${esc(seatLabel(c, data))}</b></div>`).join("")}
            </div>
          </div>
        `).join("")}
      </section>
    `;
  }).join("");
}

function refreshAll(data) {
  ensureConstituencyAssignments(data);
  const total = (data.constituencies || []).length;
  const available = (data.constituencies || []).filter((c) => seatLabel(c, data) === "Available").length;

  setHTML("parliament-summary", `
    <div class="wgo-tile">
      <div class="wgo-kicker">STATE OF PARLIAMENT</div>
      <div class="kv"><span>Total Constituencies</span><b>${total}/650</b></div>
      <div class="kv"><span>Open Constituencies</span><b>${available}</b></div>
      <div class="kv"><span>Assigned (Character/NPC)</span><b>${total - available}</b></div>
    </div>
  `);

  setHTML("party-constituencies", renderOpenConstituencies(data) || `<div class="muted-block">No constituencies configured.</div>`);

  const partySelect = document.getElementById("constParty");
  if (partySelect) {
    const parties = Array.isArray(data?.parliament?.parties) ? data.parliament.parties : [];
    partySelect.innerHTML = parties.map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join("");
  }

  const mpType = document.getElementById("constMpType");
  if (mpType) mpType.value = "";

  const listRoot = document.getElementById("constEditorList");
  if (listRoot) {
    listRoot.innerHTML = (data.constituencies || []).slice().sort((a, b) => a.name.localeCompare(b.name)).map((c) => `
      <div class="docket-item">
        <div class="docket-left"><div><div class="docket-title">${esc(c.name)}</div><div class="docket-detail">${esc(c.party)} • ${esc(c.region)} • ${esc(c.nation)} • MP: ${esc(seatLabel(c, data))}</div></div></div>
        <div class="tile-bottom" style="padding-top:0; margin-top:0;"><button class="btn" type="button" data-edit-id="${esc(c.id)}">Edit</button><button class="btn danger" type="button" data-delete-id="${esc(c.id)}">Remove</button></div>
      </div>
    `).join("");
  }

  bindEditorRowActions(data);
}

function bindEditorRowActions(data) {
  const form = document.getElementById("constEditorForm");
  if (!form) return;

  document.querySelectorAll("[data-delete-id]").forEach((btn) => btn.addEventListener("click", () => {
    const id = btn.getAttribute("data-delete-id");
    data.constituencies = (data.constituencies || []).filter((c) => c.id !== id);
    saveData(data);
    refreshAll(data);
  }));

  document.querySelectorAll("[data-edit-id]").forEach((btn) => btn.addEventListener("click", () => {
    const c = (data.constituencies || []).find((x) => x.id === btn.getAttribute("data-edit-id"));
    if (!c) return;
    form.querySelector("#constId").value = c.id;
    form.querySelector("#constName").value = c.name;
    form.querySelector("#constNation").value = c.nation;
    form.querySelector("#constRegion").value = c.region;
    form.querySelector("#constParty").value = c.party;
    form.querySelector("#constMpType").value = c.mpType || "";
    form.querySelector("#constMpName").value = c.mpName || "";
  }));
}

function bindEditor(data) {
  const panel = document.getElementById("constituencyEditorPanel");
  const openBtn = document.getElementById("constituencyEditorBtn");
  const form = document.getElementById("constEditorForm");
  const resetBtn = document.getElementById("constEditorReset");
  const seedBtn = document.getElementById("constituencySeed650");
  if (!panel || !openBtn || !form || !resetBtn) return;

  const allowed = canManage(data);
  openBtn.style.display = allowed ? "" : "none";
  if (!allowed) return;

  openBtn.addEventListener("click", () => { panel.style.display = panel.style.display === "none" ? "" : "none"; });
  seedBtn?.addEventListener("click", () => {
    data.constituencies = buildSynthetic650(data);
    saveData(data);
    refreshAll(data);
  });

  resetBtn.addEventListener("click", () => {
    form.reset();
    form.querySelector("#constId").value = "";
  });

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const id = form.querySelector("#constId").value.trim();
    const name = form.querySelector("#constName").value.trim();
    const nation = form.querySelector("#constNation").value;
    const region = form.querySelector("#constRegion").value.trim();
    const party = form.querySelector("#constParty").value;
    const mpType = form.querySelector("#constMpType").value;
    const mpName = form.querySelector("#constMpName").value.trim();
    if (!name || !nation || !region || !party) return;

    data.constituencies ??= [];
    const payload = { name, nation, region, party, mpType, mpName };

    if (id) {
      const existing = data.constituencies.find((c) => c.id === id);
      if (existing) Object.assign(existing, payload);
    } else {
      data.constituencies.push({ id: slugify(`${name}-${Math.random().toString(36).slice(2, 6)}`), ...payload });
    }

    saveData(data);
    form.reset();
    form.querySelector("#constId").value = "";
    refreshAll(data);
  });
}

export function initConstituenciesPage(data) {
  data.parliament ??= {};
  data.constituencies ??= [];
  ensureConstituencyAssignments(data);
  refreshAll(data);
  bindEditor(data);
}
