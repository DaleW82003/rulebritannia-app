import { saveData } from "../core.js";
import { esc } from "../ui.js";
import { isAdmin, isMod } from "../permissions.js";

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

function getCharacter(data) {
  return data?.currentCharacter || data?.currentPlayer || {};
}

function canModerate(data) {
  return isAdmin(data) || isMod(data);
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

  const char = getCharacter(data);
  const mod = canModerate(data);
  const list = data.fundraising.items.slice().sort((a, b) => Number(b.createdTs || 0) - Number(a.createdTs || 0));

  root.innerHTML = `
    <h1 class="page-title">Fundraising</h1>

    <section class="panel" style="margin-bottom:12px;">
      <p>Players and parties can host fundraisers. Submissions require moderator approval. Costs are deducted from income. Guest speakers and special venue requests require moderator judgement.</p>
    </section>

    <section class="panel" style="margin-bottom:12px;">
      <div style="display:grid;grid-template-columns:repeat(2,minmax(280px,1fr));gap:12px;">
        ${FUNDRAISERS.map((f) => `
          <article class="tile">
            <h3 style="margin-top:0;">${esc(f.title)}</h3>
            <div><b>Scope:</b> ${f.scope === "party" ? "For Party" : "Individual/Faction"}</div>
            <div><b>Guests:</b> ${esc(String(f.guests))}</div>
            <div><b>Expected Revenue:</b> ${esc(money(f.rangeMin))} - ${esc(money(f.rangeMax))}</div>
            <div><b>Cost:</b> ${esc(money(f.cost))}</div>
            <div class="muted">${esc(f.speechNote)}</div>
            <div style="margin-top:8px;"><button class="btn" data-action="host" data-type="${esc(f.key)}" type="button">Host</button></div>
          </article>
        `).join("")}
      </div>
    </section>

    ${state.showForm ? (() => {
      const selected = byKey(state.formType);
      return `
        <section class="panel" style="margin-bottom:12px;">
          <h2 style="margin-top:0;">Host ${esc(selected.title)}</h2>
          <form id="fr-host-form">
            <div><b>Target:</b> ${selected.scope === "party" ? `Party funds (${esc(char?.party || "No party")})` : `Faction funds (${esc(char?.name || "Character")})`}</div>
            <label class="label" for="fr-location">Location</label>
            <input id="fr-location" name="location" class="input" required placeholder="Guildhall, London">

            <label class="label" for="fr-guest">Guest Speaker (optional; mod approval required)</label>
            <input id="fr-guest" name="guestSpeaker" class="input" placeholder="Rt Hon Example MP">

            <label class="label" for="fr-special">Special details / gifts / entertainment</label>
            <input id="fr-special" name="specialDetails" class="input" placeholder="Live jazz quartet + local business sponsorship">

            <label class="label" for="fr-speech">Host Speech</label>
            <textarea id="fr-speech" name="speech" class="input" rows="8" required placeholder="Write your fundraising speech..."></textarea>

            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn" type="submit">Submit Request</button>
              <button class="btn" type="button" id="fr-cancel">Cancel</button>
            </div>
          </form>
        </section>
      `;
    })() : ""}

    <section class="panel">
      <h2 style="margin-top:0;">History of Events Hosted</h2>
      ${list.length ? list.map((item) => {
        const spec = byKey(item.type);
        const status = item.status === "approved" ? `<span style="color:#0a7f2e;font-weight:700;">Approved</span>` : item.status === "cancelled" ? `<span style="color:#9d1d1d;font-weight:700;">Cancelled</span>` : `<span class="muted">Pending Approval</span>`;
        const canSeeNet = visibleNet(data, item, char);
        return `
          <article class="tile" style="margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
              <div>
                <b>${esc(spec.title)}</b> — ${esc(item.location)}
                <div class="muted">Host: ${esc(item.hostName)} • ${esc(item.createdAt || "")}</div>
              </div>
              <div>${status}</div>
            </div>
            <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn" type="button" data-action="open" data-id="${esc(String(item.id))}">${state.openId === item.id ? "Close" : "Open"}</button>
              ${mod && item.status === "pending" ? `
                <button class="btn" type="button" data-action="approve" data-id="${esc(String(item.id))}">Approve + Allocate Revenue</button>
                <button class="btn" type="button" data-action="cancel" data-id="${esc(String(item.id))}">Refuse</button>
              ` : ""}
            </div>

            ${state.openId === item.id ? `
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
                    <div>Gross: ${esc(money(item.grossRevenue || 0))}</div>
                    <div>Cost: ${esc(money(item.cost || 0))}</div>
                    <div><b>Net Added:</b> ${esc(money(item.netRevenue || 0))}</div>
                  </div>
                ` : `<div class="muted" style="margin-top:8px;">Revenue details are private (host + moderators only).</div>`}

                ${mod && item.status === "pending" ? `
                  <form data-action="allocate" data-id="${esc(String(item.id))}" style="margin-top:8px;">
                    <label class="label" for="alloc-${esc(String(item.id))}">Allocate Gross Revenue (${esc(money(spec.rangeMin))}-${esc(money(spec.rangeMax))})</label>
                    <input id="alloc-${esc(String(item.id))}" name="grossRevenue" class="input" type="number" min="${esc(String(spec.rangeMin))}" max="${esc(String(spec.rangeMax))}" required>
                    <button class="btn" type="submit">Confirm Approval</button>
                  </form>
                ` : ""}
              </div>
            ` : ""}
          </article>
        `;
      }).join("") : `<div class="muted-block">No fundraising events yet.</div>`}
    </section>
  `;

  root.querySelectorAll("[data-action='host']").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.showForm = true;
      state.formType = btn.getAttribute("data-type") || FUNDRAISERS[0].key;
      render(data, state);
    });
  });

  root.querySelector("#fr-cancel")?.addEventListener("click", () => {
    state.showForm = false;
    render(data, state);
  });

  root.querySelector("#fr-host-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const type = state.formType || FUNDRAISERS[0].key;
    const spec = byKey(type);

    const location = String(fd.get("location") || "").trim();
    const guestSpeaker = String(fd.get("guestSpeaker") || "").trim();
    const specialDetails = String(fd.get("specialDetails") || "").trim();
    const speech = String(fd.get("speech") || "").trim();
    if (!location || !speech) return;

    data.fundraising.items.push({
      id: data.fundraising.nextId++,
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
      createdAt: new Date().toLocaleString("en-GB"),
      createdTs: Date.now()
    });

    state.showForm = false;
    saveData(data);
    render(data, state);
  });

  root.querySelectorAll("[data-action='open']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.getAttribute("data-id") || 0);
      state.openId = state.openId === id ? null : id;
      render(data, state);
    });
  });

  root.querySelectorAll("[data-action='cancel']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!mod) return;
      const id = Number(btn.getAttribute("data-id") || 0);
      const item = data.fundraising.items.find((x) => x.id === id);
      if (!item) return;
      item.status = "cancelled";
      saveData(data);
      render(data, state);
    });
  });

  root.querySelectorAll("form[data-action='allocate']").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!mod) return;
      const id = Number(form.getAttribute("data-id") || 0);
      const item = data.fundraising.items.find((x) => x.id === id);
      if (!item || item.status !== "pending") return;
      const spec = byKey(item.type);
      const fd = new FormData(form);
      const gross = Number(fd.get("grossRevenue") || 0);
      if (!Number.isFinite(gross) || gross < spec.rangeMin || gross > spec.rangeMax) return;

      item.status = "approved";
      item.grossRevenue = gross;
      item.cost = spec.cost;
      item.netRevenue = gross - spec.cost;

      if (item.scope === "party") {
        const key = item.party || "Unknown";
        data.fundraising.balances.parties[key] = Number(data.fundraising.balances.parties[key] || 0) + Number(item.netRevenue || 0);
      } else {
        const key = item.hostId || item.hostName;
        data.fundraising.balances.factions[key] = Number(data.fundraising.balances.factions[key] || 0) + Number(item.netRevenue || 0);
      }

      saveData(data);
      state.openId = id;
      render(data, state);
    });
  });

  root.querySelectorAll("[data-action='approve']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.getAttribute("data-id") || 0);
      state.openId = id;
      render(data, state);
    });
  });
}

export function initFundraisingPage(data) {
  ensureFundraising(data);
  render(data, { showForm: false, formType: FUNDRAISERS[0].key, openId: null });
}
