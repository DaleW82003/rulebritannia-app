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

// ── Scandal templates (mod may use these as starting points) ─────────────────
const SCANDAL_TEMPLATES = [
  {
    id: "tpl-planning",
    title: "Planning Permission Controversy",
    stages: [
      { id: "s1", title: "Allegation Surfaces", text: "A local newspaper claims you may have improperly influenced a planning decision in your constituency. The story is gathering momentum.", options: [
        { id: "a", label: "Deny everything publicly", nextStageIdx: 1 },
        { id: "b", label: "Offer a measured response and await investigation", nextStageIdx: 2 }
      ]},
      { id: "s2", title: "Fallout — Denial Backfires", text: "Your denial is contradicted by documents obtained by the newspaper. Scrutiny intensifies.", options: [
        { id: "a", label: "Refer matter to your solicitor", nextStageIdx: 3 }
      ]},
      { id: "s3", title: "Measured Response — Story Dies Down", text: "Your thoughtful statement buys time. The investigation finds insufficient evidence to continue.", options: [
        { id: "a", label: "Resume normal activities", nextStageIdx: null }
      ]},
      { id: "s4", title: "Legal Action Threatened", text: "The newspaper stands its ground. Legal costs begin to mount and the story dominates local media.", options: [
        { id: "a", label: "Settle privately", nextStageIdx: null }
      ]}
    ]
  },
  {
    id: "tpl-expenses",
    title: "Expenses Irregularity",
    stages: [
      { id: "s1", title: "Leak Emerges", text: "A whistleblower has reportedly passed information about your expenses claims to a national paper. Your party whip has been in touch.", options: [
        { id: "a", label: "Proactively publish all expenses", nextStageIdx: 1 },
        { id: "b", label: "Stay silent and hope it passes", nextStageIdx: 2 }
      ]},
      { id: "s2", title: "Transparency Applauded", text: "Publishing your expenses pre-empts the story. The paper runs a positive piece on your openness.", options: [
        { id: "a", label: "Continue as normal", nextStageIdx: null }
      ]},
      { id: "s3", title: "Story Published — Crisis Deepens", text: "The paper runs the story. The whip demands a meeting.", options: [
        { id: "a", label: "Meet the whip and offer to repay any disputed claims", nextStageIdx: null }
      ]}
    ]
  }
];

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

function nowStamp() {
  return new Date().toLocaleString("en-GB", { hour12: false });
}

// ── Normalisation ─────────────────────────────────────────────────────────────

function ensureWork(data) {
  data.constituencyWork ??= { plansByCharacter: {} };
  data.constituencyWork.plansByCharacter ??= {};
  data.constituencyWork.scandals ??= [];
  data.constituencyWork.nextScandalId ??= 1;

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
      scandalOptIn: false,
      lastSavedSimIndex: null,
      updatedAt: null
    };
  }

  const plan = data.constituencyWork.plansByCharacter[key];
  plan.scandalOptIn = !!plan.scandalOptIn;

  for (const s of data.constituencyWork.scandals) {
    s.id = Number(s.id || 0);
    s.characterKey = String(s.characterKey || "");
    s.title = String(s.title || "").trim();
    s.status = s.status === "closed" ? "closed" : "open";
    s.currentStageIdx = s.status === "closed" ? null : Number(s.currentStageIdx ?? 0);
    s.createdAt = String(s.createdAt || nowStamp());
    s.createdBy = String(s.createdBy || "Moderator");
    s.reputationImpact = Number(s.reputationImpact || 0);
    s.auditLog = Array.isArray(s.auditLog) ? s.auditLog : [];
    s.stages = Array.isArray(s.stages) ? s.stages : [];
    for (const stage of s.stages) {
      stage.id = String(stage.id || "");
      stage.title = String(stage.title || "").trim();
      stage.text = String(stage.text || "").trim();
      stage.options = Array.isArray(stage.options) ? stage.options : [];
      for (const o of stage.options) {
        o.id = String(o.id || "");
        o.label = String(o.label || "").trim();
        o.nextStageIdx = o.nextStageIdx != null ? Number(o.nextStageIdx) : null;
        o.reputationDelta = Number(o.reputationDelta || 0);
      }
    }
    for (const entry of s.auditLog) {
      entry.stageTitle = String(entry.stageTitle || "");
      entry.chosenOptionLabel = String(entry.chosenOptionLabel || "");
      entry.reputationDelta = Number(entry.reputationDelta || 0);
      entry.actorName = String(entry.actorName || "Unknown");
      entry.at = String(entry.at || "");
    }
  }

  return key;
}

