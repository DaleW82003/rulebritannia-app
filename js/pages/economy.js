import { apiSaveEconomyData } from "../api.js";
import { setHTML, esc } from "../ui.js";
import { isAdmin, isMod, canAdminOrMod } from "../permissions.js";
import { logAction } from "../audit.js";
import { toastSuccess, toastError } from "../components/toast.js";

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

  // Inline Economy Controls — visible to mod/admin only
  const canEdit = canAdminOrMod(data);
  const controlsPanel = document.getElementById("economyControlsPanel");
  const controlsBody  = document.getElementById("economyControlsBody");
  if (controlsPanel && controlsBody && canEdit) {
    controlsPanel.style.display = "";

    function parseRows(text) {
      return String(text || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
        const idx = l.indexOf("=");
        return idx < 0 ? [l, "—"] : [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
      });
    }

    const cats = [...(Array.isArray(economy.ukInfoTiles) ? economy.ukInfoTiles : []),
                  ...(Array.isArray(economy.surveys) ? economy.surveys : [])];

    controlsBody.innerHTML = `
      <section class="panel" style="margin-bottom:8px;">
        <h3 style="margin-top:0;">Topline</h3>
        <form id="econ-ctrl-topline" class="form-grid">
          <label>Inflation</label><input class="input" name="inflation" value="${esc(String(economy.topline?.inflation ?? ""))}">
          <label>Unemployment</label><input class="input" name="unemployment" value="${esc(String(economy.topline?.unemployment ?? ""))}">
          <label>GDP Growth</label><input class="input" name="gdpGrowth" value="${esc(String(economy.topline?.gdpGrowth ?? ""))}">
        </form>
      </section>
      <section class="panel" style="margin-bottom:8px;">
        ${cats.map((c) => `
          <article class="tile" style="margin-bottom:10px;">
            <h3 style="margin-top:0;">${esc(c.title)}</h3>
            <div class="muted">One line per stat in format <b>Label=Value</b>.</div>
            <textarea class="input" rows="12" data-econ-cat-id="${esc(c.id)}">${esc((c.rows || []).map((r) => `${r[0]}=${r[1]}`).join("\n"))}</textarea>
          </article>`).join("")}
        <button id="econ-ctrl-save" class="btn" type="button">Save Economy Data</button>
      </section>
    `;

    controlsBody.querySelector("#econ-ctrl-save")?.addEventListener("click", async () => {
      const saveBtn = controlsBody.querySelector("#econ-ctrl-save");
      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }
      const e = data.economyPage || {};
      e.topline = e.topline || {};
      const fd = new FormData(controlsBody.querySelector("#econ-ctrl-topline"));
      e.topline.inflation    = Number(fd.get("inflation")    || 0);
      e.topline.unemployment = Number(fd.get("unemployment") || 0);
      e.topline.gdpGrowth    = Number(fd.get("gdpGrowth")    || 0);

      const map = new Map(cats.map((c) => [String(c.id), c]));
      controlsBody.querySelectorAll("textarea[data-econ-cat-id]").forEach((ta) => {
        const cat = map.get(ta.getAttribute("data-econ-cat-id"));
        if (cat) cat.rows = parseRows(ta.value);
      });

      data.economyPage = e;
      try {
        await apiSaveEconomyData(e);
        logAction({ action: "economy-saved", target: "economy", details: { topline: e.topline } });
        setHTML("economyKeyLines", renderKeyLines(e.topline));
        toastSuccess("Economy data saved.");
        if (saveBtn) { saveBtn.textContent = "Saved ✓"; setTimeout(() => { saveBtn.textContent = "Save Economy Data"; saveBtn.disabled = false; }, 2000); }
      } catch (err) {
        console.error("[economy] save failed:", err);
        toastError(`Save failed: ${err.message}`);
        if (saveBtn) { saveBtn.textContent = "Save Economy Data"; saveBtn.disabled = false; }
      }
    });
  }
}
