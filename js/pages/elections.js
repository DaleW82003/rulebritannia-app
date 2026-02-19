import { saveData } from "../core.js";
import { esc } from "../ui.js";
import { isAdmin, isMod } from "../permissions.js";

const BODY_ORDER = [
  "european-parliament",
  "scottish-parliament",
  "welsh-senedd",
  "ni-assembly",
  "english-locals",
  "scottish-locals",
  "welsh-locals",
  "ni-locals"
];

const LABELS = {
  general: "General Election",
  "european-parliament": "European Parliament",
  "scottish-parliament": "Scottish Parliament",
  "welsh-senedd": "Welsh Assembly (Senedd)",
  "ni-assembly": "Northern Irish Assembly",
  "english-locals": "English Locals",
  "scottish-locals": "Scottish Locals",
  "welsh-locals": "Welsh Locals",
  "ni-locals": "Northern Irish Locals"
};

function canManage(data) {
  return isMod(data) || isAdmin(data);
}

function ensureElections(data) {
  data.elections ??= { records: {}, archive: [], nextArchiveId: 1, pendingGeneral: null };
  data.elections.records ??= {};
  data.elections.archive ??= [];
  data.elections.nextArchiveId = Number(data.elections.nextArchiveId || 1);
  data.elections.pendingGeneral ??= null;
}

function rows(results) {
  return (results || []).slice().sort((a, b) => Number(b.seats || 0) - Number(a.seats || 0));
}

function fmtTrend(v) {
  const n = Number(v || 0);
  const sign = n > 0 ? "+" : "";
  const color = n > 0 ? "#0a7f2e" : n < 0 ? "#9d1d1d" : "#444";
  return `<span style="color:${color};">${sign}${n.toFixed(1)}</span>`;
}

function trendAgainst(current, previous) {
  if (!current || !previous) return [];
  const prev = Object.fromEntries((previous.results || []).map((r) => [r.party, Number(r.vote || 0)]));
  return (current.results || []).map((r) => ({
    party: r.party,
    vote: Number(r.vote || 0),
    delta: Number(r.vote || 0) - Number(prev[r.party] || 0)
  }));
}

function cardFor(record, key) {
  if (!record) return `<article class="tile"><h3 style="margin-top:0;">${esc(LABELS[key])}</h3><div class="muted">No result recorded.</div></article>`;
  return `
    <article class="tile">
      <h3 style="margin-top:0;">${esc(LABELS[key])} — ${esc(record.date || "")}</h3>
      ${rows(record.results).map((r) => `<div><b>${esc(r.party)}</b> — ${esc(String(r.seats))} seats — ${Number(r.vote || 0).toFixed(1)}%</div>`).join("")}
    </article>
  `;
}

function parseResults(raw) {
  const lines = String(raw || "").trim().split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.map((line) => {
    const [party, seats, vote] = line.split("=");
    return { party: String(party || "").trim(), seats: Number(seats || 0), vote: Number(vote || 0) };
  }).filter((r) => r.party && Number.isFinite(r.seats) && Number.isFinite(r.vote));
}

function reseatConstituenciesToGeneralResult(data, results) {
  data.constituencies ??= [];
  data.players ??= [];

  const seatsByParty = Object.fromEntries(results.map((r) => [r.party, Math.max(0, Number(r.seats || 0))]));
  const totalSeats = Number(data.parliament?.totalSeats || 650);
  let allocated = Object.values(seatsByParty).reduce((a, b) => a + b, 0);
  if (allocated < totalSeats) seatsByParty.Others = Number(seatsByParty.Others || 0) + (totalSeats - allocated);

  const characterConstituency = new Set((data.players || []).map((p) => String(p.constituency || "").toLowerCase()));
  const npcSeats = (data.constituencies || []).filter((c) => !characterConstituency.has(String(c.name || "").toLowerCase()));

  const bag = [];
  Object.entries(seatsByParty).forEach(([party, count]) => {
    for (let i = 0; i < Number(count || 0); i += 1) bag.push(party);
  });

  npcSeats.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  for (let i = 0; i < npcSeats.length; i += 1) {
    const c = npcSeats[i];
    c.party = bag[i] || "Others";
  }
}

