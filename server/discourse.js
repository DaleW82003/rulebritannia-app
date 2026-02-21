/**
 * Discourse API client module.
 *
 * Functions accept explicit credentials so the module remains a pure HTTP
 * client and can be tested independently of the database.
 *
 * Discourse API reference: https://docs.discourse.org
 */

import { createHmac, timingSafeEqual } from "crypto";

/**
 * Create a new Discourse topic (first post of a thread).
 *
 * @param {object} opts
 * @param {string} opts.baseUrl       - Discourse base URL, no trailing slash
 * @param {string} opts.apiKey        - Discourse API key
 * @param {string} opts.apiUsername   - Discourse API username
 * @param {string} opts.title         - Topic title
 * @param {string} opts.raw           - Post body (Markdown)
 * @param {number} [opts.categoryId]  - Discourse category ID
 * @param {string[]} [opts.tags]      - Array of tag names
 * @returns {Promise<{ topicId: number, topicSlug: string }>}
 */
export async function createTopic({ baseUrl, apiKey, apiUsername, title, raw, categoryId, tags }) {
  const body = { title, raw };
  if (categoryId !== undefined && categoryId !== null) body.category = categoryId;
  if (Array.isArray(tags) && tags.length) body.tags = tags;

  const res = await fetch(`${baseUrl}/posts.json`, {
    method: "POST",
    headers: {
      "Api-Key":      apiKey,
      "Api-Username": apiUsername,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discourse createTopic failed: HTTP ${res.status} ${text}`);
  }

  const data = await res.json();
  return { topicId: data.topic_id, topicSlug: data.topic_slug || "" };
}

/**
 * Retry wrapper for createTopic with exponential back-off.
 *
 * Retries on network errors and HTTP 429 / 5xx responses (transient failures).
 * Does NOT retry on HTTP 4xx errors other than 429 (those are caller mistakes).
 *
 * @param {object}  opts            - Same options as createTopic.
 * @param {number}  [maxAttempts=3] - Total attempts (1 = no retry).
 * @param {number}  [delayMs=500]   - Initial delay in ms; doubles each attempt.
 * @returns {Promise<{ topicId: number, topicSlug: string }>}
 */
export async function createTopicWithRetry(opts, maxAttempts = 3, delayMs = 500) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await createTopic(opts);
    } catch (err) {
      lastErr = err;

      // Prefer an explicit status property on the error; fall back to parsing the message.
      const statusFromProp = err.status ?? err.statusCode;
      const statusFromMsg  = err.message?.match(/HTTP (\d+)/)?.[1];
      const status = statusFromProp ? Number(statusFromProp) : (statusFromMsg ? Number(statusFromMsg) : 0);

      // Do not retry on definitive client errors (4xx except 429 Too Many Requests)
      const isClientError = status >= 400 && status < 500 && status !== 429;
      if (isClientError) break;

      if (attempt < maxAttempts) {
        // Cap at 30 s to avoid excessive delays if maxAttempts is raised
        const wait = Math.min(delayMs * Math.pow(2, attempt - 1), 30_000);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

/**
 * Create a reply post in an existing Discourse topic.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl       - Discourse base URL, no trailing slash
 * @param {string} opts.apiKey        - Discourse API key
 * @param {string} opts.apiUsername   - Discourse API username
 * @param {number} opts.topicId       - ID of the topic to reply to
 * @param {string} opts.raw           - Post body (Markdown)
 * @returns {Promise<{ postId: number, topicId: number }>}
 */
export async function createPost({ baseUrl, apiKey, apiUsername, topicId, raw }) {
  const res = await fetch(`${baseUrl}/posts.json`, {
    method: "POST",
    headers: {
      "Api-Key":      apiKey,
      "Api-Username": apiUsername,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ topic_id: topicId, raw }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discourse createPost failed: HTTP ${res.status} ${text}`);
  }

  const data = await res.json();
  return { postId: data.id, topicId: data.topic_id };
}

// ── Group management ──────────────────────────────────────────────────────────

/**
 * Fetch the current members of a Discourse group (all pages).
 *
 * Returns the full list of members across all pages.  Discourse paginates at
 * 50 members by default; we walk pages until the response stops returning new
 * members.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {string} opts.apiKey
 * @param {string} opts.apiUsername
 * @param {string} opts.groupName
 * @returns {Promise<Array<{ id: number, username: string }>>}
 */
export async function getGroupMembers({ baseUrl, apiKey, apiUsername, groupName }) {
  const members = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const url = `${baseUrl}/groups/${encodeURIComponent(groupName)}/members.json?limit=${limit}&offset=${offset}`;
    const res = await fetch(url, {
      headers: { "Api-Key": apiKey, "Api-Username": apiUsername },
    });

    if (res.status === 404) return [];         // group doesn't exist yet — treat as empty
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`getGroupMembers(${groupName}) failed: HTTP ${res.status} ${text}`);
    }

    const body = await res.json();
    const page = body?.members ?? [];
    if (!page.length) break;
    for (const m of page) members.push({ id: m.id, username: m.username });
    if (page.length < limit) break;            // last page
    offset += limit;
  }

  return members;
}

