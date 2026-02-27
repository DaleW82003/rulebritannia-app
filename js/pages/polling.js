import { esc } from "../ui.js";
import { canAdminOrMod } from "../permissions.js";
import { formatSimMonthYear } from "../clock.js";
import { logAction } from "../audit.js";
import { apiCreatePollingEntry, apiDeletePollingEntry } from "../api.js";

function canPublish(data) {
  return canAdminOrMod(data);
}

function ensurePolling(data) {
  data.polling ??= { polls: [], nextId: 1 };
  data.polling.polls ??= [];
  data.polling.nextId = Number(data.polling.nextId || 1);
}

function currentSimLabel(data) {
  return formatSimMonthYear(data?.gameState || {});
}

function normalizeShares(entries) {
  const valid = entries.filter((e) => Number(e.value) >= 2);
  const total = valid.reduce((sum, e) => sum + Number(e.value || 0), 0);
  if (!total) return valid.map((e) => ({ party: e.party, value: 0 }));
  return valid.map((e) => ({ party: e.party, value: (Number(e.value || 0) / total) * 100 }));
}

function seatProjection(data, poll) {
  const seatsTotal = Number(data?.parliament?.totalSeats || 650);
  const shares = normalizeShares(poll.results || []);

  // Project seats for each party that has a poll share.
  const projected = [];
  let allocated = 0;
  for (const s of shares) {
    const seats = Math.floor((s.value / 100) * seatsTotal);
    allocated += seats;
    projected.push({ party: s.party, seats, remainder: (s.value / 100) * seatsTotal - seats });
  }

  // Distribute remaining seats to highest-remainder parties.
  let gap = seatsTotal - allocated;
  if (gap > 0) {
    projected
      .sort((a, b) => b.remainder - a.remainder)
      .forEach((p) => {
        if (gap <= 0) return;
        p.seats += 1;
        gap -= 1;
      });
  }

  return projected
    .map((p) => ({ party: p.party, seats: p.seats }))
    .sort((a, b) => b.seats - a.seats)
    .filter((p) => p.seats > 0);
}

function trendAgainst(previous, latest) {
  const prev = Object.fromEntries((previous?.results || []).map((r) => [r.party, Number(r.value || 0)]));
  return (latest?.results || [])
    .filter((r) => Number(r.value) >= 2)
    .map((r) => ({
      party: r.party,
      value: Number(r.value || 0),
      delta: Number(r.value || 0) - Number(prev[r.party] || 0)
    }))
    .sort((a, b) => b.value - a.value);
}

function resultList(results) {
  return results
    .filter((r) => Number(r.value) >= 2)
    .sort((a, b) => Number(b.value) - Number(a.value))
    .map((r) => `<span style="display:inline-block;margin-right:10px;"><b>${esc(r.party)}</b> ${Number(r.value).toFixed(1)}%</span>`)
    .join("");
}

