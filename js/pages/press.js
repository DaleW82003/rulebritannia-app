import { saveState } from "../core.js";
import { esc } from "../ui.js";
import { isAdmin, isMod, isSpeaker, canAdminOrMod, canAdminModOrSpeaker } from "../permissions.js";
import { formatSimMonthYear, getWeekdayName, isSunday } from "../clock.js";
import { apiCreatePressItem, apiGetPressItems, apiAddPressTranscriptEntry } from "../api.js";

const PARTY_CODES = {
  Conservative: "CON",
  Labour: "LAB",
  "Liberal Democrat": "LDM"
};

const GOV_OFFICES = new Set([
  "prime-minister", "leader-commons", "chancellor", "home", "foreign", "trade", "defence",
  "welfare", "education", "env-agri", "health", "eti", "culture", "home-nations"
]);

/** NPC office keys available for privileged users when issuing official letters. */
const NPC_OFFICES = {
  "monarch":         { displayName: "Buckingham Palace / The Crown", signatoryMale: "By Command of His Majesty", signatoryFemale: "By Command of Her Majesty", address: "Buckingham Palace, London SW1A 1AA" },
  "speakers-office": { displayName: "Speaker's Office",              signatory: "On behalf of the Speaker of the House of Commons", address: "Speaker's House, Houses of Parliament, London SW1A 0AA" },
  "cabinet-office":  { displayName: "Cabinet Office",                signatory: "Cabinet Office",                address: "70 Whitehall, London SW1A 2AS" }
};

/** Maps a character's government office ID to the formal letter-office they may use. */
const PLAYER_LETTER_OFFICES = {
  "prime-minister": { key: "pmo",         displayName: "Office of the Prime Minister",                    address: "10 Downing Street, London SW1A 2AA" },
  "chancellor":     { key: "treasury",    displayName: "HM Treasury",                                     address: "1 Horse Guards Road, London SW1A 2HQ" },
  "home":           { key: "home-office", displayName: "Home Office",                                     address: "2 Marsham Street, London SW1P 4DF" },
  "foreign":        { key: "fcdo",        displayName: "Foreign, Commonwealth & Development Office",      address: "King Charles Street, London SW1A 2AH" }
};

/** Maps a character's *role* (for opposition/third-party leaders) to a letter-office. */
const PLAYER_ROLE_LETTER_OFFICES = {
  "leader-opposition":    { key: "opp-leader",         displayName: "Office of the Leader of the Opposition",   address: "House of Commons, London SW1A 0AA" },
  "party-leader-3rd-4th": { key: "third-party-leader", displayName: "Office of the Leader of the Third Party",  address: "House of Commons, London SW1A 0AA" }
};

function getCharacter(data) {
  return data?.currentCharacter || data?.currentPlayer || {};
}

function ensurePress(data) {
  data.press ??= {};
  data.press.releases ??= [];
  data.press.conferences ??= [];
  data.press.comments ??= [];
  data.press.speeches ??= [];
  data.press.letters ??= [];
  data.press.counters ??= {};
  data.press.nextId ??= 1;
}

/**
 * Determine the letter-office the current character is authorised to use.
 * Returns an office descriptor { key, displayName, address } or null if not authorised.
 * Privileged users (admin/mod/speaker) bypass this and may use NPC offices instead.
 */
function getPlayerLetterOffice(data) {
  const char = getCharacter(data);
  return PLAYER_LETTER_OFFICES[char?.office] || PLAYER_ROLE_LETTER_OFFICES[char?.role] || null;
}

/** Explicit short prefixes for NPC office reference codes. */
const NPC_OFFICE_PREFIXES = {
  "monarch":         "ROY",
  "speakers-office": "SPK",
  "cabinet-office":  "CAB"
};

/** Render a letter-office selector HTML for privileged users. */
function npcOfficeOptions() {
  return Object.entries(NPC_OFFICES)
    .map(([k, v]) => `<option value="${esc(k)}">${esc(v.displayName)}</option>`)
    .join("");
}

