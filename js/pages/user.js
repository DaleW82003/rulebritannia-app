import { saveState } from "../core.js";
import { runSundayRoll, setAbsenceState } from "../engines/core-engine.js";
import { updateParliamentState } from "../engines/control-panel-engine.js";
import { esc } from "../ui.js";
import { isAdmin, isMod, isSpeaker, canAdminOrMod, canAdminModOrSpeaker } from "../permissions.js";
import {
  apiApplyCharacter, apiGetMyApplications, apiGetMyCharacters,
  apiGetCharacterApplications, apiApproveCharacterApplication,
  apiRejectCharacterApplication, apiSelectCharacter
} from "../api.js";

const CONTROL_LINKS = [
  { title: "Newsroom (BBC News)", href: "news.html", roles: ["mod", "admin"] },
  { title: "Papers Desk", href: "papers.html", roles: ["mod", "admin"] },
  { title: "Bodies Control", href: "bodies.html", roles: ["speaker", "mod", "admin"] },
  { title: "Locals Control", href: "locals.html", roles: ["speaker", "mod", "admin"] },
  { title: "Roles & Office Assignments", href: "government.html", roles: ["mod", "admin"] },
  { title: "Opposition Office Assignments", href: "opposition.html", roles: ["mod", "admin"] },
  { title: "Order Paper / Legislative Agenda", href: "dashboard.html", roles: ["pm", "leader-commons", "speaker", "mod", "admin"] },
  { title: "Polling Control", href: "polling.html", roles: ["mod", "admin"] },
  { title: "Elections Results Control", href: "elections.html", roles: ["mod", "admin"] },
  { title: "Press Scoring & Moderation", href: "press.html", roles: ["speaker", "mod", "admin"] },
  { title: "Budget Controls", href: "budget.html", roles: ["mod", "admin"] },
  { title: "Economy Control Panel", href: "economy.html", roles: ["mod", "admin"] },
  { title: "Speaker Control Panel", href: "user.html#speaker-controls", roles: ["speaker", "mod", "admin"] },
  { title: "Parliament Control Panel", href: "constituencies.html", roles: ["speaker", "mod", "admin"] }
];

function nowStamp() {
  return new Date().toLocaleString("en-GB", { hour12: false });
}

function isSundayToday() {
  return new Date().getDay() === 0;
}

function nextSundayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const add = (7 - d.getDay()) % 7;
  d.setDate(d.getDate() + add);
  return d.toISOString();
}

function canManage(data) {
  return canAdminModOrSpeaker(data);
}

function canAdmin(data) {
  return isAdmin(data);
}

function getChar(data) {
  return data?.currentCharacter || data?.currentPlayer || {};
}

function seatTaken(data, constituencyName) {
  const name = String(constituencyName || "").toLowerCase();
  if (!name) return false;
  const byPlayer = (data.players || []).some((p) => String(p.constituency || "").toLowerCase() === name);
  if (byPlayer) return true;
  const seat = (data.constituencies || []).find((c) => String(c.name || "").toLowerCase() === name);
  return Boolean(seat && ((seat.mpType === "npc" && seat.mpName) || (seat.mpType === "character" && seat.mpName)));
}

function openConstituencyOptions(data) {
  const pending = new Set((data.userManagement?.pendingCharacters || []).map((p) => String(p.constituency || "").toLowerCase()));
  const all = (data.constituencies || []).slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  return all.filter((c) => !seatTaken(data, c.name) && !pending.has(String(c.name || "").toLowerCase()));
}

function openConstituencyOptionsForParty(data, partyName) {
  const pending = new Set((data.userManagement?.pendingCharacters || []).map((p) => String(p.constituency || "").toLowerCase()));
  const all = (data.constituencies || []).slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  return all.filter((c) => {
    if (seatTaken(data, c.name)) return false;
    if (pending.has(String(c.name || "").toLowerCase())) return false;
    if (partyName && String(c.party || "") !== partyName) return false;
    return true;
  });
}

