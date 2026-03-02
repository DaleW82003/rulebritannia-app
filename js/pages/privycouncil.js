// js/pages/privycouncil.js
import { esc } from "../ui.js";
import { canAdminOrMod } from "../permissions.js";
import { apiGetPrivyCouncil, apiAppointPrivyCouncillor, apiRemovePrivyCouncillor, apiGetCharacters, apiGetPrivyCouncilPosts, apiCreatePrivyCouncilPost, apiDeletePrivyCouncilPost } from "../api.js";

function formatSimLabel(month, year) {
  if (!month || !year) return "";
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${MONTHS[(month - 1) % 12]} ${year}`;
}

function avatarFor(name, avatar) {
  if (avatar) return avatar;
  const initial = (name || "?").trim().slice(0, 1).toUpperCase() || "?";
  return `https://dummyimage.com/48x48/112233/ffffff&text=${encodeURIComponent(initial)}`;
}

function render(members, posts, data, state, manager) {
  const host = document.getElementById("privy-council-root") || document.querySelector("main.wrap");
  if (!host) return;

  const char = data?.currentCharacter || data?.currentPlayer || {};
  const hasActiveChar = !!char?.name;
  const canPostMonarch = manager;
  const monarchGender = String(data?.adminSettings?.monarchGender || "Queen").toLowerCase() === "king" ? "King" : "Queen";
  const monarchTitle = monarchGender === "King" ? "His Majesty" : "Her Majesty";

  host.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">${monarchTitle}'s Most Honourable Privy Council</div></div>

    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">About the Privy Council</h2>
      <p class="muted" style="margin-bottom:8px;">The Privy Council is a permanent advisory body to the Sovereign. Membership is for life. Privy Councillors are addressed as <em>The Right Honourable</em>.</p>
      <p class="muted" style="margin:0;">Access to this page is restricted to Privy Councillors and staff (admin/mod/speaker).</p>
    </section>

    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Enter Council Chamber</h2>
      <p class="muted">Private Privy Council discussion space on the forum.</p>
      <a class="btn" href="https://forum.rulebritannia.org/c/privy-council/15" target="_blank" rel="noopener">Enter Council Chamber</a>
    </section>

    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Post to the Council</h2>
      ${!hasActiveChar && !canPostMonarch
        ? `<div class="muted-block">You must have an active character to post here. <a href="user.html">Create or activate a character</a> first.</div>`
        : `<form id="pc-post-form">
        <label class="label" for="pc-body">Message</label>
        <textarea id="pc-body" name="body" class="input" rows="4" required placeholder="Speak as your character or, if staff, as ${monarchTitle}…"></textarea>
        <div style="display:flex;gap:12px;margin:8px 0;flex-wrap:wrap;align-items:center;">
          <label><input type="radio" name="pcPosterChoice" value="character" checked> My Character</label>
          ${canPostMonarch ? `<label><input type="radio" name="pcPosterChoice" value="monarch"> ${monarchTitle} the Monarch</label>` : ""}
        </div>
        <button type="submit" class="btn">Post</button>
        ${state.postMessage ? `<p class="muted" style="margin-top:6px;">${esc(state.postMessage)}</p>` : ""}
      </form>`}
    </section>

    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Council Chamber</h2>
      ${posts.length ? posts.map((p) => `
        <article class="tile" style="margin-bottom:10px;">
          <div style="display:flex;gap:10px;align-items:flex-start;">
            ${p.posted_as_type === "monarch" && !p.avatar_url
              ? `<div style="width:44px;height:44px;display:grid;place-items:center;font-size:24px;flex-shrink:0;border-radius:4px;background:#b8a000;">👑</div>`
              : `<img src="${esc(avatarFor(p.posted_as, p.avatar_url))}" alt="${esc(p.posted_as)}" width="44" height="44" style="border-radius:${p.posted_as_type === "monarch" ? "4px" : "999px"};object-fit:cover;flex-shrink:0;">`}
            <div style="flex:1;">
              <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
                <div><b>${p.posted_as_type === "monarch" ? esc(monarchTitle + " the Monarch") : esc(p.posted_as)}</b>${p.posted_as_type === "monarch" ? ` <span class="muted">(Monarch)</span>` : ""}</div>
                <div class="muted">${esc(formatSimLabel(p.sim_month, p.sim_year))}</div>
              </div>
              <p style="margin:8px 0;white-space:pre-wrap;">${esc(p.body)}</p>
              ${manager ? `<button class="btn danger" type="button" data-action="delete-pc-post" data-post-id="${esc(p.id)}" style="font-size:.8em;padding:4px 10px;">Delete</button>` : ""}
            </div>
          </div>
        </article>
      `).join("") : `<p class="muted">No posts yet. The chamber awaits.</p>`}
    </section>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Members (${members.length})</h2>
      ${members.length === 0 ? `<p class="muted">No Privy Councillors have been appointed yet.</p>` : `
        <div style="display:grid;gap:8px;">
          ${members.map((m) => `
            <article class="tile" style="display:grid;grid-template-columns:48px 1fr auto;gap:10px;align-items:center;">
              <div>
                ${m.character_avatar ? `<img src="${esc(m.character_avatar)}" alt="${esc(m.character_name)}" style="width:40px;height:40px;object-fit:cover;border-radius:6px;">` : `<div class="muted-block" style="width:40px;height:40px;display:grid;place-items:center;padding:0;">👤</div>`}
              </div>
              <div>
                <div style="font-weight:700;">${esc(m.character_display_name || m.character_name)}</div>
                <div class="muted" style="font-size:0.85em;">${esc(m.character_party || "")}${m.reason ? ` — ${esc(m.reason)}` : ""}</div>
                <div class="muted" style="font-size:0.8em;">Appointed: ${new Date(m.appointed_at).toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" })}</div>
              </div>
              ${manager ? `
              <div>
                <button class="btn btn-danger" data-action="remove" data-char-id="${esc(m.character_id)}" data-char-name="${esc(m.character_name)}" style="font-size:0.8em;padding:4px 10px;">Remove</button>
              </div>` : "<div></div>"}
            </article>
          `).join("")}
        </div>
      `}
    </section>

    ${manager ? `
    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Appoint a New Privy Councillor</h2>
      <div style="display:grid;gap:8px;max-width:420px;">
        <label class="label" for="pc-char-select">Character</label>
        <select class="input" id="pc-char-select">
          <option value="">— select character —</option>
        </select>
        <label class="label" for="pc-reason">Reason (optional)</label>
        <input class="input" id="pc-reason" type="text" maxlength="500" placeholder="e.g. Party leader, PM, etc.">
        <button id="pc-appoint-btn" type="button" class="btn">Appoint</button>
        ${state.message ? `<p class="muted">${esc(state.message)}</p>` : ""}
      </div>
    </section>
    ` : (state.message ? `<p class="muted">${esc(state.message)}</p>` : "")}
  `;

  // ── Posting form ─────────────────────────────────────────────────────────────
  const postForm = host.querySelector("#pc-post-form");
  postForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(postForm);
    const body = String(fd.get("body") || "").trim();
    if (!body) return;
    const posterChoice = (postForm.querySelector('input[name="pcPosterChoice"]:checked') || {}).value || "character";
    const submitBtn = postForm.querySelector("button[type='submit']");
    if (submitBtn) submitBtn.disabled = true;
    try {
      await apiCreatePrivyCouncilPost({ body, posted_as_type: posterChoice });
      postForm.reset();
      await initPrivyCouncilPage(data, { message: state.message || "", postMessage: "Posted successfully." });
    } catch (err) {
      await initPrivyCouncilPage(data, { message: state.message || "", postMessage: `Error: ${err.message}` });
    }
  });

  // ── Delete post ──────────────────────────────────────────────────────────────
  host.querySelectorAll("[data-action='delete-pc-post']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const postId = btn.dataset.postId;
      if (!postId || !confirm("Delete this Privy Council post?")) return;
      btn.disabled = true;
      try {
        await apiDeletePrivyCouncilPost(postId);
        await initPrivyCouncilPage(data, { message: state.message || "", postMessage: "Post deleted." });
      } catch (err) {
        await initPrivyCouncilPage(data, { message: state.message || "", postMessage: `Error: ${err.message}` });
      }
    });
  });

  // Populate character select
  if (manager) {
    const select = host.querySelector("#pc-char-select");
    if (select && Array.isArray(data._dbCharacters)) {
      const alreadyIn = new Set(members.map((m) => m.character_id));
      for (const c of data._dbCharacters.filter((c) => !alreadyIn.has(c.id)).sort((a, b) => a.name.localeCompare(b.name))) {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = c.name;
        select.appendChild(opt);
      }
    }

    host.querySelector("#pc-appoint-btn")?.addEventListener("click", async () => {
      const charId = host.querySelector("#pc-char-select")?.value || "";
      const reason = host.querySelector("#pc-reason")?.value || "";
      if (!charId) return;
      try {
        await apiAppointPrivyCouncillor(charId, reason);
        await initPrivyCouncilPage(data, { message: "Appointed successfully.", postMessage: "" });
      } catch (err) {
        await initPrivyCouncilPage(data, { message: `Error: ${err.message}`, postMessage: "" });
      }
    });

    host.querySelectorAll("[data-action='remove']").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const charId   = btn.dataset.charId;
        const charName = btn.dataset.charName;
        if (!confirm(`Remove ${charName} from the Privy Council?`)) return;
        try {
          await apiRemovePrivyCouncillor(charId);
          await initPrivyCouncilPage(data, { message: "Removed from Privy Council.", postMessage: "" });
        } catch (err) {
          if (err.message?.includes("permanent qualifying office")) {
            if (confirm(`${err.message}\n\nDo you want to force-remove this member (use only for mistaken appointments)?`)) {
              try {
                await apiRemovePrivyCouncillor(charId, { force: true });
                await initPrivyCouncilPage(data, { message: "Force-removed from Privy Council.", postMessage: "" });
              } catch (err2) {
                await initPrivyCouncilPage(data, { message: `Error: ${err2.message}`, postMessage: "" });
              }
            }
          } else {
            await initPrivyCouncilPage(data, { message: `Error: ${err.message}`, postMessage: "" });
          }
        }
      });
    });
  }
}

export async function initPrivyCouncilPage(data, renderState = { message: "", postMessage: "" }) {
  const host = document.getElementById("privy-council-root") || document.querySelector("main.wrap");
  const manager = canAdminOrMod(data);

  try {
    const [pcResult, postsResult, charsResult] = await Promise.all([
      apiGetPrivyCouncil(),
      apiGetPrivyCouncilPosts(),
      manager ? apiGetCharacters({ active: "true" }) : Promise.resolve({ characters: [] }),
    ]);
    const members = pcResult.members || [];
    const posts   = postsResult.posts || [];
    if (manager) data._dbCharacters = charsResult.characters || [];
    render(members, posts, data, renderState, manager);
  } catch (err) {
    if (host) {
      host.innerHTML = `<section class="tile"><p class="muted">${err.message?.includes("Access restricted") || err.message?.includes("403") ? "This page is restricted to Privy Councillors and staff." : `Error loading Privy Council: ${esc(err.message)}`}</p></section>`;
    }
  }
}
