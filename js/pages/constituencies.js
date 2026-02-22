import { setHTML, esc } from "../ui.js";
import { saveState } from "../core.js";
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

function getLargestParty(data) {
  const parties = Array.isArray(data?.parliament?.parties) ? data.parliament.parties : [];
  if (!parties.length) return "—";
  const sorted = parties.slice().sort((a, b) => Number(b.seats || 0) - Number(a.seats || 0));
  return sorted[0]?.name || "—";
}

function getPM(data) {
  const offices = data?.government?.offices || [];
  return offices.find((o) => o.id === "prime-minister")?.holderName || "Vacant";
}

function getLeaderOfOpposition(data) {
  const offices = data?.opposition?.offices || [];
  return offices.find((o) => o.id === "leader-opposition")?.holderName || "Vacant";
}

function renderStateOfParliament(data) {
  const parl = data.parliament || {};
  const totalSeats = parl.totalSeats || 650;
  const largestParty = getLargestParty(data);
  const governingParties = Array.isArray(parl.governingParties) && parl.governingParties.length
    ? parl.governingParties.join(", ")
    : "—";
  const govType = parl.governmentType || "—";
  const pm = getPM(data);
  const loto = getLeaderOfOpposition(data);

  return `
    <div class="wgo-tile">
      <div class="wgo-kicker">STATE OF PARLIAMENT</div>
      <div class="kv"><span>Total Seats</span><b>${esc(String(totalSeats))}</b></div>
      <div class="kv"><span>Government Type</span><b>${esc(govType)}</b></div>
      <div class="kv"><span>Largest Party</span><b>${esc(largestParty)}</b></div>
      <div class="kv"><span>Governing Party/Parties</span><b>${esc(governingParties)}</b></div>
      <div class="kv"><span>Prime Minister</span><b>${esc(pm)}</b></div>
      <div class="kv"><span>Leader of the Opposition</span><b>${esc(loto)}</b></div>
    </div>
  `;
}

function renderPartyTiles(data) {
  const parties = Array.isArray(data?.parliament?.parties) ? data.parliament.parties : [];
  if (!parties.length) return `<div class="muted-block">No parties configured.</div>`;

  return `
    <div class="wgo-grid">
      ${parties.map((p) => {
        const constCount = (data.constituencies || []).filter((c) => c.party === p.name).length;
        return `
          <div class="wgo-tile card-flex">
            <div class="wgo-kicker">${esc(p.name)}</div>
            <div class="wgo-title">${esc(String(p.seats || 0))} seats</div>
            <div class="wgo-strap">${esc(String(constCount))} constituencies assigned</div>
            <div class="tile-bottom">
              <button class="btn" type="button" data-party-list="${esc(p.name)}">View Constituencies</button>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderConstituencyListForParty(data, partyName) {
  const list = (data.constituencies || []).filter((c) => c.party === partyName).sort((a, b) => a.name.localeCompare(b.name));
  if (!list.length) return `<div class="muted-block">No constituencies assigned to ${esc(partyName)}.</div>`;
  return `
    <div class="docket-list">
      ${list.map((c) => `
        <div class="docket-item">
          <div class="docket-left"><div>
            <div class="docket-title">${esc(c.name)}</div>
            <div class="docket-detail">${esc(c.region)} • ${esc(c.nation)} • MP: ${esc(seatLabel(c, data))}</div>
          </div></div>
        </div>
      `).join("")}
    </div>
  `;
}

function bindPartyListButtons(data) {
  const panel = document.getElementById("partyConstituencyPanel");
  const title = document.getElementById("partyConstituencyTitle");
  const list = document.getElementById("partyConstituencyList");
  if (!panel || !title || !list) return;

  document.querySelectorAll("[data-party-list]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const partyName = btn.getAttribute("data-party-list");
      title.textContent = `${partyName} — Constituencies`;
      list.innerHTML = renderConstituencyListForParty(data, partyName);
      panel.style.display = "";
    });
  });
}

function refreshAll(data) {
  ensureConstituencyAssignments(data);

  setHTML("parliament-summary", renderStateOfParliament(data));
  setHTML("party-seats", renderPartyTiles(data));
  bindPartyListButtons(data);

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
  renderParliamentSetupForm(data);
}

