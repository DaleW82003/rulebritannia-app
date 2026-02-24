const BACKEND_ORIGIN = "https://rulebritannia-app-backend.onrender.com";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Special health check endpoint
    if (url.pathname === "/api/worker-test") {
      return new Response("WORKER_OK rb-api-proxy", {
        status: 200,
        headers: { "content-type": "text/plain" }
      });
    }

    // Proxy all other /api/* requests
    if (url.pathname.startsWith("/api/")) {
      const backendUrl = new URL(url.pathname + url.search, BACKEND_ORIGIN).toString();
      const init = {
        method: request.method,
        headers: request.headers,
        redirect: "follow",
      };
      // GET and HEAD requests must not carry a body per the HTTP spec.
      if (!["GET", "HEAD"].includes(request.method)) {
        init.body = request.body;
      }
      return await fetch(new Request(backendUrl, init));
    }

    // Pass through anything else
    return fetch(request);
  }
};
