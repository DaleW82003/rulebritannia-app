import { saveData } from "../core.js";
import { esc } from "../ui.js";

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

function ensureSubmissionTracker(data) {
  const simYear = Number(data?.gameState?.startSimYear || new Date().getFullYear());
  data.billSubmission ??= { year: simYear, oppositionDayUsed: { "leader-opposition": 0, "third-party": 0 } };
  if (data.billSubmission.year !== simYear) {
    data.billSubmission.year = simYear;
    data.billSubmission.oppositionDayUsed = { "leader-opposition": 0, "third-party": 0 };
  }
  data.billSubmission.oppositionDayUsed ??= { "leader-opposition": 0, "third-party": 0 };
}

function computeEligibility(data) {
  ensureSubmissionTracker(data);
  const c = currentCharacter(data);
  const thirdParty = getThirdPartyName(data);

  const canGovernment = c.office === "prime-minister" || c.office === "leader-commons";
  const canOppositionLeader = c.role === "leader-opposition";
  const canThirdPartyLeader = c.party === thirdParty && c.role === "party-leader-3rd-4th";

  const oppUsed = Number(data.billSubmission.oppositionDayUsed?.["leader-opposition"] || 0);
  const thirdUsed = Number(data.billSubmission.oppositionDayUsed?.["third-party"] || 0);

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
    opts.push(`<label><input type="radio" name="billTypeChoice" value="opposition-leader" ${e.oppRemaining <= 0 ? "disabled" : ""}> Opposition Day Bill — Leader of the Opposition (${e.oppRemaining} remaining this year)</label>`);
  }
  if (e.canThirdPartyLeader) {
    opts.push(`<label><input type="radio" name="billTypeChoice" value="opposition-third" ${e.thirdRemaining <= 0 ? "disabled" : ""}> Opposition Day Bill — Third Party (${e.thirdRemaining} remaining this year)</label>`);
  }

  return `
    <div class="muted-block">
      <div class="wgo-kicker">Submission Route</div>
      <div class="docket-list" style="margin-top:8px;">
        ${opts.map((x) => `<div>${x}</div>`).join("")}
      </div>
    </div>
  `;
}

function renderBuilder() {
  return `
    <form id="submitBillForm">
      <div class="form-grid">
        <label for="billTitleInput">Title of the Bill</label>
        <input id="billTitleInput" type="text" maxlength="160" required>

        <label for="billProvisionInput">A Bill to make provision for…</label>
        <textarea id="billProvisionInput" rows="3" required></textarea>

        <label for="billDepartmentInput">Department</label>
        <input id="billDepartmentInput" type="text" maxlength="120" value="Cabinet Office">

        <label for="articleCountInput">Number of Articles</label>
        <input id="articleCountInput" type="number" min="1" max="20" value="3" required>
      </div>

      <div id="articlesContainer" style="margin-top:14px;"></div>

      <div class="panel" style="margin-top:12px;">
        <h3 style="margin-top:0;">Final Article — Extent & Commencement</h3>
        <textarea id="billFinalArticle" rows="4" required>Extent and commencement: This Act extends to England, Wales, Scotland and Northern Ireland, and comes into force 30 days after Royal Assent.</textarea>
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
    <section class="panel" style="margin-top:12px;">
      <h3 style="margin-top:0;">Article ${i + 1}</h3>
      <div class="form-grid">
        <label for="articleHeading${i}">Article Heading</label>
        <input id="articleHeading${i}" type="text" maxlength="140" required>

        <label for="articleBody${i}">Article Body</label>
        <textarea id="articleBody${i}" rows="6" required></textarea>
      </div>
    </section>
  `).join("");
}

function buildBillText(formEl, articleCount) {
  const title = formEl.querySelector("#billTitleInput").value.trim();
  const provision = formEl.querySelector("#billProvisionInput").value.trim();
  const lines = [`${title}`, "", `A Bill to make provision for ${provision}`];

  for (let i = 0; i < articleCount; i += 1) {
    const h = formEl.querySelector(`#articleHeading${i}`)?.value?.trim() || `Article ${i + 1}`;
    const b = formEl.querySelector(`#articleBody${i}`)?.value?.trim() || "";
    lines.push("", `ARTICLE ${i + 1} — ${h}`, b);
  }

  lines.push("", "FINAL ARTICLE — EXTENT & COMMENCEMENT", formEl.querySelector("#billFinalArticle").value.trim());
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

  typeRoot.innerHTML = renderTypeControls(data);
  builderRoot.innerHTML = renderBuilder();

  if (permission) {
    permission.style.display = "";
    permission.innerHTML = `<div class="muted-block">Submitting as <b>${esc(currentCharacter(data).name || "MP")}</b>. Government submissions are unlimited for PM / Leader of the House; Opposition Day bill limits are enforced yearly.</div>`;
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

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const typeChoice = (typeRoot.querySelector('input[name="billTypeChoice"]:checked') || {}).value || "pmb";
    const articleCount = Math.max(1, Math.min(20, Number(countInput.value || 1)));
    const c = currentCharacter(data);

    if (typeChoice === "opposition-leader" && eligibility.oppRemaining <= 0) return;
    if (typeChoice === "opposition-third" && eligibility.thirdRemaining <= 0) return;

    const title = form.querySelector("#billTitleInput").value.trim();
    const department = form.querySelector("#billDepartmentInput").value.trim() || "Cabinet Office";
    const now = Date.now();

    let billType = "pmb";
    let stage = "First Reading";
    if (typeChoice === "government") {
      billType = "government";
      stage = "Second Reading";
    }
    if (typeChoice === "opposition-leader" || typeChoice === "opposition-third") {
      billType = "opposition";
      stage = "Second Reading";
      const key = typeChoice === "opposition-leader" ? "leader-opposition" : "third-party";
      data.billSubmission.oppositionDayUsed[key] = Number(data.billSubmission.oppositionDayUsed[key] || 0) + 1;
    }

    const id = `${slugify(title)}-${(data?.gameState?.startSimYear || new Date().getFullYear())}`;
    const uniqueId = (data.orderPaperCommons || []).some((b) => b.id === id) ? `${id}-${Math.random().toString(36).slice(2, 5)}` : id;

    const bill = {
      id: uniqueId,
      title,
      author: c.name || "Unknown MP",
      department,
      billType,
      stage,
      status: "in-progress",
      createdAt: now,
      stageStartedAt: now,
      stageDurationMs: stage === "Second Reading" ? 48 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000,
      billText: buildBillText(form, articleCount),
      amendments: [],
      hansard: {},
      debateUrl: `https://forum.rulebritannia.org/t/${encodeURIComponent(uniqueId)}`
    };

    data.orderPaperCommons ??= [];
    data.orderPaperCommons.unshift(bill);

    if (stage === "First Reading") {
      pushAgendaDocketItem(data, bill);
    }

    saveData(data);

    if (success) {
      success.style.display = "";
      success.innerHTML = `<div class="muted-block"><b>Bill submitted:</b> ${esc(title)} (${esc(stage)}). It has been added to the Order Paper.</div>`;
    }
    form.reset();
    countInput.value = 3;
    paintArticles();
    typeRoot.innerHTML = renderTypeControls(data);
  });
}
