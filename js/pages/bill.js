import { ensureDivision, castDivisionVote, tallyDivision, closeDivision, resolveDivisionResult } from "../engines/division-engine.js";
import { saveData } from "../core.js";

function $(id) {
  return document.getElementById(id);
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const DIVISION_STAGES = new Set(["Division", "Third Reading Division", "Final Division"]);
const AMENDMENT_LOCK_STAGES = new Set(["Division", "Third Reading", "Third Reading Division", "Royal Assent"]);

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

function stageCountdown(bill) {
  const start = Number(bill?.stageStartedAt);
  const dur = Number(bill?.stageDurationMs);
  if (!Number.isFinite(start) || !Number.isFinite(dur) || dur <= 0) return "—";
  return msToHuman(start + dur - Date.now());
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
        <span class="bill-badge">Stage ends: ${esc(stageCountdown(bill))}</span>
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
  `;

  if (canManage) {
    meta.querySelector('[data-agenda="grant-second-reading"]')?.addEventListener("click", () => {
      if (bill.stage !== "First Reading") return;
      bill.stage = "Second Reading";
      bill.stageStartedAt = Date.now();
      bill.stageDurationMs = 48 * 60 * 60 * 1000;
      persistAndRerender(data, bill);
    });

    meta.querySelector('[data-agenda="refuse-second-reading"]')?.addEventListener("click", () => {
      if (bill.stage !== "First Reading") return;
      bill.stage = "First Reading Refused";
      bill.status = "failed";
      bill.stageStartedAt = Date.now();
      persistAndRerender(data, bill);
    });

    meta.querySelector("#billTypeSelect")?.addEventListener("change", (ev) => {
      bill.billType = ev.target.value;
      persistAndRerender(data, bill, false);
    });
  }
}

function renderBillText(bill) {
  const root = $("billText");
  if (!root) return;
  root.innerHTML = `<pre style="white-space:pre-wrap; margin:0; font:inherit;">${esc(bill.billText || "No bill text loaded.")}</pre>`;
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
  const amendLocked = AMENDMENT_LOCK_STAGES.has(bill.stage);
  const canSubmit = canProposeAmendment(data) && !amendLocked;

  root.innerHTML = `
    <div class="docket-list">${bill.amendments.length ? bill.amendments.map(amendmentRow).join("") : '<div class="muted-block">No amendments submitted yet.</div>'}</div>
    <hr>
    <h3 style="margin:0 0 8px;">Submit amendment</h3>
    ${amendLocked ? '<div class="muted-block">Amendments are closed at this stage.</div>' : ""}
    ${!canSubmit && !amendLocked ? '<div class="muted-block">Your role cannot submit amendments at this time.</div>' : ""}
    ${canSubmit ? `
      <form id="amendmentForm" class="form-grid">
        <label for="amClause">Clause number</label>
        <input id="amClause" type="number" min="1" required>

        <label for="amType">Type</label>
        <select id="amType" required>
          <option value="insert">Insert</option>
          <option value="replace">Replace</option>
          <option value="delete">Delete</option>
        </select>

        <label for="amTitle">Title</label>
        <input id="amTitle" type="text" maxlength="140" required>

        <label for="amText">Text</label>
        <textarea id="amText" rows="4" required></textarea>

        <div></div>
        <div><button class="btn primary" type="submit">Submit Amendment</button></div>
      </form>
    ` : ""}
  `;

  root.querySelector("#amendmentForm")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const clause = Number(root.querySelector("#amClause")?.value || 0);
    const type = root.querySelector("#amType")?.value;
    const title = root.querySelector("#amTitle")?.value?.trim();
    const text = root.querySelector("#amText")?.value?.trim();
    if (!clause || !title || !text) return;

    const nextId = `A${bill.amendments.length + 1}`;
    bill.amendments.push({
      id: nextId,
      articleNumber: clause,
      type,
      title,
      text,
      proposedBy: partyOfCurrent(data),
      status: "proposed",
      supporters: [partyOfCurrent(data)],
      submittedAt: new Date().toISOString()
    });

    persistAndRerender(data, bill);
  });
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

  const division = ensureDivision(bill, { status: "open", openedAt: Date.now() - 30 * 60 * 1000, closesAt: Date.now() + 90 * 60 * 1000 });
  const totals = tallyDivision(bill, data);
  const now = Date.now();
  if (division.status === "open" && Number(division.closesAt || 0) <= now) {
    closeDivision(bill);
  }

  const myParty = partyOfCurrent(data);
  const current = division.votes[myParty]?.choice || "";
  const canVote = division.status === "open";

  voting.style.display = "block";
  progress.style.display = "block";

  voting.innerHTML = `
    <h2>Division</h2>
    <p class="muted">Cast your party whip position for this demo. Vote closes in <b>${esc(msToHuman(Number(division.closesAt || 0) - now))}</b>.</p>
    <div class="tile-bottom" style="padding-top:0;">
      <button class="btn ${current === "aye" ? "primary" : ""}" data-vote="aye" ${canVote ? "" : "disabled"}>Aye</button>
      <button class="btn ${current === "no" ? "primary" : ""}" data-vote="no" ${canVote ? "" : "disabled"}>No</button>
      <button class="btn ${current === "abstain" ? "primary" : ""}" data-vote="abstain" ${canVote ? "" : "disabled"}>Abstain</button>
    </div>
    ${isSpeaker(data) && division.status === "closed" && totals.aye === totals.no ? `
      <div style="margin-top:12px;" class="tile-bottom">
        <button class="btn" data-speaker="move-on">Speaker: Move On (status quo)</button>
        <button class="btn danger" data-speaker="tie-break">Speaker: Cast Tie-break Vote</button>
      </div>
    ` : ""}
  `;

  progress.innerHTML = `
    <h2>Division Progress</h2>
    <div class="kv"><span>Aye</span><b>${totals.aye}</b></div>
    <div class="kv"><span>No</span><b>${totals.no}</b></div>
    <div class="kv"><span>Abstain</span><b>${totals.abstain}</b></div>
    <div class="kv"><span>Status</span><b>${esc(division.status)}</b></div>
  `;

  voting.querySelectorAll("[data-vote]").forEach((btn) => {
    btn.addEventListener("click", () => {
      castDivisionVote(bill, myParty, { choice: btn.dataset.vote, party: myParty, weight: 1 });
      persistAndRerender(data, bill);
    });
  });

  voting.querySelector('[data-speaker="move-on"]')?.addEventListener("click", () => {
    bill.status = "stalled";
    division.status = "resolved-by-speaker";
    persistAndRerender(data, bill);
  });

  voting.querySelector('[data-speaker="tie-break"]')?.addEventListener("click", () => {
    division.status = "resolved-by-speaker";
    bill.status = resolveDivisionResult(bill, data) === "failed" ? "failed" : "passed";
    bill.stage = "Passed Commons";
    persistAndRerender(data, bill);
  });
}

function persistAndRerender(data, bill, rerenderAll = true) {
  const idx = data.orderPaperCommons.findIndex((b) => b.id === bill.id);
  if (idx >= 0) data.orderPaperCommons[idx] = bill;
  saveData(data);
  if (rerenderAll) {
    renderBillMeta(bill, data);
    renderBillText(bill);
    renderAmendments(bill, data);
    renderDivision(bill, data);
    setDebateLink(bill);
  }
}

export function initBillPage(data) {
  const billId = getBillIdFromUrl();
  const bill = (data?.orderPaperCommons || []).find((b) => b.id === billId) || (data?.orderPaperCommons || [])[0];

  if (!bill) {
    const title = $("billTitle");
    if (title) title.textContent = "Bill not found";
    const meta = $("billMeta");
    if (meta) meta.innerHTML = '<div class="muted-block">No bill data is available in demo.json.</div>';
    return;
  }

  renderBillMeta(bill, data);
  renderBillText(bill);
  renderAmendments(bill, data);
  renderDivision(bill, data);
  setDebateLink(bill);
}
