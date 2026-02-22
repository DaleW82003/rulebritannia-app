import { saveState } from "../core.js";
import { esc } from "../ui.js";
import { isSpeaker } from "../permissions.js";
import { getSimDate, simDateToObj, plusSimMonths, formatSimDate,
         formatSimMonthYear, isDeadlinePassed, compareSimDates,
         countdownToSimMonth } from "../clock.js";
import { apiCreateDebateTopic } from "../api.js";
import { tileSection, tileCard } from "../components/tile.js";
import { toastSuccess } from "../components/toast.js";
import { handleApiError } from "../errors.js";

const GOVERNMENT_OFFICES = new Set([
  "prime-minister", "leader-commons", "chancellor", "home", "foreign", "trade", "defence",
  "welfare", "education", "env-agri", "health", "eti", "culture", "home-nations"
]);

function getCharacter(data) {
  return data?.currentCharacter || data?.currentPlayer || {};
}

function simNow(data) {
  const raw = getSimDate(data.gameState);
  return {
    month: raw.monthIndex + 1,
    year: raw.year,
    label: formatSimMonthYear(data.gameState)
  };
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

function statementCard(s, speaker, gameState) {
  const countdown = s.closesAtSimObj && s.status !== "archived"
    ? countdownToSimMonth(s.closesAtSimObj.month, s.closesAtSimObj.year, gameState)
    : "";
  const actions = `
    <a class="btn" href="statement.html?id=${encodeURIComponent(s.id)}">Open</a>
    ${s.debateUrl ? `<a class="btn" href="${esc(s.debateUrl)}" target="_blank" rel="noopener">Debate</a>` : ""}
    ${speaker && s.status !== "archived" ? `<button class="btn danger" type="button" data-action="archive" data-id="${esc(s.id)}">Archive</button>` : ""}
  `;
  const body = `
    <div class="spaced">
      <div><b>MS${esc(s.number)}</b>: ${esc(s.title)} <span class="muted">by ${esc(s.author)}</span></div>
      <div>${esc(badge(s))}</div>
    </div>
    <div class="muted" style="margin-top:6px;">Debate window: ${esc(s.openedAtSim || "—")} → ${esc(s.closesAtSim || "—")}${countdown ? ` (${countdown})` : ""}</div>
    ${s.archivedAtSim ? `<div class="muted" style="margin-top:4px;">Archived ${esc(s.archivedAtSim)}</div>` : ""}
  `;
  return tileCard({ body, actions, extraClass: "tile-stack" });
}

function render(data) {
  const root = document.getElementById("statements-root");
  if (!root) return;

  ensureStatements(data);
  const sim = simNow(data);
  const speaker = isSpeaker(data);
  const submitter = canSubmit(data);
  const char = getCharacter(data);

  // Auto-archive statements whose deadline has passed
  const simCurrent = simDateToObj(getSimDate(data.gameState));
  for (const s of data.statements.items) {
    if (s.status === "open" && s.closesAtSimObj && compareSimDates(simCurrent, s.closesAtSimObj) >= 0) {
      s.status = "archived";
      s.archivedAtSim = sim.label;
    }
  }

  const items = data.statements.items.slice().sort((a, b) => Number(b.number || 0) - Number(a.number || 0));
  const openItems = items.filter((i) => i.status !== "archived");
  const archivedItems = items.filter((i) => i.status === "archived");

  root.innerHTML = `
    ${tileSection({
      title: "Ministerial Statements Guide",
      body: `<p>Ministerial Statements are used for major policy announcements that are not primary legislation. Statements are numbered automatically as <b>MS1, MS2, ...</b> in chronological sequence.</p>
        <p>Each statement links to its own debate thread (normally open for <b>2 simulation months</b>). Click <b>Open</b> to view the full statement page and debate link.</p>`
    })}

    ${submitter
      ? tileSection({
          title: "Submit a Ministerial Statement",
          body: `
            <form id="statement-submit-form">
              <div class="form-row">
                <label for="statement-title">Statement title</label>
                <input id="statement-title" name="title" required placeholder="Title of the statement" />
              </div>
              <div class="form-row">
                <label for="statement-body">Statement text</label>
                <textarea id="statement-body" name="body" rows="6" required placeholder="Write ministerial statement text"></textarea>
              </div>
              <button type="submit" class="btn primary">Submit Statement</button>
            </form>
            <p class="muted" style="margin-top:8px;">Submitting as ${esc(char?.name || "Government minister")}.</p>
          `
        })
      : tileSection({
          title: "Submit a Ministerial Statement",
          body: `<p class="muted">Only members of the Government can submit Ministerial Statements.</p>`
        })
    }

    ${tileSection({
      title: "Current Statements",
      body: openItems.length ? openItems.map((s) => statementCard(s, speaker, data.gameState)).join("") : `<p class="muted">No active statements.</p>`
    })}

    ${tileSection({
      title: "Archive",
      body: archivedItems.length ? archivedItems.map((s) => statementCard(s, false, data.gameState)).join("") : `<p class="muted">No archived statements yet.</p>`
    })}
  `;

  root.querySelector("#statement-submit-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const title = String(fd.get("title") || "").trim();
    const body = String(fd.get("body") || "").trim();
    if (!title || !body) return;

    const number = Number(data.statements.nextNumber || (data.statements.items.length + 1));
    const close = plusSimMonths(sim.month, sim.year, 2);
    const author = getCharacter(data)?.name || "Government Minister";

    const statement = {
      id: `ms-${String(number).padStart(3, "0")}`,
      number,
      title,
      body,
      author,
      status: "open",
      openedAtSim: sim.label,
      closesAtSim: formatSimDate(close.month, close.year),
      closesAtSimObj: { month: close.month, year: close.year },
      debateUrl: `https://forum.rulebritannia.org/t/ms-${number}-${encodeURIComponent(title.toLowerCase().replaceAll(" ", "-"))}`
    };
    data.statements.items.push(statement);
    data.statements.nextNumber = number + 1;

    saveState(data);
    toastSuccess(`MS${number}: "${title}" submitted.`);
    apiCreateDebateTopic({
      entityType: "statement", entityId: statement.id,
      title: `Ministerial Statement MS${number}: ${title}`,
      raw: `**Ministerial Statement by ${author}**\n\n${body}`
    }).then(({ topicId, topicUrl }) => {
      statement.debateUrl = topicUrl;
      statement.discourseTopicId = topicId;
      saveState(data);
    }).catch((err) => handleApiError(err, "Debate topic"));
    render(data);
  });

  root.querySelectorAll("[data-action='archive']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!speaker) return;
      const id = btn.getAttribute("data-id");
      const statement = data.statements.items.find((s) => s.id === id);
      if (!statement || statement.status === "archived") return;
      statement.status = "archived";
      statement.archivedAtSim = formatSimMonthYear(data.gameState);
      saveState(data);
      toastSuccess("Statement archived.");
      render(data);
    });
  });
}

export function initStatementsPage(data) {
  ensureStatements(data);
  render(data);
}
