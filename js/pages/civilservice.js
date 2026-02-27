import { nowStamp } from "../core.js";
import { esc } from "../ui.js";
import { isAdmin, isMod, canRaiseCivilServiceCase, canAdminOrMod } from "../permissions.js";
import { getCharacterContext } from "../engines/core-engine.js";
import { formatSimMonthYear } from "../clock.js";
import { apiGetCsBriefings, apiCreateCsBriefing, apiUpdateCsBriefing, apiDeleteCsBriefing, apiGetCsCases, apiCreateCsCase, apiUpdateCsCase, apiDeleteCsCase } from "../api.js";

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
  { id: "health", name: "Health Department", officeId: "health", officeTitle: "Secretary of State for Health and Social Care" },
  { id: "dot", name: "DoT", officeId: "eti", officeTitle: "Secretary of State for Transport and Infrastructure" },
  { id: "dcms", name: "DCMS", officeId: "culture", officeTitle: "Secretary of State for Culture, Media and Sport" },
  { id: "home-nations", name: "Department of the Home Nations", officeId: "home-nations", officeTitle: "Secretary of State for the Home Nations" }
];

function canModerate(data) {
  return canAdminOrMod(data);
}

function getMyOfficeId(data) {
  return String(getCharacterContext(data)?.office || "");
}

/** Returns current sim month/year as a timestamp label for new entries. */
function simStamp(data) {
  return formatSimMonthYear(data?.gameState || {});
}

function getMyOfficeIds(data) {
  const c = getCharacterContext(data);
  if (Array.isArray(c?.offices) && c.offices.length) return c.offices;
  const single = String(c?.office || "");
  return single ? [single] : [];
}

function isGovernmentMember(data) {
  const myOffices = getMyOfficeIds(data);
  return CS_DEPARTMENTS.some((d) => myOffices.includes(d.officeId));
}

function canAccessDepartment(data, officeId) {
  return canRaiseCivilServiceCase(data, officeId);
}

// ── Briefing visibility ──────────────────────────────────────────────────────

function canSeeBriefing(data, briefing) {
  if (canModerate(data)) return true;
  const myOffices = getMyOfficeIds(data);
  if (!myOffices.length) return false;
  if (myOffices.includes(String(briefing.target_officeId || ""))) return true;
  return Array.isArray(briefing.cc_officeIds) && briefing.cc_officeIds.some((cc) => myOffices.includes(cc));
}

function canActOnBriefing(data, briefing) {
  if (canModerate(data)) return true;
  const myOffices = getMyOfficeIds(data);
  return myOffices.includes(String(briefing.target_officeId || ""));
}

// ── Briefing normalisation ───────────────────────────────────────────────────

function normaliseBriefing(b) {
  b.id = Number(b.id || 0);
  b.target_officeId = String(b.target_officeId || "");
  b.cc_officeIds = Array.isArray(b.cc_officeIds) ? b.cc_officeIds.map(String) : [];
  b.title = String(b.title || "").trim();
  b.status = b.status === "closed" ? "closed" : "open";
  b.currentStageIdx = b.status === "closed" ? null : Number(b.currentStageIdx ?? 0);
  b.createdAt = String(b.createdAt || nowStamp());
  b.createdBy = String(b.createdBy || "Moderator");
  b.auditLog = Array.isArray(b.auditLog) ? b.auditLog : [];
  b.stages = Array.isArray(b.stages) ? b.stages : [];
  for (const s of b.stages) {
    s.id = String(s.id || "");
    s.title = String(s.title || "").trim();
    s.text = String(s.text || "").trim();
    s.options = Array.isArray(s.options) ? s.options : [];
    for (const o of s.options) {
      o.id = String(o.id || "");
      o.label = String(o.label || "").trim();
      o.nextStageIdx = o.nextStageIdx != null ? Number(o.nextStageIdx) : null;
    }
  }
  for (const entry of b.auditLog) {
    entry.stageTitle = String(entry.stageTitle || "");
    entry.chosenOptionLabel = String(entry.chosenOptionLabel || "");
    entry.actorName = String(entry.actorName || "Unknown");
    entry.actorOffice = String(entry.actorOffice || "");
    entry.at = String(entry.at || "");
  }
}

