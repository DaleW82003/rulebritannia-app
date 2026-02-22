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

function normaliseCabinet(data) {
  data.cabinet ??= {};
  data.cabinet.headline ??= {
    text: "Cabinet agenda and top messages from the Prime Minister will appear here.",
    updatedAt: nowStamp(),
    updatedBy: "Prime Minister"
  };
  data.cabinet.hqUrl ??= "https://forum.rulebritannia.org/c/government/cabinet-office";
  data.cabinet.nextDraftId ??= 1;
  data.cabinet.drafts ??= [];

  for (const d of data.cabinet.drafts) {
    d.id = Number(d.id || 0);
    d.ref = String(d.ref || `CAB ${d.id || ""}`).trim();
    d.title = String(d.title || "").trim();
    d.purpose = String(d.purpose || "").trim();
    d.body = String(d.body || "").trim();
    d.authorName = String(d.authorName || "").trim();
    d.authorId = String(d.authorId || "").trim();
    d.discussUrl = String(d.discussUrl || "").trim();
    d.createdAt = String(d.createdAt || nowStamp());
    d.updatedAt = d.updatedAt ? String(d.updatedAt) : "";
  }

  data.government ??= {};
  data.government.offices ??= [];
}

function getCabinetMemberNames(data) {
  const names = new Set();
  for (const office of data.government?.offices || []) {
    if (office?.holderName) names.add(String(office.holderName));
  }
  return names;
}

function canAccessCabinet(data) {
  if (isManager(data)) return true;
  const charName = String(getChar(data)?.name || "").trim();
  if (!charName) return false;
  return getCabinetMemberNames(data).has(charName);
}

function isPrimeMinister(data) {
  if (isManager(data)) return true;
  return String(getChar(data)?.office || "") === "prime-minister";
}

function discussUrlForDraft(data, draft) {
  if (draft.discussUrl) return draft.discussUrl;
  const slug = encodeURIComponent(String(draft.title || `cabinet-draft-${draft.id || ""}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, ""));
  return `https://forum.rulebritannia.org/c/government/cabinet-office/${slug || `draft-${draft.id || "new"}`}`;
}

function render(data, state) {
  const host = document.getElementById("cabinet-root") || document.querySelector("main.wrap");
  if (!host) return;

  normaliseCabinet(data);
  const char = getChar(data);
  const manager = isManager(data);
  const canAccess = canAccessCabinet(data);
  const canPostHeadline = isPrimeMinister(data);
  const drafts = [...(data.cabinet.drafts || [])].sort((a, b) => b.id - a.id);
  const editingDraft = state.editingDraftId ? data.cabinet.drafts.find((d) => d.id === state.editingDraftId) : null;

  if (!canAccess) {
    host.innerHTML = `
      <div class="bbc-masthead"><div class="bbc-title">Cabinet</div></div>
      <section class="panel">
        <div class="muted-block">You are not part of the Government Cabinet. Access is limited to cabinet members and moderators/admins.</div>
      </section>
    `;
    return;
  }

  host.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Cabinet Chamber</div></div>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Prime Minister Headline</h2>
      <div class="tile" style="white-space:pre-wrap;">${esc(data.cabinet.headline.text)}</div>
      <p class="muted" style="margin-top:8px;">Updated by ${esc(data.cabinet.headline.updatedBy || "Prime Minister")} • ${esc(data.cabinet.headline.updatedAt || "")}</p>

      ${canPostHeadline ? `
        <form id="cabinet-headline-form">
          <label class="label" for="cabinet-headline-text">Update Cabinet Headline</label>
          <textarea id="cabinet-headline-text" class="input" name="text" rows="3" required>${esc(data.cabinet.headline.text || "")}</textarea>
          <button type="submit" class="btn">Save Headline</button>
        </form>
      ` : ""}
    </section>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Enter Cabinet Office</h2>
      <p class="muted">Private government discussion space for cabinet members and moderators.</p>
      <a class="btn" href="${esc(data.cabinet.hqUrl)}" target="_blank" rel="noopener">Enter Cabinet Office</a>
    </section>

    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Cabinet Draft a Bill</h2>
      <p class="muted">Internal drafting only. No amendments, divisions, or speaker controls. Author-only edit.</p>
      <form id="cabinet-draft-form">
        ${renderDraftingBuilder("cabinet-draft", editingDraft)}
        <button type="submit" class="btn">${editingDraft ? "Update Draft" : "Save Draft"}</button>
      </form>
    </section>

    <section class="panel">
      <h2 style="margin-top:0;">Cabinet Drafts</h2>
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
                  <a class="btn" href="${esc(discussUrlForDraft(data, d))}" target="_blank" rel="noopener">Discuss</a>
                  ${canEdit ? `<button type="button" class="btn" data-action="edit-draft" data-id="${d.id}">Edit</button>` : ""}
                  ${manager ? `<button type="button" class="btn" data-action="delete-draft" data-id="${d.id}">Delete</button>` : ""}
                </div>
              </div>
            ` : ""}
          </article>
        `;
      }).join("") : `<div class="muted-block">No cabinet drafts yet.</div>`}
    </section>

    ${state.message ? `<p class="muted" style="margin-top:8px;">${esc(state.message)}</p>` : ""}
  `;

  host.querySelector("#cabinet-headline-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!canPostHeadline) return;
    const fd = new FormData(e.currentTarget);
    const text = String(fd.get("text") || "").trim();
    if (!text) return;
    data.cabinet.headline.text = text;
    data.cabinet.headline.updatedAt = nowStamp();
    data.cabinet.headline.updatedBy = String(char?.name || "Prime Minister");
    saveState(data);
    state.message = "Cabinet headline updated.";
    render(data, state);
  });

  wireDraftingBuilder(host.querySelector("#cabinet-draft-form"), "cabinet-draft");

  host.querySelector("#cabinet-draft-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const { title, purpose, body, discussUrl, department, articleCount, extent, commencement, articles } = parseDraftingForm(e.currentTarget, data);
    if (!title || !purpose || !body) return;

    if (state.editingDraftId) {
      const draft = data.cabinet.drafts.find((x) => x.id === state.editingDraftId);
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

    const id = Number(data.cabinet.nextDraftId || 1);
    data.cabinet.nextDraftId = id + 1;
    const authorName = String(char?.name || "Cabinet Member");
    const draft = {
      id,
      ref: `CAB ${id}`,
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
    data.cabinet.drafts.unshift(draft);
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
      const draft = data.cabinet.drafts.find((x) => x.id === id);
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
      const idx = data.cabinet.drafts.findIndex((x) => x.id === id);
      if (idx === -1) return;
      const [deleted] = data.cabinet.drafts.splice(idx, 1);
      saveState(data);
      if (state.openDraftId === id) state.openDraftId = null;
      if (state.editingDraftId === id) state.editingDraftId = null;
      state.message = `Deleted ${deleted.ref}.`;
      render(data, state);
    });
  });
}

export function initCabinetPage(data) {
  normaliseCabinet(data);
  saveState(data);
  render(data, { openDraftId: null, editingDraftId: null, message: "" });
}
