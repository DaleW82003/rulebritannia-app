export function initTeamPage(data) {
  const host = document.getElementById("team-root") || document.querySelector("main.wrap");
  if (!host) return;
  host.innerHTML = `
    <section class="panel">
      <h1 class="page-title">A Team</h1>
      <div class="muted-block">Stub loaded ✅ (Admins / Mods / Speaker tiles next)</div>
    </section>
  `;
}
