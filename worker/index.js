/**
 * Cloudflare Worker — rb-api-proxy
 *
 * Route: www.rulebritannia.org/api/*
 *
 * Proxies all /api/* requests from the frontend at www.rulebritannia.org to
 * the Render backend at https://rulebritannia-app-backend.onrender.com.
 * All other requests (should none reach this worker given the narrow route)
 * are passed through unmodified.
 */

const BACKEND_ORIGIN = "https://rulebritannia-app-backend.onrender.com";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      const backendUrl = new URL(url.pathname + url.search, BACKEND_ORIGIN).toString();
      const hasBody = request.method !== "GET" && request.method !== "HEAD";
      try {
        return await fetch(new Request(backendUrl, {
          method:  request.method,
          headers: request.headers,
          ...(hasBody && { body: request.body, duplex: "half" }),
          redirect: "follow",
        }));
      } catch (err) {
        return new Response(
          JSON.stringify({ error: "Backend unavailable" }),
          { status: 502, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    
    // Pass through any non-/api/ request unchanged (should not normally occur
    // given the route is scoped to /api/*).
    return fetch(request);
  },
};
