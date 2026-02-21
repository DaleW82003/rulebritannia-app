// js/auth.js
import { apiMe } from "./api.js";

/**
 * Ensures the current visitor is logged in.
 * Calls /auth/me; if the user is not authenticated, redirects to login.html.
 * @returns {Promise<object|null>} Resolved user object, or null if redirecting.
 */
export async function requireLogin() {
  const { user } = await apiMe();
  if (!user) {
    window.location.href = "login.html";
    return null;
  }
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
