// js/components/tile.js
// Tile / card HTML builder helpers.
// All functions return HTML strings. Callers must escape any user-supplied
// content before passing it as `body` or `actions`.

import { esc } from "../ui.js";

/**
 * Render a tile section (typically used as a page section block).
 *
 * @param {object} opts
 * @param {string} [opts.title]      - Section heading (will be escaped).
 * @param {string} [opts.body]       - Raw inner HTML.
 * @param {string} [opts.extraClass] - Extra CSS classes for the element.
 * @param {string} [opts.tag]        - Wrapper tag, default "section".
 * @returns {string} HTML string
 */
export function tileSection({ title = "", body = "", extraClass = "", tag = "section" } = {}) {
  const heading = title ? `<h2 class="tile-title">${esc(title)}</h2>` : "";
  const cls = ["tile", "tile-stack", extraClass].filter(Boolean).join(" ");
  return `<${tag} class="${cls}">${heading}${body}</${tag}>`;
}

/**
 * Render a tile card (typically used as a list item or grid cell).
 *
 * @param {object} opts
 * @param {string} [opts.kicker]     - Small eyebrow label (will be escaped).
 * @param {string} [opts.title]      - Card title (will be escaped).
 * @param {string} [opts.body]       - Raw inner HTML for the card body.
 * @param {string} [opts.actions]    - Raw inner HTML placed in `.tile-bottom`.
 * @param {string} [opts.extraClass] - Extra CSS classes.
 * @param {string} [opts.tag]        - Wrapper tag, default "article".
 * @returns {string} HTML string
 */
export function tileCard({ kicker = "", title = "", body = "", actions = "", extraClass = "", tag = "article" } = {}) {
  const kickerHtml = kicker ? `<div class="wgo-kicker">${esc(kicker)}</div>` : "";
  const titleHtml  = title  ? `<div class="wgo-title">${esc(title)}</div>`   : "";
  const actionsHtml = actions ? `<div class="tile-bottom">${actions}</div>` : "";
  const cls = ["tile", extraClass].filter(Boolean).join(" ");
  return `<${tag} class="${cls}">${kickerHtml}${titleHtml}${body}${actionsHtml}</${tag}>`;
}
