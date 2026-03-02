import { esc, formatMPName, partyBadge, PARTY_COLOURS } from "../ui.js";
import { canAdminOrMod } from "../permissions.js";
import { apiGetOffices, apiGetCharacters, apiAssignOffice, apiUnassignOffice, apiGetParliamentStatus, apiUpdateParliamentStatus, apiGetCanonicalParties } from "../api.js";
import { isLoggedIn } from "../core.js";

const OFFICE_SPECS = [
  { id: "prime-minister", title: "Prime Minister, First Lord of the Treasury, and Minister for the Civil Service", short: "Prime Minister" },
  { id: "chancellor", title: "Chancellor of the Exchequer, and Second Lord of the Treasury", short: "Chancellor" },
  { id: "home", title: "Secretary of State for the Home Department", short: "Home Secretary" },
  { id: "foreign", title: "Secretary of State for Foreign and Commonwealth Affairs", short: "Foreign Secretary" },
  { id: "trade", title: "Secretary of State for Business and Trade, and President of the Board of Trade", short: "Business & Trade" },
  { id: "defence", title: "Secretary of State for Defence", short: "Defence Secretary" },
  { id: "welfare", title: "Secretary of State for Work and Pensions", short: "Work & Pensions" },
  { id: "education", title: "Secretary of State for Education", short: "Education Secretary" },
  { id: "env-agri", title: "Secretary of State for the Environment and Agriculture", short: "Environment & Agriculture" },
  { id: "health", title: "Secretary of State for Health and Social Care", short: "Health & Social" },
  { id: "eti", title: "Secretary of State for Transport and Infrastructure", short: "Transport & Infrastructure" },
  { id: "culture", title: "Secretary of State for Culture, Media and Sport", short: "Culture, Media & Sport" },
  { id: "home-nations", title: "Secretary of State for the Home Nations", short: "Home Nations" },
  { id: "leader-commons", title: "Leader of the House of Commons", short: "Leader of the House" }
];

