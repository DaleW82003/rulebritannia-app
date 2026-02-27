import { ensureDivision, castDivisionVote, tallyDivision, closeDivision, resolveDivisionResult, setNpcVotes, setRebellions } from "../engines/division-engine.js";
import { buildDivisionWeights } from "../divisions.js";
import { isAdmin, isMod, canAdminOrMod, canAdminModOrSpeaker } from "../permissions.js";
import { esc } from "../ui.js";
import { createDeadline, isDeadlinePassed, simMonthsRemaining, countdownToSimMonth, formatSimMonthYear } from "../clock.js";
import { logAction } from "../audit.js";
import {
  apiCreateDebateTopic, apiGetBill, apiBillVote,
  apiBillFirstReading, apiBillSubmitReport, apiBillWithdraw, apiBillGrantAssent,
  apiBillOpenFinalDivision, apiGetBillAmendments, apiSubmitBillAmendment,
  apiBillAmendmentDecide, apiBillAmendmentSupport,
  apiGetDivisionForEntity, apiCastVote, apiCloseDivision, apiSetNpcVotes,
  apiUpdateBill, apiDeleteBill,
} from "../api.js";
import { handleApiError } from "../errors.js";
import { toastSuccess, toastError } from "../components/toast.js";

function $(id) {
  return document.getElementById(id);
}

const DIVISION_STAGES = new Set(["Final Division"]);
const AMENDMENT_LOCK_STAGES = new Set(["Final Division", "Royal Assent"]);

const STAGE_DURATION_MONTHS = {
  "Second Reading": 2,
  "Report Stage": 1,
  "Report Debate": 2,
  "Final Division": 1
};

function getBillIdFromUrl() {
  const u = new URL(window.location.href);
  return u.searchParams.get("id");
}

function getCurrentCharacter(data) {
  return data?.currentCharacter || data?.currentPlayer || null;
}

function canManageLegislativeAgenda(data) {
  const c = getCurrentCharacter(data);
  if (!c) return false;
  return c.office === "prime-minister" || c.office === "leader-commons";
}

function isSpeaker(data) {
  const c = getCurrentCharacter(data);
  return Boolean(c?.isSpeaker || data?.currentUser?.isSpeaker || data?.currentUser?.roles?.includes("speaker"));
}

function canProposeAmendment(data) {
  const role = getCurrentCharacter(data)?.role;
  return ["backbencher", "minister", "shadow", "leader-opposition", "party-leader-3rd-4th", "prime-minister"].includes(role);
}

function billTypeLabel(t) {
  if (t === "government") return "Government Bill";
  if (t === "opposition") return "Opposition Bill";
  if (t === "pmb") return "Private Member’s Bill";
  return "Bill";
}

