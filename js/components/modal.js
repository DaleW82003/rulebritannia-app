// js/components/modal.js
// Imperative modal component.
// Usage:
//   import { openModal, closeModal } from "../components/modal.js";
//   openModal({ title: "Confirm", body: "<p>Are you sure?</p>",
//               actions: [{ label: "Cancel", fn: closeModal },
//                         { label: "OK", fn: doThing, primary: true }] });

import { esc } from "../ui.js";

let _activeOverlay = null;

/**
 * Open a modal dialog.
 *
 * @param {object} opts
 * @param {string} [opts.title]   - Modal heading (will be escaped).
 * @param {string} [opts.body]    - Raw inner HTML for the modal body.
 * @param {Array}  [opts.actions] - Array of { label, fn, primary?, danger? }
 * @returns {HTMLElement} The overlay element.
 */
export function openModal({ title = "", body = "", actions = [] } = {}) {
  closeModal();

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.setAttribute("role", "presentation");

  const actionsHtml = actions
    .map(({ label, primary = false, danger = false }) => {
      const cls = ["btn", primary ? "primary" : "", danger ? "danger" : ""]
        .filter(Boolean)
        .join(" ");
      return `<button class="${esc(cls)}" type="button">${esc(label)}</button>`;
    })
    .join("");

  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="rb-modal-title">
      <div class="modal-header">
        <h2 class="modal-title" id="rb-modal-title">${esc(title)}</h2>
        <button class="modal-close" aria-label="Close">✕</button>
      </div>
      <div class="modal-body">${body}</div>
      ${actionsHtml ? `<div class="modal-footer">${actionsHtml}</div>` : ""}
    </div>
  `;

  document.body.appendChild(overlay);
  _activeOverlay = overlay;

  // Close on ✕ button
  overlay.querySelector(".modal-close")?.addEventListener("click", closeModal);

  // Close on backdrop click
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });

  // Close on Escape key
  const onKey = (e) => {
    if (e.key === "Escape") { closeModal(); document.removeEventListener("keydown", onKey); }
  };
  document.addEventListener("keydown", onKey);

  // Wire action buttons
  const btnEls = overlay.querySelectorAll(".modal-footer .btn");
  btnEls.forEach((btn, i) => {
    btn.addEventListener("click", () => actions[i]?.fn?.());
  });

  // Move focus into modal
  overlay.querySelector(".modal")?.setAttribute("tabindex", "-1");
  overlay.querySelector(".modal")?.focus();

  return overlay;
}

/**
 * Close and remove the currently open modal (if any).
 */
export function closeModal() {
  if (_activeOverlay) {
    _activeOverlay.remove();
    _activeOverlay = null;
  }
}
