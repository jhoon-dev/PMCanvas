import { newTask } from '../public/wbs-model.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanProject } from '../server/project.mjs';
import { PgRepository } from '../server/postgres.mjs';
import { summary, forecast, validateProject } from '../public/engine.js';
import {
  criticalPath,
  scheduleWarnings,
  rollups,
  captureBaseline,
  baselineDiff,
  setParent,
} from '../public/planning.js';
import {
  predecessorIds,
  taskLeaves,
  taskView,
  taskIndex,
  executionTasks,
} from '../public/task-model.js';
import { alignSuccessors, editCell, duplicateTasks, removeTasks } from '../public/wbs-model.js';
import { editorForm, applyEditor } from '../public/project-editor.js';
import { projectWorkbook } from '../server/excel.mjs';
import { readWorkbook } from '../server/excel-import.mjs';
import { previewImport, suggestMapping } from '../public/wbs-import.js';
import { wbsRows } from '../public/reports.js';
import { dashboardView } from '../public/dashboard-view.js';
import { WbsWorkspace } from '../public/wbs-workspace.js';
import { importedProject } from '../public/report-ui.js';
import { deletedTaskBundle, restoreTaskBundle } from '../server/workspace-model.mjs';

const task = (id, start = '2026-10-19', end = '2026-10-23', hours = 40, extra = {}) => ({
  id,
  name: id,
  owner: 'm',
  phase: '',
  memo: '',
  start,
  end,
  predecessor: '',
  items: [{ id: id + '-item', title: id, hours, doneDate: null }],
  ...extra,
});
const project = (tasks) => ({
  name: 'Schedule',
  description: '',
  holidays: [],
  members: [{ id: 'm', name: 'M', hours: 8, allocation: 100, grade: '', role: '' }],
  tasks,
});
const grouped = () =>
  project([
    task('P', '2026-10-19', '2026-10-30', 0, { kind: 'summary', owner: '', items: [] }),
    task('A', undefined, undefined, 40, { parentId: 'P' }),
    task('B', '2026-10-26', '2026-10-30', 40, { parentId: 'P', predecessor: 'A' }),
  ]);

test('계층 인덱스는 임의 행 순서·중첩·빈 요약을 집계하고 다음 계산에서 변경을 반영', () => {
  const p = grouped();
  p.tasks.push(
    task('S', '2026-10-19', '2026-10-30', 0, {
      parentId: 'P',
      kind: 'summary',
      owner: '',
      items: [],
    }),
  );
  p.tasks.find((t) => t.id === 'B').parentId = 'S';
  p.tasks.push(task('empty', undefined, undefined, 0, { kind: 'summary', owner: '', items: [] }));
  p.tasks.reverse();
  const before = structuredClone(p),
    index = taskIndex(p),
    parent = p.tasks.find((t) => t.id === 'P');
  assert.equal(
    taskView(p, parent, index).items.reduce((n, i) => n + i.hours, 0),
    80,
  );
  assert.equal(taskView(p, parent, index).end, '2026-10-30');
  assert.equal(rollups(p, '2026-10-18').get('P').hours, 80);
  assert.equal(forecast(p, '2026-10-18').tasks.P.end, '2026-10-30');
  assert.deepEqual(
    executionTasks(p, index)
      .map((t) => t.id)
      .sort(),
    ['A', 'B'],
  );
  assert.deepEqual(p, before);
  p.tasks.find((t) => t.id === 'B').items[0].hours = 8;
  p.tasks.find((t) => t.id === 'B').end = '2026-10-26';
  assert.equal(taskView(p, parent).end, '2026-10-26');
  assert.equal(rollups(p, '2026-10-18').get('P').hours, 48);
  assert.equal(forecast(p, '2026-10-18').tasks.P.end, '2026-10-26');
  parent.parentId = 'S';
  assert.throws(() => taskView(p, parent), /순환/);
});

