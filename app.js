/* =========================================================
   Rule Britannia — app.js (CLEAN BASELINE + BILL DIVISIONS) — WORKING REWRITE
   - Loads demo.json once
   - Uses localStorage rb_full_data as the live state (single source of truth)
   - Dashboard: Sim Date + What's Going On + Live Docket + Order Paper
   - Hansard: passed/failed archive
   - Game Clock: 3 real days = 1 sim month; Sundays frozen
   - Bill lifecycle + countdown timers
   - Amendment engine (support window + division) + SINGLE ACTIVE AMENDMENT RULE
   - Main bill division engine (24 active hours, Sunday freeze, auto-close)
   - Bill page: main division voting + amendment list + amendment modal form
   - Submit Bill builder (structured template)
   - Party Draft builder (saved to localStorage)
   - Question Time (NOT included in this paste to keep it clean; add back if needed)
   - Absence system (delegation)
   - Nav highlighting + dropdown support
   ========================================================= */

(() => {
  "use strict";

  /* =========================
     Config
     ========================= */
  const DATA_URL = "data/demo.json";
const LS_USERS = "rb_users";
const LS_CURRENT_USER = "rb_current_user";
const LS_SIMS = "rb_sims";
const LS_ACTIVE_SIM = "rb_active_sim";

// each sim stores its world state under: rb_full_data__<simId>
function simDataKey(simId){ return `rb_full_data__${simId}`; }

  const LS_PARTY_DRAFTS = "rb_party_drafts";

  /* =========================
     Helpers
     ========================= */
  const safe = (v, fallback = "") => (v === null || v === undefined ? fallback : v);
  const nowTs = () => Date.now();

  function isSunday(ts = nowTs()) {
    return new Date(ts).getDay() === 0;
  }

  function getMonthName(month) {
    const months = [
      "January","February","March","April","May","June",
      "July","August","September","October","November","December"
    ];
    return months[month - 1] || "Unknown";
  }

  function msToDHM(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function msToHMS(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}h ${m}m ${sec}s`;
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  /* =========================
     Storage
     ========================= */
  function getData() {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  function saveData(data) {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  }

  function getPartyDrafts() {
    return JSON.parse(localStorage.getItem(LS_PARTY_DRAFTS) || "[]");
  }

  function savePartyDrafts(list) {
    localStorage.setItem(LS_PARTY_DRAFTS, JSON.stringify(list));
  }

  /* =========================
     Normalise live state
     ========================= */
function normaliseData(data) {
  data.players = Array.isArray(data.players) ? data.players : [];
  data.orderPaperCommons = Array.isArray(data.orderPaperCommons) ? data.orderPaperCommons : [];
  data.whatsGoingOn = data.whatsGoingOn || {};
  data.liveDocket = data.liveDocket || {};

  data.gameState = data.gameState || {
    started: true,
    isPaused: false,
    startRealDate: new Date().toISOString(),
    startSimMonth: 8,
    startSimYear: 1997
  };

  data.parliament = data.parliament || { totalSeats: 650, parties: [] };
  data.adminSettings = data.adminSettings || { monarchGender: "Queen" };
  data.oppositionTracker = data.oppositionTracker || {};
   
// --- News + Papers base state ---
data.news = data.news || { stories: [] };

data.papers = data.papers || {
  sun: { name: "The Sun", mastheadClass: "masthead-sun", issues: [] },
  telegraph: { name: "The Daily Telegraph", mastheadClass: "masthead-telegraph", issues: [] },
  mail: { name: "The Daily Mail", mastheadClass: "masthead-mail", issues: [] },
  mirror: { name: "The Daily Mirror", mastheadClass: "masthead-mirror", issues: [] },
  times: { name: "The Times", mastheadClass: "masthead-times", issues: [] },
  ft: { name: "Financial Times", mastheadClass: "masthead-ft", issues: [] },
  guardian: { name: "The Guardian", mastheadClass: "masthead-guardian", issues: [] },
  independent: { name: "The Independent", mastheadClass: "masthead-independent", issues: [] }
};

  // --- NEW: currentUser + character model ---
  // Migrate from old currentPlayer if it exists.
  const legacy = data.currentPlayer || null;

  data.currentUser = data.currentUser || {
    username: legacy?.name ? String(legacy.name).toLowerCase().replace(/\s+/g, "_") : "guest",
    systemRole: "player", // admin | moderator | speaker | player
    character: {
      name: legacy?.name || "Unknown MP",
      party: legacy?.party || "Unknown",
      parliamentaryRole: legacy?.role || "backbencher",
      office: legacy?.office || null,
      isSpeaker: !!legacy?.isSpeaker
    }
  };

  // Keep currentPlayer for backwards compatibility (so existing parts of app.js don’t break)
  data.currentPlayer = data.currentPlayer || {
    name: data.currentUser.character.name,
    party: data.currentUser.character.party,
    role: data.currentUser.character.parliamentaryRole,
    office: data.currentUser.character.office,
    isSpeaker: data.currentUser.character.isSpeaker
  };

  // --- News storage base ---
  data.news = data.news || { items: [], archive: [] };

  // If no news exists, seed from whatsGoingOn.bbc (so News page isn’t empty)
  if (!data.news.items.length && data.whatsGoingOn?.bbc?.headline) {
    data.news.items.unshift({
      id: `news-${Date.now()}`,
      createdAt: Date.now(),
      createdBy: "system",
      source: "BBC",
      category: "Top Story",
      headline: data.whatsGoingOn.bbc.headline,
      strap: data.whatsGoingOn.bbc.strap || "",
      body: data.whatsGoingOn.bbc.body || "",
      pinned: true
    });
  }

  return data;
}

function getSystemRole(data){
  return String(data?.currentUser?.systemRole || "player");
}

function getCharacter(data){
  return data?.currentUser?.character || {
    name: "Unknown MP",
    party: "Unknown",
    parliamentaryRole: "backbencher",
    office: null,
    isSpeaker: false
  };
}

function canModerate(data){
  const r = getSystemRole(data);
  return (r === "admin" || r === "moderator");
}

function canSpeak(data){
  const r = getSystemRole(data);
  return (r === "admin" || r === "speaker");
}

  /* =========================
     Time helpers (skip Sundays)
     ========================= */
  function addActiveHoursSkippingSundays(startTs, hours) {
    let t = startTs;
    let remaining = hours;
    while (remaining > 0) {
      t += 3600000;
      if (!isSunday(t)) remaining--;
    }
    return t;
  }

  function addValidDaysSkippingSundays(startTs, validDays) {
    let t = startTs;
    let remaining = validDays;
    while (remaining > 0) {
      t += 86400000;
      if (!isSunday(t)) remaining--;
    }
    return t;
  }

  /* =========================
     NAV
     ========================= */
  function initNavUI() {
    const current = location.pathname.split("/").pop() || "dashboard.html";

    document.querySelectorAll(".nav a").forEach(link => {
      const href = link.getAttribute("href");
      if (!href) return;
      if (href.startsWith("http")) return;

      if (href === current) {
        link.classList.add("active");
        const group = link.closest(".nav-group");
        if (group) {
          const toggle = group.querySelector(".nav-toggle");
          if (toggle) toggle.classList.add("active");
        }
      }
    });

    const groups = Array.from(document.querySelectorAll(".nav-group"));
    const toggles = Array.from(document.querySelectorAll(".nav-toggle"));
    if (!groups.length || !toggles.length) return;

    toggles.forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        groups.forEach(g => { if (g !== btn.parentElement) g.classList.remove("open"); });
        btn.parentElement.classList.toggle("open");
      });
    });

    document.addEventListener("click", () => groups.forEach(g => g.classList.remove("open")));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") groups.forEach(g => g.classList.remove("open"));
    });
  }

  /* =========================
     GAME CLOCK
     ========================= */
  function getGameState(data) {
    return data.gameState || { started: false };
  }

  function isClockPaused(data) {
    return getGameState(data).isPaused === true;
  }

  function countSundaysBetween(startTs, endTs) {
    let count = 0;
    const t = new Date(startTs);
    const end = new Date(endTs);
    t.setHours(0,0,0,0);
    end.setHours(0,0,0,0);

    while (t <= end) {
      if (t.getDay() === 0) count++;
      t.setDate(t.getDate() + 1);
    }
    return count;
  }

  function getSimMonthIndex(data) {
    const gs = getGameState(data);
    if (!gs.started) return 0;
    if (isClockPaused(data)) return 0;

    const start = new Date(gs.startRealDate).getTime();
    const now = nowTs();
    const realDays = Math.floor((now - start) / 86400000);
    const sundays = countSundaysBetween(start, now);
    const validDays = Math.max(0, realDays - sundays);

    // 3 valid days = 1 sim month
    return Math.floor(validDays / 3);
  }

  function getCurrentSimDate(data) {
    const gs = getGameState(data);
    const monthsPassed = getSimMonthIndex(data);

    const startMonthIndex = (gs.startSimMonth || 1) - 1; // 0-based
    const startYear = gs.startSimYear || 1997;

    const totalMonths = startMonthIndex + monthsPassed;
    const year = startYear + Math.floor(totalMonths / 12);
    const month = (totalMonths % 12) + 1;

    return { month, year };
  }

  function renderSimDate(data) {
    const el = document.getElementById("sim-date-display");
    const gs = getGameState(data);
    if (!el || !gs.started) return;

    const sim = getCurrentSimDate(data);
    el.textContent = `${getMonthName(sim.month)} ${sim.year}`;
  }

  /* =========================
     BILL ENGINE
     ========================= */
  const STAGE_ORDER = ["First Reading", "Second Reading", "Report Stage", "Division"];
  const STAGE_LENGTH_SIM_MONTHS = { "Second Reading": 2, "Report Stage": 1 };

  function ensureBillDefaults(bill) {
    if (!bill.createdAt) bill.createdAt = nowTs();
    if (!bill.stageStartedAt) bill.stageStartedAt = bill.createdAt;
    if (!bill.stage) bill.stage = "First Reading";
    if (!bill.status) bill.status = "in-progress";
    if (!bill.billType) bill.billType = (bill.type || "pmb");
    if (!Array.isArray(bill.amendments)) bill.amendments = [];
    if (!bill.hansard) bill.hansard = {};
    if (!bill.completedAt && (bill.status === "passed" || bill.status === "failed")) bill.completedAt = nowTs();
    return bill;
  }

  function isCompleted(bill) {
    return bill.status === "passed" || bill.status === "failed";
  }

  function shouldArchiveOffOrderPaperToday(bill) {
    if (!isCompleted(bill)) return false;
    if (!isSunday()) return false;
    const done = bill.completedAt || bill.stageStartedAt || bill.createdAt;
    const days = Math.floor((nowTs() - done) / 86400000);
    return days >= 1;
  }

  function billHasOpenAmendmentDivision(bill) {
    return (bill.amendments || []).some(a =>
      a.status === "division" && a.division && a.division.closed !== true
    );
  }

  function moveStage(bill, newStage) {
    bill.stage = newStage;
    bill.stageStartedAt = nowTs();
  }

  function getSimMonthsSince(data, realTimestamp) {
    const gs = getGameState(data);
    if (!gs.started) return 0;

    const start = new Date(realTimestamp).getTime();
    const now = nowTs();

    const realDays = Math.floor((now - start) / 86400000);
    const sundays = countSundaysBetween(start, now);
    const validDays = Math.max(0, realDays - sundays);

    return Math.floor(validDays / 3);
  }

  /* =========================
     MAIN BILL DIVISION ENGINE
     ========================= */
  function ensureBillDivisionDefaults(bill){
    bill.division = bill.division || {
      openedAt: new Date().toISOString(),
      durationHours: 24,
      closesAt: null,
      votes: { aye: 0, no: 0, abstain: 0 },
      voters: [],
      closed: false,
      result: null
    };

    if (!bill.division.openedAt) bill.division.openedAt = new Date().toISOString();
    if (!bill.division.closesAt) {
      const opened = new Date(bill.division.openedAt).getTime();
      bill.division.closesAt = addActiveHoursSkippingSundays(opened, Number(bill.division.durationHours || 24));
    }

    bill.division.votes = bill.division.votes || { aye:0, no:0, abstain:0 };
    bill.division.voters = Array.isArray(bill.division.voters) ? bill.division.voters : [];
    if (typeof bill.division.closed !== "boolean") bill.division.closed = false;

    return bill.division;
  }

  function logHansardBillDivision(bill, outcome){
    bill.hansard = bill.hansard || {};
    bill.hansard.division = Array.isArray(bill.hansard.division) ? bill.hansard.division : [];

    const entry = {
      outcome, // "passed" | "failed"
      timestamp: new Date().toISOString(),
      votes: bill.division?.votes || { aye:0, no:0, abstain:0 }
    };

    const last = bill.hansard.division[bill.hansard.division.length - 1];
    if (last && last.outcome === entry.outcome &&
        last.votes?.aye === entry.votes.aye &&
        last.votes?.no === entry.votes.no &&
        last.votes?.abstain === entry.votes.abstain) {
      return;
    }

    bill.hansard.division.push(entry);
  }

  function processBillDivision(bill){
    if (!bill) return;
    ensureBillDefaults(bill);

    if (bill.stage !== "Division") return;
    if (isCompleted(bill)) return;

    const div = ensureBillDivisionDefaults(bill);
    if (div.closed) return;

    // Sunday freeze
    if (isSunday()) return;

    const now = nowTs();
    if (now >= div.closesAt) {
      div.closed = true;
      const aye = div.votes?.aye || 0;
      const no = div.votes?.no || 0;

      if (aye > no) {
        div.result = "passed";
        bill.status = "passed";
      } else {
        div.result = "failed"; // tie fails
        bill.status = "failed";
      }

      bill.completedAt = nowTs();
      logHansardBillDivision(bill, bill.status);
    }
  }

  function rbVoteBillDivision(billId, voterName, vote){
    const data = getData();
    if (!data) return null;

    normaliseData(data);
    const bill = (data.orderPaperCommons || []).find(b => b.id === billId);
    if (!bill) return null;

    ensureBillDefaults(bill);
    if (bill.stage !== "Division" || isCompleted(bill)) return null;

    const div = ensureBillDivisionDefaults(bill);
    if (div.closed) return null;

    const name = String(voterName || "").trim();
    if (!name) return null;

    if (div.voters.includes(name)) return null;

    if (vote === "aye") div.votes.aye++;
    else if (vote === "no") div.votes.no++;
    else div.votes.abstain++;

    div.voters.push(name);

    processBillDivision(bill);

    saveData(data);
    return { data, bill };
  }

  /* =========================
     BILL LIFECYCLE
     ========================= */
  function processBillLifecycle(data, bill) {
    ensureBillDefaults(bill);

    // Sundays freeze auto progression
    if (isSunday()) return bill;

    if (isCompleted(bill)) return bill;

    // Pause while amendment division open
    if (billHasOpenAmendmentDivision(bill)) return bill;

    // Defer-to-Monday rule
    if (bill.deferToMonday === true) {
      const today = new Date();
      if (today.getDay() === 0) return bill;
      bill.deferToMonday = false;
    }

    if (bill.stage === "First Reading") {
      const end = addActiveHoursSkippingSundays(new Date(bill.stageStartedAt).getTime(), 24);
      if (nowTs() >= end) moveStage(bill, "Second Reading");
      return bill;
    }

    if (bill.stage === "Second Reading") {
      const elapsed = getSimMonthsSince(data, bill.stageStartedAt);
      if (elapsed >= STAGE_LENGTH_SIM_MONTHS["Second Reading"]) moveStage(bill, "Report Stage");
      return bill;
    }

    if (bill.stage === "Report Stage") {
      const elapsed = getSimMonthsSince(data, bill.stageStartedAt);
      if (elapsed >= STAGE_LENGTH_SIM_MONTHS["Report Stage"]) {
        moveStage(bill, "Division");
        ensureBillDivisionDefaults(bill);
      }
      return bill;
    }

    if (bill.stage === "Division") {
      processBillDivision(bill);
      return bill;
    }

    return bill;
  }

  function billStageCountdown(data, bill) {
    const now = nowTs();

    if (bill.stage === "First Reading") {
      const end = addActiveHoursSkippingSundays(new Date(bill.stageStartedAt).getTime(), 24);
      return { label: isSunday() ? "Polling Day — clock frozen" : "First Reading ends in", msRemaining: end - now };
    }
    if (bill.stage === "Second Reading") {
      const end = addValidDaysSkippingSundays(new Date(bill.stageStartedAt).getTime(), 6);
      return { label: isSunday() ? "Polling Day — clock frozen" : "Second Reading ends in", msRemaining: end - now };
    }
    if (bill.stage === "Report Stage") {
      const end = addValidDaysSkippingSundays(new Date(bill.stageStartedAt).getTime(), 3);
      return { label: isSunday() ? "Polling Day — clock frozen" : "Report Stage ends in", msRemaining: end - now };
    }
    if (bill.stage === "Division") {
      const div = ensureBillDivisionDefaults(bill);
      return { label: isSunday() ? "Polling Day — clock frozen" : "Division closes in", msRemaining: (div.closesAt || 0) - now };
    }
    return { label: "", msRemaining: 0 };
  }

  function getBillBadge(bill) {
    const t = String(bill.billType || bill.type || "pmb").toLowerCase();
    if (t === "government") return { text: "Government Bill", cls: "badge-government" };
    if (t === "opposition") return { text: "Opposition Day Bill", cls: "badge-opposition" };
    return { text: "PMB", cls: "badge-pmb" };
  }

  /* =========================
     AMENDMENT ENGINE (core)
     ========================= */
  function ensureAmendmentDefaults(amend) {
    if (!amend.id) amend.id = `amend-${Date.now()}`;
    if (!amend.status) amend.status = "proposed";
    if (!Array.isArray(amend.supporters)) amend.supporters = [];
    if (!amend.submittedAt) amend.submittedAt = new Date().toISOString();
    return amend;
  }

  function logHansardAmendment(bill, amend, outcome) {
    bill.hansard = bill.hansard || {};
    bill.hansard.amendments = Array.isArray(bill.hansard.amendments) ? bill.hansard.amendments : [];

    const exists = bill.hansard.amendments.some(x => x.id === amend.id && x.outcome === outcome);
    if (exists) return;

    bill.hansard.amendments.push({
      id: amend.id,
      articleNumber: amend.articleNumber,
      type: amend.type,
      proposedBy: amend.proposedBy,
      supporters: amend.supporters || [],
      outcome,
      timestamp: new Date().toISOString(),
      failedReason: amend.failedReason || null
    });
  }

  function processAmendments(bill) {
    if (!Array.isArray(bill.amendments)) bill.amendments = [];

    // Sunday freeze
    if (isSunday()) return bill;

    const now = nowTs();

    bill.amendments.forEach(amend => {
      ensureAmendmentDefaults(amend);

      if (!amend.supportDeadlineAt) {
        const submitted = amend.submittedAt ? new Date(amend.submittedAt).getTime() : now;
        amend.supportDeadlineAt = addActiveHoursSkippingSundays(submitted, 24);
      }

      // fail if deadline passes without support
      if (amend.status === "proposed") {
        const supporters = amend.supporters || [];
        if (now > amend.supportDeadlineAt && supporters.length < 2) {
          amend.status = "failed";
          amend.failedReason = "Insufficient leader support within 24 active hours.";
          logHansardAmendment(bill, amend, "failed");
        }
      }

      // open division if supported
      if (amend.status === "proposed" && (amend.supporters || []).length >= 2) {
        amend.status = "division";
        const opened = now;
        amend.division = amend.division || {
          openedAt: new Date(opened).toISOString(),
          closesAt: addActiveHoursSkippingSundays(opened, 24),
          votes: { aye: 0, no: 0, abstain: 0 },
          voters: [],
          closed: false,
          result: null
        };
      }

      // close division if deadline passes
      if (amend.status === "division" && amend.division && amend.division.closed !== true) {
        if (now >= amend.division.closesAt) {
          const aye = amend.division.votes?.aye || 0;
          const no = amend.division.votes?.no || 0;

          amend.division.closed = true;

          if (aye > no) {
            amend.division.result = "passed";
            amend.status = "passed";
            logHansardAmendment(bill, amend, "passed");
          } else {
            amend.division.result = "failed";
            amend.status = "failed";
            amend.failedReason = (aye === no)
              ? "Tie (Speaker maintains status quo)."
              : "Majority against.";
            logHansardAmendment(bill, amend, "failed");
          }
        }
      }
    });

    return bill;
  }

  /* =========================
     Amendment actions
     ========================= */
  function rbUpdateBill(billId, updaterFn){
    const data = getData();
    if (!data) return null;

    normaliseData(data);

    const bill = (data.orderPaperCommons || []).find(b => b.id === billId);
    if (!bill) return null;

    ensureBillDefaults(bill);
    bill.amendments = Array.isArray(bill.amendments) ? bill.amendments : [];

    updaterFn(bill, data);

    processAmendments(bill);
    processBillDivision(bill);

    saveData(data);
    return { data, bill };
  }

  function rbProposeAmendment(billId, { articleNumber, type, text, proposedBy }){
    return rbUpdateBill(billId, (bill) => {
      // single live amendment per bill
      const active = (bill.amendments || []).some(a =>
        a.status === "proposed" ||
        (a.status === "division" && a.division && a.division.closed !== true)
      );

      if (active) {
        bill._lastAmendmentError = "Only one live amendment may run at a time for this bill. Resolve the current amendment first.";
        return;
      }

      const amend = ensureAmendmentDefaults({
        id: `amend-${Date.now()}`,
        articleNumber: Number(articleNumber),
        type,
        text,
        proposedBy,
        submittedAt: new Date().toISOString(),
        status: "proposed",
        supporters: []
      });

      amend.supportDeadlineAt = addActiveHoursSkippingSundays(nowTs(), 24);

      bill.amendments.unshift(amend);
      delete bill._lastAmendmentError;
    });
  }

  function rbSupportAmendment(billId, amendId, party){
    return rbUpdateBill(billId, (bill) => {
      const amend = (bill.amendments || []).find(a => a.id === amendId);
      if (!amend) return;
      if (amend.status !== "proposed") return;

      amend.supporters = Array.isArray(amend.supporters) ? amend.supporters : [];
      if (!amend.supporters.includes(party)) amend.supporters.push(party);
    });
  }

  function rbVoteAmendment(billId, amendId, voterName, vote){
    return rbUpdateBill(billId, (bill) => {
      const amend = (bill.amendments || []).find(a => a.id === amendId);
      if (!amend || amend.status !== "division" || !amend.division || amend.division.closed) return;

      const name = String(voterName || "").trim();
      if (!name) return;

      amend.division.voters = Array.isArray(amend.division.voters) ? amend.division.voters : [];
      if (amend.division.voters.includes(name)) return;

      amend.division.votes = amend.division.votes || { aye:0, no:0, abstain:0 };
      if (vote === "aye") amend.division.votes.aye++;
      else if (vote === "no") amend.division.votes.no++;
      else amend.division.votes.abstain++;

      amend.division.voters.push(name);
    });
  }

  /* =========================
     Amendment modal (Bill page)
     ========================= */
  function ensureAmendmentModal() {
    if (document.getElementById("rb-amend-modal")) return;

    const wrap = document.createElement("div");
    wrap.id = "rb-amend-modal";
    wrap.style.display = "none";
    wrap.innerHTML = `
      <div class="rb-modal-backdrop" style="
        position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:9998;
        display:flex; align-items:center; justify-content:center; padding:18px;
      ">
        <div class="panel rb-modal" style="
          width:min(720px, 100%); max-height:85vh; overflow:auto; z-index:9999;
        ">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
            <h2 style="margin:0;">Propose Amendment</h2>
            <button class="btn" type="button" id="rbAmendCloseBtn">Close</button>
          </div>

          <div class="muted-block" style="margin-top:12px;">
            One live amendment at a time per bill. After submission, party leader support runs for 24 active hours (Sundays frozen).
          </div>

          <form id="rbAmendForm" style="margin-top:12px;">
            <div class="form-grid">
              <label>Article</label>
              <input id="rbAmArticle" type="number" min="1" value="1" />

              <label>Type</label>
              <select id="rbAmType">
                <option value="replace">Replace</option>
                <option value="insert">Insert</option>
                <option value="delete">Delete</option>
              </select>

              <label>Text</label>
              <textarea id="rbAmText" rows="6" placeholder="Write the amendment text…"></textarea>

              <div style="display:flex; justify-content:flex-end; gap:10px; flex-wrap:wrap;">
                <button class="btn" type="button" id="rbAmendCancelBtn">Cancel</button>
                <button class="btn" type="submit">Submit Amendment</button>
              </div>
            </div>
          </form>
        </div>
      </div>
    `;

    document.body.appendChild(wrap);

    const close = () => { wrap.style.display = "none"; };

    wrap.querySelector(".rb-modal-backdrop").addEventListener("click", (e) => {
      if (e.target === wrap.querySelector(".rb-modal-backdrop")) close();
    });

    document.getElementById("rbAmendCloseBtn").addEventListener("click", close);
    document.getElementById("rbAmendCancelBtn").addEventListener("click", close);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && wrap.style.display !== "none") close();
    });
  }

  function openAmendmentModal({ billId, proposedBy }) {
    ensureAmendmentModal();

    const modal = document.getElementById("rb-amend-modal");
    modal.style.display = "block";

    document.getElementById("rbAmArticle").value = "1";
    document.getElementById("rbAmType").value = "replace";
    document.getElementById("rbAmText").value = "";

    const form = document.getElementById("rbAmendForm");
    form.onsubmit = (e) => {
      e.preventDefault();

      const articleNumber = Number(document.getElementById("rbAmArticle").value || 1);
      const type = document.getElementById("rbAmType").value;
      const text = (document.getElementById("rbAmText").value || "").trim();

      if (!text) return alert("Amendment text is required.");

      const res = rbProposeAmendment(billId, { articleNumber, type, text, proposedBy });

      if (!res) {
        const latest = getData();
        const b = (latest?.orderPaperCommons || []).find(x => x.id === billId);
        const msg = b?._lastAmendmentError || "Could not submit amendment.";
        return alert(msg);
      }

      modal.style.display = "none";
      location.reload();
    };
  }

  /* =========================
     Dashboard: What’s Going On
     ========================= */
  function renderWhatsGoingOn(data) {
    const el = document.getElementById("whats-going-on");
    if (!el) return;

    const w = safe(data.whatsGoingOn, {});
    const bbc = safe(w.bbc, {});
    const papers = safe(w.papers, {});
    const economy = safe(w.economy, {});
    const pollingRaw = Array.isArray(w.polling) ? w.polling : [];

    const polling = pollingRaw
      .filter(p => (p.value >= 2) || p.party === "SNP")
      .sort((a,b) => b.value - a.value);

    const pollingLines = polling.length
      ? polling.map(p => `<div class="row"><span>${escapeHtml(safe(p.party,"—"))}</span><b>${Number(p.value).toFixed(1)}%</b></div>`).join("")
      : `<div class="wgo-strap">No polling yet.</div>`;

    el.innerHTML = `
      <div class="wgo-grid">
        <div class="wgo-tile">
          <div class="wgo-kicker">BBC News</div>
          <div class="wgo-title">${escapeHtml(safe(bbc.headline, "No headline yet."))}</div>
          <div class="wgo-strap">${escapeHtml(safe(bbc.strap, ""))}</div>
          <div class="wgo-actions"><a class="btn" href="news.html">Open</a></div>
        </div>

        <div class="wgo-tile">
          <div class="wgo-kicker">Papers</div>
          <div class="wgo-title">${escapeHtml(safe(papers.paper, "Paper"))}: ${escapeHtml(safe(papers.headline, "No headline yet."))}</div>
          <div class="wgo-strap">${escapeHtml(safe(papers.strap, ""))}</div>
          <div class="wgo-actions"><a class="btn" href="papers.html">View</a></div>
        </div>

        <div class="wgo-tile">
          <div class="wgo-kicker">Economy</div>
          <div class="wgo-metric">
            <div class="row"><span>Growth</span><b>${Number(safe(economy.growth, 0)).toFixed(1)}%</b></div>
            <div class="row"><span>Inflation</span><b>${Number(safe(economy.inflation, 0)).toFixed(1)}%</b></div>
            <div class="row"><span>Unemployment</span><b>${Number(safe(economy.unemployment, 0)).toFixed(1)}%</b></div>
          </div>
          <div class="wgo-actions"><a class="btn" href="economy.html">Economy</a></div>
        </div>

        <div class="wgo-tile">
          <div class="wgo-kicker">Polling</div>
          <div class="wgo-metric">${pollingLines}</div>
          <div class="wgo-actions"><a class="btn" href="polling.html">Polling</a></div>
        </div>
      </div>
    `;
  }

  /* =========================
     Live Docket
     ========================= */
  function canSeeDocketItem(item, player) {
    const a = item.audience;
    if (!a) return true;
    if (a.speakerOnly) return !!player.isSpeaker;

    if (Array.isArray(a.roles) && a.roles.length) {
      if (!a.roles.includes(player.role)) return false;
    }
    if (Array.isArray(a.offices) && a.offices.length) {
      if (!player.office || !a.offices.includes(player.office)) return false;
    }
    return true;
  }

  function isLeader(playerObj) {
    return playerObj?.partyLeader === true ||
           playerObj?.role === "leader-opposition" ||
           playerObj?.role === "prime-minister";
  }

  function generateBillDivisionDocketItems(data){
    const items = [];
    (data.orderPaperCommons || []).forEach(bill => {
      ensureBillDefaults(bill);
      if (bill.stage !== "Division") return;
      if (isCompleted(bill)) return;

      ensureBillDivisionDefaults(bill);
      if (bill.division?.closed) return;

      const ms = Math.max(0, (bill.division?.closesAt || 0) - nowTs());
      items.push({
        type: "division",
        title: "Bill division open",
        detail: `${bill.title} · closes in ${msToHMS(ms)}`,
        ctaLabel: "Vote",
        href: `bill.html?id=${encodeURIComponent(bill.id)}`,
        priority: "high"
      });
    });
    return items;
  }

  function generateAmendmentDocketItems(data) {
    const items = [];
    const current = data.currentPlayer || {};
    const me = (data.players || []).find(p => p.name === current.name) || current;

    (data.orderPaperCommons || []).forEach(bill => {
      ensureBillDefaults(bill);
      processAmendments(bill);

      (bill.amendments || []).forEach(amend => {
        if (
          amend.status === "proposed" &&
          isLeader(me) &&
          !(amend.supporters || []).includes(me.party) &&
          nowTs() <= (amend.supportDeadlineAt || 0)
        ) {
          const ms = Math.max(0, amend.supportDeadlineAt - nowTs());
          items.push({
            type: "amendment",
            title: "Leader support available",
            detail: `Amendment on: ${bill.title} · closes in ${msToHMS(ms)}`,
            ctaLabel: "Open",
            href: `bill.html?id=${encodeURIComponent(bill.id)}`,
            priority: "normal"
          });
        }

        if (amend.status === "division" && amend.division && amend.division.closed !== true) {
          const ms = Math.max(0, amend.division.closesAt - nowTs());
          items.push({
            type: "amendment-division",
            title: "Amendment division open",
            detail: `Vote on: ${bill.title} · closes in ${msToHMS(ms)}`,
            ctaLabel: "Vote",
            href: `bill.html?id=${encodeURIComponent(bill.id)}`,
            priority: "high"
          });
        }
      });
    });

    return items;
  }

  function renderLiveDocket(data) {
    const el = document.getElementById("live-docket");
    if (!el) return;

    const player = data.currentPlayer || {};
    const docket = data.liveDocket || {};
    const staticItems = Array.isArray(docket.items) ? docket.items : [];

    let items = staticItems.filter(it => canSeeDocketItem(it, player));
    items = items.concat(generateBillDivisionDocketItems(data));
    items = items.concat(generateAmendmentDocketItems(data));

    if (!items.length) {
      el.innerHTML = `<div class="muted-block">No live items right now.</div>`;
      return;
    }

    const icon = (type) => {
      switch (type) {
        case "question": return "❓";
        case "motion": return "📜";
        case "edm": return "✍️";
        case "statement": return "🗣️";
        case "division": return "🗳️";
        case "speaker": return "🔔";
        case "amendment": return "🧾";
        case "amendment-division": return "🗳️";
        default: return "•";
      }
    };

    el.innerHTML = `
      <div class="docket-top">
        <div class="docket-kicker">
          As of: <b>${escapeHtml(safe(docket.asOf, "now"))}</b> · Logged in as: <b>${escapeHtml(safe(player.name,"Unknown"))}</b> (${escapeHtml(safe(player.role,"—"))})
        </div>
      </div>

      <div class="docket-list">
        ${items.map(it => `
          <div class="docket-item ${it.priority === "high" ? "high" : ""}">
            <div class="docket-left">
              <div class="docket-icon">${icon(it.type)}</div>
              <div class="docket-text">
                <div class="docket-title">${escapeHtml(safe(it.title, "Item"))}</div>
                <div class="docket-detail">${escapeHtml(safe(it.detail, ""))}</div>
              </div>
            </div>
            <div class="docket-cta">
              <a class="btn" href="${escapeHtml(safe(it.href, "#"))}">${escapeHtml(safe(it.ctaLabel, "Open"))}</a>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  /* =========================
     Order Paper
     ========================= */
  function renderOrderPaper(data) {
    const el = document.getElementById("order-paper");
    if (!el) return;

    let bills = Array.isArray(data.orderPaperCommons) ? data.orderPaperCommons : [];

    bills = bills.map(b => {
      ensureBillDefaults(b);
      processAmendments(b);
      processBillLifecycle(data, b);
      return b;
    });

    data.orderPaperCommons = bills;
    saveData(data);

    bills = bills.filter(b => !isCompleted(b) || !shouldArchiveOffOrderPaperToday(b));

    if (!bills.length) {
      el.innerHTML = `<div class="muted-block">No bills on the Order Paper.</div>`;
      return;
    }

    el.innerHTML = `
      <div class="order-grid">
        ${bills.map(b => {
          const badge = getBillBadge(b);
          const t = billStageCountdown(data, b);

          const openAmends = (b.amendments || []).filter(x => x.status === "proposed").length;
          const openDiv = (b.amendments || []).some(x => x.status === "division" && x.division && !x.division.closed);

          const amendLine = (openAmends || openDiv)
            ? `<div class="small" style="margin-top:8px;">
                 Amendments: <b>${openAmends}</b> proposed${openDiv ? " · <b>Division open</b>" : ""}
               </div>`
            : ``;

          const resultBlock = isCompleted(b)
            ? `<div class="bill-result ${b.status === "passed" ? "passed" : "failed"}">
                 ${b.status === "passed" ? "Royal Assent Granted" : "Bill Defeated"}
               </div>`
            : `<div class="bill-current">Current Stage: <b>${escapeHtml(b.stage)}</b></div>`;

          const timerLine = (!isCompleted(b) && t.label)
            ? `<div class="timer"><div class="kv"><span>${escapeHtml(t.label)}</span><b>${escapeHtml(msToDHM(t.msRemaining))}</b></div></div>`
            : ``;

          return `
            <div class="bill-card ${escapeHtml(b.status)}">
              <div class="bill-title">${escapeHtml(safe(b.title, "Untitled Bill"))}</div>
              <div class="bill-sub">Author: ${escapeHtml(safe(b.author, "—"))} · ${escapeHtml(safe(b.department, "—"))}</div>

              <div class="badges">
                <span class="bill-badge ${badge.cls}">${escapeHtml(badge.text)}</span>
              </div>

              <div class="stage-track">
                ${STAGE_ORDER.map(s => `<div class="stage ${b.stage === s ? "on" : ""}">${escapeHtml(s)}</div>`).join("")}
              </div>

              ${amendLine}
              ${resultBlock}
              ${timerLine}

              <div class="bill-actions spaced">
                <a class="btn" href="bill.html?id=${encodeURIComponent(safe(b.id,""))}">View Bill</a>
                <a class="btn" href="https://forum.rulebritannia.org" target="_blank" rel="noopener">Debate</a>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  /* =========================
     Hansard
     ========================= */
  function renderHansard(data) {
    const passedEl = document.getElementById("hansard-passed");
    const failedEl = document.getElementById("hansard-failed");
    if (!passedEl && !failedEl) return;

    const bills = Array.isArray(data.orderPaperCommons) ? data.orderPaperCommons : [];
    const passed = bills.filter(b => b.status === "passed");
    const failed = bills.filter(b => b.status === "failed");

    function renderList(list, emptyText) {
      if (!list.length) return `<div class="muted-block">${escapeHtml(emptyText)}</div>`;
      return `
        <div class="order-grid">
          ${list.map(b => `
            <div class="bill-card ${escapeHtml(b.status)}">
              <div class="bill-title">${escapeHtml(safe(b.title, "Untitled"))}</div>
              <div class="bill-sub">Author: ${escapeHtml(safe(b.author, "—"))} · ${escapeHtml(safe(b.department, "—"))}</div>
              <div class="bill-result ${b.status === "passed" ? "passed" : "failed"}">
                ${b.status === "passed" ? "Passed (Royal Assent)" : "Defeated"}
              </div>
              <div class="bill-actions spaced">
                <a class="btn" href="bill.html?id=${encodeURIComponent(b.id)}">View Bill</a>
                <a class="btn" href="https://forum.rulebritannia.org" target="_blank" rel="noopener">Debate</a>
              </div>
            </div>
          `).join("")}
        </div>
      `;
    }

    if (passedEl) passedEl.innerHTML = renderList(passed, "No passed legislation yet.");
    if (failedEl) failedEl.innerHTML = renderList(failed, "No defeated legislation yet.");
  }
/* =========================
   NEWS (BBC STYLE)
   - main tiles + flavour tiles
   - breaking ticker
   - auto sim date stamp (Month Year)
   - auto archive after 14 real days
   ========================= */

const NEWS_CATEGORIES = [
  "Politics",
  "Economy",
  "Security",
  "Health",
  "World",
  "Environment",
  "Culture",
  "Sport",
  "Parliament",
  "Local"
];

function getSimStamp(data){
  const sim = getCurrentSimDate(data);
  return `${getMonthName(sim.month)} ${sim.year}`;
}

function processNewsLifecycle(data){
  data.news = data.news || { items: [], archive: [] };
  data.news.items = Array.isArray(data.news.items) ? data.news.items : [];
  data.news.archive = Array.isArray(data.news.archive) ? data.news.archive : [];

  const now = nowTs();
  const TWO_WEEKS = 14 * 86400000;

  // move old items to archive
  const stillLive = [];
  data.news.items.forEach(item => {
    const created = Number(item.createdAt || now);
    if ((now - created) >= TWO_WEEKS) {
      const archived = { ...item, isLive: false, archivedAt: now };
      data.news.archive.unshift(archived);
    } else {
      stillLive.push(item);
    }
  });

  data.news.items = stillLive;

  // keep archive newest-first
  data.news.archive.sort((a,b) => (b.archivedAt || b.createdAt || 0) - (a.archivedAt || a.createdAt || 0));

  saveData(data);
}

function renderNewsPage(data){
  const tickerEl = document.getElementById("news-ticker");
  const mainEl = document.getElementById("news-main");
  const flavourEl = document.getElementById("news-flavour");
  const deskEl = document.getElementById("news-desk");
  const archEl = document.getElementById("news-archive");
  if (!tickerEl && !mainEl && !flavourEl && !deskEl && !archEl) return;

  // ensure + lifecycle
  data.news = data.news || { items: [], archive: [] };
  processNewsLifecycle(data);

  const items = Array.isArray(data.news.items) ? data.news.items : [];
  const archive = Array.isArray(data.news.archive) ? data.news.archive : [];

  // split types
  const main = items.filter(x => (x.kind || "main") === "main");
  const flavour = items.filter(x => (x.kind || "main") === "flavour");

  // breaking ticker = live breaking items (most recent first)
  const breaking = items
    .filter(x => !!x.breaking)
    .sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 8);

  // --- TICKER ---
  if (tickerEl) {
    if (!breaking.length) {
      tickerEl.innerHTML = `<b>BREAKING</b> · No breaking headlines at the moment.`;
    } else {
      tickerEl.innerHTML = `
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
          <div class="bill-badge badge-opposition" style="padding:6px 10px;">BREAKING</div>
          <div style="display:flex; gap:18px; flex-wrap:wrap;">
            ${breaking.map(n => `
              <span><b>${escapeHtml(n.headline)}</b> <span class="small">(${escapeHtml(n.simStamp || getSimStamp(data))})</span></span>
            `).join("")}
          </div>
        </div>
      `;
    }
  }

  // helper: render tile
  function renderTile(n, options = {}){
    const showControls = !!options.showControls;
    const isArchive = !!options.isArchive;

    const stamp = escapeHtml(n.simStamp || getSimStamp(data));
    const cat = escapeHtml(n.category || "Politics");
    const breakingTag = n.breaking ? `<span class="bill-badge badge-opposition" style="margin-left:8px;">BREAKING</span>` : ``;

    const photo = (n.photoUrl || "").trim();
    const photoBlock = photo
      ? `<div style="margin-top:10px;">
           <img src="${escapeHtml(photo)}" alt="" style="width:100%; border-radius:10px; display:block;">
         </div>`
      : ``;

    const body = (n.body || "").trim();
    const strap = (n.strap || "").trim();

    return `
      <div class="bill-card" style="margin-bottom:14px;">
        <div class="bill-title">${escapeHtml(n.headline)} ${breakingTag}</div>
        <div class="small" style="margin-top:6px;">
          <b>${escapeHtml("BBC News")}</b> · <b>${cat}</b> · <span>${stamp}</span>
          ${isArchive ? `<span class="small"> · Archived</span>` : ``}
        </div>

        ${photoBlock}

        ${strap ? `<div class="muted-block" style="margin-top:10px;">${escapeHtml(strap)}</div>` : ``}
        ${body ? `<div class="muted-block" style="margin-top:10px; white-space:pre-wrap;">${escapeHtml(body)}</div>` : ``}

        ${showControls ? `
          <div class="bill-actions spaced" style="margin-top:12px;">
            <button class="btn" type="button" data-news-togglebreaking="${escapeHtml(n.id)}">
              ${n.breaking ? "Unmark Breaking" : "Mark Breaking"}
            </button>
            <button class="btn" type="button" data-news-archive="${escapeHtml(n.id)}">Move to Archive</button>
          </div>
        ` : ``}
      </div>
    `;
  }

  // --- MAIN STORIES ---
  if (mainEl) {
    if (!main.length) {
      mainEl.innerHTML = `<div class="muted-block">No main stories yet.</div>`;
    } else {
      mainEl.innerHTML = main
        .sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, 12)
        .map(n => renderTile(n, { showControls: canModerate(data) }))
        .join("");
    }
  }

  // --- FLAVOUR ---
  if (flavourEl) {
    if (!flavour.length) {
      flavourEl.innerHTML = `<div class="muted-block">No flavour items yet.</div>`;
    } else {
      // smaller feel = shorter preview
      flavourEl.innerHTML = `
        <div class="docket-list">
          ${flavour
            .sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0))
            .slice(0, 20)
            .map(n => {
              const stamp = escapeHtml(n.simStamp || getSimStamp(data));
              const cat = escapeHtml(n.category || "Politics");
              const photo = (n.photoUrl || "").trim();

              return `
                <div class="docket-item">
                  <div class="docket-left">
                    <div class="docket-icon">📰</div>
                    <div class="docket-text">
                      <div class="docket-title">
                        ${escapeHtml(n.headline)}
                        ${n.breaking ? `<span class="bill-badge badge-opposition" style="margin-left:8px;">BREAKING</span>` : ``}
                      </div>
                      <div class="small"><b>BBC News</b> · <b>${cat}</b> · ${stamp}</div>
                      ${photo ? `<div style="margin-top:8px;"><img src="${escapeHtml(photo)}" alt="" style="width:100%; border-radius:10px; display:block;"></div>` : ``}
                      ${(n.strap || n.body) ? `<div class="docket-detail">${escapeHtml((n.strap || n.body || "").slice(0, 220))}${(String(n.strap||n.body||"").length>220)?"…":""}</div>` : ``}
                      ${canModerate(data) ? `
                        <div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap;">
                          <button class="btn" type="button" data-news-togglebreaking="${escapeHtml(n.id)}">
                            ${n.breaking ? "Unmark Breaking" : "Mark Breaking"}
                          </button>
                          <button class="btn" type="button" data-news-archive="${escapeHtml(n.id)}">Move to Archive</button>
                        </div>
                      ` : ``}
                    </div>
                  </div>
                </div>
              `;
            }).join("")}
        </div>
      `;
    }
  }

  // --- NEWS DESK (posting) ---
  if (deskEl) {
    if (!canModerate(data)) {
      deskEl.innerHTML = `
        <div class="muted-block">
          Only <b>Admin</b> and <b>Moderators</b> can post news.
        </div>
      `;
    } else {
      deskEl.innerHTML = `
        <div class="muted-block">
          Post a BBC News item. It automatically stamps the simulation date (<b>${escapeHtml(getSimStamp(data))}</b>).
        </div>

        <form id="rbNewsForm" style="margin-top:12px;">
          <div class="form-grid">

            <label>Type</label>
            <select id="rbNewsKind">
              <option value="main">Main story</option>
              <option value="flavour">Flavour (small)</option>
            </select>

            <label>Category</label>
            <select id="rbNewsCategory">
              ${NEWS_CATEGORIES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")}
            </select>

            <label>Headline</label>
            <input id="rbNewsHeadline" placeholder="Headline..." />

            <label>Photo URL (optional)</label>
            <input id="rbNewsPhoto" placeholder="https://..." />

            <label>Article Text</label>
            <textarea id="rbNewsBody" rows="7" placeholder="Write the article text…"></textarea>

            <div style="display:flex; justify-content:flex-end; gap:14px; flex-wrap:wrap; align-items:center;">
              <label style="display:flex; align-items:center; gap:8px;">
                <input type="checkbox" id="rbNewsBreaking" />
                Breaking News
              </label>
              <button class="btn" type="submit">Publish</button>
            </div>

          </div>
        </form>
      `;
    }
  }

  // --- ARCHIVE ---
  if (archEl) {
    if (!archive.length) {
      archEl.innerHTML = `<div class="muted-block">Archive is empty.</div>`;
    } else {
      archEl.innerHTML = archive
        .slice(0, 40)
        .map(n => renderTile(n, { showControls: false, isArchive: true }))
        .join("");
    }
  }

  // bind posting
  if (canModerate(data)) {
    const form = document.getElementById("rbNewsForm");
    if (form) {
      form.onsubmit = (e) => {
        e.preventDefault();
        const kind = document.getElementById("rbNewsKind")?.value || "main";
        const category = document.getElementById("rbNewsCategory")?.value || "Politics";
        const headline = (document.getElementById("rbNewsHeadline")?.value || "").trim();
        const photoUrl = (document.getElementById("rbNewsPhoto")?.value || "").trim();
        const body = (document.getElementById("rbNewsBody")?.value || "").trim();
        const breaking = !!document.getElementById("rbNewsBreaking")?.checked;

        if (!headline) return alert("Headline is required.");
        if (!body) return alert("Article text is required.");

        rbPublishNewsBBC({ kind, category, headline, photoUrl, body, breaking });
        location.reload();
      };
    }

    // bind archive + breaking toggle
    document.querySelectorAll("[data-news-archive]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-news-archive");
        rbArchiveNewsItem(id);
        location.reload();
      });
    });

    document.querySelectorAll("[data-news-togglebreaking]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-news-togglebreaking");
        rbToggleBreakingNews(id);
        location.reload();
      });
    });
  }
}

// publish BBC item
function rbPublishNewsBBC({ kind, category, headline, photoUrl, body, breaking }){
  const data = getData();
  if (!data) return;
  normaliseData(data);
  if (!canModerate(data)) return;

  data.news = data.news || { items: [], archive: [] };
  data.news.items = Array.isArray(data.news.items) ? data.news.items : [];

  const item = {
    id: `news-${nowTs()}`,
    createdAt: nowTs(),
    createdBy: data.currentUser?.username || "unknown",
    source: "BBC",
    kind: (kind === "flavour" ? "flavour" : "main"),
    category: NEWS_CATEGORIES.includes(category) ? category : "Politics",
    headline: String(headline),
    photoUrl: String(photoUrl || ""),
    body: String(body || ""),
    breaking: !!breaking,
    simStamp: getSimStamp(data),
    isLive: true
  };

  data.news.items.unshift(item);
  saveData(data);
}

function rbArchiveNewsItem(id){
  const data = getData();
  if (!data) return;
  normaliseData(data);
  if (!canModerate(data)) return;

  data.news = data.news || { items: [], archive: [] };
  data.news.items = Array.isArray(data.news.items) ? data.news.items : [];
  data.news.archive = Array.isArray(data.news.archive) ? data.news.archive : [];

  const idx = data.news.items.findIndex(x => x.id === id);
  if (idx === -1) return;

  const [item] = data.news.items.splice(idx, 1);
  const archived = { ...item, isLive: false, archivedAt: nowTs() };
  data.news.archive.unshift(archived);

  saveData(data);
}

function rbToggleBreakingNews(id){
  const data = getData();
  if (!data) return;
  normaliseData(data);
  if (!canModerate(data)) return;

  data.news = data.news || { items: [], archive: [] };
  data.news.items = Array.isArray(data.news.items) ? data.news.items : [];

  const item = data.news.items.find(x => x.id === id);
  if (!item) return;

  item.breaking = !item.breaking;
  saveData(data);
}

/* =========================
   PAPERS (British Press)
   - Tile per newspaper
   - Each paper has front pages (history)
   - Click to read
   ========================= */

const BRITISH_PAPERS = [
  "The Sun",
  "The Daily Telegraph",
  "The Daily Mail",
  "The Daily Mirror",
  "The Times",
  "The Financial Times",
  "The Guardian",
  "The Independent"
];

function ensurePapersData(data){
  data.papers = data.papers || {};
  BRITISH_PAPERS.forEach(name => {
    data.papers[name] = Array.isArray(data.papers[name]) ? data.papers[name] : [];
  });
}

function renderPapersPage(data){
  const gridEl = document.getElementById("papers-grid");
  const readerEl = document.getElementById("paper-reader");
  const readerContent = document.getElementById("paper-reader-content");
  const deskEl = document.getElementById("papers-desk");
  if (!gridEl && !deskEl) return;

  ensurePapersData(data);

  // ---- GRID ----
  if (gridEl){
    gridEl.innerHTML = `
      <div class="order-grid">
        ${BRITISH_PAPERS.map(paper => {
          const editions = data.papers[paper];
          const latest = editions[0];

          return `
            <div class="bill-card">
              <div class="bill-title">${escapeHtml(paper)}</div>
              <div class="muted-block" style="margin-top:10px;">
                ${latest
                  ? `<b>${escapeHtml(latest.headline)}</b><br>
                     <span class="small">${escapeHtml(latest.simStamp)}</span>`
                  : `<span class="small">No editions published yet.</span>`
                }
              </div>
              <div class="bill-actions spaced" style="margin-top:14px;">
                <button class="btn" data-open-paper="${escapeHtml(paper)}" type="button">
                  Read this Paper
                </button>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  // ---- OPEN PAPER ----
  document.querySelectorAll("[data-open-paper]").forEach(btn => {
    btn.addEventListener("click", () => {
      const paper = btn.getAttribute("data-open-paper");
      openPaperReader(data, paper);
    });
  });

  // ---- PRESS DESK ----
  if (deskEl){
    if (!canModerate(data)){
      deskEl.innerHTML = `
        <div class="muted-block">
          Only <b>Admin</b> and <b>Moderators</b> can publish front pages.
        </div>
      `;
    } else {
      deskEl.innerHTML = `
        <div class="muted-block">
          Publish a new front page. This automatically stamps the simulation date.
        </div>

        <form id="rbPaperForm" style="margin-top:12px;">
          <div class="form-grid">

            <label>Paper</label>
            <select id="rbPaperSelect">
              ${BRITISH_PAPERS.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("")}
            </select>

            <label>Headline</label>
            <input id="rbPaperHeadline" placeholder="Front page headline..." />

            <label>Photo URL (optional)</label>
            <input id="rbPaperPhoto" placeholder="https://..." />

            <label>Byline (optional)</label>
            <input id="rbPaperByline" placeholder="Jane Smith, Political Correspondent" />

            <label>Article Text</label>
            <textarea id="rbPaperBody" rows="8" placeholder="Write full front page article..."></textarea>

            <div style="display:flex; justify-content:flex-end;">
              <button class="btn" type="submit">Publish Front Page</button>
            </div>

          </div>
        </form>
      `;

      const form = document.getElementById("rbPaperForm");
      form.onsubmit = (e) => {
        e.preventDefault();

        const paper = document.getElementById("rbPaperSelect").value;
        const headline = (document.getElementById("rbPaperHeadline").value || "").trim();
        const photoUrl = (document.getElementById("rbPaperPhoto").value || "").trim();
        const byline = (document.getElementById("rbPaperByline").value || "").trim();
        const body = (document.getElementById("rbPaperBody").value || "").trim();

        if (!headline) return alert("Headline is required.");
        if (!body) return alert("Article text is required.");

        rbPublishFrontPage(paper, { headline, photoUrl, byline, body });
        location.reload();
      };
    }
  }
}

function rbPublishFrontPage(paper, { headline, photoUrl, byline, body }){
  const data = getData();
  if (!data) return;
  normaliseData(data);
  if (!canModerate(data)) return;

  ensurePapersData(data);

  const edition = {
    id: `paper-${nowTs()}`,
    createdAt: nowTs(),
    simStamp: getSimStamp(data),
    headline,
    photoUrl,
    byline,
    body
  };

  data.papers[paper].unshift(edition);
  saveData(data);
}

function openPaperReader(data, paper){
  const readerEl = document.getElementById("paper-reader");
  const contentEl = document.getElementById("paper-reader-content");
  if (!readerEl || !contentEl) return;

  const editions = data.papers[paper] || [];

  readerEl.style.display = "block";

  contentEl.innerHTML = `
    <h2 style="margin-top:0;">${escapeHtml(paper)}</h2>

    ${!editions.length
      ? `<div class="muted-block">No editions yet.</div>`
      : editions.map((ed, index) => `
          <div class="bill-card" style="margin-bottom:20px;">
            <div class="bill-title">
              ${escapeHtml(index === 0 ? "Current Front Page" : "Previous Front Page")}
            </div>

            <div style="margin-top:10px;">
              <h3 style="margin:0 0 6px;">${escapeHtml(ed.headline)}</h3>
              <div class="small">
                ${escapeHtml(ed.simStamp)}
                ${ed.byline ? ` · <i>${escapeHtml(ed.byline)}</i>` : ``}
              </div>
            </div>

            ${ed.photoUrl
              ? `<div style="margin-top:10px;">
                   <img src="${escapeHtml(ed.photoUrl)}" alt="" style="width:100%; border-radius:10px;">
                 </div>`
              : ``}

            <div class="muted-block" style="margin-top:10px; white-space:pre-wrap;">
              ${escapeHtml(ed.body)}
            </div>
          </div>
        `).join("")}
  `;

  readerEl.scrollIntoView({ behavior: "smooth" });
}

/* =========================
   USER PAGE (CONTROL PANEL BASE)
   ========================= */
function renderUserPage(data){
  const accEl = document.getElementById("user-account");
  const cpEl = document.getElementById("user-controlpanel");
  if (!accEl && !cpEl) return;

  const role = getSystemRole(data);
  const ch = getCharacter(data);
  const username = data.currentUser?.username || "guest";

  if (accEl) {
    accEl.innerHTML = `
      <div class="kv"><span>Username:</span><b>${escapeHtml(username)}</b></div>
      <div class="kv"><span>System Role:</span><b>${escapeHtml(role)}</b></div>
      <hr style="margin:12px 0;">
      <div class="kv"><span>Character:</span><b>${escapeHtml(ch.name)}</b></div>
      <div class="kv"><span>Party:</span><b>${escapeHtml(ch.party)}</b></div>
      <div class="kv"><span>Parliamentary Role:</span><b>${escapeHtml(ch.parliamentaryRole)}</b></div>
      <div class="kv"><span>Office:</span><b>${escapeHtml(ch.office || "—")}</b></div>
    `;
  }

  if (cpEl) {
    // Basic tab layout (simple, buildable)
    const tabs = [];

    tabs.push({ id: "tab-character", label: "Character", show: true });
    tabs.push({ id: "tab-speaker", label: "Speaker", show: (role === "admin" || role === "speaker") });
    tabs.push({ id: "tab-moderator", label: "Moderator", show: (role === "admin" || role === "moderator") });
    tabs.push({ id: "tab-admin", label: "Admin", show: (role === "admin") });

    cpEl.innerHTML = `
      <div class="muted-block">
        This is your control centre. Tabs appear based on your role.
      </div>

      <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;">
        ${tabs.filter(t => t.show).map(t => `
          <button class="btn" type="button" data-user-tab="${escapeHtml(t.id)}">${escapeHtml(t.label)}</button>
        `).join("")}
      </div>

      <div id="user-tab-root" style="margin-top:14px;"></div>
    `;

    const root = document.getElementById("user-tab-root");

    function setTab(id){
      if (!root) return;

      if (id === "tab-character") {
        root.innerHTML = `
          <div class="panel">
            <h2>Character</h2>
            <div class="muted-block">
              This is where we will later add:
              <ul>
                <li>Create / edit character (for new players)</li>
                <li>Character biography</li>
                <li>Constituency assignment</li>
              </ul>
            </div>
          </div>
        `;
        return;
      }

      if (id === "tab-speaker") {
        root.innerHTML = `
          <div class="panel">
            <h2>Speaker Controls</h2>
            <div class="muted-block">
              Base speaker tools will go here next:
              <ul>
                <li>Manage Order Paper</li>
                <li>Manage divisions</li>
                <li>Amendment selection / tie-break</li>
                <li>Question Time queue</li>
              </ul>
            </div>
          </div>
        `;
        return;
      }

      if (id === "tab-moderator") {
        root.innerHTML = `
          <div class="panel">
            <h2>Moderator Controls</h2>
            <div class="muted-block">
              Base moderator tools will go here next:
              <ul>
                <li>Publish news</li>
                <li>Publish papers</li>
                <li>Update economy tiles</li>
                <li>Moderate behaviour / warnings</li>
              </ul>
            </div>
          </div>
        `;
        return;
      }

      if (id === "tab-admin") {
        root.innerHTML = `
          <div class="panel">
            <h2>Admin Controls</h2>
            <div class="muted-block">
              Base admin tools will go here next:
              <ul>
                <li>Assign roles (admin/mod/speaker)</li>
                <li>Create timelines</li>
                <li>Reset / backup simulation state</li>
                <li>Global settings</li>
              </ul>
            </div>
          </div>
        `;
        return;
      }

      root.innerHTML = `<div class="muted-block">Tab not found.</div>`;
    }

    // default tab
    setTab("tab-character");

    cpEl.querySelectorAll("[data-user-tab]").forEach(btn => {
      btn.addEventListener("click", () => setTab(btn.getAttribute("data-user-tab")));
    });
  }
}

  /* =========================
     Bill Page (Main division + Amendments)
     Expects bill.html IDs:
       - #billTitle, #billMeta, #billText
       - #division-voting, #division-progress
       - #amendmentsList
     ========================= */
  function initBillPage(data){
    const titleEl = document.getElementById("billTitle");
    const metaEl = document.getElementById("billMeta");
    const textEl = document.getElementById("billText");
    const amendRoot = document.getElementById("amendmentsList");
    if (!titleEl || !metaEl || !textEl) return;

    const params = new URLSearchParams(location.search);
    const billId = params.get("id");

    const bill = billId
      ? (data.orderPaperCommons || []).find(b => b.id === billId)
      : (data.orderPaperCommons || [])[0];

    if (!bill) {
      titleEl.textContent = "Bill not found";
      metaEl.innerHTML = `
        <div class="muted-block">
          This bill ID doesn’t exist. Go back to the dashboard and open a bill from the Order Paper.
        </div>
        <div style="margin-top:12px;">
          <a class="btn" href="dashboard.html">Back to Dashboard</a>
        </div>
      `;
      textEl.textContent = "";
      if (amendRoot) amendRoot.textContent = "";
      return;
    }

    ensureBillDefaults(bill);
    processAmendments(bill);
    processBillLifecycle(data, bill);

    saveData(data);

    titleEl.textContent = bill.title || "Bill";

    const stageChips = STAGE_ORDER.map(s => `
      <div class="stage ${bill.stage === s ? "on" : ""}">${escapeHtml(s)}</div>
    `).join("");

    const resultBlock = isCompleted(bill)
      ? `<div class="bill-result ${bill.status === "passed" ? "passed" : "failed"}">
           ${bill.status === "passed" ? "Royal Assent Granted" : "Bill Defeated"}
         </div>`
      : `<div class="bill-current">Current Stage: <b>${escapeHtml(bill.stage || "—")}</b></div>`;

    const t = (!isCompleted(bill)) ? billStageCountdown(data, bill) : null;
    const countdownBlock = (t && t.label)
      ? `<div class="timer" style="margin-top:12px;">
           <div class="kv"><span>${escapeHtml(t.label)}</span><b>${escapeHtml(msToDHM(t.msRemaining))}</b></div>
         </div>`
      : ``;

    metaEl.innerHTML = `
      <div class="bill-title">${escapeHtml(bill.title)}</div>
      <div class="bill-sub">Author: ${escapeHtml(bill.author || "—")} · ${escapeHtml(bill.department || "—")}</div>

      <div class="stage-track" style="margin-top:12px;">
        ${stageChips}
      </div>

      ${resultBlock}
      ${countdownBlock}

      <div class="bill-actions spaced" style="margin-top:16px;">
        <a class="btn" href="dashboard.html">Back to Dashboard</a>
        <a class="btn" href="https://forum.rulebritannia.org" target="_blank" rel="noopener">Debate</a>
      </div>
    `;

    textEl.textContent = bill.billText || "(No bill text added yet.)";

    // ===== Main Division UI =====
    const votingEl = document.getElementById("division-voting");
    const progressEl = document.getElementById("division-progress");

    if (votingEl && progressEl) {
      if (bill.stage === "Division" && !isCompleted(bill)) {
        votingEl.style.display = "block";
        progressEl.style.display = "block";

        const me = data.currentPlayer || {};
        const voterName = String(me.name || "Unknown MP");

        ensureBillDivisionDefaults(bill);
        const div = bill.division;
        const msLeft = Math.max(0, (div.closesAt || 0) - nowTs());
        const alreadyVoted = (div.voters || []).includes(voterName);

        votingEl.innerHTML = `
          <h2 style="margin:0 0 10px;">Division</h2>
          <div class="muted-block">
            Vote closes in <b>${escapeHtml(msToHMS(msLeft))}</b>${isSunday() ? " (Sunday freeze)" : ""}.
          </div>

          ${alreadyVoted
            ? `<div class="muted-block" style="margin-top:12px;">You have already voted in this division.</div>`
            : `
              <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;">
                <button class="btn" id="billVoteAye" type="button">Aye</button>
                <button class="btn" id="billVoteNo" type="button">No</button>
                <button class="btn" id="billVoteAbstain" type="button">Abstain</button>
              </div>
            `
          }
        `;

        progressEl.innerHTML = `
          <h2 style="margin:0 0 10px;">Division Progress</h2>
          <div class="muted-block">
            <div class="kv"><span>Aye</span><b>${div.votes?.aye || 0}</b></div>
            <div class="kv"><span>No</span><b>${div.votes?.no || 0}</b></div>
            <div class="kv"><span>Abstain</span><b>${div.votes?.abstain || 0}</b></div>
            <div class="kv"><span>Turnout</span><b>${(div.voters || []).length}</b></div>
          </div>
        `;

        if (!alreadyVoted) {
          const bind = (id, v) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.addEventListener("click", () => {
              rbVoteBillDivision(bill.id, voterName, v);
              location.reload();
            });
          };
          bind("billVoteAye", "aye");
          bind("billVoteNo", "no");
          bind("billVoteAbstain", "abstain");
        }
      } else {
        votingEl.style.display = "none";
        progressEl.style.display = "none";
      }
    }

    // ===== Amendments UI =====
    if (!amendRoot) return;

    const me = data.currentPlayer || {};
    const myName = String(me.name || "Unknown MP");
    const myParty = String(me.party || "Unknown");
    const leader = isLeader(me);

    const amendments = Array.isArray(bill.amendments) ? bill.amendments : [];

    const hasActiveAmendment = amendments.some(a =>
      a.status === "proposed" ||
      (a.status === "division" && a.division && a.division.closed !== true)
    );

    const proposeButtonHtml = hasActiveAmendment
      ? `<div class="muted-block" style="margin-top:12px;">
           An amendment is already live for this bill. Resolve it before proposing another.
         </div>
         <div style="margin-top:12px;">
           <button class="btn" type="button" disabled>Propose Amendment</button>
         </div>`
      : `<div style="margin-top:12px;">
           <button class="btn" type="button" id="rbOpenAmendModalBtn">Propose Amendment</button>
         </div>`;

    amendRoot.innerHTML = `
      <div class="muted-block">
        <b>Amendments:</b> 24 active hours leader support (2 parties). If supported, 24 active hours division. Sundays frozen.
      </div>

      ${proposeButtonHtml}

      <div style="margin-top:18px;">
        <h3 style="margin:0 0 8px;">Current Amendments</h3>
        ${!amendments.length ? `<div class="muted-block">No amendments yet.</div>` : `
          <div class="docket-list">
            ${amendments.map(a => {
              const supportLeft = a.supportDeadlineAt ? Math.max(0, a.supportDeadlineAt - nowTs()) : 0;
              const divisionLeft = a.division?.closesAt ? Math.max(0, a.division.closesAt - nowTs()) : 0;
              const supporters = (a.supporters || []).join(", ") || "None";

              let actions = "";
              if (a.status === "proposed"){
                actions = `
                  <div class="small">Supporters: <b>${escapeHtml(supporters)}</b></div>
                  <div class="small">Support window: <b>${escapeHtml(msToHMS(supportLeft))}</b></div>
                  ${leader && !(a.supporters||[]).includes(myParty)
                    ? `<div style="margin-top:10px;"><button class="btn" data-support="${escapeHtml(a.id)}" type="button">Support as ${escapeHtml(myParty)}</button></div>`
                    : ``}
                `;
              } else if (a.status === "division" && a.division && !a.division.closed){
                const alreadyVoted = (a.division.voters || []).includes(myName);
                actions = `
                  <div class="small">Division closes in: <b>${escapeHtml(msToHMS(divisionLeft))}</b></div>
                  <div class="small">Aye: <b>${a.division.votes?.aye || 0}</b> · No: <b>${a.division.votes?.no || 0}</b> · Abstain: <b>${a.division.votes?.abstain || 0}</b></div>
                  ${alreadyVoted
                    ? `<div class="muted-block" style="margin-top:10px;">You have already voted.</div>`
                    : `
                      <div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap;">
                        <button class="btn" data-vote="aye" data-am="${escapeHtml(a.id)}" type="button">Aye</button>
                        <button class="btn" data-vote="no" data-am="${escapeHtml(a.id)}" type="button">No</button>
                        <button class="btn" data-vote="abstain" data-am="${escapeHtml(a.id)}" type="button">Abstain</button>
                      </div>
                    `}
                `;
              } else {
                actions = `
                  <div class="small"><b>Status:</b> ${escapeHtml(String(a.status || "").toUpperCase())}</div>
                  ${a.failedReason ? `<div class="small"><b>Reason:</b> ${escapeHtml(a.failedReason)}</div>` : ``}
                `;
              }

              return `
                <div class="docket-item ${a.status === "division" ? "high" : ""}">
                  <div class="docket-left">
                    <div class="docket-icon">🧾</div>
                    <div class="docket-text">
                      <div class="docket-title">Article ${escapeHtml(a.articleNumber)} · ${escapeHtml(a.type)}</div>
                      <div class="docket-detail">${escapeHtml(a.text || "")}</div>
                      <div class="small">Proposed by: <b>${escapeHtml(a.proposedBy || "—")}</b></div>
                      ${actions}
                    </div>
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        `}
      </div>
    `;

    const openBtn = document.getElementById("rbOpenAmendModalBtn");
    if (openBtn) {
      openBtn.addEventListener("click", () => {
        openAmendmentModal({ billId: bill.id, proposedBy: myName });
      });
    }

    amendRoot.querySelectorAll("[data-support]").forEach(btn => {
      btn.addEventListener("click", () => {
        const amendId = btn.getAttribute("data-support");
        rbSupportAmendment(bill.id, amendId, myParty);
        location.reload();
      });
    });

    amendRoot.querySelectorAll("[data-vote]").forEach(btn => {
      btn.addEventListener("click", () => {
        const vote = btn.getAttribute("data-vote");
        const amendId = btn.getAttribute("data-am");
        rbVoteAmendment(bill.id, amendId, myName, vote);
        location.reload();
      });
    });
  }

  /* =========================
     Sunday Roll Display (optional)
     ========================= */
  function renderSundayRollDisplay() {
    const el = document.getElementById("sunday-roll-display");
    if (!el) return;

    const now = new Date();
    const lastSunday = new Date(now);
    lastSunday.setDate(now.getDate() - now.getDay());
    lastSunday.setHours(0,0,0,0);

    const formatted = lastSunday.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    });

    el.innerHTML = `<b>Last Sunday Roll:</b> ${formatted}`;
  }

  /* =========================
     Submit Bill Page (structured builder)
     ========================= */
  function initSubmitBillPage(data) {
    const builder = document.getElementById("legislation-builder");
    if (!builder) return;
    renderLegislationBuilder(data);
  }

  function generatePreamble(data) {
    const gender = (data.adminSettings?.monarchGender || "Queen").toLowerCase();
    const majesty = (gender === "queen") ? "the Queen’s" : "the King’s";
    return `Be it enacted by ${majesty} most Excellent Majesty, by and with the advice and consent of the Lords Spiritual and Temporal, and Commons, in this present Parliament assembled, and by the authority of the same, as follows:—`;
  }

  function generateArticles(countId, containerId, headingPrefix, bodyPrefix) {
    const countEl = document.getElementById(countId);
    const container = document.getElementById(containerId);
    if (!countEl || !container) return;

    const count = parseInt(countEl.value, 10);
    container.innerHTML = "";

    for (let i = 1; i <= count; i++) {
      container.innerHTML += `
        <div class="article-block" style="margin-bottom:14px;">
          <label>Article ${i} Heading</label>
          <input id="${headingPrefix}${i}" placeholder="Heading..." />

          <label>Article ${i} Body</label>
          <textarea id="${bodyPrefix}${i}" rows="4" placeholder="Text of Article ${i}..."></textarea>
        </div>
      `;
    }
  }

  function renderLegislationBuilder(data) {
    const container = document.getElementById("legislation-builder");
    if (!container) return;

    const current = data.currentPlayer || {};
    const sim = getCurrentSimDate(data);
    const year = sim.year;

    const isLOTO = current.role === "leader-opposition";
    const usedOpp = Number(data.oppositionTracker[String(year)] || 0);
    const oppAvailable = usedOpp < 3;

    container.innerHTML = `
      <div class="form-grid">

        <label>Title of the Bill</label>
        <input id="billTitleInput" placeholder="e.g. Rail Safety Reform" />

        <label>A Bill to</label>
        <textarea id="billPurpose" rows="2" placeholder="make provision for..."></textarea>

        ${isLOTO ? `
          <div style="margin-top:8px;">
            <label>
              <input type="checkbox" id="oppositionDay" ${oppAvailable ? "" : "disabled"} />
              Opposition Day Bill (used ${usedOpp}/3 this year)
            </label>
            ${oppAvailable ? "" : `<div class="small">Limit reached for this simulation year.</div>`}
          </div>
        ` : ""}

        <label>Number of Articles</label>
        <select id="articleCount">
          ${[1,2,3,4,5,6,7,8,9,10].map(n => `<option value="${n}">${n}</option>`).join("")}
        </select>

        <div id="articlesContainer" style="margin-top:10px;"></div>

        <hr>

        <h3>Final Article — Extent & Commencement</h3>

        <label>Extent</label>
        <select id="extentSelect">
          <option>the United Kingdom</option>
          <option>Great Britain</option>
          <option>England and Wales</option>
          <option>England</option>
          <option>Wales</option>
          <option>Scotland</option>
          <option>Northern Ireland</option>
        </select>

        <label>Commencement</label>
        <select id="commencementSelect">
          <option>upon the day it is passed</option>
          <option>in one month</option>
          <option>in six months</option>
          <option>in one year</option>
          <option>on a date laid out in regulation by the Secretary of State</option>
        </select>

        <button class="btn" id="submitStructuredBillBtn" type="button">Submit Bill</button>
      </div>
    `;

    const articleCountEl = document.getElementById("articleCount");
    const submitBtn = document.getElementById("submitStructuredBillBtn");

    articleCountEl.addEventListener("change", () =>
      generateArticles("articleCount", "articlesContainer", "articleHeading", "articleBody")
    );
    generateArticles("articleCount", "articlesContainer", "articleHeading", "articleBody");

    submitBtn.addEventListener("click", () => submitStructuredBill());
  }

  function submitStructuredBill() {
    let data = getData();
    if (!data) return;

    normaliseData(data);

    const current = data.currentPlayer || {};
    const sim = getCurrentSimDate(data);
    const year = sim.year;

    const titleRaw = (document.getElementById("billTitleInput")?.value || "").trim();
    const purpose = (document.getElementById("billPurpose")?.value || "").trim();

    const articleCount = parseInt(document.getElementById("articleCount")?.value || "0", 10);
    const extent = document.getElementById("extentSelect")?.value || "the United Kingdom";
    const commencement = document.getElementById("commencementSelect")?.value || "upon the day it is passed";

    if (!titleRaw) return alert("Title is required.");
    if (!purpose) return alert("The 'A Bill to' section is required.");
    if (!articleCount || articleCount < 1) return alert("Please choose at least 1 article.");

    let articlesText = "";
    for (let i = 1; i <= articleCount; i++) {
      const heading = (document.getElementById(`articleHeading${i}`)?.value || "").trim();
      const body = (document.getElementById(`articleBody${i}`)?.value || "").trim();
      if (!heading || !body) return alert(`Article ${i} must have both heading and body.`);
      articlesText += `Article ${i} — ${heading}\n${body}\n\n`;
    }

    const isOpp = document.getElementById("oppositionDay")?.checked || false;

    data.oppositionTracker = data.oppositionTracker || {};
    const used = Number(data.oppositionTracker[String(year)] || 0);
    if (isOpp && used >= 3) return alert("Opposition bill limit reached for this simulation year.");

    const fullTitle = `${titleRaw} Bill ${year}`;
    const preamble = generatePreamble(data);

    const finalArticleNumber = articleCount + 1;
    const finalArticle = `Article ${finalArticleNumber} — Extent, Commencement and Short Title
1. This Act extends to ${extent}.
2. This Act comes into force ${commencement}.
3. This Act may be cited as the ${titleRaw} Act ${year}.`;

    const fullBillText = `${fullTitle}

A Bill to ${purpose}.

${preamble}

${articlesText}${finalArticle}
`;

    const submittedOnSunday = isSunday();
    let stageStartedAt = nowTs();
    let deferToMonday = false;

    if (submittedOnSunday) {
      deferToMonday = true;
      const monday = new Date();
      monday.setDate(monday.getDate() + 1);
      monday.setHours(0,0,0,0);
      stageStartedAt = monday.getTime();
    }

    const newBill = {
      id: `bill-${nowTs()}`,
      title: fullTitle,
      author: safe(current.name, "Unknown MP"),
      department: "Commons",
      billType: isOpp ? "opposition" : "pmb",
      stage: isOpp ? "Second Reading" : "First Reading",
      status: "in-progress",
      createdAt: nowTs(),
      stageStartedAt,
      deferToMonday,
      billText: fullBillText,
      amendments: [],
      hansard: {}
    };

    if (isOpp) data.oppositionTracker[String(year)] = used + 1;

    data.orderPaperCommons = Array.isArray(data.orderPaperCommons) ? data.orderPaperCommons : [];
    data.orderPaperCommons.unshift(newBill);

    saveData(data);
    location.href = "dashboard.html";
  }

  /* =========================
     Party Draft Page (kept)
     ========================= */
  function initPartyDraftPage(data) {
    const builder = document.getElementById("party-legislation-builder");
    const controls = document.getElementById("party-draft-controls");
    const listEl = document.getElementById("party-drafts-list");
    if (!builder || !controls || !listEl) return;

    renderPartyDraftBuilder(data);
  }

  function renderPartyDraftBuilder(data) {
    const builder = document.getElementById("party-legislation-builder");
    const controls = document.getElementById("party-draft-controls");
    const listEl = document.getElementById("party-drafts-list");
    const success = document.getElementById("party-draft-success");
    if (!builder || !controls || !listEl) return;

    const player = data.currentPlayer || {};
    const party = player.party || "Unknown Party";
    const sim = getCurrentSimDate(data);
    const year = sim.year;

    controls.innerHTML = `
      <div class="muted-block">
        <b>Party Draft Workspace</b><br>
        Party: <b>${escapeHtml(party)}</b> · Simulation Year: <b>${year}</b><br>
        Drafts saved here do <u>not</u> appear on the Order Paper until someone submits them.
      </div>
    `;

    builder.innerHTML = `
      <div class="form-grid">
        <label>Title of the Bill</label>
        <input id="partyBillTitleInput" placeholder="e.g. Rail Safety Reform" />

        <label>A Bill to</label>
        <textarea id="partyBillPurpose" rows="2" placeholder="make provision for..."></textarea>

        <label>Number of Articles</label>
        <select id="partyArticleCount">
          ${[1,2,3,4,5,6,7,8,9,10].map(n => `<option value="${n}">${n}</option>`).join("")}
        </select>

        <div id="partyArticlesContainer" style="margin-top:10px;"></div>

        <hr>

        <h3>Final Article — Extent & Commencement</h3>

        <label>Extent</label>
        <select id="partyExtentSelect">
          <option>the United Kingdom</option>
          <option>Great Britain</option>
          <option>England and Wales</option>
          <option>England</option>
          <option>Wales</option>
          <option>Scotland</option>
          <option>Northern Ireland</option>
        </select>

        <label>Commencement</label>
        <select id="partyCommencementSelect">
          <option>upon the day it is passed</option>
          <option>in one month</option>
          <option>in six months</option>
          <option>in one year</option>
          <option>on a date laid out in regulation by the Secretary of State</option>
        </select>

        <button class="btn" id="savePartyDraftBtn" type="button">Save Draft</button>
      </div>
    `;

    document.getElementById("partyArticleCount")
      .addEventListener("change", () => generateArticles("partyArticleCount", "partyArticlesContainer", "partyArticleHeading", "partyArticleBody"));

    generateArticles("partyArticleCount", "partyArticlesContainer", "partyArticleHeading", "partyArticleBody");

    function buildDraftText() {
      const titleRaw = (document.getElementById("partyBillTitleInput")?.value || "").trim();
      const purpose = (document.getElementById("partyBillPurpose")?.value || "").trim();
      const articleCount = parseInt(document.getElementById("partyArticleCount")?.value || "0", 10);
      const extent = document.getElementById("partyExtentSelect")?.value || "the United Kingdom";
      const commencement = document.getElementById("partyCommencementSelect")?.value || "upon the day it is passed";

      if (!titleRaw) return { error: "Title is required." };
      if (!purpose) return { error: "The 'A Bill to' section is required." };
      if (!articleCount || articleCount < 1) return { error: "Choose at least 1 article." };

      const fullTitle = `${titleRaw} Bill ${year}`;
      const preamble = generatePreamble(data);

      let articlesText = "";
      for (let i = 1; i <= articleCount; i++) {
        const heading = (document.getElementById(`partyArticleHeading${i}`)?.value || "").trim();
        const body = (document.getElementById(`partyArticleBody${i}`)?.value || "").trim();
        if (!heading || !body) return { error: `Article ${i} must have heading + body.` };
        articlesText += `Article ${i} — ${heading}\n${body}\n\n`;
      }

      const finalArticleNumber = articleCount + 1;
      const finalArticle = `Article ${finalArticleNumber} — Extent, Commencement and Short Title
1. This Act extends to ${extent}.
2. This Act comes into force ${commencement}.
3. This Act may be cited as the ${titleRaw} Act ${year}.`;

      const fullText = `${fullTitle}

A Bill to ${purpose}.

${preamble}

${articlesText}${finalArticle}
`;

      return { title: fullTitle, billText: fullText };
    }

    function renderDraftList() {
      const drafts = getPartyDrafts().filter(d => d.party === party);

      if (!drafts.length) {
        listEl.innerHTML = `<div class="muted-block">No drafts saved for ${escapeHtml(party)} yet.</div>`;
        return;
      }

      listEl.innerHTML = `
        <div class="order-grid">
          ${drafts.map(d => `
            <div class="bill-card">
              <div class="bill-title">${escapeHtml(d.title)}</div>
              <div class="bill-sub">Created by: ${escapeHtml(d.createdBy)} · Updated: ${new Date(d.updatedAt).toLocaleString()}</div>
              <div class="bill-actions spaced">
                <a class="btn" href="#" data-view="${escapeHtml(d.id)}">View</a>
                <a class="btn" href="#" data-delete="${escapeHtml(d.id)}">Delete</a>
              </div>
            </div>
          `).join("")}
        </div>
      `;

      listEl.querySelectorAll("[data-view]").forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          const id = btn.getAttribute("data-view");
          const d = getPartyDrafts().find(x => x.id === id);
          if (!d) return;
          alert(d.billText);
        });
      });

      listEl.querySelectorAll("[data-delete]").forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          const id = btn.getAttribute("data-delete");
          const next = getPartyDrafts().filter(x => x.id !== id);
          savePartyDrafts(next);
          renderDraftList();
        });
      });
    }

    document.getElementById("savePartyDraftBtn").addEventListener("click", () => {
      const built = buildDraftText();
      if (built.error) return alert(built.error);

      const drafts = getPartyDrafts();
      const ts = nowTs();
      drafts.unshift({
        id: `draft-${ts}`,
        party,
        title: built.title,
        billText: built.billText,
        createdBy: safe(player.name, "Unknown"),
        createdAt: ts,
        updatedAt: ts
      });

      savePartyDrafts(drafts);

      if (success) {
        success.style.display = "block";
        setTimeout(() => (success.style.display = "none"), 1500);
      }

      renderDraftList();
    });

    renderDraftList();
  }

  /* =========================
     ABSENCE UI
     ========================= */
  function renderAbsenceUI(dataFromBoot) {
    const container = document.getElementById("absence-ui");
    if (!container) return;

    const data = getData() || dataFromBoot || {};
    normaliseData(data);

    const players = Array.isArray(data.players) ? data.players : [];
    const current = data.currentPlayer || {};

    const me = players.find(p => p.name === current.name);
    if (!me) {
      container.innerHTML = `<div class="muted-block">No player profile loaded.</div>`;
      return;
    }

    const party = me.party || "Unknown";
    const partyLeader = players.find(p => p.party === party && p.partyLeader === true) || null;

    const eligibleDelegates = players.filter(p =>
      p.party === party &&
      p.active !== false &&
      p.name !== me.name
    );

    function saveAndRerender() {
      saveData(data);
      renderAbsenceUI(data);
    }

    function setAbsent(value) {
      me.absent = !!value;

      if (me.absent) {
        if (!me.partyLeader && partyLeader) me.delegatedTo = partyLeader.name;
        if (me.partyLeader) me.delegatedTo = me.delegatedTo || null;
      } else {
        me.delegatedTo = null;
      }

      saveAndRerender();
    }

    function setLeaderDelegation(name) {
      me.delegatedTo = name || null;
      saveAndRerender();
    }

    window.rbSetAbsent = setAbsent;
    window.rbSetLeaderDelegation = setLeaderDelegation;

    const statusLine = me.absent ? "Absent" : "Active";

    let delegationInfo = "";
    if (me.absent) {
      if (me.partyLeader) {
        delegationInfo = `
          <div class="muted-block" style="margin-top:12px;">
            <b>You are the party leader.</b> While absent, you must choose who holds the party vote.
          </div>
        `;
      } else {
        const target = me.delegatedTo || (partyLeader ? partyLeader.name : null);
        delegationInfo = `
          <div class="muted-block" style="margin-top:12px;">
            Your vote is delegated to: <b>${escapeHtml(target ? target : "No party leader set")}</b>
          </div>
        `;
      }
    }

    let leaderControls = "";
    if (me.absent && me.partyLeader) {
      leaderControls = `
        <div style="margin-top:12px;">
          <label><b>Delegate party vote to:</b></label>
          <select id="rbLeaderDelegateSelect">
            <option value="">-- Select member --</option>
            ${eligibleDelegates.map(p => `
              <option value="${escapeHtml(p.name)}" ${me.delegatedTo === p.name ? "selected" : ""}>${escapeHtml(p.name)}</option>
            `).join("")}
          </select>

          <div style="margin-top:10px;">
            <button class="btn" type="button"
              onclick="rbSetLeaderDelegation(document.getElementById('rbLeaderDelegateSelect').value)">
              Save Delegate
            </button>
          </div>

          ${eligibleDelegates.length === 0 ? `
            <div class="small" style="margin-top:8px;">No eligible active members in your party right now.</div>
          ` : ``}
        </div>
      `;
    }

    const leaderWarning =
      (me.absent && me.partyLeader && !me.delegatedTo)
        ? `<div class="bill-result failed" style="margin-top:12px;">
             No delegate selected — your party vote will not be cast until you choose one.
           </div>`
        : "";

    container.innerHTML = `
      <div class="kv"><span>Status:</span><b>${escapeHtml(statusLine)}</b></div>
      <div class="kv"><span>Party:</span><b>${escapeHtml(party)}</b></div>

      <div style="margin-top:12px;">
        ${
          me.absent
            ? `<button class="btn" type="button" onclick="rbSetAbsent(false)">Return to Active</button>`
            : `<button class="btn" type="button" onclick="rbSetAbsent(true)">Mark as Absent</button>`
        }
      </div>

      ${delegationInfo}
      ${leaderControls}
      ${leaderWarning}
    `;
  }

  /* =========================
     Live refresh
     ========================= */
  function startLiveRefresh() {
    const needsRefresh =
      document.getElementById("order-paper") ||
      document.getElementById("live-docket") ||
      document.getElementById("sim-date-display") ||
      document.getElementById("billMeta");

    if (!needsRefresh) return;

    setInterval(() => {
      const latest = getData();
      if (!latest) return;

      normaliseData(latest);

      renderSimDate(latest);
      renderLiveDocket(latest);
      renderOrderPaper(latest);
      initBillPage(latest);
    }, 1000);
  }
