import test from 'node:test';
import assert from 'node:assert/strict';
import { readAuthLink, loginRequest, createAuthUi } from '../public/auth-ui.js';
import { dailyView, filteredTasks, recordCompletion } from '../public/daily-view.js';
import { peopleView, memberEditor, updateMember } from '../public/people-view.js';
import { summary } from '../public/engine.js';
import { screenCases, screenProject } from './support/screen-fixtures.mjs';

test('인증 링크는 인증·재설정 토큰을 구분하고 변형된 토큰을 거부', () => {
  const token = 'a'.repeat(43);
  assert.deepEqual(readAuthLink('#verify-email=' + token), { kind: 'verify', token });
  assert.deepEqual(readAuthLink('#reset-password=' + token), { kind: 'reset', token });
  for (const prefix of ['verify-email', 'reset-password']) {
    for (const value of ['', token.slice(1), token + 'a', token + '&x=1', '<script>']) {
      assert.equal(readAuthLink('#' + prefix + '=' + value).token, '');
    }
  }
  assert.equal(readAuthLink('#overview'), null);
  assert.equal(readAuthLink('#registration-approvals'), null);
});

test('로그인 요청은 로컬·AD 입력을 보존하고 미저장 데이터가 있으면 계정 전환을 차단', () => {
  const body = { email: 'member@example.com', password: 'test-password-only' };
  assert.deepEqual(loginRequest(body), { path: 'auth/login', body });
  assert.deepEqual(loginRequest({ ...body, email: 'DOMAIN\\member', provider: 'company-ad' }), {
    path: 'auth/directory',
    body: { provider: 'company-ad', username: 'DOMAIN\\member', password: body.password },
  });
  const pending = { ...body, user: { email: body.email }, unsaved: true };
  assert.doesNotThrow(() => loginRequest({ ...pending, email: ' MEMBER@EXAMPLE.COM ' }));
  assert.throws(() => loginRequest({ ...pending, email: 'other@example.com' }), /기존 계정/);
  assert.throws(() => loginRequest({ ...pending, provider: 'company-ad' }), /저장하거나 백업/);
  assert.doesNotThrow(() =>
    loginRequest({ ...pending, email: 'other@example.com', unsaved: false }),
  );
});

test('인증 화면은 URL에서 토큰을 지우고 미저장·저장 중에는 링크 화면 전환을 차단', () => {
  const replacements = [],
    notices = [];
  const location = {
    hash: '#verify-email=' + 'a'.repeat(43),
    pathname: '/pmcanvas/',
    search: '?lang=ko',
  };
  const nodes = new Map();
  let dirty = true,
    busy = false;
  const auth = createAuthUi({
    api() {
      throw Error('No request expected');
    },
    user: () => null,
    hasUnsaved: () => dirty,
    isBusy: () => busy,
    toast: (message) => notices.push(message),
    document: {
      querySelector(selector) {
        if (!nodes.has(selector)) nodes.set(selector, { addEventListener() {} });
        return nodes.get(selector);
      },
      createElement() {
        throw Error('Dirty workspace must keep its current screen');
      },
    },
    location,
    history: { replaceState: (...args) => replacements.push(args[2]) },
  });
  assert.deepEqual(replacements, ['/pmcanvas/?lang=ko']);
  location.hash = '#reset-password=' + 'b'.repeat(43);
  assert.equal(auth.handleHash(), true);
  assert.match(notices.at(-1), /변경사항을 저장/);
  dirty = false;
  busy = true;
  location.hash = '#verify-email=' + 'c'.repeat(43);
  assert.equal(auth.handleHash(), true);
  assert.match(notices.at(-1), /변경사항을 저장/);
  assert.ok(replacements.every((url) => !url.includes('#')));
  location.hash = '#overview';
  assert.equal(auth.handleHash(), false);
});

test('업무 체크 필터는 담당자·검색·상태와 과거 완료 기준을 유지하고 보고서에도 재사용 가능', () => {
  const p = screenProject(),
    asOf = '2026-10-26';
  assert.deepEqual(
    filteredTasks(p, { asOf, ownerFilter: 'm2', query: '설계', statusFilter: 'late' }).map(
      (t) => t.id,
    ),
    ['t1'],
  );
  assert.deepEqual(
    filteredTasks(p, { asOf, statusFilter: 'done' }).map((t) => t.id),
    ['t3'],
  );
  assert.deepEqual(filteredTasks(p, { asOf: '2026-10-19', statusFilter: 'done' }), []);
  const html = dailyView(p, { asOf: '2026-10-19', dailyMode: 'project', onlyPending: true });
  assert.match(html, /10\.20에 완료된 작업/);
  assert.match(html, /data-check-item="i1"\s+disabled/);
  assert.equal(html.includes('is-done'), false);
});

