import { saveState } from "../core.js";
import { getSimDate, createDeadline } from "../clock.js";
import { esc } from "../ui.js";
import { apiCreateDebateTopic, apiCreateBill } from "../api.js";
import { tileSection } from "../components/tile.js";
import { toastSuccess } from "../components/toast.js";
import { handleApiError } from "../errors.js";
import { isAdmin, isMod } from "../permissions.js";
import { npcPartyOptions } from "../parties.js";

const DEPARTMENTS = [
  "Cabinet Office (General)",
  "Home",
  "Foreign",
  "Treasury",
  "Business, Trade & Industry",
  "Defence",
  "Work & Pensions",
  "Education",
  "Health",
  "Environment & Agriculture",
  "Social Care",
  "Transport & Infrastructure",
  "Culture, Media & Sports",
  "Home Nations"
];

const EXTENT_OPTIONS = [
  "the United Kingdom",
  "Great Britain",
  "England and Wales",
  "England",
  "Wales",
  "Scotland",
  "Northern Ireland"
];

const COMMENCE_OPTIONS = [
  "upon the day it is passed",
  "in one month",
  "in six months",
  "in one year",
  "on a date laid out in regulation by the Secretary of State"
];

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

function currentCharacter(data) {
  return data?.currentCharacter || data?.currentPlayer || {};
}

function getThirdPartyName(data) {
  const parties = Array.isArray(data?.parliament?.parties) ? data.parliament.parties : [];
  const ranked = parties
    .filter((p) => Number(p.seats || 0) > 0 && p.name !== "Others")
    .sort((a, b) => Number(b.seats || 0) - Number(a.seats || 0));
  return ranked[2]?.name || null;
}

function currentSimYear(data) {
  return Number(getSimDate(data?.gameState || {}).year || new Date().getFullYear());
}

function ensureSubmissionTracker(data) {
  const simYear = currentSimYear(data);
  data.billSubmission ??= { year: simYear, oppositionUsed: { "leader-opposition": 0, "third-party": 0 } };
  if (Number(data.billSubmission.year) !== simYear) {
    data.billSubmission.year = simYear;
    data.billSubmission.oppositionUsed = { "leader-opposition": 0, "third-party": 0 };
  }
  data.billSubmission.oppositionUsed ??= { "leader-opposition": 0, "third-party": 0 };
}

function computeEligibility(data) {
  ensureSubmissionTracker(data);
  const c = currentCharacter(data);
  const thirdParty = getThirdPartyName(data);

  const canGovernment = c.office === "prime-minister" || c.office === "leader-commons";
  const canOppositionLeader = c.role === "leader-opposition";
  const canThirdPartyLeader = c.party === thirdParty && c.role === "party-leader-3rd-4th";

  const oppUsed = Number(data.billSubmission.oppositionUsed?.["leader-opposition"] || 0);
  const thirdUsed = Number(data.billSubmission.oppositionUsed?.["third-party"] || 0);

  return {
    canGovernment,
    canOppositionLeader,
    canThirdPartyLeader,
    oppRemaining: Math.max(0, 3 - oppUsed),
    thirdRemaining: Math.max(0, 1 - thirdUsed),
    thirdParty
  };
}

function renderTypeControls(data) {
  const e = computeEligibility(data);
  const opts = [
    `<label><input type="radio" name="billTypeChoice" value="pmb" checked> Private Member’s Bill (starts at First Reading)</label>`
  ];

  if (e.canGovernment) {
    opts.push(`<label><input type="radio" name="billTypeChoice" value="government"> Government Bill (straight to Second Reading)</label>`);
  }
  if (e.canOppositionLeader) {
    opts.push(`<label><input type="radio" name="billTypeChoice" value="opposition-leader" ${e.oppRemaining <= 0 ? "disabled" : ""}> Opposition Bill — Leader of the Opposition (${e.oppRemaining} remaining this sim year)</label>`);
  }
  if (e.canThirdPartyLeader) {
    opts.push(`<label><input type="radio" name="billTypeChoice" value="opposition-third" ${e.thirdRemaining <= 0 ? "disabled" : ""}> Opposition Bill — Leader of the Third Party (${e.thirdRemaining} remaining this sim year)</label>`);
  }

  return `
    <div class="muted-block">
      <h3 style="margin:0 0 8px;font-size:14px;">Submission Route</h3>
      <div class="submission-route">
        ${opts.map((x) => `<div style="margin-bottom:6px;">${x}</div>`).join("")}
      </div>
    </div>
  `;
}

