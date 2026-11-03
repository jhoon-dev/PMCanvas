import test from 'node:test';
import assert from 'node:assert/strict';
import { capacityCalendar, forecast, summary } from '../public/engine.js';
import { scheduleWarnings } from '../public/planning.js';
import { managementChange, monthlyPlan } from '../public/management.js';
import { cleanProject } from '../server/project.mjs';
import { wbsRows } from '../public/reports.js';

const fixture = () =>
  cleanProject({
    name: 'Staffing',
    description: '',
    holidays: [],
    members: [{ id: 'm', name: 'M', hours: 8, allocation: 100, grade: '', role: '' }],
    tasks: [
      {
        id: 'a',
        name: 'A',
        owner: 'm',
        phase: '',
        memo: '',
        start: '2026-11-02',
        end: '2026-11-06',
        predecessor: '',
        items: [{ id: 'i', title: 'Work', hours: 40, doneDate: null }],
      },
    ],
  });
const period = (id, start, end, allocation) => ({ id, memberId: 'm', start, end, allocation });
const plan = (p, assignments) => cleanProject({ ...p, staffing: { hoursPerMM: 160, assignments } });

test('없는 투입 계획·항목 삭제는 안전하며 마지막 기간 삭제 후 기본 투입률로 복귀', () => {
  const p = fixture();
  assert.deepEqual(managementChange(p, 'remove-assignment', { id: 'missing' }), p);
  const staffed = plan(p, [period('one', '2026-11-02', '2026-11-30', 25)]),
    removed = managementChange(staffed, 'remove-assignment', { id: 'one' });
  assert.deepEqual(removed.staffing.assignments, []);
  assert.equal(forecast(removed, '2026-11-01').end, '2026-11-06');
  assert.equal(monthlyPlan(removed, '2026-11').hours, 168);
  assert.deepEqual(managementChange(removed, 'remove-assignment', { id: 'one' }), removed);
  assert.equal(staffed.staffing.assignments.length, 1);
});

test('25% 기간 계획은 기본 투입률을 대체하며 예상일·과부하·M/M·출력에 동일하게 적용', () => {
  const p = fixture();
  p.members[0].allocation = 50;
  const next = plan(p, [period('one', '2026-11-02', '2026-11-30', 25)]),
    before = structuredClone(next),
    f = forecast(next, '2026-11-01');
  assert.equal(f.tasks.a.start, '2026-11-02');
  assert.equal(f.tasks.a.end, '2026-11-27');
  assert.deepEqual(
    scheduleWarnings(next).overloads.map(({ from, to, load, capacity }) => ({
      from,
      to,
      load,
      capacity,
    })),
    [{ from: '2026-11-02', to: '2026-11-06', load: 8, capacity: 2 }],
  );
  assert.equal(monthlyPlan(next, '2026-11').hours, 42);
  assert.equal(wbsRows(next, '2026-11-02', f)[1][7], 25);
  next.staffing.hoursPerMM = 80;
  assert.equal(monthlyPlan(next, '2026-11').mm, 42 / 80);
  assert.deepEqual(
    forecast(next, '2026-11-01'),
    f,
    'Conversion basis must not change availability.',
  );
  next.staffing.hoursPerMM = 160;
  assert.deepEqual(next, before, 'Calculations must not mutate the project.');
});

test('기간 사이의 공백은 0시간이며 휴일을 제외하고 후속 투입일부터 작업 재개', () => {
  const p = fixture();
  p.tasks[0].end = '2026-11-04';
  p.tasks[0].items[0].hours = 24;
  const next = plan(p, [
    period('one', '2026-11-02', '2026-11-02', 100),
    period('two', '2026-11-09', '2026-11-11', 100),
  ]);
  next.holidays = ['2026-11-09'];
  assert.equal(forecast(next, '2026-11-01').end, '2026-11-11');
  assert.equal(monthlyPlan(next, '2026-11').hours, 24);
  assert.deepEqual(
    scheduleWarnings(next).overloads.map(({ from, to, capacity }) => ({ from, to, capacity })),
    [{ from: '2026-11-03', to: '2026-11-04', capacity: 0 }],
  );
  const calendar = capacityCalendar(next);
  assert.equal(calendar.hours('m', '2026-11-01'), 0);
  assert.equal(calendar.hours('m', '2026-11-03'), 0);
  assert.equal(calendar.hours('m', '2026-11-12'), 0);
});

test('겹친 기간의 합산과 종료 다음 날 변경을 경고 구간·월 계획에 반영', () => {
  const p = plan(fixture(), [
    period('one', '2026-11-02', '2026-11-04', 25),
    period('two', '2026-11-04', '2026-11-06', 50),
  ]);
  p.members.push({ ...p.members[0], id: 'n', allocation: 50 });
  const calendar = capacityCalendar(p);
  assert.deepEqual(
    ['2026-11-02', '2026-11-04', '2026-11-05', '2026-11-09'].map((d) => calendar.hours('m', d)),
    [2, 6, 4, 0],
  );
  assert.deepEqual(
    scheduleWarnings(p).overloads.map(({ from, to, capacity }) => ({ from, to, capacity })),
    [
      { from: '2026-11-02', to: '2026-11-03', capacity: 2 },
      { from: '2026-11-04', to: '2026-11-04', capacity: 6 },
      { from: '2026-11-05', to: '2026-11-06', capacity: 4 },
    ],
  );
  assert.deepEqual(
    monthlyPlan(p, '2026-11').rows.map((r) => r.hours),
    [18, 84],
  );
  assert.equal(
    calendar.hours('n', '2026-11-09'),
    4,
    'Members without periods keep their own default.',
  );
});

