import { setHTML, esc } from "../ui.js";
import { isAdmin, isMod, canAdminOrMod } from "../permissions.js";

function fmtPct(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
  return `${Number(v).toFixed(1)}%`;
}

function renderKeyLines(topline) {
  return `
    <div class="wgo-grid" style="grid-template-columns: repeat(3, minmax(0, 1fr));">
      <div class="wgo-tile">
        <div class="wgo-kicker">Key Line</div>
        <div class="wgo-title">Inflation</div>
        <div class="wgo-strap">${esc(fmtPct(topline?.inflation))}</div>
      </div>
      <div class="wgo-tile">
        <div class="wgo-kicker">Key Line</div>
        <div class="wgo-title">Unemployment</div>
        <div class="wgo-strap">${esc(fmtPct(topline?.unemployment))}</div>
      </div>
      <div class="wgo-tile">
        <div class="wgo-kicker">Key Line</div>
        <div class="wgo-title">GDP Growth</div>
        <div class="wgo-strap">${esc(fmtPct(topline?.gdpGrowth))}</div>
      </div>
    </div>
  `;
}

function renderSectionTiles(items, group) {
  if (!items.length) return `<div class="muted-block">No data configured.</div>`;
  return `
    <div class="wgo-grid" style="grid-template-columns: repeat(3, minmax(0, 1fr));">
      ${items.map((item) => {
        const firstValue = Array.isArray(item.rows) && item.rows[0] ? `${item.rows[0][0]}: ${item.rows[0][1]}` : "No lines yet";
        return `
          <div class="wgo-tile card-flex">
            <div class="wgo-kicker">${esc(group === "uk" ? "UK INFORMATION" : "SURVEY")}</div>
            <div class="wgo-title">${esc(item.title || "Untitled")}</div>
            <div class="wgo-strap">${esc(item.subtitle || firstValue)}</div>
            <div class="tile-bottom">
              <button class="btn" type="button" data-econ-open="${esc(item.id)}" data-econ-group="${esc(group)}">Open</button>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderDetail(item) {
  const rows = Array.isArray(item?.rows) ? item.rows : [];
  if (!item) return `<div class="muted-block">No section selected.</div>`;

  return `
    <div class="spaced" style="margin-bottom:10px;">
      <div>
        <div class="bill-title">${esc(item.title || "Detail")}</div>
        ${item.subtitle ? `<div class="bill-sub">${esc(item.subtitle)}</div>` : ""}
      </div>
      <button class="btn" type="button" id="economyCloseDetail">Close</button>
    </div>
    <div class="muted-block">
      ${rows.map((r) => `
        <div class="kv">
          <span>${esc(r[0] || "")}</span>
          <b>${esc(r[1] || "—")}</b>
        </div>
      `).join("")}
    </div>
  `;
}

export function initEconomyPage(data) {
  const economy = data?.economyPage || {};
  const topline = economy.topline || {};
  const ukInfoTiles = Array.isArray(economy.ukInfoTiles) ? economy.ukInfoTiles : [];
  const surveys = Array.isArray(economy.surveys) ? economy.surveys : [];

  setHTML("economyKeyLines", renderKeyLines(topline));
  setHTML("economyTiles", renderSectionTiles(ukInfoTiles, "uk"));
  setHTML("economyReportsTiles", renderSectionTiles(surveys, "survey"));

  const panel = document.getElementById("economyDetailPanel");
  const detail = document.getElementById("economyDetail");
  const showDetail = (item) => {
    if (!panel || !detail) return;
    panel.style.display = "";
    detail.innerHTML = renderDetail(item);
    detail.querySelector("#economyCloseDetail")?.addEventListener("click", () => {
      panel.style.display = "none";
    });
  };

  document.querySelectorAll("[data-econ-open]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const group = btn.getAttribute("data-econ-group");
      const id = btn.getAttribute("data-econ-open");
      const source = group === "uk" ? ukInfoTiles : surveys;
      const item = source.find((x) => String(x.id) === String(id));
      showDetail(item);
    });
  });

  const cpLinkWrap = document.getElementById("economyControlPanelLink");
  if (cpLinkWrap) {
    const canEdit = canAdminOrMod(data);
    cpLinkWrap.style.display = canEdit ? "" : "none";
  }
}
