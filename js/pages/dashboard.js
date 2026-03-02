import { canSeeAudienceItem, isAdmin, isMod, isSpeaker, canAdminModOrSpeaker } from "../permissions.js";
import { esc, $ } from "../ui.js";
import { nowMs, isLoggedIn } from "../core.js";
import { countdownToSimMonth } from "../clock.js";
import { errorTileHTML } from "../errors.js";
import { apiGetBills } from "../api.js";
import { apiGetMotions, apiGetStatements, apiGetRegulations, apiGetPressItems, apiGetEvents } from "../api.js";
import { apiGetPollingEntries, apiGetNews, apiGetPaperArticles, apiGetEconomyData, apiGetQtLegacyQuestions, apiGetGovernmentEvents, apiGetElections } from "../api.js";
import { getCharacterContext } from "../engines/core-engine.js";

// js/pages/dashboard.js
// Dashboard (Your Office) — Chunk 1 implementation

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

/** Item types that the Speaker is allowed to see in the Staff docket. */
const SPEAKER_STAFF_TYPES = new Set(["bill", "debate", "division", "motion", "edm", "statement", "regulation", "question", "qt-question", "press-question"]);

/**
 * Build docket items for the "Your Actions" tab (personalised to active character).
 * Caps are removed for persistent open items so actionable work is never hidden.
 */
