import { setHTML, esc } from "../ui.js";
import { saveData } from "../core.js";
import { isAdmin, isMod, isSpeaker } from "../permissions.js";

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function canManage(data) {
  return isAdmin(data) || isMod(data) || isSpeaker(data);
}

function getParliamentMeta(data) {
  const p = data?.parliament || {};
  return {
    totalSeats: Number(p.totalSeats || 650),
    lastGeneralElection: p.lastGeneralElection || "May 1997",
    governmentSetup: p.governmentSetup || "Majority",
    governmentParty: p.governmentParty || "Conservative"
  };
}

function groupedByNationRegion(constituencies) {
  const grouped = {};
  constituencies.forEach((c) => {
    const nation = c.nation || "Unknown";
    const region = c.region || "Other";
    grouped[nation] ??= {};
    grouped[nation][region] ??= [];
    grouped[nation][region].push(c);
  });

  Object.values(grouped).forEach((regions) => {
    Object.values(regions).forEach((list) => list.sort((a, b) => String(a.name).localeCompare(String(b.name))));
  });
  return grouped;
}

function renderParliamentSummary(data) {
  const meta = getParliamentMeta(data);
  const parties = Array.isArray(data?.parliament?.parties) ? data.parliament.parties : [];
  const represented = parties.reduce((sum, p) => sum + Number(p.seats || 0), 0);

  return `
    <div class="wgo-tile">
      <div class="wgo-kicker">STATE OF PARLIAMENT</div>
      <div class="kv"><span>Last General Election</span><b>${esc(meta.lastGeneralElection)}</b></div>
      <div class="kv"><span>Total Seats in the House</span><b>${meta.totalSeats}</b></div>
      <div class="kv"><span>Current Government Setup</span><b>${esc(meta.governmentSetup)}</b></div>
      <div class="kv"><span>Government Party</span><b>${esc(meta.governmentParty)}</b></div>
      <div class="kv"><span>Represented seats (seeded)</span><b>${represented}/${meta.totalSeats}</b></div>
    </div>
  `;
}

function renderPartyTiles(data) {
  const parties = Array.isArray(data?.parliament?.parties) ? data.parliament.parties : [];
  if (!parties.length) return `<div class="muted-block">No party data configured.</div>`;

  const allConstituencies = Array.isArray(data?.constituencies) ? data.constituencies : [];

  return `
    <div class="party-grid">
      ${parties.map((p) => {
        const partyCount = allConstituencies.filter((c) => c.party === p.name).length;
        return `
          <div class="party-tile card-flex">
            <div class="party-name">${esc(p.name)}</div>
            <div class="party-seats">Seats in Parliament: <b>${Number(p.seats || 0)}</b></div>
            <div class="small" style="margin-top:6px;">Seeded constituencies listed: ${partyCount}</div>
            <div class="tile-bottom">
              <button class="btn" type="button" data-party-open="${esc(p.name)}">Open Constituencies</button>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderPartyConstituencies(data, partyName) {
  const all = Array.isArray(data?.constituencies) ? data.constituencies : [];
  const held = all.filter((c) => c.party === partyName);

  if (!held.length) {
    return `
      <div class="paper-reader-header">
        <div>
          <div class="paper-reader-title">${esc(partyName)}</div>
          <div class="muted">No constituencies currently listed for this party.</div>
        </div>
      </div>
    `;
  }

  const grouped = groupedByNationRegion(held);
  const nationOrder = ["England", "Scotland", "Wales", "Northern Ireland"];
  const nations = Object.keys(grouped).sort((a, b) => {
    const ai = nationOrder.indexOf(a);
    const bi = nationOrder.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  return `
    <div class="paper-reader-header">
      <div>
        <div class="paper-reader-title">${esc(partyName)} Constituencies</div>
        <div class="muted">Broken down by nation and region.</div>
      </div>
    </div>

    ${nations.map((nation) => {
      const regions = grouped[nation];
      const regionNames = Object.keys(regions).sort((a, b) => a.localeCompare(b));
      return `
        <section class="panel" style="margin-bottom:12px;">
          <h3 style="margin-top:0;">${esc(nation)}</h3>
          ${regionNames.map((region) => `
            <div class="muted-block" style="margin-bottom:10px;">
              <div class="wgo-kicker">${esc(region)}</div>
              <div style="margin-top:8px;">${regions[region].map((c) => esc(c.name)).join(" • ")}</div>
            </div>
          `).join("")}
        </section>
      `;
    }).join("")}
  `;
}

function bindPartyOpenButtons(data) {
  document.querySelectorAll("[data-party-open]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const partyName = btn.getAttribute("data-party-open");
      const panel = document.getElementById("partyConstituenciesPanel");
      if (panel) panel.style.display = "";
      setHTML("partyConstituencies", renderPartyConstituencies(data, partyName));
    });
  });
}

