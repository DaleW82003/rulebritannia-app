/**
 * Political-state service.
 *
 * Centralises all character-level and faction-level political-state
 * computation that was previously inline in server/index.js.
 *
 * Extracted areas:
 *   - clamp100 / pressureLabel utility helpers
 *   - recomputeCharacterPoliticalState (character political capital + pressure)
 *   - computeFactionStrength / computeFactionCohesion / computeLeadershipPressure
 *   - computeFactionPoliticalState (faction state persistence)
 *   - getPartyFactionClimate (party-level faction climate summary)
 *   - seedDefaultScenarioFactions (admin seed helper for playable parties)
 *   - FACTION_PLAYABLE_PARTIES constant
 *
 * All DB-dependent functions import pool from ./db.js so they remain
 * testable without coupling callers to a specific pool instance.
 *
 * Formula weights are documented inline and visible to developers/admins.
 * They can only be changed with a code change (by design) — the in-game
 * Control Panel exposes the input data (mp_count, influence_bonus etc.)
 * without exposing the formulas.
 */

import { pool } from "./db.js";
import {
  DEFAULT_SCENARIO_KEY,
  getDefaultScenarioKey as _loaderGetDefaultScenarioKey,
} from "./scenario-manifest-loader.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parties that have faction infrastructure wired up.
 * To add or remove playable parties, update this array — it is the single
 * authoritative source used by all faction-related logic and API guards.
 *
 * Phase 3 note: the manifest for the 1997 scenario also records playableParties.
 * In a future phase this constant will be removed and callers will read
 * playableParties from the loaded manifest so alternate scenarios can differ.
 */
export const FACTION_PLAYABLE_PARTIES = ["Conservative", "Labour", "Liberal Democrat"];

// Phase 3: the default scenario key is now owned by scenario-manifest-loader.js.
// Re-export it from there so this module remains the single import point for
// callers that already reference getDefaultScenarioKey() from here.
export { DEFAULT_SCENARIO_KEY };
export function getDefaultScenarioKey() {
  return _loaderGetDefaultScenarioKey();
}

function assertSupportedScenarioKey(scenarioKey = DEFAULT_SCENARIO_KEY) {
  if (typeof scenarioKey !== "string" && typeof scenarioKey !== "number") {
    const err = new Error("scenarioKey must be a string or number");
    err.status = 400;
    throw err;
  }
  const normalized = String(scenarioKey).trim();
  if (normalized !== DEFAULT_SCENARIO_KEY) {
    const err = new Error(`Unsupported scenarioKey: ${normalized}`);
    err.status = 400;
    throw err;
  }
  return normalized;
}

const DOMINANCE_COMPONENT_WEIGHTS = {
  commons: 1.0,
  bodies: 0.1,
  locals: 0.1,
  dem: 0.2,
};

const DOMINANCE_STABILISER = {
  hostilePressureReductionMax: 0.4,
  partyPressureReductionMax: 0.4,
  resilienceBoostMax: 0.15,
};

const DOMINANCE_ARENA_KEYS = {
  lords: "lords",
  europarl: "europarl",
  localsUk: "locals_uk",
  demUk: "dem_uk",
};

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function emptyPlayablePartyTotals() {
  return { Labour: 0, Conservative: 0, "Liberal Democrat": 0 };
}

function buildPlayablePartyTotalsFromRows(rows, fieldName) {
  const totals = emptyPlayablePartyTotals();
  for (const row of Array.isArray(rows) ? rows : []) {
    const party = String(row?.party || "");
    if (!FACTION_PLAYABLE_PARTIES.includes(party)) continue;
    const parsed = Number(row?.[fieldName]);
    totals[party] = Number.isFinite(parsed) ? parsed : 0;
  }
  return totals;
}

function parseJsonConfigValue(raw) {
  if (!raw) return {};
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return raw;
}

