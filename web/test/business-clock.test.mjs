import test from 'node:test';
import assert from 'node:assert/strict';
import {
  businessDate,
  getBusinessTimeZone,
  setBusinessTimeZone,
} from '../../shared/browser/business-clock.js';
import { ReportClock } from '../../shared/browser/report-clock.js';
import { today } from '../../shared/browser/engine.js';

test('business dates follow the configured IANA zone, including DST boundaries', () => {
  const previous = getBusinessTimeZone();
  try {
    const at = new Date('2026-10-28T16:00:00Z');
    assert.equal(businessDate(at, 'Asia/Seoul'), '2026-10-29');
    assert.equal(businessDate(at, 'America/New_York'), '2026-10-28');
    assert.equal(businessDate(new Date('2026-03-08T07:01:00Z'), 'America/New_York'), '2026-03-08');
    for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Seoul']) {
      setBusinessTimeZone(zone);
      assert.equal(today(), businessDate());
    }
    for (const bad of ['', '../etc', 'Bad/Zone', ' UTC', null, '<script>'])
      assert.throws(() => setBusinessTimeZone(bad));
  } finally {
    setBusinessTimeZone(previous);
  }
});
test('changing business time zone moves following reports and preserves historical selections', () => {
  const previous = getBusinessTimeZone();
  try {
    setBusinessTimeZone('America/New_York');
    const at = new Date('2026-10-28T16:00:00Z');
    const clock = new ReportClock(() => businessDate(at));
    setBusinessTimeZone('Asia/Seoul');
    clock.refresh();
    assert.equal(clock.reportDate, '2026-10-29');
    clock.select('2026-10-20');
    setBusinessTimeZone('America/New_York');
    clock.refresh();
    assert.equal(clock.today, '2026-10-28');
    assert.equal(clock.reportDate, '2026-10-20');
  } finally {
    setBusinessTimeZone(previous);
  }
});
