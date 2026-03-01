import { apiLogin } from "../api.js";
import { esc } from "../ui.js";

function render(host, errorMsg, pendingMsg) {
  const pendingBanner = pendingMsg ? `
    <div style="padding:10px 14px;background:var(--blue-faint,#e8f0fe);border-radius:8px;font-size:13px;color:var(--blue);">
      ${esc(pendingMsg)}
    </div>
  ` : "";

  host.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Login</div></div>
    <section class="panel" style="max-width:420px;">
      ${pendingBanner}
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
    </section>
    <p style="margin-top:14px;font-size:13px;color:var(--muted);text-align:center;max-width:420px;">
      Don't have an account? <a href="register.html" style="color:var(--blue);">Apply to join</a> — applications are reviewed by our moderation team.
    </p>
  `;
}

export function initLoginPage(_data) {
  const host = document.getElementById("login-root") || document.querySelector("main.wrap");
  if (!host) return;

  // Show any SSO error or pending-SSO hint passed back via query string
  const urlParams  = new URLSearchParams(window.location.search);
  const ssoError   = urlParams.get("sso_error") || "";
  const ssoPending = urlParams.get("sso_pending") === "1";
  const pendingMsg = ssoPending ? "Please log in to continue to the Discourse Forum." : "";

  render(host, ssoError, pendingMsg);

  const form    = host.querySelector("#login-form");
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
      .then((result) => {
        // Safe relative-path check: only /api/* or known SIM pages (no query strings
        // accepted, to prevent open-redirect via manipulated parameters).
        const safeRelative = (s) => typeof s === "string" && /^\/[a-zA-Z0-9/_-]+$/.test(s);

        // Priority 1: server-provided redirect (e.g. resume a pending Discourse SSO)
        const serverRedirect = result?.redirect;
        if (safeRelative(serverRedirect)) {
          window.location.href = serverRedirect;
          return;
        }
        // Priority 2: ?next= URL param (e.g. set by /api/discourse/go when user wasn't logged in)
        // Validated against an allowlist of known SIM-internal destinations.
        const SAFE_NEXT = new Set(["/api/discourse/go"]);
        const next = urlParams.get("next") || "";
        if (SAFE_NEXT.has(next)) {
          window.location.href = next;
          return;
        }
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
