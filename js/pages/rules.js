export function initRulesPage(data) {
  const host = document.getElementById("rules-root") || document.querySelector("main.wrap");
  if (!host) return;
  host.innerHTML = `
    <section class="panel">
      <h1 class="page-title">Rules</h1>
      <div class="muted-block">Stub loaded ✅ (Rules tiles + admin editor next)</div>
    </section>
  `;
}
