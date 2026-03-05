import { formatSimMonthYear } from "../clock.js";
import { setHTML, esc } from "../ui.js";
import { canPostNews, canAdminOrMod } from "../permissions.js";
import { apiCreatePaperArticle, apiUpdatePaperArticle, apiDeletePaperArticle, apiGetPaperArticles, apiGetPaperComments, apiCreatePaperComment, apiDeletePaperComment } from "../api.js";

function byNewest(a, b) {
  return Number(b?.createdAt || 0) - Number(a?.createdAt || 0);
}

function renderPaperTiles(papers) {
  const ftPaper = papers.find((p) => p.key === "ft");
  const otherPapers = papers.filter((p) => p.key !== "ft");

  function tileHtml(p) {
    const latest = (p.issues || []).slice().sort(byNewest)[0];
    return `
      <div class="paper-tile ${esc(p.cls || "")} card-flex">
        <div class="paper-masthead">${esc(p.name)}</div>
        <div class="paper-headline">${esc(latest?.headline || "No articles yet")}</div>
        <div class="paper-strap">${esc(latest?.simDate || "")}</div>
        <div class="tile-bottom">
          <button class="btn" type="button" data-paper="${esc(p.key)}">Open</button>
        </div>
      </div>
    `;
  }

  return `
    <div class="paper-grid">
      ${otherPapers.map(tileHtml).join("")}
    </div>
    ${ftPaper ? `
    <div class="paper-ft-row">
      ${tileHtml(ftPaper)}
    </div>` : ""}
  `;
}

function renderReader(paper, canDelete = false) {
  const issues = (paper.issues || []).slice().sort(byNewest);
  if (!issues.length) {
    return `
      <div class="paper-reader-header">
        <div>
          <div class="paper-reader-title ${esc(paper.cls || "")}">${esc(paper.name)}</div>
          <div class="muted">No articles published yet.</div>
        </div>
      </div>
    `;
  }

  return `
    <div class="paper-reader-header">
      <div>
        <div class="paper-reader-title ${esc(paper.cls || "")}">${esc(paper.name)}</div>
        <div class="muted">All articles (newest first)</div>
      </div>
    </div>

    ${issues.map((i) => `
      <article class="paper-issue ${esc(paper.cls || "")}">
        <div class="paper-issue-top">
          <div class="paper-issue-masthead">${esc(paper.name)}</div>
          <div class="paper-issue-date">${esc(i.simDate || "")}</div>
        </div>
        <div class="paper-issue-headline">${esc(i.headline || "")}</div>
        ${i.bylineName ? `<div class="paper-issue-byline">By ${esc(i.bylineName)}</div>` : ""}
        ${i.imageUrl ? `<div class="paper-issue-imagewrap"><img src="${esc(i.imageUrl)}" alt=""></div>` : ""}
        <div class="paper-issue-text">${esc(i.text || "")}</div>
        ${canDelete ? `<div class="tile-bottom" style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
          <button class="btn" data-action="edit-article" data-paper="${esc(paper.key)}" data-article-id="${esc(i.id)}" type="button">Edit</button>
          <button class="btn danger" data-action="delete-article" data-paper="${esc(paper.key)}" data-article-id="${esc(i.id)}" type="button">Delete</button>
        </div>` : ""}
        <div class="paper-comments-section" style="margin-top:8px;">
          <button class="btn small" data-action="toggle-paper-comments" data-paper="${esc(paper.key)}" data-article-id="${esc(i.id)}" type="button">Comments</button>
          <div class="paper-comments-panel" data-paper="${esc(paper.key)}" data-article-id="${esc(i.id)}" style="display:none;margin-top:6px;"></div>
        </div>
      </article>
    `).join("")}
  `;
}