/* =========================
   NEWS + PAPERS (Base pages)
   - 14 real-day archive rule
   - simple mod/admin posting via modal
   ========================= */

function isStaff(user) {
  const role = String(user?.role || "").toLowerCase();
  return role === "admin" || role === "mod" || role === "moderator";
}

function simStamp(data) {
  const sim = getCurrentSimDate(data);
  return { simMonth: sim.month, simYear: sim.year };
}

function isArchivedBy14Days(createdAtMs) {
  const ageMs = nowTs() - Number(createdAtMs || 0);
  return ageMs >= (14 * 86400000);
}

/* ---------- NEWS: add story ---------- */
function rbAddNewsStory({ headline, body, category, photoUrl, isBreaking, isFlavour }) {
  const data = getData();
  if (!data) return null;
  normaliseData(data);

  const me = data.currentPlayer || {};
  if (!isStaff(me)) return null;

  const stamp = simStamp(data);

  const story = {
    id: `news-${nowTs()}`,
    headline: String(headline || "").trim(),
    body: String(body || "").trim(),
    category: String(category || "Politics"),
    photoUrl: String(photoUrl || "").trim(),
    isBreaking: !!isBreaking,
    isFlavour: !!isFlavour,
    createdAt: nowTs(),
    postedBy: String(me.name || "Staff"),
    ...stamp
  };

  if (!story.headline || !story.body) return null;

  data.news.stories.unshift(story);
  saveData(data);
  return story;
}

