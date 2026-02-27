import { esc } from "../ui.js";
import { isAdmin, isMod, canAdminOrMod } from "../permissions.js";
import { handleApiError } from "../errors.js";
import { getCharacterContext } from "../engines/core-engine.js";
import {
  apiScandalsMine,
  apiScandalsOptIn,
  apiScandalSituationRespond,
  apiScandalChoose,
  apiModScandalSituationCreate,
  apiModScandalsOpen,
  apiModScandalDecision,
  apiModScandalClose,
  apiModScandalTemplates,
  apiModScandalOptedInCharacters,
  apiGetMyWorkPlan,
  apiSaveMyWorkPlan,
} from "../api.js";

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

// ── Normalisation ─────────────────────────────────────────────────────────────

function ensureWork(data) {
  data.constituencyWork ??= { plansByCharacter: {} };
  data.constituencyWork.plansByCharacter ??= {};

  const char = getCharacterContext(data);
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

// ── Scandal helpers ──────────────────────────────────────────────────────────

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function simMonthLabel(year, month) {
  return `${MONTH_NAMES[(month - 1) % 12]} ${year}`;
}

function stageBadge(status) {
  if (status === "awaiting_mod") return "🟡 Awaiting moderator decision";
  if (status === "closed") return "✅ Resolved";
  return "🔴 Active";
}

// ── Scandal card renderers ────────────────────────────────────────────────────

function renderSituationCard(sit, mod) {
  const title = sit.title_override || sit.title;
  return `
    <article class="tile" style="margin-top:10px;border-left:4px solid #e07b00;">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;flex-wrap:wrap;">
        <div>
          <b>⚠️ Sensitive Situation: ${esc(title)}</b>
          <div class="muted">${esc(sit.category)} • Expires ${esc(simMonthLabel(sit.expires_sim_year, sit.expires_sim_month))}</div>
        </div>
      </div>
      <p style="margin:8px 0 4px;font-size:.95em;">${esc(sit.stages?.[0]?.text || "A sensitive situation has emerged. How will you respond?")}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
        <button type="button" class="btn" data-action="situation-respond" data-id="${esc(sit.id)}" data-response="investigate">Investigate</button>
        <button type="button" class="btn" data-action="situation-respond" data-id="${esc(sit.id)}" data-response="report_party">Report to Party</button>
        <button type="button" class="btn" data-action="situation-respond" data-id="${esc(sit.id)}" data-response="ignore" style="opacity:.7;">Ignore</button>
      </div>
    </article>
  `;
}

function renderScandalCard(scandal, playerChoices, state) {
  const open = state.openScandalId === scandal.id;
  const myChoices = (playerChoices || []).filter((c) => c.scandal_id === scandal.id);
  const isAwaiting = scandal.status === "awaiting_mod";
  const isClosed = scandal.status === "closed";
  const canAct = !isClosed && !isAwaiting;

  // Find current stage choices from template stages (not stored on scandal row itself)
  // The template stages are returned in the situations/scandals query — but for active scandals
  // we get stage info via the player_choices history; choices are shown from the scandal row.
  // We'll look up choices from the passed-in template stages if available.
  const templateStages = Array.isArray(scandal.stages) ? scandal.stages : [];
  const currentStage = templateStages.find((s) => s.key === scandal.stage_key) || null;
  const choices = currentStage?.choices || [];

  return `
    <article class="tile" style="margin-top:10px;">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap;">
        <div>
          <b>${esc(scandal.title)}</b>
          <div class="muted">${stageBadge(scandal.status)} • Stage: <em>${esc(scandal.stage_key)}</em></div>
          <div class="muted">Severity: ${esc(String(scandal.severity_current))} • Deadline: ${esc(simMonthLabel(scandal.stage_deadline_sim_year, scandal.stage_deadline_sim_month))}</div>
        </div>
        <button type="button" class="btn" data-action="toggle-scandal" data-id="${esc(scandal.id)}">${open ? "Collapse" : "View"}</button>
      </div>

      ${open ? `
        <div style="margin-top:10px;">
          ${isAwaiting ? `<div class="tile" style="background:#fff7e0;border-left:3px solid #e07b00;margin-bottom:8px;padding:8px;">
            🟡 <b>Awaiting moderator decision.</b> Your choices have been recorded and the matter is now under review. No further action is required from you at this time.
          </div>` : ""}

          ${(scandal.public_notes || []).length ? `
            <div style="margin-bottom:8px;">
              ${scandal.public_notes.map((n) => `
                <div class="tile" style="background:#f0f8ff;border-left:3px solid #00529b;padding:8px;margin-bottom:4px;">
                  <b>📢 Party Statement</b> (${esc(simMonthLabel(n.at_sim_year, n.at_sim_month))}): ${esc(n.statement)}
                </div>
              `).join("")}
            </div>
          ` : ""}

          ${currentStage && canAct ? `
            <div class="tile" style="background:var(--color-bg,#f8f8f8);margin-bottom:8px;">
              <h3 style="margin:0 0 4px;">${esc(currentStage.title)}</h3>
              <p style="white-space:pre-wrap;margin:0 0 8px;">${esc(currentStage.text)}</p>
              ${choices.length ? `
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                  ${choices.map((c) => `
                    <button type="button" class="btn" data-action="choose-scandal"
                      data-scandal-id="${esc(scandal.id)}" data-choice-id="${esc(c.id)}">
                      ${esc(c.label)}
                    </button>
                  `).join("")}
                </div>
              ` : '<div class="muted">No choices available for this stage.</div>'}
            </div>
          ` : ""}

          ${myChoices.length ? `
            <details style="margin-top:8px;">
              <summary class="muted" style="cursor:pointer;">Your decision log (${myChoices.length})</summary>
              ${myChoices.map((entry) => `
                <div class="muted" style="margin-top:4px;font-size:.9em;">
                  Stage <em>${esc(entry.stage_key)}</em>: chose "<em>${esc(entry.choice_label)}</em>"
                  — ${esc(simMonthLabel(entry.created_sim_year, entry.created_sim_month))}
                </div>
              `).join("")}
            </details>
          ` : ""}
        </div>
      ` : ""}
    </article>
  `;
}

// ── Mod scandal panels ────────────────────────────────────────────────────────

function renderModScandalCreate(templates, optedInCharacters) {
  const tpls = templates || [];
  const tplOptions = tpls.map((t) =>
    `<option value="${esc(t.id)}">${esc(t.title)} (${esc(t.category)})</option>`
  ).join("");
  const chars = optedInCharacters || [];
  const charOptions = chars.map((c) =>
    `<option value="${esc(c.id)}">${esc(c.name)} (${esc(c.party)})</option>`
  ).join("");
  return `
    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Moderator: Create Sensitive Situation</h2>
      <p class="muted">Create a situation for a character who has opted in. They will see a 'Sensitive Situation Discovered' card and can Investigate, Report to Party, or Ignore.</p>
      ${!tpls.length ? `<div class="muted-block">No scandal templates available. Templates are seeded automatically at server startup — check server logs if this persists.</div>` : `
      <form id="cw-mod-situation-form">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-bottom:8px;">
          <div>
            <label class="label" for="sc-char-id">Character</label>
            ${chars.length
              ? `<select id="sc-char-id" class="input" name="character_id" required>
                  <option value="">— select character —</option>
                  ${charOptions}
                </select>`
              : `<p class="muted" style="font-size:.9em;margin:4px 0 6px;">No characters have opted in to scandals yet.</p>
                 <input id="sc-char-id" class="input" name="character_id" required placeholder="UUID of character">`}
          </div>
          <div>
            <label class="label" for="sc-template">Template</label>
            <select id="sc-template" class="input" name="template_id" required>
              <option value="">— select template —</option>
              ${tplOptions}
            </select>
          </div>
          <div>
            <label class="label" for="sc-title-override">Title Override (optional)</label>
            <input id="sc-title-override" class="input" name="title_override" placeholder="Leave blank to use template title">
          </div>
          <div>
            <label class="label" for="sc-expires">Expires in (months, optional)</label>
            <input id="sc-expires" class="input" name="expires_in_months" type="number" min="1" max="24" placeholder="Default: template value">
          </div>
        </div>
        <button type="submit" class="btn">Create Situation</button>
      </form>`}
    </section>
  `;
}

function renderModOpenScandals(modData, state) {
  const scandals = modData?.scandals || [];
  const choices  = modData?.player_choices || [];
  const decisions = modData?.mod_decisions || [];

  if (!scandals.length) {
    return `<section class="panel" style="margin-bottom:12px;"><h2 style="margin-top:0;">Moderator: Open Scandals</h2><div class="muted-block">No open scandals.</div></section>`;
  }

  const cards = scandals.map((s) => {
    const open = state.openModScandalId === s.id;
    const sc = choices.filter((c) => c.scandal_id === s.id);
    const sd = decisions.filter((d) => d.scandal_id === s.id);
    return `
      <article class="tile" style="margin-top:8px;">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap;">
          <div>
            <b>${esc(s.title)}</b> — <em>${esc(s.character_name || "Unknown")}</em>
            <div class="muted">${stageBadge(s.status)} • Stage: ${esc(s.stage_key)} • Severity: ${esc(String(s.severity_current))}</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button type="button" class="btn" data-action="mod-toggle-scandal" data-id="${esc(s.id)}">${open ? "Collapse" : "Manage"}</button>
          </div>
        </div>
        ${open ? `
          <div style="margin-top:10px;">
            ${sc.length ? `
              <details open>
                <summary class="muted" style="cursor:pointer;">Player choices (${sc.length})</summary>
                ${sc.map((c) => `
                  <div class="muted" style="font-size:.9em;margin-top:3px;">
                    Stage <em>${esc(c.stage_key)}</em>: "<em>${esc(c.choice_label)}</em>" — ${esc(simMonthLabel(c.created_sim_year, c.created_sim_month))}
                    ${Object.keys(c.flags_patch || {}).length ? `<span style="color:#555;"> [${esc(Object.keys(c.flags_patch).join(", "))}]</span>` : ""}
                  </div>
                `).join("")}
              </details>
            ` : '<div class="muted">No player choices yet.</div>'}
            ${sd.length ? `
              <details style="margin-top:6px;">
                <summary class="muted" style="cursor:pointer;">Mod decisions (${sd.length})</summary>
                ${sd.map((d) => `
                  <div class="muted" style="font-size:.9em;margin-top:3px;">
                    <b>${esc(d.decision_type)}</b> (Δ${d.severity_delta >= 0 ? "+" : ""}${esc(String(d.severity_delta))})
                    ${d.next_stage_key ? `→ ${esc(d.next_stage_key)}` : ""}
                    ${d.public_statement ? `<br>📢 ${esc(d.public_statement)}` : ""}
                    ${d.internal_notes ? `<br>🔒 Internal: ${esc(d.internal_notes)}` : ""}
                    — ${esc(simMonthLabel(d.created_sim_year, d.created_sim_month))}
                  </div>
                `).join("")}
              </details>
            ` : ""}
            <form class="mod-decision-form" data-scandal-id="${esc(s.id)}" style="margin-top:10px;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;">
              <div>
                <label class="label">Decision Type</label>
                <select class="input" name="decision_type" required>
                  <option value="severity_update">Severity Update</option>
                  <option value="advance_stage">Advance Stage</option>
                  <option value="public_statement">Public Statement</option>
                  <option value="close">Close Scandal</option>
                  <option value="escalate">Escalate</option>
                </select>
              </div>
              <div>
                <label class="label">Next Stage Key (optional)</label>
                <input class="input" name="next_stage_key" placeholder="e.g. resolution">
              </div>
              <div>
                <label class="label">Severity Delta</label>
                <input class="input" name="severity_delta" type="number" value="0">
              </div>
              <div>
                <label class="label">Public Statement (optional)</label>
                <input class="input" name="public_statement" placeholder="Shown to player">
              </div>
              <div>
                <label class="label">Internal Notes (mod only)</label>
                <input class="input" name="internal_notes" placeholder="Hidden from player">
              </div>
              <div style="display:flex;align-items:flex-end;gap:6px;">
                <button type="submit" class="btn">Apply Decision</button>
                <button type="button" class="btn" data-action="mod-close-scandal" data-id="${esc(s.id)}" style="background:#c00;color:#fff;">Close Scandal</button>
              </div>
            </form>
          </div>
        ` : ""}
      </article>
    `;
  });

  return `
    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Moderator: Open Scandals</h2>
      ${cards.join("")}
    </section>
  `;
}

// ── Scandal section renderer (uses API data) ──────────────────────────────────

function renderScandalSection(scandalData, modData, templates, mod, hasActiveChar, state) {
  const sd = scandalData || { opted_in: false, situations: [], scandals: [], player_choices: [] };

  // Enrich scandal rows with template stages for choice rendering
  const enriched = (sd.scandals || []).map((s) => {
    const tpl = (templates || []).find((t) => t.id === s.template_id);
    return { ...s, stages: tpl?.stages || [] };
  });

  const openScandals = enriched.filter((s) => s.status !== "closed");
  const closedScandals = enriched.filter((s) => s.status === "closed");

  return `
    <section class="panel" style="margin-bottom:12px;" id="scandal-optin-section">
      <h2 style="margin-top:0;">Local Scandal Opt-In</h2>
      <p class="muted">Opt in to allow moderators to trigger local constituency scandals for your character. Scandals progress through stages and affect your reputation and optics.</p>
      ${!hasActiveChar
        ? `<div class="muted-block">You must have an active character to manage local scandal opt-in. <a href="user.html">Create or activate a character</a> first.</div>`
        : `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <label class="label" style="margin:0;" for="cw-scandal-optin">
          <input id="cw-scandal-optin" type="checkbox" ${sd.opted_in ? "checked" : ""}> Opted in to local scandals
        </label>
        <button type="button" class="btn" id="cw-save-optin">Save Preference</button>
        ${state.optinSaved === true ? `<span class="muted" style="color:green;">Saved ✓</span>` : state.optinSaved === false ? `<span class="muted" style="color:var(--danger);">Failed to save</span>` : ""}
      </div>`}
    </section>

    ${sd.situations.length ? `
      <section class="panel" style="margin-bottom:12px;" id="scandal-situations-section">
        <h2 style="margin-top:0;">⚠️ Sensitive Situations</h2>
        <p class="muted">The following situations have come to your attention. Choose how to respond.</p>
        ${sd.situations.map((sit) => renderSituationCard(sit, mod)).join("")}
      </section>
    ` : ""}

    <section class="panel" style="margin-bottom:12px;" id="scandal-active-section">
      <h2 style="margin-top:0;">Local Scandals</h2>
      ${openScandals.length
        ? openScandals.map((s) => renderScandalCard(s, sd.player_choices, state)).join("")
        : '<div class="muted-block">No active local scandals.</div>'}
      ${closedScandals.length ? `
        <details style="margin-top:8px;">
          <summary class="muted" style="cursor:pointer;">Closed scandals (${closedScandals.length})</summary>
          ${closedScandals.map((s) => renderScandalCard(s, sd.player_choices, state)).join("")}
        </details>
      ` : ""}
    </section>
  `;
}

// ── Module state ───────────────────────────────────────────────────────────────

let _scandalData = null;
let _modScandalData = null;
let _templates = null;
let _optedInCharacters = null;

async function loadScandalData(mod) {
  // Fetch player's own scandal data — may fail if the user has no active character.
  try {
    _scandalData = await apiScandalsMine();
  } catch (e) {
    console.error("[scandal] apiScandalsMine failed:", e);
    if (!_scandalData) _scandalData = { opted_in: false, situations: [], scandals: [], player_choices: [] };
  }

  // Fetch mod-only data independently so a missing active character doesn't block templates.
  if (mod) {
    try {
      const [tpls, modOpen, optedIn] = await Promise.all([
        apiModScandalTemplates(),
        apiModScandalsOpen(),
        apiModScandalOptedInCharacters(),
      ]);
      _templates = tpls.templates || [];
      _modScandalData = modOpen;
      _optedInCharacters = optedIn.characters || [];
    } catch (e) {
      console.error("[scandal] mod scandal data load failed:", e);
      _templates = _templates || [];
    }
  }
}

// ── Main render ────────────────────────────────────────────────────────────────

function render(data, state = {}) {
  const root = document.getElementById("constituency-work-root");
  if (!root) return;

  const key = ensureWork(data);
  const plan = data.constituencyWork.plansByCharacter[key];
  const char = getCharacterContext(data);
  const simIndex = getSimIndex(data);
  const mod = canModerate(data);
  const hasActiveChar = mod || Boolean(char?.name);

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

    <div id="scandal-section-root">
      ${renderScandalSection(_scandalData, _modScandalData, _templates, mod, hasActiveChar, state)}
    </div>

    ${mod ? `
      ${renderModScandalCreate(_templates, _optedInCharacters)}
      ${renderModOpenScandals(_modScandalData, state)}

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

  // ── Working week form ──────────────────────────────────────────────────────
  root.querySelector("#cw-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (locked) return;

    const fd = new FormData(e.currentTarget);
    const nextHours = {};
    TASKS.forEach((task) => {
      nextHours[task] = Math.max(0, Number(fd.get(task) || 0));
    });

    const sum = totalHours(nextHours);
    if (sum > 40) {
      alert("You cannot allocate more than 40 hours.");
      return;
    }

    const submitBtn = e.currentTarget.querySelector("button[type='submit']");
    if (submitBtn) submitBtn.disabled = true;

    // Save old values so we can revert if the API call fails
    const prevHours          = { ...plan.hours };
    const prevSecondJob      = plan.secondJobTitleCompany;
    const prevSimIndex       = plan.lastSavedSimIndex;

    plan.hours = nextHours;
    plan.secondJobTitleCompany = String(fd.get("secondJobTitleCompany") || "").trim();
    plan.lastSavedSimIndex = simIndex;
    plan.updatedAt = new Date().toLocaleString("en-GB");

    try {
      await apiSaveMyWorkPlan({
        hours: plan.hours,
        secondJobTitleCompany: plan.secondJobTitleCompany,
        lastSavedSimIndex: plan.lastSavedSimIndex,
      });
    } catch (err) {
      // Revert local state so UI matches DB on next reload (R3: no silent local-only mutations)
      plan.hours = prevHours;
      plan.secondJobTitleCompany = prevSecondJob;
      plan.lastSavedSimIndex = prevSimIndex;
      delete plan.updatedAt;
      handleApiError(err, "Save work plan");
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
    render(data, state);
  });

  // ── Opt-in toggle ─────────────────────────────────────────────────────────
  root.querySelector("#cw-save-optin")?.addEventListener("click", async () => {
    const checkbox = root.querySelector("#cw-scandal-optin");
    const opted_in = !!checkbox?.checked;
    try {
      await apiScandalsOptIn(opted_in);
      if (_scandalData) _scandalData.opted_in = opted_in;
      state.optinSaved = true;
      renderScandalRoot(data, state);
    } catch (e) {
      state.optinSaved = false;
      renderScandalRoot(data, state);
      console.error(e);
    }
  });

  // ── Situation respond ─────────────────────────────────────────────────────
  root.querySelectorAll('[data-action="situation-respond"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const action = btn.dataset.response;
      btn.disabled = true;
      try {
        await apiScandalSituationRespond(id, action);
        await loadScandalData(mod);
        renderScandalRoot(data, state);
      } catch (e) {
        alert("Failed to respond to situation. Please try again.");
        console.error(e);
        btn.disabled = false;
      }
    });
  });

  // ── Player scandal stage choice ───────────────────────────────────────────
  root.querySelectorAll('[data-action="choose-scandal"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const scandalId = btn.dataset.scandalId;
      const choiceId  = btn.dataset.choiceId;
      btn.disabled = true;
      try {
        await apiScandalChoose(scandalId, choiceId);
        await loadScandalData(mod);
        renderScandalRoot(data, state);
      } catch (e) {
        alert("Failed to record choice. Please try again.");
        console.error(e);
        btn.disabled = false;
      }
    });
  });

  // ── Toggle scandal card ───────────────────────────────────────────────────
  root.querySelectorAll('[data-action="toggle-scandal"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      state.openScandalId = state.openScandalId === id ? null : id;
      renderScandalRoot(data, state);
    });
  });

  // ── Mod: toggle open scandal ──────────────────────────────────────────────
  root.querySelectorAll('[data-action="mod-toggle-scandal"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      state.openModScandalId = state.openModScandalId === id ? null : id;
      render(data, state);
    });
  });

  // ── Mod: close scandal ────────────────────────────────────────────────────
  root.querySelectorAll('[data-action="mod-close-scandal"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!mod) return;
      const id = btn.dataset.id;
      btn.disabled = true;
      try {
        await apiModScandalClose(id);
        await loadScandalData(mod);
        render(data, state);
      } catch (e) {
        alert("Failed to close scandal. Please try again.");
        console.error(e);
        btn.disabled = false;
      }
    });
  });

  // ── Mod: apply decision ───────────────────────────────────────────────────
  root.querySelectorAll(".mod-decision-form").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!mod) return;
      const scandalId = form.dataset.scandalId;
      const fd = new FormData(form);
      const payload = {
        decision_type:    String(fd.get("decision_type") || ""),
        next_stage_key:   String(fd.get("next_stage_key") || "").trim() || null,
        severity_delta:   Number(fd.get("severity_delta") || 0),
        public_statement: String(fd.get("public_statement") || "").trim() || null,
        internal_notes:   String(fd.get("internal_notes") || "").trim(),
      };
      const submitBtn = form.querySelector('[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      try {
        await apiModScandalDecision(scandalId, payload);
        state.openModScandalId = null;
        await loadScandalData(mod);
        render(data, state);
      } catch (e) {
        alert("Failed to apply decision. Please try again.");
        console.error(e);
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  });

  // ── Mod: create situation ─────────────────────────────────────────────────
  root.querySelector("#cw-mod-situation-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!mod) return;
    const form = e.currentTarget;
    const fd = new FormData(form);
    const payload = {
      character_id:    String(fd.get("character_id") || "").trim(),
      template_id:     String(fd.get("template_id") || "").trim(),
      title_override:  String(fd.get("title_override") || "").trim() || null,
      expires_in_months: fd.get("expires_in_months") ? Number(fd.get("expires_in_months")) : undefined,
    };
    if (!payload.character_id || !payload.template_id) return;
    const submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    try {
      await apiModScandalSituationCreate(payload);
      alert("Sensitive situation created successfully.");
      form.reset();
    } catch (err) {
      alert(`Failed to create situation: ${err.message}`);
      console.error(err);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  // ── Mod: working week ─────────────────────────────────────────────────────
  root.querySelector("#cw-mod-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!mod) return;
    const fd = new FormData(e.currentTarget);
    plan.secondJobTitleCompany = String(fd.get("secondJobTitleCompany") || "").trim();
    apiSaveMyWorkPlan(plan).catch((err) => console.error("[cw] second job save failed:", err));
    render(data, state);
  });

  root.querySelector("#cw-mod-clear-second-job")?.addEventListener("click", () => {
    if (!mod) return;
    plan.secondJobTitleCompany = "";
    plan.hours["Do Second Job"] = 0;
    apiSaveMyWorkPlan(plan).catch((err) => console.error("[cw] second job clear failed:", err));
    render(data, state);
  });
}

// Partial re-render: refresh only the scandal section without re-rendering the whole page
function renderScandalRoot(data, state) {
  const mod = canModerate(data);
  const char = getCharacterContext(data);
  const hasActiveChar = mod || Boolean(char?.name);
  const root = document.getElementById("scandal-section-root");
  if (!root) return render(data, state); // fall back to full render
  root.innerHTML = renderScandalSection(_scandalData, _modScandalData, _templates, mod, hasActiveChar, state);
  // Re-attach event listeners for scandal section
  attachScandalListeners(data, state, mod);
}

function attachScandalListeners(data, state, mod) {
  const root = document.getElementById("constituency-work-root");
  if (!root) return;

  root.querySelector("#cw-save-optin")?.addEventListener("click", async () => {
    const checkbox = root.querySelector("#cw-scandal-optin");
    const opted_in = !!checkbox?.checked;
    try {
      await apiScandalsOptIn(opted_in);
      if (_scandalData) _scandalData.opted_in = opted_in;
      state.optinSaved = true;
      renderScandalRoot(data, state);
    } catch (e) {
      state.optinSaved = false;
      renderScandalRoot(data, state);
      console.error(e);
    }
  });

  root.querySelectorAll('[data-action="situation-respond"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const action = btn.dataset.response;
      btn.disabled = true;
      try {
        await apiScandalSituationRespond(id, action);
        await loadScandalData(mod);
        renderScandalRoot(data, state);
      } catch (e) {
        alert("Failed to respond to situation. Please try again.");
        console.error(e);
        btn.disabled = false;
      }
    });
  });

  root.querySelectorAll('[data-action="choose-scandal"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const scandalId = btn.dataset.scandalId;
      const choiceId  = btn.dataset.choiceId;
      btn.disabled = true;
      try {
        await apiScandalChoose(scandalId, choiceId);
        await loadScandalData(mod);
        renderScandalRoot(data, state);
      } catch (e) {
        alert("Failed to record choice. Please try again.");
        console.error(e);
        btn.disabled = false;
      }
    });
  });

  root.querySelectorAll('[data-action="toggle-scandal"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      state.openScandalId = state.openScandalId === id ? null : id;
      renderScandalRoot(data, state);
    });
  });
}

export async function initConstituencyWorkPage(data) {
  ensureWork(data);
  const mod = canModerate(data);
  render(data, {});

  // Load work plan from DB (authoritative for the current active character)
  if (!mod) {
    try {
      const result = await apiGetMyWorkPlan();
      if (result?.workPlan) {
        const workPlanKey = ensureWork(data);
        const plan = data.constituencyWork.plansByCharacter[workPlanKey];
        if (plan && result.workPlan.hours) {
          plan.hours = result.workPlan.hours;
          plan.secondJobTitleCompany = result.workPlan.secondJobTitleCompany || "";
          plan.lastSavedSimIndex = result.workPlan.lastSavedSimIndex || 0;
          render(data, {});
        }
      }
    } catch (err) {
      console.warn("[constituency-work] DB load failed:", err.message);
    }
  }

  await loadScandalData(mod);
  render(data, {});
}
