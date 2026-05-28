// js/main.js
import { bootData } from "./core.js";
import { initNavUI, esc } from "./ui.js";
import { handleApiError } from "./errors.js";

// Working pages (already built)
import { initDashboardPage } from "./pages/dashboard.js";
import { initNewsPage } from "./pages/news.js";
import { initPapersPage } from "./pages/papers.js";
import { initQuestionTimePage } from "./pages/questiontime.js";

// Stubs / to-be-built pages (you said you created these files already)
import { initSubmitBillPage } from "./pages/submit-bill.js";
import { initStatementsPage } from "./pages/statements.js";
import { initStatementPage } from "./pages/statement.js";
import { initMotionsPage } from "./pages/motions.js";
import { initMotionPage } from "./pages/motion.js";
import { initRegulationsPage } from "./pages/regulations.js";
import { initRegulationPage } from "./pages/regulation.js";
import { initRedLionPage } from "./pages/redlion.js";
import { initHansardPage } from "./pages/hansard.js";
import { initDebatesPage } from "./pages/debates.js";

import { initEconomyPage } from "./pages/economy.js";
import { initConstituenciesPage } from "./pages/constituencies.js";
import { initBodiesPage } from "./pages/bodies.js";
import { initLocalsPage } from "./pages/locals.js";

import { initPressPage } from "./pages/press.js";
import { initPartyPage } from "./pages/party.js";
import { initPollingPage } from "./pages/polling.js";
import { initElectionsPage } from "./pages/elections.js";
import { initConstituencyWorkPage } from "./pages/constituency-work.js";
import { initEventsPage } from "./pages/events.js";
import { initFundraisingPage } from "./pages/fundraising.js";
import { initOnlinePage } from "./pages/online.js";

import { initGovernmentPage } from "./pages/government.js";
import { initOppositionPage } from "./pages/opposition.js";
import { initBudgetPage } from "./pages/budget.js";
import { initCivilServicePage } from "./pages/civilservice.js";
import { initCabinetPage } from "./pages/cabinet.js";
import { initShadowCabinetPage } from "./pages/shadowcabinet.js";
import { initPrivyCouncilPage } from "./pages/privycouncil.js";

import { initPersonalPage } from "./pages/personal.js";
import { initUserPage } from "./pages/user.js";
import { initTeamPage } from "./pages/team.js";
import { initProfilePage } from "./pages/profile.js";
import { initRulesPage } from "./pages/rules.js";
import { initGuidesPage } from "./pages/guides.js";
import { initBillPage } from "./pages/bill.js";
import { initControlPanelPage } from "./pages/control-panel.js";
import { initAdminPanelPage } from "./pages/admin-panel.js";
import { initPlayerbasePage } from "./pages/playerbase.js";
import { initLoginPage } from "./pages/login.js";
import { initStaffDroponPage } from "./pages/staff-dropon.js";
import { initPlayerDroponPage } from "./pages/player-dropon.js";
import { initLandingPage } from "./pages/landing.js";
import { initRegisterPage } from "./pages/register.js";
import { initVerifyEmailPage } from "./pages/verify-email.js";
import { initSupportPage } from "./pages/support.js";

function showBootError(err) {
  console.error(err);
  handleApiError(err, "Boot error");
  const msg = document.createElement("div");
  msg.style.padding = "16px";
  msg.style.border = "2px solid #c00";
  msg.style.background = "#fff5f5";
  msg.style.color = "#111";
  msg.style.borderRadius = "12px";
  msg.innerHTML = `<b>Fatal boot error:</b> ${esc(String(err?.message || err))}`;
  document.body.prepend(msg);
}

function isIgnorableRuntimeNoise(reason) {
  const text = String(reason?.message || reason || "");
  return text.includes("No Listener: tabs:outgoing.message.ready");
}

// Global safety net: any unhandled promise rejection across all pages fires a toast.
window.addEventListener("unhandledrejection", (event) => {
  if (isIgnorableRuntimeNoise(event.reason)) {
    event.preventDefault();
    return;
  }
  handleApiError(event.reason, "Unexpected error");
  event.preventDefault(); // suppress duplicate browser console warning
});

/**
 * Returns true when debug mode is enabled via URL (?debug=1) or localStorage (rb_debug=1).
 * Used to gate developer-facing UI such as the API Sources panel.
 */
function isDebugEnabled() {
  try {
    if (new URLSearchParams(window.location.search).get("debug") === "1") return true;
    if (localStorage.getItem("rb_debug") === "1") return true;
  } catch { /* ignore */ }
  return false;
}

