fetch("data/demo.json")
  .then((res) => res.json())
  .then((data) => {
    const safe = (v, fallback = "") => (v === null || v === undefined ? fallback : v);

    // ================= GAME CLOCK ENGINE =================

let GAME_STATE = null;

function loadGameState(data){
  GAME_STATE = data.gameState;
}

function isSunday(){
  return new Date().getDay() === 0;
}

function isClockPaused(){
  return GAME_STATE?.isPaused === true;
}

function getRealDaysSinceStart(){
  if (!GAME_STATE?.started) return 0;

  const start = new Date(GAME_STATE.startRealDate);
  const now = new Date();

  const diff = now - start;
  return Math.floor(diff / 86400000);
}

function countSundaysSinceStart(){
  if (!GAME_STATE?.started) return 0;

  const start = new Date(GAME_STATE.startRealDate);
  const now = new Date();

  let count = 0;
  let temp = new Date(start);

  while (temp <= now) {
    if (temp.getDay() === 0) count++;
    temp.setDate(temp.getDate() + 1);
  }

  return count;
}

function getSimMonthIndex(){
  if (!GAME_STATE?.started) return 0;
  if (isClockPaused()) return 0;

  const realDays = getRealDaysSinceStart();
  const sundays = countSundaysSinceStart();

  const validDays = realDays - sundays;
  return Math.floor(validDays / 3); // 3 real days per sim month
}

function getCurrentSimDate(){

  const monthsPassed = getSimMonthIndex();

  const startMonth = GAME_STATE.startSimMonth - 1; // zero indexed
  const startYear = GAME_STATE.startSimYear;

  const totalMonths = startMonth + monthsPassed;

  const simYear = startYear + Math.floor(totalMonths / 12);
  const simMonth = (totalMonths % 12) + 1;

  return { month: simMonth, year: simYear };
}

function getMonthName(month){
  const months = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December"
  ];
  return months[month - 1];
}
// ---------- Display Simulation Date ----------
const simDisplay = document.getElementById("sim-date-display");
if (simDisplay && GAME_STATE?.started) {
  const sim = getCurrentSimDate();
  simDisplay.textContent = `${getMonthName(sim.month)} ${sim.year}`;
}

function getSimMonthsSince(realTimestamp){
  if (!GAME_STATE?.started) return 0;

  const start = new Date(realTimestamp);
  const now = new Date();

  let days = Math.floor((now - start) / 86400000);

  let temp = new Date(start);
  let sundays = 0;

  while (temp <= now){
    if (temp.getDay() === 0) sundays++;
    temp.setDate(temp.getDate() + 1);
  }

  const validDays = days - sundays;
  return Math.floor(validDays / 3);
}
const STAGE_LENGTHS = {
  "First Reading": 0, // handled by 1 real day rule
  "Second Reading": 2,
  "Report Stage": 1,
  "Division": 1
};
getSimMonthsSince(bill.stageStartedAt) >= STAGE_LENGTHS[bill.stage]
if (isSunday()) return;

    // ---------- What's Going On (dashboard only) ----------
    const wgoEl = document.getElementById("whats-going-on");
    if (wgoEl) {
      const w = safe(data.whatsGoingOn, {});
      const bbc = safe(w.bbc, {});
      const papers = safe(w.papers, {});
      const economy = safe(w.economy, {});
      const pollingRaw = Array.isArray(w.polling) ? w.polling : [];

      // Polling: show parties >= 2%, always include SNP if present
      const polling = pollingRaw
        .filter((p) => (p.value >= 2) || p.party === "SNP")
        .sort((a, b) => b.value - a.value);

      const pollingLines = polling.length
        ? polling
            .map(
              (p) =>
                `<div class="row"><span>${safe(p.party, "—")}</span><b>${Number(p.value).toFixed(1)}%</b></div>`
            )
            .join("")
        : `<div class="wgo-strap">No polling yet.</div>`;

      wgoEl.innerHTML = `
        <div class="wgo-grid">

          <div class="wgo-tile">
            <div class="wgo-kicker">BBC News</div>
            <div class="wgo-title">${safe(bbc.headline, "No headline yet.")}</div>
            <div class="wgo-strap">${safe(bbc.strap, "")}</div>
            <div class="wgo-actions"><a class="btn" href="news.html">Open</a></div>
          </div>

          <div class="wgo-tile">
            <div class="wgo-kicker">Papers</div>
            <div class="wgo-title">${safe(papers.paper, "Paper")}: ${safe(papers.headline, "No headline yet.")}</div>
            <div class="wgo-strap">${safe(papers.strap, "")}</div>
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
// ---------- Live Docket (dashboard only) ----------
const docketEl = document.getElementById("live-docket");
if (docketEl) {
  const player = data.currentPlayer || {
    name: "Unknown",
    party: "Unknown",
    role: "backbencher",
    office: null,
    isSpeaker: false,
    isMod: false
  };

  const docket = data.liveDocket || {};
  const items = Array.isArray(docket.items) ? docket.items : [];

  const canSee = (it) => {
    const a = it.audience;
    if (!a) return true;

    // Speaker-only items
    if (a.speakerOnly) return !!player.isSpeaker;

    // Role filter
    if (Array.isArray(a.roles) && a.roles.length) {
      if (!a.roles.includes(player.role)) return false;
    }

    // Office filter (only relevant if you're a minister / office holder)
    if (Array.isArray(a.offices) && a.offices.length) {
      if (!player.office || !a.offices.includes(player.office)) return false;
    }

    return true;
  };

  const icon = (type) => {
    switch (type) {
      case "question": return "❓";
      case "motion": return "📜";
      case "edm": return "✍️";
      case "statement": return "🗣️";
      case "division": return "🗳️";
      case "speaker": return "🔔";
      default: return "•";
    }
  };

  const visible = items.filter(canSee);

  if (!visible.length) {
    docketEl.innerHTML = `<div class="muted-block">No live items right now.</div>`;
  } else {
    docketEl.innerHTML = `
      <div class="docket-top">
        <div class="docket-kicker">
          As of: <b>${docket.asOf || "now"}</b> ·
          Logged in as: <b>${player.name}</b> (${player.role})
        </div>
      </div>

      <div class="docket-list">
        ${visible.map(it => `
          <div class="docket-item ${it.priority === "high" ? "high" : ""}">
            <div class="docket-left">
              <div class="docket-icon">${icon(it.type)}</div>
              <div class="docket-text">
                <div class="docket-title">${it.title || "Item"}</div>
                <div class="docket-detail">${it.detail || ""}</div>
              </div>
            </div>
            <div class="docket-cta">
              <a class="btn" href="${it.href || "#"}">${it.ctaLabel || "Open"}</a>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }
}

function hoursBetween(a, b) {
  return (b - a) / 3600000;
}

function getCompletedAt(bill) {
  // Prefer completedAt if present; otherwise fallback to stageStartedAt/createdAt
  return bill.completedAt || bill.stageStartedAt || bill.createdAt || null;
}

function isRecentCompletion(bill, hoursWindow = 120) {
  if (bill.status !== "passed" && bill.status !== "failed") return false;
  const done = getCompletedAt(bill);
  if (!done) return true; // if unknown, keep visible rather than hiding
  return hoursBetween(done, Date.now()) < hoursWindow;
}

    // ---------- Order Paper (dashboard only) ----------
    const orderWrap = document.getElementById("order-paper");
    if (orderWrap) {
      const stageOrder = [
        "First Reading",
        "Second Reading",
        "Committee Stage",
        "Report Stage",
        "Division",
      ];

let bills = data.orderPaperCommons || [];

      // Keep in-progress bills always.
// Keep passed/failed only for 120 hours after completion.
bills = bills.filter(b =>
  b.status === "in-progress" || isRecentCompletion(b, 120)
);

      // ---------- Hansard (passed/failed archive) ----------
const hansardPassed = document.getElementById("hansard-passed");
const hansardFailed = document.getElementById("hansard-failed");

if (hansardPassed || hansardFailed) {
  let allBills = data.orderPaperCommons || [];

  // Include custom bills too (submitted locally)
  const customBills = JSON.parse(localStorage.getItem("rb_custom_bills") || "[]");
  allBills = [...customBills, ...allBills];

  const passed = allBills.filter(b => b.status === "passed");
  const failed = allBills.filter(b => b.status === "failed");

  const renderList = (list, emptyText) => {
    if (!list.length) return `<div class="muted-block">${emptyText}</div>`;

    return `
      <div class="order-grid">
        ${list.map(b => `
          <div class="bill-card ${b.status}">
            <div class="bill-title">${b.title}</div>
            <div class="bill-sub">Author: ${b.author} · ${b.department}</div>

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
  };

  if (hansardPassed) hansardPassed.innerHTML = renderList(passed, "No passed legislation yet.");
  if (hansardFailed) hansardFailed.innerHTML = renderList(failed, "No defeated legislation yet.");
}


// Add locally submitted bills
const customBills = JSON.parse(localStorage.getItem("rb_custom_bills") || "[]");
bills = [...customBills, ...bills];


      orderWrap.innerHTML = `
        <div class="order-grid">
          ${
            bills.length
              ? bills
                  .map((b) => {
                    const status = safe(b.status, "in-progress");
                    const stage = safe(b.stage, "First Reading");

                    const stageTrack = stageOrder
                      .map((s) => `<div class="stage ${stage === s ? "on" : ""}">${s}</div>`)
                      .join("");

                    const resultBlock =
                      status === "passed"
                        ? `<div class="bill-result passed">Royal Assent Granted</div>`
                        : status === "failed"
                          ? `<div class="bill-result failed">Bill Defeated</div>`
                          : `<div class="bill-current">Current Stage: <b>${stage}</b></div>`;

                    return `
                      <div class="bill-card ${status}">
                        <div class="bill-title">${safe(b.title, "Untitled Bill")}</div>
                        <div class="bill-sub">Author: ${safe(b.author, "—")} · ${safe(b.department, "—")}</div>

                        <div class="stage-track">${stageTrack}</div>

                        ${resultBlock}

                        <div class="bill-actions spaced">
                          <a class="btn" href="bill.html?id=${encodeURIComponent(safe(b.id, ""))}">View Bill</a>
                          <a class="btn" href="https://forum.rulebritannia.org" target="_blank" rel="noopener">Debate</a>
                        </div>
                      </div>
                    `;
                  })
                  .join("")
              : `<div class="muted-block">No bills on the Order Paper.</div>`
          }
        </div>
      `;
    }
  })
  .catch((err) => console.error("Error loading data/demo.json:", err));
// ===== NAV ACTIVE STATE =====
(function(){
  const current = window.location.pathname.split("/").pop();
  const links = document.querySelectorAll(".nav a");

  links.forEach(link => {
    const href = link.getAttribute("href");

    // Ignore external links
    if (!href || href.startsWith("http")) return;

    if (href === current) {
      link.classList.add("active");
    }

    // Special case: dashboard.html is root sometimes
    if (current === "" && href === "dashboard.html") {
      link.classList.add("active");
    }
  });
})();

// ---------- Dropdown Nav ----------
(function initNavDropdowns(){
  const groups = Array.from(document.querySelectorAll(".nav-group"));
  const toggles = Array.from(document.querySelectorAll(".nav-toggle"));

  if (!groups.length || !toggles.length) return;

  toggles.forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();

      // close others
      groups.forEach(g => {
        if (g !== btn.parentElement) g.classList.remove("open");
      });

      btn.parentElement.classList.toggle("open");
    });
  });

  // click outside closes all
  document.addEventListener("click", () => {
    groups.forEach(g => g.classList.remove("open"));
  });

  // escape closes all
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") groups.forEach(g => g.classList.remove("open"));
  });
})();

// ---------- Active Page Highlight ----------
(function highlightActiveNav(){
  const current = location.pathname.split("/").pop() || "dashboard.html";

  document.querySelectorAll(".nav a").forEach(link => {
    const href = link.getAttribute("href");
    if (!href) return;

    // only match local pages (ignore https links)
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
})();
// ---------- Submit Bill ----------
(function initSubmitBill(){

  const form = document.getElementById("billForm");
  if (!form) return;

  const permissionBox = document.getElementById("bill-permission");
  const successBox = document.getElementById("billSuccess");

  fetch("data/demo.json")
    .then(r => r.json())
    .then(data => {
      loadGameState(data);


      const player = data.currentPlayer;

      // Only MPs allowed
      const allowedRoles = [
        "backbencher",
        "minister",
        "leader-opposition",
        "prime-minister"
      ];

      if (!allowedRoles.includes(player.role)) {
        form.style.display = "none";
        permissionBox.innerHTML =
          `<div class="bill-result failed">You are not eligible to submit legislation.</div>`;
        return;
      }

      form.addEventListener("submit", (e) => {
        e.preventDefault();

        const title = document.getElementById("billTitleInput").value.trim();
        const dept = document.getElementById("billDepartment").value;
        const text = document.getElementById("billTextInput").value.trim();

        if (!title || !text) return;

        const newBill = {
          id: "bill-" + Date.now(),
          title: title,
          author: player.name,
          department: dept,
          stage: "First Reading",
          status: "in-progress",
          billText: text,
          amendments: []
        };

        // Store in localStorage (Phase 1 simulation)
        const stored = JSON.parse(localStorage.getItem("rb_custom_bills") || "[]");
        stored.push(newBill);
        localStorage.setItem("rb_custom_bills", JSON.stringify(stored));

        form.reset();
        successBox.style.display = "block";
      });

    });

})();

{
  id,
  title,
  author,
  department,
  type: "pmb" | "opposition" | "government",

  stage: "First Reading" | "Second Reading" | "Report Stage" | "Division" | "Passed" | "Failed",

  status: "in-progress" | "passed" | "failed",

  createdAt,
  stageStartedAt,

  stagePaused: false,
  pauseStartedAt: null,

  billText,

  amendments: [
    {
      id,
      text,
      proposedBy,
      createdAt,
      status: "proposed" | "accepted" | "rejected" | "division" | "failed",
      supporters: [],
      divisionStartedAt
    }
  ],

  votes: {
    yes: [],
    no: []
  }
}
function stageHoursElapsed(bill){
  if (bill.stagePaused) {
    return (bill.pauseStartedAt - bill.stageStartedAt) / 3600000;
  }
  return (Date.now() - bill.stageStartedAt) / 3600000;
}
// ================== LEGISLATION STAGE RULES ==================
const STAGE_ORDER = ["First Reading", "Second Reading", "Report Stage", "Division"];
const STAGE_LENGTH_SIM_MONTHS = {
  "Second Reading": 2,
  "Report Stage": 1,
  "Division": 1
};

// First Reading is special (1 real day; and Sunday-start defers to Monday)
const FIRST_READING_REAL_DAYS = 1;

// Amendment windows (kept for later UI wiring; engine-ready now)
const AMENDMENTS_SECOND_READING_OPEN_SIM_MONTHS = 1; // first 1 sim month of Second Reading
const AMENDMENTS_REPORT_STAGE_OPEN_SIM_MONTHS = 0;   // we'll treat as first half via real-days later
const AUTHOR_LOCK_FINAL_REAL_DAYS = 1;               // final 24h of a stage

function getBillBadge(bill){
  const t = (bill.type || "pmb").toLowerCase();
  if (t === "government") return { text: "Government Bill", cls: "badge-government" };
  if (t === "opposition") return { text: "Opposition Day Bill", cls: "badge-opposition" };
  return { text: "PMB", cls: "badge-pmb" };
}

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function msToParts(ms){
  const s = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  return { days, hours, mins };
}

function formatCountdown(ms){
  const p = msToParts(ms);
  if (p.days > 0) return `${p.days}d ${p.hours}h ${p.mins}m`;
  if (p.hours > 0) return `${p.hours}h ${p.mins}m`;
  return `${p.mins}m`;
}

function realDaysBetween(aTs, bTs){
  return Math.floor((bTs - aTs) / 86400000);
}

function isCompleted(bill){
  return bill.status === "passed" || bill.status === "failed" || bill.stage === "Passed" || bill.stage === "Failed";
}

function ensureBillDefaults(bill){
  if (!bill.createdAt) bill.createdAt = Date.now();
  if (!bill.stageStartedAt) bill.stageStartedAt = bill.createdAt;
  if (!bill.type) bill.type = "pmb";
  if (!bill.stage) bill.stage = "First Reading";
  if (!bill.status) bill.status = "in-progress";
  if (!bill.amendments) bill.amendments = [];
  if (!bill.division) bill.division = null; // later used in Division stage
  if (!bill.completedAt && isCompleted(bill)) bill.completedAt = bill.completedAt || Date.now();
  return bill;
}
function getSimMonthsSince(realTimestamp){
  if (!GAME_STATE?.started) return 0;

  const start = new Date(realTimestamp);
  const now = new Date();

  let days = Math.floor((now - start) / 86400000);

  // Count Sundays between start and now (inclusive)
  let temp = new Date(start);
  let sundays = 0;
  while (temp <= now) {
    if (temp.getDay() === 0) sundays++;
    temp.setDate(temp.getDate() + 1);
  }

  const validDays = days - sundays;
  return Math.floor(validDays / 3); // 3 real days per sim month
}
function moveStage(bill, newStage){
  bill.stage = newStage;
  bill.stageStartedAt = Date.now();
  bill.stagePaused = false;
  bill.pauseStartedAt = null;

  // If entering Division, create vote container if missing
  if (newStage === "Division" && !bill.division) {
    bill.division = {
      openedAt: Date.now(),
      votes: { aye: [], no: [], abstain: [] },
      closed: false,
      result: null
    };
  }
}

function autoCompleteBill(bill, passed){
  bill.status = passed ? "passed" : "failed";
  bill.stage = passed ? "Passed" : "Failed";
  bill.completedAt = Date.now();
  bill.division = bill.division || null;
}

function shouldArchiveOffOrderPaperToday(bill){
  // Rule: bills move off Order Paper on the next Sunday after completion.
  // So: if completed, AND today is Sunday, AND completion happened BEFORE today (not same-minute).
  if (!isCompleted(bill)) return false;
  if (!isSunday()) return false;

  const done = bill.completedAt || bill.stageStartedAt || bill.createdAt;
  if (!done) return true;

  // Must be completed at least 1 real day ago, so Sunday isn't immediately hiding something finished on Sunday.
  return realDaysBetween(done, Date.now()) >= 1;
}

function billStageCountdown(bill){
  // Returns { label, msRemaining } for current stage
  const now = Date.now();

  // Sunday: show frozen status (we still show countdown based on real time, but no movement)
  const sundayFrozen = isSunday();

  if (bill.stage === "First Reading") {
    // First Reading starts Monday if submitted Sunday
    const end = bill.stageStartedAt + FIRST_READING_REAL_DAYS * 86400000;
    return { label: sundayFrozen ? "Polling Day — clock frozen" : "First Reading ends in", msRemaining: end - now };
  }

  if (bill.stage === "Second Reading" || bill.stage === "Report Stage" || bill.stage === "Division") {
    const needed = STAGE_LENGTH_SIM_MONTHS[bill.stage] || 1;

    // Approx end based on sim months -> convert to real days (3 days per sim month) + Sundays excluded for month-counting.
    // We can’t compute exact end timestamp without iterating days; so we present a “sim months remaining” + rough countdown.
    const elapsed = getSimMonthsSince(bill.stageStartedAt);
    const remainingSim = Math.max(0, needed - elapsed);

    // Rough: remainingSim * 3 days (not exact because Sundays excluded, but good enough for UI).
    const roughEnd = bill.stageStartedAt + (needed * 3 * 86400000);
    return {
      label: sundayFrozen ? "Polling Day — clock frozen" : `${bill.stage} ends in`,
      msRemaining: roughEnd - now,
      remainingSimMonths: remainingSim
    };
  }

  return { label: "", msRemaining: 0 };
}

function processBillLifecycle(bill, context){
  // context: { player, totalEligibleVoters } later
  ensureBillDefaults(bill);

  // Global freeze: Sundays are admin/polling day. No automatic stage movement.
  if (isSunday()) return bill;

  // If bill completed, do nothing (Hansard roll handled by Order Paper filter)
  if (isCompleted(bill)) return bill;

  // If bill submitted on Sunday, it should not enter First Reading until Monday.
  // Implementation: when created on Sunday, set a flag and stageStartedAt to next Monday 00:00.
  if (bill.stage === "First Reading" && bill.deferToMonday === true) {
    const now = new Date();
    if (now.getDay() !== 0) {
      bill.deferToMonday = false;
      // stageStartedAt already set to Monday start when created
    } else {
      return bill;
    }
  }

  // First Reading auto-move after 1 real day (unless PMB refused etc.)
  if (bill.stage === "First Reading") {
    const days = realDaysBetween(bill.stageStartedAt, Date.now());
    if (days >= FIRST_READING_REAL_DAYS) {
      // If still in-progress and not explicitly blocked, move to Second Reading
      moveStage(bill, "Second Reading");
    }
    return bill;
  }

  // Second Reading auto-move after 2 sim months (but must not have active amendment divisions; wiring later)
  if (bill.stage === "Second Reading") {
    const elapsed = getSimMonthsSince(bill.stageStartedAt);
    if (elapsed >= STAGE_LENGTH_SIM_MONTHS["Second Reading"]) {
      moveStage(bill, "Report Stage");
    }
    return bill;
  }

  // Report Stage auto-move after 1 sim month
  if (bill.stage === "Report Stage") {
    const elapsed = getSimMonthsSince(bill.stageStartedAt);
    if (elapsed >= STAGE_LENGTH_SIM_MONTHS["Report Stage"]) {
      moveStage(bill, "Division");
    }
    return bill;
  }

  // Division auto-close after 1 sim month OR early if 100% votes (we’ll enable 100% once we have electorate list)
  if (bill.stage === "Division") {
    const elapsed = getSimMonthsSince(bill.stageStartedAt);
    if (elapsed >= STAGE_LENGTH_SIM_MONTHS["Division"]) {
      // For now, if no votes system is live, we mark "failed" by default? No—don’t.
      // Instead, auto-close with placeholder result logic:
      // If you haven't implemented voting UI yet, keep it "in-progress" but mark division closed? No—confusing.
      // We'll leave it open until voting exists, but the stage engine is ready.
      // (Once voting UI exists, this block will calculate result and complete the bill.)
    }
    return bill;
  }

  return bill;
}
const now = new Date();
const submittedOnSunday = now.getDay() === 0;

const newBill = {
  id: "bill-" + Date.now(),
  title: title,
  author: player.name,
  department: dept,

  type: "pmb",
  stage: "First Reading",
  status: "in-progress",

  createdAt: Date.now(),
  stageStartedAt: Date.now(),

  // if submitted Sunday, defer stage start to Monday 00:00
  deferToMonday: submittedOnSunday,

  billText: text,
  amendments: []
};

// Set stageStartedAt to next Monday 00:00 if Sunday
if (submittedOnSunday) {
  const monday = new Date();
  monday.setDate(monday.getDate() + 1);
  monday.setHours(0,0,0,0);
  newBill.stageStartedAt = monday.getTime();
}
// ===== Order Paper (ONLY if element exists) =====
const orderWrap = document.getElementById("order-paper");
if (orderWrap) {

  let bills = data.orderPaperCommons || [];

  // Include locally submitted bills
  const customBills = JSON.parse(localStorage.getItem("rb_custom_bills") || "[]");
  bills = [...customBills, ...bills];

  // Ensure defaults + process lifecycle (Sunday freeze is inside processor)
  bills = bills.map(b => processBillLifecycle(ensureBillDefaults(b), { player: data.currentPlayer }));

  // Persist updated custom bills back to localStorage (only those that are custom)
  const updatedCustom = bills.filter(b => String(b.id || "").startsWith("bill-"));
  localStorage.setItem("rb_custom_bills", JSON.stringify(updatedCustom));

  // Filter: show in-progress always.
  // If completed, show ONLY until the next Sunday roll removes it.
  bills = bills.filter(b => {
    if (!isCompleted(b)) return true;
    return !shouldArchiveOffOrderPaperToday(b);
  });

  orderWrap.innerHTML = `
    <div class="order-grid">
      ${bills.map(b => {
        const badge = getBillBadge(b);
        const t = billStageCountdown(b);
        const timerLine = (b.status === "in-progress")
          ? `<div class="timer">
               <div class="kv"><span>${t.label}</span><b>${formatCountdown(t.msRemaining)}</b></div>
               ${typeof t.remainingSimMonths !== "undefined"
                 ? `<div class="small">Sim months remaining: ${t.remainingSimMonths}</div>` : ``}
             </div>`
          : ``;

        const stageLabel = isCompleted(b)
          ? (b.status === "passed" ? "Passed" : "Failed")
          : b.stage;

        const resultBlock = isCompleted(b)
          ? `<div class="bill-result ${b.status === "passed" ? "passed" : "failed"}">
               ${b.status === "passed" ? "Royal Assent Granted" : "Bill Defeated"}
             </div>`
          : `<div class="bill-current">Current Stage: <b>${stageLabel}</b></div>`;

        return `
          <div class="bill-card ${b.status}">
            <div class="bill-title">${b.title}</div>
            <div class="bill-sub">Author: ${b.author} · ${b.department}</div>

            <div class="badges">
              <span class="bill-badge ${badge.cls}">${badge.text}</span>
            </div>

            <div class="stage-track">
              ${STAGE_ORDER.map(s => `
                <div class="stage ${b.stage === s ? "on" : ""}">${s}</div>
              `).join("")}
            </div>

            ${resultBlock}
            ${timerLine}

            <div class="bill-actions spaced">
              <a class="btn" href="bill.html?id=${encodeURIComponent(b.id)}">View Bill</a>
              <a class="btn" href="https://forum.rulebritannia.org" target="_blank" rel="noopener">Debate</a>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}
// ================== SUNDAY ACTIVITY ROLL ==================

function processSundayActivity(players){

  if (!isSunday()) return players;

  const now = Date.now();

  return players.map(p => {

    // Inactive if not logged in within 7 real days
    const daysSinceLogin = Math.floor((now - new Date(p.lastLogin).getTime()) / 86400000);

    if (daysSinceLogin > 7) {
      p.active = false;
    }

    // Maturity check: must survive 2 Sundays since join
    const joined = new Date(p.joinedAt);
    const nowDate = new Date();

    let sundays = 0;
    let temp = new Date(joined);

    while (temp <= nowDate) {
      if (temp.getDay() === 0) sundays++;
      temp.setDate(temp.getDate() + 1);
    }

    p.mature = sundays >= 2;

    return p;
  });
}
// ================== DIVISION WEIGHT ENGINE ==================

function getFrontbenchRoles(){
  return [
    "prime-minister",
    "leader-opposition",
    "secretary",
    "shadow-secretary",
    "party-leader"
  ];
}

function calculateDivisionWeights(players, parliament){

  const processed = processSundayActivity(players);

  const result = {};

  parliament.parties.forEach(party => {

    const partyPlayers = processed.filter(pl => pl.party === party.name && pl.active);

    const fullEligible = partyPlayers.filter(pl => {

      const isFrontbench = getFrontbenchRoles().includes(pl.role);

      if (isFrontbench) return true;

      // backbencher maturity rule
      return pl.role === "backbencher" && pl.mature;
    });

    const seatCount = party.seats;

    const weightPerFull = fullEligible.length > 0
      ? seatCount / fullEligible.length
      : 0;

    result[party.name] = {
      seatCount,
      fullEligible,
      weightPerFull
    };
  });

  return result;
}
// ================== ABSENCE UI ==================

function renderAbsenceUI(data){

  const container = document.getElementById("absence-ui");
  if (!container) return;

  const players = data.players;
  const current = data.currentPlayer;

  const me = players.find(p => p.name === current.name);
  if (!me) return;

  let delegationBlock = "";

  if (me.partyLeader && me.absent){

    const eligible = players.filter(p =>
      p.party === me.party &&
      p.active &&
      p.name !== me.name
    );

    delegationBlock = `
      <div style="margin-top:12px;">
        <label>Delegate Vote To:</label>
        <select id="delegateSelect">
          <option value="">-- Select Member --</option>
          ${eligible.map(p =>
            `<option value="${p.name}" ${me.delegatedTo === p.name ? "selected":""}>
              ${p.name}
            </option>`
          ).join("")}
        </select>
        <button class="btn" onclick="setDelegation()">Save</button>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="kv">
      <span>Status:</span>
      <b>${me.absent ? "Absent" : "Active"}</b>
    </div>

    <div style="margin-top:12px;">
      ${
        me.absent
          ? `<button class="btn" onclick="toggleAbsence(false)">Return to Active</button>`
          : `<button class="btn" onclick="toggleAbsence(true)">Mark as Absent</button>`
      }
    </div>

    ${delegationBlock}
  `;
}
function getFullData(){
  return JSON.parse(localStorage.getItem("rb_full_data"));
}

function saveFullData(data){
  localStorage.setItem("rb_full_data", JSON.stringify(data));
}
voters.push(voteHolder.name)
bill.division = {
  openedAt: "2026-02-14T12:00:00Z",
  durationHours: 24,
  votes: {
    aye: 0,
    no: 0,
    abstain: 0
  },
  voters: [],
  closed: false,
  result: null
};
if (bill.stage === "Division" && !bill.division){
  bill.division = {
    openedAt: new Date().toISOString(),
    durationHours: 24,
    votes: { aye:0, no:0, abstain:0 },
    voters: [],
    closed: false,
    result: null
  };
}
function renderSubmitBillForm(data){

  const container = document.getElementById("bill-form");
  if (!container) return;

  const current = data.currentPlayer;

  const isPM = current.role === "prime-minister";
  const isLOTO = current.role === "leader-opposition";
  const isLeaderOfHouse = current.office === "leader-commons";

  container.innerHTML = `
    <div class="form-grid">

      <label>Short Title</label>
      <input id="shortTitle" placeholder="e.g. Rail Safety Reform Act 2000" />

      <label>Policy Area</label>
      <select id="policyArea">
        <option>Health</option>
        <option>Defence</option>
        <option>Home Affairs</option>
        <option>Treasury</option>
        <option>Education</option>
        <option>Transport</option>
        <option>Environment</option>
        <option>Justice</option>
        <option>Foreign Affairs</option>
      </select>

      <label>Purpose of the Bill</label>
      <textarea id="purpose" rows="3" placeholder="Brief explanation of what the Bill does."></textarea>

      <label>Extent</label>
      <select id="extent">
        <option>England</option>
        <option>England and Wales</option>
        <option>Great Britain</option>
        <option>United Kingdom</option>
      </select>

      <label>Commencement</label>
      <select id="commencement">
        <option>On Royal Assent</option>
        <option>After 3 months</option>
        <option>By Regulations</option>
      </select>

      ${
        isLOTO
          ? `<div>
               <label>
                 <input type="checkbox" id="oppositionDay" />
                 Opposition Day Bill
               </label>
             </div>`
          : ""
      }

      ${
        (isPM || isLeaderOfHouse)
          ? `<div>
               <label>
                 <input type="checkbox" id="governmentBill" />
                 Move as Government Bill
               </label>
             </div>`
          : ""
      }

      <label>Main Clauses</label>
      <textarea id="clauses" rows="8" placeholder="Enter clauses line by line..."></textarea>

      <button class="btn" onclick="submitBill()">Submit Bill</button>

    </div>
  `;
}
function generateBillText(title, purpose, extent, commencement, clauses){

  const clauseArray = clauses.split("\n").filter(c => c.trim());

  let numberedClauses = clauseArray.map((c,i) =>
    `${i+1}. ${c}`
  ).join("\n");

  return `
A Bill to ${purpose.toLowerCase()}.

BE IT ENACTED by the King's most Excellent Majesty, by and with the advice and consent of the Commons in this present Parliament assembled, and by the authority of the same, as follows:

${numberedClauses}

Extent:
This Act extends to ${extent}.

Commencement:
This Act shall come into force ${commencement.toLowerCase()}.
  `;
}
function submitBill(){

  let data = getFullData();

  const title = document.getElementById("shortTitle").value;
  const policy = document.getElementById("policyArea").value;
  const purpose = document.getElementById("purpose").value;
  const extent = document.getElementById("extent").value;
  const commencement = document.getElementById("commencement").value;
  const clauses = document.getElementById("clauses").value;

  const isOpp = document.getElementById("oppositionDay")?.checked || false;
  const isGov = document.getElementById("governmentBill")?.checked || false;

  const billText = generateBillText(title, purpose, extent, commencement, clauses);

  const newBill = {
    id: title.toLowerCase().replace(/\s/g,"-") + "-" + Date.now(),
    title,
    author: data.currentPlayer.name,
    department: policy,
    stage: isOpp || isGov ? "Second Reading" : "First Reading",
    status: "in-progress",
    billType: isGov ? "government" : isOpp ? "opposition" : "pmb",
    billText,
    amendments: [],
    submittedAt: new Date().toISOString(),
    stageStartedAt: new Date().toISOString()
  };

  data.orderPaperCommons.push(newBill);

  saveFullData(data);

  location.href = "dashboard.html";
}
