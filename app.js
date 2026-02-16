/* =========================================================
   Rule Britannia — app.js (CLEAN BASELINE)
   - Loads demo.json once
   - Uses localStorage rb_full_data as the live state
   - Dashboard tiles + Live Docket + Order Paper + Hansard
   - Game Clock Engine (3 real days = 1 sim month, Sundays frozen)
   - Bill lifecycle engine + countdown timers
   - Amendment engine (support window, division, pause lifecycle)
   - Nav highlighting + dropdown support
   ========================================================= */

(() => {
  "use strict";

  const DATA_URL = "data/demo.json";
  const LS_KEY = "rb_full_data";

  /* =========================
     Small safe helpers
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

  function msToHMS(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}h ${m}m ${sec}s`;
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

  // Add hours while skipping ALL hours that fall on Sundays (Sunday is frozen)
  function addActiveHoursSkippingSundays(startTs, hours) {
    let t = startTs;
    let remaining = hours;
    while (remaining > 0) {
      t += 3600000; // +1 hour
      if (!isSunday(t)) remaining--;
    }
    return t;
  }

  // Add valid days while skipping Sundays entirely
  function addValidDaysSkippingSundays(startTs, validDays) {
    let t = startTs;
    let remaining = validDays;
    while (remaining > 0) {
      t += 86400000; // +1 day
      if (!isSunday(t)) remaining--;
    }
    return t;
  }

  /* =========================
     Storage helpers
     ========================= */
  function getData() {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  function saveData(data) {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  }

  /* =========================
     Boot: fetch demo.json once,
     seed localStorage if empty,
     then render everything.
     ========================= */
  fetch(DATA_URL)
    .then(r => r.json())
    .then((demo) => {
      // If we already have state in localStorage, prefer it.
      // Otherwise seed it from demo.json.
      let data = getData();
      if (!data) {
        data = demo;
        // Ensure some keys exist so nothing breaks
        data.players = Array.isArray(data.players) ? data.players : [];
        data.orderPaperCommons = Array.isArray(data.orderPaperCommons) ? data.orderPaperCommons : [];
        data.gameState = data.gameState || {
          started: true,
          isPaused: false,
          startRealDate: new Date().toISOString(),
          startSimMonth: 8,
          startSimYear: 1997
        };
        data.adminSettings = data.adminSettings || { monarchGender: "Queen" };
        data.oppositionTracker = data.oppositionTracker || {}; // year -> count
        saveData(data);
      }

      // Always keep current demo.json “static content” (like WhatsGoingOn) updated:
      // Merge demo.whatsGoingOn into stored data if missing
      data.whatsGoingOn = data.whatsGoingOn || demo.whatsGoingOn || {};
      saveData(data);

      /* =========================
         Render all page components
         ========================= */
      initNavUI();
      renderSimDate(data);
      renderWhatsGoingOn(data);
      renderLiveDocket(data);
      renderOrderPaper(data);
      renderHansard(data);

      // Optional pages (only render if elements exist)
      renderAbsenceUI(data);
      initSubmitBillPage(data);

      // On pages that should show live countdowns, refresh timers
      startLiveRefresh(data);

    })
    .catch(err => console.error("Error loading data/demo.json:", err));

  /* =========================
     NAV: active highlight + dropdowns
     ========================= */
  function initNavUI() {
    // Active link highlight
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

    // Dropdown support (if you have grouped nav)
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
     GAME CLOCK ENGINE
     ========================= */
  function getGameState(data) {
    return data.gameState || { started: false };
  }

  function isClockPaused(data) {
    const gs = getGameState(data);
    return gs.isPaused === true;
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

  function getRealDaysSinceStart(data) {
    const gs = getGameState(data);
    if (!gs.started) return 0;
    const start = new Date(gs.startRealDate).getTime();
    const now = nowTs();
    return Math.floor((now - start) / 86400000);
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
     BILL DEFAULTS + LIFECYCLE
     Stages:
       First Reading (1 real day)
       Second Reading (2 sim months)
       Report Stage (1 sim month)
       Division (1 sim month unless 100% votes -> future)
     Sunday freezes automatic movement.
     Bills leave Order Paper on next Sunday after completion.
     ========================= */

  const STAGE_ORDER = ["First Reading", "Second Reading", "Report Stage", "Division"];
  const STAGE_LENGTH_SIM_MONTHS = {
    "Second Reading": 2,
    "Report Stage": 1,
    "Division": 1
  };

  function ensureBillDefaults(bill) {
    if (!bill.createdAt) bill.createdAt = nowTs();
    if (!bill.stageStartedAt) bill.stageStartedAt = bill.createdAt;
    if (!bill.stage) bill.stage = "First Reading";
    if (!bill.status) bill.status = "in-progress";
    if (!bill.billType) bill.billType = bill.type || "pmb"; // compatibility
    if (!Array.isArray(bill.amendments)) bill.amendments = [];
    if (!bill.hansard) bill.hansard = {};
    if (!bill.completedAt && (bill.status === "passed" || bill.status === "failed")) {
      bill.completedAt = nowTs();
    }
    return bill;
  }

  function isCompleted(bill) {
    return bill.status === "passed" || bill.status === "failed";
  }

  function shouldArchiveOffOrderPaperToday(bill) {
    // Bills move off Order Paper on the next Sunday after completion.
    if (!isCompleted(bill)) return false;
    if (!isSunday()) return false;

    const done = bill.completedAt || bill.stageStartedAt || bill.createdAt;
    if (!done) return true;

    // Don’t hide something completed on the same Sunday; wait at least 1 real day.
    const days = Math.floor((nowTs() - done) / 86400000);
    return days >= 1;
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

  function billHasOpenAmendmentDivision(bill) {
    return (bill.amendments || []).some(a =>
      a.status === "division" && a.division && a.division.closed !== true
    );
  }

  function moveStage(bill, newStage) {
    bill.stage = newStage;
    bill.stageStartedAt = nowTs();
  }

  function processBillLifecycle(data, bill) {
    ensureBillDefaults(bill);

    // Sundays freeze all automatic progression
    if (isSunday()) return bill;

    // Completed bills do nothing
    if (isCompleted(bill)) return bill;

    // Pause progression while any amendment division is open
    if (billHasOpenAmendmentDivision(bill)) return bill;

    // If bill was submitted on Sunday: defer stage start to Monday 00:00
    if (bill.deferToMonday === true) {
      const today = new Date();
      if (today.getDay() !== 0) bill.deferToMonday = false;
      else return bill;
    }

    // First Reading: 1 real day (24 active hours skipping Sundays)
    if (bill.stage === "First Reading") {
      const end = addActiveHoursSkippingSundays(new Date(bill.stageStartedAt).getTime(), 24);
      if (nowTs() >= end) {
        moveStage(bill, "Second Reading");
      }
      return bill;
    }

    // Second Reading: 2 sim months
    if (bill.stage === "Second Reading") {
      const elapsed = getSimMonthsSince(data, bill.stageStartedAt);
      if (elapsed >= STAGE_LENGTH_SIM_MONTHS["Second Reading"]) {
        moveStage(bill, "Report Stage");
      }
      return bill;
    }

    // Report Stage: 1 sim month
    if (bill.stage === "Report Stage") {
      const elapsed = getSimMonthsSince(data, bill.stageStartedAt);
      if (elapsed >= STAGE_LENGTH_SIM_MONTHS["Report Stage"]) {
        moveStage(bill, "Division");
        // Create division container if missing
        if (!bill.division) {
          bill.division = {
            openedAt: new Date().toISOString(),
            durationHours: 24,
            votes: { aye: 0, no: 0, abstain: 0 },
            voters: [],
            closed: false,
            result: null
          };
        }
      }
      return bill;
    }

    // Division: 1 sim month (closing logic later when full electorate is active)
    if (bill.stage === "Division") {
      // We do not auto-complete here yet (you asked that result is by votes).
      // This stage is ready; voting UI will close it when implemented.
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
      // 2 sim months = 6 valid days
      const end = addValidDaysSkippingSundays(new Date(bill.stageStartedAt).getTime(), 6);
      return { label: isSunday() ? "Polling Day — clock frozen" : "Second Reading ends in", msRemaining: end - now };
    }

    if (bill.stage === "Report Stage") {
      // 1 sim month = 3 valid days
      const end = addValidDaysSkippingSundays(new Date(bill.stageStartedAt).getTime(), 3);
      return { label: isSunday() ? "Polling Day — clock frozen" : "Report Stage ends in", msRemaining: end - now };
    }

    if (bill.stage === "Division") {
      // 1 sim month = 3 valid days
      const end = addValidDaysSkippingSundays(new Date(bill.stageStartedAt).getTime(), 3);
      return { label: isSunday() ? "Polling Day — clock frozen" : "Division closes in", msRemaining: end - now };
    }

    return { label: "", msRemaining: 0 };
  }

  /* =========================
     AMENDMENT ENGINE (core)
     - Proposed -> support window (24 active hours)
     - If <2 parties support by deadline -> failed
     - If >=2 support -> division opens (24 active hours)
     - Division auto-closes on deadline (tie fails)
     - Logs to bill.hansard.amendments
     ========================= */

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
      outcome,
      timestamp: new Date().toISOString(),
      failedReason: amend.failedReason || null
    });
  }

  function processAmendments(bill) {
    if (!Array.isArray(bill.amendments)) bill.amendments = [];
    if (isSunday()) return bill; // Sunday freeze: no expiry/closure

    const now = nowTs();

    bill.amendments.forEach(amend => {
      // Ensure support deadline exists
      if (!amend.supportDeadlineAt) {
        const submitted = amend.submittedAt ? new Date(amend.submittedAt).getTime() : now;
        amend.supportDeadlineAt = addActiveHoursSkippingSundays(submitted, 24);
      }

      // Proposed -> if deadline passes without 2 supporters, fail
      if (amend.status === "proposed") {
        const supporters = amend.supporters || [];
        if (now > amend.supportDeadlineAt && supporters.length < 2) {
          amend.status = "failed";
          amend.failedReason = "Insufficient leader support within 24 hours.";
          logHansardAmendment(bill, amend, "failed");
        }
      }

      // If 2 supporters -> open division
      if (amend.status === "proposed" && (amend.supporters || []).length >= 2) {
        amend.status = "division";
        if (!amend.division) {
          const opened = now;
          amend.division = {
            openedAt: new Date(opened).toISOString(),
            closesAt: addActiveHoursSkippingSundays(opened, 24),
            votes: { aye: 0, no: 0, abstain: 0 },
            voters: [],
            closed: false,
            result: null
          };
        }
      }

      // Close division if deadline passed
      if (amend.status === "division" && amend.division && amend.division.closed !== true) {
        const closesAt = amend.division.closesAt;
        if (now >= closesAt) {
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
            amend.failedReason = (aye === no) ? "Tie (Speaker casting vote maintains status quo)." : "Majority against.";
            logHansardAmendment(bill, amend, "failed");
          }
        }
      }
    });

    return bill;
  }

  /* =========================
     WHAT’S GOING ON (dashboard)
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
      ? polling.map(p => `<div class="row"><span>${safe(p.party,"—")}</span><b>${Number(p.value).toFixed(1)}%</b></div>`).join("")
      : `<div class="wgo-strap">No polling yet.</div>`;

    el.innerHTML = `
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

  /* =========================
     LIVE DOCKET (personalised)
     + Amendments wired in
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

  function canSeeLeaderSupportButton(playerObj) {
    // For now: treat "leader-opposition" and partyLeader true as leaders
    return playerObj.partyLeader === true || playerObj.role === "leader-opposition" || playerObj.role === "prime-minister";
  }

  function generateAmendmentDocketItems(data) {
    const items = [];
    const player = data.currentPlayer || {};
    const me = (data.players || []).find(p => p.name === player.name);

    if (!me) return items;

    (data.orderPaperCommons || []).forEach(bill => {
      ensureBillDefaults(bill);
      processAmendments(bill);

      (bill.amendments || []).forEach(amend => {
        // Author: needs to accept/reject proposed amendment
        if (amend.status === "proposed" && bill.author === me.name) {
          items.push({
            type: "amendment",
            title: "Amendment awaiting your decision",
            detail: `Bill: ${bill.title} · Article ${amend.articleNumber}`,
            ctaLabel: "Open",
            href: `bill.html?id=${encodeURIComponent(bill.id)}`,
            priority: "high"
          });
        }

        // Leader support: if leader and hasn't supported yet and still within window
        if (
          amend.status === "proposed" &&
          canSeeLeaderSupportButton(me) &&
          !(amend.supporters || []).includes(me.party) &&
          nowTs() <= (amend.supportDeadlineAt || 0)
        ) {
          items.push({
            type: "amendment",
            title: "Leader support requested",
            detail: `Amendment on: ${bill.title}`,
            ctaLabel: "Open",
            href: `bill.html?id=${encodeURIComponent(bill.id)}`,
            priority: "normal"
          });
        }

        // Amendment division open: everyone active can see (eligibility/vote weight handled on the bill page)
        if (amend.status === "division" && amend.division && amend.division.closed !== true && me.active) {
          const closesAt = amend.division.closesAt;
          const ms = Math.max(0, closesAt - nowTs());
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

    const player = data.currentPlayer || {
      name: "Unknown",
      party: "Unknown",
      role: "backbencher",
      office: null,
      isSpeaker: false,
      isMod: false
    };

    const docket = data.liveDocket || {};
    const staticItems = Array.isArray(docket.items) ? docket.items : [];

    // Filter static items based on audience
    let items = staticItems.filter(it => canSeeDocketItem(it, player));

    // Add amendment-generated items
    const amendItems = generateAmendmentDocketItems(data);
    items = items.concat(amendItems);

    // If nothing to show
    if (!items.length) {
      el.innerHTML = `<div class="muted-block">No live items right now.</div>`;
      return;
    }

    // Icon
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
          As of: <b>${safe(docket.asOf, "now")}</b> · Logged in as: <b>${player.name}</b> (${player.role})
        </div>
      </div>

      <div class="docket-list">
        ${items.map(it => `
          <div class="docket-item ${it.priority === "high" ? "high" : ""}">
            <div class="docket-left">
              <div class="docket-icon">${icon(it.type)}</div>
              <div class="docket-text">
                <div class="docket-title">${safe(it.title, "Item")}</div>
                <div class="docket-detail">${safe(it.detail, "")}</div>
              </div>
            </div>
            <div class="docket-cta">
              <a class="btn" href="${safe(it.href, "#")}">${safe(it.ctaLabel, "Open")}</a>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  /* =========================
     BILL BADGES
     ========================= */
  function getBillBadge(bill) {
    const t = String(bill.billType || bill.type || "pmb").toLowerCase();
    if (t === "government") return { text: "Government Bill", cls: "badge-government" };
    if (t === "opposition") return { text: "Opposition Day Bill", cls: "badge-opposition" };
    return { text: "PMB", cls: "badge-pmb" };
  }

  /* =========================
     ORDER PAPER render
     ========================= */
  function renderOrderPaper(data) {
    const el = document.getElementById("order-paper");
    if (!el) return;

    // Bills come from state
    let bills = Array.isArray(data.orderPaperCommons) ? data.orderPaperCommons : [];

    // Ensure defaults + run amendments + run lifecycle
    bills = bills.map(b => {
      ensureBillDefaults(b);
      processAmendments(b);
      processBillLifecycle(data, b);
      return b;
    });

    // Save updates back to storage
    data.orderPaperCommons = bills;
    saveData(data);

    // Filter: show in-progress always; completed until next Sunday roll removes
    bills = bills.filter(b => {
      if (!isCompleted(b)) return true;
      return !shouldArchiveOffOrderPaperToday(b);
    });

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
            : `<div class="bill-current">Current Stage: <b>${b.stage}</b></div>`;

          const timerLine = (!isCompleted(b) && t.label)
            ? `<div class="timer"><div class="kv"><span>${t.label}</span><b>${msToDHM(t.msRemaining)}</b></div></div>`
            : ``;

          return `
            <div class="bill-card ${b.status}">
              <div class="bill-title">${safe(b.title, "Untitled Bill")}</div>
              <div class="bill-sub">Author: ${safe(b.author, "—")} · ${safe(b.department, "—")}</div>

              <div class="badges">
                <span class="bill-badge ${badge.cls}">${badge.text}</span>
              </div>

              <div class="stage-track">
                ${STAGE_ORDER.map(s => `<div class="stage ${b.stage === s ? "on" : ""}">${s}</div>`).join("")}
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

  /* =========================
     HANSARD render
     ========================= */
  function renderHansard(data) {
    const passedEl = document.getElementById("hansard-passed");
    const failedEl = document.getElementById("hansard-failed");
    if (!passedEl && !failedEl) return;

    const bills = Array.isArray(data.orderPaperCommons) ? data.orderPaperCommons : [];
    const passed = bills.filter(b => b.status === "passed");
    const failed = bills.filter(b => b.status === "failed");

    function renderList(list, emptyText) {
      if (!list.length) return `<div class="muted-block">${emptyText}</div>`;
      return `
        <div class="order-grid">
          ${list.map(b => `
            <div class="bill-card ${b.status}">
              <div class="bill-title">${safe(b.title, "Untitled")}</div>
              <div class="bill-sub">Author: ${safe(b.author, "—")} · ${safe(b.department, "—")}</div>

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
     ABSENCE UI (safe renderer)
     - This does not implement vote delegation logic fully;
       it only renders current state without breaking.
     ========================= */
  function renderAbsenceUI(data) {
    const container = document.getElementById("absence-ui");
    if (!container) return;

    const players = Array.isArray(data.players) ? data.players : [];
    const current = data.currentPlayer || {};
    const me = players.find(p => p.name === current.name);
    if (!me) {
      container.innerHTML = `<div class="muted-block">No player profile loaded.</div>`;
      return;
    }

    container.innerHTML = `
      <div class="kv">
        <span>Status:</span>
        <b>${me.absent ? "Absent" : "Active"}</b>
      </div>
      <div class="muted-block" style="margin-top:10px;">
        Absence controls will live here (Mark absent / Return active / Delegate if leader).
      </div>
    `;
  }

  /* =========================
     SUBMIT BILL PAGE (Phase 1)
     - This only INITIALISES if the page contains
       #legislation-builder or #billForm
     - It saves bills into rb_full_data.orderPaperCommons
     ========================= */
  function initSubmitBillPage(data) {
    const builder = document.getElementById("legislation-builder");
    const simpleForm = document.getElementById("billForm");

    if (!builder && !simpleForm) return;

    // Ensure tracker exists
    data.oppositionTracker = data.oppositionTracker || {};
    saveData(data);

    if (builder) {
      renderLegislationBuilder(data);
      generateArticles(); // initial
    }

    if (simpleForm) {
      // If you still have an older simple form, keep it safe and working:
      simpleForm.addEventListener("submit", (e) => {
        e.preventDefault();
        alert("This page uses the structured builder now. Use the fields provided.");
      });
    }
  }

  function generatePreamble(data) {
    const gender = (data.adminSettings?.monarchGender || "Queen").toLowerCase();
    const majesty = (gender === "queen") ? "the Queen’s" : "the King’s";
    return `Be it enacted by ${majesty} most Excellent Majesty, by and with the advice and consent of the Lords Spiritual and Temporal, and Commons, in this present Parliament assembled, and by the authority of the same, as follows:—`;
  }

  // Renders the structured bill builder into #legislation-builder
  function renderLegislationBuilder(data) {
    const container = document.getElementById("legislation-builder");
    if (!container) return;

    const current = data.currentPlayer || {};
    const sim = getCurrentSimDate(data);
    const simYear = sim.year;

    const isLOTO = current.role === "leader-opposition";
    const usedOpp = Number(data.oppositionTracker[String(simYear)] || 0);
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

    // Generate articles on change
    const articleCountEl = document.getElementById("articleCount");
    if (articleCountEl) {
      articleCountEl.addEventListener("change", generateArticles);
    }

    // Submit handler
    const btn = document.getElementById("submitStructuredBillBtn");
    if (btn) {
      btn.addEventListener("click", () => submitStructuredBill());
    }
  }

  // Expose generateArticles to this script scope safely
  function generateArticles() {
    const countEl = document.getElementById("articleCount");
    const container = document.getElementById("articlesContainer");
    if (!countEl || !container) return;

    const count = parseInt(countEl.value, 10);
    container.innerHTML = "";

    for (let i = 1; i <= count; i++) {
      container.innerHTML += `
        <div class="article-block" style="margin-bottom:14px;">
          <label>Article ${i} Heading</label>
          <input id="articleHeading${i}" placeholder="Heading..." />

          <label>Article ${i} Body</label>
          <textarea id="articleBody${i}" rows="4" placeholder="Text of Article ${i}..."></textarea>
        </div>
      `;
    }
  }

  // Create + store bill object into rb_full_data.orderPaperCommons
  function submitStructuredBill() {
    let data = getData();
    if (!data) return;

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

    // Collect articles
    let articlesText = "";
    for (let i = 1; i <= articleCount; i++) {
      const heading = (document.getElementById(`articleHeading${i}`)?.value || "").trim();
      const body = (document.getElementById(`articleBody${i}`)?.value || "").trim();
      if (!heading || !body) return alert(`Article ${i} must have both heading and body.`);

      articlesText += `Article ${i} — ${heading}\n${body}\n\n`;
    }

    // Opposition bill checkbox (LOTO only)
    const isOpp = document.getElementById("oppositionDay")?.checked || false;

    // Opposition quota
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

    // Sunday submission rule: if submitted Sunday, First Reading starts Monday 00:00
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

    // If opposition bill, increment quota usage
    if (isOpp) {
      data.oppositionTracker[String(year)] = used + 1;
    }

    data.orderPaperCommons = Array.isArray(data.orderPaperCommons) ? data.orderPaperCommons : [];
    data.orderPaperCommons.unshift(newBill);

    saveData(data);

    // Back to office
    location.href = "dashboard.html";
  }

  /* =========================
     Live refresh for countdowns
     ========================= */
  function startLiveRefresh(data) {
    // Only refresh if these parts exist
    const hasOrder = !!document.getElementById("order-paper");
    const hasDocket = !!document.getElementById("live-docket");
    const hasSim = !!document.getElementById("sim-date-display");

    if (!hasOrder && !hasDocket && !hasSim) return;

    setInterval(() => {
      const latest = getData();
      if (!latest) return;

      if (hasSim) renderSimDate(latest);
      if (hasDocket) renderLiveDocket(latest);
      if (hasOrder) renderOrderPaper(latest);
    }, 1000);
  }

})();
