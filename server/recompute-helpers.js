/**
 * Recompute observability helpers.
 *
 * Provides a thin wrapper around fire-and-forget recompute calls so that:
 *   - every execution emits a structured start log
 *   - successes are logged with wall-clock duration
 *   - failures are always logged (no silent promise rejection swallow)
 *   - the trigger source is recorded alongside the recompute type
 *
 * Usage:
 *
 *   // Non-blocking (fire-and-forget):
 *   fireRecompute("character-political-state", "office.assign", () =>
 *     recomputeCharacterPoliticalState(charId)
 *   );
 *
 *   // Awaited (still benefits from structured logging):
 *   await awaitedRecompute("faction-political-state", "seed", () =>
 *     computeFactionPoliticalState(factionId)
 *   );
 *
 * An optional entityId can be supplied to correlate log lines back to the
 * specific entity (character ID, faction ID, …) being recomputed.  When
 * provided it appears as an `entity=` field in every log line, making it
 * straightforward to `grep` for a single entity's recompute history.
 *
 * Log line format:
 *   [recompute] start  type=<type> trigger=<trigger>
 *   [recompute] ok     type=<type> trigger=<trigger> dur=<N>ms
 *   [recompute] FAILED type=<type> trigger=<trigger> dur=<N>ms err=<message>
 *
 * With entityId supplied:
 *   [recompute] start  type=<type> trigger=<trigger> entity=<entityId>
 *   [recompute] ok     type=<type> trigger=<trigger> entity=<entityId> dur=<N>ms
 *   [recompute] FAILED type=<type> trigger=<trigger> entity=<entityId> dur=<N>ms err=<message>
 */

/**
 * Run a recompute as a fire-and-forget (non-blocking).
 *
 * The returned Promise is intentionally discarded after attaching a
 * guaranteed `.catch()` handler so rejections can never escape silently.
 *
 * @param {string} recomputeType  - Short label for what is being recomputed
 *                                  (e.g. "character-political-state")
 * @param {string} trigger        - What caused this recompute
 *                                  (e.g. "office.assign", "division.vote")
 * @param {() => Promise<*>} fn   - Zero-argument async factory that performs
 *                                  the recompute
 * @param {string|number} [entityId] - Optional entity identifier
 *                                  (e.g. a character ID or faction ID).
 *                                  When provided, appears as `entity=<id>` in
 *                                  every log line so individual entities can be
 *                                  traced when logs are busy.
 */
function normaliseTarget(target) {
  if (target == null) return null;
  if (typeof target === "object" && !Array.isArray(target)) {
    const targetScope = target.scope != null ? String(target.scope) : "entity";
    const targetId = target.id != null ? String(target.id) : null;
    if (targetId == null) return null;
    return { targetScope, targetId };
  }
  return { targetScope: "entity", targetId: String(target) };
}

function formatTargetLogSuffix(target) {
  const parsed = normaliseTarget(target);
  if (!parsed) return "";
  return ` entity=${parsed.targetId} target_scope=${parsed.targetScope} target_id=${parsed.targetId}`;
}

export function createRecomputeContext({ recomputeType, triggerSource, targetScope, targetId, executionMode = "async" }) {
  return {
    recomputeType: String(recomputeType),
    triggerSource: String(triggerSource),
    targetScope: targetScope != null ? String(targetScope) : undefined,
    targetId: targetId != null ? String(targetId) : undefined,
    executionMode: String(executionMode),
  };
}

export function buildRecomputeResponseMetadata(context, { status = "queued", staleReadWindow = "brief", note } = {}) {
  const meta = {
    type: String(context.recomputeType),
    triggerSource: String(context.triggerSource),
    target: {
      scope: context.targetScope != null ? String(context.targetScope) : "entity",
      id: context.targetId != null ? String(context.targetId) : undefined,
    },
    executionMode: String(context.executionMode || "async"),
    status: String(status),
    staleReadWindow: String(staleReadWindow),
  };
  if (note) meta.note = String(note);
  return meta;
}

export function fireRecompute(recomputeType, trigger, fn, entityId) {
  const targetSuffix = formatTargetLogSuffix(entityId);
  const start = Date.now();
  console.log(`[recompute] start  type=${recomputeType} trigger=${trigger}${targetSuffix}`);
  fn().then(() => {
    console.log(`[recompute] ok     type=${recomputeType} trigger=${trigger}${targetSuffix} dur=${Date.now() - start}ms`);
  }).catch((err) => {
    console.error(
      `[recompute] FAILED type=${recomputeType} trigger=${trigger}${targetSuffix} dur=${Date.now() - start}ms err=${err?.message ?? err}`
    );
  });
}

/**
 * Run a recompute and await the result, with structured start/success/failure logging.
 *
 * Unlike `fireRecompute`, this is blocking — use it when the route handler
 * needs the result before responding (e.g. GET /api/me/political-state).
 *
 * @param {string} recomputeType
 * @param {string} trigger
 * @param {() => Promise<*>} fn
 * @param {string|number} [entityId] - Optional entity identifier (same as fireRecompute).
 * @returns {Promise<*>}  Resolves with the fn() result; rejects on failure
 *                        (caller must handle the rejection).
 */
export async function awaitedRecompute(recomputeType, trigger, fn, entityId) {
  const targetSuffix = formatTargetLogSuffix(entityId);
  const start = Date.now();
  console.log(`[recompute] start  type=${recomputeType} trigger=${trigger}${targetSuffix}`);
  try {
    const result = await fn();
    console.log(`[recompute] ok     type=${recomputeType} trigger=${trigger}${targetSuffix} dur=${Date.now() - start}ms`);
    return result;
  } catch (err) {
    console.error(
      `[recompute] FAILED type=${recomputeType} trigger=${trigger}${targetSuffix} dur=${Date.now() - start}ms err=${err?.message ?? err}`
    );
    throw err;
  }
}