test('요약 행은 자원·임계 업무·완료 및 지연 건수에서 제외하고 하위 일정과 진척만 집계', () => {
  const p = cleanProject(grouped()),
    at = '2026-10-18',
    f = forecast(p, at);
  assert.equal(summary(p, at).total, 80);
  assert.equal(f.tasks.A.end, '2026-10-23');
  assert.equal(f.tasks.B.end, '2026-10-30');
  assert.equal(f.tasks.P.end, '2026-10-30');
  assert.equal(f.tasks.P.remaining, 80);
  assert.equal(f.tasks.P.method, 'summary');
  assert.equal(f.end, '2026-10-30');
  assert.deepEqual([...criticalPath(p).ids], ['A', 'B']);
  assert.deepEqual(scheduleWarnings(p).overloads, []);
  assert.equal(summary(p, '2026-11-02').overdue, 2);
  p.tasks.find((t) => t.id === 'A').items[0].doneDate = '2026-10-23';
  assert.equal(rollups(p, '2026-10-23').get('P').progress, 0.5);
  assert.equal(summary(p, '2026-10-23').completed, 1);
  assert.equal(wbsRows(p, '2026-10-23', forecast(p, '2026-10-23'))[1][12], 50);
});

test('기존 상위 작업은 ID·담당자·완료일·공수·선행 연결과 기준 계획을 보존하고 변환은 멱등', () => {
  const p = grouped();
  p.tasks[0] = task('P', '2026-10-19', '2026-10-30', 8);
  p.tasks[0].items[0].doneDate = '2026-10-19';
  p.tasks.push(task('C', undefined, undefined, 8, { predecessor: 'P' }));
  p.baseline = {
    name: 'Legacy',
    createdAt: '2026-10-18T00:00:00Z',
    tasks: p.tasks.map((t) => ({
      id: t.id,
      name: t.name,
      start: t.start,
      end: t.end,
      hours: t.items.reduce((n, i) => n + i.hours, 0),
      parentId: t.parentId || '',
    })),
  };
  const before = structuredClone(p),
    next = cleanProject(p),
    own = next.tasks.find((t) => t.id === 'P-work');
  assert.deepEqual(p, before);
  assert.deepEqual(own.items, p.tasks[0].items);
  assert.equal(own.owner, 'm');
  assert.equal(next.tasks[0].items.length, 0);
  assert.equal(next.tasks.find((t) => t.id === 'C').predecessor, 'P-work');
  assert.equal(summary(next, '2026-10-19').total, 96);
  assert.equal(summary(next, '2026-10-19').done, 8);
  assert.equal(next.baseline.tasks.find((t) => t.id === 'P-work').hours, 8);
  assert.equal(baselineDiff(next).rows.find((t) => t.id === 'P').hours, 0);
  assert.deepEqual(cleanProject(next), next);
});

test('500개 기존 업무도 작업을 버리거나 저장 한도를 넘지 않고 요약 모델로 전환', () => {
  const p = project(
    Array.from({ length: 500 }, (_, i) =>
      task('t' + i, undefined, undefined, 1, i ? { parentId: 't0' } : {}),
    ),
  );
  const next = cleanProject(p);
  assert.equal(next.tasks.length, 501);
  assert.equal(taskLeaves(next).length, 500);
  assert.equal(summary(next, '2026-10-18').total, 500);
  assert.deepEqual(cleanProject(next), next);
});

test('들여쓰기와 마지막 하위 삭제는 작업 기록을 유지하고 빈 요약을 실행 업무로 세지 않음', () => {
  const fresh = newTask(project([]), { summary: true, date: '2026-10-19', id: () => 'fresh' });
  assert.equal(fresh.kind, 'summary');
  assert.deepEqual(fresh.items, []);
  assert.equal(cleanProject(project([fresh])).tasks.length, 1);
  const p = project([task('P'), task('A')]),
    next = setParent(p, ['A'], 1);
  assert.equal(next.tasks[0].kind, 'summary');
  assert.equal(next.tasks.find((t) => t.id === 'P-work').items[0].id, 'P-item');
  const empty = removeTasks(next, ['A', 'P-work']);
  assert.equal(empty.tasks.length, 1);
  assert.equal(summary(empty, '2026-10-18').total, 0);
  assert.equal(summary(empty, '2026-10-18').forecast.end, null);
  assert.equal(criticalPath(empty).duration, 0);
  const workspace = new WbsWorkspace({});
  workspace.ensure({ ...empty, id: 'empty', _revision: 1 }, '2026-10-18');
  for (const html of [
    workspace.chart(),
    dashboardView(empty, summary(empty, '2026-10-18'), '2026-10-18'),
  ])
    assert.ok(!/NaN|undefined/.test(html));
  assert.throws(() => editCell(next, 'P', 'hours', '99'), /하위 업무/);
  assert.throws(() =>
    validateProject(project([task('X', undefined, undefined, 0, { items: [] })])),
  );
});

