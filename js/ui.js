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

/** Muted one-line purpose description for each page. */
const PAGE_PURPOSE = {
  dashboard:           "Your personal office — track active business, messages, and your parliamentary role.",
  news:                "Latest news stories from across Britain, updated each simulation month.",
  papers:              "Browse newspaper front pages and published issues from each major outlet.",
  economy:             "Live macroeconomic indicators, public finance data, and key statistics.",
  constituencies:      "All 650 UK constituencies — seats, majorities, and MP assignments.",
  bodies:              "Elected and appointed public bodies, quangos, and devolved institutions.",
  locals:              "Local government overview — councils, leaders, and local election results.",
  "submit-bill":       "Draft and submit a new Bill for consideration by the House of Commons.",
  questiontime:        "Ask written questions to ministers; ministers answer within the deadline.",
  statements:          "Ministerial statements made to the House on matters of public importance.",
  motions:             "House motions and Early Day Motions open for debate and signature.",
  regulations:         "Statutory instruments laid before Parliament for approval or annulment.",
  redlion:             "The Red Lion — the parliamentary bar where deals are made off the record.",
  debates:             "Ongoing and archived debates linked to bills, motions, and statements.",
  hansard:             "The official record of proceedings — bills passed and defeated in Parliament.",
  press:               "Party press releases and press conferences — communicate with the media.",
  party:               "Your party's internal hub — membership, donations, and party management.",
  polling:             "Weekly polling tracker and trend analysis by party across the simulation.",
  elections:           "General election schedule, results history, and constituency projections.",
  "constituency-work": "Surgeries, casework, and community projects in your constituency.",
  events:              "Parliamentary events, recess dates, and party conference schedule.",
  fundraising:         "Party fundraising campaigns and donation totals.",
  online:              "Social media and digital communications for your party.",
  government:          "Cabinet, government structure, and ministerial responsibilities.",
  opposition:          "Shadow Cabinet and official opposition leadership and policy positions.",
  budget:              "The Chancellor's Budget — revenue, expenditure, and fiscal projections.",
  civilservice:        "The civil service structure supporting each government department.",
  cabinet:             "Cabinet composition — Secretaries of State and their ministerial teams.",
  shadowcabinet:       "Shadow Cabinet composition and opposition spokespeople.",
  personal:            "Your personal profile, biography, and character settings.",
  user:                "Account settings, notification preferences, and session management.",
  team:                "The moderator and administrator team behind the simulation.",
  rules:               "The official rules and standing orders of the simulation.",
  guides:              "Guides and tutorials for new and experienced players.",
  bill:                "Full text, stage history, amendments, and debate record for a single Bill.",
  "control-panel":     "Moderator control panel — manage the simulation, clock, and game state.",
  "admin-panel":       "Administrator panel — user management, roles, and system configuration.",
  statement:           "Full text and debate thread for a single ministerial statement.",
  motion:              "Full text, signatories, and voting record for a single motion or EDM.",
  regulation:          "Full text and parliamentary scrutiny record for a single regulation.",
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
  // Mark write-action buttons with "Login required" label
  window.addEventListener("DOMContentLoaded", markDemoButtons, { once: true });
  // Also run immediately in case DOM is already ready
  setTimeout(markDemoButtons, 0);
}

/**
 * In demo mode, mark write-action buttons to display "Login required" inline.
 * Buttons are disabled and styled with the .btn-login-required class.
 */
function markDemoButtons() {
  qsa('button.btn[type="submit"], button.btn.primary, button.btn.danger, button.btn.secondary').forEach((btn) => {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.classList.add("btn-login-required");
    btn.setAttribute("data-tip", "Login required");
  });
}

/**
 * Inject a sim-date badge and page purpose line into the .bbc-masthead element
 * on the current page, if it exists.
 */
function injectSimBadge(clock) {
  const masthead = document.querySelector(".bbc-masthead");
  if (!masthead) return;
  // Don't duplicate if already injected
  if (masthead.querySelector(".sim-badge")) return;

  const month = clock?.sim_current_month ?? 8;
  const year  = clock?.sim_current_year  ?? 1997;
  const badge = document.createElement("span");
  badge.className = "sim-badge";
  badge.id = "sim-badge";
  badge.textContent = `${MONTH_NAMES[month - 1]} ${year}`;
  masthead.appendChild(badge);

  // Purpose line — inserted as a <p> after the masthead if not already present
  const page = document.body?.dataset?.page || "";
  const purpose = PAGE_PURPOSE[page];
  if (purpose && !masthead.querySelector(".page-purpose")) {
    const p = document.createElement("p");
    p.className = "page-purpose";
    p.textContent = purpose;
    // Insert the purpose line on its own row below the masthead
    masthead.insertAdjacentElement("afterend", p);
  }
}

export function initNavUI(user, clock) {
  // Demo mode banner — shown whenever no authenticated user is present
  if (!user) {
    insertDemoBanner();
  }

  // Inject sim-date badge into page masthead
  if (clock) {
    injectSimBadge(clock);
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

/**
 * Render a styled empty-state tile into the given container element.
 * @param {HTMLElement} container  — the element to render into
 * @param {object}      opts
 * @param {string}      opts.icon  — emoji icon (default "📭")
 * @param {string}      opts.title — bold heading
 * @param {string}      opts.body  — explanatory sentence
 */
export function renderEmptyState(container, { icon = "📭", title, body } = {}) {
  if (!container) return;
  container.innerHTML = `
    <div class="empty-state-tile">
      <div class="empty-icon">${esc(icon)}</div>
      <div class="empty-title">${esc(title ?? "Nothing here yet")}</div>
      <p class="empty-body">${esc(body ?? "Moderators can create the first one.")}</p>
    </div>`;
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


