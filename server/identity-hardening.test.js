/**
 * Unit tests for identity-hardening changes.
 *
 * Verifies that authority checks use immutable character_id / party slug
 * rather than mutable name strings.
 *
 * Run with: node --test server/identity-hardening.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// ── Helpers mirroring the production logic ────────────────────────────────────

/**
 * canAuthorManageAmendments — hardened version (mirrors js/pages/bill.js).
 * Prefers character_id equality; falls back to name comparison when IDs are absent.
 */
function canAuthorManageAmendments(bill, char) {
  if (char?.id && bill.author_character_id) {
    return String(char.id) === String(bill.author_character_id);
  }
  return String(char?.name || "") && String(char?.name || "") === String(bill.author || "");
}

/**
 * isAmendmentDecisionAuthorised — hardened server-side check
 * (mirrors the POST /api/bills/:id/amendments/:aid/decide logic).
 */
function isAmendmentDecisionAuthorised(billAuthorCharId, charId, isStaff) {
  const isAuthor = !!(billAuthorCharId && String(charId) === String(billAuthorCharId));
  return isAuthor || isStaff;
}

/**
 * isBillWithdrawalAuthorised — hardened server-side check
 * (mirrors POST /api/bills/:id/withdraw logic).
 */
function isBillWithdrawalAuthorised({ billAuthorCharId, charId, charOffice, charRole, isStaff }) {
  if (isStaff) return true;
  if (billAuthorCharId && String(charId) === String(billAuthorCharId)) return true;
  if (["prime-minister", "leader-commons"].includes(String(charOffice || ""))) return true;
  if (String(charRole || "") === "prime-minister") return true;
  return false;
}

/**
 * canAccessCabinetById — hardened client-side check
 * (mirrors js/pages/cabinet.js canAccessCabinet using holderCharId).
 */
function canAccessCabinetById(offices, charId) {
  if (!charId) return false;
  return offices.some((o) => o.holderCharId && String(o.holderCharId) === String(charId));
}

/**
 * canAccessShadowCabinetById — hardened client-side check
 * (mirrors js/pages/shadowcabinet.js canAccessShadowCabinet using holderCharId).
 */
function canAccessShadowCabinetById(offices, charId) {
  if (!charId) return false;
  return offices.some((o) => o.holderCharId && String(o.holderCharId) === String(charId));
}

// ── Amendment author authority — character_id ─────────────────────────────────

test("canAuthorManageAmendments: correct character_id matches → true", () => {
  const bill = { id: "BILL-1", author: "Alice Smith", author_character_id: "char-uuid-1" };
  const char = { id: "char-uuid-1", name: "Alice Smith" };
  assert.ok(canAuthorManageAmendments(bill, char));
});

test("canAuthorManageAmendments: different character_id → false even if name matches", () => {
  // This is the key hardening: if the character renamed themselves, id still rules
  const bill = { id: "BILL-1", author: "Alice Smith", author_character_id: "char-uuid-1" };
  const char = { id: "char-uuid-999", name: "Alice Smith" };
  assert.equal(canAuthorManageAmendments(bill, char), false);
});

test("canAuthorManageAmendments: correct id but wrong name → true (id wins)", () => {
  const bill = { id: "BILL-1", author: "Alice Smith", author_character_id: "char-uuid-1" };
  const char = { id: "char-uuid-1", name: "Alice Smith-Renamed" };
  assert.ok(canAuthorManageAmendments(bill, char));
});

test("canAuthorManageAmendments: no author_character_id falls back to name comparison (true)", () => {
  const bill = { id: "BILL-1", author: "Alice Smith", author_character_id: null };
  const char = { id: "char-uuid-1", name: "Alice Smith" };
  assert.ok(canAuthorManageAmendments(bill, char));
});

test("canAuthorManageAmendments: no author_character_id, name mismatch → false", () => {
  const bill = { id: "BILL-1", author: "Alice Smith", author_character_id: null };
  const char = { id: "char-uuid-99", name: "Bob Jones" };
  assert.equal(canAuthorManageAmendments(bill, char), false);
});

test("canAuthorManageAmendments: no char id and no bill id falls back to name (true)", () => {
  const bill = { id: "BILL-1", author: "Alice Smith" };
  const char = { name: "Alice Smith" };
  assert.ok(canAuthorManageAmendments(bill, char));
});

// ── Amendment decision authorisation ─────────────────────────────────────────

test("isAmendmentDecisionAuthorised: author charId → allowed", () => {
  assert.ok(isAmendmentDecisionAuthorised("char-uuid-1", "char-uuid-1", false));
});

test("isAmendmentDecisionAuthorised: non-author charId, not staff → denied", () => {
  assert.equal(isAmendmentDecisionAuthorised("char-uuid-1", "char-uuid-2", false), false);
});

