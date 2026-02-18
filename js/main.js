// js/main.js
import { bootData } from "./core.js";
import { initNavUI } from "./ui.js";

// Page modules (we will add more progressively)
import { initDashboardPage } from "./pages/dashboard.js";
import { initNewsPage } from "./pages/news.js";
import { initPapersPage } from "./pages/papers.js";
import { initQuestionTimePage } from "./pages/questiontime.js";

(async function () {
  try {
    const data = await bootData();
    initNavUI();

    const page = document.body?.dataset?.page || "";

    // IMPORTANT: only run the module for the current page
    if (page === "dashboard") initDashboardPage(data);
    if (page === "news") initNewsPage(data);
    if (page === "papers") initPapersPage(data);
    if (page === "questiontime") initQuestionTimePage(data);

  } catch (err) {
    console.error(err);
    const msg = document.createElement("div");
    msg.style.padding = "16px";
    msg.innerHTML = `<b>Fatal boot error:</b> ${String(err.message || err)}`;
    document.body.prepend(msg);
  }
})();
