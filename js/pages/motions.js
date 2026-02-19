import { saveData } from "../core.js";
import { esc } from "../ui.js";
import { isSpeaker } from "../permissions.js";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const GOVERNMENT_OFFICES = new Set([
  "prime-minister",
  "leader-commons",
  "chancellor",
  "home",
  "foreign",
  "trade",
  "defence",
  "welfare",
  "education",
  "env-agri",
  "health",
  "eti",
  "culture",
  "home-nations"
]);

function getCharacter(data) {
  return data?.currentCharacter || data?.currentPlayer || {};
}

function getPartyWeights(data) {
  const parties = Array.isArray(data?.parliament?.parties) ? data.parliament.parties : [];
  return Object.fromEntries(parties.map((p) => [p.name, Number(p.seats || 1)]));
}

function getWeightForCharacter(data) {
  const char = getCharacter(data);
  const weights = getPartyWeights(data);
  return Number(weights[char?.party] || 1);
}

function isGovernmentMember(data) {
  return GOVERNMENT_OFFICES.has(getCharacter(data)?.office);
}

function ensureMotions(data) {
  data.motions ??= {};
  data.motions.house ??= [];
  data.motions.edm ??= [];
  data.motions.nextHouseNumber ??= data.motions.house.length + 1;
  data.motions.nextEdmNumber ??= data.motions.edm.length + 1;
}

function simInfo(data) {
  const gs = data?.gameState || {};
  const month = Number(gs.startSimMonth ?? 8);
  const year = Number(gs.startSimYear ?? 1997);
  return { month, year, label: `${MONTHS[(month - 1 + 12) % 12]} ${year}` };
}

function plusMonths(month, year, add) {
  const n = (year * 12) + (month - 1) + add;
  return { month: (n % 12) + 1, year: Math.floor(n / 12), label: `${MONTHS[(n % 12 + 12) % 12]} ${Math.floor(n / 12)}` };
}

function discussionUrl(kind, number, title) {
  return `https://forum.rulebritannia.org/t/${kind}-${number}-${encodeURIComponent((title || "item").toLowerCase().replaceAll(" ", "-"))}`;
}

function houseDivisionTotals(motion) {
  const votes = motion?.division?.votes || {};
  const totals = { aye: 0, no: 0, abstain: 0 };
  Object.values(votes).forEach((v) => {
    const c = (v.choice || "abstain").toLowerCase();
    totals[c] = Number(totals[c] || 0) + Number(v.weight || 1);
  });
  return totals;
}

function houseResult(motion) {
  const t = houseDivisionTotals(motion);
  if (motion?.status === "archived" || motion?.division?.status === "closed") {
    if (t.aye > t.no) return "Passed";
    if (t.no >= t.aye) return "Failed";
  }
  return "In Division";
}

