import { saveData } from "../core.js";

export function getCharacterContext(data) {
  return data?.currentCharacter || data?.currentPlayer || {};
}

export function hasRoleFlag(data, role) {
  const user = data?.currentUser || {};
  if (role === "admin") return !!user.isAdmin || (user.roles || []).includes("admin");
  if (role === "mod") return !!user.isMod || (user.roles || []).includes("mod");
  if (role === "speaker") return !!user.isSpeaker || (user.roles || []).includes("speaker") || !!getCharacterContext(data)?.isSpeaker;
  return (user.roles || []).includes(role);
}

export function hasOffice(data, officeId) {
  return String(getCharacterContext(data)?.office || "") === String(officeId || "");
}

export function setAbsenceState(data, { absent, delegatedTo }) {
  const c = getCharacterContext(data);
  if (!c || !c.name) return false;
  c.absent = !!absent;
  c.delegatedTo = absent ? String(delegatedTo || "").trim() || null : null;
  saveData(data);
  return true;
}

export function getPartySeatMap(data) {
  const parties = Array.isArray(data?.parliament?.parties) ? data.parliament.parties : [];
  return Object.fromEntries(parties.map((p) => [String(p.name || ""), Number(p.seats || 0)]));
}

export function getWeightedVotePower(data, partyName, { rebelsByParty = {} } = {}) {
  const seats = Number(getPartySeatMap(data)[String(partyName || "")] || 0);
  const rebels = Number(rebelsByParty[String(partyName || "")] || 0);
  return Math.max(0, seats - rebels);
}

export function runSundayRoll(data) {
  data.hansard ??= { rollLog: {} };
  data.hansard.rollLog ??= {};
  data.hansard.rollLog.completedSinceSimStart = Number(data.hansard.rollLog.completedSinceSimStart || 0) + 1;
  data.hansard.rollLog.lastForcedAt = new Date().toISOString();

  const bills = Array.isArray(data.orderPaperCommons) ? data.orderPaperCommons : [];
  data.hansard.passed ??= [];
  data.hansard.defeated ??= [];

  const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const remaining = [];

  for (const bill of bills) {
    const divisionAt = Number(bill?.divisionResolvedAt || bill?.division?.closedAt || 0);
    const matured = Number.isFinite(divisionAt) && divisionAt > 0 && (now - divisionAt) >= FOURTEEN_DAYS_MS;

    if (bill?.status === "passed" && matured) {
      const passedItem = { ...bill, archivedAtSim: bill.archivedAtSim || "Sunday Roll" };
      const becameAct = String(bill.stage || "").toLowerCase().includes("act") || String(bill.finalStage || "").toLowerCase().includes("royal assent");
      passedItem.legislationKind = becameAct ? "Act of Parliament" : "Bill";
      if (becameAct) passedItem.title = String(passedItem.title || "").replace(/bill/ig, "Act");
      data.hansard.passed.unshift(passedItem);
      continue;
    }

    if ((bill?.status === "failed" || bill?.status === "stalled") && matured) {
      data.hansard.defeated.unshift({ ...bill, archivedAtSim: bill.archivedAtSim || "Sunday Roll" });
      continue;
    }

    remaining.push(bill);
  }

  data.orderPaperCommons = remaining;
  saveData(data);
}
