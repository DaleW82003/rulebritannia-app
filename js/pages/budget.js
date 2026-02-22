import { saveState } from "../core.js";
import { esc } from "../ui.js";
import { isAdmin, isMod } from "../permissions.js";

const REVENUE_LINES = [
  "Income Tax", "Corporate Tax", "Value Added Tax", "National Insurance", "Fuel Duty", "Stamp Duty", "Business Rate Appropriations"
];
const EXPENDITURE_LINES = [
  "Health", "Social Security", "Education", "Home Office", "Ministry of Defense", "Transport", "Local Government", "Environment", "Energy", "Culture", "Housing", "Business", "Scottish Office", "Welsh Office", "Northern Ireland Office"
];
const CAPITAL_LINES = ["Capital Expenditure"];

function getCharacter(data) {
  return data?.currentCharacter || data?.currentPlayer || {};
}
function canDraftBudget(data) {
  return isMod(data) || getCharacter(data)?.office === "chancellor";
}

function money(n) { return `£${Number(n || 0).toFixed(2)}`; }

function sum(obj, keys) { return keys.reduce((a, k) => a + Number(obj?.[k] || 0), 0); }

function ensureBudget(data) {
  data.budget ??= {};
  data.budget.archive ??= [];
  data.budget.pending ??= null;
  data.budget.adminControls ??= {
    debtInterestPercent: 7.2,
    debtInterestExpenditure: 31.11,
    charityReliefExpenditure: 0.41,
    otherExpensesExpenditure: -0.66
  };

  if (!data.budget.lastYear) {
    data.budget.lastYear = {
      label: "August 1996",
      revenues: {
        "Income Tax": 102.65, "Corporate Tax": 34.74, "Value Added Tax": 92.17, "National Insurance": 66.62, "Fuel Duty": 23.28, "Stamp Duty": 9.96, "Business Rate Appropriations": 14.14
      },
      expenditures: {
        "Health": 40.96, "Social Security": 59.42, "Education": 88.10, "Home Office": 34.94, "Ministry of Defense": 34.11, "Transport": 18.69, "Local Government": 61.21, "Environment": 6.54, "Energy": 5.58, "Culture": 0.06, "Housing": -2.45, "Business": -5.50, "Scottish Office": 21.14, "Welsh Office": 7.10, "Northern Ireland Office": 3.58
      },
      capital: { "Capital Expenditure": 35.21 },
      gdp: 1930.0
    };
  }
  data.budget.currentYear ??= structuredClone(data.budget.lastYear);
}

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

  return `
    <div class="tile" style="margin-bottom:10px;">
      <h3 style="margin-top:0;">Budget of Rule Britannia</h3>
      <div><b>REVENUES</b> — LY ${money(lyT.revenues)} • TY ${money(tyT.revenues)}</div>
      <div><b>EXPENDITURE</b> — LY ${money(lyT.expenditure)} • TY ${money(tyT.expenditure)}</div>
      <div><b>BUDGET SURPLUS/DEFICIT</b> — LY ${money(lyT.deficit)} • TY ${money(tyT.deficit)}</div>
      <div><b>SURPLUS/DEFICIT (% GDP)</b> — LY ${lyT.deficitPctGdp.toFixed(2)}% • TY ${tyT.deficitPctGdp.toFixed(2)}%</div>
      <div><b>Govt. Revenue % GDP</b> — LY ${lyT.revenuePctGdp.toFixed(2)}% • TY ${tyT.revenuePctGdp.toFixed(2)}%</div>
      <div><b>Public Spending % GDP</b> — LY ${lyT.spendPctGdp.toFixed(2)}% • TY ${tyT.spendPctGdp.toFixed(2)}%</div>
      <div><b>Operating Surplus/Deficit</b> — LY ${money(lyT.operatingDeficit)} • TY ${money(tyT.operatingDeficit)}</div>
      <div><b>Capital Expenditure</b> — LY ${money(lyT.cap)} • TY ${money(tyT.cap)}</div>
      <div><b>Debt Interest %</b> — ${Number(adminControls.debtInterestPercent || 0).toFixed(2)}% (admin controlled)</div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(2,minmax(280px,1fr));gap:12px;">
      <article class="tile">
        <h4 style="margin-top:0;">Budgetary Details — Revenues</h4>
        ${REVENUE_LINES.map((k) => `<div>${esc(k)} — LY ${money(ly.revenues[k])} • TY ${money(ty.revenues[k])}</div>`).join("")}
      </article>
      <article class="tile">
        <h4 style="margin-top:0;">Budgetary Details — Expenditure</h4>
        ${EXPENDITURE_LINES.map((k) => `<div>${esc(k)} — LY ${money(ly.expenditures[k])} • TY ${money(ty.expenditures[k])}</div>`).join("")}
        <hr>
        <div>Debt Interest — ${money(adminControls.debtInterestExpenditure)} (static)</div>
        <div>Charity Tax Relief — ${money(adminControls.charityReliefExpenditure)} (static)</div>
        <div>Other Receipts/Expenses — ${money(adminControls.otherExpensesExpenditure)} (static)</div>
      </article>
    </div>
  `;
}

