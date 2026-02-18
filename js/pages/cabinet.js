export function initCabinetPage(data) {
  const host = document.getElementById("cabinet-root") || document.querySelector("main.wrap");
  if (!host) return;
  host.innerHTML = `
    <section class="panel">
      <h1 class="page-title">Cabinet</h1>
      <div class="muted-block">Stub loaded ✅ (Cabinet HQ + cabinet drafting next)</div>
    </section>
  `;
}
