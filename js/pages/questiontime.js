import { esc, formatMPName, partyBadge } from "../ui.js";
import { isAdmin, isMod, isSpeaker, canAnswerQuestionTime, canAdminModOrSpeaker } from "../permissions.js";
import { formatSimMonthYear, formatSimDate, createDeadline, isDeadlinePassed, simDateToObj, getSimDate, countdownToSimMonth } from "../clock.js";
import { logAction } from "../audit.js";
import { handleApiError } from "../errors.js";
import {
  apiGetQtQuestions, apiSubmitQtQuestion, apiAnswerQtQuestion,
  apiFollowupQtQuestion, apiPatchQtQuestion,
  apiAnswerQtFollowup, apiDeleteQtQuestion,
} from "../api.js";
import { npcPartyOptions } from "../parties.js";

/** Static list of Question Time departments — mirrors government.js OFFICE_SPECS */
const QT_OFFICES = [
  { id: "prime-minister", title: "Prime Minister, First Lord of the Treasury, and Minister for the Civil Service", holder: "" },
  { id: "chancellor", title: "Chancellor of the Exchequer, and Second Lord of the Treasury", holder: "" },
  { id: "home", title: "Secretary of State for the Home Department", holder: "" },
  { id: "foreign", title: "Secretary of State for Foreign and Commonwealth Affairs", holder: "" },
  { id: "trade", title: "Secretary of State for Business and Trade, and President of the Board of Trade", holder: "" },
  { id: "defence", title: "Secretary of State for Defence", holder: "" },
  { id: "welfare", title: "Secretary of State for Work and Pensions", holder: "" },
  { id: "education", title: "Secretary of State for Education", holder: "" },
  { id: "env-agri", title: "Secretary of State for the Environment and Agriculture", holder: "" },
  { id: "health", title: "Secretary of State for Health and Social Care", holder: "" },
  { id: "eti", title: "Secretary of State for Transport and Infrastructure", holder: "" },
  { id: "culture", title: "Secretary of State for Culture, Media and Sport", holder: "" },
  { id: "home-nations", title: "Secretary of State for the Home Nations", holder: "" },
  { id: "leader-commons", title: "Leader of the House of Commons", holder: "" }
];

function getCurrentCharacter(data) {
  return data?.currentCharacter || data?.currentPlayer || {};
}

function canModerate(data) {
  return canAdminModOrSpeaker(data);
}

function canAnswerOffice(data, officeId) {
  return canAnswerQuestionTime(data, officeId);
}

function normaliseQuestionTime(data) {
  data.questionTime ??= {};
  data.questionTime.offices ??= [];
  data.questionTime.questions ??= [];

  // Seed static offices if none exist yet
  if (!data.questionTime.offices.length) {
    data.questionTime.offices = QT_OFFICES.map((o) => ({ ...o }));
  }

  // Ensure every static office is present (backfill any that were missing)
  const existingOfficeIds = new Set(data.questionTime.offices.map((o) => o.id));
  for (const def of QT_OFFICES) {
    if (!existingOfficeIds.has(def.id)) {
      data.questionTime.offices.push({ ...def });
    }
  }

  // Sync office holders from government data so QT stays up to date
  const govOffices = new Map((data.government?.offices || []).map((o) => [o.id, o]));
  for (const qt of data.questionTime.offices) {
    const gov = govOffices.get(qt.id);
    if (gov) qt.holder = gov.holderName || "";
    // Ensure Discourse fields are always present, even if null
    qt.discourse_topic_id  ??= null;
    qt.discourse_topic_url ??= null;
  }

  data.questionTime.questions.forEach((q) => {
    q.followUps ??= [];
    q.followUps.forEach((f) => {
      f.answer ??= "";
      f.askedByRole ??= "backbencher";
    });
  });
}

function questionStatus(question) {
  if (question.archived) return "Archived";
  if (question.status === "closed") return "Closed";
  if (question.answer) return "Answered";
  return "Open";
}

function normaliseRole(role = "") {
  const r = String(role || "");
  if (r === "leader-opposition") return "leader-opposition";
  if (r === "party-leader-3rd-4th") return "party-leader-3rd-4th";
  if (r === "shadow" || r.startsWith("shadow-")) return "shadow";
  if (r === "minister") return "minister";
  return "backbencher";
}

