/**
 * Internal Party Management (IPM) domain contract.
 *
 * Pure logic only: enums + permission/state helpers.
 * No DB access and no side effects.
 */

export const IPM_TICKET_ORIGIN = Object.freeze({
  player: "player",
  staff: "staff",
  npc: "npc",
});

export const IPM_TICKET_TYPE = Object.freeze({
  policy: "policy",
  operation: "operation",
  staffing: "staffing",
  finance: "finance",
});

export const IPM_TICKET_STATUS = Object.freeze({
  awaitingStaffCosting: "awaiting_staff_costing",
  awaitingChairmanApproval: "awaiting_chairman_approval",
  awaitingLeaderApproval: "awaiting_leader_approval",
  queuedForFreeze: "queued_for_freeze",
  outcomeRecorded: "outcome_recorded",
  ignored: "ignored",
  cancelled: "cancelled",
});

export const IPM_TICKET_TO_ROLE = Object.freeze({
  staff: "staff",
  chairman: "chairman",
  leader: "leader",
  whip: "whip",
});

export const IPM_VIEWER_ROLES = Object.freeze(["member", "whip", "chairman", "leader", "staff"]);

export function canViewTicket({ viewerRole = "member", isOwner = false } = {}) {
  if (viewerRole === "staff" || viewerRole === "leader") return true;
  if (viewerRole === "whip") return Boolean(isOwner);
  if (viewerRole === "chairman") return Boolean(isOwner);
  return false;
}

export function canCreateTicket({ viewerRole = "member", origin = IPM_TICKET_ORIGIN.player } = {}) {
  if (!Object.values(IPM_TICKET_ORIGIN).includes(origin)) return false;
  if (origin === IPM_TICKET_ORIGIN.player) {
    return viewerRole === "whip" || viewerRole === "chairman" || viewerRole === "leader";
  }
  return viewerRole === "staff";
}

export function getInitialStatus({ origin = IPM_TICKET_ORIGIN.player } = {}) {
  if (origin === IPM_TICKET_ORIGIN.player) return IPM_TICKET_STATUS.awaitingStaffCosting;
  return IPM_TICKET_STATUS.queuedForFreeze;
}

export function canCostTicket({ viewerRole = "member", ticket } = {}) {
  if (viewerRole !== "staff") return false;
  return ticket?.origin === IPM_TICKET_ORIGIN.player && ticket?.status === IPM_TICKET_STATUS.awaitingStaffCosting;
}

export function applyCosting({ ticket } = {}) {
  if (!ticket || ticket.origin !== IPM_TICKET_ORIGIN.player) return ticket;
  if (ticket.status !== IPM_TICKET_STATUS.awaitingStaffCosting) return ticket;
  return { ...ticket, status: IPM_TICKET_STATUS.awaitingChairmanApproval, to_role: IPM_TICKET_TO_ROLE.chairman };
}

export function canApproveTicket({ viewerRole = "member", ticket } = {}) {
  if (!ticket || ticket.origin !== IPM_TICKET_ORIGIN.player) return false;
  if (viewerRole === "chairman" && ticket.status === IPM_TICKET_STATUS.awaitingChairmanApproval) return true;
  if (viewerRole === "leader" && ticket.status === IPM_TICKET_STATUS.awaitingLeaderApproval) return true;
  return false;
}

export function applyApproval({ viewerRole = "member", ticket } = {}) {
  if (!canApproveTicket({ viewerRole, ticket })) return ticket;
  if (viewerRole === "chairman") {
    return { ...ticket, status: IPM_TICKET_STATUS.awaitingLeaderApproval, to_role: IPM_TICKET_TO_ROLE.leader };
  }
  return { ...ticket, status: IPM_TICKET_STATUS.queuedForFreeze, to_role: IPM_TICKET_TO_ROLE.staff };
}

export function canIgnoreTicket({ viewerRole = "member", ticket } = {}) {
  if (viewerRole !== "chairman" && viewerRole !== "leader") return false;
  return ticket?.origin === IPM_TICKET_ORIGIN.staff || ticket?.origin === IPM_TICKET_ORIGIN.npc;
}

export function canRecordOutcome({ viewerRole = "member", ticket } = {}) {
  if (viewerRole !== "staff") return false;
  return ticket?.status === IPM_TICKET_STATUS.queuedForFreeze;
}

export function canCancelTicket({ viewerRole = "member", ticket, isOwner = false } = {}) {
  if (!ticket) return false;
  if (viewerRole === "staff") return true;
  if (ticket.origin !== IPM_TICKET_ORIGIN.player) return false;
  const cancellable = [
    IPM_TICKET_STATUS.awaitingStaffCosting,
    IPM_TICKET_STATUS.awaitingChairmanApproval,
    IPM_TICKET_STATUS.awaitingLeaderApproval,
  ];
  return Boolean(isOwner) && cancellable.includes(ticket.status);
}

export function canRejectTicket({ viewerRole = "member", ticket } = {}) {
  return canApproveTicket({ viewerRole, ticket });
}

export function applyRejection({ viewerRole = "member", ticket } = {}) {
  if (!canRejectTicket({ viewerRole, ticket })) return ticket;
  return {
    ...ticket,
    status: IPM_TICKET_STATUS.cancelled,
    to_role: IPM_TICKET_TO_ROLE.staff,
  };
}

export function getCostChargeTarget({ ticket } = {}) {
  const creatorRole = String(ticket?.creatorRole || "");
  if (ticket?.origin === IPM_TICKET_ORIGIN.player && creatorRole === "whip") {
    return {
      chargeModel: "character_pc",
      characterId: String(ticket?.creatorCharacterId || ""),
      locked: true,
      reason: "Whip-created ticket cost must be charged to the creating whip character.",
    };
  }
  return {
    chargeModel: "party_budget",
    characterId: "",
    locked: false,
    reason: "Default IPM costing model.",
  };
}
