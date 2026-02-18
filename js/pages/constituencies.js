export function initConstituenciesPage(data) {
  const host = document.getElementById("constituencies-root") || document.querySelector("main.wrap");
  if (!host) return;
  host.innerHTML = `
    <section class="panel">
      <h1 class="page-title">Constituencies</h1>
      <div class="muted-block">Stub loaded ✅ (Parliament state + party tiles next)</div>
    </section>
  `;
}
