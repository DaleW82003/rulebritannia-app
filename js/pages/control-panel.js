import { saveData } from "../core.js";
import { formatSimMonthYear } from "../clock.js";
import { esc } from "../ui.js";
import { isAdmin, isMod } from "../permissions.js";

function parseRows(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf("=");
      if (idx < 0) return [line, "—"];
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
    });
}

function rowsToText(rows = []) {
  return rows.map((r) => `${r[0]}=${r[1]}`).join("\n");
}

function renderCategoryEditor(cat, locked) {
  return `
    <article class="tile" style="margin-bottom:10px;">
      <h3 style="margin-top:0;">${esc(cat.title)}</h3>
      <div class="muted">One line per stat in format <b>Label=Value</b>.</div>
      <textarea class="input" rows="12" data-cat-id="${esc(cat.id)}" ${locked ? "disabled" : ""}>${esc(rowsToText(cat.rows || []))}</textarea>
    </article>
  `;
}

export function initControlPanelPage(data) {
  const sim = document.getElementById("rbCpSimDate");
  const login = document.getElementById("rbLoginBlock");
  const simBlock = document.getElementById("rbSimBlock");
  const charBlock = document.getElementById("rbCharBlock");
  const rolePanels = document.getElementById("rbRolePanels");

  if (sim) sim.textContent = formatSimMonthYear(data?.gameState || {});

  const canEdit = isAdmin(data) || isMod(data);
  const user = data?.currentUser || {};
  const char = data?.currentCharacter || data?.currentPlayer || {};

  if (login) login.innerHTML = `<div class="kv"><span>User</span><b>${esc(user.username || "Demo")}</b></div><div class="kv"><span>Roles</span><b>${esc((user.roles || []).join(", ") || "player")}</b></div>`;
  if (simBlock) simBlock.innerHTML = `<div class="kv"><span>Simulation Started</span><b>${data?.gameState?.started ? "Yes" : "No"}</b></div><div class="kv"><span>Start Real Date</span><b>${esc(data?.gameState?.startRealDate || "Not set")}</b></div>`;
  if (charBlock) charBlock.innerHTML = `<div class="kv"><span>Character</span><b>${esc(char?.name || "None")}</b></div><div class="kv"><span>Office</span><b>${esc(char?.office || "None")}</b></div>`;

  const economy = data.economyPage || { topline: {}, ukInfoTiles: [], surveys: [] };
  const cats = [...(economy.ukInfoTiles || []), ...(economy.surveys || [])];

  if (!rolePanels) return;
  rolePanels.innerHTML = `
    <h2>Economy Controls</h2>
    ${canEdit ? `<div class="muted-block">Edit economic datasets below, then save.</div>` : `<div class="muted-block">Read-only. Admin/mod only for editing.</div>`}
    <section class="panel" style="margin-top:10px;">
      <h3 style="margin-top:0;">Topline</h3>
      <form id="topline-form" class="form-grid">
        <label>Inflation</label><input class="input" name="inflation" value="${esc(String(economy.topline?.inflation ?? ""))}" ${canEdit ? "" : "disabled"}>
        <label>Unemployment</label><input class="input" name="unemployment" value="${esc(String(economy.topline?.unemployment ?? ""))}" ${canEdit ? "" : "disabled"}>
        <label>GDP Growth</label><input class="input" name="gdpGrowth" value="${esc(String(economy.topline?.gdpGrowth ?? ""))}" ${canEdit ? "" : "disabled"}>
      </form>
    </section>
    <section class="panel" style="margin-top:10px;">
      ${cats.map((c) => renderCategoryEditor(c, !canEdit)).join("")}
      ${canEdit ? `<button id="save-econ" class="btn" type="button">Save Economy Data</button>` : ""}
    </section>
  `;

  rolePanels.querySelector("#save-econ")?.addEventListener("click", () => {
    if (!canEdit) return;
    economy.topline = economy.topline || {};
    const fd = new FormData(rolePanels.querySelector("#topline-form"));
    economy.topline.inflation = Number(fd.get("inflation") || 0);
    economy.topline.unemployment = Number(fd.get("unemployment") || 0);
    economy.topline.gdpGrowth = Number(fd.get("gdpGrowth") || 0);

    const map = new Map(cats.map((c) => [String(c.id), c]));
    rolePanels.querySelectorAll("textarea[data-cat-id]").forEach((ta) => {
      const id = ta.getAttribute("data-cat-id");
      const cat = map.get(String(id));
      if (!cat) return;
      cat.rows = parseRows(ta.value);
    });

    data.economyPage = economy;
    saveData(data);
  });
}
