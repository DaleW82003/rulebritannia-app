import { formatSimMonthYear } from "../clock.js";
import { setHTML, esc } from "../ui.js";

export function initDashboardPage(data) {
  // Sim date
  const sim = formatSimMonthYear(data.gameState);
  const simEl = document.getElementById("sim-date-display");
  if (simEl) simEl.textContent = sim;

  // What's Going On tiles (simple, clean, no breaking)
  const wgo = data.whatsGoingOn || {};
  const econ = wgo.economy || {};
  const poll = (wgo.polling || []).slice(0, 4);

  const html = `
    <div class="wgo-grid">
      <div class="wgo-tile card-flex">
        <div class="wgo-kicker">BBC NEWS</div>
        <div class="wgo-title">${esc(wgo?.bbc?.headline || "—")}</div>
        <div class="wgo-strap">${esc(wgo?.bbc?.strap || "")}</div>
        <div class="tile-bottom"><a class="btn" href="news.html">Open</a></div>
      </div>

      <div class="wgo-tile card-flex">
        <div class="wgo-kicker">PAPERS</div>
        <div class="wgo-title">${esc(wgo?.papers?.paper || "—")}</div>
        <div class="wgo-strap">${esc(wgo?.papers?.headline || "")}</div>
        <div class="tile-bottom"><a class="btn" href="papers.html">Open</a></div>
      </div>

      <div class="wgo-tile card-flex">
        <div class="wgo-kicker">ECONOMY</div>
        <div class="wgo-title">Inflation: ${esc(econ.inflation)}%</div>
        <div class="wgo-strap">Unemployment: ${esc(econ.unemployment)}% • GDP Growth: ${esc(econ.growth)}%</div>
        <div class="tile-bottom"><a class="btn" href="economy.html">Open</a></div>
      </div>

      <div class="wgo-tile card-flex">
        <div class="wgo-kicker">POLLING</div>
        <div class="wgo-title">${poll.map(p => `${esc(p.party)} ${esc(p.value)}%`).join(" • ") || "—"}</div>
        <div class="wgo-strap">Weekly release (Sunday)</div>
        <div class="tile-bottom"><a class="btn" href="polling.html">Open</a></div>
      </div>
    </div>
  `;
  setHTML("whats-going-on", html);

  // Live docket + Order paper we will plug in next step once foundation is stable
  // For now: don’t leave it blank
  if (document.getElementById("live-docket")) setHTML("live-docket", `<div class="muted-block">Next step: docket module wired back in.</div>`);
  if (document.getElementById("order-paper")) setHTML("order-paper", `<div class="muted-block">Next step: bill tiles + view/debate buttons wired back in.</div>`);
}
