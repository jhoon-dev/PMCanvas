import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEditor, editorForm, createProjectEditor } from '../public/project-editor.js';
import { historyBody, importedProject, createReportUi } from '../public/report-ui.js';
import { createSharingUi } from '../public/sharing-ui.js';
import { createSecurityUi } from '../public/security-ui.js';
import { screenProject, screenCases } from './support/screen-fixtures.mjs';

function documentFixture() {
  const nodes = new Map(),
    downloads = [];
  function node() {
    return {
      innerHTML: '',
      textContent: '',
      listeners: {},
      classList: { add() {} },
      addEventListener(type, fn) {
        (this.listeners[type] ||= []).push(fn);
      },
      showModal() {
        this.open = true;
      },
      close() {
        this.open = false;
      },
      focus() {},
      append() {},
      remove() {},
      click() {
        downloads.push({ href: this.href, filename: this.download });
      },
    };
  }
  return {
    nodes,
    downloads,
    document: {
      querySelector(key) {
        if (!nodes.has(key)) nodes.set(key, node());
        return nodes.get(key);
      },
      createElement: node,
      querySelectorAll: () => [],
      body: { append() {} },
    },
  };
}

test('프로젝트 편집은 휴무일을 검증하고 원본·revision·완료 기록을 보존', () => {
  const p = screenProject(),
    original = structuredClone(p);
  const data = new Map(
    Object.entries({
      name: ' 변경 프로젝트 ',
      description: ' 설명 ',
      holidays: '2026-10-21,2026-10-21\n2026-10-22',
    }),
  );
  const result = applyEditor(p, { type: 'settings' }, data);
  assert.equal(result.project.name, '변경 프로젝트');
  assert.deepEqual(result.project.holidays, ['2026-10-21', '2026-10-22']);
  assert.equal(result.project._revision, 1);
  assert.deepEqual(result.project.tasks, p.tasks);
  assert.deepEqual(p, original);
  data.set('holidays', '2026-02-30');
  assert.throws(() => applyEditor(p, { type: 'settings' }, data), /휴무일/);
  assert.deepEqual(p, original);
});

test('새 프로젝트와 상세 업무 편집은 기존 데이터와 분리하고 세부 작업·추가 속성을 유지', () => {
  const p = screenProject();
  const fresh = applyEditor(
    p,
    { type: 'project' },
    new Map(Object.entries({ name: '새 프로젝트', description: '', holidays: '' })),
    [],
    { uid: () => 'new-project', currentDate: '2026-10-26' },
  );
  assert.equal(fresh.created, true);
  assert.equal(fresh.project.id, 'new-project');
  assert.deepEqual(fresh.project.tasks, []);
  p.tasks[0].parentId = '';
  p.tasks[0].custom = '보존';
  const data = new Map(Object.entries({ ...p.tasks[0], name: '바꾼 업무', memo: '새 메모' }));
  const items = structuredClone(p.tasks[0].items);
  const edited = applyEditor(p, { type: 'task', id: 't1' }, data, items);
  assert.equal(edited.project.tasks[0].custom, '보존');
  assert.equal(edited.project.tasks[0].items[0].doneDate, '2026-10-20');
  assert.equal(p.tasks[0].name, '화면 설계');
  assert.throws(() => applyEditor(p, { type: 'task', id: 't1' }, data, []), /한 개 이상/);
});

