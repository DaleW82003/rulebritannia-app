export function initBudgetPage(data) {
  const host = document.getElementById("budget-root") || document.querySelector("main.wrap");
  if (!host) return;
  host.innerHTML = `
    <section class="panel">
      <h1 class="page-title">Budget</h1>
      <div class="muted-block">Stub loaded ✅ (LY/TY budget view + Chancellor edit next)</div>
    </section>
  `;
}
