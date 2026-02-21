// js/components/toast.js
// Toast / notice notification system.
// Usage:
//   import { toast, toastSuccess, toastError } from "../components/toast.js";
//   toastSuccess("Bill submitted successfully.");
//   toastError("Something went wrong.");
//   toast("Custom message", "info", 6000);

import { esc } from "../ui.js";

let _stack = null;

function getStack() {
  if (!_stack || !_stack.isConnected) {
    _stack = document.createElement("div");
    _stack.className = "toast-stack";
    _stack.id = "rb-toast-stack";
    document.body.appendChild(_stack);
  }
  return _stack;
}

/**
 * Show a toast notification.
 *
 * @param {string} message  - The message to display (will be escaped).
 * @param {"info"|"success"|"danger"} [type] - Visual variant.
 * @param {number} [duration] - Auto-dismiss after ms; 0 = sticky.
 * @returns {Function} dismiss — call to remove the toast early.
 */
export function toast(message, type = "info", duration = 4000) {
  const stack = getStack();

  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.innerHTML = `<span class="toast-msg">${esc(message)}</span><button class="toast-close" aria-label="Dismiss">✕</button>`;

  stack.appendChild(el);

  const dismiss = () => {
    el.style.opacity = "0";
    el.style.transform = "translateY(8px)";
    el.style.transition = "opacity .15s ease, transform .15s ease";
    setTimeout(() => el.remove(), 160);
  };

  el.querySelector(".toast-close")?.addEventListener("click", dismiss);

  if (duration > 0) {
    setTimeout(dismiss, duration);
  }

  return dismiss;
}

/** Shorthand for a success (green) toast. */
export function toastSuccess(message, duration = 4000) {
  return toast(message, "success", duration);
}

/** Shorthand for an error / danger (red) toast. */
export function toastError(message, duration = 5000) {
  return toast(message, "danger", duration);
}

/** Shorthand for an informational (blue) toast. */
export function toastInfo(message, duration = 4000) {
  return toast(message, "info", duration);
}
