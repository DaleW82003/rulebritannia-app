import { esc } from "../ui.js";
import { isAdmin, isMod } from "../permissions.js";
import { getCharacterContext } from "../engines/core-engine.js";
import {
  apiGetBudget,
  apiAdminSeedBudget,
  apiAdminUpdateBudgetControls,
  apiSubmitBudgetDraft,
  apiAdminApproveBudget,
  apiAdminRejectBudget,
} from "../api.js";

const REVENUE_LINES = [
  "Income Tax", "Corporate Tax", "Value Added Tax", "National Insurance", "Fuel Duty", "Stamp Duty", "Business Rate Appropriations"
];
const EXPENDITURE_LINES = [
  "Health", "Social Security", "Education", "Home Office", "Ministry of Defense", "Transport", "Local Government", "Environment", "Energy", "Culture", "Housing", "Business", "Scottish Office", "Welsh Office", "Northern Ireland Office"
];
const CAPITAL_LINES = ["Capital Expenditure"];

function canDraftBudget(data) {
  return isMod(data) || getCharacterContext(data)?.office === "chancellor";
}

function money(n) { return `£${Number(n || 0).toFixed(2)}`; }

function sum(obj, keys) { return keys.reduce((a, k) => a + Number(obj?.[k] || 0), 0); }

function calculateTotals(budget, adminControls) {
  const rev = sum(budget.revenues, REVENUE_LINES);
  const expCore = sum(budget.expenditures, EXPENDITURE_LINES);
  const cap = sum(budget.capital, CAPITAL_LINES);
  const staticExp = Number(adminControls.debtInterestExpenditure || 0) + Number(adminControls.charityReliefExpenditure || 0) + Number(adminControls.otherExpensesExpenditure || 0);
  const totalExp = expCore + cap + staticExp;
  const deficit = rev - totalExp;
  const gdp = Number(budget.gdp || 1930);
  return {
    revenues: rev,
    expenditure: totalExp,
    deficit,
    deficitPctGdp: gdp ? (deficit / gdp) * 100 : 0,
    revenuePctGdp: gdp ? (rev / gdp) * 100 : 0,
    spendPctGdp: gdp ? (totalExp / gdp) * 100 : 0,
    operatingDeficit: rev - (expCore + staticExp),
    staticExp,
    cap
  };
}

