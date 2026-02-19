import { saveData } from "../core.js";
import { esc } from "../ui.js";
import { isMod, isSpeaker } from "../permissions.js";

const WESTMINSTER_PROMPTS = [
  "Whispers spread that a reshuffle memo is already drafted.",
  "Tonight's bar talk: who controls next week's parliamentary timetable?",
  "Rumour says whips are counting heads for a late division.",
  "A backbench group is briefing journalists about a surprise amendment.",
  "Speculation grows about a difficult PMQ exchange tomorrow."
];

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

function avatarFor(name, avatar) {
  if (avatar) return avatar;
  const initial = (name || "?").trim().slice(0, 1).toUpperCase() || "?";
  return `https://dummyimage.com/64x64/112233/ffffff&text=${encodeURIComponent(initial)}`;
}

function render(data, state) {
  const root = document.getElementById("redlion-root");
  if (!root) return;

  ensureRedLion(data);
  const char = getCharacter(data);
  const allowBarkeep = canPostBarkeep(data);
  const posts = data.redLion.posts;

  root.innerHTML = `
    <section class="tile" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Welcome to the Red Lion</h2>
      <p>Everything posted here is <b>in-character bar talk</b>. Write as if spoken aloud in Westminster’s favourite political pub.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <button class="btn" type="button" id="rl-generate-westminster">AI Generate Westminster Bar Prompt</button>
        <span class="muted" id="rl-generated-line">${esc(state.generatedLine || "")}</span>
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
              ${allowBarkeep ? `<option value="barkeep">Barkeep</option>` : ""}
            </select>
          </div>
          <div>
            <label class="label" for="redlion-avatar">Avatar URL (optional)</label>
            <input id="redlion-avatar" name="avatar" class="input" placeholder="https://...">
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
                <div><b>${esc(p.displayName)}</b>${p.asBarkeep ? ` <span class="muted">(Barkeep)</span>` : ""}</div>
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

  root.querySelector("#rl-generate-westminster")?.addEventListener("click", () => {
    state.generatedLine = WESTMINSTER_PROMPTS[Math.floor(Math.random() * WESTMINSTER_PROMPTS.length)];
    render(data, state);
  });

  root.querySelector("#redlion-post-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = String(fd.get("body") || "").trim();
    const speaker = String(fd.get("speaker") || "character");
    const avatar = String(fd.get("avatar") || "").trim();
    if (!body) return;

    const asBarkeep = speaker === "barkeep" && allowBarkeep;
    const displayName = asBarkeep ? "Barkeep" : (char?.name || "Character");

    const post = {
      id: `rl-${Date.now()}-${data.redLion.nextId}`,
      displayName,
      asBarkeep,
      avatar: asBarkeep ? "" : avatar,
      body,
      createdAt: new Date().toLocaleString("en-GB")
    };

    data.redLion.posts.push(post);
    data.redLion.nextId += 1;
    saveData(data);
    render(data, state);
  });

  root.querySelectorAll("[data-action='delete']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!(allowBarkeep || isSpeaker(data))) return;
      const id = btn.getAttribute("data-id");
      data.redLion.posts = data.redLion.posts.filter((p) => p.id !== id);
      saveData(data);
      render(data, state);
    });
  });
}

export function initRedLionPage(data) {
  ensureRedLion(data);
  const state = { generatedLine: "" };
  render(data, state);
}
