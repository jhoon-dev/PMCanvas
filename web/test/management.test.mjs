import { wbsRows } from '../public/reports.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanProject, projectChanges } from '../server/project.mjs';
import { forecast, progress, summary } from '../public/engine.js';
import { criticalPath, scheduleWarnings, captureBaseline } from '../public/planning.js';
import { newTask, removeTasks } from '../public/wbs-model.js';
import {
  managementChange,
  weeklyDraft,
  monthlyPlan,
  assertReportHistory,
  detachManagementLinks,
} from '../public/management.js';
import { managementView, applyManagementForm, weeklyHtml } from '../public/management-ui.js';
import { projectWorkbook } from '../server/excel.mjs';
import { readWorkbook } from '../server/excel-import.mjs';
import { suggestMapping, previewImport } from '../public/wbs-import.js';
import { PgRepository } from '../server/postgres.mjs';
import { getLanguage, setLanguage } from '../public/i18n.js';

const task = (id, extra = {}) => ({
  id,
  name: id,
  owner: 'm',
  phase: '',
  memo: '',
  start: '2026-10-19',
  end: '2026-10-23',
  predecessor: '',
  items: [{ id: id + '-item', title: id, hours: 40, doneDate: null }],
  ...extra,
});
const fixture = () =>
  cleanProject({
    name: 'PM',
    description: '',
    holidays: [],
    members: [{ id: 'm', name: 'Member', hours: 8, allocation: 100, role: '', grade: '' }],
    tasks: [
      task('A'),
      task('M', {
        kind: 'milestone',
        start: '2026-10-23',
        end: '2026-10-23',
        items: [],
        doneDate: null,
        predecessor: 'A',
      }),
      task('B', { start: '2026-10-26', end: '2026-10-30', predecessor: 'M' }),
    ],
  });
test('management screens separate reporting from planning without changing project data', () => {
  const project = fixture();
  const original = structuredClone(project);
  const previous = getLanguage();
  try {
    for (const language of ['ko', 'en']) {
      setLanguage(language);
      const reports = managementView(project, '2026-10-23', { section: 'reports' });
      const planning = managementView(project, '2026-10-23', { section: 'planning' });
      assert.ok(
        reports.includes(
          language === 'ko' ? '<h1>이슈 · 보고</h1>' : '<h1>Issues &amp; reports</h1>',
        ),
      );
      assert.ok(
        planning.includes(
          language === 'ko' ? '<h1>계획 · 투입</h1>' : '<h1>Plans &amp; staffing</h1>',
        ),
      );
      for (const name of ['issue', 'weekly']) {
        assert.ok(reports.includes('data-pm-form="' + name + '"'));
        assert.ok(!planning.includes('data-pm-form="' + name + '"'));
      }
      for (const name of ['milestone', 'staffing', 'mm-basis']) {
        assert.ok(planning.includes('data-pm-form="' + name + '"'));
        assert.ok(!reports.includes('data-pm-form="' + name + '"'));
      }
      const combined = managementView(project, '2026-10-23');
      assert.ok(
        combined.includes('data-pm-form="issue"') && combined.includes('data-pm-form="milestone"'),
      );
      for (const [section, forms] of Object.entries({
        milestones: ['milestone'],
        staffing: ['staffing', 'mm-basis'],
        issues: ['issue'],
        weekly: ['weekly'],
      })) {
        const screen = managementView(project, '2026-10-23', { section });
        for (const form of ['milestone', 'staffing', 'mm-basis', 'issue', 'weekly'])
          assert.equal(screen.includes('data-pm-form="' + form + '"'), forms.includes(form));
      }
      assert.deepEqual(project, original);
    }
  } finally {
    setLanguage(previous);
  }
});
const issue = (extra = {}) => ({
  id: 'risk',
  title: 'External API',
  type: 'risk',
  impact: 'high',
  probability: 'medium',
  owner: 'm',
  taskId: 'A',
  due: '2026-10-23',
  status: 'open',
  action: 'Confirm contract',
  ...extra,
});
const draft = (p, options = {}) =>
  weeklyDraft(p, {
    id: 'report',
    from: '2026-10-19',
    to: '2026-10-23',
    currentDate: '2026-10-23',
    publishedAt: '2026-10-23T10:00:00Z',
    notes: 'This week',
    nextNotes: 'Next week',
    ...options,
  });

