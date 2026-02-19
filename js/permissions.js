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

export {
  canAnswerQuestionTime,
  canRaiseCivilServiceCase,
  canSignEdm,
  canVoteDivision,
  canSeeAudienceItem
};
