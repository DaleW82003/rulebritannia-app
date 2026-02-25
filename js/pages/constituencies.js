import { setHTML, esc } from "../ui.js";
import { saveState } from "../core.js";
import { isAdmin, isMod, isSpeaker, canAdminModOrSpeaker } from "../permissions.js";
import {
  apiGetCharacters,
  apiGetConstituencies,
  apiSaveConstituency,
  apiUpdateConstituency,
  apiDeleteConstituency,
  apiInitialize1997Constituencies,
  apiClearConstituencies,
} from "../api.js";

// Canonical fixed party list — never pulled from demo.json or runtime state.
// 3 playable parties + 12 NPC parties = 15 total (5 columns × 3 rows).
const CONSTITUENCY_PARTIES = [
  { name: "Conservative",     playable: true  },
  { name: "Labour",           playable: true  },
  { name: "Liberal Democrat", playable: true  },
  { name: "SNP",              playable: false },
  { name: "Plaid Cymru",      playable: false },
  { name: "Green",            playable: false },
  { name: "UKIP",             playable: false },
  { name: "DUP",              playable: false },
  { name: "Sinn Féin",        playable: false },
  { name: "SDLP",             playable: false },
  { name: "Alliance",         playable: false },
  { name: "TUP",              playable: false },
  { name: "UUP",              playable: false },
  { name: "Independents",     playable: false },
  { name: "Speaker",          playable: false },
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

function renderPartyTiles(constituencies, data) {
  // Seat counts come from live parliament data; fall back to 0 if not set.
  const liveParties = Array.isArray(data?.parliament?.parties) ? data.parliament.parties : [];
  const seatsMap = new Map(liveParties.map((p) => [p.name, Number(p.seats || 0)]));

  return `
    <div class="wgo-grid party-tiles-grid">
      ${CONSTITUENCY_PARTIES.map((p) => {
        const seats = seatsMap.get(p.name) || 0;
        const constCount = constituencies.filter((c) => c.party === p.name).length;
        const npcTag = !p.playable ? `<span class="muted" style="font-size:11px;margin-left:4px;">(NPC)</span>` : "";
        return `
          <div class="wgo-tile card-flex">
            <div class="wgo-kicker">${esc(p.name)}${npcTag}</div>
            <div class="wgo-title">${esc(String(seats))} seats</div>
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

function renderConstituencyListForParty(constituencies, partyName, data) {
  const list = constituencies.filter((c) => c.party === partyName).sort((a, b) => a.name.localeCompare(b.name));
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

function bindPartyListButtons(constituencies, data) {
  const panel = document.getElementById("partyConstituencyPanel");
  const title = document.getElementById("partyConstituencyTitle");
  const list = document.getElementById("partyConstituencyList");
  if (!panel || !title || !list) return;

  document.querySelectorAll("[data-party-list]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const partyName = btn.getAttribute("data-party-list");
      title.textContent = `${partyName} — Constituencies`;
      list.innerHTML = renderConstituencyListForParty(constituencies, partyName, data);
      panel.style.display = "";
    });
  });
}

