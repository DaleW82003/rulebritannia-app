export function initSubmitBillPage(data) {
  const host = document.getElementById("submit-bill-root") || document.querySelector("main.wrap");
  if (!host) return;
  host.innerHTML = `
    <section class="panel">
      <h1 class="page-title">Submit a Bill</h1>
      <div class="muted-block">Stub loaded ✅ (Submit Bill builder will be wired next)</div>
    </section>
  `;
}
