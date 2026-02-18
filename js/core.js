// js/core.js
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
  data.gameState ??= { started: true, startRealDate: new Date().toISOString(), startSimMonth: 8, startSimYear: 1997, isPaused: false };

  data.currentUser ??= { username: "Demo", isAdmin: true, isMod: true, roles: ["admin"] };
  data.currentCharacter ??= null;

  data.whatsGoingOn ??= {};
  data.whatsGoingOn.economy ??= { growth: 0, inflation: 0, unemployment: 0 };
  data.whatsGoingOn.polling ??= [];

  data.news ??= { stories: [] };
  data.papers ??= { papers: [] };
  data.questionTime ??= { offices: [], questions: [] };
  data.orderPaperCommons ??= [];

  return data;
}

export async function bootData() {
  const demo = await loadDemoJson();
  let data = getData();
  if (!data) data = demo;

  data = ensureDefaults(data);
  saveData(data);
  return data;
}

export function qs(sel, root = document) {
  return root.querySelector(sel);
}
export function qsa(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}