function render(data) {
  const root = document.getElementById("polling-root");
  if (!root) return;

  ensurePolling(data);
  const isPublisher = canPublish(data);
  const polls = data.polling.polls.slice().sort((a, b) => Number(b.createdTs || 0) - Number(a.createdTs || 0));
  const latest = polls[0] || null;
  const previous = polls[1] || null;
  const trends = latest ? trendAgainst(previous, latest) : [];
  const projection = latest ? seatProjection(data, latest) : [];

  root.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Polling</div></div>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Poll Publication</h2>
      <p>Polls are released every <b>2 months</b> by moderators. Only parties polling at <b>2%+</b> are displayed, with a <b>±2% margin of error</b>.</p>
    </section>

    ${latest ? `
      <section class="panel" style="margin-bottom:12px;">
        <h2 style="margin-top:0;">Most Recent Poll — ${esc(latest.simDate || "")}</h2>
        <div>${resultList(latest.results || [])}</div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-top:12px;">
          <article class="tile">
            <h3 style="margin-top:0;">Trend vs Previous Poll</h3>
            ${trends.length ? trends.map((t) => {
              const sign = t.delta > 0 ? "+" : "";
              const color = t.delta > 0 ? "#0a7f2e" : (t.delta < 0 ? "#9d1d1d" : "#444");
              return `<div><b>${esc(t.party)}</b> ${t.value.toFixed(1)}% <span style="color:${color};">(${sign}${t.delta.toFixed(1)})</span></div>`;
            }).join("") : `<div class="muted">No previous poll available for trend.</div>`}
          </article>

          <article class="tile">
            <h3 style="margin-top:0;">Simplified Seat Projection</h3>
            <div class="muted">If a GB vote was held today (scaled to ${esc(String(data?.parliament?.totalSeats || 650))} Commons seats).</div>
            <div style="margin-top:8px;">
              ${projection.map((p) => `<div><b>${esc(p.party)}:</b> ${esc(String(p.seats))}</div>`).join("")}
            </div>
          </article>
        </div>
      </section>
    ` : `
      <section class="panel" style="margin-bottom:12px;">
        <h2 style="margin-top:0;">Most Recent Poll</h2>
        <div class="muted-block">No polls have been published yet.</div>
      </section>
    `}

    ${isPublisher ? `
      <section class="panel" style="margin-bottom:12px;">
        <h2 style="margin-top:0;">Publish Poll (Mods/Admins)</h2>
        <form id="poll-submit-form">
          <label class="label" for="polling-sim-date">Simulation Month &amp; Year</label>
          <input id="polling-sim-date" name="simDate" class="input" value="${esc(currentSimLabel(data))}" readonly aria-readonly="true" style="background:#f0f4fb;cursor:default;">

          <label class="label">Party poll shares (%)</label>
          <table style="border-collapse:collapse;width:100%;margin-bottom:8px;">
            <thead><tr><th style="text-align:left;padding:4px 8px;">Party</th><th style="text-align:left;padding:4px 8px;">Share (%)</th></tr></thead>
            <tbody>
              ${(Array.isArray(data?.parliament?.parties) ? data.parliament.parties : []).map((p) => {
                const partyName = esc(p.name === "Speaker" ? "Others" : (p.name || ""));
                return `<tr><td style="padding:4px 8px;">${partyName}</td><td style="padding:4px 8px;"><input type="number" name="party-${partyName.replace(/[^a-zA-Z0-9 ]/g, "")}" min="0" max="100" step="0.1" value="0" class="input" style="width:90px;"></td></tr>`;
              }).join("")}
            </tbody>
          </table>
          <p class="muted" style="font-size:0.85em;margin-bottom:8px;">Parties polling under 2% are excluded from public display but all values are saved.</p>

          <button type="submit" class="btn">Publish Poll</button>
        </form>
      </section>
    ` : ""}

    <section class="panel">
      <h2 style="margin-top:0;">Polling Archive</h2>
      ${polls.length ? polls.map((poll, idx) => `
        <article class="tile" style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            <div><b>Poll ${esc(String(poll.id || idx + 1))}</b> • ${esc(poll.simDate || "")}</div>
            <div class="muted">Published – ${esc(poll.simDate || poll.createdAt || "")}</div>
          </div>
          <div style="margin-top:6px;">${resultList(poll.results || [])}</div>
          ${isPublisher ? `<div class="tile-bottom" style="margin-top:6px;"><button class="btn danger" type="button" data-action="delete-poll" data-id="${esc(String(poll.id))}">Delete</button></div>` : ""}
        </article>
      `).join("") : `<div class="muted-block">No historical polls yet.</div>`}
    </section>
  `;

  root.querySelector("#poll-submit-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!isPublisher) return;
    const form = e.currentTarget;
    const fd = new FormData(form);
    const simDate = String(fd.get("simDate") || "").trim();
    if (!simDate) return;

    const parties = Array.isArray(data?.parliament?.parties) ? data.parliament.parties : [];
    const results = parties
      .map((p) => {
        const partyName = p.name === "Speaker" ? "Others" : (p.name || "");
        const value = Number(fd.get("party-" + partyName) || 0);
        return partyName ? { party: partyName, value } : null;
      })
      .filter((r) => r && r.party && Number.isFinite(r.value) && r.value > 0);

    if (!results.length) return;

    const poll = {
      id: data.polling.nextId++,
      simDate,
      results,
      createdAt: simDate,
      createdTs: Date.now()
    };

    data.polling.polls.push(poll);
    try {
      await apiCreatePollingEntry(poll);
    } catch (err) {
      console.error("[polling] Failed to persist poll to DB:", err);
    }
    logAction({ action: "poll-published", target: simDate, details: { pollId: poll.id, results } });
    render(data);
  });

  root.querySelectorAll("[data-action='delete-poll']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!isPublisher) return;
      const id = String(btn.getAttribute("data-id") || "");
      data.polling.polls = data.polling.polls.filter((p) => String(p.id) !== id);
      render(data);
      apiDeletePollingEntry(id).catch((err) => console.error("[polling] delete failed:", err));
    });
  });
}

export function initPollingPage(data) {
  ensurePolling(data);
  render(data);
}
