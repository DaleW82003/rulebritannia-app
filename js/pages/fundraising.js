export function initFundraisingPage(data) {
  const host = document.getElementById("fundraising-root") || document.querySelector("main.wrap");
  if (!host) return;
  host.innerHTML = `
    <section class="panel">
      <h1 class="page-title">Fundraising</h1>
      <div class="muted-block">Stub loaded ✅ (Host templates + mod approve + private revenue next)</div>
    </section>
  `;
}
