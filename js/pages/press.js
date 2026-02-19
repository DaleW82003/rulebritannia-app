import { saveData } from "../core.js";
import { esc } from "../ui.js";
import { isAdmin, isMod, isSpeaker } from "../permissions.js";
import { formatSimMonthYear, getWeekdayName, isSunday } from "../clock.js";

const PARTY_CODES = {
  Conservative: "CON",
  Labour: "LAB",
  "Liberal Democrat": "LDM"
};

const GOV_OFFICES = new Set([
  "prime-minister", "leader-commons", "chancellor", "home", "foreign", "trade", "defence",
  "welfare", "education", "env-agri", "health", "eti", "culture", "home-nations"
]);

function getCharacter(data) {
  return data?.currentCharacter || data?.currentPlayer || {};
}

function ensurePress(data) {
  data.press ??= {};
  data.press.releases ??= [];
  data.press.conferences ??= [];
  data.press.comments ??= [];
  data.press.counters ??= {};
  data.press.nextId ??= 1;
}

function simLabel(data) {
  return formatSimMonthYear(data?.gameState || {});
}

function plusMonths(label, months) {
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const [mn, ys] = String(label || "August 1997").split(" ");
  let m = Math.max(names.indexOf(mn), 0) + 1;
  let y = Number(ys || 1997);
  const total = ((y * 12) + (m - 1) + months);
  const nm = (total % 12) + 1;
  const ny = Math.floor(total / 12);
  return `${names[nm - 1]} ${ny}`;
}

function surname(name) {
  const parts = String(name || "MP").trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 2] || parts[parts.length - 1] : parts[0] || "MP";
}

function isGovernment(char) {
  return GOV_OFFICES.has(char?.office);
}

function makePrefix(char, kind) {
  const role = char?.role;
  if (char?.office === "prime-minister") return "PM";
  if (role === "leader-opposition" || role === "party-leader-3rd-4th") {
    return PARTY_CODES[char?.party] || (char?.party || "PARTY").slice(0, 3).toUpperCase();
  }
  if (isGovernment(char)) return "GOV";
  return surname(char?.name || "MP");
}

function nextSerial(data, kind, prefix) {
  const key = `${kind}:${prefix}`;
  data.press.counters[key] = Number(data.press.counters[key] || 0) + 1;
  return data.press.counters[key];
}

function canMark(data) {
  return isMod(data) || isAdmin(data);
}

function canAsk(data) {
  return isMod(data) || isSpeaker(data) || isAdmin(data);
}

function avatar(name, url) {
  if (url) return url;
  const i = (name || "?").slice(0, 1).toUpperCase();
  return `https://dummyimage.com/48x48/334455/ffffff&text=${encodeURIComponent(i)}`;
}

function scoreChip(score) {
  if (score === null || score === undefined) return `<span class="muted">Awaiting Marking</span>`;
  const cls = Number(score) >= 0 ? "#0a7f2e" : "#9d1d1d";
  const sign = Number(score) > 0 ? "+" : "";
  return `<span style="color:${cls};font-weight:700;">${sign}${Number(score)}</span>`;
}

