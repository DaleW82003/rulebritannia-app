// js/api.js
const API_BASE = (typeof window !== "undefined" && window.RB_API_BASE) || "";

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
  if (res.status === 401) return { user: null };
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