function ensurePaperEditPanel(data, canDelete) {
  if (document.getElementById("paperEditArticlePanel")) return;

  const editPanel = document.createElement("div");
  editPanel.id = "paperEditArticlePanel";
  editPanel.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.4);display:none;align-items:center;justify-content:center;z-index:9999;";
  editPanel.innerHTML = `
    <section class="panel" style="max-width:560px;width:100%;max-height:90vh;overflow-y:auto;">
      <h2 style="margin-top:0;">Edit Article (Staff)</h2>
      <form id="paperEditArticleForm">
        <label class="label" for="peaHeadline">Headline</label>
        <input id="peaHeadline" class="input" type="text" required maxlength="200">
        <label class="label" for="peaText">Text</label>
        <textarea id="peaText" class="input" rows="6" required></textarea>
        <label class="label" for="peaByline">Byline (optional)</label>
        <input id="peaByline" class="input" type="text" maxlength="120">
        <label class="label" for="peaImage">Image URL (optional)</label>
        <input id="peaImage" class="input" type="url">
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button class="btn primary" type="submit">Save</button>
          <button class="btn" type="button" id="peaCancel">Cancel</button>
        </div>
      </form>
    </section>
  `;
  document.body.appendChild(editPanel);

  editPanel.querySelector("#peaCancel").addEventListener("click", () => {
    editPanel.style.display = "none";
  });
  editPanel.addEventListener("click", (ev) => {
    if (ev.target === editPanel) editPanel.style.display = "none";
  });

  editPanel.querySelector("#paperEditArticleForm").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const panel = document.getElementById("paperEditArticlePanel");
    const aid = panel.dataset.articleId;
    const pkey = panel.dataset.paperKey;
    const paper = (data.papers?.papers || []).find((p) => p.key === pkey);
    const art = (paper?.issues || []).find((i) => i.id === aid);
    if (!art) return;
    art.headline = panel.querySelector("#peaHeadline")?.value?.trim() || art.headline;
    art.text = panel.querySelector("#peaText")?.value?.trim() || art.text;
    art.bylineName = panel.querySelector("#peaByline")?.value?.trim() || "";
    art.imageUrl = panel.querySelector("#peaImage")?.value?.trim() || "";
    apiUpdatePaperArticle(pkey, aid, { headline: art.headline, text: art.text, bylineName: art.bylineName, imageUrl: art.imageUrl }).catch(err => console.error("[papers] update failed:", err)); // UI_ONLY_OK: admin CMS newspaper article update; no simulation-outcome consequence
    panel.style.display = "none";
    if (paper) {
      setHTML("paperReader", renderReader(paper, canDelete));
      bindArticleDeleteListeners(data, canDelete);
      bindPaperCommentToggles(data);
    }
  });
}

