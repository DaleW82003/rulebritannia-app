import { formatSimMonthYear } from "../clock.js";
import { setHTML, esc } from "../ui.js";
import { canPostNews, canAdminOrMod } from "../permissions.js";
import { saveState } from "../core.js";

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
    saveState(data);
    panel.style.display = "none";
    if (paper) {
      setHTML("paperReader", renderReader(paper, canDelete));
      bindArticleDeleteListeners(data, canDelete);
    }
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
      saveState(data);
      setHTML("paperReader", renderReader(targetPaper, canDelete));
      bindArticleDeleteListeners(data, canDelete);
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
    paper.issues.unshift({
      id: `${paperKey}-${Math.random().toString(36).slice(2, 10)}`,
      createdAt: Date.now(),
      simDate: formatSimMonthYear(data.gameState),
      headline,
      imageUrl: imageUrl || "",
      bylineName,
      text
    });

    saveState(data);
    form.reset();
    deskPanel.style.display = "none";
    rerenderGrid();
  });
}

export function initPapersPage(data) {
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
