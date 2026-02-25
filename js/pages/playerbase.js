// js/pages/playerbase.js
import { esc } from "../ui.js";
import { canAdminModOrSpeaker } from "../permissions.js";
import {
  apiGetPlayerbase,
  apiAdminSetBank,
  apiAdminSetSalaryOverride,
  apiAdminSetPositions,
  apiAdminCreateRevenue,
  apiAdminUpdateRevenue,
  apiAdminDeleteRevenue,
  apiAdminUprateScale,
} from "../api.js";

// All known position keys (from 1997 salary scale)
const POSITION_KEYS = [
  "prime_minister",
  "leader_opposition",
  "leader_third_party",
  "speaker",
  "secretary_of_state",
  "minister_of_state",
  "shadow_secretary_of_state",
  "committee_chairman",
  "committee_member",
  "backbencher",
];

function money(n) {
  const v = Number(n ?? 0);
  return `£${v.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function renderCharacterFinance(char, scaleRoles, state) {
  const revRows = (char.additionalRevenue || []).map((r) => `
    <tr>
      <td>${esc(r.label)}</td>
      <td>${money(r.annual_amount)}</td>
      <td>
        <button class="btn btn-sm" data-action="edit-revenue" data-rev-id="${esc(r.id)}"
                data-char-id="${esc(char.id)}" data-label="${esc(r.label)}" data-amount="${esc(String(r.annual_amount))}">Edit</button>
        <button class="btn btn-sm btn-danger" data-action="del-revenue" data-rev-id="${esc(r.id)}" data-char-id="${esc(char.id)}">×</button>
      </td>
    </tr>`).join("");

  const posOptions = POSITION_KEYS.map((k) => {
    const sel = (char.positions || []).includes(k) ? " selected" : "";
    const salary = scaleRoles[k] ? ` (${money(scaleRoles[k])}/yr)` : "";
    return `<option value="${esc(k)}"${sel}>${esc(k.replace(/_/g, " "))}${salary}</option>`;
  }).join("");

  return `
    <details class="char-finance-detail" data-char-id="${esc(char.id)}">
      <summary style="cursor:pointer;font-weight:600;">
        ${esc(char.name)} <span class="muted">(${esc(char.party)}${char.constituency ? ` · ${esc(char.constituency)}` : ""})</span>
        ${char.is_active ? "" : `<span class="badge" style="background:#888;color:#fff;font-size:0.75em;padding:1px 5px;border-radius:4px;">Inactive</span>`}
        — <span style="color:#0b2d6b;">${money(char.annualSalary)}/yr</span>
        — Balance: <span style="color:#007700;">${money(char.bankBalance)}</span>
      </summary>
      <div style="padding:8px 0 4px 12px;">
        <div style="display:flex;flex-wrap:wrap;gap:16px;margin-bottom:10px;">
          <a href="user.html?account=${esc(encodeURIComponent(""))}" class="btn btn-sm" style="display:none"></a>
          <a href="personal.html?character=${esc(char.id)}" class="btn btn-sm" target="_blank">Personal page ↗</a>
          <a href="profile.html?id=${esc(char.id)}" class="btn btn-sm" target="_blank">Public profile ↗</a>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;">
          <!-- Positions -->
          <div class="tile" style="padding:10px;">
            <h4 style="margin:0 0 6px;">Positions</h4>
            <select multiple size="5" style="width:100%;font-size:0.9em;" data-action="positions-select" data-char-id="${esc(char.id)}">
              ${posOptions}
            </select>
            <button class="btn btn-sm primary" style="margin-top:6px;" data-action="save-positions" data-char-id="${esc(char.id)}">Save Positions</button>
            <div class="muted" style="margin-top:4px;font-size:0.85em;">
              Computed salary: ${money(char.computedSalary)}/yr
              ${char.annualSalaryOverride != null ? `<br><b>Override active: ${money(char.annualSalaryOverride)}/yr</b>` : ""}
            </div>
          </div>

          <!-- Bank balance -->
          <div class="tile" style="padding:10px;">
            <h4 style="margin:0 0 6px;">Bank Balance</h4>
            <input type="number" step="0.01" class="input" style="width:100%;"
                   data-action="bank-input" data-char-id="${esc(char.id)}"
                   value="${esc(String(char.bankBalance))}">
            <button class="btn btn-sm primary" style="margin-top:6px;" data-action="save-bank" data-char-id="${esc(char.id)}">Save Balance</button>
          </div>

          <!-- Salary override -->
          <div class="tile" style="padding:10px;">
            <h4 style="margin:0 0 6px;">Salary Override</h4>
            <input type="number" step="1" class="input" style="width:100%;"
                   placeholder="Leave empty to use computed"
                   data-action="override-input" data-char-id="${esc(char.id)}"
                   value="${esc(char.annualSalaryOverride != null ? String(char.annualSalaryOverride) : "")}">
            <button class="btn btn-sm primary" style="margin-top:6px;" data-action="save-override" data-char-id="${esc(char.id)}">Save Override</button>
          </div>
        </div>

        <!-- Additional Revenue -->
        <div style="margin-top:10px;">
          <h4 style="margin:0 0 6px;">Additional Annual Revenue</h4>
          ${revRows ? `<table style="width:100%;font-size:0.9em;border-collapse:collapse;margin-bottom:8px;">
            <thead><tr><th style="text-align:left;padding:2px 6px;">Label</th><th style="text-align:left;padding:2px 6px;">Annual</th><th></th></tr></thead>
            <tbody>${revRows}</tbody>
          </table>` : `<p class="muted" style="margin:0 0 8px;">No additional revenue entries.</p>`}
          <form data-action="add-revenue" data-char-id="${esc(char.id)}" style="display:flex;gap:6px;flex-wrap:wrap;">
            <input type="text" class="input" placeholder="Label" name="label" style="flex:2;min-width:120px;" required>
            <input type="number" class="input" placeholder="Annual £" name="amount" style="flex:1;min-width:90px;" required>
            <button type="submit" class="btn btn-sm primary">+ Add</button>
          </form>
        </div>
      </div>
    </details>`;
}

function renderUser(user, scaleRoles, state) {
  const charCount = (user.characters || []).length;
  return `
    <div class="tile" style="margin-bottom:10px;" data-user-id="${esc(user.id)}">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;">
        <strong>${esc(user.username)}</strong>
        <span class="muted">${esc((user.roles || []).join(", ") || "player")}</span>
        <a href="user.html?account=${esc(encodeURIComponent(user.username))}" class="btn btn-sm" target="_blank">User page ↗</a>
        <span class="muted">${charCount} character${charCount === 1 ? "" : "s"}</span>
      </div>
      ${(user.characters || []).map((ch) => renderCharacterFinance(ch, scaleRoles, state)).join("") || "<p class='muted'>No characters.</p>"}
    </div>`;
}

function render(host, roster, scaleRoles, state) {
  const searchVal = state.search || "";
  const filtered = roster.filter((u) => {
    if (!searchVal) return true;
    const q = searchVal.toLowerCase();
    return u.username.toLowerCase().includes(q)
      || (u.characters || []).some((c) => c.name.toLowerCase().includes(q));
  });

  host.innerHTML = `
    <div style="margin-bottom:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
      <input type="search" class="input" placeholder="Search users/characters…" id="pb-search"
             style="max-width:280px;" value="${esc(searchVal)}">
      <span class="muted">${esc(String(filtered.length))} user${filtered.length === 1 ? "" : "s"} shown</span>
      <button class="btn btn-sm" id="pb-reload">↺ Reload</button>
    </div>

    <details style="margin-bottom:16px;">
      <summary style="cursor:pointer;font-weight:600;">⚙ Salary Scale Uprate</summary>
      <div class="tile" style="margin-top:8px;padding:12px;">
        <form id="pb-uprate-form" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;">
          <div>
            <label class="label">Scale Name</label>
            <input type="text" class="input" name="name" placeholder="e.g. 2000 Uprate" required>
          </div>
          <div>
            <label class="label">Effective Sim Index (year×12+month-1)</label>
            <input type="number" class="input" name="simIndex" placeholder="e.g. 24011" required>
          </div>
          <div>
            <label class="label">% Uplift (e.g. 2.5)</label>
            <input type="number" step="0.01" class="input" name="pct" placeholder="2.5" required>
          </div>
          <div style="display:flex;align-items:flex-end;">
            <button type="submit" class="btn primary">Create Scale</button>
          </div>
        </form>
        <div id="pb-uprate-msg" class="muted" style="margin-top:6px;"></div>
      </div>
    </details>

    <div id="pb-roster">
      ${filtered.length ? filtered.map((u) => renderUser(u, scaleRoles, state)).join("") : "<p class='muted'>No players found.</p>"}
    </div>
    ${state.message ? `<div class="muted" style="margin-top:8px;padding:6px 10px;background:#f0fff0;border-radius:6px;">${esc(state.message)}</div>` : ""}
  `;
}

function wireEvents(host, state, reload) {
  host.querySelector("#pb-search")?.addEventListener("input", (e) => {
    state.search = e.currentTarget.value;
    state.message = "";
    // re-render
    render(host, state._roster, state._scaleRoles, state);
    wireEvents(host, state, reload);
  });

  host.querySelector("#pb-reload")?.addEventListener("click", () => reload());

  // Uprate form
  host.querySelector("#pb-uprate-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const msgEl = host.querySelector("#pb-uprate-msg");
    try {
      const res = await apiAdminUprateScale(
        String(fd.get("name") || "").trim(),
        parseInt(String(fd.get("simIndex") || "0"), 10),
        parseFloat(String(fd.get("pct") || "0"))
      );
      if (msgEl) msgEl.textContent = `✓ Scale created (id ${res.scale_id})`;
    } catch (err) {
      if (msgEl) msgEl.textContent = `✗ ${err.message}`;
    }
  });

  // Save positions
  host.querySelectorAll("[data-action='save-positions']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const charId = btn.dataset.charId;
      const sel = host.querySelector(`[data-action='positions-select'][data-char-id='${charId}']`);
      const positions = sel ? Array.from(sel.selectedOptions).map((o) => o.value) : [];
      try {
        await apiAdminSetPositions(charId, positions);
        state.message = "✓ Positions saved.";
        reload();
      } catch (err) {
        state.message = `✗ ${err.message}`;
        render(host, state._roster, state._scaleRoles, state);
        wireEvents(host, state, reload);
      }
    });
  });

  // Save bank balance
  host.querySelectorAll("[data-action='save-bank']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const charId = btn.dataset.charId;
      const input = host.querySelector(`[data-action='bank-input'][data-char-id='${charId}']`);
      try {
        await apiAdminSetBank(charId, parseFloat(input?.value ?? "0"));
        state.message = "✓ Balance saved.";
        reload();
      } catch (err) {
        state.message = `✗ ${err.message}`;
        render(host, state._roster, state._scaleRoles, state);
        wireEvents(host, state, reload);
      }
    });
  });

  // Save salary override
  host.querySelectorAll("[data-action='save-override']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const charId = btn.dataset.charId;
      const input = host.querySelector(`[data-action='override-input'][data-char-id='${charId}']`);
      const val = input?.value?.trim() ?? "";
      try {
        await apiAdminSetSalaryOverride(charId, val === "" ? null : parseFloat(val));
        state.message = "✓ Override saved.";
        reload();
      } catch (err) {
        state.message = `✗ ${err.message}`;
        render(host, state._roster, state._scaleRoles, state);
        wireEvents(host, state, reload);
      }
    });
  });

  // Add revenue
  host.querySelectorAll("[data-action='add-revenue']").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const charId = form.dataset.charId;
      const fd = new FormData(form);
      try {
        await apiAdminCreateRevenue(charId, String(fd.get("label") || "").trim(), parseFloat(String(fd.get("amount") || "0")));
        state.message = "✓ Revenue added.";
        reload();
      } catch (err) {
        state.message = `✗ ${err.message}`;
        render(host, state._roster, state._scaleRoles, state);
        wireEvents(host, state, reload);
      }
    });
  });

  // Edit revenue (inline prompt)
  host.querySelectorAll("[data-action='edit-revenue']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const revId  = btn.dataset.revId;
      const label  = window.prompt("Revenue label:", btn.dataset.label || "");
      if (label === null) return;
      const amtStr = window.prompt("Annual amount (£):", btn.dataset.amount || "0");
      if (amtStr === null) return;
      try {
        await apiAdminUpdateRevenue(revId, { label: label.trim(), annual_amount: parseFloat(amtStr) });
        state.message = "✓ Revenue updated.";
        reload();
      } catch (err) {
        state.message = `✗ ${err.message}`;
        render(host, state._roster, state._scaleRoles, state);
        wireEvents(host, state, reload);
      }
    });
  });

  // Delete revenue
  host.querySelectorAll("[data-action='del-revenue']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!window.confirm("Delete this revenue entry?")) return;
      try {
        await apiAdminDeleteRevenue(btn.dataset.revId);
        state.message = "✓ Revenue deleted.";
        reload();
      } catch (err) {
        state.message = `✗ ${err.message}`;
        render(host, state._roster, state._scaleRoles, state);
        wireEvents(host, state, reload);
      }
    });
  });
}

export async function initPlayerbasePage(data) {
  const host = document.getElementById("playerbase-root") || document.querySelector("main.wrap");
  if (!host) return;

  if (!canAdminModOrSpeaker(data)) {
    host.innerHTML = `<p style="padding:2rem;font-size:1.2rem;color:var(--red,#c00);">Forbidden: Admin, Mod, or Speaker access required.</p>`;
    return;
  }

  const state = { search: "", message: "", _roster: [], _scaleRoles: {} };

  async function reload() {
    host.innerHTML = `<div class="muted-block">Loading…</div>`;
    try {
      const { roster, scaleRoles } = await apiGetPlayerbase();
      state._roster = roster || [];
      state._scaleRoles = scaleRoles || {};
      render(host, state._roster, state._scaleRoles, state);
      wireEvents(host, state, reload);
    } catch (err) {
      host.innerHTML = `<p style="color:#c00;">Failed to load playerbase: ${esc(err.message)}</p>`;
    }
  }

  await reload();
}