function buildPlayerDocketItems(data) {
  const char = getCharacterContext(data);
  const items = [];
  const push = (it) => items.push({ ...it, generated: true });
  const isGov = isGovernmentOffice(char?.office);
  const canAgenda = ["prime-minister", "leader-commons"].includes(String(char?.office || ""));

  // EDMs (non-government only) — uncapped
  (data?.motions?.edm || []).filter((m) => m?.status !== "archived").forEach((m) => {
    if (!isGov) push({ type: "edm", iconClass: "icon-edm", title: `Open EDM #${m.number}: ${m.title}`, detail: "Review/sign current Early Day Motion.", ctaLabel: "Open Motions", href: "motions.html", priority: "med" });
  });

  // House motions — uncapped
  (data?.motions?.house || []).filter((m) => m?.status !== "archived").forEach((m) => {
    push({ type: m?.division?.status === "open" ? "division" : "motion", iconClass: `icon-${m?.division?.status === "open" ? "division" : "motion"}`, title: `Open House Motion #${m.number}: ${m.title}`, detail: m?.division?.status === "open" ? "Division in progress." : "Debate open.", ctaLabel: "Open Motions", href: "motions.html", priority: "med" });
  });

  // Regulations — uncapped
  (data?.regulations?.items || []).filter((r) => r?.status !== "archived").forEach((r) => {
    push({ type: "regulation", iconClass: "icon-regulation", title: `Open Regulation #${r.regulationNumber}: ${r.shortTitle}`, detail: "Regulation debate or division is open.", ctaLabel: "Open Regulations", href: "regulations.html", priority: "med" });
  });

  // Statements — uncapped
  (data?.statements?.items || []).filter((st) => st?.status !== "archived").forEach((st) => {
    push({ type: "statement", iconClass: "icon-statement", title: `Open Statement #${st.number}: ${st.title}`, detail: "Statement debate currently open.", ctaLabel: "Open Statements", href: "statements.html", priority: "low" });
  });

  // Bills — uncapped
  (data?.orderPaperCommons || []).filter((b) => b?.status === "in-progress").forEach((b) => {
    push({ type: b?.division?.status === "open" ? "division" : "debate", iconClass: `icon-${b?.division?.status === "open" ? "division" : "bill"}`, title: `${b.title}`, detail: `${b.stage || "Stage"} is active.`, ctaLabel: "Open Bill", href: `bill.html?id=${encodeURIComponent(b.id)}`, priority: "high" });
    if (canAgenda && b.stage === "First Reading") push({ type: "bill", iconClass: "icon-bill", title: `Set second reading gate: ${b.title}`, detail: "PM/Leader of the House action required.", ctaLabel: "Open Bill", href: `bill.html?id=${encodeURIComponent(b.id)}`, priority: "high" });
  });

  // Question Time — uncapped
  const qAll = data?.questionTime?.questions || [];
  qAll.filter((q) => !q.archived && !q.answer && String(q.askedBy || "") !== String(char?.name || "")).forEach((q) => {
    if (canAdminModOrSpeaker(data) || ["prime-minister","leader-commons", q.office].includes(String(char?.office || ""))) {
      push({ type: "qt-question", iconClass: "icon-qt-question", title: "Question awaiting ministerial answer", detail: q.text || "", ctaLabel: "Open Question Time", href: "questiontime.html", priority: "high" });
    }
  });

  qAll.filter((q) => !q.archived && q.answer && String(q.askedBy || "") === String(char?.name || "") && !q.answerSeenByAsker).forEach((q) => {
    push({ type: "speaker", iconClass: "icon-speaker", title: "Your question has been answered", detail: (q.text || "").slice(0, 100), ctaLabel: "View Answer", href: `questiontime.html?questionId=${encodeURIComponent(q.id)}`, priority: "high", dismissOnClick: true, dismissQuestionId: q.id });
  });

  qAll.filter((q) => !q.archived && q.answer && String(q.askedBy || "") === String(char?.name || "")).forEach((q) => {
    (q.followUps || []).filter((f) => !f.answer && String(f.askedBy || "") === String(char?.name || "")).forEach((f) => {
      push({ type: "qt-question", iconClass: "icon-qt-question", title: "Open follow-up awaiting answer", detail: f.text || "", ctaLabel: "Open Question Time", href: "questiontime.html", priority: "med" });
    });
  });

  // ── Press conference questions awaiting a response from this character's office ─
  // Derived from DB-backed press conference data (replaces client-side push in press.js)
  (data?.press?.conferences || []).reduce((acc, c) => {
    if (!c.authorOffice || !char?.office) return acc;
    if (String(c.authorOffice) !== String(char.office)) return acc;
    if (c.archived) return acc;
    const transcript = Array.isArray(c.transcript) ? c.transcript : [];
    let questions = 0, answers = 0;
    for (const t of transcript) {
      if (t.isQuestion === true) questions++;
      else if (!t.walkOff) answers++;
    }
    const pending = questions - answers;
    if (pending > 0) acc.push({ c, pending });
    return acc;
  }, []).forEach(({ c, pending }) => {
    push({ type: "press-question", iconClass: "icon-press-question", title: `Press conference question awaiting response`, detail: `${c.reference || ""} — ${pending} question${pending !== 1 ? "s" : ""} pending`, ctaLabel: "Open Press", href: "press.html?view=conferences", priority: "high" });
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
    push({ type: "conference", iconClass: "icon-conference", title: label, detail, ctaLabel: "Open Press", href: "press.html?view=conferences", priority: "med", dismissOnClick: true, seenActivityKey: "pressConference" });
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
    push({ type: "presscomment", iconClass: "icon-presscomment", title: label, detail, ctaLabel: "Open Press", href: "press.html?view=comments", priority: "med", dismissOnClick: true, seenActivityKey: "pressComment" });
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
    push({ type: "speech", iconClass: "icon-speech", title: label, detail, ctaLabel: "Open Press", href: "press.html?view=speeches", priority: "med", dismissOnClick: true, seenActivityKey: "pressSpeech" });
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
    push({ type: "letter", iconClass: "icon-letter", title: label, detail, ctaLabel: "Open Press", href: "press.html?view=letters", priority: "med", dismissOnClick: true, seenActivityKey: "pressLetter" });
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
    push({ type: "event", iconClass: "icon-event", title: label, detail: newEvents.length === 1 ? (latest.location || "") : "New activity whilst you were away.", ctaLabel: "Open Events", href: "events.html", priority: "med", dismissOnClick: true, seenActivityKey: "event" });
  }

  // ── Government / Opposition fire, resign, reshuffle alerts ────────────────
  const govEvents = Array.isArray(data?.governmentEvents) ? data.governmentEvents : [];
  const seenGovTs = seenTs.governmentEvent || 0;
  const newGovEvents = govEvents.filter((ev) => new Date(ev.createdAt).getTime() > seenGovTs);

  // Fired events
  const firedEvents = newGovEvents.filter((ev) => ev.action === "office.fire");
  if (firedEvents.length) {
    const latest = firedEvents[0];
    const isShadow = latest.officeType === "shadow";
    const href = isShadow ? "opposition.html" : "government.html";
    const title = firedEvents.length === 1
      ? `${latest.characterName || "A minister"} has been Fired`
      : `${firedEvents.length} ministers have been Fired`;
    const detail = firedEvents.length === 1
      ? `${latest.officeName || ""} — ${isShadow ? "Opposition" : "Government"}`
      : `Recent frontbench changes`;
    push({ type: "fire", iconClass: "icon-fire", title, detail, ctaLabel: isShadow ? "Open Opposition" : "Open Government", href, priority: "high", dismissOnClick: true, seenActivityKey: "governmentEvent" });
  }

  // Resigned events
  const resignedEvents = newGovEvents.filter((ev) => ev.action === "office.resign");
  if (resignedEvents.length) {
    const latest = resignedEvents[0];
    const isShadow = latest.officeType === "shadow";
    const href = isShadow ? "opposition.html" : "government.html";
    const title = resignedEvents.length === 1
      ? `${latest.characterName || "A minister"} has Resigned`
      : `${resignedEvents.length} ministers have Resigned`;
    const detail = resignedEvents.length === 1
      ? `${latest.officeName || ""} — ${isShadow ? "Opposition" : "Government"}`
      : `Recent frontbench changes`;
    push({ type: "resign", iconClass: "icon-resign", title, detail, ctaLabel: isShadow ? "Open Opposition" : "Open Government", href, priority: "high", dismissOnClick: true, seenActivityKey: "governmentEvent" });
  }

  // Reshuffle events
  const reshuffleGovEvent = newGovEvents.find((ev) => ev.action === "government.reshuffle");
  if (reshuffleGovEvent) {
    const pmLabel = reshuffleGovEvent.pmName || "The Prime Minister";
    push({ type: "reshuffle", iconClass: "icon-reshuffle", title: `${pmLabel} is doing a Frontbench Reshuffle`, detail: "Government Cabinet reshuffle in progress.", ctaLabel: "Open Government", href: "government.html", priority: "high", dismissOnClick: true, seenActivityKey: "governmentEvent" });
  }

  const reshuffleOppEvent = newGovEvents.find((ev) => ev.action === "opposition.reshuffle");
  if (reshuffleOppEvent) {
    const lotoLabel = reshuffleOppEvent.lotoName || "The Leader of the Opposition";
    push({ type: "reshuffle", iconClass: "icon-reshuffle", title: `${lotoLabel} is doing a Frontbench Reshuffle`, detail: "Opposition Shadow Cabinet reshuffle in progress.", ctaLabel: "Open Opposition", href: "opposition.html", priority: "high", dismissOnClick: true, seenActivityKey: "governmentEvent" });
  }

  // ── Breaking news / papers / polls / election results visible to all players ─
  const newStories = (data?.news?.stories || []).filter(
    (s) => Number(s.createdAt || 0) > (seenTs.news || 0)
  );
  if (newStories.length) {
    const latest = newStories.slice().sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0];
    push({ type: "news", iconClass: "icon-news", title: latest.headline || "Breaking News", detail: (latest.text || "").slice(0, 100), ctaLabel: "Open News", href: "news.html", priority: "med", dismissOnClick: true, seenActivityKey: "news" });
  }

  const newPaperIssues = (data?.papers?.papers || []).flatMap((p) =>
    (Array.isArray(p.issues) ? p.issues : []).filter((a) => Number(a.createdAt || 0) > (seenTs.papers || 0))
  );
  if (newPaperIssues.length) {
    const latest = newPaperIssues.slice().sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0];
    push({ type: "news", iconClass: "icon-news", title: latest.headline || "New Paper Article", detail: (latest.text || "").slice(0, 100), ctaLabel: "Open Papers", href: "papers.html", priority: "low", dismissOnClick: true, seenActivityKey: "papers" });
  }

  const polls = data?.polling?.polls || [];
  if (polls.length) {
    const latestPoll = polls.slice().sort((a, b) => Number(b.createdTs || 0) - Number(a.createdTs || 0))[0];
    if (Number(latestPoll?.createdTs || 0) > (seenTs.poll || 0)) {
      const top3 = (latestPoll.results || []).filter((r) => Number(r.value) >= 2).sort((a, b) => Number(b.value) - Number(a.value)).slice(0, 3);
      push({ type: "poll", iconClass: "icon-poll", title: "New Polling Results", detail: top3.length ? top3.map((r) => `${r.party} ${Number(r.value).toFixed(1)}%`).join(" · ") : "", ctaLabel: "Open Polling", href: "polling.html", priority: "low", dismissOnClick: true, seenActivityKey: "poll" });
    }
  }

  // ── Election results (finalized) visible to all players ───────────────────
  const allElections = data?.elections?.elections || [];
  const finalizedElections = allElections.filter((e) => e.status === "finalized" && e.finalized_at);
  const newElections = finalizedElections.filter(
    (e) => new Date(e.finalized_at).getTime() > (seenTs.election || 0)
  );
  if (newElections.length) {
    const latest = newElections.sort((a, b) => new Date(b.finalized_at) - new Date(a.finalized_at))[0];
    const title = newElections.length === 1
      ? `${latest.label || latest.type || "Election"} Results Published`
      : `${newElections.length} Election Results Published`;
    push({ type: "election", iconClass: "icon-election", title, detail: latest.label || latest.polling_day || "", ctaLabel: "Open Elections", href: "elections.html", priority: "high", dismissOnClick: true, seenActivityKey: "election" });
  }

  return items;
}

