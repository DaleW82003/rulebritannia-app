export function initGovernmentPage(data) {
  const host = document.getElementById("government-root") || document.querySelector("main.wrap");
  if (!host) return;
  host.innerHTML = `
    <section class="panel">
      <h1 class="page-title">Government</h1>
      <div class="muted-block">Stub loaded ✅ (Minister tiles + dropdown assignments next)</div>
    </section>
  `;
}
