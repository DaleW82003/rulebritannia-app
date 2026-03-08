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
 * Log line format:
 *   [recompute] start  type=<type> trigger=<trigger>
 *   [recompute] ok     type=<type> trigger=<trigger> dur=<N>ms
 *   [recompute] FAILED type=<type> trigger=<trigger> dur=<N>ms err=<message>
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
 */
export function fireRecompute(recomputeType, trigger, fn) {
  const start = Date.now();
  console.log(`[recompute] start  type=${recomputeType} trigger=${trigger}`);
  fn().then(() => {
    console.log(`[recompute] ok     type=${recomputeType} trigger=${trigger} dur=${Date.now() - start}ms`);
  }).catch((err) => {
    console.error(
      `[recompute] FAILED type=${recomputeType} trigger=${trigger} dur=${Date.now() - start}ms err=${err?.message ?? err}`
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
 * @returns {Promise<*>}  Resolves with the fn() result; rejects on failure
 *                        (caller must handle the rejection).
 */
export async function awaitedRecompute(recomputeType, trigger, fn) {
  const start = Date.now();
  console.log(`[recompute] start  type=${recomputeType} trigger=${trigger}`);
  try {
    const result = await fn();
    console.log(`[recompute] ok     type=${recomputeType} trigger=${trigger} dur=${Date.now() - start}ms`);
    return result;
  } catch (err) {
    console.error(
      `[recompute] FAILED type=${recomputeType} trigger=${trigger} dur=${Date.now() - start}ms err=${err?.message ?? err}`
    );
    throw err;
  }
}
