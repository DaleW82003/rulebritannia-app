// js/pages/register.js
import { esc } from "../ui.js";

const REGISTER_URL = "/api/register";

function render(host, errorMsg = "", successMsg = "") {
  if (successMsg) {
    host.innerHTML = `
      <div class="bbc-masthead"><div class="bbc-title">Apply to Join</div></div>
      <section class="panel" style="max-width:540px;">
        <div style="text-align:center;padding:24px 0;">
          <div style="font-size:3rem;margin-bottom:12px;">✅</div>
          <h2 style="margin:0 0 10px;color:var(--navy);">Application Received</h2>
          <p style="color:var(--muted);margin:0 0 18px;">${esc(successMsg)}</p>
          <a href="index.html" class="btn">Return to Home</a>
        </div>
      </section>
    `;
    return;
  }

  host.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Apply to Join</div></div>
    <section class="panel" style="max-width:540px;">
      <p class="muted" style="margin:0 0 18px;font-size:14px;">
        Rule Britannia is an invite-gated political simulation. Complete this form to apply for access.
        Your application will be reviewed by the moderation team and you will be notified on approval.
      </p>
      <form id="register-form" style="display:grid;gap:16px;" novalidate>
        <label>
          <div class="muted" style="margin-bottom:4px;">Display Name <span style="color:var(--red)">*</span></div>
          <input id="reg-name" name="name" type="text" required autocomplete="name"
                 placeholder="e.g. Jane Smith"
                 style="width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;font-size:15px;">
        </label>
        <label>
          <div class="muted" style="margin-bottom:4px;">Username <span style="color:var(--red)">*</span></div>
          <input id="reg-username" name="username" type="text" required autocomplete="username"
                 placeholder="e.g. janesmith"
                 style="width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;font-size:15px;">
          <div class="small" style="margin-top:4px;">Letters, numbers, underscores and hyphens only. 3–30 characters.</div>
        </label>
        <label>
          <div class="muted" style="margin-bottom:4px;">Email Address <span style="color:var(--red)">*</span></div>
          <input id="reg-email" name="email" type="email" required autocomplete="email"
                 placeholder="you@example.com"
                 style="width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;font-size:15px;">
        </label>
        <label>
          <div class="muted" style="margin-bottom:4px;">Password <span style="color:var(--red)">*</span></div>
          <input id="reg-password" name="password" type="password" required autocomplete="new-password"
                 placeholder="Minimum 8 characters"
                 style="width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;font-size:15px;">
        </label>
        <label>
          <div class="muted" style="margin-bottom:4px;">Confirm Password <span style="color:var(--red)">*</span></div>
          <input id="reg-password2" name="password2" type="password" required autocomplete="new-password"
                 placeholder="Repeat password"
                 style="width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;font-size:15px;">
        </label>

        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;">
          <input id="reg-age" name="age_attested" type="checkbox" required
                 style="margin-top:3px;flex-shrink:0;width:16px;height:16px;">
          <span style="font-size:14px;">
            I confirm that I am 16 years of age or older. <span style="color:var(--red)">*</span>
          </span>
        </label>

        <div id="reg-error" style="display:none;color:var(--red);font-size:13px;padding:8px 12px;background:rgba(212,0,26,.07);border-radius:8px;"></div>
        <button class="btn primary" type="submit" style="width:100%;justify-content:center;">Submit Application</button>
      </form>
      <p style="margin-top:14px;font-size:13px;color:var(--muted);text-align:center;">
        Already have an account? <a href="login.html" style="color:var(--blue);">Login here</a>
      </p>
    </section>
  `;
}

export function initRegisterPage(_data, _user) {
  const host = document.getElementById("register-root") || document.querySelector("main.wrap");
  if (!host) return;

  render(host);

  const form = host.querySelector("#register-form");
  const errorEl = host.querySelector("#reg-error");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.style.display = "none";

    const name     = String(form.querySelector("#reg-name")?.value || "").trim();
    const username = String(form.querySelector("#reg-username")?.value || "").trim();
    const email    = String(form.querySelector("#reg-email")?.value || "").trim().toLowerCase();
    const password = String(form.querySelector("#reg-password")?.value || "");
    const password2 = String(form.querySelector("#reg-password2")?.value || "");
    const ageOk   = form.querySelector("#reg-age")?.checked;

    // Client-side validation
    if (!name || !username || !email || !password) {
      errorEl.textContent = "Please fill in all required fields.";
      errorEl.style.display = "block";
      return;
    }
    if (!/^[a-zA-Z0-9_-]{3,30}$/.test(username)) {
      errorEl.textContent = "Username must be 3–30 characters using only letters, numbers, underscores, or hyphens.";
      errorEl.style.display = "block";
      return;
    }
    if (password.length < 8) {
      errorEl.textContent = "Password must be at least 8 characters.";
      errorEl.style.display = "block";
      return;
    }
    if (password !== password2) {
      errorEl.textContent = "Passwords do not match.";
      errorEl.style.display = "block";
      return;
    }
    if (!ageOk) {
      errorEl.textContent = "You must confirm you are 16 or older to apply.";
      errorEl.style.display = "block";
      return;
    }

    const submitBtn = form.querySelector("button[type=submit]");
    if (submitBtn) submitBtn.disabled = true;

    try {
      const resp = await fetch(REGISTER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ name, username, email, password, age_attested: true }),
      });
      const json = await resp.json().catch(() => ({}));
      if (resp.ok && json.ok) {
        render(host, "", json.message || "Your application has been submitted and is pending review. You will be contacted when it is approved.");
      } else {
        errorEl.textContent = json.error || "Submission failed. Please try again.";
        errorEl.style.display = "block";
        if (submitBtn) submitBtn.disabled = false;
      }
    } catch {
      errorEl.textContent = "Network error. Please check your connection and try again.";
      errorEl.style.display = "block";
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}
