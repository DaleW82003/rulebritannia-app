/* =========================================================
   Rule Britannia — app.js (STABLE + MATCHES YOUR HTML IDS)
   - Loads demo.json once, then stores/uses localStorage rb_full_data
   - Renders into YOUR IDs:
     News: bbcSimDate, bbcBreakingPanel, bbcBreakingTicker, bbcMainNews, bbcFlavourNews, bbcArchive, bbcNewStoryBtn
     Dashboard: sim-date-display, whats-going-on, live-docket, order-paper
     Question Time: question-time-root (also supports qt-root)
     Papers: papersSimDate, papersGrid, paperReaderPanel, paperReader
     Constituencies: parliament-summary, party-constituencies (also supports constituenciesRoot)
     Bodies: bodies-root (also supports bodiesRoot)
     User: user-account, user-controlpanel (also supports userRoot)
     Bills: bill.html elements (billTitle, billMeta, billText, bill-amendments)
   ========================================================= */

(() => {
  "use strict";

  const DATA_URL = "data/demo.json";
  const LS_KEY = "rb_full_data";

  /* ---------- helpers ---------- */
  const nowTs = () => Date.now();
  const safe = (v, fallback = "") => (v === null || v === undefined ? fallback : v);

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

  /* ---------- storage ---------- */
  function getData() {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  }
  function saveData(data) {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  }

  /* ---------- time: skip Sundays; 3 valid days = 1 sim month ---------- */
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
    const gs = data.gameState || { started:false };
    if (!gs.started) return 0;
    if (gs.isPaused === true) return 0;

    const start = new Date(gs.startRealDate).getTime();
    const now = nowTs();
    const realDays = Math.floor((now - start) / 86400000);
    const sundays = countSundaysBetween(start, now);
    const validDays = Math.max(0, realDays - sundays);

    return Math.floor(validDays / 3);
  }

  function getCurrentSimDate(data) {
    const gs = data.gameState || {};
    const monthsPassed = getSimMonthIndex(data);

    const startMonthIndex = (gs.startSimMonth || 8) - 1;
    const startYear = gs.startSimYear || 1997;

    const totalMonths = startMonthIndex + monthsPassed;
    const year = startYear + Math.floor(totalMonths / 12);
    const month = (totalMonths % 12) + 1;

    return { month, year };
  }

  function getSimMonthYearLabel(data){
    const sim = getCurrentSimDate(data);
    return `${getMonthName(sim.month)} ${sim.year}`;
  }

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

  /* ---------- NAV dropdowns ---------- */
  function initNavUI() {
    const current = location.pathname.split("/").pop() || "dashboard.html";

    document.querySelectorAll(".nav a").forEach(link => {
      const href = link.getAttribute("href");
      if (!href) return;
      if (href.startsWith("http")) return;
      if (href === current) {
        link.classList.add("active");
        const group = link.closest(".nav-group");
        if (group) group.querySelector(".nav-toggle")?.classList.add("active");
      }
    });

    const groups = Array.from(document.querySelectorAll(".nav-group"));
    const toggles = Array.from(document.querySelectorAll(".nav-toggle"));
    toggles.forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        groups.forEach(g => { if (g !== btn.parentElement) g.classList.remove("open"); });
        btn.parentElement.classList.toggle("open");
      });
    });
    document.addEventListener("click", () => groups.forEach(g => g.classList.remove("open")));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") groups.forEach(g => g.classList.remove("open")); });
  }

  /* ---------- normalise base data so pages never go blank ---------- */
  function normaliseData(data) {
    data.players = Array.isArray(data.players) ? data.players : [];
    data.orderPaperCommons = Array.isArray(data.orderPaperCommons) ? data.orderPaperCommons : [];
    data.whatsGoingOn = data.whatsGoingOn || {};
    data.liveDocket = data.liveDocket || { items: [] };

    data.gameState = data.gameState || {
      started: true,
      isPaused: false,
      startRealDate: new Date().toISOString(),
      startSimMonth: 8,
      startSimYear: 1997
    };

    data.currentPlayer = data.currentPlayer || {
      name: "Unknown MP",
      party: "Labour",
      role: "backbencher",
      office: null,
      isSpeaker: false,
      partyLeader: false,
      permissions: { admin:false, mod:false, speaker:false }
    };

    data.parliament = data.parliament || {
      totalSeats: 650,
      parties: [
        { name: "Labour", seats: 418 },
        { name: "Conservative", seats: 165 },
        { name: "Liberal Democrat", seats: 46 },
        { name: "SNP", seats: 6 },
        { name: "Plaid Cymru", seats: 4 },
        { name: "DUP", seats: 2 },
        { name: "Sinn Féin", seats: 2 },
        { name: "SDLP", seats: 3 },
        { name: "UUP", seats: 10 }
      ]
    };

    // NEWS
    data.news = data.news || { items: [] };
    if (!Array.isArray(data.news.items)) data.news.items = [];
    // expected fields: headline, text, photo(optional), breaking(bool), category(str), flavour(bool), createdAt(ms), postedBy

    // PAPERS
    data.papers = data.papers || { fronts: {}, archive: {} };
    data.papers.fronts = data.papers.fronts || {};
    data.papers.archive = data.papers.archive || {};

    // QUESTION TIME
    data.questionTime = data.questionTime || {
      offices: [
        { id:"pm", title:"Prime Minister" },
        { id:"chancellor", title:"Chancellor of the Exchequer" },
        { id:"foreign", title:"Foreign Secretary" },
        { id:"home", title:"Home Secretary" }
      ],
      questions: []
    };

    // CONSTITUENCIES
    data.constituencies = data.constituencies || {
      lastUpdated: "August 1997",
      byParty: {
        "Labour": { "England": [], "Scotland": [], "Wales": [], "Northern Ireland": [] },
        "Conservative": { "England": [], "Scotland": [], "Wales": [], "Northern Ireland": [] },
        "Liberal Democrat": { "England": [], "Scotland": [], "Wales": [], "Northern Ireland": [] }
      }
    };

    // BODIES
    data.bodies = data.bodies || {
      items: [
        {
          id: "lords",
          name: "House of Lords",
          subtitle: "1997 (demo)",
          seats: [
            { name: "Conservative", seats: 300 },
            { name: "Labour", seats: 180 },
            { name: "Liberal Democrat", seats: 70 },
            { name: "Crossbench", seats: 220 },
            { name: "Bishops", seats: 26 }
          ]
        }
      ]
    };

    return data;
  }

  /* =========================================================
     DASHBOARD
     ========================================================= */

  function renderSimDate(data) {
    const el = document.getElementById("sim-date-display");
    if (!el) return;
    el.textContent = getSimMonthYearLabel(data);
  }

  function renderWhatsGoingOn(data) {
    const el = document.getElementById("whats-going-on");
    if (!el) return;

    const w = data.whatsGoingOn || {};
    const bbc = w.bbc || {};
    const papers = w.papers || {};
    const economy = w.economy || {};
    const pollingRaw = Array.isArray(w.polling) ? w.polling : [];

    const polling = pollingRaw
      .filter(p => (Number(p.value) >= 2) || p.party === "SNP")
      .sort((a,b) => Number(b.value) - Number(a.value));

    const pollingLines = polling.length
      ? polling.map(p => `<div class="row"><span>${escapeHtml(p.party)}</span><b>${Number(p.value).toFixed(1)}%</b></div>`).join("")
      : `<div class="wgo-strap">No polling yet.</div>`;

    el.innerHTML = `
      <div class="wgo-grid">
        <div class="wgo-tile">
          <div class="wgo-kicker">BBC News</div>
          <div class="wgo-title">${escapeHtml(safe(bbc.headline,"No headline yet."))}</div>
          <div class="wgo-strap">${escapeHtml(safe(bbc.strap,""))}</div>
          <div class="wgo-actions"><a class="btn" href="news.html">Open</a></div>
        </div>

        <div class="wgo-tile">
          <div class="wgo-kicker">Papers</div>
          <div class="wgo-title">${escapeHtml(safe(papers.paper,"Paper"))}: ${escapeHtml(safe(papers.headline,"No headline yet."))}</div>
          <div class="wgo-strap">${escapeHtml(safe(papers.strap,""))}</div>
          <div class="wgo-actions"><a class="btn" href="papers.html">View</a></div>
        </div>

        <div class="wgo-tile">
          <div class="wgo-kicker">Economy</div>
          <div class="wgo-metric">
            <div class="row"><span>Growth</span><b>${Number(safe(economy.growth,0)).toFixed(1)}%</b></div>
            <div class="row"><span>Inflation</span><b>${Number(safe(economy.inflation,0)).toFixed(1)}%</b></div>
            <div class="row"><span>Unemployment</span><b>${Number(safe(economy.unemployment,0)).toFixed(1)}%</b></div>
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

  function renderLiveDocket(data) {
    const el = document.getElementById("live-docket");
    if (!el) return;

    const items = Array.isArray(data.liveDocket?.items) ? data.liveDocket.items : [];

    if (!items.length) {
      el.innerHTML = `<div class="muted-block">No live items right now.</div>`;
      return;
    }

    el.innerHTML = `
      <div class="docket-list">
        ${items.map(x => `
          <div class="docket-item ${x.priority ? "high" : ""}">
            <div class="docket-left">
              <div class="docket-icon">${escapeHtml(safe(x.icon,"📌"))}</div>
              <div class="docket-text">
                <div class="docket-title">${escapeHtml(safe(x.title,"Untitled"))}</div>
                <div class="docket-detail">${escapeHtml(safe(x.detail,""))}</div>
              </div>
            </div>
            <div class="docket-actions">
              ${x.href ? `<a class="btn" href="${escapeHtml(x.href)}">Open</a>` : ``}
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderOrderPaper(data) {
    const el = document.getElementById("order-paper");
    if (!el) return;

    const bills = Array.isArray(data.orderPaperCommons) ? data.orderPaperCommons : [];

    if (!bills.length) {
      el.innerHTML = `<div class="muted-block">No bills on the Order Paper yet.</div>`;
      return;
    }

    el.innerHTML = `
      <div class="docket-list">
        ${bills.map(b => {
          const stage = safe(b.stage, "First Reading");
          const status = safe(b.status, "in-progress");
          const tag = status === "passed" ? "PASSED" : status === "failed" ? "FAILED" : stage.toUpperCase();
          return `
            <div class="docket-item">
              <div class="docket-left">
                <div class="docket-icon">📜</div>
                <div class="docket-text">
                  <div class="docket-title">${escapeHtml(safe(b.title,"Untitled Bill"))}</div>
                  <div class="docket-detail">${escapeHtml(safe(b.department,""))}</div>
                  <div class="small"><span class="tag cat">${escapeHtml(tag)}</span></div>
                </div>
              </div>
              <div class="docket-actions">
                <a class="btn" href="bill.html?id=${encodeURIComponent(b.id)}">Open</a>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  /* =========================================================
     NEWS (matches your news.html IDs)
     ========================================================= */

  function renderNewsPage(data) {
    const simEl = document.getElementById("bbcSimDate") || document.getElementById("newsSimDate");
    const breakingPanel = document.getElementById("bbcBreakingPanel");
    const breakingTicker = document.getElementById("bbcBreakingTicker") || document.getElementById("breakingTicker");
    const mainEl = document.getElementById("bbcMainNews");
    const flavourEl = document.getElementById("bbcFlavourNews");
    const archiveEl = document.getElementById("bbcArchive");
    const newBtn = document.getElementById("bbcNewStoryBtn");

    const isNewsPage = !!(simEl || breakingTicker || mainEl || flavourEl || archiveEl);
    if (!isNewsPage) return;

    const simLabel = getSimMonthYearLabel(data);
    if (simEl) simEl.textContent = simLabel;

    // show Post Story only for mods/admin/speaker (future)
    if (newBtn) {
      const p = data.currentPlayer || {};
      const perms = p.permissions || {};
      const canPost = perms.admin || perms.mod || perms.speaker;
      newBtn.style.display = canPost ? "inline-flex" : "none";
      if (canPost) {
        newBtn.onclick = () => alert("Posting UI comes next (Control Panel). For now, stories live in data.news.items.");
      }
    }

    const items = Array.isArray(data.news?.items) ? data.news.items : [];
    const now = nowTs();
    const LIVE_WINDOW_MS = 14 * 86400000;

    // split
    const live = [];
    const archive = [];
    for (const n of items) {
      const created = Number(n.createdAt || now);
      const age = now - created;
      (age <= LIVE_WINDOW_MS ? live : archive).push(n);
    }

    const breaking = live
      .filter(x => x.breaking === true)
      .sort((a,b) => Number(b.createdAt||0) - Number(a.createdAt||0));

    if (breakingTicker) {
      breakingTicker.textContent = breaking.length
        ? breaking.map(b => b.headline).join(" • ")
        : "No breaking news.";
    }
    if (breakingPanel) {
      breakingPanel.style.display = breaking.length ? "block" : "none";
    }

    const main = live
      .filter(x => x.flavour !== true)
      .sort((a,b) => Number(b.createdAt||0) - Number(a.createdAt||0));

    const flavour = live
      .filter(x => x.flavour === true)
      .sort((a,b) => Number(b.createdAt||0) - Number(a.createdAt||0));

    const renderCard = (n, mode="main") => {
      const cat = n.category ? `<span class="tag cat">${escapeHtml(n.category)}</span>` : ``;
      const br = n.breaking ? `<span class="tag breaking">BREAKING</span>` : ``;
      const posted = safe(n.postedBy, "BBC Newsdesk");
      const text = escapeHtml(safe(n.text,"")).replaceAll("\n","<br>");

      if (mode === "flavour") {
        return `
          <div class="flavour-card">
            <div class="flavour-head">
              <div class="flavour-title">${escapeHtml(safe(n.headline,"Untitled"))}</div>
              <div class="news-tags">${br}${cat}</div>
            </div>
            <div class="news-meta">${escapeHtml(simLabel)} · ${escapeHtml(posted)}</div>
            <div class="flavour-body">${text}</div>
          </div>
        `;
      }

      return `
        <div class="news-card ${n.breaking ? "breaking" : ""}">
          <div class="news-top">
            <div class="news-headline">${escapeHtml(safe(n.headline,"Untitled"))}</div>
            <div class="news-tags">${br}${cat}<span class="tag live">LIVE</span></div>
          </div>
          ${n.photo ? `<img class="news-photo" src="${escapeHtml(n.photo)}" alt="">` : ""}
          <div class="news-meta">${escapeHtml(simLabel)} · Posted by ${escapeHtml(posted)}</div>
          <div class="news-body">${text}</div>
        </div>
      `;
    };

    const renderArchiveCard = (n) => {
      const cat = n.category ? `<span class="tag cat">${escapeHtml(n.category)}</span>` : ``;
      const br = n.breaking ? `<span class="tag breaking">BREAKING</span>` : ``;
      const posted = safe(n.postedBy, "BBC Newsdesk");
      const text = escapeHtml(safe(n.text,"")).replaceAll("\n","<br>");
      return `
        <div class="news-card">
          <div class="news-top">
            <div class="news-headline">${escapeHtml(safe(n.headline,"Untitled"))}</div>
            <div class="news-tags">${br}${cat}<span class="tag archived">ARCHIVE</span></div>
          </div>
          ${n.photo ? `<img class="news-photo" src="${escapeHtml(n.photo)}" alt="">` : ""}
          <div class="news-meta">${escapeHtml(simLabel)} · Posted by ${escapeHtml(posted)}</div>
          <div class="news-body">${text}</div>
        </div>
      `;
    };

    if (mainEl) {
      mainEl.classList.remove("muted-block");
      mainEl.innerHTML = main.length
        ? `<div class="news-grid">${main.map(n => renderCard(n,"main")).join("")}</div>`
        : `<div class="muted-block">No main stories have been posted yet.</div>`;
    }

    if (flavourEl) {
      flavourEl.classList.remove("muted-block");
      flavourEl.innerHTML = flavour.length
        ? `<div class="flavour-grid">${flavour.map(n => renderCard(n,"flavour")).join("")}</div>`
        : `<div class="muted-block">No flavour stories yet.</div>`;
    }

    if (archiveEl) {
      archiveEl.classList.remove("muted-block");
      archiveEl.innerHTML = archive.length
        ? `<div class="news-grid">${archive.sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0)).map(renderArchiveCard).join("")}</div>`
        : `<div class="muted-block">No archived stories yet.</div>`;
    }
  }

  /* =========================================================
     PAPERS (matches your papers.html)
     ========================================================= */

  const PAPER_LIST = [
    { id:"sun", name:"The Sun", cls:"paper-sun" },
    { id:"telegraph", name:"The Daily Telegraph", cls:"paper-telegraph" },
    { id:"mail", name:"The Daily Mail", cls:"paper-mail" },
    { id:"mirror", name:"The Daily Mirror", cls:"paper-mirror" },
    { id:"times", name:"The Times", cls:"paper-times" },
    { id:"ft", name:"Financial Times", cls:"paper-ft" },
    { id:"guardian", name:"The Guardian", cls:"paper-guardian" },
    { id:"independent", name:"The Independent", cls:"paper-independent" }
  ];

  function renderPapersPage(data) {
    const simEl = document.getElementById("papersSimDate");
    const gridEl = document.getElementById("papersGrid");
    const readerPanel = document.getElementById("paperReaderPanel");
    const reader = document.getElementById("paperReader");

    if (!simEl && !gridEl && !readerPanel && !reader) return;

    const simLabel = getSimMonthYearLabel(data);
    if (simEl) simEl.textContent = simLabel;

    if (!gridEl) return;

    // Ensure each paper has a stub front
    PAPER_LIST.forEach(p => {
      if (!data.papers.fronts[p.id]) {
        data.papers.fronts[p.id] = {
          headline: `${p.name} — Front Page Headline`,
          byline: "Political Correspondent",
          author: "Newsroom",
          text: "No front page has been written for this paper yet.",
          photo: ""
        };
      }
      if (!Array.isArray(data.papers.archive[p.id])) data.papers.archive[p.id] = [];
    });
    saveData(data);

    gridEl.classList.remove("muted-block");
    gridEl.innerHTML = `
      <div class="paper-grid">
        ${PAPER_LIST.map(p => {
          const front = data.papers.fronts[p.id];
          return `
            <div class="paper-tile">
              <div class="paper-masthead ${p.cls}">
                <div class="paper-name">${escapeHtml(p.name)}</div>
              </div>
              <div class="paper-headline">${escapeHtml(front.headline)}</div>
              <div class="paper-actions">
                <button class="btn" type="button" data-open-paper="${escapeHtml(p.id)}">Read this Paper</button>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;

    gridEl.querySelectorAll("[data-open-paper]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-open-paper");
        openPaperReader(data, id);
      });
    });

    const params = new URLSearchParams(location.search);
    const openId = params.get("paper");
    if (openId) openPaperReader(data, openId);
  }

  function openPaperReader(data, paperId) {
    const readerPanel = document.getElementById("paperReaderPanel");
    const reader = document.getElementById("paperReader");
    if (!readerPanel || !reader) return;

    const paper = PAPER_LIST.find(x => x.id === paperId);
    if (!paper) return;

    const simLabel = getSimMonthYearLabel(data);

    const front = data.papers.fronts?.[paperId] || {};
    const archive = Array.isArray(data.papers.archive?.[paperId]) ? data.papers.archive[paperId] : [];

    readerPanel.style.display = "block";

    const renderArticle = (a, label) => `
      <div class="panel" style="margin-top:12px;">
        <div class="paper-masthead ${paper.cls}">
          <div class="paper-name">${escapeHtml(paper.name)}</div>
        </div>
        <div class="paper-front-label">${escapeHtml(label)}</div>
        <div class="paper-front-headline">${escapeHtml(safe(a.headline,"Untitled"))}</div>
        <div class="paper-front-byline">${escapeHtml(safe(a.author,""))} · <span class="muted">${escapeHtml(safe(a.byline,"Political Correspondent"))}</span></div>
        ${a.photo ? `<img class="news-photo" src="${escapeHtml(a.photo)}" alt="">` : ""}
        <div class="paper-front-meta">${escapeHtml(simLabel)}</div>
        <div class="paper-front-text">${escapeHtml(safe(a.text,"")).replaceAll("\n","<br>")}</div>
      </div>
    `;

    reader.innerHTML = `
      <div class="muted-block">
        <b>${escapeHtml(paper.name)}</b> · ${escapeHtml(simLabel)}
        <div style="margin-top:10px;">
          <a class="btn" href="papers.html">Close Reader</a>
        </div>
      </div>

      ${renderArticle(front, "Front Page")}

      <div class="panel" style="margin-top:12px;">
        <h2 style="margin:0 0 10px;">Previous Front Pages</h2>
        ${archive.length ? archive.map((a,i)=>renderArticle(a, `Archive #${archive.length - i}`)).join("") : `<div class="muted-block">No archive yet for this paper.</div>`}
      </div>
    `;
  }

  /* =========================================================
     QUESTION TIME (matches your questiontime.html id)
     ========================================================= */
  function renderQuestionTimePage(data) {
    const root =
      document.getElementById("question-time-root") ||
      document.getElementById("qt-root");

    if (!root) return;

    const offices = Array.isArray(data.questionTime?.offices) ? data.questionTime.offices : [];
    const questions = Array.isArray(data.questionTime?.questions) ? data.questionTime.questions : [];

    if (!offices.length) {
      root.innerHTML = `<div class="muted-block">No Question Time offices configured yet.</div>`;
      return;
    }

    root.innerHTML = `
      <div class="qt-grid">
        ${offices.map(o => {
          const qs = questions.filter(q => q.officeId === o.id);
          return `
            <div class="qt-tile">
              <div class="qt-title">${escapeHtml(o.title)}</div>
              <div class="qt-sub">${qs.length ? `${qs.length} question(s) queued` : "No questions yet."}</div>
              <div class="qt-actions">
                <button class="btn" type="button" data-qt-open="${escapeHtml(o.id)}">Open</button>
              </div>
            </div>
          `;
        }).join("")}
      </div>

      <div class="muted-block" style="margin-top:12px;">
        Next step: submission + threaded answers per office (Speaker/mod tools later).
      </div>
    `;

    root.querySelectorAll("[data-qt-open]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-qt-open");
        alert(`Office opened: ${id}\n\nNext step: show questions + submit form in-page.`);
      });
    });
  }

  /* =========================================================
     CONSTITUENCIES (matches your constituencies.html IDs)
     ========================================================= */
  function renderConstituenciesPage(data) {
    const summaryEl = document.getElementById("parliament-summary");
    const partyEl = document.getElementById("party-constituencies");
    const altRoot = document.getElementById("constituenciesRoot"); // support older builds

    if (!summaryEl && !partyEl && !altRoot) return;

    const parties = Array.isArray(data.parliament?.parties) ? data.parliament.parties : [];
    const total = Number(data.parliament?.totalSeats || 650);

    const seatRows = parties
      .slice()
      .sort((a,b)=>Number(b.seats||0)-Number(a.seats||0))
      .map(p => `<div class="seat-row"><span>${escapeHtml(p.name)}</span><b>${Number(p.seats||0)}</b></div>`)
      .join("");

    const summaryHtml = `
      <div class="commons-header">
        <div class="commons-badge">House of Commons</div>
        <div class="commons-sub">${escapeHtml(safe(data.constituencies?.lastUpdated,"Demo"))}</div>
      </div>

      <div class="seat-summary" style="margin-top:12px;">
        <div class="seat-row"><span>Total Seats</span><b>${total}</b></div>
        ${seatRows}
      </div>
    `;

    if (summaryEl) summaryEl.innerHTML = summaryHtml;

    const byParty = data.constituencies?.byParty || {};
    const playable = ["Labour","Conservative","Liberal Democrat"];
    const regions = ["England","Scotland","Wales","Northern Ireland"];

    const partyBlocks = playable.map(partyName => {
      const r = byParty[partyName] || {};
      return `
        <details class="party-block">
          <summary>
            <span class="party-name">${escapeHtml(partyName)}</span>
            <span class="tag cat">Open</span>
          </summary>
          <div class="party-regions">
            ${regions.map(region => {
              const list = Array.isArray(r[region]) ? r[region] : [];
              return `
                <div class="region-block">
                  <div class="region-title">${escapeHtml(region)}</div>
                  ${list.length
                    ? `<ul class="clean-list">${list.map(c=>`<li>${escapeHtml(c)}</li>`).join("")}</ul>`
                    : `<div class="muted small">No constituencies listed yet.</div>`
                  }
                </div>
              `;
            }).join("")}
          </div>
        </details>
      `;
    }).join("");

    const partyHtml = `
      <div class="muted-block" style="margin-bottom:12px;">
        Mods can amend this for any period, by-elections, defections, etc.
      </div>
      ${partyBlocks}
    `;

    if (partyEl) partyEl.innerHTML = partyHtml;

    // older page support (if ever used)
    if (altRoot) {
      altRoot.innerHTML = `
        <div class="panel">${summaryHtml}</div>
        <div class="panel" style="margin-top:12px;">${partyHtml}</div>
      `;
    }
  }

  /* =========================================================
     BODIES (matches your bodies.html id)
     ========================================================= */
  function renderBodiesPage(data) {
    const root = document.getElementById("bodies-root") || document.getElementById("bodiesRoot");
    if (!root) return;

    const items = Array.isArray(data.bodies?.items) ? data.bodies.items : [];
    if (!items.length) {
      root.innerHTML = `<div class="muted-block">No bodies configured yet.</div>`;
      return;
    }

    root.innerHTML = `
      <div class="bodies-grid">
        ${items.map(b => `
          <div class="body-card">
            <div class="body-top">
              <div class="body-name">${escapeHtml(b.name)}</div>
              <div class="body-sub">${escapeHtml(safe(b.subtitle,""))}</div>
            </div>
            ${Array.isArray(b.seats) && b.seats.length ? `
              <div class="seat-summary" style="margin-top:10px;">
                ${b.seats.map(s => `<div class="seat-row"><span>${escapeHtml(s.name)}</span><b>${Number(s.seats||0)}</b></div>`).join("")}
              </div>
            ` : `<div class="muted-block" style="margin-top:10px;">Seat breakdown not set (flavour body).</div>`}
          </div>
        `).join("")}
      </div>
    `;
  }

  /* =========================================================
     USER (matches your user.html IDs)
     ========================================================= */
  function renderUserPage(data) {
    const accountEl = document.getElementById("user-account");
    const cpEl = document.getElementById("user-controlpanel");
    const altRoot = document.getElementById("userRoot");
    if (!accountEl && !cpEl && !altRoot) return;

    const p = data.currentPlayer || {};
    const perms = p.permissions || { admin:false, mod:false, speaker:false };

    const accountHtml = `
      <div class="seat-summary">
        <div class="seat-row"><span>Character</span><b>${escapeHtml(safe(p.name,"Unknown"))}</b></div>
        <div class="seat-row"><span>Party</span><b>${escapeHtml(safe(p.party,"Unknown"))}</b></div>
        <div class="seat-row"><span>Role</span><b>${escapeHtml(safe(p.role,"backbencher"))}</b></div>
        <div class="seat-row"><span>Speaker</span><b>${p.isSpeaker ? "Yes" : "No"}</b></div>
      </div>
      <div class="muted-block" style="margin-top:12px;">
        This will evolve into: Player panel + Speaker panel + Mod panel + Admin panel (no coding required).
      </div>
    `;

    const controlHtml = `
      <div class="control-grid">
        <div class="control-tile">
          <div class="control-title">Character</div>
          <div class="muted small">Create / edit your character (coming next).</div>
          <div class="control-actions"><button class="btn" type="button">Open</button></div>
        </div>

        <div class="control-tile ${perms.speaker ? "" : "locked"}">
          <div class="control-title">Speaker Controls</div>
          <div class="muted small">NPC votes, rebellions, divisions, order.</div>
          <div class="control-actions"><button class="btn" type="button" ${perms.speaker ? "" : "disabled"}>Open</button></div>
        </div>

        <div class="control-tile ${perms.mod ? "" : "locked"}">
          <div class="control-title">Moderator Controls</div>
          <div class="muted small">News, papers, events, settings.</div>
          <div class="control-actions"><button class="btn" type="button" ${perms.mod ? "" : "disabled"}>Open</button></div>
        </div>

        <div class="control-tile ${perms.admin ? "" : "locked"}">
          <div class="control-title">Admin Controls</div>
          <div class="muted small">Users, permissions, timelines.</div>
          <div class="control-actions"><button class="btn" type="button" ${perms.admin ? "" : "disabled"}>Open</button></div>
        </div>
      </div>

      ${(!perms.admin && !perms.mod && !perms.speaker)
        ? `<div class="muted-block" style="margin-top:12px;">You’re currently a player account (no staff permissions).</div>`
        : `<div class="muted-block" style="margin-top:12px;">Staff permissions detected — panels will become functional as we build control-panel.html.</div>`
      }
    `;

    if (accountEl) accountEl.innerHTML = accountHtml;
    if (cpEl) cpEl.innerHTML = controlHtml;

    if (altRoot) {
      altRoot.innerHTML = `
        <div class="panel">${accountHtml}</div>
        <div class="panel" style="margin-top:12px;">${controlHtml}</div>
      `;
    }
  }

  /* =========================================================
     BILL + AMENDMENTS (kept working, unchanged behaviour)
     ========================================================= */

  const STAGE_ORDER = ["First Reading", "Second Reading", "Report Stage", "Division"];
  const STAGE_LENGTH_SIM_MONTHS = { "Second Reading": 2, "Report Stage": 1 };

  function ensureBillDefaults(bill) {
    if (!bill.createdAt) bill.createdAt = nowTs();
    if (!bill.stageStartedAt) bill.stageStartedAt = bill.createdAt;
    if (!bill.stage) bill.stage = "First Reading";
    if (!bill.status) bill.status = "in-progress";
    if (!Array.isArray(bill.amendments)) bill.amendments = [];
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
            amend.failedReason = (aye === no) ? "Tie (Speaker maintains status quo)." : "Majority against.";
          }
        }
      }
    });

    return bill;
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
        <div class="panel rb-modal" style="width:min(720px, 100%); max-height:85vh; overflow:auto; z-index:9999;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
            <h2 style="margin:0;">Propose Amendment</h2>
            <button class="btn" type="button" id="rbAmendCloseBtn">Close</button>
          </div>

          <div class="muted-block" style="margin-top:12px;">
            One live amendment at a time per bill. After submission, leader support runs for 24 active hours (Sundays frozen).
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
        return alert(b?._lastAmendmentError || "Could not submit amendment.");
      }

      modal.style.display = "none";
      location.reload();
    };
  }
function initPapersPage(data){
  const grid = document.getElementById("papersGrid");
  const dateEl = document.getElementById("papersSimDate");
  const readerPanel = document.getElementById("paperReaderPanel");
  const reader = document.getElementById("paperReader");
  if (!grid || !dateEl || !readerPanel || !reader) return;

  // Sim date in header
  const sim = getCurrentSimDate(data);
  dateEl.textContent = `${getMonthName(sim.month)} ${sim.year}`;

  // Define the 8 papers + the CSS class that gives the masthead its colour
  const PAPERS = [
    { key:"sun",         name:"The Sun",            cls:"paper-sun" },
    { key:"telegraph",   name:"The Daily Telegraph",cls:"paper-telegraph" },
    { key:"mail",        name:"The Daily Mail",     cls:"paper-mail" },
    { key:"mirror",      name:"The Daily Mirror",   cls:"paper-mirror" },
    { key:"times",       name:"The Times",          cls:"paper-times" },
    { key:"ft",          name:"Financial Times",    cls:"paper-ft" },
    { key:"guardian",    name:"The Guardian",       cls:"paper-guardian" },
    { key:"independent", name:"The Independent",    cls:"paper-independent" },
  ];

  // Ensure storage exists
  data.papers = data.papers || {};
  PAPERS.forEach(p => {
    data.papers[p.key] = data.papers[p.key] || [];
    // If completely empty, give each paper a simple demo front page so it doesn’t look broken
    if (data.papers[p.key].length === 0) {
      data.papers[p.key].unshift({
        id: `paper-${p.key}-${Date.now()}`,
        headline: `${p.name} — Front Page Headline`,
        byline: "Political Correspondent",
        body: "Front page story text goes here.",
        imageUrl: "",
        createdAt: Date.now()
      });
    }
  });

  saveData(data);

  const mostRecentIssue = (paperKey) => (data.papers?.[paperKey] || [])[0];

  // Render grid (WITH mastheads)
  grid.classList.remove("muted-block");
  grid.classList.add("paper-grid");

  grid.innerHTML = PAPERS.map(p => {
    const issue = mostRecentIssue(p.key);
    const headline = issue?.headline || `${p.name} — Front Page Headline`;

    return `
      <div class="paper-tile card-flex ${p.cls}">
        <div class="paper-masthead">${escapeHtml(p.name)}</div>
        <div class="paper-headline">${escapeHtml(headline)}</div>

        <div class="tile-bottom">
          <button class="btn" type="button" data-open-paper="${escapeHtml(p.key)}">Read this Paper</button>
        </div>
      </div>
    `;
  }).join("");

  // Open a paper reader
  function openPaper(paperKey){
    const paperMeta = PAPERS.find(x => x.key === paperKey);
    const issues = (data.papers?.[paperKey] || []);

    readerPanel.style.display = "block";

    reader.innerHTML = `
      <div class="paper-reader-header">
        <div>
          <div class="paper-reader-title">${escapeHtml(paperMeta?.name || "Paper")}</div>
          <div class="small">Showing latest issue first · ${escapeHtml(`${getMonthName(sim.month)} ${sim.year}`)}</div>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn" type="button" id="paperCloseBtn">Close</button>
        </div>
      </div>

      ${issues.map(issue => {
        const when = issue.createdAt ? new Date(issue.createdAt).toLocaleString() : "";
        return `
          <div class="paper-issue ${paperMeta?.cls || ""}">
            <div class="paper-issue-top">
              <div class="paper-issue-masthead">${escapeHtml(paperMeta?.name || "")}</div>
              <div class="paper-issue-date">${escapeHtml(when)}</div>
            </div>

            <div class="paper-issue-headline">${escapeHtml(issue.headline || "")}</div>
            ${issue.byline ? `<div class="paper-issue-byline">${escapeHtml(issue.byline)}</div>` : ``}

            ${issue.imageUrl
              ? `<div class="paper-issue-imagewrap"><img src="${escapeHtml(issue.imageUrl)}" alt=""></div>`
              : ``}

            <div class="paper-issue-text">${escapeHtml(issue.body || "")}</div>
          </div>
        `;
      }).join("")}
    `;

    document.getElementById("paperCloseBtn")?.addEventListener("click", () => {
      readerPanel.style.display = "none";
      reader.innerHTML = "";
    });
  }

  // Bind buttons
  grid.querySelectorAll("[data-open-paper]").forEach(btn => {
    btn.addEventListener("click", () => openPaper(btn.getAttribute("data-open-paper")));
  });
}

  function initBillPage(data){
    const titleEl = document.getElementById("billTitle");
    const metaEl = document.getElementById("billMeta");
    const textEl = document.getElementById("billText");
    const amendRoot = document.getElementById("bill-amendments") || document.getElementById("amendmentsList");

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

    if (!amendRoot) return;

    const me = data.currentPlayer || {};
    const myName = String(me.name || "Unknown MP");
    const myParty = String(me.party || "Unknown");
    const leader = (me.partyLeader === true || me.role === "leader-opposition" || me.role === "prime-minister");

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

  /* =========================================================
     LIVE REFRESH (safe)
     ========================================================= */
  function startLiveRefresh() {
    const needsRefresh =
      document.getElementById("sim-date-display") ||
      document.getElementById("whats-going-on") ||
      document.getElementById("live-docket") ||
      document.getElementById("order-paper") ||
      document.getElementById("bbcSimDate") ||
      document.getElementById("bbcMainNews") ||
      document.getElementById("papersGrid") ||
      document.getElementById("question-time-root") ||
      document.getElementById("parliament-summary") ||
      document.getElementById("bodies-root") ||
      document.getElementById("user-account") ||
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

      renderNewsPage(latest);
      renderPapersPage(latest);
      renderQuestionTimePage(latest);
      renderConstituenciesPage(latest);
      renderBodiesPage(latest);
      renderUserPage(latest);

      initBillPage(latest);
    }, 1000);
  }

  /* =========================================================
     BOOT (runs on every page load)
     ========================================================= */
  fetch(DATA_URL)
    .then(r => r.json())
    .then((demo) => {
      let data = getData();
      if (!data) data = demo;

      normaliseData(data);
      saveData(data);

      initNavUI();

      // dashboard
      renderSimDate(data);
      renderWhatsGoingOn(data);
      renderLiveDocket(data);
      renderOrderPaper(data);

      // pages
      renderNewsPage(data);
      renderPapersPage(data);
      renderQuestionTimePage(data);
      renderConstituenciesPage(data);
      renderBodiesPage(data);
      renderUserPage(data);

      // bill page
      initBillPage(data);

      startLiveRefresh();
    })
    .catch(err => console.error("Error loading demo.json:", err));
})();