function effectiveRoleForQuestionTime(data) {
  const char = getCurrentCharacter(data);
  const explicit = normaliseRole(char?.role);
  if (explicit !== "backbencher") return explicit;

  const offices = Array.isArray(char?.offices) ? char.offices : (char?.office ? [char.office] : []);
  const shadowOffices = Array.isArray(char?.shadowOffices) ? char.shadowOffices : (char?.shadowOffice ? [char.shadowOffice] : []);

  if (shadowOffices.includes("leader-opposition")) return "leader-opposition";
  if (char?.partyLeader) return "party-leader-3rd-4th";
  if (shadowOffices.some((o) => String(o || "").startsWith("shadow-"))) return "shadow";
  if (offices.length) return "minister";
  return "backbencher";
}

function officeToShadowOfficeMap(officeId = "") {
  const map = {
    "chancellor": "shadow-chancellor",
    "home": "shadow-home",
    "foreign": "shadow-foreign",
    "trade": "shadow-trade",
    "defence": "shadow-defence",
    "welfare": "shadow-welfare",
    "education": "shadow-education",
    "env-agri": "shadow-env-agri",
    "health": "shadow-health",
    "eti": "shadow-eti",
    "culture": "shadow-culture",
    "home-nations": "shadow-home-nations",
    "leader-commons": "shadow-leader-commons",
    "prime-minister": "leader-opposition"
  };
  return map[officeId] || "";
}

function openQuestionsByAsker(data, askerName) {
  return (data.questionTime?.questions || []).filter((q) => !q.archived && !q.answer && String(q.askedBy || "") === String(askerName || ""));
}

function canAskMainQuestion(data, officeId) {
  const char = getCurrentCharacter(data);
  const role = effectiveRoleForQuestionTime(data);
  const asker = String(char?.name || "").trim();
  if (!asker) return { ok: false, reason: "Create/select a character before asking questions." };

  // Government ministers (cabinet office holders) may not ask QT questions
  if (role === "minister") {
    return { ok: false, reason: "Government ministers may not ask Question Time questions — they are expected to answer them." };
  }

  const unansweredByAsker = openQuestionsByAsker(data, asker);
  const unansweredPmqs = unansweredByAsker.filter((q) => q.office === "prime-minister").length;

  if (officeId === "prime-minister") {
    if (role === "backbencher" && unansweredPmqs >= 1) {
      return { ok: false, reason: "Backbenchers may only hold 1 outstanding PMQ at a time." };
    }
    if (role === "backbencher" && unansweredByAsker.length >= 3) {
      return { ok: false, reason: "Backbenchers may hold at most 3 outstanding questions across all ministers." };
    }
    return { ok: true, reason: "" };
  }

  if (role === "shadow" || role === "minister") {
    const expectedShadowOffice = officeToShadowOfficeMap(officeId);
    const currentOffices       = Array.isArray(char?.offices)       ? char.offices       : (char?.office       ? [char.office]       : []);
    const currentShadowOffices = Array.isArray(char?.shadowOffices) ? char.shadowOffices : (char?.shadowOffice ? [char.shadowOffice] : []);
    const matchesShadow  = expectedShadowOffice && currentShadowOffices.includes(expectedShadowOffice);
    const matchesMinister = currentOffices.includes(officeId);
    if (!matchesShadow && !matchesMinister) {
      return { ok: false, reason: "Shadow Secretaries/Ministers may only ask within their own portfolio." };
    }
  }

  if (role === "backbencher" && unansweredByAsker.length >= 3) {
    return { ok: false, reason: "Backbenchers may hold at most 3 outstanding questions across all ministers." };
  }

  return { ok: true, reason: "" };
}

function maxFollowUpsFor(data, officeId) {
  // Follow-up allowance is based on the CURRENT user's role, not the original asker's.
  const role = effectiveRoleForQuestionTime(data);
  if (officeId === "prime-minister") {
    if (role === "leader-opposition")    return 3;
    if (role === "party-leader-3rd-4th") return 2;
    return 1;
  }
  if (role === "shadow" || role === "minister") return 2;
  return 1;
}