test('마일스톤은 0공수·0기간이며 자원 경쟁 없이 선행과 후속 일정에 참여', () => {
  const p = fixture(),
    f = forecast(p, '2026-10-18');
  assert.equal(summary(p, '2026-10-18').total, 80);
  assert.equal(f.tasks.A.end, '2026-10-23');
  assert.equal(f.tasks.M.end, '2026-10-23');
  assert.equal(f.tasks.M.method, 'milestone');
  assert.equal(f.tasks.B.start, '2026-10-26');
  assert.equal(criticalPath(p).duration, 10);
  assert.ok(criticalPath(p).ids.has('M'));
  assert.deepEqual(scheduleWarnings(p).dependencies, []);
  assert.deepEqual(scheduleWarnings(p).overloads, []);
  assert.equal(progress(p.tasks[1], '2026-10-23'), 0);
  p.tasks[1].doneDate = '2026-10-23';
  p.koreanHolidays = true;
  assert.equal(progress(p.tasks[1], '2026-10-23'), 1);
  assert.equal(progress(p.tasks[1], '2026-10-22'), 0);
  const csvRows = wbsRows(p, '2026-10-23', forecast(p, '2026-10-23'));
  assert.equal(csvRows[2][19], 'milestone');
  assert.equal(csvRows[2][20], '2026-10-23');
  assert.equal(forecast(p, '2026-10-25').tasks.M.method, 'actual');
  assert.equal(summary(p, '2026-10-25').done, 0);
});

test('휴일 마일스톤과 실제 완료일을 보존하되 일반 업무의 0공수·잘못된 완료일은 거부', () => {
  const p = fixture();
  p.tasks[1].start = p.tasks[1].end = '2026-10-25';
  assert.equal(cleanProject(p).tasks[1].start, '2026-10-25');
  assert.equal(forecast(p, '2026-10-18').tasks.M.end, '2026-10-25');
  const bad = fixture();
  bad.tasks[0].items = [];
  assert.throws(() => cleanProject(bad));
  bad.tasks[0].items = fixture().tasks[0].items;
  bad.tasks[1].doneDate = '2999-01-01';
  assert.throws(() => cleanProject(bad));
  bad.tasks[1].doneDate = null;
  bad.tasks[0].parentId = 'M';
  assert.throws(() => cleanProject(bad), /마일스톤/);
  const fresh = newTask(p, { milestone: true, id: () => 'new', date: '2026-10-19' });
  assert.equal(fresh.start, fresh.end);
  assert.deepEqual(fresh.items, []);
});

test('이슈·리스크는 연결·확률·조치를 보존하고 삭제된 업무·인력의 현재 연결만 정리', () => {
  const p = fixture(),
    next = managementChange(p, 'issue', issue());
  assert.equal(p.issues, undefined);
  assert.deepEqual(cleanProject(next).issues, next.issues);
  assert.throws(() => managementChange(p, 'issue', issue({ probability: '' })));
  assert.throws(() => managementChange(p, 'issue', issue({ taskId: 'missing' })));
  assert.throws(() => managementChange(p, 'issue', issue({ title: 'x'.repeat(201) })));
  const detached = removeTasks(next, ['A']);
  assert.equal(detached.issues[0].taskId, '');
  detached.members = [];
  detached.tasks.forEach((t) => (t.owner = ''));
  detachManagementLinks(detached);
  assert.equal(cleanProject(detached).issues[0].owner, '');
});

test('주간보고는 발행 당시 업무·설명·이슈·기준 계획과 당주 추이를 고정', () => {
  const p = managementChange(fixture(), 'issue', issue());
  p.tasks[0].items[0].doneDate = '2026-10-23';
  p.baseline = captureBaseline(p, 'Approval');
  const report = draft(p),
    before = structuredClone(report);
  assert.equal(report.snapshot.metrics.progress, 0.5);
  assert.equal(report.snapshot.metrics.plannedProgress, 0.5);
  assert.equal(report.snapshot.completed.length, 1);
  assert.equal(report.snapshot.nextTasks[0].id, 'B');
  assert.equal(report.snapshot.baselineName, 'Approval');
  assert.equal(report.snapshot.curve.length, 6);
  p.tasks[0].items[0].hours = 80;
  p.tasks[0].items[0].doneDate = null;
  p.issues[0].title = 'Changed';
  p.baseline.name = 'New';
  assert.deepEqual(report, before);
  assert.notEqual(draft(p).snapshot.metrics.progress, report.snapshot.metrics.progress);
  assert.deepEqual(cleanProject({ ...p, weeklyReports: [report] }).weeklyReports[0], report);
  assert.throws(() => draft(p, { to: '2026-10-31' }), /기간/);
  assert.throws(() => draft(p, { to: '2026-10-24' }), /기간/);
});

