import { esc, formatMPName, partyBadge, PARTY_COLOURS } from "../ui.js";
import { canAdminOrMod } from "../permissions.js";
import { apiGetOffices, apiGetCharacters, apiAssignOffice, apiUnassignOffice, apiGetParliamentStatus, apiUpdateParliamentStatus, apiGetCanonicalParties } from "../api.js";
import { isLoggedIn } from "../core.js";

const SHADOW_OFFICE_SPECS = [
  { id: "leader-opposition", title: "Leader of the Opposition (who appoints all others)", short: "Leader of the Opposition" },
  { id: "shadow-chancellor", title: "Shadow Chancellor of the Exchequer", short: "Shadow Chancellor" },
  { id: "shadow-home", title: "Shadow Secretary of State for the Home Department", short: "Shadow Home" },
  { id: "shadow-foreign", title: "Shadow Secretary of State for Foreign and Commonwealth Affairs", short: "Shadow Foreign" },
  { id: "shadow-trade", title: "Shadow Secretary of State for Business and Trade, and President of the Board of Trade", short: "Shadow Business & Trade" },
  { id: "shadow-defence", title: "Shadow Secretary of State for Defence", short: "Shadow Defence" },
  { id: "shadow-welfare", title: "Shadow Secretary of State for Work and Pensions", short: "Shadow Work & Pensions" },
  { id: "shadow-education", title: "Shadow Secretary of State for Education", short: "Shadow Education" },
  { id: "shadow-env-agri", title: "Shadow Secretary of State for the Environment and Agriculture", short: "Shadow Environment & Agriculture" },
  { id: "shadow-health", title: "Shadow Secretary of State for Health and Social Care", short: "Shadow Health & Social" },
  { id: "shadow-eti", title: "Shadow Secretary of State for Transport and Infrastructure", short: "Shadow Transport & Infrastructure" },
  { id: "shadow-culture", title: "Shadow Secretary of State for Culture, Media and Sport", short: "Shadow Culture, Media & Sport" },
  { id: "shadow-home-nations", title: "Shadow Secretary of State for the Home Nations", short: "Shadow Home Nations" },
  { id: "shadow-leader-commons", title: "Shadow Leader of the House of Commons", short: "Shadow Leader of the House" }
];

function normaliseOpposition(data) {
  data.opposition ??= {};
  data.opposition.offices ??= SHADOW_OFFICE_SPECS.map((o) => ({ id: o.id, holderName: "", holderAvatar: "" }));
  data.opposition.activeCharacters ??= [];

  const byId = new Map((data.opposition.offices || []).map((o) => [o.id, o]));
  data.opposition.offices = SHADOW_OFFICE_SPECS.map((spec) => {
    const existing = byId.get(spec.id) || {};
    return {
      id: spec.id,
      holderName:        String(existing.holderName        || "").trim(),
      holderDisplayName: String(existing.holderDisplayName || "").trim(),
      holderAvatar:      String(existing.holderAvatar      || "").trim(),
      holderParty:       String(existing.holderParty       || "").trim(),
      // Preserve DB-backed fields set by initOppositionPage so save handler works
      dbOfficeId:   existing.dbOfficeId   || null,
      holderCharId: existing.holderCharId || null,
    };
  });

  // Seed opposition roster from players as fallback.
  const known = new Set(data.opposition.activeCharacters.map((c) => c.name));
  const players = Array.isArray(data.players) ? data.players : [];
  for (const p of players) {
    if (!p?.name || known.has(p.name)) continue;
    data.opposition.activeCharacters.push({
      name: String(p.name),
      avatar: String(p.avatar || ""),
      active: p.active !== false
    });
    known.add(p.name);
  }

  const currentName = String(data.currentCharacter?.name || "").trim();
  if (currentName && !known.has(currentName)) {
    data.opposition.activeCharacters.push({ name: currentName, avatar: "", active: true });
  }

  for (const c of data.opposition.activeCharacters) {
    c.name = String(c.name || "").trim();
    c.avatar = String(c.avatar || "").trim();
    c.active = c.active !== false;
  }

  data.players ??= [];
}

function getCurrentName(data) {
  return String(data.currentCharacter?.name || data.currentPlayer?.name || "").trim();
}

function getOfficeMap(data) {
  return new Map((data.opposition?.offices || []).map((o) => [o.id, o]));
}