function selectedDeptFromUrl() {
  try {
    const url = new URL(window.location.href);
    return String(url.searchParams.get("dept") || "").trim();
  } catch {
    return "";
  }
}

function setDeptInUrl(deptId) {
  try {
    const url = new URL(window.location.href);
    if (deptId) {
      url.searchParams.set("dept", deptId);
    } else {
      url.searchParams.delete("dept");
    }
    window.history.replaceState({}, "", url.toString());
  } catch {
    // no-op in non-browser contexts
  }
}

function normaliseCivilService(data) {
  data.civilService ??= {};
  data.civilService.departments ??= CS_DEPARTMENTS.map((d) => ({ ...d }));
  data.civilService.cases ??= [];
  data.civilService.nextCaseId ??= 1;
  data.civilService.briefings ??= [];
  data.civilService.nextBriefingId ??= 1;

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

  for (const b of data.civilService.briefings) {
    normaliseBriefing(b);
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

// ── Briefings UI helpers ─────────────────────────────────────────────────────

function renderBriefingCard(data, b, state) {
  const open = state.openBriefingId === b.id;
  const mod = canModerate(data);
  const canAct = canActOnBriefing(data, b);
  const targetDept = CS_DEPARTMENTS.find((d) => d.officeId === b.target_officeId);
  const ccNames = (b.cc_officeIds || []).map((id) => {
    const d = CS_DEPARTMENTS.find((dept) => dept.officeId === id);
    return d ? d.name : id;
  }).join(", ") || "None";

  const stage = (b.stages.length > 0 && b.currentStageIdx != null)
    ? b.stages[b.currentStageIdx] || null
    : null;

  return `
    <article class="tile" style="margin-top:10px;">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap;">
        <div>
          <b>Briefing #${b.id}: ${esc(b.title)}</b>
          <div class="muted">Target: ${esc(targetDept?.name || b.target_officeId)} • CC: ${esc(ccNames)} • ${b.status === "open" ? "Open" : "Closed"}</div>
          <div class="muted">Created by ${esc(b.createdBy)} at ${esc(b.createdAt)}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${mod && b.status === "open" ? `<button type="button" class="btn" data-action="close-briefing" data-id="${b.id}">Close Briefing</button>` : ""}
          ${mod ? `<button type="button" class="btn danger" data-action="delete-briefing" data-id="${b.id}">Delete</button>` : ""}
          <button type="button" class="btn" data-action="toggle-briefing" data-id="${b.id}">${open ? "Collapse" : "View"}</button>
        </div>
      </div>

      ${open ? `
        <div style="margin-top:10px;">
          ${stage ? `
            <div class="tile" style="background:var(--color-bg,#f8f8f8);margin-bottom:8px;">
              <h3 style="margin:0 0 4px;">${esc(stage.title)}</h3>
              <p style="white-space:pre-wrap;margin:0 0 8px;">${esc(stage.text)}</p>
              ${canAct && b.status === "open" && stage.options.length ? `
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                  ${stage.options.map((opt) => `
                    <button type="button" class="btn" data-action="choose-briefing-option"
                      data-briefing-id="${b.id}" data-stage-idx="${b.currentStageIdx}"
                      data-opt-id="${esc(opt.id)}" data-opt-label="${esc(opt.label)}"
                      data-next-stage-idx="${opt.nextStageIdx != null ? opt.nextStageIdx : ""}">
                      ${esc(opt.label)}
                    </button>
                  `).join("")}
                </div>
              ` : (b.status === "open" && !canAct ? '<div class="muted">Awaiting ministerial decision.</div>' : "")}
            </div>
          ` : `<div class="muted-block">No active stage — briefing ${b.status === "closed" ? "closed" : "has no stages configured"}.${b.awaitingNextStage && mod ? "" : ""}</div>
            ${b.awaitingNextStage && mod ? `
              <div style="margin-top:8px;">
                <b>Stage decision recorded.</b> Choose the next action:
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
                  <button type="button" class="btn" data-action="launch-next-stage" data-id="${b.id}">Launch Next Stage</button>
                  <button type="button" class="btn danger" data-action="end-briefing" data-id="${b.id}">End Briefing</button>
                </div>
                <form id="next-stage-form-${b.id}" data-briefing-id="${b.id}" style="display:none;margin-top:8px;">
                  <input name="stageTitle" class="input" required placeholder="Stage title" style="margin-bottom:4px;">
                  <textarea name="stageText" class="input" rows="3" placeholder="Stage instructions" style="margin-bottom:4px;"></textarea>
                  <input name="optA" class="input" placeholder="Option A label" style="margin-bottom:4px;">
                  <input name="optB" class="input" placeholder="Option B label (optional)" style="margin-bottom:4px;">
                  <div style="display:flex;gap:6px;">
                    <button type="submit" class="btn" data-briefing-id="${b.id}">Launch Stage</button>
                    <button type="button" class="btn" data-action="cancel-next-stage" data-id="${b.id}">Cancel</button>
                  </div>
                </form>
              </div>
            ` : ""}`}

          ${b.auditLog.length ? `
            <details style="margin-top:8px;">
              <summary class="muted" style="cursor:pointer;">Decision log (${b.auditLog.length})</summary>
              ${b.auditLog.map((entry) => `
                <div class="muted" style="margin-top:4px;font-size:.9em;">
                  <b>${esc(entry.actorName)}</b> (${esc(entry.actorOffice)}) chose "<em>${esc(entry.chosenOptionLabel)}</em>" on stage "${esc(entry.stageTitle)}" at ${esc(entry.at)}
                </div>
              `).join("")}
            </details>
          ` : ""}
        </div>
      ` : ""}
    </article>
  `;
}

function renderModBriefingEditor(data, state) {
  const officeOptions = CS_DEPARTMENTS.map((d) => `<option value="${esc(d.officeId)}">${esc(d.name)} (${esc(d.officeId)})</option>`).join("");
  return `
    <section class="panel" style="margin-bottom:12px;">
      <h2 style="margin-top:0;">Create Briefing</h2>
      <form id="cs-new-briefing-form">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-bottom:8px;">
          <div>
            <label class="label" for="bf-title">Briefing Title</label>
            <input id="bf-title" class="input" name="title" required placeholder="Briefing title">
          </div>
          <div>
            <label class="label" for="bf-target">Target Office</label>
            <select id="bf-target" class="input" name="target_officeId" required>
              <option value="">— select —</option>
              ${officeOptions}
            </select>
          </div>
        </div>
        <label class="label" for="bf-cc">CC Offices (hold Ctrl/Cmd to select multiple)</label>
        <select id="bf-cc" class="input" name="cc_officeIds" multiple style="height:80px;">
          ${officeOptions}
        </select>
        <p class="muted" style="margin:4px 0 8px;">The Prime Minister must be explicitly CC'd to receive this briefing.</p>
        <label class="label" for="bf-stage-title">First Stage Title</label>
        <input id="bf-stage-title" class="input" name="stageTitle" required placeholder="e.g. Initial Brief">
        <label class="label" for="bf-stage-text">First Stage Text</label>
        <textarea id="bf-stage-text" class="input" name="stageText" rows="4" required placeholder="Briefing content…"></textarea>
        <label class="label" for="bf-opt-a">Option A Label</label>
        <input id="bf-opt-a" class="input" name="optA" placeholder="e.g. Accept the recommendation">
        <label class="label" for="bf-opt-b">Option B Label</label>
        <input id="bf-opt-b" class="input" name="optB" placeholder="e.g. Request further advice">
        <button type="submit" class="btn" style="margin-top:8px;">Create Briefing</button>
      </form>
    </section>
  `;
}

// ── Main render ──────────────────────────────────────────────────────────────

function render(data, state) {
  const host = document.getElementById("civilservice-root") || document.querySelector("main.wrap");
  if (!host) return;

  normaliseCivilService(data);
  const char = getCharacterContext(data);
  const mod = canModerate(data);
  const myOfficeId = getMyOfficeId(data);
  const govMember = isGovernmentMember(data);

  // Enforce minister-only visibility: non-mods only see their own department.
  const visibleDepts = mod
    ? data.civilService.departments
    : data.civilService.departments.filter((d) => canAccessDepartment(data, d.officeId));

  const requestedDeptId = state.selectedDeptId || selectedDeptFromUrl();
  const hasDeptSelected = Boolean(requestedDeptId);

  // Detect URL-manipulation: requested dept exists in global list but not visible to this user.
  const requestedDeptExists = hasDeptSelected && data.civilService.departments.some((d) => d.id === requestedDeptId);
  const requestedDeptVisible = !hasDeptSelected || visibleDepts.some((d) => d.id === requestedDeptId);
  const accessDenied = requestedDeptExists && !requestedDeptVisible;

  const dept = hasDeptSelected
    ? (visibleDepts.find((d) => d.id === requestedDeptId) || (accessDenied ? null : visibleDepts[0]))
    : visibleDepts[0];

  state.selectedDeptId = hasDeptSelected && dept ? dept.id : "";

  // Briefings visible to this user.
  const myBriefings = data.civilService.briefings.filter((b) => canSeeBriefing(data, b));

  let deptCases = [];
  if (dept) {
    deptCases = data.civilService.cases
      .filter((c) => c.deptId === dept.id)
      .sort((a, b) => b.id - a.id);
  }

  host.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Civil Service</div></div>

    ${(!mod && !govMember) ? `
      <section class="panel">
        <div class="muted-block">You hold no departmental office. Speak to your Party Leader if you want to join the Frontbench, but remember, you might not be in Government ... yet.</div>
      </section>
    ` : accessDenied ? `
      <section class="panel">
        <div class="muted-block">You do not have access to that department. Only the minister responsible for that office can view it.</div>
        <button type="button" class="btn" style="margin-top:8px;" data-action="back-to-directory">Back to your departments</button>
      </section>
    ` : `

      ${mod ? renderModBriefingEditor(data, state) : ""}

      <section class="tile" style="margin-bottom:12px;">
        <h2 style="margin-top:0;">Departmental Briefings</h2>
        <p class="muted" style="margin-bottom:0;">Mod-authored briefings for ministers. The Prime Minister only receives briefings they are CC'd on.</p>
      </section>

      <section class="panel" style="margin-bottom:12px;">
        ${myBriefings.length
          ? myBriefings.sort((a, b) => b.id - a.id).map((b) => renderBriefingCard(data, b, state)).join("")
          : '<div class="muted-block">No briefings assigned to your office.</div>'}
      </section>

      <section class="tile" style="margin-bottom:12px;">
        <h2 style="margin-top:0;">Department Case Tickets</h2>
        <p class="muted" style="margin-bottom:0;">Government members raise department cases. Mods/Admin respond as Civil Servants and can close cases.</p>
      </section>

      ${!hasDeptSelected ? `
      <section class="panel" style="margin-bottom:12px;">
        <h2 style="margin-top:0;">Your Departments</h2>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;">
          ${visibleDepts.length ? visibleDepts.map((d) => {
            const openCount = data.civilService.cases.filter((c) => c.deptId === d.id && c.status === "open").length;
            const closedCount = data.civilService.cases.filter((c) => c.deptId === d.id && c.status === "closed").length;
            return `
              <article class="tile card-flex">
                <div><b>${esc(d.name)} Office</b></div>
                <div class="muted" style="margin-top:6px;">${esc(d.officeTitle)}</div>
                <div class="muted" style="margin-top:6px;">Open: ${openCount} • Closed: ${closedCount}</div>
                <div class="tile-bottom">
                  <button class="btn" type="button" data-action="open-dept" data-id="${esc(d.id)}">Open Office</button>
                </div>
              </article>
            `;
          }).join("") : '<div class="muted-block">No departments assigned to your office.</div>'}
        </div>
      </section>
      ` : ""}

      ${hasDeptSelected && dept ? `
      <section class="panel">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap;">
          <h2 style="margin:0;">${esc(dept.name)} Office</h2>
          <button type="button" class="btn" data-action="back-to-directory">Back to Departments</button>
        </div>
        <p class="muted">${esc(dept.officeTitle)}</p>

        ${canAccessDepartment(data, dept.officeId) ? `
          <form id="cs-new-case-form" style="margin-bottom:10px;">
            <label class="label" for="cs-case-title">Open New Case</label>
            <input id="cs-case-title" class="input" name="title" required placeholder="Case title">
            ${mod ? `
            <div style="display:flex;gap:16px;margin:6px 0;">
              <label><input type="radio" name="csPosterChoice" value="character" checked> My Character</label>
              <label><input type="radio" name="csPosterChoice" value="npc"> Civil Servant (NPC)</label>
            </div>` : ""}
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
                  ${mod ? `<button type="button" class="btn danger" data-action="delete-case" data-id="${c.id}">Delete</button>` : ""}
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
      ` : ""}

      ${state.message ? `<p class="muted" style="margin-top:8px;">${esc(state.message)}</p>` : ""}
    `}
  `;

  // ── Event listeners ────────────────────────────────────────────────────────

  // Mod: create briefing
  host.querySelector("#cs-new-briefing-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!mod) return;
    const fd = new FormData(e.currentTarget);
    const title = String(fd.get("title") || "").trim();
    const target_officeId = String(fd.get("target_officeId") || "").trim();
    const cc_officeIds = fd.getAll("cc_officeIds").map(String).filter(Boolean);
    const stageTitle = String(fd.get("stageTitle") || "").trim();
    const stageText = String(fd.get("stageText") || "").trim();
    const optA = String(fd.get("optA") || "").trim();
    const optB = String(fd.get("optB") || "").trim();
    if (!title || !target_officeId || !stageTitle || !stageText) return;

    const options = [];
    if (optA) options.push({ id: "a", label: optA, nextStageIdx: null });
    if (optB) options.push({ id: "b", label: optB, nextStageIdx: null });

    const briefing = {
      id: data.civilService.nextBriefingId++,
      target_officeId,
      cc_officeIds,
      title,
      status: "open",
      currentStageIdx: 0,
      createdAt: simStamp(data),
      createdBy: String(char?.name || data?.currentUser?.username || "Moderator"),
      auditLog: [],
      stages: [{ id: "s1", title: stageTitle, text: stageText, options }]
    };
    normaliseBriefing(briefing);
    try {
      const r = await apiCreateCsBriefing(briefing);
      briefing.id = r.id;
      data.civilService.briefings.unshift(briefing);
    } catch (err) {
      console.error("[cs] create briefing failed:", err);
    }
    state.message = `Briefing #${briefing.id} created.`;
    render(data, state);
  });

  // Minister/mod: choose a briefing stage option
  host.querySelectorAll('[data-action="choose-briefing-option"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const briefingId = Number(btn.dataset.briefingId || 0);
      const stageIdx = Number(btn.dataset.stageIdx || 0);
      const optId = String(btn.dataset.optId || "");
      const optLabel = String(btn.dataset.optLabel || "");
      const nextRaw = btn.dataset.nextStageIdx;
      const nextStageIdx = nextRaw !== "" && nextRaw != null ? Number(nextRaw) : null;

      const briefing = data.civilService.briefings.find((b) => b.id === briefingId);
      if (!briefing || briefing.status === "closed") return;
      if (!canActOnBriefing(data, briefing)) return;
      if (briefing.currentStageIdx !== stageIdx) return;

      const stage = briefing.stages[stageIdx];
      briefing.auditLog.push({
        stageTitle: stage?.title || String(stageIdx),
        chosenOptionLabel: optLabel,
        actorName: String(char?.name || data?.currentUser?.username || "Unknown"),
        actorOffice: myOfficeId,
        at: simStamp(data)
      });

      if (nextStageIdx != null && nextStageIdx < briefing.stages.length) {
        briefing.currentStageIdx = nextStageIdx;
      } else {
        // Stage complete — hold open so mod can launch next stage or end briefing
        briefing.currentStageIdx = null;
        briefing.awaitingNextStage = true;
      }

      apiUpdateCsBriefing(briefingId, { currentStageIdx: briefing.currentStageIdx, awaitingNextStage: briefing.awaitingNextStage, auditLog: briefing.auditLog, stages: briefing.stages }).catch(err => console.error("[cs] option failed:", err));
      state.message = `Decision recorded on Briefing #${briefingId}.`;
      render(data, state);
    });
  });

  // Mod: launch next stage after decision
  host.querySelectorAll('[data-action="launch-next-stage"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!mod) return;
      const id = Number(btn.dataset.id || 0);
      const form = host.querySelector(`#next-stage-form-${id}`);
      if (form) form.style.display = form.style.display === "none" ? "block" : "none";
    });
  });
  host.querySelectorAll('[data-action="cancel-next-stage"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.id || 0);
      const form = host.querySelector(`#next-stage-form-${id}`);
      if (form) form.style.display = "none";
    });
  });
  host.querySelectorAll('[data-action="end-briefing"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!mod) return;
      const id = Number(btn.dataset.id || 0);
      const briefing = data.civilService.briefings.find((b) => b.id === id);
      if (!briefing || briefing.status === "closed") return;
      briefing.status = "closed";
      briefing.awaitingNextStage = false;
      briefing.currentStageIdx = null;
      apiUpdateCsBriefing(id, { status: "closed", awaitingNextStage: false, currentStageIdx: null }).catch(err => console.error("[cs] end failed:", err));
      state.message = `Briefing #${id} ended.`;
      render(data, state);
    });
  });
  host.querySelectorAll('[id^="next-stage-form-"]').forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!mod) return;
      const id = Number(form.dataset.briefingId || form.id.replace("next-stage-form-", ""));
      const briefing = data.civilService.briefings.find((b) => b.id === id);
      if (!briefing || briefing.status === "closed") return;
      const fd = new FormData(form);
      const stageTitle = String(fd.get("stageTitle") || "").trim();
      const stageText  = String(fd.get("stageText")  || "").trim();
      const optA = String(fd.get("optA") || "").trim();
      const optB = String(fd.get("optB") || "").trim();
      if (!stageTitle) return;
      const options = [];
      if (optA) options.push({ id: "a", label: optA, nextStageIdx: null });
      if (optB) options.push({ id: "b", label: optB, nextStageIdx: null });
      const newIdx = briefing.stages.length;
      briefing.stages.push({ id: `s${newIdx + 1}`, title: stageTitle, text: stageText, options });
      briefing.currentStageIdx = newIdx;
      briefing.awaitingNextStage = false;
      apiUpdateCsBriefing(id, { stages: briefing.stages, currentStageIdx: briefing.currentStageIdx, awaitingNextStage: false }).catch(err => console.error("[cs] launch failed:", err));
      state.message = `Stage ${newIdx + 1} launched on Briefing #${id}.`;
      render(data, state);
    });
  });

  // Mod: close briefing
  host.querySelectorAll('[data-action="close-briefing"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!mod) return;
      const id = Number(btn.dataset.id || 0);
      const briefing = data.civilService.briefings.find((b) => b.id === id);
      if (!briefing || briefing.status === "closed") return;
      briefing.status = "closed";
      briefing.currentStageIdx = null;
      apiUpdateCsBriefing(id, { status: "closed", currentStageIdx: null }).catch(err => console.error("[cs] close failed:", err));
      state.message = `Briefing #${id} closed.`;
      render(data, state);
    });
  });

  // Toggle briefing detail
  host.querySelectorAll('[data-action="toggle-briefing"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.id || 0);
      state.openBriefingId = state.openBriefingId === id ? null : id;
      render(data, state);
    });
  });

  // Mod: delete briefing
  host.querySelectorAll('[data-action="delete-briefing"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!mod) return;
      const id = Number(btn.dataset.id || 0);
      data.civilService.briefings = data.civilService.briefings.filter((b) => b.id !== id);
      if (state.openBriefingId === id) state.openBriefingId = null;
      apiDeleteCsBriefing(id).catch(err => console.error("[cs] del briefing failed:", err));
      state.message = `Briefing #${id} deleted.`;
      render(data, state);
    });
  });

  host.querySelectorAll('[data-action="open-dept"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedDeptId = String(btn.dataset.id || "");
      state.openCaseId = null;
      setDeptInUrl(state.selectedDeptId);
      render(data, state);
    });
  });

  host.querySelector('[data-action="back-to-directory"]')?.addEventListener("click", () => {
    state.selectedDeptId = "";
    state.openCaseId = null;
    setDeptInUrl("");
    render(data, state);
  });

  host.querySelector("#cs-new-case-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!dept || !canAccessDepartment(data, dept.officeId)) return;
    const fd = new FormData(e.currentTarget);
    const title = String(fd.get("title") || "").trim();
    const body = String(fd.get("body") || "").trim();
    if (!title || !body) return;

    const posterChoice = mod
      ? ((e.currentTarget.querySelector('input[name="csPosterChoice"]:checked') || {}).value || "character")
      : "character";
    const isNpcPost = mod && posterChoice === "npc";
    const author = isNpcPost ? "Civil Servant" : String(char?.name || "Government Member").trim();
    const avatar = isNpcPost ? "" : String(char?.avatar || "").trim();

    const caseItem = {
      id: data.civilService.nextCaseId++,
      deptId: dept.id,
      title,
      status: "open",
      createdBy: author,
      createdByAvatar: avatar,
      createdAt: simStamp(data),
      messages: [
        {
          authorName: author,
          authorRole: "government",
          avatar,
          text: body,
          createdAt: simStamp(data)
        }
      ]
    };
    try {
      const result = await apiCreateCsCase(caseItem);
      caseItem.id = result.id;
      data.civilService.cases.unshift(caseItem);
    } catch (err) {
      console.error("[cs] create case failed:", err);
    }
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
      item.closedAt = simStamp(data);
      item.closedBy = String(char?.name || data?.currentUser?.username || "Civil Service Moderator");
      apiUpdateCsCase(id, { status: "closed", closedAt: item.closedAt, closedBy: item.closedBy }).catch(err => console.error("[cs] close case failed:", err));
      state.message = `Case #${id} closed.`;
      render(data, state);
    });
  });

  host.querySelectorAll('[data-action="delete-case"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!mod) return;
      const id = Number(btn.dataset.id || 0);
      data.civilService.cases = data.civilService.cases.filter((c) => c.id !== id);
      if (state.openCaseId === id) state.openCaseId = null;
      apiDeleteCsCase(id).catch(err => console.error("[cs] del case failed:", err));
      state.message = `Case #${id} deleted.`;
      render(data, state);
    });
  });

  host.querySelectorAll('form[data-action="post-message"]').forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!dept) return;
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
        createdAt: simStamp(data)
      });
      apiUpdateCsCase(id, { messages: item.messages }).catch(err => console.error("[cs] msg failed:", err));
      state.message = `Reply added to Case #${id}.`;
      state.openCaseId = id;
      render(data, state);
    });
  });
}

export async function initCivilServicePage(data) {
  normaliseCivilService(data);
  try {
    const [br, cs] = await Promise.all([apiGetCsBriefings(), apiGetCsCases()]);
    data.civilService.briefings = br.briefings || [];
    data.civilService.cases = cs.cases || [];
  } catch (err) {
    console.error("[cs] load failed:", err);
  }
  render(data, { selectedDeptId: selectedDeptFromUrl(), openCaseId: null, openBriefingId: null, message: "" });
}