function totalHours(hours) {
  return TASKS.reduce((sum, t) => sum + Number(hours?.[t] || 0), 0);
}

// ── Scandal card renderer ────────────────────────────────────────────────────

function renderScandalCard(data, scandal, state) {
  const open = state.openScandalId === scandal.id;
  const mod = canModerate(data);
  const char = getCharacter(data);
  const charKey = char?.name || "default";
  const isOwn = scandal.characterKey === charKey;
  const canAct = isOwn && scandal.status === "open";

  const stage = (scandal.stages.length > 0 && scandal.currentStageIdx != null)
    ? scandal.stages[scandal.currentStageIdx] || null
    : null;

  return `
    <article class="tile" style="margin-top:10px;">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap;">
        <div>
          <b>Scandal #${scandal.id}: ${esc(scandal.title)}</b>
          <div class="muted">For: ${esc(scandal.characterKey)} • ${scandal.status === "open" ? "🔴 Active" : "✅ Resolved"}</div>
          <div class="muted">Reputation impact so far: ${scandal.reputationImpact > 0 ? `+${scandal.reputationImpact}` : scandal.reputationImpact}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${mod && scandal.status === "open" ? `<button type="button" class="btn" data-action="close-scandal" data-id="${scandal.id}">Close Scandal</button>` : ""}
          <button type="button" class="btn" data-action="toggle-scandal" data-id="${scandal.id}">${open ? "Collapse" : "View"}</button>
        </div>
      </div>

      ${open ? `
        <div style="margin-top:10px;">
          ${stage ? `
            <div class="tile" style="background:var(--color-bg,#f8f8f8);margin-bottom:8px;">
              <h3 style="margin:0 0 4px;">${esc(stage.title)}</h3>
              <p style="white-space:pre-wrap;margin:0 0 8px;">${esc(stage.text)}</p>
              ${canAct && stage.options.length ? `
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                  ${stage.options.map((opt) => `
                    <button type="button" class="btn" data-action="choose-scandal-option"
                      data-scandal-id="${scandal.id}" data-stage-idx="${scandal.currentStageIdx}"
                      data-opt-id="${esc(opt.id)}" data-opt-label="${esc(opt.label)}"
                      data-reputation-delta="${opt.reputationDelta}"
                      data-next-stage-idx="${opt.nextStageIdx != null ? opt.nextStageIdx : ""}">
                      ${esc(opt.label)}
                    </button>
                  `).join("")}
                </div>
              ` : (!canAct && scandal.status === "open" ? '<div class="muted">Awaiting your response.</div>' : "")}
            </div>
          ` : `<div class="muted-block">No active stage — scandal ${scandal.status === "closed" ? "resolved" : "has no stages configured"}.</div>`}

          ${scandal.auditLog.length ? `
            <details style="margin-top:8px;">
              <summary class="muted" style="cursor:pointer;">Decision log (${scandal.auditLog.length})</summary>
              ${scandal.auditLog.map((entry) => `
                <div class="muted" style="margin-top:4px;font-size:.9em;">
                  <b>${esc(entry.actorName)}</b> chose "<em>${esc(entry.chosenOptionLabel)}</em>" on "${esc(entry.stageTitle)}"
                  (reputation: ${entry.reputationDelta >= 0 ? `+${entry.reputationDelta}` : entry.reputationDelta}) at ${esc(entry.at)}
                </div>
              `).join("")}
            </details>
          ` : ""}
        </div>
      ` : ""}
    </article>
  `;
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

  // Scandals visible to this user.
  const myScandals = mod
    ? data.constituencyWork.scandals
    : data.constituencyWork.scandals.filter((s) => s.characterKey === key);

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

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Local Scandal Opt-In</h2>
      <p class="muted">Opt in to allow moderators to trigger local constituency scandals for your character. Scandals progress through stages and affect your reputation and optics.</p>
      <div style="display:flex;gap:10px;align-items:center;">
        <label class="label" style="margin:0;" for="cw-scandal-optin">
          <input id="cw-scandal-optin" type="checkbox" ${plan.scandalOptIn ? "checked" : ""}> Opted in to local scandals
        </label>
        <button type="button" class="btn" id="cw-save-optin">Save Preference</button>
      </div>
    </section>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Local Scandals</h2>
      ${myScandals.length
        ? myScandals.sort((a, b) => b.id - a.id).map((s) => renderScandalCard(data, s, state)).join("")
        : '<div class="muted-block">No active local scandals.</div>'}
    </section>

    ${mod ? `
      <section class="panel" style="margin-bottom:12px;">
        <h2 style="margin-top:0;">Moderator: Trigger Scandal</h2>
        <p class="muted">Trigger a scandal scenario for a character who has opted in. You may customise the title and use a template for the stages.</p>
        <form id="cw-mod-scandal-form">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-bottom:8px;">
            <div>
              <label class="label" for="sc-char-key">Character Key (name)</label>
              <input id="sc-char-key" class="input" name="characterKey" required placeholder="Character name">
            </div>
            <div>
              <label class="label" for="sc-template">Use Template</label>
              <select id="sc-template" class="input" name="templateId">
                <option value="">— custom (no template) —</option>
                ${SCANDAL_TEMPLATES.map((t) => `<option value="${esc(t.id)}">${esc(t.title)}</option>`).join("")}
              </select>
            </div>
          </div>
          <label class="label" for="sc-title">Scandal Title (overrides template title if set)</label>
          <input id="sc-title" class="input" name="title" placeholder="e.g. Planning Permission Row">
          <button type="submit" class="btn">Trigger Scandal</button>
        </form>
      </section>

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

  root.querySelector("#cw-save-optin")?.addEventListener("click", () => {
    const checkbox = root.querySelector("#cw-scandal-optin");
    plan.scandalOptIn = !!checkbox?.checked;
    saveState(data);
    render(data, state);
  });

  // Scandal stage option choices
  root.querySelectorAll('[data-action="choose-scandal-option"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const scandalId = Number(btn.dataset.scandalId || 0);
      const stageIdx = Number(btn.dataset.stageIdx || 0);
      const optLabel = String(btn.dataset.optLabel || "");
      const reputationDelta = Number(btn.dataset.reputationDelta || 0);
      const nextRaw = btn.dataset.nextStageIdx;
      const nextStageIdx = nextRaw !== "" && nextRaw != null ? Number(nextRaw) : null;

      const scandal = data.constituencyWork.scandals.find((s) => s.id === scandalId);
      if (!scandal || scandal.status === "closed") return;
      if (scandal.characterKey !== key) return;
      if (scandal.currentStageIdx !== stageIdx) return;

      const stage = scandal.stages[stageIdx];
      scandal.auditLog.push({
        stageTitle: stage?.title || String(stageIdx),
        chosenOptionLabel: optLabel,
        reputationDelta,
        actorName: String(char?.name || "Unknown"),
        at: nowStamp()
      });
      scandal.reputationImpact += reputationDelta;

      if (nextStageIdx != null && nextStageIdx < scandal.stages.length) {
        scandal.currentStageIdx = nextStageIdx;
      } else {
        scandal.status = "closed";
        scandal.currentStageIdx = null;
      }

      saveState(data);
      render(data, state);
    });
  });

  root.querySelectorAll('[data-action="toggle-scandal"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.id || 0);
      state.openScandalId = state.openScandalId === id ? null : id;
      render(data, state);
    });
  });

  // Mod: close scandal
  root.querySelectorAll('[data-action="close-scandal"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!mod) return;
      const id = Number(btn.dataset.id || 0);
      const scandal = data.constituencyWork.scandals.find((s) => s.id === id);
      if (!scandal || scandal.status === "closed") return;
      scandal.status = "closed";
      scandal.currentStageIdx = null;
      saveState(data);
      render(data, state);
    });
  });

  // Mod: trigger scandal
  root.querySelector("#cw-mod-scandal-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!mod) return;
    const fd = new FormData(e.currentTarget);
    const characterKey = String(fd.get("characterKey") || "").trim();
    const templateId = String(fd.get("templateId") || "").trim();
    const customTitle = String(fd.get("title") || "").trim();

    if (!characterKey) return;

    // Check character has opted in.
    const charPlan = data.constituencyWork.plansByCharacter[characterKey];
    if (!charPlan?.scandalOptIn) {
      alert(`"${characterKey}" has not opted in to local scandals.`);
      return;
    }

    const template = SCANDAL_TEMPLATES.find((t) => t.id === templateId);
    const title = customTitle || template?.title || "Local Scandal";
    const stages = template ? JSON.parse(JSON.stringify(template.stages)) : [];

    const scandal = {
      id: data.constituencyWork.nextScandalId++,
      characterKey,
      title,
      status: "open",
      currentStageIdx: stages.length ? 0 : null,
      createdAt: nowStamp(),
      createdBy: String(char?.name || data?.currentUser?.username || "Moderator"),
      reputationImpact: 0,
      auditLog: [],
      stages
    };
    data.constituencyWork.scandals.unshift(scandal);
    saveState(data);
    state.openScandalId = scandal.id;
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