function normaliseUserData(data) {
  data.userManagement ??= {};
  data.userManagement.accounts ??= [
    {
      username: data?.currentUser?.username || "Dale",
      roles: Array.isArray(data?.currentUser?.roles) ? [...data.currentUser.roles] : ["admin"],
      isAdmin: !!data?.currentUser?.isAdmin,
      isMod: !!data?.currentUser?.isMod,
      isSpeaker: !!data?.currentUser?.isSpeaker,
      activeCharacter: String(getChar(data)?.name || ""),
      active: true
    }
  ];

  data.userManagement.pendingCharacters ??= [];
  data.userManagement.globalControls ??= {
    sundayFreeze: false,
    speakerConfigJson: JSON.stringify({
      tieBreaker: "Speaker",
      autoArchiveDays: 14,
      divisionWindowMonths: 1,
      debateWindowMonths: 2
    }, null, 2)
  };

  data.adminSettings ??= {};
  data.adminSettings.monarchGender ??= "Queen";
  data.adminSettings.libDemClosedToNewChars ??= false;

  data.parliament ??= {};
  data.parliament.totalSeats ??= 650;
  data.parliament.lastGeneralElection ??= "May 1997";
  data.parliament.governmentSetup ??= "Majority";
  data.parliament.parties ??= [
    { name: "Conservative", seats: 0 },
    { name: "Labour", seats: 0 },
    { name: "Liberal Democrat", seats: 0 },
    { name: "SNP", seats: 0 },
    { name: "Plaid Cymru", seats: 0 },
    { name: "Green", seats: 0 },
    { name: "UKIP", seats: 0 },
    { name: "DUP", seats: 0 },
    { name: "Sinn Fein", seats: 0 },
    { name: "SDLP", seats: 0 },
    { name: "Alliance", seats: 0 },
    { name: "TUP", seats: 0 },
    { name: "Independents", seats: 0 },
    { name: "Speaker", seats: 0 }
  ];

  data.gameState ??= {};
  data.gameState.started ??= false;
  data.gameState.isPaused ??= false;
  data.gameState.startSimMonth ??= 8;
  data.gameState.startSimYear ??= 1997;
  data.gameState.startRealDate ??= "";

  for (const acc of data.userManagement.accounts) {
    acc.username = String(acc.username || "").trim();
    acc.roles = Array.isArray(acc.roles) ? acc.roles : [];
    acc.isAdmin = !!acc.isAdmin;
    acc.isMod = !!acc.isMod;
    acc.isSpeaker = !!acc.isSpeaker;
    acc.activeCharacter = String(acc.activeCharacter || "").trim();
    acc.active = acc.active !== false;
  }
}

function roleChips(account) {
  const tags = [];
  if (account.isAdmin) tags.push("Admin");
  if (account.isMod) tags.push("Mod");
  if (account.isSpeaker) tags.push("Speaker");
  for (const r of account.roles || []) {
    if (!["admin", "mod", "speaker"].includes(r) && !tags.includes(r)) tags.push(r);
  }
  return tags.length ? tags.join(" · ") : "Player";
}

/**
 * Return the active-role badge HTML for the current user.
 * Admin > Mod > Speaker; returns "" for plain players.
 */
function activeRoleBadgeHTML(data) {
  if (isAdmin(data))    return `<span class="admin-badge">🔒 Admin</span>`;
  if (isMod(data))      return `<span class="mod-badge">🔧 Mod</span>`;
  if (isSpeaker(data))  return `<span class="speaker-badge">🔔 Speaker</span>`;
  return "";
}

/**
 * Return the set of role badges that apply to the Control Panels section heading.
 * Admins see all three; mods see Mod + Speaker; speakers see Speaker only.
 */
function controlPanelBadgesHTML(admin, data) {
  if (admin) {
    return `<span class="admin-badge">Admin</span> <span class="mod-badge">Mod</span> <span class="speaker-badge">Speaker</span>`;
  }
  if (isMod(data)) {
    return `<span class="mod-badge">Mod</span> <span class="speaker-badge">Speaker</span>`;
  }
  if (isSpeaker(data)) {
    return `<span class="speaker-badge">Speaker</span>`;
  }
  return "";
}

function currentAccount(data) {
  const u = String(data?.currentUser?.username || "").trim();
  return (data.userManagement?.accounts || []).find((a) => a.username === u);
}


function ownedCharactersForAccount(data, username) {
  const user = String(username || "").trim();
  if (!user) return [];
  const account = (data.userManagement?.accounts || []).find((a) => a.username === user);
  const activeName = String(account?.activeCharacter || "").trim();
  const chars = Array.isArray(data.players) ? data.players : [];
  return chars.filter((p) => {
    if (!p?.name) return false;
    if (String(p.ownerUsername || "").trim() === user) return true;
    return activeName && String(p.name) === activeName;
  });
}


function setCharacterInactiveEverywhere(data, characterName) {
  const name = String(characterName || "").trim();
  if (!name) return false;

  let changed = false;
  const player = (data.players || []).find((p) => p?.name === name);
  if (player && player.active !== false) {
    player.active = false;
    changed = true;
  }

  const markRosterInactive = (group) => {
    const roster = Array.isArray(data?.[group]?.activeCharacters) ? data[group].activeCharacters : [];
    const row = roster.find((c) => String(c?.name || "") === name);
    if (row && row.active !== false) {
      row.active = false;
      changed = true;
    }
  };

  markRosterInactive("government");
  markRosterInactive("opposition");

  const clearOffice = (group) => {
    const offices = Array.isArray(data?.[group]?.offices) ? data[group].offices : [];
    for (const office of offices) {
      if (String(office?.holderName || "") === name) {
        office.holderName = "";
        office.holderAvatar = "";
        changed = true;
      }
    }
  };

  clearOffice("government");
  clearOffice("opposition");

  if (String(data?.currentCharacter?.name || "") === name && data.currentCharacter.active !== false) {
    data.currentCharacter.active = false;
    changed = true;
  }
  if (String(data?.currentPlayer?.name || "") === name && data.currentPlayer.active !== false) {
    data.currentPlayer.active = false;
    changed = true;
  }

  return changed;
}

