import { getCharacterContext, hasOffice, hasRoleFlag } from "./core-engine.js";

export function canManageAsAdmin(data) {
  return hasRoleFlag(data, "admin");
}

export function canManageAsMod(data) {
  return hasRoleFlag(data, "mod");
}

export function canManageAsSpeaker(data) {
  return hasRoleFlag(data, "speaker");
}

export function canPostNews(data) {
  return canManageAsAdmin(data) || canManageAsMod(data);
}

export function canAnswerQuestionTime(data, officeId) {
  if (canManageAsAdmin(data) || canManageAsMod(data) || canManageAsSpeaker(data)) return true;
  return hasOffice(data, officeId) || hasOffice(data, "prime-minister") || hasOffice(data, "leader-commons");
}

export function canRaiseCivilServiceCase(data, officeId) {
  if (canManageAsAdmin(data) || canManageAsMod(data)) return true;
  return hasOffice(data, officeId);
}

export function canSignEdm(data) {
  const c = getCharacterContext(data);
  const blockedOffices = new Set([
    "prime-minister", "leader-commons", "chancellor", "home", "foreign", "trade", "defence", "welfare",
    "education", "env-agri", "health", "eti", "culture", "home-nations"
  ]);
  return !blockedOffices.has(String(c.office || ""));
}

export function canVoteDivision(data) {
  const c = getCharacterContext(data);
  return Boolean(c.name && c.party);
}

export function canSeeAudienceItem(data, audience = {}) {
  if (!audience || !Object.keys(audience).length) return true;

  if (audience.speakerOnly) return canManageAsSpeaker(data);

  const c = getCharacterContext(data);

  if (Array.isArray(audience.roles) && audience.roles.length) {
    if (!audience.roles.includes(c.role)) return false;
  }
  if (Array.isArray(audience.offices) && audience.offices.length) {
    if (!audience.offices.includes(c.office)) return false;
  }
  return true;
}
