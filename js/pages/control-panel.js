import { saveState } from "../core.js";
import { esc } from "../ui.js";
import { isAdmin, isMod, isSpeaker, canAdminOrMod, canAdminModOrSpeaker } from "../permissions.js";
import { logAction } from "../audit.js";
import {
  apiGetAllBioChanges, apiApproveBioChange, apiRejectBioChange,
  apiGetAllAvatarChanges, apiApproveAvatarChange, apiRejectAvatarChange,
  apiGetCharacterApplications, apiApproveCharacterApplication, apiRejectCharacterApplication,
  apiGetCharacters, apiAdminSetCharacterInactive,
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

  // Load pending character applications and active characters from DB
  let pendingApplications = [];
  let activeDbChars = [];
  await Promise.all([
    manager
      ? apiGetCharacterApplications("pending").catch(() => ({ applications: [] })).then((r) => { pendingApplications = r.applications; })
      : Promise.resolve(),
    canEdit
      ? apiGetCharacters({ active: "true" }).catch(() => ({ characters: [] })).then((r) => { activeDbChars = r.characters; })
      : Promise.resolve(),
  ]);

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

    ${manager ? `
    <details class="tile" style="margin-bottom:10px;" open>
      <summary style="cursor:pointer;"><b>Pending Character Approvals <span class="mod-badge">Mod / Admin / Speaker</span></b></summary>
      <div style="margin-top:10px;" id="cp-pending-characters">
        ${pendingApplications.length ? pendingApplications.map((p) => `
          <article class="tile" style="margin-bottom:8px;">
            <b>${esc(p.name)}</b> (${esc(p.party)}) · Financial level ${esc(String(p.financial_background_level || "-"))}
            <div class="muted">Submitted by ${esc(p.applicant_username || "User")} at ${esc(p.submitted_at ? new Date(p.submitted_at).toLocaleString("en-GB") : "")}</div>
            <div class="muted">Constituency: ${esc(p.constituency || "-")}</div>
            <div class="muted">Bio: ${esc((p.bio || p.personal_background || "-").slice(0, 200))}${(p.bio || p.personal_background || "").length > 200 ? "…" : ""}</div>
            <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn" type="button" data-action="cp-approve-character" data-id="${esc(p.id)}">Approve + Activate</button>
              <button class="btn" type="button" data-action="cp-reject-character" data-id="${esc(p.id)}">Reject</button>
            </div>
          </article>
        `).join("") : `<div class="muted-block">No pending character applications.</div>`}
      </div>
    </details>

    <details class="tile" style="margin-bottom:10px;" open>
      <summary style="cursor:pointer;"><b>Pending Biography Change Requests <span class="mod-badge">Mod / Admin / Speaker</span></b></summary>
      <div style="margin-top:10px;" id="cp-bio-changes-list"><div class="muted-block">Loading…</div></div>
    </details>

    <details class="tile" style="margin-bottom:10px;" open>
      <summary style="cursor:pointer;"><b>Pending Avatar Change Requests <span class="mod-badge">Mod / Admin / Speaker</span></b></summary>
      <div style="margin-top:10px;" id="cp-avatar-changes-list"><div class="muted-block">Loading…</div></div>
    </details>
    ` : ""}

    ${canEdit ? `
    <details class="tile" style="margin-bottom:10px;" open>
      <summary style="cursor:pointer;"><b>Active Player Roster <span class="mod-badge">Mod / Admin</span></b></summary>
      <div class="muted" style="margin-top:10px;">Shows all active characters from the database. Mods can set characters inactive.</div>
      <div style="margin-top:10px;display:grid;gap:8px;" id="cp-player-roster">
        ${activeDbChars.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))).map((p) => `
          <article class="tile" style="display:grid;grid-template-columns:minmax(180px,2fr) minmax(180px,2fr) auto;gap:8px;align-items:center;" data-char-id="${esc(p.id)}">
            <div><b>${esc(String(p.name || "Unknown"))}</b><div class="muted">${esc(String(p.party || "No party"))}</div></div>
            <div class="muted">${esc(String(p.constituency || "No constituency"))}</div>
            <button class="btn danger" type="button" data-action="set-inactive-player" data-id="${esc(p.id)}" data-name="${esc(String(p.name || ""))}">Set Inactive</button>
          </article>
        `).join("") || `<div class="muted-block">No active characters in the database.</div>`}
      </div>
    </details>
    ` : ""}
  `;

  rolePanels.querySelectorAll('[data-action="set-inactive-player"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!canEdit) return;
      const id = String(btn.dataset.id || "").trim();
      const name = String(btn.dataset.name || "").trim();
      if (!id) return;
      btn.disabled = true;
      btn.textContent = "Setting inactive…";
      try {
        await apiAdminSetCharacterInactive(id);
        const article = btn.closest("article");
        if (article) article.remove();
        const roster = rolePanels.querySelector("#cp-player-roster");
        if (roster && !roster.querySelector("article")) {
          roster.innerHTML = '<div class="muted-block">No active characters in the database.</div>';
        }
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Set Inactive";
        alert(`Error: ${err.message}`);
      }
    });
  });

  // Pending character approval handlers
  rolePanels.querySelectorAll('[data-action="cp-approve-character"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!manager) return;
      const id = String(btn.dataset.id || "").trim();
      if (!id) return;
      try {
        await apiApproveCharacterApplication(id);
        btn.closest("article")?.remove();
        const list = rolePanels.querySelector("#cp-pending-characters");
        if (list && !list.querySelector("article")) {
          list.innerHTML = '<div class="muted-block">No pending character applications.</div>';
        }
      } catch (err) {
        alert(`Error: ${err.message}`);
      }
    });
  });

  rolePanels.querySelectorAll('[data-action="cp-reject-character"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!manager) return;
      const id = String(btn.dataset.id || "").trim();
      if (!id) return;
      try {
        await apiRejectCharacterApplication(id);
        btn.closest("article")?.remove();
        const list = rolePanels.querySelector("#cp-pending-characters");
        if (list && !list.querySelector("article")) {
          list.innerHTML = '<div class="muted-block">No pending character applications.</div>';
        }
      } catch (err) {
        alert(`Error: ${err.message}`);
      }
    });
  });

  // Load bio change requests async
  if (manager) {
    const bioListEl = rolePanels.querySelector("#cp-bio-changes-list");
    if (bioListEl) {
      apiGetAllBioChanges("pending").then(({ changes }) => {
        if (!changes.length) {
          bioListEl.innerHTML = '<div class="muted-block">No pending biography change requests.</div>';
          return;
        }
        bioListEl.innerHTML = changes.map((c) => `
          <article class="tile" style="margin-bottom:8px;" data-bio-change-id="${esc(c.id)}">
            <b>${esc(c.character_name || "-")}</b> — submitted by ${esc(c.submitter_username || "-")}
            <div class="muted" style="margin:4px 0;">Submitted: ${esc(c.submitted_at ? new Date(c.submitted_at).toLocaleString("en-GB") : "-")}</div>
            <div style="background:var(--bg,#f8f8f8);border:1px solid var(--line);border-radius:6px;padding:8px;margin:6px 0;white-space:pre-wrap;font-size:.9em;">${esc(c.proposed_bio)}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn primary" type="button" data-action="cp-approve-bio-change" data-id="${esc(c.id)}">Approve</button>
              <button class="btn" type="button" data-action="cp-reject-bio-change" data-id="${esc(c.id)}">Reject</button>
            </div>
          </article>
        `).join("");

        bioListEl.querySelectorAll('[data-action="cp-approve-bio-change"]').forEach((btn) => {
          btn.addEventListener("click", async () => {
            try {
              await apiApproveBioChange(btn.dataset.id);
              btn.closest("article")?.remove();
              if (!bioListEl.querySelector("article")) {
                bioListEl.innerHTML = '<div class="muted-block">No pending biography change requests.</div>';
              }
            } catch (err) {
              alert(`Error: ${err.message}`);
            }
          });
        });

        bioListEl.querySelectorAll('[data-action="cp-reject-bio-change"]').forEach((btn) => {
          btn.addEventListener("click", async () => {
            try {
              await apiRejectBioChange(btn.dataset.id);
              btn.closest("article")?.remove();
              if (!bioListEl.querySelector("article")) {
                bioListEl.innerHTML = '<div class="muted-block">No pending biography change requests.</div>';
              }
            } catch (err) {
              alert(`Error: ${err.message}`);
            }
          });
        });
      }).catch(() => {
        if (bioListEl) bioListEl.innerHTML = '<div class="muted-block">Could not load biography change requests.</div>';
      });
    }

    // Load avatar change requests async
    const avatarListEl = rolePanels.querySelector("#cp-avatar-changes-list");
    if (avatarListEl) {
      apiGetAllAvatarChanges("pending").then(({ changes }) => {
        if (!changes.length) {
          avatarListEl.innerHTML = '<div class="muted-block">No pending avatar change requests.</div>';
          return;
        }
        avatarListEl.innerHTML = changes.map((c) => `
          <article class="tile" style="margin-bottom:8px;" data-avatar-change-id="${esc(c.id)}">
            <b>${esc(c.character_name || "-")}</b> — submitted by ${esc(c.submitter_username || "-")}
            <div class="muted" style="margin:4px 0;">Submitted: ${esc(c.submitted_at ? new Date(c.submitted_at).toLocaleString("en-GB") : "-")}</div>
            <div style="background:var(--bg,#f8f8f8);border:1px solid var(--line);border-radius:6px;padding:8px;margin:6px 0;font-size:.9em;word-break:break-all;">${esc(c.proposed_avatar)}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn primary" type="button" data-action="cp-approve-avatar-change" data-id="${esc(c.id)}">Approve</button>
              <button class="btn" type="button" data-action="cp-reject-avatar-change" data-id="${esc(c.id)}">Reject</button>
            </div>
          </article>
        `).join("");

        avatarListEl.querySelectorAll('[data-action="cp-approve-avatar-change"]').forEach((btn) => {
          btn.addEventListener("click", async () => {
            try {
              await apiApproveAvatarChange(btn.dataset.id);
              btn.closest("article")?.remove();
              if (!avatarListEl.querySelector("article")) {
                avatarListEl.innerHTML = '<div class="muted-block">No pending avatar change requests.</div>';
              }
            } catch (err) {
              alert(`Error: ${err.message}`);
            }
          });
        });

        avatarListEl.querySelectorAll('[data-action="cp-reject-avatar-change"]').forEach((btn) => {
          btn.addEventListener("click", async () => {
            try {
              await apiRejectAvatarChange(btn.dataset.id);
              btn.closest("article")?.remove();
              if (!avatarListEl.querySelector("article")) {
                avatarListEl.innerHTML = '<div class="muted-block">No pending avatar change requests.</div>';
              }
            } catch (err) {
              alert(`Error: ${err.message}`);
            }
          });
        });
      }).catch(() => {
        if (avatarListEl) avatarListEl.innerHTML = '<div class="muted-block">Could not load avatar change requests.</div>';
      });
    }
  }
}
