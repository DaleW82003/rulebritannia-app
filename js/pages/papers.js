import { formatSimMonthYear } from "../clock.js";
import { setHTML, esc } from "../ui.js";

export function initPapersPage(data) {
  const sim = formatSimMonthYear(data.gameState);
  const dateEl = document.getElementById("papersSimDate");
  if (dateEl) dateEl.textContent = sim;

  const papers = data.papers?.papers || [];
  if (!papers.length) {
    setHTML("papersGrid", `<div class="muted-block">No papers configured.</div>`);
    return;
  }

  setHTML("papersGrid", `
    <div class="paper-grid">
      ${papers.map(p => {
        const latest = (p.issues || []).slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))[0];
        return `
          <div class="paper-tile ${esc(p.cls || "")} card-flex">
            <div class="paper-masthead">${esc(p.name)}</div>
            <div class="paper-headline">${esc(latest?.headline || "—")}</div>
            <div class="paper-strap">${esc(latest?.simDate || "")}</div>
            <div class="tile-bottom">
              <button class="btn" type="button" data-paper="${esc(p.key)}">Open</button>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `);

  // Reader open
  document.querySelectorAll("[data-paper]").forEach(btn => {
    btn.addEventListener("click", () => openPaper(data, btn.dataset.paper));
  });
}

function openPaper(data, paperKey) {
  const paper = (data.papers?.papers || []).find(p => p.key === paperKey);
  if (!paper) return;

  const issues = (paper.issues || []).slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));

  const panel = document.getElementById("paperReaderPanel");
  if (panel) panel.style.display = "";

  setHTML("paperReader", `
    <div class="paper-reader-header">
      <div>
        <div class="paper-reader-title ${esc(paper.cls||"")}">${esc(paper.name)}</div>
        <div class="muted">All issues (newest first)</div>
      </div>
    </div>

    ${issues.map(i => `
      <div class="paper-issue ${esc(paper.cls || "")}">
        <div class="paper-issue-top">
          <div class="paper-issue-masthead">${esc(paper.name)}</div>
          <div class="paper-issue-date">${esc(i.simDate || "")}</div>
        </div>
        <div class="paper-issue-headline">${esc(i.headline || "")}</div>
        ${i.bylineName ? `<div class="paper-issue-byline">${esc(i.bylineName)}</div>` : ``}
        ${i.imageUrl ? `<div class="paper-issue-imagewrap"><img src="${esc(i.imageUrl)}" alt=""></div>` : ``}
        <div class="paper-issue-text">${esc(i.text || "")}</div>
      </div>
    `).join("")}
  `);
}
