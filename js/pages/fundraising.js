import { esc } from "../ui.js";
import { isAdmin, isMod, canAdminOrMod } from "../permissions.js";
import { tileSection } from "../components/tile.js";
import { toastSuccess } from "../components/toast.js";
import { apiCreateFundraisingItem, apiGetFundraisingItems, apiDeleteFundraisingItem, apiUpdateFundraisingItem, apiCreditFundraisingToParty, apiGetParty } from "../api.js";
import { getCharacterContext } from "../engines/core-engine.js";
import { formatSimMonthYear } from "../clock.js";

const FUNDRAISERS = [
  {
    key: "individual-luncheon",
    title: "Individual Luncheon",
    scope: "faction",
    guests: 50,
    speechNote: "Small speech required",
    rangeMin: 1000,
    rangeMax: 5000,
    cost: 500
  },
  {
    key: "individual-dinner",
    title: "Individual Dinner",
    scope: "faction",
    guests: 100,
    speechNote: "Full-page strong speech required",
    rangeMin: 8000,
    rangeMax: 15000,
    cost: 3000
  },
  {
    key: "party-dinner",
    title: "Party Dinner",
    scope: "party",
    guests: 200,
    speechNote: "Full-page strong speech required",
    rangeMin: 80000,
    rangeMax: 150000,
    cost: 20000
  },
  {
    key: "party-gala",
    title: "Party Gala Party",
    scope: "party",
    guests: 500,
    speechNote: "Two-page detailed speech required",
    rangeMin: 200000,
    rangeMax: 400000,
    cost: 60000
  }
];

function byKey(key) {
  return FUNDRAISERS.find((f) => f.key === key) || FUNDRAISERS[0];
}


function canModerate(data) {
  return canAdminOrMod(data);
}

function money(n) {
  return `£${Number(n || 0).toLocaleString("en-GB")}`;
}

function ensureFundraising(data) {
  data.fundraising ??= { items: [], nextId: 1, balances: { parties: {}, factions: {} } };
  data.fundraising.items ??= [];
  data.fundraising.nextId = Number(data.fundraising.nextId || 1);
  data.fundraising.balances ??= { parties: {}, factions: {} };
  data.fundraising.balances.parties ??= {};
  data.fundraising.balances.factions ??= {};
}

function ensurePartyTreasury(data, partyName) {
  if (!partyName) return null;
  data.party ??= { parties: {}, nextDraftId: 1 };
  data.party.parties ??= {};
  data.party.nextDraftId = Number(data.party.nextDraftId || 1);
  data.party.parties[partyName] ??= { name: partyName, short: "", leader: { name: "", avatar: "", characterId: "" }, treasury: { cash: 0, debt: 0, members: 0 }, hqUrl: "", drafts: [] };
  data.party.parties[partyName].treasury ??= { cash: 0, debt: 0, members: 0 };
  data.party.parties[partyName].treasury.cash = Number(data.party.parties[partyName].treasury.cash || 0);
  return data.party.parties[partyName].treasury;
}

function ensurePersonalProfile(data, characterName) {
  if (!characterName) return null;
  data.personal ??= {};
  data.personal.profiles ??= {};
  data.personal.profiles[characterName] ??= {
    name: characterName,
    title: characterName,
    salary: 0,
    benefitsInKind: 0,
    bankBalance: 0,
    personalBackground: "",
    financialBackgroundLevel: 3,
    expenses: [],
    additionalRevenue: [],
    nextExpenseId: 1,
    nextRevenueId: 1,
    notes: ""
  };
  data.personal.profiles[characterName].bankBalance = Number(data.personal.profiles[characterName].bankBalance || 0);
  return data.personal.profiles[characterName];
}

// Returns total fundraisingCapacity modifier for a party from their shop purchases.
// Each +1 means a 10% uplift on gross fundraising revenue.
function partyFundraisingCapacity(data, partyName) {
  const purchases = data.party?.parties?.[partyName]?.partyShopPurchases || [];
  return purchases.reduce((sum, p) => {
    for (const e of (p.effects || [])) {
      if (e.type === "fundraisingCapacity") sum += Number(e.value || 0);
    }
    return sum;
  }, 0);
}

function visibleNet(data, item, char) {
  if (!item || item.status !== "approved") return false;
  if (canModerate(data)) return true;
  return item.hostId === (char?.name || "");
}

function targetLabel(item) {
  return item.scope === "party" ? `Party (${item.party || "Unknown"})` : `Faction (${item.hostName})`;
}

