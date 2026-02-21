// js/main.js
import { bootData } from "./core.js";
import { initNavUI, esc } from "./ui.js";

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

import { initPersonalPage } from "./pages/personal.js";
import { initUserPage } from "./pages/user.js";
import { initTeamPage } from "./pages/team.js";
import { initRulesPage } from "./pages/rules.js";
import { initGuidesPage } from "./pages/guides.js";
import { initBillPage } from "./pages/bill.js";
import { initControlPanelPage } from "./pages/control-panel.js";
import { initAdminPanelPage } from "./pages/admin-panel.js";
import { initLoginPage } from "./pages/login.js";

function showBootError(err) {
  console.error(err);
  const msg = document.createElement("div");
  msg.style.padding = "16px";
  msg.style.border = "2px solid #c00";
  msg.style.background = "#fff5f5";
  msg.style.color = "#111";
  msg.style.borderRadius = "12px";
  msg.innerHTML = `<b>Fatal boot error:</b> ${esc(String(err?.message || err))}`;
  document.body.prepend(msg);
}

(async function () {
  document.body.dataset.bootState = "booting";
  try {
    const { data, user } = await bootData();
    initNavUI(user);

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

      personal: initPersonalPage,
      user: initUserPage,
      team: initTeamPage,
      rules: initRulesPage,
      guides: initGuidesPage,
      bill: initBillPage,
      "control-panel": initControlPanelPage,
      "admin-panel": initAdminPanelPage,
      login: initLoginPage,
    };

    const init = routes[page];

    if (typeof init === "function") {
      init(data, user);
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
