import { saveState } from "../core.js";
import { esc } from "../ui.js";
import { canAdminModOrSpeaker } from "../permissions.js";
import { ensureRegulations } from "./regulations.js";
import { formatSimMonthYear, isDeadlinePassed, countdownToSimMonth } from "../clock.js";
import { apiGetRegulation, apiUpdateRegulation } from "../api.js";

function getId() {
  return new URL(window.location.href).searchParams.get("id");
}

export async function initRegulationPage(data) {
  const root = document.getElementById("regulation-root");
  if (!root) return;

  ensureRegulations(data);
  const id = getId();
  let item = data.regulations.items.find((r) => r.id === id) || null;

  if (!item && id) {
    try {
      const r = await apiGetRegulation(id);
      if (r?.regulation) {
        item = r.regulation;
        data.regulations.items.push(item);
      }
    } catch (err) {
      console.error("[regulation] DB fallback failed:", err);
    }
  }

  if (!item) {
    item = data.regulations.items[0] || null;
  }

  const canStaff = canAdminModOrSpeaker(data);

  // Auto-close if debate deadline passed
  if (item && item.status !== "closed" && item.debateClosesAtSimObj && isDeadlinePassed(item.debateClosesAtSimObj, data.gameState)) {
    item.status = "closed";
    item.closedAtSim = formatSimMonthYear(data.gameState);
    apiUpdateRegulation(item.id, item).catch((err) => console.error("[regulation] Failed to auto-close:", err));
    saveState(data);
  }

  if (!item) {
    root.innerHTML = `<div class="muted-block">No regulations available.</div>`;
    return;
  }

  root.innerHTML = `
    <section class="tile tile-form" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">${esc(item.department)} Regulation ${esc(item.regulationNumber)}: ${esc(item.shortTitle)}</h2>
      <p class="muted">By ${esc(item.author)} • Status: ${esc(item.status === "closed" ? "Debate Closed" : "Debate Open")}</p>
      <p class="muted">Laid: ${esc(item.laidAtSim || "—")} • In force: ${esc(item.comesIntoForce || "—")} • Debate closes: ${esc(item.debateClosesAtSim || "—")}${item.debateClosesAtSimObj && item.status !== "closed" ? ` (${countdownToSimMonth(item.debateClosesAtSimObj.month, item.debateClosesAtSimObj.year, data.gameState)})` : ""}</p>
      ${item.closedAtSim ? `<p class="muted">Closed at: ${esc(item.closedAtSim)}</p>` : ""}
      <div class="tile-bottom" style="display:flex;gap:8px;flex-wrap:wrap;">
        ${(item.debate?.topicUrl || item.discourse_topic_url || item.discourseTopicUrl || item.debateUrl) ? `<a class="btn" href="${esc(item.debate?.topicUrl || item.discourse_topic_url || item.discourseTopicUrl || item.debateUrl)}" target="_blank" rel="noopener">Open Debate</a>` : `<span class="muted">No debate yet</span>`}
        <a class="btn" href="regulations.html">Back to Regulations</a>
      </div>
    </section>

    <section class="tile" style="margin-bottom:12px;">
      <h3 style="margin-top:0;">Full Regulation</h3>
      <div class="muted-block" style="white-space:pre-wrap;">${esc(item.body || "")}</div>
    </section>

    ${canStaff ? `
      <section class="tile tile-form">
        <h3 style="margin-top:0;">Staff Controls</h3>
        <form id="speaker-edit-form">
          <label class="label" for="reg-edit-title">Edit short title</label>
          <input id="reg-edit-title" class="input" name="title" value="${esc(item.shortTitle || "")}">
          <label class="label" for="reg-edit-body">Edit body</label>
          <textarea id="reg-edit-body" class="input" name="body" rows="6">${esc(item.body || "")}</textarea>
          <div class="tile-bottom" style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn" type="submit">Save Edits</button>
            <button class="btn danger" type="button" data-action="close-early" ${item.status === "closed" ? "disabled" : ""}>Close Debate Early</button>
          </div>
        </form>
      </section>
    ` : ""}
  `;

  root.querySelector("#speaker-edit-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!canStaff) return;
    const fd = new FormData(e.currentTarget);
    const title = String(fd.get("title") || "").trim();
    const body = String(fd.get("body") || "").trim();
    if (title) item.shortTitle = title;
    if (body) item.body = body;
    apiUpdateRegulation(item.id, item).catch((err) => console.error("[regulation] Failed to save edits:", err));
    saveState(data);
    initRegulationPage(data);
  });

  root.querySelector("[data-action='close-early']")?.addEventListener("click", () => {
    if (!canStaff || item.status === "closed") return;
    item.status = "closed";
    item.closedAtSim = formatSimMonthYear(data.gameState);
    apiUpdateRegulation(item.id, item).catch((err) => console.error("[regulation] Failed to close regulation:", err));
    saveState(data);
    initRegulationPage(data);
  });
}
