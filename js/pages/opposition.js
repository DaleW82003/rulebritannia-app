export function initOppositionPage(data) {
  const host = document.getElementById("opposition-root") || document.querySelector("main.wrap");
  if (!host) return;
  host.innerHTML = `
    <section class="panel">
      <h1 class="page-title">Opposition</h1>
      <div class="muted-block">Stub loaded ✅ (Shadow cabinet tiles + dropdown assignments next)</div>
    </section>
  `;
}
