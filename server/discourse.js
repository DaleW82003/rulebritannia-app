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
 * Return the URL path segment for a group: the numeric ID when available,
 * otherwise the percent-encoded group name (legacy fallback).
 *
 * @param {string} groupName
 * @param {number|undefined} groupId
 * @returns {string}
 */
function groupUrlPath(groupName, groupId) {
  return groupId != null ? String(groupId) : encodeURIComponent(groupName);
}

/**
 * Perform a fetch with automatic retry on HTTP 429 (rate-limit) responses.
 *
 * On 429 the helper attempts to read the JSON body to extract
 * `extras.wait_seconds` and waits that duration (+250 ms buffer) before
 * retrying.  Falls back to exponential backoff when the body is not JSON or
 * the field is absent.  Throws once `maxRetries` or `maxTotalWaitMs` is
 * exceeded.
 *
 * @param {string}   url
 * @param {object}   init                         - fetch init options
 * @param {object}   [opts]
 * @param {number}   [opts.maxRetries=10]
 * @param {number}   [opts.fallbackDelayMs=2000]  - initial backoff when wait_seconds is absent
 * @param {number}   [opts.maxTotalWaitMs=300000] - 5 minutes; accommodates a single ~58 s Discourse window
 * @param {number}   [opts.maxBackoffMs=30000]    - cap on per-attempt backoff delay
 * @param {number}   [opts.jitterMs=250]          - buffer added to wait_seconds delays
 * @param {Function} [opts.sleep]                 - injectable sleep(ms)→Promise; defaults to setTimeout
 * @param {Function} [opts.warn]                  - injectable warn(msg) for 429 log lines; defaults to console.warn
 * @returns {Promise<Response>}
 */
async function discourseApiRequest(url, init, {
  maxRetries = 10,
  fallbackDelayMs = 2000,
  maxTotalWaitMs = 300_000,
  maxBackoffMs = 30_000,
  jitterMs = 250,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  warn = (msg) => console.warn(msg),
} = {}) {
  let totalWait = 0;

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);

    // With redirect:"manual", redirect responses have no useful body — the only
    // diagnostic value is the Location header.  Throw immediately so callers
    // don't silently consume an empty body or spin into a rate-limit loop
    // caused by bouncing to a login page or http→https redirect.
    if (res.status === 301 || res.status === 302 || res.status === 307 || res.status === 308) {
      const location = res.headers.get("location") ?? "(no Location header)";
      throw new Error(
        `Discourse API redirect: HTTP ${res.status} on ${url} → Location: ${location}`
      );
    }

    if (res.status !== 429) return res;

    let waitMs;
    let waitSeconds;
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      try {
        const data = await res.json();
        const secs = data?.extras?.wait_seconds;
        if (typeof secs === "number" && secs > 0) {
          waitSeconds = secs;
          waitMs = Math.round(secs * 1000) + jitterMs;
        }
      } catch {
        // fall through to backoff
      }
    }
    if (waitMs === undefined) {
      waitMs = Math.min(fallbackDelayMs * Math.pow(2, attempt), maxBackoffMs);
    }

    totalWait += waitMs;
    if (attempt >= maxRetries || totalWait > maxTotalWaitMs) {
      const waitInfo = waitSeconds != null
        ? `wait_seconds=${waitSeconds}, `
        : "";
      throw new Error(
        `Discourse API rate-limited: HTTP 429 on ${url} after ${attempt + 1} attempt(s); ` +
        `${waitInfo}totalWaitMs=${totalWait}, maxTotalWaitMs=${maxTotalWaitMs}`
      );
    }

    warn(`[Discourse] 429 rate-limit on ${url} — attempt ${attempt + 1}, waiting ${waitMs}ms`);
    await sleep(waitMs);
  }
}

/**
 * Fetch the numeric Discourse group ID for every group returned by /groups.json.
 *
 * Follows `load_more_groups` pagination until all groups have been retrieved.
 * A small delay (`_pageDelayMs`, default 500 ms) is inserted between pages to
 * avoid bursting the Discourse rate-limiter when many pages are fetched.
 * Returns a Map<groupName, groupId> that callers can use to build correct URLs.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {string} opts.apiKey
 * @param {string} opts.apiUsername
 * @param {number} [opts._pageDelayMs=500] - inter-page delay to avoid rate-limit bursts
 * @returns {Promise<Map<string, number>>}
 */
