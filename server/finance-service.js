/**
 * Finance service — salary scale resolution and character salary computation.
 *
 * Centralises the reusable salary-scale helpers that were previously inline in
 * server/index.js and called from multiple unrelated routes (salary admin, the
 * character finance page, the clock tick, and the salary-band admin API).
 *
 * Extracted:
 *   - resolveActiveSalaryScale(simIndex)  — resolves the active scale for a sim index
 *   - computeCharacterAnnualSalary(characterId, simIndex)  — highest-wins rule
 *   - resolvedAnnualSalary(characterId, simIndex)  — override > computed
 *
 * Not extracted (clock-tick runners stay in index.js):
 *   - runSalaryCrediting, runShopUpkeep, runRevenuePayouts, runMembershipIntake
 *   These depend on writeAuditLog (defined in index.js) and HQ_BASELINE_UPKEEP_1997
 *   and are pure operational side-effects rather than reusable helpers.
 *   They should be extracted in a future pass once writeAuditLog itself is
 *   modularised.
 */

import { pool } from "./db.js";

// ─────────────────────────────────────────────────────────────────────────────
// Salary scale helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the active salary scale row + its roles for the given sim index.
 * "Active" = latest scale where effective_from_sim_index <= simIndex.
 *
 * @param {number} simIndex  — absolute sim index (year*12 + month-1)
 * @returns {Promise<{id:string, name:string, effective_from_sim_index:number, roles:object}|null>}
 */
export async function resolveActiveSalaryScale(simIndex) {
  const { rows: scales } = await pool.query(
    `SELECT s.id, s.name, s.effective_from_sim_index,
            json_object_agg(r.role_key, r.annual_salary) AS roles
       FROM salary_scales s
       JOIN salary_scale_roles r ON r.scale_id = s.id
      WHERE s.effective_from_sim_index <= $1
      GROUP BY s.id, s.name, s.effective_from_sim_index
      ORDER BY s.effective_from_sim_index DESC
      LIMIT 1`,
    [simIndex]
  );
  return scales[0] ?? null;
}

/**
 * Compute a character's base annual salary using Rule 1 (highest-wins) from DB positions.
 * Returns { annualSalary, positionKeys, scaleId }.
 *
 * @param {string} characterId
 * @param {number} simIndex
 * @returns {Promise<{annualSalary:number, positionKeys:string[], scaleId:string|null}>}
 */
export async function computeCharacterAnnualSalary(characterId, simIndex) {
  const scale = await resolveActiveSalaryScale(simIndex);
  if (!scale) return { annualSalary: 0, positionKeys: [], scaleId: null };

  const { rows: positions } = await pool.query(
    "SELECT position_key FROM character_positions WHERE character_id = $1",
    [characterId]
  );
  const positionKeys = positions.map((p) => p.position_key);

  // Rule 1: highest salary wins
  let maxSalary = 0;
  const rolesMap = scale.roles || {};
  for (const key of positionKeys) {
    const s = Number(rolesMap[key] ?? 0);
    if (s > maxSalary) maxSalary = s;
  }

  return { annualSalary: maxSalary, positionKeys, scaleId: scale.id };
}

/**
 * Resolve annual salary for a character: explicit override takes precedence
 * over the computed scale lookup.
 *
 * Highest-wins is handled at query time in computeCharacterAnnualSalary.
 *
 * @param {string} characterId
 * @param {number} simIndex
 * @returns {Promise<{annualSalary:number, positionKeys?:string[], scaleId?:string|null, isOverride:boolean}>}
 */
export async function resolvedAnnualSalary(characterId, simIndex) {
  const { rows: fin } = await pool.query(
    "SELECT annual_salary_override FROM character_finance WHERE character_id = $1",
    [characterId]
  );
  const override = fin[0]?.annual_salary_override;
  if (override != null) return { annualSalary: Number(override), isOverride: true };
  const { annualSalary, positionKeys, scaleId } = await computeCharacterAnnualSalary(characterId, simIndex);
  return { annualSalary, positionKeys, scaleId, isOverride: false };
}
