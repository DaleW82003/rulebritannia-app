import { esc, affiliationBadge } from "../ui.js";
import { isAdmin, isMod, canAdminOrMod } from "../permissions.js";
import { handleApiError } from "../errors.js";
import { apiCreateOnlinePost, apiGetOnlinePosts, apiDeleteOnlinePost, apiUpdateOnlinePost, apiUpdateOnlineSettings, apiCreateNewsStory } from "../api.js";
import { formatSimMonthYear, getSimDate } from "../clock.js";
import { getCharacterContext } from "../engines/core-engine.js";
import { isLoggedIn, nowMs } from "../core.js";

const CHANNELS = {
  webPost: "Post to the Web",
  webHistory: "Web History",
  facebook: "Facebook",
  twitter: "Twitter"
};

function canModerate(data) {
  return canAdminOrMod(data);
}


function simIndex(data) {
  const gs = data?.gameState || {};
  const current = getSimDate(gs);
  return current.year * 12 + current.monthIndex; // monthIndex is 0-based (Jan=0)
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
  const char = getCharacterContext(data);
  const hasActiveChar = mod || Boolean(char?.name);
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
        ${!hasActiveChar
          ? `<div class="muted-block">You must have an active character to post online. <a href="user.html">Create or activate a character</a> first.</div>`
          : `<form id="online-web-form">
          <label class="label" for="www-title">Title</label>
          <input id="www-title" name="title" class="input" required>

          ${mod ? `<label class="label" for="www-author">Author</label>
          <input id="www-author" name="author" class="input" value="${esc(char?.display_name || char?.name || "Character")}">` : `<input type="hidden" name="author" value="${esc(char?.display_name || char?.name || "Character")}">`}

          <label class="label" for="www-image">Image URL (optional)</label>
          <input id="www-image" name="imageUrl" class="input" placeholder="https://...">

          <label class="label" for="www-body">Post</label>
          <textarea id="www-body" name="body" class="input" rows="7" required></textarea>
          <button class="btn" type="submit">Publish</button>
        </form>`}
      </section>
    ` : ""}

    ${state.view === "webHistory" && platformEnabled(data, "webHistory") ? `
      <section class="panel" style="margin-bottom:12px;">
        <h2 style="margin-top:0;">Web History</h2>
        ${webPosts.length ? webPosts.map((p) => `
          <article class="tile" style="margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;"><b>${esc(p.title)}</b><span class="muted">${esc(p.createdAt || "")}</span></div>
            <div class="muted">By ${esc(p.author)}${affiliationBadge({ party: p.party, isModAffiliation: !!p.isNpc }) ? ` ${affiliationBadge({ party: p.party, isModAffiliation: !!p.isNpc })}` : ""}</div>
            ${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="web post image" style="max-width:100%;border-radius:8px;margin-top:8px;">` : ""}
            ${state.editPostId === String(p.id) ? `
              <form data-action="save-edit-web" data-id="${esc(String(p.id))}" style="margin-top:8px;">
                <input class="input" name="body" required value="${esc(p.body)}" style="margin-bottom:4px;">
                <div style="display:flex;gap:6px;"><button class="btn" type="submit">Save</button><button class="btn" type="button" data-action="cancel-edit">Cancel</button></div>
              </form>
            ` : `<div style="white-space:pre-wrap;margin-top:8px;">${esc(p.body)}</div>`}
            ${mod ? `<div style="margin-top:6px;display:flex;gap:6px;">
              <button class="btn" type="button" data-action="edit-web" data-id="${esc(String(p.id))}">Edit</button>
              <button class="btn danger" type="button" data-action="delete-web" data-id="${esc(String(p.id))}">Delete</button>
              <button class="btn small" type="button" data-action="news-from-post" data-post-type="web" data-id="${esc(String(p.id))}" title="Create a flavour news story from this post">📰 Create News Story</button>
            </div>` : ""}
          </article>
        `).join("") : `<div class="muted">No web posts yet.</div>`}
      </section>
    ` : ""}

    ${state.view === "facebook" && platformEnabled(data, "facebook") ? `
      <section class="panel" style="margin-bottom:12px;">
        <h2 style="margin-top:0;">Facebook</h2>
        ${!hasActiveChar
          ? `<div class="muted-block">You must have an active character to post on Facebook. <a href="user.html">Create or activate a character</a> first.</div>`
          : `<form id="online-facebook-form" style="margin-bottom:10px;">
          ${mod ? `<label class="label" for="fb-name">Display Name</label>
          <input id="fb-name" name="displayName" class="input" value="${esc(char?.display_name || char?.name || "Character")}">` : `<input type="hidden" name="displayName" value="${esc(char?.display_name || char?.name || "Character")}">`}
          <label class="label" for="fb-avatar">Avatar URL (optional)</label>
          <input id="fb-avatar" name="avatar" class="input" placeholder="https://..." value="${esc(char?.avatar || "")}">
          <label class="label" for="fb-body">Post</label>
          <textarea id="fb-body" name="body" class="input" rows="4" required></textarea>
          <button class="btn" type="submit">Post to Facebook</button>
        </form>`}

        ${fbPosts.length ? fbPosts.map((p) => `
          <article class="tile" style="margin-bottom:8px;display:flex;gap:10px;">
            <img src="${esc(avatarFor(p.displayName, p.avatar))}" width="42" height="42" style="border-radius:999px;object-fit:cover;" alt="avatar">
            <div style="flex:1;">
              <div><b>${esc(p.displayName)}</b>${affiliationBadge({ party: p.party, isModAffiliation: !!p.isNpc }) ? ` ${affiliationBadge({ party: p.party, isModAffiliation: !!p.isNpc })}` : ""} <span class="muted">${esc(p.createdAt || "")}</span></div>
              ${state.editPostId === String(p.id) ? `
                <form data-action="save-edit-fb" data-id="${esc(String(p.id))}" style="margin-top:4px;">
                  <textarea class="input" name="body" required rows="3" style="margin-bottom:4px;">${esc(p.body)}</textarea>
                  <div style="display:flex;gap:6px;"><button class="btn" type="submit">Save</button><button class="btn" type="button" data-action="cancel-edit">Cancel</button></div>
                </form>
              ` : `<div style="white-space:pre-wrap;">${esc(p.body)}</div>`}
              ${mod ? `<div style="margin-top:4px;display:flex;gap:6px;">
                <button class="btn" type="button" data-action="edit-fb" data-id="${esc(String(p.id))}">Edit</button>
                <button class="btn danger" type="button" data-action="delete-fb" data-id="${esc(String(p.id))}">Delete</button>
                <button class="btn small" type="button" data-action="news-from-post" data-post-type="facebook" data-id="${esc(String(p.id))}" title="Create a flavour news story from this post">📰 Create News Story</button>
              </div>` : ""}
            </div>
          </article>
        `).join("") : `<div class="muted">No Facebook posts yet.</div>`}
      </section>
    ` : ""}

    ${state.view === "twitter" && platformEnabled(data, "twitter") ? `
      <section class="panel" style="margin-bottom:12px;">
        <h2 style="margin-top:0;">Twitter</h2>
        ${!hasActiveChar
          ? `<div class="muted-block">You must have an active character to post on Twitter. <a href="user.html">Create or activate a character</a> first.</div>`
          : `<form id="online-twitter-form" style="margin-bottom:10px;">
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
        </form>`}

        ${twPosts.length ? twPosts.map((p) => `
          <article class="tile" style="margin-bottom:8px;">
            <div><b>${esc(p.handle)}</b> <span class="muted">${esc(p.createdAt || "")}</span></div>
            <div>${esc(p.displayName)}${affiliationBadge({ party: p.party, isModAffiliation: !!p.isNpc }) ? ` ${affiliationBadge({ party: p.party, isModAffiliation: !!p.isNpc })}` : ""}</div>
            ${state.editPostId === String(p.id) ? `
              <form data-action="save-edit-tw" data-id="${esc(String(p.id))}" style="margin-top:4px;">
                <textarea class="input" name="body" required rows="3" maxlength="${limit}" style="margin-bottom:4px;">${esc(p.body)}</textarea>
                <div style="display:flex;gap:6px;"><button class="btn" type="submit">Save</button><button class="btn" type="button" data-action="cancel-edit">Cancel</button></div>
              </form>
            ` : `<div style="white-space:pre-wrap;">${esc(p.body)}</div>`}
            ${mod ? `<div style="margin-top:4px;display:flex;gap:6px;">
              <button class="btn" type="button" data-action="edit-tw" data-id="${esc(String(p.id))}">Edit</button>
              <button class="btn danger" type="button" data-action="delete-tw" data-id="${esc(String(p.id))}">Delete</button>
              <button class="btn small" type="button" data-action="news-from-post" data-post-type="twitter" data-id="${esc(String(p.id))}" title="Create a flavour news story from this post">📰 Create News Story</button>
            </div>` : ""}
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
      apiUpdateOnlineSettings(data.online.settings).catch((err) => console.error("[online] settings failed:", err)); // UI_ONLY_OK: autosave of online settings; no simulation-outcome consequence
      if (!data.online.settings[key] && state.view === key) state.view = null;
      render(data, state);
    });
  });

  root.querySelector("#online-web-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const title = String(fd.get("title") || "").trim();
    const body = String(fd.get("body") || "").trim();
    const imageUrl = String(fd.get("imageUrl") || "").trim();
    const author = String(fd.get("author") || "").trim() || (char?.display_name || char?.name || "Character");
    if (!title || !body) return;

    const post = {
      id: `web-${Date.now()}`,
      title,
      body,
      imageUrl,
      author: mod ? author : (char?.display_name || char?.name || author),
      party: char?.party || "",
      isNpc: false,
      createdAt: formatSimMonthYear(data.gameState),
      createdTs: Date.now()
    };
    const submitBtn = e.currentTarget.querySelector("[type='submit']");
    if (submitBtn) submitBtn.disabled = true;
    let persisted = null;
    try {
      const resp = await apiCreateOnlinePost("web", post);
      persisted = resp?.post || null;
    } catch (err) {
      handleApiError(err, "Post to web");
      if (submitBtn) submitBtn.disabled = false;
      return;
    }
    data.online.webPosts.push(persisted || post);
    state.view = "webHistory";
    render(data, state);
  });

  root.querySelector("#online-facebook-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = String(fd.get("body") || "").trim();
    if (!body) return;
    const displayName = String(fd.get("displayName") || "").trim() || (char?.display_name || char?.name || "Character");

    const post = {
      id: `fb-${Date.now()}`,
      displayName: mod ? displayName : (char?.display_name || char?.name || displayName),
      avatar: String(fd.get("avatar") || "").trim() || String(char?.avatar || "").trim(),
      party: char?.party || "",
      isNpc: false,
      body,
      createdAt: formatSimMonthYear(data.gameState),
      createdTs: Date.now()
    };
    const submitBtn = e.currentTarget.querySelector("[type='submit']");
    if (submitBtn) submitBtn.disabled = true;
    let persisted = null;
    try {
      const resp = await apiCreateOnlinePost("facebook", post);
      persisted = resp?.post || null;
    } catch (err) {
      handleApiError(err, "Post to Facebook");
      if (submitBtn) submitBtn.disabled = false;
      return;
    }
    data.online.facebookPosts.push(persisted || post);
    render(data, state);
  });

  root.querySelector("#online-twitter-form")?.addEventListener("submit", async (e) => {
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

    const post = {
      id: `tw-${Date.now()}`,
      handle,
      displayName,
      party: (mod && String(fd.get("handle") || "").trim() === "@npc") ? "" : (char?.party || ""),
      isNpc: mod && String(fd.get("handle") || "").trim() === "@npc",
      body,
      createdAt: formatSimMonthYear(data.gameState),
      createdTs: Date.now()
    };
    const submitBtn = e.currentTarget.querySelector("[type='submit']");
    if (submitBtn) submitBtn.disabled = true;
    let persisted = null;
    try {
      const resp = await apiCreateOnlinePost("twitter", post);
      persisted = resp?.post || null;
    } catch (err) {
      handleApiError(err, "Post to Twitter");
      if (submitBtn) submitBtn.disabled = false;
      return;
    }
    data.online.twitterPosts.push(persisted || post);
    render(data, state);
  });

  root.querySelectorAll("[data-action='delete-web']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!mod) return;
      const id = String(btn.getAttribute("data-id") || "");
      data.online.webPosts = data.online.webPosts.filter((p) => String(p.id) !== id);
      render(data, state);
      apiDeleteOnlinePost(id).catch((err) => console.error("[online] delete-web failed:", err)); // UI_ONLY_OK: player content deletion; no simulation-outcome consequence
    });
  });

  root.querySelectorAll("[data-action='delete-fb']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!mod) return;
      const id = String(btn.getAttribute("data-id") || "");
      data.online.facebookPosts = data.online.facebookPosts.filter((p) => String(p.id) !== id);
      render(data, state);
      apiDeleteOnlinePost(id).catch((err) => console.error("[online] delete-fb failed:", err)); // UI_ONLY_OK: player content deletion; no simulation-outcome consequence
    });
  });

  root.querySelectorAll("[data-action='delete-tw']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!mod) return;
      const id = String(btn.getAttribute("data-id") || "");
      data.online.twitterPosts = data.online.twitterPosts.filter((p) => String(p.id) !== id);
      render(data, state);
      apiDeleteOnlinePost(id).catch((err) => console.error("[online] delete-tw failed:", err)); // UI_ONLY_OK: player content deletion; no simulation-outcome consequence
    });
  });

  // Edit buttons — enter edit mode
  root.querySelectorAll("[data-action='edit-web']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!mod) return;
      state.editPostId = String(btn.getAttribute("data-id") || "");
      render(data, state);
    });
  });
  root.querySelectorAll("[data-action='edit-fb']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!mod) return;
      state.editPostId = String(btn.getAttribute("data-id") || "");
      render(data, state);
    });
  });
  root.querySelectorAll("[data-action='edit-tw']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!mod) return;
      state.editPostId = String(btn.getAttribute("data-id") || "");
      render(data, state);
    });
  });
  root.querySelectorAll("[data-action='cancel-edit']").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.editPostId = null;
      render(data, state);
    });
  });

  // Save edit forms
  root.querySelectorAll("form[data-action='save-edit-web']").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!mod) return;
      const id = String(form.getAttribute("data-id") || "");
      const post = data.online.webPosts.find((p) => String(p.id) === id);
      if (!post) return;
      const fd = new FormData(form);
      post.body = String(fd.get("body") || "").trim() || post.body;
      state.editPostId = null;
      apiUpdateOnlinePost(id, { body: post.body }).catch(err => console.error("[online] edit failed:", err)); // UI_ONLY_OK: player content edit; no simulation-outcome consequence
      render(data, state);
    });
  });
  root.querySelectorAll("form[data-action='save-edit-fb']").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!mod) return;
      const id = String(form.getAttribute("data-id") || "");
      const post = data.online.facebookPosts.find((p) => String(p.id) === id);
      if (!post) return;
      const fd = new FormData(form);
      post.body = String(fd.get("body") || "").trim() || post.body;
      state.editPostId = null;
      apiUpdateOnlinePost(id, { body: post.body }).catch(err => console.error("[online] edit failed:", err)); // UI_ONLY_OK: player content edit; no simulation-outcome consequence
      render(data, state);
    });
  });
  root.querySelectorAll("form[data-action='save-edit-tw']").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!mod) return;
      const id = String(form.getAttribute("data-id") || "");
      const post = data.online.twitterPosts.find((p) => String(p.id) === id);
      if (!post) return;
      const fd = new FormData(form);
      post.body = String(fd.get("body") || "").trim() || post.body;
      state.editPostId = null;
      apiUpdateOnlinePost(id, { body: post.body }).catch(err => console.error("[online] edit failed:", err)); // UI_ONLY_OK: player content edit; no simulation-outcome consequence
      render(data, state);
    });
  });

  // "Create News Story" from post (mods only)
  root.querySelectorAll("[data-action='news-from-post']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!mod) return;
      const postType = btn.getAttribute("data-post-type");
      const id = String(btn.getAttribute("data-id") || "");
      let prefillHeadline = "";
      let prefillText = "";
      if (postType === "web") {
        const post = data.online.webPosts.find((p) => String(p.id) === id);
        if (!post) return;
        prefillHeadline = `Social media row as ${post.author || "user"} posts online`;
        prefillText = `${post.author || "A user"} published a post online${post.title ? ` titled "${post.title}"` : ""}:\n\n"${post.body || ""}"`;
      } else if (postType === "facebook") {
        const post = data.online.facebookPosts.find((p) => String(p.id) === id);
        if (!post) return;
        prefillHeadline = `Social media row as ${post.displayName || "user"} posts on Facebook`;
        prefillText = `${post.displayName || "A user"} posted on Facebook:\n\n"${post.body || ""}"`;
      } else if (postType === "twitter") {
        const post = data.online.twitterPosts.find((p) => String(p.id) === id);
        if (!post) return;
        prefillHeadline = `Social media row as ${post.handle || "user"} posts on Twitter`;
        const attribution = post.displayName ? `${post.handle || "A user"} (${post.displayName})` : (post.handle || "A user");
        prefillText = `${attribution} tweeted:\n\n"${post.body || ""}"`;
      }
      openNewsFromPostModal(data, prefillHeadline, prefillText);
    });
  });
}