test('발행 보고서의 변경·삭제는 거부하고 정정 발행은 새 ID로 추가', () => {
  const p = fixture();
  p.weeklyReports = [draft(p)];
  const before = structuredClone(p),
    changed = structuredClone(p);
  changed.weeklyReports[0].notes = 'Tampered';
  assert.throws(() => assertReportHistory(before, changed), { code: 'PUBLISHED_REPORT_IMMUTABLE' });
  changed.weeklyReports = [];
  assert.throws(() => assertReportHistory(before, changed));
  changed.weeklyReports = [draft(p), draft(p, { id: 'correction', notes: 'Correction' })];
  assert.doesNotThrow(() => assertReportHistory(before, changed));
  const reordered = JSON.parse(JSON.stringify(before));
  assert.doesNotThrow(() => assertReportHistory(before, reordered));
});

test('월별 계획 M/M은 투입 기간·휴무일·투입률과 명시한 환산 기준으로 계산', () => {
  const p = fixture();
  p.holidays = ['2026-10-21'];
  const next = managementChange(p, 'staffing', {
    hoursPerMM: 160,
    assignment: {
      id: 'staff',
      memberId: 'm',
      start: '2026-10-19',
      end: '2026-10-23',
      allocation: 50,
    },
  });
  let report = monthlyPlan(next, '2026-10');
  assert.equal(report.hours, 16);
  assert.equal(report.mm, 0.1);
  next.tasks[0].items[0].doneDate = '2026-10-23';
  assert.equal(monthlyPlan(next, '2026-10').hours, 16, 'Completion is not time spent.');
  assert.equal(monthlyPlan(next, '2026-11').hours, 0);
  const basis = managementChange(next, 'mm-basis', { hoursPerMM: 80 });
  assert.equal(monthlyPlan(basis, '2026-10').mm, 0.2);
  assert.throws(
    () =>
      managementChange(next, 'staffing', {
        hoursPerMM: 160,
        assignment: {
          id: 'over',
          memberId: 'm',
          start: '2026-10-20',
          end: '2026-10-22',
          allocation: 60,
        },
      }),
    /100%/,
  );
  assert.throws(() => monthlyPlan(next, '2026-13'));
});

test('월별 표는 인력별 집계 기준과 추정 합계를 표시하고 기간별 계획만 있으면 추정 안내를 숨김', () => {
  const p = fixture();
  p.members[0].name = '<b>한글 이름</b>';
  p.staffing = {
    hoursPerMM: 160,
    assignments: [
      { id: 's', memberId: 'm', start: '2026-10-19', end: '2026-10-30', allocation: 50 },
    ],
  };
  const registered = managementView(p, '2027-06-01');
  assert.match(registered, /<th>집계 기준<\/th>/);
  assert.match(registered, /<td>기간별 계획<\/td>/);
  assert.ok(!registered.includes('pm-plan-estimate-note'));
  p.members.push({ ...p.members[0], id: 'b' });
  const estimated = managementView({ ...p, _role: 'viewer' }, '2027-06-01');
  assert.match(estimated, /<td>기본 투입률로 추정<\/td>/);
  assert.match(estimated, /<td>추정값 포함<\/td>/);
  assert.match(estimated, /176h · 1.1 M\/M/);
  assert.match(estimated, /업무 기간 밖에서도/);
  assert.ok(estimated.includes('&lt;b&gt;한글 이름&lt;/b&gt;'));
  const language = getLanguage();
  try {
    setLanguage('en');
    const english = managementView(p, '2027-06-01');
    assert.match(english, /Calculation basis/);
    assert.match(english, /Estimated from default allocation/);
    assert.match(english, /Includes estimates/);
    assert.ok(english.includes('&lt;b&gt;한글 이름&lt;/b&gt;'));
  } finally {
    setLanguage(language);
  }
});