/** Lookup an office descriptor by key — checks NPC offices then player offices. */
function officeByKey(key) {
  if (NPC_OFFICES[key]) return NPC_OFFICES[key];
  for (const o of Object.values(PLAYER_LETTER_OFFICES)) {
    if (o.key === key) return o;
  }
  for (const o of Object.values(PLAYER_ROLE_LETTER_OFFICES)) {
    if (o.key === key) return o;
  }
  return null;
}

function simLabel(data) {
  return formatSimMonthYear(data?.gameState || {});
}

/** Return the signatory line for an NPC office, using monarch gender from adminSettings. */
function npcSignatory(officeKey, data) {
  const office = NPC_OFFICES[officeKey];
  if (!office) return "";
  if (officeKey === "monarch") {
    const gender = data?.adminSettings?.monarchGender || "Queen";
    return gender === "King" ? office.signatoryMale : office.signatoryFemale;
  }
  return office.signatory || "";
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
  return canAdminOrMod(data);
}

function canAsk(data) {
  return canAdminModOrSpeaker(data);
}

function avatarFallback(name) {
  const i = (name || "?").slice(0, 1).toUpperCase();
  return `https://dummyimage.com/48x48/334455/ffffff&text=${encodeURIComponent(i)}`;
}

function findCharacterAvatar(data, name, explicitAvatar = "") {
  if (explicitAvatar) return explicitAvatar;

  const wanted = String(name || "").trim().toLowerCase();
  if (!wanted) return avatarFallback(name);

  const pools = [
    data?.currentCharacter,
    data?.currentPlayer,
    ...(data?.players || []),
    ...(data?.government?.activeCharacters || []),
    ...(data?.opposition?.activeCharacters || []),
    ...(data?.government?.offices || []).map((o) => ({ name: o.holderName, avatar: o.holderAvatar })),
    ...(data?.opposition?.offices || []).map((o) => ({ name: o.holderName, avatar: o.holderAvatar }))
  ];

  const match = pools.find((entry) => String(entry?.name || "").trim().toLowerCase() === wanted && String(entry?.avatar || "").trim());
  return match?.avatar || avatarFallback(name);
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
  const privileged = canAdminModOrSpeaker(data);
  const hasActiveChar = privileged || Boolean(char?.name);
  const sundayWindow = isSunday();
  const weekday = getWeekdayName();

  const releases = data.press.releases.slice().reverse();
  const conferences = data.press.conferences.slice().reverse();
  const comments = data.press.comments.slice().reverse();
  const speeches = data.press.speeches.slice().reverse();
  const letters = data.press.letters.slice().reverse();

  root.innerHTML = `
    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Press Work</h2>
      <p>Five channels are available: <b>Press Releases &amp; Statements</b>, <b>Press Conferences</b>, <b>Comments to the Press</b>, <b>Speeches</b>, and <b>Official Letters</b>. Once submitted, users cannot edit submissions.</p>
      ${marker && !sundayWindow ? `<p class="muted">Press marking opens on Sundays only. Today is ${esc(weekday)}.</p>` : ""}
    </section>

    <section class="tile" style="margin-bottom:12px;">
      <div class="press-tile-grid">
        <article class="wgo-tile card-flex">
          <div class="wgo-title">Press Releases &amp; Statements</div>
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
        <article class="wgo-tile card-flex">
          <div class="wgo-title">Speeches</div>
          <div class="tile-bottom"><button class="btn" data-action="switch" data-view="speeches" type="button">Open</button></div>
        </article>
        <article class="wgo-tile card-flex">
          <div class="wgo-title">Official Letters</div>
          <div class="tile-bottom"><button class="btn" data-action="switch" data-view="letters" type="button">Open</button></div>
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
      ${!hasActiveChar
        ? `<div class="muted-block">You must have an active character to submit press releases. <a href="user.html">Create or activate a character</a> first.</div>`
        : `<form id="release-form" class="tile" style="margin-bottom:10px;">
        <p class="muted"><b>Template note:</b> once submitted, this release is public and cannot be edited by users.</p>
        <label class="label" for="release-subject">Subject line</label>
        <input id="release-subject" name="subject" class="input" required>
        <label class="label" for="release-body">Release text</label>
        <textarea id="release-body" name="body" class="input" rows="6" required></textarea>
        <button class="btn" type="submit">Submit Release</button>
      </form>`}

      ${releases.length ? releases.map((r) => `
        <article class="tile" style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            <div><b>${esc(r.reference)}</b> — ${esc(r.subject)}</div>
            <div>${scoreChip(r.score)}</div>
          </div>
          <div class="muted">By ${esc(r.author)} • ${esc(r.createdAtSim)}</div>
          ${r.impact?.length ? `<div class="muted">Affects: ${esc(r.impact.join(", "))}</div>` : ""}
          <div class="tile-bottom"><button class="btn" data-action="toggle-release" data-id="${esc(r.id)}" type="button">${state.openRelease === r.id ? "Close" : "Open"}</button>${marker ? `<button class="btn danger" data-action="delete-release" data-id="${esc(r.id)}" type="button">Delete</button>` : ""}</div>
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
      ${!hasActiveChar
        ? `<div class="muted-block">You must have an active character to host press conferences. <a href="user.html">Create or activate a character</a> first.</div>`
        : `<form id="conference-form" class="tile" style="margin-bottom:10px;">
        <p class="muted"><b>Template note:</b> once submitted, this conference opening is public and cannot be edited by users.</p>
        <label class="label" for="conference-subject">Subject line</label>
        <input id="conference-subject" name="subject" class="input" required>
        <label class="label" for="conference-body">Opening statement</label>
        <textarea id="conference-body" name="body" class="input" rows="6" required></textarea>
        <button class="btn" type="submit">Host Conference</button>
      </form>`}

      ${conferences.length ? conferences.map((c) => `
        <article class="tile" style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            <div><b>${esc(c.reference)}</b> — ${esc(c.subject)}</div>
            <div>${scoreChip(c.score)}</div>
          </div>
          <div class="muted">By ${esc(c.author)} • Opens ${esc(c.createdAtSim)} • Closes ${esc(c.closesAtSim)}</div>
          <div class="tile-bottom"><button class="btn" data-action="toggle-conference" data-id="${esc(c.id)}" type="button">${state.openConference === c.id ? "Close" : "Open"}</button>${marker ? `<button class="btn danger" data-action="delete-conference" data-id="${esc(c.id)}" type="button">Delete</button>` : ""}</div>
          ${state.openConference === c.id ? `
            <div class="tile" style="margin-top:8px;white-space:pre-wrap;">${esc(c.body)}</div>
            <div class="tile" style="margin-top:8px;">
              <h4 style="margin-top:0;">Transcript</h4>
              ${(c.transcript || []).length ? c.transcript.map((t) => `<p><b>${esc(t.from)}:</b> ${esc(t.text)}</p>`).join("") : `<p class="muted">No questions yet.</p>`}
              ${asker && c.status !== "closed" ? `
                <form data-action="ask" data-id="${esc(c.id)}">
                  <label class="label">Ask as Political Correspondent</label>
                  <select class="input" name="paper">${papers.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("")}</select>
                  <input class="input" name="corrName" type="text" maxlength="80" required placeholder="Correspondent name (e.g. Jane Smith)">
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
      ${!hasActiveChar
        ? `<div class="muted-block">You must have an active character to post press comments. <a href="user.html">Create or activate a character</a> first.</div>`
        : `<form id="comment-form" class="tile" style="margin-bottom:10px;">
        <label class="label" for="press-comment-body">Comment</label>
        <textarea id="press-comment-body" name="body" class="input" rows="3" required placeholder="Your passing comment to the press..."></textarea>
        <p class="muted">Avatar is pulled from your character profile.</p>
        <button class="btn" type="submit">Post Comment</button>
      </form>`}

      ${comments.length ? comments.map((c) => `
        <article class="tile" style="margin-bottom:10px;display:flex;gap:10px;align-items:flex-start;">
          <img src="${esc(findCharacterAvatar(data, c.author, c.avatar))}" alt="${esc(c.author)} avatar" width="44" height="44" style="border-radius:999px;object-fit:cover;">
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

  if (state.view === "speeches") {
    section.innerHTML = `
      <h2 style="margin-top:0;">Speeches</h2>
      ${!hasActiveChar
        ? `<div class="muted-block">You must have an active character to submit speeches. <a href="user.html">Create or activate a character</a> first.</div>`
        : `<form id="speech-form" class="tile" style="margin-bottom:10px;">
        <p class="muted"><b>Template note:</b> once submitted, this speech is public and cannot be edited by users.</p>
        <label class="label" for="speech-title">Title</label>
        <input id="speech-title" name="title" class="input" required>
        <label class="label" for="speech-audience">Audience</label>
        <input id="speech-audience" name="audience" class="input" required placeholder="e.g. Party Conference, Parliamentary Session">
        <label class="label" for="speech-top">Top of speech (occasion / opening header)</label>
        <input id="speech-top" name="topOfSpeech" class="input" required placeholder="e.g. Conference Season Address">
        <label class="label" for="speech-body">Body</label>
        <textarea id="speech-body" name="body" class="input" rows="8" required></textarea>
        <label class="label" for="speech-picture">Picture URL (optional)</label>
        <input id="speech-picture" name="picture" class="input" type="text" placeholder="https://...">
        <button class="btn" type="submit">Submit Speech</button>
      </form>`}

      ${speeches.length ? speeches.map((s) => `
        <article class="tile" style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            <div><b>${esc(s.reference)}</b> — ${esc(s.title)}</div>
            <div>${scoreChip(s.score)}</div>
          </div>
          <div class="muted">By ${esc(s.author)} • ${esc(s.audience)} • ${esc(s.createdAtSim)}</div>
          ${s.impact?.length ? `<div class="muted">Affects: ${esc(s.impact.join(", "))}</div>` : ""}
          <div class="tile-bottom"><button class="btn" data-action="toggle-speech" data-id="${esc(s.id)}" type="button">${state.openSpeech === s.id ? "Close" : "Open"}</button>${marker ? `<button class="btn danger" data-action="delete-speech" data-id="${esc(s.id)}" type="button">Delete</button>` : ""}</div>
          ${state.openSpeech === s.id ? `
            <div class="tile" style="margin-top:8px;">
              ${s.picture ? `<img src="${esc(s.picture)}" alt="Speech image" style="max-width:100%;margin-bottom:8px;display:block;" onerror="this.style.display='none'">` : ""}
              <div style="font-weight:600;margin-bottom:4px;">${esc(s.topOfSpeech)}</div>
              <div style="white-space:pre-wrap;">${esc(s.body)}</div>
            </div>
          ` : ""}
          ${marker && sundayWindow && s.score === null ? `
            <form class="tile" data-action="mark-speech" data-id="${esc(s.id)}" style="margin-top:8px;">
              <label class="label">Mark score (-5 to +5)</label>
              <input class="input" type="number" name="score" min="-5" max="5" required>
              <label class="label">Affect parties (comma-separated, optional)</label>
              <input class="input" name="impact" placeholder="CON, LAB, LDM">
              <button class="btn" type="submit">Apply Mark</button>
            </form>
          ` : ""}
        </article>
      `).join("") : `<p class="muted">No speeches yet.</p>`}
    `;
  }

  if (state.view === "letters") {
    const playerOffice = getPlayerLetterOffice(data);
    const canPost = privileged || Boolean(playerOffice);
    section.innerHTML = `
      <h2 style="margin-top:0;">Official Letters</h2>
      ${canPost ? `
        <form id="letter-form" class="tile" style="margin-bottom:10px;">
          <p class="muted"><b>Template note:</b> once submitted, this letter is public and cannot be edited by users.</p>
          ${privileged ? `
            <label class="label" for="letter-office-select">Issuing office</label>
            <select id="letter-office-select" name="officeKey" class="input">
              <optgroup label="NPC Offices">
                ${npcOfficeOptions()}
              </optgroup>
              ${playerOffice ? `<optgroup label="Your Office"><option value="${esc(playerOffice.key)}">${esc(playerOffice.displayName)}</option></optgroup>` : ""}
            </select>
          ` : `
            <p class="muted">Issuing as: <b>${esc(playerOffice.displayName)}</b></p>
            <input type="hidden" name="officeKey" value="${esc(playerOffice.key)}">
          `}
          <label class="label" for="letter-recipient">To (Recipient)</label>
          <input id="letter-recipient" name="recipient" class="input" required placeholder="e.g. The Prime Minister">
          <label class="label" for="letter-subject">Subject / Title</label>
          <input id="letter-subject" name="subject" class="input" required>
          <label class="label" for="letter-body">Body</label>
          <textarea id="letter-body" name="body" class="input" rows="8" required></textarea>
          <label class="label" for="letter-ref">Reference code (optional)</label>
          <input id="letter-ref" name="refCode" class="input" type="text" placeholder="Leave blank to auto-generate">
          <button class="btn" type="submit">Send Letter</button>
        </form>
      ` : `
        <div class="tile" style="margin-bottom:10px;">
          <p class="muted">You are not authorised to issue Official Letters. Only the Prime Minister, Chancellor, Home Secretary, Foreign Secretary, Leader of the Opposition, and Leader of the Third Party may do so.</p>
        </div>
      `}

      ${letters.length ? letters.map((l) => {
        const office = officeByKey(l.officeKey);
        return `
        <article class="tile" style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            <div><b>${esc(l.reference)}</b> — ${esc(l.subject)}</div>
            <div>${scoreChip(l.score)}</div>
          </div>
          <div class="muted">From ${esc(office?.displayName || l.officeKey)} • To: ${esc(l.recipient)} • ${esc(l.createdAtSim)}</div>
          ${l.impact?.length ? `<div class="muted">Affects: ${esc(l.impact.join(", "))}</div>` : ""}
          <div class="tile-bottom"><button class="btn" data-action="toggle-letter" data-id="${esc(l.id)}" type="button">${state.openLetter === l.id ? "Close" : "Open"}</button>${marker ? `<button class="btn danger" data-action="delete-letter" data-id="${esc(l.id)}" type="button">Delete</button>` : ""}</div>
          ${state.openLetter === l.id ? `
            <div class="tile" style="margin-top:8px;">
              <div style="border:2px solid #1a3050;padding:16px;background:#f8f8f4;margin-bottom:12px;text-align:center;">
                <div style="font-size:1.15em;font-weight:700;">${esc(office?.displayName || l.officeKey)}</div>
                ${office?.address ? `<div class="muted" style="font-size:0.9em;">${esc(office.address)}</div>` : ""}
              </div>
              <p><b>To:</b> ${esc(l.recipient)}</p>
              <p><b>Subject:</b> ${esc(l.subject)}</p>
              <div style="white-space:pre-wrap;margin-top:8px;">${esc(l.body)}</div>
              ${office?.signatory ? `<p style="margin-top:12px;" class="muted"><i>${esc(npcSignatory(l.officeKey, data) || office.signatory)}</i></p>` : ""}
            </div>
          ` : ""}
          ${marker && sundayWindow && l.score === null ? `
            <form class="tile" data-action="mark-letter" data-id="${esc(l.id)}" style="margin-top:8px;">
              <label class="label">Mark score (-5 to +5)</label>
              <input class="input" type="number" name="score" min="-5" max="5" required>
              <label class="label">Affect parties (comma-separated, optional)</label>
              <input class="input" name="impact" placeholder="CON, LAB, LDM">
              <button class="btn" type="submit">Apply Mark</button>
            </form>
          ` : ""}
        </article>
        `;
      }).join("") : `<p class="muted">No official letters yet.</p>`}
    `;
  }

  root.querySelectorAll("[data-action='switch']").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.view = btn.getAttribute("data-view") || "releases";
      render(data, state);
    });
  });

  section.querySelector("#release-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const subject = String(fd.get("subject") || "").trim();
    const body = String(fd.get("body") || "").trim();
    if (!subject || !body) return;
    const prefix = makePrefix(char, "PR");
    const serial = nextSerial(data, "PR", prefix);
    const item = {
      id: `press-${Date.now()}-${data.press.nextId++}`,
      reference: `${prefix} PR ${serial}`,
      subject,
      body,
      author: char?.name || "MP",
      createdAtSim: now,
      score: null,
      impact: []
    };
    const submitBtn = e.currentTarget.querySelector("[type='submit']");
    if (submitBtn) submitBtn.disabled = true;
    try {
      await apiCreatePressItem({ press_type: "release", ...item });
    } catch (err) {
      console.error(err);
      if (submitBtn) submitBtn.disabled = false;
      return;
    }
    data.press.releases.push(item);
    saveState(data);
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
    saveState(data);
    render(data, state);
  }));

  section.querySelector("#conference-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const subject = String(fd.get("subject") || "").trim();
    const body = String(fd.get("body") || "").trim();
    if (!subject || !body) return;
    const prefix = makePrefix(char, "PC");
    const serial = nextSerial(data, "PC", prefix);
    const id = `press-${Date.now()}-${data.press.nextId++}`;
    const item = {
      id,
      reference: `${prefix} PC ${serial}`,
      subject,
      body,
      author: char?.name || "MP",
      authorOffice: char?.office || "",
      createdAtSim: now,
      closesAtSim: plusMonths(now, 2),
      status: "open",
      transcript: [],
      score: null,
      impact: []
    };
    const submitBtn = e.currentTarget.querySelector("[type='submit']");
    if (submitBtn) submitBtn.disabled = true;
    try {
      await apiCreatePressItem({ press_type: "conference", ...item });
    } catch (err) {
      console.error(err);
      if (submitBtn) submitBtn.disabled = false;
      return;
    }
    data.press.conferences.push(item);
    saveState(data);
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
    const corrName = String(fd.get("corrName") || "").trim();
    const text = String(fd.get("text") || "").trim();
    if (!text || !corrName) return;
    const from = `${corrName}, Political Correspondent for ${paper}`;
    conf.transcript.push({ from, text });

    data.liveDocket ??= { items: [] };
    data.liveDocket.items ??= [];
    data.liveDocket.items.push({
      type: "question",
      title: `Press conference question awaiting response`,
      detail: `${conf.reference} — ${paper}`,
      ctaLabel: "Open Press",
      href: "press.html",
      priority: "high",
      audience: { offices: [conf.authorOffice || ""] }
    });

    saveState(data);
    render(data, state);
  }));

  section.querySelectorAll("form[data-action='answer']").forEach((f) => f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = e.currentTarget.getAttribute("data-id");
    const conf = data.press.conferences.find((c) => c.id === id);
    if (!conf || conf.status === "closed" || conf.author !== char?.name) return;
    const text = String(new FormData(e.currentTarget).get("text") || "").trim();
    if (!text) return;
    const submitBtn = e.currentTarget.querySelector("button[type='submit']");
    if (submitBtn) submitBtn.disabled = true;
    const entry = { from: conf.author, text };
    conf.transcript.push(entry);
    try {
      await apiAddPressTranscriptEntry(id, entry);
      saveState(data);
    } catch (err) {
      console.error("[press] conference answer persist failed:", err);
      conf.transcript.pop(); // revert
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
    render(data, state);
  }));

  section.querySelectorAll("[data-action='walk-off']").forEach((btn) => btn.addEventListener("click", async () => {
    const id = btn.getAttribute("data-id");
    const conf = data.press.conferences.find((c) => c.id === id);
    if (!conf || conf.author !== char?.name || conf.status === "closed") return;
    btn.disabled = true;
    const entry = { from: conf.author, text: "[Walked off without answering further questions.]", walkOff: true };
    conf.transcript.push(entry);
    conf.status = "closed";
    try {
      await apiAddPressTranscriptEntry(id, { ...entry });
      saveState(data);
    } catch (err) {
      console.error("[press] walk-off persist failed:", err);
      conf.transcript.pop(); // revert
      conf.status = "open";
      btn.disabled = false;
    }
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
    saveState(data);
    render(data, state);
  }));

  section.querySelector("#comment-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = String(fd.get("body") || "").trim();
    if (!body) return;
    const item = {
      id: `press-${Date.now()}-${data.press.nextId++}`,
      author: char?.name || "MP",
      avatar: findCharacterAvatar(data, char?.name || "MP", char?.avatar || ""),
      body,
      createdAtSim: now
    };
    const submitBtn = e.currentTarget.querySelector("[type='submit']");
    if (submitBtn) submitBtn.disabled = true;
    try {
      await apiCreatePressItem({ press_type: "comment", ...item });
    } catch (err) {
      console.error(err);
      if (submitBtn) submitBtn.disabled = false;
      return;
    }
    data.press.comments.push(item);
    saveState(data);
    render(data, state);
  });

  section.querySelectorAll("[data-action='delete-comment']").forEach((btn) => btn.addEventListener("click", () => {
    if (!marker) return;
    const id = btn.getAttribute("data-id");
    data.press.comments = data.press.comments.filter((c) => c.id !== id);
    saveState(data);
    render(data, state);
  }));

  section.querySelectorAll("[data-action='delete-release']").forEach((btn) => btn.addEventListener("click", () => {
    if (!marker) return;
    const id = btn.getAttribute("data-id");
    data.press.releases = data.press.releases.filter((r) => r.id !== id);
    saveState(data);
    render(data, state);
  }));

  section.querySelectorAll("[data-action='delete-conference']").forEach((btn) => btn.addEventListener("click", () => {
    if (!marker) return;
    const id = btn.getAttribute("data-id");
    data.press.conferences = data.press.conferences.filter((c) => c.id !== id);
    saveState(data);
    render(data, state);
  }));

  section.querySelector("#speech-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const title = String(fd.get("title") || "").trim();
    const audience = String(fd.get("audience") || "").trim();
    const topOfSpeech = String(fd.get("topOfSpeech") || "").trim();
    const body = String(fd.get("body") || "").trim();
    const picture = String(fd.get("picture") || "");
    if (!title || !audience || !topOfSpeech || !body) return;
    const prefix = makePrefix(char, "SP");
    const serial = nextSerial(data, "SP", prefix);
    const item = {
      id: `press-${Date.now()}-${data.press.nextId++}`,
      reference: `${prefix} SP ${serial}`,
      title,
      audience,
      topOfSpeech,
      body,
      picture,
      author: char?.name || "MP",
      authorOffice: char?.office || char?.role || "",
      createdAtSim: now,
      score: null,
      impact: [],
      is_marked: false
    };
    const submitBtn = e.currentTarget.querySelector("[type='submit']");
    if (submitBtn) submitBtn.disabled = true;
    try {
      await apiCreatePressItem({ press_type: "speech", ...item });
    } catch (err) {
      console.error(err);
      if (submitBtn) submitBtn.disabled = false;
      return;
    }
    data.press.speeches.push(item);
    saveState(data);
    render(data, state);
  });

  section.querySelectorAll("[data-action='toggle-speech']").forEach((btn) => btn.addEventListener("click", () => {
    const id = btn.getAttribute("data-id");
    state.openSpeech = state.openSpeech === id ? null : id;
    render(data, state);
  }));

  section.querySelectorAll("form[data-action='mark-speech']").forEach((f) => f.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!marker || !isSunday()) return;
    const id = e.currentTarget.getAttribute("data-id");
    const item = data.press.speeches.find((s) => s.id === id);
    if (!item) return;
    const fd = new FormData(e.currentTarget);
    item.score = Number(fd.get("score"));
    item.impact = String(fd.get("impact") || "").split(",").map((s) => s.trim()).filter(Boolean);
    item.is_marked = true;
    saveState(data);
    render(data, state);
  }));

  section.querySelectorAll("[data-action='delete-speech']").forEach((btn) => btn.addEventListener("click", () => {
    if (!marker) return;
    const id = btn.getAttribute("data-id");
    data.press.speeches = data.press.speeches.filter((s) => s.id !== id);
    saveState(data);
    render(data, state);
  }));

  section.querySelector("#letter-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const officeKey = String(fd.get("officeKey") || "").trim();
    const recipient = String(fd.get("recipient") || "").trim();
    const subject = String(fd.get("subject") || "").trim();
    const body = String(fd.get("body") || "").trim();
    const refCode = String(fd.get("refCode") || "").trim();
    if (!officeKey || !recipient || !subject || !body) return;

    // Enforce office authorization client-side
    const isNpc = Boolean(NPC_OFFICES[officeKey]);
    const playerOfficeKeys = [
      ...Object.values(PLAYER_LETTER_OFFICES).map((o) => o.key),
      ...Object.values(PLAYER_ROLE_LETTER_OFFICES).map((o) => o.key)
    ];
    if (!isNpc && !playerOfficeKeys.includes(officeKey)) return;
    if (isNpc && !privileged) return;
    if (!isNpc && !privileged) {
      const playerOffice = getPlayerLetterOffice(data);
      if (!playerOffice || playerOffice.key !== officeKey) return;
    }

    const office = officeByKey(officeKey);
    const prefix = isNpc ? (NPC_OFFICE_PREFIXES[officeKey] || officeKey.toUpperCase().slice(0, 3)) : makePrefix(char, "LTR");
    const serial = nextSerial(data, "LTR", prefix);
    const autoRef = `${prefix}-LTR-${serial}`;
    const item = {
      id: `press-${Date.now()}-${data.press.nextId++}`,
      reference: refCode || autoRef,
      officeKey,
      officeName: office?.displayName || officeKey,
      recipient,
      subject,
      body,
      author: privileged && isNpc ? (npcSignatory(officeKey, data) || office?.displayName || officeKey) : (char?.name || "MP"),
      createdAtSim: now,
      score: null,
      impact: [],
      is_marked: false
    };
    const submitBtn = e.currentTarget.querySelector("[type='submit']");
    if (submitBtn) submitBtn.disabled = true;
    try {
      await apiCreatePressItem({ press_type: "letter", ...item });
    } catch (err) {
      console.error(err);
      if (submitBtn) submitBtn.disabled = false;
      return;
    }
    data.press.letters.push(item);
    saveState(data);
    render(data, state);
  });

  section.querySelectorAll("[data-action='toggle-letter']").forEach((btn) => btn.addEventListener("click", () => {
    const id = btn.getAttribute("data-id");
    state.openLetter = state.openLetter === id ? null : id;
    render(data, state);
  }));

  section.querySelectorAll("form[data-action='mark-letter']").forEach((f) => f.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!marker || !isSunday()) return;
    const id = e.currentTarget.getAttribute("data-id");
    const item = data.press.letters.find((l) => l.id === id);
    if (!item) return;
    const fd = new FormData(e.currentTarget);
    item.score = Number(fd.get("score"));
    item.impact = String(fd.get("impact") || "").split(",").map((s) => s.trim()).filter(Boolean);
    item.is_marked = true;
    saveState(data);
    render(data, state);
  }));

  section.querySelectorAll("[data-action='delete-letter']").forEach((btn) => btn.addEventListener("click", () => {
    if (!marker) return;
    const id = btn.getAttribute("data-id");
    data.press.letters = data.press.letters.filter((l) => l.id !== id);
    saveState(data);
    render(data, state);
  }));
}

export async function initPressPage(data) {
  ensurePress(data);

  try {
    const r = await apiGetPressItems();
    const byType = { release: "releases", conference: "conferences", comment: "comments", speech: "speeches", letter: "letters" };
    for (const item of (r?.items ?? [])) {
      const key = byType[item._pressType || item.press_type] || "releases";
      data.press[key] ??= [];
      const seen = new Set(data.press[key].map((x) => String(x.id)));
      if (!seen.has(String(item.id))) data.press[key].push(item);
    }
  } catch (err) {
    console.error("[press] DB load failed:", err);
  }

  const params = new URLSearchParams(window.location.search);
  const requested = params.get("view") || "releases";
  const validViews = ["releases", "conferences", "comments", "speeches", "letters"];
  const initialView = validViews.includes(requested) ? requested : "releases";
  render(data, { view: initialView, openRelease: null, openConference: null, openSpeech: null, openLetter: null });
}
