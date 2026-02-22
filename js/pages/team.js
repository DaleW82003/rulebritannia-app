import { saveState } from "../core.js";
import { esc } from "../ui.js";
import { isAdmin } from "../permissions.js";

const TEAM_LEVELS = [
  { id: "admins", label: "Admins", roleKey: "isAdmin" },
  { id: "mods", label: "Mods", roleKey: "isMod" },
  { id: "speaker", label: "Speaker's Office", roleKey: "isSpeaker" }
];

function normaliseTeam(data) {
  data.userManagement ??= {};
  data.userManagement.accounts ??= [];
  data.aTeam ??= { admins: [], mods: [], speaker: [] };

  // Sync aTeam lists from accounts for consistency.
  const admins = [];
  const mods = [];
  const speaker = [];
  for (const a of data.userManagement.accounts) {
    if (!a?.username) continue;
    const entry = {
      username: String(a.username),
      activeCharacter: String(a.activeCharacter || ""),
      active: a.active !== false
    };
    if (a.isAdmin) admins.push(entry);
    if (a.isMod) mods.push(entry);
    if (a.isSpeaker) speaker.push(entry);
  }

  data.aTeam.admins = admins;
  data.aTeam.mods = mods;
  data.aTeam.speaker = speaker;
}

function renderLevel(level, members, adminMode) {
  return `
    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">${esc(level.label)}</h2>
      ${members.length ? members.map((m) => `
        <article class="tile" style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
          <div>
            <div><b>${esc(m.username)}</b></div>
            <div class="muted">Character: ${esc(m.activeCharacter || "None")} • Status: ${m.active ? "Active" : "Inactive"}</div>
          </div>
          <a class="btn" href="user.html?account=${encodeURIComponent(m.username)}">Open User Page</a>
        </article>
      `).join("") : `<div class="muted-block">No ${esc(level.label.toLowerCase())} assigned.</div>`}
      ${adminMode ? `<button class="btn" type="button" data-action="open-editor" data-level="${esc(level.id)}">Manage ${esc(level.label)}</button>` : ""}
    </section>
  `;
}

function renderEditor(data, state) {
  if (!state.editLevel) return "";
  const level = TEAM_LEVELS.find((l) => l.id === state.editLevel);
  if (!level) return "";

  const options = (data.userManagement.accounts || []).map((a, idx) => {
    const key = String(a.username || "");
    const checked = state.draftAssignments?.[key] ?? !!a[level.roleKey];
    return `
      <label style="display:flex;gap:8px;align-items:center;">
        <input type="checkbox" data-action="set-level" data-level="${esc(level.id)}" data-index="${idx}" ${checked ? "checked" : ""}>
        <span><b>${esc(a.username)}</b> <span class="muted">(${esc(a.activeCharacter || "No character")})</span></span>
      </label>
    `;
  }).join("");

  return `
    <section class="panel">
      <h2 style="margin-top:0;">Manage ${esc(level.label)}</h2>
      <div class="tile" style="display:grid;gap:8px;">
        ${options || '<div class="muted-block">No accounts available.</div>'}
      </div>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn" type="button" data-action="save-level" ${state.dirty ? "" : "disabled"}>Save ${esc(level.label)} Changes</button>
        <button class="btn" type="button" data-action="cancel-level">Cancel</button>
      </div>
      <p class="muted" style="margin-top:8px;">Changes are staged until you press Save.</p>
    </section>
  `;
}

function render(data, state) {
  const host = document.getElementById("team-root") || document.querySelector("main.wrap");
  if (!host) return;

  normaliseTeam(data);
  const adminMode = isAdmin(data);

  host.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Speaker's Office</div></div>

    ${renderLevel(TEAM_LEVELS[0], data.aTeam.admins || [], adminMode)}
    ${renderLevel(TEAM_LEVELS[1], data.aTeam.mods || [], adminMode)}
    ${renderLevel(TEAM_LEVELS[2], data.aTeam.speaker || [], adminMode)}

    ${adminMode ? renderEditor(data, state) : ""}

    ${state.message ? `<p class="muted">${esc(state.message)}</p>` : ""}
  `;

  host.querySelectorAll('[data-action="open-editor"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      state.editLevel = String(btn.dataset.level || "");
      const level = TEAM_LEVELS.find((l) => l.id === state.editLevel);
      state.draftAssignments = {};
      if (level) {
        for (const account of (data.userManagement.accounts || [])) {
          state.draftAssignments[String(account.username || "")] = !!account[level.roleKey];
        }
      }
      state.dirty = false;
      render(data, state);
    });
  });

  host.querySelectorAll('[data-action="set-level"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (!adminMode) return;
      const levelId = String(input.dataset.level || "");
      const idx = Number(input.dataset.index || -1);
      const account = data.userManagement.accounts[idx];
      const level = TEAM_LEVELS.find((l) => l.id === levelId);
      if (!account || !level) return;
      state.draftAssignments ??= {};
      state.draftAssignments[String(account.username || "")] = input.checked;
      state.dirty = true;
      state.message = `Staged ${level.label} changes. Press Save to apply.`;
      render(data, state);
    });
  });

  host.querySelector('[data-action="cancel-level"]')?.addEventListener("click", () => {
    state.editLevel = "";
    state.dirty = false;
    state.draftAssignments = {};
    state.message = "Discarded staged role changes.";
    render(data, state);
  });

  host.querySelector('[data-action="save-level"]')?.addEventListener("click", () => {
    if (!adminMode || !state.editLevel) return;
    const level = TEAM_LEVELS.find((l) => l.id === state.editLevel);
    if (!level) return;

    for (const account of (data.userManagement.accounts || [])) {
      const key = String(account.username || "");
      account[level.roleKey] = !!state.draftAssignments?.[key];

      const baseRoles = (account.roles || []).filter((r) => !["admin", "mod", "speaker"].includes(r));
      if (account.isAdmin) baseRoles.push("admin");
      if (account.isMod) baseRoles.push("mod");
      if (account.isSpeaker) baseRoles.push("speaker");
      account.roles = [...new Set(baseRoles)];

      const currentUsername = String(data.currentUser?.username || "");
      if (account.username === currentUsername) {
        data.currentUser.isAdmin = !!account.isAdmin;
        data.currentUser.isMod = !!account.isMod;
        data.currentUser.isSpeaker = !!account.isSpeaker;
        data.currentUser.roles = [...account.roles];
      }
    }

    normaliseTeam(data);
    saveState(data);
    state.dirty = false;
    state.editLevel = "";
    state.draftAssignments = {};
    state.message = `Saved ${level.label} assignments.`;
    render(data, state);
  });
}

export function initTeamPage(data) {
  normaliseTeam(data);
  saveState(data);
  render(data, { editLevel: "", message: "", dirty: false, draftAssignments: {} });
}