function render(data, state) {
  const root = document.getElementById("budget-root");
  if (!root) return;
  ensureBudget(data);

  const mod = isMod(data);
  const admin = isAdmin(data);
  const drafter = canDraftBudget(data);
  const ly = data.budget.lastYear;
  const ty = data.budget.currentYear;

  root.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Budget</div></div>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Current Budget (view only)</h2>
      <button class="btn" type="button" data-action="open-current">${state.openCurrent ? "Close" : "Open"}</button>
      ${state.openCurrent ? renderBudgetTable(ly, ty, data.budget.adminControls) : ""}
    </section>

    ${drafter ? `
      <section class="panel" style="margin-bottom:12px;">
        <h2 style="margin-top:0;">New Budget Draft (Chancellor/Mods)</h2>
        <button class="btn" type="button" data-action="open-draft">${state.openDraft ? "Close" : "Open"}</button>
        ${state.openDraft ? `
          <form id="budget-draft-form" style="margin-top:8px;">
            <div class="tile" style="margin-bottom:8px;">
              <h4 style="margin-top:0;">TY Budgetary Details — Revenues</h4>
              ${REVENUE_LINES.map((k) => `<label class="label">${esc(k)}<input class="input" type="number" step="0.01" name="rev:${esc(k)}" value="${esc(String(Number(ty.revenues[k] || 0)))}"></label>`).join("")}
            </div>
            <div class="tile" style="margin-bottom:8px;">
              <h4 style="margin-top:0;">TY Budgetary Details — Expenditure</h4>
              ${EXPENDITURE_LINES.map((k) => `<label class="label">${esc(k)}<input class="input" type="number" step="0.01" name="exp:${esc(k)}" value="${esc(String(Number(ty.expenditures[k] || 0)))}"></label>`).join("")}
            </div>
            <div class="tile" style="margin-bottom:8px;">
              <h4 style="margin-top:0;">TY Capital</h4>
              ${CAPITAL_LINES.map((k) => `<label class="label">${esc(k)}<input class="input" type="number" step="0.01" name="cap:${esc(k)}" value="${esc(String(Number(ty.capital[k] || 0)))}"></label>`).join("")}
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
            <input class="input" name="debtInterestPercent" type="number" step="0.01" value="${esc(String(data.budget.adminControls.debtInterestPercent))}">
          </label>
          <label class="label">Debt Interest Expenditure
            <input class="input" name="debtInterestExpenditure" type="number" step="0.01" value="${esc(String(data.budget.adminControls.debtInterestExpenditure))}">
          </label>
          <label class="label">Charity Relief Expenditure
            <input class="input" name="charityReliefExpenditure" type="number" step="0.01" value="${esc(String(data.budget.adminControls.charityReliefExpenditure))}">
          </label>
          <label class="label">Other Expenses Expenditure
            <input class="input" name="otherExpensesExpenditure" type="number" step="0.01" value="${esc(String(data.budget.adminControls.otherExpensesExpenditure))}">
          </label>
          <button class="btn" type="submit">Save Admin Controls</button>
        </form>

        ${data.budget.pending ? `
          <div class="tile" style="margin-top:10px;">
            <h4 style="margin-top:0;">Pending Budget Submission</h4>
            <div>Submitted by ${esc(data.budget.pending.submittedBy)} at ${esc(data.budget.pending.submittedAt)}</div>
            <button class="btn" type="button" data-action="approve-budget">Approve</button>
            <button class="btn" type="button" data-action="reject-budget">Reject</button>
          </div>
        ` : `<div class="muted">No pending budget submission.</div>`}
      </section>
    ` : ""}

    <section class="panel">
      <h2 style="margin-top:0;">Budget Archive</h2>
      <div><b>This Years Budget:</b> ${esc(ty.label || "Current")}</div>
      <div><b>Last Years Budget:</b> ${esc(ly.label || "Last")}</div>
      ${data.budget.archive.length ? data.budget.archive.slice().reverse().map((b) => `<div class="muted">${esc(b.label || "Budget")} • approved ${esc(b.approvedAt || "")}</div>`).join("") : `<div class="muted">No archived budgets yet.</div>`}
    </section>
  `;

  root.querySelector("[data-action='open-current']")?.addEventListener("click", () => { state.openCurrent = !state.openCurrent; render(data, state); });
  root.querySelector("[data-action='open-draft']")?.addEventListener("click", () => { state.openDraft = !state.openDraft; render(data, state); });

  root.querySelector("#budget-draft-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!drafter) return;
    const fd = new FormData(e.currentTarget);
    const draft = structuredClone(data.budget.currentYear);
    draft.revenues = { ...draft.revenues };
    draft.expenditures = { ...draft.expenditures };
    draft.capital = { ...draft.capital };
    REVENUE_LINES.forEach((k) => { draft.revenues[k] = Number(fd.get(`rev:${k}`) || 0); });
    EXPENDITURE_LINES.forEach((k) => { draft.expenditures[k] = Number(fd.get(`exp:${k}`) || 0); });
    CAPITAL_LINES.forEach((k) => { draft.capital[k] = Number(fd.get(`cap:${k}`) || 0); });
    draft.label = "Draft submission";
    data.budget.pending = { budget: draft, submittedBy: getCharacter(data)?.name || "User", submittedAt: new Date().toLocaleString("en-GB") };
    saveState(data);
    render(data, state);
  });

  root.querySelector("#budget-admin-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!admin) return;
    const fd = new FormData(e.currentTarget);
    Object.keys(data.budget.adminControls).forEach((k) => { data.budget.adminControls[k] = Number(fd.get(k) || 0); });
    saveState(data);
    render(data, state);
  });

  root.querySelector("[data-action='approve-budget']")?.addEventListener("click", () => {
    if (!admin || !data.budget.pending) return;
    const approved = data.budget.pending.budget;
    approved.label = `Approved ${new Date().toLocaleDateString("en-GB")}`;
    approved.approvedAt = new Date().toLocaleString("en-GB");
    data.budget.archive.push(structuredClone(data.budget.lastYear));
    data.budget.lastYear = structuredClone(data.budget.currentYear);
    data.budget.currentYear = approved;
    data.budget.pending = null;
    saveState(data);
    render(data, state);
  });

  root.querySelector("[data-action='reject-budget']")?.addEventListener("click", () => {
    if (!admin) return;
    data.budget.pending = null;
    saveState(data);
    render(data, state);
  });
}

export function initBudgetPage(data) {
  ensureBudget(data);
  render(data, { openCurrent: false, openDraft: false });
}
