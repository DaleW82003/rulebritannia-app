import { esc } from "../ui.js";
import { nowStamp } from "../core.js";
import { canAdminModOrSpeaker } from "../permissions.js";
import { getSimDate } from "../clock.js";
import { apiSubmitBioChange, apiSubmitAvatarChange, apiGetShopPriceIndex, apiUpdateCharacterShopUpkeep, apiGetCharacterAffiliations, apiSubmitCharacterAffiliations, apiGetMyFinance, apiSubmitProfileChange, apiAddShopPurchase, apiRemoveShopPurchase, apiSellShopPurchase, apiDismissShopPurchase, apiAddAdditionalRevenue, apiRemoveAdditionalRevenue, apiAdminUpdateCharacterProfile, apiGetCharacters } from "../api.js";

// ── Affiliations catalogue ────────────────────────────────────────────────────
const AFFILIATIONS_CATALOG = [
  { category: "Trade Unions (Major UK)", items: [
    { id: "trade_unions_unite",  name: "Unite the Union" },
    { id: "trade_unions_unison", name: "UNISON" },
    { id: "trade_unions_gmb",    name: "GMB" },
    { id: "trade_unions_cwu",    name: "CWU (Communication Workers Union)" },
    { id: "trade_unions_rmt",    name: "RMT" },
    { id: "trade_unions_usdaw",  name: "USDAW" },
    { id: "trade_unions_nasuwt", name: "NASUWT" },
    { id: "trade_unions_neu",    name: "NEU (National Education Union)" },
    { id: "trade_unions_bma",    name: "BMA" },
    { id: "trade_unions_tssa",   name: "TSSA" },
  ]},
  { category: "Think Tanks", items: [
    { id: "think_tanks_fabian",      name: "Fabian Society" },
    { id: "think_tanks_iea",         name: "Institute of Economic Affairs" },
    { id: "think_tanks_policy_exch", name: "Policy Exchange" },
    { id: "think_tanks_cps",         name: "Centre for Policy Studies" },
    { id: "think_tanks_ifg",         name: "Institute for Government" },
    { id: "think_tanks_demos",       name: "Demos" },
    { id: "think_tanks_resolution",  name: "Resolution Foundation" },
    { id: "think_tanks_asi",         name: "Adam Smith Institute" },
    { id: "think_tanks_chatham",     name: "Chatham House" },
    { id: "think_tanks_ippr",        name: "IPPR" },
  ]},
  { category: "Advocacy / Campaign Groups", items: [
    { id: "advocacy_greenpeace",  name: "Greenpeace UK" },
    { id: "advocacy_foe",         name: "Friends of the Earth" },
    { id: "advocacy_liberty",     name: "Liberty" },
    { id: "advocacy_amnesty",     name: "Amnesty International" },
    { id: "advocacy_stonewall",   name: "Stonewall" },
    { id: "advocacy_countryside", name: "Countryside Alliance" },
    { id: "advocacy_taxpayers",   name: "TaxPayers' Alliance" },
    { id: "advocacy_openrights",  name: "Open Rights Group" },
    { id: "advocacy_shelter",     name: "Shelter" },
    { id: "advocacy_cnd",         name: "Campaign for Nuclear Disarmament" },
  ]},
  { category: "Business / Industry", items: [
    { id: "business_cbi",    name: "CBI" },
    { id: "business_fsb",    name: "Federation of Small Businesses" },
    { id: "business_iod",    name: "Institute of Directors" },
    { id: "business_bcc",    name: "British Chambers of Commerce" },
    { id: "business_techuk", name: "TechUK" },
    { id: "business_nfu",    name: "National Farmers Union" },
  ]},
  { category: "Professional Associations", items: [
    { id: "prof_law_society", name: "Law Society" },
    { id: "prof_bar_council", name: "Bar Council" },
    { id: "prof_rcn",         name: "Royal College of Nursing" },
    { id: "prof_cipd",        name: "Chartered Institute of Personnel & Development" },
  ]},
  { category: "Faith / Ethical", items: [
    { id: "faith_coe_synod",       name: "Church of England Synod Member" },
    { id: "faith_catholic_social", name: "Catholic Social Action Network" },
    { id: "faith_mcb",             name: "Muslim Council of Britain" },
    { id: "faith_jlc",             name: "Jewish Leadership Council" },
  ]},
  { category: "International", items: [
    { id: "intl_nato_pa",       name: "NATO Parliamentary Assembly" },
    { id: "intl_council_europe", name: "Council of Europe" },
    { id: "intl_cpa",           name: "Commonwealth Parliamentary Association" },
    { id: "intl_wef",           name: "World Economic Forum" },
  ]},
  { category: "Party Factions (Internal Groups)", items: [
    { id: "faction_1922",           name: "Conservative 1922 Committee" },
    { id: "faction_labour_campaign", name: "Labour Campaign Group" },
    { id: "faction_labour_first",   name: "Labour First" },
    { id: "faction_blue_labour",    name: "Blue Labour" },
    { id: "faction_tory_reform",    name: "Tory Reform Group" },
    { id: "faction_erg",            name: "European Research Group" },
    { id: "faction_libdem_fed",     name: "Liberal Democrat Federalist Group" },
  ]},
  { category: "Pressure Groups", items: [
    { id: "pressure_migwatch",   name: "Migration Watch UK" },
    { id: "pressure_brit_future", name: "British Future" },
    { id: "pressure_ifs",        name: "Institute of Fiscal Studies" },
    { id: "pressure_rbl",        name: "Royal British Legion" },
    { id: "pressure_ukfinance",  name: "UK Finance" },
  ]},
  { category: "Soft Affiliations", items: [
    { id: "soft_rotary",    name: "Rotary Club" },
    { id: "soft_local_biz", name: "Local Business Network" },
    { id: "soft_alumni",    name: "University Alumni Association" },
  ]},
];

