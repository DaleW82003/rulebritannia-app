// js/pages/player-dropon.js
import { requireLogin } from "../auth.js";
import { esc } from "../ui.js";
import { getCharacterContext } from "../engines/core-engine.js";
import { apiGetModsMessage } from "../api.js";

// ── Westminster-flavoured action tiles shown when a character is active ──────
const BRIEFING_TILES = [
  {
    href: "dashboard.html",
    icon: "🏛️",
    title: "Your Office",
    desc: "Your docket, live parliamentary business, and your ministerial or shadow brief.",
    cta: "Enter Your Office",
  },
  {
    href: "questiontime.html",
    icon: "🎙️",
    title: "Question Time",
    desc: "Submit questions to ministers, follow PMQs, and hold the Government to account.",
    cta: "Go to Questions",
  },
  {
    href: "motions.html",
    icon: "🗳️",
    title: "Motions",
    desc: "Lay down an EDM, support a motion, or follow the division results.",
    cta: "View Motions",
  },
  {
    href: "submit-bill.html",
    icon: "📜",
    title: "Legislation",
    desc: "Draft and submit a Private Member's Bill or check the legislative programme.",
    cta: "Go to Bills",
  },
  {
    href: "party.html",
    icon: "🏳️",
    title: "Your Party",
    desc: "Manage your party affairs, check the whip, and engage with colleagues.",
    cta: "Party HQ",
  },
  {
    href: "press.html",
    icon: "📰",
    title: "The Press",
    desc: "Engage journalists, manage your media profile, and shape the narrative.",
    cta: "Go to Press",
  },
];

function briefingTileHTML(t) {
  return `
    <div class="tile card-flex">
      <div class="card-body" style="flex:1;">
        <div style="font-size:2rem;margin-bottom:10px;" aria-hidden="true">${t.icon}</div>
        <h3 class="tile-title" style="margin:0 0 8px;font-size:1.05rem;">${esc(t.title)}</h3>
        <p class="muted" style="margin:0;font-size:.9rem;line-height:1.55;">${esc(t.desc)}</p>
      </div>
      <div class="tile-bottom">
        <a href="${esc(t.href)}" class="btn primary" style="width:100%;justify-content:center;">${esc(t.cta)}</a>
      </div>
    </div>
  `;
}

function modsMessageBoxHTML(message) {
  const text = (message || "").trim();
  if (!text) return "";
  const lines = text.split(/\n+/).map((l) => `<p style="margin:0 0 8px;">${esc(l)}</p>`).join("");
  return `
    <section class="panel" aria-labelledby="mods-msg-heading" style="margin-top:24px;border-left:4px solid var(--blue,#1a56db);background:var(--blue-faint,#e8f0fe);">
      <h2 id="mods-msg-heading" style="margin:0 0 10px;font-size:1rem;font-weight:800;color:var(--navy);">
        📋 Message from the Mods
      </h2>
      <div style="font-size:.95rem;color:var(--navy,#0a2240);line-height:1.6;">${lines}</div>
    </section>
  `;
}

function renderNoChar(host, name, playerMessage) {
  host.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Welcome to Westminster, ${name}</div></div>

    <section class="panel" aria-labelledby="no-char-heading"
             style="margin-bottom:24px;border:2px solid var(--blue,#1a56db);background:var(--blue-faint,#e8f0fe);"
             aria-live="polite">
      <h2 id="no-char-heading" style="font-size:1.25rem;font-weight:800;margin:0 0 10px;color:var(--navy);">
        🏛️ You have not yet taken your seat in Parliament
      </h2>
      <p style="margin:0 0 10px;color:var(--navy);line-height:1.6;">
        To submit bills, answer questions, make statements, and engage in the full parliamentary
        experience you must first create and activate a character.
      </p>
      <p style="margin:0 0 18px;color:var(--navy);font-size:.95rem;line-height:1.6;">
        Choose a constituency, pick your party, and take your seat on the green benches.
        The House awaits.
      </p>
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;">
        <a href="personal.html" class="btn primary" style="font-size:1rem;padding:12px 24px;">
          Create Your Character →
        </a>
        <a href="dashboard.html" class="btn">View the Chamber</a>
        <a href="guides.html" class="btn">Read the Guides</a>
        <a href="rules.html" class="btn">Read the Rules</a>
      </div>
    </section>

    ${modsMessageBoxHTML(playerMessage)}
  `;
}

function renderWithChar(host, name, char, playerMessage) {
  const charName = esc(char?.name || name);
  const party    = esc(char?.party || "");
  const tiles    = BRIEFING_TILES.map(briefingTileHTML).join("");

  host.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Order of Business — ${charName}</div></div>

    <section class="panel" style="margin-bottom:0;padding-bottom:8px;">
      <p style="font-size:1.1rem;margin:0;color:var(--navy);">
        <strong>${charName}</strong>${party ? `, ${party}` : ""} —
        Parliament is in session. What is your business today?
      </p>
    </section>

    ${modsMessageBoxHTML(playerMessage)}

    <section aria-labelledby="briefing-heading" style="margin-top:24px;">
      <h2 id="briefing-heading" style="font-size:1.2rem;font-weight:800;margin:0 0 14px;color:var(--navy);">
        Parliamentary Business
      </h2>
      <div class="tile-grid">
        ${tiles}
      </div>
    </section>

    <section class="panel" aria-labelledby="quick-heading" style="margin-top:24px;">
      <h2 id="quick-heading" style="margin:0 0 10px;font-size:1rem;font-weight:800;">Further Business</h2>
      <div style="display:flex;flex-wrap:wrap;gap:10px;">
        <a href="news.html"      class="btn">📰 BBC News</a>
        <a href="papers.html"    class="btn">🗞️ The Papers</a>
        <a href="economy.html"   class="btn">📊 Economy</a>
        <a href="statements.html" class="btn">📢 Statements</a>
        <a href="regulations.html" class="btn">⚖️ Regulations</a>
        <a href="/api/discourse/go" class="btn">💬 Discourse Forum</a>
      </div>
    </section>
  `;
}

export async function initPlayerDroponPage(data) {
  const user = await requireLogin();
  if (!user) return;

  data.currentUser ??= user;

  const host = document.getElementById("player-dropon-root") || document.querySelector("main.wrap");
  if (!host) return;

  const char   = getCharacterContext(data);
  const hasChar = !!char?.name;
  const name   = esc(user?.username || user?.name || "Member");

  let playerMessage = "";
  try {
    const msg = await apiGetModsMessage();
    playerMessage = msg?.playerMessage ?? "";
  } catch (err) {
    console.warn("[player-dropon] could not load mods message:", err);
  }

  if (hasChar) {
    renderWithChar(host, name, char, playerMessage);
  } else {
    renderNoChar(host, name, playerMessage);
  }
}