function renderParliamentSetupForm(data) {
  const formRoot = document.getElementById("parliamentSetupForm");
  if (!formRoot) return;
  const parl = data.parliament || {};
  const totalSeats = parl.totalSeats || 650;
  const parties = Array.isArray(parl.parties) ? parl.parties : [];
  const govType = parl.governmentType || "";
  const governingParties = Array.isArray(parl.governingParties) ? parl.governingParties : [];

  const allocated = parties.reduce((sum, p) => sum + Number(p.seats || 0), 0);

  formRoot.innerHTML = `
    <div class="form-grid">
      <label for="parlTotalSeats">Total Seats in Parliament</label>
      <input id="parlTotalSeats" type="number" min="1" max="2000" value="${esc(String(totalSeats))}" required>

      <label for="parlGovType">Government Type</label>
      <select id="parlGovType">
        <option value="Majority" ${govType === "Majority" ? "selected" : ""}>Majority</option>
        <option value="Minority" ${govType === "Minority" ? "selected" : ""}>Minority</option>
        <option value="Coalition" ${govType === "Coalition" ? "selected" : ""}>Coalition</option>
        <option value="—" ${!govType || govType === "—" ? "selected" : ""}>Not set</option>
      </select>

      <label for="parlGovParties">Governing Party/Parties (comma-separated)</label>
      <input id="parlGovParties" type="text" placeholder="e.g. Labour, Liberal Democrats" value="${esc(governingParties.join(", "))}">

      <label>Seats per Party</label>
      <div>
        ${parties.map((p) => `
          <div class="kv">
            <span>${esc(p.name)}</span>
            <input type="number" min="0" max="2000" data-party-seats="${esc(p.name)}" value="${esc(String(p.seats || 0))}" style="width:80px;">
          </div>
        `).join("")}
        <div class="kv" style="margin-top:8px;">
          <span>Total allocated</span>
          <b id="parlAllocated">${allocated} / ${totalSeats}</b>
        </div>
      </div>

      <div></div>
      <div class="tile-bottom" style="padding-top:0; margin-top:0;">
        <button class="btn primary" type="button" id="parlSetupSave">Save Parliament Setup</button>
        <span id="parlSetupMsg" class="muted" style="margin-left:8px;"></span>
      </div>
    </div>
  `;

  // Live update allocated count
  formRoot.querySelectorAll("[data-party-seats]").forEach((inp) => {
    inp.addEventListener("input", () => {
      const total = Number(formRoot.querySelector("#parlTotalSeats")?.value || 0);
      const allocated2 = Array.from(formRoot.querySelectorAll("[data-party-seats]")).reduce((s, i) => s + Number(i.value || 0), 0);
      const el = formRoot.querySelector("#parlAllocated");
      if (el) el.textContent = `${allocated2} / ${total}`;
    });
  });

  formRoot.querySelector("#parlSetupSave")?.addEventListener("click", () => {
    const total = Number(formRoot.querySelector("#parlTotalSeats")?.value || 650);
    const govType2 = formRoot.querySelector("#parlGovType")?.value || "—";
    const govPartiesRaw = formRoot.querySelector("#parlGovParties")?.value || "";
    const govParties2 = govPartiesRaw.split(",").map((s) => s.trim()).filter(Boolean);

    const alloc = Array.from(formRoot.querySelectorAll("[data-party-seats]")).reduce((s, i) => s + Number(i.value || 0), 0);
    const msgEl = formRoot.querySelector("#parlSetupMsg");
    if (alloc !== total) {
      if (msgEl) msgEl.textContent = `⚠ Error: Seats allocated (${alloc}) must equal total seats (${total}). Please adjust party seat allocations.`;
      return;
    }

    data.parliament ??= {};
    data.parliament.totalSeats = total;
    data.parliament.governmentType = govType2;
    data.parliament.governingParties = govParties2;

    formRoot.querySelectorAll("[data-party-seats]").forEach((inp) => {
      const pName = inp.getAttribute("data-party-seats");
      const party = (data.parliament.parties || []).find((p) => p.name === pName);
      if (party) party.seats = Number(inp.value || 0);
    });

    saveState(data);
    if (msgEl) msgEl.textContent = "Saved.";
    refreshAll(data);
  });
}

function bindEditorRowActions(data) {
  const form = document.getElementById("constEditorForm");
  if (!form) return;

  document.querySelectorAll("[data-delete-id]").forEach((btn) => btn.addEventListener("click", () => {
    const id = btn.getAttribute("data-delete-id");
    data.constituencies = (data.constituencies || []).filter((c) => c.id !== id);
    saveState(data);
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
  const closeListBtn = document.getElementById("partyConstituencyClose");
  if (!panel || !openBtn || !form || !resetBtn) return;

  const allowed = canManage(data);
  openBtn.style.display = allowed ? "" : "none";
  if (!allowed) return;

  openBtn.addEventListener("click", () => { panel.style.display = panel.style.display === "none" ? "" : "none"; });
  seedBtn?.addEventListener("click", () => {
    data.constituencies = buildSynthetic650(data);
    saveState(data);
    refreshAll(data);
  });

  closeListBtn?.addEventListener("click", () => {
    const p = document.getElementById("partyConstituencyPanel");
    if (p) p.style.display = "none";
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

    saveState(data);
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