function render(data, state) {
  const root = document.getElementById("motions-root");
  if (!root) return;

  ensureMotions(data);
  const sim = simInfo(data);
  const char = getCharacter(data);
  const canSpeaker = isSpeaker(data);
  const canSignEdm = !isGovernmentMember(data);

  const house = data.motions.house.slice().sort((a, b) => Number(b.number) - Number(a.number));
  const edm = data.motions.edm.slice().sort((a, b) => Number(b.number) - Number(a.number));

  const selectedHouseId = state.selectedHouseId || house[0]?.id || null;
  const selectedEdmId = state.selectedEdmId || edm[0]?.id || null;
  const selectedHouse = house.find((m) => m.id === selectedHouseId) || null;
  const selectedEdm = edm.find((m) => m.id === selectedEdmId) || null;

  root.innerHTML = `
    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Guide to Motions & EDMs</h2>
      <p><b>House Motions</b> include a 2-simulation-month debate window and then a 1-simulation-month division (weighted by party seat strength). Status is shown as Passed/Failed once closed.</p>
      <p><b>Early Day Motions (EDMs)</b> can be signed by MPs not in Government. EDMs show weighted signatory totals and signatory names.</p>
    </section>

    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Submit Motion / EDM</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;">
        <form id="house-motion-form" class="tile">
          <h3 style="margin-top:0;">Raise House Motion</h3>
          <label class="label" for="house-motion-title">Title</label>
          <input id="house-motion-title" class="input" name="title" required>
          <label class="label" for="house-motion-body">Body</label>
          <textarea id="house-motion-body" class="input" rows="5" name="body" required placeholder="That this House..."></textarea>
          <button class="btn" type="submit">Submit House Motion</button>
        </form>

        <form id="edm-form" class="tile">
          <h3 style="margin-top:0;">Raise Early Day Motion</h3>
          <label class="label" for="edm-title">Title</label>
          <input id="edm-title" class="input" name="title" required>
          <label class="label" for="edm-body">Body</label>
          <textarea id="edm-body" class="input" rows="5" name="body" required placeholder="That this House..."></textarea>
          <button class="btn" type="submit">Submit EDM</button>
        </form>
      </div>
      <p class="muted" style="margin-top:8px;">Submitting as ${esc(char?.name || "MP")}.</p>
    </section>

    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">House Motions</h2>
      ${house.length ? house.map((m) => `
        <article class="tile" style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            <div><b>Motion ${esc(m.number)}</b>: ${esc(m.title)} <span class="muted">by ${esc(m.author)}</span></div>
            <div><b>${esc(houseResult(m))}</b></div>
          </div>
          <div class="muted" style="margin-top:6px;">Debate: ${esc(m.debateStartSim || "—")} → ${esc(m.debateEndSim || "—")} • Division: ${esc(m.division?.startSim || "—")} → ${esc(m.division?.endSim || "—")}</div>
          <div class="tile-bottom"><button class="btn" type="button" data-action="open-house" data-id="${esc(m.id)}">Open</button></div>
        </article>
      `).join("") : `<p class="muted">No House Motions yet.</p>`}
    </section>

    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Early Day Motions</h2>
      ${edm.length ? edm.map((m) => {
        const signatures = Array.isArray(m.signatures) ? m.signatures : [];
        const weighted = signatures.reduce((acc, s) => acc + Number(s.weight || 1), 0);
        return `
          <article class="tile" style="margin-bottom:10px;">
            <div><b>EDM ${esc(m.number)}</b>: ${esc(m.title)} <span class="muted">by ${esc(m.author)}</span></div>
            <div class="muted" style="margin-top:6px;">Weighted signatures: ${weighted}</div>
            <div class="tile-bottom"><button class="btn" type="button" data-action="open-edm" data-id="${esc(m.id)}">Open</button></div>
          </article>
        `;
      }).join("") : `<p class="muted">No EDMs yet.</p>`}
    </section>

    <section class="tile">
      <h2 style="margin-top:0;">Motion / EDM Detail</h2>
      ${selectedHouse ? (() => {
        const totals = houseDivisionTotals(selectedHouse);
        const myVote = selectedHouse.division?.votes?.[char?.name || ""]?.choice || "";
        return `
          <h3>Motion ${esc(selectedHouse.number)}: ${esc(selectedHouse.title)}</h3>
          <p class="muted">Author: ${esc(selectedHouse.author)} • Status: <b>${esc(houseResult(selectedHouse))}</b></p>
          <p style="white-space:pre-wrap;">${esc(selectedHouse.body)}</p>
          <p><a class="btn" target="_blank" rel="noopener" href="${esc(selectedHouse.debateUrl || discussionUrl("motion", selectedHouse.number, selectedHouse.title))}">Debate on Discourse</a></p>
          <div class="tile" style="margin-top:8px;">
            <h4 style="margin-top:0;">Division (weighted)</h4>
            <p>Aye: <b>${totals.aye}</b> • No: <b>${totals.no}</b> • Abstain: <b>${totals.abstain}</b></p>
            <p class="muted">Your vote: ${esc(myVote || "Not voted")}</p>
            ${selectedHouse.status !== "archived" ? `
              <div class="tile-bottom" style="gap:8px;display:flex;flex-wrap:wrap;">
                <button class="btn" type="button" data-action="vote-motion" data-choice="aye" data-id="${esc(selectedHouse.id)}">Vote Aye</button>
                <button class="btn" type="button" data-action="vote-motion" data-choice="no" data-id="${esc(selectedHouse.id)}">Vote No</button>
                <button class="btn" type="button" data-action="vote-motion" data-choice="abstain" data-id="${esc(selectedHouse.id)}">Abstain</button>
                ${canSpeaker ? `<button class="btn" type="button" data-action="close-motion" data-id="${esc(selectedHouse.id)}">Close Early (Speaker)</button>` : ""}
              </div>
            ` : `<p class="muted">Division closed.</p>`}
          </div>
        `;
      })() : selectedEdm ? (() => {
        const signatures = Array.isArray(selectedEdm.signatures) ? selectedEdm.signatures : [];
        const weighted = signatures.reduce((acc, s) => acc + Number(s.weight || 1), 0);
        const already = signatures.some((s) => s.name === char?.name);
        return `
          <h3>EDM ${esc(selectedEdm.number)}: ${esc(selectedEdm.title)}</h3>
          <p class="muted">Lead MP: ${esc(selectedEdm.author)}</p>
          <p style="white-space:pre-wrap;">${esc(selectedEdm.body)}</p>
          <p><b>Weighted signatures:</b> ${weighted}</p>
          <p><b>Signatories:</b> ${signatures.length ? signatures.map((s) => `${esc(s.name)} (${esc(s.weight)})`).join(", ") : "None yet"}</p>
          ${canSignEdm ? (already
            ? `<p class="muted"><b>You have already signed this EDM.</b></p>`
            : `<button class="btn" type="button" data-action="sign-edm" data-id="${esc(selectedEdm.id)}">Sign EDM</button>`)
            : `<p class="muted"><b>You cannot sign EDMs as a Government member.</b></p>`}
        `;
      })() : `<p class="muted">Open a Motion or EDM to view details.</p>`}
    </section>
  `;

  root.querySelectorAll("[data-action='open-house']").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedHouseId = btn.getAttribute("data-id");
      state.selectedEdmId = null;
      render(data, state);
    });
  });

  root.querySelectorAll("[data-action='open-edm']").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedEdmId = btn.getAttribute("data-id");
      state.selectedHouseId = null;
      render(data, state);
    });
  });

  root.querySelector("#house-motion-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const title = String(fd.get("title") || "").trim();
    let body = String(fd.get("body") || "").trim();
    if (!title || !body) return;
    if (!body.toLowerCase().startsWith("that this house")) body = `That this House ${body.charAt(0).toLowerCase()}${body.slice(1)}`;

    const number = Number(data.motions.nextHouseNumber || (data.motions.house.length + 1));
    const debateEnd = plusMonths(sim.month, sim.year, 2);
    const divisionEnd = plusMonths(debateEnd.month, debateEnd.year, 1);
    const id = `motion-${Date.now()}`;

    data.motions.house.push({
      id,
      number,
      title,
      author: char?.name || "MP",
      body,
      status: "open",
      debateStartSim: sim.label,
      debateEndSim: debateEnd.label,
      debateUrl: discussionUrl("motion", number, title),
      division: { status: "open", startSim: debateEnd.label, endSim: divisionEnd.label, votes: {} }
    });
    data.motions.nextHouseNumber = number + 1;
    state.selectedHouseId = id;
    state.selectedEdmId = null;
    saveData(data);
    render(data, state);
  });

  root.querySelector("#edm-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const title = String(fd.get("title") || "").trim();
    let body = String(fd.get("body") || "").trim();
    if (!title || !body) return;
    if (!body.toLowerCase().startsWith("that this house")) body = `That this House ${body.charAt(0).toLowerCase()}${body.slice(1)}`;

    const number = Number(data.motions.nextEdmNumber || (data.motions.edm.length + 1));
    const id = `edm-${Date.now()}`;

    data.motions.edm.push({
      id,
      number,
      title,
      author: char?.name || "MP",
      body,
      signatures: []
    });
    data.motions.nextEdmNumber = number + 1;
    state.selectedEdmId = id;
    state.selectedHouseId = null;
    saveData(data);
    render(data, state);
  });

  root.querySelectorAll("[data-action='vote-motion']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const choice = btn.getAttribute("data-choice");
      const motion = data.motions.house.find((m) => m.id === id);
      if (!motion || motion.status === "archived") return;
      motion.division ??= { status: "open", votes: {} };
      motion.division.votes ??= {};
      const name = char?.name || "MP";
      motion.division.votes[name] = {
        name,
        party: char?.party || "Independent",
        weight: getWeightForCharacter(data),
        choice
      };
      saveData(data);
      render(data, state);
    });
  });

  root.querySelectorAll("[data-action='close-motion']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!canSpeaker) return;
      const id = btn.getAttribute("data-id");
      const motion = data.motions.house.find((m) => m.id === id);
      if (!motion) return;
      motion.status = "archived";
      motion.division ??= { votes: {} };
      motion.division.status = "closed";
      motion.closedAtSim = sim.label;
      saveData(data);
      render(data, state);
    });
  });

  root.querySelectorAll("[data-action='sign-edm']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!canSignEdm) return;
      const id = btn.getAttribute("data-id");
      const motion = data.motions.edm.find((m) => m.id === id);
      if (!motion) return;
      motion.signatures ??= [];
      const name = char?.name || "MP";
      if (motion.signatures.some((s) => s.name === name)) return;
      motion.signatures.push({
        name,
        party: char?.party || "Independent",
        weight: getWeightForCharacter(data)
      });
      saveData(data);
      render(data, state);
    });
  });
}

export function initMotionsPage(data) {
  ensureMotions(data);
  const state = {
    selectedHouseId: data.motions.house[0]?.id || null,
    selectedEdmId: null
  };
  render(data, state);
}
