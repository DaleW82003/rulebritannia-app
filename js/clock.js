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

  const start = new Date(startReal);
  const end = new Date(now);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  if (gameState.started === false) {
    const fallbackIndex = Math.max(0, Math.min(11, Number.isFinite(startMonth) ? startMonth - 1 : 0));
    return { monthIndex: fallbackIndex, monthName: MONTHS[fallbackIndex], year: Number.isFinite(startYear) ? startYear : 1997 };
  }

  if (gameState.isPaused) {
    const fallbackIndex = Math.max(0, Math.min(11, Number.isFinite(startMonth) ? startMonth - 1 : 0));
    return { monthIndex: fallbackIndex, monthName: MONTHS[fallbackIndex], year: Number.isFinite(startYear) ? startYear : 1997 };
  }

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
