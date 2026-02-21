import { saveData } from "../core.js";
import { esc } from "../ui.js";
import { isAdmin, isMod, isSpeaker, canAnswerQuestionTime } from "../permissions.js";
import { formatSimMonthYear, createDeadline, isDeadlinePassed, simDateToObj, getSimDate, countdownToSimMonth } from "../clock.js";
import { logAction } from "../audit.js";

function nowId(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function getCurrentCharacter(data) {
  return data?.currentCharacter || data?.currentPlayer || {};
}

function canModerate(data) {
  return isAdmin(data) || isMod(data) || isSpeaker(data);
}

function canAnswerOffice(data, officeId) {
  return canAnswerQuestionTime(data, officeId);
}

function normaliseQuestionTime(data) {
  data.questionTime ??= {};
  data.questionTime.offices ??= [];
  data.questionTime.questions ??= [];
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
  const role = normaliseRole(char?.role);
  const asker = String(char?.name || "").trim();
  if (!asker) return { ok: false, reason: "Create/select a character before asking questions." };

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
    const currentShadowOffice = String(char?.shadowOffice || "");
    const currentOffice = String(char?.office || "");
    const matchesShadow = expectedShadowOffice && currentShadowOffice === expectedShadowOffice;
    const matchesMinister = currentOffice && currentOffice === officeId;
    if (!matchesShadow && !matchesMinister) {
      return { ok: false, reason: "Shadow Secretaries/Ministers may only ask within their own portfolio." };
    }
  }

  if (role === "backbencher" && unansweredByAsker.length >= 3) {
    return { ok: false, reason: "Backbenchers may hold at most 3 outstanding questions across all ministers." };
  }

  return { ok: true, reason: "" };
}

function maxFollowUpsFor(data, officeId, askedRole) {
  const role = normaliseRole(askedRole || getCurrentCharacter(data)?.role);
  if (officeId === "prime-minister") {
    if (role === "leader-opposition") return 3;
    if (role === "party-leader-3rd-4th") return 2;
    return 1;
  }
  if (role === "shadow" || role === "minister") return 2;
  return 1;
}

