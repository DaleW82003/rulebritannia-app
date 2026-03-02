var BACKEND_ORIGIN = "https://rulebritannia-app-backend.onrender.com";
var index_default = {
  async fetch(request) {
    const url = new URL(request.url);

    // Health check (responds on both bare and www before any redirect)
    if (url.pathname === "/api/worker-test") {
      return new Response("WORKER_OK rb-api-proxy", {
        status: 200,
        headers: { "content-type": "text/plain" }
      });
    }

    // API proxy — MUST come before the bare-domain redirect below.
    //
    // All /api/* requests (GET and POST alike) are forwarded directly to the
    // backend, regardless of whether they arrive on rulebritannia.org or
    // www.rulebritannia.org.  Placing this check first prevents GET /api/*
    // requests (bootstrap, csrf-token, etc.) from being 308-redirected to
    // www.rulebritannia.org before they reach the backend.  That cross-origin
    // redirect caused the browser to send credentials to a different origin,
    // breaking session-cookie forwarding and making every CSRF check fail.
    if (url.pathname.startsWith("/api/")) {
      const backendUrl = new URL(url.pathname + url.search, BACKEND_ORIGIN).toString();
      const init = {
        method: request.method,
        headers: request.headers,
        redirect: "manual",
      };
      // GET and HEAD requests must not carry a body per the HTTP spec.
      if (!["GET", "HEAD"].includes(request.method)) {
        init.body = request.body;
      }
      return await fetch(new Request(backendUrl, init));
    }

    // Redirect bare domain → www for non-API browser navigation (GET/HEAD only).
    //
    // Session cookies are set with domain=".rulebritannia.org" so they are sent
    // on both rulebritannia.org and www.rulebritannia.org.  The redirect here
    // is kept for non-API GET/HEAD so DiscourseConnect SSO callbacks from
    // Discourse (which may target the bare domain) land on the canonical www
    // origin.
    if (url.hostname === "rulebritannia.org" && ["GET", "HEAD"].includes(request.method)) {
      url.hostname = "www.rulebritannia.org";
      return Response.redirect(url.toString(), 308);
    }

    // Fallback (shouldn't reach here)
    return fetch(request);
  }
};
export {
  index_default as default
};
