import { setHTML, esc } from "../ui.js";
import { canAdminModOrSpeaker } from "../permissions.js";
import {
  apiGetCharacters,
  apiGetConstituencies,
  apiUpdateConstituency,
  apiGetParliamentStatus,
  apiUpdateParliamentStatus,
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

function getLargestParty(constituencies) {
  if (!constituencies.length) return "—";
  const counts = new Map();
  for (const c of constituencies) {
    if (c.party && c.party !== "Speaker") counts.set(c.party, (counts.get(c.party) || 0) + 1);
  }
  if (!counts.size) return "—";
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function getPM(data) {
  const offices = data?.government?.offices || [];
  return offices.find((o) => o.id === "prime-minister")?.holderName || "Vacant";
}

function getLeaderOfOpposition(data) {
  const offices = data?.opposition?.offices || [];
  return offices.find((o) => o.id === "leader-opposition")?.holderName || "Vacant";
}

function renderStateOfParliament(constituencies, data, parlStatus) {
  const parl = data.parliament || {};

  // Derive seat counts from constituencies (single source of truth)
  const MAJORITY_EXCLUDES = ["Speaker", "Sinn Féin"];
  const seatsMap = new Map();
  for (const c of constituencies) {
    if (c.party) seatsMap.set(c.party, (seatsMap.get(c.party) || 0) + 1);
  }
  const totalSeats = constituencies.length || parl.totalSeats || 650;
  const excludedSeats = MAJORITY_EXCLUDES.reduce((sum, name) => sum + (seatsMap.get(name) || 0), 0);
  const votingSeats = totalSeats - excludedSeats;
  const majorityThreshold = Math.floor(votingSeats / 2) + 1;

  const largestParty = getLargestParty(constituencies);

  // Use DB parliament status if available, fall back to state
  const govType = (parlStatus?.governmentType) || parl.governmentType || parl.governmentSetup || "—";
  // For Majority/Minority, governing party is always the largest party (auto-derived)
  let governingParties;
  if (govType === "Majority" || govType === "Minority") {
    governingParties = largestParty;
  } else {
    governingParties = Array.isArray(parlStatus?.governingParties) && parlStatus.governingParties.length
      ? parlStatus.governingParties.join(", ")
      : (Array.isArray(parl.governingParties) && parl.governingParties.length
        ? parl.governingParties.join(", ")
        : (parl.governmentParty || "—"));
  }
  const csParties = Array.isArray(parlStatus?.confidenceSupplyParties) && parlStatus.confidenceSupplyParties.length
    ? `<div class="kv"><span>C&amp;S Support</span><b>${esc(parlStatus.confidenceSupplyParties.join(", "))}</b></div>`
    : "";

  const pm = getPM(data);
  const loto = getLeaderOfOpposition(data);

  return `
    <div class="wgo-tile">
      <div class="wgo-kicker">STATE OF PARLIAMENT</div>
      <div class="kv"><span>Total Seats</span><b>${esc(String(totalSeats))}</b></div>
      <div class="kv"><span>Voting Seats (excl. Speaker &amp; Sinn Féin)</span><b>${esc(String(votingSeats))}</b></div>
      <div class="kv"><span>Majority Threshold</span><b>${esc(String(majorityThreshold))}</b></div>
      <div class="kv"><span>Government Type</span><b>${esc(govType)}</b></div>
      <div class="kv"><span>Largest Party</span><b>${esc(largestParty)}</b></div>
      <div class="kv"><span>Governing Party/Parties</span><b>${esc(governingParties)}</b></div>
      ${csParties}
      <div class="kv"><span>Prime Minister</span><b>${esc(pm)}</b></div>
      <div class="kv"><span>Leader of the Opposition</span><b>${esc(loto)}</b></div>
    </div>
  `;
}

function renderPartyTiles(constituencies) {
  return `
    <div class="wgo-grid party-tiles-grid">
      ${CONSTITUENCY_PARTIES.map((p) => {
        const seats = constituencies.filter((c) => c.party === p.name).length;
        const npcTag = !p.playable ? `<span class="muted" style="font-size:11px;margin-left:4px;">(NPC)</span>` : "";
        return `
          <div class="wgo-tile card-flex">
            <div class="wgo-kicker">${esc(p.name)}${npcTag}</div>
            <div class="wgo-title">${esc(String(seats))} seats</div>
            <div class="wgo-strap">${esc(String(seats))} constituencies assigned</div>
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

function refreshAll(constituencies, data, parlStatus) {
  _constituencies = constituencies;
  // Show / hide empty-state callout
  const emptyCallout = document.getElementById("constEmptyCallout");
  if (emptyCallout) {
    emptyCallout.style.display = constituencies.length === 0 && canManage(data) ? "" : "none";
  }

  setHTML("parliament-summary", renderStateOfParliament(constituencies, data, parlStatus));
  setHTML("party-seats", renderPartyTiles(constituencies));
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
    const mpTypeEl = form.querySelector("#constMpType");
    if (mpTypeEl) mpTypeEl.value = c.mpType || "";
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

  // Task C: auto-select Allocate NPC reason when MP Type is set to NPC
  const mpTypeEl = form.querySelector("#constMpType");
  const changeTypeEl = form.querySelector("#constChangeType");
  if (mpTypeEl && changeTypeEl) {
    mpTypeEl.addEventListener("change", () => {
      if (mpTypeEl.value === "npc" && !changeTypeEl.value) {
        changeTypeEl.value = "allocate-npc";
      }
    });
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const id = form.querySelector("#constId").value.trim();
    if (!id) return; // edit-only; no id means nothing selected
    const party = form.querySelector("#constParty").value;
    const mpType = form.querySelector("#constMpType")?.value || "";
    const mpName = form.querySelector("#constMpName").value.trim();
    const changeType = form.querySelector("#constChangeType")?.value || "";
    const effectiveDate = form.querySelector("#constEffectiveDate")?.value || "";

    if (!party || !changeType) {
      alert("Please select a party and reason for change.");
      return;
    }

    if (changeType === "allocate-npc") {
      if (mpType !== "npc") { alert("Allocate NPC requires MP Type to be set to NPC."); return; }
      if (!mpName) { alert("Allocate NPC requires an MP Name."); return; }
    } else if (!effectiveDate) {
      alert("Please provide an effective date.");
      return;
    }

    // Whip Removal always sets party to Independents
    const resolvedParty = changeType === "whip-removal" ? "Independents" : party;

    const payload = { party: resolvedParty, mpType, mpName, changeType, effectiveDate };
    try {
      await apiUpdateConstituency(id, payload);
      form.reset();
      form.querySelector("#constId").value = "";
      const submitBtn = document.getElementById("constEditorSubmit");
      if (submitBtn) submitBtn.disabled = true;
      const fresh = await apiGetConstituencies();
      refreshAll(fresh.constituencies || [], data, _lastParlStatus);
    } catch (err) {
      alert(`Error saving constituency: ${err.message}`);
    }
  });
}

// Module-level cache so post-save refresh can pass parlStatus through.
let _lastParlStatus = null;
// Module-level cache of current constituencies for use in bindGovStatusPanel validation.
let _constituencies = [];

// Parties eligible to be part of a coalition or C&S arrangement
// (excludes Speaker as it's a presiding office, not a party in government)
const GOV_PARTY_OPTIONS = CONSTITUENCY_PARTIES.filter((p) => p.name !== "Speaker").map((p) => p.name);

function buildPartyCheckboxes(containerId, selectedNames) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = GOV_PARTY_OPTIONS.map((name) => `
    <label style="display:flex;align-items:center;gap:6px;padding:4px 8px;border:1px solid var(--line,#ddd);border-radius:4px;cursor:pointer;">
      <input type="checkbox" name="govPartyCheck" value="${esc(name)}" ${selectedNames.includes(name) ? "checked" : ""}>
      ${esc(name)}
    </label>
  `).join("");
}

function buildCSGoverningSelect(selectId, selectedParty) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = `<option value="">— select governing party —</option>` +
    GOV_PARTY_OPTIONS.map((name) => `<option value="${esc(name)}" ${name === selectedParty ? "selected" : ""}>${esc(name)}</option>`).join("");
}

