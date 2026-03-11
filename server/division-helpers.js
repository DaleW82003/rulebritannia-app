/**
 * Division and parliamentary display helpers.
 *
 * Centralises all division-tally computation, seat-weight helpers, and
 * parliamentary display-name enrichment that was previously inline in
 * server/index.js.
 *
 * Extracted areas:
 *   - SPEAKER_PARTY_RE / SINN_FEIN_PARTY_RE party-matching regex constants
 *   - getPartySeatsFromConstituencies / getPartiesRankedBySeats / getThirdPartySlug
 *   - RH_QUALIFYING_SPEC_IDS / PC_QUALIFYING_SPEC_IDS constants
 *   - getCharacterParliamentaryMeta / formatParliamentaryName
 *   - getCharacterDisplayName / batchGetCharacterDisplayNames
 *   - enrichCharacterRowWithDisplay / batchEnrichCharacterRows
 *   - computeAllPlayerWeights (pure — weight distribution algorithm)
 *   - computeCharacterWeight (pure — single-character weight lookup)
 *   - computeDivisionTallyFromDb (takes explicit db handle)
 *
 * DB-dependent functions that previously closed over the global pool now
 * either accept pool as an explicit parameter (existing convention) or import
 * it from ./db.js (for the two functions that did not already take pool).
 */

import { pool as defaultPool } from "./db.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Regex matching the Speaker party (does not vote; tie-break only). */
export const SPEAKER_PARTY_RE  = /^speaker$/i;

/** Regex matching Sinn Féin (do not take their seats; always abstain). */
export const SINN_FEIN_PARTY_RE = /sinn\s*f[ée]in/i;

/** Offices that make a character permanently "Right Honourable". */
export const RH_QUALIFYING_SPEC_IDS = ["prime-minister", "leader-opposition"];

/**
 * Offices that confer permanent Privy Council membership on appointment.
 * Includes the third-party leader (RH while in post; PC for life via this grant).
 * Note: rh_ever covers PM and LoTO; third-party leader is RH via
 * is_third_party_leader but not rh_ever.
 */
export const PC_QUALIFYING_SPEC_IDS = ["prime-minister", "leader-opposition", "party-leader-3rd-4th"];

// ─────────────────────────────────────────────────────────────────────────────
// Seat helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get party seat totals from the constituencies table.
 * This is the canonical, DB-authoritative source for weighted voting calculations,
 * matching what is displayed on the constituencies page.
 *
 * @param {import('pg').Pool} pool - pg Pool
 * @returns {Promise<Object>} { partyName: seatCount }
 */
export async function getPartySeatsFromConstituencies(pool) {
  const { rows } = await pool.query(
    "SELECT party, COUNT(*) AS seats FROM constituencies WHERE party IS NOT NULL AND party <> '' GROUP BY party"
  );
  return Object.fromEntries(rows.map((r) => [String(r.party), Number(r.seats)]));
}

/**
 * Return parties ranked by parliamentary seats (descending).
 * Tie-break rule: when seat totals tie, sort lexicographically by slug ascending.
 * This keeps Third Party selection deterministic.
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array<{slug:string, seats:number}>>}
 */
export async function getPartiesRankedBySeats(pool) {
  const { rows } = await pool.query(
    `SELECT p.slug, COUNT(c.id) AS seats
       FROM parties p
       LEFT JOIN constituencies c ON c.party = p.name
      GROUP BY p.slug
      ORDER BY COUNT(c.id) DESC, p.slug ASC`
  );
  return rows.map((r) => ({ slug: String(r.slug), seats: Number(r.seats || 0) }));
}

/**
 * Return the slug of the third-largest party by seat count.
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<string|null>}
 */
