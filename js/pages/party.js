import { saveState } from "../core.js";
import { esc } from "../ui.js";
import { isAdmin, isMod, canAdminOrMod } from "../permissions.js";
import { parseDraftingForm, renderDraftingBuilder, wireDraftingBuilder } from "../bill-drafting.js";
import { apiGetParty, apiSetPartyLeadership, apiSetChiefWhip, apiGetCharacters, apiGetMyCharacters } from "../api.js";

const DEFAULT_PARTIES = {
  Conservative: {
    name: "Conservative",
    short: "CON",
    leader: { name: "", avatar: "", characterId: "" },
    treasury: { cash: 350000, debt: 50000, members: 176000 },
    hqUrl: null,
    drafts: []
  },
  Labour: {
    name: "Labour",
    short: "LAB",
    leader: { name: "", avatar: "", characterId: "" },
    treasury: { cash: 290000, debt: 120000, members: 145000 },
    hqUrl: null,
    drafts: []
  },
  "Liberal Democrat": {
    name: "Liberal Democrat",
    short: "LDM",
    leader: { name: "", avatar: "", characterId: "" },
    treasury: { cash: 95000, debt: 12000, members: 76000 },
    hqUrl: null,
    drafts: []
  }
};

function canManage(data) {
  return canAdminOrMod(data);
}

function getCharacter(data) {
  return data?.currentCharacter || data?.currentPlayer || {};
}

function avatarFor(name, avatar) {
  if (avatar) return avatar;
  const initial = (name || "?").trim().slice(0, 1).toUpperCase() || "?";
  return `https://dummyimage.com/64x64/1f3b60/ffffff&text=${encodeURIComponent(initial)}`;
}

function normaliseName(v) {
  return String(v || "").trim().toLowerCase();
}

