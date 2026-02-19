const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

function nowMs() {
  return Date.now();
}

function isSettledBackbencher(player) {
  if (!player) return false;
  if (player.role !== "backbencher") return true;
  const joined = Date.parse(player.joinedAt || "");
  if (!Number.isFinite(joined)) return true;
  return (nowMs() - joined) >= TWO_WEEKS_MS;
}

function findPartyLeader(members) {
  return (
    members.find((m) => m.partyLeader) ||
    members.find((m) => m.role === "prime-minister") ||
    members.find((m) => m.role === "leader-opposition") ||
    members.find((m) => m.role === "party-leader-3rd-4th") ||
    members[0] ||
    null
  );
}

function activePlayers(data) {
  const list = Array.isArray(data?.players) ? data.players.filter(Boolean) : [];
  const current = data?.currentCharacter || data?.currentPlayer;
  if (current?.name && !list.some((p) => p.name === current.name)) {
    list.push(current);
  }
  return list.filter((p) => p.active !== false);
}

export function buildDivisionWeights(data) {
  const seatsByParty = Object.fromEntries((data?.parliament?.parties || []).map((p) => [p.name, Number(p.seats || 0)]));
  const players = activePlayers(data);
  const byParty = new Map();
  players.forEach((p) => {
    const party = p.party || "Independent";
    if (!byParty.has(party)) byParty.set(party, []);
    byParty.get(party).push(p);
  });

  const baseWeights = {};
  const partyByName = {};
  const leaderByParty = {};

  byParty.forEach((members, party) => {
    members.forEach((m) => {
      baseWeights[m.name] = 0;
      partyByName[m.name] = party;
    });

    const seats = Math.max(0, Math.floor(Number(seatsByParty[party] || 0)));
    const leader = findPartyLeader(members);
    if (leader) leaderByParty[party] = leader.name;

    const newBackbenchers = members.filter((m) => m.role === "backbencher" && !isSettledBackbencher(m));
    newBackbenchers.forEach((m) => {
      baseWeights[m.name] += 1;
    });

    let remaining = Math.max(0, seats - newBackbenchers.length);
    const splitMembers = members.filter((m) => !(m.role === "backbencher" && !isSettledBackbencher(m)));

    if (!splitMembers.length) {
      if (leader) baseWeights[leader.name] += remaining;
      return;
    }

    const each = Math.floor(remaining / splitMembers.length);
    let odd = remaining - (each * splitMembers.length);
    splitMembers.forEach((m) => {
      baseWeights[m.name] += each;
    });

    if (odd > 0) {
      const oddTarget = (leader && splitMembers.some((m) => m.name === leader.name)) ? leader.name : splitMembers[0].name;
      baseWeights[oddTarget] += odd;
    }
  });

  const effectiveWeights = { ...baseWeights };
  const playersByName = Object.fromEntries(players.map((p) => [p.name, p]));

  Object.values(playersByName).forEach((p) => {
    if (!p?.absent) return;
    const from = p.name;
    const amount = Number(effectiveWeights[from] || 0);
    if (amount <= 0) return;

    const party = p.party || "Independent";
    const leaderName = leaderByParty[party] || null;
    const isLeader = leaderName && from === leaderName;

    let target = null;
    if (isLeader) {
      const candidate = String(p.delegatedTo || "").trim();
      if (candidate && playersByName[candidate] && partyByName[candidate] === party && !playersByName[candidate].absent) {
        target = candidate;
      }
    } else if (leaderName && playersByName[leaderName] && !playersByName[leaderName].absent) {
      target = leaderName;
    }

    effectiveWeights[from] = 0;
    if (target && target !== from) {
      effectiveWeights[target] = Number(effectiveWeights[target] || 0) + amount;
    }
  });

  return { effectiveWeights, baseWeights, partyByName, leaderByParty };
}

export function getCurrentCharacter(data) {
  return data?.currentCharacter || data?.currentPlayer || {};
}

export function currentCharacterWeight(data) {
  const char = getCurrentCharacter(data);
  const { effectiveWeights } = buildDivisionWeights(data);
  return Number(effectiveWeights[char?.name] || 0);
}

export function tallyDivisionVotes(votes, data) {
  const { effectiveWeights } = buildDivisionWeights(data);
  const totals = { aye: 0, no: 0, abstain: 0 };
  Object.entries(votes || {}).forEach(([name, v]) => {
    const c = String(v?.choice || "abstain").toLowerCase();
    if (!(c in totals)) return;
    const w = Number(effectiveWeights[name] ?? v?.weight ?? 0);
    totals[c] += w;
  });
  return totals;
}
