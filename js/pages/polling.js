export function initPollingPage(data) {
  const host = document.getElementById("polling-root") || document.querySelector("main.wrap");
  if (!host) return;
  host.innerHTML = `
    <section class="panel">
      <h1 class="page-title">Polling</h1>
      <div class="muted-block">Stub loaded ✅ (Sunday poll + trend + seat projection next)</div>
    </section>
  `;
}