function renderQuestionLine(question, office, canAnswer, canArchive, simLabel, data) {
  const followUps = Array.isArray(question.followUps) ? question.followUps : [];
  const maxFollowUps = maxFollowUpsFor(data, question.office, question.askedRole);
  const canAskFollowUp = !!question.answer && !question.archived && followUps.length < maxFollowUps;

  return `
    <article class="tile" style="margin-bottom:10px;">
      <div class="meta" style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
        <span><b>${esc(question.askedBy || "MP")}</b> • ${esc(question.askedAtSim || simLabel)}</span>
        <span>${esc(questionStatus(question))}</span>
      </div>
      <p style="margin:8px 0;"><b>Q:</b> ${esc(question.text || "")}</p>
      ${question.answer ? `<p style="margin:8px 0;"><b>A:</b> ${esc(question.answer)}</p>` : `<p class="muted" style="margin:8px 0;">Awaiting response from ${esc(office.holder || office.title)}.</p>`}

      ${followUps.map((f) => `
        <div style="border-top:1px solid #ddd;padding-top:8px;margin-top:8px;">
          <p style="margin:6px 0;"><b>Follow-up:</b> ${esc(f.text || "")}</p>
          <p class="muted" style="margin:6px 0;">Asked by ${esc(f.askedBy || "MP")} • ${esc(f.askedAtSim || simLabel)}</p>
          ${f.answer ? `<p style="margin:6px 0;"><b>Answer:</b> ${esc(f.answer)}</p>` : `<p class="muted" style="margin:6px 0;">Awaiting clarification response.</p>`}
        </div>
      `).join("")}

      ${canAskFollowUp ? `
        <form class="qt-followup-form" data-question-id="${esc(question.id)}" style="margin-top:10px;">
          <label class="label" for="followup-${esc(question.id)}">Set follow-up / clarification (${followUps.length}/${maxFollowUps})</label>
          <textarea id="followup-${esc(question.id)}" name="text" rows="2" class="input" placeholder="Enter follow-up question"></textarea>
          <button class="btn" type="submit">Submit follow-up</button>
        </form>
      ` : ""}

      ${canArchive && !question.archived && !question.answer && question.speakerDemandAvailable && !question.speakerDemandedAtTs ? `<button class="btn" data-action="demand" data-question-id="${esc(question.id)}" type="button">Speaker Demand: Answer within 1 sim month</button>` : ""}
      ${canArchive && !question.archived ? `<button class="btn" data-action="archive" data-question-id="${esc(question.id)}" type="button">Close Question (Mod/Speaker)</button>` : ""}
      ${canAnswer && !question.archived && !question.answer ? `<button class="btn" data-action="quick-answer" data-question-id="${esc(question.id)}" type="button">Answer This Question</button>` : ""}
    </article>
  `;
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
  const askGate = canAskMainQuestion(data, selectedOffice.id);

  const officeQuestions = questions
    .filter((q) => q.office === selectedOffice.id)
    .sort((a, b) => (a.archived === b.archived ? 0 : a.archived ? 1 : -1));

  officeQuestions.forEach((q) => {
    if (q.id === urlQuestionId && q.answer && !q.answerSeenByAsker && String(q.askedBy || "") === String(getCurrentCharacter(data)?.name || "")) {
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
      <p>Secretaries have <b>1 simulation month</b> to answer. After that, the Speaker may issue a demand for answer within <b>1 more simulation month</b>. Mod/Speaker closes questions after checks.</p>
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
              <div class="tile-bottom"><button class="btn" type="button" data-action="open-office" data-office-id="${esc(o.id)}">Open</button></div>
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
          <textarea id="qt-question-text" class="input" name="text" rows="4" required placeholder="Type your parliamentary question" ${askGate.ok ? "" : "disabled"}></textarea>
          <button class="btn" type="submit" ${askGate.ok ? "" : "disabled"}>Submit Question</button>
          ${askGate.ok ? "" : `<p class="muted" style="margin-top:8px;">${esc(askGate.reason)}</p>`}
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
          ? officeQuestions.map((q) => renderQuestionLine(q, selectedOffice, canAnswer, canArchive, simLabel, data)).join("")
          : `<p class="muted">No questions in this department yet.</p>`}
      </div>
    </section>
  `;

  const submitForm = root.querySelector("#qt-submit-question-form");
  submitForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!askGate.ok) return;
    const fd = new FormData(submitForm);
    const text = String(fd.get("text") || "").trim();
    if (!text) return;

    const char = getCurrentCharacter(data);
    data.questionTime.questions.unshift({
      id: nowId("qt"),
      office: selectedOffice.id,
      askedBy: char?.name || "Backbench MP",
      askedRole: normaliseRole(char?.role || "backbencher"),
      askedAtSim: simLabel,
      createdAtTs: Date.now(),
      dueAtSim: createDeadline(data.gameState, 1),
      text,
      status: "submitted",
      answer: "",
      followUps: [],
      archived: false,
      answerSeenByAsker: false,
      speakerDemandedAtTs: 0,
      speakerDemandAvailable: false
    });

    saveData(data);
    render(data, state);
  });

  const answerForm = root.querySelector("#qt-answer-form");
  answerForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!canAnswer) return;

    const fd = new FormData(answerForm);
    const questionId = String(fd.get("questionId") || "");
    const answer = String(fd.get("answer") || "").trim();
    if (!questionId || !answer) return;

    const target = data.questionTime.questions.find((q) => q.id === questionId && q.office === selectedOffice.id);
    if (!target || target.archived) return;

    if (!target.answer) {
      target.answer = answer;
      target.answeredAtSim = simLabel;
      target.status = "answered";
      target.answerSeenByAsker = false;
      logAction({ action: "question-answered", target: selectedOffice.title, details: { questionId, askedBy: target.askedBy } });
    }

    saveData(data);
    render(data, state);
  });

  root.querySelectorAll("[data-action='open-office']").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedOfficeId = btn.getAttribute("data-office-id") || selectedOffice.id;
      render(data, state);
    });
  });

  root.querySelectorAll(".qt-followup-form").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const qid = form.getAttribute("data-question-id");
      const text = String(new FormData(form).get("text") || "").trim();
      if (!qid || !text) return;

      const question = data.questionTime.questions.find((q) => q.id === qid);
      if (!question || question.archived || !question.answer) return;

      const char = getCurrentCharacter(data);
      const maxFollowUps = maxFollowUpsFor(data, question.office, question.askedRole);
      question.followUps ??= [];
      if (question.followUps.length >= maxFollowUps) return;

      question.followUps.push({
        id: nowId("qtf"),
        text,
        askedBy: char?.name || "Backbench MP",
        askedByRole: normaliseRole(char?.role || "backbencher"),
        askedAtSim: simLabel,
        answer: ""
      });

      saveData(data);
      render(data, state);
    });
  });

  root.querySelectorAll("[data-action='archive']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!canArchive) return;
      const qid = btn.getAttribute("data-question-id");
      const question = data.questionTime.questions.find((q) => q.id === qid);
      if (!question) return;
      question.archived = true;
      question.status = "closed";
      question.archivedAtSim = simLabel;
      logAction({ action: "question-closed", target: qid, details: { office: question.office, askedBy: question.askedBy } });
      saveData(data);
      render(data, state);
    });
  });

  root.querySelectorAll("[data-action='demand']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!canArchive) return;
      const qid = btn.getAttribute("data-question-id");
      const question = data.questionTime.questions.find((q) => q.id === qid);
      if (!question || question.answer || question.archived) return;
      question.speakerDemandedAtTs = Date.now();
      question.speakerDemandedAtSim = simLabel;
      question.demandDueAtSim = createDeadline(data.gameState, 1);
      question.speakerDemandAvailable = false;
      logAction({ action: "speaker-demand", target: qid, details: { office: question.office, askedBy: question.askedBy } });
      saveData(data);
      render(data, state);
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
}

export function initQuestionTimePage(data) {
  const state = { selectedOfficeId: data?.questionTime?.offices?.[0]?.id || null };
  render(data, state);
}