function render(data, state) {
  const root = document.getElementById("press-root");
  if (!root) return;

  ensurePress(data);
  const char = getCharacter(data);
  const now = simLabel(data);
  const marker = canMark(data);
  const asker = canAsk(data);
  const sundayWindow = isSunday();
  const weekday = getWeekdayName();

  const releases = data.press.releases.slice().reverse();
  const conferences = data.press.conferences.slice().reverse();
  const comments = data.press.comments.slice().reverse();

  root.innerHTML = `
    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Press Work</h2>
      <p>Three channels are available: <b>Press Releases & Statements</b>, <b>Press Conferences</b>, and <b>Comments to the Press</b>. Once submitted, users cannot edit submissions.</p>
      ${marker && !sundayWindow ? `<p class="muted">Press marking opens on Sundays only. Today is ${esc(weekday)}.</p>` : ""}
    </section>

    <section class="tile" style="margin-bottom:12px;">
      <div class="wgo-grid">
        <article class="wgo-tile card-flex">
          <div class="wgo-title">Press Releases & Statements</div>
          <div class="tile-bottom"><button class="btn" data-action="switch" data-view="releases" type="button">Open</button></div>
        </article>
        <article class="wgo-tile card-flex">
          <div class="wgo-title">Press Conferences</div>
          <div class="tile-bottom"><button class="btn" data-action="switch" data-view="conferences" type="button">Open</button></div>
        </article>
        <article class="wgo-tile card-flex">
          <div class="wgo-title">Comments to the Press</div>
          <div class="tile-bottom"><button class="btn" data-action="switch" data-view="comments" type="button">Open</button></div>
        </article>
      </div>
    </section>

    <section class="tile" id="press-section"></section>
  `;

  const section = root.querySelector("#press-section");
  if (!section) return;

  if (state.view === "releases") {
    section.innerHTML = `
      <h2 style="margin-top:0;">Press Releases & Statements</h2>
      <form id="release-form" class="tile" style="margin-bottom:10px;">
        <p class="muted"><b>Template note:</b> once submitted, this release is public and cannot be edited by users.</p>
        <label class="label" for="release-subject">Subject line</label>
        <input id="release-subject" name="subject" class="input" required>
        <label class="label" for="release-body">Release text</label>
        <textarea id="release-body" name="body" class="input" rows="6" required></textarea>
        <button class="btn" type="submit">Submit Release</button>
      </form>

      ${releases.length ? releases.map((r) => `
        <article class="tile" style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            <div><b>${esc(r.reference)}</b> — ${esc(r.subject)}</div>
            <div>${scoreChip(r.score)}</div>
          </div>
          <div class="muted">By ${esc(r.author)} • ${esc(r.createdAtSim)}</div>
          ${r.impact?.length ? `<div class="muted">Affects: ${esc(r.impact.join(", "))}</div>` : ""}
          <div class="tile-bottom"><button class="btn" data-action="toggle-release" data-id="${esc(r.id)}" type="button">${state.openRelease === r.id ? "Close" : "Open"}</button></div>
          ${state.openRelease === r.id ? `<div class="tile" style="margin-top:8px;white-space:pre-wrap;">${esc(r.body)}</div>` : ""}
          ${marker && sundayWindow && r.score === null ? `
            <form class="tile" data-action="mark-release" data-id="${esc(r.id)}" style="margin-top:8px;">
              <label class="label">Mark score (-5 to +5)</label>
              <input class="input" type="number" name="score" min="-5" max="5" required>
              <label class="label">Affect parties (comma-separated, optional)</label>
              <input class="input" name="impact" placeholder="CON, LAB, LDM">
              <button class="btn" type="submit">Apply Mark</button>
            </form>
          ` : ""}
        </article>
      `).join("") : `<p class="muted">No releases yet.</p>`}
    `;
  }

  if (state.view === "conferences") {
    const papers = (data.papers?.papers || []).map((p) => p.name).filter(Boolean);
    section.innerHTML = `
      <h2 style="margin-top:0;">Press Conferences</h2>
      <form id="conference-form" class="tile" style="margin-bottom:10px;">
        <p class="muted"><b>Template note:</b> once submitted, this conference opening is public and cannot be edited by users.</p>
        <label class="label" for="conference-subject">Subject line</label>
        <input id="conference-subject" name="subject" class="input" required>
        <label class="label" for="conference-body">Opening statement</label>
        <textarea id="conference-body" name="body" class="input" rows="6" required></textarea>
        <button class="btn" type="submit">Host Conference</button>
      </form>

      ${conferences.length ? conferences.map((c) => `
        <article class="tile" style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            <div><b>${esc(c.reference)}</b> — ${esc(c.subject)}</div>
            <div>${scoreChip(c.score)}</div>
          </div>
          <div class="muted">By ${esc(c.author)} • Opens ${esc(c.createdAtSim)} • Closes ${esc(c.closesAtSim)}</div>
          <div class="tile-bottom"><button class="btn" data-action="toggle-conference" data-id="${esc(c.id)}" type="button">${state.openConference === c.id ? "Close" : "Open"}</button></div>
          ${state.openConference === c.id ? `
            <div class="tile" style="margin-top:8px;white-space:pre-wrap;">${esc(c.body)}</div>
            <div class="tile" style="margin-top:8px;">
              <h4 style="margin-top:0;">Transcript</h4>
              ${(c.transcript || []).length ? c.transcript.map((t) => `<p><b>${esc(t.from)}:</b> ${esc(t.text)}</p>`).join("") : `<p class="muted">No questions yet.</p>`}
              ${asker && c.status !== "closed" ? `
                <form data-action="ask" data-id="${esc(c.id)}">
                  <label class="label">Ask as Political Correspondent</label>
                  <select class="input" name="paper">${papers.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("")}</select>
                  <textarea class="input" name="text" rows="2" required placeholder="Question for the conference host"></textarea>
                  <button class="btn" type="submit">Submit Question</button>
                </form>
              ` : ""}
              ${(char?.name === c.author && c.status !== "closed") ? `
                <form data-action="answer" data-id="${esc(c.id)}" style="margin-top:8px;">
                  <label class="label">Response</label>
                  <textarea class="input" name="text" rows="2" required placeholder="Your answer"></textarea>
                  <button class="btn" type="submit">Reply</button>
                  <button class="btn" type="button" data-action="walk-off" data-id="${esc(c.id)}">Walk Off</button>
                </form>
              ` : ""}
              ${marker && sundayWindow && c.score === null ? `
                <form data-action="mark-conference" data-id="${esc(c.id)}" style="margin-top:8px;">
                  <label class="label">Mark score (-5 to +5)</label>
                  <input class="input" type="number" name="score" min="-5" max="5" required>
                  <label class="label">Affect parties (comma-separated, optional)</label>
                  <input class="input" name="impact" placeholder="CON, LAB, LDM">
                  <button class="btn" type="submit">Apply Mark & Close</button>
                </form>
              ` : ""}
            </div>
          ` : ""}
        </article>
      `).join("") : `<p class="muted">No conferences yet.</p>`}
    `;
  }

  if (state.view === "comments") {
    section.innerHTML = `
      <h2 style="margin-top:0;">Comments to the Press</h2>
      <form id="comment-form" class="tile" style="margin-bottom:10px;">
        <label class="label" for="press-comment-body">Comment</label>
        <textarea id="press-comment-body" name="body" class="input" rows="3" required placeholder="Your passing comment to the press..."></textarea>
        <label class="label" for="press-comment-avatar">Avatar URL (optional)</label>
        <input id="press-comment-avatar" name="avatar" class="input" placeholder="https://...">
        <button class="btn" type="submit">Post Comment</button>
      </form>

      ${comments.length ? comments.map((c) => `
        <article class="tile" style="margin-bottom:10px;display:flex;gap:10px;align-items:flex-start;">
          <img src="${esc(avatar(c.author, c.avatar))}" alt="${esc(c.author)} avatar" width="44" height="44" style="border-radius:999px;object-fit:cover;">
          <div style="flex:1;">
            <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
              <div><b>${esc(c.author)}</b></div><div class="muted">${esc(c.createdAtSim)}</div>
            </div>
            <p style="white-space:pre-wrap;">${esc(c.body)}</p>
            ${marker ? `<button class="btn" data-action="delete-comment" data-id="${esc(c.id)}" type="button">Delete</button>` : ""}
          </div>
        </article>
      `).join("") : `<p class="muted">No comments yet.</p>`}
    `;
  }

  root.querySelectorAll("[data-action='switch']").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.view = btn.getAttribute("data-view") || "releases";
      render(data, state);
    });
  });

  section.querySelector("#release-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const subject = String(fd.get("subject") || "").trim();
    const body = String(fd.get("body") || "").trim();
    if (!subject || !body) return;
    const prefix = makePrefix(char, "PR");
    const serial = nextSerial(data, "PR", prefix);
    data.press.releases.push({
      id: `press-${Date.now()}-${data.press.nextId++}`,
      reference: `${prefix} PR ${serial}`,
      subject,
      body,
      author: char?.name || "MP",
      createdAtSim: now,
      score: null,
      impact: []
    });
    saveData(data);
    render(data, state);
  });

  section.querySelectorAll("[data-action='toggle-release']").forEach((btn) => btn.addEventListener("click", () => {
    const id = btn.getAttribute("data-id");
    state.openRelease = state.openRelease === id ? null : id;
    render(data, state);
  }));

  section.querySelectorAll("form[data-action='mark-release']").forEach((f) => f.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!marker || !isSunday()) return;
    const id = e.currentTarget.getAttribute("data-id");
    const item = data.press.releases.find((r) => r.id === id);
    if (!item) return;
    const fd = new FormData(e.currentTarget);
    item.score = Number(fd.get("score"));
    item.impact = String(fd.get("impact") || "").split(",").map((s) => s.trim()).filter(Boolean);
    item.status = "closed";
    saveData(data);
    render(data, state);
  }));

  section.querySelector("#conference-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const subject = String(fd.get("subject") || "").trim();
    const body = String(fd.get("body") || "").trim();
    if (!subject || !body) return;
    const prefix = makePrefix(char, "PC");
    const serial = nextSerial(data, "PC", prefix);
    const id = `press-${Date.now()}-${data.press.nextId++}`;
    data.press.conferences.push({
      id,
      reference: `${prefix} PC ${serial}`,
      subject,
      body,
      author: char?.name || "MP",
      createdAtSim: now,
      closesAtSim: plusMonths(now, 2),
      status: "open",
      transcript: [],
      score: null,
      impact: []
    });
    saveData(data);
    render(data, state);
  });

  section.querySelectorAll("[data-action='toggle-conference']").forEach((btn) => btn.addEventListener("click", () => {
    const id = btn.getAttribute("data-id");
    state.openConference = state.openConference === id ? null : id;
    render(data, state);
  }));

  section.querySelectorAll("form[data-action='ask']").forEach((f) => f.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!asker) return;
    const id = e.currentTarget.getAttribute("data-id");
    const conf = data.press.conferences.find((c) => c.id === id);
    if (!conf || conf.status === "closed") return;
    const fd = new FormData(e.currentTarget);
    const paper = String(fd.get("paper") || "Political Correspondent");
    const text = String(fd.get("text") || "").trim();
    if (!text) return;
    conf.transcript.push({ from: `${paper} Political Correspondent`, text });

    data.liveDocket ??= { items: [] };
    data.liveDocket.items ??= [];
    data.liveDocket.items.push({
      type: "question",
      title: `Press conference question awaiting response`,
      detail: `${conf.reference} — ${paper}`,
      ctaLabel: "Open Press",
      href: "press.html",
      priority: "high",
      audience: { offices: [char?.office || ""] }
    });

    saveData(data);
    render(data, state);
  }));

  section.querySelectorAll("form[data-action='answer']").forEach((f) => f.addEventListener("submit", (e) => {
    e.preventDefault();
    const id = e.currentTarget.getAttribute("data-id");
    const conf = data.press.conferences.find((c) => c.id === id);
    if (!conf || conf.status === "closed" || conf.author !== char?.name) return;
    const text = String(new FormData(e.currentTarget).get("text") || "").trim();
    if (!text) return;
    conf.transcript.push({ from: conf.author, text });
    saveData(data);
    render(data, state);
  }));

  section.querySelectorAll("[data-action='walk-off']").forEach((btn) => btn.addEventListener("click", () => {
    const id = btn.getAttribute("data-id");
    const conf = data.press.conferences.find((c) => c.id === id);
    if (!conf || conf.author !== char?.name || conf.status === "closed") return;
    conf.transcript.push({ from: conf.author, text: "[Walked off without answering further questions.]" });
    conf.status = "closed";
    saveData(data);
    render(data, state);
  }));

  section.querySelectorAll("form[data-action='mark-conference']").forEach((f) => f.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!marker || !isSunday()) return;
    const id = e.currentTarget.getAttribute("data-id");
    const conf = data.press.conferences.find((c) => c.id === id);
    if (!conf) return;
    const fd = new FormData(e.currentTarget);
    conf.score = Number(fd.get("score"));
    conf.impact = String(fd.get("impact") || "").split(",").map((s) => s.trim()).filter(Boolean);
    conf.status = "closed";
    saveData(data);
    render(data, state);
  }));

  section.querySelector("#comment-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = String(fd.get("body") || "").trim();
    const avatarUrl = String(fd.get("avatar") || "").trim();
    if (!body) return;
    data.press.comments.push({
      id: `press-${Date.now()}-${data.press.nextId++}`,
      author: char?.name || "MP",
      avatar: avatarUrl,
      body,
      createdAtSim: now
    });
    saveData(data);
    render(data, state);
  });

  section.querySelectorAll("[data-action='delete-comment']").forEach((btn) => btn.addEventListener("click", () => {
    if (!marker) return;
    const id = btn.getAttribute("data-id");
    data.press.comments = data.press.comments.filter((c) => c.id !== id);
    saveData(data);
    render(data, state);
  }));
}

export function initPressPage(data) {
  ensurePress(data);
  render(data, { view: "releases", openRelease: null, openConference: null });
}
