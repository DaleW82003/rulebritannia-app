import { esc, affiliationBadge } from "../ui.js";
import { isAdmin, isMod, canAdminOrMod } from "../permissions.js";
import { parseDraftingForm, renderDraftingBuilder, wireDraftingBuilder } from "../bill-drafting.js";
import { apiGetParty, apiSetPartyLeader, apiSetPartyLeadership, apiSetChiefWhip, apiGetCharacters, apiGetMyCharacters, apiGetShopPriceIndex, apiGetPartyStructure, apiSavePartyStructure, apiSetPartyTreasury, apiSetPartyMembershipFee, apiGetPartyLedger, apiAddPartyDonation, apiAddPartyShopPurchase, apiRemovePartyShopPurchase, apiSellPartyShopPurchase, apiDismissPartyShopPurchase, apiSavePartyDrafts, apiWithdrawWhip, apiRestoreWhip, apiGetWhipRequests, apiApproveWhipRequest, apiDenyWhipRequest, apiRequestExpulsion, apiGetExpulsions, apiApproveExpulsion, apiDenyExpulsion, apiGetPartyElections, apiStartPartyElection, apiNominateForElection, apiVoteInElection, apiOpenElectionVoting, apiCloseElection, apiRunoffElection, apiGetPartyFactions, apiGetPartyFactionClimate, apiGetPartyInternalTickets, apiCreatePartyInternalTicket, apiApproveOrRejectPartyInternalTicket, apiDismissPartyInternalTicket, apiGetPartyInternalTicketMessages, apiStaffListInternalTickets, apiStaffSetInternalTicketCosting, apiStaffSetInternalTicketOutcome, apiStaffCreateInternalTicketMessage, apiStaffCancelInternalTicket, apiStaffCreateInternalTicket, apiStaffGetInternalTicketMessages } from "../api.js";
import { getCharacterContext } from "../engines/core-engine.js";
import { logAction } from "../audit.js";
import { isLoggedIn } from "../core.js";

const DEFAULT_PARTIES = {
  Conservative: {
    name: "Conservative",
    short: "CON",
    leader: { name: "", avatar: "", characterId: "" },
    treasury: { cash: 350000, debt: 50000, members: 176000 },
    hqUrl: null,
    drafts: []
  },
  Labour: {
    name: "Labour",
    short: "LAB",
    leader: { name: "", avatar: "", characterId: "" },
    treasury: { cash: 290000, debt: 120000, members: 145000 },
    hqUrl: null,
    drafts: []
  },
  "Liberal Democrat": {
    name: "Liberal Democrat",
    short: "LDM",
    leader: { name: "", avatar: "", characterId: "" },
    treasury: { cash: 95000, debt: 12000, members: 76000 },
    hqUrl: null,
    drafts: []
  }
};

// Static Discourse HQ URLs per party (category 9 = House of Commons; party categories are separate)
const PARTY_HQ_URLS = {
  "Labour":          "https://forum.rulebritannia.org/c/labour/11",
  "Conservative":    "https://forum.rulebritannia.org/c/conservative/10",
  "Liberal Democrat":"https://forum.rulebritannia.org/c/liberal-democrat/12",
};

/**
 * Returns the static Discourse HQ URL for a party by name, or null for unknown parties.
 * @param {string} partyName
 * @returns {string|null}
 */
function partyHqUrl(partyName) {
  return PARTY_HQ_URLS[partyName] || null;
}


// Schema matches personal shop: id, name, category, basePrice1997,
// baseMonthlyUpkeep1997, caps, effects[], riskModifier?, flavour

const PARTY_SHOP_ITEMS = [
  // ── A) National Operations ────────────────────────────────────────────────
  {
    id: "party-hq-upgrade",
    name: "Party HQ Upgrade",
    category: "National Operations",
    basePrice1997: 45000, baseMonthlyUpkeep1997: 4500,
    caps: { maxOwned: 1 },
    effects: [{ type: "orgCapacity", value: 3 }],
    riskModifier: null,
    flavour: "Expand and modernise central HQ. More meeting rooms, better infrastructure, professional staffing."
  },
  {
    id: "whips-office-expansion",
    name: "Whips Office Expansion",
    category: "National Operations",
    basePrice1997: 18000, baseMonthlyUpkeep1997: 2000,
    caps: { maxOwned: 1 },
    effects: [{ type: "disciplineCapacity", value: 2 }],
    riskModifier: null,
    flavour: "More whips, more phone lines, more leverage. Essential for managing a large parliamentary group."
  },
  {
    id: "national-policy-unit",
    name: "National Policy Unit",
    category: "National Operations",
    basePrice1997: 28000, baseMonthlyUpkeep1997: 3500,
    caps: { maxOwned: 1 },
    effects: [{ type: "policyResearch", value: 3 }],
    riskModifier: null,
    flavour: "A dedicated policy development unit staffed by researchers and former civil servants."
  },
  {
    id: "media-monitoring-centre",
    name: "Media Monitoring Centre",
    category: "National Operations",
    basePrice1997: 22000, baseMonthlyUpkeep1997: 2500,
    caps: { maxOwned: 1 },
    effects: [{ type: "rapidRebuttal", value: 2 }],
    riskModifier: null,
    flavour: "Real-time monitoring of press and broadcast coverage. Know what they're saying before you're asked."
  },
  {
    id: "rapid-rebuttal-team",
    name: "Rapid Rebuttal Team",
    category: "National Operations",
    basePrice1997: 12000, baseMonthlyUpkeep1997: 4000,
    caps: { maxOwned: 1 },
    effects: [{ type: "rapidRebuttal", value: 3 }, { type: "scandalDefence", value: 2 }],
    riskModifier: null,
    flavour: "A dedicated team to counter opposition attacks. Fax machines, phones, and very fast typists."
  },
  {
    id: "campaign-war-room",
    name: "Campaign War Room",
    category: "National Operations",
    basePrice1997: 32000, baseMonthlyUpkeep1997: 4800,
    caps: { maxOwned: 1 },
    effects: [{ type: "campaignCapacity", value: 4 }],
    riskModifier: null,
    flavour: "A centralised campaign operations centre. Targeting, messaging, battleground strategy."
  },
  {
    id: "data-analytics-platform",
    name: "Data Analytics Platform",
    category: "National Operations",
    basePrice1997: 38000, baseMonthlyUpkeep1997: 1800,
    caps: { maxOwned: 1 },
    effects: [{ type: "campaignCapacity", value: 2 }, { type: "policyResearch", value: 1 }],
    riskModifier: null,
    flavour: "Canvassing databases, voter modelling, demographic analysis. Advanced for 1997."
  },
  {
    id: "regional-organiser-network",
    name: "Regional Organiser Network",
    category: "National Operations",
    basePrice1997: 18000, baseMonthlyUpkeep1997: 3000,
    caps: { maxOwned: 1 },
    effects: [{ type: "orgCapacity", value: 2 }, { type: "campaignCapacity", value: 2 }],
    riskModifier: null,
    flavour: "Paid regional party organisers across the country. The backbone of ground-level politics."
  },
  {
    id: "legal-defence-fund",
    name: "Legal Defence Fund",
    category: "National Operations",
    basePrice1997: 28000, baseMonthlyUpkeep1997: 0,
    caps: { maxOwned: 1 },
    effects: [{ type: "scandalDefence", value: 3 }],
    riskModifier: null,
    flavour: "A ring-fenced fund for party-level legal matters. Libel, regulatory challenges, election disputes."
  },
  {
    id: "compliance-department",
    name: "Compliance Department",
    category: "National Operations",
    basePrice1997: 14000, baseMonthlyUpkeep1997: 2500,
    caps: { maxOwned: 1 },
    effects: [{ type: "scandalDefence", value: 2 }],
    riskModifier: null,
    flavour: "Internal compliance and ethics team. Monitors donation law, register of interests, conduct codes."
  },

  // ── B) Campaign & Influence ───────────────────────────────────────────────
  {
    id: "national-advertising-campaign",
    name: "National Advertising Campaign",
    category: "Campaign & Influence",
    basePrice1997: 75000, baseMonthlyUpkeep1997: 0,
    caps: {},
    effects: [{ type: "partyPolling", value: 3 }],
    riskModifier: null,
    flavour: "Billboard, press and broadcast campaign across target marginals. Big spend, potentially big return."
  },
  {
    id: "party-conference-upgrade",
    name: "Party Conference Upgrade",
    category: "Campaign & Influence",
    basePrice1997: 35000, baseMonthlyUpkeep1997: 0,
    caps: {},
    effects: [{ type: "partyPolling", value: 1 }, { type: "orgCapacity", value: 1 }],
    riskModifier: null,
    flavour: "Upgrade your annual conference: better venue, keynote production, fringe events, press operations."
  },
  {
    id: "digital-fundraising-platform",
    name: "Digital Fundraising Platform",
    category: "Campaign & Influence",
    basePrice1997: 18000, baseMonthlyUpkeep1997: 1000,
    caps: { maxOwned: 1 },
    effects: [{ type: "fundraisingCapacity", value: 2 }],
    riskModifier: null,
    flavour: "Online donation infrastructure. Website, secure payment, donor database. Forward-thinking."
  },
  {
    id: "national-campaign-bus",
    name: "National Campaign Bus",
    category: "Campaign & Influence",
    basePrice1997: 22000, baseMonthlyUpkeep1997: 2000,
    caps: { maxOwned: 1 },
    effects: [{ type: "campaignCapacity", value: 2 }],
    riskModifier: null,
    flavour: "A branded campaign bus for national touring events. Very visible. Hope the slogan is good."
  },
  {
    id: "social-media-war-chest",
    name: "Social Media War Chest",
    category: "Campaign & Influence",
    basePrice1997: 28000, baseMonthlyUpkeep1997: 0,
    caps: {},
    effects: [{ type: "partyPolling", value: 2 }, { type: "rapidRebuttal", value: 1 }],
    riskModifier: null,
    flavour: "Funded digital presence and targeted content. Reach voters the billboards can't."
  },
  {
    id: "grassroots-volunteer-hub",
    name: "Grassroots Volunteer Hub",
    category: "Campaign & Influence",
    basePrice1997: 14000, baseMonthlyUpkeep1997: 1500,
    caps: { maxOwned: 1 },
    effects: [{ type: "orgCapacity", value: 2 }, { type: "campaignCapacity", value: 1 }],
    riskModifier: null,
    flavour: "Volunteer coordination infrastructure. Training, briefing packs, canvass management."
  },
  {
    id: "regional-policy-forums",
    name: "Regional Policy Forums",
    category: "Campaign & Influence",
    basePrice1997: 9000, baseMonthlyUpkeep1997: 1000,
    caps: { maxOwned: 1 },
    effects: [{ type: "policyResearch", value: 1 }, { type: "orgCapacity", value: 1 }],
    riskModifier: null,
    flavour: "Consultation events with stakeholders, members, and candidates across the UK regions."
  },
  {
    id: "polling-contract",
    name: "Polling Contract",
    category: "Campaign & Influence",
    basePrice1997: 18000, baseMonthlyUpkeep1997: 2000,
    caps: { maxOwned: 1 },
    effects: [{ type: "policyResearch", value: 2 }],
    riskModifier: null,
    flavour: "A contract with a polling firm for regular internal tracking data. Know the numbers before anyone else."
  },

  // ── C) Infrastructure & Assets ────────────────────────────────────────────
  {
    id: "northern-regional-office",
    name: "Northern Regional Office",
    category: "Infrastructure & Assets",
    basePrice1997: 55000, baseMonthlyUpkeep1997: 3000,
    caps: { maxOwned: 1 },
    effects: [{ type: "orgCapacity", value: 2 }, { type: "campaignCapacity", value: 1 }],
    riskModifier: null,
    flavour: "A fully staffed regional office covering the North of England. Essential for any serious northern strategy."
  },
  {
    id: "scottish-hq",
    name: "Scottish HQ",
    category: "Infrastructure & Assets",
    basePrice1997: 72000, baseMonthlyUpkeep1997: 3800,
    caps: { maxOwned: 1 },
    effects: [{ type: "orgCapacity", value: 3 }],
    riskModifier: null,
    flavour: "A dedicated Scottish party headquarters for devolved politics. Vital post-referendum."
  },
  {
    id: "youth-wing-expansion",
    name: "Youth Wing Expansion",
    category: "Infrastructure & Assets",
    basePrice1997: 9000, baseMonthlyUpkeep1997: 1500,
    caps: { maxOwned: 1 },
    effects: [{ type: "orgCapacity", value: 1 }, { type: "fundraisingCapacity", value: 1 }],
    riskModifier: null,
    flavour: "Fund and expand the party's youth wing. Future candidates, future donors, future voters."
  },
  {
    id: "party-think-tank",
    name: "Party Think Tank",
    category: "Infrastructure & Assets",
    basePrice1997: 22000, baseMonthlyUpkeep1997: 2000,
    caps: { maxOwned: 1 },
    effects: [{ type: "policyResearch", value: 3 }],
    riskModifier: null,
    flavour: "An independent but aligned policy institute producing research, papers, and ideological firepower."
  },
  {
    id: "merchandise-warehouse",
    name: "Merchandise Warehouse",
    category: "Infrastructure & Assets",
    basePrice1997: 14000, baseMonthlyUpkeep1997: 1000,
    caps: { maxOwned: 1 },
    effects: [{ type: "fundraisingCapacity", value: 1 }],
    riskModifier: null,
    flavour: "Rosettes, mugs, T-shirts, and ballot boxes. The unglamorous logistics of mass-membership politics."
  },

  // ── D) Frivolous / Optics / Risky ─────────────────────────────────────────
  {
    id: "chairman-rv",
    name: "Chairman's RV (Tour Bus)",
    category: "Frivolous",
    basePrice1997: 42000, baseMonthlyUpkeep1997: 2800,
    caps: { maxOwned: 1 },
    effects: [{ type: "unlock", value: "partyTour" }],
    riskModifier: { partyScandalExposure: 4 },
    flavour: "A luxury motorhome for the Chairman's national tour. Very conspicuous. Very American. Very 1996."
  },
  {
    id: "luxury-conference-venue",
    name: "Luxury Party Conference Venue Upgrade",
    category: "Frivolous",
    basePrice1997: 55000, baseMonthlyUpkeep1997: 0,
    caps: {},
    effects: [{ type: "unlock", value: "nationalBroadcastEvent" }, { type: "partyPolling", value: 1 }],
    riskModifier: { partyScandalExposure: 3 },
    flavour: "Move conference to a premier venue with full broadcast facilities. Big optics — big bill."
  },
];

function partyCurrentPrice(item, priceIndex) {
  return Math.round(item.basePrice1997 * priceIndex);
}
function partyCurrentUpkeep(item, priceIndex) {
  return Math.round(item.baseMonthlyUpkeep1997 * priceIndex);
}

