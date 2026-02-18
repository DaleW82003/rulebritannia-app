export function initUserPage(data) {
  const host = document.getElementById("user-root") || document.querySelector("main.wrap");
  if (!host) return;
  host.innerHTML = `
    <section class="panel">
      <h1 class="page-title">User</h1>
      <div class="muted-block">Stub loaded ✅ (Account + character + control panels next)</div>
    </section>
  `;
}
