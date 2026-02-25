import { esc } from "../ui.js";
import { isAdmin } from "../permissions.js";
import { apiAdminGetUsers, apiSetUserRoles } from "../api.js";

const SYSTEM_ROLES = ["admin", "mod", "speaker"];

const TEAM_LEVELS = [
  { id: "admins", label: "Admins", role: "admin" },
  { id: "mods", label: "Mods", role: "mod" },
  { id: "speaker", label: "Mod Mountain", role: "speaker" }
];

function buildTeamFromUsers(users) {
  const admins = users.filter((u) => u.roles.includes("admin"));
  const mods   = users.filter((u) => u.roles.includes("mod"));
  const speaker = users.filter((u) => u.roles.includes("speaker"));
  return { admins, mods, speaker };
}

function renderLevel(level, members, adminMode) {
  return `
    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">${esc(level.label)}</h2>
      ${members.length ? members.map((m) => `
        <article class="tile" style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
          <div>
            <div><b>${esc(m.username)}</b></div>
            <div class="muted">Character: ${esc(m.activeCharacter || "None")}</div>
          </div>
          <a class="btn" href="user.html?account=${encodeURIComponent(m.username)}">Open User Page</a>
        </article>
      `).join("") : `<div class="muted-block">No ${esc(level.label.toLowerCase())} assigned.</div>`}
      ${adminMode ? `<button class="btn" type="button" data-action="open-editor" data-level="${esc(level.id)}">Manage ${esc(level.label)}</button>` : ""}
    </section>
  `;
}

function renderEditor(users, state) {
  if (!state.editLevel) return "";
  const level = TEAM_LEVELS.find((l) => l.id === state.editLevel);
  if (!level) return "";

  const options = users.map((u) => {
    const checked = state.draftAssignments?.[u.id] ?? u.roles.includes(level.role);
    return `
      <label style="display:flex;gap:8px;align-items:center;">
        <input type="checkbox" data-action="set-level" data-level="${esc(level.id)}" data-userid="${esc(u.id)}" ${checked ? "checked" : ""}>
        <span><b>${esc(u.username)}</b> <span class="muted">(${esc(u.activeCharacter || "No character")})</span></span>
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
      <p class="muted" style="margin-top:8px;">Changes take effect immediately on save. Roles are stored in the database.</p>
    </section>
  `;
}

function render(users, state) {
  const host = document.getElementById("team-root") || document.querySelector("main.wrap");
  if (!host) return;

  const adminMode = isAdmin(state.currentData);
  const team = buildTeamFromUsers(users);

  host.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Mod Mountain</div></div>

    ${renderLevel(TEAM_LEVELS[0], team.admins, adminMode)}
    ${renderLevel(TEAM_LEVELS[1], team.mods, adminMode)}
    ${renderLevel(TEAM_LEVELS[2], team.speaker, adminMode)}

    ${adminMode ? renderEditor(users, state) : ""}

    ${state.message ? `<p class="muted">${esc(state.message)}</p>` : ""}
  `;

  host.querySelectorAll('[data-action="open-editor"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      state.editLevel = String(btn.dataset.level || "");
      const level = TEAM_LEVELS.find((l) => l.id === state.editLevel);
      state.draftAssignments = {};
      if (level) {
        for (const u of users) {
          state.draftAssignments[u.id] = u.roles.includes(level.role);
        }
      }
      state.dirty = false;
      render(users, state);
    });
  });

  host.querySelectorAll('[data-action="set-level"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (!adminMode) return;
      const userId = String(input.dataset.userid || "");
      state.draftAssignments ??= {};
      state.draftAssignments[userId] = input.checked;
      state.dirty = true;
      const level = TEAM_LEVELS.find((l) => l.id === state.editLevel);
      state.message = `Staged ${level?.label || ""} changes. Press Save to apply.`;
      render(users, state);
    });
  });

  host.querySelector('[data-action="cancel-level"]')?.addEventListener("click", () => {
    state.editLevel = "";
    state.dirty = false;
    state.draftAssignments = {};
    state.message = "Discarded staged role changes.";
    render(users, state);
  });

  host.querySelector('[data-action="save-level"]')?.addEventListener("click", async () => {
    if (!adminMode || !state.editLevel) return;
    const level = TEAM_LEVELS.find((l) => l.id === state.editLevel);
    if (!level) return;

    const saveBtn = host.querySelector('[data-action="save-level"]');
    if (saveBtn) saveBtn.disabled = true;

    try {
      // Apply role changes for each user whose assignment changed
      const updated = await Promise.all(
        users.map(async (u) => {
          const shouldHave = !!state.draftAssignments?.[u.id];
          const currentlyHas = u.roles.includes(level.role);
          if (shouldHave === currentlyHas) return u;
          const newRoles = shouldHave
            ? [...new Set([...u.roles, level.role])]
            : u.roles.filter((r) => r !== level.role);
          await apiSetUserRoles(u.id, newRoles);
          return { ...u, roles: newRoles };
        })
      );
      users.splice(0, users.length, ...updated);
      state.dirty = false;
      state.editLevel = "";
      state.draftAssignments = {};
      state.message = `Saved ${level.label} assignments.`;
      render(users, state);
    } catch (err) {
      state.message = `Save failed: ${err.message}`;
      render(users, state);
    }
  });
}

export async function initTeamPage(data) {
  const host = document.getElementById("team-root") || document.querySelector("main.wrap");
  if (host) host.innerHTML = `<div class="muted-block" style="margin:16px;">Loading team…</div>`;

  let users = [];
  try {
    const result = await apiAdminGetUsers();
    users = result.users || [];
  } catch (err) {
    console.warn("[team] Could not load DB users:", err.message);
    // Non-admin users can still see the read-only view with empty lists
  }


  const state = { editLevel: "", message: "", dirty: false, draftAssignments: {}, currentData: data };
  render(users, state);
}
