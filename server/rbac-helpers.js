/**
 * RBAC helpers: shared role-check utilities for server routes.
 *
 * All boolean helpers accept an Express `req` object and safely read roles from
 * `req.session.roles` (treating a missing or non-array value as an empty array).
 *
 * Usage pattern (boolean guard with compound logic):
 *
 *   const isStaff = hasAdminOrMod(req);
 *   let canAct = isStaff;
 *   if (!canAct) { /* additional check *\/ }
 *   if (!canAct) return res.status(403).json({ error: "..." });
 *
 * For simple guards use the existing requireAdminOrMod / requireAdminModOrSpeaker
 * middleware helpers defined in server/index.js which also check authentication.
 */

/**
 * Returns the session roles array, always as a safe, non-null array.
 * Accepts optional-chaining on req.session (handles both `req.session.roles`
 * and `req.session?.roles` call sites uniformly).
 *
 * @param {import("express").Request} req
 * @returns {string[]}
 */
export function getSessionRoles(req) {
  return Array.isArray(req.session?.roles) ? req.session.roles : [];
}

/**
 * Returns true if the session user has the admin or mod role.
 *
 * @param {import("express").Request} req
 * @returns {boolean}
 */
export function hasAdminOrMod(req) {
  const roles = getSessionRoles(req);
  return roles.includes("admin") || roles.includes("mod");
}

/**
 * Returns true if the session user has the admin, mod, or speaker role.
 *
 * @param {import("express").Request} req
 * @returns {boolean}
 */
export function hasAdminModOrSpeaker(req) {
  const roles = getSessionRoles(req);
  return roles.includes("admin") || roles.includes("mod") || roles.includes("speaker");
}
