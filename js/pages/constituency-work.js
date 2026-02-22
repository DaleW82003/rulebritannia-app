import { saveState } from "../core.js";
import { esc } from "../ui.js";
import { isAdmin, isMod, canAdminOrMod } from "../permissions.js";

const TASKS = [
  "Meeting Local Businesses",
  "Meeting Community Groups",
  "Attending Local Events",
  "Visiting Local Schools, Hospitals & Job Centres",
  "Holding Surgeries",
  "Answer Mail and Emails",
  "Spend Time at Local Office",
  "Do Second Job"
];

const LOCK_MONTHS = 6;

function canModerate(data) {
  return canAdminOrMod(data);
}

function getCharacter(data) {
  return data?.currentCharacter || data?.currentPlayer || {};
}

function getSimIndex(data) {
  const gs = data?.gameState || {};
  const y = Number(gs.startSimYear || 1997);
  const m = Number(gs.startSimMonth || 8);
  return (y * 12) + (m - 1);
}

function simLabel(index) {
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const m = ((index % 12) + 12) % 12;
  const y = Math.floor(index / 12);
  return `${names[m]} ${y}`;
}

function ensureWork(data) {
  data.constituencyWork ??= { plansByCharacter: {} };
  data.constituencyWork.plansByCharacter ??= {};

  const char = getCharacter(data);
  const key = char?.name || "default";
  if (!data.constituencyWork.plansByCharacter[key]) {
    data.constituencyWork.plansByCharacter[key] = {
      constituency: char?.constituency || "Your constituency",
      hours: {
        "Meeting Local Businesses": 6,
        "Meeting Community Groups": 6,
        "Attending Local Events": 4,
        "Visiting Local Schools, Hospitals & Job Centres": 6,
        "Holding Surgeries": 8,
        "Answer Mail and Emails": 6,
        "Spend Time at Local Office": 4,
        "Do Second Job": 0
      },
      secondJobTitleCompany: "",
      lastSavedSimIndex: null,
      updatedAt: null
    };
  }

  return key;
}

function totalHours(hours) {
  return TASKS.reduce((sum, t) => sum + Number(hours?.[t] || 0), 0);
}

function render(data, state = {}) {
  const root = document.getElementById("constituency-work-root");
  if (!root) return;

  const key = ensureWork(data);
  const plan = data.constituencyWork.plansByCharacter[key];
  const char = getCharacter(data);
  const simIndex = getSimIndex(data);
  const mod = canModerate(data);

  const lastSaved = Number(plan.lastSavedSimIndex);
  const locked = Number.isFinite(lastSaved) && (simIndex - lastSaved) < LOCK_MONTHS;
  const unlockIndex = Number.isFinite(lastSaved) ? lastSaved + LOCK_MONTHS : simIndex;
  const weeklyTotal = totalHours(plan.hours);

  root.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Constituency Work</div></div>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Phase 1 Note</h2>
      <p>This page is local flavour in Phase 1. Future development will expand outcomes and constituency systems.</p>
    </section>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Your Working Week (${esc(char?.name || "MP")})</h2>
      <div><b>Constituency:</b> ${esc(plan.constituency || char?.constituency || "Your constituency")}</div>
      <div><b>Total allocated:</b> ${esc(String(weeklyTotal))} / 40 hours</div>
      <div class="muted">You can change this schedule once every 6 simulation months (3 weeks). ${locked ? `Next unlock: <b>${esc(simLabel(unlockIndex))}</b>.` : "Unlocked now."}</div>

      <form id="cw-form" style="margin-top:10px;">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px;">
          ${TASKS.map((task) => `
            <div>
              <label class="label" for="cw-${esc(task).replace(/[^a-zA-Z0-9]/g, "-")}">${esc(task)} (hours)</label>
              <input id="cw-${esc(task).replace(/[^a-zA-Z0-9]/g, "-")}" name="${esc(task)}" type="number" min="0" max="40" class="input" value="${esc(String(Number(plan.hours?.[task] || 0)))}" ${locked ? "disabled" : ""}>
            </div>
          `).join("")}
        </div>

        <label class="label" for="cw-second-job-meta">Second Job — Job Title & Company</label>
        <input id="cw-second-job-meta" name="secondJobTitleCompany" class="input" value="${esc(plan.secondJobTitleCompany || "")}" placeholder="Director, Weston Consulting Ltd" ${locked ? "disabled" : ""}>

        <button type="submit" class="btn" ${locked ? "disabled" : ""}>Save Working Week</button>
      </form>
    </section>

    ${mod ? `
      <section class="panel">
        <h2 style="margin-top:0;">Moderator Check Panel</h2>
        <p class="muted">Mods/admins can review and amend/remove second jobs and schedule entries if required.</p>
        <form id="cw-mod-form">
          <label class="label" for="cw-mod-second-job">Second Job — Job Title & Company</label>
          <input id="cw-mod-second-job" name="secondJobTitleCompany" class="input" value="${esc(plan.secondJobTitleCompany || "")}">
          <button type="submit" class="btn">Save Moderator Changes</button>
          <button type="button" class="btn" id="cw-mod-clear-second-job">Remove Second Job</button>
        </form>
      </section>
    ` : ""}
  `;

  root.querySelector("#cw-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (locked) return;

    const fd = new FormData(e.currentTarget);
    const nextHours = {};
    TASKS.forEach((task) => {
      nextHours[task] = Math.max(0, Number(fd.get(task) || 0));
    });

    const sum = totalHours(nextHours);
    if (sum > 40) {
      state.error = "You cannot allocate more than 40 hours.";
      alert(state.error);
      return;
    }

    plan.hours = nextHours;
    plan.secondJobTitleCompany = String(fd.get("secondJobTitleCompany") || "").trim();
    plan.lastSavedSimIndex = simIndex;
    plan.updatedAt = new Date().toLocaleString("en-GB");

    saveState(data);
    render(data, state);
  });

  root.querySelector("#cw-mod-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!mod) return;
    const fd = new FormData(e.currentTarget);
    plan.secondJobTitleCompany = String(fd.get("secondJobTitleCompany") || "").trim();
    saveState(data);
    render(data, state);
  });

  root.querySelector("#cw-mod-clear-second-job")?.addEventListener("click", () => {
    if (!mod) return;
    plan.secondJobTitleCompany = "";
    plan.hours["Do Second Job"] = 0;
    saveState(data);
    render(data, state);
  });
}

export function initConstituencyWorkPage(data) {
  ensureWork(data);
  render(data, {});
}
