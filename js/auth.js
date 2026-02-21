// js/auth.js
const API_BASE = (typeof window !== "undefined" && window.RB_API_BASE) || "";

/**
 * Ensures the current visitor is logged in.
 * Calls /auth/me; if the response is 401, redirects to login.html.
 * @returns {Promise<object|null>} Resolved user object, or null if redirecting.
 */
export async function requireLogin() {
  const res = await fetch(`${API_BASE}/auth/me`, { credentials: "include" });
  if (res.status === 401) {
    window.location.href = "login.html";
    return null;
  }
  if (!res.ok) throw new Error(`requireLogin: /auth/me failed (${res.status})`);
  const { user } = await res.json();
  return user;
}

/**
 * Ensures the current visitor is logged in AND has the "admin" role.
 * Redirects to login.html if not authenticated.
 * Renders a "Forbidden" message if authenticated but not admin.
 * @returns {Promise<object|null>} Resolved admin user, or null if redirected/forbidden.
 */
export async function requireAdmin() {
  const user = await requireLogin();
  if (!user) return null;

  if (!Array.isArray(user.roles) || !user.roles.includes("admin")) {
    const main = document.querySelector("main") || document.body;
    const p = document.createElement("p");
    p.style.cssText = "padding:2rem;font-size:1.2rem;color:var(--red,#c00);";
    p.textContent = "Forbidden: Admin access required.";
    main.replaceChildren(p);
    return null;
  }

  return user;
}
