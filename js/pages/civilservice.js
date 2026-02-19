import { saveData } from "../core.js";
import { esc } from "../ui.js";
import { isAdmin, isMod } from "../permissions.js";

const CS_DEPARTMENTS = [
  { id: "10ds", name: "10 Downing Street", officeId: "prime-minister", officeTitle: "Prime Minister, First Lord of the Treasury, and Minister for the Civil Service" },
  { id: "11ds", name: "11 Downing Street", officeId: "chancellor", officeTitle: "Chancellor of the Exchequer, and Second Lord of the Treasury" },
  { id: "home-office", name: "Home Office", officeId: "home", officeTitle: "Secretary of State for the Home Department" },
  { id: "foreign-office", name: "Foreign Office", officeId: "foreign", officeTitle: "Secretary of State for Foreign and Commonwealth Affairs" },
  { id: "board-trade", name: "Board of Trade", officeId: "trade", officeTitle: "Secretary of State for Business and Trade, and President of the Board of Trade" },
  { id: "mod", name: "MoD", officeId: "defence", officeTitle: "Secretary of State for Defence" },
  { id: "dwp", name: "DWP", officeId: "welfare", officeTitle: "Secretary of State for Work and Pensions" },
  { id: "education", name: "Education Department", officeId: "education", officeTitle: "Secretary of State for Education" },
  { id: "dea", name: "DEA", officeId: "env-agri", officeTitle: "Secretary of State for the Environment and Agriculture" },
  { id: "health", name: "Health Department", officeId: "health", officeTitle: "Secretary of State for Health and Social" },
  { id: "dot", name: "DoT", officeId: "eti", officeTitle: "Security Secretary of State for the Environment, Transport and Infrastructure" },
  { id: "dcms", name: "DCMS", officeId: "culture", officeTitle: "Secretary of State for Culture, Media and Sport" },
  { id: "home-nations", name: "Department of the Home Nations", officeId: "home-nations", officeTitle: "Secretary of State for the Home Nations" }
];

function nowStamp() {
  return new Date().toLocaleString("en-GB", { hour12: false });
}

function getChar(data) {
  return data?.currentCharacter || data?.currentPlayer || {};
}

function canModerate(data) {
  return isAdmin(data) || isMod(data);
}

function isGovernmentMember(data) {
  const office = String(getChar(data)?.office || "");
  return CS_DEPARTMENTS.some((d) => d.officeId === office);
}

function canAccessDepartment(data, officeId) {
  if (canModerate(data)) return true;
  return String(getChar(data)?.office || "") === officeId;
}

function normaliseCivilService(data) {
  data.civilService ??= {};
  data.civilService.departments ??= CS_DEPARTMENTS.map((d) => ({ ...d }));
  data.civilService.cases ??= [];
  data.civilService.nextCaseId ??= 1;

  // Keep canonical department list order/shape.
  const byId = new Map((data.civilService.departments || []).map((d) => [d.id, d]));
  data.civilService.departments = CS_DEPARTMENTS.map((spec) => ({
    ...spec,
    ...(byId.get(spec.id) || {})
  }));

  for (const c of data.civilService.cases) {
    c.id = Number(c.id || 0);
    c.deptId = String(c.deptId || "");
    c.title = String(c.title || "");
    c.status = c.status === "closed" ? "closed" : "open";
    c.createdBy = String(c.createdBy || "Unknown");
    c.createdByAvatar = String(c.createdByAvatar || "");
    c.createdAt = String(c.createdAt || nowStamp());
    c.closedAt = c.closedAt ? String(c.closedAt) : "";
    c.closedBy = c.closedBy ? String(c.closedBy) : "";
    c.messages = Array.isArray(c.messages) ? c.messages : [];
    for (const m of c.messages) {
      m.authorName = String(m.authorName || "Unknown");
      m.authorRole = m.authorRole === "civil-service" ? "civil-service" : "government";
      m.avatar = String(m.avatar || "");
      m.text = String(m.text || "");
      m.createdAt = String(m.createdAt || nowStamp());
    }
  }
}

