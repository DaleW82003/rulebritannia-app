import { saveState } from "../core.js";
import { esc } from "../ui.js";
import { isAdmin, isMod, isSpeaker, canAdminOrMod, canAdminModOrSpeaker } from "../permissions.js";
import { logAction } from "../audit.js";

export async function initControlPanelPage(data) {
  // Accessible to admin, mod, and speaker
  const user = data?.currentUser;
  if (!canAdminModOrSpeaker(data)) {
    const main = document.querySelector("main") || document.body;
    const p = document.createElement("p");
    p.style.cssText = "padding:2rem;font-size:1.2rem;color:var(--red,#c00);";
    p.textContent = "Forbidden: Admin, Mod, or Speaker access required.";
    main.replaceChildren(p);
    return;
  }

  const login = document.getElementById("rbLoginBlock");
  const simBlock = document.getElementById("rbSimBlock");
  const charBlock = document.getElementById("rbCharBlock");
  const rolePanels = document.getElementById("rbRolePanels");

  const canEdit = canAdminOrMod(data);
  const admin = isAdmin(data);
  const mod = isMod(data);

  if (login) login.innerHTML = `
    <div class="kv"><span>User</span><b>${esc(user?.username || "—")}</b></div>
    <div class="kv"><span>Roles</span><b>${esc((user?.roles || []).join(", ") || "player")}</b></div>
    ${admin
      ? `<div style="margin-top:8px;"><span class="admin-badge">🔒 Admin Mode Active</span></div>`
      : mod
        ? `<div style="margin-top:8px;"><span class="mod-badge">🔧 Mod Mode Active</span></div>`
        : isSpeaker(data)
          ? `<div style="margin-top:8px;"><span class="speaker-badge">🔔 Speaker Mode Active</span></div>`
          : ""
    }
  `;
  if (simBlock) simBlock.innerHTML = `<div class="kv"><span>Simulation Started</span><b>${data?.gameState?.started ? "Yes" : "No"}</b></div><div class="kv"><span>Start Real Date</span><b>${esc(data?.gameState?.startRealDate || "Not set")}</b></div>`;

  const char = data?.currentCharacter || data?.currentPlayer || {};
  if (charBlock) charBlock.innerHTML = `<div class="kv"><span>Character</span><b>${esc(char?.name || "None")}</b></div><div class="kv"><span>Office</span><b>${esc(char?.office || "None")}</b></div>`;

  if (!rolePanels) return;

  rolePanels.innerHTML = `
    <p class="muted">Economy data can be edited on the <a href="economy.html">Economy page</a> (admin/mod only).</p>

    ${canEdit ? `
    <details class="tile" style="margin-bottom:10px;" open>
      <summary style="cursor:pointer;"><b>Active Player Roster <span class="mod-badge">Mod / Admin</span></b></summary>
      <div class="muted" style="margin-top:10px;">Mods can only set characters inactive.</div>
      <div style="margin-top:10px;display:grid;gap:8px;" id="cp-player-roster">
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
  `;

  rolePanels.querySelectorAll('[data-action="set-inactive-player"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!canEdit) return;
      const name = String(btn.dataset.name || "").trim();
      if (!name) return;
      const players = Array.isArray(data.players) ? data.players : [];
      const p = players.find((pl) => pl.name === name);
      if (p) {
        p.active = false;
        saveState(data);
        btn.closest("article")?.querySelector(".muted")?.remove();
        btn.replaceWith(Object.assign(document.createElement("span"), { className: "muted", textContent: "Inactive (user can re-activate)" }));
      }
    });
  });
}
