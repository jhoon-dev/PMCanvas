import test from 'node:test';
import assert from 'node:assert/strict';
import { monthDays, moveMonth } from '../app/holiday-picker.js';

test('holiday calendar aligns Monday-first weeks and respects leap-year century rules', () => {
  assert.equal(monthDays('1900-01').offset, 0);
  assert.equal(monthDays('2026-11').offset, 6);
  assert.equal(monthDays('1900-02').dates.length, 28);
  assert.equal(monthDays('2000-02').dates.at(-1), '2000-02-29');
  assert.equal(monthDays('2100-02').dates.length, 28);
  assert.equal(monthDays('2028-02').dates.at(-1), '2028-02-29');
  assert.throws(() => monthDays('2028-13'));
  assert.throws(() => monthDays('2201-01'));
  assert.equal(moveMonth('2026-12', 1), '2027-01');
  assert.equal(moveMonth('2027-01', -1), '2026-12');
});
