import { esc } from "../ui.js";
import { isSpeaker, canAdminOrMod, canAdminModOrSpeaker, canVoteDivision } from "../permissions.js";
import { getPartySeatMap, getCharacterContext } from "../engines/core-engine.js";
import { ensureMotions, isGovernmentMember } from "./motions.js";
import { getSimDate, simDateToObj, formatSimMonthYear, isDeadlinePassed, compareSimDates, countdownToSimMonth } from "../clock.js";
import {
  apiGetDivisionForEntity, apiCreateDivision, apiCastVote, apiCloseDivision,
  apiGetPartyInstruction, apiSetPartyInstruction,
  apiGetRebelRequest, apiSubmitRebelRequest,
  apiGetMotion, apiSignEdm, apiSetNpcVotes, apiUpdateMotion,
} from "../api.js";

const WHIP_LEVEL_LABELS = ["Free vote", "1-line whip", "2-line whip", "3-line whip"];

// Parties for which player characters exist (playable) — NPC panel shows the rest.
const PLAYABLE_PARTIES = new Set(["Conservative", "Labour", "Liberal Democrat"]);

function getParams() {
  const u = new URL(window.location.href);
  return { kind: u.searchParams.get("kind") || "house", id: u.searchParams.get("id") || "" };
}

function currentWeight() { return 1; }

function getMotion(data, kind, id) {
  const list = kind === "edm" ? data.motions.edm : data.motions.house;
  return list.find((m) => m.id === id) || list[0] || null;
}

function edmWeightedSignatures(item, data) {
  const seatMap = getPartySeatMap(data);
  const personal = (item.signatures || []).reduce((a, s) => a + Number(s.weight || 0), 0);
  const npc = Object.entries(item.npcSignatures || {}).reduce((a, [party, signed]) => a + (signed ? Number(seatMap[party] || 0) : 0), 0);
  return personal + npc;
}

// ── DB-backed division rendering ─────────────────────────────────────────

function renderWhipInstruction(instr) {
  if (!instr) {
    return `<div class="whip-instruction free"><span class="whip-badge free">Free vote</span> No party instruction set.</div>`;
  }
  const level = Number(instr.whip_level || 0);
  const levelLabel = WHIP_LEVEL_LABELS[level] || "Free vote";
  const posLabel = instr.position === "free" ? "Free vote"
    : instr.position.charAt(0).toUpperCase() + instr.position.slice(1);
  return `
    <div class="whip-instruction whip-level-${level}">
      <span class="whip-badge level-${level}">${esc(levelLabel)}</span>
      Party instruction: <b>${esc(posLabel)}</b>
      ${instr.set_by_name ? `· Set by ${esc(instr.set_by_name)}` : ""}
      ${instr.set_at_sim ? `· ${esc(instr.set_at_sim)}` : ""}
      ${instr.note ? `<br><span class="muted">${esc(instr.note)}</span>` : ""}
    </div>
  `;
}

function renderWhipEditor(divisionId, partySlug, instr) {
  const pos = instr?.position || "free";
  const level = instr?.whip_level ?? 0;
  const note = instr?.note || "";
  return `
    <form id="whip-instr-form" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:end;">
      <div>
        <label class="label">Instruction</label>
        <select name="position" class="input">
          <option value="free"    ${pos==="free"    ?"selected":""}>Free vote</option>
          <option value="aye"     ${pos==="aye"     ?"selected":""}>Aye</option>
          <option value="no"      ${pos==="no"      ?"selected":""}>No</option>
          <option value="abstain" ${pos==="abstain" ?"selected":""}>Abstain</option>
        </select>
      </div>
      <div>
        <label class="label">Whip level</label>
        <select name="whipLevel" class="input">
          <option value="0" ${level===0?"selected":""}>0 – Free</option>
          <option value="1" ${level===1?"selected":""}>1-line</option>
          <option value="2" ${level===2?"selected":""}>2-line</option>
          <option value="3" ${level===3?"selected":""}>3-line</option>
        </select>
      </div>
      <div style="flex:1;min-width:120px;">
        <label class="label">Note (optional)</label>
        <input name="note" class="input" value="${esc(note)}" placeholder="Optional note…">
      </div>
      <button type="submit" class="btn">Save Instruction</button>
    </form>
    <p id="whip-instr-msg" class="muted" style="margin-top:4px;"></p>
  `;
}

