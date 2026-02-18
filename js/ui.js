// js/ui.js
import { qsa } from "./core.js";

export function initNavUI() {
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
