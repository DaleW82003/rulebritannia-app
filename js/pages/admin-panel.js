import { requireAdmin } from "../auth.js";
import { esc } from "../ui.js";
import { apiLogout, apiGetState, apiSaveState, apiGetConfig, apiSaveConfig } from "../api.js";

export async function initAdminPanelPage(data) {
  const user = await requireAdmin();
  if (!user) return;

  const host = document.getElementById("admin-panel-root") || document.querySelector("main.wrap");
  if (!host) return;

  let currentConfig = {};

  async function loadConfig() {
    try {
      const result = await apiGetConfig();
      currentConfig = result?.config || {};
    } catch (err) {
      console.error("Failed to load config:", err);
      currentConfig = {};
    }
  }

  function renderConfigFields() {
    const fields = [
      { key: "discourse_base_url", label: "Discourse Base URL", placeholder: "https://forum.rulebritannia.org" },
      { key: "ui_base_url",        label: "UI Base URL",        placeholder: "https://rulebritannia.org" },
      { key: "sim_start_date",     label: "Sim Start Date",     placeholder: "1997-08-01" },
      { key: "clock_rate",         label: "Clock Rate (sim months/week)", placeholder: "2" },
    ];
    return fields
      .map(
        ({ key, label, placeholder }) => `
      <div class="kv" style="align-items:center;gap:8px;">
        <label for="cfg-${esc(key)}" style="min-width:200px;">${esc(label)}</label>
        <input id="cfg-${esc(key)}" name="${esc(key)}" type="text"
               value="${esc(currentConfig[key] ?? "")}"
               placeholder="${esc(placeholder)}"
               style="flex:1;padding:4px 8px;border:1px solid #ccc;border-radius:4px;" />
      </div>`
      )
      .join("\n");
  }

  function render(status) {
    host.innerHTML = `
      <h1 class="page-title">Admin Panel</h1>

      <section class="panel" style="max-width:600px;">
        <h2 style="margin-top:0;">Logged-in User</h2>
        <div class="kv"><span>Email</span><b>${esc(user.email || "—")}</b></div>
        <div class="kv"><span>Roles</span><b>${esc((user.roles || []).join(", ") || "—")}</b></div>
      </section>

      <section class="panel" style="max-width:600px;margin-top:12px;">
        <h2 style="margin-top:0;">App Config</h2>
        <form id="config-form" style="display:flex;flex-direction:column;gap:10px;">
          ${renderConfigFields()}
          <div>
            <button class="btn" type="submit">Save Config</button>
          </div>
        </form>
        ${status && status.startsWith("cfg:") ? `<div id="status-msg" style="margin-top:10px;font-size:13px;">${esc(status.slice(4))}</div>` : ""}
      </section>

      <section class="panel" style="max-width:600px;margin-top:12px;">
        <h2 style="margin-top:0;">State Controls</h2>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button id="btn-reload" class="btn" type="button">Reload from server</button>
          <button id="btn-save" class="btn" type="button">Save current state to server</button>
        </div>
        ${status && !status.startsWith("cfg:") ? `<div id="status-msg" style="margin-top:10px;font-size:13px;">${esc(status)}</div>` : ""}
      </section>

      <section class="panel" style="max-width:600px;margin-top:12px;">
        <h2 style="margin-top:0;">Session</h2>
        <button id="btn-logout" class="btn" type="button">Logout</button>
      </section>
    `;

    host.querySelector("#config-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target;
      const updates = {};
      for (const input of form.querySelectorAll("input[name]")) {
        updates[input.name] = input.value;
      }
      try {
        await apiSaveConfig(updates);
        currentConfig = { ...currentConfig, ...updates };
        render("cfg:Config saved.");
      } catch (err) {
        render(`cfg:Error saving config: ${err.message}`);
      }
    });

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

  await loadConfig();
  render("");
}
