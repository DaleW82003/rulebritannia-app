/* =========================================================
   Rule Britannia — app.js (STABLE CONSOLIDATED BUILD)
   - Keeps ALL prior bill/amendment/division logic
   - FIXES: Question Time Open buttons, Economy wiring, User page typo
   - Supports multiple HTML IDs across pages (qt-root OR question-time-root, etc.)
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

    data.parliament = data.parliament || { totalSeats: 650, parties: [] };
    data.parliament.parties = Array.isArray(data.parliament.parties) ? data.parliament.parties : [];

    data.constituencies = Array.isArray(data.constituencies) ? data.constituencies : [];

    data.news = data.news || { stories: [] };
    data.news.stories = Array.isArray(data.news.stories) ? data.news.stories : [];

    data.papers = data.papers || { papers: [] };
    data.papers.papers = Array.isArray(data.papers.papers) ? data.papers.papers : [];

    // Question Time: your demo.json uses questionTime.cabinet + questionTime.questions
    data.questionTime = data.questionTime || {};
    data.questionTime.cabinet = Array.isArray(data.questionTime.cabinet) ? data.questionTime.cabinet : [];
    data.questionTime.questions = Array.isArray(data.questionTime.questions) ? data.questionTime.questions : [];
    data.questionTime.offices = Array.isArray(data.questionTime.offices) ? data.questionTime.offices : [];

    data.bodies = data.bodies || { list: [] };
    data.bodies.list = Array.isArray(data.bodies.list) ? data.bodies.list : [];

    data.adminSettings = data.adminSettings || { monarchGender: "Queen" };
    data.oppositionTracker = data.oppositionTracker || {};

    // Economy page (your demo.json)
    data.economyPage = data.economyPage || {};
    data.economyPage.topline = data.economyPage.topline || {};
    data.economyPage.ukInfoTiles = Array.isArray(data.economyPage.ukInfoTiles) ? data.economyPage.ukInfoTiles : [];
    data.economyPage.surveys = Array.isArray(data.economyPage.surveys) ? data.economyPage.surveys : [];

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

  /* =========================================================
     BILL ENGINE (existing logic kept)
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

    if (isSunday()) return bill;
    if (isCompleted(bill)) return bill;

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
    if (isSunday()) return bill;

    const now = nowTs();

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

  function isLeader(playerObj) {
    return playerObj?.partyLeader === true ||
           playerObj?.role === "leader-opposition" ||
           playerObj?.role === "prime-minister";
  }

  function rbProposeAmendment(billId, { articleNumber, type, text, proposedBy }){
    return rbUpdateBill(billId, (bill) => {
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
     BILL PAGE (kept)
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

    // Amendments UI (only if root exists; stable)
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
     QUESTION TIME PAGE (FIXED: Open works again)
     Uses your demo.json: questionTime.cabinet[]
     ========================================================= */
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
      <div class="muted-block" style="margin-bottom:14px;">
        <b>Question Time</b><br>
        Click an office to view questions and answers.
      </div>

      <div class="qt-grid">
        ${offices.map(o => `
          <div class="qt-tile card-flex">
            <div class="qt-office">${escapeHtml(o.short || "Office")}</div>
            <div class="small" style="margin-top:8px;">${escapeHtml(o.title || "")}</div>

            <div class="tile-bottom">
              <a class="btn" href="qt-office.html?office=${encodeURIComponent(o.slug)}">Open</a>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  /* =========================================================
     ECONOMY PAGE (FIXED to match your demo.json)
     Expects economy.html IDs:
       - #economyKeyLines
       - #economyTiles
       - #economyReportsTiles
       - #economyDetailPanel (optional)
       - #economyDetail (optional)
     ========================================================= */
  function initEconomyPage(data){
    const keyEl = document.getElementById("economyKeyLines");
    const tilesEl = document.getElementById("economyTiles");
    const reportsEl = document.getElementById("economyReportsTiles");
    const detailPanel = document.getElementById("economyDetailPanel");
    const detailEl = document.getElementById("economyDetail");

    if (!keyEl || !tilesEl || !reportsEl) return;

    const econ = data.economyPage || {};
    const top = econ.topline || {};

    // KEY LINES: always Inflation, Unemployment, GDP Growth (your instruction)
    keyEl.innerHTML = `
      <div class="muted-block">
        <div class="kv"><span>Inflation</span><b>${fmtPct(top.inflation)}</b></div>
        <div class="kv"><span>Unemployment</span><b>${fmtPct(top.unemployment)}</b></div>
        <div class="kv"><span>GDP Growth</span><b>${fmtPct(top.gdpGrowth)}</b></div>
      </div>
    `;

    function openDetail(title, rows){
      if (!detailPanel || !detailEl) return;

      detailPanel.style.display = "block";

      // Your demo.json rows are array-arrays, first row is headers
      const isArrayRows = Array.isArray(rows) && rows.length && Array.isArray(rows[0]);

      if (!isArrayRows) {
        detailEl.innerHTML = `
          <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:flex-start;">
            <div>
              <h2 style="margin:0;">${escapeHtml(title)}</h2>
              <div class="small" style="margin-top:6px;">No data for this tile yet.</div>
            </div>
            <button class="btn" type="button" id="econCloseDetail">Close</button>
          </div>
          <div class="muted-block" style="margin-top:12px;">—</div>
        `;
      } else {
        const [header, ...body] = rows;

        detailEl.innerHTML = `
          <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:flex-start;">
            <div>
              <h2 style="margin:0;">${escapeHtml(title)}</h2>
              <div class="small" style="margin-top:6px;">Values come from <b>data/demo.json</b> (mods/admins can edit).</div>
            </div>
            <button class="btn" type="button" id="econCloseDetail">Close</button>
          </div>

          <div class="muted-block" style="margin-top:12px;">
            ${body.map(r => `
              <div class="kv">
                <span>${escapeHtml(r[0] ?? "—")}</span>
                <b>${escapeHtml(String(r[1] ?? "—"))}${header[2] ? ` · ${escapeHtml(String(r[2] ?? "—"))}` : ""}</b>
              </div>
            `).join("")}
          </div>
        `;
      }

      const closeBtn = document.getElementById("econCloseDetail");
      if (closeBtn) closeBtn.addEventListener("click", () => {
        detailPanel.style.display = "none";
      });

      detailPanel.scrollIntoView({ behavior:"smooth", block:"start" });
    }

    const tiles = Array.isArray(econ.ukInfoTiles) ? econ.ukInfoTiles : [];
    const surveys = Array.isArray(econ.surveys) ? econ.surveys : [];

    // UK INFO tiles
    if (!tiles.length){
      tilesEl.innerHTML = `<div class="muted-block">No UK information tiles configured yet.</div>`;
    } else {
      tilesEl.className = "paper-grid";
      tilesEl.innerHTML = tiles.map(t => `
        <div class="paper-tile card-flex">
          <div class="paper-masthead">${escapeHtml(t.title || "Tile")}</div>
          <div class="paper-strap">${escapeHtml(t.subtitle || "")}</div>
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

    // Surveys & reports tiles
    if (!surveys.length){
      reportsEl.innerHTML = `<div class="muted-block">No surveys/reports configured yet.</div>`;
    } else {
      reportsEl.className = "paper-grid";
      reportsEl.innerHTML = surveys.map(r => `
        <div class="paper-tile card-flex">
          <div class="paper-masthead">${escapeHtml(r.title || "Report")}</div>
          <div class="paper-strap">Survey / report</div>
          <div class="tile-bottom">
            <button class="btn" type="button" data-econ-report="${escapeHtml(r.id)}">Open</button>
          </div>
        </div>
      `).join("");

      reportsEl.querySelectorAll("[data-econ-report]").forEach(btn => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-econ-report");
          const r = surveys.find(x => x.id === id);
          if (!r) return;
          openDetail(r.title || "Report", Array.isArray(r.rows) ? r.rows : []);
        });
      });
    }
  }

  /* =========================================================
     USER PAGE (FIXED typo that could break JS)
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
        <div class="kv"><span>Active Character</span><b>${escapeHtml(char.name || "None")}</b></div>
        <div class="kv"><span>Party</span><b>${escapeHtml(char.party || "—")}</b></div>
      </div>
    `;

    const canSeeControls = !!user.isAdmin || !!user.isMod || !!char.isSpeaker;

    cpEl.innerHTML = canSeeControls
      ? `
        <div class="muted-block">
          <b>Control Panel (Base)</b><br>
          This is where Admin/Mods/Speaker controls will live later.
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
     Builders (kept from your previous)
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
      document.getElementById("billMeta");

    if (!needsRefresh) return;

    setInterval(() => {
      const latest = getData();
      if (!latest) return;
      normaliseData(latest);

      renderSimDate(latest);
      renderWhatsGoingOn(latest);
      renderLiveDocket(latest);
      renderOrderPaper(latest);
      initBillPage(latest);
    }, 1000);
  }

  /* =========================================================
     BOOT
     ========================================================= */
  fetch(DATA_URL)
    .then(r => r.json())
    .then((demo) => {
      let data = getData();
      if (!data) data = demo;

      normaliseData(data);
      saveData(data);

      initNavUI();

      const safeRun = (label, fn) => {
        try { fn(); }
        catch (e) { console.error(`[BOOT] ${label} failed:`, e); }
      };

      // Dashboard (renders only if IDs exist)
      safeRun("renderSimDate",        () => renderSimDate(data));
      safeRun("renderWhatsGoingOn",   () => renderWhatsGoingOn(data));
      safeRun("renderLiveDocket",     () => renderLiveDocket(data));
      safeRun("renderOrderPaper",     () => renderOrderPaper(data));

      // Pages
      safeRun("initBillPage",         () => initBillPage(data));
      safeRun("initQuestionTimePage", () => initQuestionTimePage(data));
      safeRun("initEconomyPage",      () => initEconomyPage(data));
      safeRun("renderUserPage",       () => renderUserPage(data));

      // Builders
      safeRun("initSubmitBillPage",   () => initSubmitBillPage(data));
      safeRun("initPartyDraftPage",   () => initPartyDraftPage(data));

      startLiveRefresh();
    })
    .catch(err => console.error("Error loading demo.json:", err));
})();
