import { esc } from "../ui.js";
import { nowStamp, isLoggedIn } from "../core.js";
import { canManage } from "../permissions.js";
import { getSimDate } from "../clock.js";
import { getEducationOptions, getCareerOptions, getFamilyOptions } from "../character-enums.js";
import { seatTaken, allConstituenciesForPartyWithStatus, renderConstituencyOptions } from "../constituency-utils.js";
import { apiSubmitBioChange, apiSubmitAvatarChange, apiGetShopPriceIndex, apiUpdateCharacterShopUpkeep, apiGetCharacterAffiliations, apiSubmitCharacterAffiliations, apiGetMyFinance, apiGetCharacterFinance, apiSubmitProfileChange, apiAddShopPurchase, apiRemoveShopPurchase, apiSellShopPurchase, apiDismissShopPurchase, apiAddAdditionalRevenue, apiRemoveAdditionalRevenue, apiAdminUpdateCharacterProfile, apiGetCharacters, apiGetEnums, apiGetCharacterOfficesHeld, apiGetConstituencies, apiGetMyCharacters, apiGetMyApplications, apiApplyCharacter, apiGetMyPoliticalState, apiGetPartyFactionClimate, apiGetPartyFactions, apiGetMyFaction, apiSwitchMyFaction } from "../api.js";
import { logAction } from "../audit.js";

// ── Affiliations catalogue ────────────────────────────────────────────────────
const AFFILIATIONS_CATALOG = [
  { category: "Trade Unions (Major UK)", items: [
    { id: "trade_unions_unite",  name: "Unite the Union",                       monthly_fee: 25 },
    { id: "trade_unions_unison", name: "UNISON",                                monthly_fee: 25 },
    { id: "trade_unions_gmb",    name: "GMB",                                   monthly_fee: 25 },
    { id: "trade_unions_cwu",    name: "CWU (Communication Workers Union)",     monthly_fee: 25 },
    { id: "trade_unions_rmt",    name: "RMT",                                   monthly_fee: 25 },
    { id: "trade_unions_usdaw",  name: "USDAW",                                 monthly_fee: 25 },
    { id: "trade_unions_nasuwt", name: "NASUWT",                                monthly_fee: 25 },
    { id: "trade_unions_neu",    name: "NEU (National Education Union)",        monthly_fee: 25 },
    { id: "trade_unions_bma",    name: "BMA",                                   monthly_fee: 25 },
    { id: "trade_unions_tssa",   name: "TSSA",                                  monthly_fee: 25 },
  ]},
  { category: "Think Tanks", items: [
    { id: "think_tanks_fabian",      name: "Fabian Society",                    monthly_fee: 50 },
    { id: "think_tanks_iea",         name: "Institute of Economic Affairs",     monthly_fee: 50 },
    { id: "think_tanks_policy_exch", name: "Policy Exchange",                   monthly_fee: 50 },
    { id: "think_tanks_cps",         name: "Centre for Policy Studies",         monthly_fee: 50 },
    { id: "think_tanks_ifg",         name: "Institute for Government",          monthly_fee: 50 },
    { id: "think_tanks_demos",       name: "Demos",                             monthly_fee: 50 },
    { id: "think_tanks_resolution",  name: "Resolution Foundation",             monthly_fee: 50 },
    { id: "think_tanks_asi",         name: "Adam Smith Institute",              monthly_fee: 50 },
    { id: "think_tanks_chatham",     name: "Chatham House",                     monthly_fee: 50 },
    { id: "think_tanks_ippr",        name: "IPPR",                              monthly_fee: 50 },
  ]},
  { category: "Advocacy / Campaign Groups", items: [
    { id: "advocacy_greenpeace",  name: "Greenpeace UK",                        monthly_fee: 15 },
    { id: "advocacy_foe",         name: "Friends of the Earth",                 monthly_fee: 15 },
    { id: "advocacy_liberty",     name: "Liberty",                              monthly_fee: 15 },
    { id: "advocacy_amnesty",     name: "Amnesty International",                monthly_fee: 15 },
    { id: "advocacy_stonewall",   name: "Stonewall",                            monthly_fee: 15 },
    { id: "advocacy_countryside", name: "Countryside Alliance",                 monthly_fee: 15 },
    { id: "advocacy_taxpayers",   name: "TaxPayers' Alliance",                  monthly_fee: 15 },
    { id: "advocacy_openrights",  name: "Open Rights Group",                   monthly_fee: 15 },
    { id: "advocacy_shelter",     name: "Shelter",                              monthly_fee: 15 },
    { id: "advocacy_cnd",         name: "Campaign for Nuclear Disarmament",     monthly_fee: 15 },
  ]},
  { category: "Business / Industry", items: [
    { id: "business_cbi",    name: "CBI",                                       monthly_fee: 75 },
    { id: "business_fsb",    name: "Federation of Small Businesses",            monthly_fee: 75 },
    { id: "business_iod",    name: "Institute of Directors",                    monthly_fee: 75 },
    { id: "business_bcc",    name: "British Chambers of Commerce",              monthly_fee: 75 },
    { id: "business_techuk", name: "TechUK",                                   monthly_fee: 75 },
    { id: "business_nfu",    name: "National Farmers Union",                    monthly_fee: 75 },
  ]},
  { category: "Professional Associations", items: [
    { id: "prof_law_society", name: "Law Society",                              monthly_fee: 30 },
    { id: "prof_bar_council", name: "Bar Council",                              monthly_fee: 30 },
    { id: "prof_rcn",         name: "Royal College of Nursing",                 monthly_fee: 30 },
    { id: "prof_cipd",        name: "Chartered Institute of Personnel & Development", monthly_fee: 30 },
  ]},
  { category: "Faith / Ethical", items: [
    { id: "faith_coe_synod",       name: "Church of England Synod Member",      monthly_fee: 10 },
    { id: "faith_catholic_social", name: "Catholic Social Action Network",      monthly_fee: 10 },
    { id: "faith_mcb",             name: "Muslim Council of Britain",           monthly_fee: 10 },
    { id: "faith_jlc",             name: "Jewish Leadership Council",           monthly_fee: 10 },
  ]},
  { category: "International", items: [
    { id: "intl_nato_pa",        name: "NATO Parliamentary Assembly",           monthly_fee: 20 },
    { id: "intl_council_europe", name: "Council of Europe",                     monthly_fee: 20 },
    { id: "intl_cpa",            name: "Commonwealth Parliamentary Association", monthly_fee: 20 },
    { id: "intl_wef",            name: "World Economic Forum",                  monthly_fee: 20 },
  ]},
  { category: "Pressure Groups", items: [
    { id: "pressure_migwatch",    name: "Migration Watch UK",                   monthly_fee: 10 },
    { id: "pressure_brit_future", name: "British Future",                       monthly_fee: 10 },
    { id: "pressure_ifs",         name: "Institute of Fiscal Studies",          monthly_fee: 10 },
    { id: "pressure_rbl",         name: "Royal British Legion",                 monthly_fee: 10 },
    { id: "pressure_ukfinance",   name: "UK Finance",                           monthly_fee: 10 },
  ]},
  { category: "Soft Affiliations", items: [
    { id: "soft_rotary",    name: "Rotary Club",                                monthly_fee: 5 },
    { id: "soft_local_biz", name: "Local Business Network",                     monthly_fee: 5 },
    { id: "soft_alumni",    name: "University Alumni Association",              monthly_fee: 5 },
  ]},
];

const PLAYABLE_FACTION_PARTIES = new Set(["Conservative", "Labour", "Liberal Democrat"]);

const PROFILE_FIELDS = [
  { key: "dateOfBirth", label: "Date of birth" },
  { key: "education", label: "Education" },
  { key: "careerBackground", label: "Career background" },
  { key: "family", label: "Family" },
  { key: "constituency", label: "Constituency" },
  { key: "party", label: "Party" },
  { key: "yearFirstElected", label: "Year first elected" }
];


const GOVERNMENT_OFFICE_LABELS = {
  "prime-minister": "Prime Minister",
  "chancellor": "Chancellor of the Exchequer",
  "home": "Home Secretary",
  "foreign": "Foreign Secretary",
  "trade": "Secretary of State for Business and Trade",
  "defence": "Defence Secretary",
  "welfare": "Secretary of State for Work and Pensions",
  "education": "Education Secretary",
  "env-agri": "Secretary of State for the Environment and Agriculture",
  "health": "Health Secretary",
  "eti": "Secretary of State for Transport and Infrastructure",
  "culture": "Secretary of State for Culture, Media and Sport",
  "home-nations": "Secretary of State for the Home Nations",
  "leader-commons": "Leader of the House of Commons"
};

const SHADOW_OFFICE_LABELS = {
  "leader-opposition": "Leader of the Opposition",
  "shadow-chancellor": "Shadow Chancellor",
  "shadow-home": "Shadow Home Secretary",
  "shadow-foreign": "Shadow Foreign Secretary",
  "shadow-trade": "Shadow Business & Trade",
  "shadow-defence": "Shadow Defence Secretary",
  "shadow-welfare": "Shadow Work & Pensions",
  "shadow-education": "Shadow Education Secretary",
  "shadow-env-agri": "Shadow Environment & Agriculture",
  "shadow-health": "Shadow Health Secretary",
  "shadow-eti": "Shadow Transport & Infrastructure",
  "shadow-culture": "Shadow Culture, Media & Sport",
  "shadow-home-nations": "Shadow Home Nations",
  "shadow-leader-commons": "Shadow Leader of the House"
};

function getPublicOfficesForCharacter(data, characterName, profileParty = "") {
  const target = String(characterName || "").trim();
  if (!target) return [];

  const result = [];
  const seen = new Set();
  const addOffice = (scope, key, title) => {
    const id = `${scope}:${key}`;
    if (!title || seen.has(id)) return;
    seen.add(id);
    result.push({ scope, title });
  };

  for (const o of (data?.government?.offices || [])) {
    if (String(o?.holderName || "").trim() !== target) continue;
    const id = String(o?.id || "");
    addOffice("Government", id, GOVERNMENT_OFFICE_LABELS[id] || id || "Government Office");
  }

  for (const o of (data?.opposition?.offices || [])) {
    if (String(o?.holderName || "").trim() !== target) continue;
    const id = String(o?.id || "");
    addOffice("Opposition", id, SHADOW_OFFICE_LABELS[id] || id || "Opposition Office");
  }

  const targetParty = String(profileParty || "").trim();
  const partyEntries = Object.entries(data?.parties || {});
  for (const [partyName, party] of partyEntries) {
    if (targetParty && String(partyName) !== targetParty) continue;
    if (String(party?.leader?.name || "").trim() === target) {
      addOffice("Party", `leader:${partyName}`, `${partyName} Party Leader`);
    }
  }

  const playerRecord = (Array.isArray(data?.players) ? data.players : []).find((pl) => String(pl?.name || "").trim() === target);
  if (playerRecord?.partyLeader) {
    const partyName = String(playerRecord.party || targetParty || "Party").trim();
    addOffice("Party", `player:${partyName}`, `${partyName} Party Leader`);
  }

  if (String(data?.currentCharacter?.name || "").trim() === target && data?.currentCharacter?.partyLeader) {
    const partyName = String(data?.currentCharacter?.party || targetParty || "Party").trim();
    addOffice("Party", `current:${partyName}`, `${partyName} Party Leader`);
  }

  return result;
}

const FINANCIAL_BACKGROUND_LABELS = {
  1:  "1 – Poverty",
  2:  "2 – Financially Strained",
  3:  "3 – Lower Working Class",
  4:  "4 – Skilled Working / Lower Middle",
  5:  "5 – Solid Middle Class",
  6:  "6 – Upper Middle Class",
  7:  "7 – Affluent Professional",
  8:  "8 – High Net Worth Individual",
  9:  "9 – Top 5%",
  10: "10 – Top 1%",
};

// ── Personal Shop catalogue ───────────────────────────────────────────────────
// Schema: id, name, category, basePrice1997, baseMonthlyUpkeep1997,
//         caps, effects[], riskModifier?, flavour
// Computed at render time: price = round(base * priceIndex), upkeep = round(baseUpkeep * priceIndex)

