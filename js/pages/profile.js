import { esc } from "../ui.js";
import { apiGetPublicProfile } from "../api.js";

const FINANCIAL_BACKGROUND_LABELS = {
  1:  "1 – Poverty",
  2:  "2 – Financially Strained",
  3:  "3 – Lower Working Class",
  4:  "4 – Skilled Working / Lower Middle",
  5:  "5 – Solid Middle Class",
  6:  "6 – Upper Middle Class",
  7:  "7 – Affluent Professional",
  8:  "8 – High Net Worth Individual",
  9:  "9 – Top 5%",
  10: "10 – Top 1%",
};

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

    const finBgLabel = char?.financial_background_level != null
      ? (FINANCIAL_BACKGROUND_LABELS[char.financial_background_level] || "Unknown")
      : "Unknown";

    // Group approved affiliations by category
    const affsByCategory = {};
    if (char?.approved_affiliations?.length) {
      for (const aff of char.approved_affiliations) {
        (affsByCategory[aff.category] = affsByCategory[aff.category] || []).push(aff.name);
      }
    }
    const hasAffiliations = Object.keys(affsByCategory).length > 0;

    const mpProfileFields = char ? [
      { label: "Date of Birth",       value: char.date_of_birth },
      { label: "Education",           value: char.education },
      { label: "Career Background",   value: char.career_background },
      { label: "Family",              value: char.family },
      { label: "Constituency",        value: char.constituency },
      { label: "Party",               value: char.party },
      { label: "Year First Elected",  value: char.year_first_elected },
    ].filter((f) => f.value) : [];

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

            ${mpProfileFields.length ? `
              <article class="tile">
                <h3 style="margin-top:0;">MP Profile</h3>
                <div class="muted" style="line-height:1.8;">
                  ${mpProfileFields.map((f) => `<div><b>${esc(f.label)}:</b> ${esc(f.value)}</div>`).join("")}
                </div>
              </article>
            ` : ""}

            <article class="tile">
              <h3 style="margin-top:0;">Financial Background</h3>
              <p style="margin:0;">${esc(finBgLabel)}</p>
            </article>

            <article class="tile">
              <h3 style="margin-top:0;">Affiliations</h3>
              ${hasAffiliations
                ? Object.entries(affsByCategory).map(([cat, names]) => `
                    <div style="margin-bottom:8px;">
                      <div style="font-weight:600;font-size:.85em;text-transform:uppercase;letter-spacing:.04em;color:#555;margin-bottom:3px;">${esc(cat)}</div>
                      <ul style="margin:0;padding-left:16px;">
                        ${names.map((n) => `<li style="font-size:.93em;">${esc(n)}</li>`).join("")}
                      </ul>
                    </div>
                  `).join("")
                : `<p class="muted" style="margin:0;">No approved affiliations.</p>`}
            </article>

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
