import { saveState } from "../core.js";
import { esc } from "../ui.js";
import { isAdmin, isMod, canAdminOrMod } from "../permissions.js";
import { parseDraftingForm, renderDraftingBuilder, wireDraftingBuilder } from "../bill-drafting.js";

function nowStamp() {
  return new Date().toLocaleString("en-GB", { hour12: false });
}

function getChar(data) {
  return data?.currentCharacter || data?.currentPlayer || {};
}

function isManager(data) {
  return canAdminOrMod(data);
}

function normaliseShadowCabinet(data) {
  data.shadowCabinet ??= {};
  data.shadowCabinet.headline ??= {
    text: "Shadow Cabinet priorities and instructions from the Leader of the Opposition will appear here.",
    updatedAt: nowStamp(),
    updatedBy: "Leader of the Opposition"
  };
  data.shadowCabinet.hqUrl ??= "https://forum.rulebritannia.org/c/opposition/shadow-cabinet";
  data.shadowCabinet.nextDraftId ??= 1;
  data.shadowCabinet.drafts ??= [];

  for (const d of data.shadowCabinet.drafts) {
    d.id = Number(d.id || 0);
    d.ref = String(d.ref || `SHD ${d.id || ""}`).trim();
    d.title = String(d.title || "").trim();
    d.purpose = String(d.purpose || "").trim();
    d.body = String(d.body || "").trim();
    d.authorName = String(d.authorName || "").trim();
    d.authorId = String(d.authorId || "").trim();
    d.discussUrl = String(d.discussUrl || "").trim();
    d.createdAt = String(d.createdAt || nowStamp());
    d.updatedAt = d.updatedAt ? String(d.updatedAt) : "";
  }

  data.opposition ??= {};
  data.opposition.offices ??= [];
}

function getShadowCabinetMemberNames(data) {
  const names = new Set();
  for (const office of data.opposition?.offices || []) {
    if (office?.holderName) names.add(String(office.holderName));
  }
  return names;
}

function canAccessShadowCabinet(data) {
  if (isManager(data)) return true;
  const charName = String(getChar(data)?.name || "").trim();
  if (!charName) return false;
  return getShadowCabinetMemberNames(data).has(charName);
}

function isOppositionLeader(data) {
  if (isManager(data)) return true;
  return String(getChar(data)?.shadowOffice || "") === "leader-opposition" || String(getChar(data)?.role || "") === "leader-opposition";
}

