import { esc } from "../ui.js";
import { apiGetPublicProfile } from "../api.js";

export async function initProfilePage() {
  const host = document.getElementById("profile-root") || document.querySelector("main.wrap");
  if (!host) return;

  const params = new URLSearchParams(window.location.search);
  const username = params.get("user") || "";

  if (!username) {
    host.innerHTML = `<section class="panel"><div class="muted-block">No user specified. Add <code>?user=username</code> to the URL.</div></section>`;
    return;
  }

  host.innerHTML = `<div class="muted-block" style="margin:16px;">Loading profile…</div>`;

  try {
    const data = await apiGetPublicProfile(username);
    const char = data.character;

    host.innerHTML = `
      <div class="bbc-masthead"><div class="bbc-title">Public Profile</div></div>

      <section class="panel">
        <h2 style="margin-top:0;">${esc(data.username)}</h2>

        ${char ? `
          <section class="panel" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-top:12px;">
            <article class="tile">
              <h3 style="margin-top:0;">Character</h3>
              <div style="display:flex;gap:12px;align-items:center;">
                ${char.avatar
                  ? `<img src="${esc(char.avatar)}" alt="${esc(char.name)}" style="width:80px;height:80px;object-fit:cover;border-radius:10px;border:1px solid #ddd;">`
                  : `<div class="muted-block" style="width:80px;height:80px;padding:0;display:grid;place-items:center;">👤</div>`}
                <div>
                  <div><b>${esc(char.name)}</b></div>
                  <div class="muted">${esc(char.party || "")}</div>
                  <div class="muted">${esc(char.constituency || "")}</div>
                </div>
              </div>
            </article>

            ${char.bio ? `
              <article class="tile">
                <h3 style="margin-top:0;">Biography</h3>
                <p style="white-space:pre-wrap;margin:0;">${esc(char.bio)}</p>
              </article>
            ` : ""}
          </section>
        ` : `
          <p class="muted">This user has no active character.</p>
        `}

        <div style="margin-top:12px;">
          <a class="btn" href="team.html">Back to A Team</a>
        </div>
      </section>
    `;
  } catch (err) {
    host.innerHTML = `<section class="panel"><div class="muted-block">Could not load profile: ${esc(err.message)}</div></section>`;
  }
}