export async function resolveGroupIds({ baseUrl, apiKey, apiUsername, _sleep, _warn, _pageDelayMs = 500 }) {
  const cleanBase = (baseUrl || "").trim().replace(/\/$/, "");
  const sleepFn = _sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const map = new Map();
  let pageUrl = `${cleanBase}/groups.json`;
  let firstPage = true;

  while (pageUrl) {
    if (!firstPage) await sleepFn(_pageDelayMs);
    firstPage = false;

    const res = await discourseApiRequest(pageUrl, {
      method:   "GET",
      redirect: "manual",
      headers: {
        "Api-Key":      apiKey,
        "Api-Username": apiUsername,
        "Accept":       "application/json",
      },
    }, { sleep: sleepFn, warn: _warn });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`resolveGroupIds failed: HTTP ${res.status} ${text}`);
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const body = await res.text().catch(() => "");
      const snippet = body.replace(/\r?\n/g, " ").slice(0, 200);
      throw new Error(
        `resolveGroupIds failed: HTTP ${res.status} url=${res.url} content-type=${contentType} body=${snippet}`
      );
    }
    const data = await res.json();
    for (const g of data?.groups ?? []) {
      map.set(g.name, g.id);
    }
    // load_more_groups is a relative path, e.g. "/groups.json?page=1"
    const more = data?.load_more_groups;
    if (more != null) {
      const morePath = more.split("?")[0];
      if (!morePath.includes(".json")) {
        throw new Error(
          `resolveGroupIds: Discourse returned a non-API pagination URL; cannot safely crawl HTML. ` +
          `Please ensure /groups.json returns load_more_groups with .json. ` +
          `baseUrl=${cleanBase} load_more_groups=${more} pageUrl=${res.url}`
        );
      }
    }
    pageUrl = more ? `${cleanBase}${more}` : null;
  }

  return map;
}

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
 * @param {string} opts.groupName   - Group name (used in error messages)
 * @param {number} [opts.groupId]   - Numeric Discourse group ID; used in the URL
 *                                    when provided (required by some Discourse versions)
 * @returns {Promise<Array<{ id: number, username: string }>>}
 */
export async function getGroupMembers({ baseUrl, apiKey, apiUsername, groupName, groupId, _sleep, _warn }) {
  const cleanBase = (baseUrl || "").trim().replace(/\/$/, "");
  const groupPath = groupUrlPath(groupName, groupId);
  const members = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const url = `${cleanBase}/groups/${groupPath}/members.json?limit=${limit}&offset=${offset}`;
    const res = await discourseApiRequest(url, {
      method:   "GET",
      redirect: "manual",
      headers: {
        "Api-Key":      apiKey,
        "Api-Username": apiUsername,
        "Accept":       "application/json",
      },
    }, { sleep: _sleep, warn: _warn });

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
 * @param {string}   opts.groupName   - Group name (used in error messages)
 * @param {number}   [opts.groupId]   - Numeric Discourse group ID; used in the URL
 *                                      when provided (required by some Discourse versions)
 * @param {string[]} opts.usernames
 * @returns {Promise<void>}
 */
export async function addGroupMembers({ baseUrl, apiKey, apiUsername, groupName, groupId, usernames, _sleep, _warn }) {
  if (!usernames.length) return;
  const cleanBase = (baseUrl || "").trim().replace(/\/$/, "");
  const groupPath = groupUrlPath(groupName, groupId);
  const res = await discourseApiRequest(`${cleanBase}/groups/${groupPath}/members.json`, {
    method:   "PUT",
    redirect: "manual",
    headers: {
      "Api-Key":      apiKey,
      "Api-Username": apiUsername,
      "Content-Type": "application/json",
      "Accept":       "application/json",
    },
    body: JSON.stringify({ usernames: usernames.join(",") }),
  }, { sleep: _sleep, warn: _warn });
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
 * @param {string}   opts.groupName   - Group name (used in error messages)
 * @param {number}   [opts.groupId]   - Numeric Discourse group ID; used in the URL
 *                                      when provided (required by some Discourse versions)
 * @param {string[]} opts.usernames
 * @returns {Promise<void>}
 */
export async function removeGroupMembers({ baseUrl, apiKey, apiUsername, groupName, groupId, usernames, _sleep, _warn }) {
  if (!usernames.length) return;
  const cleanBase = (baseUrl || "").trim().replace(/\/$/, "");
  const groupPath = groupUrlPath(groupName, groupId);
  const res = await discourseApiRequest(`${cleanBase}/groups/${groupPath}/members.json`, {
    method:   "DELETE",
    redirect: "manual",
    headers: {
      "Api-Key":      apiKey,
      "Api-Username": apiUsername,
      "Content-Type": "application/json",
      "Accept":       "application/json",
    },
    body: JSON.stringify({ usernames: usernames.join(",") }),
  }, { sleep: _sleep, warn: _warn });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`removeGroupMembers(${groupName}) failed: HTTP ${res.status} ${text}`);
  }
}

