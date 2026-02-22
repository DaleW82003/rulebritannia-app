import { saveState } from "../core.js";
import { esc } from "../ui.js";
import { isAdmin, isMod, canAdminOrMod } from "../permissions.js";

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

function isManager(data) {
  return canAdminOrMod(data);
}

function normaliseOpposition(data) {
  data.opposition ??= {};
  data.opposition.offices ??= SHADOW_OFFICE_SPECS.map((o) => ({ id: o.id, holderName: "", holderAvatar: "" }));
  data.opposition.activeCharacters ??= [];

  const byId = new Map((data.opposition.offices || []).map((o) => [o.id, o]));
  data.opposition.offices = SHADOW_OFFICE_SPECS.map((spec) => {
    const existing = byId.get(spec.id) || {};
    return {
      id: spec.id,
      holderName: String(existing.holderName || "").trim(),
      holderAvatar: String(existing.holderAvatar || "").trim()
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

function getChoices(data) {
  const list = Array.isArray(data.opposition?.activeCharacters)
    ? data.opposition.activeCharacters.filter((c) => c.name && c.active)
    : [];
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

function canEditOffice(data, officeId) {
  if (isManager(data)) return true;
  if (officeId === "leader-opposition") return false;
  const leader = getOfficeMap(data).get("leader-opposition");
  return !!leader?.holderName && leader.holderName === getCurrentName(data);
}

function applyAssignmentEffects(data) {
  if (Array.isArray(data.players)) {
    for (const p of data.players) {
      if (p && typeof p === "object") p.shadowOffice = null;
    }
    for (const office of data.opposition.offices) {
      if (!office.holderName) continue;
      const player = data.players.find((p) => p?.name === office.holderName);
      if (player) {
        player.shadowOffice = office.id;
        if (office.id === "leader-opposition") player.role = "leader-opposition";
      }
    }
  }

  if (data.currentCharacter?.name) {
    const held = data.opposition.offices.find((o) => o.holderName === data.currentCharacter.name);
    data.currentCharacter.shadowOffice = held ? held.id : null;
  }
}

function render(data, state) {
  const host = document.getElementById("opposition-root") || document.querySelector("main.wrap");
  if (!host) return;

  normaliseOpposition(data);
  const officeMap = getOfficeMap(data);
  const choices = getChoices(data);
  const manager = isManager(data);
  const leaderHolder = officeMap.get("leader-opposition")?.holderName || "";
  const isLeader = !!leaderHolder && leaderHolder === getCurrentName(data);

  host.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Official Opposition of the United Kingdom</div></div>

    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">How appointments work</h2>
      <p class="muted" style="margin-bottom:8px;">Mods/Admins appoint the Leader of the Opposition from active characters. The Leader of the Opposition then appoints all other shadow offices from active characters.</p>
      <p class="muted" style="margin:0;">Editing rights: ${manager ? "You are a moderator/admin (full edit access)." : isLeader ? "You are the Leader of the Opposition (you can appoint all non-Leader offices)." : "View-only mode."}</p>
    </section>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Current Official Opposition</h2>
      <div style="display:grid;gap:10px;">
        ${SHADOW_OFFICE_SPECS.map((spec) => {
          const office = officeMap.get(spec.id) || {};
          const name = office.holderName || "Vacant";
          const avatar = avatarFromCharacterProfile(data, office.holderName) || office.holderAvatar || "";
          const editable = canEditOffice(data, spec.id);
          return `
            <article class="tile" style="display:grid;grid-template-columns:minmax(260px,2fr) minmax(220px,2fr) 84px;gap:10px;align-items:center;">
              <div>
                <div><b>${esc(spec.short)}</b></div>
                <div class="muted">${esc(spec.title)}</div>
              </div>
              <div>
                ${editable ? `
                  <label class="label" for="opp-assign-${esc(spec.id)}">Character</label>
                  <select class="input" id="opp-assign-${esc(spec.id)}" data-role="office-select" data-office-id="${esc(spec.id)}">
                    <option value="">Vacant</option>
                    ${choices.map((c) => `<option value="${esc(c.name)}" ${c.name === office.holderName ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
                  </select>
                ` : `<div><b>${esc(name)}</b></div>`}
              </div>
              <div style="justify-self:end;">
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

  host.querySelector("#opp-save")?.addEventListener("click", () => {
    for (const el of host.querySelectorAll('[data-role="office-select"]')) {
      const officeId = String(el.dataset.officeId || "");
      if (!canEditOffice(data, officeId)) continue;
      const selectedName = String(el.value || "").trim();
      const office = officeMap.get(officeId);
      if (!office) continue;
      office.holderName = selectedName;
      office.holderAvatar = avatarFromCharacterProfile(data, selectedName) || "";
    }

    applyAssignmentEffects(data);
    saveState(data);
    state.message = "Appointments saved.";
    render(data, state);
  });


}

export function initOppositionPage(data) {
  normaliseOpposition(data);
  applyAssignmentEffects(data);
  saveState(data);
  render(data, { message: "" });
}
