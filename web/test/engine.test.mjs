import test from 'node:test';
import assert from 'node:assert/strict';
import {
  working,
  workdays,
  addDays,
  shiftWorkday,
  validDate,
  progress,
  planned,
  forecast,
  summary,
  validateProject,
} from '../public/engine.js';
const member = (id = 'a', extra = {}) => ({
  id,
  name: id,
  role: '개발',
  grade: '중급',
  hours: 8,
  allocation: 100,
  ...extra,
});
const item = (id, hours, doneDate = null) => ({ id, title: id, hours, doneDate });
const task = (id, extra = {}) => ({
  id,
  name: id,
  phase: '개발',
  owner: 'a',
  start: '2026-10-19',
  end: '2026-10-23',
  predecessor: '',
  items: [item(id + 'i', 40)],
  ...extra,
});
const project = (tasks = [], members = [member()], holidays = []) => ({
  id: 'p',
  name: 'Test',
  description: '',
  members,
  tasks,
  holidays,
});
test('근무일은 양끝 포함, 주말과 등록 휴무일 제외', () => {
  assert.equal(workdays('2026-10-19', '2026-10-25'), 5);
  assert.equal(workdays('2026-10-19', '2026-10-25', ['2026-10-21']), 4);
  assert.equal(shiftWorkday('2026-10-23', 1), '2026-10-26');
  assert.equal(working('2026-10-25'), false);
  assert.equal(workdays('2026-10-20', '2026-10-19'), 0);
});
test('실제로 존재하지 않는 날짜 거부', () => {
  assert.equal(validDate('2026-02-30'), false);
  assert.equal(validDate('2026-02-28'), true);
  assert.equal(validDate('2026-2-01'), false);
});
test('진척은 개수 평균 대신 예상 공수로 가중', () => {
  const t = task('a', { items: [item('small', 2, '2026-10-20'), item('large', 18)] });
  assert.equal(progress(t, '2026-10-20'), 0.1);
  assert.equal(progress(t, '2026-10-19'), 0);
});
test('계획 진척은 보고일 이전 0, 이후 100%, 당일 종료 기준', () => {
  const t = task('a');
  assert.equal(planned(t, '2026-10-18'), 0);
  assert.equal(planned(t, '2026-10-19'), 8);
  assert.equal(planned(t, '2026-10-30'), 40);
});
test('완료 기록 부족 시 계획 기준, 보고 다음 근무일부터 재배치', () => {
  const p = project([task('a', { items: [item('i1', 8, '2026-10-19'), item('i2', 32)] })]),
    f = forecast(p, '2026-10-20');
  assert.equal(f.tasks.a.method, 'plan');
  assert.equal(f.tasks.a.end, '2026-10-26');
  assert.equal(f.tasks.a.remaining, 32);
});
test('실적 속도는 최소 3근무일과 서로 다른 2일 완료가 필요', () => {
  const p = project([
    task('a', {
      items: [item('i1', 4, '2026-10-19'), item('i2', 4, '2026-10-20'), item('i3', 32)],
    }),
  ]);
  assert.equal(forecast(p, '2026-10-20').tasks.a.method, 'plan');
  const f = forecast(p, '2026-10-21');
  assert.equal(f.tasks.a.method, 'velocity');
  assert.ok(Math.abs(f.pace.a.rawRatio - 1 / 3) < 1e-8);
  assert.ok(f.pace.a.ratio > f.pace.a.rawRatio && f.pace.a.ratio < 1);
  assert.equal(f.tasks.a.blended, true);
  assert.ok(f.tasks.a.end > '2026-10-26');
});

test('소량 체크 두 건으로 수년 뒤 예상일을 만들지 않고 관측값은 보존', () => {
  const p = project([
    task('a', {
      end: '2026-10-30',
      items: [item('i1', 0.5, '2026-10-19'), item('i2', 0.5, '2026-10-20'), item('i3', 79)],
    }),
  ]);
  const f = forecast(p, '2026-10-30');
  assert.equal(f.pace.a.rawRatio, 0.0125);
  assert.equal(f.pace.a.completionDays, 2);
  assert.ok(f.pace.a.ratio > 0.95 && f.pace.a.ratio < 1);
  assert.equal(f.end, '2026-11-16');
  assert.equal(f.limitedEvidence, true);
  assert.equal(summary(p, '2026-10-30').progress, 1 / 80);
});

