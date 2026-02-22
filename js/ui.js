// js/ui.js
import { qsa } from "./core.js";
import { apiLogout } from "./api.js";

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];

/** Map of data-page value → href used in nav links (for active highlight). */
const PAGE_HREF_MAP = {
  dashboard:           "dashboard.html",
  news:                "news.html",
  papers:              "papers.html",
  economy:             "economy.html",
  constituencies:      "constituencies.html",
  bodies:              "bodies.html",
  locals:              "locals.html",
  "submit-bill":       "submit-bill.html",
  questiontime:        "questiontime.html",
  statements:          "statements.html",
  motions:             "motions.html",
  regulations:         "regulations.html",
  redlion:             "redlion.html",
  debates:             "debates.html",
  hansard:             "hansard.html",
  press:               "press.html",
  party:               "party.html",
  polling:             "polling.html",
  elections:           "elections.html",
  "constituency-work": "constituency-work.html",
  events:              "events.html",
  fundraising:         "fundraising.html",
  online:              "online.html",
  government:          "government.html",
  opposition:          "opposition.html",
  budget:              "budget.html",
  civilservice:        "civilservice.html",
  cabinet:             "cabinet.html",
  shadowcabinet:       "shadowcabinet.html",
  personal:            "personal.html",
  user:                "user.html",
  team:                "team.html",
  rules:               "rules.html",
  guides:              "guides.html",
  bill:                "bill.html",
  "control-panel":     "control-panel.html",
  "admin-panel":       "admin-panel.html",
  statement:           "statement.html",
  motion:              "motion.html",
  regulation:          "regulation.html",
};

/**
 * Apply `.active` class to the nav link matching the current page.
 * Also marks parent `.nav-toggle` active when a dropdown child matches.
 */
function setActiveNav() {
  const page = document.body?.dataset?.page || "";
  const href = PAGE_HREF_MAP[page];
  if (!href) return;

  // Top-level links
  qsa(`.nav > a.nav-link[href="${href}"]`).forEach((el) => {
    el.classList.add("active");
    el.setAttribute("aria-current", "page");
  });

  // Dropdown links → activate parent toggle too
  qsa(`.dropdown a[href="${href}"]`).forEach((el) => {
    el.classList.add("active");
    el.setAttribute("aria-current", "page");
    const toggle = el.closest(".nav-group")?.querySelector(".nav-toggle");
    if (toggle) toggle.classList.add("active");
  });
}

/**
 * Insert a persistent "DEMO MODE" banner above the topbar when the user is
 * not logged in.
 */
function insertDemoBanner() {
  if (document.getElementById("rb-demo-banner")) return;
  const banner = document.createElement("div");
  banner.id = "rb-demo-banner";
  banner.className = "demo-banner";
  banner.setAttribute("role", "status");
  banner.innerHTML =
    'DEMO MODE — <a href="login.html">Login</a> to use live simulation';
  document.body.prepend(banner);
  // Disable all write-action buttons once DOM is fully rendered
  window.addEventListener("DOMContentLoaded", disableDemoButtons, { once: true });
  // Also run immediately in case DOM is already ready
  setTimeout(disableDemoButtons, 0);
}

/**
 * In demo mode, mark write-action buttons as disabled with a tooltip so
 * users understand they need to log in.
 */
function disableDemoButtons() {
  qsa('button.btn[type="submit"], button.btn.primary, button.btn.danger').forEach((btn) => {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.setAttribute("data-tip", "Login required");
  });
}

export function initNavUI(user, clock) {
  // Demo mode banner — shown whenever no authenticated user is present
  if (!user) {
    insertDemoBanner();
  }

  // Dropdown open/close
  const groups = qsa(".nav-group");
  groups.forEach(g => {
    const btn = g.querySelector(".nav-toggle");
    if (!btn) return;

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      // close others
      groups.forEach(other => { if (other !== g) other.classList.remove("open"); });
      g.classList.toggle("open");
    });
  });

  document.addEventListener("click", () => {
    groups.forEach(g => g.classList.remove("open"));
  });

  // Active nav highlighting
  setActiveNav();

  // Topbar clock display — inserted into topbar-inner after the brand
  const topbarInner = document.querySelector(".topbar-inner");
  if (topbarInner && clock) {
    const monthName = MONTH_NAMES[clock.sim_current_month - 1];
    const clockEl = document.createElement("span");
    clockEl.id = "topbar-clock";
    clockEl.className = "topbar-clock";
    clockEl.textContent = `${monthName} ${clock.sim_current_year}`;
    const brand = topbarInner.querySelector(".brand");
    if (brand && brand.nextSibling) {
      topbarInner.insertBefore(clockEl, brand.nextSibling);
    } else {
      topbarInner.appendChild(clockEl);
    }
  }

  // Topbar auth status — replace the static "Admin Login" element
  const nav = document.querySelector(".nav");
  if (nav) {
    const existing = nav.querySelector('a[href="login.html"].nav-link, span.nav-link[aria-current="page"]');
    if (existing) existing.remove();

    const authEl = document.createElement("span");
    authEl.id = "topbar-auth";
    authEl.className = "topbar-auth";

    if (user) {
      const label = document.createElement("span");
      label.className = "topbar-auth-label";
      label.textContent = `Logged in as ${user.username}`;

      const logoutBtn = document.createElement("button");
      logoutBtn.type = "button";
      logoutBtn.className = "topbar-logout-btn";
      logoutBtn.textContent = "Logout";
      logoutBtn.addEventListener("click", async () => {
        try { await apiLogout(); } catch { /* ignore */ }
        window.location.href = "login.html";
      });

      authEl.appendChild(label);
      authEl.appendChild(logoutBtn);
    } else {
      const label = document.createElement("span");
      label.className = "topbar-auth-label";
      label.textContent = "Not logged in";

      const loginLink = document.createElement("a");
      loginLink.href = "login.html";
      loginLink.className = "nav-link";
      loginLink.textContent = "Login";

      authEl.appendChild(label);
      authEl.appendChild(loginLink);
    }

    nav.appendChild(authEl);
  }

  // "Back to Your Office" affordance — inject into page header on non-dashboard pages
  const page = document.body?.dataset?.page || "";
  if (page && page !== "dashboard" && page !== "login") {
    const main = document.querySelector("main.wrap");
    if (main) {
      const backLink = document.createElement("a");
      backLink.href = "dashboard.html";
      backLink.className = "back-office-link";
      backLink.textContent = "← Back to Your Office";
      main.prepend(backLink);
    }
  }
}

export function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

export function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