const SHOP_ITEMS = [
  // ── A) Constituency & Office ──────────────────────────────────────────────
  {
    id: "const-office-basic",
    name: "Basic Constituency Office Lease",
    category: "Constituency & Office",
    basePrice1997: 8000, baseMonthlyUpkeep1997: 500,
    caps: { maxOwned: 1 },
    effects: [{ type: "constituencyPresence", value: 1 }],
    riskModifier: null,
    flavour: "A modest high-street lease in your constituency. Essential for visible casework and surgeries."
  },
  {
    id: "const-office-refurb",
    name: "Office Refurbishment",
    category: "Constituency & Office",
    basePrice1997: 4500, baseMonthlyUpkeep1997: 0,
    caps: { maxOwned: 1 },
    effects: [{ type: "constituencyPresence", value: 1 }],
    riskModifier: null,
    flavour: "Strip the tired carpet, repaint the walls, add some signage. First impressions matter."
  },
  {
    id: "caseworker-pt",
    name: "Caseworker (Part-Time)",
    category: "Constituency & Office",
    basePrice1997: 0, baseMonthlyUpkeep1997: 600,
    caps: { maxOwned: 2 },
    effects: [{ type: "constituencyCapacity", value: 1 }],
    riskModifier: null,
    flavour: "Three days a week dealing with constituents' housing, benefits, and passport nightmares."
  },
  {
    id: "caseworker-ft",
    name: "Caseworker (Full-Time)",
    category: "Constituency & Office",
    basePrice1997: 0, baseMonthlyUpkeep1997: 1200,
    caps: { maxOwned: 2 },
    effects: [{ type: "constituencyCapacity", value: 2 }],
    riskModifier: null,
    flavour: "Full-time casework support. Vital for high-need seats with complex caseloads."
  },
  {
    id: "parliamentary-researcher",
    name: "Parliamentary Researcher",
    category: "Constituency & Office",
    basePrice1997: 0, baseMonthlyUpkeep1997: 1800,
    caps: { maxOwned: 1 },
    effects: [{ type: "policyResearch", value: 1 }],
    riskModifier: null,
    flavour: "A bright graduate to draft briefings, prep speeches, and make you look like you've read the bill."
  },
  {
    id: "diary-manager",
    name: "Diary Manager",
    category: "Constituency & Office",
    basePrice1997: 0, baseMonthlyUpkeep1997: 1400,
    caps: { maxOwned: 1 },
    effects: [{ type: "efficiencyBoost", value: 1 }],
    riskModifier: null,
    flavour: "Someone to stop you double-booking Select Committee and a school visit in Skegness."
  },
  {
    id: "newsletter-system",
    name: "Local Newsletter System",
    category: "Constituency & Office",
    basePrice1997: 1500, baseMonthlyUpkeep1997: 200,
    caps: { maxOwned: 1 },
    effects: [{ type: "pollingBoost", value: 1 }],
    riskModifier: null,
    flavour: "Regular printed updates to households. Keeps your name front of mind between elections."
  },
  {
    id: "website-upgrade",
    name: "Constituency Website Upgrade",
    category: "Constituency & Office",
    basePrice1997: 1200, baseMonthlyUpkeep1997: 50,
    caps: { maxOwned: 1 },
    effects: [{ type: "pressImpact", value: 5 }],
    riskModifier: null,
    flavour: "Move beyond the Geocities-era design. A professional web presence in 1997 is genuinely novel."
  },
  {
    id: "surgery-hall-hire",
    name: "Community Surgery Hall Hire Credits",
    category: "Constituency & Office",
    basePrice1997: 800, baseMonthlyUpkeep1997: 100,
    caps: { maxOwned: 1 },
    effects: [{ type: "constituencyPresence", value: 1 }],
    riskModifier: null,
    flavour: "Pre-book village hall and community centre slots for monthly public surgeries."
  },
  {
    id: "mobile-office-kit",
    name: "Mobile Office Equipment Kit",
    category: "Constituency & Office",
    basePrice1997: 2500, baseMonthlyUpkeep1997: 0,
    caps: { maxOwned: 1 },
    effects: [{ type: "efficiencyBoost", value: 1 }],
    riskModifier: null,
    flavour: "Laptop, printer, mobile phone, and fax machine. A self-contained office in a bag."
  },

  // ── B) Travel & Logistics ─────────────────────────────────────────────────
  {
    id: "rail-travel-pass",
    name: "Rail Travel Pass",
    category: "Travel & Logistics",
    basePrice1997: 1200, baseMonthlyUpkeep1997: 0,
    caps: { maxOwned: 1 },
    effects: [{ type: "efficiencyBoost", value: 1 }],
    riskModifier: null,
    flavour: "Annual unlimited rail travel between constituency and Westminster. The workhorse of MP logistics."
  },
  {
    id: "chauffeur-service",
    name: "Chauffeur Service",
    category: "Travel & Logistics",
    basePrice1997: 0, baseMonthlyUpkeep1997: 2500,
    caps: { maxOwned: 1 },
    effects: [],
    riskModifier: { scandalExposure: 3 },
    flavour: "A personal driver on retainer. Convenient — but constituents tend to notice."
  },
  {
    id: "first-class-rail",
    name: "First Class Rail Upgrade",
    category: "Travel & Logistics",
    basePrice1997: 2000, baseMonthlyUpkeep1997: 0,
    caps: {},
    effects: [],
    riskModifier: { scandalExposure: 2 },
    flavour: "Charged to expenses, naturally. The buffet car and a quiet seat. What could go wrong?"
  },
  {
    id: "london-second-flat",
    name: "London Second Flat",
    category: "Travel & Logistics",
    basePrice1997: 120000, baseMonthlyUpkeep1997: 800,
    caps: { maxOwned: 1 },
    effects: [{ type: "efficiencyBoost", value: 2 }],
    riskModifier: { scandalExposure: 8 },
    flavour: "A pied-à-terre near Westminster. Extremely useful — and extremely scrutinised."
  },
  {
    id: "hotel-allowance",
    name: "Hotel Allowance Upgrade",
    category: "Travel & Logistics",
    basePrice1997: 2500, baseMonthlyUpkeep1997: 0,
    caps: {},
    effects: [],
    riskModifier: { scandalExposure: 1 },
    flavour: "Upgrade your accommodation allowance for overnight Westminster stays. Nothing extravagant."
  },
  {
    id: "domestic-flight",
    name: "Domestic Flight Allowance",
    category: "Travel & Logistics",
    basePrice1997: 2000, baseMonthlyUpkeep1997: 0,
    caps: {},
    effects: [],
    riskModifier: null,
    flavour: "For constituencies beyond the reach of a sensible train journey. Scotland, Cornwall, etc."
  },
  {
    id: "tour-minibus",
    name: "Constituency Tour Minibus Hire",
    category: "Travel & Logistics",
    basePrice1997: 3500, baseMonthlyUpkeep1997: 0,
    caps: {},
    effects: [{ type: "constituencyPresence", value: 1 }],
    riskModifier: null,
    flavour: "Hire a minibus and do a full constituency tour. Photo opportunities in every market town."
  },
  {
    id: "factfinding-trip",
    name: "International Fact-Finding Trip",
    category: "Travel & Logistics",
    basePrice1997: 7000, baseMonthlyUpkeep1997: 0,
    caps: {},
    effects: [{ type: "policyResearch", value: 1 }],
    riskModifier: { scandalExposure: 4 },
    flavour: "A week in Barbados studying their parliamentary system. Very educational, apparently."
  },

  // ── C) Legal & Compliance ─────────────────────────────────────────────────
  {
    id: "legal-retainer",
    name: "Legal Retainer",
    category: "Legal & Compliance",
    basePrice1997: 4000, baseMonthlyUpkeep1997: 800,
    caps: { maxOwned: 1 },
    effects: [{ type: "scandalDefence", value: 1 }],
    riskModifier: null,
    flavour: "A solicitor on retainer for any unexpected legal difficulties. Preventative, not reactive."
  },
  {
    id: "enhanced-legal",
    name: "Enhanced Legal Team",
    category: "Legal & Compliance",
    basePrice1997: 8000, baseMonthlyUpkeep1997: 2000,
    caps: { maxOwned: 1 },
    effects: [{ type: "scandalDefence", value: 3 }],
    riskModifier: null,
    flavour: "A full legal team for serious matters. Barristers, libel specialists, parliamentary privilege experts."
  },
  {
    id: "compliance-audit",
    name: "Compliance Audit",
    category: "Legal & Compliance",
    basePrice1997: 2500, baseMonthlyUpkeep1997: 0,
    caps: {},
    effects: [{ type: "scandalDefence", value: 1 }],
    riskModifier: null,
    flavour: "An independent review of your expenses, interests, and declarations. Get ahead of the story."
  },
  {
    id: "reputation-firm",
    name: "Reputation Management Firm",
    category: "Legal & Compliance",
    basePrice1997: 7000, baseMonthlyUpkeep1997: 1500,
    caps: { maxOwned: 1 },
    effects: [{ type: "pressImpact", value: 15 }, { type: "scandalDefence", value: 2 }],
    riskModifier: { scandalExposure: 1 },
    flavour: "Specialists in burying bad news and reshaping narratives. Effective — until it leaks."
  },
  {
    id: "crisis-pr",
    name: "Crisis PR Hotline",
    category: "Legal & Compliance",
    basePrice1997: 4500, baseMonthlyUpkeep1997: 500,
    caps: { maxOwned: 1 },
    effects: [{ type: "scandalDefence", value: 2 }],
    riskModifier: null,
    flavour: "24-hour access to a crisis communications team. For when the call comes on a Sunday morning."
  },

  // ── D) Media & Influence ──────────────────────────────────────────────────
  {
    id: "media-trainer",
    name: "Media Training Session",
    category: "Media & Influence",
    basePrice1997: 5000, baseMonthlyUpkeep1997: 0,
    caps: {},
    effects: [{ type: "pressImpact", value: 10 }],
    riskModifier: null,
    flavour: "A professional media coaching session. Camera technique, key messages, handling hostile questions."
  },
  {
    id: "senior-press-adviser",
    name: "Senior Press Adviser",
    category: "Media & Influence",
    basePrice1997: 0, baseMonthlyUpkeep1997: 3500,
    caps: { maxOwned: 1 },
    effects: [{ type: "pressImpact", value: 20 }],
    riskModifier: null,
    flavour: "A former lobby journalist who knows every editor and every trick. Invaluable."
  },
  {
    id: "photography-package",
    name: "Professional Photography Package",
    category: "Media & Influence",
    basePrice1997: 2500, baseMonthlyUpkeep1997: 0,
    caps: {},
    effects: [{ type: "pressImpact", value: 5 }],
    riskModifier: null,
    flavour: "High-quality constituency and Westminster photos for press releases and social media."
  },
  {
    id: "social-media-campaign",
    name: "Targeted Social Media Campaign",
    category: "Media & Influence",
    basePrice1997: 3500, baseMonthlyUpkeep1997: 0,
    caps: {},
    effects: [{ type: "pollingBoost", value: 1 }, { type: "pressImpact", value: 5 }],
    riskModifier: null,
    flavour: "Paid digital targeting in the constituency. Novel in 1997 — cutting edge."
  },
  {
    id: "opinion-column",
    name: "Opinion Column Placement",
    category: "Media & Influence",
    basePrice1997: 1800, baseMonthlyUpkeep1997: 0,
    caps: {},
    effects: [{ type: "pressImpact", value: 8 }],
    riskModifier: null,
    flavour: "A placed opinion piece in a regional or national publication under your byline."
  },
  {
    id: "broadcast-consultant",
    name: "Broadcast Media Consultant",
    category: "Media & Influence",
    basePrice1997: 5500, baseMonthlyUpkeep1997: 1200,
    caps: { maxOwned: 1 },
    effects: [{ type: "pressImpact", value: 15 }],
    riskModifier: null,
    flavour: "Specialist in TV and radio appearances. Knows when to stay quiet and when to attack."
  },
  {
    id: "speechwriting",
    name: "Speechwriting Consultant",
    category: "Media & Influence",
    basePrice1997: 3500, baseMonthlyUpkeep1997: 800,
    caps: { maxOwned: 1 },
    effects: [{ type: "pressImpact", value: 10 }, { type: "policyResearch", value: 1 }],
    riskModifier: null,
    flavour: "Someone to ensure your big speeches land. Also useful for writing things you haven't read."
  },
  {
    id: "podcast-studio",
    name: "Podcast Studio Setup",
    category: "Media & Influence",
    basePrice1997: 7000, baseMonthlyUpkeep1997: 200,
    caps: { maxOwned: 1 },
    effects: [{ type: "pressImpact", value: 5 }, { type: "pollingBoost", value: 1 }],
    riskModifier: null,
    flavour: "An in-office podcast setup. Very forward-thinking for 1997. Your producer is twenty-four."
  },

  // ── E) Frivolous / Expenses-Era Inspired ─────────────────────────────────
  {
    id: "garden-landscaping",
    name: "Garden Landscaping",
    category: "Frivolous",
    basePrice1997: 3500, baseMonthlyUpkeep1997: 0,
    caps: {},
    effects: [],
    riskModifier: { scandalExposure: 3 },
    flavour: "An extensive redesign of the garden at your second home. Charged to office expenses."
  },
  {
    id: "duck-house",
    name: "Ornamental Duck House",
    category: "Frivolous",
    basePrice1997: 1645, baseMonthlyUpkeep1997: 0,
    caps: { maxOwned: 1 },
    effects: [],
    riskModifier: { scandalExposure: 8 },
    flavour: "A hand-crafted floating duck island for the moat. You will never live this down."
  },
  {
    id: "luxury-curtains",
    name: "Luxury Curtains",
    category: "Frivolous",
    basePrice1997: 2500, baseMonthlyUpkeep1997: 0,
    caps: {},
    effects: [],
    riskModifier: { scandalExposure: 4 },
    flavour: "Bespoke hand-sewn drapes for the second home. The Daily Mail will love this."
  },
  {
    id: "home-office-reno",
    name: "Home Office Renovation",
    category: "Frivolous",
    basePrice1997: 5500, baseMonthlyUpkeep1997: 0,
    caps: {},
    effects: [{ type: "efficiencyBoost", value: 1 }],
    riskModifier: { scandalExposure: 3 },
    flavour: "Convert the spare room into a proper study. Claimed under the second home allowance."
  },
  {
    id: "designer-furniture",
    name: "Designer Furniture Allowance",
    category: "Frivolous",
    basePrice1997: 3800, baseMonthlyUpkeep1997: 0,
    caps: {},
    effects: [],
    riskModifier: { scandalExposure: 3 },
    flavour: "Eames chairs, a bespoke desk, and a sofa from a catalogued supplier. Expenses, obviously."
  },
  {
    id: "premium-broadband",
    name: "Premium Broadband Installation",
    category: "Frivolous",
    basePrice1997: 500, baseMonthlyUpkeep1997: 50,
    caps: { maxOwned: 1 },
    effects: [{ type: "efficiencyBoost", value: 1 }],
    riskModifier: null,
    flavour: "64kbps ISDN line. Blazing fast in 1997 — and technically claimable as an office expense."
  },
  {
    id: "chauffeur-car",
    name: "Chauffeur-Driven Car",
    category: "Frivolous",
    basePrice1997: 35000, baseMonthlyUpkeep1997: 1800,
    caps: { maxOwned: 1 },
    effects: [],
    riskModifier: { scandalExposure: 6 },
    flavour: "A Jaguar with a driver. Immensely practical. Utterly indefensible to a tabloid journalist."
  },
  {
    id: "personal-branding",
    name: "Personal Branding Consultant",
    category: "Frivolous",
    basePrice1997: 4500, baseMonthlyUpkeep1997: 600,
    caps: { maxOwned: 1 },
    effects: [{ type: "pressImpact", value: 8 }],
    riskModifier: { scandalExposure: 2 },
    flavour: "Logo, colour palette, personal stationery, brand guidelines. For the MP as a product."
  },
  {
    id: "luxury-watch",
    name: "Luxury Watch Purchase",
    category: "Frivolous",
    basePrice1997: 4200, baseMonthlyUpkeep1997: 0,
    caps: {},
    effects: [],
    riskModifier: { scandalExposure: 4 },
    flavour: "A Rolex or Patek Philippe. Not claimable — but you bought it anyway. People notice."
  },

  // ── F) Property & Investment ──────────────────────────────────────────────
  {
    id: "rental-property-reno",
    name: "Rental Property Renovation",
    category: "Property & Investment",
    basePrice1997: 22000, baseMonthlyUpkeep1997: 0,
    caps: {},
    effects: [{ type: "additionalRevenue", value: 1 }],
    riskModifier: { scandalExposure: 2 },
    flavour: "Refurbish a buy-to-let between tenancies. Maximise the rental yield — and the optics risk."
  },
  {
    id: "commercial-unit",
    name: "Commercial Unit Purchase",
    category: "Property & Investment",
    basePrice1997: 80000, baseMonthlyUpkeep1997: 0,
    caps: { maxOwned: 2 },
    effects: [{ type: "additionalRevenue", value: 2 }],
    riskModifier: { scandalExposure: 3 },
    flavour: "A freehold commercial unit — shop, office, storage. Diversify the portfolio."
  },
  {
    id: "holiday-let",
    name: "Holiday Let Investment",
    category: "Property & Investment",
    basePrice1997: 55000, baseMonthlyUpkeep1997: 300,
    caps: { maxOwned: 2 },
    effects: [{ type: "additionalRevenue", value: 2 }],
    riskModifier: { scandalExposure: 4 },
    flavour: "A cottage in Cornwall or a flat in Bath. Good returns — better if no one notices."
  },
  {
    id: "property-management",
    name: "Property Management Service",
    category: "Property & Investment",
    basePrice1997: 0, baseMonthlyUpkeep1997: 400,
    caps: { maxOwned: 1 },
    effects: [{ type: "efficiencyBoost", value: 1 }],
    riskModifier: null,
    flavour: "Let an agent handle everything. Tenant complaints, repairs, rent collection. Hands-off."
  },
  {
    id: "mortgage-overpayment",
    name: "Mortgage Overpayment",
    category: "Property & Investment",
    basePrice1997: 5000, baseMonthlyUpkeep1997: 0,
    caps: {},
    effects: [],
    riskModifier: null,
    flavour: "Pay down the mortgage on the second home — using the second home allowance. Technically legal."
  },

  // ── G) Political Power Tools ──────────────────────────────────────────────
  {
    id: "policy-dossier",
    name: "Policy Research Dossier Commission",
    category: "Political Power Tools",
    basePrice1997: 5500, baseMonthlyUpkeep1997: 0,
    caps: {},
    effects: [{ type: "policyResearch", value: 2 }],
    riskModifier: null,
    flavour: "Commission a specialist research dossier on a policy area. Useful for Select Committees and PMQs prep."
  },
  {
    id: "lobbying-engagement",
    name: "Lobbying Consultancy Engagement",
    category: "Political Power Tools",
    basePrice1997: 9000, baseMonthlyUpkeep1997: 1500,
    caps: { maxOwned: 1 },
    effects: [{ type: "policyResearch", value: 1 }],
    riskModifier: { scandalExposure: 5 },
    flavour: "Retain a lobbying firm for access and intelligence. Valuable. Registerable. Risky."
  },
  {
    id: "think-tank-membership",
    name: "Think Tank Membership",
    category: "Political Power Tools",
    basePrice1997: 2500, baseMonthlyUpkeep1997: 500,
    caps: { maxOwned: 1 },
    effects: [{ type: "policyResearch", value: 1 }, { type: "pressImpact", value: 5 }],
    riskModifier: null,
    flavour: "Associate membership of a major policy institute. Conferences, papers, and influential contacts."
  },
  {
    id: "private-members-club",
    name: "Private Member's Club Membership",
    category: "Political Power Tools",
    basePrice1997: 1200, baseMonthlyUpkeep1997: 200,
    caps: { maxOwned: 1 },
    effects: [{ type: "pollingBoost", value: 1 }],
    riskModifier: { scandalExposure: 1 },
    flavour: "The Garrick, Groucho, or Reform Club. Networking and discretion — old-money Westminster."
  },
  {
    id: "grant-microfund",
    name: "Constituency Grant Micro-Fund",
    category: "Political Power Tools",
    basePrice1997: 10000, baseMonthlyUpkeep1997: 0,
    caps: {},
    effects: [{ type: "pollingBoost", value: 2 }, { type: "constituencyPresence", value: 1 }],
    riskModifier: null,
    flavour: "Set up a small grants fund for local community projects. Visible, popular, and genuinely good."
  },
];

// Convert a stored date string (various formats) to YYYY-MM-DD for <input type="date">.
// Returns "" if the date cannot be parsed or is invalid.
function toDateInputValue(stored) {
  if (!stored) return "";
  // Already YYYY-MM-DD — validate it by parsing
  if (/^\d{4}-\d{2}-\d{2}$/.test(stored)) {
    const parsed = new Date(stored + "T00:00:00");
    if (!isNaN(parsed.getTime())) return stored;
    return "";
  }
  const parsed = new Date(stored);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return "";
}

