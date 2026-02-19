import { saveData } from "../core.js";
import { esc } from "../ui.js";
import { isSpeaker } from "../permissions.js";

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
  health: "Department of Health and Social",
  eti: "Department for Environment, Transport and Infrastructure",
  culture: "Department for Culture, Media and Sport",
  "home-nations": "Department for the Home Nations"
};

function getCharacter(data) {
  return data?.currentCharacter || data?.currentPlayer || {};
}

function sim(data) {
  const gs = data?.gameState || {};
  const month = Number(gs.startSimMonth ?? 8);
  const year = Number(gs.startSimYear ?? 1997);
  return { month, year, label: `${MONTHS[(month - 1 + 12) % 12]} ${year}` };
}

function plusMonths(month, year, add) {
  const z = (year * 12) + (month - 1) + add;
  return { month: (z % 12) + 1, year: Math.floor(z / 12), label: `${MONTHS[((z % 12) + 12) % 12]} ${Math.floor(z / 12)}` };
}

function canMakeRegulation(data) {
  const office = getCharacter(data)?.office;
  return Boolean(OFFICE_DEPARTMENT[office]);
}

function ensureRegulations(data) {
  data.regulations ??= {};
  data.regulations.items ??= [];
  data.regulations.nextId ??= data.regulations.items.length + 1;
}

function discussionUrl(reg) {
  if (reg.debateUrl) return reg.debateUrl;
  return `https://forum.rulebritannia.org/t/reg-${encodeURIComponent(reg.regulationNumber || reg.id)}-${encodeURIComponent((reg.shortTitle || "regulation").toLowerCase().replaceAll(" ", "-"))}`;
}

function nextYearNumber(data, year) {
  const items = data.regulations.items || [];
  return items.filter((i) => Number(i.simYear) === Number(year)).length + 1;
}

