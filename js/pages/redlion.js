export function initRedLionPage(data) {
  const host = document.getElementById("redlion-root") || document.querySelector("main.wrap");
  if (!host) return;
  host.innerHTML = `
    <section class="panel">
      <h1 class="page-title">Red Lion</h1>
      <div class="muted-block">Stub loaded ✅ (In-character comment feed next)</div>
    </section>
  `;
}
