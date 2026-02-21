import { esc } from "../ui.js";

export function initLoginPage(_data) {
  const form = document.getElementById("login-form");
  const errorEl = document.getElementById("login-error");

  if (!form) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = String(document.getElementById("login-email")?.value || "").trim();
    const password = String(document.getElementById("login-password")?.value || "");

    if (!email || !password) {
      errorEl.textContent = "Please fill in all required fields.";
      errorEl.style.display = "block";
      return;
    }

    errorEl.style.display = "none";
    // Placeholder: authentication logic goes here.
    console.info("Login attempted for:", esc(email));
  });
}
