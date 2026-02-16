fetch("data/demo.json")
  .then((res) => res.json())
  .then((data) => {
    const safe = (v, fallback = "") => (v === null || v === undefined ? fallback : v);

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
        .filter((p) => (p.value >= 2) || p.party === "SNP")
        .sort((a, b) => b.value - a.value);

      const pollingLines = polling.length
        ? polling
            .map(
              (p) =>
                `<div class="row"><span>${safe(p.party, "—")}</span><b>${Number(p.value).toFixed(1)}%</b></div>`
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
            <div class="wgo-title">${safe(papers.paper, "Paper")}: ${safe(papers.headline, "No headline yet.")}</div>
            <div class="wgo-strap">${safe(papers.strap, "")}</div>
            <div class="wgo-actions"><a class="btn" href="papers.html">View</a></div>
          </div>

          <div class="wgo-tile">
            <div class="wgo-kicker">Economy</div>
            <div class="wgo-metric">
              <div class="row"><span>Growth</span><b>${Number(safe(economy.growth, 0)).toFixed(1)}%</b></div>
              <div class="row"><span>Inflation</span><b>${Number(safe(economy.inflation, 0)).toFixed(1)}%</b></div>
              <div class="row"><span>Unemployment</span><b>${Number(safe(economy.unemployment, 0)).toFixed(1)}%</b></div>
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
// ---------- Live Docket (dashboard only) ----------
const docketEl = document.getElementById("live-docket");
if (docketEl) {
  const player = data.currentPlayer || {
    name: "Unknown",
    party: "Unknown",
    role: "backbencher",
    office: null,
    isSpeaker: false,
    isMod: false
  };

  const docket = data.liveDocket || {};
  const items = Array.isArray(docket.items) ? docket.items : [];

  const canSee = (it) => {
    const a = it.audience;
    if (!a) return true;

    // Speaker-only items
    if (a.speakerOnly) return !!player.isSpeaker;

    // Role filter
    if (Array.isArray(a.roles) && a.roles.length) {
      if (!a.roles.includes(player.role)) return false;
    }

    // Office filter (only relevant if you're a minister / office holder)
    if (Array.isArray(a.offices) && a.offices.length) {
      if (!player.office || !a.offices.includes(player.office)) return false;
    }

    return true;
  };

  const icon = (type) => {
    switch (type) {
      case "question": return "❓";
      case "motion": return "📜";
      case "edm": return "✍️";
      case "statement": return "🗣️";
      case "division": return "🗳️";
      case "speaker": return "🔔";
      default: return "•";
    }
  };

  const visible = items.filter(canSee);

  if (!visible.length) {
    docketEl.innerHTML = `<div class="muted-block">No live items right now.</div>`;
  } else {
    docketEl.innerHTML = `
      <div class="docket-top">
        <div class="docket-kicker">
          As of: <b>${docket.asOf || "now"}</b> ·
          Logged in as: <b>${player.name}</b> (${player.role})
        </div>
      </div>

      <div class="docket-list">
        ${visible.map(it => `
          <div class="docket-item ${it.priority === "high" ? "high" : ""}">
            <div class="docket-left">
              <div class="docket-icon">${icon(it.type)}</div>
              <div class="docket-text">
                <div class="docket-title">${it.title || "Item"}</div>
                <div class="docket-detail">${it.detail || ""}</div>
              </div>
            </div>
            <div class="docket-cta">
              <a class="btn" href="${it.href || "#"}">${it.ctaLabel || "Open"}</a>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }
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

                    const resultBlock =
                      status === "passed"
                        ? `<div class="bill-result passed">Royal Assent Granted</div>`
                        : status === "failed"
                          ? `<div class="bill-result failed">Bill Defeated</div>`
                          : `<div class="bill-current">Current Stage: <b>${stage}</b></div>`;

                    return `
                      <div class="bill-card ${status}">
                        <div class="bill-title">${safe(b.title, "Untitled Bill")}</div>
                        <div class="bill-sub">Author: ${safe(b.author, "—")} · ${safe(b.department, "—")}</div>

                        <div class="stage-track">${stageTrack}</div>

                        ${resultBlock}

                        <div class="bill-actions spaced">
                          <a class="btn" href="bill.html?id=${encodeURIComponent(safe(b.id, ""))}">View Bill</a>
                          <a class="btn" href="https://forum.rulebritannia.org" target="_blank" rel="noopener">Debate</a>
                        </div>
                      </div>
                    `;
                  })
                  .join("")
              : `<div class="muted-block">No bills on the Order Paper.</div>`
          }
        </div>
      `;
    }
  })
  .catch((err) => console.error("Error loading data/demo.json:", err));
// ===== NAV ACTIVE STATE =====
(function(){
  const current = window.location.pathname.split("/").pop();
  const links = document.querySelectorAll(".nav a");

  links.forEach(link => {
    const href = link.getAttribute("href");

    // Ignore external links
    if (!href || href.startsWith("http")) return;

    if (href === current) {
      link.classList.add("active");
    }

    // Special case: dashboard.html is root sometimes
    if (current === "" && href === "dashboard.html") {
      link.classList.add("active");
    }
  });
})();

// ---------- Dropdown Nav ----------
document.querySelectorAll(".nav-toggle").forEach(btn => {
  btn.addEventListener("click", e => {
    e.stopPropagation();

    document.querySelectorAll(".nav-group").forEach(g => {
      if (g !== btn.parentElement) g.classList.remove("open");
    });

    btn.parentElement.classList.toggle("open");
  });
});

document.addEventListener("click", () => {
  document.querySelectorAll(".nav-group").forEach(g => g.classList.remove("open"));
});

// ---------- Active Page Highlight ----------
const current = location.pathname.split("/").pop();

document.querySelectorAll(".nav a, .dropdown a").forEach(link => {
  if (link.getAttribute("href") === current) {
    link.classList.add("active");

    const group = link.closest(".nav-group");
    if (group) group.querySelector(".nav-toggle").classList.add("active");
  }
});