test("isAmendmentDecisionAuthorised: non-author but is staff → allowed", () => {
  assert.ok(isAmendmentDecisionAuthorised("char-uuid-1", "char-uuid-2", true));
});

test("isAmendmentDecisionAuthorised: null billAuthorCharId, not staff → denied", () => {
  // billAuthorCharId not set — no author match possible, not staff
  assert.equal(isAmendmentDecisionAuthorised(null, "char-uuid-1", false), false);
});

test("isAmendmentDecisionAuthorised: null billAuthorCharId, is staff → allowed", () => {
  assert.ok(isAmendmentDecisionAuthorised(null, "char-uuid-1", true));
});

// ── Bill withdrawal authorisation ─────────────────────────────────────────────

test("isBillWithdrawalAuthorised: matching author_character_id → allowed", () => {
  assert.ok(isBillWithdrawalAuthorised({
    billAuthorCharId: "char-1", charId: "char-1", charOffice: "backbencher", charRole: "backbencher", isStaff: false,
  }));
});

test("isBillWithdrawalAuthorised: different character_id → denied", () => {
  assert.equal(isBillWithdrawalAuthorised({
    billAuthorCharId: "char-1", charId: "char-2", charOffice: "backbencher", charRole: "backbencher", isStaff: false,
  }), false);
});

test("isBillWithdrawalAuthorised: PM by office → allowed", () => {
  assert.ok(isBillWithdrawalAuthorised({
    billAuthorCharId: "char-1", charId: "char-2", charOffice: "prime-minister", charRole: "backbencher", isStaff: false,
  }));
});

test("isBillWithdrawalAuthorised: admin/mod (isStaff) → always allowed", () => {
  assert.ok(isBillWithdrawalAuthorised({
    billAuthorCharId: "char-1", charId: "char-99", charOffice: "backbencher", charRole: "backbencher", isStaff: true,
  }));
});

// ── Cabinet access — holderCharId ─────────────────────────────────────────────

test("canAccessCabinetById: character holds an office → access granted", () => {
  const offices = [
    { id: "prime-minister", holderCharId: "char-pm", holderName: "Tony Blair" },
    { id: "chancellor",     holderCharId: "char-ch", holderName: "Gordon Brown" },
  ];
  assert.ok(canAccessCabinetById(offices, "char-ch"));
});

test("canAccessCabinetById: character does not hold any office → denied", () => {
  const offices = [
    { id: "prime-minister", holderCharId: "char-pm", holderName: "Tony Blair" },
    { id: "chancellor",     holderCharId: "char-ch", holderName: "Gordon Brown" },
  ];
  assert.equal(canAccessCabinetById(offices, "char-xyz"), false);
});

test("canAccessCabinetById: character with same name as holder but different id → denied", () => {
  const offices = [
    { id: "chancellor", holderCharId: "char-ch", holderName: "Gordon Brown" },
  ];
  // A different character happens to share the same display name — must be denied
  assert.equal(canAccessCabinetById(offices, "char-imposter"), false);
});

// ── Shadow cabinet access — holderCharId ─────────────────────────────────────

test("canAccessShadowCabinetById: character holds shadow office → access granted", () => {
  const offices = [
    { id: "leader-opposition", holderCharId: "char-loto", holderName: "William Hague" },
    { id: "shadow-chancellor", holderCharId: "char-sc",   holderName: "Francis Maude" },
  ];
  assert.ok(canAccessShadowCabinetById(offices, "char-loto"));
});

test("canAccessShadowCabinetById: non-holder denied", () => {
  const offices = [
    { id: "leader-opposition", holderCharId: "char-loto", holderName: "William Hague" },
  ];
  assert.equal(canAccessShadowCabinetById(offices, "char-random"), false);
});

test("canAccessShadowCabinetById: empty charId → denied", () => {
  const offices = [
    { id: "leader-opposition", holderCharId: "char-loto", holderName: "William Hague" },
  ];
  assert.equal(canAccessShadowCabinetById(offices, ""), false);
  assert.equal(canAccessShadowCabinetById(offices, null), false);
});

// ── resolveCharacterIdByName (backfill helper) ────────────────────────────────

/**
 * Pure function mirroring the server-side resolveCharacterIdByName helper.
 * Given an array of {id, name} character objects and a target name,
 * returns the matching character's id if exactly one matches, or null otherwise.
 */
function resolveCharacterIdByName(characters, targetName) {
  if (!targetName || typeof targetName !== "string") return null;
  const norm = targetName.toLowerCase().trim();
  if (!norm) return null;
  const matches = characters.filter(
    (c) => c && typeof c.name === "string" && c.name.toLowerCase().trim() === norm
  );
  return matches.length === 1 ? matches[0].id : null;
}