function msToHuman(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "Closed";
  const sec = Math.floor(ms / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function stageCountdown(bill, gameState) {
  if (bill?.stageDeadlineSim) {
    return countdownToSimMonth(bill.stageDeadlineSim.month, bill.stageDeadlineSim.year, gameState);
  }
  const start = Number(bill?.stageStartedAt);
  const dur = Number(bill?.stageDurationMs);
  if (!Number.isFinite(start) || !Number.isFinite(dur) || dur <= 0) return "—";
  return msToHuman(start + dur - Date.now());
}


function canGrantAssent(data) {
  return canAdminOrMod(data);
}

function finaliseDivisionOutcome(bill, data) {
  const division = ensureDivision(bill);
  if (division.status !== "closed") return false;

  if (["passed", "failed", "stalled", "awaiting-assent"].includes(String(bill.status || "")) && bill.divisionOutcome) {
    return false;
  }

  const result = resolveDivisionResult(bill, data);
  if (result === "tied") return false;

  bill.divisionOutcome = result;
  bill.divisionResolvedAt = Number(division.closedAt || Date.now());
  bill.finalStage = bill.finalStage || "Final Division";

  if (result === "passed") {
    bill.status = "awaiting-assent";
    bill.stage = "Passed - Awaiting Assent";
    bill.awaitingAssentSince = bill.divisionResolvedAt;
  } else {
    bill.status = "failed";
    bill.stage = "Defeated in Division";
  }

  return true;
}

function grantRoyalAssent(bill) {
  bill.status = "passed";
  bill.stage = "Act (Royal Assent Granted)";
  bill.finalStage = "Royal Assent";
  bill.legislationKind = "Act of Parliament";
  bill.royalAssentGrantedAt = Date.now();
  if (!bill.divisionResolvedAt) bill.divisionResolvedAt = bill.royalAssentGrantedAt;
  bill.title = String(bill.title || "").replace(/\bbill\b/ig, "Act");
}

function partyOfCurrent(data) {
  return getCurrentCharacter(data)?.party || "Independent";
}

function setDebateLink(bill) {
  const btn = $("debateBtn");
  if (!btn) return;
  const url = bill?.debate?.topicUrl || bill?.discourse_topic_url || bill?.discourseTopicUrl || bill?.debateUrl || bill?.discourseUrl || null;
  if (url) {
    btn.href = url;
    btn.hidden = false;
  } else {
    btn.hidden = true;
  }
}

function ensureBillDebateTopic(bill, data) {
  if (bill.discourseTopicId || bill.discourse_topic_id || bill.debate?.topicId) return;
  const raw = `**${bill.title}**\nIntroduced by ${bill.author || "Unknown"}${bill.department ? ` (${bill.department})` : ""}.\n\n*This is the Second Reading debate thread for this bill.*`;
  apiCreateDebateTopic({ entityType: "bill", entityId: bill.id, title: `Second Reading: ${bill.title}`, raw })
    .then(({ topicId, topicUrl }) => { // UI_ONLY_OK: Discourse side-write; fires after bill creation, outer .catch() handles failures
      bill.debate = { ...(bill.debate || {}), topicId, topicUrl };
      bill.discourseTopicId = topicId;
      bill.discourse_topic_id = topicId;
      bill.discourse_topic_url = topicUrl;
      const idx = data.orderPaperCommons.findIndex((b) => b.id === bill.id);
      if (idx >= 0) data.orderPaperCommons[idx] = bill;
      apiUpdateBill(bill.id, bill).catch((err) => console.error("[bill] discourse update failed:", err)); // UI_ONLY_OK: inside Discourse .then() callback; metadata-only side-write with outer .catch() error handler
      setDebateLink(bill);
    })
    .catch((err) => handleApiError(err, "Debate topic")); // UI_ONLY_OK: terminal error handler for the Discourse topic creation chain
}

function renderBillMeta(bill, data) {
  const h1 = $("billTitle");
  const meta = $("billMeta");
  if (h1) h1.textContent = bill.title;
  if (!meta) return;

  const canManage = canManageLegislativeAgenda(data);
  const canDeleteBill = canAdminModOrSpeaker(data);
  const canStaff = canAdminModOrSpeaker(data);
  const isStage = (s) => bill.stage === s;
  const concluded = ["failed", "passed", "withdrawn"].includes(String(bill.status || ""));

  const typeOptions = [
    ["government", "Government Bill"],
    ["opposition", "Opposition Bill"],
    ["pmb", "Private Member's Bill"]
  ];

  meta.innerHTML = `
    <div class="spaced">
      <div>
        <div class="bill-title">${esc(bill.title)}</div>
        <div class="bill-sub">${esc(bill.author || "—")} • ${esc(bill.department || "—")}</div>
      </div>
      <div class="badges">
        <span class="bill-badge">${esc(billTypeLabel(bill.billType))}</span>
        <span class="bill-badge ${bill.stage === "Withdrawn" ? "badge-withdrawn" : ""}">${esc(bill.stage || "—")}</span>
        ${bill.stageDeadlineSim ? `<span class="bill-badge">Stage ends: ${esc(stageCountdown(bill, data.gameState))}</span>` : ""}
        ${bill.reportContent ? `<details class="bill-report-detail"><summary>📋 Report submitted</summary><p>${esc(bill.reportContent)}</p>${bill.reportAttachmentUrl ? `<a href="${esc(bill.reportAttachmentUrl)}" target="_blank" rel="noopener">View attachment</a>` : ""}</details>` : ""}
      </div>
    </div>
    <p id="meta-msg" class="muted" style="margin:4px 0;"></p>

    ${canManage && isStage("First Reading") ? `
      <hr>
      <div class="form-grid" id="agenda-controls">
        <label>First Reading Decision</label>
        <div class="tile-bottom" style="padding-top:0; margin-top:0;">
          <button type="button" class="btn" data-agenda="grant-second-reading">Grant Second Reading</button>
          <button type="button" class="btn danger" data-agenda="refuse-second-reading">Refuse Second Reading</button>
        </div>
        <label>Bill Type</label>
        <div>
          <select id="billTypeSelect">
            ${typeOptions.map(([v, label]) => `<option value="${v}" ${bill.billType === v ? "selected" : ""}>${esc(label)}</option>`).join("")}
          </select>
        </div>
      </div>
      <p class="small">Leader of the House / Prime Minister controls for this account.</p>
    ` : ""}

    ${canStaff && isStage("Report Stage") ? `
      <hr>
      <div id="report-form-wrap">
        <h3 style="margin:0 0 8px;">Submit Report for Report Stage</h3>
        <p class="muted small">Submitting this report will advance the bill to Report Debate (2 sim months).</p>
        <form id="report-form" class="form-grid">
          <label for="reportContent">Report content</label>
          <textarea id="reportContent" rows="5" placeholder="Paste or write the committee report here..."></textarea>
          <label for="reportAttachment">Attachment URL (optional)</label>
          <input id="reportAttachment" type="url" placeholder="https://...">
          <div></div>
          <div><button class="btn primary" type="submit">Submit Report &amp; Advance to Report Debate</button></div>
        </form>
      </div>
    ` : ""}

    ${canStaff && isStage("Final Division") && !bill.formalDivisionId ? `
      <hr>
      <div class="tile-bottom" style="padding-top:0;margin-top:0;">
        <button type="button" class="btn primary" data-agenda="open-final-division">Open Final Division</button>
      </div>
      <p class="small">Admin / Mod / Speaker: opens the weighted division for this bill.</p>
    ` : ""}

    ${canGrantAssent(data) && bill.status === "awaiting-assent" ? `
      <hr>
      <div class="tile-bottom" style="padding-top:0;margin-top:0;">
        <button type="button" class="btn" data-agenda="grant-assent">Grant Royal Assent</button>
      </div>
      <p class="small">Moderator / admin action required to convert this bill into an Act.</p>
    ` : ""}

    ${!concluded ? `
      <hr>
      <div class="tile-bottom" style="padding-top:0;margin-top:0;">
        <button type="button" class="btn danger" data-agenda="withdraw-bill">Withdraw Bill</button>
        ${canDeleteBill ? '<button type="button" class="btn danger" data-agenda="delete-bill">Delete Bill</button>' : ""}
      </div>
      <p class="small">Author / PM can withdraw. Admin / Mod / Speaker can delete permanently.</p>
    ` : canDeleteBill ? `
      <hr>
      <div class="tile-bottom" style="padding-top:0;margin-top:0;">
        <button type="button" class="btn danger" data-agenda="delete-bill">Delete Bill</button>
      </div>
    ` : ""}

    ${canStaff ? `
      <hr>
      <h3 style="margin:0 0 8px;">Edit Bill (Staff)</h3>
      <form id="bill-edit-form" class="form-grid">
        <label for="bill-edit-title">Title</label>
        <input id="bill-edit-title" name="title" value="${esc(bill.title || "")}">
        <label for="bill-edit-author">Author</label>
        <input id="bill-edit-author" name="author" value="${esc(bill.author || "")}">
        <label for="bill-edit-dept">Department</label>
        <input id="bill-edit-dept" name="department" value="${esc(bill.department || "")}">
        <label for="bill-edit-text">Bill text</label>
        <textarea id="bill-edit-text" rows="10" name="billText">${esc(bill.billText || "")}</textarea>
        <div></div>
        <button class="btn" type="submit">Save Edits</button>
      </form>
      <p id="bill-edit-msg" class="muted" style="margin:4px 0;"></p>
    ` : ""}
  `;

  const msgEl = () => meta.querySelector("#meta-msg");
  const showMsg = (m) => { const el = msgEl(); if (el) el.textContent = m; };

  if (canManage) {
    meta.querySelector('[data-agenda="grant-second-reading"]')?.addEventListener("click", async () => {
      showMsg("Processing…");
      try {
        const result = await apiBillFirstReading(bill.id, "grant");
        Object.assign(bill, result.bill);
        persistAndRerender(data, bill);
        ensureBillDebateTopic(bill, data);
      } catch (err) { showMsg(`Error: ${err.message}`); }
    });

    meta.querySelector('[data-agenda="refuse-second-reading"]')?.addEventListener("click", async () => {
      showMsg("Processing…");
      try {
        const result = await apiBillFirstReading(bill.id, "refuse");
        Object.assign(bill, result.bill);
        persistAndRerender(data, bill);
      } catch (err) { showMsg(`Error: ${err.message}`); }
    });

    meta.querySelector("#billTypeSelect")?.addEventListener("change", (ev) => {
      bill.billType = ev.target.value;
      persistAndRerender(data, bill, false);
    });
  }

  meta.querySelector("#report-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    showMsg("Submitting report…");
    const content = meta.querySelector("#reportContent")?.value?.trim() || null;
    const attachmentUrl = meta.querySelector("#reportAttachment")?.value?.trim() || null;
    try {
      const result = await apiBillSubmitReport(bill.id, { content, attachmentUrl });
      Object.assign(bill, result.bill);
      persistAndRerender(data, bill);
    } catch (err) { showMsg(`Error: ${err.message}`); }
  });

  meta.querySelector('[data-agenda="open-final-division"]')?.addEventListener("click", async () => {
    showMsg("Opening final division…");
    try {
      const result = await apiBillOpenFinalDivision(bill.id);
      bill.formalDivisionId = result.division.id;
      persistAndRerender(data, bill);
    } catch (err) { showMsg(`Error: ${err.message}`); }
  });

  meta.querySelector('[data-agenda="grant-assent"]')?.addEventListener("click", async () => {
    if (!canGrantAssent(data) || bill.status !== "awaiting-assent") return;
    showMsg("Granting Royal Assent…");
    try {
      const result = await apiBillGrantAssent(bill.id);
      Object.assign(bill, result.bill);
      persistAndRerender(data, bill);
    } catch (err) { showMsg(`Error: ${err.message}`); }
  });

  meta.querySelector('[data-agenda="withdraw-bill"]')?.addEventListener("click", async () => {
    if (!confirm("Are you sure you want to withdraw this bill?")) return;
    showMsg("Withdrawing…");
    try {
      const result = await apiBillWithdraw(bill.id);
      Object.assign(bill, result.bill);
      persistAndRerender(data, bill);
    } catch (err) { showMsg(`Error: ${err.message}`); }
  });

  meta.querySelector('[data-agenda="delete-bill"]')?.addEventListener("click", async () => {
    if (!canDeleteBill) return;
    showMsg("Deleting…");
    try {
      await apiDeleteBill(bill.id);
    } catch (err) {
      showMsg(`Error: ${err.message}`);
      return;
    }
    data.orderPaperCommons = (data.orderPaperCommons || []).filter((b) => b.id !== bill.id);
    window.location.href = "dashboard.html";
  });

  meta.querySelector("#bill-edit-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!canStaff) return;
    const editMsg = meta.querySelector("#bill-edit-msg");
    if (editMsg) editMsg.textContent = "Saving…";
    const fd = new FormData(ev.currentTarget);
    const title = String(fd.get("title") || "").trim();
    const author = String(fd.get("author") || "").trim();
    const department = String(fd.get("department") || "").trim();
    const billText = String(fd.get("billText") || "").trim();
    if (title) bill.title = title;
    if (author) bill.author = author;
    if (department) bill.department = department;
    if (billText) bill.billText = billText;
    try {
      await apiUpdateBill(bill.id, bill);
    } catch (err) {
      if (editMsg) editMsg.textContent = `Error: ${err.message}`;
      return;
    }
    persistAndRerender(data, bill);
    if (editMsg) editMsg.textContent = "Saved.";
  });
}