/* ---------- PAPERS: add issue ---------- */
function rbAddPaperIssue(paperKey, { headline, body, byline, photoUrl }) {
  const data = getData();
  if (!data) return null;
  normaliseData(data);

  const me = data.currentPlayer || {};
  if (!isStaff(me)) return null;

  const paper = data.papers?.[paperKey];
  if (!paper) return null;

  const stamp = simStamp(data);

  const issue = {
    id: `issue-${nowTs()}`,
    headline: String(headline || "").trim(),
    body: String(body || "").trim(),
    byline: String(byline || "").trim(),
    photoUrl: String(photoUrl || "").trim(),
    createdAt: nowTs(),
    postedBy: String(me.name || "Staff"),
    ...stamp
  };

  if (!issue.headline || !issue.body) return null;

  paper.issues.unshift(issue);
  saveData(data);
  return issue;
}

/* ---------- News modal ---------- */
function ensureNewsModal() {
  if (document.getElementById("rb-news-modal")) return;

  const wrap = document.createElement("div");
  wrap.id = "rb-news-modal";
  wrap.style.display = "none";
  wrap.innerHTML = `
    <div class="rb-modal-backdrop" style="
      position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:9998;
      display:flex; align-items:center; justify-content:center; padding:18px;
    ">
      <div class="panel rb-modal" style="width:min(760px,100%); max-height:85vh; overflow:auto; z-index:9999;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
          <h2 style="margin:0;">Post News Story</h2>
          <button class="btn" type="button" id="rbNewsCloseBtn">Close</button>
        </div>

        <form id="rbNewsForm" style="margin-top:12px;">
          <div class="form-grid">
            <label>Headline</label>
            <input id="rbNewsHeadline" placeholder="Headline..." />

            <label>Category</label>
            <select id="rbNewsCategory">
              <option>Politics</option>
              <option>Economy</option>
              <option>World</option>
              <option>Security</option>
              <option>Health</option>
              <option>Justice</option>
              <option>Environment</option>
              <option>Culture</option>
              <option>Sport</option>
            </select>

            <label>Photo URL (optional)</label>
            <input id="rbNewsPhoto" placeholder="https://..." />

            <label>Story Text</label>
            <textarea id="rbNewsBody" rows="8" placeholder="Write the article..."></textarea>

            <label>
              <input type="checkbox" id="rbNewsBreaking" />
              Flag as BREAKING NEWS
            </label>

            <label>
              <input type="checkbox" id="rbNewsFlavour" />
              This is “flavour news” (smaller item)
            </label>

            <div style="display:flex; justify-content:flex-end; gap:10px; flex-wrap:wrap;">
              <button class="btn" type="button" id="rbNewsCancelBtn">Cancel</button>
              <button class="btn" type="submit">Post</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  `;

  document.body.appendChild(wrap);

  const close = () => (wrap.style.display = "none");
  wrap.querySelector(".rb-modal-backdrop").addEventListener("click", (e) => {
    if (e.target === wrap.querySelector(".rb-modal-backdrop")) close();
  });

  document.getElementById("rbNewsCloseBtn").addEventListener("click", close);
  document.getElementById("rbNewsCancelBtn").addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && wrap.style.display !== "none") close();
  });
}

