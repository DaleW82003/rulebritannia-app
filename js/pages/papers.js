import { formatSimMonthYear } from "../clock.js";
import { setHTML, esc } from "../ui.js";
import { canPostNews, canAdminOrMod } from "../permissions.js";
import { apiCreatePaperArticle, apiUpdatePaperArticle, apiDeletePaperArticle, apiGetPaperArticles, apiGetPaperComments, apiCreatePaperComment, apiDeletePaperComment, apiGetPaperSubmissions, apiCreatePaperSubmission, apiResolvePaperSubmission, apiDeletePaperSubmission } from "../api.js";

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

const SOURCE_TYPE_LABELS = {
  backbencher: "Backbencher",
  civil_servant: "Civil Servant",
  party_staff: "Party Staff",
  adviser: "Adviser",
  lobbyist: "Lobbyist",
  other: "Anonymous",
};

const RISK_LABELS = ["None", "Minor", "Moderate", "High"];

function renderSubmissionCard(s, canStaff) {
  const typeLabel = s.submissionType === "leak" ? "📰 Leak" : "✏️ Editorial";
  const statusColor = s.status === "pending" ? "#a56300" : s.status === "accepted" ? "#1a7a1a" : "#c00";
  const riskBadge = s.riskLevel >= 2 || s.isControversial ? `<span style="background:#c00;color:#fff;border-radius:3px;padding:1px 5px;font-size:.75em;margin-left:4px;">⚠ ${s.isControversial ? "CONTROVERSIAL" : ""} Risk ${s.riskLevel}</span>` : "";
  return `
    <div class="submission-card" data-sub-id="${esc(s.id)}" style="border:1px solid #ccc;border-radius:4px;padding:10px;margin-bottom:10px;">
      <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px;">
        <span style="font-weight:600;">${typeLabel}</span>
        <span class="muted small">${esc(s.paperKey)}</span>
        ${riskBadge}
        <span style="margin-left:auto;font-size:.8em;font-weight:600;color:${statusColor};">${s.status.toUpperCase()}</span>
      </div>
      ${s.headline ? `<div style="font-weight:600;margin-bottom:4px;">${esc(s.headline)}</div>` : ""}
      <div style="font-size:.85em;white-space:pre-wrap;margin-bottom:6px;">${esc(s.text.length > 400 ? s.text.slice(0, 400) + "…" : s.text)}</div>
      ${s.submissionType === "leak" ? `<div class="muted small">Source type: ${esc(SOURCE_TYPE_LABELS[s.sourceType] || s.sourceType)}${s.pseudonym ? ` · Pseudonym: "${esc(s.pseudonym)}"` : ""}</div>` : ""}
      ${canStaff ? `<div class="muted small">Submitted by: ${esc(s.submittedByName || "?")} (${esc(s.charName || "—")})</div>` : ""}
      ${canStaff && s.evidenceNotes ? `<div style="font-size:.8em;padding:4px 8px;background:#fff3cd;border-radius:3px;margin-top:4px;"><strong>Evidence:</strong> ${esc(s.evidenceNotes)}</div>` : ""}
      ${s.modNote && (canStaff || s.status !== "pending") ? `<div class="muted small" style="margin-top:4px;font-style:italic;">Mod note: ${esc(s.modNote)}</div>` : ""}
      ${s.status === "pending" && canStaff ? `
        <details style="margin-top:8px;">
          <summary style="cursor:pointer;font-size:.85em;font-weight:600;">Resolve this submission</summary>
          <div style="padding:8px 0;">
            <div class="form-grid" style="gap:6px;">
              <label style="font-size:.85em;">Final headline (optional override)</label>
              <input class="input resolve-headline" type="text" maxlength="200" placeholder="${esc(s.headline || "Auto-generated")}" style="font-size:.85em;">
              <label style="font-size:.85em;">Final text (optional override)</label>
              <textarea class="input resolve-text" rows="4" maxlength="10000" style="font-size:.85em;" placeholder="Leave blank to use submitted text">${esc(s.text)}</textarea>
              <label style="font-size:.85em;">Byline override</label>
              <input class="input resolve-byline" type="text" maxlength="120" style="font-size:.85em;" placeholder="${esc(s.submissionType === "editorial" ? (s.pseudonym || s.charName || "Correspondent") : "Auto-generated")}">
              <label style="font-size:.85em;">Editor's note (appended to article)</label>
              <input class="input resolve-editornote" type="text" maxlength="400" style="font-size:.85em;" placeholder="Optional italic note appended at end of article">
              <label style="font-size:.85em;">Mod note (private, visible to submitter)</label>
              <input class="input resolve-modnote" type="text" maxlength="300" style="font-size:.85em;" placeholder="Reason for rejection or any note">
            </div>
            <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
              <button class="btn primary small resolve-accept" type="button">✓ Accept &amp; Publish</button>
              <button class="btn small resolve-reject" type="button" style="border-color:#c00;color:#c00;">✗ Reject</button>
              <button class="btn small resolve-delete" type="button">Delete</button>
            </div>
            <div class="resolve-status" style="font-size:.8em;margin-top:4px;color:#555;"></div>
          </div>
        </details>
      ` : ""}
      ${s.publishedArticleId ? `<div class="muted small" style="margin-top:4px;">✓ Published as article <code>${esc(s.publishedArticleId)}</code></div>` : ""}
    </div>
  `;
}