function renderRebelWidget(rebelReq, myVote, divStatus) {
  if (divStatus !== "open") return "";
  if (rebelReq && rebelReq.status === "pending") {
    return `<div class="rebel-request pending"><b>Rebel request pending</b> — awaiting whip decision for <b>${esc(rebelReq.requested_vote)}</b>.</div>`;
  }
  if (rebelReq && rebelReq.status === "granted") {
    return `<div class="rebel-request granted"><b>Rebel permission granted</b> — you may vote <b>${esc(rebelReq.requested_vote)}</b>.</div>`;
  }
  if (rebelReq && rebelReq.status === "refused") {
    return `<div class="rebel-request refused"><b>Rebel request refused</b> — please vote with the party line.</div>`;
  }
  return `
    <details style="margin-top:8px;">
      <summary class="muted" style="cursor:pointer;">Request permission to vote differently</summary>
      <form id="rebel-req-form" style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:end;">
        <div>
          <label class="label">Intended vote</label>
          <select name="requestedVote" class="input">
            <option value="aye">Aye</option>
            <option value="no">No</option>
            <option value="abstain">Abstain</option>
          </select>
        </div>
        <div style="flex:1;min-width:120px;">
          <label class="label">Message (optional)</label>
          <input name="message" class="input" placeholder="Brief reason…">
        </div>
        <button type="submit" class="btn">Submit Request</button>
      </form>
      <p id="rebel-req-msg" class="muted" style="margin-top:4px;"></p>
    </details>
  `;
}