function refreshAll(constituencies, data) {
  // Show / hide empty-state callout
  const emptyCallout = document.getElementById("constEmptyCallout");
  if (emptyCallout) {
    emptyCallout.style.display = constituencies.length === 0 && canManage(data) ? "" : "none";
  }

  setHTML("parliament-summary", renderStateOfParliament(data));
  setHTML("party-seats", renderPartyTiles(constituencies, data));
  bindPartyListButtons(constituencies, data);

  const partySelect = document.getElementById("constParty");
  if (partySelect) {
    partySelect.innerHTML = CONSTITUENCY_PARTIES.map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join("");
  }

  const mpType = document.getElementById("constMpType");
  if (mpType) mpType.value = "";

  const listRoot = document.getElementById("constEditorList");
  if (listRoot) {
    listRoot.innerHTML = constituencies.slice().sort((a, b) => a.name.localeCompare(b.name)).map((c) => `
      <div class="docket-item">
        <div class="docket-left"><div><div class="docket-title">${esc(c.name)}</div><div class="docket-detail">${esc(c.party)} • ${esc(c.region)} • ${esc(c.nation)} • MP: ${esc(seatLabel(c, data))}</div></div></div>
        <div class="tile-bottom" style="padding-top:0; margin-top:0;"><button class="btn" type="button" data-edit-id="${esc(c.id)}">Edit</button><button class="btn danger" type="button" data-delete-id="${esc(c.id)}">Remove</button></div>
      </div>
    `).join("");
  }

  bindEditorRowActions(constituencies, data);
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

  // Up to 3 custom extra parties (stored on parl.extraParties)
  const MAX_EXTRA_PARTIES = 3;
  const extraParties = Array.isArray(parl.extraParties) ? parl.extraParties : Array.from({ length: MAX_EXTRA_PARTIES }, () => ({ name: "", seats: 0 }));
  while (extraParties.length < MAX_EXTRA_PARTIES) extraParties.push({ name: "", seats: 0 });

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
        <div style="margin-top:10px;border-top:1px solid var(--line);padding-top:8px;">
          <div class="muted" style="margin-bottom:6px;">Additional parties (up to 3)</div>
          ${extraParties.slice(0, MAX_EXTRA_PARTIES).map((ep, i) => `
            <div class="kv" style="margin-bottom:6px;">
              <input type="text" placeholder="Party name" data-extra-party-name="${i}" value="${esc(ep.name || "")}" style="flex:1;min-width:120px;">
              <input type="number" min="0" max="2000" data-extra-party-seats="${i}" value="${esc(String(ep.seats || 0))}" style="width:80px;">
            </div>
          `).join("")}
        </div>
        <div class="kv" style="margin-top:8px;">
          <span>Total allocated</span>
          <b id="parlAllocated">${allocated} / ${totalSeats}</b>
        </div>
      </div>

      <div></div>
      <div class="tile-bottom" style="padding-top:0; margin-top:0;">
        <button class="btn primary" type="button" id="parlSetupSave">Save Parliament Setup</button>
        <button class="btn danger" type="button" id="clearParliamentBtn">Clear Parliament</button>
        <span id="parlSetupMsg" class="muted" style="margin-left:8px;"></span>
      </div>
    </div>
  `;

  // Live update allocated count (standard + extra parties)
  const updateAlloc = () => {
    const total = Number(formRoot.querySelector("#parlTotalSeats")?.value || 0);
    const std = Array.from(formRoot.querySelectorAll("[data-party-seats]")).reduce((s, i) => s + Number(i.value || 0), 0);
    const extra = Array.from(formRoot.querySelectorAll("[data-extra-party-seats]")).reduce((s, i) => s + Number(i.value || 0), 0);
    const el = formRoot.querySelector("#parlAllocated");
    if (el) el.textContent = `${std + extra} / ${total}`;
  };
  formRoot.querySelectorAll("[data-party-seats], [data-extra-party-seats], #parlTotalSeats").forEach((inp) => {
    inp.addEventListener("input", updateAlloc);
  });

  formRoot.querySelector("#parlSetupSave")?.addEventListener("click", () => {
    const total = Number(formRoot.querySelector("#parlTotalSeats")?.value || 650);
    const govType2 = formRoot.querySelector("#parlGovType")?.value || "—";
    const govPartiesRaw = formRoot.querySelector("#parlGovParties")?.value || "";
    const govParties2 = govPartiesRaw.split(",").map((s) => s.trim()).filter(Boolean);

    // Collect extra parties
    const newExtras = [];
    for (let i = 0; i < MAX_EXTRA_PARTIES; i++) {
      const name = String(formRoot.querySelector(`[data-extra-party-name="${i}"]`)?.value || "").trim();
      const seats = Number(formRoot.querySelector(`[data-extra-party-seats="${i}"]`)?.value || 0);
      newExtras.push({ name, seats });
    }

    const stdAlloc = Array.from(formRoot.querySelectorAll("[data-party-seats]")).reduce((s, i) => s + Number(i.value || 0), 0);
    const extraAlloc = newExtras.reduce((s, ep) => s + (ep.name ? ep.seats : 0), 0);
    const alloc = stdAlloc + extraAlloc;
    const msgEl = formRoot.querySelector("#parlSetupMsg");
    if (alloc !== total) {
      if (msgEl) msgEl.textContent = `⚠ Error: Seats allocated (${alloc}) must equal total seats (${total}). Please adjust party seat allocations.`;
      return;
    }

    data.parliament ??= {};
    data.parliament.totalSeats = total;
    data.parliament.governmentType = govType2;
    data.parliament.governingParties = govParties2;
    data.parliament.extraParties = newExtras;

    formRoot.querySelectorAll("[data-party-seats]").forEach((inp) => {
      const pName = inp.getAttribute("data-party-seats");
      const party = (data.parliament.parties || []).find((p) => p.name === pName);
      if (party) party.seats = Number(inp.value || 0);
    });

    // Merge named extra parties into parliament.parties
    for (const ep of newExtras) {
      if (!ep.name) continue;
      const existing = (data.parliament.parties || []).find((p) => p.name === ep.name);
      if (existing) {
        existing.seats = ep.seats;
      } else {
        data.parliament.parties ??= [];
        data.parliament.parties.push({ name: ep.name, seats: ep.seats });
      }
    }

    saveState(data);
    if (msgEl) msgEl.textContent = "Saved.";
  });

  formRoot.querySelector("#clearParliamentBtn")?.addEventListener("click", () => {
    if (!isAdmin(data)) return;
    if (!confirm("Clear all parliament seat allocations? This will reset all party seats to 0.")) return;
    data.parliament ??= {};
    (data.parliament.parties || []).forEach((p) => { p.seats = 0; });
    data.parliament.extraParties = [];
    saveState(data);
    renderParliamentSetupForm(data);
  });
}

function bindEditorRowActions(constituencies, data) {
  const form = document.getElementById("constEditorForm");
  if (!form) return;

  document.querySelectorAll("[data-delete-id]").forEach((btn) => btn.addEventListener("click", async () => {
    const id = btn.getAttribute("data-delete-id");
    if (!confirm("Remove this constituency?")) return;
    try {
      await apiDeleteConstituency(id);
      const fresh = await apiGetConstituencies();
      refreshAll(fresh.constituencies || [], data);
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  }));

  document.querySelectorAll("[data-edit-id]").forEach((btn) => btn.addEventListener("click", () => {
    const c = constituencies.find((x) => x.id === btn.getAttribute("data-edit-id"));
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

function bindEditor(constituencies, data) {
  const panel = document.getElementById("constituencyEditorPanel");
  const openBtn = document.getElementById("constituencyEditorBtn");
  const form = document.getElementById("constEditorForm");
  const resetBtn = document.getElementById("constEditorReset");
  const init1997Btn = document.getElementById("constituencyInit1997");
  const clearAllBtn = document.getElementById("clearAllConstituencies");
  const closeListBtn = document.getElementById("partyConstituencyClose");
  if (!panel || !openBtn || !form || !resetBtn) return;

  const allowed = canManage(data);
  openBtn.style.display = allowed ? "" : "none";
  if (!allowed) return;

  openBtn.addEventListener("click", () => { panel.style.display = panel.style.display === "none" ? "" : "none"; });

  // Load May 1997 constituencies
  init1997Btn?.addEventListener("click", async () => {
    const msgEl = document.getElementById("init1997Msg");
    const existing = constituencies.length;
    const confirmMsg = existing > 0
      ? `This will overwrite all ${existing} existing constituencies with the real May 1997 data (650 seats). Continue?`
      : "Load real May 1997 constituencies (650 seats)?";
    if (!confirm(confirmMsg)) return;
    if (msgEl) msgEl.textContent = "Loading…";
    try {
      const result = await apiInitialize1997Constituencies(true);
      if (msgEl) msgEl.textContent = `✓ ${result.count} constituencies loaded from May 1997 data.`;
      const fresh = await apiGetConstituencies();
      refreshAll(fresh.constituencies || [], data);
    } catch (err) {
      if (msgEl) msgEl.textContent = `Error: ${err.message}`;
      alert(`Failed to initialize 1997 constituencies: ${err.message}`);
    }
  });

  clearAllBtn?.addEventListener("click", async () => {
    if (!isAdmin(data)) return;
    if (!confirm("Clear all constituencies? This cannot be undone.")) return;
    try {
      await apiClearConstituencies();
      const fresh = await apiGetConstituencies();
      refreshAll(fresh.constituencies || [], data);
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  });

  closeListBtn?.addEventListener("click", () => {
    const p = document.getElementById("partyConstituencyPanel");
    if (p) p.style.display = "none";
  });

  resetBtn.addEventListener("click", () => {
    form.reset();
    form.querySelector("#constId").value = "";
  });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const id = form.querySelector("#constId").value.trim();
    const name = form.querySelector("#constName").value.trim();
    const nation = form.querySelector("#constNation").value;
    const region = form.querySelector("#constRegion").value.trim();
    const party = form.querySelector("#constParty").value;
    const mpType = form.querySelector("#constMpType").value;
    const mpName = form.querySelector("#constMpName").value.trim();
    const changeType = form.querySelector("#constChangeType")?.value || "";
    const effectiveDate = form.querySelector("#constEffectiveDate")?.value || "";
    const notes = form.querySelector("#constNotes")?.value?.trim() || "";
    if (!name || !nation || !region || !party) return;

    const payload = { name, nation, region, party, mpType, mpName, changeType, effectiveDate, notes };
    try {
      if (id) {
        await apiUpdateConstituency(id, payload);
      } else {
        const newId = slugify(`${name}-${Math.random().toString(36).slice(2, 6)}`);
        await apiSaveConstituency({ id: newId, ...payload });
      }
      form.reset();
      form.querySelector("#constId").value = "";
      const fresh = await apiGetConstituencies();
      refreshAll(fresh.constituencies || [], data);
    } catch (err) {
      alert(`Error saving constituency: ${err.message}`);
    }
  });
}

/**
 * Initialise the Constituencies page.
 * Fetches constituencies from the DB API, merges active characters for display.
 */
export async function initConstituenciesPage(data) {
  data.parliament ??= {};

  // Fetch constituencies from DB
  let constituencies = [];
  try {
    const result = await apiGetConstituencies();
    constituencies = result.constituencies || [];
  } catch {
    // Non-critical: may not be logged in or server unavailable
  }

  // Fetch DB characters and merge into players list for constituency assignment
  try {
    const { characters } = await apiGetCharacters({ active: "true" });
    if (characters && characters.length) {
      const existingIds = new Set((data.players || []).map((p) => p.id));
      const dbPlayers = characters
        .filter((c) => c.constituency)
        .map((c) => ({
          id: c.id,
          name: c.name,
          party: c.party,
          constituency: c.constituency,
          _fromDb: true,
        }));
      data.players = [
        ...(data.players || []),
        ...dbPlayers.filter((p) => !existingIds.has(p.id)),
      ];
    }
  } catch {
    // Non-critical: fall back to state-based players list
  }

  refreshAll(constituencies, data);
  bindEditor(constituencies, data);
}
