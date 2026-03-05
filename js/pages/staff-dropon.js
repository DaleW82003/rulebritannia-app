// js/pages/staff-dropon.js
import { requireLogin } from "../auth.js";
import { canAdminModOrSpeaker } from "../permissions.js";
import { esc } from "../ui.js";

function render(host, data) {
  const user = data?.currentUser;
  const name = esc(user?.username || user?.name || "Staff Member");

  host.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Staff Briefing</div></div>
    <section class="panel" style="max-width:720px;">
      <p style="font-size:1.05rem;margin:0 0 10px;">Welcome back, ${name}. You are logged in as a member of the Rule Britannia staff team.</p>
      <p class="muted" style="margin:0 0 22px;">
        Use the Control Panel to manage the simulation, moderate players, handle applications,
        and administer all aspects of the game.
      </p>
      <a href="control-panel.html" class="btn primary" style="font-size:1rem;padding:14px 28px;">
        Get Right Into It and Go To the Control Panel
      </a>
    </section>
  `;
}

export async function initStaffDroponPage(data) {
  const user = await requireLogin();
  if (!user) return;

  data.currentUser ??= user;

  if (!canAdminModOrSpeaker(data)) {
    window.location.href = "dashboard.html";
    return;
  }

  const host = document.getElementById("staff-dropon-root") || document.querySelector("main.wrap");
  if (!host) return;

  render(host, data);
}
