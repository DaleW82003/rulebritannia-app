import { canSeeAudienceItem } from "../permissions.js";

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
function iconFor(type) {
  // Simple symbols for immersion (you can replace with SVG later)
  const map = {
    question: "❓",
    motion: "📜",
    edm: "✍️",
    statement: "🗣️",
    division: "🗳️",
    speaker: "🔔",
    amendment: "🧾",
    "amendment-division": "🗳️",
    regulation: "🧾",
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
  const leadStory = Array.isArray(data?.news?.stories) ? data.news.stories[0] : null;
  const topPaper = Array.isArray(data?.papers?.papers)
    ? data.papers.papers.find((p) => Array.isArray(p.issues) && p.issues.length)?.issues?.[0]
    : null;
  const econTopline = data?.economyPage?.topline || {};
  const masterPoll = Array.isArray(data?.polling?.tracker) ? data.polling.tracker : [];
  const econ = w?.economy || {};
  const polling = Array.isArray(w?.polling) && w.polling.length ? w.polling : masterPoll;

  // Show top 3 from polling if present
  const topPoll = polling.slice().sort((a,b)=>Number(b.value||0)-Number(a.value||0)).slice(0,3);

  return [
    {
      kicker: "BBC NEWS",
      title: w?.bbc?.headline || leadStory?.headline || "No stories yet",
      strap: w?.bbc?.strap || leadStory?.text || "—",
      href: "news.html",
      btn: "Open"
    },
    {
      kicker: "PAPERS",
      title: `${w?.papers?.paper || "Paper"}: ${w?.papers?.headline || topPaper?.headline || "No front page yet"}`,
      strap: w?.papers?.strap || topPaper?.text || "—",
      href: "papers.html",
      btn: "Open"
    },
    {
      kicker: "ECONOMY",
      title: "Key lines",
      strap: `Inflation ${fmtPct(econ?.inflation ?? econTopline?.inflation)}\nUnemployment ${fmtPct(econ?.unemployment ?? econTopline?.unemployment)}\nGDP growth ${fmtPct(econ?.growth ?? econTopline?.gdpGrowth)}`,
      href: "economy.html",
      btn: "Open"
    },
    {
      kicker: "POLLING",
      title: "Latest topline",
      strap: topPoll.length
        ? `${topPoll.map(p => `${p.party} ${Number(p.value).toFixed(1)}%`).join("\n")}`
        : "No polling yet",
      href: "polling.html",
      btn: "Open"
    },
  ];
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
          <div class="wgo-strap wgo-strap-lines">${esc(t.strap)}</div>
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

  const visible = items.filter(it => canSeeAudienceItem(data, it?.audience));

  if (!visible.length) {
    root.innerHTML = `<div class="muted-block">No actions available right now.</div>`;
    return;
  }

  root.innerHTML = `
    <div class="docket-list">
      ${visible.map(it => `
        <div class="docket-item ${esc(it.priority || "")}">
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
    <div class="order-grid">
      ${bills.map(b => `
        <div class="wgo-tile card-flex">
          <div class="wgo-kicker bill-type-${esc(b.billType || "bill")}">${esc(billTypeLabel(b.billType))}</div>
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
  renderWhatsGoingOn(data);
  renderLiveDocket(data);
  renderOrderPaper(data);
}
