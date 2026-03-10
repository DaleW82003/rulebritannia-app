/**
 * Add n simulation months to a (year, month) pair, rolling year over.
 * Returns { sim_year, sim_month }.
 */
export function addSimMonths(year, month, n) {
  const total = (month - 1) + n;
  return {
    sim_year: year + Math.floor(total / 12),
    sim_month: (total % 12) + 1,
  };
}

/**
 * Compute a { month, year } sim deadline by adding `months` to the current sim time.
 */
export function simDeadline(simMonth, simYear, months) {
  const total = simMonth + months - 1; // 0-indexed offset
  return {
    month: ((total % 12) || 12),
    year: simYear + Math.floor(total / 12),
  };
}

/**
 * Format a sim deadline as a TEXT value for the divisions.closes_at_sim column.
 * e.g. { month: 1, year: 1998 } → "1998-01"
 */
export function simDeadlineToText(month, year) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Returns a closes_at_sim TEXT value 1 sim month from now. */
export function nextSimMonth(simMonth, simYear) {
  const d = simDeadline(simMonth, simYear, 1);
  return simDeadlineToText(d.month, d.year);
}
