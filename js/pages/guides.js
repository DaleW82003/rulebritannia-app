export function initGuidesPage(data) {
  const host = document.getElementById("guides-root") || document.querySelector("main.wrap");
  if (!host) return;
  host.innerHTML = `
    <section class="panel">
      <h1 class="page-title">Guides</h1>
      <div class="muted-block">Stub loaded ✅ (Guides tiles + admin editor next)</div>
    </section>
  `;
}
