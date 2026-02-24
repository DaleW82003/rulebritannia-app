var BACKEND_ORIGIN = "https://rulebritannia-app-backend.onrender.com";
var index_default = {
  async fetch(request) {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/api/worker-test") {
      return new Response("WORKER_OK rb-api-proxy", {
        status: 200,
        headers: { "content-type": "text/plain" }
      });
    }

    // API proxy
    if (url.pathname.startsWith("/api/")) {
      const backendUrl = new URL(url.pathname + url.search, BACKEND_ORIGIN).toString();
      return await fetch(new Request(backendUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: "follow"
      }));
    }

    // All other requests: redirect to www
    // Only do the redirect if this is the bare domain!
    if (url.hostname === "rulebritannia.org") {
      // Replace hostname with www
      url.hostname = "www.rulebritannia.org";
      return Response.redirect(url.toString(), 301);
    }

    // Fallback (shouldn't reach here)
    return fetch(request);
  }
};
export {
  index_default as default
};