function approveGeneralElection(data, pending, approver) {
  if (!pending) return;

  if (data.elections.records.general) {
    data.elections.archive.push({
      id: data.elections.nextArchiveId++,
      type: "general",
      ...data.elections.records.general
    });
  }

  data.elections.records.general = {
    date: pending.date,
    liveCampaignUrl: pending.liveCampaignUrl || "",
    results: pending.results,
    createdAt: pending.createdAt,
    createdTs: pending.createdTs,
    approvedAt: new Date().toLocaleString("en-GB"),
    approvedBy: approver
  };

  data.parliament ??= {};
  data.parliament.lastGeneralElection = pending.date;
  data.parliament.parties ??= [];

  const byParty = new Map((pending.results || []).map((r) => [r.party, Number(r.seats || 0)]));
  data.parliament.parties.forEach((p) => {
    if (byParty.has(p.name)) p.seats = Math.max(0, Number(byParty.get(p.name) || 0));
  });

  byParty.forEach((seats, partyName) => {
    if (!data.parliament.parties.find((p) => p.name === partyName)) {
      data.parliament.parties.push({ name: partyName, seats: Math.max(0, Number(seats || 0)), playable: true });
    }
  });

  reseatConstituenciesToGeneralResult(data, pending.results || []);

  data.liveDocket ??= { items: [] };
  data.liveDocket.items ??= [];
  data.liveDocket.items.unshift({
    type: "speaker",
    title: "General Election approved: review constituency allocations",
    detail: `New Parliament set for ${pending.date}. Mods should review constituency party/MP assignments to match seat outcomes.`,
    ctaLabel: "Open Constituencies",
    href: "constituencies.html",
    priority: "high"
  });

  data.elections.pendingGeneral = null;
}

