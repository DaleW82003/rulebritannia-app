// js/permissions.js

export function isAdmin(data) {
  return !!data?.currentUser?.isAdmin || (data?.currentUser?.roles || []).includes("admin");
}

export function isMod(data) {
  return !!data?.currentUser?.isMod || (data?.currentUser?.roles || []).includes("mod");
}

export function isSpeaker(data) {
  return (data?.currentUser?.roles || []).includes("speaker") || !!data?.currentCharacter?.isSpeaker;
}

// Useful later:
export function canPostNews(data) {
  return isAdmin(data) || isMod(data);
}