function openNewsModal() {
  ensureNewsModal();
  const modal = document.getElementById("rb-news-modal");
  modal.style.display = "block";

  // reset
  document.getElementById("rbNewsHeadline").value = "";
  document.getElementById("rbNewsCategory").value = "Politics";
  document.getElementById("rbNewsPhoto").value = "";
  document.getElementById("rbNewsBody").value = "";
  document.getElementById("rbNewsBreaking").checked = false;
  document.getElementById("rbNewsFlavour").checked = false;

  const form = document.getElementById("rbNewsForm");
  form.onsubmit = (e) => {
    e.preventDefault();
    const headline = document.getElementById("rbNewsHeadline").value;
    const category = document.getElementById("rbNewsCategory").value;
    const photoUrl = document.getElementById("rbNewsPhoto").value;
    const body = document.getElementById("rbNewsBody").value;
    const isBreaking = document.getElementById("rbNewsBreaking").checked;
    const isFlavour = document.getElementById("rbNewsFlavour").checked;

    const res = rbAddNewsStory({ headline, body, category, photoUrl, isBreaking, isFlavour });
    if (!res) return alert("Could not post. (Are you logged in as an admin/mod?)");

    modal.style.display = "none";
    location.reload();
  };
}

/* ---------- Papers modal ---------- */
function ensurePaperModal() {
  if (document.getElementById("rb-paper-modal")) return;

  const wrap = document.createElement("div");
  wrap.id = "rb-paper-modal";
  wrap.style.display = "none";
  wrap.innerHTML = `
    <div class="rb-modal-backdrop" style="
      position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:9998;
      display:flex; align-items:center; justify-content:center; padding:18px;
    ">
      <div class="panel rb-modal" style="width:min(760px,100%); max-height:85vh; overflow:auto; z-index:9999;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
          <h2 style="margin:0;">Post Paper Front Page</h2>
          <button class="btn" type="button" id="rbPaperCloseBtn">Close</button>
        </div>

        <form id="rbPaperForm" style="margin-top:12px;">
          <div class="form-grid">
            <label>Paper</label>
            <select id="rbPaperKey">
              <option value="sun">The Sun</option>
              <option value="telegraph">The Daily Telegraph</option>
              <option value="mail">The Daily Mail</option>
              <option value="mirror">The Daily Mirror</option>
              <option value="times">The Times</option>
              <option value="ft">Financial Times</option>
              <option value="guardian">The Guardian</option>
              <option value="independent">The Independent</option>
            </select>

            <label>Headline</label>
            <input id="rbPaperHeadline" placeholder="Headline..." />

            <label>Byline (optional)</label>
            <input id="rbPaperByline" placeholder="e.g. James Smith, Political Correspondent" />

            <label>Photo URL (optional)</label>
            <input id="rbPaperPhoto" placeholder="https://..." />

            <label>Front Page Text</label>
            <textarea id="rbPaperBody" rows="8" placeholder="Write the front page article..."></textarea>

            <div style="display:flex; justify-content:flex-end; gap:10px; flex-wrap:wrap;">
              <button class="btn" type="button" id="rbPaperCancelBtn">Cancel</button>
              <button class="btn" type="submit">Post</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  `;

  document.body.appendChild(wrap);

  const close = () => (wrap.style.display = "none");
  wrap.querySelector(".rb-modal-backdrop").addEventListener("click", (e) => {
    if (e.target === wrap.querySelector(".rb-modal-backdrop")) close();
  });

  document.getElementById("rbPaperCloseBtn").addEventListener("click", close);
  document.getElementById("rbPaperCancelBtn").addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && wrap.style.display !== "none") close();
  });
}

