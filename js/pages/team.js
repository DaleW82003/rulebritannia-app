import { saveData } from "../core.js";
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

  const options = (data.userManagement.accounts || []).map((a, idx) => `
    <label style="display:flex;gap:8px;align-items:center;">
      <input type="checkbox" data-action="set-level" data-level="${esc(level.id)}" data-index="${idx}" ${a[level.roleKey] ? "checked" : ""}>
      <span><b>${esc(a.username)}</b> <span class="muted">(${esc(a.activeCharacter || "No character")})</span></span>
    </label>
  `).join("");

  return `
    <section class="panel">
      <h2 style="margin-top:0;">Manage ${esc(level.label)}</h2>
      <div class="tile" style="display:grid;gap:8px;">
        ${options || '<div class="muted-block">No accounts available.</div>'}
      </div>
      <p class="muted" style="margin-top:8px;">Changes are saved immediately.</p>
    </section>
  `;
}

function render(data, state) {
  const host = document.getElementById("team-root") || document.querySelector("main.wrap");
  if (!host) return;

  normaliseTeam(data);
  const adminMode = isAdmin(data);

  host.innerHTML = `
    <h1 class="page-title">Speaker's Office</h1>

    ${renderLevel(TEAM_LEVELS[0], data.aTeam.admins || [], adminMode)}
    ${renderLevel(TEAM_LEVELS[1], data.aTeam.mods || [], adminMode)}
    ${renderLevel(TEAM_LEVELS[2], data.aTeam.speaker || [], adminMode)}

    ${adminMode ? renderEditor(data, state) : ""}

    ${state.message ? `<p class="muted">${esc(state.message)}</p>` : ""}
  `;

  host.querySelectorAll('[data-action="open-editor"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      state.editLevel = String(btn.dataset.level || "");
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
      account[level.roleKey] = input.checked;

      // sync roles array and current user flags if needed
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

      normaliseTeam(data);
      saveData(data);
      state.message = `Updated ${level.label} assignments.`;
      render(data, state);
    });
  });
}

export function initTeamPage(data) {
  normaliseTeam(data);
  saveData(data);
  render(data, { editLevel: "", message: "" });
}