test('관리 화면은 입력을 검증하고 보고서·이슈의 HTML을 이스케이프', () => {
  const p = managementChange(fixture(), 'issue', issue({ title: '<img src=x onerror=alert(1)>' }));
  const html = managementView(p, '2026-10-23');
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<img'));
  assert.match(html, /마일스톤/);
  assert.match(html, /월별 계획/);
  assert.match(managementView({ ...p, _role: 'viewer' }, '2026-10-23'), /fieldset disabled/);
  const form = new FormData();
  for (const [k, v] of Object.entries({
    id: 'M',
    name: 'Open',
    start: '2026-10-25',
    owner: 'm',
    predecessor: 'A',
    doneDate: '2026-10-23',
  }))
    form.set(k, v);
  const next = applyManagementForm(p, 'milestone', form);
  assert.equal(next.tasks[1].end, '2026-10-25');
  assert.equal(next.tasks[1].doneDate, '2026-10-23');
  const report = draft(p, { notes: '<script>alert(1)</script>' }),
    body = weeklyHtml(report);
  assert.ok(body.includes('&lt;script&gt;'));
  assert.ok(!body.includes('<script>'));
});

test('마일스톤 유형과 실제 완료일은 Excel 갱신과 새 사본 가져오기에서 유지', async () => {
  const p = fixture();
  p.tasks[1].doneDate = '2026-10-23';
  p.koreanHolidays = true;
  const sheets = await readWorkbook((await projectWorkbook(p, '2026-10-23')).toString('base64')),
    sheet = sheets.find((s) => s.name === 'WBS'),
    mapping = suggestMapping(sheet.rows[0]);
  const result = previewImport(p, sheet.rows.slice(1), mapping, { mode: 'update' });
  assert.deepEqual(result.errors, []);
  assert.equal(result.project.tasks[1].kind, 'milestone');
  assert.equal(result.project.tasks[1].doneDate, '2026-10-23');
  const appended = previewImport({ ...p, tasks: [] }, sheet.rows.slice(1), mapping);
  assert.deepEqual(appended.errors, []);
  assert.equal(appended.project.tasks[1].kind, 'milestone');
  assert.deepEqual(appended.project.tasks[1].items, []);
});

test('PostgreSQL planning JSON은 관리 정보와 마일스톤 실제 완료일을 왕복', async () => {
  const repo = new PgRepository({}),
    p = managementChange(fixture(), 'issue', issue());
  p.tasks[1].doneDate = '2026-10-23';
  p.koreanHolidays = true;
  p.weeklyReports = [draft(p)];
  let planning, tasks, items, members;
  const connection = {
    query: async (sql, args) => {
      if (sql.startsWith('UPDATE pm_projects SET planning')) planning = JSON.parse(args[1]);
      if (sql.startsWith('INSERT INTO pm_tasks(')) tasks = JSON.parse(args[1]);
      if (sql.startsWith('INSERT INTO pm_task_items(')) items = JSON.parse(args[1]);
      if (sql.startsWith('INSERT INTO pm_members(')) members = JSON.parse(args[1]);
      return { rows: [] };
    },
  };
  await repo.writeDocument(connection, 'project', p);
  const restored = repo.hydratedDocument(
    {
      id: 'project',
      name: 'PM',
      description: '',
      holidays: [],
      demo: false,
      created_at: '2026-10-19T00:00:00Z',
      planning,
    },
    members,
    tasks.map(({ items, kind, doneDate, position, ...t }) => t),
    items.map(({ taskId, position, ...i }) => ({ ...i, task_id: taskId })),
  );
  assert.deepEqual(cleanProject(restored), p);
});

test('관리 변경 이력은 변경한 이슈·보고서·투입 기간만 기록하고 발행 사본을 반복 복제하지 않음', () => {
  const p = managementChange(fixture(), 'issue', issue());
  p.weeklyReports = [draft(p)];
  const next = structuredClone(p);
  next.issues[0].action = 'Updated';
  const changes = projectChanges(p, next);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].entity, 'issue');
  assert.ok(!JSON.stringify(changes).includes('This week'));
  const issued = structuredClone(p);
  issued.weeklyReports.push(draft(p, { id: 'next' }));
  assert.deepEqual(
    projectChanges(p, issued).map((c) => [c.entity, c.id]),
    [['weekly-report', 'next']],
  );
});