function openPaperModal() {
  ensurePaperModal();
  const modal = document.getElementById("rb-paper-modal");
  modal.style.display = "block";

  document.getElementById("rbPaperKey").value = "sun";
  document.getElementById("rbPaperHeadline").value = "";
  document.getElementById("rbPaperByline").value = "";
  document.getElementById("rbPaperPhoto").value = "";
  document.getElementById("rbPaperBody").value = "";

  const form = document.getElementById("rbPaperForm");
  form.onsubmit = (e) => {
    e.preventDefault();
    const key = document.getElementById("rbPaperKey").value;
    const headline = document.getElementById("rbPaperHeadline").value;
    const byline = document.getElementById("rbPaperByline").value;
    const photoUrl = document.getElementById("rbPaperPhoto").value;
    const body = document.getElementById("rbPaperBody").value;

    const res = rbAddPaperIssue(key, { headline, body, byline, photoUrl });
    if (!res) return alert("Could not post. (Are you logged in as an admin/mod?)");

    modal.style.display = "none";
    location.reload();
  };
}

/* ---------- Render News page ---------- */
function initNewsPage(data) {
  const breakingEl = document.getElementById("news-breaking");
  const controlsEl = document.getElementById("news-controls");
  const mainEl = document.getElementById("news-main");
  const flavourEl = document.getElementById("news-flavour");
  const archiveEl = document.getElementById("news-archive");
  if (!breakingEl || !controlsEl || !mainEl || !flavourEl || !archiveEl) return;

  const me = data.currentPlayer || {};
  const staff = isStaff(me);

  const stories = Array.isArray(data.news?.stories) ? data.news.stories : [];

  const live = stories.filter(s => !isArchivedBy14Days(s.createdAt));
  const archived = stories.filter(s => isArchivedBy14Days(s.createdAt));

  const breaking = live.filter(s => s.isBreaking === true).slice(0, 10);

  breakingEl.innerHTML = `
    <div class="breaking-bar">
      <div class="breaking-pill">Breaking</div>
      <div class="breaking-items">
        ${breaking.length ? breaking.map(s => escapeHtml(s.headline)).join(" · ") : "No breaking headlines right now."}
      </div>
    </div>
  `;

  controlsEl.innerHTML = staff
    ? `
      <div class="muted-block">
        You are logged in as <b>${escapeHtml(me.name || "Staff")}</b> (${escapeHtml(me.role || "staff")}).
        You can post stories to RB News.
      </div>
      <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;">
        <button class="btn" type="button" id="rbPostNewsBtn">Post News Story</button>
      </div>
    `
    : `
      <div class="muted-block">
        You are logged in as <b>${escapeHtml(me.name || "Player")}</b>.
        News is posted by the simulation staff.
      </div>
    `;

  if (staff) {
    const btn = document.getElementById("rbPostNewsBtn");
    if (btn) btn.addEventListener("click", openNewsModal);
  }

  const mainStories = live.filter(s => !s.isFlavour).slice(0, 12);
  const flavourStories = live.filter(s => s.isFlavour).slice(0, 20);

  mainEl.innerHTML = mainStories.length
    ? mainStories.map(s => `
      <div class="news-card">
        <h3>
          ${escapeHtml(s.headline)}
          ${s.isBreaking ? `<span class="tag">BREAKING</span>` : ``}
        </h3>
        <div class="news-meta">
          ${escapeHtml(s.category || "News")} ·
          ${escapeHtml(getMonthName(Number(s.simMonth || 1)))} ${escapeHtml(String(s.simYear || ""))} ·
          Posted by ${escapeHtml(s.postedBy || "Staff")}
        </div>
        ${s.photoUrl ? `<img class="news-photo" src="${escapeHtml(s.photoUrl)}" alt="">` : ``}
        <div class="news-body">${escapeHtml(s.body)}</div>
      </div>
    `).join("")
    : `<div class="muted-block">No main stories posted yet.</div>`;

  flavourEl.innerHTML = `
    <div class="flavour-list">
      ${flavourStories.length ? flavourStories.map(s => `
        <div class="flavour-item">
          <div style="font-weight:800;">${escapeHtml(s.headline)}</div>
          <div class="news-meta">
            ${escapeHtml(s.category || "News")} ·
            ${escapeHtml(getMonthName(Number(s.simMonth || 1)))} ${escapeHtml(String(s.simYear || ""))}
          </div>
          ${s.photoUrl ? `<img class="news-photo" src="${escapeHtml(s.photoUrl)}" alt="">` : ``}
          <div class="news-body">${escapeHtml(s.body)}</div>
        </div>
      `).join("") : `<div class="muted-block">No flavour items yet.</div>`}
    </div>
  `;

  archiveEl.innerHTML = archived.length
    ? archived.map(s => `
      <div class="news-card" style="opacity:.85;">
        <h3>${escapeHtml(s.headline)} <span class="tag">ARCHIVED</span></h3>
        <div class="news-meta">
          ${escapeHtml(s.category || "News")} ·
          ${escapeHtml(getMonthName(Number(s.simMonth || 1)))} ${escapeHtml(String(s.simYear || ""))}
        </div>
        ${s.photoUrl ? `<img class="news-photo" src="${escapeHtml(s.photoUrl)}" alt="">` : ``}
        <div class="news-body">${escapeHtml(s.body)}</div>
      </div>
    `).join("")
    : `<div class="muted-block">Archive is empty.</div>`;
}