const PROFILE_FIELDS = [
  { key: "dateOfBirth", label: "Date of birth" },
  { key: "education", label: "Education" },
  { key: "careerBackground", label: "Career background" },
  { key: "family", label: "Family" },
  { key: "constituency", label: "Constituency" },
  { key: "party", label: "Party" },
  { key: "yearFirstElected", label: "Year first elected" }
];

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

function canManage(data) {
  return canAdminModOrSpeaker(data);
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
    host.innerHTML = '<section class="panel"><div class="muted-block">No character selected.</div></section>';
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

  // Monthly upkeep: prefer server-side total (totalMonthlyUpkeep = shop + property) for the
  // viewed character; fall back to computing from shopPurchases for other profiles
  // or before the API response arrives (totalMonthlyUpkeep is undefined until then).
  const monthlyUpkeep = isOwnProfile
    ? (state.totalMonthlyUpkeep ?? state.shopMonthlyUpkeep ?? computeMonthlyUpkeep(profile))
    : computeMonthlyUpkeep(profile);
  const shopUpkeepDisplay     = isOwnProfile ? (state.shopMonthlyUpkeep ?? 0) : 0;
  const propertyUpkeepDisplay = isOwnProfile ? (state.propertyMonthlyUpkeep ?? 0) : 0;
  const rentalIncomeDisplay   = isOwnProfile ? (state.rentalIncomeMonthly ?? 0) : 0;
  const annualUpkeep    = monthlyUpkeep * 12;
  const investmentIncome = Number(mods?.estimatedAnnualRevenue || 0);
  const totalAnnualIncome = Number(profile.salaryAnnual || 0) + revenueTotal + investmentIncome;
  const netAnnualIncome   = totalAnnualIncome - annualUpkeep;
  // Net bi-monthly: income credit minus 2 months of upkeep
  const netBiMonthly      = biMonthlyCredit - monthlyUpkeep * 2;
  const upkeepExceedsIncome = monthlyUpkeep > 0 && annualUpkeep > totalAnnualIncome;
  const financeOverspend    = isOwnProfile ? !!state.financeOverspend : (profile.bankBalance < 0);
  // Pre-computed sub-string for the upkeep detail note in the income summary tile
  const netBiMonthlyColor = netBiMonthly >= 0 ? "#0a7f2e" : "#c00";
  const upkeepDetailNote  = monthlyUpkeep > 0
    ? ` · upkeep deducted monthly: -${money(monthlyUpkeep)}`
      + ` · net per 2-month period: <b style="color:${netBiMonthlyColor};">${money(netBiMonthly)}</b>`
    : "";
  // Pre-computed breakdown line for shop vs property upkeep
  const upkeepBreakdownParts = [];
  if (shopUpkeepDisplay > 0)     upkeepBreakdownParts.push(`Shop: -${money(shopUpkeepDisplay)}/month`);
  if (propertyUpkeepDisplay > 0) upkeepBreakdownParts.push(`Property: -${money(propertyUpkeepDisplay)}/month`);
  const upkeepBreakdown = isOwnProfile && upkeepBreakdownParts.length
    ? `<div class="muted" style="font-size:.85em;margin-left:12px;">${upkeepBreakdownParts.join(" · ")}</div>`
    : "";

  host.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Personal</div></div>

    ${manager ? `
      <section class="panel" style="margin-bottom:12px;">
        <h2 style="margin-top:0;">Moderator Profile Selector</h2>
        <label class="label" for="personal-profile-select">View / Edit Character</label>
        <select id="personal-profile-select" class="input">
          ${selectableNames.map((n) => `<option value="${esc(n)}" ${n === activeName ? "selected" : ""}>${esc(n)}</option>`).join("")}
        </select>
      </section>
    ` : ""}

    <section class="panel" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
      <article class="tile">
        <h2 style="margin-top:0;">Name and Avatar</h2>
        <div style="display:flex;gap:10px;align-items:center;">
          ${profile.avatar
            ? `<img src="${esc(profile.avatar)}" alt="${esc(profile.avatarAttribution || profile.name)}" style="width:88px;height:88px;object-fit:cover;border-radius:10px;border:1px solid #ddd;flex-shrink:0;image-rendering:auto;" onerror="this.style.display='none';this.nextElementSibling.style.display='grid';">`
              + `<div class="muted-block" style="display:none;width:88px;height:88px;padding:0;grid-template-columns:1fr;place-items:center;flex-shrink:0;border-radius:10px;">👤</div>`
            : '<div class="muted-block" style="width:88px;height:88px;padding:0;display:grid;place-items:center;flex-shrink:0;border-radius:10px;">👤</div>'}
          <div>
            <div><b>${esc(profile.name)}</b></div>
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
                    <option value="No Qualifications" ${profile.profile.education === "No Qualifications" ? "selected" : ""}>No Qualifications</option>
                    <option value="GCSEs" ${profile.profile.education === "GCSEs" ? "selected" : ""}>GCSEs</option>
                    <option value="A Levels" ${profile.profile.education === "A Levels" ? "selected" : ""}>A Levels</option>
                    <option value="Certificate of HE" ${profile.profile.education === "Certificate of HE" ? "selected" : ""}>Certificate of HE</option>
                    <option value="Diploma" ${profile.profile.education === "Diploma" ? "selected" : ""}>Diploma</option>
                    <option value="Bachelors Degree" ${profile.profile.education === "Bachelors Degree" ? "selected" : ""}>Bachelors Degree</option>
                    <option value="Masters Degree" ${profile.profile.education === "Masters Degree" ? "selected" : ""}>Masters Degree</option>
                    <option value="Doctorate" ${profile.profile.education === "Doctorate" ? "selected" : ""}>Doctorate</option>
                  </select>
                </div>
                <div>
                  <label class="label" for="pc-career">Career Background</label>
                  <select id="pc-career" class="input" name="career_background">
                    <option value="">— select —</option>
                    <option value="Manual / Skilled Trade" ${profile.profile.careerBackground === "Manual / Skilled Trade" ? "selected" : ""}>Manual / Skilled Trade</option>
                    <option value="Public Sector Professional" ${profile.profile.careerBackground === "Public Sector Professional" ? "selected" : ""}>Public Sector Professional</option>
                    <option value="Legal Profession" ${profile.profile.careerBackground === "Legal Profession" ? "selected" : ""}>Legal Profession</option>
                    <option value="Finance / Banking / Corporate" ${profile.profile.careerBackground === "Finance / Banking / Corporate" ? "selected" : ""}>Finance / Banking / Corporate</option>
                    <option value="Business Owner / Entrepreneur" ${profile.profile.careerBackground === "Business Owner / Entrepreneur" ? "selected" : ""}>Business Owner / Entrepreneur</option>
                    <option value="Political Staffer / Researcher" ${profile.profile.careerBackground === "Political Staffer / Researcher" ? "selected" : ""}>Political Staffer / Researcher</option>
                    <option value="Trade Union / Activist" ${profile.profile.careerBackground === "Trade Union / Activist" ? "selected" : ""}>Trade Union / Activist</option>
                    <option value="Media / Journalism / Communications" ${profile.profile.careerBackground === "Media / Journalism / Communications" ? "selected" : ""}>Media / Journalism / Communications</option>
                    <option value="Academia / Education Leadership" ${profile.profile.careerBackground === "Academia / Education Leadership" ? "selected" : ""}>Academia / Education Leadership</option>
                    <option value="Military / Police / Security" ${profile.profile.careerBackground === "Military / Police / Security" ? "selected" : ""}>Military / Police / Security</option>
                  </select>
                </div>
                <div>
                  <label class="label" for="pc-family">Family</label>
                  <select id="pc-family" class="input" name="family">
                    <option value="">— select —</option>
                    <option value="Single" ${profile.profile.family === "Single" ? "selected" : ""}>Single</option>
                    <option value="Married, No Children" ${profile.profile.family === "Married, No Children" ? "selected" : ""}>Married, No Children</option>
                    <option value="Married with Children" ${profile.profile.family === "Married with Children" ? "selected" : ""}>Married with Children</option>
                    <option value="Civil Partnership" ${profile.profile.family === "Civil Partnership" ? "selected" : ""}>Civil Partnership</option>
                    <option value="Divorced" ${profile.profile.family === "Divorced" ? "selected" : ""}>Divorced</option>
                    <option value="Divorced with Children" ${profile.profile.family === "Divorced with Children" ? "selected" : ""}>Divorced with Children</option>
                    <option value="Widowed" ${profile.profile.family === "Widowed" ? "selected" : ""}>Widowed</option>
                    <option value="Long-Term Partner with Children" ${profile.profile.family === "Long-Term Partner with Children" ? "selected" : ""}>Long-Term Partner with Children</option>
                    <option value="Long-Term Partner, No Children" ${profile.profile.family === "Long-Term Partner, No Children" ? "selected" : ""}>Long-Term Partner, No Children</option>
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
                    <option value="1" ${String(profile.financialBackgroundLevel) === "1" ? "selected" : ""}>1 – Poverty</option>
                    <option value="2" ${String(profile.financialBackgroundLevel) === "2" ? "selected" : ""}>2 – Financially Strained</option>
                    <option value="3" ${String(profile.financialBackgroundLevel) === "3" ? "selected" : ""}>3 – Lower Working Class</option>
                    <option value="4" ${String(profile.financialBackgroundLevel) === "4" ? "selected" : ""}>4 – Skilled Working / Lower Middle</option>
                    <option value="5" ${String(profile.financialBackgroundLevel) === "5" ? "selected" : ""}>5 – Solid Middle Class</option>
                    <option value="6" ${String(profile.financialBackgroundLevel) === "6" ? "selected" : ""}>6 – Upper Middle Class</option>
                    <option value="7" ${String(profile.financialBackgroundLevel) === "7" ? "selected" : ""}>7 – Affluent Professional</option>
                    <option value="8" ${String(profile.financialBackgroundLevel) === "8" ? "selected" : ""}>8 – High Net Worth Individual</option>
                    <option value="9" ${String(profile.financialBackgroundLevel) === "9" ? "selected" : ""}>9 – Top 5%</option>
                    <option value="10" ${String(profile.financialBackgroundLevel) === "10" ? "selected" : ""}>10 – Top 1%</option>
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

      <article class="tile">
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
          <div class="muted" style="font-size:.88em;">
            Bi-monthly deposit: ${money(biMonthlyCredit)}${upkeepDetailNote}
          </div>
        </div>
        ${upkeepExceedsIncome ? `<div style="color:#c00;margin-top:6px;">⚠️ Monthly upkeep exceeds annual income — your balance will decline each month.</div>` : ""}
      </article>

      <article class="tile">
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
        <h2 style="margin-top:0;">Affiliations</h2>
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

    <section class="panel" style="margin-top:12px;">
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

    <section class="panel" style="margin-top:12px;">
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
          <details open style="margin-bottom:10px;">
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
              <input id="p-finbg" class="input" type="number" min="1" max="10" name="financialBackgroundLevel" value="${esc(profile.financialBackgroundLevel || "")}">
            </div>
          </div>

          <label class="label" for="p-aff">Affiliations (legacy free-text)</label>
          <textarea id="p-aff" class="input" name="affiliations" rows="2" style="display:none;">${esc(profile.affiliations || "")}</textarea>

          <h3 style="margin:10px 0 6px;">MP Profile Fields</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;">
            ${PROFILE_FIELDS.map((f) => `
              <div>
                <label class="label" for="pf-${esc(f.key)}">${esc(f.label)}</label>
                <input id="pf-${esc(f.key)}" class="input" name="profile:${esc(f.key)}" value="${esc(profile.profile[f.key] || "")}">
              </div>
            `).join("")}
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

  host.querySelector("#personal-profile-select")?.addEventListener("change", (e) => {
    state.selectedName = String(e.currentTarget.value || "");
    state.message = "";
    render(data, state);
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
        syncFinanceIntoProfile(profile, fin, data, activeName);
        state.message = `Purchased "${item.name}" for ${money(price)}.${upkeep > 0 ? ` Upkeep: ${money(upkeep)}/month.` : ""}`;
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
      try {
        await apiRemoveShopPurchase(purchaseId);
        const fin = await apiGetMyFinance();
        syncFinanceIntoProfile(profile, fin, data, activeName);
        state.message = "Purchase removed.";
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
      try {
        const result = await apiSellShopPurchase(purchaseId);
        const fin = await apiGetMyFinance();
        syncFinanceIntoProfile(profile, fin, data, activeName);
        state.message = `Item sold. Refund: ${money(result.refund || 0)}.`;
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
      try {
        await apiDismissShopPurchase(purchaseId);
        const fin = await apiGetMyFinance();
        syncFinanceIntoProfile(profile, fin, data, activeName);
        state.message = "Item dismissed.";
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
    const approved = affiliations.filter((a) => a.status === "approved");
    const pendingAdd = affiliations.filter((a) => a.status === "pending_add");
    const pendingRemove = affiliations.filter((a) => a.status === "pending_remove");
    let html = "";
    if (approved.length) {
      html += `<div style="margin-bottom:6px;"><b>Approved:</b></div>`;
      html += `<ul style="margin:0 0 8px;padding-left:18px;">` +
        approved.map((a) => `<li>${esc(a.name)} <span class="muted" style="font-size:.8em;">(${esc(a.category)})</span></li>`).join("") +
        `</ul>`;
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
            .filter((a) => a.status === "approved" || a.status === "pending_add")
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
                  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:4px;">
                    ${cat.items.map((item) => `
                      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.92em;padding:2px 0;">
                        <input type="checkbox" name="aff" value="${esc(item.id)}"${tickedIds.has(item.id) ? " checked" : ""}>
                        ${esc(item.name)}
                      </label>
                    `).join("")}
                  </div>
                </div>
              `).join("")}
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;align-items:center;">
              <button id="aff-modal-save" class="btn primary" type="button">Save & Submit</button>
              <button id="aff-modal-cancel" class="btn" type="button">Cancel</button>
              <span id="aff-modal-status" class="muted" style="font-size:.9em;"></span>
            </div>
          </div>
        `;
        document.body.appendChild(overlay);

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
    state.shopMonthlyUpkeep        = Number(fin.shopMonthlyUpkeep ?? 0);
    state.financeOverspend         = !!fin.financeOverspend;
    state.totalMonthlyUpkeep       = fin.totalMonthlyUpkeep != null ? Number(fin.totalMonthlyUpkeep) : undefined;
    state.propertyMonthlyUpkeep    = fin.propertyMonthlyUpkeep != null ? Number(fin.propertyMonthlyUpkeep) : undefined;
    state.homeLivingCostsMonthly   = fin.homeLivingCostsMonthly != null ? Number(fin.homeLivingCostsMonthly) : undefined;
    state.rentalIncomeMonthly      = fin.rentalIncomeMonthly != null ? Number(fin.rentalIncomeMonthly) : undefined;
    state.rentalCostsMonthly       = fin.rentalCostsMonthly != null ? Number(fin.rentalCostsMonthly) : undefined;
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
  const state = { selectedName: getCharacterName(data), message: "", priceIndex: 1.0, profileChangeMessage: "", shopMonthlyUpkeep: undefined, financeOverspend: false, totalMonthlyUpkeep: undefined, propertyMonthlyUpkeep: undefined, homeLivingCostsMonthly: undefined, rentalIncomeMonthly: undefined, rentalCostsMonthly: undefined };

  // Load all active characters for the moderator profile selector (non-blocking).
  if (canManage(data)) {
    apiGetCharacters({ active: "true" }).then(({ characters }) => {
      for (const c of characters) {
        const cname = String(c.name || "").trim();
        if (!cname) continue;
        data.personal.profiles[cname] ??= {
          name: cname,
          avatar: "",
          avatarAttribution: "",
          profile: {
            dateOfBirth: "",
            education: "",
            careerBackground: "",
            family: "",
            constituency: String(c.constituency || ""),
            party: String(c.party || ""),
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
          updatedAt: ""
        };
      }
      render(data, state);
    }).catch(() => {});
  }

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

  render(data, state);
}
