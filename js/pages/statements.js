import { saveData } from "../core.js";
import { esc } from "../ui.js";
import { isSpeaker } from "../permissions.js";

const GOVERNMENT_OFFICES = new Set([
  "prime-minister", "leader-commons", "chancellor", "home", "foreign", "trade", "defence",
  "welfare", "education", "env-agri", "health", "eti", "culture", "home-nations"
]);

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function getCharacter(data) {
  return data?.currentCharacter || data?.currentPlayer || {};
}

function getSimDate(data) {
  const gs = data?.gameState || {};
  const month = Number(gs.startSimMonth ?? 8);
  const year = Number(gs.startSimYear ?? 1997);
  return { month, year, label: `${MONTHS[(month - 1 + 12) % 12]} ${year}` };
}

function plusMonths(month, year, add) {
  const z = (year * 12) + (month - 1) + add;
  return { month: (z % 12) + 1, year: Math.floor(z / 12) };
}

function labelFor(month, year) {
  return `${MONTHS[(month - 1 + 12) % 12]} ${year}`;
}

function ensureStatements(data) {
  data.statements ??= {};
  data.statements.items ??= [];
  data.statements.nextNumber ??= (data.statements.items.length || 0) + 1;
}

function canSubmit(data) {
  return GOVERNMENT_OFFICES.has(getCharacter(data)?.office);
}

function discussionUrl(statement) {
  if (statement?.debateUrl) return statement.debateUrl;
  return `https://forum.rulebritannia.org/t/ms-${encodeURIComponent(statement?.number || "x")}-${encodeURIComponent((statement?.title || "statement").toLowerCase().replaceAll(" ", "-"))}`;
}

function badge(statement) {
  return statement.status === "archived" ? "Archived" : "Open for Debate";
}

function statementCard(s, speaker) {
  return `
    <article class="tile" style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
        <div><b>MS${esc(s.number)}</b>: ${esc(s.title)} <span class="muted">by ${esc(s.author)}</span></div>
        <div>${esc(badge(s))}</div>
      </div>
      <div class="muted" style="margin-top:6px;">Debate window: ${esc(s.openedAtSim || "—")} → ${esc(s.closesAtSim || "—")}</div>
      ${s.archivedAtSim ? `<div class="muted" style="margin-top:4px;">Archived ${esc(s.archivedAtSim)}</div>` : ""}
      <div class="tile-bottom" style="display:flex;gap:8px;flex-wrap:wrap;">
        <a class="btn" href="statement.html?id=${encodeURIComponent(s.id)}">Open</a>
        ${speaker && s.status !== "archived" ? `<button class="btn danger" type="button" data-action="archive" data-id="${esc(s.id)}">Archive</button>` : ""}
      </div>
    </article>
  `;
}

function render(data) {
  const root = document.getElementById("statements-root");
  if (!root) return;

  ensureStatements(data);
  const sim = getSimDate(data);
  const speaker = isSpeaker(data);
  const submitter = canSubmit(data);
  const char = getCharacter(data);

  const items = data.statements.items.slice().sort((a, b) => Number(b.number || 0) - Number(a.number || 0));
  const openItems = items.filter((i) => i.status !== "archived");
  const archivedItems = items.filter((i) => i.status === "archived");

  root.innerHTML = `
    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Ministerial Statements Guide</h2>
      <p>Ministerial Statements are used for major policy announcements that are not primary legislation. Statements are numbered automatically as <b>MS1, MS2, ...</b> in chronological sequence.</p>
      <p>Each statement links to its own debate thread (normally open for <b>2 simulation months</b>). Click <b>Open</b> to view the full statement page and debate link.</p>
    </section>

    ${submitter ? `
      <section class="tile" style="margin-bottom:12px;">
        <h2 style="margin-top:0;">Submit a Ministerial Statement</h2>
        <form id="statement-submit-form">
          <label class="label" for="statement-title">Statement title</label>
          <input id="statement-title" name="title" class="input" required placeholder="Title of the statement" />

          <label class="label" for="statement-body">Statement text</label>
          <textarea id="statement-body" name="body" class="input" rows="6" required placeholder="Write ministerial statement text"></textarea>

          <button type="submit" class="btn">Submit Statement</button>
        </form>
        <p class="muted" style="margin-top:8px;">Submitting as ${esc(char?.name || "Government minister")}.</p>
      </section>
    ` : `
      <section class="tile" style="margin-bottom:12px;">
        <h2 style="margin-top:0;">Submit a Ministerial Statement</h2>
        <p class="muted">Only members of the Government can submit Ministerial Statements.</p>
      </section>
    `}

    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Current Statements</h2>
      ${openItems.length ? openItems.map((s) => statementCard(s, speaker)).join("") : `<p class="muted">No active statements.</p>`}
    </section>

    <section class="tile" style="margin-top:20px;">
      <h2 style="margin-top:0;">Archive</h2>
      ${archivedItems.length ? archivedItems.map((s) => statementCard(s, false)).join("") : `<p class="muted">No archived statements yet.</p>`}
    </section>
  `;

  root.querySelector("#statement-submit-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const title = String(fd.get("title") || "").trim();
    const body = String(fd.get("body") || "").trim();
    if (!title || !body) return;

    const number = Number(data.statements.nextNumber || (data.statements.items.length + 1));
    const close = plusMonths(sim.month, sim.year, 2);
    const author = getCharacter(data)?.name || "Government Minister";

    data.statements.items.push({
      id: `ms-${String(number).padStart(3, "0")}`,
      number,
      title,
      body,
      author,
      status: "open",
      openedAtSim: sim.label,
      closesAtSim: labelFor(close.month, close.year),
      debateUrl: `https://forum.rulebritannia.org/t/ms-${number}-${encodeURIComponent(title.toLowerCase().replaceAll(" ", "-"))}`
    });
    data.statements.nextNumber = number + 1;

    saveData(data);
    render(data);
  });

  root.querySelectorAll("[data-action='archive']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!speaker) return;
      const id = btn.getAttribute("data-id");
      const statement = data.statements.items.find((s) => s.id === id);
      if (!statement || statement.status === "archived") return;
      statement.status = "archived";
      statement.archivedAtSim = sim.label;
      saveData(data);
      render(data);
    });
  });
}

export function initStatementsPage(data) {
  ensureStatements(data);
  render(data);
}
