// js/pages/support.js
// Combined list + thread UI for the Support ticketing system.
// Login required — player and staff views are differentiated by user.roles.

import { esc } from "../ui.js";
import { requireLogin } from "../auth.js";
import { toast, toastSuccess, toastError } from "../components/toast.js";
import {
  apiGetMyTickets,
  apiCreateTicket,
  apiGetTicket,
  apiPostTicketMessage,
  apiPatchTicket,
  apiStaffGetTickets,
  apiStaffGetTicket,
  apiStaffPostMessage,
  apiStaffPatchTicket,
} from "../api.js";

const POLL_INTERVAL_MS = 25000; // 25 seconds

const CATEGORIES = ["General", "Bug", "Rules Query", "Appeal", "Other"];
const STAFF_LABELS = ["bug", "rules", "appeal", "billing", "urgent", "wontfix", "duplicate"];

// ─────────────────────────────────────────────────────────────────────────────

export async function initSupportPage(_data, _user) {
  const user = await requireLogin();
  if (!user) return;

  const isStaff = Array.isArray(user.roles) &&
    (user.roles.includes("admin") || user.roles.includes("mod"));

  const root = document.getElementById("support-root") || document.querySelector("main.wrap");
  if (!root) return;

  // ── State ──────────────────────────────────────────────────────────────────
  let tickets = [];
  let selectedTicketId = null;
  let pollTimer = null;
  let lastKnownUnreadIds = new Set();

  // ── Render shell ───────────────────────────────────────────────────────────
  root.innerHTML = `
    <div class="bbc-masthead"><div class="bbc-title">Support${isStaff ? " — Staff View" : ""}</div></div>
    <div class="support-layout">
      <aside class="support-list-panel" id="support-list-panel">
        <div class="support-list-header">
          ${isStaff ? renderStaffFilters() : renderPlayerNewButton()}
        </div>
        <ul class="support-ticket-list" id="support-ticket-list" role="list">
          <li class="support-loading">Loading…</li>
        </ul>
      </aside>
      <section class="support-thread-panel" id="support-thread-panel" aria-label="Ticket thread">
        <div class="support-thread-placeholder">Select a ticket to view the conversation.</div>
      </section>
    </div>
    <dialog id="support-new-ticket-dialog" class="modal-dialog" aria-modal="true" aria-labelledby="new-ticket-title">
      <div class="modal-inner">
        <h2 id="new-ticket-title">New Support Ticket</h2>
        <form id="support-new-ticket-form" autocomplete="off">
          <label for="ticket-subject">Subject</label>
          <input id="ticket-subject" name="subject" type="text" maxlength="200" required placeholder="Brief description of your issue" />
          <label for="ticket-category">Category</label>
          <select id="ticket-category" name="category">
            ${CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}
          </select>
          <label for="ticket-message">Message</label>
          <textarea id="ticket-message" name="message" rows="6" required placeholder="Describe your issue in detail…"></textarea>
          <div class="modal-actions">
            <button type="submit" class="btn btn-primary">Submit Ticket</button>
            <button type="button" id="new-ticket-cancel" class="btn btn-secondary">Cancel</button>
          </div>
        </form>
      </div>
    </dialog>
  `;

  // ── Wire new-ticket dialog (player only) ───────────────────────────────────
  if (!isStaff) {
    const dialog = root.querySelector("#support-new-ticket-dialog");
    root.querySelector("#support-new-ticket-btn")?.addEventListener("click", () => {
      dialog.querySelector("form").reset();
      dialog.showModal?.() ?? (dialog.open = true);
    });
    root.querySelector("#new-ticket-cancel")?.addEventListener("click", () => {
      dialog.close?.() ?? (dialog.open = false);
    });
    root.querySelector("#support-new-ticket-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target;
      const subject  = form.subject.value.trim();
      const category = form.category.value;
      const message  = form.message.value.trim();
      try {
        const { id } = await apiCreateTicket(subject, category, message);
        toastSuccess("Ticket created.");
        dialog.close?.() ?? (dialog.open = false);
        await loadTickets();
        selectTicket(id);
      } catch (err) {
        toastError(err.message || "Failed to create ticket.");
      }
    });
  }

  // ── Staff filter wiring ────────────────────────────────────────────────────
  if (isStaff) {
    root.querySelector("#staff-filter-status")?.addEventListener("change", loadTickets);
    root.querySelector("#staff-filter-label")?.addEventListener("change", loadTickets);
  }

  // ── Initial load ───────────────────────────────────────────────────────────
  await loadTickets();
  startPolling();

  // ─────────────────────────────────────────────────────────────────────────
  // Helper functions
  // ─────────────────────────────────────────────────────────────────────────

  async function loadTickets() {
    try {
      let result;
      if (isStaff) {
        const status = root.querySelector("#staff-filter-status")?.value || "";
        const label  = root.querySelector("#staff-filter-label")?.value  || "";
        result = await apiStaffGetTickets({ status: status || undefined, label: label || undefined });
      } else {
        result = await apiGetMyTickets();
      }
      tickets = result.tickets || [];
      renderTicketList();
      checkForNewUnreads();
    } catch (err) {
      root.querySelector("#support-ticket-list").innerHTML =
        `<li class="support-error">Failed to load tickets: ${esc(err.message)}</li>`;
    }
  }

  function renderTicketList() {
    const list = root.querySelector("#support-ticket-list");
    if (!tickets.length) {
      list.innerHTML = `<li class="support-empty">No tickets yet.${!isStaff ? ' <button class="btn-link" id="support-new-ticket-btn-inline">Open a new ticket</button>' : ""}</li>`;
      if (!isStaff) {
        list.querySelector("#support-new-ticket-btn-inline")?.addEventListener("click", () => {
          const dialog = root.querySelector("#support-new-ticket-dialog");
          dialog.querySelector("form").reset();
          dialog.showModal?.() ?? (dialog.open = true);
        });
      }
      return;
    }
    list.innerHTML = tickets.map((t) => renderTicketListItem(t)).join("");
    list.querySelectorAll(".support-ticket-item").forEach((item) => {
      item.addEventListener("click", () => selectTicket(item.dataset.id));
    });
  }

  function renderTicketListItem(t) {
    const isSelected = t.id === selectedTicketId;
    const unread = t.unread;
    const statusBadge = `<span class="support-badge support-badge--${esc(t.status)}">${esc(t.status)}</span>`;
    const unreadDot = unread ? `<span class="support-unread-dot" aria-label="Unread messages"></span>` : "";
    const labels = isStaff && t.staff_labels?.length
      ? `<div class="support-labels">${t.staff_labels.map((l) => `<span class="support-chip">${esc(l)}</span>`).join("")}</div>`
      : "";
    const ownerLine = isStaff
      ? `<div class="support-ticket-owner">🧑 ${esc(t.created_by_username || "unknown")}</div>`
      : "";
    const lastMsg = t.last_message_at
      ? `<time class="support-ticket-time" datetime="${esc(t.last_message_at)}">${formatRelative(t.last_message_at)}</time>`
      : "";
    return `
      <li class="support-ticket-item${isSelected ? " selected" : ""}${unread ? " unread" : ""}"
          role="listitem" data-id="${esc(t.id)}" tabindex="0"
          aria-selected="${isSelected ? "true" : "false"}" aria-label="${esc(t.subject)}">
        <div class="support-ticket-row">
          ${unreadDot}
          <span class="support-ticket-subject">${esc(t.subject)}</span>
          ${statusBadge}
          ${lastMsg}
        </div>
        ${ownerLine}
        ${t.category ? `<div class="support-ticket-category">${esc(t.category)}</div>` : ""}
        ${labels}
      </li>`;
  }

  async function selectTicket(id) {
    selectedTicketId = id;
    // Re-render list to update selected highlight
    renderTicketList();
    const panel = root.querySelector("#support-thread-panel");
    panel.innerHTML = `<div class="support-loading">Loading…</div>`;
    try {
      const { ticket, messages } = isStaff
        ? await apiStaffGetTicket(id)
        : await apiGetTicket(id);
      renderThread(ticket, messages);
    } catch (err) {
      panel.innerHTML = `<div class="support-error">Failed to load ticket: ${esc(err.message)}</div>`;
    }
  }

  function renderThread(ticket, messages) {
    const panel = root.querySelector("#support-thread-panel");
    const canPostMsg = ticket.status !== "closed" || isStaff;
    const canFinish  = !isStaff && ticket.status === "open";
    const canReopen  = !isStaff && (ticket.status === "finished" || ticket.status === "closed");
    const canClose   = isStaff  && ticket.status !== "closed";
    const canStaffReopen = isStaff && ticket.status === "closed";

    const labelsRow = isStaff ? renderStaffLabels(ticket) : "";
    const statusControls = `
      <div class="support-thread-actions">
        ${canFinish    ? `<button class="btn btn-secondary" id="btn-finish">Mark Finished</button>` : ""}
        ${canReopen    ? `<button class="btn btn-secondary" id="btn-reopen">Reopen Ticket</button>` : ""}
        ${canClose     ? `<button class="btn btn-danger"    id="btn-close">Close Ticket</button>` : ""}
        ${canStaffReopen ? `<button class="btn btn-secondary" id="btn-staff-reopen">Reopen</button>` : ""}
      </div>`;

    panel.innerHTML = `
      <div class="support-thread-header">
        <div class="support-thread-title">
          <h2>${esc(ticket.subject)}</h2>
          <span class="support-badge support-badge--${esc(ticket.status)}">${esc(ticket.status)}</span>
          ${isStaff ? `<span class="support-ticket-owner">🧑 ${esc(ticket.created_by_username || "unknown")}</span>` : ""}
        </div>
        ${ticket.category ? `<div class="support-ticket-category">Category: ${esc(ticket.category)}</div>` : ""}
        ${labelsRow}
        ${statusControls}
      </div>
      <div class="support-messages" id="support-messages" role="log" aria-live="polite">
        ${messages.map(renderMessage).join("")}
      </div>
      ${canPostMsg ? `
        <form class="support-reply-form" id="support-reply-form">
          <textarea id="reply-body" rows="4" placeholder="Type your reply…" required></textarea>
          <button type="submit" class="btn btn-primary">Send</button>
        </form>` : `<div class="support-closed-notice">This ticket is closed.</div>`}
    `;

    // Scroll to bottom
    const msgs = panel.querySelector("#support-messages");
    if (msgs) msgs.scrollTop = msgs.scrollHeight;

    // Wire status buttons
    panel.querySelector("#btn-finish")?.addEventListener("click", () => changeStatus("finished"));
    panel.querySelector("#btn-reopen")?.addEventListener("click", () => changeStatus("open"));
    panel.querySelector("#btn-close")?.addEventListener("click",  () => staffChangeStatus("closed", ticket.id));
    panel.querySelector("#btn-staff-reopen")?.addEventListener("click", () => staffChangeStatus("open", ticket.id));

    // Wire reply form
    panel.querySelector("#support-reply-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = panel.querySelector("#reply-body").value.trim();
      if (!body) return;
      try {
        if (isStaff) {
          await apiStaffPostMessage(ticket.id, body);
        } else {
          await apiPostTicketMessage(ticket.id, body);
        }
        panel.querySelector("#reply-body").value = "";
        const { ticket: t2, messages: m2 } = isStaff
          ? await apiStaffGetTicket(ticket.id)
          : await apiGetTicket(ticket.id);
        renderThread(t2, m2);
        await loadTickets();
      } catch (err) {
        toastError(err.message || "Failed to send message.");
      }
    });

    // Wire staff label editor
    panel.querySelectorAll(".support-label-toggle").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const label = btn.dataset.label;
        const current = ticket.staff_labels || [];
        const updated = current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label];
        try {
          await apiStaffPatchTicket(ticket.id, { staff_labels: updated });
          ticket.staff_labels = updated;
          // Re-render labels section
          const newLabelsRow = panel.querySelector(".support-labels-editor");
          if (newLabelsRow) newLabelsRow.outerHTML = renderStaffLabels(ticket);
          await loadTickets();
        } catch (err) {
          toastError(err.message || "Failed to update labels.");
        }
      });
    });
  }

  function renderMessage(m) {
    const isStaffMsg = m.author_role === "staff";
    return `
      <div class="support-message support-message--${esc(m.author_role)}" role="article">
        <div class="support-message-meta">
          <strong>${esc(m.author_username)}</strong>
          ${isStaffMsg ? `<span class="support-chip support-chip--staff">Staff</span>` : ""}
          <time datetime="${esc(m.created_at)}">${formatRelative(m.created_at)}</time>
        </div>
        <div class="support-message-body">${esc(m.body)}</div>
      </div>`;
  }

  function renderStaffLabels(ticket) {
    const current = ticket.staff_labels || [];
    return `
      <div class="support-labels-editor">
        <span class="support-labels-label">Labels:</span>
        ${STAFF_LABELS.map((l) => {
          const active = current.includes(l);
          return `<button class="support-label-toggle${active ? " active" : ""}" data-label="${esc(l)}" type="button">${esc(l)}</button>`;
        }).join("")}
      </div>`;
  }

  async function changeStatus(status) {
    if (!selectedTicketId) return;
    try {
      await apiPatchTicket(selectedTicketId, status);
      toastSuccess(`Ticket marked as ${status}.`);
      await loadTickets();
      selectTicket(selectedTicketId);
    } catch (err) {
      toastError(err.message || "Failed to update status.");
    }
  }

  async function staffChangeStatus(status, ticketId) {
    try {
      await apiStaffPatchTicket(ticketId, { status });
      toastSuccess(`Ticket ${status === "closed" ? "closed" : "reopened"}.`);
      await loadTickets();
      selectTicket(ticketId);
    } catch (err) {
      toastError(err.message || "Failed to update status.");
    }
  }

  function checkForNewUnreads() {
    const unreadIds = new Set(tickets.filter((t) => t.unread).map((t) => t.id));
    const newOnes = [...unreadIds].filter((id) => !lastKnownUnreadIds.has(id));
    if (newOnes.length && lastKnownUnreadIds.size > 0) {
      // Only show notification after first load (so we don't spam on page open)
      toast(`You have ${newOnes.length} new unread message${newOnes.length > 1 ? "s" : ""} in Support.`, "info");
    }
    lastKnownUnreadIds = unreadIds;
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      if (!document.hidden) await loadTickets();
    }, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", async () => {
      if (!document.hidden) await loadTickets();
    }, { once: false });
  }
}

// ── Template helpers ────────────────────────────────────────────────────────

function renderPlayerNewButton() {
  return `<button class="btn btn-primary" id="support-new-ticket-btn" type="button">+ New Ticket</button>`;
}

function renderStaffFilters() {
  return `
    <div class="support-staff-filters">
      <select id="staff-filter-status" aria-label="Filter by status">
        <option value="">All statuses</option>
        <option value="open">Open</option>
        <option value="finished">Finished</option>
        <option value="closed">Closed</option>
      </select>
      <select id="staff-filter-label" aria-label="Filter by label">
        <option value="">All labels</option>
        ${STAFF_LABELS.map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join("")}
      </select>
    </div>`;
}

function formatRelative(isoStr) {
  if (!isoStr) return "";
  const date = new Date(isoStr);
  const now = Date.now();
  const diff = now - date.getTime();
  if (diff < 60_000)  return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
