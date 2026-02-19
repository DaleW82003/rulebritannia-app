// js/core.js
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

export const DATA_URL = "./data/demo.json";
export const STORAGE_KEY = "rb_data_v1";

export async function loadDemoJson() {
  const r = await fetch(DATA_URL, { cache: "no-store" });
  if (!r.ok) throw new Error(`Failed to load demo.json (${r.status})`);
  return r.json();
}

export function getData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function ensureDefaults(data) {
  // Defensive defaults so pages never "blank" because one field is missing.
  data.gameState ??= { started: false, startRealDate: "", startSimMonth: 8, startSimYear: 1997, isPaused: false };
  data.adminSettings ??= { monarchGender: "Queen" };
  data.adminSettings.monarchGender ??= "Queen";

  data.currentUser ??= { username: "Demo", isAdmin: true, isMod: true, roles: ["admin"] };
  data.currentCharacter ??= null;

  data.whatsGoingOn ??= {};
  data.whatsGoingOn.economy ??= { growth: 0, inflation: 0, unemployment: 0 };
  data.whatsGoingOn.polling ??= [];

  data.news ??= { stories: [] };
  data.papers ??= { papers: [] };
  data.questionTime ??= { offices: [], questions: [] };
  data.orderPaperCommons ??= [];

  data.economyPage ??= JSON.parse(JSON.stringify(DEFAULT_ECONOMY_PAGE));
  data.economyPage.topline ??= { ...DEFAULT_ECONOMY_PAGE.topline };
  data.economyPage.ukInfoTiles ??= JSON.parse(JSON.stringify(DEFAULT_ECONOMY_PAGE.ukInfoTiles));
  data.economyPage.surveys ??= JSON.parse(JSON.stringify(DEFAULT_ECONOMY_PAGE.surveys));

  return data;
}

export async function bootData() {
  const demo = await loadDemoJson();
  const data = getData();

  // Keep the app demo-first so deployed environments always show seeded content
  // (including newly added showcase datasets) while preserving the active login context.
  const next = data
    ? {
        ...demo,
        currentUser: data.currentUser ?? demo.currentUser,
        currentCharacter: data.currentCharacter ?? demo.currentCharacter,
        currentPlayer: data.currentPlayer ?? demo.currentPlayer
      }
    : demo;

  const ensured = ensureDefaults(next);
  saveData(ensured);
  return ensured;
}

export function qs(sel, root = document) {
  return root.querySelector(sel);
}
export function qsa(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}
