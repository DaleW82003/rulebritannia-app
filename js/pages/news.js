import { formatSimMonthYear } from "../clock.js";
import { setHTML, esc } from "../ui.js";

export function initNewsPage(data) {
  const sim = formatSimMonthYear(data.gameState);
  const dateEl = document.getElementById("bbcSimDate");
  if (dateEl) dateEl.textContent = sim;

  const stories = (data.news?.stories || []).slice().sort((a,b) => (b.createdAt||0)-(a.createdAt||0));
  const breaking = stories.filter(s => s.isBreaking);

  // Breaking ticker
  const panel = document.getElementById("bbcBreakingPanel");
  if (panel) panel.style.display = breaking.length ? "" : "none";
  if (breaking.length) {
    setHTML("bbcBreakingTicker", breaking.map(s => esc(s.headline)).join(" • "));
  }

  // Main vs flavour (simple for now)
  const main = stories.filter(s => !s.flavour);
  const flavour = stories.filter(s => !!s.flavour);

  setHTML("bbcMainNews", renderGrid(main));
  setHTML("bbcFlavourNews", renderGrid(flavour, true));
  setHTML("bbcArchive", `<div class="muted-block">Archive view wiring is next step.</div>`);
}

function renderGrid(items, small=false) {
  if (!items.length) return `<div class="muted-block">No stories yet.</div>`;
  return `
    <div class="news-grid">
      ${items.map(s => `
        <article class="news-card ${small ? "small" : ""}">
          <div class="news-brand">
            <div class="news-date">${esc(s.simDate || "")}</div>
            ${s.isBreaking ? `<div class="breaking-tag">BREAKING</div>` : ``}
          </div>
          ${s.category ? `<div class="news-category">${esc(s.category)}</div>` : ``}
          <div class="news-headline">${esc(s.headline)}</div>
          ${s.imageUrl ? `<div class="news-imagewrap"><img src="${esc(s.imageUrl)}" alt=""></div>` : ``}
          <div class="news-text">${esc(s.text)}</div>
        </article>
      `).join("")}
    </div>
  `;
}