async function renderHouseDb(root, data, motion) {
  const char = getCharacterContext(data);
  const speaker = isSpeaker(data);
  const isStaff = canAdminOrMod(data) || speaker;
  const canStaff = canAdminModOrSpeaker(data);
  const charParty = char?.party || "";
  const debateCountdown = motion.debateEndSimObj
    ? countdownToSimMonth(motion.debateEndSimObj.month, motion.debateEndSimObj.year, data.gameState)
    : "";

  // Load DB division state (or null if no division created yet)
  let dbDiv = null, tally = { aye: 0, no: 0, abstain: 0 }, myVote = null, myWeight = 0;
  try {
    const result = await apiGetDivisionForEntity("motion", motion.id);
    if (result) {
      dbDiv = result.division;
      tally = result.tally;
      myVote = result.myVote;
      myWeight = Number(result.myWeight || 0);
    }
  } catch (_) { /* no division yet */ }

  // voteWeight: use server-computed effective weight (seat-proportional).
  // Falls back to 1 only if there is a vote recorded (which carries the weight) but myWeight wasn't returned.
  const voteWeight = myWeight || (myVote ? Number(myVote.weight || 0) : 0);

  // Load party instruction for current user's party
  let instr = null;
  if (dbDiv && charParty) {
    try {
      const r = await apiGetPartyInstruction(dbDiv.id, charParty);
      instr = r.instruction;
    } catch (_) {}
  }

  // Determine if caller can set party instruction (chief whip / leader / admin+mod)
  // We rely on the server to enforce; show the form if the user has admin/mod role
  // or if they are the current party leader/chief whip (checked via dbState set at initMotionPage).
  const canSetInstruction = isStaff || data._canSetWhipInstruction === charParty;

  // Load rebel request for current character
  let rebelReq = null;
  if (dbDiv && charParty && !isStaff) {
    try {
      const r = await apiGetRebelRequest(dbDiv.id);
      rebelReq = r.request;
    } catch (_) {}
  }

  const divisionCountdown = dbDiv?.closes_at_sim
    ? `closes ${dbDiv.closes_at_sim}`
    : dbDiv?.closes_at
      ? `closes ${new Date(dbDiv.closes_at).toLocaleDateString("en-GB")}`
      : "";

  root.innerHTML = `
    <section class="tile tile-form" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Motion ${esc(motion.number)}: ${esc(motion.title)}</h2>
      <p class="muted">By ${esc(motion.author || motion.proposedBy || "")} • Status: ${esc(motion.status || "open")}</p>
      <p class="muted">Debate: ${esc(motion.debateStartSim || "—")} → ${esc(motion.debateEndSim || "—")}${debateCountdown ? ` (${debateCountdown})` : ""}</p>
      <p style="white-space:pre-wrap;"><b>That this House</b> ${esc(motion.body || "")}</p>
      <div class="tile-bottom" style="display:flex;gap:8px;flex-wrap:wrap;">
        ${(motion.debate?.topicUrl || motion.discourse_topic_url || motion.discourseTopicUrl || motion.debateUrl) ? `<a class="btn" href="${esc(motion.debate?.topicUrl || motion.discourse_topic_url || motion.discourseTopicUrl || motion.debateUrl)}" target="_blank" rel="noopener">Open Debate</a>` : `<span class="muted">No debate yet</span>`}
        <a class="btn" href="motions.html">Back to Motions</a>
      </div>
    </section>

    ${dbDiv ? `
    <section class="tile" style="margin-bottom:12px;">
      ${charParty ? renderWhipInstruction(instr) : ""}
      ${charParty && canSetInstruction ? renderWhipEditor(dbDiv.id, charParty, instr) : ""}
      ${charParty && !isStaff && instr && instr.position !== "free" ? renderRebelWidget(rebelReq, myVote?.vote, dbDiv.status) : ""}
    </section>

    <section class="tile">
      <div class="division-panel">
        <div class="division-header">
          <div class="division-title">🗳️ Division</div>
          <span class="division-countdown">${dbDiv.status === "open" ? (divisionCountdown || "Open") : `Closed${dbDiv.outcome ? ` · ${dbDiv.outcome}` : ""}`}</span>
        </div>
        <div class="division-totals">
          <div class="division-total-cell aye"><div class="dc-num">${Math.round(Number(tally.aye || 0))}</div><div class="dc-lbl">Ayes</div></div>
          <div class="division-total-cell no"><div class="dc-num">${Math.round(Number(tally.no || 0))}</div><div class="dc-lbl">Noes</div></div>
          <div class="division-total-cell"><div class="dc-num">${Math.round(Number(tally.abstain || 0))}</div><div class="dc-lbl">Abstain</div></div>
        </div>
        ${myVote ? `<div class="division-my-vote voted-${esc(myVote.vote)}">Your vote: <b>${esc(myVote.vote.charAt(0).toUpperCase() + myVote.vote.slice(1))}</b> · Weight: <b>${Math.round(Number(voteWeight))}</b></div>` : `<div class="division-my-vote">Not yet voted · Weight: <b>${Math.round(Number(voteWeight))}</b></div>`}
        ${dbDiv.status === "open" ? `
          <div class="tile-bottom" style="padding-top:10px;">
            <button class="btn ${myVote?.vote === "aye" ? "primary" : ""}" data-action="vote" data-choice="aye" ${canVoteDivision(data) && voteWeight > 0 ? "" : "disabled"}>Aye</button>
            <button class="btn ${myVote?.vote === "no" ? "primary" : ""}" data-action="vote" data-choice="no" ${canVoteDivision(data) && voteWeight > 0 ? "" : "disabled"}>No</button>
            <button class="btn ${myVote?.vote === "abstain" ? "primary" : ""}" data-action="vote" data-choice="abstain" ${canVoteDivision(data) && voteWeight > 0 ? "" : "disabled"}>Abstain</button>
          </div>
        ` : `<p class="muted">Division closed. Outcome: <b>${esc(dbDiv.outcome || "—")}</b></p>`}
        ${isStaff && dbDiv.status === "open" ? `
          <div style="margin-top:12px;">
            <h4 style="margin:0 0 6px;">NPC Party Votes &amp; Rebels</h4>
            <p class="muted" style="margin:0 0 6px;font-size:0.85em;">Seat totals are taken from the constituencies page. Sinn Féin and Speaker abstain by convention.</p>
            <form id="npc-vote-form">
              ${(() => {
                const seats = getPartySeatMap(data);
                const npcParties = Object.keys(seats).filter((p) => Number(seats[p]) > 0 && !PLAYABLE_PARTIES.has(p) && !/sinn\s*f[ée]in/i.test(p) && !/^speaker$/i.test(p));
                const npcVotes = dbDiv.npc_votes || {};
                const rebels   = dbDiv.rebels_by_party || {};
                const rebelChoice = dbDiv.rebels_by_party_choice || {};
                if (!npcParties.length && ![...PLAYABLE_PARTIES].some(p => Number(seats[p] || 0) > 0)) return `<p class="muted">No NPC parties with seats.</p>`;
                const npcTally = { aye: 0, no: 0, abstain: 0 };
                Object.entries(npcVotes).forEach(([p, v]) => {
                  if (npcTally[v] !== undefined && Number(seats[p] || 0) > 0) {
                    npcTally[v] += Math.max(0, Number(seats[p]) - Number(rebels[p] || 0));
                  }
                });
                return (npcParties.length ? npcParties.map((p) => `
                  <div class="kv" style="margin-bottom:4px;">
                    <span><b>${esc(p)}</b> (${Number(seats[p])} seats)</span>
                    <select name="npc-${esc(p)}" class="input" style="width:110px;">
                      <option value="">Unallocated</option>
                      <option value="aye" ${npcVotes[p] === "aye" ? "selected" : ""}>Aye</option>
                      <option value="no" ${npcVotes[p] === "no" ? "selected" : ""}>No</option>
                      <option value="abstain" ${npcVotes[p] === "abstain" ? "selected" : ""}>Abstain</option>
                    </select>
                    <input type="number" name="rebels-${esc(p)}" min="0" max="${Number(seats[p])}" value="${Number(rebels[p] || 0)}" class="input" style="width:70px;" placeholder="Rebels">
                  </div>`).join("") : "") +
                `<p class="muted" style="margin-top:4px;">NPC contribution: Aye ${npcTally.aye}, No ${npcTally.no}, Abstain ${npcTally.abstain}</p>` +
                `<div style="margin-top:12px;">
                  <h5 style="margin:0 0 4px;">Rebellion (removes from player weighted vote)</h5>
                  <p class="muted" style="margin:0 0 6px;font-size:0.85em;">Set rebel count + direction. Rebels are removed from the party's weighted vote and added to their chosen direction.</p>
                  ${[...PLAYABLE_PARTIES].filter(p => Number(seats[p] || 0) > 0).map(p => `
                    <div class="kv" style="margin-bottom:4px;flex-wrap:wrap;gap:4px;">
                      <span><b>${esc(p)}</b> (${Number(seats[p])} seats total)</span>
                      <label>Rebels: <input type="number" name="rebels-${esc(p)}" min="0" max="${Number(seats[p])}" value="${Number(rebels[p] || 0)}" class="input" style="width:70px;"></label>
                      <select name="rebel-dir-${esc(p)}" class="input" style="width:110px;" title="Rebel vote direction">
                        <option value="">— direction —</option>
                        <option value="aye" ${rebelChoice[p] === "aye" ? "selected" : ""}>Rebel → Aye</option>
                        <option value="no" ${rebelChoice[p] === "no" ? "selected" : ""}>Rebel → No</option>
                        <option value="abstain" ${rebelChoice[p] === "abstain" ? "selected" : ""}>Rebel → Abstain</option>
                      </select>
                    </div>
                  `).join("")}
                </div>`;
              })()}
              <div class="tile-bottom" style="padding-top:6px;">
                <button class="btn" type="submit">Save NPC Votes</button>
              </div>
              <p id="npc-msg" class="muted" style="margin-top:4px;"></p>
            </form>
          </div>
        ` : ""}
        ${speaker ? `<div class="tile-bottom" style="display:flex;gap:8px;flex-wrap:wrap;padding-top:10px;"><button class="btn danger" data-action="close-division" ${dbDiv.status === "closed" ? "disabled" : ""}>Close Division</button></div>` : ""}
        <p id="div-msg" class="muted" style="margin-top:6px;"></p>
      </div>
    </section>
    ` : `
    <section class="tile">
      <div class="division-panel">
        <div class="division-title">🗳️ Division</div>
        <p class="muted">No division opened for this motion yet.</p>
        ${speaker || isStaff ? `<button class="btn" data-action="create-division">Open Division</button>` : ""}
        <p id="div-msg" class="muted" style="margin-top:6px;"></p>
      </div>
    </section>
    `}

    ${canStaff ? `
    <section class="tile tile-form" style="margin-top:12px;">
      <h3 style="margin-top:0;">Edit Motion (Staff)</h3>
      <form id="motion-edit-form">
        <label class="label" for="motion-edit-title">Title</label>
        <input id="motion-edit-title" class="input" name="title" value="${esc(motion.title || "")}">
        <label class="label" for="motion-edit-body">Body (after "That this House …")</label>
        <textarea id="motion-edit-body" class="input" name="body" rows="5">${esc(motion.body || "")}</textarea>
        <div class="tile-bottom" style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn" type="submit">Save Edits</button>
        </div>
      </form>
      <p id="motion-edit-msg" class="muted" style="margin-top:4px;"></p>
    </section>
    ` : ""}
  `;

  // Vote buttons
  root.querySelectorAll("[data-action='vote']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!dbDiv || dbDiv.status !== "open") return;
      if (voteWeight <= 0 || !canVoteDivision(data)) return;
      const choice = btn.getAttribute("data-choice");
      const msg = root.querySelector("#div-msg");
      if (msg) msg.textContent = "Voting…";
      try {
        const result = await apiCastVote(dbDiv.id, choice);
        if (msg) msg.textContent = "Vote recorded.";
        // Re-render with updated data
        await renderHouseDb(root, data, motion);
      } catch (err) {
        if (msg) msg.textContent = `Error: ${err.message}`;
      }
    });
  });

  // Close division (speaker/admin)
  root.querySelector("[data-action='close-division']")?.addEventListener("click", async () => {
    if (!speaker && !isStaff) return;
    const msg = root.querySelector("#div-msg");
    if (msg) msg.textContent = "Closing…";
    try {
      await apiCloseDivision(dbDiv.id);
      await renderHouseDb(root, data, motion);
    } catch (err) {
      if (msg) msg.textContent = `Error: ${err.message}`;
    }
  });

  // NPC vote form (staff/speaker only)
  root.querySelector("#npc-vote-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const msgEl = root.querySelector("#npc-msg");
    if (msgEl) msgEl.textContent = "Saving…";
    const seats = getPartySeatMap(data);
    const npcParties = Object.keys(seats).filter(
      (p) => Number(seats[p]) > 0 && !PLAYABLE_PARTIES.has(p) && !/sinn\s*f[ée]in/i.test(p) && !/^speaker$/i.test(p)
    );
    const npcVotes = {};
    const rebelsByParty = {};
    const rebelsByPartyChoice = {};
    npcParties.forEach((p) => {
      const v = String(fd.get(`npc-${p}`) || "").toLowerCase();
      if (["aye", "no", "abstain"].includes(v)) npcVotes[p] = v;
      const rebels = Number(fd.get(`rebels-${p}`) || 0);
      if (rebels > 0) rebelsByParty[p] = rebels;
    });
    // Collect rebel counts + directions for playable parties (Labour, Conservative, Liberal Democrat)
    [...PLAYABLE_PARTIES].forEach((p) => {
      if (Number(seats[p] || 0) > 0) {
        const rebels = Number(fd.get(`rebels-${p}`) || 0);
        if (rebels > 0) rebelsByParty[p] = rebels;
        else delete rebelsByParty[p];
        const dir = String(fd.get(`rebel-dir-${p}`) || "").toLowerCase();
        if (dir && ["aye", "no", "abstain"].includes(dir)) rebelsByPartyChoice[p] = dir;
        else delete rebelsByPartyChoice[p];
      }
    });
    // Also collect rebel directions for NPC parties that have rebels
    npcParties.forEach((p) => {
      const rebels = Number(fd.get(`rebels-${p}`) || 0);
      if (rebels > 0) {
        const dir = String(fd.get(`rebel-dir-${p}`) || "").toLowerCase();
        if (dir && ["aye", "no", "abstain"].includes(dir)) rebelsByPartyChoice[p] = dir;
      }
    });
    try {
      await apiSetNpcVotes(dbDiv.id, npcVotes, rebelsByParty, rebelsByPartyChoice);
      if (msgEl) msgEl.textContent = "NPC votes saved.";
      await renderHouseDb(root, data, motion);
    } catch (err) {
      if (msgEl) msgEl.textContent = `Error: ${err.message}`;
    }
  });

  // Create division (speaker/admin, when no dbDiv yet)
  root.querySelector("[data-action='create-division']")?.addEventListener("click", async () => {
    const msg = root.querySelector("#div-msg");
    if (msg) msg.textContent = "Opening division…";
    try {
      await apiCreateDivision("motion", motion.id, motion.title || "");
      await renderHouseDb(root, data, motion);
    } catch (err) {
      if (msg) msg.textContent = `Error: ${err.message}`;
    }
  });

  // Set whip instruction form
  root.querySelector("#whip-instr-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const msgEl = root.querySelector("#whip-instr-msg");
    if (msgEl) msgEl.textContent = "Saving…";
    try {
      await apiSetPartyInstruction(dbDiv.id, {
        partySlug: charParty,
        position: fd.get("position"),
        whipLevel: Number(fd.get("whipLevel")),
        note: fd.get("note") || "",
      });
      if (msgEl) msgEl.textContent = "Instruction saved.";
      await renderHouseDb(root, data, motion);
    } catch (err) {
      if (msgEl) msgEl.textContent = `Error: ${err.message}`;
    }
  });

  // Rebel request form
  root.querySelector("#rebel-req-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const msgEl = root.querySelector("#rebel-req-msg");
    if (msgEl) msgEl.textContent = "Submitting…";
    try {
      await apiSubmitRebelRequest(dbDiv.id, fd.get("requestedVote"), fd.get("message") || "");
      if (msgEl) msgEl.textContent = "Request submitted.";
      await renderHouseDb(root, data, motion);
    } catch (err) {
      if (msgEl) msgEl.textContent = `Error: ${err.message}`;
    }
  });

  // Edit form (staff only)
  root.querySelector("#motion-edit-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!canStaff) return;
    const fd = new FormData(e.currentTarget);
    const editMsg = root.querySelector("#motion-edit-msg");
    if (editMsg) editMsg.textContent = "Saving…";
    const title = String(fd.get("title") || "").trim();
    const body = String(fd.get("body") || "").trim();
    if (title) motion.title = title;
    if (body) motion.body = body;
    try {
      await apiUpdateMotion(motion.id, motion);
      if (editMsg) editMsg.textContent = "Saved.";
      await renderHouseDb(root, data, motion);
    } catch (err) {
      if (editMsg) editMsg.textContent = `Error: ${err.message}`;
    }
  });
}