test('프로젝트 편집 양식과 완료 보고서는 HTML 삽입을 이스케이프하고 표시 제한과 전체 공수를 유지', () => {
  for (const { p, at } of screenCases()) {
    for (const type of ['settings', 'member', 'task']) {
      const html = editorForm(type, p, type === 'task' ? p.tasks[0]?.id : p.members[0]?.id).body;
      assert.equal(html.includes('<img'), false);
      assert.equal(html.includes('<script'), false);
    }
    assert.equal(
      historyBody(p, { from: '2026-10-01', to: at, owner: '' }, at).includes('<img'),
      false,
    );
  }
  const p = screenProject();
  p.tasks[0].items = Array.from({ length: 205 }, (_, i) => ({
    id: 'item-' + i,
    title: '작업 ' + i,
    hours: 1,
    doneDate: '2026-10-20',
  }));
  p.tasks = [p.tasks[0]];
  const html = historyBody(p, { from: '2026-10-01', to: '2026-10-26', owner: '' }, '2026-10-26');
  assert.equal((html.match(/<tr><td/g) || []).length, 200);
  assert.match(html, /205개 완료 · 205h/);
  assert.match(html, /205건을 모두 출력/);
});

test('편집기는 미저장 WBS·조회자 수정과 담당 업무가 있는 인력 삭제를 차단', async () => {
  const f = documentFixture(),
    p = screenProject(),
    notices = [];
  let calls = 0;
  const wbs = { dirty: true };
  const ui = createProjectEditor({
    project: () => p,
    wbs,
    hasStorageError: () => false,
    canChange: () => true,
    api: async () => {
      calls++;
    },
    persist: async () => {
      calls++;
    },
    render() {},
    toast: (m) => notices.push(m),
    onCreate() {},
    onReplace() {},
    reload() {},
    document: f.document,
    confirm: () => true,
  });
  ui.open('task', 't1');
  assert.match(notices.at(-1), /WBS 변경사항/);
  wbs.dirty = false;
  p._role = 'viewer';
  ui.open('task', 't1');
  assert.match(notices.at(-1), /조회자/);
  p._role = 'owner';
  ui.open('member', 'm1');
  await f.nodes.get('#deleteButton').listeners.click[0]();
  assert.match(f.nodes.get('#formError').textContent, /담당 업무가 있는 인력/);
  assert.equal(calls, 0);
  assert.equal(p.members.length, 2);
});

test('JSON 가져오기는 새 프로젝트 ID와 이름을 만들고 서버 권한·revision을 제거', () => {
  const p = screenProject(),
    original = structuredClone(p);
  const result = importedProject(
    { format: 'pm-canvas-project', version: 1, project: structuredClone(p) },
    () => 'imported-id',
  );
  assert.equal(result.id, 'imported-id');
  assert.match(result.name, /\(불러옴\)$/);
  assert.equal(result._revision, undefined);
  assert.equal(result._role, undefined);
  assert.equal(result.tasks[0].items[0].doneDate, '2026-10-20');
  assert.deepEqual(p, original);
  assert.throws(() => importedProject({ format: 'other', version: 1, project: p }));
});

function reportsFixture(request) {
  const f = documentFixture(),
    blobs = [],
    revoked = [],
    notices = [],
    auth = [];
  let p = screenProject(),
    date = '2026-10-26',
    view = 'tasks';
  const draft = structuredClone(p);
  draft.tasks[0].name = '저장 전 초안';
  const wbs = {
    dirty: true,
    draft,
    commitCount: 0,
    snapshot: () => structuredClone(draft),
    visible: () => [draft.tasks[0]],
    commitAll() {
      this.commitCount++;
    },
  };
  const ui = createReportUi({
    api: request,
    project: () => p,
    wbs,
    getView: () => view,
    getDate: () => date,
    getOwner: () => '',
    filterDailyTasks: (current) => [current.tasks[1]],
    hasStorageError: () => false,
    persist: async () => true,
    render() {},
    toast: (m) => notices.push(m),
    showAuth: (m) => auth.push(m),
    openInfo() {},
    onImport() {},
    document: f.document,
    URL: {
      createObjectURL(blob) {
        blobs.push(blob);
        return 'blob:test/' + blobs.length;
      },
      revokeObjectURL: (url) => revoked.push(url),
    },
    schedule: (fn) => fn(),
  });
  return {
    ...f,
    ui,
    blobs,
    revoked,
    notices,
    auth,
    wbs,
    draft,
    setDate: (value) => {
      date = value;
    },
    setView: (value) => {
      view = value;
    },
    setProject: (value) => {
      p = value;
    },
  };
}

