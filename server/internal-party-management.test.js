import { test } from "node:test";
import assert from "node:assert/strict";

import {
  IPM_TICKET_ORIGIN,
  IPM_TICKET_STATUS,
  IPM_VIEWER_ROLES,
  canViewTicket,
  canCreateTicket,
  getInitialStatus,
  canCostTicket,
  applyCosting,
  canApproveTicket,
  applyApproval,
  canIgnoreTicket,
  canRecordOutcome,
  canCancelTicket,
  canRejectTicket,
  applyRejection,
  getCostChargeTarget,
} from "./internal-party-management.js";

test("IPM roles include required viewer roles", () => {
  assert.deepEqual(IPM_VIEWER_ROLES, ["member", "whip", "chairman", "leader", "staff"]);
});

test("visibility: whip/chair are owner-scoped while leader/staff can view all", () => {
  assert.equal(canViewTicket({ viewerRole: "member", isOwner: false }), false);
  assert.equal(canViewTicket({ viewerRole: "member", isOwner: true }), false);
  assert.equal(canViewTicket({ viewerRole: "whip", isOwner: false }), false);
  assert.equal(canViewTicket({ viewerRole: "chairman", isOwner: false }), false);
  assert.equal(canViewTicket({ viewerRole: "leader", isOwner: false }), true);
  assert.equal(canViewTicket({ viewerRole: "staff", isOwner: false }), true);
});

test("creation: player-origin can be created by player/staff roles, staff/npc only by staff", () => {
  assert.equal(canCreateTicket({ viewerRole: "member", origin: IPM_TICKET_ORIGIN.player }), false);
  assert.equal(canCreateTicket({ viewerRole: "whip", origin: IPM_TICKET_ORIGIN.player }), true);
  assert.equal(canCreateTicket({ viewerRole: "staff", origin: IPM_TICKET_ORIGIN.player }), false);
  assert.equal(canCreateTicket({ viewerRole: "member", origin: IPM_TICKET_ORIGIN.staff }), false);
  assert.equal(canCreateTicket({ viewerRole: "staff", origin: IPM_TICKET_ORIGIN.staff }), true);
  assert.equal(canCreateTicket({ viewerRole: "leader", origin: IPM_TICKET_ORIGIN.npc }), false);
});

test("status flow: player-origin requires staff costing then chairman then leader approvals", () => {
  const created = { origin: IPM_TICKET_ORIGIN.player, status: getInitialStatus({ origin: IPM_TICKET_ORIGIN.player }) };
  assert.equal(created.status, IPM_TICKET_STATUS.awaitingStaffCosting);

  assert.equal(canCostTicket({ viewerRole: "staff", ticket: created }), true);
  const costed = applyCosting({ ticket: created });
  assert.equal(costed.status, IPM_TICKET_STATUS.awaitingChairmanApproval);

  assert.equal(canApproveTicket({ viewerRole: "chairman", ticket: costed }), true);
  const chairApproved = applyApproval({ viewerRole: "chairman", ticket: costed });
  assert.equal(chairApproved.status, IPM_TICKET_STATUS.awaitingLeaderApproval);

  assert.equal(canApproveTicket({ viewerRole: "leader", ticket: chairApproved }), true);
  const leaderApproved = applyApproval({ viewerRole: "leader", ticket: chairApproved });
  assert.equal(leaderApproved.status, IPM_TICKET_STATUS.queuedForFreeze);
});

test("approval constraints: wrong role or wrong order cannot approve", () => {
  const awaitingChair = { origin: IPM_TICKET_ORIGIN.player, status: IPM_TICKET_STATUS.awaitingChairmanApproval };
  assert.equal(canApproveTicket({ viewerRole: "leader", ticket: awaitingChair }), false);
  assert.equal(canApproveTicket({ viewerRole: "whip", ticket: awaitingChair }), false);

  const awaitingLeader = { origin: IPM_TICKET_ORIGIN.player, status: IPM_TICKET_STATUS.awaitingLeaderApproval };
  assert.equal(canApproveTicket({ viewerRole: "chairman", ticket: awaitingLeader }), false);
});

