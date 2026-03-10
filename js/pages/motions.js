import { esc } from "../ui.js";
import { isAdmin, isMod, isSpeaker, canAdminModOrSpeaker } from "../permissions.js";
import { tileSection, tileCard } from "../components/tile.js";
import { toastSuccess } from "../components/toast.js";
import { getSimDate, simDateToObj, plusSimMonths, formatSimDate,
         formatSimMonthYear, isDeadlinePassed, compareSimDates,
         countdownToSimMonth } from "../clock.js";
import { apiCreateDebateTopic, apiCreateMotion, apiGetMotions, apiUpdateMotion, apiDeleteMotion } from "../api.js";
import { handleApiError } from "../errors.js";
import { npcPartyOptions } from "../parties.js";
import { getCharacterContext } from "../engines/core-engine.js";

const GOVERNMENT_OFFICES = new Set([
  "prime-minister", "leader-commons", "chancellor", "home", "foreign", "trade", "defence", "welfare", "education", "env-agri", "health", "eti", "culture", "home-nations"
]);


function isGovernmentMember(data) {
  const ctx = getCharacterContext(data);
  // Check `offices` array (populated by bootstrap from DB) first, fall back to scalar `office`.
  const offices = Array.isArray(ctx?.offices) ? ctx.offices : (ctx?.office ? [ctx.office] : []);
  return offices.some((o) => GOVERNMENT_OFFICES.has(o));
}

function ensureMotions(data) {
  data.motions ??= {};
  data.motions.house ??= [];
  data.motions.edm ??= [];
  data.motions.nextHouseNumber ??= data.motions.house.length + 1;
  data.motions.nextEdmNumber ??= data.motions.edm.length + 1;
}

function simNow(data) {
  const raw = getSimDate(data.gameState);
  return {
    month: raw.monthIndex + 1,
    year: raw.year,
    label: formatSimMonthYear(data.gameState)
  };
}

function discussionUrl(kind, number, title) {
  return null; // URLs are only set after a Discourse topic is created
}

function bodyWithPreamble(body = "") {
  return `That this House ${String(body || "").trim()}`;
}

