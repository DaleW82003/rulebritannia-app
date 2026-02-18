export function initHansardPage(data) {
  const host = document.getElementById("hansard-root") || document.querySelector("main.wrap");
  if (!host) return;
  host.innerHTML = `
    <section class="panel">
      <h1 class="page-title">Hansard</h1>
      <div class="muted-block">Stub loaded ✅ (Passed/defeated archive + Sunday roll log next)</div>
    </section>
  `;
}