/* ---------- Render Papers page ---------- */
function initPapersPage(data) {
  const controlsEl = document.getElementById("papers-controls");
  const tilesEl = document.getElementById("papers-tiles");
  const readerEl = document.getElementById("paper-reader");
  if (!controlsEl || !tilesEl || !readerEl) return;

  const me = data.currentPlayer || {};
  const staff = isStaff(me);

  controlsEl.innerHTML = staff
    ? `
      <div class="muted-block">
        You are logged in as <b>${escapeHtml(me.name || "Staff")}</b> (${escapeHtml(me.role || "staff")}).
        You can post new front pages.
      </div>
      <div style="margin-top:12px;">
        <button class="btn" type="button" id="rbPostPaperBtn">Post Front Page</button>
      </div>
    `
    : `
      <div class="muted-block">
        Papers are posted by the simulation staff.
      </div>
    `;

  if (staff) {
    const btn = document.getElementById("rbPostPaperBtn");
    if (btn) btn.addEventListener("click", openPaperModal);
  }

  const papers = data.papers || {};
  const keys = Object.keys(papers);

  tilesEl.innerHTML = keys.map(key => {
    const p = papers[key];
    const latest = (p.issues || [])[0];
    const headline = latest ? latest.headline : "No issue posted yet.";
    return `
      <div class="paper-tile">
        <div class="masthead small ${escapeHtml(p.mastheadClass || "")}">${escapeHtml(p.name || key)}</div>
        <div class="paper-headline">${escapeHtml(headline)}</div>
        <div style="margin-top:12px;">
          <a class="btn" href="papers.html?paper=${encodeURIComponent(key)}">Read this paper</a>
        </div>
      </div>
    `;
  }).join("");

  const params = new URLSearchParams(location.search);
  const selectedKey = params.get("paper");

  if (!selectedKey || !papers[selectedKey]) {
    readerEl.innerHTML = `<div class="muted-block">Select a paper above to read it.</div>`;
    return;
  }

  const paper = papers[selectedKey];
  const issues = Array.isArray(paper.issues) ? paper.issues : [];

  readerEl.innerHTML = `
    <div class="masthead ${escapeHtml(paper.mastheadClass || "")}">${escapeHtml(paper.name || selectedKey)}</div>

    ${!issues.length ? `<div class="muted-block">No issues posted yet.</div>` : `
      ${issues.map((iss, idx) => `
        <div class="paper-reader-issue">
          <h3>${escapeHtml(iss.headline)} ${idx === 0 ? `<span class="tag">FRONT PAGE</span>` : ``}</h3>
          <div class="news-meta">
            ${escapeHtml(getMonthName(Number(iss.simMonth || 1)))} ${escapeHtml(String(iss.simYear || ""))}
            ${iss.byline ? ` · ${escapeHtml(iss.byline)}` : ``}
          </div>
          ${iss.photoUrl ? `<img class="news-photo" src="${escapeHtml(iss.photoUrl)}" alt="">` : ``}
          <div class="news-body">${escapeHtml(iss.body)}</div>
        </div>
      `).join("")}
    `}
  `;
}

  /* =========================
     BOOT
     ========================= */
  fetch(DATA_URL)
    .then(r => r.json())
    .then((demo) => {
      let data = getData();
      if (!data) data = demo;

      normaliseData(data);
      saveData(data);

      initNavUI();
      renderSimDate(data);
      renderWhatsGoingOn(data);
      renderLiveDocket(data);
      renderOrderPaper(data);
      renderHansard(data);
      renderSundayRollDisplay();
      renderAbsenceUI(data);
      renderNewsPage(data);
      renderUserPage(data);
      renderPapersPage(data);
      initSubmitBillPage(data);
      initPartyDraftPage(data);
      initBillPage(data);
      initNewsPage(data);
      initPapersPage(data);


      startLiveRefresh();
      renderNewsPage(latest);
      renderUserPage(latest);
      renderPapersPage(latest);
      initNewsPage(latest);
      initPapersPage(latest);



    })
    .catch(err => console.error("Error loading demo.json:", err));
})();
