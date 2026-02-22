import { ensureDivision, castDivisionVote, tallyDivision, closeDivision, resolveDivisionResult, setNpcVotes, setRebellions } from "../engines/division-engine.js";
import { saveState } from "../core.js";
import { buildDivisionWeights } from "../divisions.js";
import { isAdmin, isMod, canAdminOrMod } from "../permissions.js";
import { esc } from "../ui.js";
import { createDeadline, isDeadlinePassed, simMonthsRemaining, countdownToSimMonth, formatSimMonthYear } from "../clock.js";
import { logAction } from "../audit.js";
import { apiCreateDebateTopic } from "../api.js";
import { handleApiError } from "../errors.js";

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
  const url = bill?.debateUrl || bill?.discourseUrl || `https://forum.rulebritannia.org/t/${encodeURIComponent(bill?.id || "bill")}`;
  btn.href = url;
}

function ensureBillDebateTopic(bill, data) {
  if (bill.discourseTopicId) return;
  const raw = `**${bill.title}**\nIntroduced by ${bill.author || "Unknown"}${bill.department ? ` (${bill.department})` : ""}.\n\n*This is the Second Reading debate thread for this bill.*`;
  apiCreateDebateTopic({ entityType: "bill", entityId: bill.id, title: `Second Reading: ${bill.title}`, raw })
    .then(({ topicId, topicUrl }) => {
      bill.debateUrl = topicUrl;
      bill.discourseTopicId = topicId;
      const idx = data.orderPaperCommons.findIndex((b) => b.id === bill.id);
      if (idx >= 0) data.orderPaperCommons[idx] = bill;
      saveState(data);
      setDebateLink(bill);
    })
    .catch((err) => handleApiError(err, "Debate topic"));
}

