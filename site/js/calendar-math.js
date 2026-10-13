// Imperial calendar arithmetic, shared by the site and the build script.
//
// A year has 365 days. Day 001 is Holiday and belongs to no week or month.
// Days 002-365 form 52 weeks of 7 days and 13 months of 28 days.
// Day 002 is a Sunday.

export const DAYS_PER_YEAR = 365;
export const HOLIDAY = 1;
export const DAYS_PER_WEEK = 7;
export const DAYS_PER_MONTH = 28;
export const MONTHS_PER_YEAR = 13;
export const WEEKS_PER_YEAR = 52;

export const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

/** True when `day` is a valid day-of-year (1-365). */
export function isValidDay(day) {
  return Number.isInteger(day) && day >= 1 && day <= DAYS_PER_YEAR;
}

/** Absolute day number: lets dates in different years be compared and subtracted. */
export function toAbs(day, year) {
  return year * DAYS_PER_YEAR + (day - 1);
}

/** Inverse of toAbs. */
export function fromAbs(abs) {
  return {
    day: (abs % DAYS_PER_YEAR) + 1,
    year: Math.floor(abs / DAYS_PER_YEAR),
  };
}

export function isHoliday(day) {
  return day === HOLIDAY;
}

/** 0 = Sunday ... 6 = Saturday, or null for Holiday. */
export function weekdayIndex(day) {
  return isHoliday(day) ? null : (day - 2) % DAYS_PER_WEEK;
}

export function weekdayName(day) {
  const i = weekdayIndex(day);
  return i === null ? "Holiday" : WEEKDAYS[i];
}

/** Week 1-52, or null for Holiday. */
export function weekOf(day) {
  return isHoliday(day) ? null : Math.floor((day - 2) / DAYS_PER_WEEK) + 1;
}

/** Month 1-13, or null for Holiday. */
export function monthOf(day) {
  return isHoliday(day) ? null : Math.floor((day - 2) / DAYS_PER_MONTH) + 1;
}

/** First and last day-of-year of a month (1-13). */
export function monthRange(month) {
  const first = 2 + (month - 1) * DAYS_PER_MONTH;
  return { first, last: first + DAYS_PER_MONTH - 1 };
}

/** `207-1105` style label. */
export function formatDate(day, year) {
  return `${String(day).padStart(3, "0")}-${year}`;
}

/** Parse `207-1105` into { day, year }, or null if malformed or out of range. */
export function parseDate(text) {
  const m = /^\s*(\d{1,3})-(\d{4})\s*$/.exec(text);
  if (!m) return null;
  const day = Number(m[1]);
  const year = Number(m[2]);
  return isValidDay(day) ? { day, year } : null;
}
