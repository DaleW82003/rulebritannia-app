// js/pages/dashboard.js
// Dashboard (Your Office) — Chunk 1 implementation

function $(id) {
  return document.getElementById(id);
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fmtPct(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  return `${Number(n).toFixed(1)}%`;
}

function fmtMoneyShort(s) {
  // Keep simple for demo (already strings like "£0.9tn" pass through)
  if (typeof s === "string") return s;
  if (typeof s === "number") return `£${s.toLocaleString("en-GB")}`;
  return "—";
}

function nowMs() {
  return Date.now();
}

// Best-effort sim label (Month Year) from your stored state.
// If you already have a more accurate clock module, you can swap this later.
function getSimLabel(data) {
  const gs = data?.gameState;
  const monthIndex = Number(gs?.startSimMonth ?? 8); // 1-12
  const year = Number(gs?.startSimYear ?? 1997);

  const months = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December"
  ];

  const m = months[(monthIndex - 1 + 12) % 12] || "August";
  return `${m} ${year}`;
}

function iconFor(type) {
  // Simple symbols for immersion (you can replace with SVG later)
  const map = {
    division: "🗳️",
    question: "❓",
    statement: "📣",
    motion: "📜",
    edm: "✍️",
    regulation: "🧾",
    speaker: "🎙️",
    debate: "💬",
    bill: "🏛️",
  };
  return map[type] || "•";
}

function billTypeLabel(t) {
  if (t === "government") return "Government Bill";
  if (t === "opposition") return "Opposition Bill";
  if (t === "pmb") return "Private Member’s Bill";
  return "Bill";
}

function stageLabel(s) {
  return s || "—";
}

