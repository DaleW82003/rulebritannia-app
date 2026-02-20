import { saveData } from "../core.js";
import { esc } from "../ui.js";
import { isSpeaker } from "../permissions.js";
import { getSimDate, simDateToObj, plusSimMonths, formatSimDate,
         formatSimMonthYear, isDeadlinePassed, compareSimDates,
         countdownToSimMonth } from "../clock.js";

const GOVERNMENT_OFFICES = new Set([
  "prime-minister", "leader-commons", "chancellor", "home", "foreign", "trade", "defence", "welfare", "education", "env-agri", "health", "eti", "culture", "home-nations"
]);

function getCharacter(data) {
  return data?.currentCharacter || data?.currentPlayer || {};
}

function isGovernmentMember(data) {
  return GOVERNMENT_OFFICES.has(getCharacter(data)?.office);
}

function ensureMotions(data) {
  data.motions ??= {};
  data.motions.house ??= [];
  data.motions.edm ??= [];
  data.motions.nextHouseNumber ??= data.motions.house.length + 1;
  data.motions.nextEdmNumber ??= data.motions.edm.length + 1;
}

function simNow(data) {
  const raw = getSimDate(data.gameState);
  return {
    month: raw.monthIndex + 1,
    year: raw.year,
    label: formatSimMonthYear(data.gameState)
  };
}

function discussionUrl(kind, number, title) {
  return `https://forum.rulebritannia.org/t/${kind}-${number}-${encodeURIComponent((title || "item").toLowerCase().replaceAll(" ", "-"))}`;
}

function bodyWithPreamble(body = "") {
  return `That this House ${String(body || "").trim()}`;
}

