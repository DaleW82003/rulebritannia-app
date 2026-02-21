import { saveData } from "../core.js";
import { esc } from "../ui.js";
import { getSimDate, simDateToObj, plusSimMonths, formatSimDate,
         formatSimMonthYear, isDeadlinePassed, compareSimDates,
         countdownToSimMonth } from "../clock.js";
import { apiCreateDebateTopic } from "../api.js";
import { handleApiError } from "../errors.js";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const OFFICE_DEPARTMENT = {
  "prime-minister": "Cabinet Office",
  "leader-commons": "Leader of the House Office",
  chancellor: "HM Treasury",
  home: "Home Office",
  foreign: "Foreign and Commonwealth Office",
  trade: "Department for Business and Trade",
  defence: "Ministry of Defence",
  welfare: "Department for Work and Pensions",
  education: "Department for Education",
  "env-agri": "Department for Environment and Agriculture",
  health: "Department of Health and Social Care",
  eti: "Department for Transport and Infrastructure",
  culture: "Department for Culture, Media and Sport",
  "home-nations": "Department for the Home Nations"
};

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

function canMakeRegulation(data) {
  const office = getCharacter(data)?.office;
  return Boolean(OFFICE_DEPARTMENT[office]);
}

export function ensureRegulations(data) {
  data.regulations ??= {};
  data.regulations.items ??= [];
  data.regulations.nextId ??= data.regulations.items.length + 1;
}

function nextYearNumber(data, year) {
  const items = data.regulations.items || [];
  return items.filter((i) => Number(i.simYear) === Number(year)).length + 1;
}

