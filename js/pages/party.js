import { esc, formatMPName } from "../ui.js";
import { isAdmin, isMod, canAdminOrMod } from "../permissions.js";
import { parseDraftingForm, renderDraftingBuilder, wireDraftingBuilder } from "../bill-drafting.js";
import { apiGetParty, apiSetPartyLeader, apiSetPartyLeadership, apiSetChiefWhip, apiGetCharacters, apiGetMyCharacters, apiGetShopPriceIndex, apiGetPartyStructure, apiSavePartyStructure, apiSetPartyTreasury, apiSetPartyMembershipFee, apiGetPartyLedger, apiAddPartyDonation, apiAddPartyShopPurchase, apiRemovePartyShopPurchase, apiSellPartyShopPurchase, apiDismissPartyShopPurchase, apiSavePartyDrafts, apiWithdrawWhip, apiRestoreWhip, apiGetWhipRequests, apiApproveWhipRequest, apiDenyWhipRequest, apiRequestExpulsion, apiGetExpulsions, apiApproveExpulsion, apiDenyExpulsion, apiGetPartyElections, apiStartPartyElection, apiNominateForElection, apiVoteInElection, apiOpenElectionVoting, apiCloseElection, apiRunoffElection } from "../api.js";
import { getCharacterContext } from "../engines/core-engine.js";
import { logAction } from "../audit.js";

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