function renderBillText(bill) {
  const root = $("billText");
  if (!root) return;
  root.innerHTML = `<pre style="white-space:pre-wrap; margin:0; font:inherit;">${esc(bill.billText || "No bill text loaded.")}</pre>`;
}


function parseArticlesFromBillText(text = "") {
  const lines = String(text || "").split("\n");
  const out = [];
  let current = null;
  lines.forEach((line) => {
    const m = line.match(/^ARTICLE\s+(\d+)\s+—\s+(.+)$/i);
    if (m) {
      if (current) out.push(current);
      current = { number: Number(m[1]), heading: m[2], body: [] };
    } else if (current) {
      current.body.push(line);
    }
  });
  if (current) out.push(current);
  return out.map((a) => ({ ...a, text: a.body.join("\n").trim() }));
}

function serializeBillTextWithArticles(originalText, articles) {
  const lines = String(originalText || "").split("\n");
  const header = [];
  let i = 0;
  for (; i < lines.length; i += 1) {
    if (/^ARTICLE\s+\d+\s+—\s+.+$/i.test(lines[i])) break;
    header.push(lines[i]);
  }
  const finalIdx = lines.findIndex((l) => /^FINAL ARTICLE\s+—/i.test(l));
  const finalPart = finalIdx >= 0 ? lines.slice(finalIdx).join("\n") : "";
  const body = articles.map((a) => ["", `ARTICLE ${a.number} — ${a.heading}`, a.text].join("\n")).join("\n");
  return `${header.join("\n")}\n${body}\n\n${finalPart}`.trim();
}

function canAuthorManageAmendments(bill, data) {
  const c = getCurrentCharacter(data);
  return String(c?.name || "") && String(c?.name || "") === String(bill.author || "");
}

function isPartyLeader(char = {}) {
  return ["leader-opposition", "party-leader-3rd-4th", "prime-minister"].includes(String(char.role || ""));
}

function ensureBillStageTimers(bill, gameState) {
  bill.stageStartedAt = Number(bill.stageStartedAt || Date.now());
  if (!bill.stageDeadlineSim && STAGE_DURATION_MONTHS[bill.stage] && gameState) {
    bill.stageDeadlineSim = createDeadline(gameState, STAGE_DURATION_MONTHS[bill.stage]);
  }
}

function getPlayablePartyVotesExpected(data) {
  const { effectiveWeights, partyByName } = buildDivisionWeights(data);
  const playableSet = new Set((data?.parliament?.parties || []).filter((p) => p.playable).map((p) => p.name));
  return Object.entries(effectiveWeights).filter(([name, weight]) => Number(weight) > 0 && playableSet.has(String(partyByName[name] || ""))).length;
}

function getCurrentVoteWeight(data, name, party, rebelsByParty = {}) {
  const { effectiveWeights } = buildDivisionWeights(data);
  const raw = Number(effectiveWeights[String(name || "")] || 0);
  if (raw <= 0) return 0;
  const partyWeight = Math.max(0, Number((data?.parliament?.parties || []).find((p) => p.name === party)?.seats || 0) - Number(rebelsByParty[party] || 0));
  const partyMembersWithWeight = Object.entries(effectiveWeights).filter(([actorName, weight]) => Number(weight) > 0 && String((Array.isArray(data?.players) ? data.players : []).find((p) => p.name === actorName)?.party || "") === String(party || ""));
  const partyRawTotal = partyMembersWithWeight.reduce((sum, [, weight]) => sum + Number(weight || 0), 0);
  if (partyRawTotal <= 0) return 0;
  return (raw / partyRawTotal) * partyWeight;
}

function getAutoAbstainNpcParties(parties = []) {
  return parties.filter((p) => /sinn\s*f[ée]in/i.test(String(p.name || "")) && Number(p.seats || 0) > 0);
}

function maybeAutoCloseDivision(bill, data) {
  const division = ensureDivision(bill);
  if (division.status !== "open") return false;
  const simExpired = division.closesAtSim && isDeadlinePassed(division.closesAtSim, data.gameState);
  const msExpired = !division.closesAtSim && Number(division.closesAt || 0) <= Date.now();
  if (simExpired || msExpired) {
    closeDivision(bill);
    finaliseDivisionOutcome(bill, data);
    return true;
  }
  const parties = Array.isArray(data?.parliament?.parties) ? data.parliament.parties : [];
  const playableSet = new Set(parties.filter((p) => p.playable).map((p) => p.name));
  const expectedPlayableVotes = getPlayablePartyVotesExpected(data);
  const actualPlayableVotes = Object.values(division.votes || {}).filter((v) => playableSet.has(String(v.party || ""))).length;
  const npcPartiesWithSeats = parties.filter((p) => !p.playable && Number(p.seats || 0) > 0).length;
  const autoAbstainNpc = new Set(getAutoAbstainNpcParties(parties).map((p) => p.name));
  const npcVotesNeeded = parties.filter((p) => !p.playable && Number(p.seats || 0) > 0 && !autoAbstainNpc.has(p.name)).length;
  const npcSetVotes = Object.keys(division.npcVotes || {}).filter((party) => Number((parties.find((p) => p.name === party) || {}).seats || 0) > 0 && !autoAbstainNpc.has(party)).length;
  if (expectedPlayableVotes > 0 && actualPlayableVotes >= expectedPlayableVotes && npcSetVotes >= npcVotesNeeded) {
    closeDivision(bill);
    finaliseDivisionOutcome(bill, data);
    return true;
  }
  return false;
}