function renderPaperCommentsList(comments, currentUserId, canMod) {
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
        ${canDelete ? `<button class="btn danger small" data-action="delete-paper-comment" data-paper="${esc(c._paperKey || "")}" data-article-id="${esc(c._articleId || "")}" data-comment-id="${esc(c.id)}" type="button" style="margin-left:8px;padding:1px 6px;font-size:.8em;">Delete</button>` : ""}
        <div style="margin-top:2px;">${esc(c.text)}</div>
      </div>
    `;
  }).join("");
}

function refreshPaperCommentsPanel(panel, paperKey, articleId, comments, data) {
  const currentUserId = data.currentUser?.id;
  const canMod = canAdminOrMod(data);
  const countLabel = comments.filter((c) => !c.isDeleted).length;
  const toggleBtn = panel.closest(".paper-comments-section")?.querySelector("[data-action='toggle-paper-comments']");
  if (toggleBtn) toggleBtn.textContent = `Hide Comments (${countLabel})`;
  // Tag comments with paper/article for delete handler
  const tagged = comments.map((c) => ({ ...c, _paperKey: paperKey, _articleId: articleId }));
  panel.innerHTML = `
    <div class="paper-comments-list">${renderPaperCommentsList(tagged, currentUserId, canMod)}</div>
    <form class="paper-comment-form" style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">
      <textarea class="input paper-comment-text" rows="2" maxlength="5000" placeholder="Write a comment…" style="flex:1;min-width:180px;" required></textarea>
      <button class="btn primary" type="submit" style="align-self:flex-end;">Post</button>
    </form>
  `;
  panel.querySelectorAll("[data-action='delete-paper-comment']").forEach((delBtn) => {
    delBtn.addEventListener("click", async () => {
      const commentId = delBtn.dataset.commentId;
      try {
        await apiDeletePaperComment(paperKey, articleId, commentId);
        const updated = comments.map((c) => c.id === commentId ? { ...c, isDeleted: true, text: null, createdByName: null } : c);
        comments.splice(0, comments.length, ...updated);
        refreshPaperCommentsPanel(panel, paperKey, articleId, comments, data);
      } catch (err) {
        console.error("[papers] delete comment failed:", err);
      }
    });
  });
  panel.querySelector(".paper-comment-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const textarea = panel.querySelector(".paper-comment-text");
    const text = textarea?.value?.trim();
    if (!text) return;
    try {
      const r = await apiCreatePaperComment(paperKey, articleId, text);
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
      refreshPaperCommentsPanel(panel, paperKey, articleId, comments, data);
    } catch (err) {
      console.error("[papers] post comment failed:", err);
    }
  });
}

function bindPaperCommentToggles(data) {
  document.querySelectorAll("[data-action='toggle-paper-comments']").forEach((btn) => {
    if (btn.dataset.commentsBound) return;
    btn.dataset.commentsBound = "1";
    btn.addEventListener("click", async () => {
      const paperKey = btn.dataset.paper;
      const articleId = btn.dataset.articleId;
      const panel = btn.closest(".paper-comments-section")?.querySelector(".paper-comments-panel");
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
          const r = await apiGetPaperComments(paperKey, articleId);
          panel.dataset.loaded = "1";
          const comments = r.comments || [];
          refreshPaperCommentsPanel(panel, paperKey, articleId, comments, data);
        } catch (err) {
          panel.innerHTML = `<div class="muted" style="font-size:.85em;">Failed to load comments.</div>`;
          console.error("[papers] load comments failed:", err);
        }
      }
    });
  });
}

function bindArticleDeleteListeners(data, canDelete) {
  if (!canDelete) return;
  ensurePaperEditPanel(data, canDelete);

  document.querySelectorAll("[data-action='delete-article']").forEach((delBtn) => {
    delBtn.addEventListener("click", () => {
      const articleId = delBtn.getAttribute("data-article-id");
      const paperKey = delBtn.getAttribute("data-paper");
      const targetPaper = (data.papers?.papers || []).find((p) => p.key === paperKey);
      if (!targetPaper) return;
      targetPaper.issues = (targetPaper.issues || []).filter((i) => i.id !== articleId);
      apiDeletePaperArticle(paperKey, articleId).catch(err => console.error("[papers] delete failed:", err)); // UI_ONLY_OK: admin CMS newspaper article deletion; no simulation-outcome consequence
      setHTML("paperReader", renderReader(targetPaper, canDelete));
      bindArticleDeleteListeners(data, canDelete);
      bindPaperCommentToggles(data);
    });
  });

  document.querySelectorAll("[data-action='edit-article']").forEach((editBtn) => {
    editBtn.addEventListener("click", () => {
      const articleId = editBtn.getAttribute("data-article-id");
      const paperKey = editBtn.getAttribute("data-paper");
      const targetPaper = (data.papers?.papers || []).find((p) => p.key === paperKey);
      if (!targetPaper) return;
      const article = (targetPaper.issues || []).find((i) => i.id === articleId);
      if (!article) return;

      const editPanel = document.getElementById("paperEditArticlePanel");
      editPanel.querySelector("#peaHeadline").value = article.headline || "";
      editPanel.querySelector("#peaText").value = article.text || "";
      editPanel.querySelector("#peaByline").value = article.bylineName || "";
      editPanel.querySelector("#peaImage").value = article.imageUrl || "";
      editPanel.dataset.articleId = articleId;
      editPanel.dataset.paperKey = paperKey;
      editPanel.style.display = "flex";
    });
  });
}

function bindOpenButtons(data, canDelete) {
  document.querySelectorAll("[data-paper]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const paper = (data.papers?.papers || []).find((p) => p.key === btn.dataset.paper);
      if (!paper) return;
      const panel = document.getElementById("paperReaderPanel");
      if (panel) panel.style.display = "";
      setHTML("paperReader", renderReader(paper, canDelete));
      bindArticleDeleteListeners(data, canDelete);
      bindPaperCommentToggles(data);
    });
  });
}

function bindNewsDesk(data, rerenderGrid) {
  const deskBtn = document.getElementById("papersNewsDeskBtn");
  const deskPanel = document.getElementById("papersNewsDeskPanel");
  const cancelBtn = document.getElementById("papersDeskCancel");
  const form = document.getElementById("papersNewsDeskForm");
  if (!deskBtn || !deskPanel || !cancelBtn || !form) return;

  const canPost = canPostNews(data);
  deskBtn.style.display = canPost ? "" : "none";
  if (!canPost) return;

  deskBtn.addEventListener("click", () => {
    deskPanel.style.display = deskPanel.style.display === "none" ? "" : "none";
  });

  cancelBtn.addEventListener("click", () => {
    deskPanel.style.display = "none";
  });

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const paperKey = form.querySelector("#papersDeskPaper")?.value;
    const headline = form.querySelector("#papersDeskHeadline")?.value?.trim();
    const bylineName = form.querySelector("#papersDeskByline")?.value?.trim();
    const imageUrl = form.querySelector("#papersDeskImage")?.value?.trim();
    const text = form.querySelector("#papersDeskText")?.value?.trim();
    if (!paperKey || !headline || !bylineName || !text) return;

    const paper = (data.papers?.papers || []).find((p) => p.key === paperKey);
    if (!paper) return;
    paper.issues ??= [];
    const article = {
      id: `${paperKey}-${Math.random().toString(36).slice(2, 10)}`,
      createdAt: Date.now(),
      simDate: formatSimMonthYear(data.gameState),
      headline,
      imageUrl: imageUrl || "",
      bylineName,
      text
    };
    paper.issues.unshift(article);

    apiCreatePaperArticle(paper.key, article).catch(err => console.error("[papers] create failed:", err)); // UI_ONLY_OK: admin CMS newspaper article creation; no simulation-outcome consequence
    form.reset();
    deskPanel.style.display = "none";
    rerenderGrid();
  });
}

export async function initPapersPage(data) {
  try {
    const r = await apiGetPaperArticles();
    if (r.byPaper) {
      for (const paper of (data.papers?.papers || [])) {
        if (r.byPaper[paper.key]) {
          paper.issues = r.byPaper[paper.key].map(a => ({ ...a, createdAt: new Date(a.createdAt).getTime() }));
        }
      }
    }
  } catch (err) {
    console.error("[papers] load failed:", err);
  }
  const papers = data.papers?.papers || [];
  const canDelete = canAdminOrMod(data);
  const paperSelect = document.getElementById("papersDeskPaper");
  if (paperSelect) {
    paperSelect.innerHTML = papers.map((p) => `<option value="${esc(p.key)}">${esc(p.name)}</option>`).join("");
  }

  const rerenderGrid = () => {
    if (!papers.length) {
      setHTML("papersGrid", `<div class="muted-block">No papers configured.</div>`);
      return;
    }

    setHTML("papersGrid", renderPaperTiles(papers));
    bindOpenButtons(data, canDelete);
  };

  rerenderGrid();
  bindNewsDesk(data, rerenderGrid);
}
