import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { atomicWrite } from './document.mjs';
import { readBounded, preserveInvalidFile } from './file-io.mjs';
import { validDate, addDays } from './app/shared/engine.js';

export const HOLIDAY_FEED =
  'https://calendar.google.com/calendar/ical/ko.south_korea.official%23holiday%40group.v.calendar.google.com/public/basic.ics';
export const HOLIDAY_REFRESH_MS = 6 * 60 * 60 * 1000;
export const HOLIDAY_RETRY_MS = 15 * 60 * 1000;
const MAX_BYTES = 512 * 1024;
const textValue = (text) =>
  text
    .replace(/\\[nN]/g, ' ')
    .replace(/\\([,;\\])/g, '$1')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim();
const iso = (value) =>
  /^\d{8}$/.test(value || '')
    ? value.slice(0, 4) + '-' + value.slice(4, 6) + '-' + value.slice(6)
    : '';

// The official-only Google feed still gets an explicit public-holiday check:
// observances, tentative events, timed appointments, and links are never imported.
export function parseHolidayFeed(text, year = new Date().getUTCFullYear()) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES)
    throw Error('Invalid holiday feed');
  const unfolded = text.replace(/\r\n[ \t]/g, '').replace(/\r\n/g, '\n');
  if (
    !unfolded.startsWith('BEGIN:VCALENDAR\n') ||
    !unfolded.trimEnd().endsWith('END:VCALENDAR') ||
    !/^X-WR-CALNAME:.*대한민국/m.test(unfolded)
  )
    throw Error('Invalid holiday calendar');
  const events = unfolded.match(/BEGIN:VEVENT\n[\s\S]*?\nEND:VEVENT/g) || [];
  if (events.length > 5000 || (unfolded.match(/BEGIN:VEVENT/g) || []).length !== events.length)
    throw Error('Invalid holiday events');
  const dates = new Map();
  for (const event of events) {
    const fields = new Map();
    for (const line of event.split('\n')) {
      const colon = line.indexOf(':');
      if (colon > 0) {
        const key = line.slice(0, colon);
        if (fields.has(key)) throw Error('Duplicate holiday field');
        fields.set(key, line.slice(colon + 1));
      }
    }
    if (fields.get('DESCRIPTION') !== '공휴일' || fields.get('STATUS') !== 'CONFIRMED') continue;
    if (
      ['RRULE', 'RDATE', 'EXDATE', 'RECURRENCE-ID'].some((key) =>
        [...fields.keys()].some((field) => field.split(';')[0] === key),
      )
    )
      throw Error('Unsupported recurring holiday');
    const start = iso(fields.get('DTSTART;VALUE=DATE')),
      end = iso(fields.get('DTEND;VALUE=DATE'));
    const name = textValue(fields.get('SUMMARY') || '');
    if (
      !validDate(start) ||
      !validDate(end) ||
      end <= start ||
      !name ||
      name.length > 160 ||
      end > addDays(start, 7)
    )
      throw Error('Invalid public holiday');
    for (let date = start; date < end; date = addDays(date, 1)) {
      const names = dates.get(date) || new Set();
      names.add(name);
      dates.set(date, names);
    }
  }
  const rows = [...dates]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, names]) => ({ date, name: [...names].join('·') }));
  validateRows(rows, year);
  return rows;
}
function validateRows(rows, year) {
  if (!Array.isArray(rows) || rows.length < 10 || rows.length > 3660)
    throw Error('Invalid holiday cache');
  const seen = new Set();
  for (const row of rows) {
    if (
      !row ||
      !validDate(row.date) ||
      seen.has(row.date) ||
      typeof row.name !== 'string' ||
      !row.name.trim() ||
      row.name.length > 160 ||
      /[\u0000-\u001f\u007f]/.test(row.name)
    )
      throw Error('Invalid holiday cache');
    seen.add(row.date);
  }
  // Reject partial/error/observance feeds instead of replacing a good offline cache.
  if (
    year !== undefined &&
    (rows.filter((row) => row.date.startsWith(year + '-')).length < 10 ||
      ['01-01', '03-01', '05-05', '06-06', '08-15', '10-03', '10-09', '12-25'].some(
        (day) => !seen.has(year + '-' + day),
      ))
  )
    throw Error('Incomplete holiday calendar');
  return rows;
}
export class HolidaySync {
  constructor({
    file,
    fetcher = (...args) => globalThis.fetch(...args),
    now = Date.now,
    notify = () => {},
    enabled = true,
  }) {
    this.file = file;
    this.fetcher = fetcher;
    this.now = now;
    this.notify = notify;
    this.enabled = enabled;
    this.holidays = [];
    this.checkedAt = null;
    this.attemptedAt = null;
    this.error = null;
    this.pending = null;
    this.corrupt = false;
    try {
      const value = JSON.parse(readBounded(file, MAX_BYTES));
      if (
        value.version !== 1 ||
        value.source !== HOLIDAY_FEED ||
        !Number.isFinite(Date.parse(value.checkedAt)) ||
        Date.parse(value.checkedAt) > now() + 300000
      )
        throw Error('Invalid holiday cache');
      this.holidays = validateRows(value.holidays);
      this.checkedAt = value.checkedAt;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.corrupt = true;
        this.error = 'cache';
      }
    }
  }
  snapshot() {
    return {
      source: 'Google Calendar',
      sourceUrl: HOLIDAY_FEED,
      enabled: this.enabled,
      checkedAt: this.checkedAt,
      attemptedAt: this.attemptedAt,
      error: this.error,
      checking: Boolean(this.pending),
      holidays: structuredClone(this.holidays),
    };
  }
  emit() {
    this.notify(this.snapshot());
  }
  setEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw Error('Invalid holiday preference');
    this.enabled = enabled;
    this.emit();
  }
  async refresh(force = false) {
    if (this.pending) return this.pending;
    if (!this.enabled && !force) return this.snapshot();
    const now = this.now(),
      last = this.error ? Date.parse(this.attemptedAt || '') : Date.parse(this.checkedAt || '');
    if (
      !force &&
      Number.isFinite(last) &&
      now - last < (this.error ? HOLIDAY_RETRY_MS : HOLIDAY_REFRESH_MS)
    )
      return this.snapshot();
    this.attemptedAt = new Date(now).toISOString();
    this.pending = Promise.resolve().then(async () => {
      let phase = 'network';
      try {
        const response = await this.fetcher(HOLIDAY_FEED, {
          redirect: 'error',
          credentials: 'omit',
          signal: AbortSignal.timeout(15000),
          headers: { Accept: 'text/calendar' },
        });
        if (!response.ok || !response.body) throw Error('Holiday source unavailable');
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.byteLength;
          if (size > MAX_BYTES) {
            await response.body.cancel?.().catch(() => {});
            throw Error('Holiday source too large');
          }
          chunks.push(Buffer.from(chunk));
        }
        const holidays = parseHolidayFeed(
          Buffer.concat(chunks).toString('utf8'),
          new Date(this.now()).getUTCFullYear(),
        );
        const checkedAt = new Date(this.now()).toISOString();
        phase = 'storage';
        mkdirSync(path.dirname(this.file), { recursive: true });
        if (this.corrupt) preserveInvalidFile(this.file, MAX_BYTES);
        atomicWrite(
          this.file,
          JSON.stringify({ version: 1, source: HOLIDAY_FEED, checkedAt, holidays }),
        );
        this.holidays = holidays;
        this.checkedAt = checkedAt;
        this.error = null;
        this.corrupt = false;
      } catch (error) {
        this.error = this.corrupt ? 'cache' : phase === 'storage' ? 'storage' : 'unavailable';
      } finally {
        this.pending = null;
        this.emit();
      }
      return this.snapshot();
    });
    this.emit();
    return this.pending;
  }
  start() {
    const startup = setTimeout(() => void this.refresh(), 1500);
    const interval = setInterval(() => void this.refresh(), 60000);
    startup.unref?.();
    interval.unref?.();
    return () => {
      clearTimeout(startup);
      clearInterval(interval);
    };
  }
}
