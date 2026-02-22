/**
 * server/discourseClient.js
 *
 * Focused Discourse API client.
 * Credentials are injected at call-time so the module stays stateless and
 * can be tested independently of the database.
 *
 * Idempotency is enforced by the caller: before calling createTopic() the
 * caller should check whether the entity record already has a
 * discourse_topic_id set and short-circuit if so.
 */

/**
 * Create a new Discourse topic (first post of a thread).
 *
 * @param {string} baseUrl      - Discourse base URL (no trailing slash)
 * @param {string} apiKey       - Discourse API key
 * @param {string} apiUsername  - Discourse API username
 * @param {string} title        - Topic title
 * @param {string} raw          - Post body (Markdown)
 * @param {number} [categoryId] - Discourse category ID (optional)
 * @param {string[]} [tags]     - Array of tag names (optional)
 * @returns {Promise<{ topicId: number, topicSlug: string, topicUrl: string }>}
 */
export async function createTopic(baseUrl, apiKey, apiUsername, title, raw, categoryId, tags) {
  const body = { title, raw };
  if (categoryId != null) body.category = categoryId;
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
    const err = new Error(`Discourse createTopic failed: HTTP ${res.status} ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const topicId   = data.topic_id;
  const topicSlug = data.topic_slug || "";
  const topicUrl  = topicSlug
    ? `${baseUrl}/t/${topicSlug}/${topicId}`
    : `${baseUrl}/t/${topicId}`;

  return { topicId, topicSlug, topicUrl };
}

/**
 * Create a reply post in an existing Discourse topic.
 *
 * @param {string} baseUrl     - Discourse base URL (no trailing slash)
 * @param {string} apiKey      - Discourse API key
 * @param {string} apiUsername - Discourse API username
 * @param {number} topicId     - ID of the topic to reply to
 * @param {string} raw         - Post body (Markdown)
 * @returns {Promise<{ postId: number, topicId: number }>}
 */
export async function createPost(baseUrl, apiKey, apiUsername, topicId, raw) {
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
    const err = new Error(`Discourse createPost failed: HTTP ${res.status} ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  return { postId: data.id, topicId: data.topic_id };
}

/**
 * Retry wrapper — retries on transient errors (network / 429 / 5xx).
 * Does NOT retry on definitive 4xx errors (except 429).
 *
 * @param {() => Promise<T>} fn        - Async function to retry
 * @param {number} [maxAttempts=3]
 * @param {number} [delayMs=500]       - Initial back-off in ms (doubles each attempt)
 * @returns {Promise<T>}
 */
export async function withRetry(fn, maxAttempts = 3, delayMs = 500) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err.status ?? 0;
      const isClientError = status >= 400 && status < 500 && status !== 429;
      if (isClientError) break;
      if (attempt < maxAttempts) {
        const wait = Math.min(delayMs * Math.pow(2, attempt - 1), 30_000);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}