function amendmentRow(a, supporters = []) {
  const statusLabels = {
    "proposed": "Proposed",
    "accepted": "✅ Accepted",
    "refused": "❌ Refused",
    "in-division": "🗳️ In Division",
    "withdrawn": "Withdrawn",
  };
  return `
    <div class="docket-item" data-am-id="${esc(a.id || a.amendment_id || "")}">
      <div class="docket-left">
        <div class="docket-icon">✍️</div>
        <div>
          <div class="docket-title">${esc(a.id || a.amendment_id || "")} · Article ${esc(String(a.articleNumber ?? a.article_number ?? "—"))}: ${esc(a.title || "Untitled amendment")}</div>
          <div class="docket-detail">${esc(a.amendment_type || a.type || "change")} • By ${esc(a.proposedByName || a.proposed_by_name || "Unknown")} (${esc(a.proposedBy || a.proposed_by_party || "—")}) • ${esc(statusLabels[a.status] || a.status || "proposed")}</div>
          <div class="small" style="margin-top:6px;">${esc(a.text || "")}</div>
          ${supporters.length ? `<div class="small muted">Leader support: ${supporters.map((s) => esc(s)).join(", ")}</div>` : ""}
        </div>
      </div>
    </div>
  `;
}

async function renderAmendments(bill, data) {
  const root = $("amendmentsList");
  if (!root) return;

  const char = getCurrentCharacter(data);
  const canStaff = canAdminModOrSpeaker(data);
  const canAuthorAct = String(char?.name || "") && String(char?.name || "") === String(bill.author || "");
  const isLeader = isPartyLeader(char || {});

  // Load amendments from DB (authoritative source)
  let amendments = [];
  try {
    const res = await apiGetBillAmendments(bill.id);
    amendments = res?.amendments || [];
  } catch (_) {
    // Fallback to inline amendments if DB fails
    amendments = (bill.amendments || []).map((a) => ({ ...a, amendment_type: a.type, article_number: a.articleNumber, proposed_by_name: a.proposedByName, proposed_by_party: a.proposedBy, supporter_parties: a.supporters || [] }));
  }

  // Amendment window: only open in first 1.5 sim months of Second Reading / Report Debate
  const AMEND_STAGES = new Set(["Second Reading", "Report Debate"]);
  const inAmendStage = AMEND_STAGES.has(bill.stage);
  // Window closes when < 1 sim month remains (see server AMENDMENT_ALLOWED_STAGES logic)
  const remaining = bill.stageDeadlineSim ? simMonthsRemaining(bill.stageDeadlineSim, data.gameState) : 99;
  const amendWindowOpen = inAmendStage && remaining >= 1;
  const canSubmit = canProposeAmendment(data) && amendWindowOpen;

  const articles = parseArticlesFromBillText(bill.billText || "");

  const pendingProposed = amendments.filter((a) => a.status === "proposed");
  const pendingDivisions = amendments.filter((a) => a.status === "in-division");

  root.innerHTML = `
    <div class="docket-list">
      ${amendments.length ? amendments.map((a) => amendmentRow(a, a.supporter_parties || [])).join("") : '<div class="muted-block">No amendments submitted yet.</div>'}
    </div>
    <p id="amend-msg" class="muted" style="margin:4px 0;"></p>
    <hr>
    <h3 style="margin:0 0 8px;">Submit amendment</h3>
    ${!inAmendStage ? '<div class="muted-block">Amendments may only be submitted during Second Reading and Report Debate.</div>' : ""}
    ${inAmendStage && !amendWindowOpen ? '<div class="muted-block">Amendment window closed — less than 1 sim month remains in this stage.</div>' : ""}
    ${!canSubmit && amendWindowOpen ? '<div class="muted-block">Your role cannot submit amendments at this time.</div>' : ""}
    ${canSubmit ? `
      <form id="amendmentForm" class="form-grid">
        <label for="amClause">Article</label>
        <select id="amClause" required>${articles.map((a) => `<option value="${a.number}">Article ${a.number} — ${esc(a.heading)}</option>`).join("")}</select>
        <label for="amType">Type</label>
        <select id="amType" required>
          <option value="replace">Replace article text</option>
          <option value="insert">Insert text into article</option>
          <option value="delete">Delete article text</option>
        </select>
        <label for="amTitle">Title</label>
        <input id="amTitle" type="text" maxlength="140" required>
        <label for="amText">Revised article text</label>
        <textarea id="amText" rows="6" required></textarea>
        <div></div>
        <div><button class="btn primary" type="submit">Submit Amendment</button></div>
      </form>
    ` : ""}
  `;

  const msgEl = () => root.querySelector("#amend-msg");
  const showAmMsg = (m) => { const el = msgEl(); if (el) el.textContent = m; };

  root.querySelector("#amClause")?.addEventListener("change", (ev) => {
    const selected = articles.find((a) => Number(a.number) === Number(ev.target.value));
    const area = root.querySelector("#amText");
    if (selected && area) area.value = selected.text || "";
  });
  if (root.querySelector("#amClause") && root.querySelector("#amText") && articles[0]) {
    root.querySelector("#amClause").dispatchEvent(new Event("change"));
  }

  root.querySelector("#amendmentForm")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const clause = Number(root.querySelector("#amClause")?.value || 0);
    const type = root.querySelector("#amType")?.value;
    const title = root.querySelector("#amTitle")?.value?.trim();
    const text = root.querySelector("#amText")?.value?.trim();
    if (!clause || !title) return;
    showAmMsg("Submitting…");
    try {
      await apiSubmitBillAmendment(bill.id, { articleNumber: clause, type, title, text });
      // Refresh bill from server to pick up any auto-applied text changes
      const updated = await apiGetBill(bill.id);
      if (updated?.bill) Object.assign(bill, updated.bill);
      persistAndRerender(data, bill);
    } catch (err) { showAmMsg(`Error: ${err.message}`); }
  });

  // Per-amendment action buttons
  amendments.forEach((am) => {
    const amendId = am.id || am.amendment_id || "";
    const node = root.querySelector(`[data-am-id="${CSS.escape(amendId)}"]`);
    if (!node) return;

    const supporters = am.supporter_parties || [];
    const alreadySupported = supporters.includes(char?.party || "");
    const canSupport = isLeader && !alreadySupported && am.status === "proposed";
    const canDecide = (canAuthorAct || canStaff) && am.status === "proposed";

    if (am.status === "proposed") {
      node.insertAdjacentHTML("beforeend", `
        <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;" class="am-actions">
          ${canDecide ? `<button class="btn" data-am-action="accept" type="button">Accept &amp; Apply</button><button class="btn danger" data-am-action="refuse" type="button">Refuse</button>` : ""}
          ${canSupport ? `<button class="btn" data-am-action="support" type="button">Declare Leader Support</button>` : ""}
          <span class="muted" style="align-self:center;">Leader support: ${supporters.length}</span>
        </div>
      `);
    }

    if (am.status === "in-division") {
      node.insertAdjacentHTML("beforeend", `
        <div class="muted" style="margin-top:8px;">Amendment division in progress — vote via the Divisions page (ID: ${esc(String(am.division_id || ""))})</div>
      `);
    }

    node.querySelectorAll("[data-am-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.getAttribute("data-am-action");
        showAmMsg("Processing…");
        try {
          if (action === "accept") {
            await apiBillAmendmentDecide(bill.id, amendId, "accept");
          } else if (action === "refuse") {
            await apiBillAmendmentDecide(bill.id, amendId, "refuse");
          } else if (action === "support") {
            await apiBillAmendmentSupport(bill.id, amendId);
          }
          // Refresh bill from server (bill text may have changed)
          const updated = await apiGetBill(bill.id);
          if (updated?.bill) Object.assign(bill, updated.bill);
          persistAndRerender(data, bill);
        } catch (err) { showAmMsg(`Error: ${err.message}`); }
      });
    });
  });
}

