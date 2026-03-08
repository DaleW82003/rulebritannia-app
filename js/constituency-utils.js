// js/constituency-utils.js
// Shared helpers for constituency dropdowns used across user.js and personal.js.

import { esc } from "./ui.js";

/**
 * Returns true if a constituency seat is already occupied — either by a player
 * character or by a named NPC/character entry in the constituencies list.
 *
 * @param {object} data - game data object
 * @param {string} constituencyName - constituency name to check
 */
export function seatTaken(data, constituencyName) {
  const name = String(constituencyName || "").toLowerCase();
  if (!name) return false;
  const byPlayer = (data.players || []).some((p) => String(p.constituency || "").toLowerCase() === name);
  if (byPlayer) return true;
  const seat = (data.constituencies || []).find((c) => String(c.name || "").toLowerCase() === name);
  return Boolean(seat && ((seat.mpType === "npc" && seat.mpName) || (seat.mpType === "character" && seat.mpName)));
}

/**
 * Return all constituencies for a party, sorted available-first then taken,
 * each annotated with a `taken` flag so callers can render them disabled.
 *
 * @param {object} data - game data object
 * @param {Array}  pendingApps - pending character applications (used to mark seats as taken)
 * @param {string} [partyName] - optional party filter
 */
export function allConstituenciesForPartyWithStatus(data, pendingApps, partyName) {
  const pending = new Set((pendingApps || []).map((p) => String(p.constituency || "").toLowerCase()));
  return (data.constituencies || [])
    .filter((c) => !partyName || String(c.party || "") === partyName)
    .map((c) => ({
      ...c,
      taken: seatTaken(data, c.name) || pending.has(String(c.name || "").toLowerCase()),
    }))
    .sort((a, b) => {
      if (a.taken !== b.taken) return a.taken ? 1 : -1; // available first
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
}

/** Render <option> elements for a constituency dropdown, greying out taken seats. */
export function renderConstituencyOptions(constituencies, fallbackMsg) {
  if (!constituencies.length) return `<option value="">${fallbackMsg}</option>`;
  return `<option value="">Select constituency</option>` + constituencies.map((c) =>
    c.taken
      ? `<option value="${esc(c.name)}" disabled style="color:#aaa;">${esc(c.name)} (${esc(c.region)}, ${esc(c.nation)}) — Taken</option>`
      : `<option value="${esc(c.name)}">${esc(c.name)} (${esc(c.region)}, ${esc(c.nation)})</option>`
  ).join("");
}
