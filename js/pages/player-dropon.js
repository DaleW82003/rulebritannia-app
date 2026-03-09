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


const DEFAULT_STARTER_PACK_HTML = `
    <section class="panel" aria-labelledby="starter-pack-heading" style="margin-bottom:24px;">
      <h2 id="starter-pack-heading" style="margin:0 0 10px;font-size:1.15rem;font-weight:900;color:var(--navy);">
        ✅ Starter Pack: Your First Week in Rule Britannia
      </h2>

      <p class="muted" style="margin:0 0 12px;line-height:1.6;">
        You don’t need to read everything to start. Create a character, then complete these five actions.
        Each one is designed to generate momentum and give staff something clear to adjudicate.
      </p>

      <div class="tile" style="display:grid;gap:10px;">
        <div class="muted-block" style="line-height:1.6;">
          <b>1) Create your character (5 minutes)</b><br>
          Choose a constituency, pick a party, and write a short bio. Don’t overthink it—your first week will shape the details.
          <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:10px;">
            <a href="personal.html" class="btn primary">Create Your Character →</a>
            <a href="guides.html" class="btn">Read the Guides</a>
            <a href="rules.html" class="btn">Read the Rules</a>
          </div>
        </div>

        <div class="muted-block" style="line-height:1.6;">
          <b>2) Post an introduction (5–8 sentences)</b><br>
          Who are you, what do you believe, and what’s your one priority this week?
          End with a hook: “If you care about X, reply / work with me / challenge me.”
        </div>

        <div class="muted-block" style="line-height:1.6;">
          <b>3) Pick a signature issue + make one concrete promise</b><br>
          Choose one issue (NHS, housing, crime, jobs, civil liberties, education, etc.).
          Make a specific pledge you can follow through on: a question, a motion, an event, or a press push.
        </div>

        <div class="muted-block" style="line-height:1.6;">
          <b>4) Run one Activity (Event / Fundraiser / Online)</b><br>
          Write it so staff can adjudicate it:<br>
          <span class="muted">Objective → Audience → What you did (concrete) → Risk → “Staff: please brief/adjudicate reaction + complications.”</span>
        </div>

        <div class="muted-block" style="line-height:1.6;">
          <b>5) Make one Parliament move + build two relationships</b><br>
          Do one of: ask a Question Time question, join a debate, or support/launch a motion.
          Then: pick <b>one ally</b> (same party/faction) and <b>one rival or press contact</b> (outside your comfort zone) and interact with them directly.
        </div>
      </div>

      <p class="muted" style="margin:12px 0 0;line-height:1.6;">
        Want staff to pick up your storyline faster? Open a Support ticket with a one-sentence pitch and what you’re trying to achieve this week.
      </p>

      <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:10px;">
        <a href="support.html" class="btn">Open Support</a>
      </div>
    </section>
`;

function starterPackHTML(playerStarterPackHtml) {
  const html = String(playerStarterPackHtml || "").trim();
  return html || DEFAULT_STARTER_PACK_HTML;
}


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

function renderNoChar(host, name, playerMessage, playerStarterPackHtml) {
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

    ${starterPackHTML(playerStarterPackHtml)}

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
  let playerStarterPackHtml = "";
  try {
    const msg = await apiGetModsMessage();
    playerMessage = msg?.playerMessage ?? "";
    playerStarterPackHtml = msg?.playerStarterPackHtml ?? "";
  } catch (err) {
    console.warn("[player-dropon] could not load mods message:", err);
  }

  if (hasChar) {
    renderWithChar(host, name, char, playerMessage);
  } else {
    renderNoChar(host, name, playerMessage, playerStarterPackHtml);
  }
}