// ── Party Shop catalogue ──────────────────────────────────────────────────────
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
            <div><b>Cash on hand:</b> ${esc(formatMoney(party.treasury?.cash))}</div>
            <div><b>Debt:</b> ${esc(formatMoney(party.treasury?.debt))}</div>
            <div><b>Members:</b> ${esc(Number(party.treasury?.members || 0).toLocaleString("en-GB"))}</div>
            ${(() => {
              const fee = Number(dbParty?.membershipFeeAnnual || dbParty?.membership_fee_annual || 0);
              const members = Number(party.treasury?.members || 0);
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
                    <td style="padding:4px 8px;">${esc(formatMPName(c.name, { appendMP: true, isPrivy: !!(c.is_privy_councillor) }))}</td>
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
                  <li>${esc(formatMPName(n.character_name || n.name || "—", { appendMP: true, isPrivy: !!(n.is_privy_councillor) }))}
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
      ${party.hqUrl ? `<a class="btn" href="${esc(party.hqUrl)}" target="_blank" rel="noopener">Enter Headquarters</a>` : `<span class="muted">Forum link not configured.</span>`}
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
              <div class="muted">By ${esc(d.authorName)} • ${esc(d.createdAt)}</div>
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
              <input id="party-cash" name="cash" type="number" class="input" value="${esc(String(Number(party.treasury?.cash || 0)))}">
            </div>
            <div>
              <label class="label" for="party-debt">Debt (£)</label>
              <input id="party-debt" name="debt" type="number" class="input" value="${esc(String(Number(party.treasury?.debt || 0)))}">
            </div>
            <div>
              <label class="label" for="party-members">Members</label>
              <input id="party-members" name="members" type="number" class="input" value="${esc(String(Number(party.treasury?.members || 0)))}">
            </div>
            <div>
              <label class="label" for="party-hq-url">Headquarters URL</label>
              <input id="party-hq-url" name="hqUrl" class="input" value="${esc(party.hqUrl || "")}">
            </div>
          </div>
          <button type="submit" class="btn">Save Party Settings</button>
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
          <details open style="margin-bottom:8px;">
            <summary style="cursor:pointer;font-weight:600;font-size:1em;margin-bottom:4px;">${esc(cat)}</summary>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px;margin-top:6px;">
              ${items.map((item) => {
                const price = partyCurrentPrice(item, pi);
                const upkeep = partyCurrentUpkeep(item, pi);
                const purchases = party.partyShopPurchases || [];
                const ownedCount = purchases.filter((p) => p.itemId === item.id).length;
                const maxOwned = item.caps?.maxOwned;
                const atCap = maxOwned != null && ownedCount >= maxOwned;
                const treasury = Number(party.treasury?.cash || 0);
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
                <div><b>Party Treasury:</b> ${formatMoney(Number(party.treasury?.cash || 0))}</div>
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
                <th style="text-align:left;padding:4px 8px;">From</th>
                <th style="text-align:right;padding:4px 8px;">Amount</th>
                <th style="text-align:left;padding:4px 8px;">Note</th>
                <th style="text-align:left;padding:4px 8px;">Sim Date</th>
                <th style="text-align:left;padding:4px 8px;">Real Date</th>
              </tr>
            </thead>
            <tbody>
              ${(state.ledger || []).map((d) => `
                <tr style="border-bottom:1px solid #eee;">
                  <td style="padding:4px 8px;">${esc(d.fromName)}</td>
                  <td style="padding:4px 8px;text-align:right;color:#1a6a1a;"><b>${esc(formatMoney(d.amount))}</b></td>
                  <td style="padding:4px 8px;" class="muted">${esc(d.note || "")}</td>
                  <td style="padding:4px 8px;" class="muted">${d.simMonth ? `${esc(String(d.simMonth))}/${esc(String(d.simYear))}` : "—"}</td>
                  <td style="padding:4px 8px;" class="muted">${esc(typeof d.createdAt === "string" ? new Date(d.createdAt).toLocaleString("en-GB") : "—")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      ` : `<div class="muted-block">No income entries yet.</div>`}
    </section>
    ` : ""}
  `;

  root.querySelector("#party-switch")?.addEventListener("change", async (e) => {
    const next = String(e.currentTarget.value || "");
    if (!next) return;
    state.activeParty = next;
    state.openDraftId = null;
    state.feeMessage = "";
    state.donationMessage = "";
    // Reload DB party data for the newly selected party
    try {
      const [partyResult, charsResult, structureResult, ledgerResult, whipReqResult] = await Promise.all([
        apiGetParty(next).catch(() => null),
        apiGetCharacters({ active: "true" }).catch(() => ({ characters: [] })),
        apiGetPartyStructure(next).catch(() => ({ structure: {}, treasuryOverspend: false })),
        apiGetPartyLedger(next).catch(() => ({ donations: [] })),
        apiGetWhipRequests(next, "pending").catch(() => ({ requests: [] })),
      ]);
      if (partyResult?.party) state.dbState = { ...state.dbState, party: partyResult.party };
      const partyNameLower = next.toLowerCase();
      state.dbState.partyCharacters = (charsResult.characters || []).filter(
        (c) => (c.party || "").toLowerCase() === partyNameLower
      );
      state.dbState.partyStructure = structureResult.structure || {};
      state.dbState.treasuryOverspend = !!structureResult.treasuryOverspend;
      state.ledger = Array.isArray(ledgerResult.donations) ? ledgerResult.donations : [];
      state.dbState.whipRequests = Array.isArray(whipReqResult.requests) ? whipReqResult.requests : [];
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
    const newHqUrl   = String(fd.get("hqUrl")   || "").trim();

    const partyId = state.activeParty;

    // Persist party leader to DB (admin/mod only, authoritative source)
    try {
      await apiSetPartyLeader(partyId, leaderId || null);
    } catch (err) {
      console.warn("[party-control-form] leader save failed:", err.message);
    }

    // Persist treasury + hqUrl to DB (authoritative source)
    try {
      await apiSetPartyTreasury(partyId, { cash: newCash, debt: newDebt, members: newMembers, hqUrl: newHqUrl || null });
    } catch (err) {
      console.warn("[party-control-form] treasury save failed:", err.message);
    }

    // Re-fetch party from DB to sync leader info
    try {
      const { party: updated } = await apiGetParty(partyId);
      state.dbState = { ...state.dbState, party: updated };
      party.leader.name        = updated.leader_name  || "";
      party.leader.avatar      = updated.leader_avatar || "";
      party.leader.characterId = updated.leader_id    || "";
    } catch (err) {
      console.warn("[party-control-form] re-fetch party failed:", err.message);
    }

    party.treasury.cash    = newCash;
    party.treasury.debt    = newDebt;
    party.treasury.members = newMembers;
    party.hqUrl = newHqUrl || party.hqUrl;
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
    whipMessage: "",
    expulsionMessage: "",
    electionMessage: "",
    expulsions: [],
    elections: [],
    currentElection: null,
    ledger: [],
    priceIndex: 1.0,
    dbState: { party: null, partyCharacters: [], sessionCharId: "", partyStructure: null, treasuryOverspend: false }
  };

  // Load DB-backed party data
  const partyId = state.activeParty || Object.keys(data.party?.parties || {})[0] || "";
  if (partyId) {
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

      // Load governance data: elections, pending expulsions, and pending whip requests
      const [electionsResult, expulsionsResult, whipReqResult] = await Promise.all([
        apiGetPartyElections(partyId).catch(() => ({ elections: [] })),
        apiGetExpulsions("pending").catch(() => ({ expulsions: [] })),
        apiGetWhipRequests(partyId, "pending").catch(() => ({ requests: [] })),
      ]);
      state.elections = electionsResult.elections || [];
      const openStatuses = ["nominations", "voting", "runoff"];
      state.currentElection = state.elections.find((e) => openStatuses.includes(e.status)) || null;
      state.expulsions = (expulsionsResult.expulsions || []).filter(
        (ex) => (ex.party || "").toLowerCase() === partyId.toLowerCase()
      );
      state.dbState.whipRequests = Array.isArray(whipReqResult.requests) ? whipReqResult.requests : [];
    } catch (e) {
      console.warn("[initPartyPage] DB load failed:", e.message);
    }
  }

  render(data, state);
}