// ── DiscourseConnect SSO ──────────────────────────────────────────────────────
// Reference: https://meta.discourse.org/t/discourseconnect-official-single-sign-on-for-discourse/13045
//
// This app uses DiscourseConnect in *consumer* mode: the SIM is the identity
// source and Discourse is the consumer.  Discourse calls our DiscourseConnect
// URL with ?sso=<payload>&sig=<hmac>; we verify, build a response payload
// with the user's info, sign it, and redirect back to Discourse.

/**
 * Verify an inbound DiscourseConnect request sent by Discourse.
 *
 * In consumer mode Discourse calls our DiscourseConnect URL with
 * ?sso=<base64_payload>&sig=<hmac_sha256>.  We verify the signature and
 * decode the nonce + return_sso_url.
 *
 * @param {object} opts
 * @param {string} opts.ssoSecret - Shared DiscourseConnect secret
 * @param {string} opts.sso       - Base64 payload from Discourse
 * @param {string} opts.sig       - HMAC-SHA256 hex signature from Discourse
 * @returns {{ nonce: string, returnSsoUrl: string }}
 * @throws {Error} if signature is invalid
 */
export function verifyConsumerRequest({ ssoSecret, sso, sig }) {
  const expected    = createHmac("sha256", ssoSecret).update(sso).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const receivedBuf = Buffer.from(sig,      "hex");

  if (expectedBuf.length !== receivedBuf.length || !timingSafeEqual(expectedBuf, receivedBuf)) {
    throw new Error("DiscourseConnect: signature mismatch");
  }

  const decoded = Buffer.from(sso, "base64").toString("utf8");
  const params  = new URLSearchParams(decoded);

  return {
    nonce:        params.get("nonce")          || "",
    returnSsoUrl: params.get("return_sso_url") || "",
  };
}

/**
 * Build the SSO response payload to redirect back to Discourse.
 *
 * After authenticating the user we redirect their browser to Discourse's
 * return_sso_url with a signed payload containing the user's information.
 *
 * @param {object}   opts
 * @param {string}   opts.ssoSecret   - Shared DiscourseConnect secret
 * @param {string}   opts.nonce       - Nonce from the inbound Discourse request
 * @param {string}   opts.externalId  - SIM user ID (external_id)
 * @param {string}   opts.email       - User's email address
 * @param {string}   opts.username    - User's username
 * @param {string}   [opts.name]      - User's display name
 * @param {string}   [opts.avatarUrl] - URL to the user's avatar image
 * @param {string[]} [opts.groups]    - Complete list of Discourse group names the user belongs to
 * @param {boolean}  [opts.admin]     - Whether the user should be a Discourse admin
 * @param {boolean}  [opts.moderator] - Whether the user should be a Discourse moderator
 * @returns {{ sso: string, sig: string }}
 */
export function buildConsumerResponse({ ssoSecret, nonce, externalId, email, username, name, avatarUrl, groups, admin, moderator }) {
  const params = new URLSearchParams();
  params.set("nonce",       nonce);
  params.set("external_id", String(externalId));
  params.set("email",       email);
  params.set("username",    username);
  if (name)                                    params.set("name",       name);
  if (avatarUrl)                               params.set("avatar_url", avatarUrl);
  if (Array.isArray(groups) && groups.length)  params.set("groups",     groups.join(","));
  if (admin)                                   params.set("admin",      "true");
  if (moderator)                               params.set("moderator",  "true");

  const payload = Buffer.from(params.toString()).toString("base64");
  const sig     = createHmac("sha256", ssoSecret).update(payload).digest("hex");
  return { sso: payload, sig };
}

/**
 * Build the `sso` + `sig` query-string parameters to send to Discourse.
 *
 * @deprecated Use verifyConsumerRequest / buildConsumerResponse for the
 * standard DiscourseConnect consumer flow where this app is the identity
 * source.  buildSsoPayload / verifySsoPayload remain for any provider-mode
 * usage or tests that cover the outbound nonce/return_sso_url encoding.
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
 * @deprecated Use verifyConsumerRequest / buildConsumerResponse for the
 * standard DiscourseConnect consumer flow.
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

