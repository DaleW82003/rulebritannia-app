import { saveData } from "../core.js";
import { esc } from "../ui.js";
import { isAdmin, isMod, canAdminOrMod } from "../permissions.js";
import { tileSection, tileCard } from "../components/tile.js";
import { toastSuccess } from "../components/toast.js";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function canModerate(data) {
  return canAdminOrMod(data);
}

function getCharacter(data) {
  return data?.currentCharacter || data?.currentPlayer || {};
}

function isPartyLeader(char) {
  const role = String(char?.role || "");
  return role === "leader-opposition" || role === "party-leader-3rd-4th" || role === "party-leader" || char?.office === "prime-minister";
}

function simIndex(data) {
  const gs = data?.gameState || {};
  return (Number(gs.startSimYear || 1997) * 12) + (Number(gs.startSimMonth || 8) - 1);
}

function simLabel(index) {
  const month = ((index % 12) + 12) % 12;
  const year = Math.floor(index / 12);
  return `${MONTH_NAMES[month]} ${year}`;
}

function ensureEvents(data) {
  data.events ??= { items: [], nextId: 1 };
  data.events.items ??= [];
  data.events.nextId = Number(data.events.nextId || 1);
}

function statusChip(status) {
  if (status === "approved") return `<span style="color:#0a7f2e;font-weight:700;">Approved</span>`;
  if (status === "cancelled") return `<span style="color:#9d1d1d;font-weight:700;">Cancelled</span>`;
  return `<span class="muted">Pending Approval</span>`;
}

function eventTypeLabel(type) {
  return type === "conference" ? "Party Conference" : "Party Event";
}

function canAddSpeech(char, item, data) {
  if (canModerate(data)) return true;
  if (item.status !== "approved") return false;
  if (item.type !== "conference") return false;
  return String(char?.party || "") === String(item.party || "");
}