function renderQuestionLine(question, office, canAnswer, canArchive, canDeleteQ, simLabel, data) {
  const followUps = Array.isArray(question.followUps) ? question.followUps : [];
  const maxFollowUps = maxFollowUpsFor(data, question.office);
  // Shadow secretaries/ministers can only follow up in their own portfolio
  const char = getCurrentCharacter(data);
  const viewerRole = effectiveRoleForQuestionTime(data);
  let portfolioOk = true;
  if (viewerRole === "shadow" || viewerRole === "minister") {
    const currentOffices       = Array.isArray(char?.offices)       ? char.offices       : (char?.office       ? [char.office]       : []);
    const currentShadowOffices = Array.isArray(char?.shadowOffices) ? char.shadowOffices : (char?.shadowOffice ? [char.shadowOffice] : []);
    const expectedShadow = officeToShadowOfficeMap(question.office);
    portfolioOk = (expectedShadow && currentShadowOffices.includes(expectedShadow)) || currentOffices.includes(question.office);
  }
  const canAskFollowUp = !!question.answer && !question.archived && followUps.length < maxFollowUps && portfolioOk;

  return `
    <article class="tile" style="margin-bottom:10px;">
      <div class="meta" style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
        <span><b>${esc(question.askedBy || "MP")}</b>${question.npcParty ? ` ${partyBadge(question.npcParty)}` : ""} • ${esc(question.askedAtSim || simLabel)}</span>
        <span>${esc(questionStatus(question))}</span>
      </div>
      <p style="margin:8px 0;"><b>Q:</b> ${esc(question.text || "")}</p>
      ${question.answer ? `<p style="margin:8px 0;"><b>A:</b> ${esc(question.answer)}</p>` : `<p class="muted" style="margin:8px 0;">Awaiting response from ${esc(office.holder || office.title)}.</p>`}

      ${followUps.map((f) => `
        <div style="border-top:1px solid #ddd;padding-top:8px;margin-top:8px;">
          <p style="margin:6px 0;"><b>Follow-up:</b> ${esc(f.text || "")}</p>
          <p class="muted" style="margin:6px 0;">Asked by ${esc(f.askedBy || "MP")} • ${esc(f.askedAtSim || simLabel)}</p>
          ${f.answer ? `<p style="margin:6px 0;"><b>Answer:</b> ${esc(f.answer)}</p>` : `
            <p class="muted" style="margin:6px 0;">Awaiting clarification response.</p>
            ${canAnswer ? `
              <form class="qt-answer-followup-form" data-followup-id="${esc(f.id)}" style="margin-top:6px;">
                <textarea name="text" rows="2" class="input" placeholder="Answer this follow-up" required></textarea>
                <button class="btn" type="submit" style="margin-top:4px;">Answer Follow-up</button>
              </form>
            ` : ""}
          `}
        </div>
      `).join("")}

      ${canAskFollowUp ? `
        <form class="qt-followup-form" data-question-id="${esc(question.id)}" style="margin-top:10px;">
          <label class="label" for="followup-${esc(question.id)}">Set follow-up / clarification (${followUps.length}/${maxFollowUps})</label>
          <textarea id="followup-${esc(question.id)}" name="text" rows="2" class="input" placeholder="Enter follow-up question"></textarea>
          <button class="btn" type="submit">Submit follow-up</button>
        </form>
      ` : ""}

      ${canArchive && !question.archived && !question.answer && question.speakerDemandAvailable && !question.speakerDemandedAtTs ? `<button class="btn" data-action="demand" data-question-id="${esc(question.id)}" type="button">Speaker Demand: Answer within 1 month</button>` : ""}
      ${canArchive && !question.archived ? `<button class="btn" data-action="archive" data-question-id="${esc(question.id)}" type="button">Close Question (Mod/Speaker)</button>` : ""}
      ${canAnswer && !question.archived && !question.answer ? `<button class="btn" data-action="quick-answer" data-question-id="${esc(question.id)}" type="button">Answer This Question</button>` : ""}
      ${canDeleteQ ? `<button class="btn danger" data-action="delete-question" data-question-id="${esc(question.id)}" type="button">Delete</button>` : ""}
    </article>
  `;
}

/** Reload question data from the DB then re-render the page. */
async function reloadAndRender(data, state) {
  try {
    const { questions: rows } = await apiGetQtQuestions();
    data.questionTime.questions = rows.map(dbRowToQuestion);
  } catch (err) {
    console.error("[questiontime] reload failed:", err);
  }
  normaliseQuestionTime(data);
  render(data, state);
}

