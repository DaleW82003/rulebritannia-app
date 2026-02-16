/* =========================================================
   Rule Britannia — app.js (CLEAN BASELINE + BILL DIVISIONS)
   - Loads demo.json once
   - Uses localStorage rb_full_data as the live state
   - Dashboard: Sim Date + What's Going On + Live Docket + Order Paper
   - Hansard: passed/failed archive
   - Game Clock: 3 real days = 1 sim month; Sundays frozen
   - Bill lifecycle + countdown timers
   - Amendment engine (support window + division)
   - Main bill division engine (24 active hours, Sunday freeze, auto-close)
   - Submit Bill builder (structured template)
   - Party Draft builder (saved to localStorage)
   - Question Time (tiles + office view)
   - Absence system (delegation)
   - Nav highlighting + dropdown support
   ========================================================= */

(() => {
  "use strict";

  /* =========================
     Config
     ========================= */
  const DATA_URL = "data/demo.json";
  const LS_KEY = "rb_full_data";
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
    data.oppositionTracker = data.oppositionTracker || {}; // simYear -> count

    data.currentPlayer = data.currentPlayer || {
      name: "Unknown MP",
      party: "Unknown",
      role: "backbencher",
      office: null,
      isSpeaker: false
    };

    data.questionTime = data.questionTime || {};
    data.questionTime.offices = Array.isArray(data.questionTime.offices) ? data.questionTime.offices : [];
    data.questionTime.questions = Array.isArray(data.questionTime.questions) ? data.questionTime.questions : [];

    return data;
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
     - Division open for 24 active hours (skip Sundays)
     - Auto-close on deadline
     - Sunday freeze (no closing on Sundays)
     - Tie fails (status quo)
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
    bill.hansard.division = bill.hansard.division || [];

    const entry = {
      outcome, // "passed" | "failed"
      timestamp: new Date().toISOString(),
      votes: bill.division?.votes || { aye:0, no:0, abstain:0 }
    };

    // prevent duplicates (same outcome when already final)
    const last = bill.hansard.division[bill.hansard.division.length - 1];
    if (last && last.outcome === entry.outcome && last.votes?.aye === entry.votes.aye && last.votes?.no === entry.votes.no) return;

    bill.hansard.division.push(entry);
  }

  function processBillDivision(bill){
    if (!bill || bill.stage !== "Division") return;
    ensureBillDefaults(bill);
    const div = ensureBillDivisionDefaults(bill);

    if (isCompleted(bill)) return;
    if (div.closed) return;

    // Sunday freeze: do not auto-close
    if (isSunday()) return;

    const now = Date.now();
    if (now >= div.closesAt) {
      div.closed = true;

      const aye = div.votes?.aye || 0;
      const no = div.votes?.no || 0;

      if (aye > no) {
        div.result = "passed";
        bill.status = "passed";
      } else {
        div.result = "failed";
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

    // only when in Division stage and not completed
    if (bill.stage !== "Division" || isCompleted(bill)) return null;

    const div = ensureBillDivisionDefaults(bill);
    if (div.closed) return null;

    // one vote per voterName
    if (div.voters.includes(voterName)) return null;

    if (vote === "aye") div.votes.aye++;
    else if (vote === "no") div.votes.no++;
    else div.votes.abstain++;

    div.voters.push(voterName);

    // allow immediate processing if deadline has passed (not Sunday)
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

    // Defer-to-Monday rule (if a bill was submitted on Sunday)
    if (bill.deferToMonday === true) {
      const today = new Date();
      if (today.getDay() === 0) return bill; // still Sunday
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
      // Division closes automatically based on real time
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
      const end = addValidDaysSkippingSundays(new Date(bill.stageStartedAt).getTime(), 6); // 2 sim months
      return { label: isSunday() ? "Polling Day — clock frozen" : "Second Reading ends in", msRemaining: end - now };
    }
    if (bill.stage === "Report Stage") {
      const end = addValidDaysSkippingSundays(new Date(bill.stageStartedAt).getTime(), 3); // 1 sim month
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
    bill.hansard.amendments = bill.hansard.amendments || [];

    const exists = bill.hansard.amendments.some(x => x.id === amend.id && x.outcome === outcome);
    if (exists) return;

    bill.hansard.amendments.push({
      id: amend.id,
      articleNumber: amend.articleNumber,
      type: amend.type,
      proposedBy: amend.proposedBy,
      supporters: amend.supporters || [],
      outcome, // "passed" | "failed"
      timestamp: new Date().toISOString(),
      failedReason: amend.failedReason || null
    });
  }

  function processAmendments(bill) {
    if (!Array.isArray(bill.amendments)) bill.amendments = [];

    // Sunday freeze
    if (isSunday()) return bill;

    const now = Date.now();

    bill.amendments.forEach(amend => {
      ensureAmendmentDefaults(amend);

      if (!amend.supportDeadlineAt) {
        const submitted = amend.submittedAt ? new Date(amend.submittedAt).getTime() : now;
        amend.supportDeadlineAt = addActiveHoursSkippingSundays(submitted, 24);
      }

      if (amend.status === "proposed") {
        const supporters = amend.supporters || [];
        if (now > amend.supportDeadlineAt && supporters.length < 2) {
          amend.status = "failed";
          amend.failedReason = "Insufficient leader support within 24 active hours.";
          logHansardAmendment(bill, amend, "failed");
        }
      }

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
    // Enforce: ONLY ONE active amendment at a time (support window OR division)
    const active = (bill.amendments || []).some(a =>
      a.status === "proposed" ||
      (a.status === "division" && a.division && a.division.closed !== true)
    );

    if (active) {
      // hard refuse — UI will show alert based on null return
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

    // set deadline immediately
    amend.supportDeadlineAt = addActiveHoursSkippingSundays(Date.now(), 24);

    bill.amendments.unshift(amend);

    // clear any previous error
    delete bill._lastAmendmentError;
  });
}


  function rbSupportAmendment(billId, amendId, party){
    return rbUpdateBill(billId, (bill) => {
      const amend = bill.amendments.find(a => a.id === amendId);
      if (!amend) return;
      if (amend.status !== "proposed") return;

      if (!Array.isArray(amend.supporters)) amend.supporters = [];
      if (!amend.supporters.includes(party)) amend.supporters.push(party);
    });
  }

  function rbVoteAmendment(billId, amendId, voterName, vote){
    return rbUpdateBill(billId, (bill) => {
      const amend = bill.amendments.find(a => a.id === amendId);
      if (!amend || amend.status !== "division" || !amend.division || amend.division.closed) return;

      amend.division.voters = Array.isArray(amend.division.voters) ? amend.division.voters : [];
      if (amend.division.voters.includes(voterName)) return;

      if (!amend.division.votes) amend.division.votes = { aye:0, no:0, abstain:0 };
      if (vote === "aye") amend.division.votes.aye++;
      else if (vote === "no") amend.division.votes.no++;
      else amend.division.votes.abstain++;

      amend.division.voters.push(voterName);
    });
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
    return playerObj?.partyLeader === true || playerObj?.role === "leader-opposition" || playerObj?.role === "prime-minister";
  }

  function generateBillDivisionDocketItems(data){
    const items = [];
    const current = data.currentPlayer || {};
    const me = (data.players || []).find(p => p.name === current.name) || current;

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
    const me = (data.players || []).find(p => p.name === current.name);
    if (!me) return items;

    (data.orderPaperCommons || []).forEach(bill => {
      ensureBillDefaults(bill);
      processAmendments(bill);

      (bill.amendments || []).forEach(amend => {
        // Leader support window
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

        // Amendment division open
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

  // close handlers
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

  // reset fields each time
  document.getElementById("rbAmArticle").value = "1";
  document.getElementById("rbAmType").value = "replace";
  document.getElementById("rbAmText").value = "";

  const form = document.getElementById("rbAmendForm");

  // Replace any prior handler cleanly
  form.onsubmit = (e) => {
    e.preventDefault();

    const articleNumber = Number(document.getElementById("rbAmArticle").value || 1);
    const type = document.getElementById("rbAmType").value;
    const text = (document.getElementById("rbAmText").value || "").trim();

    if (!text) return alert("Amendment text is required.");

    const res = rbProposeAmendment(billId, { articleNumber, type, text, proposedBy });

    // If engine refused, try to read a friendly error from the bill state
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
     Bill Page (Main division + Amendments)
     Expects bill.html IDs:
       - #billTitle, #billMeta, #billText
       - #division-voting, #division-progress
       - #bill-amendments (preferred)
     ========================= */
  function initBillPage(data){
    const titleEl = document.getElementById("billTitle");
    const metaEl = document.getElementById("billMeta");
    const textEl = document.getElementById("billText");
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
      return;
    }

    ensureBillDefaults(bill);
    processAmendments(bill);
    processBillLifecycle(data, bill); // will also process division if stage is Division

    // persist any auto-changes
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

    // ========== Main Division UI ==========
    const votingEl = document.getElementById("division-voting");
    const progressEl = document.getElementById("division-progress");

    if (votingEl && progressEl) {
      if (bill.stage === "Division" && !isCompleted(bill)) {
        votingEl.style.display = "block";
        progressEl.style.display = "block";

        const me = data.currentPlayer || {};
        const voterName = me.name || "Unknown MP";

        ensureBillDivisionDefaults(bill);

        const div = bill.division;
        const msLeft = Math.max(0, (div.closesAt || 0) - Date.now());
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

    // ========== Amendments UI ==========
const hasActiveAmendment = (amendments || []).some(a =>
  a.status === "proposed" ||
  (a.status === "division" && a.division && a.division.closed !== true)
);

const proposeButton = hasActiveAmendment
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

  const openBtn = document.getElementById("rbOpenAmendModalBtn");
if (openBtn) {
  openBtn.addEventListener("click", () => {
    openAmendmentModal({ billId: bill.id, proposedBy: myName });
  });
}


  ${proposeButton}

  <div style="margin-top:18px;">
    <h3 style="margin:0 0 8px;">Current Amendments</h3>
    ${!amendments.length ? `<div class="muted-block">No amendments yet.</div>` : `
      <div class="docket-list">
        ${amendments.map(a => {
          // ... keep your existing amendment cards exactly as they were ...
          // (support button + vote buttons)
          const supportLeft = a.supportDeadlineAt ? Math.max(0, a.supportDeadlineAt - Date.now()) : 0;
          const divisionLeft = a.division?.closesAt ? Math.max(0, a.division.closesAt - Date.now()) : 0;
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


    const form = document.getElementById("amendForm");
    if (form){
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const articleNumber = document.getElementById("amArticle").value;
        const type = document.getElementById("amType").value;
        const text = (document.getElementById("amText").value || "").trim();
        if (!text) return alert("Amendment text required.");

        rbProposeAmendment(bill.id, { articleNumber, type, text, proposedBy: myName });
        location.reload();
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
     Submit Bill Page + Party Draft
     (unchanged from your baseline)
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

    articleCountEl.addEventListener("change", () => generateArticles("articleCount", "articlesContainer", "articleHeading", "articleBody"));
    generateArticles("articleCount", "articlesContainer", "articleHeading", "articleBody");

    submitBtn.addEventListener("click", () => submitStructuredBill());
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

    data.orderPaperCommons.unshift(newBill);

    saveData(data);
    location.href = "dashboard.html";
  }

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
     ABSENCE UI (as in your working version)
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
        if (!me.partyLeader && partyLeader) {
          me.delegatedTo = partyLeader.name;
        }
        if (me.partyLeader) {
          me.delegatedTo = me.delegatedTo || null;
        }
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
      document.getElementById("billMeta"); // bill page

    if (!needsRefresh) return;

    setInterval(() => {
      const latest = getData();
      if (!latest) return;

      normaliseData(latest);

      renderSimDate(latest);
      renderLiveDocket(latest);
      renderOrderPaper(latest);
      initBillPage(latest); // keeps bill division/amendments fresh
    }, 1000);
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
      initSubmitBillPage(data);
      initPartyDraftPage(data);
      initBillPage(data);

      startLiveRefresh();
    })
    .catch(err => console.error("Error loading demo.json:", err));
})();
