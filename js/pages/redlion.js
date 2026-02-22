import { saveState } from "../core.js";
import { esc } from "../ui.js";
import { isMod, isSpeaker } from "../permissions.js";

function getCharacter(data) {
  return data?.currentCharacter || data?.currentPlayer || {};
}

function canPostBarkeep(data) {
  return isMod(data) || isSpeaker(data);
}

function ensureRedLion(data) {
  data.redLion ??= {};
  data.redLion.posts ??= [];
  data.redLion.nextId ??= data.redLion.posts.length + 1;
}

function resolveCharacterAvatar(data, characterName, fallbackAvatar = "") {
  if (fallbackAvatar) return fallbackAvatar;
  const fromCurrent = getCharacter(data);
  if (fromCurrent?.name === characterName && fromCurrent?.avatar) return String(fromCurrent.avatar);

  const fromPlayers = (Array.isArray(data?.players) ? data.players : []).find((p) => p?.name === characterName);
  if (fromPlayers?.avatar) return String(fromPlayers.avatar);

  const fromPersonal = data?.personal?.profiles?.[characterName]?.avatar;
  if (fromPersonal) return String(fromPersonal);

  return "";
}

function avatarFor(name, avatar) {
  if (avatar) return avatar;
  const initial = (name || "?").trim().slice(0, 1).toUpperCase() || "?";
  return `https://dummyimage.com/64x64/112233/ffffff&text=${encodeURIComponent(initial)}`;
}

function render(data) {
  const root = document.getElementById("redlion-root");
  if (!root) return;

  ensureRedLion(data);
  const char = getCharacter(data);
  const allowBarkeep = canPostBarkeep(data);
  const posts = data.redLion.posts;

  root.innerHTML = `
    <section class="tile" style="margin-bottom:12px;overflow:hidden;">
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
        <img src="assets/red-lion.svg" alt="Red Lion bar sign" width="92" height="92" style="border-radius:10px;border:1px solid #ccc;background:#fff;padding:4px;">
        <div>
          <h2 style="margin:0 0 6px;">Welcome to the Red Lion</h2>
          <p style="margin:0;">Everything posted here is <b>in-character bar talk</b>, like a Westminster bar floor conversation.</p>
        </div>
      </div>
    </section>

    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Post in the Bar</h2>
      <form id="redlion-post-form">
        <label class="label" for="redlion-body">What are you saying?</label>
        <textarea id="redlion-body" name="body" class="input" rows="4" required placeholder="Speak as your character..."></textarea>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;">
          <div>
            <label class="label" for="redlion-speaker">Post as</label>
            <select id="redlion-speaker" name="speaker" class="input">
              <option value="character">${esc(char?.name || "Your character")}</option>
              ${allowBarkeep ? `<option value="barkeep">Bar keep</option>` : ""}
            </select>
          </div>
        </div>

        <button type="submit" class="btn">Submit</button>
      </form>
    </section>

    <section class="tile">
      <h2 style="margin-top:0;">The Bar Floor</h2>
      ${posts.length ? posts.map((p) => `
        <article class="tile" style="margin-bottom:10px;">
          <div style="display:flex;gap:10px;align-items:flex-start;">
            <img src="${esc(avatarFor(p.displayName, p.avatar))}" alt="${esc(p.displayName)} avatar" width="44" height="44" style="border-radius:999px;object-fit:cover;">
            <div style="flex:1;">
              <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
                <div><b>${esc(p.displayName)}</b>${p.asBarkeep ? ` <span class="muted">(Bar keep)</span>` : ""}</div>
                <div class="muted">${esc(p.createdAt || "")}</div>
              </div>
              <p style="margin:8px 0;white-space:pre-wrap;">${esc(p.body)}</p>
              ${(allowBarkeep || isSpeaker(data)) ? `<button class="btn" type="button" data-action="delete" data-id="${esc(p.id)}">Delete</button>` : ""}
            </div>
          </div>
        </article>
      `).join("") : `<p class="muted">No bar talk yet. Start the first round.</p>`}
    </section>
  `;

  root.querySelector("#redlion-post-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = String(fd.get("body") || "").trim();
    const speaker = String(fd.get("speaker") || "character");
    if (!body) return;

    const asBarkeep = speaker === "barkeep" && allowBarkeep;
    const displayName = asBarkeep ? "Bar keep" : (char?.name || "Character");

    const post = {
      id: `rl-${Date.now()}-${data.redLion.nextId}`,
      displayName,
      asBarkeep,
      avatar: asBarkeep ? "" : resolveCharacterAvatar(data, displayName, String(char?.avatar || "")),
      body,
      createdAt: new Date().toLocaleString("en-GB")
    };

    data.redLion.posts.push(post);
    data.redLion.nextId += 1;
    saveState(data);
    render(data);
  });

  root.querySelectorAll("[data-action='delete']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!(allowBarkeep || isSpeaker(data))) return;
      const id = btn.getAttribute("data-id");
      data.redLion.posts = data.redLion.posts.filter((p) => p.id !== id);
      saveState(data);
      render(data);
    });
  });
}

export function initRedLionPage(data) {
  ensureRedLion(data);
  render(data);
}
