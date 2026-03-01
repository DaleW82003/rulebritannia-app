import { apiLogin } from "../api.js";
import { esc } from "../ui.js";
import { getBootstrapConfig } from "../core.js";

function render(host, errorMsg, ssoEnabled) {
  const ssoSection = ssoEnabled ? `
    <div style="display:flex;align-items:center;gap:10px;margin:8px 0;">
      <hr style="flex:1;border:none;border-top:1px solid var(--line);">
      <span class="muted" style="font-size:13px;white-space:nowrap;">or</span>
      <hr style="flex:1;border:none;border-top:1px solid var(--line);">
    </div>
    <a class="btn" href="/api/discourse/sso" style="width:100%;justify-content:center;text-align:center;text-decoration:none;">
      Login with Discourse
    </a>
  ` : "";

  host.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Login</div></div>
    <section class="panel" style="max-width:420px;">
      <form id="login-form" style="display:grid;gap:14px;">
        <label>
          <div class="muted" style="margin-bottom:4px;">Email</div>
          <input id="login-email" type="email" required autocomplete="email"
                 placeholder="your@email.com"
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
      ${ssoSection}
    </section>
    <p style="margin-top:14px;font-size:13px;color:var(--muted);text-align:center;max-width:420px;">
      Don't have an account? <a href="register.html" style="color:var(--blue);">Apply to join</a> — applications are reviewed by our moderation team.
    </p>
  `;
}

export function initLoginPage(_data) {
  const host = document.getElementById("login-root") || document.querySelector("main.wrap");
  if (!host) return;

  const cfg = getBootstrapConfig();
  const ssoEnabled = cfg?.sso_enabled === true;

  // Show any SSO error passed back via query string (e.g. after a failed SSO redirect)
  const urlParams = new URLSearchParams(window.location.search);
  const ssoError  = urlParams.get("sso_error") || "";

  render(host, ssoError, ssoEnabled);

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
        window.location.href = "dashboard.html";
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