function renderBuilder(canPostAsNpc, partyOptions) {
  return `
    <form id="submitBillForm">
      <div class="form-grid" style="align-items:start;">
        <label for="billTitleInput">Title of the Bill</label>
        <input id="billTitleInput" type="text" maxlength="160" required>

        <label for="billProvisionInput">A Bill to make provision for…</label>
        <textarea id="billProvisionInput" rows="3" required></textarea>

        <label for="billDepartmentInput">Department</label>
        <select id="billDepartmentInput" required>
          ${DEPARTMENTS.map((d) => `<option value="${esc(d)}" ${d === "Cabinet Office (General)" ? "selected" : ""}>${esc(d)}</option>`).join("")}
        </select>

        <label for="articleCountInput">Number of Articles</label>
        <input id="articleCountInput" type="number" min="1" max="20" value="3" required>
      </div>

      ${canPostAsNpc ? `
      <div class="muted-block" style="margin-top:12px;padding:10px;border:1px solid var(--line);">
        <div class="wgo-kicker" style="margin-bottom:6px;">NPC Submission (mod/admin)</div>
        <div class="form-row">
          <label for="npcNameInput">NPC MP Name <span style="color:var(--danger);">*</span></label>
          <input id="npcNameInput" name="npcName" maxlength="100" placeholder="Enter MP name" required>
        </div>
        <div class="form-row" style="margin-top:6px;">
          <label for="npcPartyInput">Party <span style="color:var(--danger);">*</span></label>
          <select id="npcPartyInput" name="npcParty" required>
            <option value="">— Select party —</option>
            ${partyOptions}
          </select>
        </div>
      </div>` : ""}

      <div id="articlesContainer" style="margin-top:14px;"></div>

      <div class="tile" style="margin-top:12px;">
        <h3 style="margin-top:0;">Final Article — Extent &amp; Commencement</h3>
        <div class="form-grid" style="align-items:start;">
          <label for="finalExtent">Extent</label>
          <select id="finalExtent" required>
            ${EXTENT_OPTIONS.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}
          </select>

          <label for="finalCommencement">Commencement</label>
          <select id="finalCommencement" required>
            ${COMMENCE_OPTIONS.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}
          </select>
        </div>
      </div>

      <div class="tile-bottom" style="margin-top:12px;">
        <button class="btn primary" type="submit">Submit a Bill</button>
      </div>
    </form>
  `;
}

function renderArticleEditors(count) {
  const n = Math.max(1, Math.min(20, Number(count || 1)));
  return Array.from({ length: n }).map((_, i) => `
    <div class="tile" style="margin-top:12px;">
      <h3 style="margin-top:0;">Article ${i + 1}</h3>
      <div class="form-grid" style="align-items:start;">
        <label for="articleHeading${i}">Article Heading</label>
        <input id="articleHeading${i}" type="text" maxlength="140" required>

        <label for="articleBody${i}">Article Body</label>
        <textarea id="articleBody${i}" rows="6" required></textarea>
      </div>
    </div>
  `).join("");
}

function buildFinalArticle(formEl, articleCount, simYear, billTitle) {
  const articleNumber = Number(articleCount) + 1;
  const extent = formEl.querySelector("#finalExtent")?.value || "the United Kingdom";
  const commencement = formEl.querySelector("#finalCommencement")?.value || "upon the day it is passed";
  const citedAs = `${billTitle.replace(/Bill/ig, "Act")} ${simYear}`.trim();

  return [
    `ARTICLE ${articleNumber} — FINAL ARTICLE: EXTENT AND COMMENCEMENT`,
    `1. This Act extends to ${extent}.`,
    `2. This Act comes into force ${commencement}.`,
    `3. This Act may be cited as the ${citedAs}.`
  ].join("\n");
}

