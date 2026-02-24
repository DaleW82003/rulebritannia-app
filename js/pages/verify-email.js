// js/pages/verify-email.js
import { esc } from "../ui.js";

export function initVerifyEmailPage(_data, _user) {
  const host = document.getElementById("verify-email-root") || document.querySelector("main.wrap");
  if (!host) return;

  const params = new URLSearchParams(window.location.search);
  const token  = params.get("token") || "";

  if (!token) {
    host.innerHTML = `
      <div class="bbc-masthead"><div class="bbc-title">Email Verification</div></div>
      <section class="panel" style="max-width:520px;">
        <div style="text-align:center;padding:24px 0;">
          <div style="font-size:3rem;margin-bottom:12px;">⚠️</div>
          <h2 style="margin:0 0 10px;color:var(--navy);">No Verification Token</h2>
          <p style="color:var(--muted);margin:0 0 18px;">
            This page requires a verification link from your email. If you have not received one,
            you can request a new link below.
          </p>
          <a href="register.html" class="btn" style="margin-right:8px;">Back to Registration</a>
        </div>
      </section>
    `;
    return;
  }

  // Show loading state while we verify
  host.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Email Verification</div></div>
    <section class="panel" style="max-width:520px;">
      <div style="text-align:center;padding:24px 0;">
        <div style="font-size:3rem;margin-bottom:12px;">⏳</div>
        <h2 style="margin:0 0 10px;color:var(--navy);">Verifying your email…</h2>
        <p class="muted">Please wait a moment.</p>
      </div>
    </section>
  `;

  fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`, {
    method: "GET",
    credentials: "same-origin",
  })
    .then((r) => r.json().then((json) => ({ status: r.status, json })))
    .then(({ status, json }) => {
      if (status === 200 && json.ok) {
        host.innerHTML = `
          <div class="bbc-masthead"><div class="bbc-title">Email Verified</div></div>
          <section class="panel" style="max-width:520px;">
            <div style="text-align:center;padding:24px 0;">
              <div style="font-size:3rem;margin-bottom:12px;">✅</div>
              <h2 style="margin:0 0 10px;color:var(--navy);">Email Verified!</h2>
              <p style="color:var(--muted);margin:0 0 18px;">
                ${esc(json.message || "Your email has been verified. Once your application is approved by an admin, you will be able to log in.")}
              </p>
              <a href="login.html" class="btn primary">Go to Login</a>
            </div>
          </section>
        `;
      } else {
        const msg = json?.error || "The verification link is invalid or has expired.";
        host.innerHTML = `
          <div class="bbc-masthead"><div class="bbc-title">Verification Failed</div></div>
          <section class="panel" style="max-width:520px;">
            <div style="text-align:center;padding:24px 0;">
              <div style="font-size:3rem;margin-bottom:12px;">❌</div>
              <h2 style="margin:0 0 10px;color:var(--navy);">Verification Failed</h2>
              <p style="color:var(--muted);margin:0 0 18px;">${esc(msg)}</p>
              <p style="font-size:13px;color:var(--muted);margin:0 0 18px;">
                Links expire after 24 hours and can only be used once. You can request a new verification
                email if needed — enter your email address below.
              </p>
              <form id="resend-form" style="max-width:320px;margin:0 auto 16px;">
                <input id="resend-email" type="email" required placeholder="your@email.com"
                       style="width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;font-size:15px;margin-bottom:8px;">
                <button class="btn" type="submit" style="width:100%;justify-content:center;">Resend Verification Email</button>
              </form>
              <div id="resend-msg" style="display:none;font-size:13px;color:var(--muted);"></div>
              <a href="register.html" style="font-size:13px;color:var(--blue);">Need to register?</a>
            </div>
          </section>
        `;
        host.querySelector("#resend-form")?.addEventListener("submit", handleResend);
      }
    })
    .catch(() => {
      host.innerHTML = `
        <div class="bbc-masthead"><div class="bbc-title">Email Verification</div></div>
        <section class="panel" style="max-width:520px;">
          <div style="text-align:center;padding:24px 0;">
            <div style="font-size:3rem;margin-bottom:12px;">❌</div>
            <h2 style="margin:0 0 10px;color:var(--navy);">Network Error</h2>
            <p style="color:var(--muted);margin:0 0 18px;">
              Could not reach the server. Please check your connection and try again.
            </p>
            <button class="btn" onclick="window.location.reload()">Retry</button>
          </div>
        </section>
      `;
    });
}

function handleResend(e) {
  e.preventDefault();
  const form    = e.currentTarget;
  const email   = String(form.querySelector("#resend-email")?.value || "").trim();
  const msgEl   = form.nextElementSibling;
  const btn     = form.querySelector("button[type=submit]");
  if (!email || !msgEl) return;
  if (btn) btn.disabled = true;
  fetch("/api/auth/resend-verification", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body:    JSON.stringify({ email }),
  })
    .then((r) => r.json())
    .then(() => {
      msgEl.textContent = "If your email is pending verification, a new link has been sent. Please check your inbox.";
      msgEl.style.display = "block";
    })
    .catch(() => {
      msgEl.textContent = "Could not send — please try again later.";
      msgEl.style.display = "block";
      if (btn) btn.disabled = false;
    });
}
