// js/pages/staff-dropon.js
import { requireLogin } from "../auth.js";
import { canAdminModOrSpeaker } from "../permissions.js";
import { esc } from "../ui.js";
import {
  apiGetModsMessage,
  apiGetCharacterApplications,
  apiGetMotions,
  apiGetStatements,
  apiGetRegulations,
  apiGetBills,
  apiGetDivisions,
  apiGetQtQuestions,
} from "../api.js";

function countTileHTML({ icon, title, count, href, desc }) {
  const badge = count === "—"
    ? `<span style="font-size:1.8rem;font-weight:700;color:var(--muted-text,#666);">—</span>`
    : `<span style="font-size:1.8rem;font-weight:700;color:var(--navy);">${count}</span>`;
  return `
    <a href="${esc(href)}" class="tile card-flex" style="text-decoration:none;" aria-label="${esc(title)}: ${count === "—" ? "unknown" : count}">
      <div class="card-body" style="flex:1;">
        <div style="font-size:1.6rem;margin-bottom:6px;" aria-hidden="true">${icon}</div>
        <div style="margin-bottom:4px;">${badge}</div>
        <h3 class="tile-title" style="margin:0 0 4px;font-size:.95rem;">${esc(title)}</h3>
        ${desc ? `<p class="muted" style="margin:0;font-size:.82rem;line-height:1.4;">${esc(desc)}</p>` : ""}
      </div>
    </a>
  `;
}

function modsMessageBoxHTML(message) {
  const text = (message || "").trim();
  if (!text) return "";
  const lines = text.split(/\n+/).map((l) => `<p style="margin:0 0 8px;">${esc(l)}</p>`).join("");
  return `
    <section class="panel" aria-labelledby="staff-mods-msg-heading"
             style="margin-top:24px;border-left:4px solid var(--red,#c00);background:#fff8f8;">
      <h2 id="staff-mods-msg-heading" style="margin:0 0 10px;font-size:1rem;font-weight:800;color:var(--navy);">
        📋 Message from the Mods (Staff)
      </h2>
      <div style="font-size:.95rem;color:var(--navy,#0a2240);line-height:1.6;">${lines}</div>
    </section>
  `;
}