const OFFICE_SIZES = ["Satellite Office", "Regional Office", "HQ", "Campaign War Room"];
const DEPARTMENTS = ["communications", "policy", "campaign", "compliance", "admin", "fundraising", "membership", "research"];

const DEPARTMENT_EFFECTS = {
  communications: "Faster scandal response options",
  policy:         "Reduced bill drafting cooldown",
  campaign:       "Unlocks multi-seat campaigning events",
  compliance:     "Reduces party scandal severity",
  admin:          "General organisational efficiency",
  fundraising:    "Enhanced fundraising capacity",
  membership:     "Improved member recruitment",
  research:       "Enhanced policy research output",
};

// Monthly overhead per staff member (1997 baseline)
const STAFF_COST_1997 = 1500;

// HQ baseline monthly upkeep for the 3 playable parties (mirrors server constant)
const HQ_BASELINE_UPKEEP = {
  Conservative:     12000,
  Labour:           15000,
  "Liberal Democrat": 8000,
};

const MODIFIER_LABELS = {
  orgCapacity:        "🏛️ Org Capacity",
  disciplineCapacity: "🔒 Discipline",
  policyResearch:     "📄 Policy Research",
  rapidRebuttal:      "⚡ Rapid Rebuttal",
  campaignCapacity:   "📣 Campaign",
  scandalDefence:     "🛡️ Scandal Defence",
  partyPolling:       "📊 Polling",
  fundraisingCapacity: "💰 Fundraising",
};

function canManage(data) {
  return canAdminOrMod(data);
}


function avatarFor(name, avatar) {
  if (avatar) return avatar;
  const initial = (name || "?").trim().slice(0, 1).toUpperCase() || "?";
  return `https://dummyimage.com/64x64/1f3b60/ffffff&text=${encodeURIComponent(initial)}`;
}

function normaliseName(v) {
  return String(v || "").trim().toLowerCase();
}

