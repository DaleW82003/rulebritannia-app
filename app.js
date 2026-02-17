/* =========================================================
   Rule Britannia — app.js
   Consolidated + hardened (prevents "Loading…" freezes)
   ========================================================= */

(() => {
  "use strict";

  /* =========================
     CONFIG
     ========================= */
  const DATA_URL = "./demo.json";
  const STORAGE_KEY = "rb_demo_data_v1";
  const LIVE_REFRESH_MS = 30_000;

  /* =========================
     HELPERS
     ========================= */
  function $(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function safeNum(n, fallback = 0) {
    const x = Number(n);
    return Number.isFinite(x) ? x : fallback;
  }

  function fmtPct(n) { return `${safeNum(n).toFixed(1)}%`; }

  function fmtDateTime(ts) {
    try {
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return "—";
      return d.toLocaleString(undefined, { year:"numeric", month:"short", day:"2-digit", hour:"2-digit", minute:"2-digit" });
    } catch { return "—"; }
  }

  function getData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function saveData(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    catch (e) { console.warn("Could not save data:", e); }
  }

  function normaliseData(data) {
    if (!data) return;

    // Ensure modern currentUser/currentCharacter exist (Option B)
    if (!data.currentUser && data.currentPlayer?.name) {
      data.currentUser = { username: data.currentPlayer.name, isAdmin:false, isMod:false, roles:[] };
    }
    if (!data.currentCharacter && data.currentPlayer) {
      data.currentCharacter = { ...data.currentPlayer };
    }

    // Ensure containers exist
    data.news = data.news || { stories: [] };
    data.news.stories = Array.isArray(data.news.stories) ? data.news.stories : [];

    data.papers = data.papers || { papers: [] };
    data.papers.papers = Array.isArray(data.papers.papers) ? data.papers.papers : [];

    data.questionTime = data.questionTime || { offices: [], cabinet: [], questions: [] };
    data.questionTime.offices = Array.isArray(data.questionTime.offices) ? data.questionTime.offices : [];
    data.questionTime.cabinet = Array.isArray(data.questionTime.cabinet) ? data.questionTime.cabinet : [];
    data.questionTime.questions = Array.isArray(data.questionTime.questions) ? data.questionTime.questions : [];

    data.bodies = data.bodies || { list: [] };
    data.bodies.list = Array.isArray(data.bodies.list) ? data.bodies.list : [];

    data.economyPage = data.economyPage || { topline:{}, ukInfoTiles:[], surveys:[] };
    data.economyPage.ukInfoTiles = Array.isArray(data.economyPage.ukInfoTiles) ? data.economyPage.ukInfoTiles : [];
    data.economyPage.surveys = Array.isArray(data.economyPage.surveys) ? data.economyPage.surveys : [];

    data.whatsGoingOn = data.whatsGoingOn || {};
    data.liveDocket = data.liveDocket || { asOf:"", items:[] };
    data.liveDocket.items = Array.isArray(data.liveDocket.items) ? data.liveDocket.items : [];

    data.orderPaperCommons = Array.isArray(data.orderPaperCommons) ? data.orderPaperCommons : [];
    data.parliament = data.parliament || { totalSeats:650, parties:[] };
    data.parliament.parties = Array.isArray(data.parliament.parties) ? data.parliament.parties : [];
  }

  function computeSimMonthYear(data) {
    const gs = data.gameState || {};
    const startSimMonth = safeNum(gs.startSimMonth, 8);
    const startSimYear = safeNum(gs.startSimYear, 1997);
    const startReal = new Date(gs.startRealDate || Date.now());
    const now = new Date();

    // Simple: each real-life month == one sim month (good enough for demo)
    const diffMonths = (now.getUTCFullYear() - startReal.getUTCFullYear()) * 12
      + (now.getUTCMonth() - startReal.getUTCMonth());

    let simMonth = startSimMonth + diffMonths;
    let simYear = startSimYear;

    while (simMonth > 12) { simMonth -= 12; simYear += 1; }
    while (simMonth < 1) { simMonth += 12; simYear -= 1; }

    const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    return `${monthNames[simMonth-1]} ${simYear}`;
  }

  function isSpeakerOnly(aud) { return !!aud?.speakerOnly; }

  function currentRoles(data) {
    const roles = new Set();
    const u = data.currentUser || {};
    (u.roles || []).forEach(r => roles.add(r));
    if (u.isAdmin) roles.add("admin");
    if (u.isMod) roles.add("mod");

    // character-based roles (minister/backbencher etc) can be stored on currentCharacter.role
    const c = data.currentCharacter || data.currentPlayer || {};
    if (c.role) roles.add(c.role);
    if (c.isSpeaker) roles.add("speaker");
    return roles;
  }

  function currentOffices(data) {
    const offices = new Set();
    const c = data.currentCharacter || data.currentPlayer || {};
    if (c.office) offices.add(c.office);
    return offices;
  }

  function audienceAllows(data, audience) {
    if (!audience) return true;

    const roles = currentRoles(data);
    const offices = currentOffices(data);

    if (audience.speakerOnly) return roles.has("speaker");

    if (Array.isArray(audience.roles) && audience.roles.length) {
      let ok = false;
      for (const r of audience.roles) if (roles.has(r)) ok = true;
      if (!ok) return false;
    }

    if (Array.isArray(audience.offices) && audience.offices.length) {
      let ok = false;
      for (const o of audience.offices) if (offices.has(o)) ok = true;
      if (!ok) return false;
    }

    return true;
  }

  /* =========================
     NAV UI
     ========================= */
  function initNavUI() {
    const groups = document.querySelectorAll(".nav-group");
    if (!groups.length) return;

    groups.forEach(g => {
      const btn = g.querySelector(".nav-toggle");
      if (!btn) return;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        groups.forEach(other => { if (other !== g) other.classList.remove("open"); });
        g.classList.toggle("open");
      });
    });

    document.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".nav-group")) return;
      groups.forEach(g => g.classList.remove("open"));
    });
  }

  /* =========================
     DASHBOARD RENDERS
     ========================= */
  function renderSimDate(data) {
    const el = $("sim-date-display");
    if (!el) return;
    el.textContent = computeSimMonthYear(data);
  }

  function renderWhatsGoingOn(data) {
    const el = $("whats-going-on");
    if (!el) return;

    const w = data.whatsGoingOn || {};
    const bbc = w.bbc || {};
    const papers = w.papers || {};
    const econ = w.economy || {};
    const polling = Array.isArray(w.polling) ? w.polling : [];
    const commonsLeg = Array.isArray(w.commonsLegislation) ? w.commonsLegislation : [];

    el.innerHTML = `
      <div class="wgo-grid">
        <div class="wgo-tile card-flex">
          <div class="wgo-kicker">BBC</div>
          <div class="wgo-title">${escapeHtml(bbc.headline || "—")}</div>
          <div class="wgo-strap">${escapeHtml(bbc.strap || "")}</div>
          <div class="tile-bottom">
            <a class="btn" href="news.html">Open</a>
          </div>
        </div>

        <div class="wgo-tile card-flex">
          <div class="wgo-kicker">PAPERS</div>
          <div class="wgo-title">${escapeHtml((papers.paper ? `${papers.paper}: ` : "") + (papers.headline || "—"))}</div>
          <div class="wgo-strap">${escapeHtml(papers.strap || "")}</div>
          <div class="tile-bottom">
            <a class="btn" href="papers.html">Open</a>
          </div>
        </div>

        <div class="wgo-tile card-flex">
          <div class="wgo-kicker">ECONOMY</div>
          <div class="wgo-title">GDP: ${fmtPct(econ.growth)} · CPI: ${fmtPct(econ.inflation)} · Unemp: ${fmtPct(econ.unemployment)}</div>
          <div class="wgo-strap">Topline indicators</div>
          <div class="tile-bottom">
            <a class="btn" href="economy.html">Open</a>
          </div>
        </div>

        <div class="wgo-tile card-flex">
          <div class="wgo-kicker">POLLING</div>
          <div class="wgo-title">${polling.slice(0,3).map(p => `${p.party} ${safeNum(p.value).toFixed(1)}%`).join(" · ") || "—"}</div>
          <div class="wgo-strap">Snapshot</div>
          <div class="tile-bottom">
            <a class="btn" href="polling.html">Open</a>
          </div>
        </div>
      </div>

      <div class="muted-block" style="margin-top:12px;">
        <b>Commons legislation</b><br>
        ${commonsLeg.length ? commonsLeg.map(x => `• ${escapeHtml(x.title)} — <span class="muted">${escapeHtml(x.stage)}</span>`).join("<br>") : "—"}
      </div>
    `;
  }

  function renderLiveDocket(data) {
    const el = $("live-docket");
    if (!el) return;

    const docket = data.liveDocket || {};
    const items = Array.isArray(docket.items) ? docket.items : [];
    const visible = items.filter(it => audienceAllows(data, it.audience));

    if (!visible.length) {
      el.innerHTML = `<div class="muted-block">Nothing on your docket right now.</div>`;
      return;
    }

    el.innerHTML = `
      <div class="muted-block" style="margin-bottom:12px;">
        <b>As of:</b> ${escapeHtml(docket.asOf || "—")}
      </div>
      <div class="docket-list">
        ${visible.map(it => `
          <div class="docket-item">
            <div class="docket-left">
              <div class="docket-icon">•</div>
              <div>
                <div class="docket-title">${escapeHtml(it.title || "—")}</div>
                <div class="docket-detail">${escapeHtml(it.detail || "")}</div>
              </div>
            </div>
            <div class="docket-cta">
              ${it.href ? `<a class="btn" href="${escapeHtml(it.href)}">${escapeHtml(it.ctaLabel || "Open")}</a>` : ""}
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderOrderPaper(data) {
    const el = $("order-paper");
    if (!el) return;

    const bills = Array.isArray(data.orderPaperCommons) ? data.orderPaperCommons : [];
    if (!bills.length) {
      el.innerHTML = `<div class="muted-block">No bills on the Order Paper.</div>`;
      return;
    }

    el.innerHTML = `
      <div class="docket-list">
        ${bills.slice(0,8).map(b => `
          <div class="docket-item">
            <div class="docket-left">
              <div class="docket-icon">§</div>
              <div>
                <div class="docket-title">${escapeHtml(b.title || "—")}</div>
                <div class="docket-detail">${escapeHtml(b.stage || "—")} · <span class="muted">${escapeHtml(b.billType || "")}</span></div>
              </div>
            </div>
            <div class="docket-cta">
              <a class="btn" href="bill.html?id=${encodeURIComponent(b.id)}">Open</a>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  /* =========================
     NEWS PAGE
     ========================= */
  function renderNewsPage(data) {
    const dateEl = $("bbcSimDate");
    if (dateEl) dateEl.textContent = computeSimMonthYear(data);

    const breakingPanel = $("bbcBreakingPanel");
    const breakingTicker = $("bbcBreakingTicker");

    const mainEl = $("bbcMainNews");
    const flavourEl = $("bbcFlavourNews");
    const archiveEl = $("bbcArchive");
    if (!mainEl && !flavourEl && !archiveEl) return;

    const now = Date.now();
    const RL_14_DAYS = 14 * 24 * 60 * 60 * 1000;

    const stories = (data.news?.stories || []).slice().sort((a,b) => safeNum(b.createdAt) - safeNum(a.createdAt));
    const live = stories.filter(s => (now - safeNum(s.createdAt)) <= RL_14_DAYS);
    const archive = stories.filter(s => (now - safeNum(s.createdAt)) > RL_14_DAYS);

    const breaking = live.filter(s => !!s.isBreaking);
    if (breakingPanel && breakingTicker) {
      if (breaking.length) {
        breakingPanel.style.display = "";
        breakingTicker.textContent = breaking.map(s => s.headline).join(" · ");
      } else {
        breakingPanel.style.display = "none";
      }
    }

    const main = live.filter(s => !s.flavour);
    const flavour = live.filter(s => !!s.flavour);

    function card(story, small=false) {
      return `
        <div class="news-card ${small ? "small" : ""}">
          <div class="news-brand">
            <div class="news-date">${escapeHtml(story.simDate || computeSimMonthYear(data))}</div>
            ${story.isBreaking ? `<div class="breaking-tag">BREAKING</div>` : ``}
          </div>
          ${story.category ? `<div class="news-category">${escapeHtml(story.category)}</div>` : ``}
          <div class="news-headline">${escapeHtml(story.headline || "—")}</div>
          ${story.imageUrl ? `<div class="news-imagewrap"><img src="${escapeHtml(story.imageUrl)}" alt=""></div>` : ``}
          <div class="news-text">${escapeHtml(story.text || "")}</div>
        </div>
      `;
    }

    if (mainEl) {
      mainEl.innerHTML = main.length
        ? `<div class="news-grid">${main.map(s => card(s,false)).join("")}</div>`
        : `<div class="muted-block">No live main stories.</div>`;
    }

    if (flavourEl) {
      flavourEl.innerHTML = flavour.length
        ? `<div class="news-grid">${flavour.map(s => card(s,true)).join("")}</div>`
        : `<div class="muted-block">No flavour stories.</div>`;
    }

    if (archiveEl) {
      archiveEl.innerHTML = archive.length
        ? `<div class="news-grid">${archive.map(s => card(s,false)).join("")}</div>`
        : `<div class="muted-block">Archive is empty.</div>`;
    }
  }

  /* =========================
     PAPERS PAGE
     ========================= */
  function renderPapersPage(data) {
    const dateEl = $("papersSimDate");
    if (dateEl) dateEl.textContent = computeSimMonthYear(data);

    const grid = $("papersGrid");
    const readerPanel = $("paperReaderPanel");
    const reader = $("paperReader");
    if (!grid || !readerPanel || !reader) return;

    const papers = (data.papers?.papers || []).slice();
    if (!papers.length) {
      grid.innerHTML = `<div class="muted">No papers configured.</div>`;
      return;
    }

    grid.classList.remove("muted-block");
    grid.classList.add("paper-grid");
    grid.innerHTML = "";

    papers.forEach(p => {
      const latest = (p.issues || []).slice().sort((a,b)=> safeNum(b.createdAt)-safeNum(a.createdAt))[0];
      const headline = latest?.headline || "No front page yet";
      const tile = document.createElement("div");
      tile.className = `paper-tile card-flex ${p.cls || ""}`;
      tile.innerHTML = `
        <div class="paper-masthead">${escapeHtml(p.name)}</div>
        <div class="paper-headline">${escapeHtml(headline)}</div>
        <div class="paper-strap muted">Most recent headline</div>
        <div class="tile-bottom">
          <button class="btn" type="button">Read this Paper</button>
        </div>
      `;
      tile.querySelector("button").addEventListener("click", () => openPaper(p));
      grid.appendChild(tile);
    });

    function openPaper(paper) {
      readerPanel.style.display = "";
      const issues = (paper.issues || []).slice().sort((a,b)=> safeNum(b.createdAt)-safeNum(a.createdAt));

      reader.innerHTML = `
        <div class="paper-reader-header">
          <div>
            <div class="paper-reader-title">${escapeHtml(paper.name)}</div>
            <div class="muted">${escapeHtml(computeSimMonthYear(data))}</div>
          </div>
          <div>
            <button class="btn" type="button" id="closePaperReaderBtn">Close</button>
          </div>
        </div>

        ${issues.map(issue => `
          <div class="paper-issue ${paper.cls || ""}">
            <div class="paper-issue-top">
              <div class="paper-issue-masthead">${escapeHtml(paper.name)}</div>
              <div class="paper-issue-date">${escapeHtml(issue.simDate || computeSimMonthYear(data))}</div>
            </div>
            <div class="paper-issue-headline">${escapeHtml(issue.headline || "—")}</div>
            ${issue.imageUrl ? `<div class="paper-issue-imagewrap"><img src="${escapeHtml(issue.imageUrl)}" alt=""></div>` : ``}
            <div class="paper-issue-byline">${escapeHtml(issue.bylineName || "Political Correspondent")}</div>
            <div class="paper-issue-text">${escapeHtml(issue.text || "")}</div>
          </div>
        `).join("")}
      `;

      const closeBtn = $("closePaperReaderBtn");
      if (closeBtn) closeBtn.addEventListener("click", () => {
        readerPanel.style.display = "none";
        reader.innerHTML = "";
      });

      window.scrollTo({ top: readerPanel.offsetTop - 10, behavior: "smooth" });
    }
  }

  /* =========================
     QUESTION TIME PAGE (RESTORED OPEN BUTTON)
     ========================= */
  function renderQuestionTimePage(data){
    const root =
      document.getElementById("question-time-root") ||
      document.getElementById("qt-root") ||
      document.getElementById("qt-root-legacy");
    if(!root) return;

    const qt = data.questionTime || {};
    const offices = Array.isArray(qt.offices) && qt.offices.length
      ? qt.offices
      : (Array.isArray(qt.cabinet) ? qt.cabinet.map(o => ({
          id: o.slug,
          title: o.short || o.title,
          holder: "—"
        })) : []);

    if(!offices.length){
      root.innerHTML = '<div class="muted-block">No Question Time offices configured yet.</div>';
      return;
    }

    root.innerHTML = `
      <div class="muted-block" style="margin-bottom:12px;">
        Select an office to view questions and submit new ones (if eligible).
      </div>
      <div class="qt-grid" id="qtGrid"></div>
    `;

    const grid = document.getElementById("qtGrid");
    for(const office of offices){
      const id = office.id || office.slug;
      const title = office.title || office.short || "Office";
      const holder = office.holder || "—";
      const href = `qt-office.html?office=${encodeURIComponent(id)}`;

      const tile = document.createElement("div");
      tile.className = "qt-tile card-flex";
      tile.innerHTML = `
        <div class="qt-office">${escapeHtml(title)}</div>
        <div class="muted" style="margin-top:8px;">Holder: <b>${escapeHtml(holder)}</b></div>
        <div class="tile-bottom">
          <a class="btn" href="${href}">Open</a>
        </div>
      `;
      grid.appendChild(tile);
    }
  }

  /* =========================
     QT OFFICE PAGE (existing behaviour preserved)
     ========================= */
  function initQuestionTimePage(data) {
    const root = $("qtOfficeRoot");
    if (!root) return;

    const url = new URL(window.location.href);
    const officeId = url.searchParams.get("office") || "";
    const qt = data.questionTime || {};
    const offices = qt.offices || [];
    const office = offices.find(o => (o.id || "") === officeId) || null;

    const officeTitle = office?.title || officeId || "Office";
    const holder = office?.holder || "—";

    const questions = (qt.questions || []).filter(q => q.office === officeId);

    root.innerHTML = `
      <div class="panel">
        <h1 class="page-title">${escapeHtml(officeTitle)}</h1>
        <div class="muted-block">
          <b>Holder:</b> ${escapeHtml(holder)}<br>
          <b>Sim date:</b> ${escapeHtml(computeSimMonthYear(data))}
        </div>

        <div class="muted-block" style="margin-top:12px;">
          <b>Questions</b><br>
          ${questions.length ? questions.map(q => `
            <div style="margin-top:10px; padding-top:10px; border-top:1px solid rgba(0,0,0,.08);">
              <b>${escapeHtml(q.askedBy || "—")}</b> <span class="muted">(${escapeHtml(q.status || "submitted")})</span><br>
              <div style="margin-top:6px;">${escapeHtml(q.text || "")}</div>
              ${q.answer ? `<div class="muted-block" style="margin-top:8px;"><b>Answer:</b><br>${escapeHtml(q.answer)}</div>` : ``}
            </div>
          `).join("") : "No questions yet."}
        </div>
      </div>
    `;
  }

  /* =========================
     CONSTITUENCIES PAGE
     ========================= */
  function renderConstituenciesPage(data) {
    const summaryEl = $("parliament-summary");
    const partiesEl = $("party-constituencies");
    if (!summaryEl && !partiesEl) return;

    const parl = data.parliament || { totalSeats:650, parties:[] };
    const parties = (parl.parties || []).slice().sort((a,b)=> safeNum(b.seats)-safeNum(a.seats));
    const total = safeNum(parl.totalSeats, 650);

    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="commons-hero">
          <div class="commons-badge">House of Commons</div>
          <div class="commons-sub">Total seats: <b>${total}</b></div>
        </div>

        <div class="muted-block">
          ${parties.map(p => `
            <div class="kv">
              <div><b>${escapeHtml(p.name)}</b></div>
              <div>${safeNum(p.seats)} seats</div>
            </div>
          `).join("")}
        </div>
      `;
    }

    if (partiesEl) {
      partiesEl.innerHTML = `
        <div class="party-grid">
          ${parties.map(p => `
            <div class="party-tile card-flex">
              <div class="party-name">${escapeHtml(p.name)}</div>
              <div class="party-seats">${safeNum(p.seats)} seats</div>
              <div class="tile-bottom">
                <button class="btn" type="button" disabled>Open (demo)</button>
              </div>
            </div>
          `).join("")}
        </div>
      `;
    }
  }

  /* =========================
     BODIES PAGE
     ========================= */
  function renderBodiesPage(data) {
    const root = $("bodies-root");
    if (!root) return;

    const bodies = (data.bodies?.list || []).slice();
    if (!bodies.length) {
      root.innerHTML = `<div class="panel"><div class="muted-block">No bodies configured.</div></div>`;
      return;
    }

    root.innerHTML = `
      <h1 class="page-title">Bodies</h1>
      <div class="body-grid">
        ${bodies.map(b => `
          <div class="body-tile">
            <div class="body-head">
              <div class="body-name">${escapeHtml(b.name)}</div>
              <div class="muted">${safeNum(b.totalSeats)} seats</div>
            </div>
            <div class="body-desc">${escapeHtml(b.desc || "")}</div>
            <div class="body-seats">
              ${(b.parties || []).map(p => `
                <div class="kv">
                  <div><b>${escapeHtml(p.name)}</b></div>
                  <div>${safeNum(p.seats)}</div>
                </div>
              `).join("")}
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  /* =========================
     USER PAGE
     ========================= */
  function renderUserPage(data) {
    const accountEl = $("user-account");
    const cpEl = $("user-controlpanel");
    if (!accountEl && !cpEl) return;

    const u = data.currentUser || {};
    const c = data.currentCharacter || {};

    if (accountEl) {
      accountEl.classList.remove("muted-block");
      accountEl.innerHTML = `
        <div class="user-card">
          <div class="user-top">
            <div>
              <div class="user-name">${escapeHtml(u.username || "User")}</div>
              <div class="muted">Roles: ${(u.roles || []).map(escapeHtml).join(", ") || "—"}</div>
            </div>
            <div class="user-actions">
              <a class="btn" href="control-panel.html">Control Panel</a>
            </div>
          </div>
          <div style="margin-top:12px;" class="muted-block">
            <div class="kv"><div><b>Character</b></div><div>${escapeHtml(c.name || "—")}</div></div>
            <div class="kv"><div><b>Party</b></div><div>${escapeHtml(c.party || "—")}</div></div>
            <div class="kv"><div><b>Role</b></div><div>${escapeHtml(c.role || "—")}</div></div>
            <div class="kv"><div><b>Office</b></div><div>${escapeHtml(c.office || "—")}</div></div>
          </div>
        </div>
      `;
    }

    if (cpEl) {
      cpEl.innerHTML = `
        <div class="muted-block">
          ${u.isAdmin || (u.roles || []).includes("admin")
            ? `Admin: enabled`
            : `Admin: disabled`}
          <br>
          ${u.isMod || (u.roles || []).includes("mod")
            ? `Moderator: enabled`
            : `Moderator: disabled`}
          <br>
          Speaker tools: ${(currentRoles(data).has("speaker") ? "enabled" : "disabled")}
        </div>
      `;
    }
  }

  /* =========================
     BILL PAGE (basic)
     ========================= */
  function initBillPage(data) {
    const root = $("bill-root");
    if (!root) return;

    const url = new URL(window.location.href);
    const id = url.searchParams.get("id");
    const bill = (data.orderPaperCommons || []).find(b => b.id === id);
    if (!bill) {
      root.innerHTML = `<div class="panel"><div class="muted-block">Bill not found.</div></div>`;
      return;
    }

    root.innerHTML = `
      <h1 class="page-title">${escapeHtml(bill.title)}</h1>
      <section class="panel">
        <div class="muted-block">
          <div class="kv"><div><b>Stage</b></div><div>${escapeHtml(bill.stage)}</div></div>
          <div class="kv"><div><b>Type</b></div><div>${escapeHtml(bill.billType)}</div></div>
          <div class="kv"><div><b>Department</b></div><div>${escapeHtml(bill.department)}</div></div>
          <div class="kv"><div><b>Author</b></div><div>${escapeHtml(bill.author)}</div></div>
        </div>

        <div class="muted-block" style="margin-top:12px;">
          <b>Bill text</b><br><br>
          <div style="white-space:pre-wrap; line-height:1.5;">${escapeHtml(bill.billText || "")}</div>
        </div>
      </section>
    `;
  }

  /* =========================
     SUBMIT BILL PAGE (guarded)
     ========================= */
  function initSubmitBillPage(data) {
    const root = $("submit-bill-root");
    if (!root) return;

    // (Demo placeholder)
    root.innerHTML = `
      <div class="muted-block">
        Submit Bill builder is wired but kept simple for now.
      </div>
    `;
  }

  /* =========================
     PARTY DRAFT PAGE (CRITICAL GUARD ADDED)
     ========================= */
  function initPartyDraftPage(data){
    // Guard: only run on Party Draft page
    const __partyDraftRoot =
      document.getElementById("party-draft-root") ||
      document.getElementById("partyDraftRoot") ||
      document.getElementById("partyDraftForm");
    if(!__partyDraftRoot && !document.getElementById("partyDraftTitle") && !document.getElementById("partyDraftText")) return;

    // Existing implementation (kept) – but now safe.
    const titleEl = document.getElementById("partyDraftTitle");
    const textEl = document.getElementById("partyDraftText");
    const articleCountEl = document.getElementById("partyArticleCount");
    if(!articleCountEl) return;
    const previewEl = document.getElementById("partyDraftPreview");
    const saveBtn = document.getElementById("savePartyDraftBtn");
    const clearBtn = document.getElementById("clearPartyDraftBtn");

    function updatePreview(){
      if (!titleEl || !textEl || !previewEl) return;
      const t = titleEl.value || "";
      const body = textEl.value || "";
      const words = body.trim() ? body.trim().split(/\s+/).length : 0;
      articleCountEl.textContent = `${words} words`;
      previewEl.innerHTML = `
        <div class="muted-block">
          <b>${escapeHtml(t || "Untitled")}</b><br><br>
          <div style="white-space:pre-wrap; line-height:1.5;">${escapeHtml(body)}</div>
        </div>
      `;
    }

    if (titleEl) titleEl.addEventListener("input", updatePreview);
    if (textEl) textEl.addEventListener("input", updatePreview);

    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        alert("Saved (demo).");
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        if (titleEl) titleEl.value = "";
        if (textEl) textEl.value = "";
        updatePreview();
      });
    }

    updatePreview();
  }

  /* =========================
     ECONOMY PAGE (CRITICAL GUARD ADDED)
     ========================= */
  function initEconomyPage(data){
    // Guard: only run on Economy page
    const __econRoot =
      document.getElementById("economy-root") ||
      document.getElementById("economyRoot") ||
      document.getElementById("econTiles") ||
      document.getElementById("economyTiles") ||
      document.getElementById("econTopline");
    if(!__econRoot && !document.getElementById("econTopline")) return;

    // If you have a dedicated economy.html root, render into it.
    const root = document.getElementById("economy-root") || document.getElementById("economyRoot");
    if (!root) return;

    const econ = data.economyPage || {};
    const tl = econ.topline || {};

    root.innerHTML = `
      <h1 class="page-title">Economy</h1>

      <section class="panel">
        <h2>Topline</h2>
        <div class="muted-block">
          <div class="kv"><div><b>Inflation</b></div><div>${fmtPct(tl.inflation)}</div></div>
          <div class="kv"><div><b>Unemployment</b></div><div>${fmtPct(tl.unemployment)}</div></div>
          <div class="kv"><div><b>GDP growth</b></div><div>${fmtPct(tl.gdpGrowth)}</div></div>
        </div>
      </section>

      <section class="panel" style="margin-top:14px;">
        <h2>UK Information (tiles)</h2>
        <div class="muted-block">Click a tile to expand details.</div>
        <div id="econTilesGrid" class="wgo-grid" style="margin-top:12px;"></div>
        <div id="econTileDetail" class="muted-block" style="margin-top:12px; display:none;"></div>
      </section>

      <section class="panel" style="margin-top:14px;">
        <h2>Surveys & Reports (tiles)</h2>
        <div class="muted-block">Click a tile to expand details.</div>
        <div id="econSurveysGrid" class="wgo-grid" style="margin-top:12px;"></div>
        <div id="econSurveyDetail" class="muted-block" style="margin-top:12px; display:none;"></div>
      </section>
    `;

    const tilesGrid = document.getElementById("econTilesGrid");
    const tileDetail = document.getElementById("econTileDetail");
    const surveysGrid = document.getElementById("econSurveysGrid");
    const surveyDetail = document.getElementById("econSurveyDetail");

    function renderRows(rows){
      if (!rows || !rows.length) return `<div class="muted">No data.</div>`;
      const header = rows[0];
      const body = rows.slice(1);
      if (Array.isArray(header) && header.length === 3 && body.every(r => Array.isArray(r) && r.length === 3)) {
        return `
          <div class="kv"><div><b>${escapeHtml(header[0])}</b></div><div><b>${escapeHtml(header[1])}</b></div><div><b>${escapeHtml(header[2])}</b></div></div>
          ${body.map(r => `
            <div class="kv"><div>${escapeHtml(r[0])}</div><div>${escapeHtml(r[1])}</div><div>${escapeHtml(r[2])}</div></div>
          `).join("")}
        `;
      }
      return rows.map(r => Array.isArray(r)
        ? `<div class="kv"><div>${escapeHtml(r[0])}</div><div>${escapeHtml(r[1] ?? "")}</div></div>`
        : `<div>${escapeHtml(r)}</div>`
      ).join("");
    }

    (econ.ukInfoTiles || []).forEach(t => {
      const tile = document.createElement("div");
      tile.className = "wgo-tile card-flex";
      tile.innerHTML = `
        <div class="wgo-kicker">UK INFO</div>
        <div class="wgo-title">${escapeHtml(t.title || "Tile")}</div>
        <div class="wgo-strap">${escapeHtml(t.subtitle || "")}</div>
        <div class="tile-bottom">
          <button class="btn" type="button">Open</button>
        </div>
      `;
      tile.querySelector("button").addEventListener("click", () => {
        tileDetail.style.display = "";
        tileDetail.innerHTML = `<b>${escapeHtml(t.title || "")}</b><br><br>${renderRows(t.rows || [])}`;
        window.scrollTo({ top: tileDetail.offsetTop - 10, behavior:"smooth" });
      });
      tilesGrid.appendChild(tile);
    });

    (econ.surveys || []).forEach(s => {
      const tile = document.createElement("div");
      tile.className = "wgo-tile card-flex";
      tile.innerHTML = `
        <div class="wgo-kicker">SURVEY</div>
        <div class="wgo-title">${escapeHtml(s.title || "Survey")}</div>
        <div class="wgo-strap">Reports & indicators</div>
        <div class="tile-bottom">
          <button class="btn" type="button">Open</button>
        </div>
      `;
      tile.querySelector("button").addEventListener("click", () => {
        surveyDetail.style.display = "";
        surveyDetail.innerHTML = `<b>${escapeHtml(s.title || "")}</b><br><br>${renderRows(s.rows || [])}`;
        window.scrollTo({ top: surveyDetail.offsetTop - 10, behavior:"smooth" });
      });
      surveysGrid.appendChild(tile);
    });
  }

  /* =========================
     PAPERS/NEWS extra init (safe no-ops)
     ========================= */
  function initPapersPage(data){ /* intentionally empty (render handles) */ }
  function initQuestionTimePageLanding(data){ /* intentionally empty (render handles) */ }

  /* =========================
     LIVE REFRESH (optional)
     ========================= */
  function startLiveRefresh() {
    setInterval(() => {
      try {
        const data = getData();
        if (!data) return;
        // re-render only pages that have the target nodes
        renderSimDate(data);
        renderWhatsGoingOn(data);
        renderLiveDocket(data);
        renderOrderPaper(data);
        renderNewsPage(data);
        renderPapersPage(data);
        renderQuestionTimePage(data);
        renderConstituenciesPage(data);
        renderBodiesPage(data);
        renderUserPage(data);
      } catch (e) {
        console.warn("Live refresh error:", e);
      }
    }, LIVE_REFRESH_MS);
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

      // Dashboard
      renderSimDate(data);
      renderWhatsGoingOn(data);
      renderLiveDocket(data);
      renderOrderPaper(data);

      // Pages
      initBillPage(data);
      renderNewsPage(data);
      renderPapersPage(data);
      renderQuestionTimePage(data);
      renderConstituenciesPage(data);
      renderBodiesPage(data);
      renderUserPage(data);

      // Builders (SAFE-GUARDED)
      initSubmitBillPage(data);
      initPartyDraftPage(data);
      initEconomyPage(data);

      // QT office page
      initQuestionTimePage(data);

      startLiveRefresh();
    })
    .catch(err => console.error("Error loading demo.json:", err));
})();
