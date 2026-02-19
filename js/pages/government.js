import { saveData } from "../core.js";
import { esc } from "../ui.js";
import { isAdmin, isMod } from "../permissions.js";

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
  { id: "eti", title: "Secretary of State for Transport and Infrastructure", short: "Environment, Transport & Infrastructure" },
  { id: "culture", title: "Secretary of State for Culture, Media and Sport", short: "Culture, Media & Sport" },
  { id: "home-nations", title: "Secretary of State for the Home Nations", short: "Home Nations" },
  { id: "leader-commons", title: "Leader of the House of Commons", short: "Leader of the House" }
];

function isManager(data) {
  return isAdmin(data) || isMod(data);
}

function normaliseGovernment(data) {
  data.government ??= {};
  data.government.offices ??= OFFICE_SPECS.map((o) => ({ id: o.id, holderName: "", holderAvatar: "" }));

  const byId = new Map((data.government.offices || []).map((o) => [o.id, o]));
  data.government.offices = OFFICE_SPECS.map((spec) => {
    const existing = byId.get(spec.id) || {};
    return {
      id: spec.id,
      holderName: String(existing.holderName || "").trim(),
      holderAvatar: String(existing.holderAvatar || "").trim()
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

function getActiveCharacterChoices(data) {
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
      }
    }
    for (const office of data.government.offices) {
      if (!office.holderName) continue;
      const player = data.players.find((p) => p?.name === office.holderName);
      if (player) {
        player.office = office.id;
        if (office.id === "prime-minister") player.role = "prime-minister";
      }
    }
  }

  if (data.currentCharacter?.name) {
    const held = data.government.offices.find((o) => o.holderName === data.currentCharacter.name);
    data.currentCharacter.office = held ? held.id : null;
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
    <h1 class="page-title">Government of the United Kingdom</h1>

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
          const avatar = office.holderAvatar || "";
          const editable = canEditOffice(data, spec.id);
          return `
            <article class="tile" style="display:grid;grid-template-columns:minmax(260px,2fr) minmax(220px,2fr) 84px;gap:10px;align-items:center;">
              <div>
                <div><b>${esc(spec.short)}</b></div>
                <div class="muted">${esc(spec.title)}</div>
              </div>
              <div>
                ${editable ? `
                  <label class="label" for="assign-${esc(spec.id)}">Character</label>
                  <select class="input" id="assign-${esc(spec.id)}" data-role="office-select" data-office-id="${esc(spec.id)}">
                    <option value="">Vacant</option>
                    ${choices.map((c) => `<option value="${esc(c.name)}" ${c.name === office.holderName ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
                  </select>
                ` : `
                  <div><b>${esc(name)}</b></div>
                `}
              </div>
              <div style="justify-self:end;">
                ${avatar ? `<img src="${esc(avatar)}" alt="${esc(name)}" style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid #ddd;">` : `<div class="muted-block" style="width:72px;height:72px;display:grid;place-items:center;padding:0;">👤</div>`}
              </div>
            </article>
          `;
        }).join("")}
      </div>

      ${(manager || isPM) ? `<div style="margin-top:10px;"><button id="gov-save" type="button" class="btn">Save Appointments</button></div>` : ""}
      ${state.message ? `<p class="muted" style="margin-top:8px;">${esc(state.message)}</p>` : ""}
    </section>

    ${manager ? `
      <section class="panel">
        <h2 style="margin-top:0;">Active Character Roster (Moderator Control)</h2>
        <form id="active-char-form" style="display:grid;grid-template-columns:minmax(200px,1fr) minmax(200px,1fr) auto;gap:8px;align-items:end;">
          <div>
            <label class="label" for="active-char-name">Character Name</label>
            <input id="active-char-name" class="input" name="name" required>
          </div>
          <div>
            <label class="label" for="active-char-avatar">Avatar URL (optional)</label>
            <input id="active-char-avatar" class="input" name="avatar">
          </div>
          <button type="submit" class="btn">Add Active Character</button>
        </form>

        <div style="margin-top:10px;display:grid;gap:8px;">
          ${data.government.activeCharacters.length ? data.government.activeCharacters.map((c, idx) => `
            <article class="tile" style="display:grid;grid-template-columns:minmax(180px,2fr) minmax(180px,2fr) auto auto;gap:8px;align-items:center;">
              <div><b>${esc(c.name)}</b></div>
              <input class="input" type="url" data-action="set-avatar" data-index="${idx}" value="${esc(c.avatar || "")}" placeholder="Avatar URL">
              <button type="button" class="btn" data-action="toggle-active" data-index="${idx}">${c.active ? "Set Inactive" : "Set Active"}</button>
              <button type="button" class="btn" data-action="remove-char" data-index="${idx}">Remove</button>
            </article>
          `).join("") : `<div class="muted-block">No active characters configured.</div>`}
        </div>
      </section>
    ` : ""}
  `;

  host.querySelector("#gov-save")?.addEventListener("click", () => {
    for (const el of host.querySelectorAll('[data-role="office-select"]')) {
      const officeId = String(el.dataset.officeId || "");
      if (!canEditOffice(data, officeId)) continue;
      const selectedName = String(el.value || "").trim();
      const office = officeMap.get(officeId);
      if (!office) continue;
      office.holderName = selectedName;
      const char = data.government.activeCharacters.find((c) => c.name === selectedName);
      office.holderAvatar = char?.avatar || "";
    }

    applyAssignmentEffects(data);
    saveData(data);
    state.message = "Appointments saved.";
    render(data, state);
  });

  host.querySelector("#active-char-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") || "").trim();
    const avatar = String(fd.get("avatar") || "").trim();
    if (!name) return;
    const existing = data.government.activeCharacters.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      existing.active = true;
      if (avatar) existing.avatar = avatar;
    } else {
      data.government.activeCharacters.push({ name, avatar, active: true });
    }
    saveData(data);
    state.message = `Updated active roster for ${name}.`;
    render(data, state);
  });

  host.querySelectorAll('[data-action="toggle-active"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.index);
      const char = data.government.activeCharacters[idx];
      if (!char) return;
      char.active = !char.active;
      saveData(data);
      state.message = `${char.name} marked ${char.active ? "active" : "inactive"}.`;
      render(data, state);
    });
  });

  host.querySelectorAll('[data-action="remove-char"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.index);
      const char = data.government.activeCharacters[idx];
      if (!char) return;
      data.government.activeCharacters.splice(idx, 1);
      for (const office of data.government.offices) {
        if (office.holderName === char.name) {
          office.holderName = "";
          office.holderAvatar = "";
        }
      }
      applyAssignmentEffects(data);
      saveData(data);
      state.message = `${char.name} removed from active roster.`;
      render(data, state);
    });
  });

  host.querySelectorAll('[data-action="set-avatar"]').forEach((input) => {
    input.addEventListener("change", () => {
      const idx = Number(input.dataset.index);
      const char = data.government.activeCharacters[idx];
      if (!char) return;
      char.avatar = String(input.value || "").trim();
      for (const office of data.government.offices) {
        if (office.holderName === char.name) office.holderAvatar = char.avatar;
      }
      saveData(data);
      state.message = `Avatar updated for ${char.name}.`;
      render(data, state);
    });
  });
}

export function initGovernmentPage(data) {
  normaliseGovernment(data);
  applyAssignmentEffects(data);
  saveData(data);
  render(data, { message: "" });
}
