import { setHTML, esc } from "../ui.js";
import { canAdminModOrSpeaker } from "../permissions.js";
import {
  apiGetCharacters,
  apiGetConstituencies,
  apiUpdateConstituency,
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

  const listRoot = document.getElementById("constEditorList");
  if (listRoot) {
    listRoot.innerHTML = constituencies.slice().sort((a, b) => a.name.localeCompare(b.name)).map((c) => `
      <div class="docket-item">
        <div class="docket-left"><div><div class="docket-title">${esc(c.name)}</div><div class="docket-detail">${esc(c.party)} • ${esc(c.region)} • ${esc(c.nation)} • MP: ${esc(seatLabel(c, data))}</div></div></div>
        <div class="tile-bottom" style="padding-top:0; margin-top:0;"><button class="btn" type="button" data-edit-id="${esc(c.id)}">Edit</button></div>
      </div>
    `).join("");
  }

  bindEditorRowActions(constituencies, data);
}

function bindEditorRowActions(constituencies, data) {
  const form = document.getElementById("constEditorForm");
  if (!form) return;

  document.querySelectorAll("[data-edit-id]").forEach((btn) => btn.addEventListener("click", () => {
    const c = constituencies.find((x) => x.id === btn.getAttribute("data-edit-id"));
    if (!c) return;
    form.querySelector("#constId").value = c.id;
    form.querySelector("#constName").value = c.name;
    form.querySelector("#constParty").value = c.party;
    form.querySelector("#constMpName").value = c.mpName || "";
    form.querySelector("#constChangeType").value = "";
    form.querySelector("#constEffectiveDate").value = "";
    const submitBtn = document.getElementById("constEditorSubmit");
    if (submitBtn) submitBtn.disabled = false;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
}

function bindEditor(constituencies, data) {
  const panel = document.getElementById("constituencyEditorPanel");
  const openBtn = document.getElementById("constituencyEditorBtn");
  const form = document.getElementById("constEditorForm");
  const resetBtn = document.getElementById("constEditorReset");
  const closeListBtn = document.getElementById("partyConstituencyClose");
  if (!panel || !openBtn || !form || !resetBtn) return;

  const allowed = canManage(data);
  openBtn.style.display = allowed ? "" : "none";
  if (!allowed) return;

  openBtn.addEventListener("click", () => { panel.style.display = panel.style.display === "none" ? "" : "none"; });

  closeListBtn?.addEventListener("click", () => {
    const p = document.getElementById("partyConstituencyPanel");
    if (p) p.style.display = "none";
  });

  resetBtn.addEventListener("click", () => {
    form.reset();
    form.querySelector("#constId").value = "";
    const submitBtn = document.getElementById("constEditorSubmit");
    if (submitBtn) submitBtn.disabled = true;
  });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const id = form.querySelector("#constId").value.trim();
    if (!id) return; // edit-only; no id means nothing selected
    const party = form.querySelector("#constParty").value;
    const mpName = form.querySelector("#constMpName").value.trim();
    const changeType = form.querySelector("#constChangeType")?.value || "";
    const effectiveDate = form.querySelector("#constEffectiveDate")?.value || "";
    if (!party || !changeType || !effectiveDate) {
      alert("Please select a party, reason for change, and effective date.");
      return;
    }

    // Whip Removal always sets party to Independents
    const resolvedParty = changeType === "whip-removal" ? "Independents" : party;

    const payload = { party: resolvedParty, mpName, changeType, effectiveDate };
    try {
      await apiUpdateConstituency(id, payload);
      form.reset();
      form.querySelector("#constId").value = "";
      const submitBtn = document.getElementById("constEditorSubmit");
      if (submitBtn) submitBtn.disabled = true;
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
