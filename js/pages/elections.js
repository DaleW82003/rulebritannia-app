export function initElectionsPage(data) {
  const host = document.getElementById("elections-root") || document.querySelector("main.wrap");
  if (!host) return;
  host.innerHTML = `
    <section class="panel">
      <h1 class="page-title">Elections</h1>
      <div class="muted-block">Stub loaded ✅ (Last GE + body elections tiles + archive next)</div>
    </section>
  `;
}