function render(data, state) {
  const root = document.getElementById("events-root");
  if (!root) return;

  ensureEvents(data);
  const char = getCharacter(data);
  const mod = canModerate(data);
  const canHostConference = isPartyLeader(char);
  const nowIdx = simIndex(data);

  data.events.items.forEach((item) => {
    if (item.status === "approved" && item.closesAtSimIndex !== null && item.closesAtSimIndex !== undefined && nowIdx > Number(item.closesAtSimIndex)) {
      item.status = "closed";
    }
  });

  const list = data.events.items.slice().sort((a, b) => Number(b.createdTs || 0) - Number(a.createdTs || 0));

  root.innerHTML = `
    <h1 class="page-title">Events</h1>

    ${tileSection({
      body: `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;">
          <article class="tile">
            <h2 class="tile-title">Party Conference</h2>
            <p>Only Party Leaders can host conferences (location + opening remarks). Conferences run for 2 simulation months after approval, and all members of that party can post a "Speech at Conference" while open.</p>
            ${canHostConference ? `<button class="btn" data-action="show-form" data-type="conference" type="button">Host</button>` : `<div class="muted">Only Party Leaders can host conferences.</div>`}
          </article>
          <article class="tile">
            <h2 class="tile-title">Party Event</h2>
            <p>Any character may host a party event with location, purpose and speech. Requires moderator approval.</p>
            <button class="btn" data-action="show-form" data-type="event" type="button">Host</button>
          </article>
        </div>
      `
    })}

    ${state.showForm
      ? tileSection({
          title: `Host ${state.formType === "conference" ? "Party Conference" : "Party Event"}`,
          body: `
            <form id="events-host-form">
              <div class="form-row">
                <label for="events-location">Location</label>
                <input id="events-location" name="location" required placeholder="Manchester Central">
              </div>
              ${state.formType === "conference" ? "" : `
                <div class="form-row">
                  <label for="events-reason">Reasoning / Purpose</label>
                  <input id="events-reason" name="reason" required placeholder="Cost of living campaign stop">
                </div>
              `}
              <div class="form-row">
                <label for="events-speech">${state.formType === "conference" ? "Opening Remarks" : "Host Speech"}</label>
                <textarea id="events-speech" name="speech" rows="6" required placeholder="Write the remarks..."></textarea>
              </div>
              <div class="form-row">
                <label for="events-guest">Guest Speaker (optional)</label>
                <input id="events-guest" name="guestSpeaker" placeholder="Rt Hon Jane Smith MP">
              </div>
              <div class="tile-bottom">
                <button class="btn primary" type="submit">Submit for Approval</button>
                <button class="btn" type="button" id="events-cancel-form">Cancel</button>
              </div>
            </form>
          `
        })
      : ""}

    ${tileSection({
      title: "History of Events Hosted",
      body: list.length ? list.map((item) => `
        <article class="tile tile-stack">
          <div class="spaced">
            <div>
              <b>${esc(eventTypeLabel(item.type))}</b> — ${esc(item.location)}
              <div class="muted">${esc(item.party || "No party")} • Host: ${esc(item.hostName)} • ${esc(item.createdAt || "")}</div>
            </div>
            <div>${statusChip(item.status)}</div>
          </div>
          <div class="tile-bottom">
            <button class="btn" type="button" data-action="toggle-open" data-id="${esc(String(item.id))}">${state.openId === item.id ? "Close" : "Open"}</button>
            ${mod && item.status === "pending" ? `<button class="btn" type="button" data-action="approve" data-id="${esc(String(item.id))}">Approve</button><button class="btn danger" type="button" data-action="cancel" data-id="${esc(String(item.id))}">Refuse</button>` : ""}
            ${mod && item.status === "approved" ? `<button class="btn" type="button" data-action="close" data-id="${esc(String(item.id))}">Close Now</button>` : ""}
          </div>
          ${state.openId === item.id ? `
            <div style="margin-top:10px;">
              <div><b>Type:</b> ${esc(eventTypeLabel(item.type))}</div>
              <div><b>Location:</b> ${esc(item.location)}</div>
              ${item.reason ? `<div><b>Reason:</b> ${esc(item.reason)}</div>` : ""}
              ${item.guestSpeaker ? `<div><b>Guest Speaker:</b> ${esc(item.guestSpeaker)}</div>` : ""}
              <div><b>Opening Speech:</b></div>
              <div class="muted-block" style="white-space:pre-wrap;">${esc(item.openingSpeech || "")}</div>
              ${item.type === "conference" ? `
                <div style="margin-top:8px;"><b>Conference Speeches</b></div>
                ${(item.speeches || []).length ? item.speeches.map((s) => `<div class="tile tile-stack"><b>${esc(s.author)}</b><div class="muted">${esc(s.createdAt || "")}</div><div style="white-space:pre-wrap;">${esc(s.body)}</div></div>`).join("") : `<div class="muted">No speeches added yet.</div>`}
                ${canAddSpeech(char, item, data) ? `
                  <form data-action="add-speech" data-id="${esc(String(item.id))}" style="margin-top:8px;">
                    <div class="form-row">
                      <label for="speech-${esc(String(item.id))}">Speech at Conference</label>
                      <textarea id="speech-${esc(String(item.id))}" name="speech" rows="4" required placeholder="Speech at Conference..."></textarea>
                    </div>
                    <button class="btn primary" type="submit">Add Speech</button>
                  </form>
                ` : `<div class="muted">Only same-party users can post a Speech at Conference while the conference is approved/open.</div>`}
              ` : ""}
              ${item.status === "approved" && item.closesAtSimIndex ? `<div class="muted">Scheduled close: ${esc(simLabel(Number(item.closesAtSimIndex)))}</div>` : ""}
            </div>
          ` : ""}
        </article>
      `).join("") : `<div class="muted-block">No events hosted yet.</div>`
    })}
  `;

  root.querySelectorAll("[data-action='show-form']").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.showForm = true;
      state.formType = btn.getAttribute("data-type") || "event";
      render(data, state);
    });
  });

  root.querySelector("#events-cancel-form")?.addEventListener("click", () => {
    state.showForm = false;
    render(data, state);
  });

  root.querySelector("#events-host-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const type = state.formType || "event";
    if (type === "conference" && !canHostConference) return;

    const location = String(fd.get("location") || "").trim();
    const reason = String(fd.get("reason") || "").trim();
    const speech = String(fd.get("speech") || "").trim();
    const guestSpeaker = String(fd.get("guestSpeaker") || "").trim();
    if (!location || !speech || (type === "event" && !reason)) return;

    const item = {
      id: data.events.nextId++,
      type,
      party: char?.party || "Independent",
      hostName: char?.name || "Character",
      hostId: char?.name || "",
      location,
      reason,
      openingSpeech: speech,
      guestSpeaker,
      status: "pending",
      speeches: [],
      createdAt: new Date().toLocaleString("en-GB"),
      createdTs: Date.now(),
      approvedAt: null,
      closesAtSimIndex: null
    };

    data.events.items.push(item);
    state.showForm = false;
    saveData(data);
    toastSuccess(`${eventTypeLabel(type)} submitted for approval.`);
    render(data, state);
  });

  root.querySelectorAll("[data-action='toggle-open']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.getAttribute("data-id") || 0);
      state.openId = state.openId === id ? null : id;
      render(data, state);
    });
  });

  root.querySelectorAll("[data-action='approve']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!mod) return;
      const id = Number(btn.getAttribute("data-id") || 0);
      const item = data.events.items.find((x) => x.id === id);
      if (!item) return;
      item.status = "approved";
      item.approvedAt = new Date().toLocaleString("en-GB");
      item.closesAtSimIndex = simIndex(data) + 2;
      saveData(data);
      render(data, state);
    });
  });

  root.querySelectorAll("[data-action='cancel']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!mod) return;
      const id = Number(btn.getAttribute("data-id") || 0);
      const item = data.events.items.find((x) => x.id === id);
      if (!item) return;
      item.status = "cancelled";
      saveData(data);
      render(data, state);
    });
  });

  root.querySelectorAll("[data-action='close']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!mod) return;
      const id = Number(btn.getAttribute("data-id") || 0);
      const item = data.events.items.find((x) => x.id === id);
      if (!item) return;
      item.status = "closed";
      saveData(data);
      render(data, state);
    });
  });

  root.querySelectorAll("form[data-action='add-speech']").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const id = Number(form.getAttribute("data-id") || 0);
      const item = data.events.items.find((x) => x.id === id);
      if (!item || !canAddSpeech(char, item, data)) return;
      const fd = new FormData(form);
      const speech = String(fd.get("speech") || "").trim();
      if (!speech) return;
      item.speeches.push({ author: char?.name || "Character", body: speech, createdAt: new Date().toLocaleString("en-GB") });
      saveData(data);
      state.openId = id;
      render(data, state);
    });
  });
}

export function initEventsPage(data) {
  ensureEvents(data);
  render(data, { showForm: false, formType: "event", openId: null });
}
