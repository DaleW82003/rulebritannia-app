export function initBodiesPage(data) {
  const host = document.getElementById("bodies-root") || document.querySelector("main.wrap");
  if (!host) return;
  host.innerHTML = `
    <section class="panel">
      <h1 class="page-title">Bodies</h1>
      <div class="muted-block">Stub loaded ✅ (6 bodies list + seat breakdown next)</div>
    </section>
  `;
}