async function renderDivision(bill, data) {
  const voting = $("division-voting");
  const progress = $("division-progress");
  if (!voting || !progress) return;

  if (!DIVISION_STAGES.has(bill.stage)) {
    voting.style.display = "none";
    progress.style.display = "none";
    return;
  }

  const isSpeakerUser = isSpeaker(data);
  const isStaff = canAdminModOrSpeaker(data);
  const myParty = partyOfCurrent(data);
  const currentName = String(getCurrentCharacter(data)?.name || "");
  const parties = Array.isArray(data?.parliament?.parties) ? data.parliament.parties : [];
  const autoAbstainNpc = new Set(getAutoAbstainNpcParties(parties).map((p) => p.name));
  const partyMeta = parties.find((p) => p.name === myParty) || {};

  // If a formal DB division exists, use it (authoritative weighted votes)
  if (bill.formalDivisionId) {
    let dbDiv = null, tally = { aye: 0, no: 0, abstain: 0 }, myVote = null, myWeight = 0;
    let byParty = {}, seatsByParty = {};
    try {
      const result = await apiGetDivisionForEntity("bill", bill.id);
      if (result) {
        dbDiv = result.division;
        tally = result.tally;
        myVote = result.myVote;
        myWeight = Number(result.myWeight || 0);
        byParty = result.byParty || {};
        seatsByParty = result.seatsByParty || {};
      }
    } catch (_) {}

    voting.style.display = "block";
    progress.style.display = "block";

    const divStatus = dbDiv?.status || "open";
    const countdown = dbDiv?.closes_at_sim || "—";
    const myVoteLabel = myVote
      ? `Your vote: <b>${esc(myVote.vote.charAt(0).toUpperCase() + myVote.vote.slice(1))}</b>`
      : "Not yet voted";
    const myVoteClass = myVote ? `voted-${myVote.vote}` : "";
    const canVote = divStatus === "open" && !!partyMeta.playable && myWeight > 0;

    voting.innerHTML = `
      <div class="division-panel">
        <div class="division-header">
          <div class="division-title">🗳️ Final Division (DB-backed)</div>
          <span class="division-countdown">${divStatus === "open" ? `Closes ${esc(countdown)}` : `Closed${dbDiv?.outcome ? ` · ${dbDiv.outcome}` : ""}`}</span>
        </div>
        <div class="division-totals">
          <div class="division-total-cell aye"><div class="dc-num">${tally.aye}</div><div class="dc-lbl">Aye</div></div>
          <div class="division-total-cell no"><div class="dc-num">${tally.no}</div><div class="dc-lbl">No</div></div>
          <div class="division-total-cell"><div class="dc-num">${tally.abstain}</div><div class="dc-lbl">Abstain</div></div>
        </div>
        ${Object.keys(byParty).length ? `
          <details style="margin-top:8px;">
            <summary style="cursor:pointer;font-size:.85em;color:#555;">Party breakdown</summary>
            <div class="division-party-breakdown" style="margin-top:6px;font-size:.85em;">
              ${Object.entries(byParty)
                .filter(([, v]) => Object.values(v).some(n => Number(n) > 0))
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([party, v]) => {
                  const parts = [];
                  if (Number(v.aye || 0) > 0)     parts.push(`<span style="color:#0a7f2e;">${Math.round(v.aye)} Aye</span>`);
                  if (Number(v.no || 0) > 0)      parts.push(`<span style="color:#9d1d1d;">${Math.round(v.no)} No</span>`);
                  if (Number(v.abstain || 0) > 0) parts.push(`<span style="color:#555;">${Math.round(v.abstain)} Abstain</span>`);
                  return `<div class="division-party-row"><span><b>${esc(party)}</b></span><span>${parts.join(" · ")}</span></div>`;
                }).join("")}
            </div>
          </details>
        ` : ""}
        <div class="division-my-vote ${esc(myVoteClass)}">${myVoteLabel} · Weight: <b>${myWeight}</b></div>
        ${divStatus === "open" ? `
          <div class="tile-bottom" style="padding-top:10px;">
            <button class="btn ${myVote?.vote === "aye" ? "primary" : ""}" data-vote="aye" ${canVote ? "" : "disabled"}>Aye</button>
            <button class="btn ${myVote?.vote === "no" ? "primary" : ""}" data-vote="no" ${canVote ? "" : "disabled"}>No</button>
            <button class="btn ${myVote?.vote === "abstain" ? "primary" : ""}" data-vote="abstain" ${canVote ? "" : "disabled"}>Abstain</button>
          </div>
        ` : `<p class="muted">Division closed. Outcome: <b>${esc(dbDiv?.outcome || "—")}</b></p>`}
        ${isStaff && divStatus === "open" ? `
          <div style="margin-top:12px;">
            <h4 style="margin:0 0 6px;">NPC Party Votes &amp; Rebels</h4>
            <p class="muted small">Seat totals from constituencies page. Sinn Féin/Speaker excluded.</p>
            <form id="npc-vote-form">
              ${(() => {
                // Use seat counts from constituencies (server source of truth), not stale data.parliament.parties[].seats
                const playableNames = new Set(parties.filter(p => p.playable).map(p => p.name));
                const sinnFeinRE = /sinn\s*f[ée]in/i;
                const speakerRE  = /^speaker$/i;
                const npcEntries = Object.entries(seatsByParty)
                  .filter(([name, seats]) => seats > 0 && !playableNames.has(name) && !sinnFeinRE.test(name) && !speakerRE.test(name))
                  .sort((a, b) => b[1] - a[1]);
                const playableEntries = Object.entries(seatsByParty)
                  .filter(([name, seats]) => seats > 0 && playableNames.has(name))
                  .sort((a, b) => b[1] - a[1]);
                const npcVotes = dbDiv?.npc_votes || {};
                const rebels = dbDiv?.rebels_by_party || {};
                const rebelChoice = dbDiv?.rebels_by_party_choice || {};
                if (!npcEntries.length && !playableEntries.length) return `<p class="muted">No parties with seats found in constituencies.</p>`;
                return npcEntries.map(([name, seats]) => `
                  <div class="kv" style="margin-bottom:4px;">
                    <span><b>${esc(name)}</b> (${seats} seats)</span>
                    <select name="npc-${esc(name)}" class="input" style="width:110px;">
                      <option value="">Unallocated</option>
                      <option value="aye" ${npcVotes[name] === "aye" ? "selected" : ""}>Aye</option>
                      <option value="no" ${npcVotes[name] === "no" ? "selected" : ""}>No</option>
                      <option value="abstain" ${npcVotes[name] === "abstain" ? "selected" : ""}>Abstain</option>
                    </select>
                    <input type="number" name="rebels-${esc(name)}" min="0" max="${seats}" value="${Number(rebels[name] || 0)}" class="input" style="width:70px;" placeholder="Rebels">
                  </div>`).join("") +
                (playableEntries.length ? `
                  <div style="margin-top:10px;">
                    <h5 style="margin:0 0 4px;">Rebellion (removes from player weighted vote)</h5>
                    <p class="muted" style="margin:0 0 6px;font-size:0.85em;">Set rebel count + direction. Rebels are removed from the party weighted vote and added to their chosen direction.</p>
                    ${playableEntries.map(([name, seats]) => `
                      <div class="kv" style="margin-bottom:4px;flex-wrap:wrap;gap:4px;">
                        <span><b>${esc(name)}</b> (${seats} seats)</span>
                        <label>Rebels: <input type="number" name="rebels-${esc(name)}" min="0" max="${seats}" value="${Number(rebels[name] || 0)}" class="input" style="width:70px;"></label>
                        <select name="rebel-dir-${esc(name)}" class="input" style="width:110px;" title="Rebel vote direction">
                          <option value="">— direction —</option>
                          <option value="aye" ${rebelChoice[name] === "aye" ? "selected" : ""}>Rebel → Aye</option>
                          <option value="no" ${rebelChoice[name] === "no" ? "selected" : ""}>Rebel → No</option>
                          <option value="abstain" ${rebelChoice[name] === "abstain" ? "selected" : ""}>Rebel → Abstain</option>
                        </select>
                      </div>`).join("")}
                  </div>` : "");
              })()}
              <div class="tile-bottom" style="padding-top:6px;">
                <button class="btn" type="submit">Save NPC Votes</button>
              </div>
              <p id="npc-msg" class="muted" style="margin-top:4px;"></p>
            </form>
          </div>
        ` : ""}
        ${isSpeakerUser && divStatus === "open" ? `<div class="tile-bottom" style="display:flex;gap:8px;padding-top:10px;"><button class="btn danger" data-action="close-division">Close Division</button></div>` : ""}
        <p id="div-msg" class="muted" style="margin-top:6px;"></p>
      </div>
    `;

    voting.querySelectorAll("[data-vote]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!canVote || divStatus !== "open") return;
        const msg = voting.querySelector("#div-msg");
        if (msg) msg.textContent = "Voting…";
        try {
          await apiCastVote(bill.formalDivisionId, btn.dataset.vote);
          await renderDivision(bill, data);
        } catch (err) { if (msg) msg.textContent = `Error: ${err.message}`; }
      });
    });

    voting.querySelector("[data-action='close-division']")?.addEventListener("click", async () => {
      const msg = voting.querySelector("#div-msg");
      if (msg) msg.textContent = "Closing…";
      try {
        const closeResult = await apiCloseDivision(bill.formalDivisionId);
        // Update bill status based on division outcome
        const outcome = closeResult?.tally?.aye > closeResult?.tally?.no ? "passed" : "failed";
        if (outcome === "passed") {
          bill.status = "awaiting-assent";
          bill.stage = "Passed - Awaiting Assent";
        } else {
          bill.status = "failed";
          bill.stage = "Defeated in Division";
        }
        bill.divisionOutcome = outcome;
        toastSuccess(`Division closed — ${outcome === "passed" ? "Bill passed ✓" : "Bill defeated"}.`);
        persistAndRerender(data, bill);
      } catch (err) {
        if (msg) msg.textContent = `Error: ${err.message}`;
        toastError(`Close division failed: ${err.message}`);
      }
    });

    voting.querySelector("#npc-vote-form")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const submitBtn = ev.currentTarget.querySelector("[type='submit']");
      if (submitBtn) submitBtn.disabled = true;
      const fd = new FormData(ev.currentTarget);
      const msgEl = voting.querySelector("#npc-msg");
      if (msgEl) msgEl.textContent = "Saving…";
      // Use seatsByParty from constituencies (source of truth) — same data used by the form
      const playableNames = new Set(parties.filter(p => p.playable).map(p => p.name));
      const sinnFeinRE = /sinn\s*f[ée]in/i;
      const speakerRE  = /^speaker$/i;
      const npcNames = Object.entries(seatsByParty)
        .filter(([name, seats]) => seats > 0 && !playableNames.has(name) && !sinnFeinRE.test(name) && !speakerRE.test(name))
        .map(([name]) => name);
      const playablePartyNames = Object.entries(seatsByParty)
        .filter(([name, seats]) => seats > 0 && playableNames.has(name))
        .map(([name]) => name);
      const npcVotes = {};
      const rebelsByParty = {};
      const rebelsByPartyChoice = {};
      npcNames.forEach((name) => {
        const v = String(fd.get(`npc-${name}`) || "").toLowerCase();
        if (["aye", "no", "abstain"].includes(v)) npcVotes[name] = v;
        const rebels = Number(fd.get(`rebels-${name}`) || 0);
        if (rebels > 0) rebelsByParty[name] = rebels;
      });
      playablePartyNames.forEach((name) => {
        const rebels = Number(fd.get(`rebels-${name}`) || 0);
        if (rebels > 0) rebelsByParty[name] = rebels;
        else delete rebelsByParty[name];
        const dir = String(fd.get(`rebel-dir-${name}`) || "").toLowerCase();
        if (dir && ["aye", "no", "abstain"].includes(dir)) rebelsByPartyChoice[name] = dir;
        else delete rebelsByPartyChoice[name];
      });
      const t0 = Date.now();
      try {
        await apiSetNpcVotes(bill.formalDivisionId, npcVotes, rebelsByParty, rebelsByPartyChoice);
        if (msgEl) msgEl.textContent = "NPC votes saved.";
        if (Date.now() - t0 > 500) toastSuccess("NPC votes saved.");
        await renderDivision(bill, data);
      } catch (err) {
        if (msgEl) msgEl.textContent = `Error: ${err.message}`;
        if (submitBtn) submitBtn.disabled = false;
        toastError(`Save failed: ${err.message}`);
      }
    });

    progress.innerHTML = `
      <h2>Division Progress</h2>
      <div class="kv"><span>Status</span><b>${esc(divStatus)}</b></div>
      <p class="muted small">Vote totals use seat counts from the constituencies page as source of truth.</p>
      ${Object.keys(seatsByParty).length ? `
        <div class="division-party-breakdown" style="margin-top:6px;font-size:.85em;">
          ${Object.entries(seatsByParty)
            .filter(([, s]) => s > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([party, seats]) => {
              const v = byParty[party] || {};
              const voteParts = [];
              if (Number(v.aye || 0) > 0)     voteParts.push(`<span style="color:#0a7f2e;">${Math.round(v.aye)} Aye</span>`);
              if (Number(v.no || 0) > 0)      voteParts.push(`<span style="color:#9d1d1d;">${Math.round(v.no)} No</span>`);
              if (Number(v.abstain || 0) > 0) voteParts.push(`<span style="color:#555;">${Math.round(v.abstain)} Abstain</span>`);
              const playableNames = new Set(parties.filter(p => p.playable).map(p => p.name));
              const npcLabel = playableNames.has(party) ? "" : " <span class='muted'>(NPC)</span>";
              const sinnFein = /sinn\s*f[ée]in/i.test(party) ? " <span class='muted'>(auto-abstain)</span>" : "";
              const npcVoteDir = (dbDiv?.npc_votes || {})[party];
              const unallocated = !playableNames.has(party) && !/sinn\s*f[ée]in/i.test(party) && !/^speaker$/i.test(party) && !npcVoteDir && !voteParts.length;
              return `<div class="division-party-row"><span><b>${esc(party)}</b>${npcLabel}${sinnFein} (${seats})</span><span>${voteParts.length ? voteParts.join(" · ") : unallocated ? "<span class='muted'>unallocated</span>" : ""}</span></div>`;
            }).join("")}
        </div>` : ""}
    `;
    return;
  }

  // Legacy inline division (for bills that haven't been migrated to formal divisions)
  const divDefaults = { status: "open", openedAt: Number(bill.stageStartedAt || Date.now()) };
  if (bill.stageDeadlineSim) divDefaults.closesAtSim = bill.stageDeadlineSim;
  const division = ensureDivision(bill, divDefaults);
  maybeAutoCloseDivision(bill, data);
  finaliseDivisionOutcome(bill, data);
  const totals = tallyDivision(bill, data);
  const now = Date.now();

  const current = division.votes[currentName]?.choice || "";
  const rebelsByParty = division.rebelsByParty || {};
  const myWeight = getCurrentVoteWeight(data, currentName, myParty, rebelsByParty);
  const canVote = division.status === "open" && !!partyMeta.playable && myWeight > 0;
  const pendingAmendmentDivisions = (bill.amendments || []).some((am) => am.status === "in-division" && am.division?.status === "open");

  voting.style.display = "block";
  progress.style.display = "block";

  const countdown = division.closesAtSim
    ? countdownToSimMonth(division.closesAtSim.month, division.closesAtSim.year, data.gameState)
    : msToHuman(Number(division.closesAt || 0) - now);

  const myVoteClass = current ? `voted-${current}` : "";
  const myVoteLabel = current ? `Your vote: <b>${esc(current.charAt(0).toUpperCase() + current.slice(1))}</b>` : "Not yet voted";

  voting.innerHTML = `
    <div class="division-panel">
      <div class="division-header">
        <div class="division-title">🗳️ Division</div>
        ${division.status === "open" ? `<span class="division-countdown">Closes in ${esc(countdown)}</span>` : `<span class="division-countdown">Closed</span>`}
      </div>
      <div class="division-totals">
        <div class="division-total-cell aye"><div class="dc-num">${totals.aye}</div><div class="dc-lbl">Aye</div></div>
        <div class="division-total-cell no"><div class="dc-num">${totals.no}</div><div class="dc-lbl">No</div></div>
        <div class="division-total-cell"><div class="dc-num">${totals.abstain}</div><div class="dc-lbl">Abstain</div></div>
      </div>
      <div class="division-my-vote ${esc(myVoteClass)}">${myVoteLabel} · Weight: <b>${esc(myWeight.toFixed(2))}</b></div>
      ${pendingAmendmentDivisions ? `<p class="muted">Main bill division paused until amendment divisions are finished.</p>` : ""}
      ${!partyMeta.playable ? `<p class="muted">Your party is NPC in this cycle; only Speaker allocation applies.</p>` : ""}
      ${partyMeta.playable && !canVote ? `<p class="muted">You currently have no vote weight (likely absent without delegated weight).</p>` : ""}
      <div class="tile-bottom" style="padding-top:10px;">
        <button class="btn ${current === "aye" ? "primary" : ""}" data-vote="aye" ${canVote && !pendingAmendmentDivisions ? "" : "disabled"}>Aye</button>
        <button class="btn ${current === "no" ? "primary" : ""}" data-vote="no" ${canVote && !pendingAmendmentDivisions ? "" : "disabled"}>No</button>
        <button class="btn ${current === "abstain" ? "primary" : ""}" data-vote="abstain" ${canVote && !pendingAmendmentDivisions ? "" : "disabled"}>Abstain</button>
      </div>
      ${isSpeakerUser && division.status === "closed" && totals.aye === totals.no ? `
        <div style="margin-top:12px;" class="tile-bottom">
          <button class="btn" data-speaker="move-on">Speaker: Move On (status quo)</button>
          <button class="btn danger" data-speaker="tie-break">Speaker: Cast Tie-break Vote</button>
        </div>
      ` : ""}
    </div>
  `;

  const npcParties = parties.filter((p) => !p.playable && Number(p.seats || 0) > 0 && !autoAbstainNpc.has(p.name));
  if (isSpeakerUser) {
    voting.insertAdjacentHTML("beforeend", `
      <div class="tile" style="margin-top:10px;">
        <h3 style="margin-top:0;">Speaker NPC / Rebels Control</h3>
        ${Array.from(autoAbstainNpc).length ? `<p class="muted">${Array.from(autoAbstainNpc).join(", ")} abstain by convention and do not require allocation.</p>` : ""}
        <form id="speaker-division-controls">
          ${npcParties.map((p) => `<div class="kv"><span>${esc(p.name)} (${Number(p.seats||0)} seats)</span><select name="npc-${esc(p.name)}" class="input"><option value="">Unallocated</option><option value="aye" ${division.npcVotes?.[p.name]==="aye"?"selected":""}>Aye</option><option value="no" ${division.npcVotes?.[p.name]==="no"?"selected":""}>No</option><option value="abstain" ${division.npcVotes?.[p.name]==="abstain"?"selected":""}>Abstain</option></select></div>`).join("")}
          ${parties.filter((p) => p.playable).map((p) => `<div class="kv"><span>Rebels: ${esc(p.name)}</span><input class="input" type="number" min="0" max="${Number(p.seats||0)}" name="rebels-${esc(p.name)}" value="${Number(division.rebelsByParty?.[p.name]||0)}"></div>`).join("")}
          <button class="btn" type="submit">Apply Speaker Allocation</button>
        </form>
      </div>
    `);

    voting.querySelector("#speaker-division-controls")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = e.currentTarget.querySelector("[type='submit']");
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Saving…"; }
      const fd = new FormData(e.currentTarget);
      const npcVotes = {};
      npcParties.forEach((p) => {
        const v = String(fd.get(`npc-${p.name}`) || "").toLowerCase();
        if (["aye", "no", "abstain"].includes(v)) npcVotes[p.name] = v;
      });
      const rebelsByPartyLocal = {};
      parties.filter((p) => p.playable).forEach((p) => {
        const seats = Number(p.seats || 0);
        const raw = Number(fd.get(`rebels-${p.name}`) || 0);
        rebelsByPartyLocal[p.name] = Math.max(0, Math.min(seats, raw));
      });
      // Save previous state for rollback on failure
      const prevNpcVotes = { ...(bill.division?.npcVotes || {}) };
      const prevRebels = { ...(bill.division?.rebelsByParty || {}) };
      const prevStatus = bill.division?.status;
      setNpcVotes(bill, npcVotes);
      setRebellions(bill, rebelsByPartyLocal);
      maybeAutoCloseDivision(bill, data);
      const t0 = Date.now();
      try {
        await apiUpdateBill(bill.id, bill);
      } catch (err) {
        // Rollback local mutations on failure
        if (bill.division) {
          bill.division.npcVotes = prevNpcVotes;
          bill.division.rebelsByParty = prevRebels;
          bill.division.status = prevStatus;
        }
        handleApiError(err, "Save speaker allocation");
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Apply Speaker Allocation"; }
        return;
      }
      if (Date.now() - t0 > 500) toastSuccess("Speaker allocation saved.");
      persistAndRerender(data, bill);
    });
  }

  progress.innerHTML = `
    <h2>Division Progress</h2>
    <div class="kv"><span>Status</span><b>${esc(division.status)}</b></div>
    <div class="division-party-breakdown">
      ${parties.filter((p) => Number(p.seats || 0) > 0).map((p) => {
        const partyVotes = Object.entries(division.votes || {}).filter(([, v]) => v.party === p.name);
        const npcVote = division.npcVotes?.[p.name];
        const label = p.playable
          ? (partyVotes.length ? partyVotes.map(([n, v]) => `${esc(n)}: ${esc(v.choice)}`).join(", ") : "Not voted")
          : (npcVote ? `NPC: ${esc(npcVote)}` : "NPC: unallocated");
        return `<div class="division-party-row"><span><b>${esc(p.name)}</b> (${Number(p.seats || 0)})</span><span class="muted">${label}</span></div>`;
      }).join("")}
    </div>
  `;

  voting.querySelectorAll("[data-vote]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const rebelsByPartyInner = division.rebelsByParty || {};
      const weight = getCurrentVoteWeight(data, currentName || myParty, myParty, rebelsByPartyInner);
      if (weight <= 0) return;
      try {
        const result = await apiBillVote(bill.id, btn.dataset.vote);
        if (result?.bill) {
          Object.assign(bill, result.bill);
          const idx = Array.isArray(data.orderPaperCommons)
            ? data.orderPaperCommons.findIndex((b) => b.id === bill.id)
            : -1;
          if (idx >= 0) data.orderPaperCommons[idx] = bill;
        }
      } catch (err) {
        console.error("[bill.vote] API error — falling back to local vote:", err.message);
        castDivisionVote(bill, currentName || myParty, { choice: btn.dataset.vote, party: myParty, weight });
      }
      maybeAutoCloseDivision(bill, data);
      renderDivision(bill, data);
    });
  });

  voting.querySelector('[data-speaker="move-on"]')?.addEventListener("click", () => {
    bill.status = "failed";
    bill.stage = "Defeated in Division";
    bill.divisionOutcome = "failed";
    bill.divisionResolvedAt = Date.now();
    division.status = "resolved-by-speaker";
    persistAndRerender(data, bill);
  });

  voting.querySelector('[data-speaker="tie-break"]')?.addEventListener("click", () => {
    division.status = "resolved-by-speaker";
    bill.status = "awaiting-assent";
    bill.stage = "Passed - Awaiting Assent";
    bill.divisionOutcome = "passed";
    bill.divisionResolvedAt = Date.now();
    bill.finalStage = bill.finalStage || "Final Division";
    persistAndRerender(data, bill);
  });
}