test("staff/npc-origin: no approvals required; starts queued for freeze", () => {
  assert.equal(getInitialStatus({ origin: IPM_TICKET_ORIGIN.staff }), IPM_TICKET_STATUS.queuedForFreeze);
  assert.equal(getInitialStatus({ origin: IPM_TICKET_ORIGIN.npc }), IPM_TICKET_STATUS.queuedForFreeze);

  const staffTicket = { origin: IPM_TICKET_ORIGIN.staff, status: IPM_TICKET_STATUS.queuedForFreeze };
  assert.equal(canApproveTicket({ viewerRole: "chairman", ticket: staffTicket }), false);
  assert.equal(canApproveTicket({ viewerRole: "leader", ticket: staffTicket }), false);
});

test("ignore permissions: chairman/leader can ignore staff/npc tickets only", () => {
  const staffTicket = { origin: IPM_TICKET_ORIGIN.staff, status: IPM_TICKET_STATUS.queuedForFreeze };
  const playerTicket = { origin: IPM_TICKET_ORIGIN.player, status: IPM_TICKET_STATUS.awaitingLeaderApproval };
  assert.equal(canIgnoreTicket({ viewerRole: "chairman", ticket: staffTicket }), true);
  assert.equal(canIgnoreTicket({ viewerRole: "leader", ticket: staffTicket }), true);
  assert.equal(canIgnoreTicket({ viewerRole: "whip", ticket: staffTicket }), false);
  assert.equal(canIgnoreTicket({ viewerRole: "chairman", ticket: playerTicket }), false);
});

test("outcome permissions: only staff may record outcome from queued status", () => {
  const queued = { origin: IPM_TICKET_ORIGIN.player, status: IPM_TICKET_STATUS.queuedForFreeze };
  const pending = { origin: IPM_TICKET_ORIGIN.player, status: IPM_TICKET_STATUS.awaitingLeaderApproval };
  assert.equal(canRecordOutcome({ viewerRole: "staff", ticket: queued }), true);
  assert.equal(canRecordOutcome({ viewerRole: "leader", ticket: queued }), false);
  assert.equal(canRecordOutcome({ viewerRole: "staff", ticket: pending }), false);
});

test("cancellation: staff can cancel anything; owner can cancel own player-origin pre-freeze", () => {
  const preFreeze = { origin: IPM_TICKET_ORIGIN.player, status: IPM_TICKET_STATUS.awaitingChairmanApproval };
  const queued = { origin: IPM_TICKET_ORIGIN.player, status: IPM_TICKET_STATUS.queuedForFreeze };
  const staffOrigin = { origin: IPM_TICKET_ORIGIN.staff, status: IPM_TICKET_STATUS.queuedForFreeze };

  assert.equal(canCancelTicket({ viewerRole: "staff", ticket: preFreeze, isOwner: false }), true);
  assert.equal(canCancelTicket({ viewerRole: "member", ticket: preFreeze, isOwner: true }), true);
  assert.equal(canCancelTicket({ viewerRole: "member", ticket: preFreeze, isOwner: false }), false);
  assert.equal(canCancelTicket({ viewerRole: "member", ticket: queued, isOwner: true }), false);
  assert.equal(canCancelTicket({ viewerRole: "member", ticket: staffOrigin, isOwner: true }), false);
});

test("whip-created player ticket has locked character PC charge target", () => {
  const ticket = {
    origin: IPM_TICKET_ORIGIN.player,
    creatorRole: "whip",
    creatorCharacterId: "char-123",
  };
  assert.deepEqual(getCostChargeTarget({ ticket }), {
    chargeModel: "character_pc",
    characterId: "char-123",
    locked: true,
    reason: "Whip-created ticket cost must be charged to the creating whip character.",
  });

  const normal = getCostChargeTarget({ ticket: { origin: IPM_TICKET_ORIGIN.player, creatorRole: "member" } });
  assert.equal(normal.chargeModel, "party_budget");
  assert.equal(normal.locked, false);
});


test("rejection: approver roles can reject and ticket transitions to cancelled", () => {
  const t = { origin: IPM_TICKET_ORIGIN.player, status: IPM_TICKET_STATUS.awaitingChairmanApproval };
  assert.equal(canRejectTicket({ viewerRole: "chairman", ticket: t }), true);
  const rejected = applyRejection({ viewerRole: "chairman", ticket: t });
  assert.equal(rejected.status, IPM_TICKET_STATUS.cancelled);
});
