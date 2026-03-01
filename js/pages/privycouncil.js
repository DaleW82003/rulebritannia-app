// js/pages/privycouncil.js
import { esc, formatMPName } from "../ui.js";
import { canAdminOrMod } from "../permissions.js";
import { apiGetPrivyCouncil, apiAppointPrivyCouncillor, apiRemovePrivyCouncillor, apiGetCharacters } from "../api.js";

function render(members, data, state, manager) {
  const host = document.getElementById("privy-council-root") || document.querySelector("main.wrap");
  if (!host) return;

  host.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">His Majesty's Most Honourable Privy Council</div></div>

    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">About the Privy Council</h2>
      <p class="muted" style="margin-bottom:8px;">The Privy Council is a permanent advisory body to the Sovereign. Membership is for life. Privy Councillors are addressed as <em>The Right Honourable</em>.</p>
      <p class="muted" style="margin:0;">Access to this page is restricted to Privy Councillors and staff (admin/mod/speaker).</p>
    </section>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Members (${members.length})</h2>
      ${members.length === 0 ? `<p class="muted">No Privy Councillors have been appointed yet.</p>` : `
        <div style="display:grid;gap:8px;">
          ${members.map((m) => `
            <article class="tile" style="display:grid;grid-template-columns:48px 1fr auto;gap:10px;align-items:center;">
              <div>
                ${m.character_avatar ? `<img src="${esc(m.character_avatar)}" alt="${esc(m.character_name)}" style="width:40px;height:40px;object-fit:cover;border-radius:6px;">` : `<div class="muted-block" style="width:40px;height:40px;display:grid;place-items:center;padding:0;">👤</div>`}
              </div>
              <div>
                <div style="font-weight:700;">${esc(m.character_display_name || formatMPName(m.character_name, { isPrivy: true }))}</div>
                <div class="muted" style="font-size:0.85em;">${esc(m.character_party || "")}${m.reason ? ` — ${esc(m.reason)}` : ""}</div>
                <div class="muted" style="font-size:0.8em;">Appointed: ${new Date(m.appointed_at).toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" })}</div>
              </div>
              ${manager ? `
              <div>
                <button class="btn btn-danger" data-action="remove" data-char-id="${esc(m.character_id)}" data-char-name="${esc(m.character_name)}" style="font-size:0.8em;padding:4px 10px;">Remove</button>
              </div>` : "<div></div>"}
            </article>
          `).join("")}
        </div>
      `}
    </section>

    ${manager ? `
    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Appoint a New Privy Councillor</h2>
      <div style="display:grid;gap:8px;max-width:420px;">
        <label class="label" for="pc-char-select">Character</label>
        <select class="input" id="pc-char-select">
          <option value="">— select character —</option>
        </select>
        <label class="label" for="pc-reason">Reason (optional)</label>
        <input class="input" id="pc-reason" type="text" maxlength="500" placeholder="e.g. Party leader, PM, etc.">
        <button id="pc-appoint-btn" type="button" class="btn">Appoint</button>
        ${state.message ? `<p class="muted">${esc(state.message)}</p>` : ""}
      </div>
    </section>
    ` : (state.message ? `<p class="muted">${esc(state.message)}</p>` : "")}
  `;

  // Populate character select
  if (manager) {
    const select = host.querySelector("#pc-char-select");
    if (select && Array.isArray(data._dbCharacters)) {
      const alreadyIn = new Set(members.map((m) => m.character_id));
      for (const c of data._dbCharacters.filter((c) => !alreadyIn.has(c.id)).sort((a, b) => a.name.localeCompare(b.name))) {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = c.name;
        select.appendChild(opt);
      }
    }

    host.querySelector("#pc-appoint-btn")?.addEventListener("click", async () => {
      const charId = host.querySelector("#pc-char-select")?.value || "";
      const reason = host.querySelector("#pc-reason")?.value || "";
      if (!charId) return;
      try {
        await apiAppointPrivyCouncillor(charId, reason);
        await initPrivyCouncilPage(data, { message: "Appointed successfully." });
      } catch (err) {
        await initPrivyCouncilPage(data, { message: `Error: ${err.message}` });
      }
    });

    host.querySelectorAll("[data-action='remove']").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const charId   = btn.dataset.charId;
        const charName = btn.dataset.charName;
        if (!confirm(`Remove ${charName} from the Privy Council?`)) return;
        try {
          await apiRemovePrivyCouncillor(charId);
          await initPrivyCouncilPage(data, { message: "Removed from Privy Council." });
        } catch (err) {
          // If blocked due to permanent qualifying office, offer a force-remove option
          if (err.message?.includes("permanent qualifying office")) {
            if (confirm(`${err.message}\n\nDo you want to force-remove this member (use only for mistaken appointments)?`)) {
              try {
                await apiRemovePrivyCouncillor(charId, { force: true });
                await initPrivyCouncilPage(data, { message: "Force-removed from Privy Council." });
              } catch (err2) {
                await initPrivyCouncilPage(data, { message: `Error: ${err2.message}` });
              }
            }
          } else {
            await initPrivyCouncilPage(data, { message: `Error: ${err.message}` });
          }
        }
      });
    });
  }
}

export async function initPrivyCouncilPage(data, renderState = { message: "" }) {
  const host = document.getElementById("privy-council-root") || document.querySelector("main.wrap");
  const manager = canAdminOrMod(data);

  try {
    const [pcResult, charsResult] = await Promise.all([
      apiGetPrivyCouncil(),
      manager ? apiGetCharacters({ active: "true" }) : Promise.resolve({ characters: [] }),
    ]);
    const members = pcResult.members || [];
    if (manager) data._dbCharacters = charsResult.characters || [];
    render(members, data, renderState, manager);
  } catch (err) {
    if (host) {
      host.innerHTML = `<section class="tile"><p class="muted">${err.message?.includes("Access restricted") || err.message?.includes("403") ? "This page is restricted to Privy Councillors and staff." : `Error loading Privy Council: ${esc(err.message)}`}</p></section>`;
    }
  }
}
