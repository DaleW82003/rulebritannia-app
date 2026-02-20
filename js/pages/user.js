import { saveData } from "../core.js";
import { runSundayRoll, setAbsenceState } from "../engines/core-engine.js";
import { updateParliamentState } from "../engines/control-panel-engine.js";
import { esc } from "../ui.js";
import { isAdmin, isMod, isSpeaker } from "../permissions.js";

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
  return isAdmin(data) || isMod(data) || isSpeaker(data);
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
    },
    {
      username: "Shade",
      roles: ["player"],
      isAdmin: false,
      isMod: false,
      isSpeaker: false,
      activeCharacter: "John Shade MP",
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

  data.parliament ??= {};
  data.parliament.totalSeats ??= 650;
  data.parliament.lastGeneralElection ??= "May 1997";
  data.parliament.governmentSetup ??= "Majority";

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
  const owned = ownedCharactersForAccount(data, account.username);
  const hasActiveOwned = owned.some((p) => p?.active !== false);
  const inactiveOwned = owned.filter((p) => p?.active === false);
  const pendingByCurrent = (data.userManagement?.pendingCharacters || []).filter((p) => String(p.submittedBy || "") === account.username);
  const delegationChoices = delegationChoicesForParty(data, char?.party, char?.name);

  host.innerHTML = `
    <h1 class="page-title">User</h1>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Account Data</h2>
      <div class="tile">
        <div class="kv"><span>Username</span><b>${esc(account.username)}</b></div>
        <div class="kv"><span>Role Set</span><b>${esc(roleChips(account))}</b></div>
        <div class="kv"><span>Active Character</span><b>${esc(account.activeCharacter || "None")}</b></div>
        <div class="kv"><span>Active Party</span><b>${esc(char?.party || "-")}</b></div>
        <div class="kv"><span>Status</span><b>${account.active ? "Active" : "Inactive"}</b></div>
      </div>
    </section>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Character Data / Create Character</h2>
      <div class="tile" style="margin-bottom:10px;">
        <div><b>${esc(char?.name || "No character selected")}</b></div>
        <div class="muted">DOB: ${esc(char?.dateOfBirth || "-")} · Education: ${esc(char?.education || "-")} · Career: ${esc(char?.careerBackground || "-")}</div>
        <div class="muted">Family: ${esc(char?.family || "-")} · Constituency: ${esc(char?.constituency || "-")} · Party: ${esc(char?.party || "-")} · Twitter: ${esc(char?.twitterHandle || "-")}</div>
        <div class="muted">First elected: ${esc(String(char?.yearFirstElected || "-"))} · Personal background: ${esc(char?.personalBackground || "-")} · Financial level: ${esc(String(char?.financialBackgroundLevel || "-"))}</div>
        <div class="muted">Absence: ${char?.absent ? "Absent" : "Active"}${char?.absent ? ` · Delegated to ${esc(char?.delegatedTo || "None")}` : ""}</div>
      </div>

      <div class="tile" style="margin-bottom:10px;">
        <div><b>Roster Eligibility</b></div>
        <div class="muted">Active characters you own: ${esc(String(owned.filter((p) => p?.active !== false).length))} · Pending submissions: ${esc(String(pendingByCurrent.length))}</div>
        ${hasActiveOwned ? `<div class="muted" style="margin-top:6px;">You already have an active character in this live simulation. Mark that character inactive before submitting a new one.</div>` : ""}
        ${inactiveOwned.length ? `<div style="margin-top:8px;display:grid;gap:6px;">${inactiveOwned.map((p) => `<div class="tile" style="display:flex;justify-content:space-between;gap:8px;align-items:center;"><div><b>${esc(p.name)}</b> <span class="muted">(inactive)</span></div><button class="btn" type="button" data-action="reactivate-character" data-name="${esc(p.name)}">Re-Activate</button></div>`).join("")}</div>` : ""}
      </div>

      <details class="tile" style="margin-bottom:10px;">
        <summary><b>Create Character (Moderator approval required)</b></summary>
        <form id="create-character-form" style="margin-top:10px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;">
          <input class="input" name="name" placeholder="Name" required>
          <input class="input" name="dateOfBirth" placeholder="Date of birth" required>
          <input class="input" name="education" placeholder="Education" required>
          <input class="input" name="careerBackground" placeholder="Career background" required>
          <input class="input" name="family" placeholder="Family" required>
          <select class="input" name="constituency" required>
            ${openConstituencyOptions(data).map((c) => `<option value="${esc(c.name)}">${esc(c.name)} (${esc(c.region)}, ${esc(c.nation)})</option>`).join("") || `<option value="">No open constituencies available</option>`}
          </select>
          <input class="input" name="party" placeholder="Party" required>
          <input class="input" name="avatar" placeholder="Avatar URL (optional)">
          <input class="input" name="twitterHandle" placeholder="Twitter handle (without @, optional)">
          <input class="input" name="yearFirstElected" placeholder="Year first elected" required>
          <input class="input" name="personalBackground" placeholder="Personal background" required>
          <input class="input" name="financialBackgroundLevel" type="number" min="1" max="10" placeholder="Financial background level (1-10)" required>
          <button class="btn" type="submit">Submit Character for Approval</button>
        </form>
      </details>

      <details class="tile">
        <summary><b>Absence & Delegation</b></summary>
        <form id="absence-form" style="margin-top:10px;display:grid;grid-template-columns:minmax(220px,1fr) auto auto;gap:8px;align-items:end;">
          <div>
            <label class="label" for="delegated-to">Delegate weighted voting to (same party)</label>
            <select id="delegated-to" class="input" name="delegatedTo" required>
              <option value="">Select character</option>
              ${delegationChoices.map((name) => `<option value="${esc(name)}" ${name === (char?.delegatedTo || leaderForParty(data, char?.party) || "") ? "selected" : ""}>${esc(name)}</option>`).join("")}
            </select>
          </div>
          <button class="btn" type="submit">Set Absent + Delegate</button>
          <button class="btn" type="button" id="absence-clear">Return Active</button>
        </form>
      </details>

      ${(manager && data.userManagement.pendingCharacters.length) ? `
        <h3 style="margin:10px 0 6px;">Pending Character Approvals</h3>
        ${data.userManagement.pendingCharacters.map((p, idx) => `
          <article class="tile" style="margin-bottom:8px;">
            <b>${esc(p.name)}</b> (${esc(p.party)}) · Financial level ${esc(String(p.financialBackgroundLevel || "-"))}
            <div class="muted">Submitted by ${esc(p.submittedBy || "User")} at ${esc(p.submittedAt || "")}</div>
            <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn" type="button" data-action="approve-character" data-idx="${idx}">Approve + Activate</button>
              <button class="btn" type="button" data-action="reject-character" data-idx="${idx}">Reject</button>
            </div>
          </article>
        `).join("")}
      ` : ""}
    </section>

    <section id="speaker-controls" class="panel">
      <h2 style="margin-top:0;">Control Panels (Admin / Mod / Speaker)</h2>
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
          <summary><b>Speaker Controls</b></summary>
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
            <button class="btn" type="button" id="force-sunday-roll">Force Sunday Roll (Demo)</button>
          </form>
        </details>

        <details class="tile" style="margin-bottom:10px;" open>
          <summary><b>Active Player Roster (Moderator Control)</b></summary>
          <div class="muted" style="margin-top:10px;">Control moved here from Government/Opposition pages. Mods can only set characters inactive.</div>
          <div style="margin-top:10px;display:grid;gap:8px;">
            ${(Array.isArray(data.players) ? data.players : []).slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))).map((p) => `
              <article class="tile" style="display:grid;grid-template-columns:minmax(180px,2fr) minmax(180px,2fr) auto;gap:8px;align-items:center;">
                <div><b>${esc(String(p.name || "Unknown"))}</b><div class="muted">${esc(String(p.party || "No party"))}</div></div>
                <div class="muted">${p.active === false ? "Inactive" : "Active"}</div>
                ${p.active === false ? `<span class="muted">Inactive (user can re-activate)</span>` : `<button class="btn" type="button" data-action="set-inactive-player" data-name="${esc(String(p.name || ""))}">Set Inactive</button>`}
              </article>
            `).join("") || `<div class="muted-block">No players configured.</div>`}
          </div>
        </details>
      ` : ""}

      ${(admin) ? `
        <details class="tile" style="margin-bottom:10px;" open>
          <summary><b>Simulation Control</b></summary>
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
          </div>
        </details>

        <details class="tile" open>
          <summary><b>Admin Role & Permission Assignment</b></summary>
          <div style="margin-top:10px;display:grid;gap:8px;">
            ${data.userManagement.accounts.map((a, idx) => `
              <article class="tile" style="display:grid;grid-template-columns:minmax(120px,1fr) auto auto auto auto;gap:8px;align-items:center;">
                <div><b>${esc(a.username)}</b><div class="muted">Character: ${esc(a.activeCharacter || "None")}</div></div>
                <label><input type="checkbox" data-action="set-admin" data-idx="${idx}" ${a.isAdmin ? "checked" : ""}> Admin</label>
                <label><input type="checkbox" data-action="set-mod" data-idx="${idx}" ${a.isMod ? "checked" : ""}> Mod</label>
                <label><input type="checkbox" data-action="set-speaker" data-idx="${idx}" ${a.isSpeaker ? "checked" : ""}> Speaker</label>
                <button class="btn" type="button" data-action="toggle-active-account" data-idx="${idx}">${a.active ? "Set Inactive" : "Set Active"}</button>
              </article>
            `).join("")}
          </div>
        </details>
      ` : ""}
    </section>

    ${state.message ? `<p class="muted" style="margin-top:8px;">${esc(state.message)}</p>` : ""}
  `;

  host.querySelector("#create-character-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const entry = Object.fromEntries(fd.entries());
    entry.submittedBy = account.username;
    entry.submittedAt = nowStamp();
    const ownsAnyActive = ownedCharactersForAccount(data, account.username).some((p) => p?.active !== false);
    const hasPending = (data.userManagement.pendingCharacters || []).some((p) => String(p.submittedBy || "") === account.username);
    if (ownsAnyActive) {
      state.message = "You already have an active character in this live simulation.";
      render(data, state);
      return;
    }
    if (hasPending) {
      state.message = "You already have a character pending moderator approval.";
      render(data, state);
      return;
    }
    if (!entry.constituency || seatTaken(data, entry.constituency)) {
      state.message = "Selected constituency is no longer available.";
      render(data, state);
      return;
    }
    data.userManagement.pendingCharacters.push(entry);
    saveData(data);
    state.message = "Character submitted for moderator approval.";
    render(data, state);
  });

  host.querySelector("#absence-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!data.currentCharacter) return;
    const fd = new FormData(e.currentTarget);
    const delegatedTo = String(fd.get("delegatedTo") || "").trim();
    const allowed = delegationChoicesForParty(data, data.currentCharacter?.party, data.currentCharacter?.name);
    if (!delegatedTo || !allowed.includes(delegatedTo)) {
      state.message = "Please select a valid delegate from your own party.";
      render(data, state);
      return;
    }
    data.currentCharacter.absent = true;
    data.currentCharacter.delegatedTo = delegatedTo;
    saveData(data);
    state.message = "Absence and delegation saved.";
    render(data, state);
  });

  host.querySelector("#absence-clear")?.addEventListener("click", () => {
    if (!data.currentCharacter) return;
    setAbsenceState(data, { absent: false, delegatedTo: null });
    state.message = "Character marked active.";
    render(data, state);
  });

  host.querySelectorAll('[data-action="approve-character"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!manager) return;
      const idx = Number(btn.dataset.idx || -1);
      const candidate = data.userManagement.pendingCharacters[idx];
      if (!candidate) return;
      if (seatTaken(data, candidate.constituency)) {
        state.message = "Cannot approve: constituency already assigned.";
        render(data, state);
        return;
      }

      const ownerUsername = String(candidate.submittedBy || "").trim();
      if (ownerUsername) {
        for (const p of (data.players || [])) {
          if (String(p.ownerUsername || "").trim() === ownerUsername && p.active !== false) {
            setCharacterInactiveEverywhere(data, p.name);
          }
        }
      }

      const player = {
        name: candidate.name,
        party: candidate.party,
        role: "backbencher",
        office: null,
        joinedAt: new Date().toISOString(),
        lastLogin: new Date().toISOString(),
        absent: false,
        delegatedTo: null,
        isSpeaker: false,
        active: true,
        mature: true,
        dateOfBirth: candidate.dateOfBirth,
        education: candidate.education,
        careerBackground: candidate.careerBackground,
        family: candidate.family,
        constituency: candidate.constituency,
        yearFirstElected: candidate.yearFirstElected,
        personalBackground: candidate.personalBackground,
        financialBackgroundLevel: Number(candidate.financialBackgroundLevel || 1),
        avatar: String(candidate.avatar || "").trim(),
        twitterHandle: String(candidate.twitterHandle || "").trim().replace(/^@+/, ""),
        ownerUsername
      };
      data.players ??= [];
      data.players.push(player);
      data.constituencies ??= [];
      const seat = data.constituencies.find((c) => String(c.name || "").toLowerCase() === String(player.constituency || "").toLowerCase());
      if (seat) {
        seat.mpType = "character";
        seat.mpName = player.name;
      }
      data.userManagement.pendingCharacters.splice(idx, 1);
      if (ownerUsername) {
        const owner = (data.userManagement.accounts || []).find((a) => a.username === ownerUsername);
        if (owner) owner.activeCharacter = player.name;
      }
      saveData(data);
      state.message = `Approved and activated ${player.name}.`;
      render(data, state);
    });
  });

  host.querySelectorAll('[data-action="reject-character"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!manager) return;
      const idx = Number(btn.dataset.idx || -1);
      if (idx < 0 || idx >= data.userManagement.pendingCharacters.length) return;
      data.userManagement.pendingCharacters.splice(idx, 1);
      saveData(data);
      state.message = "Rejected pending character.";
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
      saveData(data);
      state.message = `${name} marked inactive.`;
      render(data, state);
    });
  });

  host.querySelectorAll('[data-action="reactivate-character"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = String(btn.dataset.name || "").trim();
      if (!name) return;
      const mine = ownedCharactersForAccount(data, account.username);
      const target = mine.find((p) => p.name === name);
      if (!target) return;
      if (mine.some((p) => p.active !== false)) {
        state.message = "You already have an active character. Set that character inactive before re-activating another.";
        render(data, state);
        return;
      }
      target.active = true;
      account.activeCharacter = target.name;
      data.currentCharacter = target;
      data.currentPlayer = target;
      saveData(data);
      state.message = `${target.name} re-activated.`;
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
    saveData(data);
    state.message = "Speaker controls updated.";
    render(data, state);
  });

  host.querySelector("#force-sunday-roll")?.addEventListener("click", () => {
    if (!manager) return;
    runSundayRoll(data);
    state.message = "Sunday roll forced for demo.";
    render(data, state);
  });

  host.querySelector("#start-simulation")?.addEventListener("click", () => {
    if (!admin || data.gameState.started || !isSundayToday()) return;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    data.gameState.started = true;
    data.gameState.startRealDate = now.toISOString();
    data.gameState.isPaused = false;
    saveData(data);
    state.message = `Simulation started on ${now.toLocaleDateString("en-GB")}. Clock advances from Monday.`;
    render(data, state);
  });

  host.querySelector("#monarch-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!admin) return;
    const gender = String(new FormData(e.currentTarget).get("monarchGender") || "Queen");
    data.adminSettings ??= {};
    data.adminSettings.monarchGender = gender === "King" ? "King" : "Queen";
    saveData(data);
    state.message = `Monarch updated to ${data.adminSettings.monarchGender}.`;
    render(data, state);
  });

  const syncCurrentUserFlags = () => {
    const cur = currentAccount(data);
    if (!cur) return;
    data.currentUser.isAdmin = !!cur.isAdmin;
    data.currentUser.isMod = !!cur.isMod;
    data.currentUser.isSpeaker = !!cur.isSpeaker;
    const baseRoles = (cur.roles || []).filter((r) => !["admin", "mod", "speaker"].includes(r));
    if (cur.isAdmin) baseRoles.push("admin");
    if (cur.isMod) baseRoles.push("mod");
    if (cur.isSpeaker) baseRoles.push("speaker");
    data.currentUser.roles = [...new Set(baseRoles)];
  };

  host.querySelectorAll('[data-action="set-admin"], [data-action="set-mod"], [data-action="set-speaker"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (!admin) return;
      const idx = Number(input.dataset.idx || -1);
      const acc = data.userManagement.accounts[idx];
      if (!acc) return;
      if (input.dataset.action === "set-admin") acc.isAdmin = input.checked;
      if (input.dataset.action === "set-mod") acc.isMod = input.checked;
      if (input.dataset.action === "set-speaker") acc.isSpeaker = input.checked;
      syncCurrentUserFlags();
      saveData(data);
      state.message = `Updated permissions for ${acc.username}.`;
      render(data, state);
    });
  });

  host.querySelectorAll('[data-action="toggle-active-account"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!admin) return;
      const idx = Number(btn.dataset.idx || -1);
      const acc = data.userManagement.accounts[idx];
      if (!acc) return;
      acc.active = !acc.active;
      saveData(data);
      state.message = `${acc.username} marked ${acc.active ? "active" : "inactive"}.`;
      render(data, state);
    });
  });
}

export function initUserPage(data) {
  normaliseUserData(data);
  saveData(data);
  render(data, { message: "" });
}
