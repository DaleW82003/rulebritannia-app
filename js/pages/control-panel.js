import { saveState } from "../core.js";
import { esc } from "../ui.js";
import { isAdmin, isMod, isSpeaker, canAdminOrMod, canAdminModOrSpeaker } from "../permissions.js";
import { logAction } from "../audit.js";
import {
  apiGetAllBioChanges, apiApproveBioChange, apiRejectBioChange,
  apiGetAllAvatarChanges, apiApproveAvatarChange, apiRejectAvatarChange,
  apiGetCharacterApplications, apiApproveCharacterApplication, apiRejectCharacterApplication,
  apiGetCharacters, apiAdminSetCharacterInactive, apiAdminRepairCharacterOwners,
  apiGetShopPriceIndex, apiApplyShopInflation,
  apiGetPendingAffiliations, apiDecideAffiliation,
  apiGetAllProfileChanges, apiApproveProfileChange, apiRejectProfileChange,
  apiGetFinanceConfig, apiUpdateFinanceSalaryBands, apiUpdateFinanceStartingBalances, apiApplyFinanceInflation,
  apiGetAuditLog,
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

  const simBlock = document.getElementById("rbSimBlock");
  const rolePanels = document.getElementById("rbRolePanels");

  const canEdit = canAdminOrMod(data);
  const admin = isAdmin(data);
  const mod = isMod(data);
  const manager = canAdminModOrSpeaker(data);
  const char = data?.currentCharacter || data?.currentPlayer || {};

  if (simBlock) simBlock.innerHTML = `<div class="kv"><span>Simulation Started</span><b>${data?.gameState?.started ? "Yes" : "No"}</b></div><div class="kv"><span>Start Real Date</span><b>${esc(data?.gameState?.startRealDate || "Not set")}</b></div>`;

  if (!rolePanels) return;

  // Load pending character applications and active characters from DB
  let pendingApplications = [];
  let activeDbChars = [];
  let shopPriceData = { priceIndex: 1.0, lastAppliedSimMonth: null, lastAppliedSimYear: null };
  let financeConfig = { salaryBands: {}, startingBalances: {}, financeCostIndex: 1.0, lastSalaryBandsSimYear: null, lastStartingBalancesSimYear: null, lastInflationSimYear: null, currentSimYear: null };
  await Promise.all([
    manager
      ? apiGetCharacterApplications("pending").catch(() => ({ applications: [] })).then((r) => { pendingApplications = r.applications; })
      : Promise.resolve(),
    canEdit
      ? apiGetCharacters({ active: "true" }).catch(() => ({ characters: [] })).then((r) => { activeDbChars = r.characters; })
      : Promise.resolve(),
    canEdit
      ? apiGetShopPriceIndex().catch(() => ({})).then((r) => { shopPriceData = { ...shopPriceData, ...r }; })
      : Promise.resolve(),
    canEdit
      ? apiGetFinanceConfig().catch(() => ({})).then((r) => { financeConfig = { ...financeConfig, ...r }; })
      : Promise.resolve(),
  ]);

  const economyInflationPct = Number(data?.economyPage?.topline?.inflation || 0);

  rolePanels.innerHTML = `
    <section class="panel" style="margin-bottom:12px;">
      <a class="btn" href="https://forum.rulebritannia.org/c/mod-mountain/5" target="_blank" rel="noopener">Ascend the Mountain</a>
    </section>

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
      <summary style="cursor:pointer;"><b>Pending Profile Change Requests <span class="mod-badge">Mod / Admin / Speaker</span></b></summary>
      <div style="margin-top:10px;" id="cp-profile-changes-list"><div class="muted-block">Loading…</div></div>
    </details>

    <details class="tile" style="margin-bottom:10px;" open>
      <summary style="cursor:pointer;"><b>Pending Biography Change Requests <span class="mod-badge">Mod / Admin / Speaker</span></b></summary>
      <div style="margin-top:10px;" id="cp-bio-changes-list"><div class="muted-block">Loading…</div></div>
    </details>

    <details class="tile" style="margin-bottom:10px;" open>
      <summary style="cursor:pointer;"><b>Pending Avatar Change Requests <span class="mod-badge">Mod / Admin / Speaker</span></b></summary>
      <div style="margin-top:10px;" id="cp-avatar-changes-list"><div class="muted-block">Loading…</div></div>
    </details>

    <details class="tile" style="margin-bottom:10px;" open>
      <summary style="cursor:pointer;"><b>Pending Affiliation Requests <span class="mod-badge">Mod / Admin / Speaker</span></b></summary>
      <div style="margin-top:10px;" id="cp-affiliations-list"><div class="muted-block">Loading…</div></div>
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

    <details class="tile" style="margin-bottom:10px;">
      <summary style="cursor:pointer;"><b>Repair Character Owner Pointers <span class="mod-badge">Mod / Admin</span></b></summary>
      <div style="margin-top:10px;">
        <p class="muted" style="margin:0 0 8px;">
          Reconciles characters whose <code>user_id</code> is missing or incorrect by matching
          them to their approved applications. Also clears stale session pointers.
          Safe to run multiple times.
        </p>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <button class="btn" type="button" id="cp-btn-repair-char-owners">Run Repair</button>
          <span id="cp-repair-char-owners-status" style="font-size:13px;"></span>
        </div>
      </div>
    </details>

    <details class="tile" style="margin-bottom:10px;">
      <summary style="cursor:pointer;"><b>Shop Price Inflation <span class="mod-badge">Mod / Admin</span></b></summary>
      <div style="margin-top:10px;">
        <p class="muted" style="margin:0 0 8px;">
          Adjusts the shop price index by the economy inflation rate (for both party and personal shop items).
          Can only be applied <b>once every 12 sim months</b>.
          Inflation rate is set on the <a href="economy.html">Economy page</a>.
        </p>
        <div class="muted" style="margin-bottom:10px;line-height:1.8;">
          <div><b>Current Price Index:</b> ${esc(String(Number(shopPriceData.priceIndex || 1).toFixed(4)))}</div>
          <div><b>Economy Inflation Rate:</b> ${economyInflationPct
            ? `${esc(economyInflationPct.toFixed(2))}%`
            : `<span style="color:var(--danger,#c00);">Not set — please configure inflation on the <a href="economy.html">Economy page</a> first</span>`}</div>
          ${economyInflationPct ? (() => { const previewIndex = Math.round(Number(shopPriceData.priceIndex || 1) * (1 + economyInflationPct / 100) * 10000) / 10000; return `<div><b>Preview New Index:</b> ${esc(previewIndex.toFixed(4))}</div>`; })() : ""}
          <div><b>Last Applied:</b> ${shopPriceData.lastAppliedSimMonth != null
            ? `Sim month ${esc(String(shopPriceData.lastAppliedSimMonth))}/${esc(String(shopPriceData.lastAppliedSimYear))}`
            : "Never"}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <button class="btn" type="button" id="cp-btn-apply-inflation"${!economyInflationPct ? " disabled title=\"Set inflation rate on the Economy page first\"" : ""}>Apply Inflation to Shop Prices</button>
          <span id="cp-inflation-status" style="font-size:13px;"></span>
        </div>
      </div>
    </details>

    <details class="tile" style="margin-bottom:10px;">
      <summary style="cursor:pointer;"><b>Finance Controls <span class="mod-badge">Mod / Admin</span></b></summary>
      <div style="margin-top:10px;">
        <p class="muted" style="margin:0 0 12px;">
          Manage the admin-controlled finance tables: MP salary bands, character starting bank balances,
          and the finance cost index (inflation for living costs, rental costs, and affiliation fees).
          Salary bands and starting balances can be updated <b>once per sim year</b>.
          Finance cost inflation can be applied <b>once per sim year</b>.
          Current sim year: <b>${financeConfig.currentSimYear != null ? esc(String(financeConfig.currentSimYear)) : "Unknown"}</b>.
        </p>

        <!-- Finance Cost Inflation -->
        <div class="tile" style="margin-bottom:12px;padding:12px;">
          <h4 style="margin:0 0 8px;">Finance Cost Inflation</h4>
          <p class="muted" style="margin:0 0 8px;font-size:.9em;">
            Applies the economy inflation rate to the finance cost index, which uprates
            home living costs, rental costs, and affiliation membership fees.
            Does <b>not</b> affect MP salaries, starting balances, or rental income.
          </p>
          <div class="muted" style="margin-bottom:10px;line-height:1.8;font-size:.9em;">
            <div><b>Current Finance Cost Index:</b> ${esc(String(Number(financeConfig.financeCostIndex || 1).toFixed(4)))}</div>
            <div><b>Economy Inflation Rate:</b> ${economyInflationPct
              ? `${esc(economyInflationPct.toFixed(2))}%`
              : `<span style="color:var(--danger,#c00);">Not set</span>`}</div>
            ${economyInflationPct ? (() => { const pi = Math.round(Number(financeConfig.financeCostIndex || 1) * (1 + economyInflationPct / 100) * 10000) / 10000; return `<div><b>Preview New Index:</b> ${esc(pi.toFixed(4))}</div>`; })() : ""}
            <div><b>Last Applied Sim Year:</b> ${financeConfig.lastInflationSimYear != null ? esc(String(financeConfig.lastInflationSimYear)) : "Never"}</div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <label style="display:flex;align-items:center;gap:4px;font-size:.9em;">
              <input type="checkbox" id="cp-fc-inflation-override"> Admin override (allow re-apply this year)
            </label>
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px;">
            <button class="btn" type="button" id="cp-btn-apply-fc-inflation"${!economyInflationPct ? " disabled title=\"Set inflation rate on the Economy page first\"" : ""}>Apply Finance Cost Inflation</button>
            <span id="cp-fc-inflation-status" style="font-size:13px;"></span>
          </div>
        </div>

        <!-- Salary Bands Editor -->
        <div class="tile" style="margin-bottom:12px;padding:12px;">
          <h4 style="margin:0 0 8px;">MP Salary Bands</h4>
          <p class="muted" style="margin:0 0 8px;font-size:.9em;">
            Set the annual salary for each MP position. Updates are applied when computing character salaries.
            Last updated sim year: <b>${financeConfig.lastSalaryBandsSimYear != null ? esc(String(financeConfig.lastSalaryBandsSimYear)) : "Never"}</b>.
          </p>
          <form id="cp-salary-bands-form">
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-bottom:8px;">
              ${Object.entries({ prime_minister: "Prime Minister", leader_opposition: "Leader of Opposition", leader_third_party: "Leader of Third Party", speaker: "Speaker", secretary_of_state: "Secretary of State", minister_of_state: "Minister of State", shadow_secretary_of_state: "Shadow Secretary of State", committee_chairman: "Committee Chairman", committee_member: "Committee Member", backbencher: "Backbencher" }).map(([key, label]) => `
                <div>
                  <label class="label" style="font-size:.85em;">${esc(label)}</label>
                  <input type="number" step="1" min="0" class="input" name="${esc(key)}"
                         value="${esc(String(financeConfig.salaryBands[key] ?? ""))}">
                </div>
              `).join("")}
            </div>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
              <label style="display:flex;align-items:center;gap:4px;font-size:.9em;">
                <input type="checkbox" name="adminOverride"> Admin override (allow re-edit this year)
              </label>
              <button type="submit" class="btn primary">Save Salary Bands</button>
              <span id="cp-salary-bands-status" style="font-size:13px;"></span>
            </div>
          </form>
        </div>

        <!-- Starting Balances Editor -->
        <div class="tile" style="padding:12px;">
          <h4 style="margin:0 0 8px;">Character Starting Balances</h4>
          <p class="muted" style="margin:0 0 8px;font-size:.9em;">
            Set the starting bank balance for each financial background level (1–10).
            These values are used when a new character is approved.
            Last updated sim year: <b>${financeConfig.lastStartingBalancesSimYear != null ? esc(String(financeConfig.lastStartingBalancesSimYear)) : "Never"}</b>.
          </p>
          <form id="cp-starting-balances-form">
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:8px;">
              ${[1,2,3,4,5,6,7,8,9,10].map((level) => `
                <div>
                  <label class="label" style="font-size:.85em;">Level ${level}</label>
                  <input type="number" step="1" min="0" class="input" name="level_${level}"
                         value="${esc(String(financeConfig.startingBalances[level] ?? financeConfig.startingBalances[String(level)] ?? ""))}">
                </div>
              `).join("")}
            </div>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
              <label style="display:flex;align-items:center;gap:4px;font-size:.9em;">
                <input type="checkbox" name="adminOverride"> Admin override (allow re-edit this year)
              </label>
              <button type="submit" class="btn primary">Save Starting Balances</button>
              <span id="cp-starting-balances-status" style="font-size:13px;"></span>
            </div>
          </form>
        </div>
      </div>
    </details>
    ` : ""}

    ${canEdit ? `
    <details class="tile" style="margin-bottom:10px;" open>
      <summary style="cursor:pointer;"><b>Activity Feeds <span class="mod-badge">Mod / Admin</span></b></summary>
      <div style="margin-top:10px;">
        <p class="muted" style="margin:0 0 10px;font-size:.9em;">Timestamped log of party organisation changes, party shop transactions, and character shop (Politician) transactions. Newest first.</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;" id="cp-feed-tabs">
          <button class="btn" type="button" data-feed-tab="party-org" style="font-weight:600;">Party Organisation</button>
          <button class="btn" type="button" data-feed-tab="party-shop">Party Shop</button>
          <button class="btn" type="button" data-feed-tab="politician">Politician Log</button>
        </div>
        <div id="cp-feed-panel" style="min-height:60px;"><div class="muted-block">Loading…</div></div>
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

  // Repair character owner pointers
  const repairBtn = rolePanels.querySelector("#cp-btn-repair-char-owners");
  const repairStatus = rolePanels.querySelector("#cp-repair-char-owners-status");
  if (repairBtn) {
    repairBtn.addEventListener("click", async () => {
      if (!canEdit) return;
      repairBtn.disabled = true;
      repairBtn.textContent = "Running…";
      if (repairStatus) repairStatus.textContent = "";
      try {
        const result = await apiAdminRepairCharacterOwners();
        logAction({ action: "admin.repair.character-owner-pointers", details: { fixed_count: result.fixed_count, sessions_cleared: result.sessions_cleared } });
        if (repairStatus) {
          repairStatus.style.color = (result.fixed_count || result.sessions_cleared) ? "#1a7a1a" : "#555";
          repairStatus.textContent = result.message || "Done.";
        }
      } catch (err) {
        if (repairStatus) { repairStatus.style.color = "var(--danger,#c00)"; repairStatus.textContent = `Error: ${err.message}`; }
      } finally {
        repairBtn.disabled = false;
        repairBtn.textContent = "Run Repair";
      }
    });
  }

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
    // Load profile change requests async
    const profileListEl = rolePanels.querySelector("#cp-profile-changes-list");
    if (profileListEl) {
      apiGetAllProfileChanges("pending").then(({ changes }) => {
        if (!changes.length) {
          profileListEl.innerHTML = '<div class="muted-block">No pending profile change requests.</div>';
          return;
        }
        profileListEl.innerHTML = changes.map((c) => {
          const fields = [
            c.proposed_education         != null ? `<div><b>Education:</b> ${esc(c.proposed_education)}</div>` : "",
            c.proposed_career_background != null ? `<div><b>Career:</b> ${esc(c.proposed_career_background)}</div>` : "",
            c.proposed_family            != null ? `<div><b>Family:</b> ${esc(c.proposed_family)}</div>` : "",
            c.proposed_date_of_birth     != null ? `<div><b>Date of birth:</b> ${esc(c.proposed_date_of_birth)}</div>` : "",
            c.proposed_financial_bg_level!= null ? `<div><b>Financial background level:</b> ${esc(String(c.proposed_financial_bg_level))}</div>` : "",
            c.proposed_twitter_handle    != null ? `<div><b>Twitter handle:</b> @${esc(c.proposed_twitter_handle)}</div>` : "",
          ].filter(Boolean).join("");
          return `
            <article class="tile" style="margin-bottom:8px;" data-profile-change-id="${esc(c.id)}">
              <b>${esc(c.character_name || "-")}</b> — submitted by ${esc(c.submitter_username || "-")}
              <div class="muted" style="margin:4px 0;">Submitted: ${esc(c.submitted_at ? new Date(c.submitted_at).toLocaleString("en-GB") : "-")}</div>
              <div style="background:var(--bg,#f8f8f8);border:1px solid var(--line);border-radius:6px;padding:8px;margin:6px 0;font-size:.9em;line-height:1.6;">${fields}</div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button class="btn primary" type="button" data-action="cp-approve-profile-change" data-id="${esc(c.id)}">Approve</button>
                <button class="btn" type="button" data-action="cp-reject-profile-change" data-id="${esc(c.id)}">Reject</button>
              </div>
            </article>
          `;
        }).join("");

        profileListEl.querySelectorAll('[data-action="cp-approve-profile-change"]').forEach((btn) => {
          btn.addEventListener("click", async () => {
            try {
              await apiApproveProfileChange(btn.dataset.id);
              btn.closest("article")?.remove();
              if (!profileListEl.querySelector("article")) {
                profileListEl.innerHTML = '<div class="muted-block">No pending profile change requests.</div>';
              }
            } catch (err) {
              alert(`Error: ${err.message}`);
            }
          });
        });

        profileListEl.querySelectorAll('[data-action="cp-reject-profile-change"]').forEach((btn) => {
          btn.addEventListener("click", async () => {
            try {
              await apiRejectProfileChange(btn.dataset.id);
              btn.closest("article")?.remove();
              if (!profileListEl.querySelector("article")) {
                profileListEl.innerHTML = '<div class="muted-block">No pending profile change requests.</div>';
              }
            } catch (err) {
              alert(`Error: ${err.message}`);
            }
          });
        });
      }).catch(() => {
        if (profileListEl) profileListEl.innerHTML = '<div class="muted-block">Could not load profile change requests.</div>';
      });
    }

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
  // Apply inflation button
  const inflationBtn    = rolePanels.querySelector("#cp-btn-apply-inflation");
  const inflationStatus = rolePanels.querySelector("#cp-inflation-status");
  if (inflationBtn) {
    inflationBtn.addEventListener("click", async () => {
      if (!canEdit) return;
      inflationBtn.disabled = true;
      inflationBtn.textContent = "Applying…";
      if (inflationStatus) inflationStatus.textContent = "";
      try {
        const result = await apiApplyShopInflation(economyInflationPct || undefined);
        logAction({ action: "shop.apply_inflation", details: result });
        if (inflationStatus) {
          inflationStatus.style.color = "#1a7a1a";
          inflationStatus.textContent = `Done. Index: ${Number(result.oldIndex).toFixed(4)} → ${Number(result.newIndex).toFixed(4)} (+${Number(result.inflationPct).toFixed(2)}%)`;
        }
      } catch (err) {
        if (inflationStatus) {
          inflationStatus.style.color = "var(--danger,#c00)";
          inflationStatus.textContent = `Error: ${err.message}`;
        }
      } finally {
        inflationBtn.disabled = false;
        inflationBtn.textContent = "Apply Inflation to Shop Prices";
      }
    });
  }

  // Finance Cost Inflation button
  const fcInflationBtn    = rolePanels.querySelector("#cp-btn-apply-fc-inflation");
  const fcInflationStatus = rolePanels.querySelector("#cp-fc-inflation-status");
  if (fcInflationBtn) {
    fcInflationBtn.addEventListener("click", async () => {
      if (!canEdit) return;
      const overrideEl = rolePanels.querySelector("#cp-fc-inflation-override");
      const adminOverride = overrideEl?.checked ?? false;
      fcInflationBtn.disabled = true;
      fcInflationBtn.textContent = "Applying…";
      if (fcInflationStatus) fcInflationStatus.textContent = "";
      try {
        const result = await apiApplyFinanceInflation(economyInflationPct || undefined, adminOverride);
        logAction({ action: "admin.finance.apply-inflation", details: result });
        if (fcInflationStatus) {
          fcInflationStatus.style.color = "#1a7a1a";
          fcInflationStatus.textContent = `Done. Cost index: ${Number(result.oldIndex).toFixed(4)} → ${Number(result.newIndex).toFixed(4)} (+${Number(result.inflationPct).toFixed(2)}%)`;
        }
      } catch (err) {
        if (fcInflationStatus) {
          fcInflationStatus.style.color = "var(--danger,#c00)";
          fcInflationStatus.textContent = `Error: ${err.message}`;
        }
      } finally {
        fcInflationBtn.disabled = false;
        fcInflationBtn.textContent = "Apply Finance Cost Inflation";
      }
    });
  }

  // Salary Bands form
  const salaryBandsForm   = rolePanels.querySelector("#cp-salary-bands-form");
  const salaryBandsStatus = rolePanels.querySelector("#cp-salary-bands-status");
  if (salaryBandsForm) {
    salaryBandsForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const fd = new FormData(form);
      const adminOverride = fd.get("adminOverride") === "on";
      const salaryBands = {};
      for (const [k, v] of fd.entries()) {
        if (k === "adminOverride") continue;
        const num = parseFloat(String(v).trim());
        if (v.toString().trim() !== "" && Number.isFinite(num)) salaryBands[k] = num;
      }
      const btn = form.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;
      if (salaryBandsStatus) salaryBandsStatus.textContent = "";
      try {
        const result = await apiUpdateFinanceSalaryBands(salaryBands, adminOverride);
        logAction({ action: "admin.finance.salary-bands.update", details: result });
        if (salaryBandsStatus) {
          salaryBandsStatus.style.color = "#1a7a1a";
          salaryBandsStatus.textContent = `✓ Saved for sim year ${result.simYear}.`;
        }
      } catch (err) {
        if (salaryBandsStatus) {
          salaryBandsStatus.style.color = "var(--danger,#c00)";
          salaryBandsStatus.textContent = `✗ ${err.message}`;
        }
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  // Starting Balances form
  const startingBalancesForm   = rolePanels.querySelector("#cp-starting-balances-form");
  const startingBalancesStatus = rolePanels.querySelector("#cp-starting-balances-status");
  if (startingBalancesForm) {
    startingBalancesForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const fd = new FormData(form);
      const adminOverride = fd.get("adminOverride") === "on";
      const startingBalances = {};
      for (const [k, v] of fd.entries()) {
        if (k === "adminOverride") continue;
        const level = k.replace("level_", "");
        const num = parseFloat(String(v).trim());
        if (v.toString().trim() !== "" && Number.isFinite(num)) startingBalances[level] = num;
      }
      const btn = form.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;
      if (startingBalancesStatus) startingBalancesStatus.textContent = "";
      try {
        const result = await apiUpdateFinanceStartingBalances(startingBalances, adminOverride);
        logAction({ action: "admin.finance.starting-balances.update", details: result });
        if (startingBalancesStatus) {
          startingBalancesStatus.style.color = "#1a7a1a";
          startingBalancesStatus.textContent = `✓ Saved for sim year ${result.simYear}.`;
        }
      } catch (err) {
        if (startingBalancesStatus) {
          startingBalancesStatus.style.color = "var(--danger,#c00)";
          startingBalancesStatus.textContent = `✗ ${err.message}`;
        }
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

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
          avatarListEl.innerHTML = '<div class="muted-block">Could not load avatar change requests.</div>';
        });
      }


    // ── Affiliations queue ──────────────────────────────────────────────────
    const affListEl = rolePanels.querySelector("#cp-affiliations-list");
    if (affListEl) {
      function renderAffiliationRequests(requests) {
        if (!requests.length) {
          affListEl.innerHTML = '<div class="muted-block">No pending affiliation requests.</div>';
          return;
        }
        affListEl.innerHTML = `
          <table style="width:100%;border-collapse:collapse;font-size:.9em;">
            <thead>
              <tr style="border-bottom:2px solid var(--line,#ddd);text-align:left;">
                <th style="padding:4px 8px;">Character</th>
                <th style="padding:4px 8px;">Affiliation</th>
                <th style="padding:4px 8px;">Category</th>
                <th style="padding:4px 8px;">Action</th>
                <th style="padding:4px 8px;">Requested</th>
                <th style="padding:4px 8px;"></th>
              </tr>
            </thead>
            <tbody>
              ${requests.map((r) => `
                <tr style="border-bottom:1px solid var(--line,#eee);" data-aff-request-id="${esc(r.request_id)}">
                  <td style="padding:4px 8px;"><b>${esc(r.character_name || "-")}</b><br><span class="muted" style="font-size:.85em;">${esc(r.party || "")}${r.constituency ? ` · ${esc(r.constituency)}` : ""}</span></td>
                  <td style="padding:4px 8px;">${esc(r.affiliation_name)}</td>
                  <td style="padding:4px 8px;" class="muted">${esc(r.category)}</td>
                  <td style="padding:4px 8px;">
                    ${r.status === "pending_add"
                      ? '<span style="color:#1a7a1a;font-weight:600;">+ Add</span>'
                      : '<span style="color:#c00;font-weight:600;">− Remove</span>'}
                  </td>
                  <td style="padding:4px 8px;" class="muted">${esc(r.requested_at ? new Date(r.requested_at).toLocaleString("en-GB") : "-")}</td>
                  <td style="padding:4px 8px;display:flex;gap:6px;flex-wrap:wrap;">
                    <button class="btn primary btn-sm" type="button" data-action="cp-approve-aff" data-id="${esc(r.request_id)}">Approve</button>
                    <button class="btn btn-sm" type="button" data-action="cp-reject-aff" data-id="${esc(r.request_id)}">Reject</button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `;

        affListEl.querySelectorAll('[data-action="cp-approve-aff"]').forEach((btn) => {
          btn.addEventListener("click", async () => {
            const id = btn.dataset.id;
            btn.disabled = true;
            try {
              await apiDecideAffiliation(id, "approve");
              btn.closest("tr")?.remove();
              if (!affListEl.querySelector("tr[data-aff-request-id]")) {
                affListEl.innerHTML = '<div class="muted-block">No pending affiliation requests.</div>';
              }
            } catch (err) {
              btn.disabled = false;
              alert(`Error: ${err.message}`);
            }
          });
        });

        affListEl.querySelectorAll('[data-action="cp-reject-aff"]').forEach((btn) => {
          btn.addEventListener("click", async () => {
            const id = btn.dataset.id;
            btn.disabled = true;
            try {
              await apiDecideAffiliation(id, "reject");
              btn.closest("tr")?.remove();
              if (!affListEl.querySelector("tr[data-aff-request-id]")) {
                affListEl.innerHTML = '<div class="muted-block">No pending affiliation requests.</div>';
              }
            } catch (err) {
              btn.disabled = false;
              alert(`Error: ${err.message}`);
            }
          });
        });
      }

      apiGetPendingAffiliations()
        .then(({ requests }) => renderAffiliationRequests(requests))
        .catch(() => { affListEl.innerHTML = '<div class="muted-block">Could not load affiliation requests.</div>'; });
    }
  }

  // ── Activity Feeds ──────────────────────────────────────────────────────────
  if (canEdit) {
    const feedPanel = rolePanels.querySelector("#cp-feed-panel");
    const feedTabs  = rolePanels.querySelector("#cp-feed-tabs");

    const FEED_DEFS = {
      "party-org":  { label: "Party Organisation", actions: ["party-organisation-updated"] },
      "party-shop": { label: "Party Shop",          actions: ["party-shop-purchase", "party-shop-sale", "party-shop-dismissal"] },
      "politician": { label: "Politician Log",       actions: ["character-shop-purchase", "character-shop-sale", "character-shop-dismissal", "office.assign", "office.unassign"] },
    };

    function formatFeedEntry(entry) {
      const d = entry.details || {};
      const ts = entry.created_at ? new Date(entry.created_at).toLocaleString("en-GB") : "—";
      const headline = esc(d.headline || entry.action || "");
      const actor = esc(d.actorName || entry.actor_name || entry.actor_id || "");
      return `
        <article style="border-bottom:1px solid var(--line,#eee);padding:8px 0;">
          <div style="font-size:.82em;color:#888;">${esc(ts)}</div>
          <div style="margin:2px 0;">${headline}</div>
          ${actor ? `<div class="muted" style="font-size:.85em;">Actor: ${actor}</div>` : ""}
          <div class="muted" style="font-size:.8em;font-family:monospace;">${esc(entry.action)}</div>
        </article>
      `;
    }

    async function loadFeed(tab) {
      if (!feedPanel) return;
      feedPanel.innerHTML = '<div class="muted-block">Loading…</div>';
      const def = FEED_DEFS[tab];
      if (!def) return;
      try {
        const entries = [];
        await Promise.all(def.actions.map(async (action) => {
          const result = await apiGetAuditLog({ action, limit: 50 });
          entries.push(...(result.entries || []));
        }));
        entries.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        if (!entries.length) {
          feedPanel.innerHTML = `<div class="muted-block">No ${esc(def.label)} entries yet.</div>`;
          return;
        }
        feedPanel.innerHTML = entries.slice(0, 50).map(formatFeedEntry).join("");
      } catch (err) {
        feedPanel.innerHTML = `<div class="muted-block">Could not load feed: ${esc(err.message)}</div>`;
      }
    }

    let activeFeedTab = "party-org";
    if (feedTabs) {
      feedTabs.querySelectorAll("[data-feed-tab]").forEach((btn) => {
        btn.addEventListener("click", () => {
          activeFeedTab = String(btn.dataset.feedTab || "party-org");
          feedTabs.querySelectorAll("[data-feed-tab]").forEach((b) => {
            b.style.fontWeight = b === btn ? "600" : "";
          });
          loadFeed(activeFeedTab);
        });
      });
    }
    loadFeed(activeFeedTab);
  }
}
