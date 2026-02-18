export function initShadowCabinetPage(data) {
  const host = document.getElementById("shadowcabinet-root") || document.querySelector("main.wrap");
  if (!host) return;
  host.innerHTML = `
    <section class="panel">
      <h1 class="page-title">Shadow Cabinet</h1>
      <div class="muted-block">Stub loaded ✅ (Shadow HQ + shadow drafting next)</div>
    </section>
  `;
}