function render(data, state) {
  const root = document.getElementById("regulations-root");
  if (!root) return;

  ensureRegulations(data);
  const char = getCharacter(data);
  const simNow = sim(data);
  const speaker = isSpeaker(data);
  const canSubmit = canMakeRegulation(data);
  const office = char?.office;
  const myDepartment = OFFICE_DEPARTMENT[office] || "";

  const items = data.regulations.items.slice().sort((a, b) => {
    if (a.simYear !== b.simYear) return Number(b.simYear) - Number(a.simYear);
    return Number(b.yearNumber || 0) - Number(a.yearNumber || 0);
  });

  const selectedId = state.selectedId || items[0]?.id || null;
  const selected = items.find((i) => i.id === selectedId) || null;

  root.innerHTML = `
    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Guide to Regulations</h2>
      <p>Regulations are laid by Government members for their own department only. Each is numbered as <b>Year/No x</b>, where <b>x</b> increments across all departments in that simulation year.</p>
      <p>Each regulation has a Discourse debate thread open for <b>2 simulation months</b>. There is <b>no division</b>. The Speaker can close debate early and edit regulation details.</p>
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
              ${MONTHS.map((m, idx) => `<option value="${idx + 1}" ${idx + 1 === simNow.month + 1 ? "selected" : ""}>${esc(m)}</option>`).join("")}
            </select>
            <input id="reg-force-year" class="input" type="number" name="forceYear" min="${simNow.year}" value="${simNow.year}">
          </div>

          <label class="label" for="reg-body">Regulation body</label>
          <textarea id="reg-body" name="body" class="input" rows="7" required placeholder="Write full regulation text"></textarea>

          <button type="submit" class="btn">Make Regulation</button>
        </form>
      ` : `<p class="muted">Only Government members may make regulations.</p>`}
    </section>

    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Regulations this Round</h2>
      ${items.length ? items.map((r) => `
        <article class="tile" style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            <div><b>${esc(r.department)} Regulation ${esc(r.regulationNumber)}</b>: ${esc(r.shortTitle)} <span class="muted">by ${esc(r.author)}</span></div>
            <div>${esc(r.status === "closed" ? "Debate Closed" : "Debate Open")}</div>
          </div>
          <div class="muted" style="margin-top:6px;">Laid: ${esc(r.laidAtSim || "—")} • In force: ${esc(r.comesIntoForce || "—")}</div>
          <div class="tile-bottom"><button class="btn" type="button" data-action="open" data-id="${esc(r.id)}">Open</button></div>
        </article>
      `).join("") : `<p class="muted">No regulations laid yet.</p>`}
    </section>

    <section class="tile">
      <h2 style="margin-top:0;">Regulation Detail</h2>
      ${selected ? `
        <h3>${esc(selected.department)} Regulation ${esc(selected.regulationNumber)}: ${esc(selected.shortTitle)}</h3>
        <p class="muted">Author: ${esc(selected.author)} • Laid: ${esc(selected.laidAtSim)} • Comes into force: ${esc(selected.comesIntoForce)} • Status: <b>${esc(selected.status === "closed" ? "Debate Closed" : "Debate Open")}</b></p>
        <p style="white-space:pre-wrap;">${esc(selected.body)}</p>
        <p><a class="btn" href="${esc(discussionUrl(selected))}" target="_blank" rel="noopener">Debate on Discourse</a></p>

        ${speaker ? `
          <div class="tile" style="margin-top:10px;">
            <h4 style="margin-top:0;">Speaker Controls</h4>
            ${selected.status !== "closed" ? `<button class="btn" type="button" data-action="close-early" data-id="${esc(selected.id)}">Close Debate Early</button>` : `<p class="muted">Debate already closed.</p>`}
            <form id="speaker-edit-form" data-id="${esc(selected.id)}" style="margin-top:10px;">
              <label class="label" for="speaker-edit-title">Edit short title</label>
              <input id="speaker-edit-title" class="input" name="title" value="${esc(selected.shortTitle)}">
              <label class="label" for="speaker-edit-body">Edit body</label>
              <textarea id="speaker-edit-body" class="input" name="body" rows="5">${esc(selected.body)}</textarea>
              <button class="btn" type="submit">Save Speaker Edits</button>
            </form>
          </div>
        ` : ""}
      ` : `<p class="muted">Open a regulation to view details.</p>`}
    </section>
  `;

  root.querySelectorAll("[data-action='open']").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedId = btn.getAttribute("data-id");
      render(data, state);
    });
  });

  root.querySelector("#reg-submit-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!canSubmit) return;

    const fd = new FormData(e.currentTarget);
    const title = String(fd.get("title") || "").trim();
    const body = String(fd.get("body") || "").trim();
    const forceMonth = Number(fd.get("forceMonth") || simNow.month);
    const forceYear = Number(fd.get("forceYear") || simNow.year);
    if (!title || !body) return;

    const yearNumber = nextYearNumber(data, simNow.year);
    const regNo = `${simNow.year}/No ${yearNumber}`;
    const debateEnd = plusMonths(simNow.month, simNow.year, 2);

    const regulation = {
      id: `reg-${Date.now()}-${data.regulations.nextId}`,
      department: myDepartment,
      office,
      regulationNumber: regNo,
      yearNumber,
      simYear: simNow.year,
      shortTitle: title,
      author: char?.name || "Minister",
      body,
      laidAtSim: simNow.label,
      comesIntoForce: `${MONTHS[(forceMonth - 1 + 12) % 12]} ${forceYear}`,
      debateUrl: `https://forum.rulebritannia.org/t/reg-${encodeURIComponent(regNo)}-${encodeURIComponent(title.toLowerCase().replaceAll(" ", "-"))}`,
      debateClosesAtSim: debateEnd.label,
      status: "open"
    };

    data.regulations.items.push(regulation);
    data.regulations.nextId += 1;
    state.selectedId = regulation.id;
    saveData(data);
    render(data, state);
  });

  root.querySelector("#speaker-edit-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!speaker) return;
    const id = e.currentTarget.getAttribute("data-id");
    const regulation = data.regulations.items.find((r) => r.id === id);
    if (!regulation) return;

    const fd = new FormData(e.currentTarget);
    const title = String(fd.get("title") || "").trim();
    const body = String(fd.get("body") || "").trim();
    if (title) regulation.shortTitle = title;
    if (body) regulation.body = body;
    saveData(data);
    render(data, state);
  });

  root.querySelector("[data-action='close-early']")?.addEventListener("click", (e) => {
    if (!speaker) return;
    const id = e.currentTarget.getAttribute("data-id");
    const regulation = data.regulations.items.find((r) => r.id === id);
    if (!regulation || regulation.status === "closed") return;
    regulation.status = "closed";
    regulation.closedAtSim = simNow.label;
    saveData(data);
    render(data, state);
  });
}

export function initRegulationsPage(data) {
  ensureRegulations(data);
  const state = { selectedId: data.regulations.items[0]?.id || null };
  render(data, state);
}
