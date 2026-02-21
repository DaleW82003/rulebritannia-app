import { apiLogin } from "../api.js";
import { esc } from "../ui.js";

function render(host, errorMsg) {
  host.innerHTML = `
    <h1 class="page-title">Admin Login</h1>
    <section class="panel" style="max-width:420px;">
      <form id="login-form" style="display:grid;gap:14px;">
        <label>
          <div class="muted" style="margin-bottom:4px;">Email</div>
          <input id="login-email" type="email" required autocomplete="email"
                 placeholder="admin@example.com"
                 style="width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;font-size:15px;">
        </label>
        <label>
          <div class="muted" style="margin-bottom:4px;">Password</div>
          <input id="login-password" type="password" required autocomplete="current-password"
                 placeholder="••••••••"
                 style="width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;font-size:15px;">
        </label>
        <div id="login-error" style="${errorMsg ? "" : "display:none;"}color:var(--red);font-size:13px;">${esc(errorMsg)}</div>
        <button class="btn primary" type="submit" style="width:100%;justify-content:center;">Login</button>
      </form>
    </section>
  `;
}

export function initLoginPage(_data) {
  const host = document.getElementById("login-root") || document.querySelector("main.wrap");
  if (!host) return;

  render(host, "");

  const form = host.querySelector("#login-form");
  const errorEl = host.querySelector("#login-error");

  if (!form) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = String(host.querySelector("#login-email")?.value || "").trim();
    const password = String(host.querySelector("#login-password")?.value || "");

    if (!email || !password) {
      errorEl.textContent = "Please fill in all required fields.";
      errorEl.style.display = "block";
      return;
    }

    errorEl.style.display = "none";
    const btn = form.querySelector("button[type=submit]");
    if (btn) btn.disabled = true;

    apiLogin(email, password)
      .then(() => {
        window.location.href = "admin-panel.html";
      })
      .catch((err) => {
        const status = err?.message?.match(/\((\d+)\)/)?.[1];
        errorEl.textContent =
          status === "401"
            ? "Invalid email or password."
            : "Login failed. Please try again.";
        errorEl.style.display = "block";
        if (btn) btn.disabled = false;
      });
  });
}
