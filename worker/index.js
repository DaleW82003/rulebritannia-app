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

    // Redirect bare domain → www for browser navigation requests (GET/HEAD only).
    //
    // Session cookies are set with domain=".rulebritannia.org" so they are sent
    // on both rulebritannia.org and www.rulebritannia.org.  The redirect here
    // is kept for GET/HEAD so DiscourseConnect SSO callbacks from Discourse
    // (which may target the bare domain) land on the canonical www origin.
    //
    // POST/PUT/DELETE/PATCH requests must NOT be redirected: a cross-origin
    // redirect for a credentialed fetch() causes a CORS block in the browser
    // because the 308 response lacks Access-Control-Allow-Origin.  Those
    // requests fall through to the API proxy below and are forwarded directly.
    if (url.hostname === "rulebritannia.org" && ["GET", "HEAD"].includes(request.method)) {
      url.hostname = "www.rulebritannia.org";
      return Response.redirect(url.toString(), 308);
    }

    // API proxy: www.rulebritannia.org/api/* → backend
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

    // Fallback (shouldn't reach here)
    return fetch(request);
  }
};
export {
  index_default as default
};
