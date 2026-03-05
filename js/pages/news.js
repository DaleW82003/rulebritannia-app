import { formatSimMonthYear, getSimDate } from "../clock.js";
import { setHTML, esc } from "../ui.js";
import { canPostNews, canAdminOrMod } from "../permissions.js";
import { nowMs } from "../core.js";
import { apiGetNews, apiCreateNewsStory, apiUpdateNewsStory, apiDeleteNewsStory, apiGetNewsComments, apiCreateNewsComment, apiDeleteNewsComment } from "../api.js";

// 4 simulation months = 2 real weeks (2 sim months per real week per clock rules)
const LIVE_WINDOW_SIM_MONTHS = 4;

function simMonthsElapsed(gameState, fromTs, toTs) {
  const from = getSimDate(gameState, new Date(fromTs));
  const to = getSimDate(gameState, new Date(toTs));
  return (to.year - from.year) * 12 + (to.monthIndex - from.monthIndex);
}

function isLive(story, gameState, nowTs) {
  if (!story?.createdAt) return true;
  return simMonthsElapsed(gameState, story.createdAt, nowTs) < LIVE_WINDOW_SIM_MONTHS;
}

function byNewest(a, b) {
  return Number(b?.createdAt || 0) - Number(a?.createdAt || 0);
}

function byOldest(a, b) {
  return Number(a?.createdAt || 0) - Number(b?.createdAt || 0);
}

function splitNewsBuckets(stories, gameState) {
  const nowTs = nowMs();
  const live = stories.filter((s) => isLive(s, gameState, nowTs)).sort(byNewest);
  const archive = stories.filter((s) => !isLive(s, gameState, nowTs)).sort(byOldest);

  const liveMain = live.filter((s) => !s.flavour);
  const liveOther = live.filter((s) => Boolean(s.flavour));
  const liveBreaking = live.filter((s) => s.isBreaking);

  return { liveMain, liveOther, liveBreaking, archive };
}

function renderStoryCard(story, small = false, canDelete = false) {
  return `
    <article class="news-card ${small ? "small" : ""}">
      <div class="news-brand">
        <div class="news-date">${esc(story.simDate || "")}</div>
        ${story.isBreaking ? `<div class="breaking-tag">BREAKING</div>` : ""}
      </div>
      ${story.category ? `<div class="news-category">${esc(story.category)}</div>` : ""}
      <div class="news-headline">${esc(story.headline || "Untitled")}</div>
      ${story.imageUrl ? `<div class="news-imagewrap"><img src="${esc(story.imageUrl)}" alt=""></div>` : ""}
      <div class="news-text">${esc(story.text || "")}</div>
      ${canDelete ? `<div class="tile-bottom" style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
        <button class="btn" data-action="edit-story" data-id="${esc(story.id)}" type="button">Edit</button>
        <button class="btn danger" data-action="delete-story" data-id="${esc(story.id)}" type="button">Delete</button>
      </div>` : ""}
      <div class="news-comments-section" style="margin-top:8px;">
        <button class="btn small" data-action="toggle-comments" data-id="${esc(story.id)}" type="button">Comments</button>
        <div class="news-comments-panel" data-story-id="${esc(story.id)}" style="display:none;margin-top:6px;"></div>
      </div>
    </article>
  `;
}

function renderGrid(items, small = false, emptyMessage = "No stories yet.", canDelete = false) {
  if (!items.length) return `<div class="muted-block">${esc(emptyMessage)}</div>`;
  return `<div class="news-grid">${items.map((s) => renderStoryCard(s, small, canDelete)).join("")}</div>`;
}

function renderTopStory(mainItems, canDelete = false) {
  const top = mainItems[0];
  if (!top) return `<div class="muted-block">No Top Story available.</div>`;
  return renderStoryCard(top, false, canDelete);
}

function renderArchive(archiveStories, canDelete = false) {
  if (!archiveStories.length) return `<div class="muted-block">No archived stories yet.</div>`;
  return `
    <div class="small" style="margin-bottom:10px;">Archived items in chronological order (oldest first).</div>
    <div class="news-grid">${archiveStories.map((s) => renderStoryCard(s, true, canDelete)).join("")}</div>
  `;
}