/** isDraftAuthor — mirrors js/pages/cabinet.js and js/pages/shadowcabinet.js */
function isDraftAuthor(draft, char) {
  if (!draft || !char) return false;
  const charId   = String(char.id   || "");
  const charName = String(char.name || "");
  if (charId   && draft.authorId === charId)   return true;
  if (charName && draft.authorId === charName) return true;
  return false;
}

// ── resolveCharacterIdByName tests ───────────────────────────────────────────

test("resolveCharacterIdByName: unambiguous exact match → returns id", () => {
  const chars = [
    { id: "char-1", name: "Tony Blair" },
    { id: "char-2", name: "Gordon Brown" },
  ];
  assert.equal(resolveCharacterIdByName(chars, "Tony Blair"), "char-1");
});

test("resolveCharacterIdByName: case-insensitive and trims whitespace", () => {
  const chars = [
    { id: "char-1", name: "Tony Blair" },
    { id: "char-2", name: "Gordon Brown" },
  ];
  assert.equal(resolveCharacterIdByName(chars, "  tony blair  "), "char-1");
  assert.equal(resolveCharacterIdByName(chars, "GORDON BROWN"),   "char-2");
});

test("resolveCharacterIdByName: no match → null", () => {
  const chars = [
    { id: "char-1", name: "Tony Blair" },
  ];
  assert.equal(resolveCharacterIdByName(chars, "William Hague"), null);
});

test("resolveCharacterIdByName: ambiguous — 2 characters share same name → null", () => {
  const chars = [
    { id: "char-1", name: "John Smith" },
    { id: "char-2", name: "John Smith" },
  ];
  assert.equal(resolveCharacterIdByName(chars, "John Smith"), null);
});

test("resolveCharacterIdByName: empty target name → null", () => {
  const chars = [{ id: "char-1", name: "Tony Blair" }];
  assert.equal(resolveCharacterIdByName(chars, ""),    null);
  assert.equal(resolveCharacterIdByName(chars, null),  null);
  assert.equal(resolveCharacterIdByName(chars, "   "), null);
});

test("resolveCharacterIdByName: empty character list → null", () => {
  assert.equal(resolveCharacterIdByName([], "Tony Blair"), null);
});

test("resolveCharacterIdByName: already-resolved record (UUID target) still resolves if char name happens to match — not a real scenario but safe", () => {
  // The function doesn't know about UUIDs — it just matches names.
  // A UUID won't accidentally match a real name.
  const chars = [{ id: "char-1", name: "Tony Blair" }];
  assert.equal(resolveCharacterIdByName(chars, "550e8400-e29b-41d4-a716-446655440000"), null);
});

// ── isDraftAuthor tests (new helper for cabinet / shadow cabinet drafts) ──────

test("isDraftAuthor: draft.authorId is character UUID → match by id", () => {
  const draft = { authorId: "char-uuid-1" };
  const char  = { id: "char-uuid-1", name: "Tony Blair" };
  assert.ok(isDraftAuthor(draft, char));
});

test("isDraftAuthor: draft.authorId is character UUID, different char → no match", () => {
  const draft = { authorId: "char-uuid-1" };
  const char  = { id: "char-uuid-2", name: "Tony Blair" };
  assert.equal(isDraftAuthor(draft, char), false);
});

test("isDraftAuthor: legacy draft with name-based authorId → match by name", () => {
  const draft = { authorId: "Tony Blair" };
  const char  = { id: "char-uuid-1", name: "Tony Blair" };
  assert.ok(isDraftAuthor(draft, char));
});

test("isDraftAuthor: legacy draft, different character with same name — still matches (legacy limitation, same as before)", () => {
  // This is the residual risk for legacy name-based drafts that have not been backfilled yet.
  const draft = { authorId: "Tony Blair" };
  const char  = { id: "char-uuid-999", name: "Tony Blair" };
  // Should match because name fallback is still active for legacy drafts.
  assert.ok(isDraftAuthor(draft, char));
});

test("isDraftAuthor: draft with UUID authorId, char with matching name but different id — name match is NOT used when id is available", () => {
  // Once a draft is backfilled to use UUID, only the UUID path fires.
  const draft = { authorId: "char-uuid-1" };
  const char  = { id: "char-uuid-2", name: "Tony Blair" };
  // char-uuid-2 has the same name but the draft's authorId is char-uuid-1 → not the author
  assert.equal(isDraftAuthor(draft, char), false);
});

test("isDraftAuthor: new draft (authorId = char.id) after backfill → correct author recognised", () => {
  const draft = { authorId: "char-abc" };
  const char  = { id: "char-abc", name: "Gordon Brown" };
  assert.ok(isDraftAuthor(draft, char));
});

test("isDraftAuthor: null draft or char → false", () => {
  assert.equal(isDraftAuthor(null, { id: "char-1", name: "A" }), false);
  assert.equal(isDraftAuthor({ authorId: "char-1" }, null), false);
  assert.equal(isDraftAuthor(null, null), false);
});
