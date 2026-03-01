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

    // Redirect bare domain → www BEFORE proxying to the backend.
    //
    // Session cookies are set via www.rulebritannia.org (the canonical front-end
    // origin).  Browsers scope cookies to the exact host by default, so a
    // request that arrives on rulebritannia.org will NOT carry the www cookie.
    // This causes the DiscourseConnect SSO callback (which Discourse sends to
    // the configured discourse_connect_url) to arrive without a session, making
    // the user appear logged-out even though they are authenticated on www.
    //
    // By issuing a 301 here — before we touch the API proxy — the browser
    // re-sends the request on www.rulebritannia.org where it carries the right
    // cookie, so /api/discourse/sso sees the live session and completes the
    // DiscourseConnect handshake seamlessly.
    if (url.hostname === "rulebritannia.org") {
      url.hostname = "www.rulebritannia.org";
      return Response.redirect(url.toString(), 301);
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