function renderBillMeta(bill, data) {
  const h1 = $("billTitle");
  const meta = $("billMeta");
  if (h1) h1.textContent = bill.title;
  if (!meta) return;

  const canManage = canManageLegislativeAgenda(data);
  const typeOptions = [
    ["government", "Government Bill"],
    ["opposition", "Opposition Bill"],
    ["pmb", "Private Member’s Bill"]
  ];

  meta.innerHTML = `
    <div class="spaced">
      <div>
        <div class="bill-title">${esc(bill.title)}</div>
        <div class="bill-sub">${esc(bill.author || "—")} • ${esc(bill.department || "—")}</div>
      </div>
      <div class="badges">
        <span class="bill-badge">${esc(billTypeLabel(bill.billType))}</span>
        <span class="bill-badge">${esc(bill.stage || "—")}</span>
        <span class="bill-badge">Stage ends: ${esc(stageCountdown(bill, data.gameState))}</span>
      </div>
    </div>
    ${canManage ? `
      <hr>
      <div class="form-grid" id="agenda-controls">
        <label>Second Reading Gate</label>
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
      <p class="small">Leader of the House / Prime Minister controls are active for this account.</p>
    ` : ""}

    ${canGrantAssent(data) && bill.status === "awaiting-assent" ? `
      <hr>
      <div class="tile-bottom" style="padding-top:0;margin-top:0;">
        <button type="button" class="btn" data-agenda="grant-assent">Grant Royal Assent</button>
      </div>
      <p class="small">Moderator / admin action required to convert this bill into an Act.</p>
    ` : ""}
  `;

  if (canManage) {
    meta.querySelector('[data-agenda="grant-second-reading"]')?.addEventListener("click", () => {
      if (bill.stage !== "First Reading") return;
      bill.stage = "Second Reading";
      bill.stageStartedAt = Date.now();
      bill.stageDeadlineSim = createDeadline(data.gameState, 2);
      logAction({ action: "bill-stage-changed", target: bill.title, details: { billId: bill.id, stage: bill.stage } });
      persistAndRerender(data, bill);
      ensureBillDebateTopic(bill, data);
    });

    meta.querySelector('[data-agenda="refuse-second-reading"]')?.addEventListener("click", () => {
      if (bill.stage !== "First Reading") return;
      bill.stage = "First Reading Refused";
      bill.status = "failed";
      bill.stageStartedAt = Date.now();
      logAction({ action: "bill-stage-changed", target: bill.title, details: { billId: bill.id, stage: bill.stage } });
      persistAndRerender(data, bill);
    });

    meta.querySelector("#billTypeSelect")?.addEventListener("change", (ev) => {
      bill.billType = ev.target.value;
      persistAndRerender(data, bill, false);
    });
  }


  meta.querySelector('[data-agenda="grant-assent"]')?.addEventListener("click", () => {
    if (!canGrantAssent(data) || bill.status !== "awaiting-assent") return;
    grantRoyalAssent(bill);
    logAction({ action: "bill-stage-changed", target: bill.title, details: { billId: bill.id, stage: bill.stage } });
    persistAndRerender(data, bill);
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

function amendmentRow(a) {
  return `
    <div class="docket-item">
      <div class="docket-left">
        <div class="docket-icon">✍️</div>
        <div>
          <div class="docket-title">${esc(a.id)} · Clause ${esc(a.articleNumber ?? "—")}: ${esc(a.title || "Untitled amendment")}</div>
          <div class="docket-detail">${esc(a.type || "change")} • Proposed by ${esc(a.proposedBy || "Unknown")} • ${esc(a.status || "proposed")}</div>
          <div class="small" style="margin-top:6px;">${esc(a.text || "")}</div>
        </div>
      </div>
    </div>
  `;
}

function renderAmendments(bill, data) {
  const root = $("amendmentsList");
  if (!root) return;

  bill.amendments ??= [];
  ensureBillStageTimers(bill, data.gameState);
  const inLastMonth = !DIVISION_STAGES.has(bill.stage) && bill.stageDeadlineSim && simMonthsRemaining(bill.stageDeadlineSim, data.gameState) <= 0;
  const amendLocked = AMENDMENT_LOCK_STAGES.has(bill.stage) || inLastMonth;
  const canSubmit = canProposeAmendment(data) && !amendLocked;
  const canAuthorAct = canAuthorManageAmendments(bill, data);
  const char = getCurrentCharacter(data);

  const articles = parseArticlesFromBillText(bill.billText || "");

  root.innerHTML = `
    <div class="docket-list">${bill.amendments.length ? bill.amendments.map(amendmentRow).join("") : '<div class="muted-block">No amendments submitted yet.</div>'}</div>
    <hr>
    <h3 style="margin:0 0 8px;">Submit amendment</h3>
    ${inLastMonth ? '<div class="muted-block">Amendments are locked — debate deadline has passed.</div>' : ""}
    ${amendLocked && !inLastMonth ? '<div class="muted-block">Amendments are closed at this stage.</div>' : ""}
    ${!canSubmit && !amendLocked ? '<div class="muted-block">Your role cannot submit amendments at this time.</div>' : ""}
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

  root.querySelector("#amClause")?.addEventListener("change", (ev) => {
    const selected = articles.find((a) => Number(a.number) === Number(ev.target.value));
    const area = root.querySelector("#amText");
    if (selected && area) area.value = selected.text || "";
  });

  if (root.querySelector("#amClause") && root.querySelector("#amText") && articles[0]) {
    root.querySelector("#amClause").dispatchEvent(new Event("change"));
  }

  root.querySelector("#amendmentForm")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const clause = Number(root.querySelector("#amClause")?.value || 0);
    const type = root.querySelector("#amType")?.value;
    const title = root.querySelector("#amTitle")?.value?.trim();
    const text = root.querySelector("#amText")?.value?.trim();
    if (!clause || !title) return;

    const nextId = `A${bill.amendments.length + 1}`;
    const am = {
      id: nextId,
      articleNumber: clause,
      type,
      title,
      text,
      proposedBy: partyOfCurrent(data),
      proposedByName: char?.name || "MP",
      status: "proposed",
      supporters: [partyOfCurrent(data)],
      submittedAt: new Date().toISOString()
    };

    if (canAuthorAct) {
      am.status = "accepted";
      const target = articles.find((a) => Number(a.number) === clause);
      if (target) {
        if (type === "replace") target.text = text || target.text;
        if (type === "insert") target.text = `${target.text}
${text || ""}`.trim();
        if (type === "delete") target.text = "";
        bill.billText = serializeBillTextWithArticles(bill.billText || "", articles);
      }
    }

    bill.amendments.push(am);
    persistAndRerender(data, bill);
  });

  root.querySelectorAll(".docket-item").forEach((node, idx) => {
    const am = bill.amendments[idx];
    if (!am) return;
    if (am.status === "in-division" && am.division?.status === "open" && (am.division.closesAtSim ? isDeadlinePassed(am.division.closesAtSim, data.gameState) : Number(am.division.closesAt || 0) <= Date.now())) {
      am.status = "refused";
      am.division.status = "closed";
    }
    const supports = Array.isArray(am.supporters) ? am.supporters : [];
    const supportCount = supports.length;
    const canSupport = isPartyLeader(char) && !supports.includes(partyOfCurrent(data));
    if (am.status === "proposed") {
      node.insertAdjacentHTML("beforeend", `
        <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
          ${canAuthorAct ? '<button class="btn" data-am-action="accept" data-am-id="'+esc(am.id)+'" type="button">Accept & Apply</button><button class="btn danger" data-am-action="refuse" data-am-id="'+esc(am.id)+'" type="button">Refuse</button>' : ''}
          ${canSupport ? '<button class="btn" data-am-action="support" data-am-id="'+esc(am.id)+'" type="button">Leader Support</button>' : ''}
          <span class="muted">Leader supports: ${supportCount}</span>
        </div>
      `);
    }
    if (am.status === "in-division") {
      node.insertAdjacentHTML("beforeend", `
        <div class="muted" style="margin-top:8px;">Amendment division closes in ${esc(am.division?.closesAtSim ? countdownToSimMonth(am.division.closesAtSim.month, am.division.closesAtSim.year, data.gameState) : msToHuman(Number(am.division?.closesAt || 0) - Date.now()))}.</div>
        ${isSpeaker(data) ? '<div style="margin-top:6px;display:flex;gap:8px;"><button class="btn" data-am-action="pass-division" data-am-id="'+esc(am.id)+'" type="button">Speaker: Pass Amendment</button><button class="btn danger" data-am-action="fail-division" data-am-id="'+esc(am.id)+'" type="button">Speaker: Fail Amendment</button></div>' : ''}
      `);
    }
  });

  root.querySelectorAll("[data-am-action]").forEach((btn) => btn.addEventListener("click", () => {
    const id = btn.getAttribute("data-am-id");
    const action = btn.getAttribute("data-am-action");
    const am = bill.amendments.find((x) => x.id === id);
    if (!am || am.status !== "proposed") return;
    const articlesNow = parseArticlesFromBillText(bill.billText || "");

    if (action === "support" && isPartyLeader(char)) {
      am.supporters = Array.isArray(am.supporters) ? am.supporters : [];
      const party = partyOfCurrent(data);
      if (!am.supporters.includes(party)) am.supporters.push(party);
    }

    if (action === "accept" && canAuthorAct) {
      am.status = "accepted";
      const target = articlesNow.find((a) => Number(a.number) === Number(am.articleNumber));
      if (target) {
        if (am.type === "replace") target.text = am.text || target.text;
        if (am.type === "insert") target.text = `${target.text}
${am.text || ""}`.trim();
        if (am.type === "delete") target.text = "";
        bill.billText = serializeBillTextWithArticles(bill.billText || "", articlesNow);
      }
    }

    if (action === "refuse" && canAuthorAct) {
      const leaders = new Set(Array.isArray(am.supporters) ? am.supporters : []);
      if (leaders.size >= 2) {
        am.status = "in-division";
        am.division = ensureDivision(am, { status: "open", openedAt: Date.now(), closesAtSim: createDeadline(data.gameState, 1) });
      } else {
        am.status = "refused";
      }
    }

    if (action === "pass-division" && isSpeaker(data) && am.status === "in-division") {
      am.status = "accepted";
      const target = articlesNow.find((a) => Number(a.number) === Number(am.articleNumber));
      if (target) {
        if (am.type === "replace") target.text = am.text || target.text;
        if (am.type === "insert") target.text = `${target.text}
${am.text || ""}`.trim();
        if (am.type === "delete") target.text = "";
        bill.billText = serializeBillTextWithArticles(bill.billText || "", articlesNow);
      }
      if (am.division) am.division.status = "closed";
    }

    if (action === "fail-division" && isSpeaker(data) && am.status === "in-division") {
      am.status = "refused";
      if (am.division) am.division.status = "closed";
    }

    persistAndRerender(data, bill);
  }));
}

function renderDivision(bill, data) {
  const voting = $("division-voting");
  const progress = $("division-progress");
  if (!voting || !progress) return;

  if (!DIVISION_STAGES.has(bill.stage)) {
    voting.style.display = "none";
    progress.style.display = "none";
    return;
  }

  const divDefaults = { status: "open", openedAt: Number(bill.stageStartedAt || Date.now()) };
  if (bill.stageDeadlineSim) divDefaults.closesAtSim = bill.stageDeadlineSim;
  const division = ensureDivision(bill, divDefaults);
  maybeAutoCloseDivision(bill, data);
  finaliseDivisionOutcome(bill, data);
  const totals = tallyDivision(bill, data);
  const now = Date.now();

  const myParty = partyOfCurrent(data);
  const currentName = String(getCurrentCharacter(data)?.name || "");
  const current = division.votes[currentName]?.choice || "";
  const parties = Array.isArray(data?.parliament?.parties) ? data.parliament.parties : [];
  const autoAbstainNpc = new Set(getAutoAbstainNpcParties(parties).map((p) => p.name));
  const partyMeta = parties.find((p) => p.name === myParty) || {};
  const rebelsByParty = division.rebelsByParty || {};
  const myWeight = getCurrentVoteWeight(data, currentName, myParty, rebelsByParty);
  const canVote = division.status === "open" && !!partyMeta.playable && myWeight > 0;
  const pendingAmendmentDivisions = (bill.amendments || []).some((am) => am.status === "in-division" && am.division?.status === "open");

  voting.style.display = "block";
  progress.style.display = "block";

  voting.innerHTML = `
    <h2>Division</h2>
    <p class="muted">Weighted division. Vote closes in <b>${esc(division.closesAtSim ? countdownToSimMonth(division.closesAtSim.month, division.closesAtSim.year, data.gameState) : msToHuman(Number(division.closesAt || 0) - now))}</b> or early once all playable and NPC allocations are recorded.</p>
    <p class="muted">Your current vote weight: <b>${esc(myWeight.toFixed(2))}</b>. Absent members transfer weight to their party leader; if the leader is absent, delegated votes apply.</p>
    ${pendingAmendmentDivisions ? `<p class="muted">Main bill division paused until amendment divisions are finished.</p>` : ""}
    ${!partyMeta.playable ? `<p class="muted">Your party is NPC in this cycle; only Speaker allocation applies.</p>` : ""}
    ${partyMeta.playable && !canVote ? `<p class="muted">You currently have no vote weight (likely absent without delegated weight).</p>` : ""}
    <div class="tile-bottom" style="padding-top:0;">
      <button class="btn ${current === "aye" ? "primary" : ""}" data-vote="aye" ${canVote && !pendingAmendmentDivisions ? "" : "disabled"}>Aye</button>
      <button class="btn ${current === "no" ? "primary" : ""}" data-vote="no" ${canVote && !pendingAmendmentDivisions ? "" : "disabled"}>No</button>
      <button class="btn ${current === "abstain" ? "primary" : ""}" data-vote="abstain" ${canVote && !pendingAmendmentDivisions ? "" : "disabled"}>Abstain</button>
    </div>
    ${isSpeaker(data) && division.status === "closed" && totals.aye === totals.no ? `
      <div style="margin-top:12px;" class="tile-bottom">
        <button class="btn" data-speaker="move-on">Speaker: Move On (status quo)</button>
        <button class="btn danger" data-speaker="tie-break">Speaker: Cast Tie-break Vote</button>
      </div>
    ` : ""}
  `;

  const npcParties = parties.filter((p) => !p.playable && Number(p.seats || 0) > 0 && !autoAbstainNpc.has(p.name));
  if (isSpeaker(data)) {
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

    voting.querySelector("#speaker-division-controls")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const npcVotes = {};
      npcParties.forEach((p) => {
        const v = String(fd.get(`npc-${p.name}`) || "").toLowerCase();
        if (["aye", "no", "abstain"].includes(v)) npcVotes[p.name] = v;
      });
      const rebelsByParty = {};
      parties.filter((p) => p.playable).forEach((p) => {
        const seats = Number(p.seats || 0);
        const raw = Number(fd.get(`rebels-${p.name}`) || 0);
        rebelsByParty[p.name] = Math.max(0, Math.min(seats, raw));
      });
      setNpcVotes(bill, npcVotes);
      setRebellions(bill, rebelsByParty);
      maybeAutoCloseDivision(bill, data);
      persistAndRerender(data, bill);
    });
  }

  progress.innerHTML = `
    <h2>Division Progress</h2>
    <div class="kv"><span>Aye</span><b>${totals.aye}</b></div>
    <div class="kv"><span>No</span><b>${totals.no}</b></div>
    <div class="kv"><span>Abstain</span><b>${totals.abstain}</b></div>
    <div class="kv"><span>Status</span><b>${esc(division.status)}</b></div>
  `;

  voting.querySelectorAll("[data-vote]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rebelsByPartyInner = division.rebelsByParty || {};
      const weight = getCurrentVoteWeight(data, currentName || myParty, myParty, rebelsByPartyInner);
      if (weight <= 0) return;
      castDivisionVote(bill, currentName || myParty, { choice: btn.dataset.vote, party: myParty, weight });
      maybeAutoCloseDivision(bill, data);
      persistAndRerender(data, bill);
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
  saveState(data);
  if (rerenderAll) {
    renderBillMeta(bill, data);
    renderBillText(bill);
    renderAmendments(bill, data);
    renderDivision(bill, data);
    setDebateLink(bill);
  }
}

function autoAdvanceStage(bill, data) {
  if (bill.status === "failed" || bill.status === "passed" || bill.status === "awaiting-assent") return false;
  const deadline = bill.stageDeadlineSim;
  if (!deadline) return false;
  const expired = isDeadlinePassed(deadline, data.gameState);
  if (!expired) return false;

  let changed = false;
  if (bill.stage === "Second Reading") {
    bill.stage = "Report Stage";
    bill.stageStartedAt = Date.now();
    bill.stageDeadlineSim = createDeadline(data.gameState, 1);
    changed = true;
  } else if (bill.stage === "Report Stage") {
    bill.stage = "Report Debate";
    bill.stageStartedAt = Date.now();
    bill.stageDeadlineSim = createDeadline(data.gameState, 2);
    changed = true;
  } else if (bill.stage === "Report Debate") {
    bill.stage = "Final Division";
    bill.stageStartedAt = Date.now();
    bill.stageDeadlineSim = createDeadline(data.gameState, 1);
    changed = true;
  }

  if (changed) saveState(data);
  return changed;
}

export function initBillPage(data) {
  const billId = getBillIdFromUrl();
  const bill = (data?.orderPaperCommons || []).find((b) => b.id === billId) || (data?.orderPaperCommons || [])[0];

  if (!bill) {
    const title = $("billTitle");
    if (title) title.textContent = "Bill not found";
    const meta = $("billMeta");
    if (meta) meta.innerHTML = '<div class="muted-block">No bill data available.</div>';
    return;
  }

  // Auto-advance expired stages
  while (autoAdvanceStage(bill, data)) { /* advance until current stage is not expired */ }

  renderBillMeta(bill, data);
  renderBillText(bill);
  renderAmendments(bill, data);
  renderDivision(bill, data);
  setDebateLink(bill);
}