function renderCommentsList(comments, currentUserId, canMod) {
  if (!comments.length) return `<div class="muted" style="font-size:.85em;">No comments yet.</div>`;
  return comments.map((c) => {
    if (c.isDeleted) {
      return `<div class="comment-item deleted" style="font-size:.85em;color:#888;padding:4px 0;border-bottom:1px solid #eee;"><em>[deleted]</em></div>`;
    }
    const canDelete = canMod || (currentUserId && c.createdBy === currentUserId);
    const date = c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "";
    return `
      <div class="comment-item" style="font-size:.85em;padding:4px 0;border-bottom:1px solid #eee;" data-comment-id="${esc(c.id)}">
        <span style="font-weight:600;">${esc(c.createdByName || "User")}</span>
        <span class="muted" style="margin-left:6px;font-size:.9em;">${esc(date)}</span>
        ${canDelete ? `<button class="btn danger small" data-action="delete-comment" data-comment-id="${esc(c.id)}" type="button" style="margin-left:8px;padding:1px 6px;font-size:.8em;">Delete</button>` : ""}
        <div style="margin-top:2px;">${esc(c.text)}</div>
      </div>
    `;
  }).join("");
}

function bindCommentToggles(data) {
  document.querySelectorAll("[data-action='toggle-comments']").forEach((btn) => {
    if (btn.dataset.commentsBound) return;
    btn.dataset.commentsBound = "1";
    btn.addEventListener("click", async () => {
      const storyId = btn.dataset.id;
      const panel = btn.closest(".news-comments-section")?.querySelector(".news-comments-panel");
      if (!panel) return;
      if (panel.style.display !== "none") {
        panel.style.display = "none";
        btn.textContent = "Comments";
        return;
      }
      panel.style.display = "";
      btn.textContent = "Hide Comments";
      if (!panel.dataset.loaded) {
        panel.innerHTML = `<div class="muted" style="font-size:.85em;">Loading…</div>`;
        try {
          const r = await apiGetNewsComments(storyId);
          panel.dataset.loaded = "1";
          panel.dataset.comments = JSON.stringify(r.comments || []);
          refreshCommentsPanel(panel, storyId, r.comments || [], data);
        } catch (err) {
          panel.innerHTML = `<div class="muted" style="font-size:.85em;">Failed to load comments.</div>`;
          console.error("[news] load comments failed:", err);
        }
      }
    });
  });
}

function refreshCommentsPanel(panel, storyId, comments, data) {
  const currentUserId = data.currentUser?.id;
  const canMod = canAdminOrMod(data);
  const countLabel = comments.filter((c) => !c.isDeleted).length;
  const toggleBtn = panel.closest(".news-comments-section")?.querySelector("[data-action='toggle-comments']");
  if (toggleBtn) toggleBtn.textContent = `Hide Comments (${countLabel})`;
  panel.innerHTML = `
    <div class="comments-list">${renderCommentsList(comments, currentUserId, canMod)}</div>
    <form class="comment-form" style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;" data-story-id="${esc(storyId)}">
      <textarea class="input comment-text" rows="2" maxlength="5000" placeholder="Write a comment…" style="flex:1;min-width:180px;" required></textarea>
      <button class="btn primary" type="submit" style="align-self:flex-end;">Post</button>
    </form>
  `;
  // Bind delete buttons
  panel.querySelectorAll("[data-action='delete-comment']").forEach((delBtn) => {
    delBtn.addEventListener("click", async () => {
      const commentId = delBtn.dataset.commentId;
      try {
        await apiDeleteNewsComment(storyId, commentId);
        const updated = comments.map((c) => c.id === commentId ? { ...c, isDeleted: true, text: null, createdByName: null } : c);
        comments.splice(0, comments.length, ...updated);
        refreshCommentsPanel(panel, storyId, comments, data);
      } catch (err) {
        console.error("[news] delete comment failed:", err);
      }
    });
  });
  // Bind post form
  panel.querySelector(".comment-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const textarea = panel.querySelector(".comment-text");
    const text = textarea?.value?.trim();
    if (!text) return;
    try {
      const r = await apiCreateNewsComment(storyId, text);
      const newComment = {
        id: r.id,
        text,
        createdBy: currentUserId,
        createdByName: data.currentUser?.username || "",
        createdAt: r.createdAt || new Date().toISOString(),
        isDeleted: false,
      };
      comments.push(newComment);
      textarea.value = "";
      refreshCommentsPanel(panel, storyId, comments, data);
    } catch (err) {
      console.error("[news] post comment failed:", err);
    }
  });
}

