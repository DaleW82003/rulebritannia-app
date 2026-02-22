import { saveState } from "../core.js";
import { esc } from "../ui.js";
import { isSpeaker } from "../permissions.js";
import { tileSection, tileCard } from "../components/tile.js";
import { toastSuccess } from "../components/toast.js";
import { getSimDate, simDateToObj, plusSimMonths, formatSimDate,
         formatSimMonthYear, isDeadlinePassed, compareSimDates,
         countdownToSimMonth } from "../clock.js";
import { apiCreateDebateTopic } from "../api.js";
import { handleApiError } from "../errors.js";

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
    ${tileSection({
      title: "Guide to Motions & EDMs",
      body: `<p>Use <b>Open</b> to view the full motion/EDM page. House Motion divisions are handled on the open page. EDM signatures use weighted signatory logic and are also managed on the open page.</p>`
    })}

    ${tileSection({
      title: "Submit Motion / EDM",
      body: `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;">
          <form id="house-motion-form" class="tile">
            <h3 class="tile-title">Raise House Motion</h3>
            <div class="form-row">
              <label for="house-motion-title">Title</label>
              <input id="house-motion-title" name="title" required>
            </div>
            <div class="form-row">
              <label for="house-motion-body">Body text (after "That this House ...")</label>
              <textarea id="house-motion-body" rows="5" name="body" required placeholder="calls on the Government to..."></textarea>
            </div>
            <button class="btn primary" type="submit">Submit House Motion</button>
          </form>

          <form id="edm-form" class="tile">
            <h3 class="tile-title">Raise Early Day Motion</h3>
            <div class="form-row">
              <label for="edm-title">Title</label>
              <input id="edm-title" name="title" required>
            </div>
            <div class="form-row">
              <label for="edm-body">Body text (after "That this House ...")</label>
              <textarea id="edm-body" rows="5" name="body" required placeholder="recognises and calls for..."></textarea>
            </div>
            <button class="btn primary" type="submit">Submit EDM</button>
          </form>
        </div>
        <p class="muted" style="margin-top:8px;">Submitting as ${esc(char?.name || "MP")}.</p>
      `
    })}

    ${tileSection({
      title: "Current House Motions",
      body: openHouse.length ? openHouse.map((m) => tileCard({
        extraClass: "tile-stack",
        body: `
          <div><b>Motion ${esc(m.number)}</b>: ${esc(m.title)} <span class="muted">by ${esc(m.author)}</span></div>
          <div class="muted" style="margin-top:6px;">Debate: ${esc(m.debateStartSim || "—")} → ${esc(m.debateEndSim || "—")}${m.debateEndSimObj ? ` (${countdownToSimMonth(m.debateEndSimObj.month, m.debateEndSimObj.year, data.gameState)})` : ""}</div>
        `,
        actions: `
          <a class="btn" href="motion.html?kind=house&id=${encodeURIComponent(m.id)}">Open</a>
          ${m.debateUrl ? `<a class="btn" href="${esc(m.debateUrl)}" target="_blank" rel="noopener">Debate</a>` : ""}
        `
      })).join("") : `<p class="muted">No current house motions.</p>`
    })}

    ${tileSection({
      title: "Current EDMs",
      body: openEdm.length ? openEdm.map((m) => tileCard({
        extraClass: "tile-stack",
        body: `
          <div><b>EDM ${esc(m.number)}</b>: ${esc(m.title)} <span class="muted">by ${esc(m.author)}</span></div>
          <div class="muted" style="margin-top:6px;">Open: ${esc(m.openedAtSim || "—")} → ${esc(m.closesAtSim || "—")}${m.closesAtSimObj ? ` (${countdownToSimMonth(m.closesAtSimObj.month, m.closesAtSimObj.year, data.gameState)})` : ""}</div>
        `,
        actions: `
          <a class="btn" href="motion.html?kind=edm&id=${encodeURIComponent(m.id)}">Open</a>
          ${m.debateUrl ? `<a class="btn" href="${esc(m.debateUrl)}" target="_blank" rel="noopener">Debate</a>` : ""}
        `
      })).join("") : `<p class="muted">No current EDMs.</p>`
    })}

    ${tileSection({
      title: "Archive",
      body: `
        <h3>House Motions</h3>
        ${archivedHouse.length ? archivedHouse.map((m) => `<div style="margin-bottom:8px;"><b>Motion ${esc(m.number)}</b>: ${esc(m.title)} <a class="btn" href="motion.html?kind=house&id=${encodeURIComponent(m.id)}">Open</a></div>`).join("") : `<p class="muted">No archived house motions.</p>`}
        <h3>EDMs</h3>
        ${archivedEdm.length ? archivedEdm.map((m) => `<div style="margin-bottom:8px;"><b>EDM ${esc(m.number)}</b>: ${esc(m.title)} <a class="btn" href="motion.html?kind=edm&id=${encodeURIComponent(m.id)}">Open</a></div>`).join("") : `<p class="muted">No archived EDMs.</p>`}
      `
    })}
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

    const motion = {
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
    };
    data.motions.house.push(motion);
    data.motions.nextHouseNumber = number + 1;
    saveState(data);
    apiCreateDebateTopic({
      entityType: "motion", entityId: id,
      title: `Motion ${number}: ${title}`,
      raw: `**That this House** ${body}\n\n*Submitted by ${motion.author}.*`
    }).then(({ topicId, topicUrl }) => {
      motion.debateUrl = topicUrl;
      motion.discourseTopicId = topicId;
      saveState(data);
    }).catch((err) => handleApiError(err, "Debate topic"));
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

    const edm = {
      id,
      number,
      title,
      author: char?.name || "MP",
      body,
      status: "open",
      openedAtSim: sim.label,
      closesAtSim: formatSimDate(closesAtObj),
      closesAtSimObj: closesAtObj,
      debateUrl: discussionUrl("edm", number, title),
      signatures: [],
      npcSignatures: {}
    };
    data.motions.edm.push(edm);
    data.motions.nextEdmNumber = number + 1;
    saveState(data);
    apiCreateDebateTopic({
      entityType: "motion", entityId: id,
      title: `EDM ${number}: ${title}`,
      raw: `**That this House** ${body}\n\n*Submitted by ${edm.author}.*`
    }).then(({ topicId, topicUrl }) => {
      edm.debateUrl = topicUrl;
      edm.discourseTopicId = topicId;
      saveState(data);
    }).catch((err) => handleApiError(err, "Debate topic"));
    window.location.href = `motion.html?kind=edm&id=${encodeURIComponent(id)}`;
  });
}

export { bodyWithPreamble, ensureMotions, isGovernmentMember };