// Compute aggregate modifiers for a profile from its purchases.
// Handles both the new effects[] format and legacy modifiers/scrutinyRisk format.
// priceIndex is used to estimate inflation-adjusted annual revenue from additionalRevenue items.
function computeModifiers(profile, priceIndex = 1) {
  const purchases = Array.isArray(profile.shopPurchases) ? profile.shopPurchases : [];
  let pressImpactPct       = 0;
  let pollingBoostPct      = 0;
  let scrutinyScore        = 0;
  let efficiencyBoost      = 0;
  let constituencyPresence = 0;
  let constituencyCapacity = 0;
  let policyResearch       = 0;
  let scandalDefence       = 0;
  let estimatedAnnualRevenue = 0;

  for (const p of purchases) {
    // New effects[] format
    if (Array.isArray(p.effects)) {
      for (const e of p.effects) {
        const v = Number(e.value || 0);
        if (e.type === "pressImpact")         pressImpactPct       += v;
        if (e.type === "pollingBoost")         pollingBoostPct      += v;
        if (e.type === "efficiencyBoost")      efficiencyBoost      += v;
        if (e.type === "constituencyPresence") constituencyPresence += v;
        if (e.type === "constituencyCapacity") constituencyCapacity += v;
        if (e.type === "policyResearch")       policyResearch       += v;
        if (e.type === "scandalDefence")       scandalDefence       += v;
        if (e.type === "additionalRevenue") {
          // Estimate annual revenue: 20% of current price (base_price × priceIndex).
          // Look up base_price from the purchase record first; fall back to SHOP_ITEMS catalog.
          const baseP = Number(p.basePrice || 0);
          if (baseP > 0) {
            estimatedAnnualRevenue += Math.round(baseP * priceIndex * 0.20);
          } else {
            // Legacy: try SHOP_ITEMS catalog lookup
            const catalogItem = SHOP_ITEMS.find((i) => i.id === (p.itemId || p.id));
            if (catalogItem) {
              estimatedAnnualRevenue += Math.round(catalogItem.basePrice1997 * priceIndex * 0.20);
            } else {
              // Final fallback: 20% of stored paid price (static)
              estimatedAnnualRevenue += Math.round(Number(p.price || 0) * 0.20);
            }
          }
        }
      }
    }
    // Legacy modifiers format (backward compat)
    pressImpactPct  += Number(p.modifiers?.pressImpactPct  || 0);
    pollingBoostPct += Number(p.modifiers?.pollingBoostPct || 0);
    // New riskModifier format + legacy scrutinyRisk
    scrutinyScore += Number(p.riskModifier?.scandalExposure || p.scrutinyRisk || 0);
  }
  return {
    pressImpactPct, pollingBoostPct, scrutinyScore,
    efficiencyBoost, constituencyPresence, constituencyCapacity,
    policyResearch, scandalDefence, estimatedAnnualRevenue,
  };
}

// Compute total monthly upkeep from active purchases (using priceIndex for new items).
function computeMonthlyUpkeep(profile) {
  const purchases = Array.isArray(profile.shopPurchases) ? profile.shopPurchases : [];
  return purchases.reduce((sum, p) => sum + Number(p.monthlyUpkeep || 0), 0);
}

// Compute price using priceIndex (falls back to legacy price field).
function currentPrice(item, priceIndex) {
  return Math.round(item.basePrice1997 * priceIndex);
}
function currentUpkeep(item, priceIndex) {
  return Math.round(item.baseMonthlyUpkeep1997 * priceIndex);
}

// Persist computed modifiers to state (used by press/polling pipeline).
function syncModifiers(data, profileName, priceIndex = 1) {
  const profile = data.personal?.profiles?.[profileName];
  if (!profile) return;
  const mods = computeModifiers(profile, priceIndex);
  data.effects ??= {};
  data.effects.modifiers ??= {};
  data.effects.modifiers[profileName] = mods;
  profile.modifiers = mods;
}

/**
 * Returns the active press-impact modifier percentage for the given character name.
 * Used by press.js to scale release effectiveness.
 */
export function getPressImpactModifier(data, characterName) {
  const name = String(characterName || "").trim();
  return Number(data?.effects?.modifiers?.[name]?.pressImpactPct || 0);
}

