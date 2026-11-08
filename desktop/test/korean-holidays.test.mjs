import test from 'node:test';
import assert from 'node:assert/strict';
import { koreanHolidays, projectHolidays } from '../../shared/browser/korean-holidays.js';
import {
  workdays,
  nextWorkday,
  forecast,
  capacityCalendar,
  summary,
  validateProject,
} from '../../shared/browser/engine.js';
import { scheduleWarnings } from '../../shared/browser/planning.js';
import { normalizeProject, serializeDocument, parseDocument } from '../document.mjs';

test('2026/2027 calendar matches KASA/KASI, including new holidays and Memorial Day exception', () => {
  assert.deepEqual(
    koreanHolidays(2027).map((day) => day.date.slice(5)),
    [
      '01-01',
      '02-06',
      '02-07',
      '02-08',
      '02-09',
      '03-01',
      '05-01',
      '05-03',
      '05-05',
      '05-13',
      '06-06',
      '07-17',
      '07-19',
      '08-15',
      '08-16',
      '09-14',
      '09-15',
      '09-16',
      '10-03',
      '10-04',
      '10-09',
      '10-11',
      '12-25',
      '12-27',
    ],
  );
  const h = projectHolidays({ koreanHolidays: true, holidays: [] });
  assert.equal(nextWorkday('2028-10-02', h), '2028-10-06');
  assert.equal(nextWorkday('2036-10-03', h), '2036-10-08');
  assert.equal(workdays('2026-01-01', '2026-12-31', h), 245); // 120 days off, official revised almanac
  assert.equal(workdays('2027-01-01', '2027-12-31', h), 246); // 119 days off
  assert.equal(nextWorkday('2027-06-06', h), '2027-06-07');
  assert.equal(nextWorkday('2027-05-01', h), '2027-05-04');
  assert.equal(nextWorkday('2027-07-17', h), '2027-07-20');
  assert.equal(nextWorkday('2026-06-03', h), '2026-06-04');
});
test('historical substitutions, shared holidays and manual overlap count each nonworking day once', () => {
  const h = projectHolidays({
    koreanHolidays: true,
    holidays: ['2025-05-06', '2025-05-06', '2025-05-07'],
  });
  assert.equal(nextWorkday('2025-05-05', h), '2025-05-08');
  assert.equal(workdays('2025-05-05', '2025-05-09', h), 2);
  assert.equal(
    koreanHolidays(2021).some((day) => day.date === '2021-03-02'),
    false,
  );
  assert.equal(
    koreanHolidays(2021).some((day) => day.date === '2021-08-16'),
    true,
  );
  assert.equal(
    koreanHolidays(2022).some((day) => day.date === '2022-12-26'),
    false,
  );
  assert.equal(
    koreanHolidays(2023).some((day) => day.date === '2023-05-29'),
    true,
  );
  const p = { koreanHolidays: true, holidays: [] };
  projectHolidays(p);
  p.holidays.push('2026-11-03');
  assert.ok(projectHolidays(p).includes('2026-11-03'));
  p.koreanHolidays = false;
  assert.deepEqual(projectHolidays(p), ['2026-11-03']);
});
test('desktop enables automatic holidays, preserves opt-out, and uses the calendar in forecasts and staffing', () => {
  const p = normalizeProject({
    id: 'p',
    koreanHolidays: true,
    name: 'Holiday schedule',
    description: '',
    holidays: [],
    members: [{ id: 'm', name: 'Member', role: '', grade: '', hours: 8, allocation: 100 }],
    tasks: [
      {
        id: 't',
        name: 'Task',
        phase: '',
        owner: 'm',
        start: '2027-04-30',
        end: '2027-05-04',
        predecessor: '',
        memo: '',
        items: [{ id: 'i', title: 'Work', hours: 16, doneDate: null }],
      },
    ],
  });
  assert.equal(p.koreanHolidays, true);
  assert.equal(forecast(p, '2027-04-29').end, '2027-05-04');
  assert.equal(summary(p, '2027-05-03').planned, 0.5);
  assert.equal(capacityCalendar(p).totalHours('m', '2027-04-30', '2027-05-04'), 16);
  const opted = { ...p, koreanHolidays: false };
  assert.equal(parseDocument(serializeDocument(opted)).koreanHolidays, false);
  assert.equal(summary(opted, '2027-05-03').planned, 2 / 3);
  const legacy = { ...p, tasks: [{ ...p.tasks[0], start: '2027-05-03', end: '2027-05-03' }] };
  assert.doesNotThrow(() => validateProject(legacy));
  assert.deepEqual(
    scheduleWarnings(legacy).nonWorking.map((task) => task.id),
    ['t'],
  );
  assert.doesNotThrow(() => validateProject({ ...legacy, koreanHolidays: false }));
  assert.deepEqual(scheduleWarnings(legacy).overloads, []);
  assert.throws(() => normalizeProject({ ...p, koreanHolidays: 'yes' }), /공휴일/);
});