test('복수 FS는 모든 선행의 종료를 기다리고 미지정 선행·순환도 모든 연결에서 검증', () => {
  const p = project([
    task('A', undefined, undefined, 40),
    task('B', '2026-10-19', '2026-10-20', 16, { owner: 'n' }),
    task('C', '2026-10-19', '2026-10-19', 8, { owner: 'q', predecessors: ['B', 'A'] }),
  ]);
  p.members.push({ ...p.members[0], id: 'n' }, { ...p.members[0], id: 'q' });
  const next = cleanProject(p);
  assert.equal(forecast(next, '2026-10-18').tasks.C.start, '2026-10-26');
  assert.equal(criticalPath(next).duration, 6);
  assert.deepEqual(
    scheduleWarnings(next).dependencies.map((t) => t.id),
    ['C'],
  );
  const aligned = alignSuccessors(structuredClone(next));
  assert.equal(aligned.tasks[2].start, '2026-10-26');
  next.tasks[0].owner = '';
  assert.equal(forecast(next, '2026-10-18').tasks.C.end, null);
  p.tasks[0].predecessor = 'C';
  assert.throws(() => cleanProject(p), /순환/);
  p.tasks[0].predecessor = '';
  p.tasks[2].predecessors = ['A', 'missing'];
  assert.throws(() => cleanProject(p), /존재하지/);
  p.tasks[2].predecessors = ['A', 'A'];
  assert.throws(() => cleanProject(p), /중복/);
});

test('요약 선행은 전체 하위 완료를 뜻하며 계층을 거치는 숨은 순환도 거부', () => {
  const p = grouped();
  p.tasks.push(task('C', '2026-10-19', '2026-10-19', 8, { predecessor: 'P' }));
  assert.equal(forecast(cleanProject(p), '2026-10-18').tasks.C.start, '2026-11-02');
  p.tasks[0].predecessor = 'C';
  assert.throws(() => cleanProject(p), /순환/);
});

test('복수 연결은 셀 입력·복제·삭제·휴지통 복원에서 모두 유지', () => {
  const p = project([task('A'), task('B'), task('C')]),
    next = editCell(p, 'C', 'predecessor', '1, 2');
  assert.deepEqual(predecessorIds(next.tasks[2]), ['A', 'B']);
  let n = 0;
  const copies = duplicateTasks(next, ['A', 'B', 'C'], { id: () => 'copy' + n++ });
  assert.deepEqual(predecessorIds(copies.tasks.find((t) => t.name === 'C (복사)')), [
    'copy0',
    'copy1',
  ]);
  const removed = removeTasks(next, ['B']);
  assert.deepEqual(predecessorIds(removed.tasks.find((t) => t.id === 'C')), ['A']);
  const restored = restoreTaskBundle(removed, deletedTaskBundle(next, removed)).project;
  assert.deepEqual(predecessorIds(restored.tasks.find((t) => t.id === 'C')), ['A', 'B']);
  assert.equal(next.tasks[2].predecessor, 'A');
});

test('요약 편집은 작업 입력을 숨기고 복수 선택을 보존하며 예측은 기준일 종료 의미를 유지', () => {
  const p = cleanProject(grouped()),
    html = editorForm('task', p, 'P').body;
  assert.ok(!html.includes('id="addItem"'));
  assert.match(html, /하위 업무에서 계산/);
  const form = new FormData();
  for (const [key, value] of Object.entries({ name: 'Updated', phase: '', memo: '' }))
    form.set(key, value);
  const updated = applyEditor(p, { type: 'task', id: 'P' }, form).project;
  assert.equal(updated.tasks[0].items.length, 0);
  const leaf = task('X', '2026-10-19', '2026-10-19', 8);
  assert.equal(forecast(project([leaf]), '2026-10-19').tasks.X.start, '2026-10-20');
  assert.equal(forecast(project([leaf]), '2026-10-18').tasks.X.start, '2026-10-19');
});