function bindSubmissionCardActions(container, onRefresh) {
  container.querySelectorAll(".submission-card").forEach((card) => {
    const subId = card.dataset.subId;
    const statusDiv = card.querySelector(".resolve-status");

    card.querySelector(".resolve-accept")?.addEventListener("click", async () => {
      const headline = card.querySelector(".resolve-headline")?.value?.trim();
      const text = card.querySelector(".resolve-text")?.value?.trim();
      const byline = card.querySelector(".resolve-byline")?.value?.trim();
      const editorNote = card.querySelector(".resolve-editornote")?.value?.trim();
      const modNote = card.querySelector(".resolve-modnote")?.value?.trim();
      if (statusDiv) statusDiv.textContent = "Publishing…";
      try {
        await apiResolvePaperSubmission(subId, { action: "accept", headline, text, byline, editorNote, modNote });
        if (statusDiv) statusDiv.textContent = "✓ Published successfully.";
        setTimeout(() => onRefresh(), 1200);
      } catch (err) {
        if (statusDiv) statusDiv.textContent = err.message || "Failed.";
      }
    });

    card.querySelector(".resolve-reject")?.addEventListener("click", async () => {
      const modNote = card.querySelector(".resolve-modnote")?.value?.trim();
      if (statusDiv) statusDiv.textContent = "Rejecting…";
      try {
        await apiResolvePaperSubmission(subId, { action: "reject", modNote });
        if (statusDiv) statusDiv.textContent = "Rejected.";
        setTimeout(() => onRefresh(), 1200);
      } catch (err) {
        if (statusDiv) statusDiv.textContent = err.message || "Failed.";
      }
    });

    card.querySelector(".resolve-delete")?.addEventListener("click", async () => {
      if (!confirm("Delete this submission permanently?")) return;
      try {
        await apiDeletePaperSubmission(subId);
        onRefresh();
      } catch (err) {
        if (statusDiv) statusDiv.textContent = err.message || "Delete failed.";
      }
    });
  });
}