function renderBudgetTable(ly, ty, adminControls) {
  const lyT = calculateTotals(ly, adminControls);
  const tyT = calculateTotals(ty, adminControls);

  const tableStyle = `width:100%;border-collapse:collapse;font-size:14px;`;
  const thStyle = `padding:8px 12px;background:#0b2d6b;color:#fff;text-align:left;`;
  const thRStyle = `padding:8px 12px;background:#0b2d6b;color:#fff;text-align:right;`;
  const tdStyle = `padding:7px 12px;border-bottom:1px solid #cdd9f2;`;
  const tdRStyle = `padding:7px 12px;border-bottom:1px solid #cdd9f2;text-align:right;font-variant-numeric:tabular-nums;`;
  const tdBStyle = `padding:7px 12px;border-bottom:1px solid #cdd9f2;font-weight:700;`;
  const tdBRStyle = `padding:7px 12px;border-bottom:1px solid #cdd9f2;font-weight:700;text-align:right;font-variant-numeric:tabular-nums;`;

  function row(label, lyVal, tyVal, bold = false) {
    const td1 = bold ? `<td style="${tdBStyle}">${esc(label)}</td>` : `<td style="${tdStyle}">${esc(label)}</td>`;
    const td2 = bold ? `<td style="${tdBRStyle}">${lyVal}</td>` : `<td style="${tdRStyle}">${lyVal}</td>`;
    const td3 = bold ? `<td style="${tdBRStyle}">${tyVal}</td>` : `<td style="${tdRStyle}">${tyVal}</td>`;
    return `<tr>${td1}${td2}${td3}</tr>`;
  }

  function sectionHeader(label) {
    return `<tr><td colspan="3" style="padding:10px 12px 4px;font-weight:900;font-size:12px;letter-spacing:.06em;text-transform:uppercase;background:#eef3fb;color:#0b2d6b;">${esc(label)}</td></tr>`;
  }

  return `
    <div style="overflow-x:auto;">
      <table style="${tableStyle}">
        <thead>
          <tr>
            <th style="${thStyle}">Line Item</th>
            <th style="${thRStyle}">Last Year (LY)</th>
            <th style="${thRStyle}">This Year (TY)</th>
          </tr>
        </thead>
        <tbody>
          ${sectionHeader("Revenues")}
          ${REVENUE_LINES.map((k) => row(k, money(ly.revenues[k]), money(ty.revenues[k]))).join("")}
          ${row("Total Revenues", money(lyT.revenues), money(tyT.revenues), true)}

          ${sectionHeader("Expenditure")}
          ${EXPENDITURE_LINES.map((k) => row(k, money(ly.expenditures[k]), money(ty.expenditures[k]))).join("")}
          ${row("Capital Expenditure", money(lyT.cap), money(tyT.cap))}
          <!-- Static admin-controlled lines intentionally show the same value in both LY and TY columns -->
          ${row("Debt Interest (static)", money(adminControls.debtInterestExpenditure), money(adminControls.debtInterestExpenditure))}
          ${row("Charity Tax Relief (static)", money(adminControls.charityReliefExpenditure), money(adminControls.charityReliefExpenditure))}
          ${row("Other Receipts/Expenses (static)", money(adminControls.otherExpensesExpenditure), money(adminControls.otherExpensesExpenditure))}
          ${row("Total Expenditure", money(lyT.expenditure), money(tyT.expenditure), true)}

          ${sectionHeader("Summary")}
          ${row("Budget Surplus / Deficit", money(lyT.deficit), money(tyT.deficit), true)}
          ${row("Surplus/Deficit (% GDP)", `${lyT.deficitPctGdp.toFixed(2)}%`, `${tyT.deficitPctGdp.toFixed(2)}%`)}
          ${row("Govt. Revenue % GDP", `${lyT.revenuePctGdp.toFixed(2)}%`, `${tyT.revenuePctGdp.toFixed(2)}%`)}
          ${row("Public Spending % GDP", `${lyT.spendPctGdp.toFixed(2)}%`, `${tyT.spendPctGdp.toFixed(2)}%`)}
          ${row("Operating Surplus/Deficit", money(lyT.operatingDeficit), money(tyT.operatingDeficit))}
          ${row(`Debt Interest % (admin)`, `${Number(adminControls.debtInterestPercent || 0).toFixed(2)}%`, `${Number(adminControls.debtInterestPercent || 0).toFixed(2)}%`)}
        </tbody>
      </table>
    </div>
  `;
}