function bindNewsDesk(data, rerender) {
  const panel = document.getElementById("bbcNewsDeskPanel");
  const btn = document.getElementById("bbcNewStoryBtn");
  const cancel = document.getElementById("bbcNewsDeskCancel");
  const form = document.getElementById("bbcNewsDeskForm");

  if (!panel || !btn || !cancel || !form) return;

  const canPost = canPostNews(data);
  btn.style.display = canPost ? "" : "none";
  if (!canPost) return;

  btn.addEventListener("click", () => {
    panel.style.display = panel.style.display === "none" ? "" : "none";
  });

  cancel.addEventListener("click", () => {
    panel.style.display = "none";
  });

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();

    const headline = form.querySelector("#newsHeadline")?.value?.trim();
    const isBreaking = Boolean(form.querySelector("#newsBreaking")?.checked);
    const type = form.querySelector("#newsType")?.value;
    const imageUrl = form.querySelector("#newsImage")?.value?.trim();
    const text = form.querySelector("#newsText")?.value?.trim();

    if (!headline || !text) return;

    data.news ??= { stories: [], categories: [] };
    data.news.stories ??= [];

    const sim = formatSimMonthYear(data.gameState);
    const story = {
      id: `news-${Math.random().toString(36).slice(2, 10)}`,
      createdAt: nowMs(),
      simDate: sim,
      isBreaking,
      category: type === "other" ? "Other" : "Politics",
      headline,
      imageUrl: imageUrl || "",
      text,
      flavour: type === "other"
    };
    data.news.stories.unshift(story);

    apiCreateNewsStory(story).catch(err => console.error("[news] create failed:", err)); // UI_ONLY_OK: admin CMS news creation; no simulation-outcome consequence
    form.reset();
    panel.style.display = "none";
    rerender();
  });
}

function bindArchiveToggle() {
  const btn = document.getElementById("bbcArchiveBtn");
  const panel = document.getElementById("bbcArchivePanel");
  if (!btn || !panel) return;

  btn.addEventListener("click", () => {
    const opening = panel.style.display === "none";
    panel.style.display = opening ? "" : "none";
    btn.textContent = opening ? "Hide Archive" : "View Archive";
  });
}