function buildBillText(formEl, articleCount, data) {
  const title = formEl.querySelector("#billTitleInput").value.trim();
  const provision = formEl.querySelector("#billProvisionInput").value.trim();
  const monarchGender = String(data?.adminSettings?.monarchGender || "Queen").toLowerCase() === "king" ? "King" : "Queen";
  const majestyPronoun = monarchGender === "King" ? "His" : "Her";
  const simYear = currentSimYear(data);

  const lines = [
    `${title}`,
    "",
    `A Bill to make provision for ${provision}`,
    "",
    `BE IT ENACTED by the ${monarchGender}’s most Excellent Majesty, by and with the advice and consent of the Lords Spiritual and Temporal, and Commons, in this present Parliament assembled, and by the authority of the same, as follows:`,
    `(${majestyPronoun} Majesty in Parliament enacted this measure under the constitutional forms of the realm.)`
  ];

  for (let i = 0; i < articleCount; i += 1) {
    const h = formEl.querySelector(`#articleHeading${i}`)?.value?.trim() || `Article ${i + 1}`;
    const b = formEl.querySelector(`#articleBody${i}`)?.value?.trim() || "";
    lines.push("", `ARTICLE ${i + 1} — ${h}`, b);
  }

  lines.push("", buildFinalArticle(formEl, articleCount, simYear, title));
  return lines.join("\n");
}

function pushAgendaDocketItem(data, bill) {
  data.liveDocket ??= { asOf: "Today", items: [] };
  data.liveDocket.items ??= [];
  data.liveDocket.items.unshift({
    type: "bill",
    title: `Leader of the House: set second reading gate for ${bill.title}`,
    detail: "New bill submitted to First Reading. Decision required.",
    ctaLabel: "Open Bill",
    href: `bill.html?id=${bill.id}`,
    priority: "high",
    audience: { offices: ["prime-minister", "leader-commons"] }
  });
}

