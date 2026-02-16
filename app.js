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