/**
 * Add usernames to a Discourse group.
 *
 * @param {object}   opts
 * @param {string}   opts.baseUrl
 * @param {string}   opts.apiKey
 * @param {string}   opts.apiUsername
 * @param {string}   opts.groupName
 * @param {string[]} opts.usernames
 * @returns {Promise<void>}
 */
export async function addGroupMembers({ baseUrl, apiKey, apiUsername, groupName, usernames }) {
  if (!usernames.length) return;
  const res = await fetch(`${baseUrl}/groups/${encodeURIComponent(groupName)}/members.json`, {
    method: "PUT",
    headers: {
      "Api-Key":      apiKey,
      "Api-Username": apiUsername,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ usernames: usernames.join(",") }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`addGroupMembers(${groupName}) failed: HTTP ${res.status} ${text}`);
  }
}

/**
 * Remove usernames from a Discourse group.
 *
 * @param {object}   opts
 * @param {string}   opts.baseUrl
 * @param {string}   opts.apiKey
 * @param {string}   opts.apiUsername
 * @param {string}   opts.groupName
 * @param {string[]} opts.usernames
 * @returns {Promise<void>}
 */
export async function removeGroupMembers({ baseUrl, apiKey, apiUsername, groupName, usernames }) {
  if (!usernames.length) return;
  const res = await fetch(`${baseUrl}/groups/${encodeURIComponent(groupName)}/members.json`, {
    method: "DELETE",
    headers: {
      "Api-Key":      apiKey,
      "Api-Username": apiUsername,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ usernames: usernames.join(",") }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`removeGroupMembers(${groupName}) failed: HTTP ${res.status} ${text}`);
  }
}

// ── DiscourseConnect SSO ──────────────────────────────────────────────────────
// Reference: https://meta.discourse.org/t/discourseconnect-official-single-sign-on-for-discourse/13045

/**
 * Build the `sso` + `sig` query-string parameters to send to Discourse.
 *
 * DiscourseConnect flow (our side initiates):
 *   1. We generate a nonce and redirect to:
 *      {forum}/session/sso_provider?sso={payload}&sig={hmac}
 *   2. Discourse validates the signature and redirects back to our
 *      return_sso_url with the user's info embedded.
 *   3. We call verifySsoPayload() to validate the return payload.
 *
 * @param {object} opts
 * @param {string} opts.ssoSecret   - DiscourseConnect secret (from admin config)
 * @param {string} opts.returnUrl   - URL Discourse will redirect back to
 * @param {string} opts.nonce       - Unique random nonce (store in session before redirect)
 * @returns {{ sso: string, sig: string }}
 */
export function buildSsoPayload({ ssoSecret, returnUrl, nonce }) {
  const raw     = `nonce=${nonce}&return_sso_url=${encodeURIComponent(returnUrl)}`;
  const payload = Buffer.from(raw).toString("base64");
  const sig     = createHmac("sha256", ssoSecret).update(payload).digest("hex");
  return { sso: payload, sig };
}

/**
 * Verify a DiscourseConnect return payload and extract the user fields.
 *
 * Called when Discourse redirects back to our callback URL with
 * ?sso={payload}&sig={sig} query params.
 *
 * @param {object} opts
 * @param {string} opts.ssoSecret      - DiscourseConnect secret
 * @param {string} opts.sso            - Base64 payload received from Discourse
 * @param {string} opts.sig            - HMAC-SHA256 hex signature received from Discourse
 * @param {string} opts.expectedNonce  - Nonce stored in the user's session at login
 * @returns {{ externalId: string, email: string, username: string, name: string, groups: string[] }}
 * @throws {Error} if signature is invalid or nonce doesn't match
 */
export function verifySsoPayload({ ssoSecret, sso, sig, expectedNonce }) {
  const expected    = createHmac("sha256", ssoSecret).update(sso).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const receivedBuf = Buffer.from(sig,      "hex");

  if (expectedBuf.length !== receivedBuf.length || !timingSafeEqual(expectedBuf, receivedBuf)) {
    throw new Error("DiscourseConnect: signature mismatch");
  }

  const decoded = Buffer.from(sso, "base64").toString("utf8");
  const params  = new URLSearchParams(decoded);
  const nonce   = params.get("nonce") || "";

  if (nonce !== expectedNonce) {
    throw new Error("DiscourseConnect: nonce mismatch");
  }

  return {
    externalId: params.get("external_id")  || "",
    email:      params.get("email")        || "",
    username:   params.get("username")     || "",
    name:       params.get("name")         || "",
    groups:     (params.get("groups") || "").split(",").filter(Boolean),
  };
}

