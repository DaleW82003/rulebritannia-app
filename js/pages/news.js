import { formatSimMonthYear } from "../clock.js";
import { setHTML, esc } from "../ui.js";
import { canPostNews } from "../permissions.js";
import { saveState, nowMs } from "../core.js";

const LIVE_WINDOW_DAYS = 14;
const LIVE_WINDOW_MS = LIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

function byNewest(a, b) {
  return Number(b?.createdAt || 0) - Number(a?.createdAt || 0);
}

function byOldest(a, b) {
  return Number(a?.createdAt || 0) - Number(b?.createdAt || 0);
}

function splitNewsBuckets(stories) {
  const cutoff = nowMs() - LIVE_WINDOW_MS;
  const live = stories.filter((s) => Number(s.createdAt || 0) >= cutoff).sort(byNewest);
  const archive = stories.filter((s) => Number(s.createdAt || 0) < cutoff).sort(byOldest);

  const liveMain = live.filter((s) => !s.flavour);
  const liveOther = live.filter((s) => Boolean(s.flavour));
  const liveBreaking = live.filter((s) => s.isBreaking);

  return { liveMain, liveOther, liveBreaking, archive };
}

function renderStoryCard(story, small = false) {
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
    </article>
  `;
}

function renderGrid(items, small = false, emptyMessage = "No stories yet.") {
  if (!items.length) return `<div class="muted-block">${esc(emptyMessage)}</div>`;
  return `<div class="news-grid">${items.map((s) => renderStoryCard(s, small)).join("")}</div>`;
}

function renderTopStory(mainItems) {
  const top = mainItems[0];
  if (!top) return `<div class="muted-block">No Top Story in the last ${LIVE_WINDOW_DAYS} days.</div>`;
  return renderStoryCard(top);
}

function renderArchive(archiveStories) {
  if (!archiveStories.length) return `<div class="muted-block">No archived stories yet.</div>`;
  return `
    <div class="small" style="margin-bottom:10px;">Showing items older than ${LIVE_WINDOW_DAYS} days in chronological order (oldest first).</div>
    <div class="news-grid">${archiveStories.map((s) => renderStoryCard(s, true)).join("")}</div>
  `;
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
    data.news.stories.unshift({
      id: `news-${Math.random().toString(36).slice(2, 10)}`,
      createdAt: nowMs(),
      simDate: sim,
      isBreaking,
      category: type === "other" ? "Other" : "Politics",
      headline,
      imageUrl: imageUrl || "",
      text,
      flavour: type === "other"
    });

    saveState(data);
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

export function initNewsPage(data) {
  const renderAll = () => {
    const stories = (data.news?.stories || []).slice().sort(byNewest);
    const { liveMain, liveOther, liveBreaking, archive } = splitNewsBuckets(stories);

    const breakingPanel = document.getElementById("bbcBreakingPanel");
    if (breakingPanel) breakingPanel.style.display = liveBreaking.length ? "" : "none";
    const ticker = liveBreaking.map((s) => esc(s.headline)).join("   •   ");
    setHTML("bbcBreakingTicker", `<span class="bbc-breaking-track">${ticker}</span>`);

    setHTML("bbcTopStory", renderTopStory(liveMain));
    setHTML("bbcMainNews", renderGrid(liveMain, false, `No Main News in the last ${LIVE_WINDOW_DAYS} days.`));
    setHTML("bbcOtherNews", renderGrid(liveOther, true, `No Other News in the last ${LIVE_WINDOW_DAYS} days.`));
    setHTML("bbcArchive", renderArchive(archive));
  };

  renderAll();
  bindArchiveToggle();
  bindNewsDesk(data, renderAll);
}
