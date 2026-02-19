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

  let simMonthsElapsed = 0;
  if (end > start) {
    const cursor = new Date(start);
    while (cursor < end) {
      cursor.setDate(cursor.getDate() + 1);
      const wd = cursor.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
      if (wd === 1 || wd === 4) simMonthsElapsed += 1;
    }
  } else if (end < start) {
    const cursor = new Date(start);
    while (cursor > end) {
      const wd = cursor.getDay();
      if (wd === 1 || wd === 4) simMonthsElapsed -= 1;
      cursor.setDate(cursor.getDate() - 1);
    }
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
