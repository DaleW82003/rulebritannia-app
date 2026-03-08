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
