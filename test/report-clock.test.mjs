import test from 'node:test';
import assert from 'node:assert/strict';
import { ReportClock } from '../public/report-clock.js';

test('자정·백그라운드 복귀 후 오늘 조회는 새 날짜를 따라가고 과거 조회는 보존', () => {
  let day = '2026-10-26';
  const clock = new ReportClock(() => day);
  day = '2026-10-27';
  assert.deepEqual(clock.refresh(), { dayChanged: true, reportChanged: true });
  assert.equal(clock.reportDate, day);
  assert.equal(clock.select('2026-10-24'), true);
  day = '2026-10-28';
  clock.refresh();
  assert.equal(clock.today, day);
  assert.equal(clock.reportDate, '2026-10-24');
  assert.equal(clock.select('2026-10-29'), false);
  assert.equal(clock.reportDate, '2026-10-24');
  assert.equal(clock.select(day), true);
  day = '2026-10-29';
  clock.refresh();
  assert.equal(clock.reportDate, day);
});
test('입력 중에는 기준일 이동을 미루고 저장·취소 뒤 자동 반영', () => {
  let day = '2026-10-26';
  const clock = new ReportClock(() => day);
  day = '2026-10-27';
  assert.deepEqual(clock.refresh({ advance: false }), { dayChanged: true, reportChanged: false });
  assert.equal(clock.today, day);
  assert.equal(clock.reportDate, '2026-10-26');
  assert.deepEqual(clock.refresh(), { dayChanged: false, reportChanged: true });
  assert.equal(clock.reportDate, day);
});