function avatarFromCharacterProfile(data, name) {
  const target = String(name || "").trim();
  if (!target) return "";

  const pools = [
    // DB characters are the live source of truth — checked first.
    ...(Array.isArray(data?._dbCharacters) ? data._dbCharacters : []),
    ...(Array.isArray(data?.players) ? data.players : []),
    ...(Array.isArray(data?.government?.activeCharacters) ? data.government.activeCharacters : []),
    ...(Array.isArray(data?.opposition?.activeCharacters) ? data.opposition.activeCharacters : []),
    data?.currentCharacter,
    data?.currentPlayer
  ].filter(Boolean);

  for (const c of pools) {
    if (String(c?.name || "").trim() !== target) continue;
    const avatar = String(c?.avatar || "").trim();
    if (avatar) return avatar;
  }
  return "";
}

function getOppositionParties(data) {
  // Prefer explicit parliament_status opposition parties; fall back to leader's party.
  const fromParl = Array.isArray(data._parlStatus?.oppositionParties) ? data._parlStatus.oppositionParties.filter(Boolean) : [];
  if (fromParl.length) return fromParl;
  const leader = getOfficeMap(data).get("leader-opposition");
  const leaderParty = String(leader?.holderParty || "").trim();
  return leaderParty ? [leaderParty] : [];
}

function getChoices(data, partyFilter = []) {
  // DB characters (fetched in initOppositionPage) are the live source of truth.
  // The state-based roster is belt-and-braces fallback only.
  const all = Array.isArray(data._dbCharacters) && data._dbCharacters.length
    ? data._dbCharacters.filter((c) => c.name)
    : (Array.isArray(data.opposition?.activeCharacters)
        ? data.opposition.activeCharacters.filter((c) => c.name && c.active)
        : []);
  const parties = Array.isArray(partyFilter) ? partyFilter.filter(Boolean) : (partyFilter ? [partyFilter] : []);
  const filtered = parties.length ? all.filter((c) => parties.includes(String(c.party || ""))) : all;
  return filtered.sort((a, b) => a.name.localeCompare(b.name));
}

function canEditOffice(data, officeId) {
  if (canAdminOrMod(data)) return true;
  if (officeId === "leader-opposition") return false;
  const leader = getOfficeMap(data).get("leader-opposition");
  return !!leader?.holderName && leader.holderName === getCurrentName(data);
}

function applyAssignmentEffects(data) {
  if (Array.isArray(data.players)) {
    for (const p of data.players) {
      if (p && typeof p === "object") {
        p.shadowOffice = null;
        p.shadowOffices = [];
      }
    }
    for (const office of data.opposition.offices) {
      if (!office.holderName) continue;
      const player = data.players.find((p) => p?.name === office.holderName);
      if (player) {
        if (!Array.isArray(player.shadowOffices)) player.shadowOffices = [];
        player.shadowOffices.push(office.id);
        player.shadowOffice = player.shadowOffices[0];
        if (office.id === "leader-opposition") player.role = "leader-opposition";
      }
    }
  }

  if (data.currentCharacter?.name) {
    const heldShadowOffices = (data.opposition.offices || [])
      .filter((o) => o.holderName === data.currentCharacter.name)
      .map((o) => o.id);
    data.currentCharacter.shadowOffices = heldShadowOffices;
    data.currentCharacter.shadowOffice  = heldShadowOffices[0] || null;
  }
}

