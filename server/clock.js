import { getDefaultScenarioKey, loadScenarioManifest } from "./scenario-manifest-loader.js";

function getDefaultScenarioClockFallback() {
  try {
    const manifest = loadScenarioManifest(getDefaultScenarioKey());
    const month = Number(manifest?.clockDefault?.month);
    const year = Number(manifest?.clockDefault?.year);
    if (Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(year) && year > 0) {
      return { month, year };
    }
  } catch {
    // Use runtime fallback below.
  }
  return { month: 1, year: new Date().getUTCFullYear() };
}

/**
 * server/clock.js
 *
 * Server-side clock helpers.  These mirror the logic in js/clock.js (the
 * client-side module used by the navbar) so that all server-side content
 * creation uses the same sim-date computation as the UI.
 *
 * Keep this file in sync with js/clock.js whenever the clock algorithm
 * changes.
 */

/**
 * Compute the current sim month/year from a gameState object, mirroring the
 * clock.js getSimDate() logic used by the navbar.  This is the single server-
 * side source-of-truth for "what sim month is it right now?" and must be kept
 * aligned with the client-side helper.
 *
 * Rules (same as js/clock.js):
 *  - sim not started → return configured startSimMonth / startSimYear
 *  - sim paused      → freeze at pausedAtRealDate
 *  - sim running     → count Mondays + Thursdays elapsed since startRealDate
 *
 * @param {object|null} gameState
 * @param {Date} [now] - Override "now" for testing purposes
 * @returns {{ month: number, year: number }}
 */
export function computeSimDateFromGameState(gameState, now = new Date()) {
  const clockFallback = getDefaultScenarioClockFallback();
  if (!gameState || typeof gameState !== "object") {
    return { ...clockFallback };
  }
  const startMonth = Number(gameState.startSimMonth);
  const startYear  = Number(gameState.startSimYear);
  const validStart = Number.isFinite(startMonth) && startMonth >= 1 && startMonth <= 12
                  && Number.isFinite(startYear);

  // Sim not yet started — return the configured start month/year.
  if (gameState.started === false) {
    return {
      month: validStart ? startMonth : clockFallback.month,
      year:  validStart ? startYear  : clockFallback.year,
    };
  }

  // Sim started but startRealDate missing/invalid — fall back to start values.
  if (!gameState.startRealDate || !validStart) {
    return { month: validStart ? startMonth : clockFallback.month, year: validStart ? startYear : clockFallback.year };
  }

  const startReal = new Date(gameState.startRealDate);
  if (!Number.isFinite(startReal.getTime())) {
    return { month: startMonth, year: startYear };
  }

  let effectiveNow = new Date(now);
  if (gameState.isPaused && gameState.pausedAtRealDate) {
    const pausedDate = new Date(gameState.pausedAtRealDate);
    if (Number.isFinite(pausedDate.getTime())) effectiveNow = pausedDate;
  }

  const start = new Date(startReal);
  const end   = new Date(effectiveNow);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  // Count occurrences of targetDay (0=Sun..6=Sat) in the half-open range (from, to].
  function countWeekday(from, to, targetDay) {
    const totalDays = Math.round((to - from) / 86400000);
    if (totalDays <= 0) return 0;
    const fullWeeks  = Math.floor(totalDays / 7);
    let   count      = fullWeeks;
    const startDay   = from.getDay();
    const remainder  = totalDays % 7;
    for (let i = 1; i <= remainder; i++) {
      if ((startDay + i) % 7 === targetDay) count++;
    }
    return count;
  }

  let simMonthsElapsed = 0;
  if (end > start) {
    // Monday = 1, Thursday = 4
    simMonthsElapsed = countWeekday(start, end, 1) + countWeekday(start, end, 4);
  } else if (end < start) {
    simMonthsElapsed = -(countWeekday(end, start, 1) + countWeekday(end, start, 4));
  }

  let monthIndex = (startMonth - 1) + simMonthsElapsed;
  let year       = startYear + Math.floor(monthIndex / 12);
  monthIndex     = ((monthIndex % 12) + 12) % 12;

  return { month: monthIndex + 1, year };
}
