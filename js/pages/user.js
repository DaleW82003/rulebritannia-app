import { apiUpdateMyAbsent } from "../api.js";
import { isLoggedIn } from "../core.js";

import { setAbsenceState, getCharacterContext } from "../engines/core-engine.js";
import { esc } from "../ui.js";
import { isAdmin, isMod, isSpeaker, canAdminOrMod, canAdminModOrSpeaker } from "../permissions.js";
import {
  apiApplyCharacter, apiGetMyApplications, apiGetMyCharacters,
  apiGetCharacterApplications, apiApproveCharacterApplication,
  apiRejectCharacterApplication, apiSelectCharacter,
  apiGetConstituencies, apiGetCharacters,
  apiGetEnums,
} from "../api.js";

function canManage(data) {
  return canAdminModOrSpeaker(data);
}

function canAdmin(data) {
  return isAdmin(data);
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
      activeCharacter: String(getCharacterContext(data)?.name || ""),
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

function currentAccount(data, usernameOverride) {
  const u = String(usernameOverride || data?.currentUser?.username || "").trim();
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
  const char = getCharacterContext(data);
  const manager = canManage(data);
  const admin = canAdmin(data);

  // When ?account= param is set (e.g. from A Team page) and the viewer is admin/mod,
  // show that user's account data in the Account Data section.
  const viewingUsername = state.viewingUsername || "";
  const selfUsername = String(data?.currentUser?.username || "").trim();
  const isViewingOther = viewingUsername && viewingUsername !== selfUsername;
  const account = currentAccount(data, isViewingOther ? viewingUsername : "") || {
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

  // Derive active character name from DB when state snapshot hasn't been updated yet.
  // This covers the window after a mod approves an application before the auto-select
  // in initUserPage has propagated (e.g. cached render, or viewing own page via state).
  const dbActiveChar = !isViewingOther ? dbChars.find((c) => c.is_active) : null;
  const displayActiveChar = account.activeCharacter || dbActiveChar?.name || "None";

  // Use server-provided enums (single source of truth) when available, fall back to built-in arrays.
  const enums = state.enums ?? {};
  const HOME_TYPES = enums.homeTypes ?? [
    "Studio Flat", "One-Bed Flat", "Two-Bed Flat", "Terraced House", "End-Terrace",
    "Semi-Detached House", "Detached Suburban House", "Townhouse",
    "Country House", "Country Estate", "Mansion"
  ];
  const RENTAL_TYPES = enums.rentalTypes ?? [
    "Single Room Let", "Studio Flat", "One/Two-Bed Flat", "Terraced House",
    "Semi-Detached House", "Detached House",
    "High Street Retail Unit", "Office Unit", "Warehouse", "Holiday Let"
  ];
  const EDUCATION_OPTIONS = enums.educationOptions ?? [
    "No Qualifications", "GCSEs", "A Levels", "Certificate of HE", "Diploma",
    "Bachelors Degree", "Masters Degree", "Doctorate",
  ];
  const CAREER_OPTIONS = enums.careerOptions ?? [
    "Manual / Skilled Trade", "Public Sector Professional", "Legal Profession",
    "Finance / Banking / Corporate", "Business Owner / Entrepreneur",
    "Political Staffer / Researcher", "Trade Union / Activist",
    "Media / Journalism / Communications", "Academia / Education Leadership",
    "Military / Police / Security",
  ];
  const FAMILY_OPTIONS = enums.familyOptions ?? [
    "Single", "Married, No Children", "Married with Children", "Civil Partnership",
    "Divorced", "Divorced with Children", "Widowed",
    "Long-Term Partner with Children", "Long-Term Partner, No Children",
  ];
  const PROPERTY_VALUES = [
    "Under £100,000", "£100,001 to £200,000", "£200,001 to £300,000",
    "£300,001 to £400,000", "£400,001 to £500,000", "Over £500,000"
  ];
  const RENTAL_STATUSES = enums.rentalStatuses ?? ["Occupied", "Vacant", "Under renovation"];

  host.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">User</div></div>

    ${isViewingOther ? `<section class="panel" style="margin-bottom:12px;background:rgba(11,45,107,.06);border:1px solid var(--line);">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span>👁️ <b>Viewing account:</b> ${esc(account.username)}</span>
        <a class="btn" href="user.html">Back to your page</a>
      </div>
    </section>` : ""}

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Account Data</h2>
      <div class="tile">
        <div class="kv"><span>Username</span><b>${esc(account.username)}</b></div>
        <div class="kv"><span>Role Set</span><b>${esc(roleChips(account))}</b></div>
        <div class="kv"><span>Active Character</span><b>${esc(displayActiveChar)}</b>${!account.activeCharacter && dbActiveChar && canAdminOrMod(data) ? `<span class="muted" style="font-size:.8em;margin-left:6px;">⚠️ DB active (state snapshot pending sync — will resolve on next full page load)</span>` : ""}</div>
        <div class="kv"><span>Active Party</span><b>${esc(isViewingOther ? (account.activeCharacter ? "-" : "-") : (char?.party || "-"))}</b></div>
        <div class="kv"><span>Status</span><b>${account.active ? "Active" : "Inactive"}</b></div>
        ${!isViewingOther && activeRoleBadgeHTML(data) ? `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">${activeRoleBadgeHTML(data)}</div>` : ""}
      </div>
    </section>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Character Data / Create Character</h2>
      <div class="tile" style="margin-bottom:10px;">
        <div><b>${esc(char?.name || "No character selected")}</b></div>
        <div class="muted"><b>DOB:</b> ${esc(char?.dateOfBirth || char?.date_of_birth || "-")}</div>
        <div class="muted"><b>Education:</b> ${esc(char?.education || "-")}</div>
        <div class="muted"><b>Career:</b> ${esc(char?.careerBackground || char?.career_background || "-")}</div>
        <div class="muted"><b>Family:</b> ${esc(char?.family || "-")}</div>
        <div class="muted"><b>Constituency:</b> ${esc(char?.constituency || "-")}</div>
        <div class="muted"><b>Party:</b> ${esc(char?.party || "-")}</div>
        <div class="muted"><b>Twitter:</b> ${esc(char?.twitterHandle || char?.twitter_handle || "-")}</div>
        <div class="muted"><b>First elected:</b> ${esc(String(char?.yearFirstElected || char?.year_first_elected || "-"))}</div>
        <div class="muted"><b>Bio:</b> ${esc((char?.bio || char?.personal_background || "-").slice(0, 100))}${(char?.bio || char?.personal_background || "").length > 100 ? "…" : ""}</div>
        <div class="muted"><b>Financial level:</b> ${esc(String(char?.financialBackgroundLevel || char?.financial_background_level || "-"))}</div>
        <div class="muted"><b>Absence:</b> ${char?.absent ? "Absent" : "Active"}${char?.absent ? ` · Delegated to ${esc(char?.delegatedTo || "None")}` : ""}</div>
        ${char?.avatarAttribution ? `<div class="muted"><b>Avatar:</b> ${esc(char.avatarAttribution)}</div>` : ""}
      </div>

      <div class="tile" style="margin-bottom:10px;">
        <div><b>Roster Eligibility</b></div>
        <div class="muted">Active characters you own: ${esc(String(dbChars.filter((c) => c.is_active).length))} · Pending submissions: ${esc(String(pendingByCurrent.length))}</div>
        ${hasActiveOwned ? `<div class="muted" style="margin-top:6px;">You already have an active character in this live simulation. Mark that character inactive before submitting a new one.</div>` : ""}
        ${inactiveOwned.length ? `<div style="margin-top:8px;display:grid;gap:6px;">${inactiveOwned.map((c) => `<div class="tile" style="display:flex;justify-content:space-between;gap:8px;align-items:center;"><div><b>${esc(c.name)}</b> <span class="muted">(inactive)</span></div><button class="btn" type="button" data-action="reactivate-character" data-id="${esc(c.id)}" data-name="${esc(c.name)}">Re-Activate</button></div>`).join("")}</div>` : ""}
      </div>

      ${(hasActiveOwned || pendingByCurrent.length > 0) ? `
        <div class="tile muted-block" style="margin-bottom:10px;">
          ${hasActiveOwned
            ? `<b>Create Character</b> — You already have an active character (<b>${esc(dbActiveChar?.name || "")}</b>). You cannot apply for a new one while one is active.`
            : `<b>Create Character</b> — Your character application is currently pending moderator review. You cannot submit another until it is resolved.`}
        </div>
      ` : `
      <details class="tile" style="margin-bottom:10px;">
        <summary><b>Create Character (Moderator approval required)</b></summary>
        <form id="create-character-form" style="margin-top:10px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;">
          <input class="input" name="name" placeholder="Name" required>
          <input class="input" type="date" name="date_of_birth" required>
          <select class="input" name="education" required>
            <option value="">Education level</option>
            ${EDUCATION_OPTIONS.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}
          </select>
          <select class="input" name="career_background" required>
            <option value="">Pre-MP Career</option>
            ${CAREER_OPTIONS.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}
          </select>
          <select class="input" name="family" required>
            <option value="">Family Status</option>
            ${FAMILY_OPTIONS.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}
          </select>
          <select class="input" name="party" id="char-party-select" required>
            <option value="">Select party</option>
            <option value="Conservative">Conservative</option>
            <option value="Labour">Labour</option>
            ${!data.adminSettings.libDemClosedToNewChars ? `<option value="Liberal Democrat">Liberal Democrat</option>` : ""}
          </select>
          <select class="input" name="constituency" id="char-constituency-select" required>
            <option value="">Select party first</option>
          </select>
          <input class="input" name="twitter_handle" placeholder="Twitter handle (without @, optional)">
          <div style="display:flex;flex-direction:column;gap:2px;">
            <input class="input" name="avatar" placeholder="Avatar URL (optional)">
            <span class="muted" style="font-size:.8em;margin-top:2px;">Recommended: 512×512 px (min 256×256 px)</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:2px;">
            <input class="input" name="avatar_attribution" placeholder="Who is your avatar? (required, e.g. Alan Rickman)" required>
            <span class="muted" style="font-size:.8em;margin-top:2px;">The real-world person whose likeness is used as your avatar.</span>
          </div>
          <input class="input" name="year_first_elected" placeholder="Year first elected" required>
          <textarea class="input" name="bio" placeholder="Biography (max 2000 characters)" maxlength="2000" required style="grid-column:1/-1;resize:vertical;min-height:80px;"></textarea>
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
              <select class="input" name="home_value">
                <option value="">Estimated value (optional)</option>
                ${PROPERTY_VALUES.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("")}
              </select>
              <input class="input" name="home_region" placeholder="Region / location (optional)">
              <label style="display:flex;gap:8px;align-items:center;padding:10px 12px;border:1px solid var(--line);border-radius:14px;background:#fff;font-weight:400;color:var(--text);cursor:pointer;">
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
      `}

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
            <div class="muted">Bio: ${esc((p.bio || p.personal_background || "-").slice(0, 200))}${(p.bio || p.personal_background || "").length > 200 ? "…" : ""}</div>
            ${p.avatar_attribution ? `<div class="muted">Avatar: ${esc(p.avatar_attribution)}</div>` : ""}
            <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn" type="button" data-action="approve-character" data-id="${esc(p.id)}">Approve + Activate</button>
              <button class="btn" type="button" data-action="reject-character" data-id="${esc(p.id)}">Reject</button>
            </div>
          </article>
        `).join("")}
      ` : ""}

    </section>

    ${state.message ? `<p class="muted" style="margin-top:8px;">${esc(state.message)}</p>` : ""}
  `;

  // Rental builder
  const rentalsList = host.querySelector("#rentals-list");
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
      <select class="input" name="rental_${idx}_value"><option value="">Estimated value (optional)</option>${PROPERTY_VALUES.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("")}</select>
      <input class="input" name="rental_${idx}_location" placeholder="Location">
      <select class="input" name="rental_${idx}_status"><option value="">Status</option>${RENTAL_STATUSES.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("")}</select>
      <input class="input" name="rental_${idx}_notes" placeholder="Notes (optional)">
      <label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" name="rental_${idx}_mortgaged"> <span>Mortgaged</span></label>
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
    const avatar_attribution = String(fd.get("avatar_attribution") || "").trim();
    if (!avatar_attribution) {
      state.message = "Please fill in \"Who is your avatar?\" before submitting.";
      render(data, state);
      return;
    }
    // Build rentals array from dynamic rows
    const rentals = [];
    for (let i = 1; i <= rentalCount; i++) {
      const type = String(fd.get(`rental_${i}_type`) || "").trim();
      if (type) {
        rentals.push({
          type,
          value: String(fd.get(`rental_${i}_value`) || "").trim(),
          location: String(fd.get(`rental_${i}_location`) || "").trim(),
          status: String(fd.get(`rental_${i}_status`) || "").trim(),
          notes: String(fd.get(`rental_${i}_notes`) || "").trim(),
          mortgaged: fd.get(`rental_${i}_mortgaged`) === "on"
        });
      }
    }
    const home = {
      type: String(fd.get("home_type") || "").trim(),
      value: String(fd.get("home_value") || "").trim(),
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
      bio: String(fd.get("bio") || "").trim().slice(0, 2000),
      financial_background_level: Number(fd.get("financial_background_level") || 1),
      avatar: String(fd.get("avatar") || "").trim(),
      avatar_attribution,
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

  host.querySelector("#absence-form")?.addEventListener("submit", async (e) => {
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

    const absentDelegateTo = delegatedTo || leaderForParty(data, data.currentCharacter?.party);
    data.currentCharacter.absent = true;
    data.currentCharacter.delegatedTo = absentDelegateTo;
    try {
      await apiUpdateMyAbsent(true, absentDelegateTo);
      state.message = "Absence saved. Your votes are delegated.";
    } catch (err) {
      data.currentCharacter.absent = false;
      data.currentCharacter.delegatedTo = null;
      state.message = "Failed to save absence. Please try again.";
      console.error("[user] absent failed:", err);
    }
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
        if (character) {
          data.currentCharacter = character;
          const selfUsername = String(data?.currentUser?.username || "").trim();
          const myAccount = (data.userManagement?.accounts || []).find((a) => a.username === selfUsername);
          if (myAccount) myAccount.activeCharacter = character.name;
        }
        const { characters: myChars } = await apiGetMyCharacters();
        state.dbState = { ...state.dbState, myCharacters: myChars };
        state.message = `${character?.name || name} re-activated.`;
      } catch (err) {
        state.message = String(err.message || "Re-activation failed.");
      }
      render(data, state);
    });
  });
}

export async function initUserPage(data) {
  normaliseUserData(data);
  // Read ?account= URL param — used when navigating from A Team "view user" links.
  let viewingUsername = "";
  try {
    const urlParam = new URL(window.location.href).searchParams.get("account") || "";
    const selfUsername = String(data?.currentUser?.username || "").trim();
    if (urlParam && urlParam !== selfUsername && canAdminModOrSpeaker(data)) {
      viewingUsername = urlParam;
    }
  } catch { /* non-browser or URL parse error — ignore */ }

  if (!isLoggedIn()) {
    const state = { message: "", dbState: { myCharacters: [], myApplications: [], pendingApplications: [] }, viewingUsername, enums: null };
    render(data, state);
    return;
  }

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

  // Load constituencies and active characters from DB so character creation
  // only shows genuinely available (unoccupied) constituencies.
  try {
    const [constResult, charResult] = await Promise.all([
      apiGetConstituencies().catch(() => ({ constituencies: [] })),
      apiGetCharacters({ active: "true" }).catch(() => ({ characters: [] })),
    ]);
    if (constResult.constituencies?.length) {
      data.constituencies = constResult.constituencies;
    }
    if (charResult.characters?.length) {
      const existingIds = new Set((data.players || []).map((p) => p.id));
      const dbPlayers = charResult.characters
        .filter((c) => c.constituency)
        .map((c) => ({ id: c.id, name: c.name, party: c.party, constituency: c.constituency }));
      data.players = [
        ...(data.players || []),
        ...dbPlayers.filter((p) => !existingIds.has(p.id)),
      ];
    }
  } catch (e) {
    console.warn("[initUserPage] Constituency load failed:", e.message);
  }

  // Auto-select the DB-active character into the user's session and state when they
  // diverge. This handles the post-approval flow: a mod/admin approves a character
  // application, which creates the character in DB (is_active=TRUE, user_id set) but
  // cannot update the applicant's session. On the applicant's next page load, we
  // detect the mismatch and call /api/characters/select so session + state stay in sync.
  // Only runs for the current user's own page (not when an admin views another user).
  if (!viewingUsername) {
    const activeDbChar = myCharacters.find((c) => c.is_active);
    if (activeDbChar) {
      const currentName = String(data.currentCharacter?.name || "").trim();
      if (!currentName || currentName !== String(activeDbChar.name || "").trim()) {
        try {
          const { character } = await apiSelectCharacter(activeDbChar.id);
          if (character) {
            data.currentCharacter = character;
            const selfUsername = String(data?.currentUser?.username || "").trim();
            const myAccount = (data.userManagement?.accounts || []).find((a) => a.username === selfUsername);
            if (myAccount) myAccount.activeCharacter = character.name;
          }
        } catch (e) {
          // Non-critical: character will still be visible in the DB list below.
          console.warn("[initUserPage] Auto-select active character failed:", e.message);
        }
      }
    }
  }

  const dbState = { myCharacters, myApplications, pendingApplications };
  // Initial render (uses built-in fallback enum arrays)
  const state = { message: "", dbState, viewingUsername, enums: null };
  render(data, state);

  // Load server enums non-blocking; re-render once loaded to update all dropdowns.
  apiGetEnums().then((enums) => {
    state.enums = enums;
    render(data, state);
  }).catch(() => { /* fall back to built-in arrays */ });
}