function render(data, state) {
  const host = document.getElementById("opposition-root") || document.querySelector("main.wrap");
  if (!host) return;

  normaliseOpposition(data);
  const officeMap = getOfficeMap(data);
  const oppositionParties = getOppositionParties(data);
  const choices = getChoices(data, oppositionParties);
  const manager = canAdminOrMod(data);
  const leaderHolder = officeMap.get("leader-opposition")?.holderName || "";
  const isLeader = !!leaderHolder && leaderHolder === getCurrentName(data);
  const canonicalParties = Array.isArray(data._canonicalParties) ? data._canonicalParties : [];

  host.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Official Opposition of the United Kingdom</div></div>

    ${manager ? `
    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Official Opposition Parties</h2>
      <p class="muted" style="margin-bottom:10px;">Select which parties form the Official Opposition. The office assignment dropdowns will be filtered to members of these parties.</p>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
        ${canonicalParties.filter((p) => p.name !== "Speaker").map((p) => {
          const colours = PARTY_COLOURS[p.name] || { bg: "#888", fg: "#fff" };
          const checked = oppositionParties.includes(p.name);
          return `<label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;padding:3px 8px;border-radius:4px;border:2px solid ${esc(colours.bg)};background:${checked ? esc(colours.bg) : "#fff"};color:${checked ? esc(colours.fg) : esc(colours.bg)};font-weight:600;font-size:.85em;white-space:nowrap;">
            <input type="checkbox" name="opp-party" value="${esc(p.name)}" ${checked ? "checked" : ""} style="position:absolute;opacity:0;pointer-events:none;">
            ${esc(p.short_name || p.name)}
          </label>`;
        }).join("")}
      </div>
      <button id="opp-parties-save" type="button" class="btn">Save Opposition Parties</button>
      ${state.partiesMessage ? `<p class="muted" style="margin-top:6px;">${esc(state.partiesMessage)}</p>` : ""}
    </section>
    ` : ""}

    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">How appointments work</h2>
      <p class="muted" style="margin-bottom:8px;">Mods/Admins appoint the Leader of the Opposition from active characters. The Leader of the Opposition then appoints all other shadow offices from active characters.</p>
      <p class="muted" style="margin:0;">Editing rights: ${manager ? "You are a moderator/admin (full edit access)." : isLeader ? "You are the Leader of the Opposition (you can appoint all non-Leader offices)." : "View-only mode."}</p>
      ${oppositionParties.length ? `<p style="margin:8px 0 0;">Official Opposition: ${oppositionParties.map(partyBadge).join(" ")}</p>` : ""}
    </section>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Current Official Opposition</h2>
      <div style="display:grid;gap:10px;">
        ${SHADOW_OFFICE_SPECS.map((spec) => {
          const office = officeMap.get(spec.id) || {};
          const name = office.holderName || "Vacant";
          const avatar = avatarFromCharacterProfile(data, office.holderName) || office.holderAvatar || "";
          const editable = canEditOffice(data, spec.id);
          const displayName = office.holderDisplayName || (office.holderName ? formatMPName(office.holderName, { appendMP: true }) : "");
          return `
            <article class="tile" style="display:grid;grid-template-columns:minmax(260px,2fr) minmax(220px,2fr) 84px;gap:10px;align-items:center;">
              <div>
                <div><b>${esc(spec.title)}</b></div>
              </div>
              <div>
                ${editable ? `
                  <label class="label" for="opp-assign-${esc(spec.id)}">Character</label>
                  <select class="input" id="opp-assign-${esc(spec.id)}" data-role="office-select" data-office-id="${esc(spec.id)}">
                    <option value="">Vacant</option>
                    ${choices.map((c) => `<option value="${esc(c.id)}" ${c.id === office.holderCharId ? "selected" : ""}>${esc(c.name)}${c.party ? ` (${esc(c.party)})` : ""}</option>`).join("")}
                  </select>
                ` : displayName ? `
                  <div style="font-weight:700;text-align:center;">${esc(displayName)}</div>
                  ${office.holderParty ? `<div style="text-align:center;margin-top:2px;">${partyBadge(office.holderParty)}</div>` : ""}
                ` : `
                  <div style="text-align:center;color:var(--muted,#888);font-style:italic;">Vacant</div>
                `}
              </div>
              <div style="justify-self:center;">
                ${avatar ? `<img src="${esc(avatar)}" alt="${esc(name)}" style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid #ddd;">` : `<div class="muted-block" style="width:72px;height:72px;display:grid;place-items:center;padding:0;">👤</div>`}
              </div>
            </article>
          `;
        }).join("")}
      </div>

      ${(manager || isLeader) ? `<div style="margin-top:10px;"><button id="opp-save" type="button" class="btn">Save Appointments</button></div>` : ""}
      ${state.message ? `<p class="muted" style="margin-top:8px;">${esc(state.message)}</p>` : ""}
    </section>

  `;

  // Wire up party-badge toggle behaviour for opposition party checkboxes.
  host.querySelectorAll('input[name="opp-party"]').forEach((cb) => {
    cb.addEventListener("change", () => {
      const label = cb.closest("label");
      if (!label) return;
      const partyName = cb.value;
      const colours = PARTY_COLOURS[partyName] || { bg: "#888", fg: "#fff" };
      if (cb.checked) {
        label.style.background = colours.bg;
        label.style.color = colours.fg;
      } else {
        label.style.background = "#fff";
        label.style.color = colours.bg;
      }
    });
  });

  host.querySelector("#opp-parties-save")?.addEventListener("click", async () => {
    const btn = host.querySelector("#opp-parties-save");
    if (btn) btn.disabled = true;
    try {
      const newOppParties = [...host.querySelectorAll('input[name="opp-party"]:checked')].map((el) => el.value);
      const currentGovType = data._parlStatus?.governmentType || "Majority";
      const currentGovParties = Array.isArray(data._parlStatus?.governingParties) ? data._parlStatus.governingParties : [];
      const currentCsParties = Array.isArray(data._parlStatus?.confidenceSupplyParties) ? data._parlStatus.confidenceSupplyParties : [];
      await apiUpdateParliamentStatus({ governmentType: currentGovType, governingParties: currentGovParties, confidenceSupplyParties: currentCsParties, oppositionParties: newOppParties });
      await initOppositionPage(data, { message: state.message || "", partiesMessage: "Opposition parties saved." });
    } catch (err) {
      if (btn) btn.disabled = false;
      console.error("[opp-parties-save]", err);
      alert(`Error saving opposition parties: ${err.message}`);
    }
  });

  host.querySelector("#opp-save")?.addEventListener("click", async () => {
    const btn = host.querySelector("#opp-save");
    if (btn) btn.disabled = true;
    const newState = { message: "" };
    try {
      for (const el of host.querySelectorAll('[data-role="office-select"]')) {
        const officeId = String(el.dataset.officeId || "");
        if (!canEditOffice(data, officeId)) continue;
        const selectedCharId = el.value || null;
        const office = officeMap.get(officeId);
        if (!office?.dbOfficeId) continue;
        const currentCharId = office.holderCharId || null;
        if (currentCharId === selectedCharId) continue;
        if (selectedCharId) {
          await apiAssignOffice(office.dbOfficeId, selectedCharId);
        } else if (currentCharId) {
          await apiUnassignOffice(office.dbOfficeId, currentCharId);
        }
      }
      newState.message = "Appointments saved.";
    } catch (err) {
      newState.message = `Error saving: ${err.message}`;
      console.error("[opp-save]", err);
    }
    // Re-render always replaces the DOM (fresh enabled button); re-enable old ref as fallback
    await initOppositionPage(data, newState).catch(() => { if (btn) btn.disabled = false; });
  });


}

export async function initOppositionPage(data, renderState = { message: "" }) {
  normaliseOpposition(data);

  if (isLoggedIn()) {
    // Merge live office assignments from the DB (single source of truth).
    try {
      const [{ offices: dbOffices }, { characters: dbChars }, parlStatus, { parties: canonicalParties }] = await Promise.all([
      apiGetOffices(),
      apiGetCharacters({ active: "true" }),
      apiGetParliamentStatus().catch(() => null),
      apiGetCanonicalParties().catch(() => ({ parties: [] })),
    ]);
    const charById = Object.fromEntries((dbChars || []).map((c) => [c.id, c]));
    const officeMap = getOfficeMap(data);
    for (const dbOffice of (dbOffices || [])) {
      // Match by spec_id (set by server seed on canonical offices)
      const stateOffice = officeMap.get(dbOffice.spec_id ?? "");
      if (!stateOffice) continue;
      stateOffice.dbOfficeId = dbOffice.id;
      const firstAssignment = (dbOffice.assignments || [])[0];
      if (firstAssignment) {
        const char = charById[firstAssignment.character_id];
        if (char) {
          stateOffice.holderName        = char.name;
          stateOffice.holderDisplayName = char.display_name || char.name;
          stateOffice.holderCharId      = char.id;
          stateOffice.holderParty       = char.party || "";
          stateOffice.holderAvatar      = char.avatar || "";
        }
      } else {
        stateOffice.holderName        = "";
        stateOffice.holderDisplayName = "";
        stateOffice.holderCharId      = null;
        stateOffice.holderParty       = "";
        stateOffice.holderAvatar      = "";
      }
    }
    data._dbCharacters = dbChars || [];
    if (parlStatus) data._parlStatus = parlStatus;
    data._canonicalParties = canonicalParties || [];
    } catch {
      // Non-critical: fall back to state-based opposition data
    }
  }

  applyAssignmentEffects(data);
  render(data, renderState);
}
