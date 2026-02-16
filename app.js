/* =========================================================
   Rule Britannia — app.js (CLEAN BASELINE)
   - Loads demo.json once
   - Uses localStorage rb_full_data as the live state
   - Dashboard: Sim Date + What's Going On + Live Docket + Order Paper
   - Hansard: passed/failed archive
   - Game Clock: 3 real days = 1 sim month; Sundays frozen
   - Bill lifecycle + countdown timers
   - Amendment engine (support window + division)
   - Submit Bill builder (structured template)
   - Party Draft builder (saved to localStorage)
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
    return String(str)
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
// ===== Amendment actions (mutate rb_full_data safely) =====

function rbUpdateBill(billId, updaterFn){
  const data = getData();
  if (!data) return null;

  data.orderPaperCommons = Array.isArray(data.orderPaperCommons) ? data.orderPaperCommons : [];
  const bill = data.orderPaperCommons.find(b => b.id === billId);
  if (!bill) return null;

  ensureBillDefaults(bill);
  bill.amendments = Array.isArray(bill.amendments) ? bill.amendments : [];

  updaterFn(bill, data);

  // re-process after change
  processAmendments(bill);

  saveData(data);
  return { data, bill };
}

function rbProposeAmendment(billId, { articleNumber, type, text, proposedBy }){
  return rbUpdateBill(billId, (bill) => {
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
    if (amend.division.voters.includes(voterName)) return; // one vote per person

    // count vote
    if (!amend.division.votes) amend.division.votes = { aye:0, no:0, abstain:0 };
    if (vote === "aye") amend.division.votes.aye++;
    else if (vote === "no") amend.division.votes.no++;
    else amend.division.votes.abstain++;

    amend.division.voters.push(voterName);
  });
}

  /* =========================
     Boot
     ========================= */
  fetch(DATA_URL)
    .then(r => r.json())
    .then((demo) => {
      // Seed live state if missing
      let data = getData();
      if (!data) {
        data = demo;
        normaliseData(data);
        saveData(data);
      } else {
        // Keep some "static tiles" updated from demo if you want
        data.whatsGoingOn = data.whatsGoingOn || demo.whatsGoingOn || {};
        data.liveDocket = data.liveDocket || demo.liveDocket || {};
        normaliseData(data);
        saveData(data);
      }

      // Render page parts (only where elements exist)
      initNavUI();
      renderSimDate(data);
      renderWhatsGoingOn(data);
      renderLiveDocket(data);
      renderOrderPaper(data);
      renderHansard(data);
      renderQuestionTime(data);
      renderSundayRollDisplay();
      renderAbsenceUI(data);
      renderQuestionTime(data);


      initSubmitBillPage(data);
      initPartyDraftPage(data);

      // Live refresh for countdowns / docket
      startLiveRefresh();
    })
    .catch(err => console.error("Error loading demo.json:", err));

  function normaliseData(data) {
    data.players = Array.isArray(data.players) ? data.players : [];
    data.orderPaperCommons = Array.isArray(data.orderPaperCommons) ? data.orderPaperCommons : [];
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
  }

     /* =========================
     QUESTION TIME (Tiles + Office view)
     Renders into: #qt-root (questiontime.html)
     Uses URL param: ?office=pmqs (etc)
     ========================= */

  function getQTOfficeParam(){
    const p = new URLSearchParams(location.search);
    return p.get("office");
  }

  // If demo.json later includes data.questionTime.offices, we’ll use it.
  // For now we provide a solid default list so the UI is never “plain text”.
  function getDefaultOffices(){
    return [
      {
        id: "pmqs",
        title: "Prime Minister, First Lord of the Treasury, and Minister for the Civil Service",
        short: "PMQs",
        rules: [
          "Backbenchers: 1 outstanding question to the PM.",
          "Backbenchers: 3 outstanding total across all ministers.",
          "Leader of the Opposition: 3 follow-ups.",
          "3rd/4th party leaders: 2 follow-ups.",
          "Backbenchers: 1 follow-up."
        ]
      },
      { id:"treasury", title:"Chancellor of the Exchequer, and Second Lord of the Treasury", short:"Treasury Questions", rules:["Standard Question Time rules apply."] },
      { id:"fco", title:"Secretary of State for Foreign and Commonwealth Affairs", short:"FCO Questions", rules:["Standard Question Time rules apply."] },
      { id:"trade", title:"Secretary of State for Business and Trade, and President of the Board of Trade", short:"Trade Questions", rules:["Standard Question Time rules apply."] },
      { id:"defence", title:"Secretary of State for Defence", short:"Defence Questions", rules:["Standard Question Time rules apply."] },
      { id:"welfare", title:"Secretary of State for Work and Pensions", short:"Welfare Questions", rules:["Standard Question Time rules apply."] },
      { id:"education", title:"Secretary of State for Education", short:"Education Questions", rules:["Standard Question Time rules apply."] },
      { id:"environment", title:"Secretary of State for the Environment and Agriculture", short:"Environment & Agriculture", rules:["Standard Question Time rules apply."] },
      { id:"health", title:"Secretary of State for Health and Social Security", short:"Health Questions", rules:["Standard Question Time rules apply."] },
      { id:"eti", title:"Secretary of State for the Environment, Transport and Infrastructure", short:"ETI Questions", rules:["Standard Question Time rules apply."] },
      { id:"culture", title:"Secretary of State for Culture, Media and Sport", short:"Culture Questions", rules:["Standard Question Time rules apply."] },
      { id:"homenations", title:"Secretary of State for the Home Nations", short:"Home Nations Questions", rules:["Standard Question Time rules apply."] },
      { id:"commonsbiz", title:"Leader of the House of Commons", short:"Commons Business Questions", rules:["Standard Question Time rules apply."] }
    ];
  }

  function getQuestionTimeState(data){
    data.questionTime = data.questionTime || {};
    data.questionTime.questions = Array.isArray(data.questionTime.questions) ? data.questionTime.questions : [];
    return data.questionTime;
  }

  function renderQuestionTime(data){
    const root = document.getElementById("qt-root");
    if (!root) return;

    const qt = getQuestionTimeState(data);

    // Offices: prefer demo.json structure if it exists, else defaults
    const offices =
      Array.isArray(qt.offices) && qt.offices.length
        ? qt.offices
        : getDefaultOffices();

    const officeId = getQTOfficeParam();
    const selected = officeId ? offices.find(o => o.id === officeId) : null;

    if (!selected){
      // Tile hub
      root.innerHTML = `
        <div class="muted-block">
          Choose an office to submit questions and view answered/closed questions.
          (Moderators will validate and close questions.)
        </div>

        <div class="qt-grid">
          ${offices.map(o => `
            <div class="qt-card">
              <div class="qt-title">${escapeHtml(o.short || o.title)}</div>
              <div class="qt-sub">${escapeHtml(o.title)}</div>
              <div class="qt-actions">
                <a class="btn" href="questiontime.html?office=${encodeURIComponent(o.id)}">Open</a>
              </div>
            </div>
          `).join("")}
        </div>
      `;
      return;
    }
/* =========================
   QUESTION TIME (tiles + office view)
   Renders into: #qt-root
   Uses rb_full_data.questionTime (falls back to demo-seeded state)
   ========================= */
function renderQuestionTime(data){
  const root = document.getElementById("qt-root");
  if (!root) return;

  const params = new URLSearchParams(location.search);
  const officeSlug = params.get("office"); // if present -> office view

  const qt = data.questionTime || {};
  const offices = Array.isArray(qt.cabinet) ? qt.cabinet : [];
  const questions = Array.isArray(qt.questions) ? qt.questions : [];

  // If no office specified, show entry tiles
  if (!officeSlug){
    if (!offices.length){
      root.innerHTML = `<div class="muted-block">No offices configured yet.</div>`;
      return;
    }

    root.innerHTML = `
      <div class="qt-grid">
        ${offices.map(o => {
          const openCount = questions.filter(q => q.office === o.slug && q.status === "open").length;
          const answeredCount = questions.filter(q => q.office === o.slug && q.status === "answered").length;

          return `
            <div class="qt-tile">
              <div class="qt-kicker">${escapeHtml(o.type === "pmqs" ? "PMQs" : "Departmental Questions")}</div>
              <div class="qt-title">${escapeHtml(o.title)}</div>
              <div class="qt-strap">
                Open: <b>${openCount}</b> · Answered: <b>${answeredCount}</b>
              </div>
              <div class="qt-actions">
                <a class="btn" href="questiontime.html?office=${encodeURIComponent(o.slug)}">Open</a>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
    return;
  }
function initBillPage(data){
  const el = document.getElementById("bill-amendments");
  if (!el) return;

  const params = new URLSearchParams(location.search);
  const billId = params.get("id");
  if (!billId) {
    el.innerHTML = `<div class="muted-block">No bill selected.</div>`;
    return;
  }

  const bill = (data.orderPaperCommons || []).find(b => b.id === billId);
  if (!bill) {
    el.innerHTML = `<div class="muted-block">Bill not found.</div>`;
    return;
  }

  ensureBillDefaults(bill);
  processAmendments(bill);

  const me = data.currentPlayer || {};
  const myName = me.name || "Unknown";
  const myParty = me.party || "Unknown";

  // simple leader detection (your existing rule)
  const isLeader = (p) => p.partyLeader === true || p.role === "leader-opposition" || p.role === "prime-minister";
  const meObj = (data.players || []).find(p => p.name === myName) || me;
  const leader = isLeader(meObj);

  // render propose form + list
  const amendments = Array.isArray(bill.amendments) ? bill.amendments : [];

  el.innerHTML = `
    <div class="muted-block">
      <b>Rules:</b> 24 active hours for leader support (2 parties). If supported, 24 active hours division. Sundays frozen.
    </div>

    <div style="margin-top:12px;">
      <h3 style="margin:0 0 8px;">Propose an Amendment</h3>
      <div class="muted-block">Demo UI: this saves into localStorage for now.</div>

      <form id="amendForm" style="margin-top:12px;">
        <div class="form-grid">
          <label>Article</label>
          <input id="amArticle" type="number" min="1" value="1" />

          <label>Type</label>
          <select id="amType">
            <option value="replace">Replace</option>
            <option value="insert">Insert</option>
            <option value="delete">Delete</option>
          </select>

          <label>Text</label>
          <textarea id="amText" rows="4" placeholder="Write the amendment text…"></textarea>

          <button class="btn" type="submit">Submit Amendment</button>
        </div>
      </form>
    </div>

    <div style="margin-top:18px;">
      <h3 style="margin:0 0 8px;">Current Amendments</h3>
      ${!amendments.length ? `<div class="muted-block">No amendments yet.</div>` : `
        <div class="docket-list">
          ${amendments.map(a => {
            const supportLeft = a.supportDeadlineAt ? Math.max(0, a.supportDeadlineAt - Date.now()) : 0;
            const divisionLeft = a.division?.closesAt ? Math.max(0, a.division.closesAt - Date.now()) : 0;

            const supporters = (a.supporters || []).join(", ") || "None";

            let actions = "";
            if (a.status === "proposed"){
              actions = `
                <div class="small">Supporters: <b>${supporters}</b></div>
                <div class="small">Support window: <b>${msToHMS(supportLeft)}</b></div>
                ${leader && !(a.supporters||[]).includes(myParty)
                  ? `<div style="margin-top:10px;"><button class="btn" data-support="${a.id}">Support as ${myParty}</button></div>`
                  : ``}
              `;
            } else if (a.status === "division" && a.division && !a.division.closed){
              actions = `
                <div class="small">Division closes in: <b>${msToHMS(divisionLeft)}</b></div>
                <div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap;">
                  <button class="btn" data-vote="aye" data-am="${a.id}">Aye</button>
                  <button class="btn" data-vote="no" data-am="${a.id}">No</button>
                  <button class="btn" data-vote="abstain" data-am="${a.id}">Abstain</button>
                </div>
              `;
            } else {
              actions = `
                <div class="small"><b>Status:</b> ${a.status.toUpperCase()}</div>
                ${a.failedReason ? `<div class="small"><b>Reason:</b> ${a.failedReason}</div>` : ``}
              `;
            }

            return `
              <div class="docket-item ${a.status === "division" ? "high" : ""}">
                <div class="docket-left">
                  <div class="docket-icon">🧾</div>
                  <div class="docket-text">
                    <div class="docket-title">Article ${a.articleNumber} · ${a.type}</div>
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

  // wire propose
  const form = document.getElementById("amendForm");
  if (form){
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const articleNumber = document.getElementById("amArticle").value;
      const type = document.getElementById("amType").value;
      const text = document.getElementById("amText").value.trim();
      if (!text) return alert("Amendment text required.");

      rbProposeAmendment(billId, { articleNumber, type, text, proposedBy: myName });
      location.reload();
    });
  }

  // wire support buttons
  el.querySelectorAll("[data-support]").forEach(btn => {
    btn.addEventListener("click", () => {
      const amendId = btn.getAttribute("data-support");
      rbSupportAmendment(billId, amendId, myParty);
      location.reload();
    });
  });

  // wire votes
  el.querySelectorAll("[data-vote]").forEach(btn => {
    btn.addEventListener("click", () => {
      const vote = btn.getAttribute("data-vote");
      const amendId = btn.getAttribute("data-am");
      rbVoteAmendment(billId, amendId, myName, vote);
      location.reload();
    });
  });
}

  // Office view
  const officeObj = offices.find(o => o.slug === officeSlug) || null;
  if (!officeObj){
    root.innerHTML = `
      <div class="muted-block">
        Unknown office. <a class="btn" href="questiontime.html" style="margin-left:10px;">Back to Question Time</a>
      </div>
    `;
    return;
  }

  const isPM = officeObj.slug === "prime-minister" || officeObj.type === "pmqs";

  const rulesHtml = isPM ? `
    <b>PMQs</b><br>
    • Backbenchers: max <b>1 outstanding</b> question to the PM.<br>
    • Backbenchers: max <b>3 outstanding total</b> across all ministers.<br>
    • Leader of the Opposition: <b>3</b> follow-ups.<br>
    • 3rd/4th party leaders: <b>2</b> follow-ups.<br>
    • Backbenchers: <b>1</b> follow-up.
  ` : `
    <b>Departmental Questions</b><br>
    • Shadows: <b>2</b> follow-ups (matching portfolio only).<br>
    • Backbenchers: <b>1</b> follow-up to any Secretary/Minister.
  `;

  const list = questions.filter(q => q.office === officeObj.slug);

  root.innerHTML = `
    <div class="qt-office-header">
      <div>
        <div class="qt-kicker">Question Time</div>
        <div class="qt-title">${escapeHtml(officeObj.title)}</div>
      </div>
      <div>
        <a class="btn" href="questiontime.html">Back to Question Time</a>
      </div>
    </div>

    <div class="muted-block">${rulesHtml}</div>

    <div class="panel" style="margin-top:12px;">
      <h2 style="margin:0 0 10px;">Submit a Question</h2>
      <div class="muted-block">Demo-only form (no login yet). Later this will enforce limits automatically.</div>

      <form id="qtForm" class="qt-form">
        <div class="qt-field">
          <label>Asked By</label>
          <input id="askedBy" type="text" placeholder="e.g. Dale Weston MP" value="${escapeHtml(safe(data.currentPlayer?.name,""))}">
        </div>

        <div class="qt-field">
          <label>Role</label>
          <select id="askedRole">
            <option value="backbencher">Backbencher</option>
            <option value="leader-opposition">Leader of the Opposition</option>
            <option value="party-leader-3rd-4th">3rd/4th Party Leader</option>
            <option value="shadow">Shadow Secretary/Minister</option>
          </select>
        </div>

        <div class="qt-field qt-wide">
          <label>Question</label>
          <textarea id="questionText" rows="4" placeholder="Type your question…"></textarea>
        </div>

        <div class="qt-wide" style="display:flex; gap:10px; justify-content:flex-end;">
          <button class="btn" type="submit">Submit Question</button>
        </div>
      </form>
    </div>

    <div class="panel" style="margin-top:12px;">
      <h2 style="margin:0 0 10px;">Questions</h2>
      ${!list.length ? `<div class="muted-block">No questions yet.</div>` : `
        ${list.map(q => `
          <div class="qt-q">
            <div class="qt-qtop">
              <div><b>${escapeHtml(safe(q.askedBy,"Unknown"))}</b></div>
              <span class="tag ${escapeHtml(safe(q.status,"open"))}">${escapeHtml(safe(q.status,"open"))}</span>
            </div>
            <div class="qt-qtext">${escapeHtml(safe(q.text,""))}</div>
            ${q.answer ? `<div class="qt-answer"><b>Answer:</b> ${escapeHtml(q.answer)}</div>` : ``}
            <div class="qt-qmeta"><span>Office:</span> <b>${escapeHtml(officeObj.title)}</b></div>
          </div>
        `).join("")}
      `}
    </div>
  `;

  // Demo-only submit (no persistence yet)
  const form = document.getElementById("qtForm");
  if (form){
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      alert("Submitted (demo). Next step: save into rb_full_data.questionTime.questions.");
    });
  }
}

    // Office view
    const questions = (qt.questions || []).filter(q => q.officeId === selected.id);

    root.innerHTML = `
      <div class="bill-actions" style="margin-bottom:10px;">
        <a class="btn" href="questiontime.html">← Back to Question Time</a>
      </div>

      <h2 style="margin:0 0 10px;">${escapeHtml(selected.title)}</h2>

      <div class="muted-block">
        <b>Rules Summary</b>
        <ul style="margin:8px 0 0; padding-left:18px;">
          ${(selected.rules || ["Standard Question Time rules apply."]).map(r => `<li>${escapeHtml(r)}</li>`).join("")}
        </ul>
      </div>

      <div style="height:12px"></div>

      <div class="panel" style="margin:0; box-shadow:none;">
        <h2>Submit a Question</h2>
        <div class="muted-block">Demo-only form (no login yet). Later this will enforce eligibility and limits automatically.</div>

        <div style="height:10px"></div>

        <div class="form-grid">
          <label>Asked By</label>
          <input id="qtAskedBy" placeholder="e.g. Dale Weston MP" value="${escapeHtml(safe(data.currentPlayer?.name,""))}"/>

          <label>Role</label>
          <select id="qtRole">
            <option value="backbencher">Backbencher</option>
            <option value="leader-opposition">Leader of the Opposition</option>
            <option value="party-leader">3rd/4th Party Leader</option>
            <option value="minister">Minister</option>
          </select>

          <label>Question</label>
          <textarea id="qtText" rows="4" placeholder="Type your question..."></textarea>

          <button class="btn" id="qtSubmitBtn" type="button">Submit Question</button>
        </div>
      </div>

      <div style="height:16px"></div>

      <h2 style="margin:0 0 10px;">Questions</h2>
      ${questions.length ? `
        <div class="docket-list">
          ${questions.map(q => `
            <div class="docket-item">
              <div class="docket-left">
                <div class="docket-icon">❓</div>
                <div class="docket-text">
                  <div class="docket-title">${escapeHtml(safe(q.askedBy,"Unknown"))} submitted</div>
                  <div class="docket-detail">${escapeHtml(safe(q.text,""))}</div>
                  <div class="small" style="margin-top:6px;">
                    Status: <b>${escapeHtml(safe(q.status,"open"))}</b>
                    ${q.createdAt ? ` · ${new Date(q.createdAt).toLocaleString()}` : ``}
                  </div>
                </div>
              </div>
              <div class="docket-cta">
                <span class="small">${escapeHtml(selected.short || "Question Time")}</span>
              </div>
            </div>
          `).join("")}
        </div>
      ` : `<div class="muted-block">No questions for this office yet.</div>`}
    `;

    // Wire submit
    const btn = document.getElementById("qtSubmitBtn");
    if (btn){
      btn.addEventListener("click", () => {
        const latest = getData();
        if (!latest) return;

        const qtState = getQuestionTimeState(latest);

        const askedBy = (document.getElementById("qtAskedBy")?.value || "").trim();
        const role = (document.getElementById("qtRole")?.value || "backbencher").trim();
        const text = (document.getElementById("qtText")?.value || "").trim();

        if (!askedBy) return alert("Asked By is required.");
        if (!text) return alert("Question text is required.");

        qtState.questions.unshift({
          id: "qt-" + nowTs(),
          officeId: selected.id,
          askedBy,
          role,
          text,
          status: "open",
          createdAt: nowTs()
        });

        latest.questionTime = qtState;
        saveData(latest);

        // Re-render with updated state
        renderQuestionTime(latest);
      });
    }
  }

  /* =========================
     NAV
     ========================= */
  function initNavUI() {
    const current = location.pathname.split("/").pop() || "dashboard.html";

    // Highlight active link (including dropdown children)
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

    // Dropdown open/close
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
     BILL ENGINE
     ========================= */
  const STAGE_ORDER = ["First Reading", "Second Reading", "Report Stage", "Division"];
  const STAGE_LENGTH_SIM_MONTHS = { "Second Reading": 2, "Report Stage": 1, "Division": 1 };

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

    // Division closes by voting UI (bill page). Engine just holds it.
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
      const end = addValidDaysSkippingSundays(new Date(bill.stageStartedAt).getTime(), 3); // 1 sim month
      return { label: isSunday() ? "Polling Day — clock frozen" : "Division closes in", msRemaining: end - now };
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
   Rules:
   - Proposed -> support window (24 active hours)
   - If <2 party leaders support by deadline -> failed
   - If >=2 support -> division opens (24 active hours)
   - Division auto-closes on deadline (tie fails)
   - Sunday freezes expiry/closure
   - Logs to bill.hansard.amendments
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

  // prevent duplicates
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

function billHasOpenAmendmentDivision(bill) {
  return (bill.amendments || []).some(a =>
    a.status === "division" && a.division && a.division.closed !== true
  );
}

function processAmendments(bill) {
  if (!Array.isArray(bill.amendments)) bill.amendments = [];

  // Sunday freeze: do not expire windows, do not close divisions
  if (isSunday()) return bill;

  const now = Date.now();

  bill.amendments.forEach(amend => {
    ensureAmendmentDefaults(amend);

    // Set support deadline once
    if (!amend.supportDeadlineAt) {
      const submitted = amend.submittedAt ? new Date(amend.submittedAt).getTime() : now;
      amend.supportDeadlineAt = addActiveHoursSkippingSundays(submitted, 24);
    }

    // Proposed -> fail if deadline passes and <2 supporters
    if (amend.status === "proposed") {
      const supporters = amend.supporters || [];
      if (now > amend.supportDeadlineAt && supporters.length < 2) {
        amend.status = "failed";
        amend.failedReason = "Insufficient leader support within 24 active hours.";
        logHansardAmendment(bill, amend, "failed");
      }
    }

    // Proposed -> if >=2 supporters -> open division
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

    // Division -> close if deadline passed
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
     Live Docket (personalised)
     + adds amendment items automatically
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
    return playerObj.partyLeader === true || playerObj.role === "leader-opposition" || playerObj.role === "prime-minister";
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
        // Author decision items (placeholder for when you wire accept/reject UI)
        if (amend.status === "proposed" && bill.author === me.name) {
          items.push({
            type: "amendment",
            title: "Amendment awaiting your decision",
            detail: `Bill: ${bill.title}`,
            ctaLabel: "Open",
            href: `bill.html?id=${encodeURIComponent(bill.id)}`,
            priority: "high"
          });
        }

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
          As of: <b>${safe(docket.asOf, "now")}</b> · Logged in as: <b>${safe(player.name,"Unknown")}</b> (${safe(player.role,"—")})
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
              <a class="btn" href="${safe(it.href, "#")}">${escapeHtml(safe(it.ctaLabel, "Open"))}</a>
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
processAmendments(b);         // ✅ must be here
processBillLifecycle(data, b);
return b;

    });

    // Save lifecycle/amendment changes
    data.orderPaperCommons = bills;
    saveData(data);

    // Filter for Order Paper
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
     Party Draft Page
     (requires specific HTML IDs)
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
          alert(d.billText); // novice-friendly phase 1: view in alert (next step: dedicated panel)
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
     Live refresh
     ========================= */
  function startLiveRefresh() {
    const needsRefresh =
      document.getElementById("order-paper") ||
      document.getElementById("live-docket") ||
      document.getElementById("sim-date-display");

    if (!needsRefresh) return;

    setInterval(() => {
      const latest = getData();
      if (!latest) return;

      renderSimDate(latest);
      renderLiveDocket(latest);
      renderOrderPaper(latest);
    }, 1000);
  }

})();
/* =========================
   ABSENCE SYSTEM (WORKING)
   - Renders into: <div id="absence-ui"></div>
   - Stores changes in localStorage rb_full_data
   ========================= */

function rbGetData() {
  const raw = localStorage.getItem("rb_full_data");
  return raw ? JSON.parse(raw) : null;
}

function rbSaveData(data) {
  localStorage.setItem("rb_full_data", JSON.stringify(data));
}

function renderAbsenceUI(dataFromBoot) {
  const container = document.getElementById("absence-ui");
  if (!container) return;

  // Always prefer latest stored state
  const data = rbGetData() || dataFromBoot || {};
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
    rbSaveData(data);
    renderAbsenceUI(data);
  }

  function setAbsent(value) {
    me.absent = !!value;

    if (me.absent) {
      // Non-leader auto delegates to party leader
      if (!me.partyLeader && partyLeader) {
        me.delegatedTo = partyLeader.name;
      }

      // Leader must choose manually
      if (me.partyLeader) {
        me.delegatedTo = me.delegatedTo || null;
      }
    } else {
      // Returning active clears delegation
      me.delegatedTo = null;
    }

    saveAndRerender();
  }

  function setLeaderDelegation(name) {
    me.delegatedTo = name || null;
    saveAndRerender();
  }

  // Expose for inline onclick (simple)
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
          Your vote is delegated to: <b>${target ? target : "No party leader set"}</b>
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
            <option value="${p.name}" ${me.delegatedTo === p.name ? "selected" : ""}>${p.name}</option>
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
    <div class="kv"><span>Status:</span><b>${statusLine}</b></div>
    <div class="kv"><span>Party:</span><b>${party}</b></div>

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

