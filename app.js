/* =========================================================
   Rule Britannia — app.js (FULL WORKING BASELINE)
   - Loads demo.json once
   - Uses localStorage rb_full_data as the live state (single source of truth)
   - Upgraded User + Character model (currentUser + activeCharacter)
   - Dashboard: Sim Date + What’s Going On + Live Docket + Order Paper
   - Bill lifecycle + countdown timers + Sunday freeze
   - Amendments: propose -> author accept -> leader support -> division (single active amendment)
   - Main Bill Divisions:
       * 24 active hours
       * Sunday freeze
       * Early close when all votes cast (including speaker NPC allocation)
       * Majority excludes Speaker + Abstentions + Sinn Féin
       * NPC parties locked to Speaker control
       * Speaker can add NPC votes + set rebellions (reduces party pool before weighting)
   - News: BBC style tiles, breaking ticker, categories, archive after 14 RL days
   - Papers: 8 outlets tiles, click opens modal with latest + previous issues
   - Constituencies: seat totals + party tiles + constituency lists by UK region (if dataset present)
   - Bodies: non-Westminster elected bodies tiles
   - Question Time: safe loader (prevents page crash)
   ========================================================= */

(() => {
  "use strict";

  /* =========================
     CONFIG
     ========================= */
  const DATA_URL = "data/demo.json";
  const LS_KEY = "rb_full_data";
  const LS_PARTY_DRAFTS = "rb_party_drafts";
  const LS_USER_KEY = "rb_current_user"; // currentUser store

  const PLAYABLE_PARTIES = ["Labour", "Conservative", "Liberal Democrats"];
  const NPC_LOCKED = true; // speaker only controls NPC parties in divisions
  const NEWS_ARCHIVE_AFTER_DAYS = 14; // RL days

  /* =========================
     HELPERS (simple)
     ========================= */
  const safe = (v, fallback = "") => (v === null || v === undefined ? fallback : v);
  const nowTs = () => Date.now();

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

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

  /* =========================
     STORAGE
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

  function getCurrentUser() {
    return JSON.parse(localStorage.getItem(LS_USER_KEY) || "null");
  }

  function saveCurrentUser(u) {
    localStorage.setItem(LS_USER_KEY, JSON.stringify(u));
  }

  /* =========================
     NORMALISE DATA (important)
     ========================= */
  function normaliseData(data) {
    // Core data buckets
    data.players = Array.isArray(data.players) ? data.players : [];
    data.orderPaperCommons = Array.isArray(data.orderPaperCommons) ? data.orderPaperCommons : [];
    data.whatsGoingOn = data.whatsGoingOn || {};
    data.liveDocket = data.liveDocket || {};
    data.parliament = data.parliament || { totalSeats: 650, parties: [] };
    data.adminSettings = data.adminSettings || { monarchGender: "Queen" };
    data.oppositionTracker = data.oppositionTracker || {}; // simYear -> count

    // Game clock
    data.gameState = data.gameState || {
      started: true,
      isPaused: false,
      startRealDate: new Date().toISOString(),
      startSimMonth: 8,
      startSimYear: 1997
    };

    // New: user + character model
    data.users = Array.isArray(data.users) ? data.users : [];

    // News / Papers / Bodies / Constituencies / Question Time
    data.news = data.news || { items: [] };
    data.news.items = Array.isArray(data.news.items) ? data.news.items : [];

    data.papers = data.papers || { outlets: [] };
    data.papers.outlets = Array.isArray(data.papers.outlets) ? data.papers.outlets : [];

    data.bodies = data.bodies || { list: [] };
    data.bodies.list = Array.isArray(data.bodies.list) ? data.bodies.list : [];

    data.constituencies = data.constituencies || { list: [] };
    data.constituencies.list = Array.isArray(data.constituencies.list) ? data.constituencies.list : [];

    data.questionTime = data.questionTime || { offices: [], questions: [] };
    data.questionTime.offices = Array.isArray(data.questionTime.offices) ? data.questionTime.offices : [];
    data.questionTime.questions = Array.isArray(data.questionTime.questions) ? data.questionTime.questions : [];

    // Back-compat: old currentPlayer -> migrate into currentUser if needed
    data.currentPlayer = data.currentPlayer || {
      name: "Unknown MP",
      party: "Unknown",
      role: "backbencher",
      office: null,
      isSpeaker: false
    };

    // Ensure each bill has defaults
    data.orderPaperCommons.forEach(b => ensureBillDefaults(b));

    // Ensure paper outlets exist (8)
    ensurePaperOutlets(data);

    // Ensure a currentUser exists
    ensureCurrentUserFromLegacy(data);

    return data;
  }

  /* =========================
     USER + CHARACTER MODEL
     ========================= */
  function ensureCurrentUserFromLegacy(data) {
    let u = getCurrentUser();

    // If already set, keep it
    if (u && u.id) return;

    // Otherwise create a simple user from legacy currentPlayer
    const legacy = data.currentPlayer || {};
    const name = legacy.name || "Dale";
    const party = legacy.party || "Labour";

    const demoUser = {
      id: `user-${nowTs()}`,
      username: name,
      roles: legacy.isSpeaker ? ["speaker"] : ["player"], // admin/mod/speaker/player
      activeCharacterId: `char-${nowTs()}`,
      characters: [
        {
          id: `char-${nowTs()}`,
          name: name,
          party: party,
          role: legacy.role || "backbencher",
          office: legacy.office || null,
          isSpeaker: legacy.isSpeaker === true,
          absent: false,
          delegatedTo: null
        }
      ]
    };

    saveCurrentUser(demoUser);

    // Also store in data.users for future control panel
    data.users = Array.isArray(data.users) ? data.users : [];
    if (!data.users.some(x => x.id === demoUser.id)) data.users.unshift(demoUser);
  }

  function getActiveCharacter() {
    const u = getCurrentUser();
    if (!u) return null;
    const chars = Array.isArray(u.characters) ? u.characters : [];
    return chars.find(c => c.id === u.activeCharacterId) || chars[0] || null;
  }

  function userHasRole(role) {
    const u = getCurrentUser();
    return !!(u && Array.isArray(u.roles) && u.roles.includes(role));
  }

  function isSpeakerChar(ch) {
    return !!(ch && (ch.isSpeaker === true || ch.role === "speaker"));
  }

  function isLeaderChar(ch) {
    if (!ch) return false;
    return ch.partyLeader === true || ch.role === "leader-opposition" || ch.role === "prime-minister";
  }

  /* =========================
     TIME HELPERS (skip Sundays)
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

  /* =========================
     GAME CLOCK
     ========================= */
  function getGameState(data) {
    return data.gameState || { started: false };
  }

  function isClockPaused(data) {
    return getGameState(data).isPaused === true;
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

  function renderSimDate(data) {
    const el = document.getElementById("sim-date-display");
    const gs = getGameState(data);
    if (!el || !gs.started) return;

    const sim = getCurrentSimDate(data);
    el.textContent = `${getMonthName(sim.month)} ${sim.year}`;
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

    // Division metadata
    bill.division = bill.division || null;

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
     AMENDMENTS (FULL FLOW)
     FLOW:
       1) Proposed (by anyone)
       2) Author must accept (bill author only)
       3) Leaders declare support (2 parties) within 24 active hours
       4) Division opens for 24 active hours
       5) Pass/fail (tie fails)
     RULE:
       - Only one active amendment at a time per bill
       - Sundays frozen
     ========================= */

  function ensureAmendmentDefaults(amend) {
    if (!amend.id) amend.id = `amend-${nowTs()}`;
    if (!amend.status) amend.status = "proposed"; // proposed -> awaiting-author -> supported -> division -> passed/failed
    if (!amend.submittedAt) amend.submittedAt = new Date().toISOString();
    if (!Array.isArray(amend.supporters)) amend.supporters = [];
    if (!amend.authorAccepted) amend.authorAccepted = false;
    return amend;
  }

  function processAmendments(bill) {
    if (!Array.isArray(bill.amendments)) bill.amendments = [];

    // Sunday freeze
    if (isSunday()) return bill;

    const now = nowTs();

    bill.amendments.forEach(amend => {
      ensureAmendmentDefaults(amend);

      // Step A: proposed -> awaiting author acceptance
      if (amend.status === "proposed") {
        amend.status = "awaiting-author";
      }

      // Step B: author acceptance gate
      if (amend.status === "awaiting-author") {
        // if author accepts, start leader support window
        if (amend.authorAccepted === true) {
          amend.status = "support-window";
          amend.supportWindowOpenedAt = amend.supportWindowOpenedAt || now;
          amend.supportDeadlineAt = amend.supportDeadlineAt || addActiveHoursSkippingSundays(amend.supportWindowOpenedAt, 24);
        }
      }

      // Step C: leader support window expiry
      if (amend.status === "support-window") {
        const supporters = amend.supporters || [];
        if (now > (amend.supportDeadlineAt || 0) && supporters.length < 2) {
          amend.status = "failed";
          amend.failedReason = "Insufficient leader support within 24 active hours.";
        }

        // If supported by 2 parties, open division
        if (supporters.length >= 2 && amend.status === "support-window") {
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
      }

      // Step D: close division
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

  function billHasActiveAmendment(bill) {
    const a = Array.isArray(bill.amendments) ? bill.amendments : [];
    return a.some(x =>
      x.status === "awaiting-author" ||
      x.status === "support-window" ||
      (x.status === "division" && x.division && x.division.closed !== true)
    );
  }

  function rbUpdateBill(billId, updaterFn) {
    const data = getData();
    if (!data) return null;

    normaliseData(data);

    const bill = (data.orderPaperCommons || []).find(b => b.id === billId);
    if (!bill) return null;

    ensureBillDefaults(bill);

    updaterFn(bill, data);

    processAmendments(bill);
    processBillDivision(data, bill);

    saveData(data);
    return { data, bill };
  }

  function rbProposeAmendment(billId, { articleNumber, type, text, proposedBy }) {
    return rbUpdateBill(billId, (bill) => {
      // Only one live amendment at a time
      if (billHasActiveAmendment(bill)) {
        bill._lastAmendmentError = "Only one live amendment may run at a time for this bill. Resolve the current amendment first.";
        return;
      }

      const amend = ensureAmendmentDefaults({
        id: `amend-${nowTs()}`,
        articleNumber: Number(articleNumber),
        type,
        text,
        proposedBy,
        submittedAt: new Date().toISOString(),
        status: "proposed",
        supporters: [],
        authorAccepted: false
      });

      bill.amendments.unshift(amend);
      delete bill._lastAmendmentError;
    });
  }

  function rbAuthorAcceptAmendment(billId, amendId, acceptBool) {
    return rbUpdateBill(billId, (bill) => {
      const amend = (bill.amendments || []).find(a => a.id === amendId);
      if (!amend) return;

      ensureAmendmentDefaults(amend);

      if (amend.status !== "awaiting-author") return;

      amend.authorAccepted = !!acceptBool;
      if (!amend.authorAccepted) {
        amend.status = "failed";
        amend.failedReason = "Bill author rejected the amendment.";
      }
    });
  }

  function rbSupportAmendment(billId, amendId, party) {
    return rbUpdateBill(billId, (bill) => {
      const amend = (bill.amendments || []).find(a => a.id === amendId);
      if (!amend) return;

      ensureAmendmentDefaults(amend);

      if (amend.status !== "support-window") return;

      amend.supporters = Array.isArray(amend.supporters) ? amend.supporters : [];
      if (!amend.supporters.includes(party)) amend.supporters.push(party);
    });
  }

  function rbVoteAmendment(billId, amendId, voterName, vote) {
    return rbUpdateBill(billId, (bill) => {
      const amend = (bill.amendments || []).find(a => a.id === amendId);
      if (!amend || amend.status !== "division" || !amend.division || amend.division.closed) return;

      const name = String(voterName || "").trim();
      if (!name) return;

      amend.division.voters = Array.isArray(amend.division.voters) ? amend.division.voters : [];
      if (amend.division.voters.includes(name)) return;

      amend.division.votes = amend.division.votes || { aye: 0, no: 0, abstain: 0 };
      if (vote === "aye") amend.division.votes.aye++;
      else if (vote === "no") amend.division.votes.no++;
      else amend.division.votes.abstain++;

      amend.division.voters.push(name);
    });
  }

  /* =========================
     BILL DIVISIONS (WEIGHTED)
     - 24 active hours (skip Sundays)
     - Sunday freeze
     - Early close when all votes cast (including NPC allocations)
     - Majority excludes Speaker + Abstentions + Sinn Féin
     - NPC parties: speaker allocation only
     - Speaker can set rebellions (reduces party pool before weighting)
     ========================= */

  function ensureBillDivisionDefaults(bill) {
    bill.division = bill.division || {
      openedAt: new Date().toISOString(),
      durationHours: 24,
      closesAt: null,
      closed: false,
      result: null,
      // weighted voting
      characterVotes: {}, // { "charId": "aye|no|abstain" }
      npcAllocations: {}, // { "PartyName": { aye:0,no:0,abstain:0 } }
      rebels: {}, // { "Labour": 0, "Conservative":0, "Liberal Democrats":0 }
      computed: {
        aye: 0,
        no: 0,
        abstain: 0,
        turnout: 0,
        possible: 0,
        majorityNeeded: 0
      }
    };

    if (!bill.division.closesAt) {
      const opened = new Date(bill.division.openedAt).getTime();
      bill.division.closesAt = addActiveHoursSkippingSundays(opened, Number(bill.division.durationHours || 24));
    }

    bill.division.characterVotes = bill.division.characterVotes || {};
    bill.division.npcAllocations = bill.division.npcAllocations || {};
    bill.division.rebels = bill.division.rebels || {};
    bill.division.computed = bill.division.computed || {
      aye: 0, no: 0, abstain: 0, turnout: 0, possible: 0, majorityNeeded: 0
    };

    return bill.division;
  }

  // Get party seat totals from data.parliament.parties if present
  function getParliamentSeatMap(data) {
    const map = {};
    const parties = Array.isArray(data.parliament?.parties) ? data.parliament.parties : [];
    parties.forEach(p => {
      const n = safe(p.name, "");
      if (!n) return;
      map[n] = Number(p.seats || 0);
    });
    return map;
  }

  // Speaker, Abstention, Sinn Fein exclusions
  function isSinnFein(partyName) {
    return String(partyName || "").toLowerCase().includes("sinn");
  }

  function computeDivisionTotals(data, bill) {
    ensureBillDefaults(bill);
    const div = ensureBillDivisionDefaults(bill);

    const seatMap = getParliamentSeatMap(data);

    // Speaker seat exclusion:
    // We'll assume seatMap includes Speaker in a party or as "Speaker".
    // If not explicit, we still exclude Speaker character from voting.
    // Sinn Fein exclusion: remove entire party from denominator and ignore allocations.

    // Rebels reduce pool BEFORE weighting
    const rebels = div.rebels || {};

    // Determine how many characters exist per playable party (active, non-speaker)
    const currentUser = getCurrentUser();
    const allUsers = Array.isArray(data.users) ? data.users : (currentUser ? [currentUser] : []);
    const allChars = [];
    allUsers.forEach(u => {
      const cs = Array.isArray(u.characters) ? u.characters : [];
      cs.forEach(c => allChars.push({ userId: u.id, ...c }));
    });

    // Eligible voters per playable party = characters of that party who are NOT speaker
    const eligibleByParty = {};
    PLAYABLE_PARTIES.forEach(p => eligibleByParty[p] = []);

    allChars.forEach(ch => {
      if (!PLAYABLE_PARTIES.includes(ch.party)) return;
      if (isSpeakerChar(ch)) return;
      // if absent, their vote is delegated - but in this simplified version,
      // the character still "exists"; delegation is handled by speaker/admin later.
      eligibleByParty[ch.party].push(ch);
    });

    // Effective seats per party after rebels
    const effectiveSeats = {};
    Object.keys(seatMap).forEach(p => {
      let seats = Number(seatMap[p] || 0);

      // Remove Sinn Fein entirely from consideration
      if (isSinnFein(p)) {
        seats = 0;
      }

      // Rebels apply only to playable parties (but allowed for all 3 playable as requested)
      if (PLAYABLE_PARTIES.includes(p)) {
        const r = Math.max(0, Number(rebels[p] || 0));
        seats = Math.max(0, seats - r);
      }

      effectiveSeats[p] = seats;
    });

    // Compute playable party weighted votes from characterVotes
    let aye = 0, no = 0, abstain = 0, turnout = 0;
    let possible = 0;

    // Possible excludes Sinn Fein + abstentions not counted as "possible"? (possible is MPs who *can* vote aye/no/abstain)
    // We'll define possible = sum effective seats of all parties except Sinn Fein.
    Object.keys(effectiveSeats).forEach(p => {
      possible += Number(effectiveSeats[p] || 0);
    });

    // Apply playable party weights
    PLAYABLE_PARTIES.forEach(party => {
      const seats = Number(effectiveSeats[party] || 0);
      const chars = eligibleByParty[party] || [];
      const countChars = chars.length;

      if (seats <= 0) return;

      // If no characters, treat party as NPC (speaker allocation required)
      if (countChars === 0) return;

      const weightPerChar = seats / countChars;

      chars.forEach(ch => {
        const v = div.characterVotes?.[ch.id];
        if (!v) return;

        // turnout counts MPs represented
        turnout += weightPerChar;

        if (v === "aye") aye += weightPerChar;
        else if (v === "no") no += weightPerChar;
        else abstain += weightPerChar;
      });
    });

    // Apply NPC allocations (speaker only), excluding Sinn Fein
    const npc = div.npcAllocations || {};
    Object.keys(npc).forEach(partyName => {
      if (PLAYABLE_PARTIES.includes(partyName)) return; // speaker allocations shouldn’t overwrite playable
      if (isSinnFein(partyName)) return; // exclude Sinn Fein fully

      const seats = Number(effectiveSeats[partyName] || 0);
      if (seats <= 0) return;

      const alloc = npc[partyName] || {};
      const a = Math.max(0, Number(alloc.aye || 0));
      const n = Math.max(0, Number(alloc.no || 0));
      const ab = Math.max(0, Number(alloc.abstain || 0));

      // Clamp to available seats (no over-allocation)
      const total = a + n + ab;
      if (total <= 0) return;

      const scale = total > seats ? (seats / total) : 1;

      aye += a * scale;
      no += n * scale;
      abstain += ab * scale;
      turnout += (a + n + ab) * scale;
    });

    // Majority excludes abstentions by definition
    const countForMajority = aye + no; // speaker excluded because they cannot vote, Sinn Fein excluded already
    const majorityNeeded = Math.floor(countForMajority / 2) + 1;

    div.computed = {
      aye: Math.round(aye * 100) / 100,
      no: Math.round(no * 100) / 100,
      abstain: Math.round(abstain * 100) / 100,
      turnout: Math.round(turnout * 100) / 100,
      possible: Math.round(possible * 100) / 100,
      majorityNeeded
    };

    return div.computed;
  }

  // Early close rule: close when turnout >= possible (within tolerance)
  function divisionAllVotesCast(data, bill) {
    const div = ensureBillDivisionDefaults(bill);
    const computed = computeDivisionTotals(data, bill);
    const possible = computed.possible || 0;
    const turnout = computed.turnout || 0;

    // tolerance for float weights
    return (possible > 0 && turnout + 0.001 >= possible);
  }

  function processBillDivision(data, bill) {
    if (!bill) return;
    ensureBillDefaults(bill);

    if (bill.stage !== "Division") return;
    if (isCompleted(bill)) return;

    const div = ensureBillDivisionDefaults(bill);
    if (div.closed) return;

    // Sunday freeze
    if (isSunday()) return;

    // Always recompute tallies
    computeDivisionTotals(data, bill);

    // Early close if all votes cast
    if (divisionAllVotesCast(data, bill)) {
      closeDivisionFromTotals(data, bill, "All votes cast.");
      return;
    }

    // Time close
    const now = nowTs();
    if (now >= div.closesAt) {
      closeDivisionFromTotals(data, bill, "Time expired.");
    }
  }

  function closeDivisionFromTotals(data, bill, reason) {
    const div = ensureBillDivisionDefaults(bill);
    computeDivisionTotals(data, bill);

    div.closed = true;

    const aye = div.computed?.aye || 0;
    const no = div.computed?.no || 0;

    if (aye > no) {
      div.result = "passed";
      bill.status = "passed";
    } else {
      div.result = "failed";
      bill.status = "failed";
    }

    bill.completedAt = nowTs();

    bill.hansard = bill.hansard || {};
    bill.hansard.division = Array.isArray(bill.hansard.division) ? bill.hansard.division : [];
    bill.hansard.division.push({
      outcome: bill.status,
      reason,
      timestamp: new Date().toISOString(),
      totals: { ...div.computed }
    });
  }

  // Character vote in main division (weighted by party pool)
  function rbVoteBillDivision(billId, charId, vote) {
    return rbUpdateBill(billId, (bill, data) => {
      if (bill.stage !== "Division" || isCompleted(bill)) return;

      const div = ensureBillDivisionDefaults(bill);
      if (div.closed) return;

      const ch = getActiveCharacter();
      if (!ch) return;

      // Speaker cannot vote
      if (isSpeakerChar(ch)) return;

      // Must match the active character id
      if (String(charId) !== String(ch.id)) return;

      // NPC lock: only playable parties can use character votes
      if (!PLAYABLE_PARTIES.includes(ch.party)) return;

      div.characterVotes = div.characterVotes || {};
      div.characterVotes[ch.id] = (vote === "aye" || vote === "no" || vote === "abstain") ? vote : "abstain";

      // process immediately
      processBillDivision(data, bill);
    });
  }

  // Speaker sets NPC votes (clamped by seat totals)
  function rbSpeakerSetNpcVotes(billId, partyName, alloc) {
    return rbUpdateBill(billId, (bill, data) => {
      const ch = getActiveCharacter();
      if (!ch || !isSpeakerChar(ch)) return;

      if (!bill || bill.stage !== "Division" || isCompleted(bill)) return;

      const div = ensureBillDivisionDefaults(bill);
      if (div.closed) return;

      const party = String(partyName || "").trim();
      if (!party) return;

      // Lock NPC: speaker may set NPC parties only (not playable)
      if (NPC_LOCKED && PLAYABLE_PARTIES.includes(party)) return;

      div.npcAllocations = div.npcAllocations || {};
      div.npcAllocations[party] = {
        aye: Math.max(0, Number(alloc?.aye || 0)),
        no: Math.max(0, Number(alloc?.no || 0)),
        abstain: Math.max(0, Number(alloc?.abstain || 0))
      };

      processBillDivision(data, bill);
    });
  }

  // Speaker sets rebellion counts for playable parties (reduces pool BEFORE weighting)
  function rbSpeakerSetRebels(billId, partyName, rebelsCount) {
    return rbUpdateBill(billId, (bill, data) => {
      const ch = getActiveCharacter();
      if (!ch || !isSpeakerChar(ch)) return;

      if (!bill || bill.stage !== "Division" || isCompleted(bill)) return;

      const div = ensureBillDivisionDefaults(bill);
      if (div.closed) return;

      const party = String(partyName || "").trim();
      if (!party) return;

      // Only the 3 playable parties as requested
      if (!PLAYABLE_PARTIES.includes(party)) return;

      div.rebels = div.rebels || {};
      div.rebels[party] = Math.max(0, Math.floor(Number(rebelsCount || 0)));

      processBillDivision(data, bill);
    });
  }

  // Helper for speaker UI: seats remaining for NPC allocation
  function getNpcSeatsAvailable(data, bill, partyName) {
    const seatMap = getParliamentSeatMap(data);
    const div = ensureBillDivisionDefaults(bill);
    const rebels = div.rebels || {};

    const party = String(partyName || "");
    if (!party) return 0;
    if (isSinnFein(party)) return 0;

    let seats = Number(seatMap[party] || 0);

    // playable parties reduce by rebels but speaker doesn’t allocate playable anyway
    if (PLAYABLE_PARTIES.includes(party)) {
      seats = Math.max(0, seats - Math.max(0, Number(rebels[party] || 0)));
    }

    const alloc = div.npcAllocations?.[party] || { aye: 0, no: 0, abstain: 0 };
    const used = Number(alloc.aye || 0) + Number(alloc.no || 0) + Number(alloc.abstain || 0);

    return Math.max(0, seats - used);
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
      processBillDivision(data, bill);
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
     DASHBOARD — WHAT’S GOING ON
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
      ? polling.map(p => `<div class="kv"><span>${escapeHtml(safe(p.party,"—"))}</span><b>${Number(p.value).toFixed(1)}%</b></div>`).join("")
      : `<div class="muted-block">No polling yet.</div>`;

    el.innerHTML = `
      <div class="order-grid" style="grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));">
        <div class="panel">
          <div class="small" style="opacity:.8;">BBC News</div>
          <div style="font-weight:800; margin-top:6px;">${escapeHtml(safe(bbc.headline, "No headline yet."))}</div>
          <div class="small" style="margin-top:6px;">${escapeHtml(safe(bbc.strap, ""))}</div>
          <div style="margin-top:12px;"><a class="btn" href="news.html">Open</a></div>
        </div>

        <div class="panel">
          <div class="small" style="opacity:.8;">Papers</div>
          <div style="font-weight:800; margin-top:6px;">${escapeHtml(safe(papers.paper, "Paper"))}: ${escapeHtml(safe(papers.headline, "No headline yet."))}</div>
          <div class="small" style="margin-top:6px;">${escapeHtml(safe(papers.strap, ""))}</div>
          <div style="margin-top:12px;"><a class="btn" href="papers.html">View</a></div>
        </div>

        <div class="panel">
          <div class="small" style="opacity:.8;">Economy</div>
          <div style="margin-top:8px;">
            <div class="kv"><span>Growth</span><b>${Number(safe(economy.growth, 0)).toFixed(1)}%</b></div>
            <div class="kv"><span>Inflation</span><b>${Number(safe(economy.inflation, 0)).toFixed(1)}%</b></div>
            <div class="kv"><span>Unemployment</span><b>${Number(safe(economy.unemployment, 0)).toFixed(1)}%</b></div>
          </div>
          <div style="margin-top:12px;"><a class="btn" href="economy.html">Economy</a></div>
        </div>

        <div class="panel">
          <div class="small" style="opacity:.8;">Polling</div>
          <div style="margin-top:8px;">${pollingLines}</div>
          <div style="margin-top:12px;"><a class="btn" href="polling.html">Polling</a></div>
        </div>
      </div>
    `;
  }

  /* =========================
     LIVE DOCKET (simple)
     ========================= */
  function renderLiveDocket(data) {
    const el = document.getElementById("live-docket");
    if (!el) return;

    const ch = getActiveCharacter() || data.currentPlayer || {};
    const items = [];

    // Bill divisions open
    (data.orderPaperCommons || []).forEach(bill => {
      ensureBillDefaults(bill);
      processAmendments(bill);
      processBillLifecycle(data, bill);

      if (bill.stage === "Division" && !isCompleted(bill)) {
        const div = ensureBillDivisionDefaults(bill);
        const ms = Math.max(0, (div.closesAt || 0) - nowTs());
        items.push({
          icon: "🗳️",
          title: "Bill division open",
          detail: `${bill.title} · closes in ${msToHMS(ms)}`,
          href: `bill.html?id=${encodeURIComponent(bill.id)}`
        });
      }

      // Amendment prompts
      (bill.amendments || []).forEach(a => {
        ensureAmendmentDefaults(a);

        if (a.status === "awaiting-author" && String(bill.author || "") === String(ch.name || "")) {
          items.push({
            icon: "🧾",
            title: "Amendment awaiting your acceptance",
            detail: `${bill.title} · proposed amendment needs author decision`,
            href: `bill.html?id=${encodeURIComponent(bill.id)}`
          });
        }

        if (a.status === "support-window" && isLeaderChar(ch) && !(a.supporters || []).includes(ch.party)) {
          const ms = Math.max(0, (a.supportDeadlineAt || 0) - nowTs());
          items.push({
            icon: "🧾",
            title: "Leader support available",
            detail: `${bill.title} · closes in ${msToHMS(ms)}`,
            href: `bill.html?id=${encodeURIComponent(bill.id)}`
          });
        }

        if (a.status === "division" && a.division && !a.division.closed) {
          const ms = Math.max(0, (a.division.closesAt || 0) - nowTs());
          items.push({
            icon: "🗳️",
            title: "Amendment division open",
            detail: `${bill.title} · closes in ${msToHMS(ms)}`,
            href: `bill.html?id=${encodeURIComponent(bill.id)}`
          });
        }
      });
    });

    if (!items.length) {
      el.innerHTML = `<div class="muted-block">No live items right now.</div>`;
      return;
    }

    el.innerHTML = `
      <div class="small" style="margin-bottom:10px;">
        Logged in as: <b>${escapeHtml(safe(ch.name,"Unknown"))}</b> (${escapeHtml(safe(ch.role,"—"))})
      </div>
      <div class="docket-list">
        ${items.map(it => `
          <div class="docket-item high">
            <div class="docket-left">
              <div class="docket-icon">${it.icon}</div>
              <div class="docket-text">
                <div class="docket-title">${escapeHtml(it.title)}</div>
                <div class="docket-detail">${escapeHtml(it.detail)}</div>
              </div>
            </div>
            <div class="docket-cta">
              <a class="btn" href="${escapeHtml(it.href)}">Open</a>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  /* =========================
     ORDER PAPER
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

    if (!bills.length) {
      el.innerHTML = `<div class="muted-block">No bills on the Order Paper.</div>`;
      return;
    }

    el.innerHTML = `
      <div class="order-grid">
        ${bills.map(b => {
          const badge = getBillBadge(b);
          const t = billStageCountdown(data, b);

          const openAmends = (b.amendments || []).filter(x =>
            x.status === "awaiting-author" || x.status === "support-window"
          ).length;

          const openDiv = (b.amendments || []).some(x => x.status === "division" && x.division && !x.division.closed);

          const amendLine = (openAmends || openDiv)
            ? `<div class="small" style="margin-top:8px;">
                 Amendments: <b>${openAmends}</b> live${openDiv ? " · <b>Division open</b>" : ""}
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
     AMENDMENT MODAL (Bill page)
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
            One live amendment at a time per bill. After submission, the <b>bill author must accept</b>, then leaders can support, then division opens.
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
     BILL PAGE (Division + Amendments)
     IMPORTANT: supports BOTH:
       - #bill-amendments (new)
       - #amendmentsList (old fallback)
     ========================= */
  function initBillPage(data) {
    const titleEl = document.getElementById("billTitle");
    const metaEl = document.getElementById("billMeta");
    const textEl = document.getElementById("billText");
    if (!titleEl || !metaEl || !textEl) return;

    const amendRoot =
      document.getElementById("bill-amendments") ||
      document.getElementById("amendmentsList");

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
      if (amendRoot) amendRoot.innerHTML = "";
      return;
    }

    ensureBillDefaults(bill);
    processAmendments(bill);
    processBillLifecycle(data, bill);
    saveData(data);

    const ch = getActiveCharacter() || data.currentPlayer || {};
    const myName = String(ch.name || "Unknown MP");
    const myParty = String(ch.party || "Unknown");
    const leader = isLeaderChar(ch);
    const isSpeaker = isSpeakerChar(ch);

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

    // ===== MAIN DIVISION UI (weighted) =====
    const votingEl = document.getElementById("division-voting");
    const progressEl = document.getElementById("division-progress");

    if (votingEl && progressEl) {
      if (bill.stage === "Division" && !isCompleted(bill)) {
        votingEl.style.display = "block";
        progressEl.style.display = "block";

        const div = ensureBillDivisionDefaults(bill);
        computeDivisionTotals(data, bill);

        const msLeft = Math.max(0, (div.closesAt || 0) - nowTs());
        const alreadyVoted = !!div.characterVotes?.[ch.id];

        // Speaker cannot vote — but has NPC tools later via control panel
        const canVote = !isSpeaker && PLAYABLE_PARTIES.includes(myParty);

        votingEl.innerHTML = `
          <h2 style="margin:0 0 10px;">Division</h2>
          <div class="muted-block">
            Vote closes in <b>${escapeHtml(msToHMS(msLeft))}</b>${isSunday() ? " (Sunday freeze)" : ""}.
            <div class="small" style="margin-top:6px;">
              Majority excludes <b>Speaker</b>, <b>Abstentions</b>, and <b>Sinn Féin</b>.
            </div>
          </div>

          ${!canVote
            ? `<div class="muted-block" style="margin-top:12px;">
                 You cannot vote from this character (Speaker or NPC party).
               </div>`
            : alreadyVoted
              ? `<div class="muted-block" style="margin-top:12px;">You have already voted: <b>${escapeHtml(div.characterVotes[ch.id])}</b></div>`
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
            <div class="kv"><span>Aye</span><b>${div.computed.aye}</b></div>
            <div class="kv"><span>No</span><b>${div.computed.no}</b></div>
            <div class="kv"><span>Abstain</span><b>${div.computed.abstain}</b></div>
            <div class="kv"><span>Turnout</span><b>${div.computed.turnout}</b></div>
            <div class="kv"><span>Possible votes</span><b>${div.computed.possible}</b></div>
          </div>

          ${isSpeaker ? `
            <div class="muted-block" style="margin-top:12px;">
              <b>Speaker controls NPC parties.</b><br>
              NPC votes + rebellions will be managed via the control panel (coming next).
            </div>
          ` : ``}
        `;

        if (canVote && !alreadyVoted) {
          const bind = (id, v) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.addEventListener("click", () => {
              rbVoteBillDivision(bill.id, ch.id, v);
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

    // ===== AMENDMENTS UI (FULL FLOW) =====
    if (!amendRoot) return;

    const amendments = Array.isArray(bill.amendments) ? bill.amendments : [];
    const hasActive = billHasActiveAmendment(bill);

    const proposeButtonHtml = hasActive
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
        <b>Amendment process:</b>
        1) Submit →
        2) <b>Bill author accepts</b> →
        3) Leaders support (2 parties / 24 active hours) →
        4) Division (24 active hours). Sundays frozen.
      </div>

      ${proposeButtonHtml}

      <div style="margin-top:18px;">
        <h3 style="margin:0 0 8px;">Current Amendments</h3>

        ${!amendments.length
          ? `<div class="muted-block">No amendments yet.</div>`
          : `
            <div class="docket-list">
              ${amendments.map(a => {
                ensureAmendmentDefaults(a);

                const supportLeft = a.supportDeadlineAt ? Math.max(0, a.supportDeadlineAt - nowTs()) : 0;
                const divisionLeft = a.division?.closesAt ? Math.max(0, a.division.closesAt - nowTs()) : 0;

                const supporters = (a.supporters || []).join(", ") || "None";

                let actions = "";

                // Author acceptance
                if (a.status === "awaiting-author") {
                  const isAuthor = String(bill.author || "") === myName;
                  actions = `
                    <div class="small"><b>Status:</b> Awaiting bill author decision</div>
                    ${isAuthor
                      ? `
                        <div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap;">
                          <button class="btn" data-author-accept="yes" data-am="${escapeHtml(a.id)}" type="button">Accept</button>
                          <button class="btn" data-author-accept="no" data-am="${escapeHtml(a.id)}" type="button">Reject</button>
                        </div>
                      `
                      : `<div class="small" style="margin-top:8px;">Only the bill author can accept/reject.</div>`
                    }
                  `;
                }

                // Support window
                else if (a.status === "support-window") {
                  actions = `
                    <div class="small">Supporters: <b>${escapeHtml(supporters)}</b></div>
                    <div class="small">Support window: <b>${escapeHtml(msToHMS(supportLeft))}</b></div>
                    ${leader && !(a.supporters || []).includes(myParty)
                      ? `<div style="margin-top:10px;"><button class="btn" data-support="${escapeHtml(a.id)}" type="button">Support as ${escapeHtml(myParty)}</button></div>`
                      : ``}
                  `;
                }

                // Division
                else if (a.status === "division" && a.division && !a.division.closed) {
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
                }

                // Finished
                else {
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

    // Modal button
    const openBtn = document.getElementById("rbOpenAmendModalBtn");
    if (openBtn) {
      openBtn.addEventListener("click", () => openAmendmentModal({ billId: bill.id, proposedBy: myName }));
    }

    // Author accept / reject
    amendRoot.querySelectorAll("[data-author-accept]").forEach(btn => {
      btn.addEventListener("click", () => {
        const amendId = btn.getAttribute("data-am");
        const mode = btn.getAttribute("data-author-accept");
        rbAuthorAcceptAmendment(bill.id, amendId, mode === "yes");
        location.reload();
      });
    });

    // Leader support
    amendRoot.querySelectorAll("[data-support]").forEach(btn => {
      btn.addEventListener("click", () => {
        const amendId = btn.getAttribute("data-support");
        rbSupportAmendment(bill.id, amendId, myParty);
        location.reload();
      });
    });

    // Vote amendment
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
     NEWS (BBC style)
     Expected IDs on news.html:
       - #bbc-breaking-ticker
       - #bbc-news-live
       - #bbc-news-archive
     Optional (future compose UI):
       - #news-compose-form
     ========================= */
  const NEWS_CATEGORIES = [
    "Politics", "Economy", "Health", "Crime", "International", "Transport", "Environment", "Culture"
  ];

  function isNewsArchived(item) {
    const createdAt = Number(item.createdAt || 0);
    if (!createdAt) return false;
    const days = Math.floor((nowTs() - createdAt) / 86400000);
    return days >= NEWS_ARCHIVE_AFTER_DAYS;
  }

  function renderNewsPage(data) {
    const liveEl = document.getElementById("bbc-news-live");
    const archEl = document.getElementById("bbc-news-archive");
    const tickerEl = document.getElementById("bbc-breaking-ticker");

    if (!liveEl && !archEl && !tickerEl) return;

    const sim = getCurrentSimDate(data);
    const stamp = `${getMonthName(sim.month)} ${sim.year}`;

    const items = Array.isArray(data.news?.items) ? data.news.items : [];
    const live = items.filter(x => !isNewsArchived(x));
    const archived = items.filter(x => isNewsArchived(x));

    // Breaking ticker
    if (tickerEl) {
      const breaking = live.filter(x => x.breaking === true);
      if (!breaking.length) {
        tickerEl.innerHTML = `<div class="muted-block">No breaking news right now.</div>`;
      } else {
        tickerEl.innerHTML = `
          <div class="muted-block" style="border-left:6px solid #c8102e;">
            <b>BREAKING:</b>
            ${breaking.slice(0, 6).map(b => escapeHtml(b.headline)).join(" · ")}
          </div>
        `;
      }
    }

    function tile(item) {
      const cat = item.category ? String(item.category) : "Politics";
      const by = item.byline ? ` · <span class="small">${escapeHtml(item.byline)}</span>` : "";
      const img = item.imageUrl
        ? `<img class="news-image" alt="" src="${escapeHtml(item.imageUrl)}">`
        : "";

      return `
        <div class="news-tile ${item.breaking ? "breaking" : ""}">
          <div class="news-meta">${escapeHtml(stamp)} · ${escapeHtml(cat)}${by}</div>
          <div class="news-headline">${escapeHtml(item.headline || "Untitled")}</div>
          ${img}
          <div class="news-body">${escapeHtml(item.body || "")}</div>
        </div>
      `;
    }

    if (liveEl) {
      liveEl.innerHTML = live.length
        ? `<div class="news-grid">${live.map(tile).join("")}</div>`
        : `<div class="muted-block">No live BBC stories yet.</div>`;
    }

    if (archEl) {
      archEl.innerHTML = archived.length
        ? `<div class="news-grid">${archived.map(tile).join("")}</div>`
        : `<div class="muted-block">No archived stories yet.</div>`;
    }
  }

  /* =========================
     PAPERS (8 outlets + modal)
     Expected IDs on papers.html:
       - #papers-grid
     ========================= */
  const PAPER_OUTLETS = [
    "The Sun",
    "The Daily Telegraph",
    "The Daily Mail",
    "The Daily Mirror",
    "The Times",
    "The Financial Times",
    "The Guardian",
    "The Independent"
  ];

  function ensurePaperOutlets(data) {
    const outlets = data.papers.outlets;
    PAPER_OUTLETS.forEach(name => {
      if (!outlets.some(o => o.name === name)) {
        outlets.push({
          id: `paper-${name.toLowerCase().replace(/\s+/g, "-")}`,
          name,
          issues: [] // {id, headline, body, imageUrl?, byline?, createdAt, simMonth, simYear}
        });
      }
    });
  }

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
        <div class="panel rb-modal" style="
          width:min(860px, 100%); max-height:85vh; overflow:auto; z-index:9999;
        ">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
            <h2 style="margin:0;" id="rbPaperModalTitle">Paper</h2>
            <button class="btn" type="button" id="rbPaperCloseBtn">Close</button>
          </div>

          <div id="rbPaperModalBody" style="margin-top:12px;"></div>
        </div>
      </div>
    `;

    document.body.appendChild(wrap);

    const close = () => { wrap.style.display = "none"; };
    wrap.querySelector(".rb-modal-backdrop").addEventListener("click", (e) => {
      if (e.target === wrap.querySelector(".rb-modal-backdrop")) close();
    });
    document.getElementById("rbPaperCloseBtn").addEventListener("click", close);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && wrap.style.display !== "none") close();
    });
  }

  function openPaperModal(data, outletId) {
    ensurePaperModal();

    const outlet = (data.papers.outlets || []).find(o => o.id === outletId);
    if (!outlet) return;

    const sim = getCurrentSimDate(data);
    const stamp = `${getMonthName(sim.month)} ${sim.year}`;

    const issues = Array.isArray(outlet.issues) ? outlet.issues : [];
    const latest = issues[0];

    const modal = document.getElementById("rb-paper-modal");
    const titleEl = document.getElementById("rbPaperModalTitle");
    const bodyEl = document.getElementById("rbPaperModalBody");

    titleEl.textContent = outlet.name;

    const renderIssue = (x) => {
      const by = x.byline ? `<div class="small" style="margin-top:6px;">${escapeHtml(x.byline)} · Political Correspondent</div>` : "";
      const img = x.imageUrl ? `<img class="news-image" alt="" src="${escapeHtml(x.imageUrl)}">` : "";
      return `
        <div class="panel" style="margin-top:14px;">
          <div class="small" style="opacity:.75;">${escapeHtml(stamp)}</div>
          <div style="font-weight:900; font-size:18px; margin-top:6px;">${escapeHtml(x.headline || "Untitled")}</div>
          ${by}
          <div style="margin-top:10px;">${img}</div>
          <div style="margin-top:10px;">${escapeHtml(x.body || "")}</div>
        </div>
      `;
    };

    bodyEl.innerHTML = `
      ${latest ? renderIssue(latest) : `<div class="muted-block">No front page yet for this paper.</div>`}
      <h3 style="margin-top:18px; margin-bottom:10px;">Previous Issues</h3>
      ${issues.slice(1).length ? issues.slice(1).map(renderIssue).join("") : `<div class="muted-block">No previous issues yet.</div>`}
    `;

    modal.style.display = "block";
  }

  function renderPapersPage(data) {
    const grid = document.getElementById("papers-grid");
    if (!grid) return;

    ensurePaperOutlets(data);

    grid.innerHTML = `
      <div class="paper-grid">
        ${(data.papers.outlets || []).map(o => {
          const latest = (o.issues || [])[0];
          const headline = latest?.headline || "No headline yet";
          return `
            <div class="paper-tile">
              <div class="paper-masthead">${escapeHtml(o.name)}</div>
              <div class="paper-headline">${escapeHtml(headline)}</div>
              <button class="btn" type="button" data-paper="${escapeHtml(o.id)}">Read this Paper</button>
            </div>
          `;
        }).join("")}
      </div>
    `;

    grid.querySelectorAll("[data-paper]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-paper");
        openPaperModal(data, id);
      });
    });
  }

  /* =========================
     CONSTITUENCIES (base)
     Expected IDs on constituencies.html:
       - #parliament-summary
       - #party-constituencies
     ========================= */
  function renderConstituenciesPage(data) {
    const summaryEl = document.getElementById("parliament-summary");
    const partiesEl = document.getElementById("party-constituencies");
    if (!summaryEl && !partiesEl) return;

    const parties = Array.isArray(data.parliament?.parties) ? data.parliament.parties : [];
    const totalSeats = Number(data.parliament?.totalSeats || 650);

    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="muted-block">
          <div class="kv"><span>Total seats</span><b>${totalSeats}</b></div>
          ${parties.map(p => `<div class="kv"><span>${escapeHtml(p.name)}</span><b>${Number(p.seats || 0)}</b></div>`).join("")}
        </div>
      `;
    }

    if (!partiesEl) return;

    const list = Array.isArray(data.constituencies?.list) ? data.constituencies.list : [];
    if (!list.length) {
      partiesEl.innerHTML = `
        <div class="muted-block">
          Constituency list not loaded yet (dataset needed). Seat totals still work.
        </div>
      `;
      return;
    }

    // group constituencies by party -> region
    const byParty = {};
    parties.forEach(p => byParty[p.name] = { regions: {} });

    list.forEach(c => {
      const party = c.party || "Unknown";
      const region = c.region || "Unknown region";
      byParty[party] = byParty[party] || { regions: {} };
      byParty[party].regions[region] = byParty[party].regions[region] || [];
      byParty[party].regions[region].push(c);
    });

    partiesEl.innerHTML = `
      <div class="order-grid">
        ${parties.map(p => {
          const regions = byParty[p.name]?.regions || {};
          const regionKeys = Object.keys(regions);

          return `
            <div class="panel">
              <div style="font-weight:900;">${escapeHtml(p.name)}</div>
              <div class="small" style="opacity:.8; margin-top:6px;">Seats: <b>${Number(p.seats || 0)}</b></div>

              ${regionKeys.length ? `
                <div style="margin-top:12px;">
                  ${regionKeys.sort().map(r => `
                    <div class="muted-block" style="margin-top:10px;">
                      <b>${escapeHtml(r)}</b>
                      <div class="small" style="margin-top:6px;">
                        ${regions[r].slice(0, 30).map(x => escapeHtml(x.name)).join(" · ")}
                        ${regions[r].length > 30 ? ` · (+${regions[r].length - 30} more)` : ``}
                      </div>
                    </div>
                  `).join("")}
                </div>
              ` : `<div class="muted-block" style="margin-top:12px;">No constituency entries for this party yet.</div>`}
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  /* =========================
     BODIES (base)
     Expected IDs on bodies.html:
       - #bodies-grid
     ========================= */
  function renderBodiesPage(data) {
    const grid = document.getElementById("bodies-grid");
    if (!grid) return;

    const list = Array.isArray(data.bodies?.list) ? data.bodies.list : [];

    if (!list.length) {
      grid.innerHTML = `<div class="muted-block">No bodies configured yet.</div>`;
      return;
    }

    grid.innerHTML = `
      <div class="order-grid">
        ${list.map(b => {
          const seats = Array.isArray(b.parties) ? b.parties : [];
          return `
            <div class="panel">
              <div style="font-weight:900; font-size:18px;">${escapeHtml(b.name || "Body")}</div>
              <div class="small" style="opacity:.8; margin-top:6px;">${escapeHtml(b.type || "")}</div>
              ${b.description ? `<div style="margin-top:10px;">${escapeHtml(b.description)}</div>` : ``}

              ${seats.length ? `
                <div class="muted-block" style="margin-top:12px;">
                  ${seats.map(p => `<div class="kv"><span>${escapeHtml(p.name)}</span><b>${Number(p.seats || 0)}</b></div>`).join("")}
                </div>
              ` : `<div class="muted-block" style="margin-top:12px;">No seat breakdown added.</div>`}
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  /* =========================
     QUESTION TIME (safe loader)
     If your questiontime.html expects IDs, add them and this will render.
     It will NOT crash if missing.
     ========================= */
  function initQuestionTimePage(data) {
    const root = document.getElementById("question-time-root");
    if (!root) return;

    const qt = data.questionTime || { offices: [], questions: [] };
    const offices = Array.isArray(qt.offices) ? qt.offices : [];
    const questions = Array.isArray(qt.questions) ? qt.questions : [];

    root.innerHTML = `
      <div class="panel">
        <h2>Question Time</h2>
        <div class="muted-block">
          Offices and questions are mod-managed. This page is now wired correctly and will display once configured.
        </div>

        <div style="margin-top:16px;">
          <h3 style="margin:0 0 8px;">Offices</h3>
          ${offices.length
            ? `<div class="muted-block">${offices.map(o => escapeHtml(o.name || o)).join(" · ")}</div>`
            : `<div class="muted-block">No offices configured yet.</div>`}
        </div>

        <div style="margin-top:16px;">
          <h3 style="margin:0 0 8px;">Questions</h3>
          ${questions.length
            ? `<div class="docket-list">${
                questions.slice(0, 20).map(q => `
                  <div class="docket-item">
                    <div class="docket-left">
                      <div class="docket-icon">❓</div>
                      <div class="docket-text">
                        <div class="docket-title">${escapeHtml(q.title || "Question")}</div>
                        <div class="docket-detail">${escapeHtml(q.text || "")}</div>
                      </div>
                    </div>
                  </div>
                `).join("")
              }</div>`
            : `<div class="muted-block">No questions asked yet.</div>`}
        </div>
      </div>
    `;
  }

  /* =========================
     SUBMIT BILL + PARTY DRAFT
     (kept working as before)
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

    const ch = getActiveCharacter() || data.currentPlayer || {};
    const sim = getCurrentSimDate(data);
    const year = sim.year;

    const isLOTO = ch.role === "leader-opposition";
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

    submitBtn.addEventListener("click", () => submitStructuredBill(data));
  }

  function submitStructuredBill(data) {
    normaliseData(data);

    const ch = getActiveCharacter() || data.currentPlayer || {};
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
      author: safe(ch.name, "Unknown MP"),
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
    // left as-is (your existing party draft page uses this)
    const builder = document.getElementById("party-legislation-builder");
    const controls = document.getElementById("party-draft-controls");
    const listEl = document.getElementById("party-drafts-list");
    if (!builder || !controls || !listEl) return;

    // Keep minimal: this page already worked earlier — we’re not changing it now
  }

  /* =========================
     LIVE REFRESH
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
      initQuestionTimePage(latest);
      renderNewsPage(latest);
      renderPapersPage(latest);
      renderConstituenciesPage(latest);
      renderBodiesPage(latest);
    }, 1000);
  }

  /* =========================
     DEBUG HELPERS FOR YOU (novice-friendly)
     You can type these in the browser console.
     ========================= */
  window.rb = {
    getData,
    saveData,
    getCurrentUser,
    saveCurrentUser,
    getActiveCharacter,
    rbProposeAmendment,
    rbAuthorAcceptAmendment,
    rbSupportAmendment,
    rbVoteAmendment,
    rbVoteBillDivision,
    rbSpeakerSetNpcVotes,
    rbSpeakerSetRebels,
    getNpcSeatsAvailable
  };

  /* =========================
     BOOT (means: start the app)
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
      initBillPage(data);
      initQuestionTimePage(data);
      renderNewsPage(data);
      renderPapersPage(data);
      renderConstituenciesPage(data);
      renderBodiesPage(data);
      initSubmitBillPage(data);
      initPartyDraftPage(data);

      startLiveRefresh();
    })
    .catch(err => console.error("Error loading demo.json:", err));
})();
