import { saveData } from "../core.js";
import { esc } from "../ui.js";
import { isAdmin } from "../permissions.js";

function normaliseRules(data) {
  data.rules ??= { items: [], nextId: 1 };
  if (!Array.isArray(data.rules.items)) data.rules.items = [];
  if (!Number.isFinite(data.rules.nextId) || data.rules.nextId < 1) {
    data.rules.nextId = data.rules.items.length + 1;
  }

  data.rules.items = data.rules.items
    .filter((rule) => rule && (rule.title || rule.body))
    .map((rule, idx) => ({
      id: Number(rule.id) || idx + 1,
      title: String(rule.title || "Untitled Rule"),
      body: String(rule.body || "")
    }));

  const maxId = data.rules.items.reduce((m, r) => Math.max(m, r.id), 0);
  data.rules.nextId = Math.max(data.rules.nextId, maxId + 1);
}

function renderRuleRows(data, adminMode) {
  const rules = data.rules.items || [];
  if (!rules.length) {
    return `<section class="panel"><div class="muted-block">No rules published yet.</div></section>`;
  }

  return rules
    .map((rule) => `
      <article class="panel" style="margin-bottom:12px;">
        <div class="tile" style="display:grid;gap:8px;">
          <h2 style="margin:0;">${esc(rule.title)}</h2>
          <div style="white-space:pre-wrap;line-height:1.45;">${esc(rule.body)}</div>
          ${adminMode ? `
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn" type="button" data-action="edit" data-rule-id="${rule.id}">Edit</button>
              <button class="btn" type="button" data-action="delete" data-rule-id="${rule.id}">Remove</button>
            </div>
          ` : ""}
        </div>
      </article>
    `)
    .join("");
}

function renderEditor(data, state) {
  const adminMode = isAdmin(data);
  if (!adminMode) return "";

  const editing = data.rules.items.find((rule) => rule.id === state.editingId);
  const title = editing ? editing.title : "";
  const body = editing ? editing.body : "";

  return `
    <section class="panel">
      <h2 style="margin-top:0;">${editing ? "Edit Rule" : "Add Rule"}</h2>
      <form id="rules-editor-form" class="tile" style="display:grid;gap:10px;">
        <label>
          <div class="muted">Title</div>
          <input id="rule-title" type="text" required maxlength="150" value="${esc(title)}" style="width:100%;">
        </label>
        <label>
          <div class="muted">Rule text</div>
          <textarea id="rule-body" rows="6" required style="width:100%;">${esc(body)}</textarea>
        </label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn" type="submit">${editing ? "Save Changes" : "Add Rule"}</button>
          ${editing ? '<button class="btn" type="button" data-action="cancel-edit">Cancel</button>' : ""}
        </div>
      </form>
    </section>
  `;
}

function render(data, state) {
  const host = document.getElementById("rules-root") || document.querySelector("main.wrap");
  if (!host) return;

  const adminMode = isAdmin(data);

  host.innerHTML = `
    <h1 class="page-title">Rules</h1>
    <section class="panel" style="margin-bottom:12px;">
      <div class="muted-block">Core rules of Rule Britannia are listed below.</div>
    </section>

    ${renderRuleRows(data, adminMode)}
    ${renderEditor(data, state)}
    ${state.message ? `<p class="muted">${esc(state.message)}</p>` : ""}
  `;

  host.querySelectorAll('[data-action="edit"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      state.editingId = Number(btn.dataset.ruleId || 0) || null;
      state.message = "";
      render(data, state);
    });
  });

  host.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!adminMode) return;
      const id = Number(btn.dataset.ruleId || 0);
      data.rules.items = data.rules.items.filter((rule) => rule.id !== id);
      if (state.editingId === id) state.editingId = null;
      saveData(data);
      state.message = "Rule removed.";
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

  const form = host.querySelector("#rules-editor-form");
  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!adminMode) return;

      const title = String(host.querySelector("#rule-title")?.value || "").trim();
      const body = String(host.querySelector("#rule-body")?.value || "").trim();
      if (!title || !body) {
        state.message = "Title and rule text are required.";
        render(data, state);
        return;
      }

      if (state.editingId) {
        const target = data.rules.items.find((rule) => rule.id === state.editingId);
        if (target) {
          target.title = title;
          target.body = body;
          state.message = "Rule updated.";
        }
      } else {
        data.rules.items.unshift({
          id: data.rules.nextId,
          title,
          body
        });
        data.rules.nextId += 1;
        state.message = "Rule added.";
      }

      state.editingId = null;
      saveData(data);
      render(data, state);
    });
  }
}

export function initRulesPage(data) {
  normaliseRules(data);
  saveData(data);
  render(data, { editingId: null, message: "" });
}
