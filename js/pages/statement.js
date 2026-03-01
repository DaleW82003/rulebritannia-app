import { esc } from "../ui.js";
import { countdownToSimMonth, formatSimMonthYear } from "../clock.js";
import { canAdminModOrSpeaker } from "../permissions.js";
import { apiGetStatement, apiUpdateStatement } from "../api.js";

function ensureStatements(data) {
  data.statements ??= {};
  data.statements.items ??= [];
}

function getDebateUrl(statement) {
  return statement?.debate?.topicUrl || statement?.discourse_topic_url || statement?.discourseTopicUrl || statement?.debateUrl || null;
}

function getIdFromUrl() {
  return new URL(window.location.href).searchParams.get("id");
}

export async function initStatementPage(data) {
  const root = document.getElementById("statement-root");
  if (!root) return;

  ensureStatements(data);
  const id = getIdFromUrl();
  let statement = (data.statements.items || []).find((s) => s.id === id) || null;

  if (!statement && id) {
    try {
      const r = await apiGetStatement(id);
      if (r?.statement) {
        statement = r.statement;
        data.statements.items.push(statement);
      }
    } catch (err) {
      console.error("[statement] DB fallback failed:", err);
    }
  }

  if (!statement) {
    statement = data.statements.items[0] || null;
  }

  if (!statement) {
    root.innerHTML = `<div class="muted-block">No statements are available.</div>`;
    return;
  }

  const canStaff = canAdminModOrSpeaker(data);
  const debateUrl = getDebateUrl(statement);

  root.innerHTML = `
    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">MS${esc(statement.number)}: ${esc(statement.title)}</h2>
      <p class="muted">Author: ${esc(statement.author_display_name || statement.author || "Government Minister")} • Status: ${esc(statement.status || "open")}</p>
      <p class="muted">Debate window: ${esc(statement.openedAtSim || "—")} → ${esc(statement.closesAtSim || "—")}${statement.closesAtSimObj && statement.status !== "archived" ? ` (${countdownToSimMonth(statement.closesAtSimObj.month, statement.closesAtSimObj.year, data.gameState)})` : ""}</p>
      ${statement.archivedAtSim ? `<p class="muted">Archived: ${esc(statement.archivedAtSim)}</p>` : ""}
    </section>

    <section class="tile" style="margin-bottom:12px;">
      <h3 style="margin-top:0;">Full Statement</h3>
      <div class="muted-block" style="white-space:pre-wrap;">${esc(statement.body || "No statement text provided.")}</div>
    </section>

    <section class="tile tile-form">
      <div class="tile-bottom" style="display:flex;gap:8px;flex-wrap:wrap;">
        ${debateUrl ? `<a class="btn" href="${esc(debateUrl)}" target="_blank" rel="noopener">Open Debate</a>` : `<span class="muted">No debate yet</span>`}
        <a class="btn" href="statements.html">Back to Statements</a>
      </div>
    </section>

    ${canStaff ? `
    <section class="tile tile-form" style="margin-top:12px;">
      <h3 style="margin-top:0;">Edit Statement (Staff)</h3>
      <form id="statement-edit-form">
        <label class="label" for="stmt-edit-title">Title</label>
        <input id="stmt-edit-title" class="input" name="title" value="${esc(statement.title || "")}">
        <label class="label" for="stmt-edit-body">Statement text</label>
        <textarea id="stmt-edit-body" class="input" name="body" rows="8">${esc(statement.body || "")}</textarea>
        <div class="tile-bottom" style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn" type="submit">Save Edits</button>
        </div>
      </form>
      <p id="stmt-edit-msg" class="muted" style="margin-top:4px;"></p>
    </section>
    ` : ""}
  `;

  root.querySelector("#statement-edit-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!canStaff) return;
    const fd = new FormData(ev.currentTarget);
    const editMsg = root.querySelector("#stmt-edit-msg");
    if (editMsg) editMsg.textContent = "Saving…";
    const title = String(fd.get("title") || "").trim();
    const body = String(fd.get("body") || "").trim();
    if (title) statement.title = title;
    if (body) statement.body = body;
    try {
      await apiUpdateStatement(statement.id, statement);
      if (editMsg) editMsg.textContent = "Saved.";
      initStatementPage(data);
    } catch (err) {
      if (editMsg) editMsg.textContent = `Error: ${err.message}`;
    }
  });
}
