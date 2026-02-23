import { setHTML, esc } from "../ui.js";
import { isAdmin, isMod, isSpeaker, canAdminModOrSpeaker } from "../permissions.js";
import { saveState } from "../core.js";

const COUNTRY_ORDER = ["England", "Scotland", "Wales", "Northern Ireland"];
const PARTY_SCHEMA = {
  England: ["Conservative", "Labour", "Liberal Democrat", "Others"],
  Scotland: ["SNP", "Conservative", "Labour", "Liberal Democrat", "Others"],
  Wales: ["Plaid Cymru", "Labour", "Conservative", "Liberal Democrat", "Others"],
  "Northern Ireland": ["UUP", "DUP", "Alliance", "SDLP", "Sinn Fein", "TUV", "UKUP", "Independent", "Other"]
};

function canManage(data) {
  return canAdminModOrSpeaker(data);
}

function ensureLocals(data) {
  data.locals ??= { countries: [] };
  data.locals.countries ??= [];

  // Initialize all 4 nations if not already present
  COUNTRY_ORDER.forEach((countryName) => {
    if (!data.locals.countries.find((c) => c.country === countryName)) {
      data.locals.countries.push({
        country: countryName,
        noOverallControlCouncils: 0,
        partyBreakdown: (PARTY_SCHEMA[countryName] || []).map((name) => ({ party: name, councillors: 0, councilsControlled: 0 }))
      });
    }
  });

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

function renderCouncillorRows(country) {
  return (country.partyBreakdown || []).map((p) => `
    <tr>
      <td style="padding:5px 6px;">${esc(p.party)}</td>
      <td style="text-align:right;padding:5px 6px;">${Number(p.councillors || 0).toLocaleString("en-GB")}</td>
    </tr>
  `).join("");
}

function renderCouncilRows(country) {
  return (country.partyBreakdown || []).map((p) => `
    <tr>
      <td style="padding:5px 6px;">${esc(p.party)}</td>
      <td style="text-align:right;padding:5px 6px;">${Number(p.councilsControlled || 0).toLocaleString("en-GB")}</td>
    </tr>
  `).join("") + `
    <tr>
      <td style="padding:5px 6px;font-style:italic;">No Overall Control</td>
      <td style="text-align:right;padding:5px 6px;">${Number(country.noOverallControlCouncils || 0).toLocaleString("en-GB")}</td>
    </tr>
  `;
}

function renderCountryTile(country) {
  const totalCouncillors = sumBy(country, "councillors");
  const totalControlled = sumBy(country, "councilsControlled");
  return `
    <article class="tile" style="margin-bottom:14px;width:100%;">
      <h3 style="margin-top:0;margin-bottom:10px;">${esc(country.country)}</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <div class="wgo-kicker" style="margin-bottom:6px;">Councillors</div>
          <div class="muted" style="margin-bottom:6px;">Total: <b>${totalCouncillors.toLocaleString("en-GB")}</b></div>
          <table style="width:100%;border-collapse:collapse;font-size:0.92em;">
            <thead>
              <tr>
                <th style="text-align:left;border-bottom:1px solid var(--line);padding:5px 6px;">Party</th>
                <th style="text-align:right;border-bottom:1px solid var(--line);padding:5px 6px;">Councillors</th>
              </tr>
            </thead>
            <tbody>${renderCouncillorRows(country)}</tbody>
          </table>
        </div>
        <div>
          <div class="wgo-kicker" style="margin-bottom:6px;">Councils</div>
          <div class="muted" style="margin-bottom:6px;">Controlled: <b>${totalControlled.toLocaleString("en-GB")}</b></div>
          <table style="width:100%;border-collapse:collapse;font-size:0.92em;">
            <thead>
              <tr>
                <th style="text-align:left;border-bottom:1px solid var(--line);padding:5px 6px;">Party</th>
                <th style="text-align:right;border-bottom:1px solid var(--line);padding:5px 6px;">Councils</th>
              </tr>
            </thead>
            <tbody>${renderCouncilRows(country)}</tbody>
          </table>
        </div>
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
    saveState(data);
    refreshLocals(data);
    loadForm();
  });
}

export function initLocalsPage(data) {
  ensureLocals(data);
  refreshLocals(data);
  bindEditor(data);
}
