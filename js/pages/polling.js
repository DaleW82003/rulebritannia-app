import { saveData } from "../core.js";
import { esc } from "../ui.js";
import { isAdmin, isMod, canAdminOrMod } from "../permissions.js";
import { formatSimMonthYear, getWeekdayName, isSunday } from "../clock.js";
import { logAction } from "../audit.js";

const POLL_DAY = "Sunday";

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
  const parties = data?.parliament?.parties || [];
  const seatsTotal = Number(data?.parliament?.totalSeats || 650);
  const shares = normalizeShares(poll.results || []);

  const byParty = Object.fromEntries(shares.map((s) => [s.party, s.value]));
  const projected = [];
  let allocated = 0;

  parties.forEach((p) => {
    const share = Number(byParty[p.name] || 0);
    const seats = Math.floor((share / 100) * seatsTotal);
    allocated += seats;
    projected.push({ party: p.name, seats, remainder: ((share / 100) * seatsTotal) - seats });
  });

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
  const sunday = isSunday();
  const weekday = getWeekdayName();
  const polls = data.polling.polls.slice().sort((a, b) => Number(b.createdTs || 0) - Number(a.createdTs || 0));
  const latest = polls[0] || null;
  const previous = polls[1] || null;
  const trends = latest ? trendAgainst(previous, latest) : [];
  const projection = latest ? seatProjection(data, latest) : [];

  root.innerHTML = `
    <h1 class="page-title">Polling</h1>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Weekly Poll Publication</h2>
      <p>Polls are published by moderators on <b>${POLL_DAY}s</b>. Only parties polling at <b>2%+</b> are displayed. Archive is chronological for the current simulation round.</p>
      ${isPublisher && !sunday ? `<p class="muted">Poll publishing is locked on ${esc(weekday)}. Return on Sunday for the weekly release.</p>` : ""}
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
        <h2 style="margin-top:0;">Publish Weekly Poll (Mods/Admins)</h2>
        <form id="poll-submit-form">
          <label class="label" for="polling-sim-date">Simulation Month & Year</label>
          <input id="polling-sim-date" name="simDate" class="input" value="${esc(currentSimLabel(data))}" required>

          <label class="label" for="polling-results">Party shares (one per line: Party=Value)</label>
          <textarea id="polling-results" name="results" class="input" rows="6" required placeholder="Labour=34.5\nConservative=31.1\nLiberal Democrat=11.8\nGreen=5.0\nSNP=3.0"></textarea>

          <button type="submit" class="btn" ${sunday ? "" : "disabled"}>Publish Poll</button>
        </form>
      </section>
    ` : ""}

    <section class="panel">
      <h2 style="margin-top:0;">Polling Archive</h2>
      ${polls.length ? polls.map((poll, idx) => `
        <article class="tile" style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            <div><b>Poll ${esc(String(poll.id || idx + 1))}</b> • ${esc(poll.simDate || "")}</div>
            <div class="muted">Published ${esc(poll.createdAt || "")}</div>
          </div>
          <div style="margin-top:6px;">${resultList(poll.results || [])}</div>
        </article>
      `).join("") : `<div class="muted-block">No historical polls yet.</div>`}
    </section>
  `;

  root.querySelector("#poll-submit-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!isPublisher) return;
    if (!isSunday()) return;
    const fd = new FormData(e.currentTarget);
    const simDate = String(fd.get("simDate") || "").trim();
    const text = String(fd.get("results") || "").trim();
    if (!simDate || !text) return;

    const results = text.split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [party, value] = line.split("=");
        return { party: String(party || "").trim(), value: Number(value || 0) };
      })
      .filter((r) => r.party && Number.isFinite(r.value));

    if (!results.length) return;

    const poll = {
      id: data.polling.nextId++,
      simDate,
      results,
      createdAt: new Date().toLocaleString("en-GB"),
      createdTs: Date.now()
    };

    data.polling.polls.push(poll);
    saveData(data);
    logAction({ action: "poll-published", target: simDate, details: { pollId: poll.id, results } });
    render(data);
  });
}

export function initPollingPage(data) {
  ensurePolling(data);
  render(data);
}