function persistAndRerender(data, bill, rerenderAll = true) {
  const idx = data.orderPaperCommons.findIndex((b) => b.id === bill.id);
  if (idx >= 0) data.orderPaperCommons[idx] = bill;
  // Non-blocking save; re-render proceeds immediately. Errors are surfaced via toast.
  (async () => {
    try { await apiUpdateBill(bill.id, bill); }
    catch (err) {
      console.error("[bill] persist failed:", err);
      const { toastError: te } = await import("../components/toast.js");
      te(`Save failed: ${err.message}`);
    }
  })();
  if (rerenderAll) {
    renderBillMeta(bill, data);
    renderBillText(bill);
    renderAmendments(bill, data);
    renderDivision(bill, data);
    setDebateLink(bill);
  }
}

function autoAdvanceStage(bill, data) {
  if (bill.status === "failed" || bill.status === "passed" || bill.status === "awaiting-assent" || bill.status === "withdrawn") return false;
  const deadline = bill.stageDeadlineSim;
  if (!deadline) return false;
  const expired = isDeadlinePassed(deadline, data.gameState);
  if (!expired) return false;

  let changed = false;
  if (bill.stage === "Second Reading") {
    // After 2 months → moves to Report Stage (awaits staff report submission — no auto-advance)
    bill.stage = "Report Stage";
    bill.stageStartedAt = Date.now();
    bill.stageDeadlineSim = null; // Report Stage has no timer: advances when staff submits report
    changed = true;
  } else if (bill.stage === "Report Debate") {
    // After 2 months → Final Division stage (staff opens formal division)
    bill.stage = "Final Division";
    bill.stageStartedAt = Date.now();
    bill.stageDeadlineSim = createDeadline(data.gameState, 1);
    changed = true;
  }
  // Note: Report Stage → Report Debate is triggered by staff submitting a report (server endpoint)
  // Note: Final Division stage uses formal DB division (no auto-advance here)
  return changed;
}