function msToHuman(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const sec = Math.floor(ms / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Countdown for a bill stage.
 * Uses bill.stageStartedAt + optional bill.stageDurationMs.
 * If not present, returns "—" (we avoid inventing timing rules here).
 */
function billCountdown(bill) {
  const start = Number(bill?.stageStartedAt);
  const dur = Number(bill?.stageDurationMs);
  if (!Number.isFinite(start) || !Number.isFinite(dur) || dur <= 0) return "—";
  const end = start + dur;
  return msToHuman(end - nowMs());
}

function getWhatsGoingOnTiles(data) {
  const w = data?.whatsGoingOn || {};
  const econ = w?.economy || {};
  const polling = Array.isArray(w?.polling) ? w.polling : [];

  // Show top 3 from polling if present
  const topPoll = polling.slice().sort((a,b)=>Number(b.value||0)-Number(a.value||0)).slice(0,3);

  return [
    {
      kicker: "BBC NEWS",
      title: w?.bbc?.headline || "No stories yet",
      strap: w?.bbc?.strap || "—",
      href: "news.html",
      btn: "Open"
    },
    {
      kicker: "PAPERS",
      title: `${w?.papers?.paper || "Paper"}: ${w?.papers?.headline || "No front page yet"}`,
      strap: w?.papers?.strap || "—",
      href: "papers.html",
      btn: "Open"
    },
    {
      kicker: "ECONOMY",
      title: `Inflation ${fmtPct(econ?.inflation)} • Unemployment ${fmtPct(econ?.unemployment)}`,
      strap: `GDP growth ${fmtPct(econ?.growth)}`,
      href: "economy.html",
      btn: "Open"
    },
    {
      kicker: "POLLING",
      title: topPoll.length
        ? `${topPoll.map(p => `${p.party} ${Number(p.value).toFixed(1)}%`).join(" • ")}`
        : "No polling yet",
      strap: "Weekly poll published Sundays",
      href: "polling.html",
      btn: "Open"
    },
  ];
}

function canSeeDocketItem(item, data) {
  // Basic audience filter based on your demo.json shape.
  // If no audience, assume visible to all.
  const aud = item?.audience;
  if (!aud) return true;

  const user = data?.currentUser || {};
  const char = data?.currentCharacter || data?.currentPlayer || {};

  // SpeakerOnly
  if (aud.speakerOnly) return Boolean(char?.isSpeaker) || user?.roles?.includes("speaker");

  // Roles filter (character.role)
  if (Array.isArray(aud.roles) && aud.roles.length) {
    if (!aud.roles.includes(char?.role)) return false;
  }

  // Offices filter (character.office)
  if (Array.isArray(aud.offices) && aud.offices.length) {
    if (!aud.offices.includes(char?.office)) return false;
  }

  return true;
}

function renderSimDate(data) {
  const el = $("sim-date-display");
  if (!el) return;

  const label = getSimLabel(data);
  el.textContent = `Simulation Date: ${label}`;
}

function renderWhatsGoingOn(data) {
  const root = $("whats-going-on");
  if (!root) return;

  const tiles = getWhatsGoingOnTiles(data);

  root.innerHTML = `
    <div class="wgo-grid">
      ${tiles.map(t => `
        <div class="wgo-tile card-flex">
          <div class="wgo-kicker">${esc(t.kicker)}</div>
          <div class="wgo-title">${esc(t.title)}</div>
          <div class="wgo-strap">${esc(t.strap)}</div>
          <div class="tile-bottom">
            <a class="btn" href="${esc(t.href)}">${esc(t.btn)}</a>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderLiveDocket(data) {
  const root = $("live-docket");
  if (!root) return;

  const docket = data?.liveDocket;
  const items = Array.isArray(docket?.items) ? docket.items : [];

  const visible = items.filter(it => canSeeDocketItem(it, data));

  if (!visible.length) {
    root.innerHTML = `<div class="muted-block">No actions available right now.</div>`;
    return;
  }

  root.innerHTML = `
    <div class="docket-list">
      ${visible.map(it => `
        <div class="docket-item">
          <div class="docket-left">
            <div class="docket-icon" aria-hidden="true">${esc(iconFor(it.type))}</div>
            <div>
              <div class="docket-title">${esc(it.title)}</div>
              <div class="docket-detail">${esc(it.detail || "")}</div>
            </div>
          </div>
          <div class="docket-cta">
            ${it.href ? `<a class="btn" href="${esc(it.href)}">${esc(it.ctaLabel || "Open")}</a>` : ""}
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function discourseLinkForBill(bill) {
  // Use explicit link if present; otherwise, a predictable placeholder.
  // (Your future Discourse automation can replace this cleanly.)
  if (bill?.debateUrl) return bill.debateUrl;
  if (bill?.discourseUrl) return bill.discourseUrl;
  return `https://forum.rulebritannia.org/t/${encodeURIComponent(bill?.id || "bill")}`;
}

function renderOrderPaper(data) {
  const root = $("order-paper");
  if (!root) return;

  const bills = Array.isArray(data?.orderPaperCommons) ? data.orderPaperCommons : [];
  if (!bills.length) {
    root.innerHTML = `<div class="muted-block">No legislation on the Order Paper yet.</div>`;
    return;
  }

  // 2-column layout
  root.innerHTML = `
    <div class="bill-grid" style="display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:14px;">
      ${bills.map(b => `
        <div class="wgo-tile card-flex">
          <div class="wgo-kicker">${esc(billTypeLabel(b.billType))}</div>
          <div class="wgo-title">${esc(b.title)}</div>
          <div class="wgo-strap">
            <div><b>Author:</b> ${esc(b.author || "—")}</div>
            <div><b>Department:</b> ${esc(b.department || "—")}</div>
            <div><b>Stage:</b> ${esc(stageLabel(b.stage))}</div>
            <div><b>Stage ends in:</b> ${esc(billCountdown(b))}</div>
          </div>

          <div class="tile-bottom">
            <a class="btn" href="bill.html?id=${encodeURIComponent(b.id)}">View Bill</a>
            <a class="btn" href="${esc(discourseLinkForBill(b))}" target="_blank" rel="noopener">Debate</a>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

export function initDashboardPage(data) {
  renderSimDate(data);
  renderWhatsGoingOn(data);
  renderLiveDocket(data);
  renderOrderPaper(data);
}