function renderMessage(m) {
  const civil = m.authorRole === "civil-service";
  return `
    <article class="tile" style="margin-bottom:8px;">
      <div style="display:flex;gap:10px;align-items:center;">
        ${m.avatar ? `<img src="${esc(m.avatar)}" alt="${esc(m.authorName)}" style="width:42px;height:42px;border-radius:999px;object-fit:cover;border:1px solid #ddd;">` : `<div class="muted-block" style="width:42px;height:42px;border-radius:999px;padding:0;display:grid;place-items:center;">${civil ? "🏛️" : "👤"}</div>`}
        <div>
          <div><b>${esc(m.authorName)}</b> ${civil ? '<span class="muted">(Civil Servant)</span>' : ""}</div>
          <div class="muted">${esc(m.createdAt)}</div>
        </div>
      </div>
      <div style="margin-top:8px;white-space:pre-wrap;">${esc(m.text)}</div>
    </article>
  `;
}

function render(data, state) {
  const host = document.getElementById("civilservice-root") || document.querySelector("main.wrap");
  if (!host) return;

  normaliseCivilService(data);
  const char = getChar(data);
  const mod = canModerate(data);
  const govMember = isGovernmentMember(data);
  const selectedDeptId = state.selectedDeptId || data.civilService.departments[0]?.id;
  const dept = data.civilService.departments.find((d) => d.id === selectedDeptId) || data.civilService.departments[0];
  if (!dept) {
    host.innerHTML = '<section class="panel"><div class="muted-block">No Civil Service departments configured.</div></section>';
    return;
  }

  state.selectedDeptId = dept.id;
  const deptCases = data.civilService.cases
    .filter((c) => c.deptId === dept.id)
    .sort((a, b) => b.id - a.id);

  host.innerHTML = `
    <h1 class="page-title">Civil Service</h1>

    ${(!mod && !govMember) ? `
      <section class="panel">
        <div class="muted-block">You are a Backbencher, Speak to your Party Leader if you want to join their Government.</div>
      </section>
    ` : `
      <section class="tile" style="margin-bottom:12px;">
        <h2 style="margin-top:0;">Department Case Tickets</h2>
        <p class="muted" style="margin-bottom:0;">Government members raise department cases. Mods/Admin respond as Civil Servants and can close cases.</p>
      </section>

      <section class="panel" style="margin-bottom:12px;">
        <h2 style="margin-top:0;">Departments</h2>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;">
          ${data.civilService.departments.map((d) => {
            const accessible = canAccessDepartment(data, d.officeId);
            const openCount = data.civilService.cases.filter((c) => c.deptId === d.id && c.status === "open").length;
            const closedCount = data.civilService.cases.filter((c) => c.deptId === d.id && c.status === "closed").length;
            return `
              <article class="tile card-flex">
                <div><b>${esc(d.name)}</b></div>
                <div class="muted" style="margin-top:6px;">${esc(d.officeTitle)}</div>
                <div class="muted" style="margin-top:6px;">Open: ${openCount} • Closed: ${closedCount}</div>
                <div class="tile-bottom">
                  <button class="btn" type="button" data-action="open-dept" data-id="${esc(d.id)}" ${accessible ? "" : "disabled"}>${accessible ? "Open" : "No Access"}</button>
                </div>
              </article>
            `;
          }).join("")}
        </div>
      </section>

      <section class="panel">
        <h2 style="margin-top:0;">${esc(dept.name)} Case Panel</h2>
        <p class="muted">${esc(dept.officeTitle)}</p>

        ${canAccessDepartment(data, dept.officeId) ? `
          <form id="cs-new-case-form" style="margin-bottom:10px;">
            <label class="label" for="cs-case-title">Open New Case</label>
            <input id="cs-case-title" class="input" name="title" required placeholder="Case title">
            <label class="label" for="cs-case-body">Initial Message</label>
            <textarea id="cs-case-body" class="input" name="body" rows="3" required placeholder="Describe the case"></textarea>
            <button type="submit" class="btn">Create Case</button>
          </form>
        ` : `<div class="muted-block">No access to open cases for this department.</div>`}

        ${deptCases.length ? deptCases.map((c) => {
          const open = state.openCaseId === c.id;
          const canPost = c.status === "open" && (mod || canAccessDepartment(data, dept.officeId));
          return `
            <article class="tile" style="margin-top:10px;">
              <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap;">
                <div>
                  <b>Case #${c.id}: ${esc(c.title)}</b>
                  <div class="muted">By ${esc(c.createdBy)} • ${esc(c.createdAt)} • ${c.status === "open" ? "Open" : "Closed"}</div>
                  ${c.status === "closed" ? `<div class="muted">Closed by ${esc(c.closedBy || "Civil Service")} at ${esc(c.closedAt || "-")}</div>` : ""}
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                  ${mod && c.status === "open" ? `<button type="button" class="btn" data-action="close-case" data-id="${c.id}">Close Case</button>` : ""}
                  <button type="button" class="btn" data-action="toggle-case" data-id="${c.id}">${open ? "Close" : "Open"}</button>
                </div>
              </div>

              ${open ? `
                <div style="margin-top:10px;">
                  ${c.messages.length ? c.messages.map(renderMessage).join("") : '<div class="muted-block">No messages yet.</div>'}
                  ${canPost ? `
                    <form data-action="post-message" data-id="${c.id}">
                      <label class="label" for="cs-message-${c.id}">Add Comment</label>
                      <textarea id="cs-message-${c.id}" class="input" name="text" rows="3" required placeholder="Write your message"></textarea>
                      <button type="submit" class="btn">Post Comment</button>
                    </form>
                  ` : '<div class="muted-block">Case closed — no further comments.</div>'}
                </div>
              ` : ""}
            </article>
          `;
        }).join("") : '<div class="muted-block">No cases for this department yet.</div>'}
      </section>

      ${state.message ? `<p class="muted" style="margin-top:8px;">${esc(state.message)}</p>` : ""}
    `}
  `;

  host.querySelectorAll('[data-action="open-dept"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedDeptId = String(btn.dataset.id || "");
      state.openCaseId = null;
      render(data, state);
    });
  });

  host.querySelector("#cs-new-case-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!canAccessDepartment(data, dept.officeId)) return;
    const fd = new FormData(e.currentTarget);
    const title = String(fd.get("title") || "").trim();
    const body = String(fd.get("body") || "").trim();
    if (!title || !body) return;

    const author = String(char?.name || "Government Member").trim();
    const avatar = String(char?.avatar || "").trim();

    const caseItem = {
      id: data.civilService.nextCaseId++,
      deptId: dept.id,
      title,
      status: "open",
      createdBy: author,
      createdByAvatar: avatar,
      createdAt: nowStamp(),
      messages: [
        {
          authorName: author,
          authorRole: "government",
          avatar,
          text: body,
          createdAt: nowStamp()
        }
      ]
    };
    data.civilService.cases.unshift(caseItem);
    saveData(data);
    state.openCaseId = caseItem.id;
    state.message = `Case #${caseItem.id} created.`;
    render(data, state);
  });

  host.querySelectorAll('[data-action="toggle-case"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.id || 0);
      state.openCaseId = state.openCaseId === id ? null : id;
      render(data, state);
    });
  });

  host.querySelectorAll('[data-action="close-case"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!mod) return;
      const id = Number(btn.dataset.id || 0);
      const item = data.civilService.cases.find((c) => c.id === id);
      if (!item || item.status === "closed") return;
      item.status = "closed";
      item.closedAt = nowStamp();
      item.closedBy = String(getChar(data)?.name || data?.currentUser?.username || "Civil Service Moderator");
      saveData(data);
      state.message = `Case #${id} closed.`;
      render(data, state);
    });
  });

  host.querySelectorAll('form[data-action="post-message"]').forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const id = Number(form.dataset.id || 0);
      const item = data.civilService.cases.find((c) => c.id === id);
      if (!item || item.status !== "open") return;
      if (!(mod || canAccessDepartment(data, dept.officeId))) return;

      const fd = new FormData(form);
      const text = String(fd.get("text") || "").trim();
      if (!text) return;

      const civil = mod;
      item.messages.push({
        authorName: civil ? "Civil Servant" : String(char?.name || "Government Member"),
        authorRole: civil ? "civil-service" : "government",
        avatar: civil ? "" : String(char?.avatar || ""),
        text,
        createdAt: nowStamp()
      });
      saveData(data);
      state.message = `Reply added to Case #${id}.`;
      state.openCaseId = id;
      render(data, state);
    });
  });
}

export function initCivilServicePage(data) {
  normaliseCivilService(data);
  saveData(data);
  render(data, { selectedDeptId: "10ds", openCaseId: null, message: "" });
}
