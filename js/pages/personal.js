import { saveState } from "../core.js";
import { esc } from "../ui.js";
import { isAdmin, isMod, canAdminOrMod } from "../permissions.js";

const PROFILE_FIELDS = [
  { key: "dateOfBirth", label: "Date of birth" },
  { key: "education", label: "Education" },
  { key: "careerBackground", label: "Career background" },
  { key: "family", label: "Family" },
  { key: "constituency", label: "Constituency" },
  { key: "party", label: "Party" },
  { key: "yearFirstElected", label: "Year first elected" }
];

function money(n) {
  const val = Number(n || 0);
  return `£${val.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function nowStamp() {
  return new Date().toLocaleString("en-GB", { hour12: false });
}

function canManage(data) {
  return canAdminOrMod(data);
}

function getCharacterName(data) {
  return String(data?.currentCharacter?.name || data?.currentPlayer?.name || "").trim();
}

function getCharacterParty(data) {
  return String(data?.currentCharacter?.party || data?.currentPlayer?.party || "").trim();
}

function normalisePersonal(data) {
  data.personal ??= {};
  data.personal.profiles ??= {};

  const name = getCharacterName(data);
  if (!name) return;

  data.personal.profiles[name] ??= {
    name,
    avatar: "",
    profile: {
      dateOfBirth: "4 May 1970",
      education: "State school; University of Leeds (PPE)",
      careerBackground: "Former solicitor and local councillor",
      family: "Married, two children",
      constituency: "Kensington & Chelsea",
      party: getCharacterParty(data) || "Conservative",
      yearFirstElected: "1992"
    },
    salaryAnnual: 91000,
    bankBalance: 125000,
    financialBackgroundLevel: "Upper-middle",
    affiliations: "Conservative Parliamentary Party; Reform Caucus",
    additionalRevenue: [
      { id: 1, source: "Book royalties", annualRevenue: 12000 },
      { id: 2, source: "Rental income", annualRevenue: 18000 }
    ],
    nextRevenueId: 3,
    lastSundayCreditAt: "",
    updatedAt: nowStamp()
  };

  for (const profile of Object.values(data.personal.profiles)) {
    profile.name = String(profile.name || "").trim();
    profile.avatar = String(profile.avatar || "").trim();
    profile.profile ??= {};
    for (const f of PROFILE_FIELDS) {
      profile.profile[f.key] = String(profile.profile[f.key] || "").trim();
    }
    profile.salaryAnnual = Number(profile.salaryAnnual || 0);
    profile.bankBalance = Number(profile.bankBalance || 0);
    profile.financialBackgroundLevel = String(profile.financialBackgroundLevel || "").trim();
    profile.affiliations = String(profile.affiliations || "").trim();
    profile.additionalRevenue = Array.isArray(profile.additionalRevenue) ? profile.additionalRevenue : [];
    profile.nextRevenueId = Number(profile.nextRevenueId || 1);
    profile.lastSundayCreditAt = String(profile.lastSundayCreditAt || "");

    for (const rev of profile.additionalRevenue) {
      rev.id = Number(rev.id || 0);
      rev.source = String(rev.source || "").trim();
      rev.annualRevenue = Number(rev.annualRevenue || 0);
    }
  }
}

function weeklyCreditAmount(profile) {
  const extraAnnual = profile.additionalRevenue.reduce((sum, r) => sum + Number(r.annualRevenue || 0), 0);
  return (Number(profile.salaryAnnual || 0) + extraAnnual) / 6;
}

function render(data, state) {
  const host = document.getElementById("personal-root") || document.querySelector("main.wrap");
  if (!host) return;

  normalisePersonal(data);
  const manager = canManage(data);
  const name = getCharacterName(data);
  if (!name) {
    host.innerHTML = '<section class="panel"><div class="muted-block">No character selected.</div></section>';
    return;
  }

  const selectableNames = Object.keys(data.personal.profiles).sort();
  const activeName = manager && state.selectedName ? state.selectedName : name;
  state.selectedName = activeName;
  const profile = data.personal.profiles[activeName];
  if (!profile) {
    host.innerHTML = '<section class="panel"><div class="muted-block">No personal profile data found.</div></section>';
    return;
  }

  const weekly = weeklyCreditAmount(profile);
  const revenueTotal = profile.additionalRevenue.reduce((sum, r) => sum + Number(r.annualRevenue || 0), 0);

  host.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Personal</div></div>

    ${manager ? `
      <section class="panel" style="margin-bottom:12px;">
        <h2 style="margin-top:0;">Moderator Profile Selector</h2>
        <label class="label" for="personal-profile-select">View / Edit Character</label>
        <select id="personal-profile-select" class="input">
          ${selectableNames.map((n) => `<option value="${esc(n)}" ${n === activeName ? "selected" : ""}>${esc(n)}</option>`).join("")}
        </select>
      </section>
    ` : ""}

    <section class="panel" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
      <article class="tile">
        <h2 style="margin-top:0;">Name and Avatar</h2>
        <div style="display:flex;gap:10px;align-items:center;">
          ${profile.avatar ? `<img src="${esc(profile.avatar)}" alt="${esc(profile.name)}" style="width:88px;height:88px;object-fit:cover;border-radius:10px;border:1px solid #ddd;">` : '<div class="muted-block" style="width:88px;height:88px;padding:0;display:grid;place-items:center;">👤</div>'}
          <div>
            <div><b>${esc(profile.name)}</b></div>
            <div class="muted">${esc(profile.profile.party || "")}</div>
          </div>
        </div>
      </article>

      <article class="tile">
        <h2 style="margin-top:0;">MP Profile</h2>
        <div class="muted" style="line-height:1.7;">
          ${PROFILE_FIELDS.map((f) => `<div><b>${esc(f.label)}:</b> ${esc(profile.profile[f.key] || "-")}</div>`).join("")}
        </div>
      </article>

      <article class="tile">
        <h2 style="margin-top:0;">Salary</h2>
        <p><b>Annual Salary:</b> ${money(profile.salaryAnnual)}</p>
        <p class="muted">Weekly sim credit (annual ÷ 6): ${money(profile.salaryAnnual / 6)}</p>
      </article>

      <article class="tile">
        <h2 style="margin-top:0;">Bank Balance</h2>
        <p><b>Current Balance:</b> ${money(profile.bankBalance)}</p>
        <p class="muted">Projected next Sunday credit (salary + additional revenue): ${money(weekly)}</p>
        ${manager ? `<button type="button" class="btn" id="personal-apply-credit">Apply Sunday Credit Now</button>` : ""}
      </article>

      <article class="tile">
        <h2 style="margin-top:0;">Financial Background level</h2>
        <p>${esc(profile.financialBackgroundLevel || "-")}</p>
      </article>

      <article class="tile">
        <h2 style="margin-top:0;">Affiliations</h2>
        <p style="white-space:pre-wrap;">${esc(profile.affiliations || "-")}</p>
      </article>
    </section>

    <section class="panel" style="margin-top:12px;">
      <h2 style="margin-top:0;">Additional Revenue</h2>
      <p class="muted">Annual additional revenue total: ${money(revenueTotal)}</p>
      ${profile.additionalRevenue.length ? profile.additionalRevenue.map((rev) => `
        <article class="tile" style="margin-bottom:8px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;">
          <div>
            <b>${esc(rev.source)}</b>
            <div class="muted">Annual Revenue: ${money(rev.annualRevenue)}</div>
          </div>
          ${manager ? `<button type="button" class="btn" data-action="remove-revenue" data-id="${rev.id}">Remove</button>` : ""}
        </article>
      `).join("") : '<div class="muted-block">No additional revenue streams recorded.</div>'}
    </section>

    ${manager ? `
      <section class="panel" style="margin-top:12px;">
        <h2 style="margin-top:0;">Personal Finance Control Panel</h2>
        <form id="personal-control-form">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;">
            <div>
              <label class="label" for="p-avatar">Avatar URL</label>
              <input id="p-avatar" class="input" name="avatar" value="${esc(profile.avatar || "")}">
            </div>
            <div>
              <label class="label" for="p-salary">Annual Salary (£)</label>
              <input id="p-salary" class="input" type="number" name="salaryAnnual" value="${esc(String(profile.salaryAnnual || 0))}">
            </div>
            <div>
              <label class="label" for="p-balance">Bank Balance (£)</label>
              <input id="p-balance" class="input" type="number" name="bankBalance" value="${esc(String(profile.bankBalance || 0))}">
            </div>
            <div>
              <label class="label" for="p-finbg">Financial Background Level</label>
              <input id="p-finbg" class="input" name="financialBackgroundLevel" value="${esc(profile.financialBackgroundLevel || "")}">
            </div>
          </div>

          <label class="label" for="p-aff">Affiliations</label>
          <textarea id="p-aff" class="input" name="affiliations" rows="3">${esc(profile.affiliations || "")}</textarea>

          <h3 style="margin:10px 0 6px;">MP Profile Fields</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;">
            ${PROFILE_FIELDS.map((f) => `
              <div>
                <label class="label" for="pf-${esc(f.key)}">${esc(f.label)}</label>
                <input id="pf-${esc(f.key)}" class="input" name="profile:${esc(f.key)}" value="${esc(profile.profile[f.key] || "")}">
              </div>
            `).join("")}
          </div>

          <button class="btn" type="submit">Save Personal Profile</button>
        </form>

        <hr style="margin:12px 0;border:none;border-top:1px solid #ddd;">

        <form id="personal-add-revenue-form">
          <h3 style="margin:0 0 6px;">Add Additional Revenue</h3>
          <div style="display:grid;grid-template-columns:minmax(220px,2fr) minmax(160px,1fr) auto;gap:8px;align-items:end;">
            <div>
              <label class="label" for="rev-source">Source of Revenue</label>
              <input id="rev-source" class="input" name="source" required>
            </div>
            <div>
              <label class="label" for="rev-annual">Annual Revenue (£)</label>
              <input id="rev-annual" class="input" type="number" name="annualRevenue" required>
            </div>
            <button class="btn" type="submit">Add Revenue</button>
          </div>
        </form>
      </section>
    ` : ""}

    ${state.message ? `<p class="muted" style="margin-top:8px;">${esc(state.message)}</p>` : ""}
  `;

  host.querySelector("#personal-profile-select")?.addEventListener("change", (e) => {
    state.selectedName = String(e.currentTarget.value || "");
    state.message = "";
    render(data, state);
  });

  host.querySelector("#personal-apply-credit")?.addEventListener("click", () => {
    if (!manager) return;
    profile.bankBalance = Number(profile.bankBalance || 0) + weekly;
    profile.lastSundayCreditAt = nowStamp();
    profile.updatedAt = nowStamp();
    saveState(data);
    state.message = `Applied Sunday credit of ${money(weekly)}.`;
    render(data, state);
  });

  host.querySelector("#personal-control-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!manager) return;
    const fd = new FormData(e.currentTarget);
    profile.avatar = String(fd.get("avatar") || "").trim();
    profile.salaryAnnual = Number(fd.get("salaryAnnual") || 0);
    profile.bankBalance = Number(fd.get("bankBalance") || 0);
    profile.financialBackgroundLevel = String(fd.get("financialBackgroundLevel") || "").trim();
    profile.affiliations = String(fd.get("affiliations") || "").trim();

    for (const f of PROFILE_FIELDS) {
      profile.profile[f.key] = String(fd.get(`profile:${f.key}`) || "").trim();
    }

    profile.updatedAt = nowStamp();
    saveState(data);
    state.message = `Saved personal profile for ${profile.name}.`;
    render(data, state);
  });

  host.querySelector("#personal-add-revenue-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!manager) return;
    const fd = new FormData(e.currentTarget);
    const source = String(fd.get("source") || "").trim();
    const annualRevenue = Number(fd.get("annualRevenue") || 0);
    if (!source) return;
    profile.additionalRevenue.push({ id: Number(profile.nextRevenueId || 1), source, annualRevenue });
    profile.nextRevenueId = Number(profile.nextRevenueId || 1) + 1;
    profile.updatedAt = nowStamp();
    saveState(data);
    state.message = `Added revenue source for ${profile.name}.`;
    render(data, state);
  });

  host.querySelectorAll('[data-action="remove-revenue"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!manager) return;
      const id = Number(btn.dataset.id || 0);
      const idx = profile.additionalRevenue.findIndex((r) => r.id === id);
      if (idx === -1) return;
      profile.additionalRevenue.splice(idx, 1);
      profile.updatedAt = nowStamp();
      saveState(data);
      state.message = `Removed additional revenue source.`;
      render(data, state);
    });
  });
}

export function initPersonalPage(data) {
  normalisePersonal(data);
  saveState(data);
  render(data, { selectedName: getCharacterName(data), message: "" });
}
