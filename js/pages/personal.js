import { saveState } from "../core.js";
import { esc } from "../ui.js";
import { isAdmin, isMod, canAdminOrMod, canAdminModOrSpeaker } from "../permissions.js";
import { apiSubmitBioChange, apiGetMyBioChanges, apiGetAllBioChanges, apiApproveBioChange, apiRejectBioChange } from "../api.js";

const PROFILE_FIELDS = [
  { key: "dateOfBirth", label: "Date of birth" },
  { key: "education", label: "Education" },
  { key: "careerBackground", label: "Career background" },
  { key: "family", label: "Family" },
  { key: "constituency", label: "Constituency" },
  { key: "party", label: "Party" },
  { key: "yearFirstElected", label: "Year first elected" }
];

// ── Shop catalogue ────────────────────────────────────────────────────────────
// Each item has: id, name, category, price, description,
//   modifiers: { pressImpactPct, pollingBoostPct },
//   scrutinyRisk: integer (added to scrutiny score on purchase).

const SHOP_ITEMS = [
  {
    id: "media-trainer",
    name: "Media Training Session",
    category: "Communications",
    price: 5000,
    description: "A professional media coaching session. Improves press release effectiveness.",
    modifiers: { pressImpactPct: 10, pollingBoostPct: 0 },
    scrutinyRisk: 0
  },
  {
    id: "polling-consultant",
    name: "Polling Consultant",
    category: "Communications",
    price: 8000,
    description: "Commission a specialist polling consultant. Small but sustained polling lift.",
    modifiers: { pressImpactPct: 0, pollingBoostPct: 2 },
    scrutinyRisk: 1
  },
  {
    id: "luxury-car",
    name: "Luxury Car (chauffeur-driven)",
    category: "Lifestyle",
    price: 45000,
    description: "A high-end chauffeured vehicle. Status symbol — but attracts media scrutiny.",
    modifiers: { pressImpactPct: 0, pollingBoostPct: 0 },
    scrutinyRisk: 5
  },
  {
    id: "second-home",
    name: "Second Home (London)",
    category: "Property",
    price: 120000,
    description: "A London property. Expensive and scrutiny-attracting, but convenient.",
    modifiers: { pressImpactPct: 0, pollingBoostPct: 0 },
    scrutinyRisk: 8
  },
  {
    id: "constituency-event",
    name: "Constituency Summer Fair",
    category: "Outreach",
    price: 3000,
    description: "Fund a local constituency event. Modest polling boost from community goodwill.",
    modifiers: { pressImpactPct: 0, pollingBoostPct: 1 },
    scrutinyRisk: 0
  },
  {
    id: "pr-firm",
    name: "PR Firm Retainer",
    category: "Communications",
    price: 15000,
    description: "Retain a PR firm for ongoing positive press management.",
    modifiers: { pressImpactPct: 20, pollingBoostPct: 1 },
    scrutinyRisk: 2
  }
];

// Compute aggregate modifiers for a profile from its purchases.
function computeModifiers(profile) {
  const purchases = Array.isArray(profile.shopPurchases) ? profile.shopPurchases : [];
  let pressImpactPct = 0;
  let pollingBoostPct = 0;
  let scrutinyScore = 0;
  for (const p of purchases) {
    pressImpactPct += Number(p.modifiers?.pressImpactPct || 0);
    pollingBoostPct += Number(p.modifiers?.pollingBoostPct || 0);
    scrutinyScore += Number(p.scrutinyRisk || 0);
  }
  return { pressImpactPct, pollingBoostPct, scrutinyScore };
}

// Persist computed modifiers to state (used by press/polling pipeline).
function syncModifiers(data, profileName) {
  const profile = data.personal?.profiles?.[profileName];
  if (!profile) return;
  const mods = computeModifiers(profile);
  data.effects ??= {};
  data.effects.modifiers ??= {};
  data.effects.modifiers[profileName] = mods;
  profile.modifiers = mods;
}

/**
 * Returns the active press-impact modifier percentage for the given character name.
 * Used by press.js to scale release effectiveness.
 */
export function getPressImpactModifier(data, characterName) {
  const name = String(characterName || "").trim();
  return Number(data?.effects?.modifiers?.[name]?.pressImpactPct || 0);
}

