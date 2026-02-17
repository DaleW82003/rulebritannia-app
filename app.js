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
// Playable parties (only these parties may vote as players)
const PLAYABLE_PARTIES = ["Labour", "Conservative", "Liberal Democrat"];

// Parties excluded from voting/majority entirely (Sinn Féin don't take seats)
function isSinnFeinParty(partyName){
  return String(partyName || "").toLowerCase().includes("sinn");
}

function isPlayableParty(partyName){
  return PLAYABLE_PARTIES.includes(String(partyName || ""));
}

function isSpeakerPlayer(playerObj){
  return playerObj?.isSpeaker === true;
}

// Look up a player record by name
function findPlayerByName(data, name){
  const n = String(name || "").trim();
  if (!n) return null;
  return (Array.isArray(data.players) ? data.players : []).find(p => p.name === n) || null;
}

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
function getActiveSimId() {
  return localStorage.getItem(LS_ACTIVE_SIM) || "sim-default";
}

function setActiveSimId(simId) {
  localStorage.setItem(LS_ACTIVE_SIM, simId);
}

function getData() {
  const simId = getActiveSimId();
  const raw = localStorage.getItem(simDataKey(simId));
  return raw ? JSON.parse(raw) : null;
}

function saveData(data) {
  const simId = getActiveSimId();
  localStorage.setItem(simDataKey(simId), JSON.stringify(data));
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
// ===== NEW: users + currentUser + characters =====
data.users = Array.isArray(data.users) ? data.users : [];
data.characters = Array.isArray(data.characters) ? data.characters : [];
data.auditLog = Array.isArray(data.auditLog) ? data.auditLog : [];

data.currentUser = data.currentUser || null;

// Back-compat: if you still have currentPlayer, convert into currentUser+character if needed
if (!data.currentUser && data.currentPlayer) {
  const uId = `user-${Date.now()}`;
  const cId = `char-${Date.now()}`;

  data.users.unshift({
    id: uId,
    username: data.currentPlayer.name || "Admin",
    role: "admin" // safest default while migrating
  });

  data.characters.unshift({
    id: cId,
    ownerUserId: uId,
    name: data.currentPlayer.name || "Admin MP",
    party: data.currentPlayer.party || "Unknown",
    role: data.currentPlayer.role || "backbencher",
    office: data.currentPlayer.office || null,
    isSpeaker: !!data.currentPlayer.isSpeaker,
    partyLeader: !!data.currentPlayer.partyLeader,
    active: true
  });

  data.currentUser = { id: uId, username: "Admin", role: "admin", activeCharacterId: cId };
}

// Ensure currentUser exists (first-time installs)
if (!data.currentUser) {
  const uId = `user-${Date.now()}`;
  data.users.unshift({ id: uId, username: "Admin", role: "admin" });
  data.currentUser = { id: uId, username: "Admin", role: "admin", activeCharacterId: null };
}

// Speaker controls store (NPC votes / rebellions / overrides)
data.speakerControls = data.speakerControls || {
  npcVoteAllocations: {},     // billId -> { partyVotes: {party: {aye,no,abstain}}, rebels: {party: number}}
  divisionOverrides: {},      // billId -> { forcedResult: "passed"|"failed"|null }
  notes: ""
};

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
   VOTE WEIGHT + EXCLUSIONS
   - Speaker never votes
   - Sinn Féin never votes
   - Supports your weighting system:
     * player.voteWeight (if you set it)
     * absence delegation: absent votes transfer to delegatedTo
     * if absent + not leader and no delegatedTo set, defaults to party leader
   ========================= */

function normParty(p) {
  return String(p || "").trim().toLowerCase();
}

function isSinnFeinParty(party) {
  return normParty(party) === "sinn féin" || normParty(party) === "sinn fein";
}

function isSpeakerPlayer(player) {
  if (!player) return false;
  if (player.isSpeaker === true) return true;
  return String(player.role || "").toLowerCase() === "speaker";
}

// Find party leader name for a party (if present)
function getPartyLeaderName(data, party) {
  const players = Array.isArray(data.players) ? data.players : [];
  const leader = players.find(p => normParty(p.party) === normParty(party) && p.partyLeader === true);
  return leader ? leader.name : null;
}

/**
 * Returns the weight a *named voter* should cast RIGHT NOW,
 * including delegated weights from absent players.
 *
 * Rules:
 * - Speaker => 0
 * - Sinn Féin => 0
 * - If player has voteWeight (number), we use it; otherwise default 1
 * - If player is absent, they do NOT vote directly; their weight transfers:
 *    - to player.delegatedTo if set
 *    - else, if they are not leader: to party leader (if exists)
 */
function getEffectiveVoteWeight(data, voterName) {
  const players = Array.isArray(data.players) ? data.players : [];
  const voter = players.find(p => String(p.name) === String(voterName));
  if (!voter) return 0;

  // hard exclusions
  if (isSpeakerPlayer(voter)) return 0;
  if (isSinnFeinParty(voter.party)) return 0;

  // base weight for each player (default 1)
  const baseWeight = (p) => {
    const w = Number(p.voteWeight);
    return Number.isFinite(w) && w > 0 ? w : 1;
  };

  // If voter themselves are absent, they cast nothing directly
  if (voter.absent === true) return 0;

  // Start with voter's own base weight
  let total = baseWeight(voter);

  // Add any weights delegated TO this voterName
  for (const p of players) {
    if (!p || p.absent !== true) continue;

    // excluded people don't contribute votes at all
    if (isSpeakerPlayer(p)) continue;
    if (isSinnFeinParty(p.party)) continue;

    // who receives their vote?
    let delegate = p.delegatedTo || null;

    // if no delegate set and they are not leader, default to party leader
    if (!delegate && p.party && p.partyLeader !== true) {
      delegate = getPartyLeaderName(data, p.party);
    }

    if (String(delegate) === String(voterName)) {
      total += baseWeight(p);
    }
  }

  return total;
}

/**
 * For Parliament summary / majorities:
 * count "voting seats" excluding:
 * - Sinn Féin constituencies
 * - Speaker seat (we treat any constituency with party === "Speaker" as speaker-held)
 *
 * If you later model Speaker differently, we can adjust this in one place.
 */
function getVotingSeatCount(data) {
  const seats = Array.isArray(data.constituencies) ? data.constituencies : [];
  return seats.filter(c => {
    const p = normParty(c.party);
    if (p === "speaker") return false;
    if (p === "sinn féin" || p === "sinn fein") return false;
    return true;
  }).length;
}
/**
 * Total effective voting weight currently in the House
 * Excludes:
 * - Speaker
 * - Sinn Féin
 * - Absent MPs with no valid delegate
 */
function getTotalEligibleVoteWeight(data) {
  const players = Array.isArray(data.players) ? data.players : [];
  let total = 0;

  for (const p of players) {
    if (!p) continue;

    if (isSpeakerPlayer(p)) continue;
    if (isSinnFeinParty(p.party)) continue;

    const weight = Number.isFinite(Number(p.voteWeight)) && Number(p.voteWeight) > 0
      ? Number(p.voteWeight)
      : 1;

    // if present, they vote directly
    if (p.absent !== true) {
      total += weight;
      continue;
    }

    // if absent, check delegation
    let delegate = p.delegatedTo || null;

    if (!delegate && p.partyLeader !== true) {
      delegate = getPartyLeaderName(data, p.party);
    }

    if (delegate) {
      total += weight;
    }
    // if no delegate → vote not counted
  }
const division = data.orderPaperCommons.find(b => b.stage === "Division")?.divisionControl;
const rebels = division?.rebellions?.[p.party] || 0;
let adjustedWeight = weight;

if (rebels > 0) {
  adjustedWeight = Math.max(0, weight - rebels);
}

  return total;
}
function rbSetNpcVotes(billId, partyName, aye, no, abstain){
  const data = getData();
  if (!data) return;

  normaliseData(data);

  const bill = (data.orderPaperCommons || []).find(b => b.id === billId);
  if (!bill) return;

  ensureBillDefaults(bill);
  ensureBillDivisionDefaults(bill);

  const limit = getNpcVoteLimit(data, partyName);

  const totalRequested =
    Number(aye || 0) +
    Number(no || 0) +
    Number(abstain || 0);

  if (totalRequested > limit){
    alert(`Cannot allocate ${totalRequested} votes. ${partyName} only has ${limit} seats.`);
    return;
  }

  bill.divisionControl = bill.divisionControl || {};
  bill.divisionControl.npcVotes = bill.divisionControl.npcVotes || {};

  bill.divisionControl.npcVotes[partyName] = {
    aye: Number(aye || 0),
    no: Number(no || 0),
    abstain: Number(abstain || 0)
  };

  saveData(data);
  location.reload();
}
const limit = getNpcVoteLimit(data, partyName);
// =========================
// Vote pool + weighting engine
// =========================
function getRebelCount(bill, partyName){
  const n = Number(bill?.divisionControl?.rebels?.[partyName] || 0);
  return Math.max(0, Math.floor(n));
}

function getNpcVoteLimit(data, bill, partyName){
  // Sinn Féin never votes
  if (isSinnFeinParty(partyName)) return 0;

  // NPC parties = any non-playable party (plus playable if no characters exist)
  const seats = getPartySeatTotal(data, partyName);
  if (seats <= 0) return 0;

  // Rebels are only for playable parties (but if you set it for others, still subtract)
  const rebels = getRebelCount(bill, partyName);

  // Speaker seat should NOT count towards majorities or "all votes cast"
  // (so we remove 1 seat from the Speaker's own party)
  let speakerSeat = 0;
  const spParty = getSpeakerParty(data);
  if (spParty && spParty === partyName) speakerSeat = 1;

  return Math.max(0, seats - rebels - speakerSeat);
}

function getPlayableCharacters(data, partyName){
  const players = Array.isArray(data.players) ? data.players : [];
  return players.filter(p =>
    p &&
    p.active !== false &&
    p.isSpeaker !== true &&
    String(p.party || "") === String(partyName || "")
  );
}

function getVoteWeightsForParty(data, bill, partyName){
  const chars = getPlayableCharacters(data, partyName);
  const available = getNpcVoteLimit(data, bill, partyName); // same “pool” rule
  if (!chars.length || available <= 0) return { weights: {}, available, chars: [] };

  const n = chars.length;
  const base = Math.floor(available / n);
  const remainder = available % n;

  // assign remainder to party leader if found, else first alphabetically
  let leader = chars.find(p => p.partyLeader === true) || chars[0];
  if (!leader) leader = chars[0];

  const weights = {};
  chars.forEach(p => { weights[p.name] = base; });
  weights[leader.name] = (weights[leader.name] || 0) + remainder;

  // Absence delegation (simple): if absent, their weight transfers to delegatedTo
  chars.forEach(p => {
    if (p.absent === true && p.delegatedTo) {
      const w = weights[p.name] || 0;
      if (w > 0) {
        weights[p.name] = 0;
        weights[p.delegatedTo] = (weights[p.delegatedTo] || 0) + w;
      }
    }
  });

  return { weights, available, chars };
}

function getNpcAllocatedTotals(bill, partyName){
  const row = bill?.divisionControl?.npcVotes?.[partyName];
  const aye = Number(row?.aye || 0);
  const no = Number(row?.no || 0);
  const abstain = Number(row?.abstain || 0);
  return {
    aye: Math.max(0, Math.floor(aye)),
    no: Math.max(0, Math.floor(no)),
    abstain: Math.max(0, Math.floor(abstain)),
    total: Math.max(0, Math.floor(aye)) + Math.max(0, Math.floor(no)) + Math.max(0, Math.floor(abstain))
  };
}

function getAllPartiesInParliament(data){
  return (data.parliament?.parties || []).map(p => p.name).filter(Boolean);
}

function getEligibleVoteTotal(data, bill){
  // total eligible votes across all parties (after Sinn Féin + Speaker seat + rebels removed)
  const parties = getAllPartiesInParliament(data);
  return parties.reduce((sum, partyName) => sum + getNpcVoteLimit(data, bill, partyName), 0);
}

function getPlayerCastTotal(bill){
  const voters = Array.isArray(bill?.division?.voters) ? bill.division.voters : [];
  return voters.reduce((sum, v) => sum + Number(v.weight || 0), 0);
}

function getNpcCastTotal(data, bill){
  const parties = getAllPartiesInParliament(data);
  return parties.reduce((sum, partyName) => sum + getNpcAllocatedTotals(bill, partyName).total, 0);
}

function getCombinedDivisionTotals(data, bill){
  // player tallies
  const div = bill.division || { votes:{aye:0,no:0,abstain:0} };

  // npc tallies
  const parties = getAllPartiesInParliament(data);
  let npcAye = 0, npcNo = 0, npcAbstain = 0;

  parties.forEach(partyName => {
    const t = getNpcAllocatedTotals(bill, partyName);
    const row = bill.divisionControl?.npcVotes?.[partyName] || {};
    npcAye += Number(row.aye || 0);
    npcNo += Number(row.no || 0);
    npcAbstain += Number(row.abstain || 0);
  });

  return {
    aye: (div.votes?.aye || 0) + npcAye,
    no: (div.votes?.no || 0) + npcNo,
    abstain: (div.votes?.abstain || 0) + npcAbstain
  };
}

function closeDivisionNow(data, bill, reason){
  const div = ensureBillDivisionDefaults(bill);
  if (div.closed) return;

  div.closed = true;
  div.closedReason = reason || "Closed";

  const totals = getCombinedDivisionTotals(data, bill);
  const aye = totals.aye || 0;
  const no = totals.no || 0;

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

  /* =========================
     MAIN BILL DIVISION ENGINE
     ========================= */
function ensureBillDivisionDefaults(bill){
  bill.division = bill.division || {
    openedAt: new Date().toISOString(),
    durationHours: 24,
    closesAt: null,

    // tallies are STILL stored here, but now they can be weighted
    votes: { aye: 0, no: 0, abstain: 0 },

    // voters now stored as objects (for weights)
    voters: [], // [{ name, vote, weight, party }]

    closed: false,
    result: null,
    closedReason: null
  };

  if (!bill.division.openedAt) bill.division.openedAt = new Date().toISOString();
  if (!bill.division.closesAt) {
    const opened = new Date(bill.division.openedAt).getTime();
    bill.division.closesAt = addActiveHoursSkippingSundays(opened, Number(bill.division.durationHours || 24));
  }

  bill.division.votes = bill.division.votes || { aye:0, no:0, abstain:0 };
  bill.division.voters = Array.isArray(bill.division.voters) ? bill.division.voters : [];
  if (typeof bill.division.closed !== "boolean") bill.division.closed = false;

  // Speaker control area for NPC votes + rebels
  bill.divisionControl = bill.divisionControl || {
    npcVotes: {},   // partyName -> { aye, no, abstain }
    rebels: {}      // partyName -> number
  };

  bill.divisionControl.npcVotes = bill.divisionControl.npcVotes || {};
  bill.divisionControl.rebels = bill.divisionControl.rebels || {};

  return bill.division;
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
function getNpcTotalsFromBill(bill){
const npcParties = (data.parliament?.parties || [])
  .map(p => p.name)
  .filter(name => name && !isPlayableParty(name) && !isSinnFeinParty(name));

const partiesToControl = npcParties.length ? npcParties : ["SNP","Plaid Cymru","DUP","UUP","SDLP","Green","Others"];


  Object.values(npc).forEach(row => {
    aye += Number(row?.aye || 0);
    no += Number(row?.no || 0);
    abstain += Number(row?.abstain || 0);
  });

  return { aye, no, abstain };
}

function getCombinedDivisionTotals(bill){
  const pv = bill?.division?.votes || { aye:0, no:0, abstain:0 };
  const nv = getNpcTotalsFromBill(bill);

  return {
    aye: (pv.aye || 0) + nv.aye,
    no: (pv.no || 0) + nv.no,
    abstain: (pv.abstain || 0) + nv.abstain
  };
}

function processBillDivision(data, bill){
  if (!bill) return;
  ensureBillDefaults(bill);

  if (bill.stage !== "Division") return;
  if (isCompleted(bill)) return;

  const div = ensureBillDivisionDefaults(bill);
  if (div.closed) return;

  // EARLY CLOSE: if all eligible votes have been cast, close immediately (even on Sunday)
  const eligible = getEligibleVoteTotal(data, bill);
  const cast = getPlayerCastTotal(bill) + getNpcCastTotal(data, bill);
  if (eligible > 0 && cast >= eligible) {
    closeDivisionNow(data, bill, "All eligible votes cast");
    return;
  }

  // Sunday freeze for deadline-based auto close
  if (isSunday()) return;

  const now = nowTs();
  if (now >= div.closesAt) {
    closeDivisionNow(data, bill, "Time expired");
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

  // one vote per name
  if ((div.voters || []).some(v => v.name === name)) return null;

  // find player's party (so we can apply correct weighting)
  const players = Array.isArray(data.players) ? data.players : [];
  const me = players.find(p => p.name === name) || data.currentPlayer || {};
  const party = String(me.party || "");

  // Speaker cannot vote
  if (me.isSpeaker === true) return null;

  // Sinn Féin characters (if you ever allow them) should also be blocked from voting
  if (isSinnFeinParty(party)) return null;

  // Weighting:
  // - playable parties use distributed weights
  // - non-playable parties are NPC-only (Speaker allocates), so block here
  let weight = 0;

  if (isPlayableParty(party)) {
    const w = getVoteWeightsForParty(data, bill, party).weights;
    weight = Number(w[name] || 0);
  } else {
    // NPC parties locked to Speaker control
    return null;
  }

  // If weight is 0 (e.g. delegated away), do nothing
  if (weight <= 0) return null;

  // apply weighted vote to the tally
  if (vote === "aye") div.votes.aye += weight;
  else if (vote === "no") div.votes.no += weight;
  else div.votes.abstain += weight;

  div.voters.push({ name, party, vote, weight });

  // After casting: check early-close logic
  processBillDivision(data, bill);

  saveData(data);
  return { data, bill };
}
function rbSetNpcVotes(billId, partyName, aye, no, abstain){
  const data = getData();
  if (!data) return null;

  normaliseData(data);

  // Speaker-only
  if (!(data.currentPlayer?.isSpeaker === true)) return null;

  const bill = (data.orderPaperCommons || []).find(b => b.id === billId);
  if (!bill) return null;

  ensureBillDefaults(bill);
  ensureBillDivisionDefaults(bill);

  const party = String(partyName || "");
  if (!party) return null;

  // NPC parties ONLY (non playable)
  if (isPlayableParty(party)) return null;
  if (isSinnFeinParty(party)) return null;

  const limit = getNpcVoteLimit(data, bill, party);

  const a = Math.max(0, Math.floor(Number(aye || 0)));
  const n = Math.max(0, Math.floor(Number(no || 0)));
  const ab = Math.max(0, Math.floor(Number(abstain || 0)));
  const totalRequested = a + n + ab;

  if (totalRequested > limit) {
    alert(`Cannot allocate ${totalRequested}. ${party} only has ${limit} votes available.`);
    return null;
  }

  bill.divisionControl.npcVotes[party] = { aye: a, no: n, abstain: ab };

  processBillDivision(data, bill);

  saveData(data);
  return { data, bill };
}

function rbSetRebels(billId, partyName, rebelCount){
  const data = getData();
  if (!data) return null;

  normaliseData(data);

  // Speaker-only
  if (!(data.currentPlayer?.isSpeaker === true)) return null;

  const bill = (data.orderPaperCommons || []).find(b => b.id === billId);
  if (!bill) return null;

  ensureBillDefaults(bill);
  ensureBillDivisionDefaults(bill);

  const party = String(partyName || "");
  if (!party) return null;
  if (!isPlayableParty(party)) return null; // rebels only for playable parties

  const seats = getPartySeatTotal(data, party);
  const spParty = getSpeakerParty(data);
  const speakerSeat = (spParty === party) ? 1 : 0;

  const maxRebels = Math.max(0, seats - speakerSeat);

  let r = Math.max(0, Math.floor(Number(rebelCount || 0)));
  if (r > maxRebels) r = maxRebels;

  bill.divisionControl.rebels[party] = r;

  // NOTE: changing rebels changes weights; do NOT auto-change past votes.
  // This is fine as long as Speaker sets rebels BEFORE voting starts.
  // If needed later, we can add "rebels locked once first vote is cast".

  processBillDivision(data, bill);

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
processBillDivision(data, bill);


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
  return rbUpdateBill(billId, (bill, data) => {
    const amend = (bill.amendments || []).find(a => a.id === amendId);
    if (!amend || amend.status !== "division" || !amend.division || amend.division.closed) return;

    const name = String(voterName || "").trim();
    if (!name) return;

    amend.division.voters = Array.isArray(amend.division.voters) ? amend.division.voters : [];
    if (amend.division.voters.includes(name)) return;

    const weight = getEffectiveVoteWeight(data, name);
    if (!weight || weight <= 0) return;

    amend.division.votes = amend.division.votes || { aye:0, no:0, abstain:0 };

    if (vote === "aye") amend.division.votes.aye += weight;
    else if (vote === "no") amend.division.votes.no += weight;
    else amend.division.votes.abstain += weight;

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
// =========================
// Parties + voting rules
// =========================
const PLAYABLE_PARTIES = ["Labour", "Conservative", "Liberal Democrat"];

function isPlayableParty(partyName){
  return PLAYABLE_PARTIES.includes(String(partyName || ""));
}

function isSinnFeinParty(partyName){
  const p = String(partyName || "").toLowerCase();
  return p.includes("sinn") && p.includes("féin") || p.includes("fein");
}

function getPartySeatTotal(data, partyName){
  const parties = data.parliament?.parties || [];
  const row = parties.find(p => p.name === partyName);
  return row ? Number(row.seats || 0) : 0;
}

function getSpeakerPlayer(data){
  const players = Array.isArray(data.players) ? data.players : [];
  return players.find(p => p.isSpeaker === true) || null;
}

function getSpeakerParty(data){
  const sp = getSpeakerPlayer(data);
  return sp?.party ? String(sp.party) : null;
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
         const myWeight = getEffectiveVoteWeight(data, voterName);


        ensureBillDivisionDefaults(bill);
        const div = bill.division;
        const msLeft = Math.max(0, (div.closesAt || 0) - nowTs());
        const alreadyVoted = (div.voters || []).includes(voterName);

        votingEl.innerHTML = `
          <h2 style="margin:0 0 10px;">Division</h2>
          <div class="muted-block">
            Vote closes in <b>${escapeHtml(msToHMS(msLeft))}</b>${isSunday() ? " (Sunday freeze)" : ""}.
          </div>

   ${
  myWeight <= 0
    ? `<div class="muted-block" style="margin-top:12px;">
         You cannot vote in this division (Speaker, Sinn Féin, or you are marked Absent).
       </div>`
    : alreadyVoted
      ? `<div class="muted-block" style="margin-top:12px;">You have already voted in this division.</div>`
      : `
        <div class="muted-block" style="margin-top:12px;">
          Your vote weight: <b>${myWeight}</b>
        </div>
        <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn" id="billVoteAye" type="button">Aye</button>
          <button class="btn" id="billVoteNo" type="button">No</button>
          <button class="btn" id="billVoteAbstain" type="button">Abstain</button>
        </div>
      `
}

        `;

const totals = getCombinedDivisionTotals(bill);
const aye = totals.aye;
const no = totals.no;
const abstain = div.votes?.abstain || 0;

const votingTotal = aye + no;
const majorityNeeded = Math.floor(votingTotal / 2) + 1;
const majoritySecured = aye >= majorityNeeded;

const totalEligible = getTotalEligibleVoteWeight(data);
const totalCast = aye + no + abstain;
const votesRemaining = Math.max(0, totalEligible - totalCast);

const eligible = getEligibleVoteTotal(data, bill);
const playerCast = getPlayerCastTotal(bill);
const npcCast = getNpcCastTotal(data, bill);
const totalCast = playerCast + npcCast;

const totals = getCombinedDivisionTotals(data, bill);

// Majority excludes Speaker + Sinn Féin automatically via eligible pool;
// abstentions excluded from majority by using aye vs no
const majorityNeeded = Math.floor((eligible - (totals.abstain || 0)) / 2) + 1; // informational only

// Speaker panel: show remaining NPC pools
const isSpeakerUser = (data.currentPlayer?.isSpeaker === true);

let npcPanelHtml = "";
if (isSpeakerUser) {
  const parties = getAllPartiesInParliament(data).filter(p => !isPlayableParty(p) && !isSinnFeinParty(p));

  npcPanelHtml = `
    <div class="panel" style="margin-top:12px;">
      <h3 style="margin:0 0 8px;">Speaker Controls</h3>

      <div class="muted-block">
        <b>NPC Votes:</b> You can allocate votes for all non-playable parties, up to their total seats (minus Speaker seat if relevant).
      </div>

      ${parties.length ? `
        <div style="margin-top:12px;" class="docket-list">
          ${parties.map(party => {
            const limit = getNpcVoteLimit(data, bill, party);
            const cur = getNpcAllocatedTotals(bill, party);
            const remaining = Math.max(0, limit - cur.total);

            const row = bill.divisionControl?.npcVotes?.[party] || { aye:0, no:0, abstain:0 };

            return `
              <div class="docket-item">
                <div class="docket-left">
                  <div class="docket-icon">🎛️</div>
                  <div class="docket-text">
                    <div class="docket-title">${escapeHtml(party)}</div>
                    <div class="small">Available: <b>${limit}</b> · Allocated: <b>${cur.total}</b> · Remaining: <b>${remaining}</b></div>

                    <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap; align-items:flex-end;">
                      <div>
                        <label class="small">Aye</label>
                        <input type="number" min="0" id="npc_${escapeHtml(party)}_aye" value="${Number(row.aye||0)}" style="width:90px;">
                      </div>
                      <div>
                        <label class="small">No</label>
                        <input type="number" min="0" id="npc_${escapeHtml(party)}_no" value="${Number(row.no||0)}" style="width:90px;">
                      </div>
                      <div>
                        <label class="small">Abstain</label>
                        <input type="number" min="0" id="npc_${escapeHtml(party)}_ab" value="${Number(row.abstain||0)}" style="width:90px;">
                      </div>
                      <button class="btn" type="button" data-save-npc="${escapeHtml(party)}">Save</button>
                    </div>
                  </div>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      ` : `<div class="muted-block" style="margin-top:12px;">No NPC parties in parliament data.</div>`}

      <div class="muted-block" style="margin-top:14px;">
        <b>Rebels:</b> Set rebels for playable parties (reduces the party seat pool before weighting).
      </div>

      <div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end;">
        ${PLAYABLE_PARTIES.map(party => {
          const current = Number(bill.divisionControl?.rebels?.[party] || 0);
          return `
            <div>
              <label class="small">${escapeHtml(party)} rebels</label>
              <input type="number" min="0" id="rebels_${escapeHtml(party)}" value="${current}" style="width:140px;">
              <button class="btn" type="button" data-save-rebels="${escapeHtml(party)}" style="margin-top:6px;">Save</button>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

progressEl.innerHTML = `
  <h2 style="margin:0 0 10px;">Division Progress</h2>

  <div class="muted-block">
    <div class="kv"><span>Aye</span><b>${totals.aye || 0}</b></div>
    <div class="kv"><span>No</span><b>${totals.no || 0}</b></div>
    <div class="kv"><span>Abstain</span><b>${totals.abstain || 0}</b></div>

    <div style="margin-top:10px;" class="kv"><span>Eligible votes</span><b>${eligible}</b></div>
    <div class="kv"><span>Cast votes</span><b>${totalCast}</b></div>
    <div class="kv"><span>Remaining</span><b>${Math.max(0, eligible - totalCast)}</b></div>

    <div class="small" style="margin-top:10px;">
      Majority is based on <b>Aye vs No</b>. Speaker + Sinn Féin excluded. Abstentions don’t count to majority.
    </div>
  </div>

  ${npcPanelHtml}
`;
// Speaker NPC save buttons
if (isSpeakerUser) {
  progressEl.querySelectorAll("[data-save-npc]").forEach(btn => {
    btn.addEventListener("click", () => {
      const party = btn.getAttribute("data-save-npc");
      const aye = document.getElementById(`npc_${party}_aye`)?.value;
      const no = document.getElementById(`npc_${party}_no`)?.value;
      const ab = document.getElementById(`npc_${party}_ab`)?.value;
      rbSetNpcVotes(bill.id, party, aye, no, ab);
    });
  });

  progressEl.querySelectorAll("[data-save-rebels]").forEach(btn => {
    btn.addEventListener("click", () => {
      const party = btn.getAttribute("data-save-rebels");
      const val = document.getElementById(`rebels_${party}`)?.value;
      rbSetRebels(bill.id, party, val);
    });
  });
}




if (!alreadyVoted && myWeight > 0) {
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
  ? `<div class="muted-block" style="margin-top:12px;">You have already voted in this division.</div>`
  : (() => {
      const myPlayer = findPlayerByName(data, voterName);
      const myParty = myPlayer?.party || me.party;

      if (myPlayer?.isSpeaker) {
        return `<div class="muted-block" style="margin-top:12px;">The Speaker does not vote.</div>`;
      }

      if (isSinnFeinParty(myParty)) {
        return `<div class="muted-block" style="margin-top:12px;">Sinn Féin do not take their seats — no vote is cast.</div>`;
      }

      if (!isPlayableParty(myParty)) {
        return `<div class="muted-block" style="margin-top:12px;">
          NPC party voting is controlled by the Speaker. Your character cannot vote.
        </div>`;
      }

      return `
        <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn" id="billVoteAye" type="button">Aye</button>
          <button class="btn" id="billVoteNo" type="button">No</button>
          <button class="btn" id="billVoteAbstain" type="button">Abstain</button>
        </div>
      `;
    })()
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
function renderParliamentSummary(data) {
  const el = document.getElementById("parliament-summary");
  if (!el) return;

  const seats = data.constituencies || [];
  const totals = {};

  seats.forEach(c => {
    totals[c.party] = (totals[c.party] || 0) + 1;
  });

  const totalSeats = seats.length;
  const majorityThreshold = Math.floor(totalSeats / 2) + 1;

  // Determine largest party
  let largestParty = null;
  let largestSeats = 0;

  Object.entries(totals).forEach(([party, count]) => {
    if (count > largestSeats) {
      largestSeats = count;
      largestParty = party;
    }
  });

  const hasMajority = largestSeats >= majorityThreshold;
  const workingMajority = largestSeats - (majorityThreshold - 1);

  el.innerHTML = `
    <div class="wgo-grid">
      ${Object.entries(totals).map(([party, count]) => `
        <div class="wgo-tile">
          <div class="wgo-title">${party}</div>
          <div class="wgo-strap">${count} seats</div>
        </div>
      `).join("")}
    </div>

    <div style="margin-top:18px; padding:12px; border-radius:12px;
                background:${hasMajority ? "rgba(46,139,87,.15)" : "rgba(200,16,46,.15)"};
                border:1px solid ${hasMajority ? "rgba(46,139,87,.35)" : "rgba(200,16,46,.35)"};">
      <div><b>Total Seats:</b> ${totalSeats}</div>
      <div><b>Majority Threshold:</b> ${majorityThreshold}</div>
      <div><b>Largest Party:</b> ${largestParty} (${largestSeats})</div>
      <div style="margin-top:6px;">
        ${
          hasMajority
            ? `<b>Government Majority:</b> ${workingMajority}`
            : `<b>Hung Parliament</b>`
        }
      </div>
    </div>
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
function getUsers(){
  return JSON.parse(localStorage.getItem(LS_USERS) || "[]");
}
function saveUsers(list){
  localStorage.setItem(LS_USERS, JSON.stringify(list));
}
function getCurrentUser(){
  return JSON.parse(localStorage.getItem(LS_CURRENT_USER) || "null");
}
function setCurrentUser(userId){
  localStorage.setItem(LS_CURRENT_USER, JSON.stringify({ userId }));
}
function getSims(){
  return JSON.parse(localStorage.getItem(LS_SIMS) || "[]");
}
function saveSims(list){
  localStorage.setItem(LS_SIMS, JSON.stringify(list));
}

function ensureUserAndSimBase(demo){
  // Sims list
  let sims = getSims();
  if (!sims.length) {
    sims = [{ id:"sim-default", name:"United Kingdom — 1997", createdAt: nowTs() }];
    saveSims(sims);
  }

  // Active sim
  const active = getActiveSimId();
  const exists = sims.some(s => s.id === active);
  if (!exists) setActiveSimId(sims[0].id);

  // Users (ensure an admin exists)
  let users = getUsers();
  if (!users.length) {
    users = [{
      id: "user-admin",
      username: "Admin",
      role: "admin", // admin | mod | speaker | player
      activeCharacterId: null,
      characters: []
    }];
    saveUsers(users);
    setCurrentUser("user-admin");
  }

  // Sim data: migrate old rb_full_data into sim-default if present
  const simId = getActiveSimId();
  const key = simDataKey(simId);

  if (!localStorage.getItem(key)) {
    // if your old storage existed, try to pull it once
    const old = localStorage.getItem("rb_full_data");
    if (old) {
      localStorage.setItem(key, old);
      // optional: leave old in place so nothing breaks if other pages still reference it
    } else {
      localStorage.setItem(key, JSON.stringify(demo));
    }
  }
}

function getMyUser(){
  const cu = getCurrentUser();
  const users = getUsers();
  if (!cu?.userId) return null;
  return users.find(u => u.id === cu.userId) || null;
}

function canPostNews(user){
  if (!user) return false;
  return user.role === "admin" || user.role === "mod";
}
function ensureNewsDefaults(data){
  data.news = data.news || {};
  data.news.stories = Array.isArray(data.news.stories) ? data.news.stories : [];
  return data;
}

function renderNewsPage(data){
  const mainEl = document.getElementById("bbcMainNews");
  const flavEl = document.getElementById("bbcFlavourNews");
  const archEl = document.getElementById("bbcArchive");
  const simDateEl = document.getElementById("bbcSimDate");
  const breakPanel = document.getElementById("bbcBreakingPanel");
  const tickerEl = document.getElementById("bbcBreakingTicker");
  const newBtn = document.getElementById("bbcNewStoryBtn");

  if (!mainEl || !flavEl || !archEl) return;

  ensureNewsDefaults(data);

  // Sim date line
  const sim = getCurrentSimDate(data);
  if (simDateEl) simDateEl.textContent = `${getMonthName(sim.month)} ${sim.year}`;

  const meUser = getMyUser();
  if (newBtn) newBtn.style.display = canPostNews(meUser) ? "inline-flex" : "none";

  const TWO_WEEKS_MS = 14 * 86400000;
  const now = nowTs();

  const stories = data.news.stories
    .slice()
    .sort((a,b) => (b.createdAt||0) - (a.createdAt||0));

  const live = stories.filter(s => (now - (s.createdAt||0)) < TWO_WEEKS_MS);
  const archive = stories.filter(s => (now - (s.createdAt||0)) >= TWO_WEEKS_MS);

  const breaking = live.filter(s => s.isBreaking === true);
  if (breakPanel && tickerEl) {
    if (!breaking.length) {
      breakPanel.style.display = "none";
    } else {
      breakPanel.style.display = "block";
      const line = breaking.map(s => s.headline).join(" • ");
      tickerEl.innerHTML = `<div class="ticker-line">${escapeHtml(line)}</div>`;
    }
  }

  const renderTile = (s) => {
    const kickerParts = [];
    kickerParts.push(`<span class="news-category">${escapeHtml(s.category || "General")}</span>`);
    if (s.isBreaking) kickerParts.push(`<span class="news-breaking-pill">BREAKING</span>`);
    kickerParts.push(`<span>${escapeHtml(s.simMonthName || "")} ${escapeHtml(String(s.simYear || ""))}</span>`);

    const img = s.photoUrl ? `<img class="news-photo" src="${escapeHtml(s.photoUrl)}" alt="">` : ``;

    return `
      <div class="news-tile">
        ${img}
        <div class="news-body">
          <div class="news-kicker">${kickerParts.join(" ")}</div>
          <div class="news-headline">${escapeHtml(s.headline || "Untitled")}</div>
          <div class="news-text">${escapeHtml(s.body || "")}</div>
          <div class="news-meta">
            Posted by: <b>${escapeHtml(s.postedBy || "BBC Newsroom")}</b>
          </div>
        </div>
      </div>
    `;
  };

  const mainLive = live.filter(s => s.kind !== "flavour");
  const flavLive = live.filter(s => s.kind === "flavour");

  mainEl.innerHTML = mainLive.length
    ? `<div class="news-grid">${mainLive.map(renderTile).join("")}</div>`
    : `<div class="muted-block">No main stories yet.</div>`;

  flavEl.innerHTML = flavLive.length
    ? `<div class="news-grid">${flavLive.map(renderTile).join("")}</div>`
    : `<div class="muted-block">No flavour stories yet.</div>`;

  archEl.innerHTML = archive.length
    ? `<div class="news-grid">${archive.map(renderTile).join("")}</div>`
    : `<div class="muted-block">Nothing in the archive yet.</div>`;

  if (newBtn) {
    newBtn.onclick = () => openNewsPostModal(data);
  }
}

function ensureNewsModal(){
  if (document.getElementById("rb-news-modal")) return;

  const wrap = document.createElement("div");
  wrap.id = "rb-news-modal";
  wrap.style.display = "none";
  wrap.innerHTML = `
    <div class="rb-modal-backdrop" style="
      position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:9998;
      display:flex; align-items:center; justify-content:center; padding:18px;">
      <div class="panel rb-modal" style="width:min(760px,100%); max-height:85vh; overflow:auto; z-index:9999;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
          <h2 style="margin:0;">Post BBC Story</h2>
          <button class="btn" type="button" id="rbNewsClose">Close</button>
        </div>

        <div class="muted-block" style="margin-top:12px;">
          Mods/Admins can post. Date auto-fills from the simulation clock.
        </div>

        <form id="rbNewsForm" style="margin-top:12px;">
          <div class="form-grid">
            <label>Headline</label>
            <input id="rbNewsHeadline" placeholder="Headline…" />

            <label>Category</label>
            <select id="rbNewsCategory">
              <option>Politics</option>
              <option>Parliament</option>
              <option>Economy</option>
              <option>Justice</option>
              <option>Health</option>
              <option>Transport</option>
              <option>Security</option>
              <option>International</option>
              <option>Local</option>
              <option>General</option>
            </select>

            <label>Photo URL (optional)</label>
            <input id="rbNewsPhoto" placeholder="https://…" />

            <label>Story text</label>
            <textarea id="rbNewsBody" rows="8" placeholder="Article text…"></textarea>

            <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:center;">
              <label style="display:flex; gap:8px; align-items:center;">
                <input type="checkbox" id="rbNewsBreaking" />
                <b>Breaking News</b>
              </label>

              <label style="display:flex; gap:8px; align-items:center;">
                <input type="checkbox" id="rbNewsFlavour" />
                <b>Flavour (smaller story)</b>
              </label>
            </div>

            <div style="display:flex; justify-content:flex-end; gap:10px; flex-wrap:wrap;">
              <button class="btn" type="button" id="rbNewsCancel">Cancel</button>
              <button class="btn" type="submit">Publish</button>
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
  document.getElementById("rbNewsClose").addEventListener("click", close);
  document.getElementById("rbNewsCancel").addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && wrap.style.display !== "none") close();
  });
}

function openNewsPostModal(data){
  const meUser = getMyUser();
  if (!canPostNews(meUser)) return alert("Only Admins/Mods can post BBC stories.");

  ensureNewsModal();
  const modal = document.getElementById("rb-news-modal");
  modal.style.display = "block";

  document.getElementById("rbNewsHeadline").value = "";
  document.getElementById("rbNewsCategory").value = "Politics";
  document.getElementById("rbNewsPhoto").value = "";
  document.getElementById("rbNewsBody").value = "";
  document.getElementById("rbNewsBreaking").checked = false;
  document.getElementById("rbNewsFlavour").checked = false;

  const form = document.getElementById("rbNewsForm");
  form.onsubmit = (e) => {
    e.preventDefault();

    const headline = (document.getElementById("rbNewsHeadline").value || "").trim();
    const category = document.getElementById("rbNewsCategory").value || "General";
    const photoUrl = (document.getElementById("rbNewsPhoto").value || "").trim();
    const body = (document.getElementById("rbNewsBody").value || "").trim();
    const isBreaking = document.getElementById("rbNewsBreaking").checked;
    const isFlavour = document.getElementById("rbNewsFlavour").checked;

    if (!headline) return alert("Headline is required.");
    if (!body) return alert("Story text is required.");

    const sim = getCurrentSimDate(data);

    ensureNewsDefaults(data);

    data.news.stories.unshift({
      id: `news-${nowTs()}`,
      headline,
      body,
      category,
      photoUrl: photoUrl || null,
      isBreaking,
      kind: isFlavour ? "flavour" : "main",
      createdAt: nowTs(),
      simMonth: sim.month,
      simYear: sim.year,
      simMonthName: getMonthName(sim.month),
      postedBy: meUser.username || "BBC Newsroom"
    });

    saveData(data);
    modal.style.display = "none";
    location.reload();
  };
}
function renderControlPanel(data){
  const loginEl = document.getElementById("rbLoginBlock");
  const simEl = document.getElementById("rbSimBlock");
  const charEl = document.getElementById("rbCharBlock");
  const roleEl = document.getElementById("rbRolePanels");
  const simDateEl = document.getElementById("rbCpSimDate");

  if (!loginEl || !simEl || !charEl || !roleEl) return;

  const sims = getSims();
  const activeSimId = getActiveSimId();
  const me = getMyUser();
  const sim = getCurrentSimDate(data);

  if (simDateEl) simDateEl.textContent = `${getMonthName(sim.month)} ${sim.year}`;

  // LOGIN
  const users = getUsers();
  loginEl.innerHTML = `
    <div class="kv"><span>Logged in as</span><b>${escapeHtml(me?.username || "None")}</b></div>
    <div class="kv"><span>Role</span><b>${escapeHtml(me?.role || "—")}</b></div>

    <div style="margin-top:12px;">
      <label><b>Switch user:</b></label>
      <select id="rbUserSelect">
        ${users.map(u => `<option value="${escapeHtml(u.id)}" ${me?.id===u.id?"selected":""}>${escapeHtml(u.username)} (${escapeHtml(u.role)})</option>`).join("")}
      </select>
      <div style="margin-top:10px;">
        <button class="btn" type="button" id="rbSwitchUserBtn">Switch</button>
      </div>
    </div>

    <div style="margin-top:14px;">
      <label><b>Create new user:</b></label>
      <input id="rbNewUsername" placeholder="Username…" />
      <select id="rbNewRole">
        <option value="player">player</option>
        <option value="speaker">speaker</option>
        <option value="mod">mod</option>
        <option value="admin">admin</option>
      </select>
      <div style="margin-top:10px;">
        <button class="btn" type="button" id="rbCreateUserBtn">Create</button>
      </div>
      <div class="small">Note: this is local-only for now (localStorage). Later we can move it to a real database.</div>
    </div>
  `;

  document.getElementById("rbSwitchUserBtn").onclick = () => {
    const id = document.getElementById("rbUserSelect").value;
    setCurrentUser(id);
    location.reload();
  };

  document.getElementById("rbCreateUserBtn").onclick = () => {
    const uname = (document.getElementById("rbNewUsername").value || "").trim();
    const role = document.getElementById("rbNewRole").value || "player";
    if (!uname) return alert("Username required.");

    const list = getUsers();
    if (list.some(u => u.username.toLowerCase() === uname.toLowerCase())) {
      return alert("That username already exists.");
    }

    const nu = { id:`user-${nowTs()}`, username: uname, role, activeCharacterId:null, characters:[] };
    list.unshift(nu);
    saveUsers(list);
    setCurrentUser(nu.id);
    location.reload();
  };

  // SIMULATIONS
  simEl.innerHTML = `
    <div class="kv"><span>Active simulation</span><b>${escapeHtml((sims.find(s=>s.id===activeSimId)?.name) || activeSimId)}</b></div>
    <div style="margin-top:12px;">
      <label><b>Switch simulation:</b></label>
      <select id="rbSimSelect">
        ${sims.map(s => `<option value="${escapeHtml(s.id)}" ${s.id===activeSimId?"selected":""}>${escapeHtml(s.name)}</option>`).join("")}
      </select>
      <div style="margin-top:10px;">
        <button class="btn" type="button" id="rbSwitchSimBtn">Switch Simulation</button>
      </div>
    </div>

    <div style="margin-top:14px;">
      <label><b>Create new simulation:</b></label>
      <input id="rbNewSimName" placeholder="e.g. United Kingdom — 1999" />
      <div style="margin-top:10px;">
        <button class="btn" type="button" id="rbCreateSimBtn">Create Simulation</button>
      </div>
    </div>
  `;

  document.getElementById("rbSwitchSimBtn").onclick = () => {
    const sid = document.getElementById("rbSimSelect").value;
    setActiveSimId(sid);
    location.reload();
  };

  document.getElementById("rbCreateSimBtn").onclick = () => {
    const name = (document.getElementById("rbNewSimName").value || "").trim();
    if (!name) return alert("Simulation name required.");

    const list = getSims();
    const simId = `sim-${nowTs()}`;
    list.unshift({ id: simId, name, createdAt: nowTs() });
    saveSims(list);

    // clone current sim data as a starting point
    const currentSimData = getData();
    localStorage.setItem(simDataKey(simId), JSON.stringify(currentSimData || {}));

    setActiveSimId(simId);
    location.reload();
  };

  // CHARACTER (simple starter)
  const chars = Array.isArray(data.characters) ? data.characters : [];
  const myChar = me?.activeCharacterId ? chars.find(c => c.id === me.activeCharacterId) : null;

  charEl.innerHTML = `
    <div class="kv"><span>Active character</span><b>${escapeHtml(myChar?.name || "None")}</b></div>

    <div style="margin-top:12px;">
      <label><b>Select character:</b></label>
      <select id="rbCharSelect">
        <option value="">-- None --</option>
        ${chars.map(c => `<option value="${escapeHtml(c.id)}" ${me?.activeCharacterId===c.id?"selected":""}>${escapeHtml(c.name)} (${escapeHtml(c.party || "—")})</option>`).join("")}
      </select>
      <div style="margin-top:10px;">
        <button class="btn" type="button" id="rbSetCharBtn">Set Active Character</button>
      </div>
    </div>

    <div style="margin-top:14px;">
      <label><b>Create character:</b></label>
      <input id="rbCharName" placeholder="Character name…" />
      <input id="rbCharParty" placeholder="Party…" />
      <div style="margin-top:10px;">
        <button class="btn" type="button" id="rbCreateCharBtn">Create</button>
      </div>
      <div class="small">Later we’ll add seat, role, offices, etc.</div>
    </div>
  `;

  document.getElementById("rbSetCharBtn").onclick = () => {
    const id = document.getElementById("rbCharSelect").value || null;
    const users2 = getUsers();
    const idx = users2.findIndex(u => u.id === me.id);
    if (idx === -1) return;

    users2[idx].activeCharacterId = id;
    saveUsers(users2);

    // ALSO set data.currentPlayer so your existing pages work immediately
    if (id) {
      const ch = chars.find(c => c.id === id);
      if (ch) {
        data.currentPlayer = data.currentPlayer || {};
        data.currentPlayer.name = ch.name;
        data.currentPlayer.party = ch.party || "Unknown";
        data.currentPlayer.role = ch.role || "backbencher";
        saveData(data);
      }
    }

    location.reload();
  };

  document.getElementById("rbCreateCharBtn").onclick = () => {
    const name = (document.getElementById("rbCharName").value || "").trim();
    const party = (document.getElementById("rbCharParty").value || "").trim();
    if (!name) return alert("Character name required.");

    data.characters = Array.isArray(data.characters) ? data.characters : [];
    const id = `char-${nowTs()}`;
    data.characters.unshift({ id, name, party: party || "Independent" });
    saveData(data);

    // auto-set active
    const users2 = getUsers();
    const idx = users2.findIndex(u => u.id === me.id);
    if (idx !== -1) {
      users2[idx].activeCharacterId = id;
      saveUsers(users2);
    }

    // keep compatibility with existing app
    data.currentPlayer = data.currentPlayer || {};
    data.currentPlayer.name = name;
    data.currentPlayer.party = party || "Independent";
    data.currentPlayer.role = "backbencher";
    saveData(data);

    location.reload();
  };

  // ROLE PANELS (scaffold only, but real and expandable)
  let panelHtml = `
    <div class="muted-block">
      <b>Player</b> controls live here (your character, personal tools).
    </div>
  `;

  if (me?.role === "speaker" || me?.role === "admin") {
    panelHtml += `
      <div class="muted-block" style="margin-top:12px;">
        <b>Speaker Panel</b><br>
        Coming next: manage divisions, certify amendments, agenda control.
      </div>
    `;
  }

  if (me?.role === "mod" || me?.role === "admin") {
    panelHtml += `
      <div class="muted-block" style="margin-top:12px;">
        <b>Moderator Panel</b><br>
        Coming next: post BBC news, manage papers, moderate content, set “What’s Going On”.
      </div>
    `;
  }

  if (me?.role === "admin") {
    panelHtml += `
      <div class="muted-block" style="margin-top:12px;">
        <b>Admin Panel</b><br>
        Coming next: manage users/roles, reset simulations, create countries/timelines, global settings.
      </div>
    `;
  }

  roleEl.innerHTML = panelHtml;
}
function ensurePapersDefaults(data){
  data.papers = data.papers || {};
  data.papers.frontPages = data.papers.frontPages || {}; 
  return data;
}

function renderPapersPage(data){
  const gridEl = document.getElementById("papersGrid");
  const readerPanel = document.getElementById("paperReaderPanel");
  const readerEl = document.getElementById("paperReader");
  const simDateEl = document.getElementById("papersSimDate");

  if (!gridEl) return;

  ensurePapersDefaults(data);

  const sim = getCurrentSimDate(data);
  if (simDateEl) simDateEl.textContent = `${getMonthName(sim.month)} ${sim.year}`;

  const papers = [
    { id:"sun", name:"The Sun", cls:"paper-sun" },
    { id:"telegraph", name:"The Daily Telegraph", cls:"paper-telegraph" },
    { id:"mail", name:"The Daily Mail", cls:"paper-mail" },
    { id:"mirror", name:"The Daily Mirror", cls:"paper-mirror" },
    { id:"times", name:"The Times", cls:"paper-times" },
    { id:"ft", name:"The Financial Times", cls:"paper-ft" },
    { id:"guardian", name:"The Guardian", cls:"paper-guardian" },
    { id:"independent", name:"The Independent", cls:"paper-independent" }
  ];

  gridEl.innerHTML = `
    <div class="papers-grid">
      ${papers.map(p => `
        <div class="paper-tile ${p.cls}" data-paper="${p.id}">
          <div class="paper-title">${p.name}</div>
          <div class="paper-read-btn">
            <button class="btn" type="button">Read this Paper</button>
          </div>
        </div>
      `).join("")}
    </div>
  `;

  gridEl.querySelectorAll("[data-paper]").forEach(tile => {
    tile.addEventListener("click", () => {
      const id = tile.getAttribute("data-paper");
      openPaperReader(data, id);
    });
  });

  function openPaperReader(data, paperId){
    const frontPages = data.papers.frontPages[paperId] || [];
    readerPanel.style.display = "block";

    if (!frontPages.length){
      readerEl.innerHTML = `
        <div class="muted-block">
          No front page published yet.
        </div>
      `;
      return;
    }

    const current = frontPages[0];

    readerEl.innerHTML = `
      <div class="paper-front">
        <div class="paper-headline">${escapeHtml(current.headline)}</div>
        <div class="paper-byline">
          ${escapeHtml(current.byline || "Political Correspondent")} · ${escapeHtml(current.simMonthName)} ${escapeHtml(current.simYear)}
        </div>
        ${current.photoUrl ? `<img class="paper-photo" src="${escapeHtml(current.photoUrl)}">` : ``}
        <div class="news-text">${escapeHtml(current.body)}</div>
      </div>

      <div class="paper-archive">
        <h3>Previous Front Pages</h3>
        ${
          frontPages.slice(1).length
            ? frontPages.slice(1).map(fp => `
              <div style="margin-bottom:12px;">
                <b>${escapeHtml(fp.headline)}</b><br>
                <span class="small">${escapeHtml(fp.simMonthName)} ${escapeHtml(fp.simYear)}</span>
              </div>
            `).join("")
            : `<div class="muted-block">No previous editions.</div>`
        }
      </div>
    `;
  }
}
function publishFrontPage(data, paperId, {headline, body, photoUrl, byline}){
  ensurePapersDefaults(data);

  const sim = getCurrentSimDate(data);

  const entry = {
    id: `paper-${nowTs()}`,
    headline,
    body,
    photoUrl: photoUrl || null,
    byline: byline || "Political Correspondent",
    createdAt: nowTs(),
    simMonth: sim.month,
    simYear: sim.year,
    simMonthName: getMonthName(sim.month)
  };

  if (!data.papers.frontPages[paperId])
    data.papers.frontPages[paperId] = [];

  data.papers.frontPages[paperId].unshift(entry);
  saveData(data);
}
function ensureConstituencyData(data) {
  if (Array.isArray(data.constituencies) && data.constituencies.length) return;

  const parties = {
    "Labour": 418,
    "Conservative": 165,
    "Liberal Democrat": 46,
    "SNP": 6,
    "Plaid Cymru": 4,
    "DUP": 2,
    "SDLP": 3,
    "UUP": 10,
    "Sinn Féin": 2,
    "Others": 4
  };

  const regions = [
    "North East","North West","Yorkshire","East Midlands","West Midlands",
    "East of England","South East","South West",
    "Scotland","Wales","Northern Ireland"
  ];

  data.constituencies = [];
  let regionIndex = 0;

  Object.entries(parties).forEach(([party, seats]) => {
    for (let i = 1; i <= seats; i++) {
      const region = regions[regionIndex % regions.length];
      data.constituencies.push({
        name: `${party} Seat ${i}`,
        region,
        party,
        mp: `MP ${i} (${party})`,
        majority: Math.floor(Math.random() * 20000)
      });
      regionIndex++;
    }
  });

  saveData(data);
}
function renderParliamentSummary(data) {
  const el = document.getElementById("parliament-summary");
  if (!el) return;

  const seats = data.constituencies || [];

  const totals = {};
  seats.forEach(c => {
    totals[c.party] = (totals[c.party] || 0) + 1;
  });

  const totalSeats = seats.length;

  el.innerHTML = `
    <div class="wgo-grid">
      ${Object.entries(totals).map(([party, count]) => `
        <div class="wgo-tile">
          <div class="wgo-title">${party}</div>
          <div class="wgo-strap">${count} seats</div>
        </div>
      `).join("")}
    </div>

    <div style="margin-top:14px;">
      <b>Total Seats:</b> ${totalSeats}
    </div>
  `;
}
function renderPartyConstituencies(data) {
  const el = document.getElementById("party-constituencies");
  if (!el) return;

  const seats = data.constituencies || [];

  const grouped = {};
  seats.forEach(c => {
    if (!grouped[c.party]) grouped[c.party] = [];
    grouped[c.party].push(c);
  });

  el.innerHTML = Object.entries(grouped).map(([party, list]) => `
    <div class="bill-card" style="margin-bottom:14px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div class="bill-title">${party}</div>
        <button class="btn" onclick="toggleParty('${party.replace(/'/g,"")}')">
          View Seats (${list.length})
        </button>
      </div>

      <div id="party-${party.replace(/[^a-z0-9]/gi,'')}" style="display:none; margin-top:10px;">
        ${renderConstituencyRegions(list)}
      </div>
    </div>
  `).join("");
}

function renderConstituencyRegions(list) {
  const regions = {};
  list.forEach(c => {
    if (!regions[c.region]) regions[c.region] = [];
    regions[c.region].push(c);
  });

  return Object.entries(regions).map(([region, seats]) => `
    <div style="margin-bottom:10px;">
      <b>${region}</b>
      <ul style="margin-top:6px;">
        ${seats.map(c => `
          <li>${c.name} — ${c.mp} (Maj: ${c.majority})</li>
        `).join("")}
      </ul>
    </div>
  `).join("");
}

window.toggleParty = function(party) {
  const el = document.getElementById("party-" + party.replace(/[^a-z0-9]/gi,''));
  if (!el) return;
  el.style.display = el.style.display === "none" ? "block" : "none";
};
function calculatePartyBreakdown(data, division){
  const players = Array.isArray(data.players) ? data.players : [];
  const result = {};

  players.forEach(p => {
    if (isSpeakerPlayer(p)) return;
    if (isSinnFeinParty(p.party)) return;

    result[p.party] = result[p.party] || { seats:0 };
    result[p.party].seats += Number(p.voteWeight || 1);
  });

  return `
    <div class="muted-block">
      ${Object.entries(result).map(([party, info]) => `
        <div class="kv">
          <span>${escapeHtml(party)}</span>
          <b>${info.seats}</b>
        </div>
      `).join("")}
    </div>
  `;
}
function renderSpeakerDivisionControls(bill, data){

  const progressEl = document.getElementById("division-progress");
  if (!progressEl) return;

  bill.divisionControl = bill.divisionControl || {
    npcVotes: {},
    rebellions: {}
  };

  const playableParties = ["Labour", "Conservative", "Liberal Democrat"];

  progressEl.innerHTML += `
    <div style="margin-top:30px; border-top:1px solid #444; padding-top:20px;">
      <h3>Speaker Controls</h3>
      <div class="muted-block">
        Allocate NPC votes and rebellions manually.
      </div>

      ${renderNPCControls(bill, playableParties)}
      ${renderRebellionControls(bill, playableParties)}

      <div style="margin-top:12px;">
        <button class="btn" onclick="rbSaveDivisionControl('${bill.id}')">
          Save Speaker Changes
        </button>
      </div>
    </div>
  `;
}
function renderNPCControls(bill, parties){
  return `
    <h4>NPC Votes</h4>
    ${parties.map(p => `
      <div class="kv">
        <span>${p}</span>
        Aye <input type="number" min="0" data-npc="${p}-aye" style="width:60px;">
        No <input type="number" min="0" data-npc="${p}-no" style="width:60px;">
        Abstain <input type="number" min="0" data-npc="${p}-abstain" style="width:60px;">
      </div>
    `).join("")}
  `;
}
function renderRebellionControls(bill, parties){
  return `
    <h4 style="margin-top:16px;">Rebellions</h4>
    ${parties.map(p => `
      <div class="kv">
        <span>${p} rebels</span>
        <input type="number" min="0" data-rebel="${p}" style="width:80px;">
      </div>
    `).join("")}
  `;
}
window.rbSaveDivisionControl = function(billId){
  const data = getData();
  if (!data) return;

  const bill = data.orderPaperCommons.find(b => b.id === billId);
  if (!bill) return;

  bill.divisionControl = bill.divisionControl || { npcVotes:{}, rebellions:{} };

  document.querySelectorAll("[data-npc]").forEach(input => {
    const [party, type] = input.getAttribute("data-npc").split("-");
    bill.divisionControl.npcVotes[party] = bill.divisionControl.npcVotes[party] || {};
    bill.divisionControl.npcVotes[party][type] = Number(input.value || 0);
  });

  document.querySelectorAll("[data-rebel]").forEach(input => {
    const party = input.getAttribute("data-rebel");
    bill.divisionControl.rebellions[party] = Number(input.value || 0);
  });

  saveData(data);
  location.reload();
};
function getPartySeatTotal(data, partyName){
  const parties = data.parliament?.parties || [];
  const row = parties.find(p => p.name === partyName);
  return row ? Number(row.seats || 0) : 0;
}
function getNpcVoteLimit(data, partyName){
  if (isSinnFeinParty(partyName)) return 0;
  return getPartySeatTotal(data, partyName);
}
// --- Legislative Bodies ---
data.bodies = Array.isArray(data.bodies) ? data.bodies : [
  {
    id: "commons",
    name: "House of Commons",
    type: "westminster",
    totalSeats: 650,
    parties: [
      { name: "Labour", seats: 418 },
      { name: "Conservative", seats: 165 },
      { name: "Liberal Democrat", seats: 46 },
      { name: "SNP", seats: 6 },
      { name: "Plaid Cymru", seats: 4 },
      { name: "Others", seats: 11 }
    ]
  },
  {
    id: "scotland",
    name: "Scottish Parliament",
    type: "devolved",
    totalSeats: 129,
    parties: []
  },
  {
    id: "wales",
    name: "Senedd Cymru",
    type: "devolved",
    totalSeats: 60,
    parties: []
  },
  {
    id: "ni",
    name: "Northern Ireland Assembly",
    type: "devolved",
    totalSeats: 90,
    parties: []
  },
  {
    id: "europe",
    name: "European Parliament (UK Seats)",
    type: "europe",
    totalSeats: 87,
    parties: []
  }
];

function renderBodiesPage(data) {
  const root = document.getElementById("bodies-root");
  if (!root) return;

  const bodies = data.bodies || [];

  function majorityMark(total) {
    return Math.floor(total / 2) + 1;
  }

  function bodyColour(type) {
    if (type === "westminster") return "#1f3a5f";
    if (type === "devolved") return "#7a1f1f";
    if (type === "europe") return "#003399";
    return "#333";
  }

  function renderSeatBar(body) {
    const total = body.totalSeats;
    if (!body.parties || !body.parties.length) return "";

    return `
      <div style="margin-top:12px;">
        ${body.parties.map(p => {
          const pct = ((p.seats / total) * 100).toFixed(1);
          return `
            <div style="margin-bottom:6px;">
              <div class="kv">
                <span>${escapeHtml(p.name)}</span>
                <b>${p.seats}</b>
              </div>
              <div style="
                height:8px;
                background:#ddd;
                border-radius:4px;
                overflow:hidden;
              ">
                <div style="
                  width:${pct}%;
                  height:100%;
                  background:#444;
                "></div>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  root.innerHTML = `
    <div class="panel">
      <h1 style="margin:0;">Legislative Bodies</h1>
      <div class="muted-block">
        These bodies provide political context only.  
        No voting or character mechanics apply outside Westminster.
      </div>
    </div>

    <div class="order-grid" style="margin-top:16px;">
      ${bodies.map(body => `
        <div class="bill-card">

          <div style="
            background:${bodyColour(body.type)};
            color:white;
            padding:10px;
            font-weight:600;
            margin:-16px -16px 12px -16px;
          ">
            ${escapeHtml(body.name)}
          </div>

          <div class="kv">
            <span>Total Seats</span>
            <b>${body.totalSeats}</b>
          </div>

          <div class="kv">
            <span>Majority Mark</span>
            <b>${majorityMark(body.totalSeats)}</b>
          </div>

          ${renderSeatBar(body)}

        </div>
      `).join("")}
    </div>
  `;
}

function renderControlPanel(data){
  const root = document.getElementById("control-root");
  if (!root) return;

  const user = data.currentUser || {};
  const role = user.role || "player";

  if (role === "player"){
    root.innerHTML = `
      <div class="panel">
        <div class="muted-block">
          You do not have access to the control panel.
        </div>
      </div>
    `;
    return;
  }

  function section(title, content){
    return `
      <div class="panel" style="margin-bottom:16px;">
        <h2 style="margin:0 0 10px;">${title}</h2>
        ${content}
      </div>
    `;
  }

  let output = "";

  /* ================= ADMIN ================= */
  if (role === "admin"){

    output += section("User & Role Management", `
      <div class="muted-block">
        (Future) Create users, assign Admin / Mod / Speaker roles.
      </div>
    `);

    output += section("Game Clock", `
      <button class="btn" id="pauseClockBtn">Pause Clock</button>
      <button class="btn" id="resumeClockBtn">Resume Clock</button>
    `);

    output += section("Bodies Editor", `
      <div id="admin-bodies-editor"></div>
    `);

    output += section("Constituency Reset", `
      <button class="btn" id="resetParliamentBtn">Reset Parliament to 1997</button>
    `);
  }

  /* ================= MOD ================= */
  if (role === "admin" || role === "mod"){

    output += section("News Control", `
      <a class="btn" href="news.html">Manage News</a>
    `);

    output += section("Papers Control", `
      <a class="btn" href="papers.html">Manage Papers</a>
    `);

    output += section("Bodies Control", `
      <a class="btn" href="bodies.html">Manage Bodies</a>
    `);

    output += section("Constituencies Control", `
      <a class="btn" href="constituencies.html">Manage Constituencies</a>
    `);
  }

  /* ================= SPEAKER ================= */
  if (role === "admin" || role === "speaker"){

    output += section("Division Controls", `
      <div class="muted-block">
        Allocate NPC votes, apply rebellions, override division results.
      </div>
      <a class="btn" href="constituencies.html">Manage Votes</a>
    `);
  }

  root.innerHTML = output;

  bindControlPanelActions(data);
}
function bindControlPanelActions(data){

  const pause = document.getElementById("pauseClockBtn");
  const resume = document.getElementById("resumeClockBtn");

  if (pause){
    pause.addEventListener("click", () => {
      data.gameState.isPaused = true;
      saveData(data);
      alert("Game clock paused.");
    });
  }

  if (resume){
    resume.addEventListener("click", () => {
      data.gameState.isPaused = false;
      saveData(data);
      alert("Game clock resumed.");
    });
  }

  const resetBtn = document.getElementById("resetParliamentBtn");
  if (resetBtn){
    resetBtn.addEventListener("click", () => {
      if (!confirm("Reset Parliament to August 1997?")) return;

      localStorage.removeItem("rb_full_data");
      location.reload();
    });
  }
}
function logAudit(data, action, details = {}) {
  const user = data.currentUser || { username: "Unknown", role: "unknown" };
  data.auditLog = Array.isArray(data.auditLog) ? data.auditLog : [];
  data.auditLog.unshift({
    at: new Date().toISOString(),
    by: user.username,
    role: user.role,
    action,
    details
  });
  // keep log sane
  if (data.auditLog.length > 200) data.auditLog.length = 200;
}

function getActiveCharacter(data) {
  const u = data.currentUser;
  if (!u || !u.activeCharacterId) return null;
  return (data.characters || []).find(c => c.id === u.activeCharacterId) || null;
}

// For older code that still reads data.currentPlayer
function syncCurrentPlayerFromCharacter(data) {
  const c = getActiveCharacter(data);
  if (!c) return;

  data.currentPlayer = {
    name: c.name,
    party: c.party,
    role: c.role,
    office: c.office,
    isSpeaker: !!c.isSpeaker,
    partyLeader: !!c.partyLeader
  };
}
function renderControlPanel(data) {
  const root = document.getElementById("control-root");
  if (!root) return;

  const user = data.currentUser || { username: "Unknown", role: "player" };
  const role = user.role || "player";

  // Keep legacy currentPlayer updated for existing pages
  syncCurrentPlayerFromCharacter(data);

  // Helper UI builders
  const section = (title, inner) => `
    <div class="panel" style="margin-bottom:16px;">
      <h2 style="margin:0 0 10px;">${escapeHtml(title)}</h2>
      ${inner}
    </div>
  `;

  const badge = (t) => `<span class="bill-badge badge-pmb" style="margin-left:8px;">${escapeHtml(t)}</span>`;

  if (role === "player") {
    root.innerHTML = `
      <div class="muted-block">
        You are logged in as <b>${escapeHtml(user.username)}</b> (Player).  
        Players do not have access to the Control Panel.
      </div>
    `;
    return;
  }

  // Build the page content
  let html = `
    <div class="muted-block" style="margin-bottom:14px;">
      Logged in as <b>${escapeHtml(user.username)}</b> — Role: <b>${escapeHtml(role.toUpperCase())}</b>
    </div>
  `;

  /* =========================================================
     1) USER MANAGEMENT (Admin)
     ========================================================= */
  if (role === "admin") {
    const users = Array.isArray(data.users) ? data.users : [];
    html += section("1) User Management " + badge("Admin"), `
      <div class="muted-block">Create users, assign roles, and pick their active character. (Local-only for now.)</div>

      <div style="margin-top:12px;" class="form-grid">
        <label>New username</label>
        <input id="cpNewUsername" placeholder="e.g. Dale" />

        <label>Role</label>
        <select id="cpNewRole">
          <option value="player">player</option>
          <option value="mod">mod</option>
          <option value="speaker">speaker</option>
          <option value="admin">admin</option>
        </select>

        <button class="btn" id="cpCreateUserBtn" type="button">Create User</button>
      </div>

      <div style="margin-top:14px;">
        <h3 style="margin:0 0 8px;">Existing Users</h3>
        ${users.length ? `
          <div class="docket-list">
            ${users.map(u => `
              <div class="docket-item">
                <div class="docket-left">
                  <div class="docket-icon">👤</div>
                  <div class="docket-text">
                    <div class="docket-title">${escapeHtml(u.username)} <span class="small">(${escapeHtml(u.role)})</span></div>
                    <div class="small">User ID: ${escapeHtml(u.id)}</div>
                  </div>
                </div>
                <div class="docket-cta">
                  <button class="btn" type="button" data-login-user="${escapeHtml(u.id)}">Log in</button>
                </div>
              </div>
            `).join("")}
          </div>
        ` : `<div class="muted-block">No users created yet.</div>`}
      </div>
    `);
  }

  /* =========================================================
     2) SPEAKER PANEL (NPC votes / rebellions / override)
     ========================================================= */
  if (role === "admin" || role === "speaker") {
    const bills = Array.isArray(data.orderPaperCommons) ? data.orderPaperCommons : [];
    const openDivBills = bills.filter(b => (b.stage === "Division" && b.status === "in-progress"));

    html += section("2) Speaker Panel (NPC Votes / Rebellions / Overrides) " + badge("Speaker"), `
      <div class="muted-block">
        Speaker controls NPC parties (and optional rebellions for Labour/Conservative/Lib Dem), and can force-close or override a division result.
      </div>

      <div style="margin-top:12px;" class="form-grid">
        <label>Pick an open division bill</label>
        <select id="cpSpeakerBillSelect">
          ${openDivBills.length
            ? openDivBills.map(b => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.title)}</option>`).join("")
            : `<option value="">No open divisions</option>`
          }
        </select>

        <button class="btn" id="cpLoadSpeakerBillBtn" type="button">Load</button>
      </div>

      <div id="cpSpeakerBillTools" style="margin-top:14px;"></div>
    `);
  }

  /* =========================================================
     3) MOD PANEL: News
     ========================================================= */
  if (role === "admin" || role === "mod") {
    html += section("3) Manage News " + badge("Mod"), `
      <div class="muted-block">Create BBC-style news tiles, breaking ticker, archives.</div>
      <a class="btn" href="news.html">Open News Editor</a>
    `);

    /* =========================================================
       4) MOD PANEL: Papers
       ========================================================= */
    html += section("4) Manage Papers " + badge("Mod"), `
      <div class="muted-block">Manage front pages + archive for the 8 papers with custom mastheads.</div>
      <a class="btn" href="papers.html">Open Papers Editor</a>
    `);

    /* =========================================================
       5) MOD PANEL: Bodies
       ========================================================= */
    html += section("5) Manage Bodies " + badge("Mod"), `
      <div class="muted-block">Manage Scottish Parliament / Senedd / NI Assembly / European Parliament seat numbers + graphics.</div>
      <a class="btn" href="bodies.html">Open Bodies Editor</a>
    `);

    /* =========================================================
       6) MOD PANEL: Constituencies
       ========================================================= */
    html += section("6) Manage Constituencies + Parliament State " + badge("Mod"), `
      <div class="muted-block">Seat totals, constituency holders, by-elections, defections. (This will drive vote-weighting.)</div>
      <a class="btn" href="constituencies.html">Open Constituencies</a>
    `);
  }

  /* =========================================================
     7) ELECTION ENGINE (Foundation)
     ========================================================= */
  if (role === "admin" || role === "mod") {
    html += section("7) Election Engine (Foundation) " + badge("Mod"), `
      <div class="muted-block">
        Create an election event and apply seat totals. (We will flesh this out into a full engine next.)
      </div>

      <div class="form-grid" style="margin-top:12px;">
        <label>Election Name</label>
        <input id="cpElectionName" placeholder="e.g. 1997 General Election" />

        <label>Notes</label>
        <textarea id="cpElectionNotes" rows="2" placeholder="Optional…"></textarea>

        <button class="btn" id="cpCreateElectionBtn" type="button">Create Election Record</button>
      </div>

      <div id="cpElectionResult" style="margin-top:12px;"></div>
    `);
  }

  /* =========================================================
     8) TIMELINE / MULTI-SIM (Foundation)
     ========================================================= */
  if (role === "admin") {
    html += section("8) Timeline / Multi-Sim (Foundation) " + badge("Admin"), `
      <div class="muted-block">
        This stores which timeline is active. Later this will switch datasets, forums, and character pools.
      </div>

      <div class="form-grid" style="margin-top:12px;">
        <label>Active Timeline Key</label>
        <select id="cpTimelineKey">
          <option value="UK-1997">UK-1997 (Aug 1997)</option>
          <option value="UK-1999">UK-1999</option>
          <option value="UK-2010">UK-2010</option>
          <option value="UK-2024">UK-2024</option>
        </select>

        <button class="btn" id="cpSetTimelineBtn" type="button">Save Timeline</button>
      </div>

      <div class="muted-block" style="margin-top:12px;">
        Current timeline: <b>${escapeHtml(data.simConfig?.timelineKey || "UK-1997")}</b>
      </div>
    `);
  }

  root.innerHTML = html;

  bindControlPanelActions(data);
}
function bindControlPanelActions(data) {
  const user = data.currentUser || { role: "player" };
  const role = user.role || "player";

  /* ===== 1) Create user (Admin) ===== */
  const createBtn = document.getElementById("cpCreateUserBtn");
  if (createBtn && role === "admin") {
    createBtn.addEventListener("click", () => {
      const name = (document.getElementById("cpNewUsername")?.value || "").trim();
      const r = document.getElementById("cpNewRole")?.value || "player";
      if (!name) return alert("Enter a username.");

      const id = `user-${Date.now()}`;
      data.users.unshift({ id, username: name, role: r });
      logAudit(data, "USER_CREATE", { id, username: name, role: r });
      saveData(data);
      location.reload();
    });
  }

  document.querySelectorAll("[data-login-user]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (role !== "admin") return;
      const id = btn.getAttribute("data-login-user");
      const u = (data.users || []).find(x => x.id === id);
      if (!u) return;

      data.currentUser = {
        id: u.id,
        username: u.username,
        role: u.role,
        activeCharacterId: data.currentUser?.activeCharacterId || null
      };

      logAudit(data, "USER_SWITCH", { toUserId: u.id, username: u.username });
      saveData(data);
      alert(`Now logged in as ${u.username} (${u.role}).`);
      location.reload();
    });
  });

  /* ===== 2) Speaker bill tools ===== */
  const loadSpeakerBillBtn = document.getElementById("cpLoadSpeakerBillBtn");
  if (loadSpeakerBillBtn && (role === "admin" || role === "speaker")) {
    loadSpeakerBillBtn.addEventListener("click", () => {
      const billId = document.getElementById("cpSpeakerBillSelect")?.value || "";
      const bill = (data.orderPaperCommons || []).find(b => b.id === billId);
      const wrap = document.getElementById("cpSpeakerBillTools");
      if (!wrap) return;
      if (!bill) return (wrap.innerHTML = `<div class="muted-block">No bill loaded.</div>`);

      // Defaults
      data.speakerControls = data.speakerControls || {};
      data.speakerControls.npcVoteAllocations = data.speakerControls.npcVoteAllocations || {};
      data.speakerControls.divisionOverrides = data.speakerControls.divisionOverrides || {};

      const alloc = data.speakerControls.npcVoteAllocations[billId] || {
        // Speaker allocates NPC party votes here:
        partyVotes: {},
        // Optional rebellions for playable parties:
        rebels: { Labour: 0, Conservative: 0, "Liberal Democrat": 0 }
      };

      const override = data.speakerControls.divisionOverrides[billId] || { forcedResult: "" };

      // Define NPC parties (you can expand later)
      const npcParties = ["SNP", "Plaid Cymru", "DUP", "UUP", "SDLP", "Alliance", "Green", "Sinn Fein", "Others"];

      wrap.innerHTML = `
        <div class="muted-block">
          <b>${escapeHtml(bill.title)}</b><br>
          Speaker can allocate NPC votes and rebellions. NPC parties are locked to Speaker only.
        </div>

        <h3 style="margin-top:12px; margin-bottom:6px;">NPC Party Votes</h3>
        <div class="small">Enter how many NPC MPs vote Aye/No/Abstain. Sinn Fein will not count toward majority.</div>

        <div class="form-grid" style="margin-top:10px;">
          ${npcParties.map(p => {
            const pv = alloc.partyVotes[p] || { aye: 0, no: 0, abstain: 0 };
            return `
              <label>${escapeHtml(p)} — Aye</label>
              <input type="number" min="0" data-npc-party="${escapeHtml(p)}" data-npc-field="aye" value="${pv.aye}" />

              <label>${escapeHtml(p)} — No</label>
              <input type="number" min="0" data-npc-party="${escapeHtml(p)}" data-npc-field="no" value="${pv.no}" />

              <label>${escapeHtml(p)} — Abstain</label>
              <input type="number" min="0" data-npc-party="${escapeHtml(p)}" data-npc-field="abstain" value="${pv.abstain}" />
            `;
          }).join("")}
        </div>

        <h3 style="margin-top:14px; margin-bottom:6px;">Playable Party Rebellions (Optional)</h3>
        <div class="small">Rebels are removed from the party seat pool before weighting.</div>

        <div class="form-grid" style="margin-top:10px;">
          <label>Labour rebels</label>
          <input id="cpRebLab" type="number" min="0" value="${alloc.rebels?.Labour || 0}" />

          <label>Conservative rebels</label>
          <input id="cpRebCon" type="number" min="0" value="${alloc.rebels?.Conservative || 0}" />

          <label>Liberal Democrat rebels</label>
          <input id="cpRebLD" type="number" min="0" value="${alloc.rebels?.["Liberal Democrat"] || 0}" />
        </div>

        <h3 style="margin-top:14px; margin-bottom:6px;">Division Override (Emergency)</h3>
        <div class="form-grid">
          <label>Forced Result</label>
          <select id="cpOverrideResult">
            <option value="" ${!override.forcedResult ? "selected" : ""}>None</option>
            <option value="passed" ${override.forcedResult === "passed" ? "selected" : ""}>Force PASSED</option>
            <option value="failed" ${override.forcedResult === "failed" ? "selected" : ""}>Force FAILED</option>
          </select>
        </div>

        <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn" id="cpSaveSpeakerAllocBtn" type="button">Save Speaker Settings</button>
        </div>
      `;

      const saveBtn = document.getElementById("cpSaveSpeakerAllocBtn");
      if (saveBtn) {
        saveBtn.addEventListener("click", () => {
          // read npc inputs
          const partyVotes = {};
          wrap.querySelectorAll("[data-npc-party]").forEach(inp => {
            const party = inp.getAttribute("data-npc-party");
            const field = inp.getAttribute("data-npc-field");
            const v = Math.max(0, Number(inp.value || 0));
            partyVotes[party] = partyVotes[party] || { aye: 0, no: 0, abstain: 0 };
            partyVotes[party][field] = v;
          });

          const rebels = {
            Labour: Math.max(0, Number(document.getElementById("cpRebLab")?.value || 0)),
            Conservative: Math.max(0, Number(document.getElementById("cpRebCon")?.value || 0)),
            "Liberal Democrat": Math.max(0, Number(document.getElementById("cpRebLD")?.value || 0))
          };

          data.speakerControls.npcVoteAllocations[billId] = { partyVotes, rebels };

          const forcedResult = document.getElementById("cpOverrideResult")?.value || "";
          data.speakerControls.divisionOverrides[billId] = { forcedResult };

          logAudit(data, "SPEAKER_SAVE_DIVISION_SETTINGS", { billId, rebels, forcedResult });
          saveData(data);

          alert("Saved Speaker settings.");
        });
      }
    });
  }

  /* ===== 7) Election record ===== */
  const createElectionBtn = document.getElementById("cpCreateElectionBtn");
  if (createElectionBtn && (role === "admin" || role === "mod")) {
    createElectionBtn.addEventListener("click", () => {
      data.elections = Array.isArray(data.elections) ? data.elections : [];

      const name = (document.getElementById("cpElectionName")?.value || "").trim();
      const notes = (document.getElementById("cpElectionNotes")?.value || "").trim();
      if (!name) return alert("Enter an election name.");

      const rec = { id: `election-${Date.now()}`, name, notes, createdAt: new Date().toISOString() };
      data.elections.unshift(rec);

      logAudit(data, "ELECTION_CREATE_RECORD", rec);
      saveData(data);

      const out = document.getElementById("cpElectionResult");
      if (out) out.innerHTML = `<div class="muted-block">Election record created: <b>${escapeHtml(name)}</b></div>`;
    });
  }

  /* ===== 8) Timeline save ===== */
  const setTimelineBtn = document.getElementById("cpSetTimelineBtn");
  if (setTimelineBtn && role === "admin") {
    setTimelineBtn.addEventListener("click", () => {
      data.simConfig = data.simConfig || {};
      data.simConfig.timelineKey = document.getElementById("cpTimelineKey")?.value || "UK-1997";
      logAudit(data, "TIMELINE_SET", { timelineKey: data.simConfig.timelineKey });
      saveData(data);
      alert("Timeline saved.");
      location.reload();
    });
  }
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
      ensureConstituencyData(data);
      renderParliamentSummary(data);
      renderPartyConstituencies(data);
      renderWhatsGoingOn(data);
      renderLiveDocket(data);
      renderOrderPaper(data);
      renderHansard(data);
      renderSundayRollDisplay();
      renderAbsenceUI(data);
      renderNewsPage(data);
      renderUserPage(data);
      renderPapersPage(data);
      renderBodiesPage(data);
      renderControlPanel(data);
      renderControlPanel(data);
      initSubmitBillPage(data);
      initPartyDraftPage(data);
      initBillPage(data);
      initNewsPage(data);
      initPapersPage(data);
      ensureUserAndSimBase(demo);



      startLiveRefresh();
      renderNewsPage(latest);
      renderBodiesPage(latest);
      renderUserPage(latest);
      renderPapersPage(latest);
      initNewsPage(latest);
      initPapersPage(latest);



    })
    .catch(err => console.error("Error loading demo.json:", err));
})();
