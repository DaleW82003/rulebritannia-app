// js/components/form-row.js
// Form-row HTML builder.
// Returns an HTML string wrapping a label + control in a `.form-row` div.
// Usage:
//   import { formRow } from "../components/form-row.js";
//   html += formRow("Your name", "nameInput", `<input id="nameInput" type="text">`);

import { esc } from "../ui.js";

/**
 * Render a form row (label + control).
 *
 * @param {string} labelText - Visible label text (will be escaped).
 * @param {string} id        - The `for` attribute value (will be escaped).
 * @param {string} inputHtml - Raw HTML for the input / select / textarea.
 * @param {object} [opts]
 * @param {boolean} [opts.inline] - Use side-by-side layout on wider screens.
 * @returns {string} HTML string
 */
export function formRow(labelText, id, inputHtml, { inline = false } = {}) {
  const cls = ["form-row", inline ? "inline" : ""].filter(Boolean).join(" ");
  return `
    <div class="${cls}">
      <label for="${esc(id)}">${esc(labelText)}</label>
      ${inputHtml}
    </div>
  `;
}
