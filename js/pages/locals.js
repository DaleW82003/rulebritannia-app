export function initLocalsPage(data) {
  const host = document.getElementById("locals-root") || document.querySelector("main.wrap");
  if (!host) return;
  host.innerHTML = `
    <section class="panel">
      <h1 class="page-title">Locals</h1>
      <div class="muted-block">Stub loaded ✅ (4-country council control tiles next)</div>
    </section>
  `;
}
