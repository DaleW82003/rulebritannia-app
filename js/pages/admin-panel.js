import { requireAdmin } from "../auth.js";
import { esc } from "../ui.js";
import { apiLogout, apiGetState, apiSaveState } from "../api.js";

export async function initAdminPanelPage(data) {
  const user = await requireAdmin();
  if (!user) return;

  const host = document.getElementById("admin-panel-root") || document.querySelector("main.wrap");
  if (!host) return;

  function render(status) {
    host.innerHTML = `
      <h1 class="page-title">Admin Panel</h1>

      <section class="panel" style="max-width:600px;">
        <h2 style="margin-top:0;">Logged-in User</h2>
        <div class="kv"><span>Email</span><b>${esc(user.email || "—")}</b></div>
        <div class="kv"><span>Roles</span><b>${esc((user.roles || []).join(", ") || "—")}</b></div>
      </section>

      <section class="panel" style="max-width:600px;margin-top:12px;">
        <h2 style="margin-top:0;">State Controls</h2>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button id="btn-reload" class="btn" type="button">Reload from server</button>
          <button id="btn-save" class="btn" type="button">Save current state to server</button>
        </div>
        ${status ? `<div id="status-msg" style="margin-top:10px;font-size:13px;">${esc(status)}</div>` : ""}
      </section>

      <section class="panel" style="max-width:600px;margin-top:12px;">
        <h2 style="margin-top:0;">Session</h2>
        <button id="btn-logout" class="btn" type="button">Logout</button>
      </section>
    `;

    host.querySelector("#btn-reload")?.addEventListener("click", async () => {
      try {
        const result = await apiGetState();
        if (result?.data) Object.assign(data, result.data);
        render("Reloaded from server.");
      } catch (err) {
        render(`Error reloading: ${err.message}`);
      }
    });

    host.querySelector("#btn-save")?.addEventListener("click", async () => {
      try {
        await apiSaveState(data);
        render("State saved to server.");
      } catch (err) {
        render(`Error saving: ${err.message}`);
      }
    });

    host.querySelector("#btn-logout")?.addEventListener("click", async () => {
      try {
        await apiLogout();
        window.location.href = "login.html";
      } catch (err) {
        render(`Error logging out: ${err.message}`);
      }
    });
  }

  render("");
}