/**
 * Build docket items for the "Staff" tab.
 * - Admin/Mod: all parliamentary categories + economy/polling/news status items.
 * - Speaker: procedural Parliament items only (bills, divisions, motions, EDMs,
 *   statements, regulations, question time).
 */
function buildStaffDocketItems(data) {
  if (!canAdminModOrSpeaker(data)) return [];

  const speakerOnly = isSpeaker(data) && !isAdmin(data) && !isMod(data);
  const items = [];
  const push = (it) => {
    // Speaker is restricted to procedural Parliament item types only
    if (speakerOnly && !SPEAKER_STAFF_TYPES.has(it.type)) return;
    items.push({ ...it, generated: true });
  };

  // Bills / Divisions (all in-progress) — uncapped
  (data?.orderPaperCommons || []).filter((b) => b?.status === "in-progress").forEach((b) => {
    push({ type: b?.division?.status === "open" ? "division" : "debate", iconClass: `icon-${b?.division?.status === "open" ? "division" : "bill"}`, title: `${b.title}`, detail: `${b.stage || "Stage"} is active.`, ctaLabel: "Open Bill", href: `bill.html?id=${encodeURIComponent(b.id)}`, priority: "high" });
  });

  // House Motions — uncapped
  (data?.motions?.house || []).filter((m) => m?.status !== "archived").forEach((m) => {
    push({ type: m?.division?.status === "open" ? "division" : "motion", iconClass: `icon-${m?.division?.status === "open" ? "division" : "motion"}`, title: `House Motion #${m.number}: ${m.title}`, detail: m?.division?.status === "open" ? "Division in progress." : "Debate open.", ctaLabel: "Open Motions", href: "motions.html", priority: "med" });
  });

  // EDMs — uncapped
  (data?.motions?.edm || []).filter((m) => m?.status !== "archived").forEach((m) => {
    push({ type: "edm", iconClass: "icon-edm", title: `EDM #${m.number}: ${m.title}`, detail: "Early Day Motion open for signature.", ctaLabel: "Open Motions", href: "motions.html", priority: "med" });
  });

  // Statements — uncapped
  (data?.statements?.items || []).filter((st) => st?.status !== "archived").forEach((st) => {
    push({ type: "statement", iconClass: "icon-statement", title: `Statement #${st.number}: ${st.title}`, detail: "Statement debate currently open.", ctaLabel: "Open Statements", href: "statements.html", priority: "low" });
  });

  // Regulations — uncapped
  (data?.regulations?.items || []).filter((r) => r?.status !== "archived").forEach((r) => {
    push({ type: "regulation", iconClass: "icon-regulation", title: `Regulation #${r.regulationNumber}: ${r.shortTitle}`, detail: "Regulation debate or division is open.", ctaLabel: "Open Regulations", href: "regulations.html", priority: "med" });
  });

  // Question Time — all unanswered questions (staff oversight)
  const qAll = data?.questionTime?.questions || [];
  qAll.filter((q) => !q.archived && !q.answer).forEach((q) => {
    push({ type: "qt-question", iconClass: "icon-qt-question", title: "Question awaiting ministerial answer", detail: q.text || "", ctaLabel: "Open Question Time", href: "questiontime.html", priority: "high" });
  });

  // Non-procedural items — Admin/Mod only (Speaker excluded)
  if (!speakerOnly) {
    // Economy status summary
    const econ = data?.economyPage?.topline || {};
    if (Object.keys(econ).length) {
      push({ type: "economy", iconClass: "icon-economy", title: "Economy Status", detail: `Inflation ${fmtPct(econ.inflation)} · Unemployment ${fmtPct(econ.unemployment)} · GDP growth ${fmtPct(econ.gdpGrowth)}`, ctaLabel: "Open Economy", href: "economy.html", priority: "low" });
    }

    // Latest polling topline
    const polls = data?.polling?.polls || [];
    if (polls.length) {
      const latest = polls.slice().sort((a, b) => Number(b.createdTs || 0) - Number(a.createdTs || 0))[0];
      const top3 = (latest?.results || []).filter((r) => Number(r.value) >= 2).sort((a, b) => Number(b.value) - Number(a.value)).slice(0, 3);
      if (top3.length) {
        push({ type: "poll", iconClass: "icon-poll", title: "Latest Polling Topline", detail: top3.map((r) => `${r.party} ${Number(r.value).toFixed(1)}%`).join(" · "), ctaLabel: "Open Polling", href: "polling.html", priority: "low" });
      }
    }

    // Latest news headline
    const stories = (data?.news?.stories || []).slice().sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    if (stories.length) {
      push({ type: "news", iconClass: "icon-news", title: stories[0].headline || "Latest News Story", detail: (stories[0].text || "").slice(0, 100), ctaLabel: "Open News", href: "news.html", priority: "low" });
    }
  }

  return items;
}