async function render(host, data, counts) {
  const user   = data?.currentUser;
  const name   = esc(user?.username || user?.name || "Staff Member");

  const opTiles = [
    { icon: "📋", title: "Pending Applications",   count: counts.pendingApps,   href: "control-panel.html", desc: "Character approvals awaiting decision" },
    { icon: "🎙️", title: "Open Question Time",      count: counts.openQT,        href: "questiontime.html",  desc: "Questions needing ministerial answers" },
    { icon: "📜", title: "Bills in Progress",        count: counts.openBills,     href: "submit-bill.html",   desc: "Bills currently at a parliamentary stage" },
    { icon: "🗳️", title: "Open Motions",             count: counts.openMotions,   href: "motions.html",       desc: "House motions open for debate or division" },
    { icon: "⚖️", title: "Open Regulations",         count: counts.openRegs,      href: "regulations.html",   desc: "Regulations under parliamentary scrutiny" },
    { icon: "📢", title: "Open Statements",          count: counts.openStmts,     href: "statements.html",    desc: "Ministerial statements currently open" },
    { icon: "🏴", title: "Active Divisions",         count: counts.openDivisions, href: "motions.html",       desc: "Divisions currently underway in the House" },
  ].map(countTileHTML).join("");

  host.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Staff Briefing — Order of Business</div></div>

    <section class="panel" style="margin-bottom:0;padding-bottom:8px;">
      <p style="font-size:1.05rem;margin:0;color:var(--navy);">
        Welcome back, <strong>${name}</strong>. You are logged in as a member of the Rule Britannia staff team.
        The briefing below shows current parliamentary activity and pending moderation tasks.
      </p>
    </section>

    ${modsMessageBoxHTML(counts.staffMessage)}

    <section aria-labelledby="ops-heading" style="margin-top:24px;">
      <h2 id="ops-heading" style="font-size:1.2rem;font-weight:800;margin:0 0 14px;color:var(--navy);">
        Westminster Activity — Live Status
      </h2>
      <div class="tile-grid">
        ${opTiles}
      </div>
    </section>

    <section class="panel" aria-labelledby="cp-heading" style="margin-top:24px;display:flex;flex-wrap:wrap;align-items:center;gap:16px;">
      <div style="flex:1;min-width:220px;">
        <h2 id="cp-heading" style="margin:0 0 6px;font-size:1.1rem;font-weight:800;">Control Panel</h2>
        <p class="muted" style="margin:0;font-size:.9rem;">
          Manage the simulation, handle character approvals, moderate players, and administer the game.
        </p>
      </div>
      <a href="control-panel.html" class="btn primary" style="font-size:1rem;padding:14px 28px;white-space:nowrap;">
        Go to Control Panel →
      </a>
    </section>

    <section class="panel" aria-labelledby="staff-quick-heading" style="margin-top:16px;">
      <h2 id="staff-quick-heading" style="margin:0 0 10px;font-size:1rem;font-weight:800;">Staff Quick Links</h2>
      <div style="display:flex;flex-wrap:wrap;gap:10px;">
        <a href="news.html"         class="btn">📰 Newsroom</a>
        <a href="government.html"   class="btn">🏛️ Government</a>
        <a href="bodies.html"       class="btn">🏢 Bodies</a>
        <a href="polling.html"      class="btn">📊 Polling</a>
        <a href="elections.html"    class="btn">🗳️ Elections</a>
        <a href="https://forum.rulebritannia.org/c/mod-mountain/5" class="btn" target="_blank" rel="noopener">⛰️ Mod Mountain</a>
      </div>
    </section>
  `;
}

export async function initStaffDroponPage(data) {
  const user = await requireLogin();
  if (!user) return;

  data.currentUser ??= user;

  if (!canAdminModOrSpeaker(data)) {
    window.location.href = "dashboard.html";
    return;
  }

  const host = document.getElementById("staff-dropon-root") || document.querySelector("main.wrap");
  if (!host) return;

  // Fetch all counts in parallel; graceful fallback on failure
  const [msgResult, pendingAppsResult, billsResult, motionsResult, stmtsResult, regsResult, divisionsResult, qtResult] = await Promise.allSettled([
    apiGetModsMessage(),
    apiGetCharacterApplications("pending"),
    apiGetBills(),
    apiGetMotions(),
    apiGetStatements(),
    apiGetRegulations(),
    apiGetDivisions({ status: "open" }),
    apiGetQtQuestions({ status: "open" }),
  ]);

  const msg        = msgResult.status === "fulfilled" ? msgResult.value : {};
  const pendingRaw = pendingAppsResult.status === "fulfilled" ? pendingAppsResult.value : {};
  const billsRaw   = billsResult.status === "fulfilled" ? billsResult.value : {};
  const motionsRaw = motionsResult.status === "fulfilled" ? motionsResult.value : {};
  const stmtsRaw   = stmtsResult.status === "fulfilled" ? stmtsResult.value : {};
  const regsRaw    = regsResult.status === "fulfilled" ? regsResult.value : {};
  const divsRaw    = divisionsResult.status === "fulfilled" ? divisionsResult.value : null;
  const qtRaw      = qtResult.status === "fulfilled" ? qtResult.value : null;

  function countArr(val) {
    if (!val || val === "—") return "—";
    if (Array.isArray(val)) return val.length;
    const arr = val.applications ?? val.bills ?? val.motions ?? val.statements ?? val.regulations ?? val.divisions ?? val.questions;
    return Array.isArray(arr) ? arr.length : "—";
  }

  // Filter to only open/active items
  const bills   = Array.isArray(billsRaw?.bills)    ? billsRaw.bills   : [];
  const motions = Array.isArray(motionsRaw?.motions) ? motionsRaw.motions : [];
  const stmts   = Array.isArray(stmtsRaw?.statements) ? stmtsRaw.statements : [];
  const regs    = Array.isArray(regsRaw?.regulations) ? regsRaw.regulations : [];

  const openBills   = bills.filter((b) => b.status && !["royal_assent","withdrawn","defeated"].includes(b.status)).length;
  const openMotions = motions.filter((m) => m.status === "open" || m.status === "debate").length;
  const openStmts   = stmts.filter((s) => s.status === "open" || s.status === "debate").length;
  const openRegs    = regs.filter((r) => r.status === "open" || r.status === "debate").length;

  const counts = {
    staffMessage:  msg?.staffMessage ?? "",
    pendingApps:   countArr(pendingRaw),
    openBills:     billsResult.status      === "fulfilled" ? openBills   : "—",
    openMotions:   motionsResult.status    === "fulfilled" ? openMotions : "—",
    openStmts:     stmtsResult.status      === "fulfilled" ? openStmts   : "—",
    openRegs:      regsResult.status       === "fulfilled" ? openRegs    : "—",
    openDivisions: countArr(divsRaw),
    openQT:        countArr(qtRaw),
  };

  await render(host, data, counts);
}
