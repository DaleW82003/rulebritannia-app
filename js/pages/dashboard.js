import { canSeeAudienceItem, isAdmin, isMod, isSpeaker, canAdminModOrSpeaker } from "../permissions.js";
import { esc } from "../ui.js";
import { nowMs } from "../core.js";
import { countdownToSimMonth } from "../clock.js";
import { errorTileHTML } from "../errors.js";
import { apiGetBills } from "../api.js";
import { apiGetMotions, apiGetStatements, apiGetRegulations, apiGetPressItems, apiGetEvents } from "../api.js";
import { apiGetPollingEntries, apiGetNews, apiGetPaperArticles, apiGetEconomyData } from "../api.js";
import { getCharacterContext } from "../engines/core-engine.js";

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


function isGovernmentOffice(office = "") {
  return new Set(["prime-minister","leader-commons","chancellor","home","foreign","trade","defence","welfare","education","env-agri","health","eti","culture","home-nations"]).has(String(office));
}

function buildRoleAwareDocket(data) {
  const char = getCharacterContext(data);
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

  // ── Offline activity highlights ────────────────────────────────────────────
  // Show one-click items for content added since the user last acknowledged each
  // category (tracked via data.liveDocket.seenActivityTs).
  const seenTs = data.liveDocket?.seenActivityTs || {};

  const newConferences = (data?.press?.conferences || []).filter(
    (c) => tsFromPressId(c.id) > (seenTs.pressConference || 0)
  );
  if (newConferences.length) {
    const latest = newConferences[newConferences.length - 1];
    const label = newConferences.length === 1
      ? `${latest.author || "Someone"} held a Press Conference`
      : `${newConferences.length} new Press Conferences`;
    const detail = newConferences.length === 1
      ? (latest.subject || "")
      : "New activity whilst you were away.";
    push({ type: "conference", title: label, detail, ctaLabel: "Open Press", href: "press.html?view=conferences", priority: "med", dismissOnClick: true, seenActivityKey: "pressConference" });
  }

  const newComments = (data?.press?.comments || []).filter(
    (c) => tsFromPressId(c.id) > (seenTs.pressComment || 0)
  );
  if (newComments.length) {
    const latest = newComments[newComments.length - 1];
    const label = newComments.length === 1
      ? `${latest.author || "Someone"} made Comments to the Press`
      : `${newComments.length} new Comments to the Press`;
    const detail = newComments.length === 1
      ? (latest.body || "").slice(0, 100)
      : "New activity whilst you were away.";
    push({ type: "presscomment", title: label, detail, ctaLabel: "Open Press", href: "press.html?view=comments", priority: "med", dismissOnClick: true, seenActivityKey: "pressComment" });
  }

  const newSpeeches = (data?.press?.speeches || []).filter(
    (s) => tsFromPressId(s.id) > (seenTs.pressSpeech || 0)
  );
  if (newSpeeches.length) {
    const latest = newSpeeches[newSpeeches.length - 1];
    const label = newSpeeches.length === 1
      ? `${latest.author || "Someone"} delivered a Speech`
      : `${newSpeeches.length} new Speeches`;
    const detail = newSpeeches.length === 1
      ? (latest.title || "")
      : "New activity whilst you were away.";
    push({ type: "speech", title: label, detail, ctaLabel: "Open Press", href: "press.html?view=speeches", priority: "med", dismissOnClick: true, seenActivityKey: "pressSpeech" });
  }

  const newLetters = (data?.press?.letters || []).filter(
    (l) => tsFromPressId(l.id) > (seenTs.pressLetter || 0)
  );
  if (newLetters.length) {
    const latest = newLetters[newLetters.length - 1];
    const label = newLetters.length === 1
      ? `Official Letter from ${latest.officeName || latest.officeKey || "an Office"}`
      : `${newLetters.length} new Official Letters`;
    const detail = newLetters.length === 1
      ? (latest.subject || "")
      : "New activity whilst you were away.";
    push({ type: "letter", title: label, detail, ctaLabel: "Open Press", href: "press.html?view=letters", priority: "med", dismissOnClick: true, seenActivityKey: "pressLetter" });
  }

  const newEvents = (data?.events?.items || []).filter(
    (ev) => Number(ev.createdTs || 0) > (seenTs.event || 0)
  );
  if (newEvents.length) {
    const latest = newEvents[newEvents.length - 1];
    const typeLabel = latest.type === "conference" ? "a Party Conference" : "a Party Event";
    const label = newEvents.length === 1
      ? `${latest.hostName || "Someone"} held ${typeLabel}`
      : `${newEvents.length} new Events`;
    push({ type: "event", title: label, detail: newEvents.length === 1 ? (latest.location || "") : "New activity whilst you were away.", ctaLabel: "Open Events", href: "events.html", priority: "med", dismissOnClick: true, seenActivityKey: "event" });
  }

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
    conference: "🎙️",
    presscomment: "💬",
    speech: "🎤",
    letter: "✉️",
    event: "🎉",
  };
  return map[type] || "•";
}

