export function initPressPage(data) {
  const host = document.getElementById("press-root") || document.querySelector("main.wrap");
  if (!host) return;
  host.innerHTML = `
    <section class="panel">
      <h1 class="page-title">Press</h1>
      <div class="muted-block">Stub loaded ✅ (Releases / Conferences / Comments next)</div>
    </section>
  `;
}
