import { setHTML, esc } from "../ui.js";
import { isAdmin, isMod, isSpeaker } from "../permissions.js";
import { saveData } from "../core.js";

const COUNTRY_ORDER = ["England", "Scotland", "Wales", "Northern Ireland"];

function canManage(data) {
  return isAdmin(data) || isMod(data) || isSpeaker(data);
}

function renderCountryTile(country) {
  return `
    <article class="body-tile" style="margin-bottom:12px;">
      <div class="body-head">
        <div class="body-name">${esc(country.country)}</div>
      </div>
      <div class="wgo-grid" style="grid-template-columns: repeat(2, minmax(0,1fr)); margin-top:10px;">
        <div class="muted-block">
          <div class="wgo-kicker">COUNCILLORS</div>
          <div class="kv"><span>Total Councillors</span><b>${Number(country.councillors || 0)}</b></div>
          <div class="kv"><span>Independent Councillors</span><b>${Number(country.independentCouncillors || 0)}</b></div>
        </div>
        <div class="muted-block">
          <div class="wgo-kicker">COUNCILS</div>
          <div class="kv"><span>Councils Controlled</span><b>${Number(country.councilsControlled || 0)}</b></div>
          <div class="kv"><span>Independent-Controlled</span><b>${Number(country.independentCouncilsControlled || 0)}</b></div>
          <div class="kv"><span>No Overall Control</span><b>${Number(country.noOverallControlCouncils || 0)}</b></div>
        </div>
      </div>
    </article>
  `;
}

function refreshLocals(data) {
  const countries = Array.isArray(data?.locals?.countries) ? data.locals.countries : [];
  const ordered = countries.slice().sort((a, b) => COUNTRY_ORDER.indexOf(a.country) - COUNTRY_ORDER.indexOf(b.country));
  setHTML("locals-root", ordered.length ? ordered.map(renderCountryTile).join("") : `<div class="muted-block">No local authority data configured.</div>`);

  const select = document.getElementById("localCountry");
  if (select) {
    select.innerHTML = ordered.map((c) => `<option value="${esc(c.country)}">${esc(c.country)}</option>`).join("");
  }
}

function bindEditor(data) {
  const btn = document.getElementById("localsEditorBtn");
  const panel = document.getElementById("localsEditorPanel");
  const form = document.getElementById("localsEditorForm");
  const select = document.getElementById("localCountry");
  if (!btn || !panel || !form || !select) return;

  const allowed = canManage(data);
  btn.style.display = allowed ? "" : "none";
  if (!allowed) return;

  const getCountry = () => (data.locals?.countries || []).find((x) => x.country === select.value);
  const loadForm = () => {
    const c = getCountry();
    if (!c) return;
    form.querySelector("#localCouncils").value = Number(c.councilsControlled || 0);
    form.querySelector("#localCouncillors").value = Number(c.councillors || 0);
    form.querySelector("#localIndependentCouncillors").value = Number(c.independentCouncillors || 0);
    form.querySelector("#localIndependentCouncils").value = Number(c.independentCouncilsControlled || 0);
    form.querySelector("#localNoc").value = Number(c.noOverallControlCouncils || 0);
  };

  btn.addEventListener("click", () => {
    panel.style.display = panel.style.display === "none" ? "" : "none";
    loadForm();
  });

  select.addEventListener("change", loadForm);

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const c = getCountry();
    if (!c) return;
    c.councilsControlled = Number(form.querySelector("#localCouncils").value || 0);
    c.councillors = Number(form.querySelector("#localCouncillors").value || 0);
    c.independentCouncillors = Number(form.querySelector("#localIndependentCouncillors").value || 0);
    c.independentCouncilsControlled = Number(form.querySelector("#localIndependentCouncils").value || 0);
    c.noOverallControlCouncils = Number(form.querySelector("#localNoc").value || 0);
    saveData(data);
    refreshLocals(data);
  });
}

export function initLocalsPage(data) {
  data.locals ??= { countries: [] };
  refreshLocals(data);
  bindEditor(data);
}
