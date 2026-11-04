import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProject as desktopProject, DesktopDocument } from '../document.mjs';
import { normalizeProject as mobileProject } from '../../mobile/src/model.mjs';
import { cleanProject } from '../../shared/model/project.mjs';
import { summary } from '../../shared/browser/engine.js';
import {
  dashboardView,
  dashboardVisuals,
  progressChart,
} from '../../shared/browser/dashboard-view.js';
const sample = () => ({
  id: 'parity',
  name: '공통 프로젝트',
  description: '',
  holidays: [],
  members: [
    { id: 'member', name: '담당자', role: '개발', grade: '중급', hours: 8, allocation: 100 },
  ],
  tasks: [
    {
      id: 'task',
      name: '공통 업무',
      owner: 'member',
      phase: '개발',
      start: '2026-10-09',
      end: '2026-10-12',
      predecessor: '',
      memo: '',
      items: [{ id: 'item', title: '완료 확인', hours: 16, doneDate: null }],
    },
  ],
});
test('the same project and calendar produce the same summary and graphs on web, desktop and mobile', () => {
  for (const automatic of [undefined, false, true]) {
    const input = {
      ...sample(),
      ...(automatic === undefined ? {} : { koreanHolidays: automatic }),
    };
    const variants = [cleanProject(input), desktopProject(input), mobileProject(input)];
    const summaries = variants.map((project) => summary(project, '2026-10-09'));
    assert.deepEqual(summaries[1], summaries[0]);
    assert.deepEqual(summaries[2], summaries[0]);
    const charts = variants.map((project, index) =>
      progressChart(project, summaries[index], '2026-10-09'),
    );
    assert.equal(charts[0], charts[1]);
    assert.equal(charts[1], charts[2]);
    const visuals = dashboardVisuals(variants[0], summaries[0], '2026-10-09');
    assert.ok(dashboardView(variants[0], summaries[0], '2026-10-09').includes(charts[0]));
    for (const chart of ['progress', 'timeline', 'people'])
      assert.ok(visuals.includes('data-project-chart="' + chart + '"'));
  }
});
