import { getPartySeatMap } from "./core-engine.js";

export function ensureDivision(container, defaults = {}) {
  container.division ??= {
    status: "open",
    votes: {},
    openedAt: Date.now(),
    closesAt: Date.now() + 60 * 60 * 1000,
    rebelsByParty: {},
    npcVotes: {}
  };
  container.division.votes ??= {};
  container.division.rebelsByParty ??= {};
  container.division.npcVotes ??= {};
  Object.assign(container.division, defaults || {});
  return container.division;
}

export function castDivisionVote(container, actorKey, vote) {
  const division = ensureDivision(container);
  if (division.status !== "open") return false;
  division.votes[String(actorKey)] = {
    actor: String(actorKey),
    party: String(vote.party || "Independent"),
    choice: String(vote.choice || "abstain").toLowerCase(),
    weight: Number(vote.weight || 1),
    at: Date.now()
  };
  return true;
}

export function setRebellions(container, rebelsByParty = {}) {
  const division = ensureDivision(container);
  division.rebelsByParty = { ...rebelsByParty };
}

export function setNpcVotes(container, npcVotes = {}) {
  const division = ensureDivision(container);
  division.npcVotes = { ...npcVotes };
}

export function closeDivision(container) {
  const division = ensureDivision(container);
  division.status = "closed";
}

export function tallyDivision(container, data) {
  const division = ensureDivision(container);
  const totals = { aye: 0, no: 0, abstain: 0 };

  Object.values(division.votes).forEach((v) => {
    if (totals[v.choice] !== undefined) totals[v.choice] += Number(v.weight || 0);
  });

  const seats = getPartySeatMap(data);
  for (const [party, vote] of Object.entries(division.npcVotes || {})) {
    const partySeats = Number(seats[party] || 0);
    const rebels = Number((division.rebelsByParty || {})[party] || 0);
    const weight = Math.max(0, partySeats - rebels);
    if (totals[vote] !== undefined) totals[vote] += weight;
  }

  return totals;
}

export function resolveDivisionResult(container, data) {
  const totals = tallyDivision(container, data);
  if (totals.aye > totals.no) return "passed";
  if (totals.no > totals.aye) return "failed";
  return "tied";
}