function renderEdm(root, data, edm) {
  const char = getCharacterContext(data);
  const speaker = isSpeaker(data);
  const canStaff = canAdminModOrSpeaker(data);
  const disallowed = isGovernmentMember(data);
  const w = currentWeight(data);
  edm.signatures ??= [];
  edm.npcSignatures ??= {};

  // Auto-archive expired EDM
  if (edm.status !== "archived" && edm.closesAtSimObj && isDeadlinePassed(edm.closesAtSimObj, data.gameState)) {
    edm.status = "archived";
    edm.archivedAtSim = formatSimMonthYear(data.gameState);
    apiUpdateMotion(edm.id, edm).catch((err) => console.error("[motion] Failed to archive EDM:", err));
  }

  const expired = edm.status === "archived";
  const signed = edm.signatures.some((s) => s.name === char?.name);
  const seats = getPartySeatMap(data);
  const npcParties = Object.entries(seats).filter(([party, n]) => Number(n) > 0 && !["Conservative", "Labour", "Liberal Democrat"].includes(party));
  const edmCountdown = edm.closesAtSimObj ? countdownToSimMonth(edm.closesAtSimObj.month, edm.closesAtSimObj.year, data.gameState) : "";

  root.innerHTML = `
    <section class="tile tile-form" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">EDM ${esc(edm.number)}: ${esc(edm.title)}</h2>
      <p class="muted">By ${esc(edm.author)} • Status: ${esc(edm.status || "open")}</p>
      <p class="muted">Open: ${esc(edm.openedAtSim || "—")} → ${esc(edm.closesAtSim || "—")}${edmCountdown ? ` (${edmCountdown})` : ""}</p>
      <p style="white-space:pre-wrap;"><b>That this House</b> ${esc(edm.body || "")}</p>
      <div class="tile-bottom" style="display:flex;gap:8px;flex-wrap:wrap;">
        ${(edm.debate?.topicUrl || edm.discourse_topic_url || edm.discourseTopicUrl || edm.debateUrl) ? `<a class="btn" href="${esc(edm.debate?.topicUrl || edm.discourse_topic_url || edm.discourseTopicUrl || edm.debateUrl)}" target="_blank" rel="noopener">Open Debate</a>` : `<span class="muted">No debate yet</span>`}
        <a class="btn" href="motions.html">Back to Motions</a>
      </div>
    </section>

    <section class="tile">
      <h3 style="margin-top:0;">Signatories</h3>
      <p><b>Signatories:</b> ${Math.round(edmWeightedSignatures(edm, data))}</p>
      <p><b>Signed by:</b> ${edm.signatures.length ? edm.signatures.map((s) => esc(s.name)).join(", ") : "No signatories yet."}</p>
      ${Object.entries(edm.npcSignatures).filter(([,v])=>v).length ? `<p><b>NPC signatures:</b> ${Object.entries(edm.npcSignatures).filter(([,v])=>v).map(([p]) => esc(p)).join(", ")}</p>` : ""}
      ${expired ? `<p class="muted"><b>Signature period has closed.</b></p>` : disallowed ? `<p class="muted"><b>Government members cannot sign EDMs.</b></p>` : signed ? `<p class="muted"><b>You have already signed.</b></p>` : `<button class="btn" data-action="sign-edm" ${w > 0 ? "" : "disabled"}>Sign EDM</button>`}

      ${speaker && !expired ? `
        <div style="margin-top:12px;">
          <h4>Speaker NPC Signatures</h4>
          <form id="npc-sign-form">
            ${npcParties.map(([party, n]) => `<label style="display:flex;gap:8px;align-items:center;margin-bottom:6px;"><input type="checkbox" name="npc-${esc(party)}" ${edm.npcSignatures?.[party] ? "checked" : ""}> ${esc(party)} (${Number(n)} seats)</label>`).join("")}
            <button class="btn" type="submit">Apply NPC Signatures</button>
          </form>
        </div>
      ` : ""}
    </section>

    ${canStaff ? `
    <section class="tile tile-form" style="margin-top:12px;">
      <h3 style="margin-top:0;">Edit EDM (Staff)</h3>
      <form id="edm-edit-form">
        <label class="label" for="edm-edit-title">Title</label>
        <input id="edm-edit-title" class="input" name="title" value="${esc(edm.title || "")}">
        <label class="label" for="edm-edit-body">Body (after "That this House …")</label>
        <textarea id="edm-edit-body" class="input" name="body" rows="5">${esc(edm.body || "")}</textarea>
        <div class="tile-bottom" style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn" type="submit">Save Edits</button>
        </div>
      </form>
      <p id="edm-edit-msg" class="muted" style="margin-top:4px;"></p>
    </section>
    ` : ""}
  `;

  root.querySelector("[data-action='sign-edm']")?.addEventListener("click", async () => {
    if (expired || disallowed || signed || w <= 0) return;
    try {
      const resp = await apiSignEdm(edm.id);
      if (resp?.motion) Object.assign(edm, resp.motion);
    } catch (err) {
      console.error("[edm.sign]", err?.message || err);
      return;
    }
    renderEdm(root, data, edm);
  });

  root.querySelector("#npc-sign-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!speaker) return;
    const fd = new FormData(e.currentTarget);
    npcParties.forEach(([party]) => {
      edm.npcSignatures[party] = !!fd.get(`npc-${party}`);
    });
    apiUpdateMotion(edm.id, edm).catch((err) => console.error("[motion] NPC sign failed:", err));
    renderEdm(root, data, edm);
  });

  root.querySelector("#edm-edit-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!canStaff) return;
    const fd = new FormData(e.currentTarget);
    const editMsg = root.querySelector("#edm-edit-msg");
    if (editMsg) editMsg.textContent = "Saving…";
    const title = String(fd.get("title") || "").trim();
    const body = String(fd.get("body") || "").trim();
    if (title) edm.title = title;
    if (body) edm.body = body;
    try {
      await apiUpdateMotion(edm.id, edm);
      if (editMsg) editMsg.textContent = "Saved.";
      renderEdm(root, data, edm);
    } catch (err) {
      if (editMsg) editMsg.textContent = `Error: ${err.message}`;
    }
  });
}

export async function initMotionPage(data) {
  const root = document.getElementById("motion-root") || document.querySelector("#motions-root");
  if (!root) return;
  ensureMotions(data);

  const { kind, id } = getParams();
  let item = getMotion(data, kind, id);

  // If not found in local state (e.g. newly created by another user or race condition),
  // try fetching directly from the DB via the API.
  if (!item && id) {
    try {
      const result = await apiGetMotion(id);
      if (result?.motion) {
        item = result.motion;
        // Merge into local state so subsequent lookups work.
        const motionKind = item.motion_type || item._motionType || kind;
        if (motionKind === "edm") {
          data.motions.edm.push(item);
        } else {
          data.motions.house.push(item);
        }
      }
    } catch (err) {
      console.error("[motion] API fallback failed:", err);
    }
  }

  if (!item) {
    root.innerHTML = `<div class="muted-block">Motion/EDM not found.</div>`;
    return;
  }

  // Determine kind from item if it came from the API (may carry _motionType).
  const resolvedKind = item.motion_type || item._motionType || kind;

  if (resolvedKind === "edm") {
    renderEdm(root, data, item);
    return;
  }

  await renderHouseDb(root, data, item);
}
