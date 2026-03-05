// js/pages/player-dropon.js
import { requireLogin } from "../auth.js";
import { esc } from "../ui.js";

const DESTINATION_TILES = [
  {
    href: "dashboard.html",
    icon: "🏛️",
    title: "Your Office",
    desc: "Check your docket, track live business, and manage your parliamentary role.",
    cta: "Enter Your Office",
  },
  {
    href: "news.html",
    icon: "📰",
    title: "BBC News",
    desc: "Read the latest news from across Britain, updated each simulation month.",
    cta: "Read the News",
  },
  {
    href: "papers.html",
    icon: "🗞️",
    title: "The Papers",
    desc: "Browse front pages and published issues from every major newspaper.",
    cta: "Browse Papers",
  },
  {
    href: "economy.html",
    icon: "📊",
    title: "The Economy",
    desc: "Track GDP, inflation, unemployment, and the broader economic picture.",
    cta: "View Economy",
  },
  {
    href: "questiontime.html",
    icon: "🎙️",
    title: "Question Time",
    desc: "Submit questions to ministers, follow PMQs, and engage in Parliament.",
    cta: "Go to Question Time",
  },
];

const QUICK_ACTIONS = [
  { href: "submit-bill.html",       label: "📜 Submit a Bill" },
  { href: "statements.html",        label: "📢 Make a Statement" },
  { href: "motions.html",           label: "🗳️ View Motions" },
  { href: "party.html",             label: "🏳️ Your Party" },
  { href: "personal.html",          label: "👤 Your Character" },
  { href: "/api/discourse/go",      label: "💬 Discourse Forum" },
];

function tileHTML(t) {
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

function render(host, data) {
  const user = data?.currentUser;
  const name = esc(user?.username || user?.name || "Member");

  const tilesHTML = DESTINATION_TILES.map(tileHTML).join("");

  const quickHTML = QUICK_ACTIONS.map((a) =>
    `<a href="${esc(a.href)}" class="btn" style="font-size:.9rem;">${esc(a.label)}</a>`
  ).join("");

  host.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Welcome back, ${name}</div></div>

    <section class="panel" style="margin-bottom:0;padding-bottom:4px;">
      <p style="font-size:1.15rem;margin:0;color:var(--navy);">
        <strong>Your Office awaits.</strong> Pick up where you left off or explore what's happening across Britain.
      </p>
    </section>

    <section aria-labelledby="destinations-heading" style="margin-top:24px;">
      <h2 id="destinations-heading" style="font-size:1.3rem;font-weight:800;margin:0 0 14px;color:var(--navy);">
        Where would you like to go?
      </h2>
      <div class="tile-grid">
        ${tilesHTML}
      </div>
    </section>

    <section class="panel" aria-labelledby="quick-heading" style="margin-top:24px;">
      <h2 id="quick-heading" style="margin:0 0 14px;font-size:1.1rem;font-weight:800;">Quick Actions</h2>
      <div style="display:flex;flex-wrap:wrap;gap:10px;">
        ${quickHTML}
      </div>
    </section>
  `;
}

export async function initPlayerDroponPage(data) {
  const user = await requireLogin();
  if (!user) return;

  const host = document.getElementById("player-dropon-root") || document.querySelector("main.wrap");
  if (!host) return;

  render(host, data);
}
