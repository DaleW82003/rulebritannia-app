// js/api.js
function resolveApiBase() {
  if (typeof window !== "undefined" && window.RB_API_BASE) return window.RB_API_BASE;
  if (typeof window !== "undefined") {
    const h = window.location.hostname;
    if (
      h === "rulebritannia.org" ||
      h.endsWith(".rulebritannia.org") ||
      h === "rulebritannia-app.onrender.com"
    ) {
      return "https://rulebritannia-app-backend.onrender.com";
    }
  }
  return "";
}
const API_BASE = resolveApiBase();

export async function apiLogin(email, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`apiLogin failed (${res.status})`);
  return res.json();
}

export async function apiMe() {
  const res = await fetch(`${API_BASE}/auth/me`, {
    credentials: "include",
  });
  if (res.status === 401 || res.status === 404) return { user: null };
  if (!res.ok) throw new Error(`apiMe failed (${res.status})`);
  return res.json();
}

export async function apiLogout() {
  const res = await fetch(`${API_BASE}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`apiLogout failed (${res.status})`);
  return res.json();
}

export async function apiGetState() {
  const res = await fetch(`${API_BASE}/api/state`, {
    credentials: "include",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`apiGetState failed (${res.status})`);
  return res.json();
}

export async function apiSaveState(data) {
  const res = await fetch(`${API_BASE}/api/state`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data }),
  });
  if (!res.ok) throw new Error(`apiSaveState failed (${res.status})`);
  return res.json();
}

export async function apiGetConfig() {
  const res = await fetch(`${API_BASE}/api/config`);
  if (!res.ok) throw new Error(`apiGetConfig failed (${res.status})`);
  return res.json();
}

export async function apiSaveConfig(config) {
  const res = await fetch(`${API_BASE}/api/config`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(`apiSaveConfig failed (${res.status})`);
  return res.json();
}
