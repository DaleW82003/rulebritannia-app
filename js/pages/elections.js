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
  data.elections ??= { records: {}, archive: [], nextArchiveId: 1 };
  data.elections.records ??= {};
  data.elections.archive ??= [];
  data.elections.nextArchiveId = Number(data.elections.nextArchiveId || 1);
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

function render(data, state) {
  const root = document.getElementById("elections-root");
  if (!root) return;
  ensureElections(data);
  const m = canManage(data);
  const records = data.elections.records;
  const ge = records.general || null;
  const previousGe = [...data.elections.archive].reverse().find((a) => a.type === "general") || null;
  const geTrend = trendAgainst(ge, previousGe);

  root.innerHTML = `
    <h1 class="page-title">Elections</h1>

    <section class="panel" style="margin-bottom:12px;">
      <div class="muted">Election Development is not part of current Phase 1, this remains mod controlled via UK Elect.</div>
    </section>

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

  root.querySelector("#elections-add-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!m) return;
    const fd = new FormData(e.currentTarget);
    const type = String(fd.get("type") || "");
    const date = String(fd.get("date") || "").trim();
    const liveCampaignUrl = String(fd.get("liveCampaignUrl") || "").trim();
    const lines = String(fd.get("results") || "").trim().split("\n").map((l) => l.trim()).filter(Boolean);
    const results = lines.map((line) => {
      const [party, seats, vote] = line.split("=");
      return { party: String(party || "").trim(), seats: Number(seats || 0), vote: Number(vote || 0) };
    }).filter((r) => r.party && Number.isFinite(r.seats) && Number.isFinite(r.vote));
    if (!type || !date || !results.length) return;

    if (data.elections.records[type]) {
      data.elections.archive.push({
        id: data.elections.nextArchiveId++,
        type,
        ...data.elections.records[type]
      });
    }

    data.elections.records[type] = {
      date,
      liveCampaignUrl: type === "general" ? liveCampaignUrl : "",
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
