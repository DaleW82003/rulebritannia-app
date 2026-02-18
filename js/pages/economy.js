export function initEconomyPage(data) {
  const host = document.getElementById("economy-root") || document.querySelector("main.wrap");
  if (!host) return;
  host.innerHTML = `
    <section class="panel">
      <h1 class="page-title">Economy</h1>
      <div class="muted-block">Stub loaded ✅ (Key lines + UK Info + Surveys tiles next)</div>
    </section>
  `;
}
