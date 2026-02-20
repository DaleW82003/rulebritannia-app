// js/clock.js
// Clock rules:
// - Monday/Tuesday/Wednesday = one simulation month block
// - Thursday/Friday/Saturday = one simulation month block
// - Sunday is frozen (no advancement)
// This yields 2 simulation months per real week.

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];

/* ------------------------------------------------------------------ */
/*  Core sim-date calculation                                          */
/* ------------------------------------------------------------------ */

export function getSimDate(gameState, now = new Date()) {
  if (!gameState || typeof gameState !== "object") {
    return { monthIndex: 0, monthName: MONTHS[0], year: 1997 };
  }
  const startReal = new Date(gameState.startRealDate);
  const startMonth = Number(gameState.startSimMonth); // 1-12
  const startYear = Number(gameState.startSimYear);
  if (Number.isNaN(startReal.getTime())) {
    return { monthIndex: Math.max(0, Math.min(11, startMonth - 1)), monthName: MONTHS[Math.max(0, Math.min(11, startMonth - 1))], year: startYear };
  }

  if (gameState.started === false) {
    const fallbackIndex = Math.max(0, Math.min(11, Number.isFinite(startMonth) ? startMonth - 1 : 0));
    return { monthIndex: fallbackIndex, monthName: MONTHS[fallbackIndex], year: Number.isFinite(startYear) ? startYear : 1997 };
  }

  // When paused, compute sim date as of the moment we paused (not start date)
  let effectiveNow = new Date(now);
  if (gameState.isPaused && gameState.pausedAtRealDate) {
    effectiveNow = new Date(gameState.pausedAtRealDate);
  }

  const start = new Date(startReal);
  const end = new Date(effectiveNow);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  // Count Mondays and Thursdays between start and end using O(1) arithmetic
  // instead of iterating day-by-day.
  function countWeekday(from, to, targetDay) {
    // Count occurrences of targetDay (0=Sun..6=Sat) in the half-open range (from, to].
    const totalDays = Math.round((to - from) / 86400000);
    if (totalDays <= 0) return 0;
    const fullWeeks = Math.floor(totalDays / 7);
    let count = fullWeeks;
    const startDay = from.getDay();
    const remainder = totalDays % 7;
    for (let i = 1; i <= remainder; i++) {
      if ((startDay + i) % 7 === targetDay) count++;
    }
    return count;
  }

  let simMonthsElapsed = 0;
  if (end > start) {
    simMonthsElapsed = countWeekday(start, end, 1) + countWeekday(start, end, 4);
  } else if (end < start) {
    simMonthsElapsed = -(countWeekday(end, start, 1) + countWeekday(end, start, 4));
  }

  let monthIndex = (startMonth - 1) + simMonthsElapsed;
  let year = startYear + Math.floor(monthIndex / 12);
  monthIndex = ((monthIndex % 12) + 12) % 12;

  return { monthIndex, monthName: MONTHS[monthIndex], year };
}

/* ------------------------------------------------------------------ */
/*  Formatting helpers                                                 */
/* ------------------------------------------------------------------ */

export function formatSimMonthYear(gameState) {
  const d = getSimDate(gameState);
  return `${d.monthName} ${d.year}`;
}

export function getWeekdayName(now = new Date()) {
  const day = new Date(now).getDay();
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day] || "Sunday";
}

export function isSunday(now = new Date()) {
  return new Date(now).getDay() === 0;
}

/** Convert getSimDate() result to a { month: 1-12, year } object */
export function simDateToObj(simDate) {
  return { month: simDate.monthIndex + 1, year: simDate.year };
}

/** Format a { month, year } or (month, year) pair as "Month YYYY" */
export function formatSimDate(monthOrObj, year) {
  let m, y;
  if (typeof monthOrObj === "object" && monthOrObj !== null) {
    m = monthOrObj.month;
    y = monthOrObj.year;
  } else {
    m = monthOrObj;
    y = year;
  }
  return `${MONTHS[((m - 1) % 12 + 12) % 12]} ${y}`;
}

/* ------------------------------------------------------------------ */
/*  Sim-month arithmetic                                               */
/* ------------------------------------------------------------------ */

/** Add N sim months to (month, year). Returns { month: 1-12, year } */
export function plusSimMonths(month, year, add) {
  const total = (year * 12) + (month - 1) + add;
  return { month: (total % 12) + 1, year: Math.floor(total / 12) };
}

/** Compare two { month, year } objects. Returns <0 if a<b, 0 if equal, >0 if a>b */
export function compareSimDates(a, b) {
  const aTotal = a.year * 12 + (a.month - 1);
  const bTotal = b.year * 12 + (b.month - 1);
  return aTotal - bTotal;
}

/** Check whether a { month, year } deadline has been reached or passed */
export function isDeadlinePassed(deadline, gameState) {
  if (!deadline || !deadline.month || !deadline.year) return false;
  const now = simDateToObj(getSimDate(gameState));
  return compareSimDates(now, deadline) >= 0;
}

/** How many sim months remain until a deadline (min 0) */
export function simMonthsRemaining(deadline, gameState) {
  if (!deadline || !deadline.month || !deadline.year) return 0;
  const now = simDateToObj(getSimDate(gameState));
  const nowTotal = now.year * 12 + (now.month - 1);
  const deadlineTotal = deadline.year * 12 + (deadline.month - 1);
  return Math.max(0, deadlineTotal - nowTotal);
}

/** Create a deadline N sim months from the current sim date */
export function createDeadline(gameState, simMonthsFromNow) {
  const now = simDateToObj(getSimDate(gameState));
  return plusSimMonths(now.month, now.year, simMonthsFromNow);
}

/* ------------------------------------------------------------------ */
/*  Real-time countdown helpers                                        */
/* ------------------------------------------------------------------ */

/**
 * Compute the real-world Date when a given sim month begins.
 * Walks forward from startRealDate counting Monday (dow 1) and Thursday (dow 4)
 * boundaries until the required number of sim months have elapsed.
 */
export function realDateOfSimMonth(targetMonth, targetYear, gameState) {
  if (!gameState || !gameState.startRealDate) return null;
  const startReal = new Date(gameState.startRealDate);
  if (!Number.isFinite(startReal.getTime())) return null;

  const startSimTotal = (gameState.startSimYear * 12) + (gameState.startSimMonth - 1);
  const targetTotal = (targetYear * 12) + (targetMonth - 1);
  const monthsNeeded = targetTotal - startSimTotal;

  if (monthsNeeded <= 0) return new Date(startReal);

  const d = new Date(startReal);
  d.setHours(0, 0, 0, 0);
  let counted = 0;

  // Walk forward day-by-day. Sim durations are typically 1-4 months (1-2 real weeks),
  // so this loop is very short in practice.
  for (let i = 0; i < 10000; i++) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow === 1 || dow === 4) { // Monday or Thursday = sim month boundary
      counted++;
      if (counted >= monthsNeeded) return new Date(d);
    }
  }
  return null;
}

/**
 * Human-readable countdown to a sim month deadline.
 * Returns strings like "2d 14h 30m", "Expired", "Paused", "---".
 */
export function countdownToSimMonth(targetMonth, targetYear, gameState) {
  if (gameState.isPaused) return "Paused";

  const target = realDateOfSimMonth(targetMonth, targetYear, gameState);
  if (!target) return "---";

  const now = new Date();
  const diffMs = target.getTime() - now.getTime();

  if (diffMs <= 0) return "Expired";

  const sec = Math.floor(diffMs / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);

  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
