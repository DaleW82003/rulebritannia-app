import { saveState } from "../core.js";
import { esc } from "../ui.js";
import { isAdmin, isMod, canAdminOrMod } from "../permissions.js";

const CHANNELS = {
  webPost: "Post to the Web",
  webHistory: "Web History",
  facebook: "Facebook",
  twitter: "Twitter"
};

function canModerate(data) {
  return canAdminOrMod(data);
}

function getCharacter(data) {
  return data?.currentCharacter || data?.currentPlayer || {};
}

function simIndex(data) {
  const gs = data?.gameState || {};
  return (Number(gs.startSimYear || 1997) * 12) + (Number(gs.startSimMonth || 8) - 1);
}

function twitterLimit(data) {
  const year = Math.floor(simIndex(data) / 12);
  return year >= 2017 ? 280 : 140;
}

function avatarFor(name, avatar) {
  if (avatar) return avatar;
  const i = (name || "?").trim().slice(0, 1).toUpperCase() || "?";
  return `https://dummyimage.com/48x48/1f3b60/ffffff&text=${encodeURIComponent(i)}`;
}

function preferredTwitterHandle(char) {
  const custom = String(char?.twitterHandle || "").trim().replace(/^@+/, "");
  if (custom) return `@${custom.toLowerCase()}`;
  const fallback = String(char?.name || "character").toLowerCase().replace(/[^a-z0-9]/g, "");
  return `@${fallback || "character"}`;
}

function ensureOnline(data) {
  data.online ??= {
    settings: { webPost: true, webHistory: true, facebook: true, twitter: true },
    webPosts: [],
    facebookPosts: [],
    twitterPosts: [],
    nextId: 1
  };
  data.online.settings ??= { webPost: true, webHistory: true, facebook: true, twitter: true };
  data.online.webPosts ??= [];
  data.online.facebookPosts ??= [];
  data.online.twitterPosts ??= [];
  data.online.nextId = Number(data.online.nextId || 1);
}

function platformEnabled(data, key) {
  return !!data.online.settings?.[key];
}