export async function getThirdPartySlug(pool) {
  const ranked = await getPartiesRankedBySeats(pool);
  return ranked[2]?.slug || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parliamentary meta / display name helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return parliamentary-status flags for a character.
 *
 * @param {import('pg').Pool} pool
 * @param {string|null} characterId
 * @returns {Promise<{is_mp:boolean, is_pc:boolean, is_privy_current:boolean, is_rh:boolean, is_third_party_leader:boolean}>}
 */
export async function getCharacterParliamentaryMeta(pool, characterId) {
  if (!characterId) return { is_mp: false, is_pc: false, is_privy_current: false, is_rh: false, is_third_party_leader: false };

  const thirdPartySlug = await getThirdPartySlug(pool);
  const { rows } = await pool.query(
    `SELECT c.id, c.rh_ever, c.tpl_ever, c.is_npc,
            EXISTS (SELECT 1 FROM constituencies k WHERE LOWER(k.name) = LOWER(c.constituency)
                    AND (k.mp_type = 'character' OR (k.mp_type = 'npc' AND c.is_npc = TRUE))
                    AND COALESCE(c.constituency, '') != '') AS is_mp,
            EXISTS (SELECT 1 FROM privy_council_members pcm WHERE pcm.character_id = c.id AND pcm.removed_at IS NULL) AS is_privy_current,
            EXISTS (
              SELECT 1 FROM office_assignments oa
                JOIN offices o ON o.id = oa.office_id
               WHERE oa.character_id = c.id
                 AND o.type = 'cabinet'
            ) AS has_cabinet_office,
            EXISTS (
              SELECT 1 FROM parties p
               WHERE p.leader_character_id = c.id
                 AND $2::text IS NOT NULL
                 AND p.slug = $2
            ) AS is_third_party_leader
       FROM characters c
      WHERE c.id = $1
      LIMIT 1`,
    [characterId, thirdPartySlug]
  );
  const m = rows[0] || {};
  // rh_ever: set permanently when a character is first appointed PM or LoTO. Never reverts.
  // has_cabinet_office: any current cabinet office gives RH while in post.
  // is_privy_current: current PC membership also qualifies for RH.
  const is_rh = Boolean(m.rh_ever || m.is_privy_current || m.has_cabinet_office || m.is_third_party_leader);
  // PC post-nominal: only for PM/LoTO (rh_ever) and third-party leaders (tpl_ever) — permanently once held.
  const is_pc = Boolean(m.rh_ever || m.tpl_ever);
  return {
    is_mp: Boolean(m.is_mp),
    is_pc,
    is_privy_current: Boolean(m.is_privy_current),
    is_rh,
    is_third_party_leader: Boolean(m.is_third_party_leader),
  };
}

/**
 * Format a bare character name with the correct parliamentary title and post-nominals.
 *
 * @param {{bareName:string, isRH?:boolean, isMP?:boolean, isPC?:boolean}} opts
 * @returns {string}
 */
export function formatParliamentaryName({ bareName, isRH = false, isMP = false, isPC = false }) {
  const n = String(bareName || "").trim();
  if (!n) return "";
  const title = isRH ? "The Right Honourable" : "The Honourable";
  // MP is universal — every character is an MP so it always appears.
  const suffix = ["MP", isPC ? "PC" : ""].filter(Boolean).join(" ");
  return [title, n, suffix].filter(Boolean).join(" ").trim();
}

/**
 * Return the full formatted parliamentary display name for a single character.
 *
 * @param {import('pg').Pool} pool
 * @param {string|null} characterId
 * @param {string} fallbackName
 * @returns {Promise<string>}
 */
export async function getCharacterDisplayName(pool, characterId, fallbackName = "") {
  if (!characterId) return String(fallbackName || "");
  const { rows } = await pool.query("SELECT name FROM characters WHERE id = $1 LIMIT 1", [characterId]);
  const bareName = rows[0]?.name || fallbackName || "";
  const meta = await getCharacterParliamentaryMeta(pool, characterId);
  return formatParliamentaryName({ bareName, isRH: meta.is_rh, isMP: meta.is_mp, isPC: meta.is_pc });
}

/**
 * Efficiently compute display names for many characters in a single DB round-trip.
 * Returns an array of display name strings in the same order as the input entries.
 * Null/undefined IDs use the entry's fallback string directly.
 *
 * @param {import('pg').Pool} pool
 * @param {Array<{ id: string|null|undefined, fallback: string }>} entries
 * @returns {Promise<string[]>}
 */
export async function batchGetCharacterDisplayNames(pool, entries) {
  const ids = [...new Set(entries.map((e) => e.id).filter(Boolean))];
  if (!ids.length) {
    return entries.map((e) => e.fallback || "");
  }

  const thirdPartySlug = await getThirdPartySlug(pool);
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.rh_ever, c.tpl_ever, c.is_npc,
            EXISTS (SELECT 1 FROM constituencies k WHERE LOWER(k.name) = LOWER(c.constituency)
                    AND (k.mp_type = 'character' OR (k.mp_type = 'npc' AND c.is_npc = TRUE))
                    AND COALESCE(c.constituency, '') != '') AS is_mp,
            EXISTS (SELECT 1 FROM privy_council_members pcm WHERE pcm.character_id = c.id AND pcm.removed_at IS NULL) AS is_privy_current,
            EXISTS (SELECT 1 FROM office_assignments oa JOIN offices o ON o.id = oa.office_id WHERE oa.character_id = c.id AND o.type = 'cabinet') AS has_cabinet_office,
            EXISTS (SELECT 1 FROM parties p WHERE p.leader_character_id = c.id AND $2::text IS NOT NULL AND p.slug = $2) AS is_third_party_leader
       FROM characters c WHERE c.id = ANY($1::uuid[])`,
    [ids, thirdPartySlug]
  );

  const byId = Object.fromEntries(rows.map((r) => {
    const is_rh = Boolean(r.rh_ever || r.is_privy_current || r.has_cabinet_office || r.is_third_party_leader);
    const is_pc = Boolean(r.rh_ever || r.tpl_ever);
    return [r.id, formatParliamentaryName({ bareName: r.name || "", isRH: is_rh, isMP: Boolean(r.is_mp), isPC: is_pc })];
  }));

  return entries.map((e) => (e.id ? (byId[e.id] ?? (e.fallback || "")) : (e.fallback || "")));
}

/**
 * Enrich a single character row with display_name, is_mp, is_pc, is_privy, is_rh.
 * Uses the module-level pool import for backward compatibility with call sites that
 * do not pass a pool argument.
 *
 * @param {object} row — must have at least { id, name }
 * @returns {Promise<object>}
 */
export async function enrichCharacterRowWithDisplay(row) {
  const meta = await getCharacterParliamentaryMeta(defaultPool, row?.id);
  return {
    ...row,
    display_name: formatParliamentaryName({ bareName: row?.name || "", isRH: meta.is_rh, isMP: meta.is_mp, isPC: meta.is_pc }),
    is_mp: meta.is_mp,
    is_pc: meta.is_pc,
    is_privy: meta.is_privy_current,
    is_rh: meta.is_rh,
  };
}

/**
 * Batch-enrich an array of character rows with display_name, is_mp, is_pc, is_privy, and is_rh
 * using a single DB round-trip instead of one query per row.
 *
 * @param {import('pg').Pool} pool — database connection pool
 * @param {Array<Object>} rows — character rows, each must have at least { id, name }
 * @returns {Promise<Array<Object>>} — same rows with display_name/is_mp/is_pc/is_privy/is_rh merged in
 */
export async function batchEnrichCharacterRows(pool, rows) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id).filter(Boolean);
  if (!ids.length) return rows.map((r) => ({ ...r, display_name: r.name || "", is_mp: false, is_pc: false, is_privy: false, is_rh: false }));

  const thirdPartySlug = await getThirdPartySlug(pool);
  const { rows: metaRows } = await pool.query(
    `SELECT c.id, c.rh_ever, c.tpl_ever, c.is_npc,
            EXISTS (SELECT 1 FROM constituencies k WHERE LOWER(k.name) = LOWER(c.constituency)
                    AND (k.mp_type = 'character' OR (k.mp_type = 'npc' AND c.is_npc = TRUE))
                    AND COALESCE(c.constituency, '') != '') AS is_mp,
            EXISTS (SELECT 1 FROM privy_council_members pcm WHERE pcm.character_id = c.id AND pcm.removed_at IS NULL) AS is_privy_current,
            EXISTS (SELECT 1 FROM office_assignments oa JOIN offices o ON o.id = oa.office_id WHERE oa.character_id = c.id AND o.type = 'cabinet') AS has_cabinet_office,
            EXISTS (SELECT 1 FROM parties p WHERE p.leader_character_id = c.id AND $2::text IS NOT NULL AND p.slug = $2) AS is_third_party_leader
       FROM characters c WHERE c.id = ANY($1::uuid[])`,
    [ids, thirdPartySlug]
  );

  // Store only the boolean flags; the display name is computed per-row using the original row.name.
  const byId = Object.fromEntries(metaRows.map((r) => {
    const is_rh = Boolean(r.rh_ever || r.is_privy_current || r.has_cabinet_office || r.is_third_party_leader);
    const is_pc = Boolean(r.rh_ever || r.tpl_ever);
    return [r.id, { is_mp: Boolean(r.is_mp), is_pc, is_privy: Boolean(r.is_privy_current), is_rh }];
  }));

  return rows.map((row) => {
    const meta = byId[row.id];
    if (!meta) return { ...row, display_name: row.name || "", is_mp: false, is_pc: false, is_privy: false, is_rh: false };
    return {
      ...row,
      display_name: formatParliamentaryName({ bareName: row.name || "", isRH: meta.is_rh, isMP: meta.is_mp, isPC: meta.is_pc }),
      is_mp: meta.is_mp,
      is_pc: meta.is_pc,
      is_privy: meta.is_privy,
      is_rh: meta.is_rh,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Vote weight computation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute weighted vote weights for all active players.
 *
 * Formula: each party's constituency seat total is distributed evenly among its
 * active, settled players. New backbenchers receive 1 for their first 4 sim months
 * (equivalent to 14 real days under the current sim clock) until settled.
 * Absent players' weights delegate to their party leader (or a nominated deputy)
 * **unless** `applyDelegation` is false — use that flag for EDM signing where a
 * member cannot sign on someone else's behalf.
 *
 * Special rules:
 * - Speaker party members receive 0 weight (Speaker does not vote; tie-break only).
 * - Sinn Féin members receive 0 weight (do not take their seats).
 *
 * @param {Object}  seatsByParty             - { partyName: seatCount } from constituencies DB
 * @param {Array}   players                  - active players from game state (with absent/delegatedTo/joinedAt/role)
 * @param {Object}  [opts]
 * @param {boolean} [opts.applyDelegation=true] - when false, absent members' weights are NOT
 *   routed to their delegation target; use for EDM signature weight computation.
 * @returns {{ effectiveWeights: Object, baseWeights: Object, leaderByParty: Object }}
 */
export function computeAllPlayerWeights(seatsByParty, players, { applyDelegation = true, currentSimMonth = null, currentSimYear = null } = {}) {
  const FOUR_SIM_MONTHS = 4;
  const allPlayers = (players || []).filter((p) => p != null && p.active !== false);

  function simMonthsElapsed(joinedMonth, joinedYear) {
    if (!joinedMonth || !joinedYear || !currentSimMonth || !currentSimYear) return null;
    return (currentSimYear - joinedYear) * 12 + (currentSimMonth - joinedMonth);
  }

  function isSettledBackbencher(p) {
    if (!p || p.role !== "backbencher") return true;
    // Prefer sim-clock comparison when joinedSimMonth/joinedSimYear are available
    const elapsed = simMonthsElapsed(p.joinedSimMonth, p.joinedSimYear);
    if (elapsed !== null) return elapsed >= FOUR_SIM_MONTHS;
    // Fall back to wall-clock (14 real days ≈ 4 sim months)
    const joined = Date.parse(p.joinedAt || "");
    if (!Number.isFinite(joined)) return true;
    const FOUR_SIM_MONTHS_MS = 14 * 24 * 60 * 60 * 1000;
    return (Date.now() - joined) >= FOUR_SIM_MONTHS_MS;
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

  // Group by party
  const byParty = new Map();
  allPlayers.forEach((p) => {
    const party = String(p.party || "Independent");
    if (!byParty.has(party)) byParty.set(party, []);
    byParty.get(party).push(p);
  });

  const baseWeights = {};
  const leaderByParty = {};

  byParty.forEach((members, party) => {
    members.forEach((m) => { baseWeights[String(m.name || "")] = 0; });

    // Speaker does not vote (tie-break only); Sinn Féin do not take their seats.
    if (SPEAKER_PARTY_RE.test(party) || SINN_FEIN_PARTY_RE.test(party)) return;

    const seats = Math.max(0, Math.floor(Number(seatsByParty[party] || 0)));
    const leader = findPartyLeader(members);
    if (leader) leaderByParty[party] = String(leader.name || "");

    const newBackbenchers = members.filter((m) => !isSettledBackbencher(m));
    newBackbenchers.forEach((m) => { baseWeights[String(m.name || "")] += 1; });

    const remaining = Math.max(0, seats - newBackbenchers.length);
    const splitMembers = members.filter((m) => isSettledBackbencher(m));

    if (!splitMembers.length) {
      if (leader) baseWeights[String(leader.name || "")] = (baseWeights[String(leader.name || "")] || 0) + remaining;
      return;
    }

    const each = Math.floor(remaining / splitMembers.length);
    const odd  = remaining - (each * splitMembers.length);
    splitMembers.forEach((m) => { baseWeights[String(m.name || "")] = (baseWeights[String(m.name || "")] || 0) + each; });

    if (odd > 0) {
      const leaderName = leader ? String(leader.name || "") : null;
      const oddTarget = leaderName && splitMembers.some((m) => m.name === leader.name)
        ? leaderName
        : String(splitMembers[0].name || "");
      baseWeights[oddTarget] = (baseWeights[oddTarget] || 0) + odd;
    }
  });

  // Delegation: absent players' weights route to their party leader (or deputy).
  // Skipped when applyDelegation=false (e.g. EDM signature weight: you cannot sign on
  // someone else's behalf, so absent members' weight must not flow to the signer).
  const effectiveWeights = { ...baseWeights };

  if (applyDelegation) {
    const playersByName = Object.fromEntries(allPlayers.map((p) => [String(p.name || ""), p]));

    allPlayers.forEach((p) => {
      if (!p?.absent) return;
      const from = String(p.name || "");
      const amount = Number(effectiveWeights[from] || 0);
      if (amount <= 0) return;

      const party = String(p.party || "Independent");
      const leaderName = leaderByParty[party] || null;
      const isLeader = leaderName && from === leaderName;

      let target = null;
      if (isLeader) {
        const candidate = String(p.delegatedTo || "").trim();
        if (candidate && playersByName[candidate] && String(playersByName[candidate].party || "Independent") === party && !playersByName[candidate].absent) {
          target = candidate;
        } else {
          target = allPlayers.find(
            (q) => String(q.party || "Independent") === party && q.name !== from && !q.absent
          )?.name || null;
        }
      } else if (leaderName && playersByName[leaderName] && !playersByName[leaderName].absent) {
        target = leaderName;
      }

      effectiveWeights[from] = 0;
      if (target && target !== from) {
        effectiveWeights[target] = (Number(effectiveWeights[target] || 0)) + amount;
      }
    });
  }

  return { effectiveWeights, baseWeights, leaderByParty };
}

/**
 * Enrich a player list with joined_sim_month/joined_sim_year from the characters table.
 * This lets isSettledBackbencher use sim-clock comparison instead of wall-clock fallback.
 *
 * @param {import('pg').Pool} pool
 * @param {Array} players - state players (each has at least a name field)
 * @returns {Promise<Array>} - same array with joinedSimMonth/joinedSimYear added where available
 */
export async function batchEnrichPlayersWithSimJoinDates(pool, players) {
  if (!players?.length) return players;
  const names = players.map((p) => String(p.name || "")).filter(Boolean);
  if (!names.length) return players;
  try {
    const { rows } = await pool.query(
      `SELECT name, joined_sim_month, joined_sim_year
         FROM characters
        WHERE name = ANY($1::text[]) AND is_active = TRUE`,
      [names]
    );
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    return players.map((p) => {
      const char = byName[String(p.name || "")];
      if (!char || (char.joined_sim_month == null && char.joined_sim_year == null)) return p;
      return {
        ...p,
        joinedSimMonth: char.joined_sim_month ?? null,
        joinedSimYear:  char.joined_sim_year  ?? null,
      };
    });
  } catch {
    return players; // best-effort: fall back to un-enriched list
  }
}

/**
 * Compute the effective vote weight for a single character.
 *
 * When a character is an NPC assigned as a user's main active character they may
 * not appear in the game-state `statePlayers` list (which is admin-managed).  In
 * that case, inject them as a synthetic settled backbencher and recompute so that
 * they receive their proportional share of their party's seats.
 *
 * Normal (non-NPC) characters that are absent from the player list intentionally
 * receive 0 weight — that behaviour is preserved.
 *
 * @param {Object}   seatsByParty  - { partyName: seatCount } from constituencies DB
 * @param {Array}    statePlayers  - player list from game state snapshot
 * @param {string}   charName      - character name to look up
 * @param {string|null} charParty  - character party
 * @param {boolean}  isNpc         - true if the character has is_npc = true
 * @param {Object}   [opts]
 * @param {boolean}  [opts.applyDelegation=true] - set false for EDM signatures so that
 *   absent members' delegated weight does not inflate the signer's share.
 * @returns {number}
 */
export function computeCharacterWeight(seatsByParty, statePlayers, charName, charParty, isNpc, { applyDelegation = true, currentSimMonth = null, currentSimYear = null, joinedSimMonth = null, joinedSimYear = null } = {}) {
  const nameStr = String(charName || "");
  const { effectiveWeights } = computeAllPlayerWeights(seatsByParty, statePlayers, { applyDelegation, currentSimMonth, currentSimYear });
  const w = Number(effectiveWeights[nameStr] || 0);
  if (w > 0) return w;

  // For NPCs not present in the game state, inject synthetically so they share party seats.
  if (!isNpc || !charParty) return w;
  if (SINN_FEIN_PARTY_RE.test(charParty) || SPEAKER_PARTY_RE.test(charParty)) return 0;
  const inState = statePlayers.some((p) => String(p.name || "") === nameStr);
  if (inState) return w; // already included but still got 0 — respect the computed result

  const augmented = [
    ...statePlayers,
    { name: nameStr, party: charParty, role: "backbencher", active: true, joinedSimMonth, joinedSimYear },
  ];
  const { effectiveWeights: ew2 } = computeAllPlayerWeights(seatsByParty, augmented, { applyDelegation, currentSimMonth, currentSimYear });
  return Number(ew2[nameStr] || 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Division tally
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the aye/no/abstain tally for a division from DB votes and NPC data.
 *
 * Combines:
 *   1. Player votes (effective_weight from division_votes)
 *   2. NPC party votes (seat-weighted, minus rebels)
 *   3. Playable-party rebel deductions and re-crediting
 *   4. Sinn Féin auto-abstain
 *
 * The `db` parameter accepts either a Pool or a PoolClient so callers inside
 * a transaction can pass their client directly.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {string} divisionId
 * @param {object} npcVotes - { partyName: "aye"|"no"|"abstain" }
 * @param {object} rebelsByParty - { partyName: rebelCount }
 * @param {object} rebelsByPartyChoice - { partyName: "aye"|"no"|"abstain" }
 * @param {object} seatsByParty  - { partyName: seatCount } from constituencies DB
 * @returns {Promise<{tally:{aye:number,no:number,abstain:number}, byParty:object}>}
 */
export async function computeDivisionTallyFromDb(db, divisionId, npcVotes, rebelsByParty, rebelsByPartyChoice, seatsByParty) {
  // 1. Player votes — aggregated by party and direction
  const { rows: pvRows } = await db.query(
    `SELECT COALESCE(c.party, 'Independent') AS party, dv.vote,
            SUM(dv.effective_weight) AS weight
       FROM division_votes dv
       LEFT JOIN characters c ON c.id = dv.character_id
      WHERE dv.division_id = $1
      GROUP BY COALESCE(c.party, 'Independent'), dv.vote`,
    [divisionId]
  );

  const tally = { aye: 0, no: 0, abstain: 0 };
  const partyVoteMap = {};
  for (const pv of pvRows) {
    const w = Number(pv.weight || 0);
    if (tally[pv.vote] !== undefined) tally[pv.vote] += w;
    if (!partyVoteMap[pv.party]) partyVoteMap[pv.party] = {};
    partyVoteMap[pv.party][pv.vote] = (partyVoteMap[pv.party][pv.vote] || 0) + w;
  }

  // byParty tracks per-party seat contributions to the final tally (player + NPC + rebels + Sinn Féin)
  const byParty = {};
  for (const [party, votes] of Object.entries(partyVoteMap)) {
    byParty[party] = { ...votes };
  }

  // 2. NPC party votes (seat-weighted) — Speaker and Sinn Féin excluded
  for (const [party, npcVote] of Object.entries(npcVotes)) {
    if (tally[npcVote] === undefined) continue;
    if (SINN_FEIN_PARTY_RE.test(party) || SPEAKER_PARTY_RE.test(party)) continue;
    const seats = Number(seatsByParty[party] || 0);
    const rebels = Number(rebelsByParty[party] || 0);
    const effective = Math.max(0, seats - rebels);
    if (seats > 0) {
      tally[npcVote] += effective;
      if (effective > 0) {
        byParty[party] = byParty[party] || {};
        byParty[party][npcVote] = (byParty[party][npcVote] || 0) + effective;
      }
    }
    if (rebels > 0) {
      const rebelDir = rebelsByPartyChoice[party];
      if (rebelDir && tally[rebelDir] !== undefined) {
        tally[rebelDir] += rebels;
        byParty[party] = byParty[party] || {};
        byParty[party][rebelDir] = (byParty[party][rebelDir] || 0) + rebels;
      }
    }
  }

  // 3. Playable-party rebels: deduct proportionally from player votes, credit rebel direction
  for (const [party, rebels] of Object.entries(rebelsByParty)) {
    if (npcVotes[party]) continue; // NPC parties already handled above
    const rebelCount = Number(rebels);
    if (rebelCount <= 0) continue;
    const rebelDir = rebelsByPartyChoice[party];
    const voteDirs = partyVoteMap[party] || {};
    const totalPartyWeight = Object.values(voteDirs).reduce((s, w) => s + w, 0);
    if (totalPartyWeight > 0) {
      const rebelDeduction = Math.min(rebelCount, totalPartyWeight);
      for (const [dir, weight] of Object.entries(voteDirs)) {
        const deduct = Math.round((weight / totalPartyWeight) * rebelDeduction);
        tally[dir] = Math.max(0, (tally[dir] || 0) - deduct);
        if (byParty[party]) {
          byParty[party][dir] = Math.max(0, (byParty[party][dir] || 0) - deduct);
        }
      }
    }
    if (rebelDir && tally[rebelDir] !== undefined) {
      tally[rebelDir] += rebelCount;
      byParty[party] = byParty[party] || {};
      byParty[party][rebelDir] = (byParty[party][rebelDir] || 0) + rebelCount;
    }
  }

  // 4. Sinn Féin always abstain
  for (const [party, seats] of Object.entries(seatsByParty)) {
    if (SINN_FEIN_PARTY_RE.test(party) && seats > 0) {
      tally.abstain += seats;
      byParty[party] = byParty[party] || {};
      byParty[party].abstain = (byParty[party].abstain || 0) + seats;
    }
  }

  return { tally, byParty };
}