function money(n) {
  const val = Number(n || 0);
  return `£${val.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getCharacterName(data) {
  return String(data?.currentCharacter?.name || "").trim();
}

function getCharacterParty(data) {
  return String(data?.currentCharacter?.party || "").trim();
}

function normalisePersonal(data) {
  data.personal ??= {};
  data.personal.profiles ??= {};

  const name = getCharacterName(data);
  if (!name) return;

  data.personal.profiles[name] ??= {
    name,
    avatar: "",
    profile: {
      dateOfBirth: "",
      education: "",
      careerBackground: "",
      family: "",
      constituency: String(data?.currentCharacter?.constituency || "").trim(),
      party: getCharacterParty(data) || "",
      yearFirstElected: ""
    },
    salaryAnnual: 0,
    bankBalance: 0,
    financialBackgroundLevel: "",
    affiliations: "",
    additionalRevenue: [],
    nextRevenueId: 1,
    shopPurchases: [],
    modifiers: { pressImpactPct: 0, pollingBoostPct: 0, scrutinyScore: 0 },
    lastSundayCreditAt: "",
    updatedAt: nowStamp()
  };

  for (const profile of Object.values(data.personal.profiles)) {
    profile.name = String(profile.name || "").trim();
    profile.avatar = String(profile.avatar || "").trim();
    profile.avatarAttribution = String(profile.avatarAttribution || "").trim();
    profile.profile ??= {};
    for (const f of PROFILE_FIELDS) {
      profile.profile[f.key] = String(profile.profile[f.key] || "").trim();
    }
    profile.salaryAnnual = Number(profile.salaryAnnual || 0);
    profile.bankBalance = Number(profile.bankBalance || 0);
    profile.financialBackgroundLevel = String(profile.financialBackgroundLevel || "").trim();
    profile.affiliations = String(profile.affiliations || "").trim();
    profile.additionalRevenue = Array.isArray(profile.additionalRevenue) ? profile.additionalRevenue : [];
    profile.nextRevenueId = Number(profile.nextRevenueId || 1);
    profile.lastSundayCreditAt = String(profile.lastSundayCreditAt || "");
    profile.shopPurchases = Array.isArray(profile.shopPurchases) ? profile.shopPurchases : [];

    for (const rev of profile.additionalRevenue) {
      // Accept both DB schema (label/annualAmount) and legacy state schema (source/annualRevenue)
      // rev.id is a UUID string from DB or a numeric from legacy state; keep as-is (don't coerce to 0)
      rev.id = rev.id ?? null;
      rev.source = String(rev.source || rev.label || "").trim();
      rev.label  = rev.source;
      rev.annualRevenue = Number(rev.annualRevenue || rev.annualAmount || 0);
      rev.annualAmount  = rev.annualRevenue;
    }

    for (const p of profile.shopPurchases) {
      p.itemId = String(p.itemId || "");
      // DB returns itemName; legacy state uses name
      p.name = String(p.name || p.itemName || "");
      p.itemName = p.name;
      p.price = Number(p.price || 0);
      p.monthlyUpkeep = Number(p.monthlyUpkeep || 0);
      p.purchasedAt = String(p.purchasedAt || "");
      p.effects = Array.isArray(p.effects) ? p.effects : [];
      p.riskModifier = p.riskModifier || null;
      // Backward compat: keep legacy fields if present
      p.modifiers ??= { pressImpactPct: 0, pollingBoostPct: 0 };
      p.scrutinyRisk = Number(p.scrutinyRisk || 0);
    }

    // Recompute modifiers from purchases.
    profile.modifiers = computeModifiers(profile);
  }

  // Sync bio and display fields from DB character record if available.
  const dbChar = data?.currentCharacter;
  if (dbChar && dbChar.name === name) {
    const p = data.personal.profiles[name];
    if (p) {
      if (dbChar.bio != null || dbChar.personal_background != null) {
        p.bio = String(dbChar.bio ?? dbChar.personal_background ?? p.bio ?? "");
      }
      // Sync DB creation fields into the profile display (do not overwrite with empty string).
      if (dbChar.dateOfBirth)      p.profile.dateOfBirth      = dbChar.dateOfBirth;
      if (dbChar.education)        p.profile.education        = dbChar.education;
      if (dbChar.careerBackground) p.profile.careerBackground = dbChar.careerBackground;
      if (dbChar.family)           p.profile.family           = dbChar.family;
      if (dbChar.constituency)     p.profile.constituency     = dbChar.constituency;
      if (dbChar.party)            p.profile.party            = dbChar.party;
      if (dbChar.yearFirstElected) p.profile.yearFirstElected = dbChar.yearFirstElected;
      if (dbChar.avatar)           p.avatar                   = dbChar.avatar;
      if (dbChar.avatarAttribution != null) p.avatarAttribution = String(dbChar.avatarAttribution);
      // Sync financial background level and twitter handle from DB character record
      if (dbChar.financialBackgroundLevel != null && dbChar.financialBackgroundLevel !== "") {
        p.financialBackgroundLevel = String(dbChar.financialBackgroundLevel);
      }
      if (dbChar.twitterHandle != null) p.twitterHandle = dbChar.twitterHandle;
      // Sync canonical display_name from the server-authoritative current character.
      if (dbChar.display_name) p.display_name = dbChar.display_name;
    }
  }

  // Keep effects.modifiers in sync.
  data.effects ??= {};
  data.effects.modifiers ??= {};
  for (const [pName, profile] of Object.entries(data.personal.profiles)) {
    data.effects.modifiers[pName] = profile.modifiers;
  }
}

function biMonthlyCreditAmount(profile, mods) {
  const extraAnnual = profile.additionalRevenue.reduce((sum, r) => sum + Number(r.annualRevenue || 0), 0);
  const investmentIncome = Number(mods?.estimatedAnnualRevenue || 0);
  return (Number(profile.salaryAnnual || 0) + extraAnnual + investmentIncome) / 6;
}

function render(data, state) {
  const host = document.getElementById("personal-root") || document.querySelector("main.wrap");
  if (!host) return;

  normalisePersonal(data);
  const manager = canManage(data);
  const name = getCharacterName(data);
  if (!name) {
    const enums = state.enums ?? {};
    const EDUCATION_OPTIONS = getEducationOptions(enums);
    const CAREER_OPTIONS = getCareerOptions(enums);
    const FAMILY_OPTIONS = getFamilyOptions(enums);
    const HOME_TYPES = enums.homeTypes ?? [
      "Studio Flat", "One-Bed Flat", "Two-Bed Flat", "Terraced House", "End-Terrace",
      "Semi-Detached House", "Detached Suburban House", "Townhouse",
      "Country House", "Country Estate", "Mansion"
    ];
    const PROPERTY_VALUES = [
      "Under £100,000", "£100,001 to £200,000", "£200,001 to £300,000",
      "£300,001 to £400,000", "£400,001 to £500,000", "Over £500,000"
    ];
    const RENTAL_TYPES = enums.rentalTypes ?? [
      "Single Room Let", "Studio Flat", "One/Two-Bed Flat", "Terraced House",
      "Semi-Detached House", "Detached House",
      "High Street Retail Unit", "Office Unit", "Warehouse", "Holiday Let"
    ];
    const RENTAL_STATUSES = enums.rentalStatuses ?? ["Occupied", "Vacant", "Under renovation"];

    const dbChars = Array.isArray(state.dbState?.myCharacters) ? state.dbState.myCharacters : [];
    const dbMyApps = Array.isArray(state.dbState?.myApplications) ? state.dbState.myApplications : [];
    const hasActiveOwned = dbChars.some((c) => c.is_active);
    const pendingByCurrent = dbMyApps.filter((a) => a.status === "pending");
    const dbActiveChar = dbChars.find((c) => c.is_active);

    host.innerHTML = `
      <div class="bbc-masthead"><div class="bbc-title">Your Character</div></div>
      <section class="panel">
        <h2 style="margin-top:0;">Create Character</h2>
        ${(hasActiveOwned || pendingByCurrent.length > 0) ? `
          <div class="tile muted-block" style="margin-bottom:10px;">
            ${hasActiveOwned
              ? `<b>Create Character</b> — You already have an active character (<b>${esc(dbActiveChar?.name || "")}</b>). You cannot apply for a new one while one is active.`
              : `<b>Create Character</b> — Your character application is currently pending moderator review. You cannot submit another until it is resolved.`}
          </div>
        ` : `
        <div class="tile" style="margin-bottom:10px;">
          <p class="muted" style="margin:0;">You don't have an active character yet. Submit your main character for moderator approval.</p>
        </div>
        <form id="create-character-form" class="tile" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;">
          <input class="input" name="name" placeholder="Name" required>
          <input class="input" type="date" name="date_of_birth" required>
          <select class="input" name="education" required><option value="">Education level</option>${EDUCATION_OPTIONS.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}</select>
          <select class="input" name="career_background" required><option value="">Pre-MP Career</option>${CAREER_OPTIONS.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}</select>
          <select class="input" name="family" required><option value="">Family Status</option>${FAMILY_OPTIONS.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}</select>
          <select class="input" name="party" id="char-party-select" required>
            <option value="">Select party</option><option value="Conservative">Conservative</option><option value="Labour">Labour</option>${!data.adminSettings.libDemClosedToNewChars ? `<option value="Liberal Democrat">Liberal Democrat</option>` : ""}
          </select>
          <select class="input" name="constituency" id="char-constituency-select" required><option value="">Select party first</option></select>
          <select class="input" name="faction_id" id="char-faction-select" required><option value="">Select party first</option></select>
          <input class="input" name="twitter_handle" placeholder="Twitter handle (without @, optional)">
          <input class="input" name="avatar" placeholder="Avatar URL (optional)">
          <input class="input" name="avatar_attribution" placeholder="Who is your avatar? (required, e.g. Alan Rickman)" required>
          <input class="input" name="year_first_elected" placeholder="Year first elected" required>
          <textarea class="input" name="bio" placeholder="Biography (max 2000 characters)" maxlength="2000" required style="grid-column:1/-1;resize:vertical;min-height:80px;"></textarea>
          <select class="input" name="financial_background_level" required>
            <option value="">Financial background</option>${(state.enums?.financialLevels ?? [{level:1,label:"1 – Poverty"},{level:2,label:"2 – Financially Strained"},{level:3,label:"3 – Lower Working Class"},{level:4,label:"4 – Skilled Working / Lower Middle"},{level:5,label:"5 – Solid Middle Class"},{level:6,label:"6 – Upper Middle Class"},{level:7,label:"7 – Affluent Professional"},{level:8,label:"8 – High Net Worth Individual"},{level:9,label:"9 – Top 5%"},{level:10,label:"10 – Top 1%"}]).map((fl)=>`<option value="${esc(String(fl.level))}">${esc(fl.label)}</option>`).join("")}
          </select>
          <fieldset style="grid-column:1/-1;border:1px solid var(--border,#ccc);padding:8px;border-radius:4px;"><legend><b>Primary Home</b></legend><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;"><select class="input" name="home_type"><option value="">Select home type (optional)</option>${HOME_TYPES.map((t)=>`<option value="${esc(t)}">${esc(t)}</option>`).join("")}</select><select class="input" name="home_value"><option value="">Estimated value (optional)</option>${PROPERTY_VALUES.map((v)=>`<option value="${esc(v)}">${esc(v)}</option>`).join("")}</select><input class="input" name="home_region" placeholder="Region"><label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" name="home_mortgaged"> <span>Mortgaged</span></label><input class="input" name="home_notes" placeholder="Notes (optional)"></div></fieldset>
          <fieldset style="grid-column:1/-1;border:1px solid var(--border,#ccc);padding:8px;border-radius:4px;"><legend><b>Rental Properties (0–5)</b></legend><div id="rentals-list" style="display:grid;gap:8px;"></div><button type="button" class="btn" id="add-rental-btn" style="margin-top:8px;">+ Add Rental</button></fieldset>
          <button class="btn" type="submit" style="grid-column:1/-1;">Submit Character for Approval</button>
        </form>
        `}
      </section>
      ${state.message ? `<p class="muted" style="margin-top:8px;">${esc(state.message)}</p>` : ""}
    `;

    const partySelect = host.querySelector("#char-party-select");
    const constSelect = host.querySelector("#char-constituency-select");
    const factionSelect = host.querySelector("#char-faction-select");
    if (partySelect && constSelect && factionSelect) {
      partySelect.addEventListener("change", async () => {
        const party = partySelect.value;
        if (!party) {
          constSelect.innerHTML = `<option value="">Select party first</option>`;
          factionSelect.innerHTML = `<option value="">Select party first</option>`;
          return;
        }
        const opts = allConstituenciesForPartyWithStatus(data, dbMyApps, party);
        constSelect.innerHTML = opts.length
          ? renderConstituencyOptions(opts, `No constituencies for ${party}`)
          : `<option value="">No constituencies for ${esc(party)}</option>`;
        try {
          const factionResult = await apiGetPartyFactions(party);
          const factions = Array.isArray(factionResult?.factions) ? factionResult.factions : [];
          const unaligned = factions.find((f) => String(f.slug || "") === "unaligned");
          factionSelect.innerHTML = factions.length
            ? `<option value="">Select faction</option>${factions.map((f) => `<option value="${esc(String(f.id))}" ${unaligned && String(unaligned.id) === String(f.id) ? "selected" : ""}>${esc(f.name)}</option>`).join("")}`
            : `<option value="">Unable to load factions. Please try again.</option>`;
        } catch {
          factionSelect.innerHTML = `<option value="">Unable to load factions. Please try again.</option>`;
        }
      });
    }

    const rentalsList = host.querySelector("#rentals-list");
    let rentalCount = 0;
    host.querySelector("#add-rental-btn")?.addEventListener("click", () => {
      if (rentalCount >= 5) return;
      rentalCount += 1;
      const idx = rentalCount;
      const div = document.createElement("div");
      div.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;padding:6px 0;border-top:1px solid var(--border,#eee);";
      div.innerHTML = `<div style="grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;"><b>Rental #${idx}</b><button type="button" class="btn danger" data-remove-rental="${idx}" style="padding:4px 10px;font-size:12px;">Remove</button></div><select class="input" name="rental_${idx}_type"><option value="">Type</option>${RENTAL_TYPES.map((t)=>`<option value="${esc(t)}">${esc(t)}</option>`).join("")}</select><select class="input" name="rental_${idx}_value"><option value="">Estimated value (optional)</option>${PROPERTY_VALUES.map((v)=>`<option value="${esc(v)}">${esc(v)}</option>`).join("")}</select><input class="input" name="rental_${idx}_location" placeholder="Location"><select class="input" name="rental_${idx}_status"><option value="">Status</option>${RENTAL_STATUSES.map((st)=>`<option value="${esc(st)}">${esc(st)}</option>`).join("")}</select><input class="input" name="rental_${idx}_notes" placeholder="Notes (optional)"><label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" name="rental_${idx}_mortgaged"> <span>Mortgaged</span></label>`;
      div.querySelector(`[data-remove-rental="${idx}"]`)?.addEventListener("click", () => { div.remove(); rentalCount = Math.max(0, rentalCount - 1); });
      rentalsList?.appendChild(div);
    });

    host.querySelector("#create-character-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const avatar_attribution = String(fd.get("avatar_attribution") || "").trim();
      if (!avatar_attribution) {
        state.message = 'Please fill in "Who is your avatar?" before submitting.';
        render(data, state);
        return;
      }
      const rentals = [];
      for (let i = 1; i <= rentalCount; i++) {
        const type = String(fd.get(`rental_${i}_type`) || "").trim();
        if (!type) continue;
        rentals.push({
          type,
          value: String(fd.get(`rental_${i}_value`) || "").trim(),
          location: String(fd.get(`rental_${i}_location`) || "").trim(),
          status: String(fd.get(`rental_${i}_status`) || "").trim(),
          notes: String(fd.get(`rental_${i}_notes`) || "").trim(),
          mortgaged: fd.get(`rental_${i}_mortgaged`) === "on",
        });
      }
      const fields = {
        name: String(fd.get("name") || "").trim(),
        party: String(fd.get("party") || "").trim(),
        constituency: String(fd.get("constituency") || "").trim(),
        faction_id: String(fd.get("faction_id") || "").trim(),
        date_of_birth: String(fd.get("date_of_birth") || "").trim(),
        education: String(fd.get("education") || "").trim(),
        career_background: String(fd.get("career_background") || "").trim(),
        family: String(fd.get("family") || "").trim(),
        year_first_elected: String(fd.get("year_first_elected") || "").trim(),
        bio: String(fd.get("bio") || "").trim().slice(0, 2000),
        financial_background_level: Number(fd.get("financial_background_level") || 1),
        avatar: String(fd.get("avatar") || "").trim(),
        avatar_attribution,
        twitter_handle: String(fd.get("twitter_handle") || "").trim(),
        home: {
          type: String(fd.get("home_type") || "").trim(),
          value: String(fd.get("home_value") || "").trim(),
          region: String(fd.get("home_region") || "").trim(),
          mortgaged: fd.get("home_mortgaged") === "on",
          notes: String(fd.get("home_notes") || "").trim(),
        },
        rentals,
      };
      try {
        await apiApplyCharacter(fields);
        const [{ applications }, { characters }] = await Promise.all([apiGetMyApplications(), apiGetMyCharacters()]);
        state.dbState = { ...state.dbState, myApplications: applications, myCharacters: characters };
        state.message = "Character submitted for moderator approval.";
      } catch (err) {
        state.message = String(err.message || "Submission failed.");
      }
      render(data, state);
    });
    return;
  }

  const selectableNames = Object.keys(data.personal.profiles).sort();
  const activeName = manager && state.selectedName ? state.selectedName : name;
  state.selectedName = activeName;
  const profile = data.personal.profiles[activeName];
  if (!profile) {
    host.innerHTML = '<section class="panel"><div class="muted-block">No personal profile data found.</div></section>';
    return;
  }

  const revenueTotal = profile.additionalRevenue.reduce((sum, r) => sum + Number(r.annualRevenue || 0), 0);
  // Compute fresh modifiers with current priceIndex for accurate revenue estimates
  const pi = state.priceIndex || 1;
  const mods = computeModifiers(profile, pi);
  const biMonthlyCredit = biMonthlyCreditAmount(profile, mods);
  const isOwnProfile = activeName === name;
  const canShop = isOwnProfile || manager;
  const activeParty = String(data?.currentCharacter?.party || "").trim();
  const factionsEnabledForParty = PLAYABLE_FACTION_PARTIES.has(activeParty);
  const factionList = Array.isArray(state.partyFaction?.factions) ? state.partyFaction.factions : [];
  const currentFaction = state.partyFaction?.currentFaction
    || factionList.find((f) => String(f.slug || "") === "unaligned")
    || null;
  const factionViewerRole = String(state.partyFaction?.viewerRole || "member");
  const isPartyLeadershipView = ["staff", "leader", "chairman", "whip"].includes(factionViewerRole);

  // Monthly upkeep: prefer server-side total (totalMonthlyUpkeep = shop + property) for the
  // viewed character; fall back to computing from shopPurchases for other profiles
  // or before the API response arrives (totalMonthlyUpkeep is undefined until then).
  // When manager views another character, state values are populated after apiGetCharacterFinance resolves.
  const useStateFinance = isOwnProfile || (manager && state.totalMonthlyUpkeep !== undefined);
  const monthlyUpkeep = useStateFinance
    ? (state.totalMonthlyUpkeep ?? state.shopMonthlyUpkeep ?? computeMonthlyUpkeep(profile))
    : computeMonthlyUpkeep(profile);
  const shopUpkeepDisplay       = useStateFinance ? (state.shopMonthlyUpkeep ?? 0) : 0;
  const propertyUpkeepDisplay   = useStateFinance ? (state.propertyMonthlyUpkeep ?? 0) : 0;
  const affiliationsFeesDisplay = useStateFinance ? (state.affiliationsMonthlyFees ?? 0) : 0;
  const rentalIncomeDisplay     = useStateFinance ? (state.rentalIncomeMonthly ?? 0) : 0;
  const annualUpkeep    = monthlyUpkeep * 12;
  const investmentIncome = Number(mods?.estimatedAnnualRevenue || 0);
  const totalAnnualIncome = Number(profile.salaryAnnual || 0) + revenueTotal + investmentIncome;
  const netAnnualIncome   = totalAnnualIncome - annualUpkeep;
  // Net bi-monthly: income credit minus 2 months of upkeep
  const netBiMonthly      = biMonthlyCredit - monthlyUpkeep * 2;
  const upkeepExceedsIncome = monthlyUpkeep > 0 && annualUpkeep > totalAnnualIncome;
  const financeOverspend    = (isOwnProfile || useStateFinance) ? !!state.financeOverspend : (profile.bankBalance < 0);
  // Pre-computed colour for net bi-monthly figure
  const netBiMonthlyColor = netBiMonthly >= 0 ? "#0a7f2e" : "#c00";
  // Pre-computed breakdown lines for upkeep components (one <div> per item)
  const upkeepBreakdownLines = [];
  if (shopUpkeepDisplay > 0)       upkeepBreakdownLines.push(`Upkeep: -${money(shopUpkeepDisplay)}/month`);
  if (propertyUpkeepDisplay > 0)   upkeepBreakdownLines.push(`Cost of Living: -${money(propertyUpkeepDisplay)}/month`);
  if (affiliationsFeesDisplay > 0) upkeepBreakdownLines.push(`Affiliations: -${money(affiliationsFeesDisplay)}/month`);
  const upkeepBreakdown = (isOwnProfile || useStateFinance) && upkeepBreakdownLines.length
    ? `<div class="muted" style="font-size:.85em;margin-left:12px;line-height:1.7;">${upkeepBreakdownLines.map(l => `<div>${l}</div>`).join("")}</div>`
    : "";

  host.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Your Character</div></div>

    ${manager ? `
      <section class="panel" style="margin-bottom:12px;">
        <h2 style="margin-top:0;">Moderator Profile Selector</h2>
        <label class="label" for="personal-profile-select">View / Edit Character</label>
        <select id="personal-profile-select" class="input">
          ${selectableNames.map((n) => `<option value="${esc(n)}" ${n === activeName ? "selected" : ""}>${esc(n)}</option>`).join("")}
        </select>
      </section>
    ` : ""}

    ${!data?.currentCharacter?.id || !factionsEnabledForParty ? "" : `
    <section class="panel" style="margin-bottom:12px;" id="party-faction-tile">
      <h2 style="margin-top:0;">Party Faction</h2>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
        <span class="muted">Your faction:</span>
        <span style="display:inline-flex;align-items:center;gap:6px;font-weight:700;">
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${esc(String(currentFaction?.colour || "#777"))};"></span>
          ${esc(String(currentFaction?.name || "Unaligned"))}
        </span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:6px 14px;font-size:.9em;margin-bottom:10px;">
        ${isPartyLeadershipView ? `<div><span class="muted">Internal power</span><br><b>${Math.round(Number(currentFaction?.internalPower ?? 0))}</b></div>` : ""}
        <div><span class="muted">Momentum</span><br><b style="text-transform:capitalize;">${esc(String(currentFaction?.momentum || "stable"))}</b></div>
        <div><span class="muted">Leadership alignment</span><br><b style="text-transform:capitalize;">${esc(String(currentFaction?.leadershipAlignment || "neutral"))}</b></div>
        ${isPartyLeadershipView ? `<div><span class="muted">Leadership pressure</span><br><b>${Math.round(Number(currentFaction?.leadershipPressure ?? 0))}</b></div>` : ""}
        ${isPartyLeadershipView ? `<div><span class="muted">Cohesion</span><br><b>${Math.round(Number(currentFaction?.cohesion ?? 0))}</b></div>` : ""}
        <div><span class="muted">Members (active characters)</span><br><b>${Math.round(Number(currentFaction?.memberCharacterCountActive ?? 0))}</b></div>
      </div>
      <div style="border-top:1px solid #eee;padding-top:8px;margin-top:2px;">
        <div style="font-weight:600;margin-bottom:4px;">Commons allocation (party-wide)</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:6px 14px;font-size:.9em;">
          <div><span class="muted">Total seats</span><br><b>${Math.round(Number(state.partyFaction?.partySeatTotal ?? 0))}</b></div>
          <div><span class="muted">Allocated MPs</span><br><b>${Math.round(Number(state.partyFaction?.allocatedMPs ?? 0))}</b></div>
          <div><span class="muted">Unallocated MPs</span><br><b>${Math.round(Number(state.partyFaction?.remainingMPs ?? 0))}</b></div>
        </div>
        <div class="muted" style="font-size:.82em;margin-top:6px;">“Allocated MPs” are set by staff to represent the parliamentary party’s internal balance.<br>“Members” are the characters currently assigned to the faction.</div>
      </div>
      <div style="border-top:1px solid #eee;padding-top:8px;margin-top:8px;">
      </div>
      ${isOwnProfile ? `
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;">
          <div style="min-width:220px;flex:1;">
            <label class="label" for="personal-faction-switch">Change faction</label>
            <div class="muted" style="font-size:.82em;margin:4px 0 6px;">You can switch faction once per sim year.<br>You cannot switch while you are Leader, Chairman, or a Whip.</div>
            <select class="input" id="personal-faction-switch">
              <option value="">Select faction</option>
              ${factionList.filter((f) => f.active !== false).map((f) => `<option value="${esc(String(f.id))}" ${currentFaction && String(currentFaction.id) === String(f.id) ? "selected" : ""}>${esc(f.name)}</option>`).join("")}
            </select>
          </div>
          <button type="button" class="btn" id="personal-faction-switch-btn">Switch faction</button>
        </div>
      ` : `<div class="muted">Faction switching is only available on your active character.</div>`}
      ${state.partyFaction?.message ? `<div class="muted" style="margin-top:8px;">${esc(state.partyFaction.message)}</div>` : ""}
      ${manager ? `<div class="muted" style="font-size:.82em;margin-top:8px;">Staff note: if legacy <code>affiliations_catalog</code> still contains faction-like IDs, remove them via approved admin maintenance workflow; Personal UI now suppresses them.</div>` : ""}
    </section>
    `}

    <section class="panel" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
      <article class="tile">
        <h2 style="margin-top:0;">Name and Avatar</h2>
        <div style="display:flex;gap:10px;align-items:center;">
          ${profile.avatar
            ? `<img src="${esc(profile.avatar)}" alt="${esc(profile.avatarAttribution || profile.name)}" style="width:88px;height:88px;object-fit:cover;border-radius:10px;border:1px solid #ddd;flex-shrink:0;image-rendering:auto;" onerror="this.style.display='none';this.nextElementSibling.style.display='grid';">`
              + `<div class="muted-block" style="display:none;width:88px;height:88px;padding:0;grid-template-columns:1fr;place-items:center;flex-shrink:0;border-radius:10px;">👤</div>`
            : '<div class="muted-block" style="width:88px;height:88px;padding:0;display:grid;place-items:center;flex-shrink:0;border-radius:10px;">👤</div>'}
          <div>
            <div><b>${esc(profile.display_name || profile.name)}</b></div>
            <div class="muted">${esc(profile.profile.party || "")}</div>
            ${profile.avatarAttribution ? `<div class="muted" style="font-size:.85em;">Avatar: ${esc(profile.avatarAttribution)}</div>` : ""}
          </div>
        </div>
        ${isOwnProfile ? `
          <details style="margin-top:10px;">
            <summary style="cursor:pointer;font-weight:500;">Request Avatar Change</summary>
            <form id="avatar-change-form" style="margin-top:10px;">
              <input class="input" name="proposed_avatar" placeholder="New avatar URL (https://...)" style="width:100%;">
              <div class="muted" style="font-size:.8em;margin-top:3px;">Recommended: 512×512 px (min 256×256 px)</div>
              <input class="input" name="proposed_avatar_attribution" placeholder="Who is this avatar? (required, e.g. Alan Rickman)" style="width:100%;margin-top:6px;" required>
              <div class="muted" style="font-size:.8em;margin-top:3px;">The real-world person whose likeness is used as your avatar.</div>
              <div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <button class="btn primary" type="submit">Submit Change Request</button>
                <span class="muted" id="avatar-change-status"></span>
              </div>
            </form>
          </details>
        ` : ""}
      </article>

      <article class="tile">
        <h2 style="margin-top:0;">MP Profile</h2>
        <div class="muted" style="line-height:1.7;">
          ${PROFILE_FIELDS.map((f) => `<div><b>${esc(f.label)}:</b> ${esc(profile.profile[f.key] || "-")}</div>`).join("")}
        </div>
        ${isOwnProfile ? `
          <details style="margin-top:10px;" id="profile-edit-details">
            <summary style="cursor:pointer;font-weight:500;">Edit Profile Fields</summary>
            <p class="muted" style="font-size:.85em;margin:6px 0 10px;">Changes are sent for mod/admin review before they appear publicly.</p>
            <form id="profile-change-form" style="margin-top:8px;">
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-bottom:10px;">
                <div>
                  <label class="label" for="pc-dob">Date of Birth</label>
                  <input id="pc-dob" class="input" type="date" name="date_of_birth" value="${esc(toDateInputValue(profile.profile.dateOfBirth || ""))}">
                </div>
                <div>
                  <label class="label" for="pc-edu">Education</label>
                  <select id="pc-edu" class="input" name="education">
                    <option value="">— select —</option>
                    ${getEducationOptions(state.enums).map((o) => `<option value="${esc(o)}" ${profile.profile.education === o ? "selected" : ""}>${esc(o)}</option>`).join("")}
                  </select>
                </div>
                <div>
                  <label class="label" for="pc-career">Career Background</label>
                  <select id="pc-career" class="input" name="career_background">
                    <option value="">— select —</option>
                    ${getCareerOptions(state.enums).map((o) => `<option value="${esc(o)}" ${profile.profile.careerBackground === o ? "selected" : ""}>${esc(o)}</option>`).join("")}
                  </select>
                </div>
                <div>
                  <label class="label" for="pc-family">Family</label>
                  <select id="pc-family" class="input" name="family">
                    <option value="">— select —</option>
                    ${getFamilyOptions(state.enums).map((o) => `<option value="${esc(o)}" ${profile.profile.family === o ? "selected" : ""}>${esc(o)}</option>`).join("")}
                  </select>
                </div>
                <div>
                  <label class="label" for="pc-twitter">Twitter Handle</label>
                  <input id="pc-twitter" class="input" name="twitter_handle" value="${esc(profile.twitterHandle || "")}" placeholder="without @" maxlength="100">
                </div>
                <div>
                  <label class="label" for="pc-finbg">Financial Background Level</label>
                  <select id="pc-finbg" class="input" name="financial_background_level">
                    <option value="">— select —</option>
                    ${(state.enums?.financialLevels ?? [{level:1,label:"1 – Poverty"},{level:2,label:"2 – Financially Strained"},{level:3,label:"3 – Lower Working Class"},{level:4,label:"4 – Skilled Working / Lower Middle"},{level:5,label:"5 – Solid Middle Class"},{level:6,label:"6 – Upper Middle Class"},{level:7,label:"7 – Affluent Professional"},{level:8,label:"8 – High Net Worth Individual"},{level:9,label:"9 – Top 5%"},{level:10,label:"10 – Top 1%"}]).map((fl) => `<option value="${esc(String(fl.level))}" ${String(profile.financialBackgroundLevel) === String(fl.level) ? "selected" : ""}>${esc(fl.label)}</option>`).join("")}
                  </select>
                </div>
              </div>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <button class="btn primary" type="submit">Submit Change Request</button>
                <span class="muted" id="profile-change-status" style="font-size:.9em;">${esc(state.profileChangeMessage || "")}</span>
              </div>
            </form>
          </details>
        ` : ""}
      </article>

      <article class="tile" style="grid-column:1/-1;">
        <h2 style="margin-top:0;">Biography</h2>
        <p style="white-space:pre-wrap;margin:0 0 10px;">${esc(profile.bio || profile.profile?.personalBackground || "-")}</p>
        ${isOwnProfile ? `
          <details style="margin-top:6px;">
            <summary style="cursor:pointer;font-weight:500;">Request Biography Change</summary>
            <form id="bio-change-form" style="margin-top:10px;">
              <textarea class="input" name="proposed_bio" rows="6" maxlength="2000" placeholder="Enter your new biography (max 2000 characters)..." style="width:100%;resize:vertical;"></textarea>
              <div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <button class="btn primary" type="submit">Submit Change Request</button>
                <span class="muted" id="bio-change-status">${esc(state.bioChangeMessage || "")}</span>
              </div>
            </form>
          </details>
        ` : ""}
      </article>

      <article class="tile" style="grid-column:1/-1;">
        <h2 style="margin-top:0;">Service &amp; Offices</h2>
        <div style="display:grid;gap:8px;">
          <div class="muted-block" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
            ${profile.profile.constituency
              ? `<b>Member of Parliament for ${esc(profile.profile.constituency)}</b><span class="muted">MP Service — ${esc(profile.profile.yearFirstElected || "?")} → Present</span>`
              : `<span class="muted">Not currently an MP.</span>`}
          </div>
          ${(state.officeHistory && state.officeHistory.length)
            ? state.officeHistory.map((o) => {
                const typeLabel = { cabinet: "Government", shadow: "Opposition", parliamentary: "Parliamentary", other: "Other" }[o.office_type] || o.office_type || "";
                const dateRange = `${esc(o.start_sim)} → ${o.end_sim ? esc(o.end_sim) : "Present"}`;
                return `
                  <div class="muted-block" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
                    <b>${esc(o.title)}</b>
                    <span class="muted">${esc(typeLabel)} — ${dateRange}</span>
                  </div>
                `;
              }).join("")
            : `<div class="muted" style="font-size:.9em;padding:4px 0;">No frontbench offices held yet.</div>`}
        </div>
      </article>

      <article class="tile" style="grid-column:1/-1;" id="political-capital-tile">
        <h2 style="margin-top:0;">Political Capital &amp; Pressure Profile</h2>
        ${state.politicalState ? (() => {
          const ps = state.politicalState;
          const momentumIcon = ps.momentum === "rising" ? "📈" : ps.momentum === "falling" ? "📉" : "➡️";
          const momentumColor = ps.momentum === "rising" ? "#0a7f2e" : ps.momentum === "falling" ? "#c00" : "inherit";
          const repColors = { excellent: "#0a5a8a", good: "#0a7f2e", neutral: "inherit", poor: "#b06000", damaged: "#c00" };
          const repColor = repColors[ps.reputation] || "inherit";
          const repLabel = { excellent: "Excellent", good: "Good", neutral: "Neutral", poor: "Poor", damaged: "Damaged" }[ps.reputation] || ps.reputation;
          const breakdownRaw = Array.isArray(ps.breakdown) ? ps.breakdown : [];
          const isAlignedFaction = String(currentFaction?.leadershipAlignment || "").toLowerCase() === "aligned";
          const breakdown = breakdownRaw.filter((b) => isAlignedFaction || !/aligned faction support/i.test(String(b?.label || "")));

          // Pressure channel helpers
          function pressureColor(v) {
            if (v >= 75) return "#8b0000";
            if (v >= 50) return "#c00";
            if (v >= 25) return "#b06000";
            return "#0a7f2e";
          }
          function pressureBadge(v) {
            if (v >= 75) return "🔴 Critical";
            if (v >= 50) return "🟠 High";
            if (v >= 25) return "🟡 Moderate";
            return "🟢 Low";
          }

          const channels = [
            { key: "party_pressure",        label: "Party",         hint: "Rebellion record and whip conflicts" },
            { key: "constituency_pressure",  label: "Constituency",  hint: "Local engagement and constituency events" },
            { key: "media_pressure",         label: "Media",         hint: "Press coverage and scandal exposure" },
            { key: "group_pressure",         label: "Group",         hint: "Affiliated group demands" },
            { key: "institutional_pressure", label: "Institutional", hint: "Office responsibility and scrutiny" },
          ];
          const risks = [
            { key: "rebellion_risk", label: "Rebellion Risk" },
            { key: "scandal_risk",   label: "Scandal Risk" },
          ];

          const pressureBreakdown = Array.isArray(ps.pressure_breakdown) ? ps.pressure_breakdown : [];

          return `
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px 20px;margin-bottom:12px;">
              <div><b>Capital:</b> <span style="font-size:1.15em;font-weight:600;">${Math.round(Number(ps.capital_current ?? 0))}</span></div>
              <div><b>Change since last update:</b> <span style="color:${momentumColor};">${momentumIcon} ${Number(ps.capital_trend) >= 0 ? "+" : ""}${Math.round(Number(ps.capital_trend ?? 0))}</span></div>
              <div><b>Momentum:</b> <span style="color:${momentumColor};text-transform:capitalize;">${esc(ps.momentum)}</span></div>
              <div><b>Reputation:</b> <span style="color:${repColor};">${esc(repLabel)}</span></div>
            </div>

            <h3 style="font-size:.95em;margin:10px 0 6px;font-weight:600;">Pressure Channels</h3>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin-bottom:12px;">
              ${channels.map(({ key, label, hint }) => {
                const v = Number(ps[key] ?? 0);
                const pct = Math.round(v);
                const col = pressureColor(v);
                const badge = pressureBadge(v);
                const chBreakdown = pressureBreakdown.filter((b) => b.channel === key.replace("_pressure", ""));
                return `
                  <div style="border:1px solid #ddd;border-radius:6px;padding:10px 12px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                      <b>${esc(label)}</b>
                      <span style="color:${col};font-size:.85em;">${badge}</span>
                    </div>
                    <div style="background:#eee;border-radius:4px;height:8px;margin-bottom:6px;">
                      <div style="background:${col};width:${pct}%;height:8px;border-radius:4px;transition:width .3s;"></div>
                    </div>
                    <div style="font-size:.8em;color:#666;">${esc(hint)}</div>
                    ${chBreakdown.length ? `<div style="font-size:.8em;margin-top:4px;color:#444;">${chBreakdown.map((b) => `• ${esc(b.label)}`).join("<br>")}</div>` : ""}
                  </div>
                `;
              }).join("")}
            </div>

            <h3 style="font-size:.95em;margin:10px 0 6px;font-weight:600;">Derived Risks</h3>
            <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:12px;">
              ${risks.map(({ key, label }) => {
                const v = Number(ps[key] ?? 0);
                const pct = Math.round(v);
                const col = pressureColor(v);
                const badge = pressureBadge(v);
                return `
                  <div style="border:1px solid #ddd;border-radius:6px;padding:10px 14px;min-width:160px;">
                    <div style="font-weight:600;margin-bottom:4px;">${esc(label)}</div>
                    <div style="display:flex;align-items:center;gap:8px;">
                      <span style="font-size:1.2em;font-weight:700;color:${col};">${pct}</span>
                      <span style="color:${col};font-size:.85em;">${badge}</span>
                    </div>
                  </div>
                `;
              }).join("")}
            </div>

            ${isPartyLeadershipView && breakdown.length ? `
              <details>
                <summary style="cursor:pointer;font-weight:500;font-size:.9em;">Capital score breakdown</summary>
                <div style="margin-top:6px;display:grid;gap:4px;font-size:.88em;line-height:1.7;">
                  ${breakdown.map((b) => `
                    <div style="display:flex;justify-content:space-between;gap:8px;">
                      <span class="muted">${esc(b.label)}</span>
                      <b style="color:${Number(b.delta) >= 0 ? "#0a7f2e" : "#c00"};">${Number(b.delta) >= 0 ? "+" : ""}${Math.round(Number(b.delta))}</b>
                    </div>
                  `).join("")}
                </div>
              </details>
            ` : ""}

            ${isPartyLeadershipView && ps.faction_climate ? (() => {
              const fc = ps.faction_climate;
              const CLIMATE_COLOURS = { unified: "#2e7d32", stable: "#1565c0", tense: "#e65100", fractious: "#b71c1c" };
              const col = CLIMATE_COLOURS[fc.climateLabel] || "#555";
              const label = fc.climateLabel ? fc.climateLabel.charAt(0).toUpperCase() + fc.climateLabel.slice(1) : "Unknown";
              return `
                <div style="margin-top:12px;border:1px solid #ddd;border-radius:6px;padding:10px 12px;background:var(--bg-alt,#f9f9f9);">
                  <div style="font-weight:600;margin-bottom:4px;">Party Climate Context</div>
                  <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:.88em;">
                    <div>Climate: <b style="color:${col};">${esc(label)}</b></div>
                    <div>Score: <b>${fc.climateScore > 0 ? "+" : ""}${Math.round(fc.climateScore)}</b></div>
                    ${fc.capitalResilienceBonus > 0 ? `<div style="color:#0a7f2e;">Aligned faction resilience: <b>+${fc.capitalResilienceBonus.toFixed(1)} capital</b></div>` : ""}
                    ${fc.partyPressureModifier > 0 ? `<div style="color:#c00;">Hostile factions adding: <b>+${fc.partyPressureModifier.toFixed(1)} party pressure</b></div>` : ""}
                  </div>
                </div>
              `;
            })() : ""}
          `;
        })() : `<div class="muted-block" style="font-size:.9em;">Political capital is loading…</div>`}
      </article>

      <article class="tile" style="min-height:240px;">
        <h2 style="margin-top:0;">Income &amp; Upkeep Summary</h2>
        <div style="line-height:1.8;">
          <div><b>Annual Salary:</b> ${money(profile.salaryAnnual)}</div>
          ${revenueTotal > 0 ? `<div><b>Additional Revenue (annual):</b> ${money(revenueTotal)}</div>` : ""}
          ${investmentIncome > 0 ? `<div><b>Investment Income (annual):</b> ${money(investmentIncome)}</div>` : ""}
          ${rentalIncomeDisplay > 0 ? `<div><b>Rental Income:</b> <span style="color:#0a7f2e;">+${money(rentalIncomeDisplay)}/month</span></div>` : ""}
          ${monthlyUpkeep > 0 ? `<div><b>Monthly Upkeep:</b> <span style="color:#c00;">-${money(monthlyUpkeep)}/month</span>${upkeepBreakdown}</div>` : ""}
          <div style="border-top:1px solid #eee;margin-top:4px;padding-top:4px;">
            <b>Net Annual Income:</b>
            <span style="color:${netAnnualIncome >= 0 ? "#0a7f2e" : "#c00"};">${money(netAnnualIncome)}</span>
          </div>
          <div class="muted" style="font-size:.88em;line-height:1.9;margin-top:2px;">
            <div>Bi-monthly deposit: ${money(biMonthlyCredit)}</div>
            ${monthlyUpkeep > 0 ? `<div>Monthly upkeep deduction: <span style="color:#c00;">-${money(monthlyUpkeep)}</span></div>` : ""}
            ${monthlyUpkeep > 0 ? `<div>Net per 2-month period: <b style="color:${netBiMonthlyColor};">${money(netBiMonthly)}</b></div>` : ""}
          </div>
        </div>
        ${upkeepExceedsIncome ? `<div style="color:#c00;margin-top:6px;">⚠️ Monthly upkeep exceeds annual income — your balance will decline each month.</div>` : ""}
      </article>

      <article class="tile" style="min-height:240px;">
        <h2 style="margin-top:0;">Bank Balance</h2>
        <p><b>Current Balance:</b> <span style="color:${profile.bankBalance < 0 ? "#c00" : "inherit"};">${money(profile.bankBalance)}</span></p>
        <p class="muted">Projected next bi-monthly deposit: ${money(biMonthlyCredit)}</p>
        ${monthlyUpkeep > 0 ? `<p class="muted">Monthly upkeep deduction: -${money(monthlyUpkeep)}</p>` : ""}
        ${financeOverspend ? `<div style="color:#c00;">⚠️ Balance in deficit — upkeep is being deducted regardless of available funds.</div>` : ""}
      </article>

      <article class="tile">
        <h2 style="margin-top:0;">Financial Background level</h2>
        <p>${esc(FINANCIAL_BACKGROUND_LABELS[Number(profile.financialBackgroundLevel)] || profile.financialBackgroundLevel || "Unknown")}</p>
      </article>

      <article class="tile" id="affiliations-tile">
        <h2 style="margin-top:0;">Paid Affiliations</h2>
        <div id="affiliations-display"><div class="muted-block" style="font-size:.9em;">Loading affiliations…</div></div>
        ${isOwnProfile ? `<button type="button" class="btn" style="margin-top:10px;" id="affiliations-edit-btn">Edit Affiliations</button>` : ""}
      </article>

      <article class="tile">
        <h2 style="margin-top:0;">Active Modifiers</h2>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:4px 16px;line-height:1.9;font-size:.93em;">
          <div><b>📰 Press Impact:</b> <span style="color:${mods.pressImpactPct > 0 ? "#0a7f2e" : "inherit"}">+${mods.pressImpactPct}%</span></div>
          <div><b>📊 Polling Boost:</b> <span style="color:${mods.pollingBoostPct > 0 ? "#0a7f2e" : "inherit"}">+${mods.pollingBoostPct}%</span></div>
          <div><b>⚡ Efficiency:</b> <span style="color:${mods.efficiencyBoost > 0 ? "#0a7f2e" : "inherit"}">+${mods.efficiencyBoost}</span></div>
          <div><b>📍 Constituency Work:</b> <span style="color:${mods.constituencyPresence > 0 ? "#0a7f2e" : "inherit"}">+${mods.constituencyPresence}</span></div>
          <div><b>👥 Casework Capacity:</b> <span style="color:${mods.constituencyCapacity > 0 ? "#0a7f2e" : "inherit"}">+${mods.constituencyCapacity}</span></div>
          <div><b>📄 Policy Research:</b> <span style="color:${mods.policyResearch > 0 ? "#0a7f2e" : "inherit"}">+${mods.policyResearch}</span></div>
          <div><b>🛡️ Scandal Defence:</b> <span style="color:${mods.scandalDefence > 0 ? "#0a5a8a" : "inherit"}">+${mods.scandalDefence}</span></div>
          <div><b>⚠️ Scandal Risk:</b> <span style="color:${mods.scrutinyScore >= 10 ? "#9d1d1d" : mods.scrutinyScore >= 5 ? "#b06000" : "inherit"}">${mods.scrutinyScore} ${mods.scrutinyScore >= 10 ? "— High" : mods.scrutinyScore >= 5 ? "— Medium" : "— Low"}</span></div>
          ${mods.estimatedAnnualRevenue > 0 ? `<div style="grid-column:1/-1;border-top:1px solid #eee;padding-top:4px;margin-top:2px;"><b>💰 Investment Income:</b> <span style="color:#0a5a8a;">est. ${money(mods.estimatedAnnualRevenue)}/year</span> <span class="muted" style="font-size:.85em;">(20% of current price, paid every 12 sim months)</span></div>` : ""}
        </div>
        <p class="muted" style="margin-bottom:0;font-size:.85em;margin-top:8px;">All modifiers are cumulative from shop purchases and are applied to press releases and polling entries.</p>
      </article>
    </section>

    <section class="panel" style="margin-top:12px;" id="additional-revenue-tile">
      <h2 style="margin-top:0;">Additional Revenue</h2>
      <p class="muted">Annual additional revenue total: ${money(revenueTotal)}</p>
      ${profile.additionalRevenue.length ? profile.additionalRevenue.map((rev) => `
        <article class="tile" style="margin-bottom:8px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;">
          <div>
            <b>${esc(rev.source || rev.label)}</b>
            <div class="muted">Annual Revenue: ${money(rev.annualRevenue || rev.annualAmount)}</div>
          </div>
          ${manager ? `<button type="button" class="btn" data-action="remove-revenue" data-id="${esc(String(rev.id))}">Remove</button>` : ""}
        </article>
      `).join("") : '<div class="muted-block">No additional revenue streams recorded.</div>'}
    </section>

    <section class="panel" style="margin-top:12px;" id="mp-shop-tile">
      <h2 style="margin-top:0;">MP Shop</h2>
      <p class="muted">Monthly upkeep is deducted automatically each month.</p>

      <h3 style="margin:0 0 6px;">Purchased Items</h3>
      ${profile.shopPurchases.length ? `
        <div class="muted" style="margin-bottom:8px;">
          Total monthly upkeep: <b>${money(computeMonthlyUpkeep(profile))}</b>
        </div>
        ${profile.shopPurchases.map((p, idx) => {
          const isFreeItem = Number(p.price) === 0 && Number(p.monthlyUpkeep) > 0;
          const canSell    = canShop && !isFreeItem;
          const canDismiss = canShop && isFreeItem;
          // Compute sim month/year at time of purchase from real timestamp + gameState
          let purchaseDateLabel = "";
          const purchasedAtDate = p.purchasedAt ? new Date(p.purchasedAt) : null;
          if (purchasedAtDate && !isNaN(purchasedAtDate.getTime()) && data.gameState) {
            const simAtPurchase = getSimDate(data.gameState, purchasedAtDate);
            purchaseDateLabel = `Purchased ${simAtPurchase.monthName} ${simAtPurchase.year} – `;
          }
          const EFFECT_LABELS = {
            pressImpact:         (v) => `+${v}% press`,
            pollingBoost:        (v) => `+${v}% polling`,
            efficiencyBoost:     (v) => `+${v} efficiency`,
            constituencyPresence:(v) => `+${v} constituency presence`,
            constituencyCapacity:(v) => `+${v} casework capacity`,
            policyResearch:      (v) => `+${v} policy research`,
            scandalDefence:      (v) => `+${v} scandal defence`,
            additionalRevenue:   ()  => `💰 investment income`,
          };
          const effectTags = Array.isArray(p.effects) && p.effects.length ? p.effects.map((e) => {
            const fn = EFFECT_LABELS[e.type];
            return fn ? fn(e.value) : null;
          }).filter(Boolean).join(" · ") : "";
          const scandalRisk = p.riskModifier?.scandalExposure || p.scrutinyRisk;
          const scandalTag = scandalRisk ? `⚠️ +${scandalRisk} scandal risk` : "";
          const allTags = [effectTags, scandalTag].filter(Boolean).join(" · ");
          return `
          <article class="tile" style="margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:flex-start;">
              <div>
                <b>${esc(p.name)}</b>
                <div class="muted" style="font-size:.88em;">${esc(purchaseDateLabel)}Paid ${money(p.price)}</div>
                ${p.monthlyUpkeep > 0 ? `<div class="muted" style="font-size:.85em;">Upkeep: ${money(p.monthlyUpkeep)}/month</div>` : ""}
                ${allTags ? `<div class="muted" style="font-size:.88em;">${allTags}</div>` : ""}
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                ${canSell    ? `<button type="button" class="btn" data-action="sell-purchase" data-id="${esc(String(p.id || idx))}" aria-label="Sell — refund 50% of current price">Sell</button>` : ""}
                ${canDismiss ? `<button type="button" class="btn" data-action="dismiss-purchase" data-id="${esc(String(p.id || idx))}">Dismiss</button>` : ""}
                ${manager ? `<button type="button" class="btn" data-action="remove-purchase" data-id="${esc(String(p.id || idx))}">Remove</button>` : ""}
              </div>
            </div>
          </article>
        `;
        }).join("")}
      ` : '<div class="muted-block">No items purchased.</div>'}

      ${Object.entries(
        SHOP_ITEMS.reduce((groups, item) => {
          (groups[item.category] = groups[item.category] || []).push(item);
          return groups;
        }, {})
      ).map(([cat, items]) => {
        const pi = state.priceIndex || 1;
        return `
          <details style="margin-bottom:10px;">
            <summary style="cursor:pointer;font-weight:600;font-size:1em;margin-bottom:6px;">${esc(cat)}</summary>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:8px;margin-top:6px;">
              ${items.map((item) => {
                const price = currentPrice(item, pi);
                const upkeep = currentUpkeep(item, pi);
                const ownedCount = profile.shopPurchases.filter((p) => p.itemId === item.id).length;
                const maxOwned = item.caps?.maxOwned;
                const atCap = maxOwned != null && ownedCount >= maxOwned;
                const canAfford = profile.bankBalance >= price;
                const effectTags = item.effects.map((e) => {
                  if (e.type === "pressImpact")         return `+${e.value}% press`;
                  if (e.type === "pollingBoost")         return `+${e.value}% polling`;
                  if (e.type === "constituencyPresence") return `📍 constituency`;
                  if (e.type === "constituencyCapacity") return `👥 casework`;
                  if (e.type === "policyResearch")       return `📄 research`;
                  if (e.type === "efficiencyBoost")      return `⚡ efficiency`;
                  if (e.type === "scandalDefence")       return `🛡️ scandal defence`;
                  if (e.type === "additionalRevenue")    return `💰 investment income`;
                  return e.type;
                }).join(" · ");
                const riskTag = item.riskModifier?.scandalExposure
                  ? `⚠️ +${item.riskModifier.scandalExposure} scandal risk`
                  : "";
                const capNote = maxOwned != null
                  ? `${ownedCount}/${maxOwned} owned`
                  : (ownedCount > 0 ? `${ownedCount} owned` : "");
                return `
                  <article class="tile card-flex">
                    <div>
                      <div style="display:flex;justify-content:space-between;gap:4px;flex-wrap:wrap;align-items:baseline;">
                        <b>${esc(item.name)}</b>
                        ${capNote ? `<span class="muted" style="font-size:.8em;">${esc(capNote)}</span>` : ""}
                      </div>
                      <div class="muted" style="margin-top:4px;font-size:.88em;line-height:1.4;">${esc(item.flavour)}</div>
                      <div style="margin-top:5px;font-size:.82em;display:flex;gap:6px;flex-wrap:wrap;">
                        ${effectTags ? `<span style="color:#1a6a1a;">${esc(effectTags)}</span>` : ""}
                        ${riskTag ? `<span style="color:#b00;">${esc(riskTag)}</span>` : ""}
                      </div>
                    </div>
                    <div class="tile-bottom" style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px;">
                      <div>
                        <b>${money(price)}</b>
                        ${upkeep > 0 ? `<div class="muted" style="font-size:.82em;">+ ${money(upkeep)}/month</div>` : ""}
                      </div>
                      ${canShop ? `<button type="button" class="btn" data-action="buy-item" data-item-id="${esc(item.id)}"
                        ${!canAfford ? `disabled title="Insufficient funds"` : ""}
                        ${atCap ? `disabled title="Maximum owned"` : ""}
                      >Buy</button>` : ""}
                    </div>
                  </article>
                `;
              }).join("")}
            </div>
          </details>
        `;
      }).join("")}
    </section>

    ${manager ? `
      <section class="panel" style="margin-top:12px;">
        <h2 style="margin-top:0;">Personal Finance Control Panel <span class="mod-badge">Mod / Admin / Speaker</span></h2>
        <form id="personal-control-form">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;">
            <div>
              <label class="label" for="p-avatar">Avatar URL</label>
              <input id="p-avatar" class="input" name="avatar" value="${esc(profile.avatar || "")}">
            </div>
            <div>
              <label class="label" for="p-avatar-attr">Avatar Attribution (who)</label>
              <input id="p-avatar-attr" class="input" name="avatar_attribution" value="${esc(profile.avatarAttribution || "")}">
            </div>
            <div>
              <label class="label" for="p-salary">Annual Salary Override (£)</label>
              <input id="p-salary" class="input" type="number" name="salaryAnnual" value="${esc(String(profile.salaryAnnual || 0))}">
            </div>
            <div>
              <label class="label" for="p-balance">Bank Balance (£)</label>
              <input id="p-balance" class="input" type="number" name="bankBalance" value="${esc(String(profile.bankBalance || 0))}">
            </div>
            <div>
              <label class="label" for="p-finbg">Financial Background Level (1–10)</label>
              <select id="p-finbg" class="input" name="financialBackgroundLevel">
                ${(state.enums?.financialLevels ?? [{level:1,label:"1 – Poverty"},{level:2,label:"2 – Financially Strained"},{level:3,label:"3 – Lower Working Class"},{level:4,label:"4 – Skilled Working / Lower Middle"},{level:5,label:"5 – Solid Middle Class"},{level:6,label:"6 – Upper Middle Class"},{level:7,label:"7 – Affluent Professional"},{level:8,label:"8 – High Net Worth Individual"},{level:9,label:"9 – Top 5%"},{level:10,label:"10 – Top 1%"}]).map((fl) => `<option value="${esc(String(fl.level))}" ${String(profile.financialBackgroundLevel) === String(fl.level) ? "selected" : ""}>${esc(fl.label)}</option>`).join("")}
              </select>
            </div>
          </div>

          <label class="label" for="p-aff">Affiliations (legacy free-text)</label>
          <textarea id="p-aff" class="input" name="affiliations" rows="2" style="display:none;">${esc(profile.affiliations || "")}</textarea>

          <h3 style="margin:10px 0 6px;">MP Profile Fields</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;">
            ${PROFILE_FIELDS.map((f) => {
              const val = profile.profile[f.key] || "";
              if (f.key === "dateOfBirth") {
                return `<div><label class="label" for="pf-${esc(f.key)}">${esc(f.label)}</label><input id="pf-${esc(f.key)}" class="input" type="date" name="profile:${esc(f.key)}" value="${esc(val)}"></div>`;
              }
              if (f.key === "education") {
                const opts = getEducationOptions(state.enums);
                return `<div><label class="label" for="pf-${esc(f.key)}">${esc(f.label)}</label><select id="pf-${esc(f.key)}" class="input" name="profile:${esc(f.key)}"><option value=""></option>${opts.map((o) => `<option value="${esc(o)}" ${val === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>`;
              }
              if (f.key === "careerBackground") {
                const opts = getCareerOptions(state.enums);
                return `<div><label class="label" for="pf-${esc(f.key)}">${esc(f.label)}</label><select id="pf-${esc(f.key)}" class="input" name="profile:${esc(f.key)}"><option value=""></option>${opts.map((o) => `<option value="${esc(o)}" ${val === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>`;
              }
              if (f.key === "family") {
                const opts = getFamilyOptions(state.enums);
                return `<div><label class="label" for="pf-${esc(f.key)}">${esc(f.label)}</label><select id="pf-${esc(f.key)}" class="input" name="profile:${esc(f.key)}"><option value=""></option>${opts.map((o) => `<option value="${esc(o)}" ${val === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>`;
              }
              if (f.key === "party") {
                const partyOpts = ["Conservative","Labour","Liberal Democrat","Independent"];
                return `<div><label class="label" for="pf-${esc(f.key)}">${esc(f.label)}</label><select id="pf-party" class="input" name="profile:${esc(f.key)}"><option value=""></option>${partyOpts.map((o) => `<option value="${esc(o)}" ${val === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>`;
              }
              if (f.key === "constituency") {
                const allConsts = (data.constituencies || []).slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
                const partyVal = profile.profile.party || "";
                const filtered = partyVal ? allConsts.filter((c) => String(c.party || "") === partyVal) : allConsts;
                const constOpts = filtered.map((c) => `<option value="${esc(c.name)}" ${val === c.name ? "selected" : ""}>${esc(c.name)}${c.region ? ` (${esc(c.region)})` : ""}</option>`).join("");
                return `<div><label class="label" for="pf-${esc(f.key)}">${esc(f.label)}</label><select id="pf-constituency" class="input" name="profile:${esc(f.key)}"><option value=""></option>${constOpts}</select></div>`;
              }
              return `<div><label class="label" for="pf-${esc(f.key)}">${esc(f.label)}</label><input id="pf-${esc(f.key)}" class="input" name="profile:${esc(f.key)}" value="${esc(val)}"></div>`;
            }).join("")}
          </div>

          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px;">
            <button class="btn primary" type="submit">Save to DB</button>
            <span id="control-form-status" class="muted" style="font-size:.9em;"></span>
          </div>
        </form>

        <hr style="margin:12px 0;border:none;border-top:1px solid #ddd;">

        <form id="personal-add-revenue-form">
          <h3 style="margin:0 0 6px;">Add Additional Revenue</h3>
          <div style="display:grid;grid-template-columns:minmax(220px,2fr) minmax(160px,1fr) auto;gap:8px;align-items:end;">
            <div>
              <label class="label" for="rev-source">Source of Revenue</label>
              <input id="rev-source" class="input" name="source" required>
            </div>
            <div>
              <label class="label" for="rev-annual">Annual Revenue (£)</label>
              <input id="rev-annual" class="input" type="number" name="annualRevenue" required>
            </div>
            <button class="btn" type="submit">Add Revenue</button>
          </div>
          <span id="add-revenue-status" class="muted" style="font-size:.9em;"></span>
        </form>
      </section>
    ` : ""}

    ${state.message ? `<p class="muted" style="margin-top:8px;">${esc(state.message)}</p>` : ""}
  `;

  // Layout tweak: keep Party Faction + Political Capital together between
  // Additional Revenue and MP Shop for a consistent personal-page flow.
  const additionalRevenueTile = host.querySelector("#additional-revenue-tile");
  const mpShopTile = host.querySelector("#mp-shop-tile");
  const partyFactionTile = host.querySelector("#party-faction-tile");
  const politicalCapitalTile = host.querySelector("#political-capital-tile");
  if (additionalRevenueTile && mpShopTile) {
    if (partyFactionTile) {
      host.insertBefore(partyFactionTile, mpShopTile);
    }
    if (politicalCapitalTile) {
      host.insertBefore(politicalCapitalTile, mpShopTile);
    }
  }

  host.querySelector("#personal-profile-select")?.addEventListener("change", async (e) => {
    const newName = String(e.currentTarget.value || "");
    state.selectedName = newName;
    state.message = "";
    // Clear stale finance + office history state before fetching new data
    state.shopMonthlyUpkeep = undefined;
    state.propertyMonthlyUpkeep = undefined;
    state.affiliationsMonthlyFees = undefined;
    state.affiliationsMonthlyFeesItems = undefined;
    state.rentalIncomeMonthly = undefined;
    state.totalMonthlyUpkeep = undefined;
    state.financeOverspend = false;
    state.officeHistory = null;
    render(data, state);
    // Load finance data for the selected character (mod view of other profiles)
    const myName = getCharacterName(data);
    if (newName && newName !== myName && canManage(data)) {
      const profiles = data.personal?.profiles || {};
      const prof = profiles[newName];
      if (prof) {
        // Find character id from the characters list by name
        const charId = (data.personal?._charIdByName || {})[newName];
        if (charId) {
          state.message = "Loading finance data…";
          render(data, state);
          try {
            const fin = await apiGetCharacterFinance(charId);
            syncFinanceIntoProfile(prof, fin, data, newName, state);
            state.message = "";
          } catch (err) {
            state.message = `Failed to load finance data: ${err.message}`;
          }
          // Load office history for the selected character
          apiGetCharacterOfficesHeld(charId).then(({ officesHeld }) => {
            state.officeHistory = officesHeld || [];
            render(data, state);
          }).catch(() => {});
          render(data, state);
        }
      }
    }
  });

  // Constituency dropdown: update options when party changes
  host.querySelector("#pf-party")?.addEventListener("change", () => {
    const partyVal = host.querySelector("#pf-party")?.value || "";
    const constSelect = host.querySelector("#pf-constituency");
    if (!constSelect) return;
    const allConsts = (data.constituencies || []).slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    const filtered = partyVal ? allConsts.filter((c) => String(c.party || "") === partyVal) : allConsts;
    const currentVal = constSelect.value;
    constSelect.innerHTML = `<option value=""></option>` + filtered.map((c) => `<option value="${esc(c.name)}" ${currentVal === c.name ? "selected" : ""}>${esc(c.name)}${c.region ? ` (${esc(c.region)})` : ""}</option>`).join("");
  });

  // Shop: buy item — DB-backed (deducts balance atomically, inserts purchase record)
  host.querySelectorAll('[data-action="buy-item"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!canShop) return;
      const itemId = String(btn.dataset.itemId || "");
      const item = SHOP_ITEMS.find((i) => i.id === itemId);
      if (!item) return;
      const pi = state.priceIndex || 1;
      const price = currentPrice(item, pi);
      const upkeep = currentUpkeep(item, pi);
      // Client-side cap check
      const ownedCount = profile.shopPurchases.filter((p) => p.itemId === item.id).length;
      if (item.caps?.maxOwned != null && ownedCount >= item.caps.maxOwned) return;
      if (profile.bankBalance < price) return;
      btn.disabled = true;
      try {
        const result = await apiAddShopPurchase({
          item_id: item.id, item_name: item.name, price, base_price: item.basePrice1997, monthly_upkeep: upkeep,
          effects: item.effects ? [...item.effects] : [], risk_modifier: item.riskModifier || null,
        });
        // Reload finance from DB to get authoritative state
        const fin = await apiGetMyFinance();
        syncFinanceIntoProfile(profile, fin, data, activeName, state);
        state.message = `Purchased "${item.name}" for ${money(price)}.${upkeep > 0 ? ` Upkeep: ${money(upkeep)}/month.` : ""}`;
        logAction({
          action: "character-shop-purchase",
          target: activeName,
          details: {
            characterId: result.purchase?.characterId || profile?.profile?.id || "",
            characterName: activeName,
            itemId: item.id,
            itemName: item.name,
            price,
            monthlyUpkeep: upkeep,
            headline: `${activeName} purchased "${item.name}" for ${money(price)} from the character shop.`,
          },
        });
      } catch (err) {
        state.message = `Purchase failed: ${err.message}`;
      }
      render(data, state);
    });
  });

  // Remove purchase — DB-backed (admin/mod only)
  host.querySelectorAll('[data-action="remove-purchase"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!manager) return;
      const purchaseId = String(btn.dataset.id || "");
      if (!purchaseId) return;
      btn.disabled = true;
      const removedItem = profile.shopPurchases?.find((p) => p.id === purchaseId);
      try {
        await apiRemoveShopPurchase(purchaseId);
        const fin = await apiGetMyFinance();
        syncFinanceIntoProfile(profile, fin, data, activeName, state);
        state.message = "Purchase removed.";
        logAction({
          action: "character-shop-dismissal",
          target: activeName,
          details: {
            characterName: activeName,
            purchaseId,
            itemId: removedItem?.itemId || "",
            itemName: removedItem?.itemName || "",
            headline: `Admin removed "${removedItem?.itemName || "an item"}" from ${activeName}'s character shop.`,
          },
        });
      } catch (err) {
        state.message = `Remove failed: ${err.message}`;
      }
      render(data, state);
    });
  });

  // Sell purchase — player: refunds 50% of current price
  host.querySelectorAll('[data-action="sell-purchase"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!canShop) return;
      const purchaseId = String(btn.dataset.id || "");
      if (!purchaseId) return;
      btn.disabled = true;
      const soldItem = profile.shopPurchases?.find((p) => p.id === purchaseId);
      try {
        const result = await apiSellShopPurchase(purchaseId);
        const fin = await apiGetMyFinance();
        syncFinanceIntoProfile(profile, fin, data, activeName, state);
        state.message = `Item sold. Refund: ${money(result.refund || 0)}.`;
        logAction({
          action: "character-shop-sale",
          target: activeName,
          details: {
            characterName: activeName,
            purchaseId,
            itemId: soldItem?.itemId || "",
            itemName: soldItem?.itemName || "",
            refund: result.refund || 0,
            headline: `${activeName} sold "${soldItem?.itemName || "an item"}" from the character shop (refund: ${money(result.refund || 0)}).`,
          },
        });
      } catch (err) {
        state.message = `Sell failed: ${err.message}`;
        btn.disabled = false;
      }
      render(data, state);
    });
  });

  // Dismiss purchase — player: removes free+upkeep item with no refund
  host.querySelectorAll('[data-action="dismiss-purchase"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!canShop) return;
      const purchaseId = String(btn.dataset.id || "");
      if (!purchaseId) return;
      btn.disabled = true;
      const dismissedItem = profile.shopPurchases?.find((p) => p.id === purchaseId);
      try {
        await apiDismissShopPurchase(purchaseId);
        const fin = await apiGetMyFinance();
        syncFinanceIntoProfile(profile, fin, data, activeName, state);
        state.message = "Item dismissed.";
        logAction({
          action: "character-shop-dismissal",
          target: activeName,
          details: {
            characterName: activeName,
            purchaseId,
            itemId: dismissedItem?.itemId || "",
            itemName: dismissedItem?.itemName || "",
            headline: `${activeName} dismissed "${dismissedItem?.itemName || "an item"}" from the character shop.`,
          },
        });
      } catch (err) {
        state.message = `Dismiss failed: ${err.message}`;
        btn.disabled = false;
      }
      render(data, state);
    });
  });

  // Admin control form — persist directly to DB
  host.querySelector("#personal-control-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!manager) return;
    const statusEl = host.querySelector("#control-form-status");
    const btn = e.currentTarget.querySelector('[type="submit"]');
    if (btn) btn.disabled = true;
    if (statusEl) statusEl.textContent = "Saving…";
    const fd = new FormData(e.currentTarget);

    // Build profile-field update for DB — always include fields that are present in the form
    const profileUpdate = {};
    // Profile text fields: include whenever the form element exists (always, since it's in the manager panel)
    profileUpdate.education         = String(fd.get("profile:education")         ?? "");
    profileUpdate.career_background = String(fd.get("profile:careerBackground")  ?? "");
    profileUpdate.family            = String(fd.get("profile:family")             ?? "");
    profileUpdate.date_of_birth     = String(fd.get("profile:dateOfBirth")        ?? "");
    profileUpdate.avatar            = String(fd.get("avatar")                     ?? "").trim();
    profileUpdate.avatar_attribution = String(fd.get("avatar_attribution")          ?? "").trim();
    // financial_background_level: include as number or null (empty string → null = "clear")
    const finBgRaw = fd.get("financialBackgroundLevel");
    profileUpdate.financial_background_level = finBgRaw !== null && finBgRaw !== "" ? finBgRaw : null;
    profileUpdate.bank_balance  = Number(fd.get("bankBalance")  ?? 0);
    profileUpdate.salary_annual = Number(fd.get("salaryAnnual") ?? 0) || null;

    const charId = data?.currentCharacter?.id;
    try {
      if (charId) await apiAdminUpdateCharacterProfile(charId, profileUpdate);
      // Reload finance from DB
      const fin = await apiGetMyFinance();
      syncFinanceIntoProfile(profile, fin, data, activeName);
      // Update local profile display fields too
      profile.avatar = String(fd.get("avatar") || "").trim();
      profile.avatarAttribution = String(fd.get("avatar_attribution") || "").trim();
      for (const f of PROFILE_FIELDS) {
        const v = String(fd.get(`profile:${f.key}`) || "").trim();
        if (v) profile.profile[f.key] = v;
      }
      profile.affiliations = String(fd.get("affiliations") || "").trim();
      profile.updatedAt = nowStamp();
      if (statusEl) statusEl.textContent = "Saved to DB.";
      state.message = `Saved personal profile for ${profile.name}.`;
    } catch (err) {
      if (statusEl) statusEl.textContent = `Error: ${err.message}`;
      state.message = `Save failed: ${err.message}`;
    } finally {
      if (btn) btn.disabled = false;
    }
    render(data, state);
  });

  // Admin: add additional revenue — DB-backed
  host.querySelector("#personal-add-revenue-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!manager) return;
    const statusEl = host.querySelector("#add-revenue-status");
    const fd = new FormData(e.currentTarget);
    const source = String(fd.get("source") || "").trim();
    const annualRevenue = Number(fd.get("annualRevenue") || 0);
    if (!source) return;
    const charId = data?.currentCharacter?.id;
    try {
      await apiAddAdditionalRevenue(charId, source, annualRevenue);
      const fin = await apiGetMyFinance();
      syncFinanceIntoProfile(profile, fin, data, activeName);
      e.currentTarget.reset();
      if (statusEl) statusEl.textContent = "";
      state.message = `Added revenue source for ${profile.name}.`;
    } catch (err) {
      if (statusEl) statusEl.textContent = `Error: ${err.message}`;
    }
    render(data, state);
  });

  // Admin: remove additional revenue — DB-backed
  host.querySelectorAll('[data-action="remove-revenue"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!manager) return;
      const id = String(btn.dataset.id || "");
      if (!id) return;
      btn.disabled = true;
      try {
        await apiRemoveAdditionalRevenue(id);
        const fin = await apiGetMyFinance();
        syncFinanceIntoProfile(profile, fin, data, activeName);
        state.message = "Removed additional revenue source.";
      } catch (err) {
        state.message = `Remove failed: ${err.message}`;
      }
      render(data, state);
    });
  });

  // Player: submit profile field change request for approval
  host.querySelector("#profile-change-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const statusEl = host.querySelector("#profile-change-status");
    const btn = form.querySelector('[type="submit"]');
    if (btn) btn.disabled = true;
    if (statusEl) statusEl.textContent = "Submitting…";
    const fd = new FormData(form);
    const fields = {};
    const dob     = String(fd.get("date_of_birth")         || "").trim();
    const edu     = String(fd.get("education")             || "").trim();
    const career  = String(fd.get("career_background")     || "").trim();
    const family  = String(fd.get("family")                || "").trim();
    const twitter = String(fd.get("twitter_handle")        || "").trim();
    const finBg   = String(fd.get("financial_background_level") || "").trim();
    if (dob)    fields.date_of_birth         = dob;
    if (edu)    fields.education             = edu;
    if (career) fields.career_background     = career;
    if (family) fields.family               = family;
    if (twitter) fields.twitter_handle      = twitter;
    if (finBg)  fields.financial_background_level = finBg;
    if (!Object.keys(fields).length) {
      if (statusEl) statusEl.textContent = "No fields entered.";
      if (btn) btn.disabled = false;
      return;
    }
    try {
      await apiSubmitProfileChange(fields);
      if (statusEl) statusEl.textContent = "Change request submitted — awaiting mod review.";
      state.profileChangeMessage = "Change request submitted — awaiting mod review.";
      if (form) form.reset();
    } catch (err) {
      if (statusEl) statusEl.textContent = `Error: ${err.message}`;
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // Bio change request form (own profile only)
  host.querySelector("#bio-change-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const proposed_bio = String(fd.get("proposed_bio") || "").trim().slice(0, 2000);
    if (!proposed_bio) return;
    const statusEl = host.querySelector("#bio-change-status");
    const btn = form.querySelector('[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      await apiSubmitBioChange(proposed_bio);
      if (statusEl) statusEl.textContent = "Change request submitted — awaiting mod review.";
      form.reset();
    } catch (err) {
      if (statusEl) statusEl.textContent = `Error: ${err.message}`;
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // Avatar change request form (own profile only)
  host.querySelector("#avatar-change-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const proposed_avatar = String(fd.get("proposed_avatar") || "").trim();
    const proposed_avatar_attribution = String(fd.get("proposed_avatar_attribution") || "").trim();
    const statusEl = host.querySelector("#avatar-change-status");
    if (!proposed_avatar) {
      if (statusEl) statusEl.textContent = "Please enter a new avatar URL.";
      return;
    }
    if (!proposed_avatar_attribution) {
      if (statusEl) statusEl.textContent = "Please fill in \"Who is your avatar?\".";
      return;
    }
    const btn = form.querySelector('[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      await apiSubmitAvatarChange(proposed_avatar, proposed_avatar_attribution);
      if (statusEl) statusEl.textContent = "Change request submitted — awaiting mod review.";
      form.reset();
    } catch (err) {
      if (statusEl) statusEl.textContent = `Error: ${err.message}`;
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // ── Affiliations tile: load and render ──────────────────────────────────
  const affiliationsDisplay = host.querySelector("#affiliations-display");
  const affiliationsEditBtn = host.querySelector("#affiliations-edit-btn");
  const currentCharId = data?.currentCharacter?.id;

  function renderAffiliationsDisplay(affiliations) {
    if (!affiliationsDisplay) return;
    if (!affiliations || !affiliations.length) {
      affiliationsDisplay.innerHTML = '<div class="muted-block" style="font-size:.9em;">No affiliations recorded.</div>';
      return;
    }
    const visible = affiliations.filter((a) => !String(a.affiliation_id || "").startsWith("faction_"));
    const approved = visible.filter((a) => a.status === "approved");
    const pendingAdd = visible.filter((a) => a.status === "pending_add");
    const pendingRemove = visible.filter((a) => a.status === "pending_remove");
    let html = "";
    if (approved.length) {
      // Look up monthly fees from catalog
      const feeMap = new Map(AFFILIATIONS_CATALOG.flatMap((cat) => cat.items.map((i) => [i.id, i.monthly_fee])));
      const approvedTotal = approved.reduce((sum, a) => sum + (feeMap.get(a.affiliation_id) ?? 0), 0);
      html += `<div style="margin-bottom:6px;"><b>Approved:</b></div>`;
      html += `<ul style="margin:0 0 4px;padding-left:18px;">` +
        approved.map((a) => {
          const fee = feeMap.get(a.affiliation_id);
          const feeStr = fee != null ? ` <span class="muted" style="font-size:.82em;">£${fee}/month</span>` : "";
          return `<li>${esc(a.name)}${feeStr} <span class="muted" style="font-size:.8em;">(${esc(a.category)})</span></li>`;
        }).join("") +
        `</ul>`;
      if (approvedTotal > 0) {
        html += `<div class="muted" style="font-size:.88em;margin-bottom:8px;">Membership fees total: <b style="color:#c00;">-£${approvedTotal}/month</b></div>`;
      }
    }
    if (pendingAdd.length) {
      html += `<div style="margin-bottom:4px;color:#b57a00;"><b>Pending addition (awaiting mod approval):</b></div>`;
      html += `<ul style="margin:0 0 8px;padding-left:18px;color:#b57a00;">` +
        pendingAdd.map((a) => `<li>${esc(a.name)}</li>`).join("") +
        `</ul>`;
    }
    if (pendingRemove.length) {
      html += `<div style="margin-bottom:4px;color:#c00;"><b>Pending removal (awaiting mod approval):</b></div>`;
      html += `<ul style="margin:0 0 8px;padding-left:18px;color:#c00;">` +
        pendingRemove.map((a) => `<li>${esc(a.name)}</li>`).join("") +
        `</ul>`;
    }
    if (!html) html = '<div class="muted-block" style="font-size:.9em;">No affiliations recorded.</div>';
    affiliationsDisplay.innerHTML = html;
  }

  if (currentCharId) {
    apiGetCharacterAffiliations(currentCharId)
      .then(({ affiliations }) => { renderAffiliationsDisplay(affiliations); })
      .catch(() => {
        if (affiliationsDisplay) affiliationsDisplay.innerHTML = '<div class="muted-block" style="font-size:.9em;">Could not load affiliations.</div>';
      });
  } else if (affiliationsDisplay) {
    affiliationsDisplay.innerHTML = '<div class="muted-block" style="font-size:.9em;">No active character.</div>';
  }

  // "Edit Affiliations" modal
  if (affiliationsEditBtn && isOwnProfile && currentCharId) {
    affiliationsEditBtn.addEventListener("click", () => {
      // Build current selection from displayed affiliations (load fresh)
      apiGetCharacterAffiliations(currentCharId).then(({ affiliations }) => {
        // IDs that are currently "ticked" = approved + pending_add (pending_remove = still showing, so remain ticked)
        const tickedIds = new Set(
          affiliations
            .filter((a) => !String(a.affiliation_id || "").startsWith("faction_") && (a.status === "approved" || a.status === "pending_add"))
            .map((a) => a.affiliation_id)
        );

        const overlay = document.createElement("div");
        overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1000;display:flex;align-items:center;justify-content:center;padding:12px;";
        overlay.innerHTML = `
          <div style="background:#fff;border-radius:10px;padding:20px;max-width:680px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 4px 32px rgba(0,0,0,.3);">
            <h2 style="margin:0 0 6px;">Select Affiliations</h2>
            <p class="muted" style="margin:0 0 14px;font-size:.9em;">Tick to add, untick to remove. Changes need mod approval before they appear publicly.</p>
            <div id="aff-modal-body">
              ${AFFILIATIONS_CATALOG.map((cat) => `
                <div style="margin-bottom:14px;">
                  <div style="font-weight:700;margin-bottom:6px;border-bottom:1px solid #ddd;padding-bottom:3px;">${esc(cat.category)}</div>
                  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:4px;">
                    ${cat.items.map((item) => `
                      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.92em;padding:2px 0;">
                        <input type="checkbox" name="aff" value="${esc(item.id)}" data-fee="${esc(String(item.monthly_fee))}"${tickedIds.has(item.id) ? " checked" : ""}>
                        ${esc(item.name)} <span class="muted" style="font-size:.82em;">£${esc(String(item.monthly_fee))}/mo</span>
                      </label>
                    `).join("")}
                  </div>
                </div>
              `).join("")}
            </div>
            <div style="padding:8px 0 4px;font-size:.95em;">
              Selected total (if approved): <b id="aff-modal-total" style="color:#c00;">£0/month</b>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center;">
              <button id="aff-modal-save" class="btn primary" type="button">Save & Submit</button>
              <button id="aff-modal-cancel" class="btn" type="button">Cancel</button>
              <span id="aff-modal-status" class="muted" style="font-size:.9em;"></span>
            </div>
          </div>
        `;
        document.body.appendChild(overlay);

        // Live-running total: update whenever a checkbox changes
        function updateAffTotal() {
          const totalEl = overlay.querySelector("#aff-modal-total");
          if (!totalEl) return;
          const total = [...overlay.querySelectorAll('input[name="aff"]:checked')]
            .reduce((sum, el) => sum + Number(el.dataset.fee || 0), 0);
          totalEl.textContent = `£${total}/month`;
        }
        overlay.querySelector("#aff-modal-body").addEventListener("change", updateAffTotal);
        updateAffTotal();

        overlay.querySelector("#aff-modal-cancel").addEventListener("click", () => overlay.remove());
        overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

        overlay.querySelector("#aff-modal-save").addEventListener("click", async () => {
          const statusEl = overlay.querySelector("#aff-modal-status");
          const saveBtn  = overlay.querySelector("#aff-modal-save");
          const checked = [...overlay.querySelectorAll('input[name="aff"]:checked')].map((el) => el.value);
          saveBtn.disabled = true;
          saveBtn.textContent = "Saving…";
          if (statusEl) statusEl.textContent = "";
          try {
            const { affiliations: updated } = await apiSubmitCharacterAffiliations(currentCharId, checked);
            renderAffiliationsDisplay(updated);
            overlay.remove();
          } catch (err) {
            if (statusEl) statusEl.textContent = `Error: ${err.message}`;
            saveBtn.disabled = false;
            saveBtn.textContent = "Save & Submit";
          }
        });
      }).catch(() => { alert("Could not load affiliations. Please try again."); });
    });
  }

  host.querySelector("#personal-faction-switch-btn")?.addEventListener("click", async () => {
    const nextFactionId = String(host.querySelector("#personal-faction-switch")?.value || "").trim();
    if (!nextFactionId) {
      state.partyFaction = { ...(state.partyFaction || {}), message: "Please choose a faction." };
      render(data, state);
      return;
    }
    try {
      await apiSwitchMyFaction(nextFactionId);
      const partySlug = String(data?.currentCharacter?.party || "").trim();
      const [factionResult, climateResult, meFactionResult, politicalStateResult] = await Promise.all([
        apiGetPartyFactions(partySlug).catch(() => ({ factions: [] })),
        apiGetPartyFactionClimate(partySlug).catch(() => ({ climate: null })),
        apiGetMyFaction().catch(() => ({ faction: null })),
        apiGetMyPoliticalState().catch(() => ({ politicalState: null })),
      ]);
      const factions = Array.isArray(factionResult?.factions) ? factionResult.factions : [];
      let currentFaction = meFactionResult?.faction ?? null;
      if (!currentFaction) currentFaction = factions.find((f) => String(f.slug || "") === "unaligned") || null;
      if (currentFaction?.id) {
        const full = factions.find((f) => String(f.id) === String(currentFaction.id));
        if (full) currentFaction = full;
      }
      state.partyFaction = {
        ...state.partyFaction,
        factions,
        currentFaction,
        climate: climateResult?.climate ?? null,
        partySeatTotal: Number(factionResult?.partySeatTotal ?? 0),
        allocatedMPs: Number(factionResult?.allocatedMPs ?? 0),
        remainingMPs: Number(factionResult?.remainingMPs ?? 0),
        message: "Faction updated. Staff can see this change in the log.",
      };
      state.politicalState = politicalStateResult?.politicalState ?? state.politicalState;
    } catch (err) {
      const msg = String(err?.message || "Faction switch failed.");
      let friendly = "Couldn’t switch faction. Please try again.";
      if (/leaders|chairmen|whips/i.test(msg)) {
        friendly = "You can’t switch faction while you are Leader, Chairman, or a Whip.";
      } else if (/once per sim year/i.test(msg)) {
        const year = data?.gameState?.year || "this year";
        friendly = "You can only switch faction once per sim year. Try again next sim year.";
      }
      state.partyFaction = { ...(state.partyFaction || {}), message: friendly };
    }
    render(data, state);
  });

}

/**
 * Sync a finance snapshot (from apiGetMyFinance) into the in-memory profile object
 * so the render shows authoritative DB values.
 */
function syncFinanceIntoProfile(profile, fin, data, profileName, state) {
  if (!profile || !fin) return;
  profile.bankBalance   = Number(fin.bankBalance   ?? profile.bankBalance);
  profile.salaryAnnual  = Number(fin.annualSalary  ?? profile.salaryAnnual);

  // Propagate upkeep totals and overspend flag into state for the render
  if (state) {
    state.shopMonthlyUpkeep            = Number(fin.shopMonthlyUpkeep ?? 0);
    state.financeOverspend             = !!fin.financeOverspend;
    state.totalMonthlyUpkeep           = fin.totalMonthlyUpkeep != null ? Number(fin.totalMonthlyUpkeep) : undefined;
    state.propertyMonthlyUpkeep        = fin.propertyMonthlyUpkeep != null ? Number(fin.propertyMonthlyUpkeep) : undefined;
    state.homeLivingCostsMonthly       = fin.homeLivingCostsMonthly != null ? Number(fin.homeLivingCostsMonthly) : undefined;
    state.rentalIncomeMonthly          = fin.rentalIncomeMonthly != null ? Number(fin.rentalIncomeMonthly) : undefined;
    state.rentalCostsMonthly           = fin.rentalCostsMonthly != null ? Number(fin.rentalCostsMonthly) : undefined;
    state.affiliationsMonthlyFees      = fin.affiliationsMonthlyFees != null ? Number(fin.affiliationsMonthlyFees) : undefined;
    state.affiliationsMonthlyFeesItems = Array.isArray(fin.affiliationsMonthlyFeesItems) ? fin.affiliationsMonthlyFeesItems : undefined;
  }

  // Replace shop purchases from DB (normalise field names)
  if (Array.isArray(fin.shopPurchases)) {
    profile.shopPurchases = fin.shopPurchases.map((p) => ({
      id:            p.id,
      itemId:        p.itemId,
      name:          p.itemName || p.itemId,
      itemName:      p.itemName || p.itemId,
      price:         Number(p.price),
      basePrice:     Number(p.basePrice || 0),
      monthlyUpkeep: Number(p.monthlyUpkeep),
      effects:       Array.isArray(p.effects) ? p.effects : [],
      riskModifier:  p.riskModifier ?? null,
      modifiers:     { pressImpactPct: 0, pollingBoostPct: 0 },
      scrutinyRisk:  p.riskModifier?.scandalExposure || 0,
      purchasedAt:   p.purchasedAt ? new Date(p.purchasedAt).toLocaleString("en-GB", { hour12: false }) : "",
    }));
    profile.modifiers = computeModifiers(profile);
    syncModifiers(data, profileName);
  }

  // Replace additional revenue from DB (normalise field names)
  if (Array.isArray(fin.additionalRevenue)) {
    profile.additionalRevenue = fin.additionalRevenue.map((r) => ({
      id:            r.id,
      source:        r.label,
      label:         r.label,
      annualRevenue: Number(r.annualAmount),
      annualAmount:  Number(r.annualAmount),
    }));
  }
}

export async function initPersonalPage(data) {
  normalisePersonal(data);
  const state = { selectedName: getCharacterName(data), message: "", priceIndex: 1.0, profileChangeMessage: "", shopMonthlyUpkeep: undefined, financeOverspend: false, totalMonthlyUpkeep: undefined, propertyMonthlyUpkeep: undefined, homeLivingCostsMonthly: undefined, rentalIncomeMonthly: undefined, rentalCostsMonthly: undefined, affiliationsMonthlyFees: undefined, affiliationsMonthlyFeesItems: undefined, enums: null, officeHistory: null, politicalState: null, partyFaction: { factions: [], currentFaction: null, partySeatTotal: 0, allocatedMPs: 0, remainingMPs: 0, message: "" }, dbState: { myCharacters: [], myApplications: [] } };

  if (!isLoggedIn()) {
    render(data, state);
    return;
  }

  // Load all active characters for the moderator profile selector (non-blocking).
  if (canManage(data)) {
    apiGetCharacters({ active: "true" }).then(({ characters }) => {
      for (const c of characters) {
        const cname = String(c.name || "").trim();
        if (!cname) continue;
        data.personal.profiles[cname] ??= {
          name: cname,
          avatar: String(c.avatar || ""),
          avatarAttribution: "",
          profile: {
            dateOfBirth: String(c.date_of_birth || "").slice(0, 10),
            education: String(c.education || ""),
            careerBackground: String(c.career_background || ""),
            family: String(c.family || ""),
            constituency: String(c.constituency || ""),
            party: String(c.party || ""),
            yearFirstElected: String(c.year_first_elected || "")
          },
          bio: String(c.bio || c.personal_background || ""),
          salaryAnnual: 0,
          bankBalance: 0,
          financialBackgroundLevel: String(c.financial_background_level || ""),
          affiliations: "",
          additionalRevenue: [],
          nextRevenueId: 1,
          shopPurchases: [],
          modifiers: { pressImpactPct: 0, pollingBoostPct: 0, scrutinyScore: 0 },
          lastSundayCreditAt: "",
          updatedAt: ""
        };
        // Store character ID for finance lookup
        data.personal._charIdByName ??= {};
        data.personal._charIdByName[cname] = String(c.id || "");
        // Always update avatar and profile fields from authoritative DB data
        const prof = data.personal.profiles[cname];
        prof.avatar = String(c.avatar || "");
        if (c.party)        prof.profile.party        = String(c.party);
        if (c.constituency) prof.profile.constituency = String(c.constituency);
        if (c.date_of_birth) prof.profile.dateOfBirth  = String(c.date_of_birth).slice(0, 10);
        if (c.education)    prof.profile.education     = String(c.education);
        if (c.career_background) prof.profile.careerBackground = String(c.career_background);
        if (c.family)       prof.profile.family        = String(c.family);
        if (c.year_first_elected) prof.profile.yearFirstElected = String(c.year_first_elected);
        if (c.bio || c.personal_background) prof.bio = String(c.bio || c.personal_background || "");
        if (c.financial_background_level) prof.financialBackgroundLevel = String(c.financial_background_level);
        // Store canonical display_name from the server (includes PC/RH/MP post-nominals)
        if (c.display_name) prof.display_name = c.display_name;
        // Store offices_held from the API (admin/mod only — server populates this field)
        if (Array.isArray(c.offices_held)) prof.offices_held = c.offices_held;
      }
      render(data, state);
    }).catch(() => {});
  }


  // Load character application prerequisites for seat-availability checks on create form.
  Promise.all([apiGetConstituencies(), apiGetMyCharacters(), apiGetMyApplications()]).then(([cons, chars, apps]) => {
    if (Array.isArray(cons?.constituencies)) data.constituencies = cons.constituencies;
    state.dbState = {
      ...state.dbState,
      myCharacters: Array.isArray(chars?.characters) ? chars.characters : [],
      myApplications: Array.isArray(apps?.applications) ? apps.applications : [],
    };
    render(data, state);
  }).catch(() => {});

  // Load finance + shop purchases from DB (authoritative source of truth).
  // Run in parallel with initial render so the page appears immediately,
  // then refreshes once DB data arrives.
  apiGetMyFinance().then((fin) => {
    const name = getCharacterName(data);
    const profile = name ? data.personal?.profiles?.[name] : null;
    if (profile) {
      syncFinanceIntoProfile(profile, fin, data, name, state);
      render(data, state);
    }
  }).catch(() => {}); // fail silently — client state is used as fallback

  // Load current shop price index from server (non-blocking; falls back to 1.0)
  apiGetShopPriceIndex().then(({ priceIndex }) => {
    if (Number.isFinite(priceIndex) && priceIndex > 0) {
      state.priceIndex = priceIndex;
      render(data, state);
    }
  }).catch(() => {});

  // Load server enum arrays non-blocking; re-render to update all dropdowns.
  apiGetEnums().then((enums) => {
    state.enums = enums;
    render(data, state);
  }).catch(() => { /* fall back to built-in arrays */ });

  // Load office assignment history from DB (DB source of truth for "Offices Held" tile).
  const currentCharId = data?.currentCharacter?.id;
  if (currentCharId) {
    apiGetCharacterOfficesHeld(currentCharId).then(({ officesHeld }) => {
      state.officeHistory = officesHeld || [];
      render(data, state);
    }).catch(() => {});
  }

  // Load political capital state non-blocking; re-render once data arrives.
  apiGetMyPoliticalState().then(({ politicalState }) => {
    state.politicalState = politicalState ?? null;
    render(data, state);
  }).catch(() => {});

  const partySlug = String(data?.currentCharacter?.party || "").trim();
  if (partySlug && PLAYABLE_FACTION_PARTIES.has(partySlug)) {
    Promise.all([
      apiGetPartyFactions(partySlug).catch(() => ({ factions: [], partySeatTotal: 0, allocatedMPs: 0, remainingMPs: 0 })),
      apiGetPartyFactionClimate(partySlug).catch(() => ({ climate: null })),
      apiGetMyFaction().catch(() => ({ faction: null })),
    ]).then(([factionResult, climateResult, meFactionResult]) => {
      const factions = Array.isArray(factionResult?.factions) ? factionResult.factions : [];
      let currentFaction = meFactionResult?.faction ?? null;
      if (!currentFaction) currentFaction = factions.find((f) => String(f.slug || "") === "unaligned") || null;
      if (currentFaction?.id) {
        const full = factions.find((f) => String(f.id) === String(currentFaction.id));
        if (full) currentFaction = full;
      }
      state.partyFaction = {
        ...state.partyFaction,
        factions,
        currentFaction,
        partySeatTotal: Number(factionResult?.partySeatTotal ?? 0),
        allocatedMPs: Number(factionResult?.allocatedMPs ?? 0),
        remainingMPs: Number(factionResult?.remainingMPs ?? 0),
        climate: climateResult?.climate ?? null,
        viewerRole: String(factionResult?.viewerRole || "member"),
      };
      render(data, state);
    }).catch(() => {});
  }

  render(data, state);
}