test('CSV·JSON 출력은 현재 WBS 초안과 필터를 사용하고 다운로드 URL을 정리', async () => {
  const f = reportsFixture(async () => {});
  f.ui.wbs();
  const csv = await f.blobs[0].text();
  assert.match(csv, /저장 전 초안/);
  assert.equal(csv.includes('화면 구현'), false);
  assert.equal(f.wbs.commitCount, 0);
  f.nodes.get('#backupButton').onclick();
  const backup = JSON.parse(await f.blobs[1].text());
  assert.equal(backup.format, 'pm-canvas-project');
  assert.equal(backup.project.tasks[0].name, '저장 전 초안');
  assert.equal(f.revoked.length, 2);
  assert.match(f.downloads[0].filename, /\.csv$/);
});

test('Excel 출력은 셀을 확정하고 필터·보고일을 캡처하며 중복 요청을 차단', async () => {
  let release;
  const calls = [],
    f = reportsFixture((...args) => {
      calls.push(args);
      return new Promise((resolve) => {
        release = resolve;
      });
    });
  const running = f.ui.excel();
  await f.ui.excel();
  assert.equal(calls.length, 1);
  assert.equal(f.wbs.commitCount, 1);
  assert.deepEqual(calls[0][1].body.taskIds, ['t1']);
  assert.equal(calls[0][1].body.asOf, '2026-10-26');
  assert.equal(calls[0][1].body.project.tasks[0].name, '저장 전 초안');
  f.setDate('2026-10-19');
  release(new Blob(['xlsx-test']));
  await running;
  assert.match(f.downloads[0].filename, /2026-10-26\.xlsx$/);
  assert.equal(f.revoked.length, 1);
});

test('Excel 401 실패는 재로그인을 안내하고 다음 출력 요청의 잠금을 해제', async () => {
  let failed = true;
  const f = reportsFixture(async () => {
    if (failed) throw Object.assign(Error('로그인 필요'), { status: 401 });
    return new Blob(['ok']);
  });
  await f.ui.excel();
  assert.equal(f.auth.length, 1);
  assert.equal(f.downloads.length, 0);
  failed = false;
  f.setView('daily');
  await f.ui.excel();
  assert.equal(f.downloads.length, 1);
});

test('공유·보안 화면의 소유자/관리자 경계는 요청 전에 적용되고 API 결과는 이스케이프', async () => {
  const f = documentFixture(),
    p = screenProject(),
    notices = [];
  let requests = 0,
    admin = false;
  const attack = '\"><img src=x onerror=alert(1)>';
  const api = async () => {
    requests++;
    return {
      access: [{ id: attack, name: attack, email: attack, role: 'editor' }],
      providers: [],
      identities: [],
    };
  };
  const sharing = createSharingUi({
    api,
    project: () => p,
    mappings: async () => '',
    openInfo() {},
    toast: (m) => notices.push(m),
    showAuth() {},
    document: f.document,
  });
  p._role = 'viewer';
  await sharing.open();
  assert.equal(requests, 0);
  assert.match(notices.at(-1), /소유자/);
  const security = createSecurityUi({
    api,
    user: () => ({ isAdmin: admin }),
    project: () => p,
    openInfo() {},
    toast() {},
    showAuth() {},
    securityNav() {},
    document: f.document,
  });
  await security.connections();
  assert.equal(requests, 0);
  p._role = 'owner';
  await sharing.open();
  assert.equal(f.nodes.get('#infoBody').innerHTML.includes('<img'), false);
  assert.match(f.nodes.get('#infoBody').innerHTML, /&lt;img/);
  admin = true;
  await security.connections();
  assert.equal(requests, 2);
});