function bindGovStatusPanel(data, parlStatus) {
  const panel = document.getElementById("govStatusPanel");
  const form  = document.getElementById("govStatusForm");
  const typeEl = document.getElementById("govType");
  const coalitionRow = document.getElementById("govCoalitionRow");
  const csRow = document.getElementById("govCSRow");
  const msgEl = document.getElementById("govStatusMsg");
  if (!panel || !form || !typeEl) return;

  // Populate from current parlStatus
  const current = parlStatus || { governmentType: "Majority", governingParties: [], confidenceSupplyParties: [] };
  typeEl.value = current.governmentType || "Majority";
  buildPartyCheckboxes("govCoalitionParties", current.governmentType === "Coalition" ? (current.governingParties || []) : []);
  buildCSGoverningSelect("govCSGoverning", current.governmentType === "Confidence and Supply" ? (current.governingParties?.[0] || "") : "");
  buildPartyCheckboxes("govCSParties", current.governmentType === "Confidence and Supply" ? (current.confidenceSupplyParties || []) : []);

  function updateVisibility() {
    const t = typeEl.value;
    coalitionRow.style.display = t === "Coalition" ? "" : "none";
    csRow.style.display = t === "Confidence and Supply" ? "" : "none";
  }
  updateVisibility();
  typeEl.addEventListener("change", updateVisibility);

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const govType = typeEl.value;
    let governingParties = [];
    let confidenceSupplyParties = [];

    if (govType === "Coalition") {
      governingParties = Array.from(form.querySelectorAll("#govCoalitionParties input[name=govPartyCheck]:checked")).map((cb) => cb.value);
      if (!governingParties.length) { alert("Please tick at least one coalition party."); return; }
    } else if (govType === "Confidence and Supply") {
      const gov = document.getElementById("govCSGoverning")?.value || "";
      if (!gov) { alert("Please select the governing party."); return; }
      governingParties = [gov];
      confidenceSupplyParties = Array.from(form.querySelectorAll("#govCSParties input[name=govPartyCheck]:checked")).map((cb) => cb.value);
      if (!confidenceSupplyParties.length) { alert("Please tick at least one confidence-and-supply party."); return; }
    } else if (govType === "Majority" || govType === "Minority") {
      // Derive largest party and validate seat count from constituencies (single source of truth)
      const seatsMap = new Map();
      for (const c of _constituencies) {
        if (c.party) seatsMap.set(c.party, (seatsMap.get(c.party) || 0) + 1);
      }
      const totalSeats = _constituencies.length || data?.parliament?.totalSeats || 650;
      const MAJORITY_EXCLUDES = ["Speaker", "Sinn Féin"];
      const excludedSeats = MAJORITY_EXCLUDES.reduce((sum, name) => sum + (seatsMap.get(name) || 0), 0);
      const votingSeats = totalSeats - excludedSeats;
      const majorityThreshold = Math.floor(votingSeats / 2) + 1;

      const largestPartyName = getLargestParty(_constituencies);
      const largestPartySeats = seatsMap.get(largestPartyName) || 0;

      if (govType === "Majority" && largestPartySeats < majorityThreshold) {
        msgEl.innerHTML = `<span style="color:var(--danger,red);">Cannot save as Majority: ${esc(largestPartyName)} holds ${largestPartySeats} seats, but majority threshold is ${majorityThreshold}.</span>`;
        return;
      }
      if (govType === "Minority" && largestPartySeats >= majorityThreshold) {
        msgEl.innerHTML = `<span style="color:var(--danger,red);">Cannot save as Minority: ${esc(largestPartyName)} holds ${largestPartySeats} seats, which meets or exceeds majority threshold of ${majorityThreshold}.</span>`;
        return;
      }
      governingParties = largestPartyName ? [largestPartyName] : [];
    }

    try {
      await apiUpdateParliamentStatus({ governmentType: govType, governingParties, confidenceSupplyParties });
      _lastParlStatus = { governmentType: govType, governingParties, confidenceSupplyParties };
      msgEl.innerHTML = `<span style="color:var(--success,green);">Government status saved.</span>`;
      // Re-render State of Parliament tile
      const constResult = await apiGetConstituencies();
      refreshAll(constResult.constituencies || [], data, _lastParlStatus);
      // Re-init checkboxes with fresh data
      buildPartyCheckboxes("govCoalitionParties", govType === "Coalition" ? governingParties : []);
      buildCSGoverningSelect("govCSGoverning", govType === "Confidence and Supply" ? (governingParties[0] || "") : "");
      buildPartyCheckboxes("govCSParties", govType === "Confidence and Supply" ? confidenceSupplyParties : []);
    } catch (err) {
      msgEl.innerHTML = `<span style="color:var(--danger,red);">${esc(err.message)}</span>`;
    }
  });
}

/**
 * Initialise the Constituencies page.
 * Fetches constituencies from the DB API, merges active characters for display.
 */
export async function initConstituenciesPage(data) {
  data.parliament ??= {};

  // Fetch constituencies and parliament status from DB in parallel
  let constituencies = [];
  let parlStatus = null;
  try {
    const [constResult, statusResult] = await Promise.all([
      apiGetConstituencies().catch(() => ({ constituencies: [] })),
      apiGetParliamentStatus().catch(() => null),
    ]);
    constituencies = constResult.constituencies || [];
    parlStatus = statusResult;
    _lastParlStatus = parlStatus;
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

  refreshAll(constituencies, data, parlStatus);
  bindEditor(constituencies, data);
  bindGovStatusPanel(data, parlStatus);
}