function normaliseGovernment(data) {
  data.government ??= {};
  data.government.offices ??= OFFICE_SPECS.map((o) => ({ id: o.id, holderName: "", holderAvatar: "" }));

  const byId = new Map((data.government.offices || []).map((o) => [o.id, o]));
  data.government.offices = OFFICE_SPECS.map((spec) => {
    const existing = byId.get(spec.id) || {};
    return {
      id: spec.id,
      holderName:        String(existing.holderName        || "").trim(),
      holderDisplayName: String(existing.holderDisplayName || "").trim(),
      holderAvatar:      String(existing.holderAvatar      || "").trim(),
      holderParty:       String(existing.holderParty       || "").trim(),
      // Preserve DB-backed fields set by initGovernmentPage so save handler works
      dbOfficeId:   existing.dbOfficeId   || null,
      holderCharId: existing.holderCharId || null,
    };
  });

  data.government.activeCharacters ??= [];

  // Seed defaults from QT holders if available.
  const known = new Set(data.government.activeCharacters.map((c) => c.name));
  const qtOffices = Array.isArray(data.questionTime?.offices) ? data.questionTime.offices : [];
  for (const office of qtOffices) {
    if (!office?.holder || known.has(office.holder)) continue;
    data.government.activeCharacters.push({
      name: office.holder,
      avatar: "",
      active: true
    });
    known.add(office.holder);
  }

  // Ensure current character exists in active roster.
  const currentName = String(data.currentCharacter?.name || "").trim();
  if (currentName && !known.has(currentName)) {
    data.government.activeCharacters.push({ name: currentName, avatar: "", active: true });
  }

  for (const c of data.government.activeCharacters) {
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
  return new Map((data.government?.offices || []).map((o) => [o.id, o]));
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

function getGoverningParties(data) {
  // Prefer explicit parliament_status governing parties; fall back to PM's party.
  const fromParl = Array.isArray(data._parlStatus?.governingParties) ? data._parlStatus.governingParties.filter(Boolean) : [];
  if (fromParl.length) return fromParl;
  const pm = getOfficeMap(data).get("prime-minister");
  const pmParty = String(pm?.holderParty || "").trim();
  return pmParty ? [pmParty] : [];
}

function getActiveCharacterChoices(data, partyFilter = []) {
  // DB characters (fetched in initGovernmentPage) are the live source of truth.
  // The state-based roster is belt-and-braces fallback only.
  const all = Array.isArray(data._dbCharacters) && data._dbCharacters.length
    ? data._dbCharacters.filter((c) => c.name)
    : (Array.isArray(data.government?.activeCharacters)
        ? data.government.activeCharacters.filter((c) => c.name && c.active)
        : []);
  const parties = Array.isArray(partyFilter) ? partyFilter.filter(Boolean) : (partyFilter ? [partyFilter] : []);
  const filtered = parties.length ? all.filter((c) => parties.includes(String(c.party || ""))) : all;
  return filtered.sort((a, b) => a.name.localeCompare(b.name));
}

function canEditOffice(data, officeId) {
  if (canAdminOrMod(data)) return true;
  if (officeId === "prime-minister") return false;
  const pm = getOfficeMap(data).get("prime-minister");
  return !!pm?.holderName && pm.holderName === getCurrentName(data);
}

function applyAssignmentEffects(data) {
  const officeMap = getOfficeMap(data);

  // Synchronise Question Time office holders.
  if (Array.isArray(data.questionTime?.offices)) {
    for (const qt of data.questionTime.offices) {
      const gov = officeMap.get(qt.id);
      if (gov) qt.holder = gov.holderName || "Vacant";
    }
  }

  // Clear all office roles on players then reassign from government mapping.
  if (Array.isArray(data.players)) {
    for (const p of data.players) {
      if (p && typeof p === "object") {
        p.office = null;
        p.offices = [];
      }
    }
    for (const office of data.government.offices) {
      if (!office.holderName) continue;
      const player = data.players.find((p) => p?.name === office.holderName);
      if (player) {
        if (!Array.isArray(player.offices)) player.offices = [];
        player.offices.push(office.id);
        player.office = player.offices[0];
        if (office.id === "prime-minister") player.role = "prime-minister";
      }
    }
  }

  if (data.currentCharacter?.name) {
    const heldOffices = (data.government.offices || [])
      .filter((o) => o.holderName === data.currentCharacter.name)
      .map((o) => o.id);
    data.currentCharacter.offices = heldOffices;
    data.currentCharacter.office  = heldOffices[0] || null;
  }
}

function render(data, state) {
  const host = document.getElementById("government-root") || document.querySelector("main.wrap");
  if (!host) return;

  normaliseGovernment(data);
  const officeMap = getOfficeMap(data);
  const governingParties = getGoverningParties(data);
  const csParties = Array.isArray(data._parlStatus?.confidenceSupplyParties) ? data._parlStatus.confidenceSupplyParties.filter(Boolean) : [];
  const govType = data._parlStatus?.governmentType || "Majority";
  const choices = getActiveCharacterChoices(data, governingParties);
  const manager = canAdminOrMod(data);
  const pmHolder = officeMap.get("prime-minister")?.holderName || "";
  const isPM = !!pmHolder && pmHolder === getCurrentName(data);
  const canonicalParties = Array.isArray(data._canonicalParties) ? data._canonicalParties : [];

  const GOV_TYPES = ["Majority", "Minority", "Coalition", "Confidence and Supply"];

  host.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Government of the United Kingdom</div></div>

    ${manager ? `
    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Government Formation</h2>
      <p class="muted" style="margin-bottom:10px;">Select the type of government and which parties form it. The office assignment dropdowns will be filtered to members of the governing parties.</p>
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;margin-bottom:10px;">
        <div>
          <label class="label" for="gov-type-select">Government type</label>
          <select id="gov-type-select" class="input" style="min-width:200px;">
            ${GOV_TYPES.map((t) => `<option value="${esc(t)}" ${t === govType ? "selected" : ""}>${esc(t)}</option>`).join("")}
          </select>
        </div>
        <div>
          <div class="label" style="margin-bottom:6px;">Governing parties</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${canonicalParties.filter((p) => p.name !== "Speaker").map((p) => {
              const colours = PARTY_COLOURS[p.name] || { bg: "#888", fg: "#fff" };
              const checked = governingParties.includes(p.name);
              return `<label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;padding:3px 8px;border-radius:4px;border:2px solid ${esc(colours.bg)};background:${checked ? esc(colours.bg) : "#fff"};color:${checked ? esc(colours.fg) : esc(colours.bg)};font-weight:600;font-size:.85em;white-space:nowrap;">
                <input type="checkbox" name="gov-party" value="${esc(p.name)}" ${checked ? "checked" : ""} style="position:absolute;opacity:0;pointer-events:none;">
                ${esc(p.short_name || p.name)}
              </label>`;
            }).join("")}
          </div>
        </div>
        <div>
          <div class="label" style="margin-bottom:6px;">Confidence &amp; Supply parties</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${canonicalParties.filter((p) => p.name !== "Speaker").map((p) => {
              const colours = PARTY_COLOURS[p.name] || { bg: "#888", fg: "#fff" };
              const checked = csParties.includes(p.name);
              return `<label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;padding:3px 8px;border-radius:4px;border:2px solid ${esc(colours.bg)};background:${checked ? esc(colours.bg) : "#fff"};color:${checked ? esc(colours.fg) : esc(colours.bg)};font-weight:600;font-size:.85em;white-space:nowrap;">
                <input type="checkbox" name="cs-party" value="${esc(p.name)}" ${checked ? "checked" : ""} style="position:absolute;opacity:0;pointer-events:none;">
                ${esc(p.short_name || p.name)}
              </label>`;
            }).join("")}
          </div>
        </div>
      </div>
      <button id="gov-formation-save" type="button" class="btn">Save Formation</button>
      ${state.formationMessage ? `<p class="muted" style="margin-top:6px;">${esc(state.formationMessage)}</p>` : ""}
    </section>
    ` : ""}

    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">How appointments work</h2>
      <p class="muted" style="margin-bottom:8px;">Mods/Admins appoint the Prime Minister from active characters. The Prime Minister then appoints all other offices from active characters.</p>
      <p class="muted" style="margin:0;">Editing rights: ${manager ? "You are a moderator/admin (full edit access)." : isPM ? "You are the Prime Minister (you can appoint all non-PM offices)." : "View-only mode."}</p>
      ${governingParties.length ? `<p style="margin:8px 0 0;">Government (${esc(govType)}): ${governingParties.map(partyBadge).join(" ")}</p>` : ""}
      ${csParties.length ? `<p style="margin:4px 0 0;">Confidence &amp; Supply: ${csParties.map(partyBadge).join(" ")}</p>` : ""}
    </section>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Current Government</h2>
      <div style="display:grid;gap:10px;">
        ${OFFICE_SPECS.map((spec) => {
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
                  <label class="label" for="assign-${esc(spec.id)}">Character</label>
                  <select class="input" id="assign-${esc(spec.id)}" data-role="office-select" data-office-id="${esc(spec.id)}">
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

      ${(manager || isPM) ? `<div style="margin-top:10px;"><button id="gov-save" type="button" class="btn">Save Appointments</button></div>` : ""}
      ${state.message ? `<p class="muted" style="margin-top:8px;">${esc(state.message)}</p>` : ""}
    </section>

  `;

  // Wire up party-badge toggle behaviour for formation checkboxes (visual toggle).
  host.querySelectorAll('input[name="gov-party"], input[name="cs-party"]').forEach((cb) => {
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

  host.querySelector("#gov-formation-save")?.addEventListener("click", async () => {
    const btn = host.querySelector("#gov-formation-save");
    if (btn) btn.disabled = true;
    try {
      const govTypeVal = host.querySelector("#gov-type-select")?.value || "Majority";
      const newGovParties = [...host.querySelectorAll('input[name="gov-party"]:checked')].map((el) => el.value);
      const newCsParties = [...host.querySelectorAll('input[name="cs-party"]:checked')].map((el) => el.value);
      const currentOppParties = Array.isArray(data._parlStatus?.oppositionParties) ? data._parlStatus.oppositionParties : [];
      await apiUpdateParliamentStatus({ governmentType: govTypeVal, governingParties: newGovParties, confidenceSupplyParties: newCsParties, oppositionParties: currentOppParties });
      await initGovernmentPage(data, { message: state.message || "", formationMessage: "Government formation saved." });
    } catch (err) {
      if (btn) btn.disabled = false;
      console.error("[gov-formation-save]", err);
      alert(`Error saving formation: ${err.message}`);
    }
  });

  host.querySelector("#gov-save")?.addEventListener("click", async () => {
    const btn = host.querySelector("#gov-save");
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
      console.error("[gov-save]", err);
    }
    // Re-render always replaces the DOM (fresh enabled button); re-enable old ref as fallback
    await initGovernmentPage(data, newState).catch(() => { if (btn) btn.disabled = false; });
  });


}

export async function initGovernmentPage(data, renderState = { message: "" }) {
  normaliseGovernment(data);

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
      // Non-critical: fall back to state-based government data
    }
  }

  applyAssignmentEffects(data);
  render(data, renderState);
}
