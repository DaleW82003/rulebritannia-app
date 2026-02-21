/**
 * Discourse API client module.
 *
 * Functions accept explicit credentials so the module remains a pure HTTP
 * client and can be tested independently of the database.
 *
 * Discourse API reference: https://docs.discourse.org
 */

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