export async function initBillPage(data) {
  const billId = getBillIdFromUrl();
  // Always fetch from DB first (authoritative source)
  let bill = null;
  if (billId) {
    try {
      const result = await apiGetBill(billId);
      if (result?.bill) {
        bill = result.bill;
        // Sync into local state
        data.orderPaperCommons ??= [];
        const idx = data.orderPaperCommons.findIndex((b) => b.id === billId);
        if (idx >= 0) data.orderPaperCommons[idx] = bill;
        else data.orderPaperCommons.unshift(bill);
      }
    } catch (err) {
      console.error("[bill] DB fetch failed, falling back to local state:", err);
    }
  }

  // Fallback to local state
  if (!bill) {
    bill = (data?.orderPaperCommons || []).find((b) => b.id === billId) || (billId ? null : (data?.orderPaperCommons || [])[0]);
  }

  if (!bill) {
    const title = $("billTitle");
    if (title) title.textContent = "Bill not found";
    const meta = $("billMeta");
    if (meta) meta.innerHTML = '<div class="muted-block">No bill data available.</div>';
    return;
  }

  // Auto-advance expired stages (client-side display aid; server is authoritative)
  let stageAdvanced = false;
  while (autoAdvanceStage(bill, data)) { stageAdvanced = true; }
  if (stageAdvanced) {
    try { await apiUpdateBill(bill.id, bill); }
    catch (err) { console.error("[bill] auto-advance failed:", err); }
  }

  renderBillMeta(bill, data);
  renderBillText(bill);
  await renderAmendments(bill, data);
  await renderDivision(bill, data);
  setDebateLink(bill);
}
