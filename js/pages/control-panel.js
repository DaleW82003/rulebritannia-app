import { saveState } from "../core.js";
import { esc } from "../ui.js";
import { isAdmin, isMod, isSpeaker, canAdminOrMod, canAdminModOrSpeaker } from "../permissions.js";
import { logAction } from "../audit.js";

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
  { title: "Parliament Control Panel", href: "constituencies.html", roles: ["speaker", "mod", "admin"] }
];

function controlPanelBadgesHTML(admin, data) {
  if (admin) {
    return `<span class="admin-badge">Admin</span> <span class="mod-badge">Mod</span> <span class="speaker-badge">Speaker</span>`;
  }
  if (isMod(data)) {
    return `<span class="mod-badge">Mod</span> <span class="speaker-badge">Speaker</span>`;
  }
  return `<span class="speaker-badge">Speaker</span>`;
}

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
  const manager = canAdminModOrSpeaker(data);
  const char = data?.currentCharacter || data?.currentPlayer || {};

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

  if (charBlock) charBlock.innerHTML = `<div class="kv"><span>Character</span><b>${esc(char?.name || "None")}</b></div><div class="kv"><span>Office</span><b>${esc(char?.office || "None")}</b></div>`;

  if (!rolePanels) return;

  rolePanels.innerHTML = `
    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Control Panels ${controlPanelBadgesHTML(admin, data)}</h2>
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
    </section>

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