function render(data, state) {
  const root = document.getElementById("online-root");
  if (!root) return;
  ensureOnline(data);

  const mod = canModerate(data);
  const char = getCharacter(data);
  const limit = twitterLimit(data);

  const webPosts = data.online.webPosts.slice().sort((a, b) => Number(b.createdTs || 0) - Number(a.createdTs || 0));
  const fbPosts = data.online.facebookPosts.slice().sort((a, b) => Number(a.createdTs || 0) - Number(b.createdTs || 0));
  const twPosts = data.online.twitterPosts.slice().sort((a, b) => Number(a.createdTs || 0) - Number(b.createdTs || 0));

  const renderTile = (key, description) => `
    <article class="tile">
      <h3 style="margin-top:0;">${esc(CHANNELS[key])}</h3>
      <p>${description}</p>
      ${platformEnabled(data, key)
        ? `<button class="btn" type="button" data-action="open" data-view="${esc(key)}">Open</button>`
        : `<div class="muted"><b>Does Not Exist…Yet</b></div>`}
      ${mod ? `<div style="margin-top:8px;"><button class="btn" type="button" data-action="toggle-platform" data-key="${esc(key)}">${platformEnabled(data, key) ? "Deactivate" : "Activate"}</button></div>` : ""}
    </article>
  `;

  root.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Online</div></div>

    <section class="panel" style="margin-bottom:12px;">
      <div style="display:grid;grid-template-columns:repeat(2,minmax(280px,1fr));gap:12px;">
        ${renderTile("webPost", "Create blogs/homepages and other web posts.")}
        ${renderTile("webHistory", "Archive of web posts, chronological.")}
      </div>
    </section>

    <section class="panel" style="margin-bottom:12px;">
      <div style="display:grid;grid-template-columns:repeat(2,minmax(280px,1fr));gap:12px;">
        ${renderTile("facebook", "Post with your character name/avatar in chronological feed.")}
        ${renderTile("twitter", `Post with handle in chronological feed. Character limit: ${limit}.`)}
      </div>
    </section>

    ${state.view === "webPost" && platformEnabled(data, "webPost") ? `
      <section class="panel" style="margin-bottom:12px;">
        <h2 style="margin-top:0;">Post to the World Wide Web</h2>
        <form id="online-web-form">
          <label class="label" for="www-title">Title</label>
          <input id="www-title" name="title" class="input" required>

          <label class="label" for="www-author">Author</label>
          <input id="www-author" name="author" class="input" value="${esc(char?.name || "Character")}" ${mod ? "" : "readonly"}>

          <label class="label" for="www-image">Image URL (optional)</label>
          <input id="www-image" name="imageUrl" class="input" placeholder="https://...">

          <label class="label" for="www-body">Post</label>
          <textarea id="www-body" name="body" class="input" rows="7" required></textarea>
          <button class="btn" type="submit">Publish</button>
        </form>
      </section>
    ` : ""}

    ${state.view === "webHistory" && platformEnabled(data, "webHistory") ? `
      <section class="panel" style="margin-bottom:12px;">
        <h2 style="margin-top:0;">Web History</h2>
        ${webPosts.length ? webPosts.map((p) => `
          <article class="tile" style="margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;"><b>${esc(p.title)}</b><span class="muted">${esc(p.createdAt || "")}</span></div>
            <div class="muted">By ${esc(p.author)}</div>
            ${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="web post image" style="max-width:100%;border-radius:8px;margin-top:8px;">` : ""}
            <div style="white-space:pre-wrap;margin-top:8px;">${esc(p.body)}</div>
            ${mod ? `<button class="btn" type="button" data-action="delete-web" data-id="${esc(String(p.id))}">Delete</button>` : ""}
          </article>
        `).join("") : `<div class="muted">No web posts yet.</div>`}
      </section>
    ` : ""}

    ${state.view === "facebook" && platformEnabled(data, "facebook") ? `
      <section class="panel" style="margin-bottom:12px;">
        <h2 style="margin-top:0;">Facebook</h2>
        <form id="online-facebook-form" style="margin-bottom:10px;">
          <label class="label" for="fb-name">Display Name</label>
          <input id="fb-name" name="displayName" class="input" value="${esc(char?.name || "Character")}" ${mod ? "" : "readonly"}>
          <label class="label" for="fb-avatar">Avatar URL (optional)</label>
          <input id="fb-avatar" name="avatar" class="input" placeholder="https://...">
          <label class="label" for="fb-body">Post</label>
          <textarea id="fb-body" name="body" class="input" rows="4" required></textarea>
          <button class="btn" type="submit">Post to Facebook</button>
        </form>

        ${fbPosts.length ? fbPosts.map((p) => `
          <article class="tile" style="margin-bottom:8px;display:flex;gap:10px;">
            <img src="${esc(avatarFor(p.displayName, p.avatar))}" width="42" height="42" style="border-radius:999px;object-fit:cover;" alt="avatar">
            <div style="flex:1;">
              <div><b>${esc(p.displayName)}</b> <span class="muted">${esc(p.createdAt || "")}</span></div>
              <div style="white-space:pre-wrap;">${esc(p.body)}</div>
              ${mod ? `<button class="btn" type="button" data-action="delete-fb" data-id="${esc(String(p.id))}">Delete</button>` : ""}
            </div>
          </article>
        `).join("") : `<div class="muted">No Facebook posts yet.</div>`}
      </section>
    ` : ""}

    ${state.view === "twitter" && platformEnabled(data, "twitter") ? `
      <section class="panel" style="margin-bottom:12px;">
        <h2 style="margin-top:0;">Twitter</h2>
        <form id="online-twitter-form" style="margin-bottom:10px;">
          <label class="label" for="tw-handle">Handle</label>
          <select id="tw-handle" name="handle" class="input">
            <option value="${esc(preferredTwitterHandle(char))}">${esc(preferredTwitterHandle(char))}</option>
            ${(String(char?.role || "").includes("leader") || char?.office === "prime-minister") && char?.party ? `<option value="@${esc(char.party.replace(/\s+/g, ""))}">@${esc(char.party.replace(/\s+/g, ""))}</option>` : ""}
            ${mod ? `<option value="@npc">@npc (custom below)</option>` : ""}
          </select>
          ${mod ? `<label class="label" for="tw-custom">Custom handle (mods only)</label><input id="tw-custom" name="customHandle" class="input" placeholder="@DowningStreetPress"><label class="label" for="tw-display-custom">NPC display name (mods only)</label><input id="tw-display-custom" name="customDisplayName" class="input" placeholder="Civil Service Spokesperson">` : ""}
          <label class="label" for="tw-body">Tweet (${limit} chars)</label>
          <textarea id="tw-body" name="body" class="input" rows="3" maxlength="${limit}" required></textarea>
          <button class="btn" type="submit">Tweet</button>
        </form>

        ${twPosts.length ? twPosts.map((p) => `
          <article class="tile" style="margin-bottom:8px;">
            <div><b>${esc(p.handle)}</b> <span class="muted">${esc(p.createdAt || "")}</span></div>
            <div>${esc(p.displayName)}</div>
            <div style="white-space:pre-wrap;">${esc(p.body)}</div>
            ${mod ? `<button class="btn" type="button" data-action="delete-tw" data-id="${esc(String(p.id))}">Delete</button>` : ""}
          </article>
        `).join("") : `<div class="muted">No tweets yet.</div>`}
      </section>
    ` : ""}
  `;

  root.querySelectorAll("[data-action='open']").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.view = btn.getAttribute("data-view") || null;
      render(data, state);
    });
  });

  root.querySelectorAll("[data-action='toggle-platform']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!mod) return;
      const key = btn.getAttribute("data-key");
      if (!key) return;
      data.online.settings[key] = !data.online.settings[key];
      saveState(data);
      if (!data.online.settings[key] && state.view === key) state.view = null;
      render(data, state);
    });
  });

  root.querySelector("#online-web-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const title = String(fd.get("title") || "").trim();
    const body = String(fd.get("body") || "").trim();
    const imageUrl = String(fd.get("imageUrl") || "").trim();
    const author = String(fd.get("author") || "").trim() || (char?.name || "Character");
    if (!title || !body) return;

    data.online.webPosts.push({
      id: data.online.nextId++,
      title,
      body,
      imageUrl,
      author: mod ? author : (char?.name || author),
      createdAt: new Date().toLocaleString("en-GB"),
      createdTs: Date.now()
    });
    saveState(data);
    state.view = "webHistory";
    render(data, state);
  });

  root.querySelector("#online-facebook-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = String(fd.get("body") || "").trim();
    if (!body) return;
    const displayName = String(fd.get("displayName") || "").trim() || (char?.name || "Character");

    data.online.facebookPosts.push({
      id: data.online.nextId++,
      displayName: mod ? displayName : (char?.name || displayName),
      avatar: String(fd.get("avatar") || "").trim(),
      body,
      createdAt: new Date().toLocaleString("en-GB"),
      createdTs: Date.now()
    });
    saveState(data);
    render(data, state);
  });

  root.querySelector("#online-twitter-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = String(fd.get("body") || "").trim();
    if (!body || body.length > limit) return;

    let handle = String(fd.get("handle") || "").trim();
    if (mod && handle === "@npc") {
      handle = String(fd.get("customHandle") || "").trim() || "@npc";
    }
    if (!handle.startsWith("@")) handle = `@${handle}`;

    const displayName = mod && String(fd.get("handle") || "").trim() === "@npc"
      ? (String(fd.get("customDisplayName") || "").trim() || "NPC")
      : (char?.name || "Character");

    data.online.twitterPosts.push({
      id: data.online.nextId++,
      handle,
      displayName,
      body,
      createdAt: new Date().toLocaleString("en-GB"),
      createdTs: Date.now()
    });
    saveState(data);
    render(data, state);
  });

  root.querySelectorAll("[data-action='delete-web']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!mod) return;
      const id = Number(btn.getAttribute("data-id") || 0);
      data.online.webPosts = data.online.webPosts.filter((p) => p.id !== id);
      saveState(data);
      render(data, state);
    });
  });

  root.querySelectorAll("[data-action='delete-fb']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!mod) return;
      const id = Number(btn.getAttribute("data-id") || 0);
      data.online.facebookPosts = data.online.facebookPosts.filter((p) => p.id !== id);
      saveState(data);
      render(data, state);
    });
  });

  root.querySelectorAll("[data-action='delete-tw']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!mod) return;
      const id = Number(btn.getAttribute("data-id") || 0);
      data.online.twitterPosts = data.online.twitterPosts.filter((p) => p.id !== id);
      saveState(data);
      render(data, state);
    });
  });
}

export function initOnlinePage(data) {
  ensureOnline(data);
  render(data, { view: null });
}
