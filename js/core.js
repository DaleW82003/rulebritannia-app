// js/core.js
import { apiBootstrap, apiGetState, apiSaveState, setCsrfToken } from "./api.js";

// ── Session state cache (set once during bootData) ───────────────────────────
let _user = null;
let _bootstrapConfig = {};

/**
 * Returns true when the current visitor has an active server session.
 * This is the single source of truth for session state across the application.
 * @returns {boolean}
 */
export function isLoggedIn() {
  return Boolean(_user?.id);
}

/**
 * Returns the non-sensitive config object from the last bootstrap response.
 * Available after bootData() resolves. Contains keys such as sso_enabled,
 * discourse_base_url, ui_base_url, etc.
 * @returns {object}
 */
export function getBootstrapConfig() {
  return _bootstrapConfig;
}

/**
 * Load simulation state from the appropriate source.
 * - When logged in: fetches the live state from GET /api/state.
 * - When not logged in: fetches the read-only demo baseline from /data/demo.json.
 * This is the sole data loader; no page may reference either source directly.
 * @returns {Promise<object>} The resolved state data object.
 */
export async function getState() {
  if (isLoggedIn()) {
    const result = await apiGetState();
    if (!result?.data) {
      console.warn("[getState] API returned no state data; defaulting to empty object.");
    }
    return result?.data ?? {};
  }
  const res = await fetch("/data/demo.json");
  if (!res.ok) throw new Error(`Failed to load demo data (${res.status})`);
  return res.json();
}

const DEFAULT_ECONOMY_PAGE = {
  topline: { gdpGrowth: 1.8, inflation: 2.6, unemployment: 4.3 },
  ukInfoTiles: [
    { id: "econ-indicators", title: "Economic Indicators", subtitle: "Core macroeconomic snapshot", rows: [["Inflation","2.6%"],["Unemployment","4.3%"],["GDP","£0.9tn"],["GDP Growth","1.8%"],["GDP per Capita","£15,500"],["Investment (% of GDP)","17.2%"],["BoE Interest Rate","6.0%"],["Business Confidence","49.0"],["Average UK Income (Full Time Salary)","£23,900"]] },
    { id: "public-finance", title: "Public Finance", subtitle: "Fiscal year (Apr-Mar) settlement", rows: [["Revenue Last Year","£355.0bn"],["Expenses Last Year","£383.0bn"],["Surplus/Deficit Last Year","-£28.0bn"],["Real Growth (GDP Growth minus Inflation)","-0.8%"],["National Debt","£560.0bn"],["Debt Interest","£23.0bn"],["Debt as a % of GDP","62.2%"]] },
    { id: "demographics", title: "Demographics", subtitle: "Population and labour-market context", rows: [["Population","58.6m"],["Net Migration","+50k"],["Pensioners","10.9m"],["Students","2.1m"],["Total Unemployed","2.5m"],["Total Economically Inactive","16.7m"],["Electoral Franchise","44.4m"],["Registered Births","690k"],["Registered Deaths","610k"]] }
  ],
  surveys: [
    { id: "british-crime-survey", title: "British Crime Survey", subtitle: "Annual offences (headline)", rows: [["Violent Crimes","1.06m"],["Sexual Offences","54k"],["Burglary","810k"],["Theft","2.10m"],["Criminal Damage","640k"],["Arson","34k"],["Fraud","410k"],["Drug Possession","128k"],["Drug Supply","41k"],["Public Order Offence","300k"],["Driving Offences","585k"],["Offensive Weapon","27k"],["Other Offences","190k"]] },
    { id: "nhs-waiting", title: "NHS Waiting Lists", subtitle: "Patients waiting by speciality", rows: [["Trauma & Orthopaedics","840k"],["General Surgery","790k"],["Ophthalmology","520k"],["ENT (Ear, Nose & Throat)","300k"],["Obstetrics & Gynaecology (OBGYN)","270k"],["Urology","220k"],["Plastic Surgery","125k"],["Oral Surgery","90k"],["Other Surgeries","560k"]] },
    { id: "labour-survey", title: "UK Labour Survey", subtitle: "Employment stock", rows: [["Public Sector Workforce","5.3m"],["Private Sector Workforce","21.9m"],["Total Employed","27.2m"]] }
  ]
};