export function initMotionsPage(data) {
  const root = document.getElementById("motions-root");
  if (!root) return;

  ensureMotions(data);
  const sim = simNow(data);
  const char = getCharacter(data);
  const simCurrentObj = simDateToObj(getSimDate(data.gameState));

  // Auto-archive expired house motions and EDMs
  for (const m of data.motions.house) {
    if (m.status !== "archived" && m.division?.endSimObj && compareSimDates(simCurrentObj, m.division.endSimObj) >= 0 && m.division?.status === "open") {
      m.division.status = "closed";
      m.status = "archived";
      m.archivedAtSim = sim.label;
    }
  }
  for (const m of data.motions.edm) {
    if (m.status !== "archived" && m.closesAtSimObj && compareSimDates(simCurrentObj, m.closesAtSimObj) >= 0) {
      m.status = "archived";
      m.archivedAtSim = sim.label;
    }
  }

  const house = data.motions.house.slice().sort((a, b) => Number(b.number || 0) - Number(a.number || 0));
  const edm = data.motions.edm.slice().sort((a, b) => Number(b.number || 0) - Number(a.number || 0));
  const openHouse = house.filter((m) => m.status !== "archived");
  const archivedHouse = house.filter((m) => m.status === "archived");
  const openEdm = edm.filter((m) => m.status !== "archived");
  const archivedEdm = edm.filter((m) => m.status === "archived");

  root.innerHTML = `
    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Guide to Motions & EDMs</h2>
      <p>Use <b>Open</b> to view the full motion/EDM page. House Motion divisions are handled on the open page. EDM signatures use weighted signatory logic and are also managed on the open page.</p>
    </section>

    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Submit Motion / EDM</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;">
        <form id="house-motion-form" class="tile">
          <h3 style="margin-top:0;">Raise House Motion</h3>
          <label class="label" for="house-motion-title">Title</label>
          <input id="house-motion-title" class="input" name="title" required>
          <label class="label" for="house-motion-body">Body text (after “That this House ...”)</label>
          <textarea id="house-motion-body" class="input" rows="5" name="body" required placeholder="calls on the Government to..."></textarea>
          <button class="btn" type="submit">Submit House Motion</button>
        </form>

        <form id="edm-form" class="tile">
          <h3 style="margin-top:0;">Raise Early Day Motion</h3>
          <label class="label" for="edm-title">Title</label>
          <input id="edm-title" class="input" name="title" required>
          <label class="label" for="edm-body">Body text (after “That this House ...”)</label>
          <textarea id="edm-body" class="input" rows="5" name="body" required placeholder="recognises and calls for..."></textarea>
          <button class="btn" type="submit">Submit EDM</button>
        </form>
      </div>
      <p class="muted" style="margin-top:8px;">Submitting as ${esc(char?.name || "MP")}.</p>
    </section>

    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Current House Motions</h2>
      ${openHouse.length ? openHouse.map((m) => `
        <article class="tile" style="margin-bottom:10px;">
          <div><b>Motion ${esc(m.number)}</b>: ${esc(m.title)} <span class="muted">by ${esc(m.author)}</span></div>
          <div class="muted" style="margin-top:6px;">Debate: ${esc(m.debateStartSim || "—")} → ${esc(m.debateEndSim || "—")}${m.debateEndSimObj ? ` (${countdownToSimMonth(m.debateEndSimObj.month, m.debateEndSimObj.year, data.gameState)})` : ""}</div>
          <div class="tile-bottom"><a class="btn" href="motion.html?kind=house&id=${encodeURIComponent(m.id)}">Open</a></div>
        </article>`).join("") : `<p class="muted">No current house motions.</p>`}
    </section>

    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Current EDMs</h2>
      ${openEdm.length ? openEdm.map((m) => `
        <article class="tile" style="margin-bottom:10px;">
          <div><b>EDM ${esc(m.number)}</b>: ${esc(m.title)} <span class="muted">by ${esc(m.author)}</span></div>
          <div class="muted" style="margin-top:6px;">Open: ${esc(m.openedAtSim || "—")} → ${esc(m.closesAtSim || "—")}${m.closesAtSimObj ? ` (${countdownToSimMonth(m.closesAtSimObj.month, m.closesAtSimObj.year, data.gameState)})` : ""}</div>
          <div class="tile-bottom"><a class="btn" href="motion.html?kind=edm&id=${encodeURIComponent(m.id)}">Open</a></div>
        </article>`).join("") : `<p class="muted">No current EDMs.</p>`}
    </section>

    <section class="tile" style="margin-top:20px;">
      <h2 style="margin-top:0;">Archive</h2>
      <h3>House Motions</h3>
      ${archivedHouse.length ? archivedHouse.map((m) => `<div style="margin-bottom:8px;"><b>Motion ${esc(m.number)}</b>: ${esc(m.title)} <a class="btn" href="motion.html?kind=house&id=${encodeURIComponent(m.id)}">Open</a></div>`).join("") : `<p class="muted">No archived house motions.</p>`}
      <h3>EDMs</h3>
      ${archivedEdm.length ? archivedEdm.map((m) => `<div style="margin-bottom:8px;"><b>EDM ${esc(m.number)}</b>: ${esc(m.title)} <a class="btn" href="motion.html?kind=edm&id=${encodeURIComponent(m.id)}">Open</a></div>`).join("") : `<p class="muted">No archived EDMs.</p>`}
    </section>
  `;

  root.querySelector("#house-motion-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const title = String(fd.get("title") || "").trim();
    const body = String(fd.get("body") || "").trim();
    if (!title || !body) return;

    const number = Number(data.motions.nextHouseNumber || (data.motions.house.length + 1));
    const debateEndObj = plusSimMonths(sim.month, sim.year, 2);
    const divisionEndObj = plusSimMonths(debateEndObj.month, debateEndObj.year, 1);
    const id = `motion-${Date.now()}`;

    data.motions.house.push({
      id,
      number,
      title,
      author: char?.name || "MP",
      body,
      status: "open",
      debateStartSim: sim.label,
      debateEndSim: formatSimDate(debateEndObj),
      debateEndSimObj: debateEndObj,
      debateUrl: discussionUrl("motion", number, title),
      division: { status: "open", startSim: formatSimDate(debateEndObj), endSim: formatSimDate(divisionEndObj), endSimObj: divisionEndObj, votes: {}, rebelsByParty: {}, npcVotes: {} }
    });
    data.motions.nextHouseNumber = number + 1;
    saveData(data);
    window.location.href = `motion.html?kind=house&id=${encodeURIComponent(id)}`;
  });

  root.querySelector("#edm-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const title = String(fd.get("title") || "").trim();
    const body = String(fd.get("body") || "").trim();
    if (!title || !body) return;

    const number = Number(data.motions.nextEdmNumber || (data.motions.edm.length + 1));
    const closesAtObj = plusSimMonths(sim.month, sim.year, 2);
    const id = `edm-${Date.now()}`;

    data.motions.edm.push({
      id,
      number,
      title,
      author: char?.name || "MP",
      body,
      status: "open",
      openedAtSim: sim.label,
      closesAtSim: formatSimDate(closesAtObj),
      closesAtSimObj: closesAtObj,
      signatures: [],
      npcSignatures: {}
    });
    data.motions.nextEdmNumber = number + 1;
    saveData(data);
    window.location.href = `motion.html?kind=edm&id=${encodeURIComponent(id)}`;
  });
}

export { bodyWithPreamble, ensureMotions, isGovernmentMember };
