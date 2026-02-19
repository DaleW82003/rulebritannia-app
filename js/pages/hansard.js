import { esc } from "../ui.js";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function simLabel(data) {
  const gs = data?.gameState || {};
  const m = Number(gs.startSimMonth ?? 8);
  const y = Number(gs.startSimYear ?? 1997);
  return `${MONTHS[(m - 1 + 12) % 12]} ${y}`;
}

function ensureHansard(data) {
  data.hansard ??= {};
  data.hansard.rollLog ??= {
    completedSinceStart: 0,
    nextRollCountdown: "4d 0h 42m"
  };
  data.hansard.passed ??= [];
  data.hansard.defeated ??= [];
}

function divisionTotals(division = {}) {
  const totals = { aye: 0, no: 0, abstain: 0 };
  Object.values(division.votes || {}).forEach((v) => {
    const c = (v.choice || "abstain").toLowerCase();
    totals[c] = Number(totals[c] || 0) + Number(v.weight || 1);
  });
  return totals;
}

function renderTile(item, kind) {
  return `
    <article class="tile" style="margin-bottom:10px;">
      <div class="wgo-kicker">${kind === "passed" ? "Passed" : "Defeated"}</div>
      <div><b>${esc(item.title)}</b></div>
      <div class="muted">${esc(item.author || "Unknown author")} • ${esc(item.department || "Unknown department")}</div>
      <div class="muted">Final stage: ${esc(item.finalStage || "Division")}</div>
      <div class="tile-bottom"><button class="btn" type="button" data-action="open" data-kind="${esc(kind)}" data-id="${esc(item.id)}">Open</button></div>
    </article>
  `;
}

function amendmentLines(amendments = []) {
  if (!amendments.length) return "<p class=\"muted\">No archived amendments.</p>";
  return amendments.map((a) => `
    <div class="tile" style="margin-bottom:8px;">
      <div><b>${esc(a.id || "Amendment")}</b> • Clause ${esc(a.articleNumber ?? "—")}</div>
      <div class="muted">${esc(a.status || "proposed")} • ${esc(a.proposedBy || "Unknown")}</div>
      <div>${esc(a.text || "")}</div>
    </div>
  `).join("");
}

function detailPanel(item, kind) {
  if (!item) return `<p class="muted">Open a piece of archived legislation to view details.</p>`;

  const div = item.division || {};
  const totals = divisionTotals(div);
  return `
    <h3 style="margin-top:0;">${esc(item.title)}</h3>
    <p class="muted">Status: <b>${kind === "passed" ? "Passed" : "Defeated"}</b> • Archived on ${esc(item.archivedAtSim || "—")}</p>
    <p class="muted">Author: ${esc(item.author || "Unknown")} • Department: ${esc(item.department || "—")}</p>

    <div class="tile" style="margin:10px 0;">
      <h4 style="margin-top:0;">Bill text</h4>
      <pre style="white-space:pre-wrap;margin:0;font:inherit;">${esc(item.billText || "No text archived.")}</pre>
    </div>

    <p><a class="btn" href="${esc(item.debateUrl || `https://forum.rulebritannia.org/t/${encodeURIComponent(item.id || "bill")}`)}" target="_blank" rel="noopener">View historic debate</a></p>

    <div class="tile" style="margin:10px 0;">
      <h4 style="margin-top:0;">Archived amendments</h4>
      ${amendmentLines(item.amendments || [])}
    </div>

    <div class="tile" style="margin:10px 0;">
      <h4 style="margin-top:0;">Division result</h4>
      <p>Aye: <b>${totals.aye}</b> • No: <b>${totals.no}</b> • Abstain: <b>${totals.abstain}</b></p>
      <p class="muted">Recorded status: ${esc(div.status || "closed")}</p>
    </div>
  `;
}

function render(data, state) {
  ensureHansard(data);

  const passedRoot = document.getElementById("hansard-passed");
  const failedRoot = document.getElementById("hansard-failed");
  const detailRoot = document.getElementById("hansard-detail");
  const simRoot = document.getElementById("sim-date-display");
  const rollRoot = document.getElementById("sunday-roll-display");

  if (!passedRoot || !failedRoot || !detailRoot) return;

  if (simRoot) simRoot.textContent = `Simulation Date: ${simLabel(data)}`;
  if (rollRoot) {
    const log = data.hansard.rollLog;
    rollRoot.innerHTML = `Log of the Sunday roll: <b>${esc(log.completedSinceStart)}</b> completed since sim start. Next roll in <b>${esc(log.nextRollCountdown)}</b>.`;
  }

  const passed = data.hansard.passed;
  const defeated = data.hansard.defeated;

  passedRoot.innerHTML = passed.length
    ? `<div class="order-grid">${passed.map((i) => renderTile(i, "passed")).join("")}</div>`
    : `<div class="muted-block">No passed legislation archived yet.</div>`;

  failedRoot.innerHTML = defeated.length
    ? `<div class="order-grid">${defeated.map((i) => renderTile(i, "defeated")).join("")}</div>`
    : `<div class="muted-block">No defeated legislation archived yet.</div>`;

  const selected = state.selectedKind && state.selectedId
    ? (state.selectedKind === "passed" ? passed : defeated).find((i) => i.id === state.selectedId)
    : null;

  detailRoot.innerHTML = detailPanel(selected, state.selectedKind);

  document.querySelectorAll("[data-action='open']").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedKind = btn.getAttribute("data-kind");
      state.selectedId = btn.getAttribute("data-id");
      render(data, state);
    });
  });
}

export function initHansardPage(data) {
  ensureHansard(data);
  const state = { selectedKind: null, selectedId: null };
  render(data, state);
}
