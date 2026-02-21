// js/ui.js
import { qsa } from "./core.js";
import { apiLogout } from "./api.js";

export function initNavUI(user) {
  // Dropdown open/close
  const groups = qsa(".nav-group");
  groups.forEach(g => {
    const btn = g.querySelector(".nav-toggle");
    if (!btn) return;

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      // close others
      groups.forEach(other => { if (other !== g) other.classList.remove("open"); });
      g.classList.toggle("open");
    });
  });

  document.addEventListener("click", () => {
    groups.forEach(g => g.classList.remove("open"));
  });

  // Topbar auth status — replace the static "Admin Login" element
  const nav = document.querySelector(".nav");
  if (nav) {
    const existing = nav.querySelector('a[href="login.html"].nav-link, span.nav-link[aria-current="page"]');
    if (existing) existing.remove();

    const authEl = document.createElement("span");
    authEl.id = "topbar-auth";
    authEl.className = "topbar-auth";

    if (user) {
      const label = document.createElement("span");
      label.className = "topbar-auth-label";
      label.textContent = `Logged in as ${user.username}`;

      const logoutBtn = document.createElement("button");
      logoutBtn.type = "button";
      logoutBtn.className = "topbar-logout-btn";
      logoutBtn.textContent = "Logout";
      logoutBtn.addEventListener("click", async () => {
        try { await apiLogout(); } catch { /* ignore */ }
        window.location.href = "dashboard.html";
      });

      authEl.appendChild(label);
      authEl.appendChild(logoutBtn);
    } else {
      const label = document.createElement("span");
      label.className = "topbar-auth-label";
      label.textContent = "Not logged in";

      const loginLink = document.createElement("a");
      loginLink.href = "login.html";
      loginLink.className = "nav-link";
      loginLink.textContent = "Login";

      authEl.appendChild(label);
      authEl.appendChild(loginLink);
    }

    nav.appendChild(authEl);
  }
}

export function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

export function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
