// js/clock.js
// Very simple: 1 real week = 2 sim months (as you specified)
// Sunday freeze logic can be plugged in later; for now we just compute sim month/year.

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];

export function getSimDate(gameState, now = new Date()) {
  const startReal = new Date(gameState.startRealDate);
  const startMonth = Number(gameState.startSimMonth); // 1-12
  const startYear = Number(gameState.startSimYear);

  const msPerDay = 24 * 60 * 60 * 1000;
  const days = Math.floor((now - startReal) / msPerDay);

  // 1 week = 2 sim months => 7 days = 2 months => 1 day = 2/7 months
  const simMonthsElapsed = Math.floor((days * 2) / 7);

  let monthIndex = (startMonth - 1) + simMonthsElapsed;
  let year = startYear + Math.floor(monthIndex / 12);
  monthIndex = ((monthIndex % 12) + 12) % 12;

  return { monthIndex, monthName: MONTHS[monthIndex], year };
}

export function formatSimMonthYear(gameState) {
  const d = getSimDate(gameState);
  return `${d.monthName} ${d.year}`;
}
