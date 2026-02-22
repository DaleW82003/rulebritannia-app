import { saveState } from "../core.js";
import { esc } from "../ui.js";
import { isSpeaker, canVoteDivision } from "../permissions.js";
import { ensureDivision, castDivisionVote, tallyDivision, closeDivision, resolveDivisionResult } from "../engines/division-engine.js";
import { buildDivisionWeights } from "../divisions.js";
import { getPartySeatMap } from "../engines/core-engine.js";
import { ensureMotions, isGovernmentMember } from "./motions.js";
import { getSimDate, simDateToObj, formatSimMonthYear, isDeadlinePassed, compareSimDates, countdownToSimMonth } from "../clock.js";

function getCharacter(data) {
  return data?.currentCharacter || data?.currentPlayer || {};
}

function getParams() {
  const u = new URL(window.location.href);
  return { kind: u.searchParams.get("kind") || "house", id: u.searchParams.get("id") || "" };
}

function currentWeight(data) {
  const c = getCharacter(data);
  const { effectiveWeights } = buildDivisionWeights(data);
  return Number(effectiveWeights[String(c?.name || "")] || 0);
}

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

function renderHouse(root, data, motion) {
  const char = getCharacter(data);
  const speaker = isSpeaker(data);
  const voteWeight = currentWeight(data);
  const simCurrentObj = simDateToObj(getSimDate(data.gameState));

  // Auto-close division if deadline passed
  if (motion.division?.status === "open" && motion.division.endSimObj && compareSimDates(simCurrentObj, motion.division.endSimObj) >= 0) {
    closeDivision(motion);
    motion.outcome = resolveDivisionResult(motion, data);
    motion.status = "archived";
    motion.archivedAtSim = formatSimMonthYear(data.gameState);
    saveState(data);
  }

  ensureDivision(motion);
  const totals = tallyDivision(motion, data);
  const myVote = motion.division?.votes?.[char?.name || ""]?.choice || "";
  const debateCountdown = motion.debateEndSimObj ? countdownToSimMonth(motion.debateEndSimObj.month, motion.debateEndSimObj.year, data.gameState) : "";
  const divisionCountdown = motion.division?.endSimObj ? countdownToSimMonth(motion.division.endSimObj.month, motion.division.endSimObj.year, data.gameState) : "";

  root.innerHTML = `
    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Motion ${esc(motion.number)}: ${esc(motion.title)}</h2>
      <p class="muted">By ${esc(motion.author)} • Status: ${esc(motion.status || "open")}</p>
      <p class="muted">Debate: ${esc(motion.debateStartSim || "—")} → ${esc(motion.debateEndSim || "—")}${debateCountdown ? ` (${debateCountdown})` : ""}</p>
      <p class="muted">Division: ${esc(motion.division?.startSim || "—")} → ${esc(motion.division?.endSim || "—")}${divisionCountdown ? ` (${divisionCountdown})` : ""}</p>
      <p style="white-space:pre-wrap;"><b>That this House</b> ${esc(motion.body || "")}</p>
      <div class="tile-bottom" style="display:flex;gap:8px;flex-wrap:wrap;">
        <a class="btn" href="${esc(motion.debateUrl || "#")}" target="_blank" rel="noopener">Open Debate</a>
        <a class="btn" href="motions.html">Back to Motions</a>
      </div>
    </section>

    <section class="tile">
      <h3 style="margin-top:0;">Division</h3>
      <p class="muted">Aye: <b>${totals.aye}</b> • No: <b>${totals.no}</b> • Abstain: <b>${totals.abstain}</b> • Your weight: <b>${voteWeight.toFixed(2)}</b></p>
      ${motion.division.status === "open" ? `
        <div class="tile-bottom" style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn ${myVote === "aye" ? "primary" : ""}" data-action="vote" data-choice="aye" ${canVoteDivision(data) && voteWeight > 0 ? "" : "disabled"}>Aye</button>
          <button class="btn ${myVote === "no" ? "primary" : ""}" data-action="vote" data-choice="no" ${canVoteDivision(data) && voteWeight > 0 ? "" : "disabled"}>No</button>
          <button class="btn ${myVote === "abstain" ? "primary" : ""}" data-action="vote" data-choice="abstain" ${canVoteDivision(data) && voteWeight > 0 ? "" : "disabled"}>Abstain</button>
        </div>
      ` : `<p class="muted">Division closed. Outcome: <b>${esc(motion.outcome || resolveDivisionResult(motion, data))}</b></p>`}
      ${speaker ? `<div class="tile-bottom" style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn danger" data-action="close-division">Close Division</button></div>` : ""}
    </section>
  `;

  root.querySelectorAll("[data-action='vote']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (motion.division.status !== "open") return;
      const choice = btn.getAttribute("data-choice");
      const name = char?.name || "MP";
      if (voteWeight <= 0) return;
      castDivisionVote(motion, name, { party: char?.party || "Independent", weight: voteWeight, choice });
      saveState(data);
      renderHouse(root, data, motion);
    });
  });

  root.querySelector("[data-action='close-division']")?.addEventListener("click", () => {
    if (!speaker) return;
    closeDivision(motion);
    motion.outcome = resolveDivisionResult(motion, data);
    motion.status = "archived";
    saveState(data);
    renderHouse(root, data, motion);
  });
}

function renderEdm(root, data, edm) {
  const char = getCharacter(data);
  const speaker = isSpeaker(data);
  const disallowed = isGovernmentMember(data);
  const w = currentWeight(data);
  edm.signatures ??= [];
  edm.npcSignatures ??= {};

  // Auto-archive expired EDM
  if (edm.status !== "archived" && edm.closesAtSimObj && isDeadlinePassed(edm.closesAtSimObj, data.gameState)) {
    edm.status = "archived";
    edm.archivedAtSim = formatSimMonthYear(data.gameState);
    saveState(data);
  }

  const expired = edm.status === "archived";
  const signed = edm.signatures.some((s) => s.name === char?.name);
  const seats = getPartySeatMap(data);
  const npcParties = Object.entries(seats).filter(([party, n]) => Number(n) > 0 && !["Conservative", "Labour", "Liberal Democrat"].includes(party));
  const edmCountdown = edm.closesAtSimObj ? countdownToSimMonth(edm.closesAtSimObj.month, edm.closesAtSimObj.year, data.gameState) : "";

  root.innerHTML = `
    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">EDM ${esc(edm.number)}: ${esc(edm.title)}</h2>
      <p class="muted">By ${esc(edm.author)} • Status: ${esc(edm.status || "open")}</p>
      <p class="muted">Open: ${esc(edm.openedAtSim || "—")} → ${esc(edm.closesAtSim || "—")}${edmCountdown ? ` (${edmCountdown})` : ""}</p>
      <p style="white-space:pre-wrap;"><b>That this House</b> ${esc(edm.body || "")}</p>
      <div class="tile-bottom" style="display:flex;gap:8px;flex-wrap:wrap;">
        <a class="btn" href="${esc(edm.debateUrl || "#")}" target="_blank" rel="noopener">Open Debate</a>
        <a class="btn" href="motions.html">Back to Motions</a>
      </div>
    </section>

    <section class="tile">
      <h3 style="margin-top:0;">Signatories</h3>
      <p><b>Weighted signatories:</b> ${edmWeightedSignatures(edm, data).toFixed(2)}</p>
      <p><b>Signed by:</b> ${edm.signatures.length ? edm.signatures.map((s) => `${esc(s.name)} (${Number(s.weight || 0).toFixed(2)})`).join(", ") : "No player signatories yet."}</p>
      ${Object.entries(edm.npcSignatures).filter(([,v])=>v).length ? `<p><b>NPC signatures:</b> ${Object.entries(edm.npcSignatures).filter(([,v])=>v).map(([p]) => esc(p)).join(", ")}</p>` : ""}
      ${expired ? `<p class="muted"><b>Signature period has closed.</b></p>` : disallowed ? `<p class="muted"><b>Government members cannot sign EDMs.</b></p>` : signed ? `<p class="muted"><b>You have already signed.</b></p>` : `<button class="btn" data-action="sign-edm" ${w > 0 ? "" : "disabled"}>Sign EDM (${w.toFixed(2)})</button>`}

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
  `;

  root.querySelector("[data-action='sign-edm']")?.addEventListener("click", () => {
    if (expired || disallowed || signed || w <= 0) return;
    edm.signatures.push({ name: char?.name || "MP", party: char?.party || "Independent", weight: w });
    saveState(data);
    renderEdm(root, data, edm);
  });

  root.querySelector("#npc-sign-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!speaker) return;
    const fd = new FormData(e.currentTarget);
    npcParties.forEach(([party]) => {
      edm.npcSignatures[party] = !!fd.get(`npc-${party}`);
    });
    saveState(data);
    renderEdm(root, data, edm);
  });
}

export function initMotionPage(data) {
  const root = document.getElementById("motion-root") || document.querySelector("#motions-root");
  if (!root) return;
  ensureMotions(data);

  const { kind, id } = getParams();
  const item = getMotion(data, kind, id);
  if (!item) {
    root.innerHTML = `<div class="muted-block">Motion/EDM not found.</div>`;
    return;
  }

  if (kind === "edm") {
    if (!item.debateUrl) item.debateUrl = `https://forum.rulebritannia.org/t/edm-${item.number}-${encodeURIComponent((item.title || "edm").toLowerCase().replaceAll(" ", "-"))}`;
    renderEdm(root, data, item);
    return;
  }

  if (!item.debateUrl) item.debateUrl = `https://forum.rulebritannia.org/t/motion-${item.number}-${encodeURIComponent((item.title || "motion").toLowerCase().replaceAll(" ", "-"))}`;
  renderHouse(root, data, item);
}
