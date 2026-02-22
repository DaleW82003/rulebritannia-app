import { formatSimMonthYear } from "../clock.js";
import { setHTML, esc } from "../ui.js";
import { canPostNews } from "../permissions.js";
import { saveState } from "../core.js";

function byNewest(a, b) {
  return Number(b?.createdAt || 0) - Number(a?.createdAt || 0);
}

function renderPaperTiles(papers) {
  return `
    <div class="paper-grid">
      ${papers.map((p) => {
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
      }).join("")}
    </div>
  `;
}

function renderReader(paper) {
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
      </article>
    `).join("")}
  `;
}

function bindOpenButtons(data) {
  document.querySelectorAll("[data-paper]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const paper = (data.papers?.papers || []).find((p) => p.key === btn.dataset.paper);
      if (!paper) return;
      const panel = document.getElementById("paperReaderPanel");
      if (panel) panel.style.display = "";
      setHTML("paperReader", renderReader(paper));
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
    bindOpenButtons(data);
  };

  rerenderGrid();
  bindNewsDesk(data, rerenderGrid);
}