function render(data, state) {
  const root = document.getElementById("elections-root");
  if (!root) return;
  ensureElections(data);
  const m = canManage(data);
  const admin = isAdmin(data);
  const records = data.elections.records;
  const ge = records.general || null;
  const previousGe = [...data.elections.archive].reverse().find((a) => a.type === "general") || null;
  const geTrend = trendAgainst(ge, previousGe);
  const pendingGe = data.elections.pendingGeneral;

  root.innerHTML = `
    <h1 class="page-title">Elections</h1>

    <section class="panel" style="margin-bottom:12px;">
      <div class="muted">Election Development is not part of current Phase 1, this remains mod controlled via UK Elect.</div>
    </section>

    ${pendingGe ? `
      <section class="panel" style="margin-bottom:12px; border-left:4px solid #8a6d3b;">
        <h2 style="margin-top:0;">Pending General Election Approval</h2>
        <div><b>${esc(pendingGe.date || "")}</b> submitted by ${esc(pendingGe.submittedBy || "Mod")}</div>
        <div class="muted" style="margin:6px 0;">Awaiting admin approval before Parliament/constituency state is updated.</div>
        ${rows(pendingGe.results).map((r) => `<div>${esc(r.party)} — ${esc(String(r.seats))} seats — ${Number(r.vote || 0).toFixed(1)}%</div>`).join("")}
        ${admin ? `<div style="margin-top:8px;"><button class="btn" type="button" id="approve-general-election">Approve + Apply Parliament Update</button></div>` : ""}
      </section>
    ` : ""}

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Last General Election Result</h2>
      ${ge ? `
        <div><b>${esc(ge.date || "")}</b></div>
        ${rows(ge.results).map((r) => `<div><b>${esc(r.party)}</b> — ${esc(String(r.seats))} seats — ${Number(r.vote || 0).toFixed(1)}%</div>`).join("")}
        ${ge.liveCampaignUrl ? `<div style="margin-top:8px;"><a class="btn" href="${esc(ge.liveCampaignUrl)}" target="_blank" rel="noopener">Enter Live Election Campaign</a></div>` : ""}
        <div style="margin-top:10px;">
          <h3 style="margin:0 0 6px 0;">Trend vs Previous General Election</h3>
          ${geTrend.length ? geTrend.map((t) => `<div><b>${esc(t.party)}</b> ${Number(t.vote).toFixed(1)}% (${fmtTrend(t.delta)})</div>`).join("") : `<div class="muted">No previous general election result in archive yet.</div>`}
        </div>
      ` : `<div class="muted">No General Election result recorded.</div>`}
    </section>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Previous General Election Slot</h2>
      ${previousGe ? rows(previousGe.results).map((r) => `<div><b>${esc(r.party)}</b> — ${esc(String(r.seats))} seats — ${Number(r.vote || 0).toFixed(1)}%</div>`).join("") : `<div class="muted">Blank until a newer general election is submitted.</div>`}
    </section>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Other Elected Bodies and Locals</h2>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(280px,1fr));gap:12px;">
        ${BODY_ORDER.map((k) => cardFor(records[k], k)).join("")}
      </div>
    </section>

    ${m ? `
      <section class="panel" style="margin-bottom:12px;">
        <h2 style="margin-top:0;">Elections Control Panel</h2>
        <form id="elections-add-form">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;">
            <div>
              <label class="label" for="election-type">Election</label>
              <select id="election-type" name="type" class="input">
                ${Object.entries(LABELS).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join("")}
              </select>
            </div>
            <div>
              <label class="label" for="election-date">Date label</label>
              <input id="election-date" name="date" class="input" placeholder="May 1997" required>
            </div>
            <div>
              <label class="label" for="election-live-url">Live campaign URL (optional, GE only)</label>
              <input id="election-live-url" name="liveCampaignUrl" class="input" placeholder="https://forum.rulebritannia.org/c/elections/...">
            </div>
          </div>

          <label class="label" for="election-results">Results lines (Party=Seats=VoteShare)</label>
          <textarea id="election-results" name="results" class="input" rows="7" required placeholder="Labour=340=41.0\nConservative=240=33.1\nLiberal Democrat=40=13.2"></textarea>
          <button type="submit" class="btn">Save Result</button>
          <p class="muted" style="margin-top:8px;">General Elections now require admin approval before they are applied to Parliament + Constituencies.</p>
        </form>
      </section>
    ` : ""}

    <section class="panel">
      <h2 style="margin-top:0;">Archive</h2>
      <button class="btn" type="button" id="elections-archive-toggle">${state.showArchive ? "Hide" : "Open"} Archive</button>
      ${state.showArchive ? `
        <div style="margin-top:10px;">
          ${data.elections.archive.length ? [...data.elections.archive].reverse().map((a) => `
            <article class="tile" style="margin-bottom:8px;">
              <div><b>${esc(LABELS[a.type] || a.type)}</b> — ${esc(a.date || "")}</div>
              ${rows(a.results).map((r) => `<div>${esc(r.party)} — ${esc(String(r.seats))} seats — ${Number(r.vote || 0).toFixed(1)}%</div>`).join("")}
            </article>
          `).join("") : `<div class="muted">No archived election results yet.</div>`}
        </div>
      ` : ""}
    </section>
  `;

  root.querySelector("#elections-archive-toggle")?.addEventListener("click", () => {
    state.showArchive = !state.showArchive;
    render(data, state);
  });

  root.querySelector("#approve-general-election")?.addEventListener("click", () => {
    if (!isAdmin(data) || !data.elections.pendingGeneral) return;
    approveGeneralElection(data, data.elections.pendingGeneral, data?.currentUser?.username || "Admin");
    saveData(data);
    render(data, state);
  });

  root.querySelector("#elections-add-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!m) return;
    const fd = new FormData(e.currentTarget);
    const type = String(fd.get("type") || "");
    const date = String(fd.get("date") || "").trim();
    const liveCampaignUrl = String(fd.get("liveCampaignUrl") || "").trim();
    const results = parseResults(fd.get("results"));
    if (!type || !date || !results.length) return;

    if (type === "general") {
      data.elections.pendingGeneral = {
        type,
        date,
        liveCampaignUrl,
        results,
        submittedBy: data?.currentUser?.username || "Mod",
        createdAt: new Date().toLocaleString("en-GB"),
        createdTs: Date.now()
      };
      saveData(data);
      render(data, state);
      return;
    }

    if (data.elections.records[type]) {
      data.elections.archive.push({
        id: data.elections.nextArchiveId++,
        type,
        ...data.elections.records[type]
      });
    }

    data.elections.records[type] = {
      date,
      liveCampaignUrl: "",
      results,
      createdAt: new Date().toLocaleString("en-GB"),
      createdTs: Date.now()
    };

    saveData(data);
    render(data, state);
  });
}

export function initElectionsPage(data) {
  ensureElections(data);
  render(data, { showArchive: false });
}