function refreshAll(data) {
  setHTML("parliament-summary", renderParliamentSummary(data));
  setHTML("party-constituencies", renderPartyTiles(data));
  bindPartyOpenButtons(data);

  const partySelect = document.getElementById("constParty");
  if (partySelect) {
    const parties = Array.isArray(data?.parliament?.parties) ? data.parliament.parties : [];
    partySelect.innerHTML = parties.map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join("");
  }

  const listRoot = document.getElementById("constEditorList");
  if (listRoot) {
    const items = (data.constituencies || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
    listRoot.innerHTML = items.map((c) => `
      <div class="docket-item">
        <div class="docket-left">
          <div>
            <div class="docket-title">${esc(c.name)}</div>
            <div class="docket-detail">${esc(c.party)} • ${esc(c.region)} • ${esc(c.nation)}</div>
          </div>
        </div>
        <div class="tile-bottom" style="padding-top:0; margin-top:0;">
          <button class="btn" type="button" data-edit-id="${esc(c.id)}">Edit</button>
          <button class="btn danger" type="button" data-delete-id="${esc(c.id)}">Remove</button>
        </div>
      </div>
    `).join("");
  }

  bindEditorRowActions(data);
}

function bindEditorRowActions(data) {
  const form = document.getElementById("constEditorForm");
  if (!form) return;

  document.querySelectorAll("[data-delete-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-delete-id");
      data.constituencies = (data.constituencies || []).filter((c) => c.id !== id);
      saveData(data);
      refreshAll(data);
    });
  });

  document.querySelectorAll("[data-edit-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-edit-id");
      const c = (data.constituencies || []).find((x) => x.id === id);
      if (!c) return;
      form.querySelector("#constId").value = c.id;
      form.querySelector("#constName").value = c.name;
      form.querySelector("#constNation").value = c.nation;
      form.querySelector("#constRegion").value = c.region;
      form.querySelector("#constParty").value = c.party;
      const submit = form.querySelector("button[type='submit']");
      if (submit) submit.textContent = "Save Changes";
    });
  });
}

function bindEditor(data) {
  const panel = document.getElementById("constituencyEditorPanel");
  const openBtn = document.getElementById("constituencyEditorBtn");
  const form = document.getElementById("constEditorForm");
  const resetBtn = document.getElementById("constEditorReset");
  if (!panel || !openBtn || !form || !resetBtn) return;

  const allowed = canManage(data);
  openBtn.style.display = allowed ? "" : "none";
  if (!allowed) return;

  openBtn.addEventListener("click", () => {
    panel.style.display = panel.style.display === "none" ? "" : "none";
  });

  resetBtn.addEventListener("click", () => {
    form.reset();
    form.querySelector("#constId").value = "";
    const submit = form.querySelector("button[type='submit']");
    if (submit) submit.textContent = "Add Constituency";
  });

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const id = form.querySelector("#constId").value.trim();
    const name = form.querySelector("#constName").value.trim();
    const nation = form.querySelector("#constNation").value;
    const region = form.querySelector("#constRegion").value.trim();
    const party = form.querySelector("#constParty").value;

    if (!name || !nation || !region || !party) return;

    data.constituencies ??= [];
    if (id) {
      const existing = data.constituencies.find((c) => c.id === id);
      if (existing) {
        existing.name = name;
        existing.nation = nation;
        existing.region = region;
        existing.party = party;
      }
    } else {
      const nextId = `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`;
      data.constituencies.push({ id: nextId, name, nation, region, party });
    }

    saveData(data);
    form.reset();
    form.querySelector("#constId").value = "";
    const submit = form.querySelector("button[type='submit']");
    if (submit) submit.textContent = "Add Constituency";
    refreshAll(data);
  });
}

export function initConstituenciesPage(data) {
  data.parliament ??= {};
  data.constituencies ??= [];

  refreshAll(data);
  bindEditor(data);
}