/** Extract the real-time timestamp embedded in a press item's id (format: "press-<ts>-<n>"). */
function tsFromPressId(id) {
  const parts = String(id || "").split("-");
  return parts.length >= 2 ? (Number(parts[1]) || 0) : 0;
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
  const sortedStories = Array.isArray(data?.news?.stories)
    ? data.news.stories.slice().sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    : [];
  const leadStory = sortedStories[0] || null;
  const topPaperEntry = Array.isArray(data?.papers?.papers)
    ? data.papers.papers.find((p) => Array.isArray(p.issues) && p.issues.length)
    : null;
  const sortedIssues = topPaperEntry?.issues
    ? topPaperEntry.issues.slice().sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    : [];
  const topPaper = sortedIssues[0] ?? null;
  const topPaperName = topPaperEntry?.name || "Paper";
  const econTopline = data?.economyPage?.topline || {};
  // Build latest poll results from data.polling.polls (authoritative) or whatsGoingOn fallback
  const latestPoll = Array.isArray(data?.polling?.polls) && data.polling.polls.length
    ? data.polling.polls.slice().sort((a, b) => Number(b.createdTs || 0) - Number(a.createdTs || 0))[0]
    : null;
  const masterPoll = Array.isArray(latestPoll?.results)
    ? latestPoll.results.filter((r) => Number(r.value) >= 2)
    : (Array.isArray(data?.polling?.tracker) ? data.polling.tracker : []);
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
      title: `${w?.papers?.paper || topPaperName}: ${w?.papers?.headline || topPaper?.headline || "No front page yet"}`,
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
  data.liveDocket.seenActivityTs ??= {};

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
      if (!item?.dismissOnClick) return;
      if (item.dismissQuestionId) {
        const q = (data.questionTime?.questions || []).find((it) => it.id === item.dismissQuestionId);
        if (q) q.answerSeenByAsker = true;
      }
      if (item.seenActivityKey) {
        data.liveDocket.seenActivityTs ??= {};
        const ts = Date.now();
        data.liveDocket.seenActivityTs[item.seenActivityKey] = ts;
        // Persist to localStorage synchronously (works for all users, avoids navigation race)
        try {
          const lsKey = `rb_docket_seenTs_${data.currentUser?.username || ""}`;
          const stored = JSON.parse(localStorage.getItem(lsKey) || "{}");
          stored[item.seenActivityKey] = ts;
          localStorage.setItem(lsKey, JSON.stringify(stored));
        } catch { /* ignore */ }
      }
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

export async function initDashboardPage(data) {
  // Helper: merge DB items into a state array (deduplicates by id)
  function mergeInto(arr, dbItems) {
    if (!Array.isArray(dbItems) || !dbItems.length) return;
    const seen = new Set(arr.map((x) => String(x.id)));
    for (const item of dbItems) {
      if (!seen.has(String(item.id))) arr.push(item);
    }
  }

  // Merge localStorage-persisted dismissed docket timestamps so non-staff dismissals survive refresh
  data.liveDocket ??= { asOf: "Today", items: [] };
  data.liveDocket.seenActivityTs ??= {};
  try {
    const lsKey = `rb_docket_seenTs_${data.currentUser?.username || ""}`;
    const stored = JSON.parse(localStorage.getItem(lsKey) || "{}");
    for (const [k, v] of Object.entries(stored)) {
      data.liveDocket.seenActivityTs[k] = Math.max(Number(data.liveDocket.seenActivityTs[k] || 0), Number(v || 0));
    }
  } catch { /* ignore localStorage errors */ }

  await Promise.allSettled([
    // Bills → order paper + live docket (replace from DB — authoritative source)
    apiGetBills().then((r) => {
      if (Array.isArray(r?.bills)) {
        data.orderPaperCommons = r.bills;
      } else {
        data.orderPaperCommons ??= [];
      }
    }),
    // Motions → live docket
    apiGetMotions().then((r) => {
      data.motions ??= { house: [], edm: [], nextHouseNumber: 1, nextEdmNumber: 1 };
      data.motions.house ??= [];
      data.motions.edm ??= [];
      const all = r?.motions ?? [];
      mergeInto(data.motions.house, all.filter((m) => (m._motionType || m.motion_type) === "house"));
      mergeInto(data.motions.edm,   all.filter((m) => (m._motionType || m.motion_type) === "edm"));
    }),
    // Statements → live docket
    apiGetStatements().then((r) => {
      data.statements ??= { items: [] };
      data.statements.items ??= [];
      mergeInto(data.statements.items, r?.statements);
    }),
    // Regulations → live docket
    apiGetRegulations().then((r) => {
      data.regulations ??= { items: [] };
      data.regulations.items ??= [];
      mergeInto(data.regulations.items, r?.regulations);
    }),
    // Press items → live docket (conferences, comments, speeches, letters)
    apiGetPressItems().then((r) => {
      data.press ??= { releases: [], conferences: [], comments: [], speeches: [], letters: [] };
      const byType = { release: "releases", conference: "conferences", comment: "comments", speech: "speeches", letter: "letters" };
      for (const item of (r?.items ?? [])) {
        const key = byType[item._pressType] || "releases";
        data.press[key] ??= [];
        mergeInto(data.press[key], [item]);
      }
    }),
    // Events → live docket
    apiGetEvents().then((r) => {
      data.events ??= { items: [] };
      data.events.items ??= [];
      mergeInto(data.events.items, r?.events);
    }),
    // Polling → What's Going On tile
    apiGetPollingEntries().then((r) => {
      if (Array.isArray(r?.entries)) {
        data.polling ??= { polls: [], nextId: 1 };
        data.polling.polls = r.entries;
      }
    }).catch((err) => {
      console.error("[dashboard] polling DB load failed", err);
    }),
    // News → What's Going On tile
    apiGetNews().then((r) => {
      if (Array.isArray(r?.stories)) {
        data.news ??= { stories: [], categories: [] };
        data.news.stories = r.stories.map((s) => ({ ...s, createdAt: new Date(s.createdAt).getTime() }));
      }
    }).catch((err) => {
      console.error("[dashboard] news DB load failed", err);
    }),
    // Papers → What's Going On tile
    apiGetPaperArticles().then((r) => {
      if (r?.byPaper) {
        for (const paper of (data.papers?.papers || [])) {
          if (r.byPaper[paper.key]) {
            paper.issues = r.byPaper[paper.key].map((a) => ({ ...a, createdAt: new Date(a.createdAt).getTime() }));
          }
        }
      }
    }).catch((err) => {
      console.error("[dashboard] papers DB load failed", err);
    }),
    // Economy → What's Going On tile
    apiGetEconomyData().then((r) => {
      if (r && typeof r === "object" && !r.error) {
        data.economyPage = r;
      }
    }).catch((err) => {
      console.error("[dashboard] economy DB load failed", err);
    }),
  ]);

  const sections = [
    { id: "whats-going-on", fn: renderWhatsGoingOn, label: "What's Going On" },
    { id: "live-docket",    fn: renderLiveDocket,   label: "Live Docket" },
    { id: "order-paper",   fn: renderOrderPaper,   label: "Order Paper" },
  ];
  sections.forEach(({ id, fn, label }) => {
    const root = document.getElementById(id);
    if (!root) return;
    try {
      fn(data);
    } catch (err) {
      console.error(`[dashboard:${label}]`, err);
      root.innerHTML = errorTileHTML(err, `Could not load ${label}`);
    }
  });
}