function iconFor(type) {
  // Simple symbols for immersion (you can replace with SVG later)
  // Each entry is [emoji, css-icon-class] so callers can use either
  const map = {
    question:            ["❓", "icon-question"],
    "qt-question":       ["❓", "icon-qt-question"],
    "press-question":    ["🎙️", "icon-press-question"],
    motion:              ["📜", "icon-motion"],
    edm:                 ["✍️", "icon-edm"],
    statement:           ["🗣️", "icon-statement"],
    division:            ["🗳️", "icon-division"],
    speaker:             ["🔔", "icon-speaker"],
    amendment:           ["🧾", "icon-amendment"],
    "amendment-division":["🗳️", "icon-amendment-division"],
    regulation:          ["🧾", "icon-regulation"],
    debate:              ["💬", "icon-debate"],
    bill:                ["🏛️", "icon-bill"],
    conference:          ["🎙️", "icon-conference"],
    presscomment:        ["💬", "icon-presscomment"],
    speech:              ["🎤", "icon-speech"],
    letter:              ["✉️", "icon-letter"],
    event:               ["🎉", "icon-event"],
    economy:             ["📊", "icon-economy"],
    poll:                ["📈", "icon-poll"],
    news:                ["📰", "icon-news"],
    election:            ["🗳️", "icon-election"],
    fire:                ["🔥", "icon-fire"],
    resign:              ["🚪", "icon-resign"],
    reshuffle:           ["🔄", "icon-reshuffle"],
  };
  const entry = map[type];
  if (!entry) return { emoji: "•", cls: "icon-default" };
  return { emoji: entry[0], cls: entry[1] };
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

/** Render a single flat list of docket items into a container element. */
function renderDocketList(container, visible, data) {
  if (!visible.length) {
    container.innerHTML = `<div class="muted-block">No actions available right now.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="docket-list">
      ${visible.map((it, idx) => {
        const icon = iconFor(it.type);
        const iconCls = it.iconClass || icon.cls;
        return `
        <div class="docket-item ${esc(it.priority || "")}">
          <div class="docket-left">
            <div class="docket-icon ${esc(iconCls)}" aria-hidden="true">${esc(icon.emoji)}</div>
            <div>
              <div class="docket-title">${esc(it.title)}</div>
              <div class="docket-detail">${esc(it.detail || "")}</div>
            </div>
          </div>
          <div class="docket-cta">
            ${it.href ? `<a class="btn" data-docket-idx="${idx}" href="${esc(it.href)}">${esc(it.ctaLabel || "Open")}</a>` : ""}
          </div>
        </div>
        `;
      }).join("")}
    </div>
  `;

  container.querySelectorAll("a[data-docket-idx]").forEach((a) => {
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
    });
  });
}

