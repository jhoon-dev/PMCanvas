import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  HolidaySync,
  parseHolidayFeed,
  HOLIDAY_FEED,
  HOLIDAY_REFRESH_MS,
  HOLIDAY_RETRY_MS,
} from '../holiday-sync.mjs';
import {
  setKoreanHolidayUpdates,
  projectHolidays,
  koreanHolidays,
} from '../app/shared/korean-holidays.js';
import { forecast } from '../app/shared/engine.js';
import { DesktopWorkspace } from '../workspace.mjs';

import { holidayFeed } from './holiday-feed-fixture.mjs';

test('automatic startup and periodic checks run without manual interaction and stop on shutdown', async (t) => {
  const { file } = fixture(t);
  let calls = 0;
  t.mock.timers.enable({
    apis: ['setTimeout', 'setInterval', 'Date'],
    now: Date.parse('2026-11-03T09:00Z'),
  });
  const sync = new HolidaySync({
    file,
    fetcher: async () => {
      calls++;
      return new Response(holidayFeed());
    },
  });
  const stop = sync.start();
  t.mock.timers.tick(1500);
  await sync.pending;
  assert.equal(calls, 1);
  t.mock.timers.tick(HOLIDAY_REFRESH_MS + 60000);
  await sync.pending;
  assert.equal(calls, 2);
  stop();
  t.mock.timers.tick(HOLIDAY_REFRESH_MS * 2);
  assert.equal(calls, 2);
});

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-holiday-sync-'));
  t.after(() => {
    setKoreanHolidayUpdates([]);
    rmSync(root, { recursive: true, force: true });
  });
  return { root, file: path.join(root, 'holidays.json') };
}
test('ICS imports only confirmed public holidays, unfolds names, expands exclusive date ranges and rejects partial or unsupported feeds', () => {
  const text = holidayFeed([
    { date: '2026-11-05', name: '임시공\r\n 휴일' },
    { date: '2026-11-06', name: '선거일', end: '2026-11-08' },
    { date: '2026-11-09', name: '일반 기념일', description: '기념일' },
    { date: '2026-11-10', name: '취소된 선거', status: 'CANCELLED' },
    { date: '2026-11-11', name: '예정', status: 'TENTATIVE' },
  ]);
  const rows = parseHolidayFeed(text, 2026);
  assert.deepEqual(
    rows.filter((row) => row.date.startsWith('2026-11')),
    [
      { date: '2026-11-05', name: '임시공휴일' },
      { date: '2026-11-06', name: '선거일' },
      { date: '2026-11-07', name: '선거일' },
    ],
  );
  for (const bad of [
    text.slice(0, -20),
    text.replace('대한민국', '다른 국가'),
    text.replaceAll('공휴일\r\nSTATUS', '기념일\r\nSTATUS'),
    text.replace('20261105', '20261305'),
    holidayFeed([{ date: '2026-11-05', name: '반복', extra: 'RRULE:FREQ=YEARLY\r\n' }]),
    'x'.repeat(600000),
  ])
    assert.throws(() => parseHolidayFeed(bad, 2026));
});
test('sync persists validated data atomically, deduplicates calls and respects periodic checks, retry and opt-out', async (t) => {
  const { file } = fixture(t);
  let now = Date.parse('2026-11-03T09:00Z'),
    calls = 0,
    fail = false;
  const sync = new HolidaySync({
    file,
    now: () => now,
    fetcher: async (url, options) => {
      calls++;
      assert.equal(url, HOLIDAY_FEED);
      assert.equal(options.redirect, 'error');
      assert.equal(options.credentials, 'omit');
      if (fail) throw Error('offline');
      return new Response(holidayFeed([{ date: '2026-11-05', name: '임시공휴일' }]));
    },
  });
  await Promise.all([sync.refresh(), sync.refresh()]);
  assert.equal(calls, 1);
  assert.equal(sync.snapshot().error, null);
  assert.ok(sync.holidays.some((row) => row.date === '2026-11-05'));
  const good = readFileSync(file);
  await sync.refresh();
  assert.equal(calls, 1);
  now += HOLIDAY_REFRESH_MS;
  fail = true;
  await sync.refresh();
  assert.equal(calls, 2);
  assert.equal(sync.snapshot().error, 'unavailable');
  assert.deepEqual(readFileSync(file), good);
  await sync.refresh();
  assert.equal(calls, 2);
  now += HOLIDAY_RETRY_MS;
  await sync.refresh();
  assert.equal(calls, 3);
  const restored = new HolidaySync({
    file,
    now: () => now,
    fetcher: async () => {
      throw Error('offline');
    },
  });
  assert.deepEqual(restored.holidays, sync.holidays);
  assert.ok(restored.checkedAt);
  sync.setEnabled(false);
  now += HOLIDAY_REFRESH_MS;
  await sync.refresh();
  assert.equal(calls, 3);
  sync.setEnabled(true);
  fail = false;
  await sync.refresh(true);
  assert.equal(calls, 4);
  assert.equal(sync.error, null);
});
test('bad responses or failed cache writes preserve the last successful calendar; corrupt originals are backed up', async (t) => {
  const { file, root } = fixture(t);
  let text = holidayFeed();
  const sync = new HolidaySync({
    file,
    now: () => Date.parse('2026-11-03T09:00Z'),
    fetcher: async () => new Response(text),
  });
  await sync.refresh();
  const good = readFileSync(file),
    before = sync.holidays;
  text = 'not a calendar';
  await sync.refresh(true);
  assert.deepEqual(sync.holidays, before);
  assert.deepEqual(readFileSync(file), good);
  text = holidayFeed([{ date: '2026-11-05', name: '임시공휴일' }]);
  const blocked = new HolidaySync({ file: root, fetcher: async () => new Response(text) });
  await blocked.refresh(true);
  assert.ok(blocked.error);
  assert.deepEqual(blocked.holidays, []);
  writeFileSync(file, '{broken');
  const corrupt = new HolidaySync({
    file,
    now: () => Date.parse('2026-11-03T09:00Z'),
    fetcher: async () => new Response(text),
  });
  await corrupt.refresh(true);
  assert.equal(corrupt.error, null);
  assert.ok(readdirSync(root).some((name) => name.includes('.invalid-')));
});
test('new and removed downloaded holidays invalidate calculations in every project without editing project files, dirty flags or undo', (t) => {
  const { root } = fixture(t),
    w = new DesktopWorkspace(path.join(root, 'workspace.json'));
  const p = {
    name: 'Project A',
    description: '',
    holidays: [],
    members: [{ id: 'm', name: 'Member', role: '', grade: '', hours: 8, allocation: 100 }],
    tasks: [
      {
        id: 't',
        name: 'Task',
        phase: '',
        owner: 'm',
        start: '2026-11-04',
        end: '2026-11-04',
        predecessor: '',
        memo: '',
        items: [{ id: 'i', title: 'Work', hours: 16, doneDate: null }],
      },
    ],
  };
  const a = w.create(p).tabId;
  w.save(path.join(root, 'A.pmcanvas'));
  const b = w.create({ ...p, name: 'Project B' }).tabId;
  w.save(path.join(root, 'B.pmcanvas'));
  const before = w.snapshot(),
    disk = readFileSync(path.join(root, 'A.pmcanvas'));
  assert.equal(forecast(w.project, '2026-11-03').end, '2026-11-05');
  setKoreanHolidayUpdates([{ date: '2026-11-05', name: '임시공휴일' }]);
  for (const id of [a, b]) {
    w.activate(id);
    assert.equal(forecast(w.project, '2026-11-03').end, '2026-11-06');
    assert.equal(w.dirty, false);
    assert.equal(w.snapshot().canUndo, false);
  }
  assert.deepEqual(readFileSync(path.join(root, 'A.pmcanvas')), disk);
  assert.ok(koreanHolidays(2026).some((row) => row.date === '2026-11-05'));
  setKoreanHolidayUpdates([]);
  assert.equal(forecast(w.project, '2026-11-03').end, '2026-11-05');
  const opted = { ...w.project, koreanHolidays: false };
  setKoreanHolidayUpdates([{ date: '2026-11-05', name: '임시공휴일' }]);
  assert.deepEqual(projectHolidays(opted), []);
});
