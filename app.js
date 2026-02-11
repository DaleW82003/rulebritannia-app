// app.js
// Loads demo data + renders dashboard widgets when the relevant elements exist
// Also highlights the current page in the sidebar nav

// ---------- Helpers ----------
function safe(v, fallback = "") {
  return v === null || v === undefined ? fallback : v;
}

// ---------- Nav: highlight current page ----------
(function highlightCurrentNav() {
  const currentFile = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  const navLinks = document.querySelectorAll(".sidebar a[href]");
  let bestMatch = null;

  for (const a of navLinks) {
    try {
      const url = new URL(a.getAttribute("href"), location.href);

      // Ignore external links
      if (url.origin !== location.origin) continue;

      const file = (url.pathname.split("/").pop() || "index.html").toLowerCase();

      if (file === currentFile) {
        bestMatch = a;
        break;
      }
    } catch {
      // ignore invalid hrefs
    }
  }

  if (bestMatch) {
    bestMatch.classList.add("is-active");
    bestMatch.setAttribute("aria-current", "page");
  }
})();

// ---------- Data load + page rendering ----------
fetch("data/demo.json")
  .then((res) => res.json())
  .then((data) => {
    // ---------- What's Going On (dashboard only) ----------
    const wgoEl = document.getElementById("whats-going-on");
    if (wgoEl) {
      const w = safe(data.whatsGoingOn, {});
      const bbc = safe(w.bbc, {});
      const papers = safe(w.papers, {});
      const economy = safe(w.economy, {});
      const pollingRaw = Array.isArray(w.polling) ? w.polling : [];

      // Polling: show parties >= 2%, always include SNP if present
      const polling = pollingRaw
        .filter((p) => p.value >= 2 || p.party === "SNP")
        .sort((a, b) => b.value - a.value);

      const pollingLines = polling.length
        ? polling
            .map(
              (p) =>
                `<div class="row"><span>${safe(p.party, "—")}</span><b>${Number(p.value).toFixed(
                  1
                )}%</b></div>`
            )
            .join("")
        : `<div class="wgo-strap">No polling yet.</div>`;

      wgoEl.innerHTML = `
        <div class="wgo-grid">

          <div class="wgo-tile">
            <div class="wgo-kicker">BBC News</div>
            <div class="wgo-title">${safe(bbc.headline, "No headline yet.")}</div>
            <div class="wgo-strap">${safe(bbc.strap, "")}</div>
            <div class="wgo-actions"><a class="btn" href="news.html">Open</a></div>
          </div>

          <div class="wgo-tile">
            <div class="wgo-kicker">Papers</div>
            <div class="wgo-title">${safe(papers.paper, "Paper")}: ${safe(
              papers.headline,
              "No headline yet."
            )}</div>
            <div class="wgo-strap">${safe(papers.strap, "")}</div>
            <div class="wgo-actions"><a class="btn" href="papers.html">View</a></div>
          </div>

          <div class="wgo-tile">
            <div class="wgo-kicker">Economy</div>
            <div class="wgo-metric">
              <div class="row"><span>Growth</span><b>${Number(safe(economy.growth, 0)).toFixed(
                1
              )}%</b></div>
              <div class="row"><span>Inflation</span><b>${Number(
                safe(economy.inflation, 0)
              ).toFixed(1)}%</b></div>
              <div class="row"><span>Unemployment</span><b>${Number(
                safe(economy.unemployment, 0)
              ).toFixed(1)}%</b></div>
            </div>
            <div class="wgo-actions"><a class="btn" href="economy.html">Economy</a></div>
          </div>

          <div class="wgo-tile">
            <div class="wgo-kicker">Polling</div>
            <div class="wgo-metric">${pollingLines}</div>
            <div class="wgo-actions"><a class="btn" href="polling.html">Polling</a></div>
          </div>

        </div>
      `;
    }

    // ---------- Order Paper (dashboard only) ----------
    const orderWrap = document.getElementById("order-paper");
    if (orderWrap) {
      const stageOrder = [
        "First Reading",
        "Second Reading",
        "Committee Stage",
        "Report Stage",
        "Division",
      ];

      const bills = Array.isArray(data.orderPaperCommons) ? data.orderPaperCommons : [];

      orderWrap.innerHTML = `
        <div class="order-grid">
          ${
            bills.length
              ? bills
                  .map((b) => {
                    const status = safe(b.status, "in-progress");
                    const stage = safe(b.stage, "First Reading");

                    const stageTrack = stageOrder
                      .map((s) => `<div class="stage ${stage === s ? "on" : ""}">${s}</div>`)
                      .join("");
