import { apiUpdateMyAbsent } from "../api.js";
import { isLoggedIn } from "../core.js";

import { setAbsenceState, getCharacterContext } from "../engines/core-engine.js";
import { esc } from "../ui.js";
import { isAdmin, isMod, isSpeaker, canAdminOrMod, canAdminModOrSpeaker } from "../permissions.js";
import {
  apiApplyNpcCharacter, apiGetMyApplications, apiGetMyCharacters,
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

/**
 * Return all constituencies for a party, sorted available-first then taken,
 * each annotated with a `taken` flag so callers can render them disabled.
 */
function allConstituenciesForPartyWithStatus(data, partyName) {
  const pending = new Set((data.userManagement?.pendingCharacters || []).map((p) => String(p.constituency || "").toLowerCase()));
  const all = (data.constituencies || [])
    .filter((c) => !partyName || String(c.party || "") === partyName)
    .map((c) => ({
      ...c,
      taken: seatTaken(data, c.name) || pending.has(String(c.name || "").toLowerCase()),
    }))
    .sort((a, b) => {
      if (a.taken !== b.taken) return a.taken ? 1 : -1; // available first
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  return all;
}

/** Render <option> elements for a constituency dropdown, greying out taken seats. */
function renderConstituencyOptions(constituencies, fallbackMsg) {
  if (!constituencies.length) return `<option value="">${fallbackMsg}</option>`;
  return `<option value="">Select constituency</option>` + constituencies.map((c) =>
    c.taken
      ? `<option value="${esc(c.name)}" disabled style="color:#aaa;">${esc(c.name)} (${esc(c.region)}, ${esc(c.nation)}) — Taken</option>`
      : `<option value="${esc(c.name)}">${esc(c.name)} (${esc(c.region)}, ${esc(c.nation)})</option>`
  ).join("");
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

  const pendingNpcByCurrent = dbMyApps.filter((a) => a.status === "pending" && a.application_type === "npc");
  const delegationChoices = delegationChoicesForParty(data, char?.party, char?.name);

  // Derive active character name from DB when state snapshot hasn't been updated yet.
  // This covers the window after a mod approves an application before the auto-select
  // in initUserPage has propagated (e.g. cached render, or viewing own page via state).
  const dbActiveChar = !isViewingOther ? dbChars.find((c) => c.is_active) : null;
  const displayActiveChar = account.activeCharacter || dbActiveChar?.name || "None";

  // Active character party for NPC form party-lock (non-admin/mod users)
  const activeCharParty = char?.party || dbActiveChar?.party || "";
  const isAdminOrMod = canAdminOrMod(data);
  // Party leaders (PM, LoTO, third-party leader) are also eligible to request NPCs
  const isPartyLeader = !!char?.partyLeader;
  const canRequestNpc = isAdminOrMod || isPartyLeader;

  // Use server-provided enums (single source of truth) when available, fall back to built-in arrays.
  const enums = state.enums ?? {};
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
      <h2 style="margin-top:0;">Character Data</h2>
      <div class="tile" style="margin-bottom:10px;">
        <div><b>${esc(char?.display_name || char?.name || "No character selected")}</b></div>
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
            ${p.application_type === "npc" ? `<span style="display:inline-block;background:var(--accent,#0b2d6b);color:#fff;font-size:.75em;padding:1px 7px;border-radius:10px;margin-right:6px;vertical-align:middle;">NPC</span>` : ""}
            <b>${esc(p.name)}</b> (${esc(p.party)}) · Financial level ${esc(String(p.financial_background_level || "-"))}
            <div class="muted">Submitted by ${esc(p.applicant_username || "User")} at ${esc(p.submitted_at ? new Date(p.submitted_at).toLocaleString("en-GB") : "")}</div>
            <div class="muted">Constituency: ${esc(p.constituency || "-")}</div>
            <div class="muted">Bio: ${esc((p.bio || p.personal_background || "-").slice(0, 200))}${(p.bio || p.personal_background || "").length > 200 ? "…" : ""}</div>
            ${p.avatar_attribution ? `<div class="muted">Avatar: ${esc(p.avatar_attribution)}</div>` : ""}
            ${p.application_type === "npc" && p.requested_by_character_name ? `<div class="muted" style="margin-top:4px;"><b>Requested by character:</b> ${esc(p.requested_by_character_name)}${p.requested_by_party ? ` (${esc(p.requested_by_party)})` : ""}</div>` : ""}
            ${p.application_type === "npc" && p.npc_reason ? `<div class="muted" style="margin-top:4px;"><b>NPC Reason:</b> ${esc(p.npc_reason)}</div>` : ""}
            <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn" type="button" data-action="approve-character" data-id="${esc(p.id)}">${p.application_type === "npc" ? "Approve NPC" : "Approve + Activate"}</button>
              <button class="btn" type="button" data-action="reject-character" data-id="${esc(p.id)}">Reject</button>
            </div>
          </article>
        `).join("")}
      ` : ""}

    </section>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Request NPC Character <span class="muted" style="font-size:.7em;font-weight:400;">(Moderator approval required)</span></h2>
      ${!isLoggedIn() ? `<div class="tile muted-block">You must be logged in to request an NPC character.</div>` : !canRequestNpc ? `
      <div class="tile muted-block">
        <p class="muted" style="margin:0;">NPC character requests are available to <b>administrators</b>, <b>moderators</b>, and <b>party leaders</b> only.</p>
      </div>
      ` : `
      <div class="tile" style="margin-bottom:10px;">
        <p class="muted" style="margin:0 0 6px;">Use this form to request a non-player character (NPC) for in-game purposes. NPCs occupy a parliamentary seat and are managed by you but are not your active player character.</p>
        ${!isAdminOrMod && activeCharParty ? `<p class="muted">Your NPC will be in the <b>${esc(activeCharParty)}</b> party (locked to your active character's party).</p>` : ""}
        ${pendingNpcByCurrent.length > 0 ? `<p class="muted">You already have a pending NPC application. You cannot submit another until it is resolved.</p>` : ""}
      </div>
      ${(pendingNpcByCurrent.length === 0 && (isAdminOrMod || activeCharParty)) ? `
      <details class="tile" style="margin-bottom:10px;">
        <summary><b>Submit NPC Request</b></summary>
        <form id="npc-character-form" style="margin-top:10px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;">
          <input class="input" name="name" placeholder="NPC Name" required>
          <input class="input" type="date" name="date_of_birth">
          <select class="input" name="education">
            <option value="">Education level (optional)</option>
            ${EDUCATION_OPTIONS.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}
          </select>
          <select class="input" name="career_background">
            <option value="">Pre-MP Career (optional)</option>
            ${CAREER_OPTIONS.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}
          </select>
          <select class="input" name="family">
            <option value="">Family Status (optional)</option>
            ${FAMILY_OPTIONS.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}
          </select>
          ${isAdminOrMod ? (() => {
            // Build a sorted, de-duped list of parties that hold at least one constituency.
            // Exclude Sinn Féin (do not take their seats).
            const constParties = [...new Set(
              (data.constituencies || [])
                .map((c) => c.party)
                .filter((p) => p && !/sinn\s*f[eé]in/i.test(p))
            )].sort((a, b) => a.localeCompare(b));
            const opts = constParties.map((p) =>
              `<option value="${esc(p)}">${esc(p)}</option>`
            ).join("");
            return `
          <select class="input" name="party" id="npc-party-select" required>
            <option value="">Select party</option>
            ${opts}
          </select>`;
          })() : `
          <input type="hidden" name="party" value="${esc(activeCharParty)}">
          <div class="input" style="background:#f5f5f5;cursor:not-allowed;color:#888;">Party: ${esc(activeCharParty)} (locked)</div>
          `}
          <select class="input" name="constituency" id="npc-constituency-select" required>
            <option value="">${isAdminOrMod ? "Select party first" : "Loading constituencies…"}</option>
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
          <input class="input" name="year_first_elected" placeholder="Year first elected">
          <textarea class="input" name="bio" placeholder="Biography (max 2000 characters)" maxlength="2000" style="grid-column:1/-1;resize:vertical;min-height:80px;"></textarea>
          <select class="input" name="financial_background_level">
            <option value="">Financial background (optional)</option>
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
          <div style="grid-column:1/-1;display:flex;flex-direction:column;gap:4px;">
            <label class="label"><b>Reason for NPC (required)</b> — explain to moderators why this NPC is needed</label>
            <textarea class="input" name="npc_reason" placeholder="e.g. I need an NPC to serve as a minor government minister for roleplay purposes" maxlength="1000" required style="resize:vertical;min-height:60px;"></textarea>
          </div>
          <button class="btn" type="submit" style="grid-column:1/-1;">Submit NPC Request for Approval</button>
        </form>
      </details>
      ` : ""}
      `}
    </section>

    ${state.message ? `<p class="muted" style="margin-top:8px;">${esc(state.message)}</p>` : ""}
  `;

  // Party → constituency filtering for NPC form
  const npcPartySelect = host.querySelector("#npc-party-select");
  const npcConstSelect = host.querySelector("#npc-constituency-select");
  if (npcPartySelect && npcConstSelect) {
    // admin/mod: filter by selected party
    npcPartySelect.addEventListener("change", () => {
      const party = npcPartySelect.value;
      if (!party) {
        npcConstSelect.innerHTML = `<option value="">Select party first</option>`;
        return;
      }
      const opts = allConstituenciesForPartyWithStatus(data, party);
      npcConstSelect.innerHTML = opts.length
        ? renderConstituencyOptions(opts, `No constituencies for ${party}`)
        : `<option value="">No constituencies for ${esc(party)}</option>`;
    });
  } else if (npcConstSelect && !npcPartySelect) {
    // non-admin/mod: party is locked to active character's party, populate immediately
    const opts = allConstituenciesForPartyWithStatus(data, activeCharParty);
    npcConstSelect.innerHTML = opts.length
      ? renderConstituencyOptions(opts, `No constituencies for ${activeCharParty}`)
      : `<option value="">No constituencies for ${esc(activeCharParty)}</option>`;
  }

  host.querySelector("#npc-character-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const avatar_attribution = String(fd.get("avatar_attribution") || "").trim();
    if (!avatar_attribution) {
      state.message = "Please fill in \"Who is your avatar?\" before submitting.";
      render(data, state);
      return;
    }
    const npc_reason = String(fd.get("npc_reason") || "").trim();
    if (!npc_reason) {
      state.message = "Please fill in the NPC reason before submitting.";
      render(data, state);
      return;
    }
    const fields = {
      name: String(fd.get("name") || "").trim(),
      party: String(fd.get("party") || "").trim(),
      constituency: String(fd.get("constituency") || "").trim(),
      date_of_birth: String(fd.get("date_of_birth") || "").trim() || null,
      education: String(fd.get("education") || "").trim() || null,
      career_background: String(fd.get("career_background") || "").trim() || null,
      family: String(fd.get("family") || "").trim() || null,
      year_first_elected: String(fd.get("year_first_elected") || "").trim() || null,
      bio: String(fd.get("bio") || "").trim().slice(0, 2000) || null,
      financial_background_level: Number(fd.get("financial_background_level") || 5),
      avatar: String(fd.get("avatar") || "").trim(),
      avatar_attribution,
      twitter_handle: String(fd.get("twitter_handle") || "").trim(),
      npc_reason,
    };
    try {
      await apiApplyNpcCharacter(fields);
      const { applications } = await apiGetMyApplications();
      state.dbState = { ...state.dbState, myApplications: applications };
      state.message = "NPC request submitted for moderator approval.";
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