test('동일 인력의 병행 업무는 기간별 하루 가용시간을 공유', () => {
  const p = plan(fixture(), [period('one', '2026-11-02', '2026-12-31', 50)]);
  p.tasks.push({
    ...structuredClone(p.tasks[0]),
    id: 'b',
    items: [{ id: 'ib', title: 'B', hours: 40, doneDate: null }],
  });
  const f = forecast(p, '2026-11-01');
  assert.equal(f.tasks.a.end, '2026-11-13');
  assert.equal(f.tasks.b.start, '2026-11-16');
  assert.equal(f.tasks.b.end, '2026-11-27');
});

test('소수 투입률을 합산·종료한 뒤 공백에 부동소수점 가용시간이 남지 않음', () => {
  const p = plan(fixture(), [
    period('a', '2026-11-02', '2026-11-03', 0.1),
    period('b', '2026-11-02', '2026-11-04', 0.2),
    period('c', '2026-11-09', '2026-11-09', 100),
  ]);
  const calendar = capacityCalendar(p);
  assert.equal(calendar.hours('m', '2026-11-05'), 0);
  assert.equal(calendar.hours('m', '2026-11-10'), 0);
});

test('가용시간이 부족하면 완료일을 꾸며내지 않고 후속 마일스톤에도 계산 대기를 전파', () => {
  const p = plan(fixture(), [period('one', '2026-11-02', '2026-11-06', 25)]);
  p.tasks.push({
    id: 'm',
    name: 'Milestone',
    kind: 'milestone',
    owner: '',
    phase: '',
    memo: '',
    start: '2026-11-06',
    end: '2026-11-06',
    predecessor: 'a',
    items: [],
    doneDate: null,
  });
  const f = forecast(p, '2026-11-01');
  assert.equal(f.tasks.a.end, null);
  assert.equal(f.tasks.a.late, 0);
  assert.match(f.tasks.a.reason, /가용시간 부족/);
  assert.equal(f.tasks.m.end, null);
  assert.equal(f.end, null);
  p.staffing.assignments[0].start = '2037-11-02';
  p.staffing.assignments[0].end = '2037-11-30';
  assert.equal(
    forecast(p, '2026-11-01').tasks.a.end,
    null,
    'Calendar jumps must respect the forecast horizon.',
  );
});

test('기간 계획이 없어도 기본 투입률로 M/M을 계산하며 실제 완료 기록은 재배치하지 않음', () => {
  const p = fixture();
  p.members[0].allocation = 50;
  assert.equal(monthlyPlan(p, '2026-11').hours, 84);
  p.staffing = { hoursPerMM: 80, assignments: [] };
  assert.equal(monthlyPlan(p, '2026-11').mm, 84 / 80);
  p.staffing.assignments = [period('old', '2026-10-01', '2026-10-30', 25)];
  p.tasks[0].items[0].doneDate = '2026-11-06';
  assert.equal(forecast(p, '2026-11-08').tasks.a.end, '2026-11-06');
  assert.equal(summary(p, '2026-11-08').done, 40);
  assert.equal(monthlyPlan(p, '2026-11').hours, 0);
});

test('업무 기간 밖 M/M은 등록한 기간 계획과 기본 투입률 추정을 구분하고 추정분 합계를 제공', () => {
  const p = plan(fixture(), [period('one', '2026-11-02', '2026-11-30', 50)]);
  p.members.push({ ...p.members[0], id: 'b', name: 'B' });
  const before = structuredClone(p),
    outside = monthlyPlan(p, '2027-06');
  assert.deepEqual(
    outside.rows.map(({ id, basis, hours, mm }) => ({ id, basis, hours, mm })),
    [
      { id: 'm', basis: 'period', hours: 0, mm: 0 },
      { id: 'b', basis: 'default', hours: 176, mm: 1.1 },
    ],
  );
  assert.equal(outside.estimatedHours, 176);
  assert.equal(outside.estimatedMM, 1.1);
  const mixed = monthlyPlan(p, '2026-11');
  assert.equal(mixed.hours, 252);
  assert.equal(mixed.estimatedHours, 168);
  assert.equal(mixed.estimatedMM, 1.05);
  p.staffing.hoursPerMM = 80;
  assert.equal(monthlyPlan(p, '2027-06').estimatedMM, 2.2);
  p.staffing.hoursPerMM = 160;
  assert.deepEqual(p, before);
  p.members.pop();
  assert.equal(monthlyPlan(p, '2027-06').estimatedHours, 0);
  const removed = managementChange(p, 'remove-assignment', { id: 'one' });
  assert.equal(monthlyPlan(removed, '2027-06').rows[0].basis, 'default');
  assert.equal(monthlyPlan(removed, '2027-06').estimatedHours, 176);
});
