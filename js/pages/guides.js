import { esc } from "../ui.js";
import { canAdminOrMod } from "../permissions.js";
import { apiGetGuides, apiCreateGuide, apiUpdateGuide, apiDeleteGuide } from "../api.js";
import { isLoggedIn } from "../core.js";

function normaliseGuides(data) {
  data.guides ??= { items: [], nextId: 1 };
  if (!Array.isArray(data.guides.items)) data.guides.items = [];
  if (!Number.isFinite(data.guides.nextId) || data.guides.nextId < 1) {
    data.guides.nextId = data.guides.items.length + 1;
  }

  data.guides.items = data.guides.items
    .filter((guide) => guide && (guide.title || guide.body))
    .map((guide, idx) => ({
      id: Number(guide.id) || idx + 1,
      title: String(guide.title || "Untitled Guide"),
      body: String(guide.body || "")
    }));

  const maxId = data.guides.items.reduce((m, g) => Math.max(m, g.id), 0);
  data.guides.nextId = Math.max(data.guides.nextId, maxId + 1);
}

function renderGuideRows(data, adminMode) {
  const guides = data.guides.items || [];
  if (!guides.length) {
    return `<section class="panel"><div class="muted-block">No guides published yet.</div></section>`;
  }

  return guides
    .map((guide) => `
      <article class="panel" style="margin-bottom:12px;overflow:hidden;">
        <button
          type="button"
          data-action="toggle"
          data-guide-id="${guide.id}"
          aria-expanded="false"
          class="tile"
          style="display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:none;border:0;cursor:pointer;"
        >
          <span style="flex:1;font-weight:700;">${esc(guide.title)}</span>
          <span data-oc-label class="muted">Open</span>
        </button>
        <div data-guide-body="${guide.id}" class="tile" hidden style="display:grid;gap:8px;padding-top:0;">
          <div style="white-space:pre-wrap;line-height:1.45;">${esc(guide.body)}</div>
          ${adminMode ? `
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn" type="button" data-action="edit" data-guide-id="${guide.id}">Edit</button>
              <button class="btn" type="button" data-action="delete" data-guide-id="${guide.id}">Remove</button>
            </div>
          ` : ""}
        </div>
      </article>
    `)
    .join("");
}

function attachGuideToggles(host) {
  host.querySelectorAll('[data-action="toggle"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.guideId;
      const body = host.querySelector(`[data-guide-body="${id}"]`);
      const label = btn.querySelector("[data-oc-label]");
      if (!body || !label) return;
      const isOpen = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!isOpen));
      body.hidden = isOpen;
      label.textContent = isOpen ? "Open" : "Close";
    });
  });
}

function renderEditor(data, state) {
  const adminMode = canAdminOrMod(data);
  if (!adminMode) return "";

  const editing = data.guides.items.find((guide) => guide.id === state.editingId);
  const title = editing ? editing.title : "";
  const body = editing ? editing.body : "";

  return `
    <section class="panel">
      <h2 style="margin-top:0;">${editing ? "Edit Guide" : "Add Guide"}</h2>
      <form id="guides-editor-form" class="tile" style="display:grid;gap:10px;">
        <label>
          <div class="muted">Title</div>
          <input id="guide-title" type="text" required maxlength="150" value="${esc(title)}" style="width:100%;">
        </label>
        <label>
          <div class="muted">Guide text</div>
          <textarea id="guide-body" rows="6" required style="width:100%;">${esc(body)}</textarea>
        </label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn" type="submit">${editing ? "Save Changes" : "Add Guide"}</button>
          ${editing ? '<button class="btn" type="button" data-action="cancel-edit">Cancel</button>' : ""}
        </div>
      </form>
    </section>
  `;
}

function render(data, state) {
  const host = document.getElementById("guides-root") || document.querySelector("main.wrap");
  if (!host) return;

  const adminMode = canAdminOrMod(data);

  host.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Guides</div></div>
    <section class="panel" style="margin-bottom:12px;">
      <div class="muted-block">Guides for Rule Britannia are listed below.</div>
    </section>

    ${renderGuideRows(data, adminMode)}
    ${renderEditor(data, state)}
    ${state.message ? `<p class="muted">${esc(state.message)}</p>` : ""}
  `;

  host.querySelectorAll('[data-action="edit"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      state.editingId = Number(btn.dataset.guideId || 0) || null;
      state.message = "";
      render(data, state);
    });
  });

  host.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!adminMode) return;
      const id = Number(btn.dataset.guideId || 0);
      data.guides.items = data.guides.items.filter((guide) => guide.id !== id);
      if (state.editingId === id) state.editingId = null;
      apiDeleteGuide(id).catch(err => console.error("[guides] delete failed:", err)); // UI_ONLY_OK: admin CMS guide deletion; no simulation-outcome consequence
      state.message = "Guide removed.";
      render(data, state);
    });
  });

  const cancelBtn = host.querySelector('[data-action="cancel-edit"]');
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      state.editingId = null;
      state.message = "";
      render(data, state);
    });
  }

  const form = host.querySelector("#guides-editor-form");
  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!adminMode) return;

      const title = String(host.querySelector("#guide-title")?.value || "").trim();
      const body = String(host.querySelector("#guide-body")?.value || "").trim();
      if (!title || !body) {
        state.message = "Title and guide text are required.";
        render(data, state);
        return;
      }

      if (state.editingId) {
        const target = data.guides.items.find((guide) => guide.id === state.editingId);
        if (target) {
          target.title = title;
          target.body = body;
          await apiUpdateGuide(state.editingId, { title, body });
          state.message = "Guide updated.";
        }
      } else {
        const result = await apiCreateGuide({ title, body });
        data.guides.items.unshift({
          id: result.item.id,
          title,
          body
        });
        state.message = "Guide added.";
      }

      state.editingId = null;
      render(data, state);
    });
  }

  attachGuideToggles(host);
}

export async function initGuidesPage(data) {
  if (isLoggedIn()) {
    try {
      const r = await apiGetGuides();
      data.guides = data.guides || {};
      data.guides.items = r.items || [];
      data.guides.nextId = Math.max(0, ...(r.items || []).map(i => Number(i.id) || 0)) + 1;
    } catch (err) {
      console.error("[guides] load failed:", err);
      normaliseGuides(data);
    }
  } else {
    normaliseGuides(data);
  }
  render(data, { editingId: null, message: "" });
}
