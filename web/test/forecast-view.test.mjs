import test from 'node:test';
import assert from 'node:assert/strict';
import { summary } from '../public/engine.js';
import { dashboardView } from '../public/dashboard-view.js';
import { workspaceOverview } from '../../shared/browser/local-workspace-view.js';
import { peopleView } from '../../shared/browser/people-view.js';
import { wbsRows } from '../public/reports.js';
import { setLanguage } from '../public/i18n.js';

const project = () => ({
  id: 'p',
  name: 'Example',
  description: '',
  holidays: [],
  members: [{ id: 'a', name: 'Member', role: '', grade: '', hours: 8, allocation: 100 }],
  tasks: [
    {
      id: 't',
      name: 'Task',
      owner: 'a',
      start: '2026-10-19',
      end: '2026-10-30',
      items: [
        { id: 'i1', title: 'One', hours: 0.5, doneDate: '2026-10-19' },
        { id: 'i2', title: 'Two', hours: 0.5, doneDate: '2026-10-20' },
        { id: 'i3', title: 'Remaining', hours: 79, doneDate: null },
      ],
    },
  ],
});

test('웹·오프라인 현황·인력·내보내기에 혼합 추정과 원래 관측값 표시', () => {
  const p = project(),
    at = '2026-10-30',
    s = summary(p, at);
  for (const language of ['ko', 'en']) {
    setLanguage(language);
    try {
      const note =
        language === 'ko'
          ? '완료 기록 부족 · 계획 속도와 혼합한 추정'
          : 'Limited records · Estimate blends planned and observed speed';
      assert.ok(dashboardView(p, s, at).includes(note));
      assert.ok(workspaceOverview(p, s, { asOf: at }).includes(note));
      const people = peopleView(p, s, at);
      assert.ok(people.includes(language === 'ko' ? '관측 속도' : 'Observed speed'));
      assert.ok(people.includes('1.3%'));
      assert.ok(people.includes('95.9%'));
      assert.ok(people.includes(note));
      assert.equal(
        wbsRows(p, at, s.forecast)[1][16],
        language === 'ko' ? '계획·실적 혼합 추정' : 'Blended plan and observed estimate',
      );
    } finally {
      setLanguage('ko');
    }
  }
});

test('충분한 실적과 계획 추정 업무가 섞이면 프로젝트 전체에 기록 부족 표시', () => {
  const p = project(),
    at = '2026-10-30';
  p.tasks[0].items = [
    ...['2026-10-19', '2026-10-21', '2026-10-23', '2026-10-27', '2026-10-30'].map((date, i) => ({
      id: 'i' + i,
      title: 'Done',
      hours: 8,
      doneDate: date,
    })),
    { id: 'left', title: 'Left', hours: 40, doneDate: null },
  ];
  let s = summary(p, at);
  assert.equal(s.forecast.limitedEvidence, false);
  assert.match(dashboardView(p, s, at), /최근 완료 속도를 반영한 추정/);
  p.members.push({ ...p.members[0], id: 'b' });
  p.tasks.push({
    ...p.tasks[0],
    id: 'other',
    owner: 'b',
    items: [{ id: 'other-item', title: 'Other', hours: 80, doneDate: null }],
  });
  s = summary(p, at);
  assert.equal(s.forecast.observed, true);
  assert.equal(s.forecast.limitedEvidence, true);
  assert.match(workspaceOverview(p, s, { asOf: at }), /완료 기록 부족/);
});

test('웹 지연 일수도 자동 공휴일을 제외한 엔진·내보내기와 일치', () => {
  const p = project();
  p.koreanHolidays = true;
  Object.assign(p.tasks[0], {
    start: '2026-10-08',
    end: '2026-10-08',
    items: [{ id: 'i', title: 'Work', hours: 8, doneDate: null }],
  });
  const at = '2026-10-08',
    s = summary(p, at);
  assert.equal(s.forecast.end, '2026-10-12');
  assert.equal(s.forecast.tasks.t.late, 1);
  assert.equal(wbsRows(p, at, s.forecast)[1][15], 1);
  assert.match(dashboardView(p, s, at), /계획 대비 \+1근무일/);
});
