import { setHTML, esc } from "../ui.js";

export function initQuestionTimePage(data) {
  const root = document.getElementById("question-time-root") || document.getElementById("qt-root");
  if (!root) return;

  const offices = data.questionTime?.offices || [];
  if (!offices.length) {
    root.innerHTML = `<div class="muted-block">No offices configured in demo.json.</div>`;
    return;
  }

  root.innerHTML = `
    <div class="muted-block" style="margin-bottom:12px;">
      Ministers have <b>1 simulation month</b> to answer a question. The Speaker may demand an answer within <b>1 more simulation month</b>.
    </div>

    <div class="qt-grid">
      ${offices.map(o => `
        <div class="qt-tile card-flex">
          <div class="qt-office">${esc(o.title)}</div>
          <div class="muted" style="margin-top:6px;">Secretary of State: ${esc(o.holder || "—")}</div>
          <div class="tile-bottom">
            <a class="btn" href="qt-office.html?office=${encodeURIComponent(o.id)}">Open</a>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}
