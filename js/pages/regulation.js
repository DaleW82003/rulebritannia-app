import { saveState } from "../core.js";
import { esc } from "../ui.js";
import { canAdminModOrSpeaker } from "../permissions.js";
import { ensureRegulations } from "./regulations.js";
import { formatSimMonthYear, isDeadlinePassed, countdownToSimMonth } from "../clock.js";
import { apiGetRegulation, apiUpdateRegulation } from "../api.js";
import { toastSuccess, toastError } from "../components/toast.js";

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

  // Compute display-only closed status without mutating persistent state.
  // Actual auto-close is handled server-side; DB is authoritative.
  const isEffectivelyClosed = item && (
    item.status === "closed" ||
    (item.debateClosesAtSimObj && isDeadlinePassed(item.debateClosesAtSimObj, data.gameState))
  );
  const closedAtSim = item?.closedAtSim || (isEffectivelyClosed && item?.status !== "closed" ? formatSimMonthYear(data.gameState) : null);

  if (!item) {
    root.innerHTML = `<div class="muted-block">No regulations available.</div>`;
    return;
  }

  root.innerHTML = `
    <section class="tile tile-form" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">${esc(item.department)} Regulation ${esc(item.regulationNumber)}: ${esc(item.shortTitle)}</h2>
      <p class="muted">By ${esc(item.author_display_name || item.author)} • Status: ${esc(isEffectivelyClosed ? "Debate Closed" : "Debate Open")}</p>
      <p class="muted">Laid: ${esc(item.laidAtSim || "—")} • In force: ${esc(item.comesIntoForce || "—")} • Debate closes: ${esc(item.debateClosesAtSim || "—")}${item.debateClosesAtSimObj && !isEffectivelyClosed ? ` (${countdownToSimMonth(item.debateClosesAtSimObj.month, item.debateClosesAtSimObj.year, data.gameState)})` : ""}</p>
      ${closedAtSim ? `<p class="muted">Closed at: ${esc(closedAtSim)}</p>` : ""}
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
            <button class="btn danger" type="button" data-action="close-early" ${isEffectivelyClosed ? "disabled" : ""}>Close Debate Early</button>
          </div>
        </form>
      </section>
    ` : ""}
  `;

  root.querySelector("#speaker-edit-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!canStaff) return;
    const submitBtn = e.currentTarget.querySelector("[type='submit']");
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Saving…"; }
    const fd = new FormData(e.currentTarget);
    const title = String(fd.get("title") || "").trim();
    const body = String(fd.get("body") || "").trim();
    const patch = {};
    if (title) patch.shortTitle = title;
    if (body) patch.body = body;
    try {
      await apiUpdateRegulation(item.id, patch);
      toastSuccess("Regulation edits saved.");
    } catch (err) {
      console.error("[regulation] Failed to save edits:", err);
      toastError(`Save failed: ${err.message}`);
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Save Edits"; }
      return;
    }
    await initRegulationPage(data);
  });

  root.querySelector("[data-action='close-early']")?.addEventListener("click", async (e) => {
    if (!canStaff || isEffectivelyClosed) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await apiUpdateRegulation(item.id, { status: "closed", closedAtSim: formatSimMonthYear(data.gameState) });
      toastSuccess("Regulation debate closed.");
    } catch (err) {
      console.error("[regulation] Failed to close regulation:", err);
      toastError(`Close failed: ${err.message}`);
      btn.disabled = false;
      return;
    }
    await initRegulationPage(data);
  });
}
