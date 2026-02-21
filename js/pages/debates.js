// js/pages/debates.js
// Lists all linked Discourse debate topics grouped by entity type (Bills,
// Motions, Statements, Regulations) and sorted newest-first within each group.
import { esc } from "../ui.js";
import { handleApiError } from "../errors.js";
import { apiGetBills, apiGetMotions, apiGetStatements, apiGetRegulations } from "../api.js";

const CATEGORIES = [
  { key: "bills",       label: "Bills"       },
  { key: "motions",     label: "Motions"      },
  { key: "statements",  label: "Statements"   },
  { key: "regulations", label: "Regulations"  },
];

/**
 * Return a JS Date (or epoch 0) from the various date fields an entity may carry.
 * Newest-first sort: higher value = earlier position.
 */
function entityDate(item) {
  const raw =
    item._updatedAt ||
    item.updatedAt  ||
    item.created_at ||
    item.createdAt  ||
    item.openedAtSim || // sim-date string — only used as last-resort tie-break
    "";
  if (!raw) return new Date(0);
  const d = new Date(raw);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

function sortNewestFirst(items) {
  return [...items].sort((a, b) => entityDate(b) - entityDate(a));
}

function renderCard(item, type) {
  const url   = item.discourseTopicUrl || item.debateUrl || "";
  const title = item.title || item.shortTitle || `${type} ${item.id}`;
  const date  = entityDate(item);
  const dateStr = date.getTime()
    ? date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "—";
  const sub   = item.author ? `by ${esc(item.author)}` : "";
  const badge = item.status
    ? `<span style="font-size:11px;padding:1px 6px;border-radius:10px;background:#e8e8e8;color:#555;">${esc(item.status)}</span>`
    : "";

  return `
    <article class="tile" style="margin-bottom:10px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <div style="flex:1;min-width:180px;">
        <div><b>${esc(title)}</b> ${badge}</div>
        ${sub ? `<div class="muted" style="font-size:13px;margin-top:2px;">${sub}</div>` : ""}
        <div class="muted" style="font-size:12px;margin-top:2px;">${esc(dateStr)}</div>
      </div>
      ${url
        ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener" style="white-space:nowrap;">Open in Discourse</a>`
        : `<span class="muted" style="font-size:12px;">No Discourse link yet</span>`
      }
    </article>`;
}

function renderCategory(label, items, type) {
  if (!items.length) {
    return `
      <section class="panel" style="margin-bottom:16px;">
        <h2 style="margin-top:0;">${esc(label)}</h2>
        <p class="muted-block">No linked debate topics yet.</p>
      </section>`;
  }
  return `
    <section class="panel" style="margin-bottom:16px;">
      <h2 style="margin-top:0;">${esc(label)} <span class="muted" style="font-size:14px;font-weight:400;">(${items.length})</span></h2>
      ${items.map((item) => renderCard(item, type)).join("")}
    </section>`;
}

export async function initDebatesPage(data) {
  const root = document.querySelector("main.wrap") || document.body;
  root.innerHTML = `<h1 class="page-title">Debates</h1><p class="muted-block" id="debates-status">Loading debate topics…</p>`;

  let bills = [], houseMotions = [], edmMotions = [], statements = [], regulations = [];

  try {
    const [billsRes, motionsRes, statementsRes, regulationsRes] = await Promise.all([
      apiGetBills().catch((e) => { handleApiError(e, "Load bills"); return null; }),
      apiGetMotions().catch((e) => { handleApiError(e, "Load motions"); return null; }),
      apiGetStatements().catch((e) => { handleApiError(e, "Load statements"); return null; }),
      apiGetRegulations().catch((e) => { handleApiError(e, "Load regulations"); return null; }),
    ]);

    bills       = (billsRes?.bills       || []).filter((b) => b.discourseTopicId || b.discourseTopicUrl);
    const allMotions = motionsRes?.motions || [];
    houseMotions = allMotions.filter((m) => (m.motion_type || m.kind) !== "edm" && (m.discourseTopicId || m.discourseTopicUrl));
    edmMotions   = allMotions.filter((m) => (m.motion_type || m.kind) === "edm"  && (m.discourseTopicId || m.discourseTopicUrl));
    statements  = (statementsRes?.statements  || []).filter((s) => s.discourseTopicId || s.discourseTopicUrl);
    regulations = (regulationsRes?.regulations || []).filter((r) => r.discourseTopicId || r.discourseTopicUrl);
  } catch (e) {
    handleApiError(e, "Load debates");
  }

  // All motions together (house + EDM), each sorted newest-first
  const allMotions = [...houseMotions, ...edmMotions];

  const total = bills.length + allMotions.length + statements.length + regulations.length;

  root.innerHTML = `
    <h1 class="page-title">Debates</h1>
    <p class="muted-block" style="margin-bottom:18px;">
      All Discourse debate topics linked to game entities, grouped by type and sorted newest first.
      ${total ? `${total} linked topic${total !== 1 ? "s" : ""}.` : "No linked topics yet."}
    </p>
    ${renderCategory("Bills",       sortNewestFirst(bills),       "Bill")}
    ${renderCategory("Motions",     sortNewestFirst(allMotions),  "Motion")}
    ${renderCategory("Statements",  sortNewestFirst(statements),  "Statement")}
    ${renderCategory("Regulations", sortNewestFirst(regulations), "Regulation")}
  `;
}
