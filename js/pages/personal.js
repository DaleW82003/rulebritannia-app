export function initPersonalPage(data) {
  const host = document.getElementById("personal-root") || document.querySelector("main.wrap");
  if (!host) return;
  host.innerHTML = `
    <section class="panel">
      <h1 class="page-title">Personal</h1>
      <div class="muted-block">Stub loaded ✅ (Salary + bank + profile tiles next)</div>
    </section>
  `;
}