test('충분한 분산 기록은 실제 느린 속도와 빠른 속도를 상하한 없이 반영', () => {
  const dates = ['2026-10-19', '2026-10-21', '2026-10-23', '2026-10-27', '2026-10-30'];
  for (const hours of [4.8, 48]) {
    const total = Math.max(80, hours * 5 + 8);
    const p = project([
      task('a', {
        end: hours === 48 ? '2026-11-27' : '2026-10-30',
        items: [
          ...dates.map((date, i) => item('i' + i, hours, date)),
          item('left', total - hours * 5),
        ],
      }),
    ]);
    const f = forecast(p, '2026-10-30');
    assert.equal(f.pace.a.weight, 1);
    assert.equal(f.pace.a.ratio, f.pace.a.rawRatio);
    assert.equal(f.limitedEvidence, false);
    assert.equal(f.tasks.a.blended, false);
    if (hours === 48) assert.ok(f.pace.a.rawRatio > 2);
    else assert.ok(f.pace.a.rawRatio < 1);
  }
});

test('같은 완료량에서도 분산된 날짜와 긴 관측 기간일수록 실적 비중 증가', () => {
  const p = project([
    task('a', {
      end: '2026-10-30',
      items: [item('i1', 8, '2026-10-19'), item('i2', 8, '2026-10-20'), item('left', 64)],
    }),
  ]);
  const early = forecast(p, '2026-10-21').pace.a;
  const later = forecast(p, '2026-10-30').pace.a;
  assert.ok(later.weight > early.weight);
  p.tasks[0].items = [
    ...['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'].map((date, i) =>
      item('i' + i, 3.2, date),
    ),
    item('left', 64),
  ];
  assert.ok(forecast(p, '2026-10-30').pace.a.weight > later.weight);
});

test('미완료·하루 몰아 체크·관측창 밖 기록은 계획 추정 유지', () => {
  for (const dates of [
    [null, null],
    ['2026-10-20', '2026-10-20'],
    ['2026-10-01', '2026-10-02'],
  ]) {
    const p = project([
      task('a', {
        end: '2026-10-30',
        items: [item('i1', 8, dates[0]), item('i2', 8, dates[1]), item('left', 64)],
      }),
    ]);
    const f = forecast(p, '2026-10-30');
    assert.equal(f.pace.a.weight, 0);
    assert.equal(f.pace.a.ratio, 1);
    assert.equal(f.tasks.a.method, 'plan');
    assert.equal(f.limitedEvidence, true);
  }
});

test('한국 공휴일만 있는 일반 업무도 열고 저장하며 계획 공수와 다음 근무일 예측 유지', () => {
  const p = {
    ...project([task('a', { start: '2026-10-09', end: '2026-10-09' })]),
    koreanHolidays: true,
  };
  assert.doesNotThrow(() => validateProject(p));
  assert.equal(summary(p, '2026-10-08').planned, 0);
  assert.equal(summary(p, '2026-10-09').planned, 1);
  assert.equal(forecast(p, '2026-10-08').end, '2026-10-16');
  assert.doesNotThrow(() => validateProject({ ...p, koreanHolidays: false }));
  p.tasks[0] = { ...p.tasks[0], kind: 'milestone', items: [], doneDate: null };
  assert.doesNotThrow(() => validateProject(p));
});

