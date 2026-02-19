import { saveData } from "../core.js";
import { esc } from "../ui.js";
import { isSpeaker } from "../permissions.js";
import { ensureRegulations } from "./regulations.js";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function simLabel(data) {
  const gs = data?.gameState || {};
  const month = Number(gs.startSimMonth ?? 8);
  const year = Number(gs.startSimYear ?? 1997);
  return `${MONTHS[(month - 1 + 12) % 12]} ${year}`;
}

function getId() {
  return new URL(window.location.href).searchParams.get("id");
}

export function initRegulationPage(data) {
  const root = document.getElementById("regulation-root");
  if (!root) return;

  ensureRegulations(data);
  const id = getId();
  const item = data.regulations.items.find((r) => r.id === id) || data.regulations.items[0] || null;
  const speaker = isSpeaker(data);
  const sim = simLabel(data);

  if (!item) {
    root.innerHTML = `<div class="muted-block">No regulations available.</div>`;
    return;
  }

  root.innerHTML = `
    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">${esc(item.department)} Regulation ${esc(item.regulationNumber)}: ${esc(item.shortTitle)}</h2>
      <p class="muted">By ${esc(item.author)} • Status: ${esc(item.status === "closed" ? "Debate Closed" : "Debate Open")}</p>
      <p class="muted">Laid: ${esc(item.laidAtSim || "—")} • In force: ${esc(item.comesIntoForce || "—")} • Debate closes: ${esc(item.debateClosesAtSim || "—")}</p>
      ${item.closedAtSim ? `<p class="muted">Closed at: ${esc(item.closedAtSim)}</p>` : ""}
      <div class="tile-bottom" style="display:flex;gap:8px;flex-wrap:wrap;">
        <a class="btn" href="${esc(item.debateUrl || "#")}" target="_blank" rel="noopener">Open Debate</a>
        <a class="btn" href="regulations.html">Back to Regulations</a>
      </div>
    </section>

    <section class="tile" style="margin-bottom:12px;">
      <h3 style="margin-top:0;">Full Regulation</h3>
      <div class="muted-block" style="white-space:pre-wrap;">${esc(item.body || "")}</div>
    </section>

    ${speaker ? `
      <section class="tile">
        <h3 style="margin-top:0;">Speaker Controls</h3>
        <form id="speaker-edit-form">
          <label class="label" for="reg-edit-title">Edit short title</label>
          <input id="reg-edit-title" class="input" name="title" value="${esc(item.shortTitle || "")}">
          <label class="label" for="reg-edit-body">Edit body</label>
          <textarea id="reg-edit-body" class="input" name="body" rows="6">${esc(item.body || "")}</textarea>
          <button class="btn" type="submit">Save Edits</button>
        </form>
        <div class="tile-bottom" style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn danger" data-action="close-early" ${item.status === "closed" ? "disabled" : ""}>Close Debate Early</button>
        </div>
      </section>
    ` : ""}
  `;

  root.querySelector("#speaker-edit-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!speaker) return;
    const fd = new FormData(e.currentTarget);
    const title = String(fd.get("title") || "").trim();
    const body = String(fd.get("body") || "").trim();
    if (title) item.shortTitle = title;
    if (body) item.body = body;
    saveData(data);
    initRegulationPage(data);
  });

  root.querySelector("[data-action='close-early']")?.addEventListener("click", () => {
    if (!speaker || item.status === "closed") return;
    item.status = "closed";
    item.closedAtSim = sim;
    saveData(data);
    initRegulationPage(data);
  });
}
