import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardView } from '../public/dashboard-view.js';
import { WbsView } from '../public/wbs-view.js';
import { summary } from '../public/engine.js';
import { editCell } from '../public/wbs-model.js';
import { screenCases, screenProject } from './support/screen-fixtures.mjs';

test('대시보드는 공수 가중 진척·보고일·권한과 과거 실적을 유지', () => {
  const p = screenProject(),
    at = '2026-10-26';
  const html = dashboardView(p, summary(p, at), at);
  assert.match(html, /실제 진척률[\s\S]*?metric-number">29<small>%/);
  assert.match(html, /person-percent">25%/);
  assert.match(html, /person-percent">33%/);
  assert.match(html, /value="2026-10-26"/);
  assert.match(html, /data-action="sharing"/);
  assert.match(html, /data-edit-task="t1"/);
  const historical = dashboardView(p, summary(p, '2026-10-19'), '2026-10-19');
  assert.match(historical, /실제 진척률[\s\S]*?metric-number">0<small>%/);
  assert.match(historical, /value="2026-10-19"/);
  assert.equal(
    dashboardView({ ...p, _role: 'viewer' }, summary(p, at), at).includes('data-action="sharing"'),
    false,
  );
});

test('대시보드와 WBS는 빈 프로젝트·미지정 담당자·HTML 입력을 안전하게 표시', () => {
  const cases = screenCases();
  for (const { p, at } of cases) {
    const dashboard = dashboardView(p, summary(p, at), at);
    const wbs = new WbsView({}).render(p, at);
    for (const html of [dashboard, wbs]) {
      assert.equal(html.includes('<img'), false);
      assert.equal(html.includes('<script'), false);
      assert.equal(html.includes('NaN'), false);
      assert.equal(html.includes('undefined'), false);
    }
  }
  const { p, at } = cases.find((c) => c.name === 'empty');
  assert.match(dashboardView(p, summary(p, at), at), /업무를 등록하면 진척 추이가 표시됩니다/);
  const viewer = cases.find((c) => c.name === 'viewer-unassigned');
  const view = new WbsView({});
  const html = view.render(viewer.p, viewer.at);
  assert.equal(view.readOnly, true);
  assert.equal(html.includes('data-wbs-action="save"'), false);
  assert.match(html, /data-action="export-excel"/);
});

test('대시보드 프로젝트 전환은 이전 인력·색상·보고일에 의존하지 않음', () => {
  const p = screenProject(),
    at = '2026-10-26';
  const first = dashboardView(p, summary(p, at), at);
  const other = screenProject();
  other.members.reverse();
  other.members[0].name = '다른 프로젝트 인력';
  dashboardView(other, summary(other, '2026-10-19'), '2026-10-19');
  assert.equal(dashboardView(p, summary(p, at), at), first);
  assert.equal(first.includes('다른 프로젝트 인력'), false);
});

function workspace(request) {
  let active = screenProject(),
    busy = false;
  const events = [],
    calls = [];
  const view = new WbsView({
    getProject: () => active,
    request: async (...args) => {
      calls.push(args);
      return request(...args);
    },
    isSaving: () => busy,
    onMutation() {
      busy = true;
      events.push('begin');
    },
    onSettled() {
      busy = false;
      events.push('end');
    },
    acceptProject(p) {
      active = p;
      events.push('accept');
    },
    onSaved() {
      events.push('saved');
    },
    onAuth(message) {
      events.push(['auth', message]);
    },
    toast() {},
    onRender() {},
  });
  return { view, events, calls, active: () => active, busy: () => busy };
}

test('분리한 WBS는 서버 revision·완료 기록을 보존하고 저장 후에만 내 업무를 갱신', async () => {
  const f = workspace(async (url, options) => ({
    project: { ...(options?.body.project || screenProject()), _revision: options ? 2 : 3 },
  }));
  f.view.ensure(f.active(), '2026-10-26');
  f.view.changed(editCell(f.view.draft, 't1', 'name', '수정한 업무'), { paint: false });
  await f.view.action('save');
  assert.equal(f.calls[0][0], 'projects/screen-project');
  assert.equal(f.calls[0][1].method, 'PUT');
  assert.equal(f.calls[0][1].body.revision, 1);
  assert.equal(f.active().tasks[0].items[0].doneDate, '2026-10-20');
  assert.equal(f.view.base._revision, 2);
  assert.equal(f.view.dirty, false);
  assert.equal(f.busy(), false);
  assert.deepEqual(f.events, ['begin', 'accept', 'saved', 'end']);
  await f.view.options.onReload(f.active().id);
  // Reload is a GET and does not publish a successful edit notification.
  assert.equal(f.calls[1][1], undefined);
  assert.equal(f.active()._revision, 3);
  assert.equal(f.events.filter((e) => e === 'saved').length, 1);
});

test('분리한 WBS는 저장 충돌 때 초안·완료일을 유지하고 잠금을 해제', async () => {
  const f = workspace(async () => {
    throw Object.assign(Error('conflict'), { status: 409 });
  });
  f.view.ensure(f.active(), '2026-10-26');
  f.view.changed(editCell(f.view.draft, 't1', 'name', '충돌 중 보존할 업무'), { paint: false });
  await f.view.action('save');
  assert.equal(f.view.dirty, true);
  assert.equal(f.view.draft.tasks[0].name, '충돌 중 보존할 업무');
  assert.equal(f.view.draft.tasks[0].items[0].doneDate, '2026-10-20');
  assert.match(f.view.error, /다른 사용자/);
  assert.equal(f.busy(), false);
  assert.deepEqual(f.events, ['begin', 'end']);
});

test('WBS 세션 만료·재조회 실패에서도 저장 잠금을 해제하고 저장 중 중복 요청을 차단', async () => {
  let release;
  const f = workspace(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = f.view.options.onSave(f.active());
  assert.equal(f.busy(), true);
  await assert.rejects(f.view.options.onReload(f.active().id), /저장이 진행 중/);
  assert.equal(f.calls.length, 1);
  release({ project: f.active() });
  await pending;
  assert.equal(f.busy(), false);
  const expired = workspace(async () => {
    throw Object.assign(Error('로그인 필요'), { status: 401 });
  });
  await assert.rejects(expired.view.options.onSave(expired.active()));
  assert.deepEqual(expired.events, ['begin', ['auth', '로그인 필요'], 'end']);
  await assert.rejects(expired.view.options.onReload(expired.active().id));
  assert.equal(expired.busy(), false);
});

test('WBS Excel 가져오기는 현재 프로젝트와 원본 바이너리를 사용', async () => {
  const f = workspace(async () => ({ sheets: [] }));
  f.active().id = 'switched-project';
  const bytes = new Uint8Array([0, 255, 128, 65, 10]);
  await f.view.options.readExcel({ arrayBuffer: async () => bytes.buffer });
  assert.equal(f.calls[0][0], 'projects/switched-project/import-excel');
  assert.equal(f.calls[0][1].method, 'POST');
  assert.deepEqual(Buffer.from(f.calls[0][1].body.file, 'base64'), Buffer.from(bytes));
});
