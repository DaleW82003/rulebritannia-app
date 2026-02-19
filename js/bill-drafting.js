import { esc } from "./ui.js";
import { getSimDate } from "./clock.js";

export const DEPARTMENTS = [
  "Cabinet Office (General)",
  "Home",
  "Foreign",
  "Treasury",
  "Business, Trade & Industry",
  "Defence",
  "Work & Pensions",
  "Education",
  "Health",
  "Environment & Agriculture",
  "Social Care",
  "Transport & Infrastructure",
  "Culture, Media & Sports",
  "Home Nations"
];

export const EXTENT_OPTIONS = [
  "the United Kingdom",
  "Great Britain",
  "England and Wales",
  "England",
  "Wales",
  "Scotland",
  "Northern Ireland"
];

export const COMMENCE_OPTIONS = [
  "upon the day it is passed",
  "in one month",
  "in six months",
  "in one year",
  "on a date laid out in regulation by the Secretary of State"
];

export function currentSimYear(data) {
  return Number(getSimDate(data?.gameState || {}).year || new Date().getFullYear());
}

function renderArticleEditors(count, articleSeed = []) {
  const n = Math.max(1, Math.min(20, Number(count || 1)));
  return Array.from({ length: n }).map((_, i) => {
    const seeded = articleSeed[i] || {};
    return `
      <section class="panel" style="margin-top:12px;">
        <h3 style="margin-top:0;">Article ${i + 1}</h3>
        <div class="form-grid">
          <label for="draftArticleHeading${i}">Article Heading</label>
          <input id="draftArticleHeading${i}" name="draftArticleHeading${i}" type="text" maxlength="140" required value="${esc(seeded.heading || "")}">

          <label for="draftArticleBody${i}">Article Body</label>
          <textarea id="draftArticleBody${i}" name="draftArticleBody${i}" rows="6" required>${esc(seeded.body || "")}</textarea>
        </div>
      </section>
    `;
  }).join("");
}

export function renderDraftingBuilder(prefix, draft = {}) {
  draft = draft || {};
  const articleCount = Math.max(1, Math.min(20, Number(draft.articleCount || (draft.articles?.length || 3))));
  const articleSeed = Array.isArray(draft.articles) && draft.articles.length
    ? draft.articles
    : [{ heading: "General provisions", body: draft.body || "" }];

  return `
    <div class="form-grid">
      <label for="${prefix}-title">Bill Title</label>
      <input id="${prefix}-title" class="input" name="title" required value="${esc(draft.title || "")}">

      <label for="${prefix}-purpose">A Bill to make provision for</label>
      <textarea id="${prefix}-purpose" class="input" name="purpose" rows="3" required>${esc(draft.purpose || "")}</textarea>

      <label for="${prefix}-department">Department</label>
      <select id="${prefix}-department" class="input" name="department" required>
        ${DEPARTMENTS.map((d) => `<option value="${esc(d)}" ${d === (draft.department || "Cabinet Office (General)") ? "selected" : ""}>${esc(d)}</option>`).join("")}
      </select>

      <label for="${prefix}-article-count">Number of Articles</label>
      <input id="${prefix}-article-count" class="input" name="articleCount" type="number" min="1" max="20" value="${articleCount}" required>
    </div>

    <div data-draft-articles-container="${prefix}" style="margin-top:12px;">
      ${renderArticleEditors(articleCount, articleSeed)}
    </div>

    <div class="panel" style="margin-top:12px;">
      <h3 style="margin-top:0;">Final Article — Extent & Commencement</h3>
      <div class="form-grid">
        <label for="${prefix}-extent">Extent</label>
        <select id="${prefix}-extent" class="input" name="extent" required>
          ${EXTENT_OPTIONS.map((o) => `<option value="${esc(o)}" ${o === (draft.extent || "the United Kingdom") ? "selected" : ""}>${esc(o)}</option>`).join("")}
        </select>

        <label for="${prefix}-commencement">Commencement</label>
        <select id="${prefix}-commencement" class="input" name="commencement" required>
          ${COMMENCE_OPTIONS.map((o) => `<option value="${esc(o)}" ${o === (draft.commencement || "upon the day it is passed") ? "selected" : ""}>${esc(o)}</option>`).join("")}
        </select>
      </div>
    </div>

    <label class="label" for="${prefix}-discuss">Discuss URL (optional)</label>
    <input id="${prefix}-discuss" class="input" name="discussUrl" placeholder="Auto-generated if blank" value="${esc(draft.discussUrl || "")}">
  `;
}

export function wireDraftingBuilder(form, prefix) {
  const countInput = form?.querySelector(`#${prefix}-article-count`);
  const container = form?.querySelector(`[data-draft-articles-container="${prefix}"]`);
  if (!countInput || !container) return;

  const repaint = () => {
    container.innerHTML = renderArticleEditors(countInput.value);
  };

  countInput.addEventListener("input", repaint);
}

export function getMonarchGender(data) {
  return String(data?.adminSettings?.monarchGender || "Queen").toLowerCase() === "king" ? "King" : "Queen";
}

export function parseDraftingForm(form, data) {
  const fd = new FormData(form);
  const title = String(fd.get("title") || "").trim();
  const purpose = String(fd.get("purpose") || "").trim();
  const department = String(fd.get("department") || "Cabinet Office (General)").trim();
  const articleCount = Math.max(1, Math.min(20, Number(fd.get("articleCount") || 1)));
  const extent = String(fd.get("extent") || "the United Kingdom").trim();
  const commencement = String(fd.get("commencement") || "upon the day it is passed").trim();
  const discussUrl = String(fd.get("discussUrl") || "").trim();

  const articles = [];
  for (let i = 0; i < articleCount; i += 1) {
    articles.push({
      heading: String(form.querySelector(`#draftArticleHeading${i}`)?.value || `Article ${i + 1}`).trim(),
      body: String(form.querySelector(`#draftArticleBody${i}`)?.value || "").trim()
    });
  }

  const simYear = currentSimYear(data);
  const titleAsAct = `${title.replace(/Bill/ig, "Act")} ${simYear}`.trim();
  const monarch = getMonarchGender(data);
  const pronoun = monarch === "King" ? "His" : "Her";

  const lines = [
    title,
    "",
    `A Bill to make provision for ${purpose}`,
    "",
    `BE IT ENACTED by the ${monarch}’s most Excellent Majesty, by and with the advice and consent of the Lords Spiritual and Temporal, and Commons, in this present Parliament assembled, and by the authority of the same, as follows:`,
    `(${pronoun} Majesty in Parliament enacted this measure under the constitutional forms of the realm.)`
  ];

  articles.forEach((a, i) => {
    lines.push("", `ARTICLE ${i + 1} — ${a.heading || `Article ${i + 1}`}`, a.body || "");
  });

  const finalNo = articleCount + 1;
  lines.push(
    "",
    `ARTICLE ${finalNo} — FINAL ARTICLE: EXTENT AND COMMENCEMENT`,
    `1. This Act extends to ${extent}.`,
    `2. This Act comes into force ${commencement}.`,
    `3. This Act may be cited as the ${titleAsAct}.`
  );

  return { title, purpose, department, discussUrl, articleCount, extent, commencement, articles, body: lines.join("\n") };
}
