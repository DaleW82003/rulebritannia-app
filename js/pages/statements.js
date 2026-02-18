export function initStatementsPage(data) {
  const host = document.getElementById("statements-root") || document.querySelector("main.wrap");
  if (!host) return;
  host.innerHTML = `
    <section class="panel">
      <h1 class="page-title">Statements</h1>
      <div class="muted-block">Stub loaded ✅ (Ministerial Statements next)</div>
    </section>
  `;
}
