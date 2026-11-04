import { KOREAN_HOLIDAYS } from './korean-holidays-data.js';

export const HOLIDAY_FIRST_YEAR = 2020;
export const HOLIDAY_LAST_YEAR = 2050;
let downloaded = new Map();
let generation = 0;
let automaticDates = Object.freeze(Object.keys(KOREAN_HOLIDAYS));
const cache = new WeakMap();
export function setKoreanHolidayUpdates(rows = []) {
  if (!Array.isArray(rows) || rows.length > 3660) throw Error('Invalid public holiday data');
  const next = new Map();
  for (const row of rows) {
    if (
      !row ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
      row.date < '1900-01-01' ||
      row.date > '2200-12-31' ||
      !Number.isFinite(Date.parse(row.date + 'T00:00:00Z')) ||
      new Date(row.date + 'T00:00:00Z').toISOString().slice(0, 10) !== row.date ||
      typeof row.name !== 'string' ||
      !row.name.trim() ||
      row.name.length > 160 ||
      /[\u0000-\u001f\u007f]/.test(row.name)
    )
      throw Error('Invalid public holiday data');
    next.set(row.date, row.name);
  }
  const sorted = [...next].sort(([a], [b]) => a.localeCompare(b));
  if (JSON.stringify(sorted) === JSON.stringify([...downloaded])) return false;
  downloaded = new Map(sorted);
  automaticDates = Object.freeze(
    [...new Set([...Object.keys(KOREAN_HOLIDAYS), ...downloaded.keys()])].sort(),
  );
  generation++;
  return true;
}
export function koreanHolidays(year) {
  const prefix = String(year) + '-';
  return [...new Map([...downloaded, ...Object.entries(KOREAN_HOLIDAYS)])]
    .filter(([date]) => date.startsWith(prefix))
    .map(([date, name]) => ({ date, name }));
}
export function projectHolidays(project) {
  const manual = project.holidays || [];
  if (project.koreanHolidays !== true) return manual;
  const signature = JSON.stringify(manual),
    previous = cache.get(project);
  if (previous?.signature === signature && previous.generation === generation)
    return previous.dates;
  const dates = Object.freeze([...new Set([...manual, ...automaticDates])]);
  cache.set(project, { signature, dates, generation });
  return dates;
}
