// js/permissions.js
import {
  canManageAsAdmin,
  canManageAsMod,
  canManageAsSpeaker,
  canPostNews as canPostNewsEngine,
  canAnswerQuestionTime,
  canRaiseCivilServiceCase,
  canSignEdm,
  canVoteDivision,
  canSeeAudienceItem
} from "./engines/permission-engine.js";

export function isAdmin(data) {
  return canManageAsAdmin(data);
}

export function isMod(data) {
  return canManageAsMod(data);
}

export function isSpeaker(data) {
  return canManageAsSpeaker(data);
}

export function canPostNews(data) {
  return canPostNewsEngine(data);
}

/**
 * Generic role check: does the current user have the given role?
 *
 * Supported roles: "admin" | "mod" | "speaker"
 *
 * @param {"admin"|"mod"|"speaker"} role
 * @param {object} data - game data object (contains data.currentUser)
 */
export function can(role, data) {
  if (role === "admin")   return isAdmin(data);
  if (role === "mod")     return isMod(data);
  if (role === "speaker") return isSpeaker(data);
  return false;
}

/**
 * True for admin OR mod — the most common staff permission.
 * Use this wherever only admins/mods should see a button (not speakers).
 */
export function canAdminOrMod(data) {
  return isAdmin(data) || isMod(data);
}

/**
 * True for admin OR mod OR speaker.
 * Use this wherever all three system roles have access (e.g. body management,
 * constituency management, user profiles).
 */
export function canAdminModOrSpeaker(data) {
  return isAdmin(data) || isMod(data) || isSpeaker(data);
}

export {
  canAnswerQuestionTime,
  canRaiseCivilServiceCase,
  canSignEdm,
  canVoteDivision,
  canSeeAudienceItem
};
