export function initOnlinePage(data) {
  const host = document.getElementById("online-root") || document.querySelector("main.wrap");
  if (!host) return;
  host.innerHTML = `
    <section class="panel">
      <h1 class="page-title">Online</h1>
      <div class="muted-block">Stub loaded ✅ (WWW posts + Facebook/Twitter feeds next)</div>
    </section>
  `;
}