test('업무 체크·참여인력·수정 양식은 HTML 입력과 프로젝트 간 상태를 격리', () => {
  for (const { p, at } of screenCases()) {
    for (const html of [
      dailyView(p, { asOf: at, dailyMode: 'project' }),
      dailyView(p, { asOf: at, dailyMode: 'mine', myProjects: [p] }),
      peopleView(p, summary(p, at), at),
      memberEditor(p, p.members[0]?.id).body,
    ]) {
      assert.equal(html.includes('<img'), false);
      assert.equal(html.includes('<script'), false);
      assert.equal(html.includes('NaN'), false);
    }
  }
  const p = screenProject(),
    context = { asOf: '2026-10-26', dailyMode: 'project' };
  const before = dailyView(p, context);
  dailyView({ ...p, members: [] }, { ...context, ownerFilter: 'other', query: '없음' });
  assert.equal(dailyView(p, context), before);
});

test('완료 체크와 취소는 선택 기준일을 저장하며 다른 항목·공수는 보존', async () => {
  const p = screenProject(),
    events = [];
  const options = {
    project: p,
    taskId: 't1',
    itemId: 'i2',
    asOf: '2026-10-25',
    currentDate: '2026-10-26',
    persist: async () => {
      events.push('save');
      return true;
    },
    onRender: () => events.push('render'),
    toast: (message) => events.push(message),
  };
  await recordCompletion({ ...options, checked: true });
  assert.equal(p.tasks[0].items[1].doneDate, '2026-10-25');
  assert.equal(p.tasks[0].items[0].doneDate, '2026-10-20');
  assert.equal(p.tasks[0].items[1].hours, 24);
  assert.deepEqual(events.slice(0, 2), ['save', 'render']);
  await recordCompletion({ ...options, checked: false });
  assert.equal(p.tasks[0].items[1].doneDate, null);
  assert.match(events.at(-1), /체크를 취소/);
});

test('미래 날짜·없는 체크 항목은 저장하지 않고 저장 실패는 백업 필요 상태를 알림', async () => {
  const p = screenProject(),
    events = [];
  const options = {
    project: p,
    taskId: 't1',
    itemId: 'i2',
    checked: true,
    asOf: '2026-10-27',
    currentDate: '2026-10-26',
    persist: async () => {
      events.push('save');
      return false;
    },
    onRender: () => events.push('render'),
    toast: (message) => events.push(message),
  };
  await recordCompletion(options);
  assert.equal(p.tasks[0].items[1].doneDate, null);
  assert.equal(events.includes('save'), false);
  await recordCompletion({ ...options, itemId: 'missing', asOf: '2026-10-26' });
  assert.equal(events.includes('save'), false);
  await recordCompletion({ ...options, asOf: '2026-10-26' });
  assert.equal(p.tasks[0].items[1].doneDate, '2026-10-26');
  assert.match(events.at(-1), /저장 실패/);
});

test('참여인력 화면은 가용시간·가중 진척·과거 실적과 신규 양식 기본값을 유지', () => {
  const p = screenProject(),
    at = '2026-10-26';
  const html = peopleView(p, summary(p, at), at);
  assert.match(html, /25%/);
  assert.match(html, /33%/);
  assert.match(html, /4<em>h/);
  assert.match(html, /8 \/ 32h/);
  const previous = peopleView(p, summary(p, '2026-10-19'), '2026-10-19');
  assert.match(previous, /0 \/ 32h/);
  const form = memberEditor(p);
  assert.equal(form.title, '참여인력 추가');
  assert.match(form.body, /name="hours"[^>]*value="8"/);
  assert.match(form.body, /name="allocation"[^>]*value="100"/);
});

test('참여인력 수정·추가는 인력 ID와 업무·완료 기록을 보존하고 유효하지 않은 투입률을 거부', () => {
  const p = screenProject(),
    tasks = structuredClone(p.tasks);
  const data = new Map(
    Object.entries({
      name: ' 수정한 인력 ',
      role: '개발',
      grade: '고급',
      hours: '6',
      allocation: '50',
    }),
  );
  updateMember(p, 'm1', data);
  assert.equal(p.members[0].id, 'm1');
  assert.equal(p.members[0].name, '수정한 인력');
  assert.equal(p.members[0].hours, 6);
  assert.deepEqual(p.tasks, tasks);
  updateMember(p, '', data, () => 'new-member');
  assert.equal(p.members.at(-1).id, 'new-member');
  data.set('allocation', '101');
  assert.throws(() => updateMember(structuredClone(p), 'm1', data));
});
