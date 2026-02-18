export function initPartyPage(data) {
  const host = document.getElementById("party-root") || document.querySelector("main.wrap");
  if (!host) return;
  host.innerHTML = `
    <section class="panel">
      <h1 class="page-title">Party</h1>
      <div class="muted-block">Stub loaded ✅ (Party HQ + Draft a Bill + Discuss button next)</div>
    </section>
  `;
}
