import { formatSimMonthYear, getSimDate, formatSimDate } from "../clock.js";
import { setHTML, esc } from "../ui.js";
import { canPostNews, canAdminOrMod, canAdminModOrSpeaker, canRightOfReply } from "../permissions.js";
import { nowMs } from "../core.js";
import {
  apiGetNews, apiCreateNewsStory, apiUpdateNewsStory, apiDeleteNewsStory,
  apiGetNewsComments, apiCreateNewsComment, apiDeleteNewsComment, apiReportNewsComment,
  apiCreateNewsReplyRequest, apiGetNewsReplyRequests, apiGetMyReplyRequests, apiResolveNewsReplyRequest,
} from "../api.js";

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

function renderOfficialResponses(responses) {
  if (!responses || !responses.length) return "";
  const ROLE_LABELS = {
    "prime-minister": "Prime Minister",
    "leader-opposition": "Leader of the Opposition",
    "party-leader-3rd-4th": "Third Party Leader",
    "speaker": "Speaker",
  };
  return responses.map((r) => `
    <div class="official-response" style="margin-top:10px;border-left:3px solid #003f7d;padding:6px 10px;background:#f0f4ff;">
      <div style="font-size:.8em;font-weight:600;color:#003f7d;margin-bottom:4px;">
        ★ OFFICIAL RESPONSE — ${esc(ROLE_LABELS[r.charRole] || r.charRole || "Official")}${r.charName ? ` (${esc(r.charName)})` : ""}
      </div>
      <div style="font-size:.9em;">${esc(r.text)}</div>
    </div>
  `).join("");
}