export function initSubmitBillPage(data) {
  const typeRoot = document.getElementById("bill-type-controls");
  const builderRoot = document.getElementById("legislation-builder");
  const permission = document.getElementById("bill-permission");
  const success = document.getElementById("billSuccess");
  if (!typeRoot || !builderRoot) return;

  ensureSubmissionTracker(data);
  const eligibility = computeEligibility(data);
  const canPostAsNpc = isAdmin(data) || isMod(data);

  const partyOptions = npcPartyOptions();

  typeRoot.innerHTML = renderTypeControls(data);
  builderRoot.innerHTML = renderBuilder(canPostAsNpc, partyOptions);

  if (permission) {
    permission.style.display = "";
    if (canPostAsNpc) {
      permission.innerHTML = `<div class="muted-block">Submitting as <b>NPC</b> (mod/admin). You must enter an MP name and select a party. The bill will be tagged <b>[NPC]</b>.</div>`;
    } else {
      permission.innerHTML = `<div class="muted-block">Submitting as <b>${esc(currentCharacter(data).name || "MP")}</b>. PMBs are available to all MPs. Government bills are for PM / Leader of the House. Opposition bills are capped yearly (Leader of the Opposition: 3; Third Party Leader: 1).</div>`;
    }
  }

  const form = builderRoot.querySelector("#submitBillForm");
  const countInput = form?.querySelector("#articleCountInput");
  const articlesContainer = form?.querySelector("#articlesContainer");
  if (!form || !countInput || !articlesContainer) return;

  const paintArticles = () => {
    articlesContainer.innerHTML = renderArticleEditors(countInput.value);
  };
  paintArticles();
  countInput.addEventListener("input", paintArticles);

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const typeChoice = (typeRoot.querySelector('input[name="billTypeChoice"]:checked') || {}).value || "pmb";
    const articleCount = Math.max(1, Math.min(20, Number(countInput.value || 1)));
    const c = currentCharacter(data);

    if (!canPostAsNpc) {
      if (typeChoice === "opposition-leader" && eligibility.oppRemaining <= 0) return;
      if (typeChoice === "opposition-third" && eligibility.thirdRemaining <= 0) return;
    }

    const npcName = canPostAsNpc ? String(form.querySelector("#npcNameInput")?.value || "").trim() : "";
    const npcParty = canPostAsNpc ? String(form.querySelector("#npcPartyInput")?.value || "").trim() : "";

    if (canPostAsNpc && !npcName) {
      form.querySelector("#npcNameInput")?.focus();
      return;
    }
    if (canPostAsNpc && !npcParty) {
      form.querySelector("#npcPartyInput")?.focus();
      return;
    }

    const title = form.querySelector("#billTitleInput").value.trim();
    const department = form.querySelector("#billDepartmentInput").value || "Cabinet Office (General)";
    const now = Date.now();

    const author = canPostAsNpc ? `${npcName} [NPC]` : (c.name || "Unknown MP");

    let billType = "pmb";
    let stage = "First Reading";
    if (!canPostAsNpc) {
      if (typeChoice === "government") {
        billType = "government";
        stage = "Second Reading";
      }
      if (typeChoice === "opposition-leader" || typeChoice === "opposition-third") {
        billType = "opposition";
        stage = "First Reading";
        const key = typeChoice === "opposition-leader" ? "leader-opposition" : "third-party";
        data.billSubmission.oppositionUsed[key] = Number(data.billSubmission.oppositionUsed[key] || 0) + 1;
      }
    }

    const simYear = currentSimYear(data);
    const id = `${slugify(title)}-${simYear}`;
    const uniqueId = (data.orderPaperCommons || []).some((b) => b.id === id) ? `${id}-${Math.random().toString(36).slice(2, 5)}` : id;

    const bill = {
      id: uniqueId,
      title,
      author,
      ...(canPostAsNpc ? { npc: true, npcParty } : {}),
      department,
      billType,
      stage,
      status: "in-progress",
      createdAt: now,
      stageStartedAt: now,
      stageDeadlineSim: createDeadline(data.gameState, stage === "Second Reading" ? 2 : 1),
      billText: buildBillText(form, articleCount, data),
      amendments: [],
      hansard: {},
      debate: { topicId: null, topicUrl: null, opensAtSim: null, closesAtSim: null }
    };

    const submitBtn = form.querySelector("[type='submit']");
    if (submitBtn) submitBtn.disabled = true;

    try {
      await apiCreateBill(bill);
    } catch (err) {
      console.error("[submit-bill] Failed to persist bill to DB:", err);
      handleApiError(err, "Submit bill");
      if (submitBtn) submitBtn.disabled = false;
      return;
    }

    data.orderPaperCommons ??= [];
    data.orderPaperCommons.unshift(bill);

    if (stage === "First Reading") {
      pushAgendaDocketItem(data, bill);
    }

    if (stage === "Second Reading") {
      const raw = `**${bill.title}**\nIntroduced by ${bill.author || "Unknown"}${department ? ` (${department})` : ""}.\n\n*This is the Second Reading debate thread for this bill.*`;
      apiCreateDebateTopic({ entityType: "bill", entityId: bill.id, title: `Second Reading: ${bill.title}`, raw })
        .then(({ topicId, topicUrl }) => {
          bill.debate = { ...bill.debate, topicId, topicUrl };
          bill.discourseTopicId = topicId;
          const idx = data.orderPaperCommons.findIndex((b) => b.id === bill.id);
          if (idx >= 0) data.orderPaperCommons[idx] = bill;
        })
        .catch((err) => handleApiError(err, "Debate topic"));
    }

    toastSuccess(`Bill submitted: ${title} (${stage}).`);
    if (success) success.style.display = "none";
    if (submitBtn) submitBtn.disabled = false;
    form.reset();
    countInput.value = 3;
    paintArticles();
    typeRoot.innerHTML = renderTypeControls(data);
  });
}