function money(n) {
  const val = Number(n || 0);
  return `£${val.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function nowStamp() {
  return new Date().toLocaleString("en-GB", { hour12: false });
}

function canManage(data) {
  return canAdminModOrSpeaker(data);
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
    shopPurchases: [],
    modifiers: { pressImpactPct: 0, pollingBoostPct: 0, scrutinyScore: 0 },
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
    profile.shopPurchases = Array.isArray(profile.shopPurchases) ? profile.shopPurchases : [];

    for (const rev of profile.additionalRevenue) {
      rev.id = Number(rev.id || 0);
      rev.source = String(rev.source || "").trim();
      rev.annualRevenue = Number(rev.annualRevenue || 0);
    }

    for (const p of profile.shopPurchases) {
      p.itemId = String(p.itemId || "");
      p.name = String(p.name || "");
      p.price = Number(p.price || 0);
      p.purchasedAt = String(p.purchasedAt || "");
      p.modifiers ??= { pressImpactPct: 0, pollingBoostPct: 0 };
      p.scrutinyRisk = Number(p.scrutinyRisk || 0);
    }

    // Recompute modifiers from purchases.
    profile.modifiers = computeModifiers(profile);
  }

  // Sync bio from DB character record if available.
  const dbChar = data?.currentCharacter;
  if (dbChar && dbChar.name === name) {
    const p = data.personal.profiles[name];
    if (p && (dbChar.bio != null || dbChar.personal_background != null)) {
      p.bio = String(dbChar.bio ?? dbChar.personal_background ?? p.bio ?? "");
    }
  }

  // Keep effects.modifiers in sync.
  data.effects ??= {};
  data.effects.modifiers ??= {};
  for (const [pName, profile] of Object.entries(data.personal.profiles)) {
    data.effects.modifiers[pName] = profile.modifiers;
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
  const mods = profile.modifiers;
  // Viewing own profile (non-manager) or any profile (manager).
  const isOwnProfile = activeName === name;
  const canShop = isOwnProfile || manager;

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

      <article class="tile" style="grid-column:1/-1;">
        <h2 style="margin-top:0;">Biography</h2>
        <p style="white-space:pre-wrap;margin:0 0 10px;">${esc(profile.bio || profile.profile?.personalBackground || "-")}</p>
        ${isOwnProfile ? `
          <details style="margin-top:6px;">
            <summary style="cursor:pointer;font-weight:500;">Request Biography Change</summary>
            <form id="bio-change-form" style="margin-top:10px;">
              <textarea class="input" name="proposed_bio" rows="6" maxlength="2000" placeholder="Enter your new biography (max 2000 characters)..." style="width:100%;resize:vertical;"></textarea>
              <div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <button class="btn primary" type="submit">Submit Change Request</button>
                <span class="muted" id="bio-change-status">${esc(state.bioChangeMessage || "")}</span>
              </div>
            </form>
          </details>
        ` : ""}
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

      <article class="tile">
        <h2 style="margin-top:0;">Active Modifiers</h2>
        <div class="muted" style="line-height:1.8;">
          <div><b>Press Impact:</b> +${mods.pressImpactPct}%</div>
          <div><b>Polling Boost:</b> +${mods.pollingBoostPct}%</div>
          <div><b>Scrutiny Score:</b> ${mods.scrutinyScore} ${mods.scrutinyScore >= 10 ? "⚠️ High" : mods.scrutinyScore >= 5 ? "⚡ Medium" : "✅ Low"}</div>
        </div>
        <p class="muted" style="margin-bottom:0;font-size:.85em;">Modifiers from shop purchases are applied to press releases and polling entries.</p>
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

    <section class="panel" style="margin-top:12px;">
      <h2 style="margin-top:0;">MP Shop</h2>
      <p class="muted">Purchase items to gain soft modifiers. High-luxury and property purchases attract media scrutiny (visible to mods).</p>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-bottom:12px;">
        ${SHOP_ITEMS.map((item) => `
          <article class="tile card-flex">
            <div>
              <div><b>${esc(item.name)}</b> <span class="muted">(${esc(item.category)})</span></div>
              <div class="muted" style="margin-top:4px;font-size:.9em;">${esc(item.description)}</div>
              <div class="muted" style="margin-top:4px;">
                ${item.modifiers.pressImpactPct ? `+${item.modifiers.pressImpactPct}% press impact ` : ""}
                ${item.modifiers.pollingBoostPct ? `+${item.modifiers.pollingBoostPct}% polling boost ` : ""}
                ${item.scrutinyRisk ? `⚠️ +${item.scrutinyRisk} scrutiny` : ""}
              </div>
            </div>
            <div class="tile-bottom" style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
              <b>${money(item.price)}</b>
              ${canShop ? `<button type="button" class="btn" data-action="buy-item" data-item-id="${esc(item.id)}" ${profile.bankBalance < item.price ? "disabled title=\"Insufficient funds\"" : ""}>Buy</button>` : ""}
            </div>
          </article>
        `).join("")}
      </div>

      <h3 style="margin:0 0 6px;">Purchased Items</h3>
      ${profile.shopPurchases.length ? profile.shopPurchases.map((p, idx) => `
        <article class="tile" style="margin-bottom:8px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;">
          <div>
            <b>${esc(p.name)}</b>
            <div class="muted">Purchased ${esc(p.purchasedAt)} — ${money(p.price)}</div>
            <div class="muted" style="font-size:.9em;">
              ${p.modifiers?.pressImpactPct ? `+${p.modifiers.pressImpactPct}% press ` : ""}
              ${p.modifiers?.pollingBoostPct ? `+${p.modifiers.pollingBoostPct}% polling ` : ""}
              ${p.scrutinyRisk ? `+${p.scrutinyRisk} scrutiny` : ""}
            </div>
          </div>
          ${manager ? `<button type="button" class="btn" data-action="remove-purchase" data-idx="${idx}">Remove</button>` : ""}
        </article>
      `).join("") : '<div class="muted-block">No items purchased.</div>'}
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

      <section class="panel" id="bio-changes-panel" style="margin-top:12px;">
        <h2 style="margin-top:0;">Pending Biography Change Requests <span class="mod-badge">Mod / Admin</span></h2>
        <div id="bio-changes-list"><div class="muted-block">Loading…</div></div>
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

  // Shop: buy item
  host.querySelectorAll('[data-action="buy-item"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!canShop) return;
      const itemId = String(btn.dataset.itemId || "");
      const item = SHOP_ITEMS.find((i) => i.id === itemId);
      if (!item) return;
      if (profile.bankBalance < item.price) return;
      profile.bankBalance -= item.price;
      profile.shopPurchases.push({
        itemId: item.id,
        name: item.name,
        price: item.price,
        modifiers: { ...item.modifiers },
        scrutinyRisk: item.scrutinyRisk,
        purchasedAt: nowStamp()
      });
      profile.modifiers = computeModifiers(profile);
      syncModifiers(data, activeName);
      profile.updatedAt = nowStamp();
      saveState(data);
      state.message = `Purchased "${item.name}" for ${money(item.price)}.`;
      render(data, state);
    });
  });

  // Manager: remove purchase
  host.querySelectorAll('[data-action="remove-purchase"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!manager) return;
      const idx = Number(btn.dataset.idx || 0);
      if (idx < 0 || idx >= profile.shopPurchases.length) return;
      profile.shopPurchases.splice(idx, 1);
      profile.modifiers = computeModifiers(profile);
      syncModifiers(data, activeName);
      profile.updatedAt = nowStamp();
      saveState(data);
      state.message = `Purchase removed.`;
      render(data, state);
    });
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

  // Bio change request form (own profile only)
  host.querySelector("#bio-change-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const proposed_bio = String(fd.get("proposed_bio") || "").trim().slice(0, 2000);
    if (!proposed_bio) return;
    const statusEl = host.querySelector("#bio-change-status");
    try {
      await apiSubmitBioChange(proposed_bio);
      if (statusEl) statusEl.textContent = "Change request submitted — awaiting mod review.";
      e.currentTarget.reset();
    } catch (err) {
      if (statusEl) statusEl.textContent = `Error: ${err.message}`;
    }
  });

  // Admin/mod bio change review panel
  if (manager) {
    const bioChangesList = host.querySelector("#bio-changes-list");
    if (bioChangesList) {
      apiGetAllBioChanges("pending").then(({ changes }) => {
        if (!changes.length) {
          bioChangesList.innerHTML = '<div class="muted-block">No pending biography change requests.</div>';
          return;
        }
        bioChangesList.innerHTML = changes.map((c) => `
          <article class="tile" style="margin-bottom:8px;" data-bio-change-id="${esc(c.id)}">
            <b>${esc(c.character_name || "-")}</b> — submitted by ${esc(c.submitter_username || "-")}
            <div class="muted" style="margin:4px 0;">Submitted: ${esc(c.submitted_at ? new Date(c.submitted_at).toLocaleString("en-GB") : "-")}</div>
            <div style="background:var(--bg,#f8f8f8);border:1px solid var(--line);border-radius:6px;padding:8px;margin:6px 0;white-space:pre-wrap;font-size:.9em;">${esc(c.proposed_bio)}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn primary" type="button" data-action="approve-bio-change" data-id="${esc(c.id)}">Approve</button>
              <button class="btn" type="button" data-action="reject-bio-change" data-id="${esc(c.id)}">Reject</button>
            </div>
          </article>
        `).join("");

        bioChangesList.querySelectorAll('[data-action="approve-bio-change"]').forEach((btn) => {
          btn.addEventListener("click", async () => {
            try {
              await apiApproveBioChange(btn.dataset.id);
              btn.closest("article")?.remove();
              if (!bioChangesList.querySelector("article")) {
                bioChangesList.innerHTML = '<div class="muted-block">No pending biography change requests.</div>';
              }
            } catch (err) {
              state.message = `Error: ${err.message}`;
              render(data, state);
            }
          });
        });

        bioChangesList.querySelectorAll('[data-action="reject-bio-change"]').forEach((btn) => {
          btn.addEventListener("click", async () => {
            try {
              await apiRejectBioChange(btn.dataset.id);
              btn.closest("article")?.remove();
              if (!bioChangesList.querySelector("article")) {
                bioChangesList.innerHTML = '<div class="muted-block">No pending biography change requests.</div>';
              }
            } catch (err) {
              state.message = `Error: ${err.message}`;
              render(data, state);
            }
          });
        });
      }).catch(() => {
        if (bioChangesList) bioChangesList.innerHTML = '<div class="muted-block">Could not load bio change requests.</div>';
      });
    }
  }
}

export function initPersonalPage(data) {
  normalisePersonal(data);
  saveState(data);
  render(data, { selectedName: getCharacterName(data), message: "" });
}
