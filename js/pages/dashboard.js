import { canSeeAudienceItem, isAdmin, isMod, isSpeaker, canAdminModOrSpeaker } from "../permissions.js";
import { esc } from "../ui.js";
import { nowMs } from "../core.js";
import { countdownToSimMonth } from "../clock.js";

// js/pages/dashboard.js
// Dashboard (Your Office) — Chunk 1 implementation

function $(id) {
  return document.getElementById(id);
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

// Best-effort sim label (Month Year) from your stored state.
// If you already have a more accurate clock module, you can swap this later.

function getCharacter(data) {
  return data?.currentCharacter || data?.currentPlayer || {};
}

function isGovernmentOffice(office = "") {
  return new Set(["prime-minister","leader-commons","chancellor","home","foreign","trade","defence","welfare","education","env-agri","health","eti","culture","home-nations"]).has(String(office));
}

function buildRoleAwareDocket(data) {
  const char = getCharacter(data);
  const items = [];
  const push = (it) => items.push({ ...it, generated: true });
  const isGov = isGovernmentOffice(char?.office);
  const canAgenda = ["prime-minister", "leader-commons"].includes(String(char?.office || ""));

  (data?.motions?.edm || []).filter((m) => m?.status !== "archived").slice(0, 4).forEach((m) => {
    if (!isGov) push({ type: "edm", title: `Open EDM #${m.number}: ${m.title}`, detail: "Review/sign current Early Day Motion.", ctaLabel: "Open Motions", href: "motions.html", priority: "med" });
  });

  (data?.motions?.house || []).filter((m) => m?.status !== "archived").slice(0, 4).forEach((m) => {
    push({ type: m?.division?.status === "open" ? "division" : "motion", title: `Open House Motion #${m.number}: ${m.title}`, detail: m?.division?.status === "open" ? "Division in progress." : "Debate open.", ctaLabel: "Open Motions", href: "motions.html", priority: "med" });
  });

  (data?.regulations?.items || []).filter((r) => r?.status !== "archived").slice(0, 4).forEach((r) => {
    push({ type: "regulation", title: `Open Regulation #${r.regulationNumber}: ${r.shortTitle}`, detail: "Regulation debate or division is open.", ctaLabel: "Open Regulations", href: "regulations.html", priority: "med" });
  });

  (data?.statements?.items || []).filter((st) => st?.status !== "archived").slice(0, 4).forEach((st) => {
    push({ type: "statement", title: `Open Statement #${st.number}: ${st.title}`, detail: "Statement debate currently open.", ctaLabel: "Open Statements", href: "statements.html", priority: "low" });
  });

  (data?.orderPaperCommons || []).filter((b) => b?.status === "in-progress").slice(0, 6).forEach((b) => {
    push({ type: b?.division?.status === "open" ? "division" : "debate", title: `${b.title}`, detail: `${b.stage || "Stage"} is active.`, ctaLabel: "Open Bill", href: `bill.html?id=${encodeURIComponent(b.id)}`, priority: "high" });
    if (canAgenda && b.stage === "First Reading") push({ type: "bill", title: `Set second reading gate: ${b.title}`, detail: "PM/Leader of the House action required.", ctaLabel: "Open Bill", href: `bill.html?id=${encodeURIComponent(b.id)}`, priority: "high" });
  });

  const qAll = data?.questionTime?.questions || [];
  qAll.filter((q) => !q.archived && !q.answer && String(q.askedBy || "") !== String(char?.name || "")).slice(0, 4).forEach((q) => {
    if (canAdminModOrSpeaker(data) || ["prime-minister","leader-commons", q.office].includes(String(char?.office || ""))) {
      push({ type: "question", title: "Question awaiting ministerial answer", detail: q.text || "", ctaLabel: "Open Question Time", href: "questiontime.html", priority: "high" });
    }
  });

  qAll.filter((q) => !q.archived && q.answer && String(q.askedBy || "") === String(char?.name || "") && !q.answerSeenByAsker).slice(0, 4).forEach((q) => {
    push({ type: "speaker", title: "Your question has been answered", detail: (q.text || "").slice(0, 100), ctaLabel: "View Answer", href: `questiontime.html?questionId=${encodeURIComponent(q.id)}`, priority: "high", dismissOnClick: true, dismissQuestionId: q.id });
  });

  qAll.filter((q) => !q.archived && q.answer && String(q.askedBy || "") === String(char?.name || "").slice(0,999)).forEach((q) => {
    (q.followUps || []).filter((f) => !f.answer && String(f.askedBy || "") === String(char?.name || "")).slice(0, 2).forEach((f) => {
      push({ type: "question", title: "Open follow-up awaiting answer", detail: f.text || "", ctaLabel: "Open Question Time", href: "questiontime.html", priority: "med" });
    });
  });

  return items;
}

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
 * Prefers sim-calendar deadline (stageDeadlineSim), falls back to ms-based.
 */
function billCountdown(bill, gameState) {
  if (bill?.stageDeadlineSim) {
    return countdownToSimMonth(bill.stageDeadlineSim.month, bill.stageDeadlineSim.year, gameState);
  }
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
      strap: `Inflation ${fmtPct(econTopline?.inflation ?? econ?.inflation)}\nUnemployment ${fmtPct(econTopline?.unemployment ?? econ?.unemployment)}\nGDP growth ${fmtPct(econTopline?.gdpGrowth ?? econ?.growth)}`,
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

  data.liveDocket ??= { asOf: "Today", items: [] };
  data.liveDocket.items ??= [];

  const combined = [...data.liveDocket.items, ...buildRoleAwareDocket(data)];
  const visible = combined.filter((it) => canSeeAudienceItem(data, it?.audience));

  if (!visible.length) {
    root.innerHTML = `<div class="muted-block">No actions available right now.</div>`;
    return;
  }

  root.innerHTML = `
    <div class="docket-list">
      ${visible.map((it, idx) => `
        <div class="docket-item ${esc(it.priority || "")}">
          <div class="docket-left">
            <div class="docket-icon" aria-hidden="true">${esc(iconFor(it.type))}</div>
            <div>
              <div class="docket-title">${esc(it.title)}</div>
              <div class="docket-detail">${esc(it.detail || "")}</div>
            </div>
          </div>
          <div class="docket-cta">
            ${it.href ? `<a class="btn" data-docket-idx="${idx}" href="${esc(it.href)}">${esc(it.ctaLabel || "Open")}</a>` : ""}
          </div>
        </div>
      `).join("")}
    </div>
  `;

  root.querySelectorAll("a[data-docket-idx]").forEach((a) => {
    a.addEventListener("click", () => {
      const item = visible[Number(a.getAttribute("data-docket-idx") || -1)];
      if (!item?.dismissOnClick || !item?.dismissQuestionId) return;
      const q = (data.questionTime?.questions || []).find((it) => it.id === item.dismissQuestionId);
      if (q) q.answerSeenByAsker = true;
      if (item.generated !== true) {
        data.liveDocket.items = data.liveDocket.items.filter((i) => i !== item);
      }
    });
  });
}

function getDebateUrl(bill) {
  return bill?.debate?.topicUrl || bill?.discourse_topic_url || bill?.discourseTopicUrl || bill?.debateUrl || bill?.discourseUrl || null;
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
            <div><b>Stage ends in:</b> ${esc(billCountdown(b, data.gameState))}</div>
          </div>

          <div class="tile-bottom">
            <a class="btn" href="bill.html?id=${encodeURIComponent(b.id)}">View Bill</a>
            ${getDebateUrl(b) ? `<a class="btn" href="${esc(getDebateUrl(b))}" target="_blank" rel="noopener">Debate</a>` : ""}
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