function renderStoryCard(story, small = false, canDelete = false, canReply = false, myReplyStatus = null) {
  const replyBtn = canReply ? (() => {
    if (myReplyStatus === "pending") {
      return `<button class="btn small" type="button" disabled title="Your request is being reviewed">⏳ Reply Pending</button>`;
    }
    if (myReplyStatus === "published") {
      return `<span class="muted small">✓ Reply published</span>`;
    }
    if (myReplyStatus === "rejected") {
      return `<button class="btn small" data-action="request-reply" data-id="${esc(story.id)}" data-headline="${esc(story.headline)}" type="button">Request Right of Reply</button>`;
    }
    return `<button class="btn small" data-action="request-reply" data-id="${esc(story.id)}" data-headline="${esc(story.headline)}" type="button">Request Right of Reply</button>`;
  })() : "";

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
      ${renderOfficialResponses(story.officialResponses)}
      ${(canDelete || replyBtn) ? `<div class="tile-bottom" style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
        ${canDelete ? `<button class="btn" data-action="edit-story" data-id="${esc(story.id)}" type="button">Edit</button>
        <button class="btn danger" data-action="delete-story" data-id="${esc(story.id)}" type="button">Delete</button>` : ""}
        ${replyBtn}
      </div>` : ""}
      <div class="news-comments-section" style="margin-top:8px;">
        <button class="btn small" data-action="toggle-comments" data-id="${esc(story.id)}" type="button">Have Your Say</button>
        <div class="news-comments-panel" data-story-id="${esc(story.id)}" style="display:none;margin-top:6px;"></div>
      </div>
    </article>
  `;
}

function renderGrid(items, small = false, emptyMessage = "No stories yet.", canDelete = false, canReply = false, myReplyMap = {}) {
  if (!items.length) return `<div class="muted-block">${esc(emptyMessage)}</div>`;
  return `<div class="news-grid">${items.map((s) => renderStoryCard(s, small, canDelete, canReply, myReplyMap[s.id] ?? null)).join("")}</div>`;
}

function renderTopStory(mainItems, canDelete = false, canReply = false, myReplyMap = {}) {
  const top = mainItems[0];
  if (!top) return `<div class="muted-block">No Top Story available.</div>`;
  return renderStoryCard(top, false, canDelete, canReply, myReplyMap[top.id] ?? null);
}

function renderArchive(archiveStories, canDelete = false, canReply = false, myReplyMap = {}) {
  if (!archiveStories.length) return `<div class="muted-block">No archived stories yet.</div>`;
  return `
    <div class="small" style="margin-bottom:10px;">Archived items in chronological order (oldest first).</div>
    <div class="news-grid">${archiveStories.map((s) => renderStoryCard(s, true, canDelete, canReply, myReplyMap[s.id] ?? null)).join("")}</div>
  `;
}

const MAX_COMMENT_LENGTH = 400;

const CHAR_ROLE_LABELS = {
  "prime-minister": "Prime Minister",
  "leader-opposition": "Leader of the Opposition",
  "party-leader-3rd-4th": "Third Party Leader",
  "speaker": "Speaker",
};

function renderHaveYourSayList(comments, currentUserId, canStaff) {
  if (!comments.length) return `<div class="muted" style="font-size:.85em;">No comments yet. Be the first to have your say.</div>`;
  return comments.map((c) => {
    if (c.isDeleted) {
      const label = c.deletedByUser ? "User deleted this comment" : "Removed by staff";
      const originalBlock = (canStaff && c.originalText)
        ? `<div style="margin-top:4px;padding:4px;background:#fff3cd;border-radius:3px;font-style:italic;font-size:.85em;">[Staff view] ${esc(c.originalText)}</div>`
        : "";
      return `
        <div class="comment-item deleted" style="font-size:.85em;color:#888;padding:6px 0;border-bottom:1px solid #eee;">
          <em>${label}</em>${originalBlock}
        </div>`;
    }
    const canDel = canStaff || (currentUserId && c.createdBy === currentUserId);
    const simLabel = (c.simMonth && c.simYear) ? esc(formatSimDate(c.simMonth, c.simYear)) : "";
    const isReported = !!c.reportedAt;
    return `
      <div class="comment-item${isReported && canStaff ? " reported" : ""}" style="font-size:.85em;padding:6px 0;border-bottom:1px solid #eee;${isReported && canStaff ? "background:#fff3cd;" : ""}" data-comment-id="${esc(c.id)}">
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;">
          <span style="font-weight:600;">${esc(c.displayName || "Member")}</span>
          ${simLabel ? `<span class="muted" style="font-size:.85em;">${simLabel}</span>` : ""}
          ${isReported && canStaff ? `<span style="font-size:.75em;background:#f44;color:#fff;border-radius:3px;padding:1px 4px;">REPORTED</span>` : ""}
          ${canDel ? `<button class="btn danger small" data-action="delete-hys-comment" data-comment-id="${esc(c.id)}" type="button" style="margin-left:auto;padding:1px 6px;font-size:.8em;">Delete</button>` : ""}
          ${canStaff ? `<button class="btn small" data-action="promote-hys-comment" data-comment-id="${esc(c.id)}" data-comment-text="${esc(c.text || "")}" type="button" style="padding:1px 6px;font-size:.8em;">Promote</button>` : ""}
          ${!isReported ? `<button class="btn small" data-action="report-hys-comment" data-comment-id="${esc(c.id)}" type="button" style="padding:1px 6px;font-size:.8em;color:#888;">Report</button>` : ""}
        </div>
        <div style="margin-top:3px;">${esc(c.text)}</div>
      </div>
    `;
  }).join("");
}

function bindHaveYourSayToggles(data) {
  document.querySelectorAll("[data-action='toggle-comments']").forEach((btn) => {
    if (btn.dataset.commentsBound) return;
    btn.dataset.commentsBound = "1";
    btn.addEventListener("click", async () => {
      const storyId = btn.dataset.id;
      const panel = btn.closest(".news-comments-section")?.querySelector(".news-comments-panel");
      if (!panel) return;
      if (panel.style.display !== "none") {
        panel.style.display = "none";
        btn.textContent = "Have Your Say";
        return;
      }
      panel.style.display = "";
      btn.textContent = "Loading…";
      if (!panel.dataset.loaded) {
        panel.innerHTML = `<div class="muted" style="font-size:.85em;">Loading…</div>`;
        try {
          const r = await apiGetNewsComments(storyId);
          panel.dataset.loaded = "1";
          refreshHaveYourSayPanel(panel, storyId, r.comments || [], data);
        } catch (err) {
          panel.innerHTML = `<div class="muted" style="font-size:.85em;">Failed to load comments.</div>`;
          btn.textContent = "Have Your Say";
          console.error("[news] load comments failed:", err);
        }
      }
    });
  });
}

function refreshHaveYourSayPanel(panel, storyId, comments, data) {
  const currentUserId = data.currentUser?.id;
  const canStaff = canAdminModOrSpeaker(data);
  const activeCount = comments.filter((c) => !c.isDeleted).length;
  const toggleBtn = panel.closest(".news-comments-section")?.querySelector("[data-action='toggle-comments']");
  if (toggleBtn) toggleBtn.textContent = `Have Your Say (${activeCount})`;
  panel.innerHTML = `
    <div style="font-size:.8em;font-weight:600;color:#333;margin-bottom:6px;border-bottom:2px solid #c00;padding-bottom:4px;">
      📣 Have Your Say — ${activeCount} comment${activeCount !== 1 ? "s" : ""}
    </div>
    <div class="hys-list">${renderHaveYourSayList(comments, currentUserId, canStaff)}</div>
    <form class="hys-form" style="margin-top:8px;" data-story-id="${esc(storyId)}">
      <div style="position:relative;">
        <textarea class="input hys-text" rows="2" maxlength="${MAX_COMMENT_LENGTH}"
          placeholder="Have your say… (${MAX_COMMENT_LENGTH} character limit, one comment per sim-month)"
          style="width:100%;resize:vertical;" required></textarea>
        <span class="hys-charcount" style="position:absolute;bottom:4px;right:6px;font-size:.75em;color:#888;">0/${MAX_COMMENT_LENGTH}</span>
      </div>
      <div style="margin-top:4px;display:flex;gap:6px;">
        <button class="btn primary" type="submit" style="font-size:.85em;">Post Comment</button>
      </div>
    </form>
  `;
  // Live char count
  const textarea = panel.querySelector(".hys-text");
  const counter = panel.querySelector(".hys-charcount");
  textarea?.addEventListener("input", () => {
    const len = textarea.value.length;
    if (counter) {
      counter.textContent = `${len}/${MAX_COMMENT_LENGTH}`;
      counter.style.color = len >= MAX_COMMENT_LENGTH ? "#c00" : "#888";
    }
  });
  // Delete buttons
  panel.querySelectorAll("[data-action='delete-hys-comment']").forEach((delBtn) => {
    delBtn.addEventListener("click", async () => {
      const commentId = delBtn.dataset.commentId;
      delBtn.disabled = true;
      try {
        await apiDeleteNewsComment(storyId, commentId);
        const isAuthor = comments.find((c) => c.id === commentId)?.createdBy === currentUserId;
        const updated = comments.map((c) => c.id === commentId
          ? { ...c, isDeleted: true, text: null, displayName: null, deletedByUser: isAuthor }
          : c);
        comments.splice(0, comments.length, ...updated);
        refreshHaveYourSayPanel(panel, storyId, comments, data);
      } catch (err) {
        console.error("[news] delete comment failed:", err);
        delBtn.disabled = false;
      }
    });
  });
  // Report buttons
  panel.querySelectorAll("[data-action='report-hys-comment']").forEach((repBtn) => {
    repBtn.addEventListener("click", async () => {
      const commentId = repBtn.dataset.commentId;
      repBtn.disabled = true;
      try {
        await apiReportNewsComment(storyId, commentId);
        repBtn.textContent = "Reported";
        repBtn.style.color = "#c00";
      } catch (err) {
        const msg = err.message || "";
        repBtn.disabled = false;
        if (msg.includes("Already reported")) { repBtn.textContent = "Already reported"; return; }
        console.error("[news] report comment failed:", err);
      }
    });
  });
  // Promote buttons (mods/admin/speaker only) — opens news desk with prefilled headline
  panel.querySelectorAll("[data-action='promote-hys-comment']").forEach((proBtn) => {
    proBtn.addEventListener("click", () => {
      const storyHeadline = panel.closest("article.news-card")?.querySelector(".news-headline")?.textContent?.trim() || "";
      const commentText = proBtn.dataset.commentText || "";
      // Pre-fill the news desk form and open it
      const newsDeskPanel = document.getElementById("bbcNewsDeskPanel");
      const headlineInput = document.getElementById("newsHeadline");
      const textInput = document.getElementById("newsText");
      if (headlineInput) headlineInput.value = `Public backlash after: ${storyHeadline}`.slice(0, 160);
      if (textInput) textInput.value = `Community reaction: "${commentText}"`;
      if (newsDeskPanel) {
        newsDeskPanel.style.display = "";
        newsDeskPanel.scrollIntoView({ behavior: "smooth" });
      }
    });
  });
  // Post form
  panel.querySelector(".hys-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const ta = panel.querySelector(".hys-text");
    const text = ta?.value?.trim();
    if (!text) return;
    const submitBtn = panel.querySelector(".hys-form button[type='submit']");
    if (submitBtn) submitBtn.disabled = true;
    try {
      const r = await apiCreateNewsComment(storyId, text);
      const newComment = {
        id: r.id,
        text,
        createdBy: currentUserId,
        displayName: r.displayName || data.currentUser?.username || "",
        simMonth: r.simMonth,
        simYear: r.simYear,
        createdAt: r.createdAt || new Date().toISOString(),
        isDeleted: false,
        deletedByUser: false,
      };
      comments.push(newComment);
      if (ta) ta.value = "";
      refreshHaveYourSayPanel(panel, storyId, comments, data);
    } catch (err) {
      console.error("[news] post comment failed:", err);
      if (submitBtn) submitBtn.disabled = false;
      const errDiv = document.createElement("div");
      errDiv.style.cssText = "color:#c00;font-size:.85em;margin-top:4px;";
      errDiv.textContent = err.message || "Failed to post. Please try again.";
      panel.querySelector(".hys-form")?.appendChild(errDiv);
      setTimeout(() => errDiv.remove(), 5000);
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

function bindRightOfReplyButtons(data, myReplyMap) {
  document.querySelectorAll("[data-action='request-reply']").forEach((btn) => {
    if (btn.dataset.replyBound) return;
    btn.dataset.replyBound = "1";
    btn.addEventListener("click", () => {
      const storyId = btn.dataset.id;
      const headline = btn.dataset.headline || "";
      // Show inline form below the button
      const existingForm = btn.parentElement?.querySelector(".reply-request-form");
      if (existingForm) { existingForm.remove(); return; }
      const form = document.createElement("form");
      form.className = "reply-request-form";
      form.style.cssText = "margin-top:6px;display:flex;flex-direction:column;gap:6px;";
      form.innerHTML = `
        <textarea class="input" id="rrf-text-${esc(storyId)}" rows="3" maxlength="2000"
          placeholder="Optional: draft your response (mods may edit before publishing)…"
          style="resize:vertical;font-size:.85em;"></textarea>
        <div style="display:flex;gap:6px;">
          <button class="btn primary" type="submit" style="font-size:.85em;">Submit Request</button>
          <button class="btn" type="button" style="font-size:.85em;" class="rrf-cancel">Cancel</button>
        </div>
        <div class="rrf-status" style="font-size:.8em;color:#555;"></div>
      `;
      form.querySelector("[type='button']").addEventListener("click", () => form.remove());
      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const textDraft = form.querySelector("textarea")?.value?.trim() || "";
        const submitBtn = form.querySelector("[type='submit']");
        const statusDiv = form.querySelector(".rrf-status");
        if (submitBtn) submitBtn.disabled = true;
        try {
          await apiCreateNewsReplyRequest(storyId, textDraft);
          myReplyMap[storyId] = "pending";
          form.innerHTML = `<div style="color:#007700;font-size:.85em;">✓ Request submitted. Mods will review your request.</div>`;
          btn.disabled = true;
          btn.textContent = "⏳ Reply Pending";
        } catch (err) {
          const msg = err.message || "";
          if (submitBtn) submitBtn.disabled = false;
          if (statusDiv) statusDiv.textContent = msg.includes("already have") ? "You already have a pending request for this story." : (msg || "Failed to submit request.");
        }
      });
      btn.parentElement?.appendChild(form);
    });
  });
}

async function bindReplyRequestsPanel(data) {
  if (!canAdminOrMod(data)) return;
  const existing = document.getElementById("bbcReplyRequestsPanel");
  if (existing) return;
  let requests;
  try {
    const r = await apiGetNewsReplyRequests();
    requests = r.requests || [];
  } catch (err) {
    console.error("[news] load reply requests failed:", err);
    return;
  }
  const pending = requests.filter((r) => r.status === "pending");
  if (!pending.length) return;

  const panel = document.createElement("section");
  panel.id = "bbcReplyRequestsPanel";
  panel.className = "panel";
  panel.style.cssText = "border-left:3px solid #003f7d;margin-bottom:12px;";
  panel.innerHTML = `
    <h2 style="margin-top:0;color:#003f7d;">📬 Right of Reply Requests (${pending.length} pending)</h2>
    <div id="bbcReplyRequestsList">
      ${pending.map((req) => `
        <div class="reply-request-item" data-req-id="${esc(req.id)}" data-story-id="${esc(req.storyId)}" style="border:1px solid #ccc;border-radius:4px;padding:10px;margin-bottom:8px;">
          <div style="font-size:.85em;font-weight:600;">${esc(req.charName || "Unknown")} <span class="muted">(${esc(CHAR_ROLE_LABELS[req.charRole] || req.charRole)})</span></div>
          <div style="font-size:.8em;color:#555;">Re: <em>${esc(req.storyHeadline || req.storyId)}</em></div>
          ${req.textDraft ? `<div style="font-size:.85em;margin-top:6px;padding:6px;background:#f9f9f9;border-radius:3px;font-style:italic;">"${esc(req.textDraft)}"</div>` : `<div class="muted small" style="margin-top:4px;">No draft provided.</div>`}
          <div style="margin-top:8px;">
            <textarea class="input rrf-official-resp" rows="3" maxlength="2000"
              placeholder="Official response text (required to publish)…"
              style="font-size:.85em;resize:vertical;">${esc(req.textDraft || "")}</textarea>
          </div>
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn primary" data-action="publish-reply" type="button" style="font-size:.85em;">Publish Response</button>
            <button class="btn" data-action="reject-reply" type="button" style="font-size:.85em;">Reject</button>
          </div>
          <div style="margin-top:4px;">
            <input class="input rrf-mod-note" type="text" maxlength="300" placeholder="Mod note (visible to requester on reject, optional)…" style="font-size:.8em;">
          </div>
          <div class="rrf-action-status" style="font-size:.8em;margin-top:4px;"></div>
        </div>
      `).join("")}
    </div>
  `;
  // Bind publish/reject buttons
  panel.querySelectorAll(".reply-request-item").forEach((item) => {
    const reqId = item.dataset.reqId;
    const storyId = item.dataset.storyId;
    const statusDiv = item.querySelector(".rrf-action-status");
    const publishBtn = item.querySelector("[data-action='publish-reply']");
    const rejectBtn = item.querySelector("[data-action='reject-reply']");

    publishBtn?.addEventListener("click", async () => {
      const officialResponse = item.querySelector(".rrf-official-resp")?.value?.trim() || "";
      const modNote = item.querySelector(".rrf-mod-note")?.value?.trim() || "";
      if (!officialResponse) { if (statusDiv) statusDiv.textContent = "Please enter an official response text."; return; }
      publishBtn.disabled = true;
      try {
        await apiResolveNewsReplyRequest(storyId, reqId, { action: "publish", officialResponse, modNote });
        item.style.opacity = "0.5";
        if (statusDiv) statusDiv.textContent = "✓ Published.";
        publishBtn.disabled = true; rejectBtn.disabled = true;
      } catch (err) { if (statusDiv) statusDiv.textContent = err.message || "Failed."; publishBtn.disabled = false; }
    });
    rejectBtn?.addEventListener("click", async () => {
      const modNote = item.querySelector(".rrf-mod-note")?.value?.trim() || "";
      rejectBtn.disabled = true;
      try {
        await apiResolveNewsReplyRequest(storyId, reqId, { action: "reject", modNote });
        item.style.opacity = "0.5";
        if (statusDiv) statusDiv.textContent = "Rejected.";
        publishBtn.disabled = true; rejectBtn.disabled = true;
      } catch (err) { if (statusDiv) statusDiv.textContent = err.message || "Failed."; rejectBtn.disabled = false; }
    });
  });

  const newsDeskPanel = document.getElementById("bbcNewsDeskPanel");
  if (newsDeskPanel?.parentNode) {
    newsDeskPanel.parentNode.insertBefore(panel, newsDeskPanel);
  } else {
    document.querySelector("main")?.append(panel);
  }
}

export async function initNewsPage(data) {
  // Load stories, my reply-request statuses (if reply-eligible), and reply requests (if mod)
  let myReplyMap = {}; // storyId → status ("pending"|"published"|"rejected"|null)
  const canReply = canRightOfReply(data);
  const canDelete = canAdminOrMod(data);

  try {
    const r = await apiGetNews();
    data.news = data.news || { stories: [], categories: [] };
    data.news.stories = r.stories.map(s => ({ ...s, createdAt: new Date(s.createdAt).getTime(), officialResponses: s.officialResponses || [] }));
  } catch (err) {
    console.error("[news] load failed:", err);
  }

  if (canReply) {
    try {
      const mr = await apiGetMyReplyRequests();
      for (const req of (mr.requests || [])) {
        // Keep the most recent status per story
        if (!myReplyMap[req.storyId]) myReplyMap[req.storyId] = req.status;
      }
    } catch (err) {
      console.error("[news] load my reply requests failed:", err);
    }
  }

  const renderAll = () => {
    const stories = (data.news?.stories || []).slice().sort(byNewest);
    const { liveMain, liveOther, liveBreaking, archive } = splitNewsBuckets(stories, data.gameState);

    const breakingPanel = document.getElementById("bbcBreakingPanel");
    if (breakingPanel) breakingPanel.style.display = liveBreaking.length ? "" : "none";
    const ticker = liveBreaking.map((s) => esc(s.headline)).join("   •   ");
    setHTML("bbcBreakingTicker", `<span class="bbc-breaking-track">${ticker}</span>`);

    setHTML("bbcTopStory", renderTopStory(liveMain, canDelete, canReply, myReplyMap));
    setHTML("bbcMainNews", renderGrid(liveMain, false, `No Main News available.`, canDelete, canReply, myReplyMap));
    setHTML("bbcOtherNews", renderGrid(liveOther, true, `No Other News available.`, canDelete, canReply, myReplyMap));
    setHTML("bbcArchive", renderArchive(archive, canDelete, canReply, myReplyMap));
    bindHaveYourSayToggles(data);
    bindRightOfReplyButtons(data, myReplyMap);
  };

  renderAll();
  bindArchiveToggle();
  bindNewsDesk(data, renderAll);
  // Load reply requests panel for mods/admin (fire-and-forget, non-critical)
  bindReplyRequestsPanel(data).catch(err => console.error("[news] reply requests panel failed:", err)); // UI_ONLY_OK: mod-only news admin panel; non-critical feature

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
