/**
 * Cloudflare Pages Function — proxy all /api/* requests to the Render backend.
 *
 * This file is picked up automatically by Cloudflare Pages and deployed as part
 * of the site build — no separate `wrangler deploy` step is required.
 *
 * The Cloudflare Worker defined in worker/index.js provides the same behaviour
 * but must be deployed explicitly via `wrangler deploy`.  This Pages Function
 * acts as the always-on fallback so that /api/* routes are accessible as soon
 * as the Pages deployment goes live.
 *
 * Route: /api/* (catch-all — matches /api/bootstrap, /api/auth/login, etc.)
 *
 * TODO: Once the Cloudflare Worker (worker/index.js) is confirmed deployed and
 *       stable, this file can optionally be removed — the Worker will take
 *       priority over Pages Functions for matching routes.
 */

const BACKEND_ORIGIN = "https://rulebritannia-app-backend.onrender.com";

export async function onRequest({ request }) {
  const url = new URL(request.url);
  const backendUrl = new URL(url.pathname + url.search, BACKEND_ORIGIN);

  const init = {
    method: request.method,
    headers: request.headers,
    redirect: "manual",
  };

  // GET and HEAD requests must not carry a body per the HTTP spec.
  if (!["GET", "HEAD"].includes(request.method)) {
    init.body = request.body;
  }

  return fetch(new Request(backendUrl.toString(), init));
}