function activeCharactersForParty(data, partyName) {
  const wanted = normaliseName(partyName);
  if (!wanted) return [];

  const pools = [
    ...(Array.isArray(data?.players) ? data.players : []),
    ...(Array.isArray(data?.government?.activeCharacters) ? data.government.activeCharacters : []),
    ...(Array.isArray(data?.opposition?.activeCharacters) ? data.opposition.activeCharacters : []),
    data?.currentCharacter,
    data?.currentPlayer
  ].filter(Boolean);

  const byName = new Map();
  pools.forEach((c) => {
    const name = String(c?.name || "").trim();
    if (!name) return;

    const party = normaliseName(c?.party);
    if (party && party !== wanted) return;
    if (c?.active === false) return;

    const existing = byName.get(name) || { name, avatar: "" };
    if (!existing.avatar && c?.avatar) existing.avatar = String(c.avatar).trim();
    byName.set(name, existing);
  });

  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function ensurePartyData(data) {
  data.party ??= { parties: {}, nextDraftId: 1 };
  data.party.parties ??= {};
  data.party.nextDraftId = Number(data.party.nextDraftId || 1);

  Object.entries(DEFAULT_PARTIES).forEach(([key, value]) => {
    if (!data.party.parties[key]) data.party.parties[key] = structuredClone(value);
    const p = data.party.parties[key];
    p.name ??= value.name;
    p.short ??= value.short;
    p.leader ??= structuredClone(value.leader);
    p.treasury ??= structuredClone(value.treasury);
    p.hqUrl ??= value.hqUrl;
    p.drafts ??= [];
    p.partyShopPurchases ??= [];
  });
}

function accessiblePartyNames(data) {
  const char = getCharacterContext(data);
  const party = char?.party;
  const names = Object.keys(data.party.parties);
  if (canManage(data)) return names;
  return names.includes(party) ? [party] : [];
}

function partyFromState(data, state) {
  return data.party.parties[state.activeParty] || null;
}

function formatMoney(v) {
  return `£${Number(v || 0).toLocaleString("en-GB")}`;
}

function discussUrlForDraft(party, draft) {
  return draft.discussUrl || null;
}

function render(data, state) {
  const root = document.getElementById("party-root");
  if (!root) return;

  ensurePartyData(data);
  const allowed = accessiblePartyNames(data);
  const manager = canManage(data);

  if (!state.activeParty || !data.party.parties[state.activeParty]) {
    state.activeParty = allowed[0] || Object.keys(data.party.parties)[0];
  }

  const party = partyFromState(data, state);
  const char = getCharacterContext(data);
  const canView = manager || (char?.party && char.party === state.activeParty);

  if (!canView) {
    root.innerHTML = `
      <section class="panel">
        <div class="bbc-masthead"><div class="bbc-title">Party</div></div>
        <div class="muted-block">This headquarters is private. You can only access your own party workspace.</div>
      </section>
    `;
    return;
  }

  const drafts = party.drafts.slice().sort((a, b) => Number(b.createdTs || 0) - Number(a.createdTs || 0));

  // DB-backed party leadership data
  const dbParty = state.dbState?.party || null;
  // Party Treasury: prefer DB-authoritative values from dbParty.treasury when available,
  // falling back to in-memory party.treasury (which is synced from DB on init and after saves).
  const dbTreasury = dbParty?.treasury || null;
  const treasuryCash    = Number(dbTreasury?.cash    ?? party.treasury?.cash    ?? 0);
  const treasuryDebt    = Number(dbTreasury?.debt    ?? party.treasury?.debt    ?? 0);
  const treasuryMembers = Number(dbTreasury?.members ?? party.treasury?.members ?? 0);
  const dbLeaderName    = dbParty?.leader_name      || party.leader?.name    || "";
  const dbLeaderAvatar  = dbParty?.leader_avatar    || party.leader?.avatar  || "";
  const dbChairmanName  = dbParty?.chairman_name    || "";
  const dbChairmanAvatar= dbParty?.chairman_avatar  || "";
  const dbChiefWhipName  = dbParty?.chief_whip_name  || "";
  const dbChiefWhipAvatar= dbParty?.chief_whip_avatar || "";

  // Determine if caller is party leader (for leadership assignment)
  const dbLeaderId   = dbParty?.leader_character_id;
  const dbChairmanId = dbParty?.chairman_character_id;
  const sessionCharId = state.dbState?.sessionCharId || "";
  const isPartyLeader  = dbLeaderId   && sessionCharId && String(dbLeaderId)   === String(sessionCharId);
  const isChairman     = dbChairmanId && sessionCharId && String(dbChairmanId) === String(sessionCharId);
  const canAssignLeadership = manager || isPartyLeader;
  const canManageStructure  = manager || isPartyLeader || isChairman;

  // Chief Whip role for whip discipline controls
  const dbChiefWhipId = dbParty?.chief_whip_character_id;
  const isChiefWhip   = !!dbChiefWhipId && !!sessionCharId && String(dbChiefWhipId) === String(sessionCharId);
  const canManageWhip = manager || isPartyLeader || isChiefWhip;

  // Characters for party (for leadership dropdowns)
  const partyCharacters = (state.dbState?.partyCharacters || []);

  root.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">${esc(party.name)} Party HQ</div></div>

    ${manager ? `
      <section class="panel" style="margin-bottom:12px;">
        <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;">
          <div>
            <label class="label" for="party-switch">View/Edit Party</label>
            <select id="party-switch" class="input">
              ${Object.keys(data.party.parties).map((name) => `<option value="${esc(name)}" ${name === state.activeParty ? "selected" : ""}>${esc(name)}</option>`).join("")}
            </select>
          </div>
        </div>
      </section>
    ` : ""}

    <section class="panel" style="margin-bottom:12px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:stretch;">
        <article class="tile" style="min-height:110px;display:flex;flex-direction:column;">
          <h2 style="margin-top:0;">Party Leader</h2>
          <div style="display:flex;gap:10px;align-items:center;flex:1;">
            <img src="${esc(avatarFor(dbLeaderName, dbLeaderAvatar))}" alt="Party leader avatar" width="56" height="56" style="border-radius:999px;object-fit:cover;">
            <div><b>${esc(dbLeaderName || "Vacant")}</b></div>
          </div>
        </article>

        <article class="tile" style="min-height:110px;display:flex;flex-direction:column;">
          <h2 style="margin-top:0;">Party Treasury</h2>
          <div style="flex:1;">
            <div><b>Cash on hand:</b> ${esc(formatMoney(treasuryCash))}</div>
            <div><b>Debt:</b> ${esc(formatMoney(treasuryDebt))}</div>
            <div><b>Members:</b> ${esc(Number(treasuryMembers).toLocaleString("en-GB"))}</div>
            ${(() => {
              const fee = Number(dbParty?.membershipFeeAnnual || dbParty?.membership_fee_annual || 0);
              const members = treasuryMembers;
              const estimate = Math.round(fee * members);
              return `<div style="margin-top:4px;border-top:1px solid #e0e0e0;padding-top:4px;">
                <div><b>Annual membership fee:</b> ${fee > 0 ? esc(formatMoney(fee)) : '<span class="muted">Not set</span>'}</div>
                ${fee > 0 ? `<div class="muted" style="font-size:.88em;">Next January intake estimate: <b>${esc(formatMoney(estimate))}</b> (${Number(members).toLocaleString()} × ${esc(formatMoney(fee))})</div>` : ''}
              </div>`;
            })()}
            ${(manager || isChairman) ? `
              <form id="party-fee-form" style="display:flex;gap:6px;align-items:center;margin-top:6px;">
                <input type="number" id="party-fee-input" class="input" style="width:120px;"
                  placeholder="£ per year"
                  value="${esc(String(Number(dbParty?.membershipFeeAnnual || dbParty?.membership_fee_annual || 0)))}"
                  min="0" step="1">
                <button type="submit" class="btn" style="padding:4px 10px;">Set Fee</button>
              </form>
              ${state.feeMessage ? `<p class="muted" style="margin:2px 0 0;">${esc(state.feeMessage)}</p>` : ""}
            ` : ""}
          </div>
        </article>

        <article class="tile" style="min-height:110px;display:flex;flex-direction:column;">
          <h2 style="margin-top:0;">Party Chairman</h2>
          <div style="display:flex;gap:10px;align-items:center;flex:1;">
            <img src="${esc(avatarFor(dbChairmanName, dbChairmanAvatar))}" alt="Chairman avatar" width="56" height="56" style="border-radius:999px;object-fit:cover;">
            <div><b>${esc(dbChairmanName || "Vacant")}</b></div>
          </div>
        </article>

        <article class="tile" style="min-height:110px;display:flex;flex-direction:column;">
          <h2 style="margin-top:0;">Chief Whip</h2>
          <div style="display:flex;gap:10px;align-items:center;flex:1;">
            <img src="${esc(avatarFor(dbChiefWhipName, dbChiefWhipAvatar))}" alt="Chief Whip avatar" width="56" height="56" style="border-radius:999px;object-fit:cover;">
            <div><b>${esc(dbChiefWhipName || "Vacant")}</b></div>
          </div>
        </article>
      </div>
    </section>

    ${(canAssignLeadership && dbParty) ? `
      <section class="panel" style="margin-bottom:12px;">
        <h2 style="margin-top:0;">Assign Leadership Roles ${isPartyLeader && !manager ? `<span class="muted" style="font-size:.85em;">(Leader only)</span>` : ""}</h2>
        <form id="party-leadership-form" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;align-items:end;">
          <div>
            <label class="label" for="chairman-select">Chairman</label>
            <select id="chairman-select" name="chairman_character_id" class="input">
              <option value="">— Vacant —</option>
              ${partyCharacters.map((c) => `<option value="${esc(c.id)}" ${String(c.id) === String(dbParty?.chairman_character_id || "") ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
            </select>
          </div>
          <div>
            <label class="label" for="chief-whip-select">Chief Whip</label>
            <select id="chief-whip-select" name="chief_whip_character_id" class="input">
              <option value="">— Vacant —</option>
              ${partyCharacters.map((c) => `<option value="${esc(c.id)}" ${String(c.id) === String(dbParty?.chief_whip_character_id || "") ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
            </select>
          </div>
          <button type="submit" class="btn">Save Leadership</button>
        </form>
        ${state.leadershipMessage ? `<p class="muted" style="margin-top:8px;">${esc(state.leadershipMessage)}</p>` : ""}
      </section>
    ` : ""}

    ${canManageWhip ? `
    <section class="panel" style="margin-bottom:12px;" id="whip-section">
      <h2 style="margin-top:0;">Parliamentary Whip Status</h2>
      ${partyCharacters.length ? `
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:.9em;">
            <thead>
              <tr style="border-bottom:2px solid #ccc;">
                <th style="text-align:left;padding:4px 8px;">MP</th>
                <th style="text-align:left;padding:4px 8px;">Status</th>
                ${canManageWhip ? `<th style="text-align:left;padding:4px 8px;">Action</th>` : ""}
              </tr>
            </thead>
            <tbody>
              ${partyCharacters.map((c) => {
                const whipWithdrawn = c.whip_status === "withdrawn";
                return `
                  <tr style="border-bottom:1px solid #eee;">
                    <td style="padding:4px 8px;">${esc(c.display_name ?? c.name)}</td>
                    <td style="padding:4px 8px;">${whipWithdrawn ? "⛔ Withdrawn" : "✅ Has Whip"}</td>
                    ${canManageWhip ? `<td style="padding:4px 8px;">
                      ${whipWithdrawn
                        ? `<button type="button" class="btn" style="padding:2px 8px;font-size:.85em;" data-action="restore-whip" data-id="${esc(String(c.id))}">Restore Whip</button>`
                        : `<button type="button" class="btn" style="padding:2px 8px;font-size:.85em;" data-action="withdraw-whip" data-id="${esc(String(c.id))}">Withdraw Whip</button>`
                      }
                    </td>` : ""}
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
        ${state.whipMessage ? `<p class="muted" style="margin-top:6px;">${esc(state.whipMessage)}</p>` : ""}
        ${(isPartyLeader || manager) && (state.dbState?.whipRequests || []).length ? `
        <div style="margin-top:12px;padding-top:10px;border-top:1px solid #ddd;">
          <h4 style="margin:0 0 8px;">Pending Whip Withdrawal Requests</h4>
          ${(state.dbState.whipRequests).map((r) => `
            <div class="muted-block" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
              <div>
                <b>${esc(r.character_name)}</b>
                <span class="muted"> — requested by ${esc(r.requested_by_name)}</span>
                ${r.note ? `<span class="muted"> — "${esc(r.note)}"</span>` : ""}
              </div>
              <div style="display:flex;gap:6px;">
                <button type="button" class="btn" data-action="approve-whip-request" data-request-id="${esc(r.id)}" data-party-slug="${esc(state.dbState.party?.slug || "")}">Approve</button>
                <button type="button" class="btn danger" data-action="deny-whip-request" data-request-id="${esc(r.id)}" data-party-slug="${esc(state.dbState.party?.slug || "")}">Deny</button>
              </div>
            </div>
          `).join("")}
        </div>` : ""}
      ` : `<div class="muted-block">No party members found.</div>`}
    </section>
    ` : ""}

    ${(canAssignLeadership || manager) ? `
    <section class="panel" style="margin-bottom:12px;" id="expulsion-section">
      <h2 style="margin-top:0;">Expulsion Requests</h2>
      ${(canAssignLeadership && partyCharacters.length) ? `
        <details style="margin-bottom:12px;">
          <summary style="cursor:pointer;font-weight:600;">Request Expulsion</summary>
          <form id="expulsion-request-form" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin-top:8px;align-items:end;">
            <div>
              <label class="label" for="expulsion-member-select">Member</label>
              <select id="expulsion-member-select" name="character_id" class="input" required>
                <option value="">— Select member —</option>
                ${partyCharacters.filter((c) => c.id !== sessionCharId).map((c) => `<option value="${esc(String(c.id))}">${esc(c.name)}</option>`).join("")}
              </select>
            </div>
            <div>
              <label class="label" for="expulsion-reason">Reason (optional)</label>
              <input id="expulsion-reason" name="reason" class="input" placeholder="e.g. Breach of party whip">
            </div>
            <button type="submit" class="btn">Request Expulsion</button>
          </form>
        </details>
      ` : ""}
      ${manager ? `
        <h3 style="margin:4px 0 8px;">Pending Expulsion Requests</h3>
        ${(state.expulsions || []).length ? (state.expulsions || []).map((ex) => `
          <article class="tile" style="margin-bottom:6px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;">
            <div>
              <b>${esc(ex.character_name || ex.characterName || "Unknown MP")}</b>
              <span class="muted" style="font-size:.85em;"> — ${esc(ex.party || "")}</span>
              ${ex.reason ? `<div class="muted" style="font-size:.85em;">Reason: ${esc(ex.reason)}</div>` : ""}
              <div class="muted" style="font-size:.82em;">Requested by ${esc(ex.requested_by_name || ex.requestedByName || "—")}</div>
            </div>
            <div style="display:flex;gap:6px;">
              <button type="button" class="btn" data-action="approve-expulsion" data-id="${esc(String(ex.id))}">Approve</button>
              <button type="button" class="btn" data-action="deny-expulsion" data-id="${esc(String(ex.id))}">Deny</button>
            </div>
          </article>
        `).join("") : `<div class="muted-block">No pending expulsion requests.</div>`}
      ` : ""}
      ${state.expulsionMessage ? `<p class="muted" style="margin-top:6px;">${esc(state.expulsionMessage)}</p>` : ""}
    </section>
    ` : ""}

    <section class="panel" style="margin-bottom:12px;" id="elections-section">
      <h2 style="margin-top:0;">Party Leader Election</h2>
      ${(() => {
        const election = state.currentElection;
        if (!election) {
          return `
            <div class="muted-block">No active leadership election.</div>
            ${manager ? `<button type="button" class="btn" id="start-election-btn" style="margin-top:8px;">Start Election</button>` : ""}
          `;
        }
        const phase = election.status || "nominations";
        const nominations = election.nominations || [];
        const votes = election.vote_counts || election.votes || {};
        return `
          <div class="muted" style="margin-bottom:8px;">Phase: <b>${esc(phase)}</b></div>
          ${nominations.length ? `
            <div style="margin-bottom:8px;">
              <b>Candidates:</b>
              <ul style="margin:4px 0 0 0;padding-left:1.2em;">
                ${nominations.map((n) => `
                  <li>${esc(n.display_name ?? n.character_name ?? n.name ?? "—")}
                    ${votes[n.character_id || n.id] != null ? ` — <b>${votes[n.character_id || n.id]} vote(s)</b>` : ""}
                    ${(phase === "voting" || phase === "runoff") ? `
                      <button type="button" class="btn" style="margin-left:8px;padding:1px 7px;font-size:.82em;" data-action="vote-election" data-nominee-id="${esc(String(n.character_id || n.id))}" data-election-id="${esc(String(election.id))}">Vote</button>
                    ` : ""}
                  </li>
                `).join("")}
              </ul>
            </div>
          ` : `<div class="muted-block" style="margin-bottom:8px;">No nominations yet.</div>`}
          ${phase === "nominations" ? `
            <form id="nominate-form" style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-bottom:8px;">
              <div>
                <label class="label" for="nominate-select">Nominate Candidate</label>
                <select id="nominate-select" name="character_id" class="input">
                  <option value="">— Select candidate —</option>
                  ${partyCharacters.map((c) => `<option value="${esc(String(c.id))}">${esc(c.name)}</option>`).join("")}
                </select>
              </div>
              <button type="submit" class="btn">Nominate</button>
            </form>
          ` : ""}
          ${manager ? `
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
              ${phase === "nominations" ? `<button type="button" class="btn" id="open-voting-btn" data-election-id="${esc(String(election.id))}">Open Voting</button>` : ""}
              ${(phase === "voting" || phase === "runoff") ? `<button type="button" class="btn" id="close-election-btn" data-election-id="${esc(String(election.id))}">Close Election</button>` : ""}
              ${phase === "closed" ? `<button type="button" class="btn" id="runoff-btn" data-election-id="${esc(String(election.id))}">Initiate Runoff</button>` : ""}
            </div>
          ` : ""}
        `;
      })()}
      ${state.electionMessage ? `<p class="muted" style="margin-top:6px;">${esc(state.electionMessage)}</p>` : ""}
    </section>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Enter Headquarters</h2>
      <p>Open your private party Discourse headquarters for internal strategy and debate.</p>
      ${partyHqUrl(party.name) ? `<a class="btn" href="${esc(partyHqUrl(party.name))}" target="_blank" rel="noopener">Enter Headquarters</a>` : `<span class="muted">Forum link not configured.</span>`}
    </section>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Draft a Bill (Party Workspace)</h2>
      <p class="muted">Once submitted, drafts can only be edited by their author. There are no amendments or divisions in party drafting.</p>
      <form id="party-draft-form">
        ${renderDraftingBuilder("party-draft", state.editingDraftId ? party.drafts.find((d) => d.id === state.editingDraftId) : null)}

        <button type="submit" class="btn">${state.editingDraftId ? "Update Draft" : "Save Draft"}</button>
      </form>
    </section>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Party Drafts</h2>
      ${drafts.length ? drafts.map((d) => `
        <article class="tile" style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;">
            <div>
              <b>${esc(d.ref || `Draft ${d.id}`)}:</b> ${esc(d.title)}
              <div class="muted">By ${esc(d.authorName)}${affiliationBadge({ party: state.party }) ? ` ${affiliationBadge({ party: state.party })}` : ""} • ${esc(d.createdAt)}</div>
            </div>
            <button type="button" class="btn" data-action="open-draft" data-id="${esc(String(d.id))}">${state.openDraftId === d.id ? "Close" : "Open"}</button>
          </div>
          ${state.openDraftId === d.id ? `
            <div style="margin-top:10px;">
              <p><b>A Bill to make provision for:</b> ${esc(d.purpose)}</p>
              <div class="muted-block" style="white-space:pre-wrap;">${esc(d.body)}</div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
                ${discussUrlForDraft(party, d) ? `<a class="btn" href="${esc(discussUrlForDraft(party, d))}" target="_blank" rel="noopener">Discuss</a>` : ""}
                ${(d.authorId === (char?.name || "") || manager) ? `<button type="button" class="btn" data-action="edit-draft" data-id="${esc(String(d.id))}">Edit</button>` : ""}
                ${manager ? `<button type="button" class="btn" data-action="delete-draft" data-id="${esc(String(d.id))}">Delete</button>` : ""}
              </div>
            </div>
          ` : ""}
        </article>
      `).join("") : `<div class="muted-block">No party drafts yet.</div>`}
    </section>

    ${manager ? `
      <section class="panel">
        <h2 style="margin-top:0;">Party Control Panel</h2>
        <form id="party-control-form">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;">
            <div>
              <label class="label" for="party-leader-select">Leader (active character)</label>
              <select id="party-leader-select" name="leaderId" class="input">
                <option value="">— No leader —</option>
                ${(state.dbState?.partyCharacters?.length
                    ? state.dbState.partyCharacters.slice().sort((a, b) => a.name.localeCompare(b.name))
                    : activeCharactersForParty(data, party.name)
                  ).map((c) => `<option value="${esc(c.id)}" ${String(c.id) === String(dbLeaderId || "") ? "selected" : ""}>${esc(c.name)}</option>`).join("") || `<option value="">No active character available</option>`}
              </select>
            </div>
            <div>
              <label class="label" for="party-cash">Treasury Cash (£)</label>
              <input id="party-cash" name="cash" type="number" class="input" value="${esc(String(treasuryCash))}">
            </div>
            <div>
              <label class="label" for="party-debt">Debt (£)</label>
              <input id="party-debt" name="debt" type="number" class="input" value="${esc(String(treasuryDebt))}">
            </div>
            <div>
              <label class="label" for="party-members">Members</label>
              <input id="party-members" name="members" type="number" class="input" value="${esc(String(treasuryMembers))}">
            </div>
          </div>
          <button type="submit" class="btn">Save Party Settings</button>
          ${state.controlMessage ? `<p class="muted" style="margin-top:8px;">${esc(state.controlMessage)}</p>` : ""}
        </form>
      </section>
    ` : ""}

    ${canManageStructure ? `
    <section class="panel" style="margin-top:12px;">
      <h2 style="margin-top:0;">Party Shop <span class="muted" style="font-size:.8em;">(Chairman · Leader · Admin/Mod)</span></h2>
      <p class="muted">
        Monthly upkeep is deducted from party treasury each month.
        ${(party.partyShopPurchases || []).some((p) => (p.effects||[]).some((e) => e.type==="unlock" && e.value==="partyTour")) || state.dbState?.partyStructure?.unlocks?.partyTour ? `<span style="color:#1a6a1a;">✅ Party Tour active</span>` : ""}
      </p>
      ${state.partyShopMessage ? `<p class="muted" id="party-shop-msg">${esc(state.partyShopMessage)}</p>` : ""}
      ${Object.entries(
        PARTY_SHOP_ITEMS.reduce((groups, item) => {
          (groups[item.category] = groups[item.category] || []).push(item);
          return groups;
        }, {})
      ).map(([cat, items]) => {
        const pi = state.priceIndex || 1;
        return `
          <details style="margin-bottom:8px;">
            <summary style="cursor:pointer;font-weight:600;font-size:1em;margin-bottom:4px;">${esc(cat)}</summary>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px;margin-top:6px;">
              ${items.map((item) => {
                const price = partyCurrentPrice(item, pi);
                const upkeep = partyCurrentUpkeep(item, pi);
                const purchases = party.partyShopPurchases || [];
                const ownedCount = purchases.filter((p) => p.itemId === item.id).length;
                const maxOwned = item.caps?.maxOwned;
                const atCap = maxOwned != null && ownedCount >= maxOwned;
                const treasury = treasuryCash;
                const canAfford = treasury >= price;
                const effectTags = item.effects.map((e) => {
                  if (e.type === "orgCapacity")        return `🏛️ org capacity +${e.value}`;
                  if (e.type === "disciplineCapacity") return `🔒 discipline +${e.value}`;
                  if (e.type === "campaignCapacity")   return `📣 campaign +${e.value}`;
                  if (e.type === "policyResearch")     return `📄 research +${e.value}`;
                  if (e.type === "rapidRebuttal")      return `⚡ rebuttal +${e.value}`;
                  if (e.type === "scandalDefence")     return `🛡️ scandal defence +${e.value}`;
                  if (e.type === "fundraisingCapacity") return `💰 fundraising +${e.value}`;
                  if (e.type === "partyPolling")       return `📊 polling +${e.value}`;
                  if (e.type === "unlock")             return `🔓 unlock: ${e.value}`;
                  return e.type;
                }).join(" · ");
                const riskTag = item.riskModifier?.partyScandalExposure
                  ? `⚠️ +${item.riskModifier.partyScandalExposure} party scandal risk`
                  : "";
                const capNote = maxOwned != null ? `${ownedCount}/${maxOwned}` : (ownedCount > 0 ? `×${ownedCount}` : "");
                return `
                  <article class="tile card-flex">
                    <div>
                      <div style="display:flex;justify-content:space-between;gap:4px;flex-wrap:wrap;align-items:baseline;">
                        <b>${esc(item.name)}</b>
                        ${capNote ? `<span class="muted" style="font-size:.8em;">${esc(capNote)}</span>` : ""}
                      </div>
                      <div class="muted" style="margin-top:3px;font-size:.88em;line-height:1.4;">${esc(item.flavour)}</div>
                      <div style="margin-top:4px;font-size:.82em;display:flex;gap:6px;flex-wrap:wrap;">
                        ${effectTags ? `<span style="color:#1a6a1a;">${esc(effectTags)}</span>` : ""}
                        ${riskTag ? `<span style="color:#b00;">${esc(riskTag)}</span>` : ""}
                      </div>
                    </div>
                    <div class="tile-bottom" style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px;">
                      <div>
                        <b>${formatMoney(price)}</b>
                        ${upkeep > 0 ? `<div class="muted" style="font-size:.82em;">+ ${formatMoney(upkeep)}/month</div>` : ""}
                      </div>
                      <button type="button" class="btn" data-action="party-buy-item" data-item-id="${esc(item.id)}"
                        ${!canAfford ? `disabled title="Insufficient funds"` : ""}
                        ${atCap ? `disabled title="Maximum owned"` : ""}
                      >Buy</button>
                    </div>
                  </article>
                `;
              }).join("")}
            </div>
          </details>
        `;
      }).join("")}

      ${(party.partyShopPurchases || []).length ? `
        <h3 style="margin:8px 0 4px;">Party Purchases</h3>
        <div class="muted" style="margin-bottom:6px;">
          Total monthly upkeep: <b>${formatMoney((party.partyShopPurchases || []).reduce((s, p) => s + Number(p.monthlyUpkeep || 0), 0))}</b>
        </div>
        ${(party.partyShopPurchases || []).map((p, idx) => `
          <article class="tile" style="margin-bottom:6px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;">
            <div>
              <b>${esc(p.name || p.itemName)}</b>
              <div class="muted" style="font-size:.85em;">Purchased ${esc(typeof p.purchasedAt === "string" ? p.purchasedAt : (p.purchasedAt ? new Date(p.purchasedAt).toLocaleString("en-GB") : "-"))} — ${formatMoney(p.price)}${p.monthlyUpkeep > 0 ? ` · ${formatMoney(p.monthlyUpkeep)}/month` : ""}</div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              ${canManageStructure && Number(p.price) > 0 ? `<button type="button" class="btn" data-action="party-sell-purchase" data-id="${esc(String(p.id || ""))}">Sell (50% refund)</button>` : ""}
              ${canManageStructure && Number(p.price) === 0 ? `<button type="button" class="btn" data-action="party-dismiss-purchase" data-id="${esc(String(p.id || ""))}">Dismiss</button>` : ""}
              ${manager ? `<button type="button" class="btn" data-action="party-remove-purchase" data-id="${esc(String(p.id || ""))}" data-idx="${idx}">Remove</button>` : ""}
            </div>
          </article>
        `).join("")}
      ` : ""}
    </section>

    <section class="panel" style="margin-top:12px;" id="national-org-panel">
      <h2 style="margin-top:0;">National Organisation <span class="muted" style="font-size:.8em;">(Chairman · Leader · Admin/Mod)</span></h2>
      ${state.dbState?.partyStructure ? (() => {
        const s = state.dbState.partyStructure;
        const depts = s.departments || {};
        const offices = s.nationalOffices || [];
        const totalDeptStaff = Object.values(depts).reduce((sum, v) => sum + v, 0);
        const totalOfficeStaff = offices.reduce((sum, o) => sum + (o.staffCount || 0), 0);
        const totalStaff = totalDeptStaff + totalOfficeStaff;
        const overhead = totalStaff * STAFF_COST_1997 * (state.priceIndex || 1);
        const unlocks = s.unlocks || {};

        // Compute active modifiers from shop purchases
        const purchases = party.partyShopPurchases || [];
        const modifiers = {
          orgCapacity: 0, disciplineCapacity: 0, policyResearch: 0,
          rapidRebuttal: 0, campaignCapacity: 0, scandalDefence: 0,
          partyPolling: 0, fundraisingCapacity: 0,
        };
        const activeUnlockSet = { ...unlocks };
        for (const p of purchases) {
          for (const e of (p.effects || [])) {
            if (e.type in modifiers) modifiers[e.type] += Number(e.value || 0);
            if (e.type === "unlock") activeUnlockSet[e.value] = true;
          }
        }

        const hqBaseline = Number(HQ_BASELINE_UPKEEP[state.activeParty] || 0);
        const shopMonthlyUpkeep = purchases.reduce((s, p) => s + Number(p.monthlyUpkeep || 0), 0);

        return `
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-bottom:12px;">
            <article class="tile">
              <h3 style="margin-top:0;">Overview</h3>
              <div class="muted" style="line-height:1.8;">
                <div><b>Total Staff:</b> ${totalStaff}</div>
                <div><b>Staff Overhead:</b> ${formatMoney(Math.round(overhead))}/month</div>
                ${hqBaseline > 0 ? `<div><b>HQ Baseline Upkeep:</b> ${formatMoney(hqBaseline)}/month</div>` : ""}
                ${shopMonthlyUpkeep > 0 ? `<div><b>Shop Upkeep:</b> ${formatMoney(shopMonthlyUpkeep)}/month</div>` : ""}
                <div><b>Total Monthly:</b> ${formatMoney(Math.round(overhead) + hqBaseline + shopMonthlyUpkeep)}</div>
                <div><b>Party Treasury:</b> ${formatMoney(treasuryCash)}</div>
                ${state.dbState?.treasuryOverspend ? `<div style="color:#c00;">⚠️ Treasury in deficit — risk of emergency fundraising scandal</div>` : ""}
              </div>
            </article>
            <article class="tile">
              <h3 style="margin-top:0;">Active Unlocks</h3>
              <div class="muted" style="font-size:.9em;line-height:1.8;">
                ${activeUnlockSet.partyTour ? "<div>✅ Party Tour</div>" : ""}
                ${activeUnlockSet.nationalBroadcastEvent ? "<div>✅ National Broadcast Event</div>" : ""}
                ${!activeUnlockSet.partyTour && !activeUnlockSet.nationalBroadcastEvent ? "<div>No special unlocks active.</div>" : ""}
              </div>
            </article>
            <article class="tile">
              <h3 style="margin-top:0;">Active Modifiers</h3>
              <div style="font-size:.9em;line-height:1.8;">
                ${Object.entries(modifiers).map(([k, v]) => v > 0
                  ? `<div>${esc(MODIFIER_LABELS[k] || k)}: <b>+${v}</b></div>`
                  : ""
                ).join("") || '<div class="muted">No modifiers active.</div>'}
              </div>
            </article>
          </div>

          <h3>Department Staff</h3>
          <form id="party-structure-form">
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-bottom:12px;">
              ${DEPARTMENTS.map((dept) => `
                <div>
                  <label class="label" for="dept-${esc(dept)}" title="${esc(DEPARTMENT_EFFECTS[dept] || "")}">
                    ${esc(dept.charAt(0).toUpperCase() + dept.slice(1))}
                    <span class="muted" style="font-size:.8em;display:block;">${esc(DEPARTMENT_EFFECTS[dept] || "")}</span>
                  </label>
                  <input id="dept-${esc(dept)}" class="input" type="number" min="0" max="200" name="dept_${esc(dept)}" value="${esc(String(depts[dept] || 0))}">
                </div>
              `).join("")}
            </div>

            <h3>Regional Offices</h3>
            <div id="offices-list" style="margin-bottom:10px;">
              ${offices.map((o, i) => `
                <div style="display:grid;grid-template-columns:1fr 1fr auto auto;gap:8px;align-items:end;margin-bottom:6px;">
                  <div>
                    <label class="label">Region</label>
                    <input class="input" name="office_region_${i}" value="${esc(o.region || "")}" placeholder="e.g. North West">
                  </div>
                  <div>
                    <label class="label">Type</label>
                    <select class="input" name="office_size_${i}">
                      ${OFFICE_SIZES.map((sz) => `<option value="${esc(sz)}" ${sz === o.size ? "selected" : ""}>${esc(sz)}</option>`).join("")}
                    </select>
                  </div>
                  <div>
                    <label class="label">Staff</label>
                    <input class="input" type="number" min="0" max="500" name="office_staff_${i}" value="${esc(String(o.staffCount || 0))}">
                  </div>
                  <button type="button" class="btn" data-action="remove-office" data-idx="${i}" style="margin-top:22px;">Remove</button>
                </div>
              `).join("")}
            </div>
            <input type="hidden" name="office_count" value="${offices.length}">
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
              <button type="button" class="btn" id="add-office-btn">+ Add Regional Office</button>
            </div>
            <p class="muted" style="font-size:.85em;">
              Staff cost: ~${formatMoney(STAFF_COST_1997)}/staff/month (1997 baseline × price index).
              Total estimated overhead: <b>${formatMoney(Math.round(overhead))}</b>/month.
            </p>
            <button type="submit" class="btn primary">Save Organisation Structure</button>
          </form>
          ${state.structureMessage ? `<p class="muted" style="margin-top:8px;">${esc(state.structureMessage)}</p>` : ""}
        `;
      })() : `<div class="muted-block">Loading organisation data…</div>`}
    </section>

    <section class="panel" style="margin-top:12px;">
      <h2 style="margin-top:0;">Party Income Ledger <span class="muted" style="font-size:.8em;">(Chairman · Leader · Admin/Mod)</span></h2>
      ${manager ? `
        <details style="margin-bottom:12px;">
          <summary style="cursor:pointer;font-weight:600;">Add Donation</summary>
          <form id="party-donation-form" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-top:8px;align-items:end;">
            <div>
              <label class="label" for="donation-from">From (name/organisation)</label>
              <input id="donation-from" name="fromName" class="input" placeholder="e.g. Major Donor Ltd" required>
            </div>
            <div>
              <label class="label" for="donation-amount">Amount (£)</label>
              <input id="donation-amount" name="amount" type="number" min="1" step="1" class="input" placeholder="5000" required>
            </div>
            <div>
              <label class="label" for="donation-note">Note (optional)</label>
              <input id="donation-note" name="note" class="input" placeholder="e.g. General donation">
            </div>
            <button type="submit" class="btn">Add Donation</button>
          </form>
          ${state.donationMessage ? `<p class="muted" style="margin-top:6px;">${esc(state.donationMessage)}</p>` : ""}
        </details>
      ` : ""}
      ${(state.ledger || []).length ? `
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:.9em;">
            <thead>
              <tr style="border-bottom:2px solid #ccc;">
                <th style="text-align:left;padding:4px 8px;">Type</th>
                <th style="text-align:left;padding:4px 8px;">From</th>
                <th style="text-align:right;padding:4px 8px;">Amount</th>
                <th style="text-align:left;padding:4px 8px;">Note</th>
                <th style="text-align:left;padding:4px 8px;">Sim Date</th>
                <th style="text-align:left;padding:4px 8px;">Real Date</th>
              </tr>
            </thead>
            <tbody>
              ${(state.ledger || []).map((d) => {
                const typeLabel = d.sourceType === "fundraising" ? "Fundraising"
                  : d.sourceType === "membership" ? "Membership"
                  : "Donation";
                const typeCls = d.sourceType === "fundraising" ? "color:#7a4a00;"
                  : d.sourceType === "membership" ? "color:#1a1a8a;"
                  : "";
                return `
                <tr style="border-bottom:1px solid #eee;">
                  <td style="padding:4px 8px;white-space:nowrap;${typeCls}"><b>${esc(typeLabel)}</b></td>
                  <td style="padding:4px 8px;">${esc(d.fromName)}</td>
                  <td style="padding:4px 8px;text-align:right;color:#1a6a1a;"><b>${esc(formatMoney(d.amount))}</b></td>
                  <td style="padding:4px 8px;" class="muted">${esc(d.note || "")}</td>
                  <td style="padding:4px 8px;" class="muted">${d.simMonth ? `${esc(String(d.simMonth))}/${esc(String(d.simYear))}` : "—"}</td>
                  <td style="padding:4px 8px;" class="muted">${esc(typeof d.createdAt === "string" ? new Date(d.createdAt).toLocaleString("en-GB") : "—")}</td>
                </tr>
              `;}).join("")}
            </tbody>
          </table>
        </div>
      ` : `<div class="muted-block">No income entries yet.</div>`}
    </section>
    ` : ""}

    ${state.factions.length > 0 ? `
    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Factions</h2>
      <p class="muted" style="margin-top:0;">Factions represent internal groups within the party.<br>Party climate is affected by how much aligned support and hostile pressure exists across factions.</p>
      <div class="muted" style="font-size:.88em;margin-bottom:8px;">Total Seats: <b>${Math.round(Number(state.factionSeatTotal ?? 0))}</b> · Allocated MPs: <b>${Math.round(Number(state.factionAllocatedMPs ?? 0))}</b> · Remaining / Unallocated MPs: <b>${Math.round(Number(state.factionRemainingMPs ?? 0))}</b></div>
      ${(() => {
        const viewerRole = state.factionViewerRole || "member";
        const showDerivedStats = viewerRole === "staff" || viewerRole === "leader" || viewerRole === "chairman";
        const showNpcSlots = viewerRole === "staff" || viewerRole === "leader" || viewerRole === "chairman";
        const showNpcCol = state.factions.some((f) => Number(f.memberNpcCountActive ?? 0) > 0);
        return `
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:.88em;">
          <thead>
            <tr style="border-bottom:2px solid #ccc;">
              <th style="text-align:left;padding:6px;">Faction</th>
              <th style="text-align:left;padding:6px;">Alignment</th>
              <th style="text-align:left;padding:6px;">Momentum</th>
              ${showDerivedStats ? `
              <th style="text-align:right;padding:6px;">Allocated MPs</th>
              <th style="text-align:right;padding:6px;">Internal power</th>
              <th style="text-align:right;padding:6px;">Cohesion</th>
              <th style="text-align:right;padding:6px;">Leadership pressure</th>
              ` : ""}
              ${!showDerivedStats ? `<th style="text-align:right;padding:6px;">Allocated MPs</th>` : ""}
              <th style="text-align:right;padding:6px;">Members (active characters)</th>
              ${showNpcSlots ? `<th style="text-align:right;padding:6px;" title="Allocated MPs minus active MP members">NPC slots</th>` : ""}
              ${showNpcCol ? `<th style="text-align:right;padding:6px;">NPCs (active)</th>` : ""}
            </tr>
          </thead>
          <tbody>
            ${state.factions.map((f) => `
              <tr style="border-bottom:1px solid #eee;">
                <td style="padding:6px;white-space:nowrap;"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${esc(f.colour || "#888")};margin-right:6px;"></span><b>${esc(f.name)}</b></td>
                <td style="padding:6px;text-transform:capitalize;">${esc(String(f.leadershipAlignment || "neutral"))}</td>
                <td style="padding:6px;text-transform:capitalize;">${esc(String(f.momentum || "stable"))}</td>
                ${showDerivedStats ? `
                <td style="padding:6px;text-align:right;">${Math.round(Number(f.mpCount ?? 0))}</td>
                <td style="padding:6px;text-align:right;">${Math.round(Number(f.internalPower ?? 0))}</td>
                <td style="padding:6px;text-align:right;">${Math.round(Number(f.cohesion ?? 0))}</td>
                <td style="padding:6px;text-align:right;">${Math.round(Number(f.leadershipPressure ?? 0))}</td>
                ` : `<td style="padding:6px;text-align:right;">${Math.round(Number(f.mpCount ?? 0))}</td>`}
                <td style="padding:6px;text-align:right;">${Math.round(Number(f.memberCharacterCountActive ?? 0))}</td>
                ${showNpcSlots ? `<td style="padding:6px;text-align:right;">${Math.round(Number(f.npcSlots ?? 0))}</td>` : ""}
                ${showNpcCol ? `<td style="padding:6px;text-align:right;">${Math.round(Number(f.memberNpcCountActive ?? 0))}</td>` : ""}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>`;
      })()}
      <p class="muted" style="font-size:.82em;margin-top:8px;">Allocated MPs are staff-managed to model the parliamentary party. Members are characters currently assigned to the faction. Joining a faction does not add MPs - it changes who occupies existing allocated MP slots.</p>
    </section>
    ` : ""}

    ${(String(data?.currentCharacter?.party || "") === String(state.activeParty || "") && state.factions.length > 0) ? `
    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Your Faction</h2>
      <a class="btn" href="personal.html">Manage your faction on your Personal page</a>
      <p class="muted" style="margin-top:8px;">Switching is limited to once per sim year and is blocked for Leader/Chairman/Whips. MPs can only join factions with available MP slots.</p>
      ${state.factionSwitchMessage ? `<p class="muted" style="margin-top:6px;">${esc(state.factionSwitchMessage)}</p>` : ""}
    </section>
    ` : ""}
        ${state.factionClimate ? (() => {
      const c = state.factionClimate;
      const viewerRole = state.factionViewerRole || "member";
      const isStaffOrLeader = viewerRole === "staff" || viewerRole === "leader" || viewerRole === "chairman";
      const isWhipOrAbove = viewerRole === "staff" || viewerRole === "leader" || viewerRole === "chairman" || viewerRole === "whip";
      const CLIMATE_COLOURS = { unified: "#2e7d32", stable: "#1565c0", tense: "#e65100", fractious: "#b71c1c" };
      const climateColour = CLIMATE_COLOURS[c.climateLabel] || "#555";
      const scoreBarWidth = Math.round(((c.climateScore + 100) / 200) * 100);
      const debug = c?.debug || null;
      const allocByArena = debug?.allocationTotalsByFactionByArena || {};
      const warn = [];
      if (viewerRole === "staff" && debug) {
        const localsTotal = Number(debug?.computed?.locals_total || 0);
        const localsAllocated = Object.values(allocByArena?.locals_uk || {}).reduce((s, v) => s + Number(v || 0), 0);
        if (localsTotal > 0 && localsAllocated !== localsTotal) warn.push(`Locals allocations incomplete: allocated ${localsAllocated} / total ${localsTotal}.`);
        const lordsTotal = Number(debug?.totalsByPartyByArena?.lords?.[state.activeParty] || 0);
        const lordsAllocated = Object.values(allocByArena?.lords || {}).reduce((s, v) => s + Number(v || 0), 0);
        if (lordsTotal > 0 && lordsAllocated !== lordsTotal) warn.push(`Lords allocations incomplete: allocated ${lordsAllocated} / total ${lordsTotal}.`);
        const euroTotal = Number(debug?.totalsByPartyByArena?.europarl?.[state.activeParty] || 0);
        const euroAllocated = Object.values(allocByArena?.europarl || {}).reduce((s, v) => s + Number(v || 0), 0);
        if (euroTotal > 0 && euroAllocated !== euroTotal) warn.push(`Europarl allocations incomplete: allocated ${euroAllocated} / total ${euroTotal}.`);
        const demTotal = Number(debug?.computed?.dem_total || 0);
        const demAllocated = Object.values(allocByArena?.dem_uk || {}).reduce((s, v) => s + Number(v || 0), 0);
        if (demTotal > 0 && demAllocated !== demTotal) warn.push(`DEM allocations incomplete: allocated ${demAllocated} / total ${demTotal}.`);
      }
      return `
    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Internal Party Climate</h2>
      <p class="muted" style="margin-top:0;">This reflects internal alignment vs opposition — it's not just who holds the top jobs.</p>
      ${viewerRole === "staff" && Number(state.factionPendingFreezeCount ?? 0) > 0 ? `
      <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:4px;padding:8px 12px;margin-bottom:10px;font-size:.88em;">
        <b>&#9888; Pending freeze:</b> ${state.factionPendingFreezeCount} faction(s) have metadata changes not yet applied to derived stats (internal power, cohesion, leadership pressure). Use <b>Control Panel &rarr; Factions &rarr; Trigger Freeze</b> to publish updated values.
      </div>
      ` : ""}
      ${viewerRole === "staff" && warn.length ? `
      <div style="background:#ffe9e9;border:1px solid #d33;border-radius:4px;padding:8px 12px;margin-bottom:10px;font-size:.86em;">
        <b>IPC allocation warnings:</b>
        <ul style="margin:6px 0 0 18px;">${warn.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
      </div>
      ` : ""}
      ${viewerRole !== "staff" && state.factionLastFreezeAt ? `
      <p class="muted" style="font-size:.84em;margin-top:0;margin-bottom:10px;">&#128336; Faction stats are updated every Sunday. Last updated: <b>${new Date(state.factionLastFreezeAt).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</b>.</p>
      ` : ""}
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px;">
        <span style="font-size:1.2em;font-weight:700;color:${climateColour};">Climate: ${esc(c.climateLabel.charAt(0).toUpperCase() + c.climateLabel.slice(1))}</span>
        ${isWhipOrAbove ? `<span class="muted" style="font-size:.85em;">Climate score: ${c.climateScore > 0 ? "+" : ""}${Math.round(c.climateScore)}</span>` : ""}
      </div>
      <div style="background:var(--bg-alt,#f0f0f0);border-radius:4px;height:10px;margin-bottom:10px;position:relative;overflow:hidden;">
        <div style="position:absolute;left:0;top:0;height:100%;width:${scoreBarWidth}%;background:${climateColour};border-radius:4px;transition:width .3s;"></div>
        <div style="position:absolute;left:50%;top:0;height:100%;width:1px;background:#999;"></div>
      </div>
      ${isWhipOrAbove ? `
      <div style="display:flex;gap:20px;flex-wrap:wrap;font-size:.88em;">
        <div>
          <span class="muted">Aligned support</span><br>
          <b>${Math.round(c.alignedStrength)}</b>
        </div>
        <div>
          <span class="muted">Hostile pressure</span><br>
          <b>${Math.round(c.hostilePressure)}</b>
        </div>
        ${isStaffOrLeader ? `
        <div>
          <span class="muted">Capital resilience bonus</span><br>
          <b>+${c.capitalResilienceBonus.toFixed(1)}</b>
        </div>
        <div>
          <span class="muted">Party pressure modifier</span><br>
          <b>+${c.partyPressureModifier.toFixed(1)}</b>
        </div>
        ` : ""}
      </div>
      ` : `<p class="muted" style="font-size:.88em;">Detailed climate figures are visible to party whips and leadership.</p>`}
      ${isStaffOrLeader ? (c.dominance ? (() => {
        const d = c.dominance;
        const fmtPct = (v) => `${(Number(v || 0) * 100).toFixed(1)}%`;
        const domFaction = d.components?.commons?.dominantFaction;
        return `
          <hr style="margin:12px 0;border:0;border-top:1px solid #ddd;">
          <h3 style="margin:0 0 8px;">Dominance stabiliser breakdown</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;font-size:.86em;">
            <div class="tile" style="padding:8px;">
              <b>Commons (MPs)</b><br>
              Total: ${Math.round(Number(d.components?.commons?.total || 0))}<br>
              Share: ${fmtPct(d.components?.commons?.share)}<br>
              Dominant: ${domFaction ? esc(`${domFaction.name} (${domFaction.leadershipAlignment})`) : "n/a"}
            </div>
            <div class="tile" style="padding:8px;">
              <b>Lords + MEPs</b><br>
              Total: ${Math.round(Number(d.components?.bodies?.total || 0))}<br>
              Share: ${fmtPct(d.components?.bodies?.share)}<br>
              Arenas: ${Math.round(Number((d.components?.bodies?.arenasIncluded || []).length))}
            </div>
            <div class="tile" style="padding:8px;">
              <b>Councillors (UK-wide)</b><br>
              Total: ${Math.round(Number(d.components?.locals?.total || 0))}<br>
              Share: ${fmtPct(d.components?.locals?.share)}
            </div>
            <div class="tile" style="padding:8px;">
              <b>Directly elected mayors (UK-wide)</b><br>
              Total: ${Math.round(Number(d.components?.dem?.total || 0))}<br>
              Share: ${fmtPct(d.components?.dem?.share)}
            </div>
          </div>
          <div style="margin-top:8px;font-size:.84em;" class="muted">
            Active weights — Commons ${d.weights?.active?.commons ?? 0}, Lords + MEPs ${d.weights?.active?.bodies ?? 0}, Locals ${d.weights?.active?.locals ?? 0}, Directly elected mayors (UK-wide) ${d.weights?.active?.dem ?? 0}.<br>
            Effective share: <b>${fmtPct(d.effectiveShare)}</b>, dominance score: <b>${fmtPct(d.dominanceScore)}</b>, applied: <b>${d.dominanceApplied ? "yes" : "no"}</b>.<br>
            Multipliers — hostile ${Number(d.appliedMultipliers?.hostilePressureMultiplier ?? 1).toFixed(3)}, pressure ${Number(d.appliedMultipliers?.partyPressureMultiplier ?? 1).toFixed(3)}, resilience ${Number(d.appliedMultipliers?.resilienceMultiplier ?? 1).toFixed(3)}.
          </div>
        `;
      })() : "") : ""}
    </section>
      `;
    })() : ""}
  `;


  // ── Internal Party Management (IPM) tile ─────────────────────────────────
  const ipmViewerRole = String(state.ipmViewerRole || "member");
  const canCreateIpm = ["whip", "chairman", "leader"].includes(ipmViewerRole);
  const canApproveIpm = ["chairman", "leader"].includes(ipmViewerRole);
  const canStaffIpm = ipmViewerRole === "staff";
  const ipmTickets = Array.isArray(state.ipmTickets) ? state.ipmTickets : [];
  const selectedTicket = ipmTickets.find((t) => String(t.id) === String(state.ipmSelectedTicketId || "")) || ipmTickets[0] || null;
  if (!state.ipmSelectedTicketId && selectedTicket?.id) state.ipmSelectedTicketId = selectedTicket.id;

  const showIpm = ipmViewerRole !== "member";
  const ipmHtml = showIpm ? `
    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Internal Party Management</h2>
      <div class="muted" style="margin-bottom:8px;font-size:.88em;">Role: <b>${esc(ipmViewerRole)}</b>${state.ipmMessage ? ` · ${esc(state.ipmMessage)}` : ""}</div>
      <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:10px;">
        <div>
          <h3 style="margin:0 0 6px;">Docket</h3>
          <div style="max-height:260px;overflow:auto;border:1px solid #ddd;border-radius:6px;padding:6px;background:#fff;">
            ${ipmTickets.length ? ipmTickets.map((t) => `
              <div class="tile" data-ipm-ticket-row="${esc(t.id)}" style="padding:6px;margin-bottom:6px;cursor:pointer;${String(selectedTicket?.id||"")===String(t.id)?"border-color:#0b4ea2;box-shadow:0 0 0 1px #0b4ea2 inset;":""}">
                <div style="display:flex;justify-content:space-between;gap:8px;">
                  <b>${esc(t.title || '(untitled)')}</b>
                  <span class="muted">${esc(t.status || '')}</span>
                </div>
                <div class="muted" style="font-size:.82em;">${esc(t.origin || '')} · ${esc(t.ticket_type || '')} · to ${esc(t.to_role || '')}</div>
              </div>
            `).join("") : `<div class="muted-block">No tickets yet.</div>`}
          </div>

          ${canCreateIpm ? `
            <form id="ipm-create-form" style="margin-top:8px;display:grid;gap:6px;">
              <div style="font-weight:600;">Create ticket</div>
              <input class="input" name="title" placeholder="Ticket title" required>
              <select class="input" name="ticket_type">
                <option value="policy">Policy</option><option value="operation">Operation</option><option value="staffing">Staffing</option><option value="finance">Finance</option>
              </select>
              <textarea class="input" name="body" rows="3" placeholder="What needs to happen?" required></textarea>
              <button class="btn" type="submit">Create</button>
            </form>
          ` : ``}
        </div>

        <div>
          <h3 style="margin:0 0 6px;">Selected ticket</h3>
          ${selectedTicket ? `
            <div class="tile" style="padding:8px;">
              <div><b>${esc(selectedTicket.title || '(untitled)')}</b></div>
              <div class="muted" style="font-size:.84em;">${esc(selectedTicket.status || '')} · ${esc(selectedTicket.origin || '')} · ${esc(selectedTicket.ticket_type || '')}</div>
              <div style="margin-top:6px;white-space:pre-wrap;">${esc(selectedTicket.body || '')}</div>
              ${canApproveIpm ? `
                <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
                  <button class="btn" type="button" data-ipm-action="approve">Approve</button>
                  <button class="btn" type="button" data-ipm-action="reject">Reject</button>
                </div>
              ` : ``}
              ${canApproveIpm && (selectedTicket.origin === 'staff' || selectedTicket.origin === 'npc') ? `
                <div style="margin-top:8px;"><button class="btn" type="button" data-ipm-action="dismiss">Ignore / Dismiss</button></div>
              ` : ``}
              <div style="margin-top:8px;">
                <button class="btn" type="button" data-ipm-action="messages">Load messages</button>
              </div>
            </div>
          ` : `<div class="muted-block">Select a ticket from the docket.</div>`}

          <div id="ipm-message-thread" style="margin-top:8px;max-height:200px;overflow:auto;">
            ${(Array.isArray(state.ipmMessages) ? state.ipmMessages : []).map((m) => `<div class="tile" style="padding:6px;margin-bottom:6px;"><div class="muted" style="font-size:.8em;">${esc(m.author_role || 'member')} · ${esc(new Date(m.created_at).toLocaleString('en-GB'))}</div><div>${esc(m.body || '')}</div></div>`).join('')}
          </div>
        </div>
      </div>

      ${canStaffIpm ? `
        <hr style="margin:12px 0;border:0;border-top:1px solid #ddd;">
        <h3 style="margin:0 0 6px;">Staff Panel</h3>
        <form id="ipm-staff-filter" style="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-end;">
          <select class="input" name="party_slug"><option value="">All parties</option><option>Labour</option><option>Conservative</option><option>Liberal Democrat</option></select>
          <select class="input" name="origin"><option value="">All origins</option><option value="player">player</option><option value="staff">staff</option><option value="npc">npc</option></select>
          <select class="input" name="status"><option value="">All statuses</option><option value="awaiting_staff_costing">awaiting_staff_costing</option><option value="awaiting_chairman_approval">awaiting_chairman_approval</option><option value="awaiting_leader_approval">awaiting_leader_approval</option><option value="queued_for_freeze">queued_for_freeze</option><option value="outcome_recorded">outcome_recorded</option><option value="cancelled">cancelled</option></select>
          <input class="input" name="q" placeholder="search">
          <button class="btn" type="submit">Load</button>
        </form>
        <div style="margin-top:8px;max-height:220px;overflow:auto;border:1px solid #ddd;padding:6px;border-radius:6px;">
          ${(Array.isArray(state.ipmStaffTickets) ? state.ipmStaffTickets : []).map((t) => `<div class="tile" data-ipm-staff-row="${esc(t.id)}" style="padding:6px;margin-bottom:6px;cursor:pointer;${String(state.ipmStaffSelectedId||'')===String(t.id)?'border-color:#0b4ea2;box-shadow:0 0 0 1px #0b4ea2 inset;':''}"><b>${esc(t.title||'(untitled)')}</b><div class="muted" style="font-size:.82em;">${esc(t.party_slug||'')} · ${esc(t.status||'')} · ${esc(t.origin||'')}</div></div>`).join('')}
        </div>
        <div style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <form id="ipm-staff-create" class="tile" style="padding:8px;display:grid;gap:6px;">
            <b>Create staff/NPC ticket</b>
            <select class="input" name="party_slug"><option>Labour</option><option>Conservative</option><option>Liberal Democrat</option></select>
            <select class="input" name="origin"><option value="staff">staff</option><option value="npc">npc</option></select>
            <input class="input" name="title" placeholder="Title" required>
            <textarea class="input" name="body" rows="2" placeholder="Body"></textarea>
            <button class="btn" type="submit">Create</button>
          </form>
          <div class="tile" style="padding:8px;display:grid;gap:6px;">
            <b>Costing / outcome / letters</b>
            <div class="muted" style="font-size:.82em;">Selected: ${esc(String(state.ipmStaffSelectedId || 'none'))}</div>
            <form id="ipm-staff-cost"><input class="input" name="cost_amount" type="number" step="0.01" placeholder="Cost amount"><input class="input" name="cost_model" placeholder="party_budget|character_pc"><input class="input" name="charge_character_id" placeholder="Character UUID (optional)"><button class="btn" type="submit">Save costing</button></form>
            <form id="ipm-staff-outcome"><input class="input" name="outcome_type" placeholder="recorded"><input class="input" name="summary" placeholder="Outcome summary"><button class="btn" type="submit">Set outcome</button></form>
            <form id="ipm-staff-letter"><select class="input" name="author_role"><option value="staff">staff</option><option value="npc">npc</option></select><textarea class="input" name="body" rows="2" placeholder="Letter/message"></textarea><button class="btn" type="submit">Send letter</button></form>
            <button class="btn" type="button" id="ipm-staff-cancel">Cancel selected ticket</button>
            <button class="btn" type="button" id="ipm-staff-load-msg">Load selected messages</button>
          </div>
        </div>
      ` : ``}
    </section>
  ` : "";
  if (ipmHtml) root.insertAdjacentHTML("beforeend", ipmHtml);

  const reloadPartyTickets = async () => {
    try {
      const r = await apiGetPartyInternalTickets(state.activeParty);
      state.ipmTickets = Array.isArray(r.tickets) ? r.tickets : [];
      state.ipmViewerRole = r.viewerRole || state.ipmViewerRole || "member";
      if (!state.ipmSelectedTicketId && state.ipmTickets[0]?.id) state.ipmSelectedTicketId = state.ipmTickets[0].id;
    } catch (e) {
      state.ipmMessage = `IPM load failed: ${e.message}`;
    }
  };

  root.querySelectorAll("[data-ipm-ticket-row]").forEach((el) => {
    el.addEventListener("click", () => {
      state.ipmSelectedTicketId = el.getAttribute("data-ipm-ticket-row") || "";
      render(data, state);
    });
  });

  root.querySelector("#ipm-create-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await apiCreatePartyInternalTicket(state.activeParty, {
        title: String(fd.get("title") || ""),
        body: String(fd.get("body") || ""),
        ticket_type: String(fd.get("ticket_type") || "policy"),
      });
      state.ipmMessage = "Ticket created.";
      await reloadPartyTickets();
      render(data, state);
    } catch (err) {
      state.ipmMessage = err.message;
      render(data, state);
    }
  });

  root.querySelectorAll("[data-ipm-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!selectedTicket) return;
      const action = btn.getAttribute("data-ipm-action");
      try {
        if (action === "approve" || action === "reject") {
          await apiApproveOrRejectPartyInternalTicket(state.activeParty, selectedTicket.id, action, "");
          await reloadPartyTickets();
        } else if (action === "dismiss") {
          await apiDismissPartyInternalTicket(state.activeParty, selectedTicket.id, "");
          await reloadPartyTickets();
        } else if (action === "messages") {
          const r = await apiGetPartyInternalTicketMessages(state.activeParty, selectedTicket.id);
          state.ipmMessages = Array.isArray(r.messages) ? r.messages : [];
        }
        state.ipmMessage = "Updated.";
      } catch (err) {
        state.ipmMessage = err.message;
      }
      render(data, state);
    });
  });

  root.querySelector("#ipm-staff-filter")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      const r = await apiStaffListInternalTickets({
        party_slug: String(fd.get("party_slug") || ""),
        origin: String(fd.get("origin") || ""),
        status: String(fd.get("status") || ""),
        q: String(fd.get("q") || ""),
      });
      state.ipmStaffTickets = Array.isArray(r.tickets) ? r.tickets : [];
      if (!state.ipmStaffSelectedId && state.ipmStaffTickets[0]?.id) state.ipmStaffSelectedId = state.ipmStaffTickets[0].id;
      render(data, state);
    } catch (err) {
      state.ipmMessage = err.message;
      render(data, state);
    }
  });

  root.querySelectorAll("[data-ipm-staff-row]").forEach((el) => {
    el.addEventListener("click", () => {
      state.ipmStaffSelectedId = el.getAttribute("data-ipm-staff-row") || "";
      render(data, state);
    });
  });

  root.querySelector("#ipm-staff-create")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await apiStaffCreateInternalTicket({
        party_slug: String(fd.get("party_slug") || ""),
        origin: String(fd.get("origin") || "staff"),
        title: String(fd.get("title") || ""),
        body: String(fd.get("body") || ""),
      });
      state.ipmMessage = "Staff ticket created.";
      render(data, state);
    } catch (err) {
      state.ipmMessage = err.message;
      render(data, state);
    }
  });

  root.querySelector("#ipm-staff-cost")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.ipmStaffSelectedId) return;
    const fd = new FormData(e.currentTarget);
    try {
      await apiStaffSetInternalTicketCosting(state.ipmStaffSelectedId, {
        cost_amount: Number(fd.get("cost_amount") || 0),
        cost_model: String(fd.get("cost_model") || "party_budget"),
        charge_character_id: String(fd.get("charge_character_id") || "") || null,
      });
      state.ipmMessage = "Costing saved.";
      render(data, state);
    } catch (err) {
      state.ipmMessage = err.message;
      render(data, state);
    }
  });

  root.querySelector("#ipm-staff-outcome")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.ipmStaffSelectedId) return;
    const fd = new FormData(e.currentTarget);
    try {
      await apiStaffSetInternalTicketOutcome(state.ipmStaffSelectedId, {
        outcome_type: String(fd.get("outcome_type") || "recorded"),
        summary: String(fd.get("summary") || ""),
      });
      state.ipmMessage = "Outcome saved.";
      render(data, state);
    } catch (err) {
      state.ipmMessage = err.message;
      render(data, state);
    }
  });

  root.querySelector("#ipm-staff-letter")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.ipmStaffSelectedId) return;
    const fd = new FormData(e.currentTarget);
    try {
      await apiStaffCreateInternalTicketMessage(state.ipmStaffSelectedId, {
        author_role: String(fd.get("author_role") || "staff"),
        body: String(fd.get("body") || ""),
      });
      state.ipmMessage = "Letter sent.";
      render(data, state);
    } catch (err) {
      state.ipmMessage = err.message;
      render(data, state);
    }
  });

  root.querySelector("#ipm-staff-cancel")?.addEventListener("click", async () => {
    if (!state.ipmStaffSelectedId) return;
    try {
      await apiStaffCancelInternalTicket(state.ipmStaffSelectedId, "Cancelled by staff panel");
      state.ipmMessage = "Cancelled.";
      render(data, state);
    } catch (err) {
      state.ipmMessage = err.message;
      render(data, state);
    }
  });

  root.querySelector("#ipm-staff-load-msg")?.addEventListener("click", async () => {
    if (!state.ipmStaffSelectedId) return;
    try {
      const r = await apiStaffGetInternalTicketMessages(state.ipmStaffSelectedId);
      state.ipmMessages = Array.isArray(r.messages) ? r.messages : [];
      render(data, state);
    } catch (err) {
      state.ipmMessage = err.message;
      render(data, state);
    }
  });



  root.querySelector("#party-switch")?.addEventListener("change", async (e) => {
    const next = String(e.currentTarget.value || "");
    if (!next) return;
    state.activeParty = next;
    state.openDraftId = null;
    state.feeMessage = "";
    state.donationMessage = "";
    state.controlMessage = "";
    // Reload DB party data for the newly selected party
    try {
      const [partyResult, charsResult, structureResult, ledgerResult, whipReqResult, factionsResult, climateResultBase, ipmResult] = await Promise.all([
        apiGetParty(next).catch(() => null),
        apiGetCharacters({ active: "true" }).catch(() => ({ characters: [] })),
        apiGetPartyStructure(next).catch(() => ({ structure: {}, treasuryOverspend: false })),
        apiGetPartyLedger(next).catch(() => ({ donations: [] })),
        apiGetWhipRequests(next, "pending").catch(() => ({ requests: [] })),
        apiGetPartyFactions(next).catch(() => ({ factions: [] })),
        apiGetPartyFactionClimate(next).catch(() => ({ climate: null, viewerRole: "member" })),
        apiGetPartyInternalTickets(next).catch(() => ({ tickets: [], viewerRole: "member" })),
      ]);
      const climateResult = (climateResultBase?.viewerRole === "staff")
        ? await apiGetPartyFactionClimate(next, { debug: true }).catch(() => climateResultBase)
        : climateResultBase;
      if (partyResult?.party) state.dbState = { ...state.dbState, party: partyResult.party };
      const partyNameLower = next.toLowerCase();
      state.dbState.partyCharacters = (charsResult.characters || []).filter(
        (c) => (c.party || "").toLowerCase() === partyNameLower
      );
      state.dbState.partyStructure = structureResult.structure || {};
      state.dbState.treasuryOverspend = !!structureResult.treasuryOverspend;
      state.ledger = Array.isArray(ledgerResult.donations) ? ledgerResult.donations : [];
      state.dbState.whipRequests = Array.isArray(whipReqResult.requests) ? whipReqResult.requests : [];
      state.factions = Array.isArray(factionsResult.factions) ? factionsResult.factions : [];
      state.factionClimate = climateResult.climate ?? null;
      state.factionViewerRole = climateResult.viewerRole ?? "member";
      state.factionPendingFreezeCount = Number(climateResult.pendingFreezeCount ?? 0);
      state.factionLastFreezeAt = climateResult.lastFreezeAt ?? null;
      state.factionSeatTotal = Number(factionsResult.partySeatTotal ?? 0);
      state.factionAllocatedMPs = Number(factionsResult.allocatedMPs ?? 0);
      state.factionRemainingMPs = Number(factionsResult.remainingMPs ?? 0);
      state.ipmTickets = Array.isArray(ipmResult.tickets) ? ipmResult.tickets : [];
      state.ipmViewerRole = String(ipmResult.viewerRole || "member");
      state.ipmSelectedTicketId = state.ipmTickets[0]?.id || "";
    } catch (e) {
      console.warn("[party-switch] DB reload failed:", e.message);
    }
    render(data, state);
  });

  wireDraftingBuilder(root.querySelector("#party-draft-form"), "party-draft");

  root.querySelector("#party-draft-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const { title, purpose, body, discussUrl, department, articleCount, extent, commencement, articles } = parseDraftingForm(e.currentTarget, data);
    if (!title || !purpose || !body) return;

    if (state.editingDraftId) {
      const draft = party.drafts.find((d) => d.id === state.editingDraftId);
      const userId = char?.name || "";
      if (!draft || (draft.authorId !== userId && !manager)) return;
      draft.title = title;
      draft.purpose = purpose;
      draft.body = body;
      draft.discussUrl = discussUrl;
      draft.department = department;
      draft.articleCount = articleCount;
      draft.extent = extent;
      draft.commencement = commencement;
      draft.articles = articles;
      state.editingDraftId = null;
    } else {
      const id = data.party.nextDraftId++;
      const draft = {
        id,
        ref: `${party.short} DRAFT ${id}`,
        title,
        purpose,
        body,
        discussUrl,
        department,
        articleCount,
        extent,
        commencement,
        articles,
        authorName: char?.name || "Unknown MP",
        authorId: char?.name || "",
        createdAt: new Date().toLocaleString("en-GB"),
        createdTs: Date.now()
      };
      party.drafts.push(draft);
      state.openDraftId = id;
    }

    // Persist drafts to DB (fire-and-forget; UI stays responsive)
    apiSavePartyDrafts(state.activeParty, party.drafts).catch((err) => { // UI_ONLY_OK: autosave of party draft text; no simulation-outcome consequence
      console.warn("[party-draft-form] drafts save failed:", err.message);
      state.partyShopMessage = `Draft save failed: ${err.message}. Please try again.`;
      render(data, state);
    });
    render(data, state);
  });

  root.querySelectorAll("[data-action='open-draft']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.getAttribute("data-id") || 0);
      state.openDraftId = state.openDraftId === id ? null : id;
      render(data, state);
    });
  });

  root.querySelectorAll("[data-action='edit-draft']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.getAttribute("data-id") || 0);
      const draft = party.drafts.find((d) => d.id === id);
      const userId = char?.name || "";
      if (!draft || (draft.authorId !== userId && !manager)) return;
      state.editingDraftId = id;
      render(data, state);
    });
  });

  root.querySelectorAll("[data-action='delete-draft']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!manager) return;
      const id = Number(btn.getAttribute("data-id") || 0);
      party.drafts = party.drafts.filter((d) => d.id !== id);
      if (state.openDraftId === id) state.openDraftId = null;
      apiSavePartyDrafts(state.activeParty, party.drafts).catch((err) => { // UI_ONLY_OK: autosave of party draft text; no simulation-outcome consequence
        console.warn("[delete-draft] drafts save failed:", err.message);
        state.partyShopMessage = `Draft remove failed: ${err.message}. Please try again.`;
        render(data, state);
      });
      render(data, state);
    });
  });

  root.querySelector("#party-control-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!manager) return;
    const fd = new FormData(e.currentTarget);
    const leaderId = String(fd.get("leaderId") || "").trim();
    const newCash    = Number(fd.get("cash")    || 0);
    const newDebt    = Number(fd.get("debt")    || 0);
    const newMembers = Number(fd.get("members") || 0);

    const partyId = state.activeParty;

    let leaderSaveError = "";
    let treasurySaveError = "";

    // Persist party leader to DB (admin/mod only, authoritative source)
    try {
      await apiSetPartyLeader(partyId, leaderId || null);
    } catch (err) {
      leaderSaveError = String(err?.message || "Leader update failed.");
      console.warn("[party-control-form] leader save failed:", err.message);
    }

    // Persist treasury cash/debt first so a members cooldown conflict does not block
    // cash/debt updates in the same save action.
    try {
      await apiSetPartyTreasury(partyId, { cash: newCash, debt: newDebt });
    } catch (err) {
      treasurySaveError = String(err?.message || "Treasury update failed.");
      console.warn("[party-control-form] treasury (cash/debt) save failed:", err.message);
    }

    const currentMembers = Number(dbParty?.treasury?.members ?? party.treasury?.members ?? 0);
    if (newMembers !== currentMembers) {
      try {
        await apiSetPartyTreasury(partyId, { members: newMembers });
      } catch (err) {
        const membersMessage = String(err?.message || "Members update failed.");
        treasurySaveError = treasurySaveError
          ? `${treasurySaveError} Members: ${membersMessage}`
          : `Members: ${membersMessage}`;
        console.warn("[party-control-form] treasury (members) save failed:", err.message);
      }
    }

    // Re-fetch party from DB to sync leader info and treasury (DB is authoritative)
    try {
      const { party: updated } = await apiGetParty(partyId);
      state.dbState = { ...state.dbState, party: updated };
      party.leader.name        = updated.leader_name  || "";
      party.leader.avatar      = updated.leader_avatar || "";
      party.leader.characterId = updated.leader_id    || "";
      // Sync treasury from DB response (authoritative) — overrides form values
      // in case the server applied rate-limiting or partial update.
      if (updated.treasury) {
        party.treasury = {
          cash:    Number(updated.treasury.cash    ?? newCash),
          debt:    Number(updated.treasury.debt    ?? newDebt),
          members: Number(updated.treasury.members ?? newMembers),
        };
      } else {
        party.treasury.cash    = newCash;
        party.treasury.debt    = newDebt;
        party.treasury.members = newMembers;
      }
    } catch (err) {
      console.warn("[party-control-form] re-fetch party failed:", err.message);
      // Fallback to form values if re-fetch fails
      party.treasury.cash    = newCash;
      party.treasury.debt    = newDebt;
      party.treasury.members = newMembers;
    }

    if (leaderSaveError || treasurySaveError) {
      state.controlMessage = `Saved with warnings.${leaderSaveError ? ` Leader: ${leaderSaveError}` : ""}${treasurySaveError ? ` Treasury: ${treasurySaveError}` : ""}`;
    } else {
      state.controlMessage = "Party settings saved.";
    }

    render(data, state);
  });

  root.querySelector("#party-leadership-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!canAssignLeadership) return;
    const fd = new FormData(e.currentTarget);
    const chairmanId = String(fd.get("chairman_character_id") || "").trim();
    const chiefWhipId = String(fd.get("chief_whip_character_id") || "").trim();
    const partyId = state.activeParty;
    try {
      await Promise.all([
        apiSetPartyLeadership(partyId, "chairman", chairmanId || null),
        apiSetChiefWhip(partyId, chiefWhipId || null),
      ]);
      const { party: updated } = await apiGetParty(partyId);
      state.dbState = { ...state.dbState, party: updated };
      state.leadershipMessage = "Leadership updated.";
    } catch (err) {
      state.leadershipMessage = String(err.message || "Update failed.");
    }
    render(data, state);
  });

  // Party shop: buy item — DB-backed (deducts treasury atomically, inserts purchase record)
  root.querySelectorAll('[data-action="party-buy-item"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!canManageStructure) return;
      const itemId = String(btn.dataset.itemId || "");
      const item = PARTY_SHOP_ITEMS.find((i) => i.id === itemId);
      if (!item) return;
      const pi = state.priceIndex || 1;
      const price  = partyCurrentPrice(item, pi);
      const upkeep = partyCurrentUpkeep(item, pi);
      const purchases = party.partyShopPurchases || [];
      const ownedCount = purchases.filter((p) => p.itemId === item.id).length;
      if (item.caps?.maxOwned != null && ownedCount >= item.caps.maxOwned) return;
      const cash = Number(party.treasury?.cash || 0);
      if (cash < price) return;
      btn.disabled = true;
      try {
        const result = await apiAddPartyShopPurchase(state.activeParty, {
          item_id: item.id, item_name: item.name, price, monthly_upkeep: upkeep,
          effects: item.effects ? [...item.effects] : [], risk_modifier: item.riskModifier || null,
        });
        // Update in-memory state from DB response
        party.treasury.cash = Number(result.newTreasuryCash ?? cash - price);
        party.partyShopPurchases = [...purchases, result.purchase];
        // Apply unlock effects immediately
        const structure = state.dbState?.partyStructure || {};
        structure.unlocks = structure.unlocks || {};
        for (const e of (item.effects || [])) {
          if (e.type === "unlock") structure.unlocks[e.value] = true;
        }
        if (state.dbState) state.dbState.partyStructure = structure;
        state.partyShopMessage = `Purchased "${item.name}" for ${formatMoney(price)}.${upkeep > 0 ? ` Upkeep: ${formatMoney(upkeep)}/month.` : ""}`;
        const actorChar = getCharacterContext(data);
        logAction({
          action: "party-shop-purchase",
          target: state.activeParty,
          details: {
            partyId: state.activeParty,
            partyName: party?.name || state.activeParty,
            actorId: actorChar?.id || actorChar?.characterId || "",
            actorName: actorChar?.name || "",
            itemId: item.id,
            itemName: item.name,
            price,
            monthlyUpkeep: upkeep,
            headline: `${actorChar?.name || "Someone"} purchased "${item.name}" for ${formatMoney(price)} from the ${party?.name || state.activeParty} party shop.`,
          },
        });
      } catch (err) {
        state.partyShopMessage = `Purchase failed: ${err.message}`;
        btn.disabled = false;
      }
      render(data, state);
    });
  });

  // Party shop: manager remove purchase — DB-backed
  root.querySelectorAll('[data-action="party-remove-purchase"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!manager) return;
      const purchaseId = String(btn.dataset.id || "");
      const idx = Number(btn.dataset.idx || 0);
      const purchases = party.partyShopPurchases || [];
      btn.disabled = true;
      try {
        const removed = purchaseId ? purchases.find((p) => p.id === purchaseId) : purchases[idx];
        if (purchaseId) {
          await apiRemovePartyShopPurchase(state.activeParty, purchaseId);
          party.partyShopPurchases = purchases.filter((p) => p.id !== purchaseId);
        } else {
          // Fallback: use idx for legacy state-only records
          if (idx < 0 || idx >= purchases.length) { render(data, state); return; }
          party.partyShopPurchases = purchases.filter((_, i) => i !== idx);
        }
        state.partyShopMessage = "Purchase removed.";
        const actorChar = getCharacterContext(data);
        logAction({
          action: "party-shop-dismissal",
          target: state.activeParty,
          details: {
            partyId: state.activeParty,
            partyName: party?.name || state.activeParty,
            actorId: actorChar?.id || actorChar?.characterId || "",
            actorName: actorChar?.name || "",
            purchaseId: purchaseId || String(idx),
            itemId: removed?.itemId || "",
            itemName: removed?.itemName || "",
            headline: `${actorChar?.name || "Someone"} removed "${removed?.itemName || "an item"}" from the ${party?.name || state.activeParty} party shop.`,
          },
        });
      } catch (err) {
        state.partyShopMessage = `Remove failed: ${err.message}`;
        btn.disabled = false;
      }
      render(data, state);
    });
  });

  // Party shop: sell purchase (leader/chairman/admin/mod) — 50% refund to treasury
  root.querySelectorAll('[data-action="party-sell-purchase"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!canManageStructure) return;
      const purchaseId = String(btn.dataset.id || "");
      if (!purchaseId) return;
      btn.disabled = true;
      const purchases = party.partyShopPurchases || [];
      const soldItem = purchases.find((p) => p.id === purchaseId);
      try {
        const result = await apiSellPartyShopPurchase(state.activeParty, purchaseId);
        party.partyShopPurchases = purchases.filter((p) => p.id !== purchaseId);
        if (party.treasury) party.treasury.cash = Number(result.newTreasuryCash ?? party.treasury.cash);
        state.partyShopMessage = `"${soldItem?.itemName || soldItem?.name || "Item"}" sold. Refund: ${formatMoney(result.refund || 0)} returned to treasury.`;
        const actorChar = getCharacterContext(data);
        logAction({
          action: "party-shop-sale",
          target: state.activeParty,
          details: {
            partyId: state.activeParty,
            partyName: party?.name || state.activeParty,
            actorId: actorChar?.id || actorChar?.characterId || "",
            actorName: actorChar?.name || "",
            purchaseId,
            itemId: soldItem?.itemId || "",
            itemName: soldItem?.itemName || soldItem?.name || "",
            refund: result.refund || 0,
            headline: `${actorChar?.name || "Someone"} sold "${soldItem?.itemName || soldItem?.name || "an item"}" from the ${party?.name || state.activeParty} party shop (refund: ${formatMoney(result.refund || 0)}).`,
          },
        });
      } catch (err) {
        state.partyShopMessage = `Sell failed: ${err.message}`;
        btn.disabled = false;
      }
      render(data, state);
    });
  });

  // Party shop: dismiss purchase (leader/chairman/admin/mod) — free items, no refund
  root.querySelectorAll('[data-action="party-dismiss-purchase"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!canManageStructure) return;
      const purchaseId = String(btn.dataset.id || "");
      if (!purchaseId) return;
      btn.disabled = true;
      const purchases = party.partyShopPurchases || [];
      const dismissedItem = purchases.find((p) => p.id === purchaseId);
      try {
        await apiDismissPartyShopPurchase(state.activeParty, purchaseId);
        party.partyShopPurchases = purchases.filter((p) => p.id !== purchaseId);
        state.partyShopMessage = `"${dismissedItem?.itemName || dismissedItem?.name || "Item"}" dismissed.`;
        const actorChar = getCharacterContext(data);
        logAction({
          action: "party-shop-dismissal",
          target: state.activeParty,
          details: {
            partyId: state.activeParty,
            partyName: party?.name || state.activeParty,
            actorId: actorChar?.id || actorChar?.characterId || "",
            actorName: actorChar?.name || "",
            purchaseId,
            itemId: dismissedItem?.itemId || "",
            itemName: dismissedItem?.itemName || dismissedItem?.name || "",
            headline: `${actorChar?.name || "Someone"} dismissed "${dismissedItem?.itemName || dismissedItem?.name || "an item"}" from the ${party?.name || state.activeParty} party shop.`,
          },
        });
      } catch (err) {
        state.partyShopMessage = `Dismiss failed: ${err.message}`;
        btn.disabled = false;
      }
      render(data, state);
    });
  });

  // National Organisation: add office button
  root.querySelector("#add-office-btn")?.addEventListener("click", () => {
    if (!canManageStructure) return;
    const s = state.dbState?.partyStructure || {};
    s.nationalOffices = [...(s.nationalOffices || []), { region: "", size: "Regional Office", staffCount: 0 }];
    if (state.dbState) state.dbState.partyStructure = s;
    render(data, state);
  });

  // National Organisation: remove office button
  root.querySelectorAll('[data-action="remove-office"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!canManageStructure) return;
      const idx = Number(btn.dataset.idx || 0);
      const s = state.dbState?.partyStructure || {};
      s.nationalOffices = (s.nationalOffices || []).filter((_, i) => i !== idx);
      if (state.dbState) state.dbState.partyStructure = s;
      render(data, state);
    });
  });

  // National Organisation: save structure form
  root.querySelector("#party-structure-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!canManageStructure) return;
    const fd = new FormData(e.currentTarget);
    const officeCount = Number(fd.get("office_count") || 0);
    const offices = [];
    for (let i = 0; i < officeCount; i++) {
      offices.push({
        region:     String(fd.get(`office_region_${i}`) || "").trim(),
        size:       String(fd.get(`office_size_${i}`)   || "Regional Office"),
        staffCount: Math.max(0, Number(fd.get(`office_staff_${i}`) || 0)),
      });
    }
    const departments = {};
    for (const dept of DEPARTMENTS) {
      departments[dept] = Math.max(0, Number(fd.get(`dept_${dept}`) || 0));
    }
    const totalStaff = offices.reduce((s, o) => s + o.staffCount, 0)
      + Object.values(departments).reduce((s, v) => s + v, 0);
    const monthlyOverhead = Math.round(totalStaff * STAFF_COST_1997 * (state.priceIndex || 1));
    const existing = state.dbState?.partyStructure || {};
    const structure = {
      nationalOffices: offices,
      departments,
      totalStaff,
      monthlyOverhead,
      unlocks: existing.unlocks || {},
    };
    try {
      const beforeStructure = state.dbState?.partyStructure || {};
      const result = await apiSavePartyStructure(state.activeParty, structure);
      state.dbState = { ...state.dbState, partyStructure: result.structure };
      state.structureMessage = `Organisation saved. Monthly overhead: ${formatMoney(monthlyOverhead)}.`;
      const actorChar = getCharacterContext(data);
      logAction({
        action: "party-organisation-updated",
        target: state.activeParty,
        details: {
          partyId: state.activeParty,
          partyName: party?.name || state.activeParty,
          actorId: actorChar?.id || actorChar?.characterId || "",
          actorName: actorChar?.name || "",
          beforeTotalStaff: beforeStructure.totalStaff ?? null,
          afterTotalStaff: totalStaff,
          beforeMonthlyOverhead: beforeStructure.monthlyOverhead ?? null,
          afterMonthlyOverhead: monthlyOverhead,
          departments,
          officeCount: offices.length,
          headline: `${actorChar?.name || "Someone"} updated ${party?.name || state.activeParty} party organisation: ${totalStaff} total staff, overhead ${formatMoney(monthlyOverhead)}/month.`,
        },
      });
    } catch (err) {
      state.structureMessage = `Error: ${err.message}`;
    }
    render(data, state);
  });

  // Membership fee form (chairman/admin/mod)
  root.querySelector("#party-fee-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!manager && !isChairman) return;
    const fee = Number(document.getElementById("party-fee-input")?.value || 0);
    try {
      const result = await apiSetPartyMembershipFee(state.activeParty, fee);
      if (state.dbState?.party) state.dbState.party.membershipFeeAnnual = result.membershipFeeAnnual;
      state.feeMessage = `Annual membership fee set to ${formatMoney(result.membershipFeeAnnual)}.`;
    } catch (err) {
      state.feeMessage = `Error: ${err.message}`;
    }
    render(data, state);
  });

  // Donation form (admin/mod only)
  root.querySelector("#party-donation-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!manager) return;
    const fd = new FormData(e.currentTarget);
    const fromName = String(fd.get("fromName") || "").trim();
    const amount   = Number(fd.get("amount") || 0);
    const note     = String(fd.get("note") || "").trim();
    if (!fromName || amount <= 0) {
      state.donationMessage = "Please enter a valid name and amount.";
      render(data, state);
      return;
    }
    try {
      const result = await apiAddPartyDonation(state.activeParty, { fromName, amount, note });
      // Update treasury in memory
      party.treasury.cash = Number(party.treasury?.cash || 0) + amount;
      // Prepend to ledger
      state.ledger = [result.donation, ...(state.ledger || [])];
      state.donationMessage = `Donation of ${formatMoney(amount)} from "${fromName}" added.`;
      e.currentTarget.reset();
    } catch (err) {
      state.donationMessage = `Error: ${err.message}`;
    }
    render(data, state);
  });

  // ── Whip discipline ─────────────────────────────────────────────────────────
  root.querySelectorAll('[data-action="withdraw-whip"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!canManageWhip) return;
      const charId = String(btn.dataset.id || "");
      if (!charId) return;
      btn.disabled = true;
      try {
        const result = await apiWithdrawWhip(charId);
        if (result.pending) {
          // Chief Whip's request is pending party leader approval — do not update local state yet
          state.whipMessage = result.message || "Whip withdrawal request submitted to the Party Leader for approval.";
        } else {
          const c = state.dbState.partyCharacters.find((x) => String(x.id) === charId);
          if (c) c.whip_status = "withdrawn";
          state.whipMessage = "Whip withdrawn.";
        }
      } catch (err) {
        state.whipMessage = `Error: ${err.message}`;
        btn.disabled = false;
      }
      render(data, state);
    });
  });

  root.querySelectorAll('[data-action="approve-whip-request"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const reqId = String(btn.dataset.requestId || "");
      const partySlug = String(btn.dataset.partySlug || "");
      if (!reqId || !partySlug) return;
      btn.disabled = true;
      try {
        await apiApproveWhipRequest(partySlug, reqId);
        state.whipMessage = "Whip withdrawal approved.";
        // Refresh characters to reflect the withdrawn status, and remove only this request
        const charsResult = await apiGetCharacters({ active: "true" }).catch(() => ({ characters: [] }));
        const partyNameLower = partySlug.toLowerCase();
        state.dbState.partyCharacters = (charsResult.characters || []).filter(
          (c) => (c.party || "").toLowerCase() === partyNameLower
        );
        state.dbState.whipRequests = (state.dbState.whipRequests || []).filter((r) => r.id !== reqId);
      } catch (err) {
        state.whipMessage = `Error: ${err.message}`;
        btn.disabled = false;
      }
      render(data, state);
    });
  });

  root.querySelectorAll('[data-action="deny-whip-request"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const reqId = String(btn.dataset.requestId || "");
      const partySlug = String(btn.dataset.partySlug || "");
      if (!reqId || !partySlug) return;
      btn.disabled = true;
      try {
        await apiDenyWhipRequest(partySlug, reqId);
        state.whipMessage = "Whip withdrawal request denied.";
        state.dbState.whipRequests = (state.dbState.whipRequests || []).filter((r) => r.id !== reqId);
      } catch (err) {
        state.whipMessage = `Error: ${err.message}`;
        btn.disabled = false;
      }
      render(data, state);
    });
  });

  root.querySelectorAll('[data-action="restore-whip"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!canManageWhip) return;
      const charId = String(btn.dataset.id || "");
      if (!charId) return;
      btn.disabled = true;
      try {
        await apiRestoreWhip(charId);
        const c = state.dbState.partyCharacters.find((x) => String(x.id) === charId);
        if (c) c.whip_status = "active";
        state.whipMessage = "Whip restored.";
      } catch (err) {
        state.whipMessage = `Error: ${err.message}`;
        btn.disabled = false;
      }
      render(data, state);
    });
  });

  // ── Expulsion workflow ───────────────────────────────────────────────────────
  root.querySelector("#expulsion-request-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!canAssignLeadership) return;
    const fd = new FormData(e.currentTarget);
    const characterId = String(fd.get("character_id") || "").trim();
    const reason      = String(fd.get("reason") || "").trim();
    if (!characterId) {
      state.expulsionMessage = "Please select a member.";
      render(data, state);
      return;
    }
    try {
      await apiRequestExpulsion(state.activeParty, characterId, reason);
      state.expulsionMessage = "Expulsion request submitted.";
      e.currentTarget.reset();
    } catch (err) {
      state.expulsionMessage = `Error: ${err.message}`;
    }
    render(data, state);
  });

  root.querySelectorAll('[data-action="approve-expulsion"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!manager) return;
      const id = String(btn.dataset.id || "");
      if (!id) return;
      btn.disabled = true;
      try {
        await apiApproveExpulsion(id);
        state.expulsions = (state.expulsions || []).filter((ex) => String(ex.id) !== id);
        state.expulsionMessage = "Expulsion approved.";
      } catch (err) {
        state.expulsionMessage = `Error: ${err.message}`;
        btn.disabled = false;
      }
      render(data, state);
    });
  });

  root.querySelectorAll('[data-action="deny-expulsion"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!manager) return;
      const id = String(btn.dataset.id || "");
      if (!id) return;
      btn.disabled = true;
      try {
        await apiDenyExpulsion(id);
        state.expulsions = (state.expulsions || []).filter((ex) => String(ex.id) !== id);
        state.expulsionMessage = "Expulsion denied.";
      } catch (err) {
        state.expulsionMessage = `Error: ${err.message}`;
        btn.disabled = false;
      }
      render(data, state);
    });
  });

  // ── Party leader elections ───────────────────────────────────────────────────
  root.querySelector("#start-election-btn")?.addEventListener("click", async () => {
    if (!manager) return;
    const btn = root.querySelector("#start-election-btn");
    if (btn) btn.disabled = true;
    try {
      const result = await apiStartPartyElection(state.activeParty);
      state.currentElection = result.election || result;
      state.electionMessage = "Election started.";
    } catch (err) {
      state.electionMessage = `Error: ${err.message}`;
      if (btn) btn.disabled = false;
    }
    render(data, state);
  });

  root.querySelector("#nominate-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const characterId = String(fd.get("character_id") || "").trim();
    if (!characterId || !state.currentElection) return;
    try {
      await apiNominateForElection(state.activeParty, String(state.currentElection.id), characterId);
      const updated = await apiGetPartyElections(state.activeParty).catch(() => ({ elections: [] }));
      state.elections = updated.elections || [];
      const openStatuses = ["nominations", "voting", "runoff"];
      state.currentElection = state.elections.find((el) => openStatuses.includes(el.status)) || state.currentElection;
      state.electionMessage = "Nomination submitted.";
    } catch (err) {
      state.electionMessage = `Error: ${err.message}`;
    }
    render(data, state);
  });

  root.querySelectorAll('[data-action="vote-election"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const nomineeId  = String(btn.dataset.nomineeId || "");
      const electionId = String(btn.dataset.electionId || "");
      if (!nomineeId || !electionId) return;
      btn.disabled = true;
      try {
        await apiVoteInElection(state.activeParty, electionId, nomineeId);
        const updated = await apiGetPartyElections(state.activeParty).catch(() => ({ elections: [] }));
        state.elections = updated.elections || [];
        const openStatuses = ["nominations", "voting", "runoff"];
        state.currentElection = state.elections.find((el) => openStatuses.includes(el.status)) || state.currentElection;
        state.electionMessage = "Vote cast.";
      } catch (err) {
        state.electionMessage = `Error: ${err.message}`;
        btn.disabled = false;
      }
      render(data, state);
    });
  });

  root.querySelector("#open-voting-btn")?.addEventListener("click", async () => {
    if (!manager || !state.currentElection) return;
    const btn = root.querySelector("#open-voting-btn");
    if (btn) btn.disabled = true;
    try {
      await apiOpenElectionVoting(state.activeParty, String(state.currentElection.id));
      if (state.currentElection) state.currentElection.status = "voting";
      state.electionMessage = "Voting opened.";
    } catch (err) {
      state.electionMessage = `Error: ${err.message}`;
      if (btn) btn.disabled = false;
    }
    render(data, state);
  });

  root.querySelector("#close-election-btn")?.addEventListener("click", async () => {
    if (!manager || !state.currentElection) return;
    const btn = root.querySelector("#close-election-btn");
    if (btn) btn.disabled = true;
    try {
      await apiCloseElection(state.activeParty, String(state.currentElection.id));
      if (state.currentElection) state.currentElection.status = "closed";
      state.electionMessage = "Election closed.";
    } catch (err) {
      state.electionMessage = `Error: ${err.message}`;
      if (btn) btn.disabled = false;
    }
    render(data, state);
  });

  root.querySelector("#runoff-btn")?.addEventListener("click", async () => {
    if (!manager || !state.currentElection) return;
    const btn = root.querySelector("#runoff-btn");
    if (btn) btn.disabled = true;
    try {
      await apiRunoffElection(state.activeParty, String(state.currentElection.id));
      if (state.currentElection) state.currentElection.status = "runoff";
      state.electionMessage = "Runoff initiated.";
    } catch (err) {
      state.electionMessage = `Error: ${err.message}`;
      if (btn) btn.disabled = false;
    }
    render(data, state);
  });
}

export async function initPartyPage(data) {
  ensurePartyData(data);
  const char = getCharacterContext(data);
  const state = {
    activeParty: char?.party || "",
    openDraftId: null,
    editingDraftId: null,
    leadershipMessage: "",
    partyShopMessage: "",
    structureMessage: "",
    feeMessage: "",
    donationMessage: "",
    controlMessage: "",
    whipMessage: "",
    expulsionMessage: "",
    electionMessage: "",
    expulsions: [],
    elections: [],
    currentElection: null,
    ledger: [],
    priceIndex: 1.0,
    factions: [],
    factionClimate: null,
    factionViewerRole: "member",
    factionPendingFreezeCount: 0,
    factionLastFreezeAt: null,
    factionSeatTotal: 0,
    factionAllocatedMPs: 0,
    factionRemainingMPs: 0,
    factionSwitchMessage: "",
    ipmTickets: [],
    ipmViewerRole: "member",
    ipmSelectedTicketId: "",
    ipmMessages: [],
    ipmMessage: "",
    ipmStaffTickets: [],
    ipmStaffSelectedId: "",
    dbState: { party: null, partyCharacters: [], sessionCharId: "", partyStructure: null, treasuryOverspend: false }
  };

  // Load DB-backed party data
  const partyId = state.activeParty || Object.keys(data.party?.parties || {})[0] || "";
  if (partyId && isLoggedIn()) {
    try {
      const [partyResult, charsResult, myCharsResult, priceResult, structureResult, ledgerResult] = await Promise.all([
        apiGetParty(partyId).catch(() => null),
        apiGetCharacters({ active: "true" }).catch(() => ({ characters: [] })),
        apiGetMyCharacters().catch(() => ({ characters: [] })),
        apiGetShopPriceIndex().catch(() => ({ priceIndex: 1.0 })),
        apiGetPartyStructure(partyId).catch(() => ({ structure: {}, treasuryOverspend: false })),
        apiGetPartyLedger(partyId).catch(() => ({ donations: [] })),
      ]);
      if (partyResult?.party) {
        state.dbState.party = partyResult.party;

        // Sync DB-authoritative values into in-memory party state so render is live
        const party = data.party?.parties?.[partyId];
        if (party && partyResult.party) {
          const dbParty = partyResult.party;
          // Treasury from DB
          if (dbParty.treasury) {
            party.treasury = {
              cash:    Number(dbParty.treasury.cash    ?? party.treasury?.cash    ?? 0),
              debt:    Number(dbParty.treasury.debt    ?? party.treasury?.debt    ?? 0),
              members: Number(dbParty.treasury.members ?? party.treasury?.members ?? 0),
            };
          }
          // HQ URL
          if (dbParty.hq_url !== undefined) party.hqUrl = dbParty.hq_url;
          // Party shop purchases from DB
          if (Array.isArray(dbParty.partyShopPurchases)) {
            party.partyShopPurchases = dbParty.partyShopPurchases;
          }
          // Party drafts from DB
          if (Array.isArray(dbParty.drafts)) {
            party.drafts = dbParty.drafts;
          }
        }
      }
      const partyNameLower = partyId.toLowerCase();
      state.dbState.partyCharacters = (charsResult.characters || []).filter(
        (c) => (c.party || "").toLowerCase() === partyNameLower
      );
      const myActive = (myCharsResult.characters || []).find((c) => c.is_active);
      state.dbState.sessionCharId = myActive?.id || "";
      if (Number.isFinite(priceResult.priceIndex) && priceResult.priceIndex > 0) {
        state.priceIndex = priceResult.priceIndex;
      }
      state.dbState.partyStructure = structureResult.structure || {};
      state.dbState.treasuryOverspend = !!structureResult.treasuryOverspend;
      state.ledger = Array.isArray(ledgerResult.donations) ? ledgerResult.donations : [];

      // Load governance data: elections, pending expulsions, whip requests, and factions
      const [electionsResult, expulsionsResult, whipReqResult, factionsResult, climateResultBase, ipmResult] = await Promise.all([
        apiGetPartyElections(partyId).catch(() => ({ elections: [] })),
        apiGetExpulsions("pending").catch(() => ({ expulsions: [] })),
        apiGetWhipRequests(partyId, "pending").catch(() => ({ requests: [] })),
        apiGetPartyFactions(partyId).catch(() => ({ factions: [] })),
        apiGetPartyFactionClimate(partyId).catch(() => ({ climate: null, viewerRole: "member" })),
        apiGetPartyInternalTickets(partyId).catch(() => ({ tickets: [], viewerRole: "member" })),
      ]);
      const climateResult = (climateResultBase?.viewerRole === "staff")
        ? await apiGetPartyFactionClimate(partyId, { debug: true }).catch(() => climateResultBase)
        : climateResultBase;
      state.elections = electionsResult.elections || [];
      const openStatuses = ["nominations", "voting", "runoff"];
      state.currentElection = state.elections.find((e) => openStatuses.includes(e.status)) || null;
      state.expulsions = (expulsionsResult.expulsions || []).filter(
        (ex) => (ex.party || "").toLowerCase() === partyId.toLowerCase()
      );
      state.dbState.whipRequests = Array.isArray(whipReqResult.requests) ? whipReqResult.requests : [];
      state.factions = Array.isArray(factionsResult.factions) ? factionsResult.factions : [];
      state.factionClimate = climateResult.climate ?? null;
      state.factionViewerRole = climateResult.viewerRole ?? "member";
      state.factionPendingFreezeCount = Number(climateResult.pendingFreezeCount ?? 0);
      state.factionLastFreezeAt = climateResult.lastFreezeAt ?? null;
      state.factionSeatTotal = Number(factionsResult.partySeatTotal ?? 0);
      state.factionAllocatedMPs = Number(factionsResult.allocatedMPs ?? 0);
      state.factionRemainingMPs = Number(factionsResult.remainingMPs ?? 0);
      state.ipmTickets = Array.isArray(ipmResult.tickets) ? ipmResult.tickets : [];
      state.ipmViewerRole = String(ipmResult.viewerRole || "member");
      state.ipmSelectedTicketId = state.ipmTickets[0]?.id || "";
      state.ipmMessages = [];
    } catch (e) {
      console.warn("[initPartyPage] DB load failed:", e.message);
    }
  }

  render(data, state);
}
