/* =========================================================
   Rule Britannia — app.js (STABLE CONSOLIDATED BUILD)
   - Keeps ALL prior bill/amendment/division logic
   - Restores light UI expectation (CSS handles visuals)
   - FIXES: News / Papers / Question Time / User / Bodies / Constituencies
   - Supports multiple HTML IDs (qt-root OR question-time-root, etc.)
   - Adds safe defaults so pages never sit on "Loading…" if data missing
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

    // CurrentUser + Character model (back-compat with currentPlayer)
    data.currentUser = data.currentUser || {
      username: (data.currentPlayer?.name ? String(data.currentPlayer.name).replaceAll(" ", "") : "User"),
      roles: data.currentPlayer?.isSpeaker ? ["speaker"] : [],
      isAdmin: false,
      isMod: false
    };

    data.currentCharacter = data.currentCharacter || data.currentPlayer || {
      name: "Unknown MP",
      party: "Unknown",
      role: "backbencher",
      office: null,
      isSpeaker: false
    };

    // Keep old field updated for older code paths
    data.currentPlayer = data.currentCharacter;

    data.gameState = data.gameState || {
      started: true,
      isPaused: false,
      startRealDate: new Date().toISOString(),
      startSimMonth: 8,
      startSimYear: 1997
    };

    data.parliament = data.parliament || {
      totalSeats: 650,
      parties: [
        { name:"Labour", seats:418 },
        { name:"Conservative", seats:165 },
        { name:"Liberal Democrat", seats:46 },
        { name:"SNP", seats:6 },
        { name:"Plaid Cymru", seats:4 },
        { name:"DUP", seats:2 },
        { name:"SDLP", seats:3 },
        { name:"UUP", seats:10 },
        { name:"Sinn Féin", seats:2 },
        { name:"Others", seats: -1 } // will be recomputed
      ]
    };

    // Constituencies dataset (mods can replace later)
    data.constituencies = Array.isArray(data.constituencies) ? data.constituencies : [];

    // BBC News dataset
    data.news = data.news || { stories: [] };

    // Papers dataset
    data.papers = data.papers || { papers: [] };

    // Question Time offices dataset
    data.questionTime = data.questionTime || { offices: [] };

    // Bodies dataset
    data.bodies = data.bodies || { list: [] };

    // Admin settings
    data.adminSettings = data.adminSettings || { monarchGender: "Queen" };
    data.oppositionTracker = data.oppositionTracker || {};

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
  function getGameState(data) { return data.gameState || { started: false }; }
  function isClockPaused(data) { return getGameState(data).isPaused === true; }

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

    const startMonthIndex = (gs.startSimMonth || 1) - 1;
    const startYear = gs.startSimYear || 1997;

    const totalMonths = startMonthIndex + monthsPassed;
    const year = startYear + Math.floor(totalMonths / 12);
    const month = (totalMonths % 12) + 1;

    return { month, year };
  }

  function simMonthYearLabel(data) {
    const sim = getCurrentSimDate(data);
    return `${getMonthName(sim.month)} ${sim.year}`;
  }

  function renderSimDate(data) {
    const el = document.getElementById("sim-date-display");
    const gs = getGameState(data);
    if (!el || !gs.started) return;
    el.textContent = simMonthYearLabel(data);
  }

   function fmtNumber(n){
  if (n === null || n === undefined || n === "") return "—";
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  return num.toLocaleString("en-GB");
}
function fmtPct(n){
  if (n === null || n === undefined || n === "") return "—";
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  return `${num.toFixed(1)}%`;
}
function fmtPctSigned(n){
  if (n === null || n === undefined || n === "") return "—";
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  const sign = num > 0 ? "+" : "";
  return `${sign}${num.toFixed(2)}%`;
}

  /* =========================================================
     BILL ENGINE (your existing working logic kept)
     ========================================================= */
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
        div.result = "failed";
        bill.status = "failed";
      }

      bill.completedAt = nowTs();
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

  function processBillLifecycle(data, bill) {
    ensureBillDefaults(bill);

    // Sundays freeze auto progression
    if (isSunday()) return bill;
    if (isCompleted(bill)) return bill;

    // Pause while amendment division open
    if (billHasOpenAmendmentDivision(bill)) return bill;

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
     AMENDMENT ENGINE (kept)
     ========================= */
  function ensureAmendmentDefaults(amend) {
    if (!amend.id) amend.id = `amend-${Date.now()}`;
    if (!amend.status) amend.status = "proposed";
    if (!Array.isArray(amend.supporters)) amend.supporters = [];
    if (!amend.submittedAt) amend.submittedAt = new Date().toISOString();
    return amend;
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
          } else {
            amend.division.result = "failed";
            amend.status = "failed";
            amend.failedReason = (aye === no)
              ? "Tie (Speaker maintains status quo)."
              : "Majority against.";
          }
        }
      }
    });

    return bill;
  }

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

  /* =========================================================
     DASHBOARD RENDERS (kept)
     ========================================================= */
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
      : `<div class="muted">No polling yet.</div>`;

    el.innerHTML = `
      <div class="wgo-grid">
        <div class="wgo-tile card-flex">
          <div class="wgo-kicker">BBC NEWS</div>
          <div class="wgo-title">BBC: ${escapeHtml(safe(bbc.headline, "Top political story headline goes here"))}</div>
          <div class="wgo-strap">${escapeHtml(safe(bbc.strap, "One-sentence summary of the lead story."))}</div>
          <div class="tile-bottom"><a class="btn" href="news.html">Open</a></div>
        </div>

        <div class="wgo-tile card-flex">
          <div class="wgo-kicker">PAPERS</div>
          <div class="wgo-title">${escapeHtml(safe(papers.paper, "The Times"))}: ${escapeHtml(safe(papers.headline, "Front page headline goes here"))}</div>
          <div class="wgo-strap">${escapeHtml(safe(papers.strap, "One-sentence front page standfirst."))}</div>
          <div class="tile-bottom"><a class="btn" href="papers.html">View</a></div>
        </div>

        <div class="wgo-tile card-flex">
          <div class="wgo-kicker">ECONOMY</div>
          <div class="wgo-strap" style="margin-top:10px;">
            <div class="row"><span>Growth</span><b>${Number(safe(economy.growth, 1.8)).toFixed(1)}%</b></div>
            <div class="row"><span>Inflation</span><b>${Number(safe(economy.inflation, 2.6)).toFixed(1)}%</b></div>
            <div class="row"><span>Unemployment</span><b>${Number(safe(economy.unemployment, 4.3)).toFixed(1)}%</b></div>
          </div>
          <div class="tile-bottom"><a class="btn" href="economy.html">Economy</a></div>
        </div>

        <div class="wgo-tile card-flex">
          <div class="wgo-kicker">POLLING</div>
          <div class="wgo-strap" style="margin-top:10px;">${pollingLines}</div>
          <div class="tile-bottom"><a class="btn" href="polling.html">Polling</a></div>
        </div>
      </div>
    `;
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
    const staticItems = Array.isArray(data.liveDocket?.items) ? data.liveDocket.items : [];

    let items = staticItems.slice();
    items = items.concat(generateBillDivisionDocketItems(data));
    items = items.concat(generateAmendmentDocketItems(data));

    if (!items.length) {
      el.innerHTML = `<div class="muted-block">No live items right now.</div>`;
      return;
    }

    const icon = (type) => {
      switch (type) {
        case "division": return "🗳️";
        case "amendment": return "🧾";
        case "amendment-division": return "🗳️";
        default: return "•";
      }
    };

    el.innerHTML = `
      <div class="small" style="margin-bottom:10px;">
        As of: <b>Today</b> · Logged in as: <b>${escapeHtml(safe(player.name,"Unknown"))}</b> (${escapeHtml(safe(player.role,"—"))})
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

    if (!bills.length) {
      el.innerHTML = `<div class="muted-block">No bills on the Order Paper.</div>`;
      return;
    }

    el.innerHTML = `
      <div class="order-grid">
        ${bills.map(b => {
          const badge = getBillBadge(b);
          const t = billStageCountdown(data, b);

          const resultBlock = isCompleted(b)
            ? `<div class="bill-result ${b.status === "passed" ? "passed" : "failed"}">
                 ${b.status === "passed" ? "Royal Assent Granted" : "Bill Defeated"}
               </div>`
            : `<div class="bill-current">Current Stage: <b>${escapeHtml(b.stage)}</b></div>`;

          const timerLine = (!isCompleted(b) && t.label)
            ? `<div class="timer"><div class="kv"><span>${escapeHtml(t.label)}</span><b>${escapeHtml(msToDHM(t.msRemaining))}</b></div></div>`
            : ``;

          return `
            <div class="bill-card">
              <div class="bill-title">${escapeHtml(safe(b.title, "Untitled Bill"))}</div>
              <div class="bill-sub">Author: ${escapeHtml(safe(b.author, "—"))} · ${escapeHtml(safe(b.department, "—"))}</div>

              <div class="badges">
                <span class="bill-badge ${badge.cls}">${escapeHtml(badge.text)}</span>
              </div>

              <div class="stage-track">
                ${STAGE_ORDER.map(s => `<div class="stage ${b.stage === s ? "on" : ""}">${escapeHtml(s)}</div>`).join("")}
              </div>

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

  /* =========================================================
     BILL PAGE (kept — minimal, your bill.html uses it)
     ========================================================= */
  function initBillPage(data){
    const titleEl = document.getElementById("billTitle");
    const metaEl = document.getElementById("billMeta");
    const textEl = document.getElementById("billText");
    const amendRoot = document.getElementById("amendmentsList") || document.getElementById("bill-amendments");
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

    // Main Division voting blocks (only if elements exist)
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

    // Amendments UI (only if root exists; keep minimal stable)
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
           <button class="btn" type="button" id="rbQuickProposeBtn">Propose Amendment</button>
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

    const quickBtn = document.getElementById("rbQuickProposeBtn");
    if (quickBtn) {
      quickBtn.addEventListener("click", () => {
        const articleNumber = Number(prompt("Article number? (e.g. 1)") || "1");
        const type = String(prompt("Type? replace / insert / delete", "replace") || "replace").toLowerCase();
        const text = String(prompt("Amendment text:") || "").trim();
        if (!text) return alert("Amendment text is required.");
        const res = rbProposeAmendment(bill.id, { articleNumber, type, text, proposedBy: myName });
        if (!res) {
          const latest = getData();
          const b = (latest?.orderPaperCommons || []).find(x => x.id === bill.id);
          return alert(b?._lastAmendmentError || "Could not submit amendment.");
        }
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

  /* =========================================================
     NEWS PAGE
     ========================================================= */
  function ensureNewsDefaults(data){
    data.news = data.news || { stories: [] };
    data.news.stories = Array.isArray(data.news.stories) ? data.news.stories : [];

    // If empty, add a couple of starter placeholders
    if (data.news.stories.length === 0) {
      const sim = simMonthYearLabel(data);
      data.news.stories.push(
        {
          id:`news-${nowTs()}`,
          createdAt: nowTs(),
          simDate: sim,
          isBreaking: true,
          category: "Politics",
          headline: "BBC: Top political story headline goes here",
          imageUrl: "",
          text: "Write the main story text here.",
          flavour: false
        },
        {
          id:`news-${nowTs()+1}`,
          createdAt: nowTs(),
          simDate: sim,
          isBreaking: false,
          category: "Economy",
          headline: "Smaller flavour headline goes here",
          imageUrl: "",
          text: "This is the smaller BBC-app style flavour item.",
          flavour: true
        }
      );
    }
  }

  function renderNewsPage(data){
    const mast = document.getElementById("bbcSimDate");
    const mainEl = document.getElementById("bbcMainNews");
    const flavEl = document.getElementById("bbcFlavourNews");
    const archEl = document.getElementById("bbcArchive");
    const breakingPanel = document.getElementById("bbcBreakingPanel");
    const breakingTicker = document.getElementById("bbcBreakingTicker");

    if (!mast || !mainEl || !flavEl || !archEl) return;

    ensureNewsDefaults(data);
    mast.textContent = simMonthYearLabel(data);

    const stories = data.news.stories.slice().sort((a,b)=> (b.createdAt||0)-(a.createdAt||0));
    const TWO_WEEKS_MS = 14 * 86400000;

    const live = stories.filter(s => (nowTs() - (s.createdAt||nowTs())) <= TWO_WEEKS_MS);
    const archive = stories.filter(s => (nowTs() - (s.createdAt||nowTs())) > TWO_WEEKS_MS);

    const breaking = live.filter(s => s.isBreaking && !s.flavour);
    if (breakingPanel && breakingTicker) {
      if (breaking.length) {
        breakingPanel.style.display = "block";
        breakingTicker.textContent = breaking.map(s => s.headline).slice(0, 6).join("  •  ");
      } else {
        breakingPanel.style.display = "none";
      }
    }

    const card = (s, small=false) => `
      <div class="news-card ${small ? "small" : ""} card-flex">
        <div class="news-brand">
          <div class="news-date">${escapeHtml(s.simDate || simMonthYearLabel(data))}</div>
          ${s.isBreaking ? `<div class="breaking-tag">BREAKING</div>` : ``}
        </div>
        ${s.category ? `<div class="news-category">${escapeHtml(s.category)}</div>` : ``}
        <div class="news-headline">${escapeHtml(s.headline || "Untitled")}</div>
        ${s.imageUrl ? `<div class="news-imagewrap"><img alt="" src="${escapeHtml(s.imageUrl)}"></div>` : ``}
        <div class="news-text">${escapeHtml(s.text || "")}</div>
      </div>
    `;

    const mainNews = live.filter(s => !s.flavour);
    const flavour = live.filter(s => s.flavour);

    mainEl.innerHTML = mainNews.length
      ? `<div class="news-grid">${mainNews.map(s => card(s,false)).join("")}</div>`
      : `<div class="muted-block">No main news stories yet.</div>`;

    flavEl.innerHTML = flavour.length
      ? `<div class="news-grid">${flavour.map(s => card(s,true)).join("")}</div>`
      : `<div class="muted-block">No flavour items yet.</div>`;

    archEl.innerHTML = archive.length
      ? `<div class="news-grid">${archive.map(s => card(s,true)).join("")}</div>`
      : `<div class="muted-block">No archived stories yet.</div>`;
  }

  /* =========================================================
     PAPERS PAGE
     ========================================================= */
  function ensurePapersDefaults(data){
    const defaults = [
      { key:"sun", name:"The Sun", cls:"paper-sun" },
      { key:"telegraph", name:"The Daily Telegraph", cls:"paper-telegraph" },
      { key:"mail", name:"The Daily Mail", cls:"paper-mail" },
      { key:"mirror", name:"The Daily Mirror", cls:"paper-mirror" },
      { key:"times", name:"The Times", cls:"paper-times" },
      { key:"ft", name:"Financial Times", cls:"paper-ft" },
      { key:"guardian", name:"The Guardian", cls:"paper-guardian" },
      { key:"independent", name:"The Independent", cls:"paper-independent" },
    ];

    data.papers = data.papers || { papers: [] };
    data.papers.papers = Array.isArray(data.papers.papers) ? data.papers.papers : [];

    // If missing, create papers + one issue each
    if (data.papers.papers.length === 0) {
      const sim = simMonthYearLabel(data);
      data.papers.papers = defaults.map(p => ({
        ...p,
        issues: [
          {
            id:`issue-${p.key}-${nowTs()}`,
            createdAt: nowTs(),
            simDate: sim,
            headline: `${p.name} — Front Page Headline`,
            imageUrl: "",
            bylineName: "Political Correspondent",
            text: "Front page story text goes here."
          }
        ]
      }));
    } else {
      // ensure each has cls + issues array
      data.papers.papers.forEach(p => {
        const match = defaults.find(d => d.key === p.key || d.name === p.name);
        if (match) {
          p.key = p.key || match.key;
          p.name = p.name || match.name;
          p.cls = p.cls || match.cls;
        }
        p.issues = Array.isArray(p.issues) ? p.issues : [];
        if (p.issues.length === 0) {
          p.issues.push({
            id:`issue-${p.key || "paper"}-${nowTs()}`,
            createdAt: nowTs(),
            simDate: simMonthYearLabel(data),
            headline: `${p.name || "Paper"} — Front Page Headline`,
            imageUrl: "",
            bylineName: "Political Correspondent",
            text: "Front page story text goes here."
          });
        }
      });
    }
  }

  function renderPapersPage(data){
    const dateEl = document.getElementById("papersSimDate");
    const gridEl = document.getElementById("papersGrid");
    const readerPanel = document.getElementById("paperReaderPanel");
    const readerEl = document.getElementById("paperReader");

    if (!dateEl || !gridEl) return;

    ensurePapersDefaults(data);
    dateEl.textContent = simMonthYearLabel(data);

    const papers = data.papers.papers;

    // reader mode by query
    const params = new URLSearchParams(location.search);
    const paperKey = params.get("paper"); // e.g. ?paper=times
    const selected = paperKey ? papers.find(p => p.key === paperKey) : null;

    // Grid always visible
    gridEl.classList.remove("muted-block");
    gridEl.innerHTML = `
      <div class="paper-grid">
        ${papers.map(p => {
          const issue = (p.issues || []).slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))[0];
          return `
            <div class="paper-tile ${escapeHtml(p.cls || "")} card-flex">
              <div class="paper-masthead">${escapeHtml(p.name || "Paper")}</div>
              <div class="paper-headline">${escapeHtml(issue?.headline || "Front Page Headline")}</div>
              <div class="tile-bottom">
                <a class="btn" href="papers.html?paper=${encodeURIComponent(p.key)}">Read this Paper</a>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;

    // Reader panel
    if (readerPanel && readerEl) {
      if (!selected) {
        readerPanel.style.display = "none";
      } else {
        readerPanel.style.display = "block";
        const issues = (selected.issues || []).slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));

        readerEl.innerHTML = `
          <div class="paper-reader-header">
            <div>
              <div class="paper-reader-title">${escapeHtml(selected.name)}</div>
              <div class="small">Newest issue first · click back to return to the grid.</div>
            </div>
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
              <a class="btn" href="papers.html">Back to Papers</a>
            </div>
          </div>

          ${issues.map(i => `
            <div class="paper-issue ${escapeHtml(selected.cls || "")}">
              <div class="paper-issue-top">
                <div class="paper-issue-masthead">${escapeHtml(selected.name)}</div>
                <div class="paper-issue-date">${escapeHtml(i.simDate || simMonthYearLabel(data))}</div>
              </div>

              <div class="paper-issue-headline">${escapeHtml(i.headline || "Front Page")}</div>

              ${i.imageUrl ? `<div class="paper-issue-imagewrap"><img alt="" src="${escapeHtml(i.imageUrl)}"></div>` : ``}

              <div class="paper-issue-byline">${escapeHtml(i.bylineName || "Political Correspondent")}</div>
              <div class="paper-issue-text">${escapeHtml(i.text || "")}</div>
            </div>
          `).join("")}
        `;
      }
    }
  }

  /* =========================================================
     QUESTION TIME PAGE
     ========================================================= */
  function ensureQuestionTimeDefaults(data){
    data.questionTime = data.questionTime || { offices: [] };
    data.questionTime.offices = Array.isArray(data.questionTime.offices) ? data.questionTime.offices : [];

    // If empty, restore the tiles (this is why you saw "No offices configured")
    if (data.questionTime.offices.length === 0) {
      data.questionTime.offices = [
        { id:"pmq", title:"Prime Minister", holder: safe(data.currentPlayer?.name, "Prime Minister") },
        { id:"chancellor", title:"Chancellor of the Exchequer", holder:"—" },
        { id:"foreign", title:"Foreign Secretary", holder:"—" },
        { id:"home", title:"Home Secretary", holder:"—" },
        { id:"defence", title:"Defence Secretary", holder:"—" },
        { id:"health", title:"Health Secretary", holder:"—" },
        { id:"education", title:"Education Secretary", holder:"—" },
        { id:"transport", title:"Transport Secretary", holder:"—" },
      ];
    }
  }

  function renderQuestionTimePage(data){
    const root = document.getElementById("question-time-root") || document.getElementById("qt-root");
    if (!root) return;

    ensureQuestionTimeDefaults(data);

    const offices = data.questionTime.offices;

    root.innerHTML = `
      <div class="muted-block" style="margin-bottom:14px;">
        <b>Question Time</b><br>
        Office tiles are shown here. Mods/Admin can change the list later in the control panel.
      </div>

      <div class="qt-grid">
        ${offices.map(o => `
          <div class="qt-tile card-flex">
            <div class="qt-office">${escapeHtml(o.title || "Office")}</div>
            <div class="qt-holder">Holder: <b>${escapeHtml(o.holder || "—")}</b></div>
            <div class="tile-bottom">
              <button class="btn" type="button" disabled>Ask a Question (soon)</button>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  /* =========================================================
     CONSTITUENCIES PAGE
     ========================================================= */
  function ensureConstituenciesDefaults(data){
    // If mods haven’t loaded a full list yet, at least show party totals from parliament.parties
    data.parliament = data.parliament || { totalSeats: 650, parties: [] };
    data.parliament.parties = Array.isArray(data.parliament.parties) ? data.parliament.parties : [];

    // Clean party totals if "Others" is negative or missing
    const total = Number(data.parliament.totalSeats || 650);
    const known = data.parliament.parties.filter(p => p.name !== "Others");
    const sumKnown = known.reduce((a,p)=>a+Number(p.seats||0),0);
    const othersSeats = Math.max(0, total - sumKnown);

    const hasOthers = data.parliament.parties.some(p => p.name === "Others");
    if (!hasOthers) data.parliament.parties.push({ name:"Others", seats: othersSeats });
    else {
      data.parliament.parties = data.parliament.parties.map(p => p.name === "Others" ? ({...p, seats: othersSeats}) : p);
    }

    // Constituency list optional; if empty, we still render a useful page
    data.constituencies = Array.isArray(data.constituencies) ? data.constituencies : [];
  }

  function renderConstituenciesPage(data){
    const summaryEl = document.getElementById("parliament-summary");
    const partyEl = document.getElementById("party-constituencies");
    if (!summaryEl || !partyEl) return;

    ensureConstituenciesDefaults(data);

    const total = Number(data.parliament.totalSeats || 650);
    const parties = data.parliament.parties.slice().sort((a,b)=> (b.seats||0)-(a.seats||0));

    summaryEl.innerHTML = `
      <div class="commons-hero">
        <div class="commons-badge">House of Commons</div>
        <div class="commons-sub">Total seats: <b>${total}</b> · Snapshot: <b>${escapeHtml(simMonthYearLabel(data))}</b></div>
        <div style="margin-top:10px;" class="muted-block">
          ${parties.map(p => `<div class="row"><span>${escapeHtml(p.name)}</span><b>${Number(p.seats||0)}</b></div>`).join("")}
        </div>
      </div>
    `;

    // If we have full constituency data, show by party and region. If not, show “ready for mod data”.
    const list = data.constituencies;
    if (!list.length) {
      partyEl.innerHTML = `
        <div class="muted-block">
          Constituency lists are not loaded yet (this is fine for now).<br>
          The party totals above are live and will feed into divisions later.
        </div>

        <div class="party-grid" style="margin-top:14px;">
          ${parties.map(p => `
            <div class="party-tile card-flex">
              <div class="party-name">${escapeHtml(p.name)}</div>
              <div class="party-seats">${Number(p.seats||0)} seats</div>
              <div class="tile-bottom"><button class="btn" type="button" disabled>Open seats (soon)</button></div>
            </div>
          `).join("")}
        </div>
      `;
      return;
    }

    // Group constituencies by party -> region
    const byParty = new Map();
    list.forEach(c => {
      const party = c.party || "Unknown";
      const region = c.region || "UK";
      if (!byParty.has(party)) byParty.set(party, new Map());
      const m = byParty.get(party);
      if (!m.has(region)) m.set(region, []);
      m.get(region).push(c);
    });

    partyEl.innerHTML = `
      <div class="party-grid">
        ${parties.map(p => {
          const regions = byParty.get(p.name);
          const seatListHtml = regions
            ? Array.from(regions.entries()).map(([region, seats]) => `
                <div class="muted-block" style="margin-top:10px;">
                  <b>${escapeHtml(region)}</b><br>
                  <span class="small">${seats.map(s => escapeHtml(s.name)).join(", ")}</span>
                </div>
              `).join("")
            : `<div class="muted-block" style="margin-top:10px;">No constituencies listed for this party yet.</div>`;

          return `
            <div class="party-tile">
              <div class="party-name">${escapeHtml(p.name)}</div>
              <div class="party-seats">${Number(p.seats||0)} seats</div>
              ${seatListHtml}
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  /* =========================================================
     BODIES PAGE (must not be empty)
     ========================================================= */
  function ensureBodiesDefaults(data){
    data.bodies = data.bodies || { list: [] };
    data.bodies.list = Array.isArray(data.bodies.list) ? data.bodies.list : [];

    if (data.bodies.list.length === 0) {
      // Minimal 1997-ish defaults (mods can edit later)
      data.bodies.list = [
        {
          id:"lords",
          name:"House of Lords",
          desc:"Non-elected chamber. Composition is flavour (no player voting).",
          totalSeats: 1200,
          parties: [
            { name:"Conservative", seats: 450 },
            { name:"Labour", seats: 200 },
            { name:"Liberal Democrat", seats: 70 },
            { name:"Crossbench", seats: 350 },
            { name:"Bishops/Other", seats: 130 }
          ]
        },
        {
          id:"europarl",
          name:"European Parliament (UK delegation)",
          desc:"Flavour body for Europe-wide context.",
          totalSeats: 87,
          parties: [
            { name:"Labour", seats: 62 },
            { name:"Conservative", seats: 18 },
            { name:"Liberal Democrat", seats: 2 },
            { name:"SNP/Plaid/Other", seats: 5 }
          ]
        }
      ];
    }
  }

  function renderBodiesPage(data){
    const root = document.getElementById("bodies-root");
    if (!root) return;

    ensureBodiesDefaults(data);

    root.innerHTML = `
      <h1 class="page-title">Bodies</h1>
      <div class="muted-block" style="margin-bottom:14px;">
        These are non-Commons bodies (flavour only). Mods can change seats and composition for any time period.
      </div>

      <div class="body-grid">
        ${data.bodies.list.map(b => `
          <div class="body-tile">
            <div class="body-head">
              <div class="body-name">${escapeHtml(b.name)}</div>
              <div class="small">Seats: <b>${Number(b.totalSeats||0)}</b></div>
            </div>
            <div class="body-desc">${escapeHtml(b.desc || "")}</div>

            <div class="body-seats muted-block" style="margin-top:12px;">
              ${(b.parties||[]).map(p => `<div class="row"><span>${escapeHtml(p.name)}</span><b>${Number(p.seats||0)}</b></div>`).join("")}
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  /* =========================================================
     USER PAGE (must not be empty)
     ========================================================= */
  function renderUserPage(data){
    const accountEl = document.getElementById("user-account");
    const cpEl = document.getElementById("user-controlpanel");
    if (!accountEl || !cpEl) return;

    const user = data.currentUser || {};
    const char = data.currentCharacter || data.currentPlayer || {};

    const roles = [];
    if (user.isAdmin) roles.push("Admin");
    if (user.isMod) roles.push("Moderator");
    if (char.isSpeaker) roles.push("Speaker");
    if (!roles.length) roles.push("Player");

    accountEl.innerHTML = `
      <div class="muted-block">
        <div class="kv"><span>Username</span><b>${escapeHtml(user.username || "User")}</b></div>
        <div class="kv"><span>Role</span><b>${escapeHtml(roles.join(", "))}</b></div>
        <div class ⚠️= "kv"><span>Active Character</span><b>${escapeHtml(char.name || "None")}</b></div>
        <div class="kv"><span>Party</span><b>${escapeHtml(char.party || "—")}</b></div>
      </div>
    `;

    const canSeeControls = !!user.isAdmin || !!user.isMod || !!char.isSpeaker;

    cpEl.innerHTML = canSeeControls
      ? `
        <div class="muted-block">
          <b>Control Panel (Base)</b><br>
          This is where Admin/Mods/Speaker controls will live (no coding rewrites needed later).
          <hr>
          <div class="small"><b>Planned:</b> edit Parliament seats, manage NPC votes, manage Question Time offices, post BBC News, post Papers.</div>
          <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;">
            <button class="btn" type="button" disabled>Open Admin Controls (soon)</button>
            <button class="btn" type="button" disabled>Open Speaker Controls (soon)</button>
          </div>
        </div>
      `
      : `<div class="muted-block">No control access on this account.</div>`;
  }

  /* =========================================================
     SUBMIT BILL PAGE (fix "Loading...")
     ========================================================= */
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

        <h3 style="grid-column:1/-1; margin:0;">Final Article — Extent & Commencement</h3>

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

        <div style="grid-column:1/-1; display:flex; justify-content:flex-end;">
          <button class="btn primary" id="submitStructuredBillBtn" type="button">Submit Bill</button>
        </div>
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

    const newBill = {
      id: `bill-${nowTs()}`,
      title: fullTitle,
      author: safe(current.name, "Unknown MP"),
      department: "Commons",
      billType: isOpp ? "opposition" : "pmb",
      stage: isOpp ? "Second Reading" : "First Reading",
      status: "in-progress",
      createdAt: nowTs(),
      stageStartedAt: nowTs(),
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

  /* =========================================================
     PARTY DRAFT PAGE (fix "Loading...")
     ========================================================= */
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

        <h3 style="grid-column:1/-1; margin:0;">Final Article — Extent & Commencement</h3>

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

        <div style="grid-column:1/-1; display:flex; justify-content:flex-end;">
          <button class="btn primary" id="savePartyDraftBtn" type="button">Save Draft</button>
        </div>
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
                <a class="btn danger" href="#" data-delete="${escapeHtml(d.id)}">Delete</a>
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

  /* =========================================================
     Live refresh (only where needed)
     ========================================================= */
  function startLiveRefresh() {
    const needsRefresh =
      document.getElementById("order-paper") ||
      document.getElementById("live-docket") ||
      document.getElementById("sim-date-display") ||
      document.getElementById("billMeta") ||
      document.getElementById("bbcMainNews") ||
      document.getElementById("papersGrid");

    if (!needsRefresh) return;

    setInterval(() => {
      const latest = getData();
      if (!latest) return;
      normaliseData(latest);

      // Dashboard
      renderSimDate(latest);
      renderWhatsGoingOn(latest);
      renderLiveDocket(latest);
      renderOrderPaper(latest);

      // Bill page
      initBillPage(latest);

      // News/Papers
      renderNewsPage(latest);
      renderPapersPage(latest);
    }, 1000);
  }
/* =========================
   Economy Page
   Expects economy.html IDs:
     - #econ-topline
     - #econ-tiles
     - #econ-surveys
   ========================= */
function initEconomyPage(data){
  const keyEl = document.getElementById("economyKeyLines");
  const tilesEl = document.getElementById("economyTiles");
  const reportsEl = document.getElementById("economyReportsTiles");
  const detailPanel = document.getElementById("economyDetailPanel");
  const detailEl = document.getElementById("economyDetail");

  if (!keyEl || !tilesEl || !reportsEl) return;

  const econ = data.economyPage || {};
  const key = econ.keyLines || {};

  keyEl.innerHTML = `
    <div class="muted-block">
      <div class="kv"><span>Inflation</span><b>${fmtPct(key.inflation)}</b></div>
      <div class="kv"><span>Unemployment</span><b>${fmtPct(key.unemployment)}</b></div>
      <div class="kv"><span>GDP Growth</span><b>${fmtPct(key.gdpGrowth)}</b></div>
    </div>
  `;

  function openDetail(title, rows){
    if (!detailPanel || !detailEl) return;
    detailPanel.style.display = "block";

    // rows can be: {label, value} OR {label, ly, ty, pct}
    const isLyTy = rows.some(r => ("ly" in r) || ("ty" in r));

    detailEl.innerHTML = `
      <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:flex-start;">
        <div>
          <h2 style="margin:0;">${escapeHtml(title)}</h2>
          <div class="small" style="margin-top:6px;">Values come from <b>data/demo.json</b> (mods/admins can edit).</div>
        </div>
        <button class="btn" type="button" id="econCloseDetail">Close</button>
      </div>

      <div class="muted-block" style="margin-top:12px;">
        ${
          isLyTy
            ? rows.map(r => `
                <div class="kv">
                  <span>${escapeHtml(r.label || "—")}</span>
                  <b>
                    LY ${fmtNumber(r.ly)} · TY ${fmtNumber(r.ty)} · ${fmtPctSigned(r.pct)}
                  </b>
                </div>
              `).join("")
            : rows.map(r => `
                <div class="kv">
                  <span>${escapeHtml(r.label || "—")}</span>
                  <b>${fmtNumber(r.value)}</b>
                </div>
              `).join("")
        }
      </div>
    `;

    const closeBtn = document.getElementById("econCloseDetail");
    if (closeBtn) closeBtn.addEventListener("click", () => {
      detailPanel.style.display = "none";
    });

    detailPanel.scrollIntoView({ behavior:"smooth", block:"start" });
  }

  const tiles = Array.isArray(econ.tiles) ? econ.tiles : [];
  const reports = Array.isArray(econ.reports) ? econ.reports : [];

  if (!tiles.length){
    tilesEl.innerHTML = `<div class="muted-block">No economy tiles configured yet.</div>`;
  } else {
    tilesEl.className = "paper-grid"; // reuse a nice grid you already have
    tilesEl.innerHTML = tiles.map(t => `
      <div class="paper-tile card-flex">
        <div class="paper-masthead">${escapeHtml(t.title || "Tile")}</div>
        <div class="paper-strap">${escapeHtml(t.summary || "")}</div>
        <div class="tile-bottom">
          <button class="btn" type="button" data-econ-tile="${escapeHtml(t.id)}">Open</button>
        </div>
      </div>
    `).join("");

    tilesEl.querySelectorAll("[data-econ-tile]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-econ-tile");
        const t = tiles.find(x => x.id === id);
        if (!t) return;
        openDetail(t.title || "Detail", Array.isArray(t.rows) ? t.rows : []);
      });
    });
  }

  if (!reports.length){
    reportsEl.innerHTML = `<div class="muted-block">No surveys/reports configured yet.</div>`;
  } else {
    reportsEl.className = "paper-grid";
    reportsEl.innerHTML = reports.map(r => `
      <div class="paper-tile card-flex">
        <div class="paper-masthead">${escapeHtml(r.title || "Report")}</div>
        <div class="paper-strap">${escapeHtml(r.summary || "")}</div>
        <div class="tile-bottom">
          <button class="btn" type="button" data-econ-report="${escapeHtml(r.id)}">Open</button>
        </div>
      </div>
    `).join("");

    reportsEl.querySelectorAll("[data-econ-report]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-econ-report");
        const r = reports.find(x => x.id === id);
        if (!r) return;
        openDetail(r.title || "Report", Array.isArray(r.rows) ? r.rows : []);
      });
    });
  }
}


/* =========================
   QUICK FIXES: Question Time + Papers ID mismatches
   ========================= */
function initQuestionTimePage(data){
  const root =
    document.getElementById("question-time-root") ||
    document.getElementById("qt-root");

  if (!root) return;

  const qt = data.questionTime || {};
  const offices = Array.isArray(qt.cabinet) ? qt.cabinet : [];

  if (!offices.length){
    root.innerHTML = `<div class="muted-block">No Question Time offices configured yet.</div>`;
    return;
  }

  root.innerHTML = `
    <div class="qt-grid">
      ${offices.map(o => `
        <div class="qt-tile card-flex">
          <div class="qt-office">${escapeHtml(o.short || o.title || "Office")}</div>
          <div class="small" style="margin-top:8px;">${escapeHtml(o.title || "")}</div>

          <div class="tile-bottom">
            <a class="btn" href="qt-office.html?office=${encodeURIComponent(o.slug)}">Open</a>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}


function initPapersPage(data){
  const grid = document.getElementById("papersGrid");
  const simDateEl = document.getElementById("papersSimDate");
  const readerPanel = document.getElementById("paperReaderPanel");
  const reader = document.getElementById("paperReader");

  if (!grid || !simDateEl) return;

  const sim = getCurrentSimDate(data);
  simDateEl.textContent = `${getMonthName(sim.month)} ${sim.year}`;

  // You can move this list into demo.json later if you want total mod control.
  const PAPERS = [
    { id:"sun", name:"The Sun", cls:"paper-sun" },
    { id:"telegraph", name:"The Daily Telegraph", cls:"paper-telegraph" },
    { id:"mail", name:"The Daily Mail", cls:"paper-mail" },
    { id:"mirror", name:"The Daily Mirror", cls:"paper-mirror" },
    { id:"times", name:"The Times", cls:"paper-times" },
    { id:"ft", name:"Financial Times", cls:"paper-ft" },
    { id:"guardian", name:"The Guardian", cls:"paper-guardian" },
    { id:"independent", name:"The Independent", cls:"paper-independent" }
  ];

  // Minimal “front page” source: use whatsGoingOn.papers as a stand-in headline.
  const front = data.whatsGoingOn?.papers || {};
  const defaultHeadline = front.headline || "Front Page Headline";

  grid.className = "paper-grid";
  grid.innerHTML = PAPERS.map(p => `
    <div class="paper-tile ${p.cls} card-flex">
      <div class="paper-masthead">${escapeHtml(p.name)}</div>
      <div class="paper-headline">${escapeHtml(p.name)} — ${escapeHtml(defaultHeadline)}</div>
      <div class="tile-bottom">
        <button class="btn" type="button" data-paper="${escapeHtml(p.id)}">Read this Paper</button>
      </div>
    </div>
  `).join("");

  grid.querySelectorAll("[data-paper]").forEach(btn => {
    btn.addEventListener("click", () => {
      const pid = btn.getAttribute("data-paper");
      if (!readerPanel || !reader) return;

      readerPanel.style.display = "block";

      const p = PAPERS.find(x => x.id === pid);
      reader.innerHTML = `
        <div class="paper-reader-header">
          <div>
            <div class="paper-reader-title">${escapeHtml(p?.name || "Paper")}</div>
            <div class="small">${escapeHtml(getMonthName(sim.month))} ${sim.year}</div>
          </div>
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <button class="btn" type="button" id="paperCloseBtn">Close</button>
          </div>
        </div>

        <div class="paper-issue ${escapeHtml(p?.cls || "")}">
          <div class="paper-issue-top">
            <div class="paper-issue-masthead">${escapeHtml(p?.name || "")}</div>
            <div class="paper-issue-date">${escapeHtml(getMonthName(sim.month))} ${sim.year}</div>
          </div>

          <div class="paper-issue-headline">${escapeHtml(defaultHeadline)}</div>
          <div class="paper-issue-byline">Political Correspondent</div>
          <div class="paper-issue-text">${escapeHtml(front.strap || "One-sentence front page standfirst.")}</div>
        </div>
      `;

      const closeBtn = document.getElementById("paperCloseBtn");
      if (closeBtn) closeBtn.addEventListener("click", () => {
        readerPanel.style.display = "none";
      });

      // scroll into view nicely
      readerPanel.scrollIntoView({ behavior:"smooth", block:"start" });
    });
  });
}


/* =========================================================
   BOOT (means: "when the app first loads")
   ========================================================= */
fetch(DATA_URL)
  .then(r => r.json())
  .then((demo) => {
    let data = getData();
    if (!data) data = demo;

    normaliseData(data);
    saveData(data);

    initNavUI();

    // Helper: run a function without killing the entire app if it errors
    const safeRun = (label, fn) => {
      try { fn(); }
      catch (e) { console.error(`[BOOT] ${label} failed:`, e); }
    };

    // Dashboard (only renders if the IDs exist on the page)
    safeRun("renderSimDate",        () => renderSimDate(data));
    safeRun("renderWhatsGoingOn",   () => renderWhatsGoingOn(data));
    safeRun("renderLiveDocket",     () => renderLiveDocket(data));
    safeRun("renderOrderPaper",     () => renderOrderPaper(data));
    safeRun("renderHansard",        () => renderHansard(data));
    safeRun("renderSundayRollDisplay", () => renderSundayRollDisplay());
    safeRun("renderAbsenceUI",      () => renderAbsenceUI(data));

    // Core pages (ONLY call the versions you actually have)
    safeRun("initBillPage",         () => initBillPage(data));

    // ✅ Use THESE newer init functions (and remove the older render* calls)
    safeRun("initNewsPage",         () => initNewsPage?.(data) || renderNewsPage?.(data));
    safeRun("initPapersPage",       () => initPapersPage(data));
    safeRun("initQuestionTimePage", () => initQuestionTimePage(data));
    safeRun("initEconomyPage",      () => initEconomyPage(data));

    // If you have these functions, keep them; if not, they won't crash
    safeRun("initConstituenciesPage", () => initConstituenciesPage?.(data) || renderConstituenciesPage?.(data));
    safeRun("initBodiesPage",         () => initBodiesPage?.(data) || renderBodiesPage?.(data));
    safeRun("initUserPage",           () => initUserPage?.(data) || renderUserPage?.(data));

    // Builders (safe)
    safeRun("initSubmitBillPage",   () => initSubmitBillPage(data));
    safeRun("initPartyDraftPage",   () => initPartyDraftPage(data));

    startLiveRefresh();
  })
  .catch(err => console.error("Error loading demo.json:", err));
})();