function renderLiveDocket(data) {
  const root = $("live-docket");
  if (!root) return;

  data.liveDocket ??= { asOf: "Today", items: [] };
  data.liveDocket.items ??= [];
  data.liveDocket.seenActivityTs ??= {};

  const isStaff = canAdminModOrSpeaker(data);

  // Restore last active tab from localStorage (per user)
  const tabLsKey = `rb_docket_tab_${data.currentUser?.username || ""}`;
  let activeTab = "actions";
  try {
    const stored = localStorage.getItem(tabLsKey);
    if (stored === "staff" && isStaff) activeTab = "staff";
  } catch { /* ignore */ }

  // Build item sets — all items are DB-sourced via buildPlayerDocketItems
  const playerItems = buildPlayerDocketItems(data);
  const actionsVisible = playerItems.filter((it) => canSeeAudienceItem(data, it?.audience));
  const staffItems = buildStaffDocketItems(data);

  // Build tab HTML (Staff tab only rendered for staff users)
  root.innerHTML = `
    <div class="docket-tabs" role="tablist" aria-label="Live Docket tabs">
      <button
        class="docket-tab${activeTab === "actions" ? " active" : ""}"
        data-tab="actions"
        role="tab"
        aria-selected="${activeTab === "actions"}"
        aria-controls="docket-panel-actions"
      >Your Actions</button>
      ${isStaff ? `<button
        class="docket-tab${activeTab === "staff" ? " active" : ""}"
        data-tab="staff"
        role="tab"
        aria-selected="${activeTab === "staff"}"
        aria-controls="docket-panel-staff"
      >Staff</button>` : ""}
    </div>
    <div id="docket-panel-actions" class="docket-panel" role="tabpanel" ${activeTab !== "actions" ? 'hidden' : ""}></div>
    ${isStaff ? `<div id="docket-panel-staff" class="docket-panel" role="tabpanel" ${activeTab !== "staff" ? 'hidden' : ""}></div>` : ""}
  `;

  // Render each panel's content
  renderDocketList(root.querySelector("#docket-panel-actions"), actionsVisible, data);
  if (isStaff) {
    renderDocketList(root.querySelector("#docket-panel-staff"), staffItems, data);
  }

  // Tab switching
  root.querySelectorAll(".docket-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab");
      root.querySelectorAll(".docket-tab").forEach((b) => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", String(b === btn));
      });
      root.querySelectorAll(".docket-panel").forEach((panel) => {
        const show = panel.id === `docket-panel-${tab}`;
        panel.hidden = !show;
      });
      try { localStorage.setItem(tabLsKey, tab); } catch { /* ignore */ }
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
  // Restore localStorage-persisted dismissed docket timestamps
  data.liveDocket ??= { asOf: "Today", items: [] };
  data.liveDocket.seenActivityTs ??= {};
  try {
    const lsKey = `rb_docket_seenTs_${data.currentUser?.username || ""}`;
    const stored = JSON.parse(localStorage.getItem(lsKey) || "{}");
    for (const [k, v] of Object.entries(stored)) {
      data.liveDocket.seenActivityTs[k] = Math.max(Number(data.liveDocket.seenActivityTs[k] || 0), Number(v || 0));
    }
  } catch { /* ignore localStorage errors */ }

  await Promise.allSettled(isLoggedIn() ? [
    // Bills → order paper + live docket (DB authoritative — replace entirely)
    apiGetBills().then((r) => {
      data.orderPaperCommons = Array.isArray(r?.bills) ? r.bills : [];
    }),
    // Motions → live docket (DB authoritative — replace entirely)
    apiGetMotions().then((r) => {
      const all = r?.motions ?? [];
      data.motions ??= { house: [], edm: [], nextHouseNumber: 1, nextEdmNumber: 1 };
      data.motions.house = all.filter((m) => (m._motionType || m.motion_type) === "house");
      data.motions.edm   = all.filter((m) => (m._motionType || m.motion_type) === "edm");
    }),
    // Statements → live docket (DB authoritative — replace entirely)
    apiGetStatements().then((r) => {
      data.statements ??= { items: [] };
      data.statements.items = Array.isArray(r?.statements) ? r.statements : [];
    }),
    // Regulations → live docket (DB authoritative — replace entirely)
    apiGetRegulations().then((r) => {
      data.regulations ??= { items: [] };
      data.regulations.items = Array.isArray(r?.regulations) ? r.regulations : [];
    }),
    // Press items → live docket (DB authoritative — replace each category entirely)
    apiGetPressItems().then((r) => {
      data.press ??= { releases: [], conferences: [], comments: [], speeches: [], letters: [] };
      const byType = { release: "releases", conference: "conferences", comment: "comments", speech: "speeches", letter: "letters" };
      // Reset all press categories so deleted/archived items are not stale
      for (const key of Object.values(byType)) data.press[key] = [];
      for (const item of (r?.items ?? [])) {
        const key = byType[item._pressType] || "releases";
        data.press[key].push(item);
      }
    }),
    // Events → live docket (DB authoritative — replace entirely)
    apiGetEvents().then((r) => {
      data.events ??= { items: [] };
      data.events.items = Array.isArray(r?.events) ? r.events : [];
    }),
    // Question Time → live docket (DB authoritative — replace entirely)
    apiGetQtLegacyQuestions().then((r) => {
      data.questionTime ??= { offices: [], questions: [] };
      data.questionTime.questions = Array.isArray(r?.questions) ? r.questions : [];
    }).catch((err) => {
      console.error("[dashboard] questiontime DB load failed — clearing QT questions to prevent stale data", err);
      data.questionTime ??= { offices: [], questions: [] };
      data.questionTime.questions = [];
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
    // Government events (fire/resign/reshuffle) → live docket
    apiGetGovernmentEvents().then((r) => {
      data.governmentEvents = Array.isArray(r?.events) ? r.events : [];
    }).catch((err) => {
      console.error("[dashboard] government events load failed", err);
    }),
    // Elections → player docket (finalized results visible to all)
    apiGetElections().then((r) => {
      data.elections ??= { elections: [] };
      data.elections.elections = Array.isArray(r?.elections) ? r.elections : [];
    }).catch((err) => {
      console.error("[dashboard] elections load failed", err);
    }),
  ] : []);

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