function discussUrlForDraft(draft) {
  if (draft.discussUrl) return draft.discussUrl;
  const slug = encodeURIComponent(String(draft.title || `shadow-draft-${draft.id || ""}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, ""));
  return `https://forum.rulebritannia.org/c/opposition/shadow-cabinet/${slug || `draft-${draft.id || "new"}`}`;
}

function render(data, state) {
  const host = document.getElementById("shadowcabinet-root") || document.querySelector("main.wrap");
  if (!host) return;

  normaliseShadowCabinet(data);
  const char = getChar(data);
  const manager = isManager(data);
  const canAccess = canAccessShadowCabinet(data);
  const canPostHeadline = isOppositionLeader(data);
  const drafts = [...(data.shadowCabinet.drafts || [])].sort((a, b) => b.id - a.id);
  const editingDraft = state.editingDraftId ? data.shadowCabinet.drafts.find((d) => d.id === state.editingDraftId) : null;

  if (!canAccess) {
    host.innerHTML = `
      <div class="bbc-masthead"><div class="bbc-title">Shadow Cabinet</div></div>
      <section class="panel">
        <div class="muted-block">You are not part of the Official Opposition Shadow Cabinet. Access is limited to shadow cabinet members and moderators/admins.</div>
      </section>
    `;
    return;
  }

  host.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Shadow Cabinet Chamber</div></div>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Leader of the Opposition Headline</h2>
      <div class="tile" style="white-space:pre-wrap;">${esc(data.shadowCabinet.headline.text)}</div>
      <p class="muted" style="margin-top:8px;">Updated by ${esc(data.shadowCabinet.headline.updatedBy || "Leader of the Opposition")} • ${esc(data.shadowCabinet.headline.updatedAt || "")}</p>

      ${canPostHeadline ? `
        <form id="shadow-headline-form">
          <label class="label" for="shadow-headline-text">Update Shadow Cabinet Headline</label>
          <textarea id="shadow-headline-text" class="input" name="text" rows="3" required>${esc(data.shadowCabinet.headline.text || "")}</textarea>
          <button type="submit" class="btn">Save Headline</button>
        </form>
      ` : ""}
    </section>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Enter the Shadow Cabinet Office</h2>
      <p class="muted">Private Opposition discussion space for the shadow cabinet and moderators.</p>
      <a class="btn" href="${esc(data.shadowCabinet.hqUrl)}" target="_blank" rel="noopener">Enter Shadow Cabinet Office</a>
    </section>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Shadow Cabinet Draft a Bill</h2>
      <p class="muted">Internal drafting only. No amendments, divisions, or speaker controls. Author-only edit.</p>
      <form id="shadow-draft-form">
        ${renderDraftingBuilder("shadow-draft", editingDraft)}
        <button type="submit" class="btn">${editingDraft ? "Update Draft" : "Save Draft"}</button>
      </form>
    </section>

    <section class="panel">
      <h2 style="margin-top:0;">Shadow Cabinet Drafts</h2>
      ${drafts.length ? drafts.map((d) => {
        const open = state.openDraftId === d.id;
        const canEdit = manager || d.authorId === String(char?.name || "");
        return `
          <article class="tile" style="margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;">
              <div>
                <b>${esc(d.ref)}:</b> ${esc(d.title)}
                <div class="muted">By ${esc(d.authorName || "Unknown")} • ${esc(d.createdAt || "")}${d.updatedAt ? ` • Updated ${esc(d.updatedAt)}` : ""}</div>
              </div>
              <button type="button" class="btn" data-action="toggle-draft" data-id="${d.id}">${open ? "Close" : "Open"}</button>
            </div>

            ${open ? `
              <div style="margin-top:10px;">
                <p><b>A Bill to make provision for:</b> ${esc(d.purpose)}</p>
                <div class="muted-block" style="white-space:pre-wrap;">${esc(d.body)}</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
                  <a class="btn" href="${esc(discussUrlForDraft(d))}" target="_blank" rel="noopener">Discuss</a>
                  ${canEdit ? `<button type="button" class="btn" data-action="edit-draft" data-id="${d.id}">Edit</button>` : ""}
                  ${manager ? `<button type="button" class="btn" data-action="delete-draft" data-id="${d.id}">Delete</button>` : ""}
                </div>
              </div>
            ` : ""}
          </article>
        `;
      }).join("") : `<div class="muted-block">No shadow cabinet drafts yet.</div>`}
    </section>

    ${state.message ? `<p class="muted" style="margin-top:8px;">${esc(state.message)}</p>` : ""}
  `;

  host.querySelector("#shadow-headline-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!canPostHeadline) return;
    const fd = new FormData(e.currentTarget);
    const text = String(fd.get("text") || "").trim();
    if (!text) return;
    data.shadowCabinet.headline.text = text;
    data.shadowCabinet.headline.updatedAt = nowStamp();
    data.shadowCabinet.headline.updatedBy = String(char?.name || "Leader of the Opposition");
    saveState(data);
    state.message = "Shadow Cabinet headline updated.";
    render(data, state);
  });

  wireDraftingBuilder(host.querySelector("#shadow-draft-form"), "shadow-draft");

  host.querySelector("#shadow-draft-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const { title, purpose, body, discussUrl, department, articleCount, extent, commencement, articles } = parseDraftingForm(e.currentTarget, data);
    if (!title || !purpose || !body) return;

    if (state.editingDraftId) {
      const draft = data.shadowCabinet.drafts.find((x) => x.id === state.editingDraftId);
      const userId = String(char?.name || "");
      if (!draft || (!manager && draft.authorId !== userId)) return;
      draft.title = title;
      draft.purpose = purpose;
      draft.body = body;
      draft.discussUrl = discussUrl;
      draft.department = department;
      draft.articleCount = articleCount;
      draft.extent = extent;
      draft.commencement = commencement;
      draft.articles = articles;
      draft.updatedAt = nowStamp();
      saveState(data);
      state.message = `Updated ${draft.ref}.`;
      state.editingDraftId = null;
      render(data, state);
      return;
    }

    const id = Number(data.shadowCabinet.nextDraftId || 1);
    data.shadowCabinet.nextDraftId = id + 1;
    const authorName = String(char?.name || "Shadow Cabinet Member");
    const draft = {
      id,
      ref: `SHD ${id}`,
      title,
      purpose,
      body,
      discussUrl,
      department,
      articleCount,
      extent,
      commencement,
      articles,
      authorName,
      authorId: authorName,
      createdAt: nowStamp()
    };
    data.shadowCabinet.drafts.unshift(draft);
    saveState(data);
    state.openDraftId = id;
    state.message = `Created ${draft.ref}.`;
    render(data, state);
  });

  host.querySelectorAll('[data-action="toggle-draft"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.id || 0);
      state.openDraftId = state.openDraftId === id ? null : id;
      render(data, state);
    });
  });

  host.querySelectorAll('[data-action="edit-draft"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.id || 0);
      const draft = data.shadowCabinet.drafts.find((x) => x.id === id);
      if (!draft) return;
      const userId = String(char?.name || "");
      if (!manager && draft.authorId !== userId) return;
      state.editingDraftId = id;
      state.message = `Editing ${draft.ref}.`;
      render(data, state);
    });
  });

  host.querySelectorAll('[data-action="delete-draft"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!manager) return;
      const id = Number(btn.dataset.id || 0);
      const idx = data.shadowCabinet.drafts.findIndex((x) => x.id === id);
      if (idx === -1) return;
      const [deleted] = data.shadowCabinet.drafts.splice(idx, 1);
      saveState(data);
      if (state.openDraftId === id) state.openDraftId = null;
      if (state.editingDraftId === id) state.editingDraftId = null;
      state.message = `Deleted ${deleted.ref}.`;
      render(data, state);
    });
  });
}

export function initShadowCabinetPage(data) {
  normaliseShadowCabinet(data);
  saveState(data);
  render(data, { openDraftId: null, editingDraftId: null, message: "" });
}
