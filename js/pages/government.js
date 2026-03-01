import { esc, formatMPName } from "../ui.js";
import { canAdminOrMod } from "../permissions.js";
import { apiGetOffices, apiGetCharacters, apiAssignOffice, apiUnassignOffice } from "../api.js";

const PARTY_COLOURS = {
  "Conservative":     { bg: "#003e7e", fg: "#ffffff" },
  "Labour":           { bg: "#cc0000", fg: "#ffffff" },
  "Liberal Democrat": { bg: "#fdbb30", fg: "#000000" },
  "Liberal Democrats":{ bg: "#fdbb30", fg: "#000000" },
  "Green":            { bg: "#00843d", fg: "#ffffff" },
  "SNP":              { bg: "#fff200", fg: "#000000" },
  "Plaid Cymru":      { bg: "#3f8428", fg: "#ffffff" },
  "DUP":              { bg: "#d46a00", fg: "#ffffff" },
  "Sinn Féin":        { bg: "#326760", fg: "#ffffff" },
  "SDLP":             { bg: "#2aa82c", fg: "#ffffff" },
  "UUP":              { bg: "#48a5ee", fg: "#ffffff" },
  "Independent":      { bg: "#888888", fg: "#ffffff" },
};

function partyBadge(partyName) {
  if (!partyName) return "";
  const colours = PARTY_COLOURS[partyName] || { bg: "#888888", fg: "#ffffff" };
  return `<span style="display:inline-block;padding:1px 7px;border-radius:3px;font-size:.8em;font-weight:600;background:${colours.bg};color:${colours.fg};">${esc(partyName)}</span>`;
}

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

function isManager(data) {
  return canAdminOrMod(data);
}

function normaliseGovernment(data) {
  data.government ??= {};
  data.government.offices ??= OFFICE_SPECS.map((o) => ({ id: o.id, holderName: "", holderAvatar: "" }));

  const byId = new Map((data.government.offices || []).map((o) => [o.id, o]));
  data.government.offices = OFFICE_SPECS.map((spec) => {
    const existing = byId.get(spec.id) || {};
    return {
      id: spec.id,
      holderName:   String(existing.holderName   || "").trim(),
      holderAvatar: String(existing.holderAvatar || "").trim(),
      holderParty:  String(existing.holderParty  || "").trim(),
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

function getActiveCharacterChoices(data) {
  // DB characters (fetched in initGovernmentPage) are the live source of truth.
  // The state-based roster is belt-and-braces fallback only.
  if (Array.isArray(data._dbCharacters) && data._dbCharacters.length) {
    return data._dbCharacters
      .filter((c) => c.name)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  const fromGov = Array.isArray(data.government?.activeCharacters)
    ? data.government.activeCharacters.filter((c) => c.name && c.active)
    : [];
  return fromGov.sort((a, b) => a.name.localeCompare(b.name));
}

function canEditOffice(data, officeId) {
  if (isManager(data)) return true;
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
  const choices = getActiveCharacterChoices(data);
  const manager = isManager(data);
  const pmHolder = officeMap.get("prime-minister")?.holderName || "";
  const isPM = !!pmHolder && pmHolder === getCurrentName(data);

  host.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Government of the United Kingdom</div></div>

    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">How appointments work</h2>
      <p class="muted" style="margin-bottom:8px;">Mods/Admins appoint the Prime Minister from active characters. The Prime Minister then appoints all other offices from active characters.</p>
      <p class="muted" style="margin:0;">Editing rights: ${manager ? "You are a moderator/admin (full edit access)." : isPM ? "You are the Prime Minister (you can appoint all non-PM offices)." : "View-only mode."}</p>
    </section>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Current Government</h2>
      <div style="display:grid;gap:10px;">
        ${OFFICE_SPECS.map((spec) => {
          const office = officeMap.get(spec.id) || {};
          const name = office.holderName || "Vacant";
          const avatar = avatarFromCharacterProfile(data, office.holderName) || office.holderAvatar || "";
          const editable = canEditOffice(data, spec.id);
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
                    ${choices.map((c) => `<option value="${esc(c.id)}" ${c.id === office.holderCharId ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
                  </select>
                ` : office.holderName ? `
                  <div style="font-weight:700;text-align:center;">${esc(formatMPName(office.holderName, { appendMP: true }))}</div>
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

  // Merge live office assignments from the DB (single source of truth).
  try {
    const [{ offices: dbOffices }, { characters: dbChars }] = await Promise.all([
      apiGetOffices(),
      apiGetCharacters({ active: "true" }),
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
          stateOffice.holderName   = char.name;
          stateOffice.holderCharId = char.id;
          stateOffice.holderParty  = char.party || "";
          stateOffice.holderAvatar = char.avatar || "";
        }
      } else {
        stateOffice.holderName   = "";
        stateOffice.holderCharId = null;
        stateOffice.holderParty  = "";
        stateOffice.holderAvatar = "";
      }
    }
    data._dbCharacters = dbChars || [];
  } catch {
    // Non-critical: fall back to state-based government data
  }

  applyAssignmentEffects(data);
  render(data, renderState);
}