function bindSubmissions(data, papers) {
  const mainBtn = document.getElementById("papersSubmissionsBtn");
  const mainPanel = document.getElementById("papersSubmissionsPanel");
  if (!mainBtn || !mainPanel) return;

  const isLoggedIn = !!data.currentUser?.id;
  const isStaff = canAdminOrMod(data);

  // Show/hide submissions panel
  mainBtn.addEventListener("click", () => {
    const isOpen = mainPanel.style.display !== "none";
    mainPanel.style.display = isOpen ? "none" : "";
    mainBtn.textContent = isOpen ? "Submit a Leak / Editorial" : "Close Submissions";
    if (!isOpen && isStaff) loadModInbox();
  });

  // Populate paper selects
  const paperOptions = papers.map((p) => `<option value="${esc(p.key)}">${esc(p.name)}</option>`).join("");
  ["leakPaper", "editPaper", "modInboxFilterPaper"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === "modInboxFilterPaper") {
      el.innerHTML = `<option value="">All Papers</option>` + paperOptions;
    } else {
      el.innerHTML = paperOptions;
    }
  });

  // Toggle sub-panels
  const leakForm    = document.getElementById("papersLeakForm");
  const editForm    = document.getElementById("papersEditorialForm");
  const mySubsPanel = document.getElementById("papersMySubmissions");
  const modInbox    = document.getElementById("papersModInbox");

  function hideAll() {
    [leakForm, editForm, mySubsPanel, modInbox].forEach((el) => { if (el) el.style.display = "none"; });
  }

  document.getElementById("papersSubLeakBtn")?.addEventListener("click", () => {
    if (!isLoggedIn) { alert("Please log in to submit a leak."); return; }
    const isShowing = leakForm?.style.display !== "none";
    hideAll();
    if (!isShowing && leakForm) leakForm.style.display = "";
  });

  document.getElementById("papersSubEditorialBtn")?.addEventListener("click", () => {
    if (!isLoggedIn) { alert("Please log in to submit an editorial."); return; }
    const isShowing = editForm?.style.display !== "none";
    hideAll();
    if (!isShowing && editForm) editForm.style.display = "";
  });

  document.getElementById("papersSubMyBtn")?.addEventListener("click", () => {
    if (!isLoggedIn) { alert("Please log in to see your submissions."); return; }
    const isShowing = mySubsPanel?.style.display !== "none";
    hideAll();
    if (!isShowing) {
      if (mySubsPanel) mySubsPanel.style.display = "";
      loadMySubmissions();
    }
  });

  document.getElementById("papersLeakCancel")?.addEventListener("click", () => {
    if (leakForm) leakForm.style.display = "none";
  });
  document.getElementById("papersEditorialCancel")?.addEventListener("click", () => {
    if (editForm) editForm.style.display = "none";
  });

  // Leak form submit
  document.getElementById("papersLeakFormEl")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = ev.currentTarget.querySelector("[type='submit']");
    if (btn) btn.disabled = true;
    try {
      await apiCreatePaperSubmission({
        paperKey:       document.getElementById("leakPaper")?.value,
        submissionType: "leak",
        text:           document.getElementById("leakText")?.value?.trim(),
        sourceType:     document.getElementById("leakSourceType")?.value,
        pseudonym:      document.getElementById("leakPseudonym")?.value?.trim(),
        evidenceNotes:  document.getElementById("leakEvidence")?.value?.trim(),
        riskLevel:      Number(document.getElementById("leakRisk")?.value || 0),
        isControversial: document.getElementById("leakControversial")?.checked,
      });
      ev.currentTarget.reset();
      if (leakForm) leakForm.style.display = "none";
      showSubmitSuccess("Leak submitted! Mods will review it shortly.");
    } catch (err) {
      showSubmitError(err.message || "Submission failed.");
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // Editorial form submit
  document.getElementById("papersEditorialFormEl")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = ev.currentTarget.querySelector("[type='submit']");
    if (btn) btn.disabled = true;
    try {
      await apiCreatePaperSubmission({
        paperKey:       document.getElementById("editPaper")?.value,
        submissionType: "editorial",
        headline:       document.getElementById("editHeadline")?.value?.trim(),
        text:           document.getElementById("editText")?.value?.trim(),
        pseudonym:      document.getElementById("editPseudonym")?.value?.trim(),
        imageUrl:       document.getElementById("editImage")?.value?.trim(),
        riskLevel:      Number(document.getElementById("editRisk")?.value || 0),
        isControversial: document.getElementById("editControversial")?.checked,
      });
      ev.currentTarget.reset();
      if (editForm) editForm.style.display = "none";
      showSubmitSuccess("Editorial submitted! Mods will review it shortly.");
    } catch (err) {
      showSubmitError(err.message || "Submission failed.");
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  function showSubmitSuccess(msg) {
    const div = document.createElement("div");
    div.style.cssText = "padding:8px 12px;background:#d4edda;border:1px solid #c3e6cb;border-radius:4px;margin-top:8px;font-size:.9em;";
    div.textContent = msg;
    mainPanel.prepend(div);
    setTimeout(() => div.remove(), 5000);
  }

  function showSubmitError(msg) {
    const div = document.createElement("div");
    div.style.cssText = "padding:8px 12px;background:#f8d7da;border:1px solid #f5c6cb;border-radius:4px;margin-top:8px;font-size:.9em;";
    div.textContent = `Error: ${msg}`;
    mainPanel.prepend(div);
    setTimeout(() => div.remove(), 7000);
  }

  // My Submissions
  async function loadMySubmissions() {
    const listEl = document.getElementById("papersMySubmissionsList");
    if (!listEl) return;
    listEl.innerHTML = `<div class="muted-block">Loading…</div>`;
    try {
      const r = await apiGetPaperSubmissions();
      const subs = r.submissions || [];
      if (!subs.length) { listEl.innerHTML = `<div class="muted-block">No submissions yet.</div>`; return; }
      listEl.innerHTML = subs.map((s) => renderSubmissionCard(s, false)).join("");
    } catch (err) {
      listEl.innerHTML = `<div class="muted-block">Failed to load submissions.</div>`;
      console.error("[papers] my submissions load failed:", err);
    }
  }

  // Mod inbox
  if (isStaff) {
    if (modInbox) modInbox.style.display = "none";

    document.querySelector(".tile-bottom")?.closest("section.panel"); // already opened via click

    // Show mod inbox on panel open via the main button (already handled above)
    // But also expose a way to access it directly from the page:
    const modInboxBtn = document.createElement("button");
    modInboxBtn.className = "btn small";
    modInboxBtn.textContent = "Mod Inbox";
    modInboxBtn.style.cssText = "margin-left:6px;";
    modInboxBtn.addEventListener("click", () => {
      if (mainPanel.style.display === "none") {
        mainPanel.style.display = "";
        mainBtn.textContent = "Close Submissions";
      }
      hideAll();
      if (modInbox) modInbox.style.display = "";
      loadModInbox();
    });
    mainBtn.insertAdjacentElement("afterend", modInboxBtn);

    async function loadModInbox() {
      const listEl = document.getElementById("papersModInboxList");
      if (!listEl) return;
      listEl.innerHTML = `<div class="muted-block">Loading…</div>`;
      const filters = {};
      const paperF = document.getElementById("modInboxFilterPaper")?.value;
      const statusF = document.getElementById("modInboxFilterStatus")?.value;
      const typeF = document.getElementById("modInboxFilterType")?.value;
      const riskF = document.getElementById("modInboxFilterRisk")?.checked;
      if (paperF)  filters.paper  = paperF;
      if (statusF) filters.status = statusF;
      if (typeF)   filters.type   = typeF;
      if (riskF)   filters.risk   = "high";
      try {
        const r = await apiGetPaperSubmissions(filters);
        const subs = r.submissions || [];
        if (!subs.length) { listEl.innerHTML = `<div class="muted-block">No submissions match the current filters.</div>`; return; }
        listEl.innerHTML = subs.map((s) => renderSubmissionCard(s, true)).join("");
        bindSubmissionCardActions(listEl, loadModInbox);
      } catch (err) {
        listEl.innerHTML = `<div class="muted-block">Failed to load inbox.</div>`;
        console.error("[papers] mod inbox load failed:", err);
      }
    }

    document.getElementById("modInboxRefresh")?.addEventListener("click", loadModInbox);
    ["modInboxFilterPaper", "modInboxFilterStatus", "modInboxFilterType", "modInboxFilterRisk"].forEach((id) => {
      document.getElementById(id)?.addEventListener("change", loadModInbox);
    });
  }
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
  bindSubmissions(data, papers);
}
