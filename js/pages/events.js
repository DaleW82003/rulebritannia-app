export function initEventsPage(data) {
  const host = document.getElementById("events-root") || document.querySelector("main.wrap");
  if (!host) return;
  host.innerHTML = `
    <section class="panel">
      <h1 class="page-title">Events</h1>
      <div class="muted-block">Stub loaded ✅ (Conference/Event hosting + mod approval next)</div>
    </section>
  `;
}