export async function initMotionsPage(data) {
  const root = document.getElementById("motions-root");
  if (!root) return;

  ensureMotions(data);

  try {
    const r = await apiGetMotions();
    if (Array.isArray(r?.motions)) {
      // DB is authoritative: replace local collections to prevent stale/deleted
      // motions from surviving in client memory for non-staff players.
      data.motions.house = r.motions.filter((m) => (m._motionType || m.motion_type) === "house");
      data.motions.edm = r.motions.filter((m) => (m._motionType || m.motion_type) === "edm");

      // Recalculate next numbers from the max number already in the DB so they never collide
      const maxHouse = data.motions.house.reduce((mx, m) => Math.max(mx, Number(m.number || 0)), 0);
      const maxEdm = data.motions.edm.reduce((mx, m) => Math.max(mx, Number(m.number || 0)), 0);
      data.motions.nextHouseNumber = Math.max(Number(data.motions.nextHouseNumber || 1), maxHouse + 1);
      data.motions.nextEdmNumber = Math.max(Number(data.motions.nextEdmNumber || 1), maxEdm + 1);
    }
  } catch (err) {
    console.error("[motions] DB load failed:", err);
  }

  const sim = simNow(data);
  const char = getCharacterContext(data);
  const simCurrentObj = simDateToObj(getSimDate(data.gameState));
  const canPostAsNpc = isAdmin(data) || isMod(data);
  const canDelete = canAdminModOrSpeaker(data);
  const hasActiveChar = canPostAsNpc || Boolean(char?.name);
  const partyOptions = npcPartyOptions();

  // Auto-archive detection is display-only here; do not mutate persistent state.
  // The actual status mutations would be initiated server-side.
  // For display purposes, compute "effective" archived status without mutating.
  for (const m of data.motions.house) {
    if (m.status !== "archived" && m.division?.endSimObj && compareSimDates(simCurrentObj, m.division.endSimObj) >= 0 && m.division?.status === "open") {
      // Mark as visually archived without persisting — DB is authoritative on next load
      m._displayStatus = "archived";
    }
  }
  for (const m of data.motions.edm) {
    if (m.status !== "archived" && m.closesAtSimObj && compareSimDates(simCurrentObj, m.closesAtSimObj) >= 0) {
      m._displayStatus = "archived";
    }
  }

  const house = data.motions.house.slice().sort((a, b) => Number(b.number || 0) - Number(a.number || 0));
  const edm = data.motions.edm.slice().sort((a, b) => Number(b.number || 0) - Number(a.number || 0));
  const openHouse = house.filter((m) => (m._displayStatus || m.status) !== "archived");
  const archivedHouse = house.filter((m) => (m._displayStatus || m.status) === "archived");
  const openEdm = edm.filter((m) => (m._displayStatus || m.status) !== "archived");
  const archivedEdm = edm.filter((m) => (m._displayStatus || m.status) === "archived");

  root.innerHTML = `
    ${tileSection({
      title: "Guide to Motions & EDMs",
      body: `<p>Use <b>Open</b> to view the full motion/EDM page. House Motion divisions are handled on the open page. EDM signatures are managed on the open page.</p>`
    })}

    ${tileSection({
      title: "Submit Motion / EDM",
      body: !hasActiveChar
        ? `<div class="muted-block">You must have an active character to submit motions or EDMs. <a href="user.html">Create or activate a character</a> first.</div>`
        : `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;">
          <form id="house-motion-form" class="tile tile-form">
            <h3 class="tile-title">Raise House Motion</h3>
            <div class="form-row">
              <label for="house-motion-title">Title</label>
              <input id="house-motion-title" name="title" required>
            </div>
            <div class="form-row">
              <label for="house-motion-body">Body text (after "That this House ...")</label>
              <textarea id="house-motion-body" rows="5" name="body" required placeholder="calls on the Government to..."></textarea>
            </div>
            ${canPostAsNpc ? `
            <div class="form-row" style="margin-top:6px;padding-top:6px;border-top:1px solid var(--line);">
              <label style="font-size:0.85em;color:var(--muted);">Post as NPC (mod/admin)</label>
              <input name="npcName" placeholder="NPC MP name (leave blank to post as yourself)" style="margin-bottom:4px;">
              <select name="npcParty">
                <option value="">— NPC party —</option>
                ${partyOptions}
              </select>
            </div>` : ""}
            <p class="muted" style="margin-top:8px;margin-bottom:4px;">Submitting as <b>${esc(char?.display_name || char?.name || "MP")}</b>.</p>
            <div class="tile-bottom"><button class="btn primary" type="submit">Submit House Motion</button></div>
          </form>

          <form id="edm-form" class="tile tile-form">
            <h3 class="tile-title">Raise Early Day Motion</h3>
            <p class="muted" style="font-size:0.9em;margin-top:0;">EDMs may not be submitted by Government members.</p>
            <div class="form-row">
              <label for="edm-title">Title</label>
              <input id="edm-title" name="title" required>
            </div>
            <div class="form-row">
              <label for="edm-body">Body text (after "That this House ...")</label>
              <textarea id="edm-body" rows="5" name="body" required placeholder="recognises and calls for..."></textarea>
            </div>
            ${canPostAsNpc ? `
            <div class="form-row" style="margin-top:6px;padding-top:6px;border-top:1px solid var(--line);">
              <label style="font-size:0.85em;color:var(--muted);">Post as NPC (mod/admin)</label>
              <input name="npcName" placeholder="NPC MP name (leave blank to post as yourself)" style="margin-bottom:4px;">
              <select name="npcParty">
                <option value="">— NPC party —</option>
                ${partyOptions}
              </select>
            </div>` : ""}
            <p class="muted" style="margin-top:8px;margin-bottom:4px;">Submitting as <b>${esc(char?.display_name || char?.name || "MP")}</b>.</p>
            <div class="tile-bottom"><button class="btn primary" type="submit">Submit EDM</button></div>
          </form>
        </div>
      `
    })}

    ${tileSection({
      title: "Current House Motions",
      body: openHouse.length ? openHouse.map((m) => tileCard({
        extraClass: "tile-stack",
        body: `
          <div><b>Motion ${esc(m.number)}</b>: ${esc(m.title)} <span class="muted">by ${esc(m.author_display_name || m.author)}</span></div>
          <div class="muted" style="margin-top:6px;">Debate: ${esc(m.debateStartSim || "—")} → ${esc(m.debateEndSim || "—")}${m.debateEndSimObj ? ` (${countdownToSimMonth(m.debateEndSimObj.month, m.debateEndSimObj.year, data.gameState)})` : ""}</div>
        `,
        actions: `
          <a class="btn" href="motion.html?kind=house&id=${encodeURIComponent(m.id)}">Open</a>
          ${(m.debate?.topicUrl || m.discourse_topic_url || m.discourseTopicUrl || m.debateUrl) ? `<a class="btn" href="${esc(m.debate?.topicUrl || m.discourse_topic_url || m.discourseTopicUrl || m.debateUrl)}" target="_blank" rel="noopener">Debate</a>` : ""}
          ${canDelete ? `<button class="btn danger" data-action="delete-motion" data-kind="house" data-id="${esc(m.id)}" type="button">Delete</button>` : ""}
        `
      })).join("") : `<p class="muted">No current house motions.</p>`
    })}

    ${tileSection({
      title: "Current EDMs",
      body: openEdm.length ? openEdm.map((m) => tileCard({
        extraClass: "tile-stack",
        body: `
          <div><b>EDM ${esc(m.number)}</b>: ${esc(m.title)} <span class="muted">by ${esc(m.author_display_name || m.author)}</span></div>
          <div class="muted" style="margin-top:6px;">Open: ${esc(m.openedAtSim || "—")} → ${esc(m.closesAtSim || "—")}${m.closesAtSimObj ? ` (${countdownToSimMonth(m.closesAtSimObj.month, m.closesAtSimObj.year, data.gameState)})` : ""}</div>
        `,
        actions: `
          <a class="btn" href="motion.html?kind=edm&id=${encodeURIComponent(m.id)}">Open</a>
          ${(m.debate?.topicUrl || m.discourse_topic_url || m.discourseTopicUrl || m.debateUrl) ? `<a class="btn" href="${esc(m.debate?.topicUrl || m.discourse_topic_url || m.discourseTopicUrl || m.debateUrl)}" target="_blank" rel="noopener">Debate</a>` : ""}
          ${canDelete ? `<button class="btn danger" data-action="delete-motion" data-kind="edm" data-id="${esc(m.id)}" type="button">Delete</button>` : ""}
        `
      })).join("") : `<p class="muted">No current EDMs.</p>`
    })}

    ${tileSection({
      title: "Archive",
      body: `
        <h3>House Motions</h3>
        ${archivedHouse.length ? archivedHouse.map((m) => `<div style="margin-bottom:8px;"><b>Motion ${esc(m.number)}</b>: ${esc(m.title)} <a class="btn" href="motion.html?kind=house&id=${encodeURIComponent(m.id)}">Open</a>${canDelete ? `<button class="btn danger" data-action="delete-motion" data-kind="house" data-id="${esc(m.id)}" type="button" style="margin-left:6px;">Delete</button>` : ""}</div>`).join("") : `<p class="muted">No archived house motions.</p>`}
        <h3>EDMs</h3>
        ${archivedEdm.length ? archivedEdm.map((m) => `<div style="margin-bottom:8px;"><b>EDM ${esc(m.number)}</b>: ${esc(m.title)} <a class="btn" href="motion.html?kind=edm&id=${encodeURIComponent(m.id)}">Open</a>${canDelete ? `<button class="btn danger" data-action="delete-motion" data-kind="edm" data-id="${esc(m.id)}" type="button" style="margin-left:6px;">Delete</button>` : ""}</div>`).join("") : `<p class="muted">No archived EDMs.</p>`}
      `
    })}
  `;

  root.querySelector("#house-motion-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!hasActiveChar) return;
    const fd = new FormData(e.currentTarget);
    const title = String(fd.get("title") || "").trim();
    const body = String(fd.get("body") || "").trim();
    if (!title || !body) return;

    const submitBtn = e.currentTarget.querySelector("[type='submit']");
    if (submitBtn) submitBtn.disabled = true;

    const npcName = canPostAsNpc ? String(fd.get("npcName") || "").trim() : "";
    const npcParty = canPostAsNpc ? String(fd.get("npcParty") || "").trim() : "";
    const author = npcName || char?.display_name || char?.name || "MP";
    const authorCharacterId = npcName ? null : (char?.id || null);

    const number = Number(data.motions.nextHouseNumber || (data.motions.house.length + 1));
    const debateEndObj = plusSimMonths(sim.month, sim.year, 2);
    const divisionEndObj = plusSimMonths(debateEndObj.month, debateEndObj.year, 1);
    const id = `motion-${Date.now()}`;

    const motion = {
      id,
      number,
      title,
      author,
      author_display_name: author,
      author_character_id: authorCharacterId,
      ...(npcName ? { npc: true, npcParty } : {}),
      body,
      status: "open",
      debateStartSim: sim.label,
      debateEndSim: formatSimDate(debateEndObj),
      debateEndSimObj: debateEndObj,
      debate: { topicId: null, topicUrl: null, opensAtSim: null, closesAtSim: null },
      division: { status: "pending", startSim: formatSimDate(debateEndObj), endSim: formatSimDate(divisionEndObj), endSimObj: divisionEndObj, votes: {}, rebelsByParty: {}, npcVotes: {} }
    };

    let persistedMotion = null;
    try {
      const resp = await apiCreateMotion("house", motion);
      persistedMotion = resp?.motion || null;
    } catch (err) {
      console.error("[motions] Failed to persist house motion to DB:", err);
      handleApiError(err, "Submit motion");
      if (submitBtn) submitBtn.disabled = false;
      return;
    }

    const createdMotion = persistedMotion || motion;
    data.motions.house.push(createdMotion);
    data.motions.nextHouseNumber = number + 1;
    apiCreateDebateTopic({
      entityType: "motion", entityId: createdMotion.id,
      title: `Motion ${number}: ${title}`,
      raw: `**That this House** ${body}\n\n*Submitted by ${createdMotion.author}.*`,
      categoryId: 9
    }).then(({ topicId, topicUrl }) => { // UI_ONLY_OK: Discourse side-write after motion submit; outer .catch() handles failures
      createdMotion.debate = { ...createdMotion.debate, topicId, topicUrl };
      createdMotion.discourseTopicId = topicId;
      createdMotion.discourse_topic_id = topicId;
      createdMotion.discourse_topic_url = topicUrl;
    }).catch((err) => handleApiError(err, "Debate topic")); // UI_ONLY_OK: terminal error handler for the Discourse topic creation chain
    window.location.href = `motion.html?kind=house&id=${encodeURIComponent(createdMotion.id)}`;
  });

  root.querySelector("#edm-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!hasActiveChar) return;
    // Government members cannot submit EDMs
    if (!canPostAsNpc && isGovernmentMember(data)) {
      alert("Government members may not submit Early Day Motions.");
      return;
    }
    const fd = new FormData(e.currentTarget);
    const title = String(fd.get("title") || "").trim();
    const body = String(fd.get("body") || "").trim();
    if (!title || !body) return;

    const submitBtn = e.currentTarget.querySelector("[type='submit']");
    if (submitBtn) submitBtn.disabled = true;

    const npcName = canPostAsNpc ? String(fd.get("npcName") || "").trim() : "";
    const npcParty = canPostAsNpc ? String(fd.get("npcParty") || "").trim() : "";
    const author = npcName || char?.display_name || char?.name || "MP";
    const authorCharacterId = npcName ? null : (char?.id || null);

    const number = Number(data.motions.nextEdmNumber || (data.motions.edm.length + 1));
    const closesAtObj = plusSimMonths(sim.month, sim.year, 2);
    const id = `edm-${Date.now()}`;

    const edm = {
      id,
      number,
      title,
      author,
      author_display_name: author,
      author_character_id: authorCharacterId,
      ...(npcName ? { npc: true, npcParty } : {}),
      body,
      status: "open",
      openedAtSim: sim.label,
      closesAtSim: formatSimDate(closesAtObj),
      closesAtSimObj: closesAtObj,
      debate: { topicId: null, topicUrl: null, opensAtSim: null, closesAtSim: null },
      signatures: [],
      npcSignatures: {}
    };

    let persistedEdm = null;
    try {
      const resp = await apiCreateMotion("edm", edm);
      persistedEdm = resp?.motion || null;
    } catch (err) {
      console.error("[motions] Failed to persist EDM to DB:", err);
      handleApiError(err, "Submit EDM");
      if (submitBtn) submitBtn.disabled = false;
      return;
    }

    const createdEdm = persistedEdm || edm;
    data.motions.edm.push(createdEdm);
    data.motions.nextEdmNumber = number + 1;
    window.location.href = `motion.html?kind=edm&id=${encodeURIComponent(createdEdm.id)}`;
  });

  root.querySelectorAll("[data-action='delete-motion']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!canDelete) return;
      const id = btn.getAttribute("data-id");
      const kind = btn.getAttribute("data-kind");
      try {
        await apiDeleteMotion(id);
      } catch (err) {
        handleApiError(err, "Delete motion");
        return;
      }
      if (kind === "house") {
        data.motions.house = data.motions.house.filter((m) => m.id !== id);
      } else {
        data.motions.edm = data.motions.edm.filter((m) => m.id !== id);
      }
      initMotionsPage(data);
    });
  });
}

export { bodyWithPreamble, ensureMotions, isGovernmentMember };