function render(data, state) {
  const root = document.getElementById("question-time-root") || document.getElementById("qt-root");
  if (!root) return;

  normaliseQuestionTime(data);
  const offices = data.questionTime.offices;
  const questions = data.questionTime.questions;
  const urlQuestionId = new URL(window.location.href).searchParams.get("questionId");
  const preselect = urlQuestionId ? questions.find((q) => q.id === urlQuestionId) : null;
  const selectedOfficeId = state.selectedOfficeId || preselect?.office || offices[0]?.id;
  const selectedOffice = offices.find((o) => o.id === selectedOfficeId) || offices[0];
  const simLabel = formatSimMonthYear(data.gameState);

  if (!selectedOffice) {
    root.innerHTML = `<div class="muted-block">No Question Time offices configured.</div>`;
    return;
  }

  state.selectedOfficeId = selectedOffice.id;
  const canArchive = canModerate(data);
  const canAnswer = canAnswerOffice(data, selectedOffice.id) || canModerate(data);
  const canDeleteQ = isAdmin(data) || isMod(data);
  const askGate = canAskMainQuestion(data, selectedOffice.id);
  const canPostAsNpc = isAdmin(data) || isMod(data);
  const partyOptions = npcPartyOptions();

  const officeQuestions = questions
    .filter((q) => q.office === selectedOffice.id)
    .sort((a, b) => (a.archived === b.archived ? 0 : a.archived ? 1 : -1));

  officeQuestions.forEach((q) => {
    if (q.id === urlQuestionId && q.answer && !q.answerSeenByAsker && String(q.askedBy || "") === String(getCurrentCharacter(data)?.display_name || getCurrentCharacter(data)?.name || "")) {
      q.answerSeenByAsker = true;
    }
    if (!q.answer && !q.speakerDemandedAtTs) {
      const overdue = q.dueAtSim ? isDeadlinePassed(q.dueAtSim, data.gameState) : (Number(q.createdAtTs || 0) > 0 && (Date.now() - Number(q.createdAtTs || 0)) > 72 * 60 * 60 * 1000);
      if (overdue) q.speakerDemandAvailable = true;
    }
  });

  root.innerHTML = `
    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">How Question Time Works</h2>
      <p><b>PMQs:</b> Backbenchers may ask the Prime Minister with 1 outstanding PMQ max and 3 outstanding total questions across all ministers. Leader of the Opposition gets up to 3 follow-ups to PMQs; Third Party Leader gets 2; backbenchers get 1.</p>
      <p><b>Outside PMQs:</b> Shadow Secretaries/Ministers may only ask within matching portfolios; no cross-portfolio questions. Backbenchers may ask any secretary. Follow-ups: Shadow Secretaries/Ministers get 2, backbenchers get 1.</p>
      <p>Secretaries have <b>1 month</b> to answer. After that, the Speaker may issue a demand for answer within <b>1 more month</b>. Mod/Speaker closes questions after checks.</p>
      <p class="muted">Prime Minister and Leader of the House can step in and answer any department question.</p>
    </section>

    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Government Question Time Departments</h2>
      <div class="qt-grid">
        ${offices.map((o) => {
          const qs = questions.filter((q) => q.office === o.id && !q.archived);
          const openCount = qs.filter((q) => !q.answer).length;
          const answeredCount = qs.filter((q) => q.answer).length;
          return `
            <article class="qt-tile card-flex ${o.id === selectedOffice.id ? "active" : ""}">
              <div class="qt-office">${esc(o.title)}</div>
              <div class="muted" style="margin:6px 0;">Secretary: ${esc(o.holder || "Vacant")}</div>
              <div class="muted">Open: ${openCount} • Answered: ${answeredCount}</div>
              <div class="tile-bottom">
                <button class="btn" type="button" data-action="open-office" data-office-id="${esc(o.id)}">Open</button>
                ${o.discourse_topic_url ? `<a class="btn" href="${esc(o.discourse_topic_url)}" target="_blank" rel="noopener">Debate</a>` : ""}
              </div>
            </article>
          `;
        }).join("")}
      </div>
    </section>

    <section class="tile" id="qt-office-panel">
      <h2 style="margin-top:0;">${esc(selectedOffice.title)}</h2>
      <p class="muted">Current office holder: <b>${esc(selectedOffice.holder || "Vacant")}</b></p>

      <div style="display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));margin-bottom:12px;">
        <form id="qt-submit-question-form" class="tile">
          <h3 style="margin-top:0;">Submit a Question</h3>
          <label class="label" for="qt-question-text">Question text</label>
          <textarea id="qt-question-text" class="input" name="text" rows="4" required placeholder="Type your parliamentary question" ${askGate.ok || canPostAsNpc ? "" : "disabled"}></textarea>
          ${canPostAsNpc ? `
          <div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--line);">
            <div style="display:flex;gap:16px;margin-bottom:6px;">
              <label><input type="radio" name="qtPosterChoice" value="character" checked> My Character</label>
              <label><input type="radio" name="qtPosterChoice" value="npc"> NPC</label>
            </div>
            <div id="qt-npc-fields" style="display:none;">
              <input class="input" name="npcName" placeholder="NPC MP name (required)" style="margin-bottom:4px;">
              <select class="input" name="npcParty">
                <option value="">— NPC party —</option>
                ${partyOptions}
              </select>
            </div>
          </div>` : ""}
          <div id="qt-submit-error" role="alert" style="display:none;color:#c00;margin-top:6px;font-size:.9em;"></div>
          <button class="btn" type="submit" ${askGate.ok || canPostAsNpc ? "" : "disabled"}>Submit Question</button>
          ${!askGate.ok && !canPostAsNpc ? `<p class="muted" style="margin-top:8px;">${esc(askGate.reason)}</p>` : ""}
        </form>

        <form id="qt-answer-form" class="tile">
          <h3 style="margin-top:0;">Answer a Question</h3>
          <label class="label" for="qt-answer-question-id">Question</label>
          <select id="qt-answer-question-id" class="input" name="questionId" ${canAnswer ? "" : "disabled"}>
            ${officeQuestions.filter((q) => !q.answer && !q.archived).map((q) => `<option value="${esc(q.id)}">${esc((q.text || "").slice(0, 80))}${(q.text || "").length > 80 ? "…" : ""}</option>`).join("") || `<option value="">No unanswered questions</option>`}
          </select>
          <label class="label" for="qt-answer-text">Answer text</label>
          <textarea id="qt-answer-text" class="input" name="answer" rows="4" ${canAnswer ? "required" : "disabled"} placeholder="Type ministerial response"></textarea>
          <button class="btn" type="submit" ${canAnswer ? "" : "disabled"}>Post Answer</button>
          ${canAnswer ? "" : `<p class="muted" style="margin-top:8px;">Only the assigned office, PM, Leader of the House, Speaker, mod, or admin can answer.</p>`}
        </form>
      </div>

      <div>
        <h3>Questions & Follow-ups</h3>
        ${officeQuestions.length
          ? officeQuestions.map((q) => renderQuestionLine(q, selectedOffice, canAnswer, canArchive, canDeleteQ, simLabel, data)).join("")
          : `<p class="muted">No questions in this department yet.</p>`}
      </div>
    </section>
  `;

  const submitForm = root.querySelector("#qt-submit-question-form");

  // Wire up poster-choice radio for staff
  if (canPostAsNpc && submitForm) {
    submitForm.querySelectorAll('input[name="qtPosterChoice"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        const npcFields = submitForm.querySelector("#qt-npc-fields");
        if (npcFields) npcFields.style.display = radio.value === "npc" ? "" : "none";
      });
    });
  }

  submitForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = submitForm.querySelector("[type='submit']");
    const errorEl = submitForm.querySelector("#qt-submit-error");
    const showError = (msg) => {
      if (errorEl) { errorEl.textContent = msg; errorEl.style.display = ""; }
    };
    const clearError = () => {
      if (errorEl) { errorEl.textContent = ""; errorEl.style.display = "none"; }
    };
    clearError();

    const fd = new FormData(submitForm);
    const text = String(fd.get("text") || "").trim();
    if (!text) {
      showError("Please enter your question text before submitting.");
      return;
    }

    const posterChoice = canPostAsNpc
      ? ((submitForm.querySelector('input[name="qtPosterChoice"]:checked') || {}).value || "character")
      : "character";
    const isNpcPost = canPostAsNpc && posterChoice === "npc";
    const npcName = isNpcPost ? String(fd.get("npcName") || "").trim() : "";
    const npcParty = isNpcPost ? String(fd.get("npcParty") || "").trim() : "";

    if (!isNpcPost && !askGate.ok) {
      showError(askGate.reason || "You are not permitted to submit a question at this time.");
      return;
    }

    if (isNpcPost) {
      if (!npcName) {
        showError("Please enter the NPC MP name.");
        return;
      }
      if (!npcParty) {
        showError("Please select the NPC party.");
        return;
      }
    }

    if (submitBtn) submitBtn.disabled = true;

    const char = getCurrentCharacter(data);
    const askedBy = isNpcPost ? npcName : (char?.display_name || char?.name || "Backbench MP");

    try {
      await apiSubmitQtQuestion({
        office_id:     selectedOffice.id,
        question_text: text,
        asked_by_name: askedBy,
        asked_at_sim:  simLabel,
        due_at_sim:    createDeadline(data.gameState, 1),
        ...(isNpcPost ? { npc_party: npcParty } : {}),
      });
      submitForm.reset();
      await reloadAndRender(data, state);
    } catch (err) {
      showError(err.message || "Failed to submit question. Please try again.");
      handleApiError(err, "Submit question");
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  const answerForm = root.querySelector("#qt-answer-form");
  answerForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!canAnswer) return;

    const fd = new FormData(answerForm);
    const questionId = String(fd.get("questionId") || "");
    const answer = String(fd.get("answer") || "").trim();
    if (!questionId || !answer) return;

    const target = data.questionTime.questions.find((q) => q.id === questionId && q.office === selectedOffice.id);
    if (!target || target.archived) return;

    try {
      await apiAnswerQtQuestion(questionId, {
        answer_text:  answer,
        answered_at_sim: simLabel,
      });
      logAction({ action: "question-answered", target: selectedOffice.title, details: { questionId } });
      await reloadAndRender(data, state);
    } catch (err) {
      handleApiError(err, "Answer question");
    }
  });

  root.querySelectorAll("[data-action='open-office']").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedOfficeId = btn.getAttribute("data-office-id") || selectedOffice.id;
      render(data, state);
    });
  });

  root.querySelectorAll(".qt-followup-form").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const qid = form.getAttribute("data-question-id");
      const text = String(new FormData(form).get("text") || "").trim();
      if (!qid || !text) return;

      const question = data.questionTime.questions.find((q) => q.id === qid);
      if (!question || question.archived || !question.answer) return;

      const char = getCurrentCharacter(data);
      const maxFollowUps = maxFollowUpsFor(data, question.office);
      if ((question.followUps || []).length >= maxFollowUps) return;
      // Shadow secretaries/ministers can only follow up in their own portfolio
      const fRole = normaliseRole(char?.role);
      if (fRole === "shadow" || fRole === "minister") {
        const currentOffices       = Array.isArray(char?.offices)       ? char.offices       : (char?.office       ? [char.office]       : []);
        const currentShadowOffices = Array.isArray(char?.shadowOffices) ? char.shadowOffices : (char?.shadowOffice ? [char.shadowOffice] : []);
        const expectedShadow = officeToShadowOfficeMap(question.office);
        const ok = (expectedShadow && currentShadowOffices.includes(expectedShadow)) || currentOffices.includes(question.office);
        if (!ok) return;
      }

      const submitBtn = form.querySelector("button[type='submit']");
      if (submitBtn) submitBtn.disabled = true;

      try {
        await apiFollowupQtQuestion(qid, {
          followup_text: text,
          asked_by_name: char?.display_name || char?.name || "Backbench MP",
          asked_at_sim:  simLabel,
        });
        await reloadAndRender(data, state);
      } catch (err) {
        handleApiError(err, "Submit follow-up");
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  });

  root.querySelectorAll(".qt-answer-followup-form").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fid = form.getAttribute("data-followup-id");
      const text = String(new FormData(form).get("text") || "").trim();
      if (!fid || !text || !canAnswer) return;

      const submitBtn = form.querySelector("button[type='submit']");
      if (submitBtn) submitBtn.disabled = true;

      try {
        await apiAnswerQtFollowup(fid, { answer_text: text });
        await reloadAndRender(data, state);
      } catch (err) {
        handleApiError(err, "Answer follow-up");
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  });

  root.querySelectorAll("[data-action='archive']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!canArchive) return;
      const qid = btn.getAttribute("data-question-id");
      if (!qid) return;
      btn.disabled = true;
      try {
        await apiPatchQtQuestion(qid, { status: "archived" });
        logAction({ action: "question-closed", target: qid, details: {} });
        await reloadAndRender(data, state);
      } catch (err) {
        handleApiError(err, "Close question");
        btn.disabled = false;
      }
    });
  });

  root.querySelectorAll("[data-action='demand']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!canArchive) return;
      const qid = btn.getAttribute("data-question-id");
      if (!qid) return;
      btn.disabled = true;
      try {
        await apiPatchQtQuestion(qid, { action: "speaker-demand", demand_due_at_sim: createDeadline(data.gameState, 1) });
        logAction({ action: "speaker-demand", target: qid, details: {} });
        await reloadAndRender(data, state);
      } catch (err) {
        handleApiError(err, "Speaker demand");
        btn.disabled = false;
      }
    });
  });

  root.querySelectorAll("[data-action='quick-answer']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const qid = btn.getAttribute("data-question-id");
      const select = root.querySelector("#qt-answer-question-id");
      if (qid && select) select.value = qid;
      const answerBox = root.querySelector("#qt-answer-text");
      answerBox?.focus();
    });
  });

  root.querySelectorAll("[data-action='delete-question']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!canDeleteQ) return;
      const qid = btn.getAttribute("data-question-id");
      if (!qid) return;
      btn.disabled = true;
      try {
        await apiDeleteQtQuestion(qid);
        await reloadAndRender(data, state);
      } catch (err) {
        handleApiError(err, "Delete question");
        btn.disabled = false;
      }
    });
  });
}

