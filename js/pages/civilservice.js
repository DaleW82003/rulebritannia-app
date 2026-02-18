export function initCivilServicePage(data) {
  const host = document.getElementById("civilservice-root") || document.querySelector("main.wrap");
  if (!host) return;
  host.innerHTML = `
    <section class="panel">
      <h1 class="page-title">Civil Service</h1>
      <div class="muted-block">Stub loaded ✅ (Department tickets + Civil Servant replies next)</div>
    </section>
  `;
}