/**
 * Injects (once) and opens a modal panel for creating a flavour news story
 * from an online post. Pre-fills headline and text; mod can edit before publishing.
 */
function openNewsFromPostModal(data, prefillHeadline, prefillText) {
  let modal = document.getElementById("online-news-from-post-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "online-news-from-post-modal";
    modal.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;z-index:9999;";
    modal.innerHTML = `
      <section class="panel" style="max-width:580px;width:100%;max-height:92vh;overflow-y:auto;">
        <h2 style="margin-top:0;">📰 Create Flavour News Story</h2>
        <div class="muted-block" style="margin-bottom:10px;">Creates an <em>Other News (Flavour)</em> story on the news page. Edit the pre-filled text as needed before publishing.</div>
        <form id="online-news-from-post-form" class="form-grid">
          <label for="nfp-headline">Headline</label>
          <input id="nfp-headline" type="text" maxlength="160" required>

          <label for="nfp-breaking">Breaking News?</label>
          <div><input id="nfp-breaking" type="checkbox" style="width:auto;"> <span class="small">Include in BREAKING ticker</span></div>

          <label for="nfp-image">Image URL (optional)</label>
          <input id="nfp-image" type="url" placeholder="https://...">

          <label for="nfp-text">Article text</label>
          <textarea id="nfp-text" rows="6" required></textarea>

          <div></div>
          <div class="tile-bottom" style="padding-top:0;margin-top:0;display:flex;gap:8px;align-items:center;">
            <button class="btn primary" type="submit">Publish to News</button>
            <button class="btn" type="button" id="nfp-cancel">Cancel</button>
            <span id="nfp-status" style="font-size:.85em;color:#555;"></span>
          </div>
        </form>
      </section>
    `;
    document.body.appendChild(modal);

    modal.addEventListener("click", (ev) => {
      if (ev.target === modal) modal.style.display = "none";
    });
    document.getElementById("nfp-cancel")?.addEventListener("click", () => {
      modal.style.display = "none";
    });

    document.getElementById("online-news-from-post-form")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const form = ev.currentTarget;
      const headline = document.getElementById("nfp-headline")?.value?.trim();
      const text = document.getElementById("nfp-text")?.value?.trim();
      const imageUrl = document.getElementById("nfp-image")?.value?.trim();
      const isBreaking = Boolean(document.getElementById("nfp-breaking")?.checked);
      if (!headline || !text) return;
      const submitBtn = ev.currentTarget.querySelector("[type='submit']");
      const statusEl = document.getElementById("nfp-status");
      if (submitBtn) submitBtn.disabled = true;
      if (statusEl) statusEl.textContent = "Publishing…";
      const story = {
        id: `news-${Math.random().toString(36).slice(2, 10)}`,
        createdAt: nowMs(),
        simDate: formatSimMonthYear(data.gameState),
        isBreaking,
        category: "Other",
        headline,
        imageUrl: imageUrl || "",
        text,
        flavour: true,
      };
      try {
        await apiCreateNewsStory(story);
        if (statusEl) statusEl.textContent = "✓ Published!";
        if (form instanceof HTMLFormElement) form.reset();
        setTimeout(() => { modal.style.display = "none"; if (statusEl) statusEl.textContent = ""; }, 1500);
      } catch (err) {
        if (statusEl) statusEl.textContent = err.message || "Failed to publish.";
        console.error("[online] news-from-post failed:", err);
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  // Pre-fill with this post's data
  const headlineEl = document.getElementById("nfp-headline");
  const textEl = document.getElementById("nfp-text");
  const imageEl = document.getElementById("nfp-image");
  const breakingEl = document.getElementById("nfp-breaking");
  if (headlineEl) headlineEl.value = prefillHeadline;
  if (textEl) textEl.value = prefillText;
  if (imageEl) imageEl.value = "";
  if (breakingEl) breakingEl.checked = false;
  const statusEl = document.getElementById("nfp-status");
  if (statusEl) statusEl.textContent = "";
  modal.style.display = "flex";
}

export async function initOnlinePage(data) {
  ensureOnline(data);
  if (isLoggedIn()) {
    try {
      const r = await apiGetOnlinePosts();
      if (r?.posts?.length) {
        const seenWeb = new Set(data.online.webPosts.map((x) => String(x.id)));
        const seenFb = new Set(data.online.facebookPosts.map((x) => String(x.id)));
        const seenTw = new Set(data.online.twitterPosts.map((x) => String(x.id)));
        for (const post of r.posts) {
          const pt = post._post_type || post.post_type || "web";
          if (pt === "web" && !seenWeb.has(String(post.id))) data.online.webPosts.push(post);
          else if (pt === "facebook" && !seenFb.has(String(post.id))) data.online.facebookPosts.push(post);
          else if (pt === "twitter" && !seenTw.has(String(post.id))) data.online.twitterPosts.push(post);
        }
      }
    } catch (err) {
      console.error("[online] DB load failed:", err);
    }
  }
  render(data, { view: null, editPostId: null });
}