export async function initNewsPage(data) {
  try {
    const r = await apiGetNews();
    data.news = data.news || { stories: [], categories: [] };
    data.news.stories = r.stories.map(s => ({ ...s, createdAt: new Date(s.createdAt).getTime(), simDate: s.simDate, category: s.category, text: s.text, imageUrl: s.imageUrl, isBreaking: s.isBreaking, flavour: s.flavour }));
  } catch (err) {
    console.error("[news] load failed:", err);
  }
  const canDelete = canAdminOrMod(data);

  const renderAll = () => {
    const stories = (data.news?.stories || []).slice().sort(byNewest);
    const { liveMain, liveOther, liveBreaking, archive } = splitNewsBuckets(stories, data.gameState);

    const breakingPanel = document.getElementById("bbcBreakingPanel");
    if (breakingPanel) breakingPanel.style.display = liveBreaking.length ? "" : "none";
    const ticker = liveBreaking.map((s) => esc(s.headline)).join("   •   ");
    setHTML("bbcBreakingTicker", `<span class="bbc-breaking-track">${ticker}</span>`);

    setHTML("bbcTopStory", renderTopStory(liveMain, canDelete));
    setHTML("bbcMainNews", renderGrid(liveMain, false, `No Main News available.`, canDelete));
    setHTML("bbcOtherNews", renderGrid(liveOther, true, `No Other News available.`, canDelete));
    setHTML("bbcArchive", renderArchive(archive, canDelete));
    bindCommentToggles(data);
  };

  renderAll();
  bindArchiveToggle();
  bindNewsDesk(data, renderAll);

  if (canDelete) {
    document.addEventListener("click", (e) => {
      const deleteBtn = e.target.closest("[data-action='delete-story']");
      if (deleteBtn) {
        const id = deleteBtn.getAttribute("data-id");
        data.news.stories = (data.news.stories || []).filter((s) => s.id !== id);
        apiDeleteNewsStory(id).catch(err => console.error("[news] delete failed:", err)); // UI_ONLY_OK: admin CMS news deletion; no simulation-outcome consequence
        renderAll();
        return;
      }

      const editBtn = e.target.closest("[data-action='edit-story']");
      if (editBtn) {
        const id = editBtn.getAttribute("data-id");
        const story = (data.news?.stories || []).find((s) => s.id === id);
        if (!story) return;

        const panel = document.getElementById("bbcEditStoryPanel");
        if (panel) {
          panel.querySelector("#editNewsHeadline").value = story.headline || "";
          panel.querySelector("#editNewsText").value = story.text || "";
          panel.querySelector("#editNewsImage").value = story.imageUrl || "";
          panel.querySelector("#editNewsBreaking").checked = !!story.isBreaking;
          panel.dataset.editId = id;
          panel.style.display = "";
        }
      }
    });

    // Inject edit panel if not already present
    if (!document.getElementById("bbcEditStoryPanel")) {
      const editPanel = document.createElement("section");
      editPanel.id = "bbcEditStoryPanel";
      editPanel.className = "panel";
      editPanel.style.display = "none";
      editPanel.style.marginBottom = "12px";
      editPanel.innerHTML = `
        <h2 style="margin-top:0;">Edit Story (Staff)</h2>
        <form id="bbcEditStoryForm" class="form-grid">
          <label class="label" for="editNewsHeadline">Headline</label>
          <input id="editNewsHeadline" class="input" type="text" required maxlength="200">
          <label class="label" for="editNewsText">Text</label>
          <textarea id="editNewsText" class="input" rows="5" required></textarea>
          <label class="label" for="editNewsImage">Image URL (optional)</label>
          <input id="editNewsImage" class="input" type="url">
          <label style="display:flex;gap:6px;align-items:center;"><input id="editNewsBreaking" type="checkbox"> Breaking News</label>
          <div style="display:flex;gap:8px;margin-top:6px;">
            <button class="btn primary" type="submit">Save Changes</button>
            <button class="btn" type="button" id="bbcEditStoryCancel">Cancel</button>
          </div>
        </form>
      `;
      const newsDeskPanel = document.getElementById("bbcNewsDeskPanel");
      if (newsDeskPanel?.parentNode) {
        newsDeskPanel.parentNode.insertBefore(editPanel, newsDeskPanel);
      } else {
        document.querySelector("main")?.prepend(editPanel);
      }

      document.getElementById("bbcEditStoryCancel")?.addEventListener("click", () => {
        editPanel.style.display = "none";
      });

      document.getElementById("bbcEditStoryForm")?.addEventListener("submit", (ev) => {
        ev.preventDefault();
        const id = editPanel.dataset.editId;
        const story = (data.news?.stories || []).find((s) => s.id === id);
        if (!story) return;
        story.headline = document.getElementById("editNewsHeadline")?.value?.trim() || story.headline;
        story.text = document.getElementById("editNewsText")?.value?.trim() || story.text;
        story.imageUrl = document.getElementById("editNewsImage")?.value?.trim() || "";
        story.isBreaking = document.getElementById("editNewsBreaking")?.checked || false;
        apiUpdateNewsStory(id, { headline: story.headline, text: story.text, imageUrl: story.imageUrl, isBreaking: story.isBreaking }).catch(err => console.error("[news] update failed:", err)); // UI_ONLY_OK: admin CMS news update; no simulation-outcome consequence
        editPanel.style.display = "none";
        renderAll();
      });
    }
  }
}