function activeCharactersForParty(data, partyName) {
  const wanted = normaliseName(partyName);
  if (!wanted) return [];

  const pools = [
    ...(Array.isArray(data?.players) ? data.players : []),
    ...(Array.isArray(data?.government?.activeCharacters) ? data.government.activeCharacters : []),
    ...(Array.isArray(data?.opposition?.activeCharacters) ? data.opposition.activeCharacters : []),
    data?.currentCharacter,
    data?.currentPlayer
  ].filter(Boolean);

  const byName = new Map();
  pools.forEach((c) => {
    const name = String(c?.name || "").trim();
    if (!name) return;

    const party = normaliseName(c?.party);
    if (party && party !== wanted) return;
    if (c?.active === false) return;

    const existing = byName.get(name) || { name, avatar: "" };
    if (!existing.avatar && c?.avatar) existing.avatar = String(c.avatar).trim();
    byName.set(name, existing);
  });

  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function ensurePartyData(data) {
  data.party ??= { parties: {}, nextDraftId: 1 };
  data.party.parties ??= {};
  data.party.nextDraftId = Number(data.party.nextDraftId || 1);

  Object.entries(DEFAULT_PARTIES).forEach(([key, value]) => {
    if (!data.party.parties[key]) data.party.parties[key] = structuredClone(value);
    const p = data.party.parties[key];
    p.name ??= value.name;
    p.short ??= value.short;
    p.leader ??= structuredClone(value.leader);
    p.treasury ??= structuredClone(value.treasury);
    p.hqUrl ??= value.hqUrl;
    p.drafts ??= [];
  });
}

function accessiblePartyNames(data) {
  const char = getCharacter(data);
  const party = char?.party;
  const names = Object.keys(data.party.parties);
  if (canManage(data)) return names;
  return names.includes(party) ? [party] : [];
}

function partyFromState(data, state) {
  return data.party.parties[state.activeParty] || null;
}

function formatMoney(v) {
  return `£${Number(v || 0).toLocaleString("en-GB")}`;
}

function discussUrlForDraft(party, draft) {
  return draft.discussUrl || null;
}

function render(data, state) {
  const root = document.getElementById("party-root");
  if (!root) return;

  ensurePartyData(data);
  const allowed = accessiblePartyNames(data);
  const manager = canManage(data);

  if (!state.activeParty || !data.party.parties[state.activeParty]) {
    state.activeParty = allowed[0] || Object.keys(data.party.parties)[0];
  }

  const party = partyFromState(data, state);
  const char = getCharacter(data);
  const canView = manager || (char?.party && char.party === state.activeParty);

  if (!canView) {
    root.innerHTML = `
      <section class="panel">
        <div class="bbc-masthead"><div class="bbc-title">Party</div></div>
        <div class="muted-block">This headquarters is private. You can only access your own party workspace.</div>
      </section>
    `;
    return;
  }

  const drafts = party.drafts.slice().sort((a, b) => Number(b.createdTs || 0) - Number(a.createdTs || 0));

  // DB-backed party leadership data
  const dbParty = state.dbState?.party || null;
  const dbLeaderName    = dbParty?.leader_name      || party.leader?.name    || "";
  const dbLeaderAvatar  = dbParty?.leader_avatar    || party.leader?.avatar  || "";
  const dbChairmanName  = dbParty?.chairman_name    || "";
  const dbChairmanAvatar= dbParty?.chairman_avatar  || "";
  const dbChiefWhipName  = dbParty?.chief_whip_name  || "";
  const dbChiefWhipAvatar= dbParty?.chief_whip_avatar || "";

  // Determine if caller is party leader (for leadership assignment)
  const dbLeaderId = dbParty?.leader_character_id;
  const sessionCharId = state.dbState?.sessionCharId || "";
  const isPartyLeader = dbLeaderId && sessionCharId && String(dbLeaderId) === String(sessionCharId);
  const canAssignLeadership = manager || isPartyLeader;

  // Characters for party (for leadership dropdowns)
  const partyCharacters = (state.dbState?.partyCharacters || []);

  root.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">${esc(party.name)} Party HQ</div></div>

    ${manager ? `
      <section class="panel" style="margin-bottom:12px;">
        <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;">
          <div>
            <label class="label" for="party-switch">View/Edit Party</label>
            <select id="party-switch" class="input">
              ${Object.keys(data.party.parties).map((name) => `<option value="${esc(name)}" ${name === state.activeParty ? "selected" : ""}>${esc(name)}</option>`).join("")}
            </select>
          </div>
        </div>
      </section>
    ` : ""}

    <section class="panel" style="margin-bottom:12px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <article class="tile">
          <h2 style="margin-top:0;">Party Leader</h2>
          <div style="display:flex;gap:10px;align-items:center;">
            <img src="${esc(avatarFor(dbLeaderName, dbLeaderAvatar))}" alt="Party leader avatar" width="56" height="56" style="border-radius:999px;object-fit:cover;">
            <div><b>${esc(dbLeaderName || "Vacant")}</b></div>
          </div>
        </article>

        <article class="tile">
          <h2 style="margin-top:0;">Party Treasury</h2>
          <div><b>Cash on hand:</b> ${esc(formatMoney(party.treasury?.cash))}</div>
          <div><b>Debt:</b> ${esc(formatMoney(party.treasury?.debt))}</div>
          <div><b>Members:</b> ${esc(Number(party.treasury?.members || 0).toLocaleString("en-GB"))}</div>
        </article>

        <article class="tile">
          <h2 style="margin-top:0;">Party Chairman</h2>
          <div style="display:flex;gap:10px;align-items:center;">
            <img src="${esc(avatarFor(dbChairmanName, dbChairmanAvatar))}" alt="Chairman avatar" width="56" height="56" style="border-radius:999px;object-fit:cover;">
            <div><b>${esc(dbChairmanName || "Vacant")}</b></div>
          </div>
        </article>

        <article class="tile">
          <h2 style="margin-top:0;">Chief Whip</h2>
          <div style="display:flex;gap:10px;align-items:center;">
            <img src="${esc(avatarFor(dbChiefWhipName, dbChiefWhipAvatar))}" alt="Chief Whip avatar" width="56" height="56" style="border-radius:999px;object-fit:cover;">
            <div><b>${esc(dbChiefWhipName || "Vacant")}</b></div>
          </div>
        </article>
      </div>
    </section>

    ${(canAssignLeadership && dbParty) ? `
      <section class="panel" style="margin-bottom:12px;">
        <h2 style="margin-top:0;">Assign Leadership Roles ${isPartyLeader && !manager ? `<span class="muted" style="font-size:.85em;">(Leader only)</span>` : ""}</h2>
        <form id="party-leadership-form" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;align-items:end;">
          <div>
            <label class="label" for="chairman-select">Chairman</label>
            <select id="chairman-select" name="chairman_character_id" class="input">
              <option value="">— Vacant —</option>
              ${partyCharacters.map((c) => `<option value="${esc(c.id)}" ${String(c.id) === String(dbParty?.chairman_character_id || "") ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
            </select>
          </div>
          <div>
            <label class="label" for="chief-whip-select">Chief Whip</label>
            <select id="chief-whip-select" name="chief_whip_character_id" class="input">
              <option value="">— Vacant —</option>
              ${partyCharacters.map((c) => `<option value="${esc(c.id)}" ${String(c.id) === String(dbParty?.chief_whip_character_id || "") ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
            </select>
          </div>
          <button type="submit" class="btn">Save Leadership</button>
        </form>
        ${state.leadershipMessage ? `<p class="muted" style="margin-top:8px;">${esc(state.leadershipMessage)}</p>` : ""}
      </section>
    ` : ""}

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Enter Headquarters</h2>
      <p>Open your private party Discourse headquarters for internal strategy and debate.</p>
      ${party.hqUrl ? `<a class="btn" href="${esc(party.hqUrl)}" target="_blank" rel="noopener">Enter Headquarters</a>` : `<span class="muted">Forum link not configured.</span>`}
    </section>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Draft a Bill (Party Workspace)</h2>
      <p class="muted">Once submitted, drafts can only be edited by their author. There are no amendments or divisions in party drafting.</p>
      <form id="party-draft-form">
        ${renderDraftingBuilder("party-draft", state.editingDraftId ? party.drafts.find((d) => d.id === state.editingDraftId) : null)}

        <button type="submit" class="btn">${state.editingDraftId ? "Update Draft" : "Save Draft"}</button>
      </form>
    </section>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Party Drafts</h2>
      ${drafts.length ? drafts.map((d) => `
        <article class="tile" style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;">
            <div>
              <b>${esc(d.ref || `Draft ${d.id}`)}:</b> ${esc(d.title)}
              <div class="muted">By ${esc(d.authorName)} • ${esc(d.createdAt)}</div>
            </div>
            <button type="button" class="btn" data-action="open-draft" data-id="${esc(String(d.id))}">${state.openDraftId === d.id ? "Close" : "Open"}</button>
          </div>
          ${state.openDraftId === d.id ? `
            <div style="margin-top:10px;">
              <p><b>A Bill to make provision for:</b> ${esc(d.purpose)}</p>
              <div class="muted-block" style="white-space:pre-wrap;">${esc(d.body)}</div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
                ${discussUrlForDraft(party, d) ? `<a class="btn" href="${esc(discussUrlForDraft(party, d))}" target="_blank" rel="noopener">Discuss</a>` : ""}
                ${(d.authorId === (char?.name || "") || manager) ? `<button type="button" class="btn" data-action="edit-draft" data-id="${esc(String(d.id))}">Edit</button>` : ""}
                ${manager ? `<button type="button" class="btn" data-action="delete-draft" data-id="${esc(String(d.id))}">Delete</button>` : ""}
              </div>
            </div>
          ` : ""}
        </article>
      `).join("") : `<div class="muted-block">No party drafts yet.</div>`}
    </section>

    ${manager ? `
      <section class="panel">
        <h2 style="margin-top:0;">Party Control Panel</h2>
        <form id="party-control-form">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;">
            <div>
              <label class="label" for="party-leader-name">Leader (active character)</label>
              <select id="party-leader-name" name="leaderName" class="input">
                ${activeCharactersForParty(data, party.name).map((c) => `<option value="${esc(c.name)}" ${c.name === (party.leader?.name || "") ? "selected" : ""}>${esc(c.name)}</option>`).join("") || `<option value="">No active character available</option>`}
              </select>
            </div>
            <div>
              <label class="label" for="party-cash">Treasury Cash (£)</label>
              <input id="party-cash" name="cash" type="number" class="input" value="${esc(String(Number(party.treasury?.cash || 0)))}">
            </div>
            <div>
              <label class="label" for="party-debt">Debt (£)</label>
              <input id="party-debt" name="debt" type="number" class="input" value="${esc(String(Number(party.treasury?.debt || 0)))}">
            </div>
            <div>
              <label class="label" for="party-members">Members</label>
              <input id="party-members" name="members" type="number" class="input" value="${esc(String(Number(party.treasury?.members || 0)))}">
            </div>
            <div>
              <label class="label" for="party-hq-url">Headquarters URL</label>
              <input id="party-hq-url" name="hqUrl" class="input" value="${esc(party.hqUrl || "")}">
            </div>
          </div>
          <button type="submit" class="btn">Save Party Settings</button>
        </form>
      </section>
    ` : ""}
  `;

  root.querySelector("#party-switch")?.addEventListener("change", async (e) => {
    const next = String(e.currentTarget.value || "");
    if (!next) return;
    state.activeParty = next;
    state.openDraftId = null;
    // Reload DB party data for the newly selected party
    try {
      const [partyResult, charsResult] = await Promise.all([
        apiGetParty(next).catch(() => null),
        apiGetCharacters({ active: "true" }).catch(() => ({ characters: [] }))
      ]);
      if (partyResult?.party) state.dbState = { ...state.dbState, party: partyResult.party };
      const partyNameLower = next.toLowerCase();
      state.dbState.partyCharacters = (charsResult.characters || []).filter(
        (c) => (c.party || "").toLowerCase() === partyNameLower
      );
    } catch (e) {
      console.warn("[party-switch] DB reload failed:", e.message);
    }
    render(data, state);
  });

  wireDraftingBuilder(root.querySelector("#party-draft-form"), "party-draft");

  root.querySelector("#party-draft-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const { title, purpose, body, discussUrl, department, articleCount, extent, commencement, articles } = parseDraftingForm(e.currentTarget, data);
    if (!title || !purpose || !body) return;

    if (state.editingDraftId) {
      const draft = party.drafts.find((d) => d.id === state.editingDraftId);
      const userId = char?.name || "";
      if (!draft || (draft.authorId !== userId && !manager)) return;
      draft.title = title;
      draft.purpose = purpose;
      draft.body = body;
      draft.discussUrl = discussUrl;
      draft.department = department;
      draft.articleCount = articleCount;
      draft.extent = extent;
      draft.commencement = commencement;
      draft.articles = articles;
      state.editingDraftId = null;
    } else {
      const id = data.party.nextDraftId++;
      const draft = {
        id,
        ref: `${party.short} DRAFT ${id}`,
        title,
        purpose,
        body,
        discussUrl,
        department,
        articleCount,
        extent,
        commencement,
        articles,
        authorName: char?.name || "Unknown MP",
        authorId: char?.name || "",
        createdAt: new Date().toLocaleString("en-GB"),
        createdTs: Date.now()
      };
      party.drafts.push(draft);
      state.openDraftId = id;
    }

    saveState(data);
    render(data, state);
  });

  root.querySelectorAll("[data-action='open-draft']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.getAttribute("data-id") || 0);
      state.openDraftId = state.openDraftId === id ? null : id;
      render(data, state);
    });
  });

  root.querySelectorAll("[data-action='edit-draft']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.getAttribute("data-id") || 0);
      const draft = party.drafts.find((d) => d.id === id);
      const userId = char?.name || "";
      if (!draft || (draft.authorId !== userId && !manager)) return;
      state.editingDraftId = id;
      render(data, state);
    });
  });

  root.querySelectorAll("[data-action='delete-draft']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!manager) return;
      const id = Number(btn.getAttribute("data-id") || 0);
      party.drafts = party.drafts.filter((d) => d.id !== id);
      if (state.openDraftId === id) state.openDraftId = null;
      saveState(data);
      render(data, state);
    });
  });

  root.querySelector("#party-control-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!manager) return;
    const fd = new FormData(e.currentTarget);
    const leaderName = String(fd.get("leaderName") || "").trim();
    const candidates = activeCharactersForParty(data, party.name);
    const selected = candidates.find((c) => c.name === leaderName);
    if (selected) {
      party.leader.name = selected.name;
      party.leader.avatar = selected.avatar || "";
      party.leader.characterId = selected.name;
    }
    party.treasury.cash = Number(fd.get("cash") || 0);
    party.treasury.debt = Number(fd.get("debt") || 0);
    party.treasury.members = Number(fd.get("members") || 0);
    party.hqUrl = String(fd.get("hqUrl") || "").trim() || party.hqUrl;
    saveState(data);
    render(data, state);
  });

  root.querySelector("#party-leadership-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!canAssignLeadership) return;
    const fd = new FormData(e.currentTarget);
    const chairmanId = String(fd.get("chairman_character_id") || "").trim();
    const chiefWhipId = String(fd.get("chief_whip_character_id") || "").trim();
    const partyId = state.activeParty;
    try {
      await Promise.all([
        apiSetPartyLeadership(partyId, "chairman", chairmanId || null),
        apiSetChiefWhip(partyId, chiefWhipId || null),
      ]);
      const { party: updated } = await apiGetParty(partyId);
      state.dbState = { ...state.dbState, party: updated };
      state.leadershipMessage = "Leadership updated.";
    } catch (err) {
      state.leadershipMessage = String(err.message || "Update failed.");
    }
    render(data, state);
  });
}

export async function initPartyPage(data) {
  ensurePartyData(data);
  const char = getCharacter(data);
  const state = {
    activeParty: char?.party || "",
    openDraftId: null,
    editingDraftId: null,
    leadershipMessage: "",
    dbState: { party: null, partyCharacters: [], sessionCharId: "" }
  };

  // Load DB-backed party data
  const partyId = state.activeParty || Object.keys(data.party?.parties || {})[0] || "";
  if (partyId) {
    try {
      const [partyResult, charsResult, myCharsResult] = await Promise.all([
        apiGetParty(partyId).catch(() => null),
        apiGetCharacters({ active: "true" }).catch(() => ({ characters: [] })),
        apiGetMyCharacters().catch(() => ({ characters: [] }))
      ]);
      if (partyResult?.party) state.dbState.party = partyResult.party;
      // Filter characters for this party
      const partyNameLower = partyId.toLowerCase();
      state.dbState.partyCharacters = (charsResult.characters || []).filter(
        (c) => (c.party || "").toLowerCase() === partyNameLower
      );
      // Determine session character ID: use the caller's active character in this party
      const myActive = (myCharsResult.characters || []).find((c) => c.is_active);
      state.dbState.sessionCharId = myActive?.id || "";
    } catch (e) {
      console.warn("[initPartyPage] DB load failed:", e.message);
    }
  }

  render(data, state);
}
