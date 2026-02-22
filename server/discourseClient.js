/**
 * discourseClient.js
 *
 * Thin module providing createTopic() and createPost() with idempotency support.
 * Re-exports the underlying implementation from discourse.js and wraps it with
 * idempotency checks when an entity record is supplied.
 *
 * Usage:
 *   import { createTopic, createPost } from "./discourseClient.js";
 *
 *   // Plain topic creation (no idempotency):
 *   const { topicId, topicSlug } = await createTopic({ baseUrl, apiKey, apiUsername, title, raw, categoryId, tags });
 *
 *   // Idempotency-aware (pass pool + table + entityId):
 *   const result = await createTopicIdempotent({ pool, table, entityId, ...topicParams });
 *   // Returns { topicId, topicUrl, created: false } if topic already exists.
 */

import { createTopic as _createTopic, createPost as _createPost, createTopicWithRetry } from "./discourse.js";

/**
 * Create a Discourse topic.
 *
 * @param {object} params
 * @param {string} params.baseUrl       - Discourse base URL
 * @param {string} params.apiKey        - Discourse API key
 * @param {string} params.apiUsername   - Discourse API username
 * @param {string} params.title         - Topic title
 * @param {string} params.raw           - Topic body (Markdown)
 * @param {number} [params.categoryId]  - Category ID
 * @param {string[]} [params.tags]      - Tags
 * @returns {Promise<{topicId: number, topicSlug: string}>}
 */
export async function createTopic({ baseUrl, apiKey, apiUsername, title, raw, categoryId, tags }) {
  return _createTopic({ baseUrl, apiKey, apiUsername, title, raw, categoryId, tags });
}

/**
 * Create a Discourse post (reply) in an existing topic.
 *
 * @param {object} params
 * @param {string} params.baseUrl       - Discourse base URL
 * @param {string} params.apiKey        - Discourse API key
 * @param {string} params.apiUsername   - Discourse API username
 * @param {number} params.topicId       - Topic ID to reply to
 * @param {string} params.raw           - Post body (Markdown)
 * @returns {Promise<{postId: number}>}
 */
export async function createPost({ baseUrl, apiKey, apiUsername, topicId, raw }) {
  return _createPost({ baseUrl, apiKey, apiUsername, topicId, raw });
}

/**
 * Create a Discourse topic with automatic retry on transient errors.
 * Delegates directly to discourse.js createTopicWithRetry.
 */
export { createTopicWithRetry };

/** Allowed table names for idempotency checks — prevents SQL injection. */
const ALLOWED_TABLES = new Set(["bills", "motions", "statements", "regulations", "questiontime_questions"]);

/**
 * Idempotency-aware topic creation.
 *
 * Checks whether the entity row already has a discourseTopicId set.
 * If yes, returns the stored values without calling Discourse.
 * If no, calls createTopicWithRetry and patches the entity row.
 *
 * @param {object} params
 * @param {import("pg").Pool} params.pool       - PostgreSQL connection pool
 * @param {string}            params.table      - Table name (must be one of ALLOWED_TABLES)
 * @param {string}            params.entityId   - Entity row id
 * @param {string}            params.baseUrl
 * @param {string}            params.apiKey
 * @param {string}            params.apiUsername
 * @param {string}            params.title
 * @param {string}            params.raw
 * @param {number}            [params.categoryId]
 * @param {string[]}          [params.tags]
 * @returns {Promise<{topicId: number, topicUrl: string, created: boolean}>}
 */
export async function createTopicIdempotent({ pool, table, entityId, baseUrl, apiKey, apiUsername, title, raw, categoryId, tags }) {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`createTopicIdempotent: table "${table}" is not in the allowed list`);
  }

  // Idempotency: check if topic already created for this entity
  const { rows: existing } = await pool.query(
    `SELECT data->>'discourseTopicId'  AS topic_id,
            data->>'discourseTopicUrl' AS topic_url
       FROM ${table} WHERE id = $1`,
    [String(entityId)]
  );
  if (existing.length && existing[0].topic_id) {
    const topicUrl = existing[0].topic_url || `${baseUrl}/t/${existing[0].topic_id}`;
    return { topicId: Number(existing[0].topic_id), topicUrl, created: false };
  }

  // Create the topic
  const { topicId, topicSlug } = await createTopicWithRetry(
    { baseUrl, apiKey, apiUsername, title, raw, categoryId, tags: Array.isArray(tags) ? tags : undefined },
    3, 500
  );
  const topicUrl = topicSlug ? `${baseUrl}/t/${topicSlug}/${topicId}` : `${baseUrl}/t/${topicId}`;

  // Patch the entity row with the topic link
  await pool.query(
    `UPDATE ${table}
        SET data       = data || $1::jsonb,
            updated_at = NOW()
      WHERE id = $2`,
    [JSON.stringify({ discourseTopicId: topicId, discourseTopicUrl: topicUrl }), String(entityId)]
  );

  return { topicId, topicUrl, created: true };
}