export const STORAGE_KEY = "rb_data_v1";

// Local simulation store is permanently disabled.
// Demo mode is read-only; no simulation state is ever written to localStorage.
function canUseLocalSimStore() {
  return false;
}

export function getData() {
  if (!canUseLocalSimStore()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveData(_data) {
  // Local simulation state persistence is permanently disabled.
  // saveData() is now a no-op; any callers should be migrated to saveState() or feature APIs.
  console.warn("[RB_SIM_STORE_DISABLED] saveData() called but local simulation state persistence is disabled. Demo mode is read-only.");
}

/**
 * Guards write actions behind a login check.
 * Call this at the top of any submit/save handler that would mutate simulation state.
 * Returns true if the user is logged in and may proceed; shows a toast and returns false otherwise.
 * @param {string} [actionLabel] - Optional label for the action (used in log only; toast is generic).
 * @returns {boolean}
 */
export function requireLoginForWrite(actionLabel = "write action") {
  if (isLoggedIn()) return true;
  import("./components/toast.js").then(({ toastError }) => {
    toastError("Login required to perform this action.");
  }).catch((err) => {
    console.warn("[requireLoginForWrite] toast module unavailable:", err);
  });
  console.warn(`[requireLoginForWrite] blocked demo-mode ${actionLabel} — user is not logged in.`);
  return false;
}

/**
 * Recursively freezes an object so that accidental mutations in demo mode are
 * caught immediately (TypeError in strict mode; silent no-op otherwise).
 * @template T
 * @param {T} obj
 * @returns {T}
 */
export function deepFreeze(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  Object.keys(obj).forEach((key) => deepFreeze(obj[key]));
  Object.freeze(obj);
  return obj;
}

/**
 * Persist simulation state.
 * - When logged in as admin/mod/speaker: writes to localStorage and POSTs to the backend.
 * - When logged in as staff (admin/mod/speaker): writes to the backend via POST /api/state.
 * - When logged in as a regular user: silently skips the global-state snapshot write.
 *   Feature-specific APIs (e.g. POST /api/parties/:id/drafts) should be used instead for player writes.
 * - When not logged in: shows a "Login required" notice and does not persist.
 * This is the sole global-state write function; no page may write localStorage directly.
 * @param {object} data - The full state object to persist.
 */
export function saveState(data) {
  if (!isLoggedIn()) {
    import("./components/toast.js").then(({ toastError }) => {
      toastError("Login required to save changes.");
    }).catch((err) => {
      console.warn("[saveState] toast module unavailable:", err);
    });
    return Promise.resolve();
  }
  // Only staff roles may write the global state snapshot.
  // Non-staff authenticated users rely on feature-specific API endpoints for their writes.
  const roles = Array.isArray(_user?.roles) ? _user.roles : [];
  const canPersist = roles.includes("admin") || roles.includes("mod") || roles.includes("speaker");
  if (!canPersist) {
    console.warn("[saveState] skipped for non-staff user -- use feature APIs for player writes.");
    return Promise.resolve();
  }
  return apiSaveState(data).catch((err) => console.error("[saveState] API save failed:", err)); // UI_ONLY_OK: saveState() returns this promise to callers; errors are surfaced via console at the module boundary
}

export function ensureDefaults(data) {
  // Defensive defaults so pages never "blank" because one field is missing.
  // Null-coalescing for missing keys + type guards for critical arrays/objects.
  data.gameState ??= { started: false, startRealDate: "", startSimMonth: 8, startSimYear: 1997, isPaused: false, pausedAtRealDate: "" };
  data.gameState.pausedAtRealDate ??= "";
  data.adminSettings ??= { monarchGender: "Queen" };
  data.adminSettings.monarchGender ??= "Queen";

  data.currentUser ??= { username: "Demo", isAdmin: true, isMod: true, roles: ["admin"] };
  data.currentCharacter ??= null;

  data.whatsGoingOn ??= {};
  data.whatsGoingOn.economy ??= { growth: 0, inflation: 0, unemployment: 0 };
  if (!Array.isArray(data.whatsGoingOn.polling)) data.whatsGoingOn.polling = [];

  data.news ??= { stories: [] };
  if (!Array.isArray(data.news.stories)) data.news.stories = [];
  data.papers ??= { papers: [] };
  if (!Array.isArray(data.papers.papers) || data.papers.papers.length === 0) {
    const DEFAULT_PAPERS = [
      { key: "times", name: "The Times", cls: "paper-times", issues: [] },
      { key: "telegraph", name: "The Daily Telegraph", cls: "paper-telegraph", issues: [] },
      { key: "guardian", name: "The Guardian", cls: "paper-guardian", issues: [] },
      { key: "mail", name: "The Daily Mail", cls: "paper-mail", issues: [] },
      { key: "sun", name: "The Sun", cls: "paper-sun", issues: [] },
      { key: "mirror", name: "The Daily Mirror", cls: "paper-mirror", issues: [] },
      { key: "independent", name: "The Independent", cls: "paper-independent", issues: [] },
      { key: "express", name: "The Daily Express", cls: "paper-express", issues: [] },
      { key: "ft", name: "Financial Times", cls: "paper-ft", issues: [] },
    ];
    data.papers.papers = DEFAULT_PAPERS.map((p) => ({ ...p }));
  } else if (!data.papers.papers.find((p) => p.key === "ft")) {
    data.papers.papers.push({ key: "ft", name: "Financial Times", cls: "paper-ft", issues: [] });
  }
  data.liveDocket ??= { asOf: "Today", items: [] };
  data.liveDocket.items ??= [];
  data.liveDocket.seenActivityTs ??= {};

  data.questionTime ??= { offices: [], questions: [] };
  if (!Array.isArray(data.questionTime.offices)) data.questionTime.offices = [];
  if (!Array.isArray(data.questionTime.questions)) data.questionTime.questions = [];
  if (!Array.isArray(data.orderPaperCommons)) data.orderPaperCommons = [];
  if (!Array.isArray(data.players)) data.players = [];

  data.motions ??= { house: [], edm: [] };
  if (!Array.isArray(data.motions.house)) data.motions.house = [];
  if (!Array.isArray(data.motions.edm)) data.motions.edm = [];
  data.statements ??= { items: [] };
  if (!Array.isArray(data.statements.items)) data.statements.items = [];
  data.regulations ??= { items: [] };
  if (!Array.isArray(data.regulations.items)) data.regulations.items = [];
  data.hansard ??= { passed: [], defeated: [] };
  if (!Array.isArray(data.hansard.passed)) data.hansard.passed = [];
  if (!Array.isArray(data.hansard.defeated)) data.hansard.defeated = [];

  data.parliament ??= { totalSeats: 650, parties: [] };
  if (!Array.isArray(data.parliament.parties)) data.parliament.parties = [];
  if (data.parliament.parties.length === 0) {
    data.parliament.parties = [
      { name: "Conservative",      seats: 0, playable: true  },
      { name: "Labour",            seats: 0, playable: true  },
      { name: "Liberal Democrat",  seats: 0, playable: true  },
      { name: "SNP",               seats: 0, playable: false },
      { name: "Plaid Cymru",       seats: 0, playable: false },
      { name: "Green",             seats: 0, playable: false },
      { name: "UKIP",              seats: 0, playable: false },
      { name: "DUP",               seats: 0, playable: false },
      { name: "Sinn Féin",         seats: 0, playable: false },
      { name: "SDLP",              seats: 0, playable: false },
      { name: "Alliance",          seats: 0, playable: false },
      { name: "TUP",               seats: 0, playable: false },
      { name: "Independents",      seats: 0, playable: false },
      { name: "Speaker",           seats: 0, playable: false },
    ];
  }

  data.polling ??= { tracker: [] };
  if (!Array.isArray(data.polling.tracker)) data.polling.tracker = [];

  data.economyPage ??= JSON.parse(JSON.stringify(DEFAULT_ECONOMY_PAGE));
  data.economyPage.topline ??= { ...DEFAULT_ECONOMY_PAGE.topline };
  if (!Array.isArray(data.economyPage.ukInfoTiles)) data.economyPage.ukInfoTiles = JSON.parse(JSON.stringify(DEFAULT_ECONOMY_PAGE.ukInfoTiles));
  if (!Array.isArray(data.economyPage.surveys)) data.economyPage.surveys = JSON.parse(JSON.stringify(DEFAULT_ECONOMY_PAGE.surveys));

  return data;
}

/**
 * Rebuild data.parliament.parties from DB-backed bootstrap data.
 * Constituencies are the source of truth for seat counts; the parties table
 * is the source of truth for the playable flag.
 * This must run after ensureDefaults() so parliament.parties already exists.
 */
function applyBootstrapParliament(data, bootstrap) {
  const canonicalParties = Array.isArray(bootstrap?.canonicalParties) ? bootstrap.canonicalParties : [];
  const seatTotals       = Array.isArray(bootstrap?.seatTotals)       ? bootstrap.seatTotals       : [];
  if (!canonicalParties.length) return; // No DB data yet — leave ensureDefaults values in place.

  const seatMap = {};
  for (const r of seatTotals) seatMap[String(r.party)] = Number(r.seats);

  data.parliament.parties = canonicalParties.map((cp) => ({
    name:     cp.name,
    seats:    seatMap[cp.name] || 0,
    playable: Boolean(cp.playable),
  }));

  data.parliament.totalSeats = data.parliament.parties.reduce((s, p) => s + p.seats, 0) || 650;
}


export async function bootData() {
  const sources = [];

  // Single round-trip: /api/bootstrap returns clock + config + user + state.
  const bootstrap = await apiBootstrap().then(
    (r) => { sources.push({ label: "/api/bootstrap", ok: true  }); return r; },
    (e) => { sources.push({ label: "/api/bootstrap", ok: false, error: e.message }); return null; }
  );

  const user   = bootstrap?.user  ?? null;
  const clock  = bootstrap?.clock ?? null;
  // Canonical active character from bootstrap (DB-derived, never stale localStorage).
  const bootstrapCharacter = bootstrap?.currentCharacter ?? null;

  if (bootstrap?.csrfToken) setCsrfToken(bootstrap.csrfToken);

  // Cache session state so isLoggedIn() and saveState() can use it synchronously.
  _user = user;
  _bootstrapConfig = bootstrap?.config ?? {};

  if (!user) {
    // If bootstrap failed (network/server error), show a warning but do NOT rehydrate
    // any cached state or fall back to demo.json.  The user must refresh or try again.
    const bootstrapFailed = sources.some((s) => s.label === "/api/bootstrap" && !s.ok);
    if (bootstrapFailed) {
      console.warn("[bootData] Bootstrap failed — server may be unavailable.");
      return {
        data: ensureDefaults({}),
        user: null,
        clock,
        sources,
        bootWarning: "Cannot reach the server. Your session may still be active — please refresh or try again shortly.",
      };
    }

    // Not logged in — load demo baseline from demo.json (read-only; no localStorage writes).
    // Purge any stale simulation data that older builds may have written.
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    let demoData = {};
    try {
      const res = await fetch("/data/demo.json");
      if (res.ok) demoData = await res.json();
    } catch (e) {
      console.warn("[bootData] Failed to load demo.json:", e.message);
    }
    const ensured = ensureDefaults(demoData);
    // Deep-freeze the demo baseline so accidental mutations are caught at the call site.
    deepFreeze(ensured);
    return { data: ensured, user: null, clock, sources };
  }

  // Logged in.
  let serverData = bootstrap?.state?.data ?? null;

  if (!serverData) {
    // No state yet → seed the DB with empty defaults (admin only).
    if (Array.isArray(user.roles) && user.roles.includes("admin")) {
      await apiSaveState(ensureDefaults({})).catch((err) => console.error("[bootData] first-admin DB seed failed (admin:", user.id, "):", err));
    }
    serverData = {};
  }

  const ensured = ensureDefaults(serverData);
  ensured.currentUser = user;
  // Always overwrite currentCharacter with the DB-canonical value from bootstrap.
  // This prevents stale localStorage from a previous session (e.g. different account) bleeding in.
  ensured.currentCharacter = bootstrapCharacter;

  // Constituencies are the source of truth for parliament seat counts.
  // Always rebuild parliament.parties from the DB-backed bootstrap data so that
  // no stale state or client-side baseline can override the live seat picture.
  applyBootstrapParliament(ensured, bootstrap);

  return { data: ensured, user, clock, sources };
}

export function nowMs() {
  return Date.now();
}

export function nowStamp() {
  return new Date().toLocaleString("en-GB", { hour12: false });
}

export function qs(sel, root = document) {
  return root.querySelector(sel);
}
export function qsa(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}