function mapBodyToDominanceArena(bodyId, body) {
  const id = String(bodyId || "").trim().toLowerCase();
  const title = String(body?.title || body?.name || "").trim().toLowerCase();
  if (id === "house-of-lords" || id === "lords" || title.includes("lords")) return DOMINANCE_ARENA_KEYS.lords;
  if (id === "european-parliament" || id === "europarl" || title.includes("european parliament")) return DOMINANCE_ARENA_KEYS.europarl;
  if (id === "directly-elected-mayors" || id === "dem_uk") return DOMINANCE_ARENA_KEYS.demUk;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Clamp a raw score to the [0, 100] integer range. */
export function clamp100(v) { return Math.min(100, Math.max(0, Math.round(v))); }

/** Return a human-readable pressure tier label for a 0-100 score. */
export function pressureLabel(v) {
  if (v >= 75) return "critical";
  if (v >= 50) return "high";
  if (v >= 25) return "moderate";
  return "low";
}

// ─────────────────────────────────────────────────────────────────────────────
// Character political state
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recompute and persist the political state for a single character.
 *
 * Capital sources (additive):
 *   offices              +30 PM, +20 cabinet/LoTo, +10 shadow, +8 other
 *   press (marked items) +3 per positive (score>0), −5 per negative (score<0)
 *   scandals             −10 per open/awaiting, −15 per closed scandal (severity>3)
 *   work plan            +5 if work plan updated in last 3 sim periods
 *   party leadership     +12 party leader, +6 chief/deputy whip, +4 whip/chairman
 *
 * @param {string|number} characterId
 * @returns {Promise<object>} computed state object
 */
export async function recomputeCharacterPoliticalState(characterId) {
  const breakdown = [];
  let total = 0;

  // ── Shared data ────────────────────────────────────────────────────────────
  const { rows: clkRows } = await pool.query(
    "SELECT sim_current_month, sim_current_year FROM sim_clock WHERE id = 'main'"
  );
  const simMonth = clkRows[0]?.sim_current_month ?? 8;
  const simYear  = clkRows[0]?.sim_current_year  ?? 1997;
  const currentIndex = (simYear - 1997) * 12 + (simMonth - 1);

  // Character's party and constituency
  const { rows: charRows } = await pool.query(
    "SELECT party, constituency FROM characters WHERE id = $1",
    [characterId]
  );
  const charParty        = charRows[0]?.party        || "";
  const charConstituency = charRows[0]?.constituency || "";

  // ── Offices ────────────────────────────────────────────────────────────────
  const { rows: officeRows } = await pool.query(
    `SELECT o.spec_id, o.type
       FROM office_assignments oa
       JOIN offices o ON o.id = oa.office_id
      WHERE oa.character_id = $1`,
    [characterId]
  );
  for (const { spec_id, type } of officeRows) {
    let delta = 0;
    let label = "";
    if (spec_id === "prime-minister") {
      delta = 30; label = "Prime Minister";
    } else if (spec_id === "leader-opposition") {
      delta = 20; label = "Leader of the Opposition";
    } else if (spec_id === "leader-commons") {
      delta = 15; label = "Leader of the House of Commons";
    } else if (type === "cabinet") {
      delta = 20; label = `Cabinet office (${spec_id})`;
    } else if (type === "shadow") {
      delta = 10; label = `Shadow cabinet office (${spec_id})`;
    } else {
      delta = 8;  label = `Parliamentary office (${spec_id || type})`;
    }
    total += delta;
    breakdown.push({ category: "office", label, delta });
  }

  // ── Press items ────────────────────────────────────────────────────────────
  const { rows: pressRows } = await pool.query(
    `SELECT (data->>'score')::numeric AS score
       FROM press_items
      WHERE author_character_id = $1
        AND data->>'is_marked' = 'true'`,
    [characterId]
  );
  let positivePress = 0;
  let negativePress = 0;
  for (const { score } of pressRows) {
    const s = Number(score ?? 0);
    if (s > 0) positivePress++;
    else if (s < 0) negativePress++;
  }
  if (positivePress > 0) {
    const delta = positivePress * 3;
    total += delta;
    breakdown.push({ category: "press", label: `${positivePress} positive press item${positivePress !== 1 ? "s" : ""}`, delta });
  }
  if (negativePress > 0) {
    const delta = negativePress * -5;
    total += delta;
    breakdown.push({ category: "press", label: `${negativePress} negative press item${negativePress !== 1 ? "s" : ""}`, delta });
  }

  // ── Scandals ───────────────────────────────────────────────────────────────
  const { rows: scandalRows } = await pool.query(
    `SELECT status, severity_current
       FROM scandals
      WHERE character_id = $1`,
    [characterId]
  );
  let activeScandals = 0;
  let heavyClosedScandals = 0;
  for (const { status, severity_current } of scandalRows) {
    if (status === "open" || status === "awaiting_mod") {
      activeScandals++;
    } else if (status === "closed" && Number(severity_current) > 3) {
      heavyClosedScandals++;
    }
  }
  if (activeScandals > 0) {
    const delta = activeScandals * -10;
    total += delta;
    breakdown.push({ category: "scandal", label: `${activeScandals} active scandal${activeScandals !== 1 ? "s" : ""}`, delta });
  }
  if (heavyClosedScandals > 0) {
    const delta = heavyClosedScandals * -15;
    total += delta;
    breakdown.push({ category: "scandal", label: `${heavyClosedScandals} major resolved scandal${heavyClosedScandals !== 1 ? "s" : ""}`, delta });
  }

  // ── Work plan ──────────────────────────────────────────────────────────────
  const { rows: wpRows } = await pool.query(
    `SELECT last_saved_sim_index
       FROM character_work_plans
      WHERE character_id = $1`,
    [characterId]
  );
  if (wpRows.length > 0) {
    const savedIndex = Number(wpRows[0].last_saved_sim_index ?? 0);
    if (currentIndex - savedIndex <= 3) {
      const delta = 5;
      total += delta;
      breakdown.push({ category: "work_plan", label: "Active work plan", delta });
    }
  }

  // ── Party leadership / whip roles ──────────────────────────────────────────
  const { rows: partyRows } = await pool.query(
    `SELECT slug,
            leader_character_id,
            chairman_character_id,
            chief_whip_character_id,
            deputy_whip_character_id,
            whip_character_id
       FROM parties`,
    []
  );
  const charIdStr = String(characterId);
  for (const p of partyRows) {
    if (String(p.leader_character_id) === charIdStr) {
      const delta = 12;
      total += delta;
      breakdown.push({ category: "party", label: `Party leader (${p.slug})`, delta });
    } else if (
      String(p.chief_whip_character_id) === charIdStr ||
      String(p.deputy_whip_character_id) === charIdStr
    ) {
      const delta = 6;
      total += delta;
      breakdown.push({ category: "party", label: `Chief/Deputy Whip (${p.slug})`, delta });
    } else if (String(p.whip_character_id) === charIdStr) {
      const delta = 4;
      total += delta;
      breakdown.push({ category: "party", label: `Whip (${p.slug})`, delta });
    } else if (String(p.chairman_character_id) === charIdStr) {
      const delta = 4;
      total += delta;
      breakdown.push({ category: "party", label: `Party chairman (${p.slug})`, delta });
    }
  }

  // ── Derive momentum and reputation ─────────────────────────────────────────
  const { rows: prevRows } = await pool.query(
    "SELECT capital_current FROM character_political_state WHERE character_id = $1",
    [characterId]
  );
  const previousCapital = prevRows.length ? Number(prevRows[0].capital_current) : null;
  const capitalTrend = previousCapital !== null ? total - previousCapital : 0;

  let momentum = "stable";
  if (capitalTrend >= 5) momentum = "rising";
  else if (capitalTrend <= -5) momentum = "falling";

  let reputation = "neutral";
  if (total >= 60) reputation = "excellent";
  else if (total >= 30) reputation = "good";
  else if (total >= 10) reputation = "neutral";
  else if (total >= -10) reputation = "poor";
  else reputation = "damaged";

  // ── PRESSURE CHANNELS ──────────────────────────────────────────────────────

  // ── 1. Party pressure ──────────────────────────────────────────────────────
  // Sources: rebellion log (whipped vote defiance), rebel requests refused
  let partyPressureRaw = 0;
  const partyPressureBreakdown = [];

  const { rows: rebellionRows } = await pool.query(
    `SELECT whip_level FROM division_rebellion_log
      WHERE character_id = $1
      ORDER BY created_at DESC LIMIT 20`,
    [characterId]
  );
  for (const { whip_level } of rebellionRows) {
    const wl = Number(whip_level ?? 0);
    // Pressure weight per rebellion: 3-line whip defiance carries maximum party damage
    const WHIP_REBELLION_WEIGHT = { 3: 25, 2: 15, 1: 8, 0: 3 };
    partyPressureRaw += WHIP_REBELLION_WEIGHT[wl] ?? 3;
  }
  if (rebellionRows.length > 0) {
    partyPressureBreakdown.push(`${rebellionRows.length} rebellion${rebellionRows.length !== 1 ? "s" : ""} on record`);
  }

  const { rows: refusedRequestRows } = await pool.query(
    `SELECT COUNT(*) AS cnt FROM division_rebel_requests
      WHERE character_id = $1 AND status = 'refused'`,
    [characterId]
  );
  const refusedRequests = Number(refusedRequestRows[0]?.cnt ?? 0);
  if (refusedRequests > 0) {
    partyPressureRaw += refusedRequests * 10;
    partyPressureBreakdown.push(`${refusedRequests} rebel request${refusedRequests !== 1 ? "s" : ""} refused by whips`);
  }

  const { rows: pendingRequestRows } = await pool.query(
    `SELECT COUNT(*) AS cnt FROM division_rebel_requests
      WHERE character_id = $1 AND status = 'pending'`,
    [characterId]
  );
  const pendingRequests = Number(pendingRequestRows[0]?.cnt ?? 0);
  if (pendingRequests > 0) {
    partyPressureRaw += pendingRequests * 5;
    partyPressureBreakdown.push(`${pendingRequests} rebel request${pendingRequests !== 1 ? "s" : ""} pending`);
  }

  const partyPressure = clamp100(partyPressureRaw);

  // ── 1b. Faction climate effect on party pressure ───────────────────────────
  // Hostile factions increase party_pressure; aligned factions build resilience (capital bonus).
  // Only applies when the character belongs to a playable party with factions set up.
  let factionClimateContext = null;
  if (charParty && FACTION_PLAYABLE_PARTIES.includes(charParty)) {
    try {
      factionClimateContext = await getPartyFactionClimate(charParty);
    } catch (_) { /* non-fatal: factions may not be seeded yet */ }
  }
  const factionPartyPressureBonus  = factionClimateContext ? factionClimateContext.partyPressureModifier  : 0;
  const factionCapitalBonus        = factionClimateContext ? factionClimateContext.capitalResilienceBonus : 0;
  if (factionClimateContext && factionClimateContext.partyPressureModifier > 0) {
    partyPressureBreakdown.push(
      `Faction climate (${factionClimateContext.climateLabel}): +${factionClimateContext.partyPressureModifier.toFixed(1)} party pressure`
    );
  }
  if (factionClimateContext && factionClimateContext.capitalResilienceBonus > 0) {
    breakdown.push({
      category: "faction",
      label: `Aligned faction support (${factionClimateContext.climateLabel})`,
      delta: Math.round(factionCapitalBonus * 10) / 10,
    });
    total += factionCapitalBonus;
  }
  const partyPressureFinal = clamp100(partyPressure + factionPartyPressureBonus);

  // ── 2. Constituency pressure ───────────────────────────────────────────────
  // Sources: stale/missing work plan, constituency seat changes
  let constituencyPressureRaw = 0;
  const constituencyPressureBreakdown = [];

  if (wpRows.length === 0) {
    constituencyPressureRaw += 30;
    constituencyPressureBreakdown.push("No work plan on record");
  } else {
    const savedIndex = Number(wpRows[0].last_saved_sim_index ?? 0);
    const monthsStale = currentIndex - savedIndex;
    if (monthsStale > 3) {
      const stalePenalty = Math.min(40, monthsStale * 5);
      constituencyPressureRaw += stalePenalty;
      constituencyPressureBreakdown.push(`Work plan ${monthsStale} month${monthsStale !== 1 ? "s" : ""} out of date`);
    }
  }

  if (charConstituency) {
    const { rows: ceRows } = await pool.query(
      `SELECT change_type FROM constituency_events
        WHERE constituency_id = $1
        ORDER BY created_at DESC LIMIT 5`,
      [charConstituency]
    );
    // party_change and by_election indicate seat instability, raising local pressure
    const ADVERSE_CONSTITUENCY_EVENT_TYPES = new Set(["party_change", "by_election"]);
    const adverseEvents = ceRows.filter((r) => ADVERSE_CONSTITUENCY_EVENT_TYPES.has(r.change_type)).length;
    if (adverseEvents > 0) {
      constituencyPressureRaw += adverseEvents * 15;
      constituencyPressureBreakdown.push(`${adverseEvents} recent constituency event${adverseEvents !== 1 ? "s" : ""}`);
    }
  }

  const constituencyPressure = clamp100(constituencyPressureRaw);

  // ── 3. Media pressure ─────────────────────────────────────────────────────
  // Sources: negative/marked press items, active/closed scandals
  let mediaPressureRaw = 0;
  const mediaPressureBreakdown = [];

  if (negativePress > 0) {
    mediaPressureRaw += negativePress * 15;
    mediaPressureBreakdown.push(`${negativePress} negative press item${negativePress !== 1 ? "s" : ""}`);
  }
  if (activeScandals > 0) {
    mediaPressureRaw += activeScandals * 25;
    mediaPressureBreakdown.push(`${activeScandals} active scandal${activeScandals !== 1 ? "s" : ""}`);
  }
  if (heavyClosedScandals > 0) {
    mediaPressureRaw += heavyClosedScandals * 10;
    mediaPressureBreakdown.push(`${heavyClosedScandals} major resolved scandal${heavyClosedScandals !== 1 ? "s" : ""}`);
  }

  const mediaPressure = clamp100(mediaPressureRaw);

  // ── 4. Group pressure ─────────────────────────────────────────────────────
  // Sources: affiliation requests pending removal (group friction), number of
  //          active approved affiliations (exposure to group demands)
  let groupPressureRaw = 0;
  const groupPressureBreakdown = [];

  const { rows: affiliationRows } = await pool.query(
    `SELECT ca.status, ac.category
       FROM character_affiliations ca
       JOIN affiliations_catalog ac ON ac.id = ca.affiliation_id
      WHERE ca.character_id = $1`,
    [characterId]
  );
  const pendingRemove = affiliationRows.filter((r) => r.status === "pending_remove").length;
  const approvedAffiliations = affiliationRows.filter((r) => r.status === "approved").length;
  // 5+ active affiliations creates competing group demands; +5 per additional group beyond 4, capped at 20
  if (approvedAffiliations >= 5) {
    groupPressureRaw += Math.min(20, (approvedAffiliations - 4) * 5);
    groupPressureBreakdown.push(`${approvedAffiliations} active group affiliations`);
  }
  if (pendingRemove > 0) {
    groupPressureRaw += pendingRemove * 15;
    groupPressureBreakdown.push(`${pendingRemove} affiliation removal${pendingRemove !== 1 ? "s" : ""} pending`);
  }

  const groupPressure = clamp100(groupPressureRaw);

  // ── 5. Institutional pressure ─────────────────────────────────────────────
  // Sources: senior/cabinet offices carry high responsibility and scrutiny
  let institutionalPressureRaw = 0;
  const institutionalPressureBreakdown = [];

  for (const { spec_id, type } of officeRows) {
    if (spec_id === "prime-minister") {
      institutionalPressureRaw += 40;
      institutionalPressureBreakdown.push("Prime Minister — high institutional responsibility");
    } else if (type === "cabinet" || spec_id === "leader-opposition" || spec_id === "leader-commons") {
      institutionalPressureRaw += 25;
      institutionalPressureBreakdown.push(`Senior office (${spec_id || type}) — institutional scrutiny`);
    } else if (type === "shadow") {
      institutionalPressureRaw += 15;
      institutionalPressureBreakdown.push(`Shadow cabinet office (${spec_id}) — scrutiny`);
    } else if (type === "parliamentary") {
      institutionalPressureRaw += 8;
      institutionalPressureBreakdown.push(`Parliamentary office (${spec_id || type})`);
    }
  }

  const institutionalPressure = clamp100(institutionalPressureRaw);

  // ── Derived: rebellion risk ────────────────────────────────────────────────
  // 60% weight from accumulated party pressure + 8pts per recent rebellion (up to 5 counted).
  // Coefficients keep the score responsive to fresh rebellions while reflecting cumulative party tension.
  const recentRebellions = Math.min(rebellionRows.length, 5);
  const rebellionRisk = clamp100(partyPressureFinal * 0.6 + recentRebellions * 8);

  // ── Derived: scandal risk ─────────────────────────────────────────────────
  // 70% weight from media pressure + 15pts per active scandal.
  // Active scandals dominate because they represent unresolved and escalating exposure.
  const scandalRisk = clamp100(mediaPressure * 0.7 + activeScandals * 15);

  // ── Assemble full breakdown with channel tags ──────────────────────────────
  const pressureBreakdown = [
    ...partyPressureBreakdown.map((label) => ({ channel: "party", label })),
    ...constituencyPressureBreakdown.map((label) => ({ channel: "constituency", label })),
    ...mediaPressureBreakdown.map((label) => ({ channel: "media", label })),
    ...groupPressureBreakdown.map((label) => ({ channel: "group", label })),
    ...institutionalPressureBreakdown.map((label) => ({ channel: "institutional", label })),
  ];

  await pool.query(
    `INSERT INTO character_political_state
       (character_id, capital_current, capital_trend, momentum, reputation, breakdown,
        party_pressure, constituency_pressure, media_pressure, group_pressure,
        institutional_pressure, rebellion_risk, scandal_risk, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, now())
     ON CONFLICT (character_id) DO UPDATE
       SET capital_current        = EXCLUDED.capital_current,
           capital_trend          = EXCLUDED.capital_trend,
           momentum               = EXCLUDED.momentum,
           reputation             = EXCLUDED.reputation,
           breakdown              = EXCLUDED.breakdown,
           party_pressure         = EXCLUDED.party_pressure,
           constituency_pressure  = EXCLUDED.constituency_pressure,
           media_pressure         = EXCLUDED.media_pressure,
           group_pressure         = EXCLUDED.group_pressure,
           institutional_pressure = EXCLUDED.institutional_pressure,
           rebellion_risk         = EXCLUDED.rebellion_risk,
           scandal_risk           = EXCLUDED.scandal_risk,
           updated_at             = now()`,
    [
      characterId, total, capitalTrend, momentum, reputation, JSON.stringify(breakdown),
      partyPressureFinal, constituencyPressure, mediaPressure, groupPressure,
      institutionalPressure, rebellionRisk, scandalRisk,
    ]
  );

  return {
    capital_current: total, capital_trend: capitalTrend, momentum, reputation, breakdown,
    party_pressure: partyPressureFinal,
    constituency_pressure: constituencyPressure,
    media_pressure: mediaPressure,
    group_pressure: groupPressure,
    institutional_pressure: institutionalPressure,
    rebellion_risk: rebellionRisk,
    scandal_risk: scandalRisk,
    pressure_breakdown: pressureBreakdown,
    faction_climate: factionClimateContext ? {
      climateLabel:           factionClimateContext.climateLabel,
      climateScore:           factionClimateContext.climateScore,
      partyPressureModifier:  factionClimateContext.partyPressureModifier,
      capitalResilienceBonus: factionClimateContext.capitalResilienceBonus,
    } : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Faction political state helpers
// ─────────────────────────────────────────────────────────────────────────────
//
// All weights used in computeFactionStrength / computeLeadershipPressure /
// getPartyFactionClimate are documented inline.  Mods/admins with code access
// can adjust them there.  In-game, MP counts and influence_bonus on each
// faction are editable from the Control Panel without code changes.

/**
 * Compute internal_power for a faction from its allocation data.
 * Formula (transparent, easy to tune):
 *   raw = (mp_count × 0.8) + (influence_bonus × 10) + officeholder_weight
 *   internal_power = clamp(raw, 0, 100)
 * Weights:
 *   - mp_count:       0.8 pts each — principal driver; 125 MPs ≈ 100 pts
 *   - influence_bonus: 10 pts each — mod-adjustable strategic weight
 *   - officeholder:   up to +15 pts if the faction holds a senior party office
 */
export function computeFactionStrength({ mpCount = 0, influenceBonus = 0, officeholderWeight = 0 }) {
  const raw = mpCount * 0.8 + influenceBonus * 10 + officeholderWeight;
  return clamp100(raw);
}

/**
 * Compute cohesion for a faction.
 * Starts at 70 (default baseline), reduced by rebellion_bias (0–1 scale).
 * rebellion_bias = 1.0 → cohesion penalty of 40; cohesion floor is 5.
 */
export function computeFactionCohesion(rebellionBias = 0) {
  return Math.max(5, 70 - Number(rebellionBias) * 40);
}

/**
 * Compute leadership_pressure a faction exerts on the party leadership.
 * Hostile factions with high internal_power drive up pressure;
 * aligned factions dampen it slightly.
 * Neutral factions contribute a modest baseline.
 */
export function computeLeadershipPressure(internalPower, leadershipAlignment) {
  if (leadershipAlignment === "hostile")  return clamp100(internalPower * 1.2);
  if (leadershipAlignment === "neutral")  return clamp100(internalPower * 0.4);
  if (leadershipAlignment === "aligned")  return clamp100(internalPower * 0.1);
  return clamp100(internalPower * 0.4);
}

/**
 * Compute and persist faction_political_state for a single faction.
 * Returns the computed state object.
 */
export async function computeFactionPoliticalState(factionId) {
  const { rows } = await pool.query(
    `SELECT f.id, f.leadership_alignment, f.rebellion_bias,
            COALESCE(f.momentum, 'stable') AS momentum,
            COALESCE(a.mp_count, 0)        AS mp_count,
            COALESCE(a.influence_bonus, 0) AS influence_bonus
       FROM party_factions f
       LEFT JOIN party_faction_allocations a ON a.faction_id = f.id
      WHERE f.id = $1`,
    [factionId]
  );
  if (!rows.length) throw new Error(`Faction ${factionId} not found`);
  const f = rows[0];

  const internalPower      = computeFactionStrength({ mpCount: Number(f.mp_count), influenceBonus: Number(f.influence_bonus) });
  const cohesion           = computeFactionCohesion(Number(f.rebellion_bias));
  const leadershipPressure = computeLeadershipPressure(internalPower, f.leadership_alignment);

  // Momentum is mod-set on party_factions; internal_power/cohesion/pressure are derived.
  const momentum = f.momentum || "stable";

  const breakdown = {
    mp_count:             Number(f.mp_count),
    influence_bonus:      Number(f.influence_bonus),
    leadership_alignment: f.leadership_alignment,
    rebellion_bias:       Number(f.rebellion_bias),
    momentum,
    internal_power_raw:   internalPower,
    cohesion_raw:         cohesion,
    leadership_pressure_raw: leadershipPressure,
    note: "Weights: mp×0.8 + influence×10; cohesion=70-(rebellion_bias×40); momentum is mod-set. See computeFactionStrength/computeFactionCohesion in server/political-state-service.js",
  };

  await pool.query(
    `INSERT INTO faction_political_state
       (faction_id, internal_power, momentum, leadership_pressure, cohesion, breakdown, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
     ON CONFLICT (faction_id) DO UPDATE
       SET internal_power      = EXCLUDED.internal_power,
           momentum            = EXCLUDED.momentum,
           leadership_pressure = EXCLUDED.leadership_pressure,
           cohesion            = EXCLUDED.cohesion,
           breakdown           = EXCLUDED.breakdown,
           updated_at          = now()`,
    [factionId, internalPower, momentum, leadershipPressure, cohesion, JSON.stringify(breakdown)]
  );

  return { faction_id: factionId, internal_power: internalPower, momentum, leadership_pressure: leadershipPressure, cohesion, breakdown };
}

/**
 * Return the party-level faction climate for a party slug.
 * climate_score > 0 = unified/stable; < 0 = fractious/hostile.
 * Also returns capital_resilience_bonus and party_pressure_modifier
 * so callers can integrate these into political state calculations.
 *
 * Weights (transparent, easy to tune):
 *   hostile_pressure  = sum of hostile faction leadership_pressure scores
 *   aligned_strength  = sum of aligned faction leadership_pressure scores (damping)
 *   climate_score     = aligned_strength - hostile_pressure  (range −100 to +100)
 *   party_pressure_modifier   = hostile_pressure × 0.15   (adds 0–15 pts to party_pressure)
 *   capital_resilience_bonus  = aligned_strength × 0.10   (adds 0–10 pts to capital)
 */
export async function getPartyFactionClimate(partySlug, { includeDebug = false } = {}) {
  const { rows } = await pool.query(
    `SELECT f.id, f.name, f.slug, f.colour, f.leadership_alignment, f.rebellion_bias,
            COALESCE(f.momentum, 'stable')  AS momentum,
            COALESCE(a.mp_count, 0)        AS mp_count,
            COALESCE(a.influence_bonus, 0) AS influence_bonus,
            fps.internal_power, fps.leadership_pressure, fps.cohesion
       FROM party_factions f
       LEFT JOIN party_faction_allocations a   ON a.faction_id   = f.id
       LEFT JOIN faction_political_state fps   ON fps.faction_id = f.id
      WHERE f.party_slug = $1 AND f.active = TRUE
      ORDER BY f.display_order ASC, f.name ASC`,
    [partySlug]
  );

  let hostilePressure  = 0;
  let alignedStrength  = 0;
  let totalInternalPower = 0;
  const factionSummaries = [];
  let dominantCommonsFaction = null;
  let dominantCommonsCount = 0;

  for (const r of rows) {
    // Use cached computed state if available, otherwise compute on the fly
    const internalPower = r.internal_power !== null
      ? Number(r.internal_power)
      : computeFactionStrength({ mpCount: Number(r.mp_count), influenceBonus: Number(r.influence_bonus) });
    const lp = r.leadership_pressure !== null
      ? Number(r.leadership_pressure)
      : computeLeadershipPressure(internalPower, r.leadership_alignment);
    const cohesion = r.cohesion !== null
      ? Number(r.cohesion)
      : computeFactionCohesion(Number(r.rebellion_bias));

    if (r.leadership_alignment === "hostile")  hostilePressure  += lp;
    else if (r.leadership_alignment === "aligned") alignedStrength += lp;
    totalInternalPower += internalPower;

    factionSummaries.push({
      id:                  r.id,
      name:                r.name,
      slug:                r.slug,
      colour:              r.colour,
      leadershipAlignment: r.leadership_alignment,
      mpCount:             Number(r.mp_count),
      internalPower,
      leadershipPressure:  lp,
      cohesion,
      momentum:            r.momentum ?? "stable",
    });

    const mpCount = Number(r.mp_count ?? 0);
    if (mpCount > dominantCommonsCount) {
      dominantCommonsCount = mpCount;
      dominantCommonsFaction = {
        id: r.id,
        slug: r.slug,
        name: r.name,
        leadershipAlignment: r.leadership_alignment,
      };
    }
  }

  const [commonsCountResult, bodyRowsResult, localsResult, officialsResult] = await Promise.all([
    pool.query("SELECT COUNT(*) AS total FROM constituencies WHERE party = $1", [partySlug]),
    pool.query("SELECT id, data FROM bodies_data ORDER BY sort_order ASC, id ASC"),
    pool.query("SELECT value FROM app_config WHERE key = 'locals_data'"),
    pool.query(
      `SELECT o.arena_type, o.arena_id, o.faction_id, o.official_count,
              f.slug AS faction_slug, f.name AS faction_name, f.leadership_alignment
         FROM other_officials_faction_allocations o
         JOIN party_factions f ON f.id = o.faction_id
        WHERE o.party_slug = $1 AND f.active = TRUE`,
      [partySlug]
    ),
  ]);

  const commonsTotal = Number(commonsCountResult.rows[0]?.total ?? 0);
  const commonsShare = commonsTotal > 0 ? dominantCommonsCount / commonsTotal : 0;

  const officialsRows = Array.isArray(officialsResult.rows) ? officialsResult.rows : [];
  const allocationsByArena = new Map();
  for (const row of officialsRows) {
    const arenaTypeRaw = String(row.arena_type || "").trim();
    const arenaIdRaw = String(row.arena_id || "").trim();
    let canonicalArena = "";
    if (arenaTypeRaw === "body") {
      if (arenaIdRaw === "house-of-lords" || arenaIdRaw === "lords") canonicalArena = DOMINANCE_ARENA_KEYS.lords;
      else if (arenaIdRaw === "european-parliament" || arenaIdRaw === "europarl") canonicalArena = DOMINANCE_ARENA_KEYS.europarl;
      else if (arenaIdRaw === "directly-elected-mayors" || arenaIdRaw === "dem_uk") canonicalArena = DOMINANCE_ARENA_KEYS.demUk;
    } else if (arenaTypeRaw === "locals") {
      canonicalArena = DOMINANCE_ARENA_KEYS.localsUk;
    } else if (Object.values(DOMINANCE_ARENA_KEYS).includes(arenaIdRaw)) {
      canonicalArena = arenaIdRaw;
    }
    if (!canonicalArena) continue;
    const count = Number(row.official_count ?? 0);
    if (!allocationsByArena.has(canonicalArena)) allocationsByArena.set(canonicalArena, []);
    allocationsByArena.get(canonicalArena).push({
      factionId: row.faction_id,
      count: Number.isFinite(count) ? count : 0,
      slug: row.faction_slug,
      name: row.faction_name,
      leadershipAlignment: row.leadership_alignment,
    });
  }

  const getDominantArenaCount = (arenaKey) => {
    const entries = allocationsByArena.get(arenaKey) || [];
    return entries.reduce((max, entry) => Math.max(max, Number(entry.count || 0)), 0);
  };

  const totalsByPartyByArena = {
    [DOMINANCE_ARENA_KEYS.lords]: emptyPlayablePartyTotals(),
    [DOMINANCE_ARENA_KEYS.europarl]: emptyPlayablePartyTotals(),
    [DOMINANCE_ARENA_KEYS.localsUk]: emptyPlayablePartyTotals(),
    [DOMINANCE_ARENA_KEYS.demUk]: emptyPlayablePartyTotals(),
  };

  for (const row of bodyRowsResult.rows) {
    const body = row?.data || {};
    const bodyId = String(row?.id || body?.id || "").trim();
    const arenaKey = mapBodyToDominanceArena(bodyId, body);
    if (!arenaKey) continue;
    if (arenaKey === DOMINANCE_ARENA_KEYS.demUk) {
      const mayors = Array.isArray(body?.mayors) ? body.mayors : [];
      for (const mayor of mayors) {
        const party = String(mayor?.party || "");
        if (!FACTION_PLAYABLE_PARTIES.includes(party)) continue;
        totalsByPartyByArena[arenaKey][party] += 1;
      }
      continue;
    }
    if (!body?.visible) continue;
    const totals = buildPlayablePartyTotalsFromRows(body?.partyBreakdown, "seats");
    totalsByPartyByArena[arenaKey] = totals;
  }

  const localsData = parseJsonConfigValue(localsResult.rows[0]?.value);
  const countries = Array.isArray(localsData?.countries) ? localsData.countries : [];
  const fallbackCountries = ["England", "Scotland", "Wales", "Northern Ireland"];
  for (const country of fallbackCountries) {
    const countryRow = countries.find((r) => String(r?.country || "").trim() === country) || { partyBreakdown: [] };
    const countryTotals = buildPlayablePartyTotalsFromRows(countryRow?.partyBreakdown, "councillors");
    for (const partySlugKey of FACTION_PLAYABLE_PARTIES) {
      totalsByPartyByArena[DOMINANCE_ARENA_KEYS.localsUk][partySlugKey] += Number(countryTotals[partySlugKey] || 0);
    }
  }

  const bodiesArenasIncluded = [
    {
      id: DOMINANCE_ARENA_KEYS.lords,
      label: "House of Lords",
      total: Number(totalsByPartyByArena[DOMINANCE_ARENA_KEYS.lords][partySlug] || 0),
      share: 0,
    },
    {
      id: DOMINANCE_ARENA_KEYS.europarl,
      label: "European Parliament",
      total: Number(totalsByPartyByArena[DOMINANCE_ARENA_KEYS.europarl][partySlug] || 0),
      share: 0,
    },
  ];
  let bodiesTotal = 0;
  let bodiesWeightedShareSum = 0;
  for (const arena of bodiesArenasIncluded) {
    const partyTotalArena = Number(arena.total || 0);
    if (partyTotalArena <= 0) continue;
    const arenaShare = getDominantArenaCount(arena.id) / partyTotalArena;
    arena.share = arenaShare;
    bodiesTotal += partyTotalArena;
    bodiesWeightedShareSum += arenaShare * partyTotalArena;
  }
  const bodiesShare = bodiesTotal > 0 ? bodiesWeightedShareSum / bodiesTotal : 0;

  const localsTotal = Number(totalsByPartyByArena[DOMINANCE_ARENA_KEYS.localsUk][partySlug] || 0);
  const localsDominant = getDominantArenaCount(DOMINANCE_ARENA_KEYS.localsUk);
  const localsShare = localsTotal > 0 ? localsDominant / localsTotal : 0;
  const localsArenas = [{ id: DOMINANCE_ARENA_KEYS.localsUk, label: "UK-wide councillors", total: localsTotal, share: localsShare }];

  const demTotal = Number(totalsByPartyByArena[DOMINANCE_ARENA_KEYS.demUk][partySlug] || 0);
  const demShare = demTotal > 0 ? getDominantArenaCount(DOMINANCE_ARENA_KEYS.demUk) / demTotal : 0;

  const activeWeights = {
    commons: commonsTotal > 0 ? DOMINANCE_COMPONENT_WEIGHTS.commons : 0,
    bodies: bodiesTotal > 0 ? DOMINANCE_COMPONENT_WEIGHTS.bodies : 0,
    locals: localsTotal > 0 ? DOMINANCE_COMPONENT_WEIGHTS.locals : 0,
    dem: demTotal > 0 ? DOMINANCE_COMPONENT_WEIGHTS.dem : 0,
  };
  const numerator =
    (activeWeights.commons * commonsShare) +
    (activeWeights.bodies * bodiesShare) +
    (activeWeights.locals * localsShare) +
    (activeWeights.dem * demShare);
  const denominator = activeWeights.commons + activeWeights.bodies + activeWeights.locals + activeWeights.dem;
  const effectiveShare = denominator > 0 ? numerator / denominator : 0;

  const dominanceGateAlignment = dominantCommonsFaction?.leadershipAlignment === "aligned";
  const dominanceGateThreshold = effectiveShare > 0.5;
  const dominanceApplied = dominanceGateAlignment && dominanceGateThreshold;
  const dominanceScore = dominanceApplied ? clamp01((effectiveShare - 0.5) / 0.5) : 0;

  const debugPayload = {
    arenasIncluded: {
      commons: ["commons"],
      bodies: bodiesArenasIncluded.map((a) => a.id),
      locals: [DOMINANCE_ARENA_KEYS.localsUk],
      dem: [DOMINANCE_ARENA_KEYS.demUk],
    },
    totalsByPartyByArena,
    allocationTotalsByFactionByArena: Object.fromEntries(Array.from(allocationsByArena.entries()).map(([arenaKey, entries]) => {
      const byFaction = {};
      for (const e of entries) {
        byFaction[e.slug] = (byFaction[e.slug] || 0) + Number(e.count || 0);
      }
      return [arenaKey, byFaction];
    })),
    computed: {
      commons_total: commonsTotal,
      commons_share: commonsShare,
      bodies_total: bodiesTotal,
      bodies_share: bodiesShare,
      locals_total: localsTotal,
      locals_share: localsShare,
      dem_total: demTotal,
      dem_share: demShare,
      effectiveShare,
      dominanceApplied,
    },
    notes: localsTotal > 0 && localsDominant === 0 ? ["locals allocations missing"] : [],
  };

  hostilePressure  = clamp100(hostilePressure);
  alignedStrength  = clamp100(alignedStrength);
  const hostilePressureMultiplier = 1 - (DOMINANCE_STABILISER.hostilePressureReductionMax * dominanceScore);
  const partyPressureMultiplier = 1 - (DOMINANCE_STABILISER.partyPressureReductionMax * dominanceScore);
  const resilienceMultiplier = 1 + (DOMINANCE_STABILISER.resilienceBoostMax * dominanceScore);

  const effectiveHostilePressure = hostilePressure * hostilePressureMultiplier;
  const effectiveAlignedStrength = alignedStrength;
  const climateScore             = Math.max(-100, Math.min(100, effectiveAlignedStrength - effectiveHostilePressure));
  const partyPressureModifier    = effectiveHostilePressure * 0.15 * partyPressureMultiplier;
  const capitalResilienceBonus   = effectiveAlignedStrength * 0.10 * resilienceMultiplier;

  let climateLabel;
  if (climateScore >= 30)       climateLabel = "unified";
  else if (climateScore >= 0)   climateLabel = "stable";
  else if (climateScore >= -30) climateLabel = "tense";
  else                          climateLabel = "fractious";

  return {
    partySlug,
    factions: factionSummaries,
    hostilePressure,
    alignedStrength,
    climateScore,
    climateLabel,
    partyPressureModifier,
    capitalResilienceBonus,
    dominance: {
      components: {
        commons: {
          total: commonsTotal,
          share: commonsShare,
          dominantFaction: dominantCommonsFaction,
        },
        bodies: {
          total: bodiesTotal,
          share: bodiesShare,
          arenasIncluded: bodiesArenasIncluded,
        },
        locals: {
          total: localsTotal,
          share: localsShare,
          arenasIncluded: localsArenas,
        },
        dem: {
          total: demTotal,
          share: demShare,
        },
      },
      weights: {
        configured: { ...DOMINANCE_COMPONENT_WEIGHTS },
        active: activeWeights,
        numerator,
        denominator,
      },
      effectiveShare,
      dominanceScore,
      dominanceApplied,
      appliedMultipliers: {
        hostilePressureMultiplier,
        partyPressureMultiplier,
        resilienceMultiplier,
      },
    },
    totalInternalPower: clamp100(totalInternalPower),
    ...(includeDebug ? { debug: debugPayload } : {}),
    // Weights documented for developers/admins with code access:
    weights: {
      mp_count_weight:           0.8,
      influence_bonus_weight:   10.0,
      hostile_pressure_factor:   0.15,
      aligned_resilience_factor: 0.10,
      note: "Formula weights require code changes to the faction computation helpers (server/political-state-service.js). In-game MP counts and influence_bonus are editable without code changes via the Control Panel.",
    },
  };
}

/**
 * Seed editable starter factions for the current default scenario.
 * Inserts only if no factions exist for that party yet — safe to call repeatedly.
 * Returns a summary of what was inserted vs. already present.
 *
 * The app still ships only the 1997 default scenario data in this phase.
 * SEED VALUES — mods/admins can change these after seeding via the control panel.
 * All mp_counts are approximate 1997 estimates; adjust freely in-game.
 */
export async function seedDefaultScenarioFactions(scenarioKey = getDefaultScenarioKey(), actorUserId = "") {
  assertSupportedScenarioKey(scenarioKey);
  const DEFAULT_SCENARIO_FACTION_SEED_DATA = [
    // ── Labour (418 seats, May 1997) ─────────────────────────────────────────
    // New Labour swept to power; internal factions reflect Blairite dominance
    // with a sizeable traditional left and eurosceptic minority.
    {
      party_slug: "Labour", slug: "new-labour-blairite", name: "New Labour / Blairite",
      description: "The dominant Blairite modernising wing backing Blair's third-way programme.",
      colour: "#cc0000", ideology_tags: ["centrist", "moderniser", "third-way"],
      leadership_alignment: "aligned", rebellion_bias: 0.05, media_sensitivity: 0.4,
      constituency_sensitivity: 0.2, display_order: 1, mp_count: 200, influence_bonus: 2.0,
      notes: "1997 estimate — editable by mods/admins",
    },
    {
      party_slug: "Labour", slug: "tribune-group", name: "Tribune Group / Soft Left",
      description: "Broad soft-left grouping supportive of Labour values but cautious on market reforms.",
      colour: "#e05050", ideology_tags: ["soft-left", "labour-movement"],
      leadership_alignment: "neutral", rebellion_bias: 0.30, media_sensitivity: 0.3,
      constituency_sensitivity: 0.3, display_order: 2, mp_count: 100, influence_bonus: 0.5,
      notes: "1997 estimate — editable by mods/admins",
    },
    {
      party_slug: "Labour", slug: "campaign-group", name: "Campaign Group / Hard Left",
      description: "Socialist left grouping, most likely to rebel against New Labour policies.",
      colour: "#7b0000", ideology_tags: ["socialist", "hard-left", "anti-war"],
      leadership_alignment: "hostile", rebellion_bias: 0.80, media_sensitivity: 0.5,
      constituency_sensitivity: 0.4, display_order: 3, mp_count: 40, influence_bonus: 0.0,
      notes: "1997 estimate — editable by mods/admins",
    },
    {
      party_slug: "Labour", slug: "labour-first", name: "Labour First / Mainstream Right",
      description: "Right-of-party grouping favouring electability and fiscal caution.",
      colour: "#ff6666", ideology_tags: ["centre-right", "labour-right"],
      leadership_alignment: "aligned", rebellion_bias: 0.10, media_sensitivity: 0.3,
      constituency_sensitivity: 0.2, display_order: 4, mp_count: 50, influence_bonus: 0.3,
      notes: "1997 estimate — editable by mods/admins",
    },
    {
      party_slug: "Labour", slug: "labour-eurosceptics", name: "Labour Eurosceptics",
      description: "Cross-ideological group sceptical of deeper European integration.",
      colour: "#994444", ideology_tags: ["eurosceptic", "sovereign"],
      leadership_alignment: "neutral", rebellion_bias: 0.50, media_sensitivity: 0.3,
      constituency_sensitivity: 0.3, display_order: 5, mp_count: 28, influence_bonus: 0.0,
      notes: "1997 estimate — editable by mods/admins",
    },

    // ── Conservative (165 seats, May 1997) ───────────────────────────────────
    // Party in shock defeat; split between eurosceptic resurgence and one-nation moderates.
    {
      party_slug: "Conservative", slug: "one-nation", name: "One Nation Conservatives",
      description: "Moderate, pro-European strand emphasising social cohesion and pragmatic governance.",
      colour: "#1d6ab0", ideology_tags: ["one-nation", "moderate", "pro-europe"],
      leadership_alignment: "aligned", rebellion_bias: 0.10, media_sensitivity: 0.3,
      constituency_sensitivity: 0.2, display_order: 1, mp_count: 50, influence_bonus: 0.5,
      notes: "1997 estimate — editable by mods/admins",
    },
    {
      party_slug: "Conservative", slug: "fresh-start-eurosceptics", name: "Fresh Start / Eurosceptics",
      description: "Dominant eurosceptic grouping; grew after Maastricht and pushed for harder EU line.",
      colour: "#003087", ideology_tags: ["eurosceptic", "sovereign", "thatcherite"],
      leadership_alignment: "hostile", rebellion_bias: 0.60, media_sensitivity: 0.4,
      constituency_sensitivity: 0.3, display_order: 2, mp_count: 60, influence_bonus: 1.0,
      notes: "1997 estimate — editable by mods/admins",
    },
    {
      party_slug: "Conservative", slug: "thatcherite-right", name: "Thatcherite Right",
      description: "Free-market Thatcherites prioritising low tax, deregulation, and strong defence.",
      colour: "#001f5b", ideology_tags: ["thatcherite", "free-market", "right"],
      leadership_alignment: "neutral", rebellion_bias: 0.40, media_sensitivity: 0.4,
      constituency_sensitivity: 0.3, display_order: 3, mp_count: 35, influence_bonus: 0.3,
      notes: "1997 estimate — editable by mods/admins",
    },
    {
      party_slug: "Conservative", slug: "tory-modernisers", name: "Conservative Modernisers",
      description: "Post-defeat modernising faction pushing for social liberalism and party reform.",
      colour: "#4a90d9", ideology_tags: ["moderniser", "liberal-conservative", "centrist"],
      leadership_alignment: "aligned", rebellion_bias: 0.05, media_sensitivity: 0.5,
      constituency_sensitivity: 0.2, display_order: 4, mp_count: 20, influence_bonus: 0.5,
      notes: "1997 estimate — editable by mods/admins",
    },

    // ── Liberal Democrat (46 seats, May 1997) ────────────────────────────────
    // Paddy Ashdown era; broadly cohesive with a social/economic liberal divide.
    {
      party_slug: "Liberal Democrat", slug: "social-liberals", name: "Social Liberal Forum",
      description: "Left-leaning social liberals prioritising public services and civil liberties.",
      colour: "#f4a900", ideology_tags: ["social-liberal", "left-leaning", "civil-liberties"],
      leadership_alignment: "aligned", rebellion_bias: 0.10, media_sensitivity: 0.4,
      constituency_sensitivity: 0.3, display_order: 1, mp_count: 25, influence_bonus: 0.5,
      notes: "1997 estimate — editable by mods/admins",
    },
    {
      party_slug: "Liberal Democrat", slug: "economic-liberals", name: "Economic Liberals",
      description: "Market-oriented liberals emphasising enterprise, free trade, and fiscal discipline.",
      colour: "#e8961e", ideology_tags: ["economic-liberal", "free-market", "orange-book"],
      leadership_alignment: "aligned", rebellion_bias: 0.20, media_sensitivity: 0.3,
      constituency_sensitivity: 0.2, display_order: 2, mp_count: 15, influence_bonus: 0.3,
      notes: "1997 estimate — editable by mods/admins",
    },
    {
      party_slug: "Liberal Democrat", slug: "independent-liberals", name: "Independent Liberals",
      description: "Constituency-first pragmatists resistant to strong whipping.",
      colour: "#d4891e", ideology_tags: ["pragmatist", "localist"],
      leadership_alignment: "neutral", rebellion_bias: 0.35, media_sensitivity: 0.3,
      constituency_sensitivity: 0.5, display_order: 3, mp_count: 6, influence_bonus: 0.0,
      notes: "1997 estimate — editable by mods/admins",
    },
  ];

  const results = { inserted: [], skipped: [] };

  for (const f of DEFAULT_SCENARIO_FACTION_SEED_DATA) {
    // Skip if a faction with this slug already exists for this party
    const { rows: existing } = await pool.query(
      "SELECT id FROM party_factions WHERE party_slug = $1 AND slug = $2",
      [f.party_slug, f.slug]
    );
    if (existing.length > 0) {
      results.skipped.push(`${f.party_slug}/${f.slug}`);
      continue;
    }

    const { rows: inserted } = await pool.query(
      `INSERT INTO party_factions
         (party_slug, slug, name, description, colour, ideology_tags, leadership_alignment,
          rebellion_bias, media_sensitivity, constituency_sensitivity, display_order, active)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,TRUE)
       RETURNING id`,
      [
        f.party_slug, f.slug, f.name, f.description, f.colour,
        JSON.stringify(f.ideology_tags),
        f.leadership_alignment, f.rebellion_bias, f.media_sensitivity,
        f.constituency_sensitivity, f.display_order,
      ]
    );
    const newId = inserted[0].id;
    await pool.query(
      `INSERT INTO party_faction_allocations (faction_id, mp_count, influence_bonus, notes, updated_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [newId, f.mp_count, f.influence_bonus, f.notes, actorUserId]
    );
    results.inserted.push(`${f.party_slug}/${f.slug}`);
  }

  return results;
}

export async function seed1997Factions(actorUserId = "") {
  return seedDefaultScenarioFactions(getDefaultScenarioKey(), actorUserId);
}