function render(budgetDb, data, state) {
  const root = document.getElementById("budget-root");
  if (!root) return;

  const mod = isMod(data);
  const admin = isAdmin(data);
  const drafter = canDraftBudget(data);
  const ly = budgetDb.lastYear;
  const ty = budgetDb.currentYear;
  const adminControls = budgetDb.adminControls || {
    debtInterestPercent: 7.2,
    debtInterestExpenditure: 31.11,
    charityReliefExpenditure: 0.41,
    otherExpensesExpenditure: -0.66
  };
  const pending = budgetDb.pending;
  const archive = budgetDb.archive || [];
  // Fallback empty structures for the draft form so inputs don't throw on null ty.
  const tyDraft = ty || { revenues: {}, expenditures: {}, capital: {}, gdp: 1930.0 };

  root.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Budget</div></div>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Current Budget (view only)</h2>
      <button class="btn" type="button" data-action="open-current">${state.openCurrent ? "Close" : "Open"}</button>
      ${state.openCurrent ? (ly && ty ? renderBudgetTable(ly, ty, adminControls) : '<div class="muted-block" style="margin-top:8px;">No budget data available yet. Mods/Admins must seed the Last Year budget first.</div>') : ""}
    </section>

    ${drafter ? `
      <section class="panel" style="margin-bottom:12px;">
        <h2 style="margin-top:0;">New Budget Draft (Chancellor/Mods)</h2>
        <button class="btn" type="button" data-action="open-draft">${state.openDraft ? "Close" : "Open"}</button>
        ${state.openDraft ? `
          <form id="budget-draft-form" style="margin-top:8px;">
            <div class="tile" style="margin-bottom:8px;">
              <h4 style="margin-top:0;">TY Budgetary Details — Revenues</h4>
              ${REVENUE_LINES.map((k) => `<label class="label">${esc(k)}<input class="input" type="number" step="0.01" name="rev:${esc(k)}" value="${esc(String(Number(tyDraft.revenues[k] || 0)))}"></label>`).join("")}
            </div>
            <div class="tile" style="margin-bottom:8px;">
              <h4 style="margin-top:0;">TY Budgetary Details — Expenditure</h4>
              ${EXPENDITURE_LINES.map((k) => `<label class="label">${esc(k)}<input class="input" type="number" step="0.01" name="exp:${esc(k)}" value="${esc(String(Number(tyDraft.expenditures[k] || 0)))}"></label>`).join("")}
            </div>
            <div class="tile" style="margin-bottom:8px;">
              <h4 style="margin-top:0;">TY Capital</h4>
              ${CAPITAL_LINES.map((k) => `<label class="label">${esc(k)}<input class="input" type="number" step="0.01" name="cap:${esc(k)}" value="${esc(String(Number(tyDraft.capital[k] || 0)))}"></label>`).join("")}
            </div>
            <button class="btn" type="submit">Submit New Budget</button>
          </form>
        ` : ""}
      </section>
    ` : ""}

    ${admin ? `
      <section class="panel" style="margin-bottom:12px;">
        <h2 style="margin-top:0;">Admin Budget Controls</h2>
        <form id="budget-admin-form">
          <label class="label">Debt Interest %
            <input class="input" name="debtInterestPercent" type="number" step="0.01" value="${esc(String(adminControls.debtInterestPercent))}">
          </label>
          <label class="label">Debt Interest Expenditure
            <input class="input" name="debtInterestExpenditure" type="number" step="0.01" value="${esc(String(adminControls.debtInterestExpenditure))}">
          </label>
          <label class="label">Charity Relief Expenditure
            <input class="input" name="charityReliefExpenditure" type="number" step="0.01" value="${esc(String(adminControls.charityReliefExpenditure))}">
          </label>
          <label class="label">Other Expenses Expenditure
            <input class="input" name="otherExpensesExpenditure" type="number" step="0.01" value="${esc(String(adminControls.otherExpensesExpenditure))}">
          </label>
          <button class="btn" type="submit">Save Admin Controls</button>
        </form>
        ${state.adminMessage ? `<p class="muted" style="margin-top:6px;">${esc(state.adminMessage)}</p>` : ""}

        ${pending ? `
          <div class="tile" style="margin-top:10px;">
            <h4 style="margin-top:0;">Pending Budget Submission</h4>
            <div>Submitted by ${esc(pending.submittedBy)} at ${esc(pending.submittedAt)}</div>
            <button class="btn" type="button" data-action="approve-budget">Approve</button>
            <button class="btn" type="button" data-action="reject-budget">Reject</button>
          </div>
        ` : `<div class="muted">No pending budget submission.</div>`}

        <div class="tile" style="margin-top:10px;">
          <h4 style="margin-top:0;">Seed Last Year's Budget</h4>
          <p class="muted" style="margin:0 0 8px;">Populate the Last Year and This Year columns with the 1996–97 baseline figures. Only needed once at simulation start.</p>
          ${ly
            ? `<button class="btn" type="button" disabled title="Last Year's budget is already set">Last Year Already Seeded ✓</button>`
            : `<button class="btn" type="button" data-action="seed-last-year">Seed Last Year's Budget (1996–97 Baseline)</button>`}
          ${state.seedMessage ? `<p class="muted" style="margin-top:6px;">${esc(state.seedMessage)}</p>` : ""}
        </div>
      </section>
    ` : ""}

    <section class="panel">
      <h2 style="margin-top:0;">Budget Archive</h2>
      <div><b>Current Year's Budget:</b> ${ty?.label ? esc(ty.label) : `<span class="muted" style="font-style:italic;">Not yet submitted — Chancellor submits each year.</span>`}</div>
      <div><b>Last Year's Budget:</b> ${ly?.label ? esc(ly.label) : `<span class="muted" style="font-style:italic;">Not yet set — Mods/Admins set this at the start of the simulation.</span>`}</div>
      ${archive.length ? `<div style="margin-top:8px;"><b>Previous Budgets:</b></div>${archive.slice().reverse().map((b) => `<div class="muted">${esc(b.label || "Budget")} • approved ${esc(b.approvedAt || "")}</div>`).join("")}` : `<div class="muted" style="margin-top:8px;">No previously approved budgets on record yet.</div>`}
    </section>
  `;

  root.querySelector("[data-action='open-current']")?.addEventListener("click", () => { state.openCurrent = !state.openCurrent; render(budgetDb, data, state); });
  root.querySelector("[data-action='open-draft']")?.addEventListener("click", () => { state.openDraft = !state.openDraft; render(budgetDb, data, state); });

  root.querySelector("#budget-draft-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!drafter) return;
    const fd = new FormData(e.currentTarget);
    const base = ty || { revenues: {}, expenditures: {}, capital: {}, gdp: 1930.0 };
    const draft = { ...base, revenues: { ...base.revenues }, expenditures: { ...base.expenditures }, capital: { ...base.capital } };
    REVENUE_LINES.forEach((k) => { draft.revenues[k] = Number(fd.get(`rev:${k}`) || 0); });
    EXPENDITURE_LINES.forEach((k) => { draft.expenditures[k] = Number(fd.get(`exp:${k}`) || 0); });
    CAPITAL_LINES.forEach((k) => { draft.capital[k] = Number(fd.get(`cap:${k}`) || 0); });
    draft.label = "Draft submission";
    try {
      await apiSubmitBudgetDraft(draft, getCharacterContext(data)?.name || "User");
      const updated = await apiGetBudget();
      Object.assign(budgetDb, updated);
      state.openDraft = false;
      render(budgetDb, data, state);
    } catch (err) {
      alert(`Failed to submit draft: ${err.message}`);
    }
  });

  root.querySelector("#budget-admin-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!admin) return;
    const fd = new FormData(e.currentTarget);
    const controls = {
      debtInterestPercent:      Number(fd.get("debtInterestPercent") || 0),
      debtInterestExpenditure:  Number(fd.get("debtInterestExpenditure") || 0),
      charityReliefExpenditure: Number(fd.get("charityReliefExpenditure") || 0),
      otherExpensesExpenditure: Number(fd.get("otherExpensesExpenditure") || 0),
    };
    try {
      await apiAdminUpdateBudgetControls(controls);
      budgetDb.adminControls = controls;
      state.adminMessage = "Admin controls saved.";
      render(budgetDb, data, state);
    } catch (err) {
      state.adminMessage = `Save failed: ${err.message}`;
      render(budgetDb, data, state);
    }
  });

  root.querySelector("[data-action='approve-budget']")?.addEventListener("click", async () => {
    if (!admin || !pending) return;
    try {
      await apiAdminApproveBudget();
      const updated = await apiGetBudget();
      Object.assign(budgetDb, updated);
      render(budgetDb, data, state);
    } catch (err) {
      alert(`Approve failed: ${err.message}`);
    }
  });

  root.querySelector("[data-action='reject-budget']")?.addEventListener("click", async () => {
    if (!admin) return;
    try {
      await apiAdminRejectBudget();
      budgetDb.pending = null;
      render(budgetDb, data, state);
    } catch (err) {
      alert(`Reject failed: ${err.message}`);
    }
  });

  root.querySelector("[data-action='seed-last-year']")?.addEventListener("click", async () => {
    if (!admin) return;
    const btn = root.querySelector("[data-action='seed-last-year']");
    if (btn) btn.disabled = true;
    try {
      const result = await apiAdminSeedBudget(false);
      if (result.error && !result.alreadySeeded) {
        state.seedMessage = `Seed failed: ${result.error}`;
        render(budgetDb, data, state);
        return;
      }
      const updated = await apiGetBudget();
      Object.assign(budgetDb, updated);
      state.seedMessage = "Budget seeded successfully.";
      render(budgetDb, data, state);
    } catch (err) {
      state.seedMessage = `Seed failed: ${err.message}`;
      render(budgetDb, data, state);
    }
  });
}

export async function initBudgetPage(data) {
  const root = document.getElementById("budget-root");
  if (root) root.innerHTML = `<div class="muted-block" style="margin:16px;">Loading budget…</div>`;
  let budgetDb = { lastYear: null, currentYear: null, adminControls: {}, archive: [], pending: null };
  try {
    budgetDb = await apiGetBudget();
  } catch (err) {
    console.error("[budget] Failed to load budget from DB:", err);
  }
  render(budgetDb, data, { openCurrent: false, openDraft: false });
}