test('Excel 갱신·새 사본 가져오기는 요약·완료 기록·모든 선행 연결을 보존', async () => {
  const p = cleanProject(grouped());
  p.tasks.push(
    task('C', '2026-11-02', '2026-11-02', 8, { predecessors: ['A', 'B'], predecessor: 'A' }),
  );
  p.tasks[1].items[0].doneDate = '2026-10-23';
  const sheets = await readWorkbook((await projectWorkbook(p, '2026-10-23')).toString('base64')),
    sheet = sheets.find((s) => s.name === 'WBS'),
    mapping = suggestMapping(sheet.rows[0]);
  const updated = previewImport(p, sheet.rows.slice(1), mapping, { mode: 'update' });
  assert.deepEqual(updated.errors, []);
  assert.deepEqual(cleanProject(updated.project), p);
  const appended = previewImport({ ...p, tasks: [] }, sheet.rows.slice(1), mapping);
  assert.deepEqual(appended.errors, []);
  assert.equal(appended.project.tasks[0].kind, 'summary');
  assert.equal(appended.project.tasks[0].items.length, 0);
  assert.equal(taskLeaves(appended.project).length, 3);
  assert.equal(predecessorIds(appended.project.tasks.find((t) => t.name === 'C')).length, 2);
  assert.equal(taskView(appended.project, appended.project.tasks[0]).items.length, 2);
  const imported = importedProject(
    { format: 'pm-canvas-project', version: 2, project: p },
    () => 'copy',
  );
  assert.deepEqual(predecessorIds(imported.tasks.find((t) => t.id === 'C')), ['A', 'B']);
});

test('PostgreSQL 쓰기·재조회는 요약 유형과 복수 선행을 planning JSON에 왕복 저장', async () => {
  const repo = new PgRepository({}),
    p = cleanProject(grouped());
  // Use two independent predecessors and an empty summary to exercise metadata persistence.
  p.tasks.push(task('D', undefined, undefined, 8));
  p.tasks[2].predecessors = ['A', 'D'];
  p.tasks.push(task('Empty', undefined, undefined, 0, { kind: 'summary', items: [], owner: '' }));
  let planning, savedTasks, savedMembers, savedItems;
  const c = {
    query: async (sql, args) => {
      if (sql.startsWith('UPDATE pm_projects SET planning')) planning = JSON.parse(args[1]);
      if (sql.startsWith('INSERT INTO pm_tasks(')) savedTasks = JSON.parse(args[1]);
      if (sql.startsWith('INSERT INTO pm_members(')) savedMembers = JSON.parse(args[1]);
      if (sql.startsWith('INSERT INTO pm_task_items(')) savedItems = JSON.parse(args[1]);
      return { rows: [] };
    },
  };
  await repo.writeDocument(c, 'project', p);
  const row = {
    id: 'project',
    name: p.name,
    description: '',
    holidays: [],
    demo: false,
    created_at: '2026-10-18T00:00:00Z',
    revision: 7,
    role: 'owner',
    planning,
  };
  const restored = repo.hydratedDocument(
    row,
    savedMembers,
    savedTasks.map(({ position, items, kind, predecessors, ...t }) => t),
    savedItems.map(({ taskId, position, ...i }) => ({ ...i, task_id: taskId })),
  );
  assert.equal(restored._revision, 7);
  assert.deepEqual(cleanProject(restored), p);
  assert.equal(restored.tasks.find((t) => t.id === 'Empty').kind, 'summary');
});

test('긴 복수 선행 목록도 영어 Excel에서 2,000자 경계에 잘리지 않고 왕복', async () => {
  const predecessors = Array.from(
    { length: 60 },
    (_, n) => 'dependency-' + n + '-' + 'x'.repeat(28),
  );
  const p = cleanProject(
    project([
      ...predecessors.map((id) => task(id, undefined, undefined, 1)),
      task('join', undefined, undefined, 1, { predecessors }),
    ]),
  );
  assert.ok(predecessors.join(', ').length > 2000);
  const bytes = await projectWorkbook(
      p,
      '2026-10-18',
      p.tasks.map((t) => t.id),
      { language: 'en' },
    ),
    sheets = await readWorkbook(bytes.toString('base64')),
    sheet = sheets.find((s) => s.name === 'WBS'),
    result = previewImport(p, sheet.rows.slice(1), suggestMapping(sheet.rows[0]), {
      mode: 'update',
    });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(predecessorIds(result.project.tasks.find((t) => t.id === 'join')), predecessors);
});