function leaderForParty(data, party) {
  const pname = String(party || "").toLowerCase();
  const players = Array.isArray(data.players) ? data.players : [];
  const leader = players.find((p) => String(p.party || "").toLowerCase() === pname && p.partyLeader);
  return leader?.name || "";
}


function delegationChoicesForParty(data, partyName, currentName) {
  const party = String(partyName || "").trim().toLowerCase();
  if (!party) return [];
  const current = String(currentName || "").trim();

  const names = new Set();
  for (const p of (Array.isArray(data.players) ? data.players : [])) {
    if (!p?.name) continue;
    if (String(p.party || "").trim().toLowerCase() !== party) continue;
    if (String(p.name).trim() === current) continue;
    if (p.active === false) continue;
    names.add(String(p.name).trim());
  }

  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

function render(data, state) {
  const host = document.getElementById("user-root") || document.querySelector("main.wrap");
  if (!host) return;

  normaliseUserData(data);
  const char = getChar(data);
  const manager = canManage(data);
  const admin = canAdmin(data);
  const account = currentAccount(data) || {
    username: data?.currentUser?.username || "Unknown",
    isAdmin: false,
    isMod: false,
    isSpeaker: false,
    roles: [],
    activeCharacter: String(char?.name || ""),
    active: true
  };

  // DB-backed character data (loaded async before render)
  const dbChars = Array.isArray(state.dbState?.myCharacters) ? state.dbState.myCharacters : [];
  const dbMyApps = Array.isArray(state.dbState?.myApplications) ? state.dbState.myApplications : [];
  const dbPendingApps = Array.isArray(state.dbState?.pendingApplications) ? state.dbState.pendingApplications : [];

  const hasActiveOwned = dbChars.some((c) => c.is_active);
  const inactiveOwned = dbChars.filter((c) => !c.is_active);
  const pendingByCurrent = dbMyApps.filter((a) => a.status === "pending");
  const delegationChoices = delegationChoicesForParty(data, char?.party, char?.name);

  const HOME_TYPES = ["Detached house", "Semi-detached house", "Terraced house", "Flat/apartment", "Town house", "Country estate", "Other"];
  const RENTAL_STATUSES = ["Occupied", "Vacant", "Under renovation"];

  host.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">User</div></div>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Account Data</h2>
      <div class="tile">
        <div class="kv"><span>Username</span><b>${esc(account.username)}</b></div>
        <div class="kv"><span>Role Set</span><b>${esc(roleChips(account))}</b></div>
        <div class="kv"><span>Active Character</span><b>${esc(account.activeCharacter || "None")}</b></div>
        <div class="kv"><span>Active Party</span><b>${esc(char?.party || "-")}</b></div>
        <div class="kv"><span>Status</span><b>${account.active ? "Active" : "Inactive"}</b></div>
        ${activeRoleBadgeHTML(data) ? `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">${activeRoleBadgeHTML(data)}</div>` : ""}
      </div>
    </section>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Character Data / Create Character</h2>
      <div class="tile" style="margin-bottom:10px;">
        <div><b>${esc(char?.name || "No character selected")}</b></div>
        <div class="muted">DOB: ${esc(char?.dateOfBirth || char?.date_of_birth || "-")} · Education: ${esc(char?.education || "-")} · Career: ${esc(char?.careerBackground || char?.career_background || "-")}</div>
        <div class="muted">Family: ${esc(char?.family || "-")} · Constituency: ${esc(char?.constituency || "-")} · Party: ${esc(char?.party || "-")} · Twitter: ${esc(char?.twitterHandle || char?.twitter_handle || "-")}</div>
        <div class="muted">First elected: ${esc(String(char?.yearFirstElected || char?.year_first_elected || "-"))} · Personal background: ${esc(char?.personalBackground || char?.personal_background || "-")} · Financial level: ${esc(String(char?.financialBackgroundLevel || char?.financial_background_level || "-"))}</div>
        <div class="muted">Absence: ${char?.absent ? "Absent" : "Active"}${char?.absent ? ` · Delegated to ${esc(char?.delegatedTo || "None")}` : ""}</div>
      </div>

      <div class="tile" style="margin-bottom:10px;">
        <div><b>Roster Eligibility</b></div>
        <div class="muted">Active characters you own: ${esc(String(dbChars.filter((c) => c.is_active).length))} · Pending submissions: ${esc(String(pendingByCurrent.length))}</div>
        ${hasActiveOwned ? `<div class="muted" style="margin-top:6px;">You already have an active character in this live simulation. Mark that character inactive before submitting a new one.</div>` : ""}
        ${inactiveOwned.length ? `<div style="margin-top:8px;display:grid;gap:6px;">${inactiveOwned.map((c) => `<div class="tile" style="display:flex;justify-content:space-between;gap:8px;align-items:center;"><div><b>${esc(c.name)}</b> <span class="muted">(inactive)</span></div><button class="btn" type="button" data-action="reactivate-character" data-id="${esc(c.id)}" data-name="${esc(c.name)}">Re-Activate</button></div>`).join("")}</div>` : ""}
      </div>

      <details class="tile" style="margin-bottom:10px;">
        <summary><b>Create Character (Moderator approval required)</b></summary>
        <form id="create-character-form" style="margin-top:10px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;">
          <input class="input" name="name" placeholder="Name" required>
          <input class="input" type="date" name="date_of_birth" required>
          <select class="input" name="education" required>
            <option value="">Education level</option>
            <option value="No Qualifications">No Qualifications</option>
            <option value="GCSEs">GCSEs</option>
            <option value="A Levels">A Levels</option>
            <option value="Certificate of HE">Certificate of HE</option>
            <option value="Diploma">Diploma</option>
            <option value="Bachelors Degree">Bachelors Degree</option>
            <option value="Masters Degree">Masters Degree</option>
            <option value="Doctorate">Doctorate</option>
          </select>
          <input class="input" name="career_background" placeholder="Career background" required>
          <input class="input" name="family" placeholder="Family" required>
          <select class="input" name="party" id="char-party-select" required>
            <option value="">Select party</option>
            <option value="Conservative">Conservative</option>
            <option value="Labour">Labour</option>
            ${!data.adminSettings.libDemClosedToNewChars ? `<option value="Liberal Democrat">Liberal Democrat</option>` : ""}
          </select>
          <select class="input" name="constituency" id="char-constituency-select" required>
            <option value="">Select party first</option>
          </select>
          <input class="input" name="avatar" placeholder="Avatar URL (optional)">
          <input class="input" name="twitter_handle" placeholder="Twitter handle (without @, optional)">
          <input class="input" name="year_first_elected" placeholder="Year first elected" required>
          <input class="input" name="personal_background" placeholder="Personal background" required>
          <select class="input" name="financial_background_level" required>
            <option value="">Financial background</option>
            <option value="1">1 – Poverty</option>
            <option value="2">2 – Financially Strained</option>
            <option value="3">3 – Lower Working Class</option>
            <option value="4">4 – Skilled Working / Lower Middle</option>
            <option value="5">5 – Solid Middle Class</option>
            <option value="6">6 – Upper Middle Class</option>
            <option value="7">7 – Affluent Professional</option>
            <option value="8">8 – High Net Worth Individual</option>
            <option value="9">9 – Top 5%</option>
            <option value="10">10 – Top 1%</option>
          </select>

          <fieldset style="grid-column:1/-1;border:1px solid var(--border,#ccc);padding:8px;border-radius:4px;">
            <legend><b>Primary Home</b></legend>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;">
              <select class="input" name="home_type">
                <option value="">Select home type (optional)</option>
                ${HOME_TYPES.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("")}
              </select>
              <input class="input" name="home_region" placeholder="Region / location (optional)">
              <label class="label" style="display:flex;gap:6px;align-items:center;margin:0;">
                <input type="checkbox" name="home_mortgaged"> <span>Mortgaged</span>
              </label>
              <input class="input" name="home_notes" placeholder="Notes (optional)">
            </div>
          </fieldset>

          <fieldset style="grid-column:1/-1;border:1px solid var(--border,#ccc);padding:8px;border-radius:4px;">
            <legend><b>Rental Properties (0–5)</b></legend>
            <div id="rentals-list" style="display:grid;gap:8px;"></div>
            <button type="button" class="btn" id="add-rental-btn" style="margin-top:8px;">+ Add Rental</button>
          </fieldset>

          <button class="btn" type="submit" style="grid-column:1/-1;">Submit Character for Approval</button>
        </form>
      </details>

      <details class="tile">
        <summary><b>Absence & Delegation</b></summary>
        ${char?.partyLeader ? `
          <p class="muted" style="margin-top:10px;">As Party Leader, you may select a delegate from your own party to receive weighted votes while absent.</p>
          <form id="absence-form" style="margin-top:8px;display:grid;grid-template-columns:minmax(220px,1fr) auto auto;gap:8px;align-items:end;">
            <div>
              <label class="label" for="delegated-to">Delegate weighted voting to (same party)</label>
              <select id="delegated-to" class="input" name="delegatedTo" required>
                <option value="">Select character</option>
                ${delegationChoices.map((name) => `<option value="${esc(name)}" ${name === (char?.delegatedTo || "") ? "selected" : ""}>${esc(name)}</option>`).join("")}
              </select>
            </div>
            <button class="btn" type="submit">Set Absent + Delegate</button>
            <button class="btn" type="button" id="absence-clear">Return Active</button>
          </form>
        ` : `
          <p class="muted" style="margin-top:10px;">When absent, your weighted votes are automatically delegated to your Party Leader.</p>
          <form id="absence-form" style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
            <input type="hidden" name="delegatedTo" value="${esc(leaderForParty(data, char?.party) || "")}">
            <button class="btn" type="submit" ${!leaderForParty(data, char?.party) ? "disabled title='No Party Leader found'" : ""}>Set Absent (delegate to Party Leader)</button>
            <button class="btn" type="button" id="absence-clear">Return Active</button>
          </form>
          ${!leaderForParty(data, char?.party) ? `<p class="muted" style="margin-top:6px;color:var(--danger);">No Party Leader is currently set for your party — absence cannot be delegated.</p>` : ""}
        `}
      </details>

      ${(manager && dbPendingApps.length) ? `
        <h3 style="margin:10px 0 6px;">Pending Character Approvals</h3>
        ${dbPendingApps.map((p) => `
          <article class="tile" style="margin-bottom:8px;">
            <b>${esc(p.name)}</b> (${esc(p.party)}) · Financial level ${esc(String(p.financial_background_level || "-"))}
            <div class="muted">Submitted by ${esc(p.applicant_username || "User")} at ${esc(p.submitted_at ? new Date(p.submitted_at).toLocaleString("en-GB") : "")}</div>
            <div class="muted">Constituency: ${esc(p.constituency || "-")}</div>
            <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn" type="button" data-action="approve-character" data-id="${esc(p.id)}">Approve + Activate</button>
              <button class="btn" type="button" data-action="reject-character" data-id="${esc(p.id)}">Reject</button>
            </div>
          </article>
        `).join("")}
      ` : ""}
    </section>

    ${manager ? `
    <section id="speaker-controls" class="panel">
      <h2 style="margin-top:0;">
        Control Panels
        ${controlPanelBadgesHTML(admin, data)}
      </h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px;margin-bottom:10px;">
        ${CONTROL_LINKS.map((c) => {
          const allowed = admin || (manager && c.roles.some((r) => {
            if (r === "admin") return admin;
            if (r === "mod") return isMod(data);
            if (r === "speaker") return isSpeaker(data);
            if (r === "pm") return String(char?.office || "") === "prime-minister";
            if (r === "leader-commons") return String(char?.office || "") === "leader-commons";
            return false;
          }));
          return `<a class="tile" style="text-decoration:none;${allowed ? "" : "opacity:.5;pointer-events:none;"}" href="${esc(c.href)}"><b>${esc(c.title)}</b><div class="muted">${allowed ? "Access granted" : "Restricted"}</div></a>`;
        }).join("")}
      </div>

      ${(manager) ? `
        <details class="tile" style="margin-bottom:10px;">
          <summary><b>Speaker Controls <span class="speaker-badge">Speaker / Mod / Admin</span></b></summary>
          <form id="speaker-form" style="margin-top:10px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;">
            <label class="label"><input type="checkbox" name="isPaused" ${data.gameState.isPaused ? "checked" : ""} ${!admin ? "disabled" : ""}> Pause game clock (Admin only — unpause on Sunday only)</label>
            <label class="label"><input type="checkbox" name="sundayFreeze" ${data.userManagement.globalControls.sundayFreeze ? "checked" : ""}> Sunday freeze</label>
            <input class="input" type="number" min="1" max="12" name="startSimMonth" value="${esc(String(data.gameState.startSimMonth || 1))}" placeholder="Sim month">
            <input class="input" type="number" name="startSimYear" value="${esc(String(data.gameState.startSimYear || 1997))}" placeholder="Sim year">
            <input class="input" name="lastGeneralElection" value="${esc(String(data.parliament.lastGeneralElection || ""))}" placeholder="Last general election date">
            <select class="input" name="governmentSetup">
              ${["Majority","Minority","Coalition"].map((g) => `<option value="${g}" ${data.parliament.governmentSetup===g?"selected":""}>${g}</option>`).join("")}
            </select>
            <textarea class="input" rows="5" name="speakerConfigJson">${esc(data.userManagement.globalControls.speakerConfigJson || "")}</textarea>
            <button class="btn" type="submit">Save Speaker Controls</button>
            <button class="btn" type="button" id="force-sunday-roll">Force Sunday Roll</button>
          </form>
        </details>

        <details class="tile" style="margin-bottom:10px;" open>
          <summary><b>Active Player Roster <span class="mod-badge">Mod / Admin</span></b></summary>
          <div class="muted" style="margin-top:10px;">Control moved here from Government/Opposition pages. Mods can only set characters inactive.</div>
          <div style="margin-top:10px;display:grid;gap:8px;">
            ${(Array.isArray(data.players) ? data.players : []).slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))).map((p) => `
              <article class="tile" style="display:grid;grid-template-columns:minmax(180px,2fr) minmax(180px,2fr) auto;gap:8px;align-items:center;">
                <div><b>${esc(String(p.name || "Unknown"))}</b><div class="muted">${esc(String(p.party || "No party"))}</div></div>
                <div class="muted">${p.active === false ? "Inactive" : "Active"}</div>
                ${p.active === false ? `<span class="muted">Inactive (user can re-activate)</span>` : `<button class="btn danger" type="button" data-action="set-inactive-player" data-name="${esc(String(p.name || ""))}">Set Inactive</button>`}
              </article>
            `).join("") || `<div class="muted-block">No players configured.</div>`}
          </div>
        </details>
      ` : ""}

      ${(admin) ? `
        <details class="tile" style="margin-bottom:10px;" open>
          <summary><b>Simulation Control <span class="admin-badge">Admin only</span></b></summary>
          <div style="margin-top:10px;display:grid;gap:8px;">
            <div class="muted">Simulation must be started by an admin on Sunday. The sim clock advances from Monday onward.</div>
            <div class="kv"><span>Simulation status</span><b>${data.gameState.started ? "Running" : "Not started"}</b></div>
            <div class="kv"><span>Clock anchor (real date)</span><b>${esc(String(data.gameState.startRealDate || "Not set"))}</b></div>
            <button class="btn" type="button" id="start-simulation" ${data.gameState.started || !isSundayToday() ? "disabled" : ""}>Start Simulation (Sunday Only)</button>
            ${!data.gameState.started && !isSundayToday() ? `<div class="muted">Start unlocks on Sunday. Next Sunday anchor: <b>${esc(nextSundayIso().slice(0, 10))}</b>.</div>` : ""}
            <form id="monarch-form" style="display:grid;grid-template-columns:minmax(220px,1fr) auto;gap:8px;align-items:end;">
              <div>
                <label class="label" for="monarchGender">Monarch</label>
                <select id="monarchGender" class="input" name="monarchGender">
                  <option value="Queen" ${data.adminSettings.monarchGender === "Queen" ? "selected" : ""}>Queen</option>
                  <option value="King" ${data.adminSettings.monarchGender === "King" ? "selected" : ""}>King</option>
                </select>
              </div>
              <button class="btn" type="submit">Save Monarch</button>
            </form>
            <form id="libdem-toggle-form" style="display:grid;grid-template-columns:minmax(220px,1fr) auto;gap:8px;align-items:end;">
              <div>
                <label class="label" for="libDemClosed">Liberal Democrat — Open to New Characters</label>
                <select id="libDemClosed" class="input" name="libDemClosed">
                  <option value="open" ${!data.adminSettings.libDemClosedToNewChars ? "selected" : ""}>Open (new characters can join)</option>
                  <option value="closed" ${data.adminSettings.libDemClosedToNewChars ? "selected" : ""}>Closed (no new characters)</option>
                </select>
              </div>
              <button class="btn" type="submit">Save</button>
            </form>
          </div>
        </details>

      ` : ""}
    </section>
    ` : ""}

    ${state.message ? `<p class="muted" style="margin-top:8px;">${esc(state.message)}</p>` : ""}
  `;

  // Rental builder
  const rentalsList = host.querySelector("#rentals-list");
  const RENTAL_TYPES = ["Detached house", "Semi-detached house", "Terraced house", "Flat/apartment", "Commercial", "Other"];
  let rentalCount = 0;
  function addRentalRow() {
    if (rentalCount >= 5) return;
    rentalCount++;
    const idx = rentalCount;
    const div = document.createElement("div");
    div.dataset.rentalRow = idx;
    div.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;padding:6px 0;border-top:1px solid var(--border,#eee);";
    div.innerHTML = `
      <div style="grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;">
        <b>Rental #${idx}</b>
        <button type="button" class="btn danger" data-remove-rental="${idx}" style="padding:4px 10px;font-size:12px;">Remove</button>
      </div>
      <select class="input" name="rental_${idx}_type"><option value="">Type</option>${RENTAL_TYPES.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("")}</select>
      <input class="input" name="rental_${idx}_location" placeholder="Location">
      <select class="input" name="rental_${idx}_status"><option value="">Status</option>${RENTAL_STATUSES.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("")}</select>
      <input class="input" name="rental_${idx}_notes" placeholder="Notes (optional)">
    `;
    div.querySelector(`[data-remove-rental="${idx}"]`)?.addEventListener("click", () => {
      div.remove();
      rentalCount = Math.max(0, rentalCount - 1);
      const addBtn = host.querySelector("#add-rental-btn");
      if (addBtn) addBtn.disabled = false;
    });
    rentalsList?.appendChild(div);
    if (rentalCount >= 5) host.querySelector("#add-rental-btn").disabled = true;
  }
  host.querySelector("#add-rental-btn")?.addEventListener("click", addRentalRow);

  // Party → constituency filtering
  const partySelect = host.querySelector("#char-party-select");
  const constSelect = host.querySelector("#char-constituency-select");
  if (partySelect && constSelect) {
    partySelect.addEventListener("change", () => {
      const party = partySelect.value;
      if (!party) {
        constSelect.innerHTML = `<option value="">Select party first</option>`;
        return;
      }
      const opts = openConstituencyOptionsForParty(data, party);
      constSelect.innerHTML = opts.length
        ? opts.map((c) => `<option value="${esc(c.name)}">${esc(c.name)} (${esc(c.region)}, ${esc(c.nation)})</option>`).join("")
        : `<option value="">No open constituencies for ${esc(party)}</option>`;
    });
  }

  host.querySelector("#create-character-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // Build rentals array from dynamic rows
    const rentals = [];
    for (let i = 1; i <= rentalCount; i++) {
      const type = String(fd.get(`rental_${i}_type`) || "").trim();
      if (type) {
        rentals.push({
          type,
          location: String(fd.get(`rental_${i}_location`) || "").trim(),
          status: String(fd.get(`rental_${i}_status`) || "").trim(),
          notes: String(fd.get(`rental_${i}_notes`) || "").trim()
        });
      }
    }
    const home = {
      type: String(fd.get("home_type") || "").trim(),
      region: String(fd.get("home_region") || "").trim(),
      mortgaged: fd.get("home_mortgaged") === "on",
      notes: String(fd.get("home_notes") || "").trim()
    };
    const fields = {
      name: String(fd.get("name") || "").trim(),
      party: String(fd.get("party") || "").trim(),
      constituency: String(fd.get("constituency") || "").trim(),
      date_of_birth: String(fd.get("date_of_birth") || "").trim(),
      education: String(fd.get("education") || "").trim(),
      career_background: String(fd.get("career_background") || "").trim(),
      family: String(fd.get("family") || "").trim(),
      year_first_elected: String(fd.get("year_first_elected") || "").trim(),
      personal_background: String(fd.get("personal_background") || "").trim(),
      financial_background_level: Number(fd.get("financial_background_level") || 1),
      avatar: String(fd.get("avatar") || "").trim(),
      twitter_handle: String(fd.get("twitter_handle") || "").trim(),
      home,
      rentals
    };
    try {
      await apiApplyCharacter(fields);
      const { applications } = await apiGetMyApplications();
      state.dbState = { ...state.dbState, myApplications: applications };
      state.message = "Character submitted for moderator approval.";
    } catch (err) {
      state.message = String(err.message || "Submission failed.");
    }
    render(data, state);
  });

  host.querySelector("#absence-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!data.currentCharacter) return;
    const fd = new FormData(e.currentTarget);
    const delegatedTo = String(fd.get("delegatedTo") || "").trim();
    const isLeader = !!data.currentCharacter.partyLeader;

    if (isLeader) {
      // Party leader must pick a valid delegate from same party
      const allowed = delegationChoicesForParty(data, data.currentCharacter?.party, data.currentCharacter?.name);
      if (!delegatedTo || !allowed.includes(delegatedTo)) {
        state.message = "Please select a valid delegate from your own party.";
        render(data, state);
        return;
      }
    } else {
      // Normal character: auto-delegate to party leader
      const leader = leaderForParty(data, data.currentCharacter?.party);
      if (!leader) {
        state.message = "Cannot set absent: no Party Leader found for your party.";
        render(data, state);
        return;
      }
    }

    data.currentCharacter.absent = true;
    data.currentCharacter.delegatedTo = delegatedTo || leaderForParty(data, data.currentCharacter?.party);
    saveState(data);
    state.message = "Absence saved. Your votes are delegated.";
    render(data, state);
  });

  host.querySelector("#absence-clear")?.addEventListener("click", () => {
    if (!data.currentCharacter) return;
    setAbsenceState(data, { absent: false, delegatedTo: null });
    state.message = "Character marked active.";
    render(data, state);
  });

  host.querySelectorAll('[data-action="approve-character"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!manager) return;
      const id = String(btn.dataset.id || "").trim();
      if (!id) return;
      try {
        await apiApproveCharacterApplication(id);
        const [{ applications: pending }, { applications: mine }] = await Promise.all([
          apiGetCharacterApplications("pending"),
          apiGetMyApplications()
        ]);
        const { characters: myChars } = await apiGetMyCharacters();
        state.dbState = { myApplications: mine, pendingApplications: pending, myCharacters: myChars };
        state.message = "Application approved and character created.";
      } catch (err) {
        state.message = String(err.message || "Approval failed.");
      }
      render(data, state);
    });
  });

  host.querySelectorAll('[data-action="reject-character"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!manager) return;
      const id = String(btn.dataset.id || "").trim();
      if (!id) return;
      try {
        await apiRejectCharacterApplication(id);
        const { applications: pending } = await apiGetCharacterApplications("pending");
        state.dbState = { ...state.dbState, pendingApplications: pending };
        state.message = "Rejected pending character.";
      } catch (err) {
        state.message = String(err.message || "Rejection failed.");
      }
      render(data, state);
    });
  });

  host.querySelectorAll('[data-action="set-inactive-player"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!manager) return;
      const name = String(btn.dataset.name || "").trim();
      if (!name) return;
      const changed = setCharacterInactiveEverywhere(data, name);
      if (!changed) return;
      saveState(data);
      state.message = `${name} marked inactive.`;
      render(data, state);
    });
  });

  host.querySelectorAll('[data-action="reactivate-character"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = String(btn.dataset.id || "").trim();
      const name = String(btn.dataset.name || "").trim();
      if (!id) return;
      if (hasActiveOwned) {
        state.message = "You already have an active character. Set that character inactive before re-activating another.";
        render(data, state);
        return;
      }
      try {
        const { character } = await apiSelectCharacter(id);
        const { characters: myChars } = await apiGetMyCharacters();
        state.dbState = { ...state.dbState, myCharacters: myChars };
        state.message = `${character?.name || name} re-activated.`;
      } catch (err) {
        state.message = String(err.message || "Re-activation failed.");
      }
      render(data, state);
    });
  });

  host.querySelector("#speaker-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!manager) return;
    const fd = new FormData(e.currentTarget);

    // Pause/unpause: admin-only with Sunday-only unpause
    const wantPaused = fd.get("isPaused") === "on";
    const wasPaused = !!data.gameState.isPaused;

    if (wantPaused !== wasPaused) {
      if (!admin) {
        state.message = "Only an Admin can pause or unpause the simulation.";
        render(data, state);
        return;
      }
      if (wantPaused && !wasPaused) {
        // Pausing: record the real date so sim time freezes here
        data.gameState.isPaused = true;
        data.gameState.pausedAtRealDate = new Date().toISOString();
      } else if (!wantPaused && wasPaused) {
        // Unpausing: only allowed on Sunday
        if (!isSundayToday()) {
          state.message = "Cannot unpause: the simulation may only be unpaused on a Sunday.";
          render(data, state);
          return;
        }
        // Shift startRealDate forward by the pause duration so sim time resumes correctly
        const pausedAt = new Date(data.gameState.pausedAtRealDate || new Date().toISOString());
        const now = new Date();
        const pauseDurationMs = now.getTime() - pausedAt.getTime();
        const oldStart = new Date(data.gameState.startRealDate);
        data.gameState.startRealDate = new Date(oldStart.getTime() + pauseDurationMs).toISOString();
        data.gameState.isPaused = false;
        data.gameState.pausedAtRealDate = "";
      }
    }

    data.userManagement.globalControls.sundayFreeze = fd.get("sundayFreeze") === "on";
    data.gameState.startSimMonth = Number(fd.get("startSimMonth") || 1);
    data.gameState.startSimYear = Number(fd.get("startSimYear") || 1997);
    data.parliament.lastGeneralElection = String(fd.get("lastGeneralElection") || "").trim();
    data.parliament.governmentSetup = String(fd.get("governmentSetup") || "Majority");
    updateParliamentState(data, {
      lastGeneralElection: data.parliament.lastGeneralElection,
      governmentSetup: data.parliament.governmentSetup
    });
    data.userManagement.globalControls.speakerConfigJson = String(fd.get("speakerConfigJson") || "{}");
    saveState(data);
    state.message = "Speaker controls updated.";
    render(data, state);
  });

  host.querySelector("#force-sunday-roll")?.addEventListener("click", () => {
    if (!manager) return;
    runSundayRoll(data);
    state.message = "Sunday roll forced.";
    render(data, state);
  });

  host.querySelector("#start-simulation")?.addEventListener("click", () => {
    if (!admin || data.gameState.started || !isSundayToday()) return;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    data.gameState.started = true;
    data.gameState.startRealDate = now.toISOString();
    data.gameState.isPaused = false;
    saveState(data);
    state.message = `Simulation started on ${now.toLocaleDateString("en-GB")}. Clock advances from Monday.`;
    render(data, state);
  });

  host.querySelector("#monarch-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!admin) return;
    const gender = String(new FormData(e.currentTarget).get("monarchGender") || "Queen");
    data.adminSettings ??= {};
    data.adminSettings.monarchGender = gender === "King" ? "King" : "Queen";
    saveState(data);
    state.message = `Monarch updated to ${data.adminSettings.monarchGender}.`;
    render(data, state);
  });

  host.querySelector("#libdem-toggle-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!admin) return;
    const closed = String(new FormData(e.currentTarget).get("libDemClosed") || "open") === "closed";
    data.adminSettings ??= {};
    data.adminSettings.libDemClosedToNewChars = closed;
    saveState(data);
    state.message = `Liberal Democrat is now ${closed ? "closed" : "open"} to new characters.`;
    render(data, state);
  });
}

export async function initUserPage(data) {
  normaliseUserData(data);
  saveState(data);

  // Load DB-backed character and application data
  let myCharacters = [];
  let myApplications = [];
  let pendingApplications = [];
  try {
    [{ characters: myCharacters }, { applications: myApplications }] = await Promise.all([
      apiGetMyCharacters().catch(() => ({ characters: [] })),
      apiGetMyApplications().catch(() => ({ applications: [] }))
    ]);
    // Admin/mod also load all pending applications
    if (canAdminOrMod(data)) {
      const result = await apiGetCharacterApplications("pending").catch(() => ({ applications: [] }));
      pendingApplications = result.applications;
    }
  } catch (e) {
    console.warn("[initUserPage] DB load failed:", e.message);
  }

  const dbState = { myCharacters, myApplications, pendingApplications };
  render(data, { message: "", dbState });
}