export function initRegulationsPage(data) {
  const root = document.getElementById("regulations-root");
  if (!root) return;

  ensureRegulations(data);
  const char = getCharacter(data);
  const simCurrent = simNow(data);

  // Auto-close regulations whose deadline has passed
  const simCurrentObj = simDateToObj(getSimDate(data.gameState));
  for (const r of data.regulations.items) {
    if (r.status === "open" && r.debateClosesAtSimObj && compareSimDates(simCurrentObj, r.debateClosesAtSimObj) >= 0) {
      r.status = "closed";
      r.closedAtSim = simCurrent.label;
    }
  }
  const canSubmit = canMakeRegulation(data);
  const office = char?.office;
  const myDepartment = OFFICE_DEPARTMENT[office] || "";

  const items = data.regulations.items.slice().sort((a, b) => {
    if (a.status !== b.status) return a.status === "closed" ? 1 : -1;
    if (a.simYear !== b.simYear) return Number(b.simYear) - Number(a.simYear);
    return Number(b.yearNumber || 0) - Number(a.yearNumber || 0);
  });
  const openItems = items.filter((i) => i.status !== "closed");
  const archivedItems = items.filter((i) => i.status === "closed");

  root.innerHTML = `
    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Guide to Regulations</h2>
      <p>Regulations are laid by Government members for their own department only. Each regulation links to a dedicated open page with the full text and debate link.</p>
      <p>Use <b>Open</b> to view and manage an individual regulation (including Speaker controls).</p>
    </section>

    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Make a Regulation</h2>
      ${canSubmit ? `
        <form id="reg-submit-form">
          <p class="muted">Department: <b>${esc(myDepartment)}</b></p>
          <label class="label" for="reg-title">Short title</label>
          <input id="reg-title" name="title" class="input" required placeholder="e.g. Licensing Compliance Order">

          <label class="label" for="reg-force-month">Comes into force (month/year)</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <select id="reg-force-month" class="input" name="forceMonth">
              ${MONTHS.map((m, idx) => `<option value="${idx + 1}" ${idx + 1 === simCurrent.month + 1 ? "selected" : ""}>${esc(m)}</option>`).join("")}
            </select>
            <input id="reg-force-year" class="input" type="number" name="forceYear" min="${simCurrent.year}" value="${simCurrent.year}">
          </div>

          <label class="label" for="reg-body">Regulation body</label>
          <textarea id="reg-body" name="body" class="input" rows="7" required placeholder="Write full regulation text"></textarea>

          <button type="submit" class="btn">Make Regulation</button>
        </form>
      ` : `<p class="muted">Only Government members may make regulations.</p>`}
    </section>

    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Current Regulations</h2>
      ${openItems.length ? openItems.map((r) => `
        <article class="tile" style="margin-bottom:10px;">
          <div><b>${esc(r.department)} Regulation ${esc(r.regulationNumber)}</b>: ${esc(r.shortTitle)} <span class="muted">by ${esc(r.author)}</span></div>
          <div class="muted" style="margin-top:6px;">Laid: ${esc(r.laidAtSim || "—")} • In force: ${esc(r.comesIntoForce || "—")} • Debate closes: ${esc(r.debateClosesAtSim || "—")}${r.debateClosesAtSimObj && r.status !== "closed" ? ` (${countdownToSimMonth(r.debateClosesAtSimObj.month, r.debateClosesAtSimObj.year, data.gameState)})` : ""}</div>
          <div class="tile-bottom" style="display:flex;gap:8px;flex-wrap:wrap;">
            <a class="btn" href="regulation.html?id=${encodeURIComponent(r.id)}">Open</a>
            ${r.debateUrl ? `<a class="btn" href="${esc(r.debateUrl)}" target="_blank" rel="noopener">Debate</a>` : ""}
          </div>
        </article>
      `).join("") : `<p class="muted">No current regulations.</p>`}
    </section>

    <section class="tile" style="margin-top:20px;">
      <h2 style="margin-top:0;">Archive</h2>
      ${archivedItems.length ? archivedItems.map((r) => `
        <article class="tile" style="margin-bottom:10px;">
          <div><b>${esc(r.department)} Regulation ${esc(r.regulationNumber)}</b>: ${esc(r.shortTitle)}</div>
          <div class="muted" style="margin-top:6px;">Closed: ${esc(r.closedAtSim || "—")}</div>
          <div class="tile-bottom" style="display:flex;gap:8px;flex-wrap:wrap;">
            <a class="btn" href="regulation.html?id=${encodeURIComponent(r.id)}">Open</a>
            ${r.debateUrl ? `<a class="btn" href="${esc(r.debateUrl)}" target="_blank" rel="noopener">Debate</a>` : ""}
          </div>
        </article>
      `).join("") : `<p class="muted">No archived regulations yet.</p>`}
    </section>
  `;

  root.querySelector("#reg-submit-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!canSubmit) return;

    const fd = new FormData(e.currentTarget);
    const title = String(fd.get("title") || "").trim();
    const body = String(fd.get("body") || "").trim();
    const forceMonth = Number(fd.get("forceMonth") || simCurrent.month);
    const forceYear = Number(fd.get("forceYear") || simCurrent.year);
    if (!title || !body) return;

    const yearNumber = nextYearNumber(data, simCurrent.year);
    const regNo = `${simCurrent.year}/No ${yearNumber}`;
    const debateEnd = plusSimMonths(simCurrent.month, simCurrent.year, 2);

    const regulation = {
      id: `reg-${Date.now()}-${data.regulations.nextId}`,
      department: myDepartment,
      office,
      regulationNumber: regNo,
      yearNumber,
      simYear: simCurrent.year,
      shortTitle: title,
      author: char?.name || "Minister",
      body,
      laidAtSim: simCurrent.label,
      comesIntoForce: `${MONTHS[(forceMonth - 1 + 12) % 12]} ${forceYear}`,
      debateUrl: `https://forum.rulebritannia.org/t/reg-${encodeURIComponent(regNo)}-${encodeURIComponent(title.toLowerCase().replaceAll(" ", "-"))}`,
      debateClosesAtSim: formatSimDate(debateEnd.month, debateEnd.year),
      debateClosesAtSimObj: { month: debateEnd.month, year: debateEnd.year },
      status: "open"
    };

    data.regulations.items.push(regulation);
    data.regulations.nextId += 1;
    saveData(data);
    apiCreateDebateTopic({
      entityType: "regulation", entityId: regulation.id,
      title: `${regulation.department} Regulation ${regNo}: ${title}`,
      raw: `**${regulation.department} Regulation ${regNo}: ${title}**\nLaid by ${regulation.author}. Comes into force: ${regulation.comesIntoForce}.\n\n${body}`
    }).then(({ topicId, topicUrl }) => {
      regulation.debateUrl = topicUrl;
      regulation.discourseTopicId = topicId;
      saveData(data);
    }).catch((err) => handleApiError(err, "Debate topic"));
    window.location.href = `regulation.html?id=${encodeURIComponent(regulation.id)}`;
  });
}
