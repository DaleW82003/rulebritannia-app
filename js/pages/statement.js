import { esc } from "../ui.js";

function ensureStatements(data) {
  data.statements ??= {};
  data.statements.items ??= [];
}

function debateUrl(statement) {
  if (statement?.debateUrl) return statement.debateUrl;
  return `https://forum.rulebritannia.org/t/ms-${encodeURIComponent(statement?.number || "x")}-${encodeURIComponent((statement?.title || "statement").toLowerCase().replaceAll(" ", "-"))}`;
}

function getIdFromUrl() {
  return new URL(window.location.href).searchParams.get("id");
}

export function initStatementPage(data) {
  const root = document.getElementById("statement-root");
  if (!root) return;

  ensureStatements(data);
  const id = getIdFromUrl();
  const items = data.statements.items || [];
  const statement = items.find((s) => s.id === id) || items[0] || null;

  if (!statement) {
    root.innerHTML = `<div class="muted-block">No statements are available.</div>`;
    return;
  }

  root.innerHTML = `
    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">MS${esc(statement.number)}: ${esc(statement.title)}</h2>
      <p class="muted">Author: ${esc(statement.author || "Government Minister")} • Status: ${esc(statement.status || "open")}</p>
      <p class="muted">Debate window: ${esc(statement.openedAtSim || "—")} → ${esc(statement.closesAtSim || "—")}</p>
      ${statement.archivedAtSim ? `<p class="muted">Archived: ${esc(statement.archivedAtSim)}</p>` : ""}
    </section>

    <section class="tile" style="margin-bottom:12px;">
      <h3 style="margin-top:0;">Full Statement</h3>
      <div class="muted-block" style="white-space:pre-wrap;">${esc(statement.body || "No statement text provided.")}</div>
    </section>

    <section class="tile">
      <div class="tile-bottom" style="display:flex;gap:8px;flex-wrap:wrap;">
        <a class="btn" href="${esc(debateUrl(statement))}" target="_blank" rel="noopener">Open Debate</a>
        <a class="btn" href="statements.html">Back to Statements</a>
      </div>
    </section>
  `;
}