function renderDataSourcePanel(sources) {
  const failCount = sources.filter((s) => !s.ok).length;
  const allOk = failCount === 0;
  const panel = document.createElement("div");
  panel.className = "ds-panel";

  const rows = sources.map((s) =>
    `<div class="ds-row"${s.error ? ` aria-label="${esc(s.label)}: ${esc(s.error)}"` : ""}>` +
    `<span class="ds-dot ${s.ok ? "ok" : "fail"}" aria-hidden="true"></span>` +
    `<span class="ds-label">${esc(s.label)}</span>` +
    (s.error ? `<span class="ds-err">${esc(s.error)}</span>` : "") +
    `</div>`
  ).join("");

  const summaryText = failCount ? `API Sources (${failCount} failed)` : "API Sources (all ok)";

  panel.innerHTML =
    `<button class="ds-panel-toggle" type="button" aria-expanded="false">` +
    `<span class="ds-dot ${allOk ? "ok" : "fail"}" aria-hidden="true"></span>` +
    `<span class="ds-toggle-label" aria-live="polite" aria-atomic="true">${summaryText}</span>` +
    `<span class="ds-caret" aria-hidden="true">▸</span>` +
    `</button>` +
    `<div class="ds-panel-body" hidden>${rows}</div>`;

  const toggle = panel.querySelector(".ds-panel-toggle");
  const body   = panel.querySelector(".ds-panel-body");
  const caret  = panel.querySelector(".ds-caret");
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!open));
    body.hidden = open;
    caret.textContent = open ? "▸" : "▾";
  });

  document.body.appendChild(panel);
}

(async function () {
  document.body.dataset.bootState = "booting";
  try {
    const page = document.body?.dataset?.page || "";

    // One router to rule them all
    const routes = {
      dashboard: initDashboardPage,
      news: initNewsPage,
      papers: initPapersPage,
      questiontime: initQuestionTimePage,

      "submit-bill": initSubmitBillPage,
      statements: initStatementsPage,
      statement: initStatementPage,
      motions: initMotionsPage,
      motion: initMotionPage,
      regulations: initRegulationsPage,
      regulation: initRegulationPage,
      redlion: initRedLionPage,
      hansard: initHansardPage,
      debates: initDebatesPage,

      economy: initEconomyPage,
      constituencies: initConstituenciesPage,
      bodies: initBodiesPage,
      locals: initLocalsPage,

      press: initPressPage,
      party: initPartyPage,
      polling: initPollingPage,
      elections: initElectionsPage,
      "constituency-work": initConstituencyWorkPage,
      events: initEventsPage,
      fundraising: initFundraisingPage,
      online: initOnlinePage,

      government: initGovernmentPage,
      opposition: initOppositionPage,
      budget: initBudgetPage,
      civilservice: initCivilServicePage,
      cabinet: initCabinetPage,
      shadowcabinet: initShadowCabinetPage,
      "privy-council": initPrivyCouncilPage,

      personal: initPersonalPage,
      user: initUserPage,
      team: initTeamPage,
      profile: initProfilePage,
      rules: initRulesPage,
      guides: initGuidesPage,
      bill: initBillPage,
      "control-panel": initControlPanelPage,
      "admin-panel": initAdminPanelPage,
      playerbase: initPlayerbasePage,
      login: initLoginPage,
      "staff-dropon": initStaffDroponPage,
      "player-dropon": initPlayerDroponPage,
      landing: initLandingPage,
      register: initRegisterPage,
      "verify-email": initVerifyEmailPage,

      // Static content pages — no JS initialiser needed; boot nav + mark ready.
      "community-rules": null,
      "privacy":         null,
      "terms":           null,
      "report":          null,

      support: initSupportPage,
    };

    const init = routes[page];
    const entryPages = new Set(["login", "register", "verify-email", "landing"]);

    let data = {};
    let user = null;
    if (entryPages.has(page)) {
      data = { gameState: {} };
    } else {
      const boot = await bootData();
      data = boot.data;
      user = boot.user;
      initNavUI(user, boot.clock, data.gameState, boot.simFreeze);
      if (boot.bootWarning) {
        const msg = document.createElement("div");
        msg.style.cssText = "padding:16px;border:2px solid #f90;background:#fffbf0;color:#111;border-radius:12px;margin-bottom:8px";
        msg.innerHTML = `<b>Server notice:</b> ${esc(boot.bootWarning)} Running in read-only demo mode.`;
        document.body.prepend(msg);
      }
      if (isDebugEnabled()) renderDataSourcePanel(boot.sources);
    }

    if (typeof init === "function") {
      await init(data, user);
      document.body.dataset.bootState = "ready";
      return;
    }

    // Known static content pages (null route) — boot completes without a JS init.
    if (page in routes && init === null) {
      document.body.dataset.bootState = "ready";
      return;
    }

    // If someone forgot data-page or we haven't wired the route yet:
    console.warn(`No route for data-page="${page}".`);
    const warn = document.createElement("div");
    warn.style.padding = "12px 16px";
    warn.style.margin = "16px auto";
    warn.style.maxWidth = "1100px";
    warn.style.border = "1px solid #f0c36d";
    warn.style.background = "#fff8e6";
    warn.style.color = "#111";
    warn.style.borderRadius = "12px";
    warn.innerHTML =
      `<b>Page not wired:</b> This HTML is missing a valid <code>data-page</code> route. ` +
      `Current value: <code>${esc(page || "(empty)")}</code>`;
    document.body.prepend(warn);
    document.body.dataset.bootState = "route-missing";

  } catch (err) {
    document.body.dataset.bootState = "error";
    showBootError(err);
  }
})();