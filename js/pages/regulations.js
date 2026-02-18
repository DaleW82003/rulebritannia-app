export function initRegulationsPage(data) {
  const host = document.getElementById("regulations-root") || document.querySelector("main.wrap");
  if (!host) return;
  host.innerHTML = `
    <section class="panel">
      <h1 class="page-title">Regulations</h1>
      <div class="muted-block">Stub loaded ✅ (Regulations template + debate link next)</div>
    </section>
  `;
}
