export function initConstituencyWorkPage(data) {
  const host = document.getElementById("constituency-work-root") || document.querySelector("main.wrap");
  if (!host) return;
  host.innerHTML = `
    <section class="panel">
      <h1 class="page-title">Constituency Work</h1>
      <div class="muted-block">Stub loaded ✅ (40h allocation + lockout logic next)</div>
    </section>
  `;
}