function render(data, state) {
  const root = document.getElementById("fundraising-root");
  if (!root) return;
  ensureFundraising(data);

  const char = getCharacterContext(data);
  const mod = canModerate(data);
  const hasActiveChar = mod || Boolean(char?.name);
  const list = data.fundraising.items.slice().sort((a, b) => Number(b.createdTs || 0) - Number(a.createdTs || 0));

  root.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Fundraising</div></div>

    ${tileSection({
      body: `<p>Players and parties can host fundraisers. Submissions require moderator approval. Costs are deducted from income. Guest speakers and special venue requests require moderator judgement.</p>`
    })}

    ${!hasActiveChar ? tileSection({
      body: `<div class="muted-block">You must have an active character to host fundraisers. <a href="user.html">Create or activate a character</a> first.</div>`
    }) : tileSection({
      body: `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;">
          ${FUNDRAISERS.map((f) => `
            <article class="tile">
              <h3 class="tile-title">${esc(f.title)}</h3>
              <div><b>Scope:</b> ${f.scope === "party" ? "For Party" : "Individual/Faction"}</div>
              <div><b>Guests:</b> ${esc(String(f.guests))}</div>
              <div><b>Expected Revenue:</b> ${esc(money(f.rangeMin))} - ${esc(money(f.rangeMax))}</div>
              <div><b>Cost:</b> ${esc(money(f.cost))}</div>
              <div class="muted">${esc(f.speechNote)}</div>
              <div class="tile-bottom"><button class="btn" data-action="host" data-type="${esc(f.key)}" type="button">Host</button></div>
            </article>
          `).join("")}
        </div>
      `
    })}

    ${state.showForm ? (() => {
      const selected = byKey(state.formType);
      return tileSection({
        title: `Host ${selected.title}`,
        body: `
          <form id="fr-host-form">
            <p class="muted"><b>Target:</b> ${selected.scope === "party" ? `Party funds (${esc(char?.party || "No party")})` : `Faction funds (${esc(char?.name || "Character")})`}</p>
            <div class="form-row">
              <label for="fr-location">Location</label>
              <input id="fr-location" name="location" required placeholder="Guildhall, London">
            </div>
            <div class="form-row">
              <label for="fr-guest">Guest Speaker (optional; mod approval required)</label>
              <input id="fr-guest" name="guestSpeaker" placeholder="Rt Hon Example MP">
            </div>
            <div class="form-row">
              <label for="fr-special">Special details / gifts / entertainment</label>
              <input id="fr-special" name="specialDetails" placeholder="Live jazz quartet + local business sponsorship">
            </div>
            <div class="form-row">
              <label for="fr-speech">Host Speech</label>
              <textarea id="fr-speech" name="speech" rows="8" required placeholder="Write your fundraising speech..."></textarea>
            </div>
            <div class="tile-bottom">
              <button class="btn primary" type="submit">Submit Request</button>
              <button class="btn" type="button" id="fr-cancel">Cancel</button>
            </div>
          </form>
        `
      });
    })() : ""}

    ${tileSection({
      title: "History of Events Hosted",
      body: list.length ? list.map((item) => {
        const spec = byKey(item.type);
        const status = item.status === "approved" ? `<span style="color:#0a7f2e;font-weight:700;">Approved</span>` : item.status === "cancelled" ? `<span style="color:#9d1d1d;font-weight:700;">Cancelled</span>` : `<span class="muted">Pending Approval</span>`;
        const canSeeNet = visibleNet(data, item, char);
        return `
          <article class="tile tile-stack">
            <div class="spaced">
              <div>
                <b>${esc(spec.title)}</b> — ${esc(item.location)}
                <div class="muted">Host: ${esc(item.hostName)} • ${esc(item.createdAt || "")}</div>
              </div>
              <div>${status}</div>
            </div>
            <div class="tile-bottom">
              <button class="btn" type="button" data-action="open" data-id="${esc(String(item.id))}">${String(state.openId) === String(item.id) ? "Close" : "Open"}</button>
              ${mod && item.status === "pending" ? `
                <button class="btn" type="button" data-action="approve" data-id="${esc(String(item.id))}">Approve + Allocate Revenue</button>
                <button class="btn danger" type="button" data-action="cancel" data-id="${esc(String(item.id))}">Refuse</button>
              ` : ""}
              ${mod ? `<button class="btn danger" type="button" data-action="delete-fundraiser" data-id="${esc(String(item.id))}">Delete</button>` : ""}
            </div>
            ${String(state.openId) === String(item.id) ? `
              <div style="margin-top:8px;">
                <div><b>Type:</b> ${esc(spec.title)}</div>
                <div><b>Location:</b> ${esc(item.location)}</div>
                <div><b>Guest Speaker:</b> ${esc(item.guestSpeaker || "None")}</div>
                <div><b>Special Details:</b> ${esc(item.specialDetails || "None")}</div>
                <div><b>Target:</b> ${esc(targetLabel(item))}</div>
                <div><b>Speech:</b></div>
                <div class="muted-block" style="white-space:pre-wrap;">${esc(item.speech || "")}</div>
                ${canSeeNet ? `
                  <div style="margin-top:8px;">
                    <b>Private Financial Result</b>
                    ${item.baseGrossRevenue != null && item.baseGrossRevenue !== item.grossRevenue ? `
                      <div>Mod-entered Gross: ${esc(money(item.baseGrossRevenue))}</div>
                      <div style="color:#1a6a1a;">Fundraising Capacity Bonus (+${esc(String(item.fundraisingCapacityBonus || 0))} = +${esc(String((item.fundraisingCapacityBonus || 0) * 10))}%): +${esc(money((item.grossRevenue || 0) - (item.baseGrossRevenue || 0)))}</div>
                      <div>Adjusted Gross: ${esc(money(item.grossRevenue || 0))}</div>
                    ` : `<div>Gross: ${esc(money(item.grossRevenue || 0))}</div>`}
                    <div>Cost: ${esc(money(item.cost || 0))}</div>
                    <div><b>Net Added:</b> ${esc(money(item.netRevenue || 0))}</div>
                  </div>
                ` : `<div class="muted" style="margin-top:8px;">Revenue details are private (host + moderators only).</div>`}
                ${mod && item.status === "pending" ? (() => {
                  const fc = item.scope === "party" ? partyFundraisingCapacity(data, item.party) : 0;
                  const bonusPct = fc * 10;
                  return `
                    <form data-action="allocate" data-id="${esc(String(item.id))}" style="margin-top:8px;">
                      ${fc > 0 ? `<div class="muted" style="margin-bottom:6px;color:#1a6a1a;">✨ Party fundraising capacity: <b>+${fc}</b> — gross will be boosted by <b>${bonusPct}%</b> before deducting costs.</div>` : ""}
                      <div class="form-row">
                        <label for="alloc-${esc(String(item.id))}">Allocate Gross Revenue (${esc(money(spec.rangeMin))}-${esc(money(spec.rangeMax))})</label>
                        <input id="alloc-${esc(String(item.id))}" name="grossRevenue" type="number" min="${esc(String(spec.rangeMin))}" max="${esc(String(spec.rangeMax))}" required>
                      </div>
                      <button class="btn primary" type="submit">Confirm Approval</button>
                    </form>
                  `;
                })() : ""}
              </div>
            ` : ""}
          </article>
        `;
      }).join("") : `<div class="muted-block">No fundraising events yet.</div>`
    })}
  `;

  root.querySelectorAll("[data-action='host']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!hasActiveChar) return;
      state.showForm = true;
      state.formType = btn.getAttribute("data-type") || FUNDRAISERS[0].key;
      render(data, state);
    });
  });

  root.querySelector("#fr-cancel")?.addEventListener("click", () => {
    state.showForm = false;
    render(data, state);
  });

  root.querySelector("#fr-host-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const type = state.formType || FUNDRAISERS[0].key;
    const spec = byKey(type);

    const location = String(fd.get("location") || "").trim();
    const guestSpeaker = String(fd.get("guestSpeaker") || "").trim();
    const specialDetails = String(fd.get("specialDetails") || "").trim();
    const speech = String(fd.get("speech") || "").trim();
    if (!location || !speech) return;

    const item = {
      id: `fr-${Date.now()}`,
      type,
      scope: spec.scope,
      party: char?.party || "",
      hostName: char?.name || "Character",
      hostId: char?.name || "",
      location,
      guestSpeaker,
      specialDetails,
      speech,
      status: "pending",
      grossRevenue: null,
      cost: spec.cost,
      netRevenue: null,
      createdAt: formatSimMonthYear(data?.gameState || {}),
      createdTs: Date.now()
    };

    const submitBtn = e.currentTarget.querySelector("[type='submit']");
    if (submitBtn) submitBtn.disabled = true;
    try {
      await apiCreateFundraisingItem(item);
    } catch (err) {
      console.error(err);
      if (submitBtn) submitBtn.disabled = false;
      return;
    }

    data.fundraising.items.push(item);
    state.showForm = false;
    toastSuccess(`${spec.title} submitted for approval.`);
    render(data, state);
  });

  root.querySelectorAll("[data-action='open']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = String(btn.getAttribute("data-id") || "");
      state.openId = state.openId === id ? null : id;
      render(data, state);
    });
  });

  root.querySelectorAll("[data-action='cancel']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!mod) return;
      const id = String(btn.getAttribute("data-id") || "");
      const item = data.fundraising.items.find((x) => String(x.id) === id);
      if (!item) return;
      item.status = "cancelled";
      apiUpdateFundraisingItem(id, { status: "cancelled" }).catch(err => console.error("[fundraising] cancel failed:", err));
      render(data, state);
    });
  });

  root.querySelectorAll("form[data-action='allocate']").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!mod) return;
      const id = String(form.getAttribute("data-id") || "");
      const item = data.fundraising.items.find((x) => String(x.id) === id);
      if (!item || item.status !== "pending") return;
      const spec = byKey(item.type);
      const fd = new FormData(form);
      const gross = Number(fd.get("grossRevenue") || 0);
      if (!Number.isFinite(gross) || gross < spec.rangeMin || gross > spec.rangeMax) return;

      // Apply fundraisingCapacity bonus for party-scoped fundraisers.
      // Each +1 to fundraisingCapacity = 10% uplift on the mod-entered gross revenue.
      let adjustedGross = gross;
      let fc = 0;
      if (item.scope === "party" && item.party) {
        fc = partyFundraisingCapacity(data, item.party);
        if (fc > 0) {
          adjustedGross = Math.round(gross * (1 + fc * 0.1));
        }
      }
      const bonusPct = fc * 10;

      item.status = "approved";
      item.baseGrossRevenue = gross;
      item.grossRevenue = adjustedGross;
      item.fundraisingCapacityBonus = fc > 0 ? fc : undefined;
      item.cost = spec.cost;
      item.netRevenue = adjustedGross - spec.cost;

      if (item.scope === "party") {
        const key = item.party || "Unknown";
        const net = Number(item.netRevenue || 0);
        data.fundraising.balances.parties[key] = Number(data.fundraising.balances.parties[key] || 0) + net;
        // Only update local party treasury state if the party entry already exists in state
        // (i.e. was loaded from DB). Avoids overwriting real treasury with a 0-initialised default.
        const existingParty = data.party?.parties?.[item.party];
        if (existingParty?.treasury) {
          existingParty.treasury.cash = Number(existingParty.treasury.cash || 0) + net;
        }
        // Credit DB-backed party treasury and add to party income ledger (awaited; errors shown)
        if (net > 0 && item.party) {
          try {
            await apiCreditFundraisingToParty(id, {
              partySlug: item.party,
              amount: net,
              note: `Fundraising: ${item.type || "event"}${fc > 0 ? ` +${bonusPct}% capacity bonus` : ""}`,
            });
          } catch (err) {
            console.error("[fundraising] DB party treasury credit failed:", err.message);
          }
        }
      } else {
        const key = item.hostId || item.hostName;
        const net = Number(item.netRevenue || 0);
        data.fundraising.balances.factions[key] = Number(data.fundraising.balances.factions[key] || 0) + net;
        const profile = ensurePersonalProfile(data, key);
        if (profile) profile.bankBalance = Number(profile.bankBalance || 0) + net;
      }

      apiUpdateFundraisingItem(id, item).catch(err => console.error("[fundraising] allocate failed:", err));
      state.openId = id;
      render(data, state);
    });
  });

  root.querySelectorAll("[data-action='approve']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = String(btn.getAttribute("data-id") || "");
      state.openId = id;
      render(data, state);
    });
  });

  root.querySelectorAll("[data-action='delete-fundraiser']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!mod) return;
      const id = String(btn.getAttribute("data-id") || "");
      data.fundraising.items = data.fundraising.items.filter((x) => String(x.id) !== id);
      render(data, state);
      apiDeleteFundraisingItem(id).catch((err) => console.error("[fundraising] delete failed:", err));
    });
  });
}

export async function initFundraisingPage(data) {
  ensureFundraising(data);
  try {
    const r = await apiGetFundraisingItems();
    if (Array.isArray(r?.items)) {
      // Replace with DB state — source of truth so deleted/partial items don't persist from stale snapshot
      data.fundraising.items = r.items;
    }
  } catch (err) {
    console.error("[fundraising] DB load failed:", err);
  }

  // Load party shop purchases for parties with pending party fundraisers so the
  // mod/admin sees the correct fundraisingCapacity bonus when approving revenue.
  const pendingParties = [
    ...new Set(
      data.fundraising.items
        .filter((i) => i.scope === "party" && i.party && i.status === "pending")
        .map((i) => i.party)
    ),
  ];
  if (pendingParties.length > 0) {
    await Promise.all(
      pendingParties.map(async (partyName) => {
        try {
          const result = await apiGetParty(partyName);
          if (result?.party && Array.isArray(result.party.partyShopPurchases)) {
            ensurePartyTreasury(data, partyName);
            data.party.parties[partyName].partyShopPurchases = result.party.partyShopPurchases;
          }
        } catch (err) {
          console.warn(`[fundraising] failed to load party data for ${partyName}:`, err.message);
        }
      })
    );
  }

  render(data, { showForm: false, formType: FUNDRAISERS[0].key, openId: null });
}
