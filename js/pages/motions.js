export function initMotionsPage(data) {
  const host = document.getElementById("motions-root") || document.querySelector("main.wrap");
  if (!host) return;
  host.innerHTML = `
    <section class="panel">
      <h1 class="page-title">Motions</h1>
      <div class="muted-block">Stub loaded ✅ (House Motions + EDMs next)</div>
    </section>
  `;
}
