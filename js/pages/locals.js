import { setHTML, esc } from "../ui.js";
import { isAdmin, isMod, isSpeaker } from "../permissions.js";
import { saveData } from "../core.js";

const COUNTRY_ORDER = ["England", "Scotland", "Wales", "Northern Ireland"];
const PARTY_SCHEMA = {
  England: ["Conservative", "Labour", "Liberal Democrat", "Others"],
  Scotland: ["SNP", "Conservative", "Labour", "Liberal Democrat", "Others"],
  Wales: ["Plaid Cymru", "Labour", "Conservative", "Liberal Democrat", "Others"],
  "Northern Ireland": ["UUP", "DUP", "Alliance", "SDLP", "Sinn Fein", "TUV", "UKUP", "Independent", "Other"]
};

function canManage(data) {
  return isAdmin(data) || isMod(data) || isSpeaker(data);
}

function ensureLocals(data) {
  data.locals ??= { countries: [] };
  data.locals.countries ??= [];
  data.locals.countries.forEach((country) => {
    const schema = PARTY_SCHEMA[country.country] || [];
    country.partyBreakdown ??= schema.map((name) => ({ party: name, councillors: 0, councilsControlled: 0 }));
    schema.forEach((name) => {
      if (!country.partyBreakdown.find((p) => p.party === name)) {
        country.partyBreakdown.push({ party: name, councillors: 0, councilsControlled: 0 });
      }
    });
    country.partyBreakdown = country.partyBreakdown.filter((p) => schema.includes(p.party));
  });
}

function sumBy(country, key) {
  return (country.partyBreakdown || []).reduce((sum, p) => sum + Number(p[key] || 0), 0);
}

function renderPartyRows(country) {
  return (country.partyBreakdown || []).map((p) => `
    <tr>
      <td>${esc(p.party)}</td>
      <td style="text-align:right;">${Number(p.councillors || 0).toLocaleString("en-GB")}</td>
      <td style="text-align:right;">${Number(p.councilsControlled || 0).toLocaleString("en-GB")}</td>
    </tr>
  `).join("");
}

function renderCountryTile(country) {
  const totalCouncillors = sumBy(country, "councillors");
  const totalControlled = sumBy(country, "councilsControlled");
  return `
    <article class="body-tile" style="margin-bottom:12px;">
      <div class="body-head">
        <div class="body-name">${esc(country.country)}</div>
      </div>
      <div class="wgo-grid" style="grid-template-columns: repeat(3, minmax(0,1fr)); margin-top:10px;">
        <div class="muted-block"><div class="kv"><span>Total Councillors (listed parties)</span><b>${totalCouncillors.toLocaleString("en-GB")}</b></div></div>
        <div class="muted-block"><div class="kv"><span>Councils Controlled (listed parties)</span><b>${totalControlled.toLocaleString("en-GB")}</b></div></div>
        <div class="muted-block"><div class="kv"><span>No Overall Control Councils</span><b>${Number(country.noOverallControlCouncils || 0).toLocaleString("en-GB")}</b></div></div>
      </div>
      <div class="muted-block" style="margin-top:10px;overflow:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr>
              <th style="text-align:left;border-bottom:1px solid #ccc;padding:6px;">Party</th>
              <th style="text-align:right;border-bottom:1px solid #ccc;padding:6px;">Councillors</th>
              <th style="text-align:right;border-bottom:1px solid #ccc;padding:6px;">Councils Held</th>
            </tr>
          </thead>
          <tbody>
            ${renderPartyRows(country)}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function refreshLocals(data) {
  ensureLocals(data);
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
  const partyRows = document.getElementById("localsPartyRows");
  if (!btn || !panel || !form || !select || !partyRows) return;

  const allowed = canManage(data);
  btn.style.display = allowed ? "" : "none";
  if (!allowed) return;

  const getCountry = () => (data.locals?.countries || []).find((x) => x.country === select.value);
  const renderPartyInputs = (country) => {
    partyRows.innerHTML = (country.partyBreakdown || []).map((p) => `
      <div class="docket-item" style="margin-bottom:6px;">
        <div class="docket-left"><div class="docket-title">${esc(p.party)}</div></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:end;min-width:340px;">
          <label class="label">Councillors<input class="input" type="number" min="0" name="councillors-${esc(p.party)}" value="${Number(p.councillors || 0)}"></label>
          <label class="label">Councils Held<input class="input" type="number" min="0" name="councils-${esc(p.party)}" value="${Number(p.councilsControlled || 0)}"></label>
        </div>
      </div>
    `).join("");
  };

  const loadForm = () => {
    const c = getCountry();
    if (!c) return;
    form.querySelector("#localNoc").value = Number(c.noOverallControlCouncils || 0);
    renderPartyInputs(c);
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
    c.noOverallControlCouncils = Number(form.querySelector("#localNoc").value || 0);
    c.partyBreakdown = (c.partyBreakdown || []).map((p) => ({
      party: p.party,
      councillors: Number(form.querySelector(`[name='councillors-${p.party}']`)?.value || 0),
      councilsControlled: Number(form.querySelector(`[name='councils-${p.party}']`)?.value || 0)
    }));
    saveData(data);
    refreshLocals(data);
    loadForm();
  });
}

export function initLocalsPage(data) {
  ensureLocals(data);
  refreshLocals(data);
  bindEditor(data);
}