/**
 * Map a DB row from GET /api/qt/questions to the question shape used by render().
 */
function dbRowToQuestion(row) {
  // due_at_sim is stored as a JSON string '{"month":9,"year":1997}'; parse it for deadline comparisons.
  const parseDueAtSim = (raw) => {
    if (!raw) return null;
    if (typeof raw === "object") return raw;
    try {
      const p = JSON.parse(raw);
      if (p && Number.isInteger(p.month) && p.month >= 1 && p.month <= 12 &&
          Number.isInteger(p.year)  && p.year  >= 1990) return p;
    } catch {}
    return null;
  };
  // Parse and format asked_at_sim / answered_at_sim (stored as JSON strings like '{"month":9,"year":1997}')
  const formatStoredSimDate = (raw) => {
    if (!raw) return "";
    if (typeof raw === "string") {
      try {
        const p = JSON.parse(raw);
        if (p && Number.isInteger(p.month) && Number.isInteger(p.year)) return formatSimDate(p);
      } catch {}
    }
    if (typeof raw === "object" && raw !== null && Number.isInteger(raw.month)) return formatSimDate(raw);
    return String(raw);
  };
  const followUps = (row.followups || []).map((f) => ({
    id:          f.id,
    text:        f.followup_text,
    answer:      f.answer_text || "",
    askedBy:     f.asked_by_display_name || f.asked_by_name || "MP",
    askedByRole: "backbencher",
    askedAtSim:  formatStoredSimDate(f.asked_at_sim),
  }));
  return {
    id:                  row.id,
    office:              row.office_id,
    askedBy:             row.asked_by_display_name || row.asked_by_name || "MP",
    askedAtSim:          formatStoredSimDate(row.asked_at_sim),
    createdAtTs:         row.created_at ? new Date(row.created_at).getTime() : 0,
    dueAtSim:            parseDueAtSim(row.due_at_sim),
    text:                row.question_text,
    answer:              row.answer_text || "",
    answeredAtSim:       row.answered_at_sim || "",
    status:              row.status,
    archived:            row.status === "archived",
    followUps,
    speakerDemandedAtTs: row.speaker_demanded_at ? new Date(row.speaker_demanded_at).getTime() : 0,
    demandDueAtSim:      parseDueAtSim(row.demand_due_at_sim),
    speakerDemandAvailable: false, // computed later in render
    answerSeenByAsker:   false,
    npc:                 !!row.npc_party,
    npcParty:            row.npc_party || "",
  };
}

/**
 * Initialise the Question Time page using the DB-backed /api/qt/* endpoints.
 * All submissions, answers, follow-ups, follow-up answers, closures, and
 * speaker demands are persisted to the database immediately.
 */
export async function initQuestionTimePage(data) {
  normaliseQuestionTime(data);

  // Load all questions from DB (authoritative)
  try {
    const { questions: rows } = await apiGetQtQuestions();
    data.questionTime.questions = rows.map(dbRowToQuestion);
  } catch (err) {
    console.error("[questiontime] DB load failed:", err);
    data.questionTime.questions = [];
  }

  normaliseQuestionTime(data);

  const state = { selectedOfficeId: data.questionTime.offices[0]?.id || null };
  render(data, state);
}
