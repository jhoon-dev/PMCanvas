import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../reports.mjs';
import { addDays, today } from '../app/shared/engine.js';

const fixture = () => ({
  name: 'PC / 출시',
  holidays: [],
  members: [
    { id: 'm1', name: '김담당', grade: '고급', hours: 8, allocation: 100 },
    { id: 'm2', name: '이담당', grade: '중급', hours: 8, allocation: 100 },
  ],
  tasks: [
    {
      id: 't1',
      name: '개발, 검증',
      owner: 'm1',
      start: '2020-01-02',
      end: '2020-01-10',
      items: [
        { title: '핵심 기능', hours: 2, doneDate: '2020-01-03' },
        { title: '후속 작업', hours: 6, doneDate: '2020-01-06' },
      ],
    },
    {
      id: 't2',
      name: '=1+1',
      owner: 'm2',
      start: '2020-01-02',
      end: '2020-01-10',
      items: [{ title: '문구 "검토"\n두 번째 줄', hours: 8, doneDate: '2020-01-03' }],
    },
  ],
});

test('WBS CSV uses the selected historical date, all tasks, BOM and Excel-safe text', () => {
  const project = fixture(),
    before = structuredClone(project);
  const report = buildReport(project, { kind: 'wbs', at: '2020-01-03' });
  assert.equal(report.filename, 'PM-Canvas-PC _ 출시-업무현황-2020-01-03.csv');
  assert.ok(report.csv.startsWith('\uFEFF"프로젝트","보고 기준일"'));
  assert.ok(report.csv.includes('"개발, 검증"'));
  assert.ok(report.csv.includes('"25"'));
  assert.ok(report.csv.includes('"\'=1+1"'));
  assert.equal(report.csv.split('\r\n').length, 4);
  assert.deepEqual(project, before);
});

test('completion CSV includes both date boundaries and only the selected owner', () => {
  const report = buildReport(fixture(), {
    kind: 'completion',
    from: '2020-01-03',
    to: '2020-01-06',
    owner: 'm1',
  });
  assert.ok(report.csv.includes('"2020-01-03"'));
  assert.ok(report.csv.includes('"2020-01-06"'));
  assert.ok(report.csv.includes('"김담당"'));
  assert.ok(!report.csv.includes('이담당'));
  assert.equal(report.csv.split('\r\n').length, 4);
  const all = buildReport(fixture(), {
    kind: 'completion',
    from: '2020-01-03',
    to: '2020-01-03',
  }).csv;
  assert.ok(all.includes('"문구 ""검토""\n두 번째 줄"'));
  assert.ok(!all.includes('후속 작업'));
});

test('empty reports export column headers and reject invalid dates, future dates and owners', () => {
  const project = fixture();
  const csv = buildReport(project, {
    kind: 'completion',
    from: '2020-01-04',
    to: '2020-01-04',
  }).csv;
  assert.equal(csv.split('\r\n').length, 2);
  assert.throws(() => buildReport(null, { kind: 'wbs', at: today() }), /프로젝트/);
  for (const options of [
    null,
    { kind: 'other' },
    { kind: 'wbs', at: '2020-02-30' },
    { kind: 'wbs', at: addDays(today(), 1) },
    { kind: 'completion', from: '2020-01-06', to: '2020-01-03' },
    { kind: 'completion', from: today(), to: addDays(today(), 1) },
    { kind: 'completion', from: '2020-01-03', to: '2020-01-06', owner: 'missing' },
  ])
    assert.throws(() => buildReport(project, options));
});