test('수동·자동 중복 휴일과 대체공휴일에도 저장 가능하고 계획 공수 보존', () => {
  const p = {
    ...project(
      [task('a', { start: '2027-05-03', end: '2027-05-03' })],
      [member()],
      ['2027-05-03', '2027-05-03'],
    ),
    koreanHolidays: true,
  };
  assert.doesNotThrow(() => validateProject(p));
  assert.equal(summary(p, '2027-05-03').planned, 1);
  p.tasks[0].start = '2027-04-30';
  p.tasks[0].end = '2027-05-04';
  assert.doesNotThrow(() => validateProject(p));
  assert.equal(summary(p, '2027-05-03').planned, 0.5);
  assert.equal(forecast(p, '2027-04-29').end, '2027-05-10');
});
test('인력 등급만 바꿔도 예상일은 바뀌지 않음', () => {
  const p = project([task('x')]),
    a = forecast(p, '2026-10-18').end;
  p.members[0].grade = '특급';
  assert.equal(forecast(p, '2026-10-18').end, a);
});
test('투입률 감소는 가용시간을 제한하고 완료일을 늦춤', () => {
  const p = project([task('x')], [member('a', { allocation: 50 })]),
    f = forecast(p, '2026-10-18');
  assert.equal(f.end, '2026-10-30');
});
test('같은 담당자의 병행 업무에 일 가용시간을 중복 배정하지 않음', () => {
  const p = project([task('a'), task('b')]),
    f = forecast(p, '2026-10-18');
  assert.equal(f.tasks.a.end, '2026-10-23');
  assert.equal(f.tasks.b.start, '2026-10-26');
  assert.equal(f.end, '2026-10-30');
});
test('선행 관계는 작업 입력 순서에 무관하게 반영', () => {
  const a = task('a', { items: [item('ai', 8)], end: '2026-10-19' }),
    b = task('b', { owner: 'b', items: [item('bi', 8)], end: '2026-10-19', predecessor: 'a' }),
    f = forecast(project([b, a], [member(), member('b')]), '2026-10-18');
  assert.equal(f.tasks.b.start, '2026-10-20');
  assert.equal(f.tasks.b.end, '2026-10-20');
});
test('휴무일은 예상일 배정에서도 제외', () => {
  const p = project(
    [task('x', { items: [item('x', 16)], start: '2026-10-19', end: '2026-10-20' })],
    [member()],
    ['2026-10-20'],
  );
  assert.equal(forecast(p, '2026-10-18').end, '2026-10-21');
});
test('완료된 업무는 계산 날짜 대신 실제 마지막 완료일 사용', () => {
  const p = project([
      task('x', { items: [item('a', 8, '2026-10-19'), item('b', 32, '2026-10-21')] }),
    ]),
    f = forecast(p, '2026-10-23');
  assert.equal(f.tasks.x.method, 'actual');
  assert.equal(f.end, '2026-10-21');
  assert.equal(summary(p, '2026-10-23').completed, 1);
});
test('과거 조회는 미래의 완료 체크를 아직 미완료로 계산', () => {
  const p = project([task('x', { items: [item('i', 40, '2026-10-23')] })]);
  assert.equal(summary(p, '2026-10-22').done, 0);
  assert.equal(summary(p, '2026-10-23').done, 40);
});
test('담당자 미지정 업무와 그 후속 업무는 예상일을 꾸며내지 않음', () => {
  const p = project([task('a', { owner: '' }), task('b', { predecessor: 'a' })]),
    f = forecast(p, '2026-10-18');
  assert.equal(f.tasks.a.end, null);
  assert.equal(f.tasks.b.end, null);
  assert.equal(f.end, null);
});
test('선행 업무 순환과 없는 선행 업무 거부', () => {
  assert.throws(
    () =>
      validateProject(project([task('a', { predecessor: 'b' }), task('b', { predecessor: 'a' })])),
    /순환/,
  );
  assert.throws(
    () => validateProject(project([task('a', { predecessor: 'missing' })])),
    /존재하지/,
  );
});
test('주말만 있는 일정은 허용하고 중복 체크 ID와 0 작업량은 거부', () => {
  assert.doesNotThrow(() =>
    validateProject(project([task('a', { start: '2026-10-24', end: '2026-10-25' })])),
  );
  assert.throws(() =>
    validateProject(project([task('a', { items: [item('same', 1), item('same', 2)] })])),
  );
  assert.throws(() => validateProject(project([task('a', { items: [item('i', 0)] })])));
});
test('빈 프로젝트는 진척 0, 예상 완료일 없음', () => {
  const s = summary(project([]), '2026-10-23');
  assert.equal(s.progress, 0);
  assert.equal(s.forecast.end, null);
});
test('과거 미완료 업무도 기준일 이전에 배정하지 않음', () => {
  const f = forecast(project([task('a')]), '2026-10-25');
  assert.equal(f.tasks.a.start, '2026-10-26');
  assert.equal(f.tasks.a.end, '2026-10-30');
});
