import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createHandler } from '../server/http.mjs';
import { hashPassword, digest } from '../server/security.mjs';
import { MemoryRepository } from './support/memory-repository.mjs';
import { Federation } from '../server/federation.mjs';
import { registrationConfig } from '../server/registration.mjs';
import { RegistrationEmail } from '../server/registration.mjs';
import { PasswordReset } from '../server/password-reset.mjs';
import { MailSettings } from '../server/mail-settings.mjs';
const PASSWORD = 'a-test-password-12345',
  HASH = await hashPassword(PASSWORD);
const ORIGIN = 'http://localhost:3000';
async function fixture(
  t,
  {
    basePath = '',
    providers = [],
    trustProxies = '',
    mailer = null,
    mailSettingsFactory = null,
    registration = registrationConfig(),
  } = {},
) {
  const users = [
    {
      id: randomUUID(),
      email: 'owner@example.com',
      name: '소유자',
      password_hash: HASH,
      is_admin: true,
    },
    {
      id: randomUUID(),
      email: 'other@example.com',
      name: '팀원',
      password_hash: HASH,
      is_admin: false,
    },
  ];
  const repo = new MemoryRepository(users),
    mailSettings = mailSettingsFactory ? mailSettingsFactory(repo) : null,
    effectiveMailer = mailSettings || mailer,
    reset = effectiveMailer
      ? new PasswordReset({
          repo,
          mailer: effectiveMailer,
          origin: ORIGIN,
          basePath,
          logger: { error() {} },
        })
      : null,
    registrationEmail = new RegistrationEmail({
      repo,
      mailer: effectiveMailer || {
        async sendVerification() {},
        async sendApproval() {},
        async sendReviewRequest() {},
      },
      origin: ORIGIN,
      basePath,
      logger: { error() {} },
    }),
    handler = createHandler({
      repo,
      origin: ORIGIN,
      basePath,
      registration,
      trustProxies,
      passwordReset: reset,
      registrationEmail,
      mailSettings,
      federation: new Federation({ repo, origin: ORIGIN, basePath, providers }),
      logger: { error() {} },
    });
  async function inject(url, { method = 'GET', body, headers = {} } = {}) {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url, method, headers, socket: { remoteAddress: '127.0.0.1' } });
    class Response extends EventEmitter {
      constructor() {
        super();
        this.headers = new Map();
        this.headersSent = false;
        this.statusCode = 200;
        this.body = '';
      }
      setHeader(name, value) {
        this.headers.set(name.toLowerCase(), String(value));
      }
      writeHead(status, headers = {}) {
        this.statusCode = status;
        for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
        this.headersSent = true;
        return this;
      }
      end(body) {
        this.body =
          body === undefined ? '' : Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
        this.emit('finish');
      }
      destroy() {
        this.destroyed = true;
      }
    }
    const res = new Response();
    await handler(req, res);
    return {
      status: res.statusCode,
      body: res.body,
      headers: new Headers(Object.fromEntries(res.headers)),
    };
  }
  const client = () => ({ cookie: '', csrf: '' });
  async function call(c, path, { method = 'GET', body, headers = {} } = {}) {
    const normalized = Object.fromEntries(
      Object.entries({
        ...(c.cookie ? { Cookie: c.cookie } : {}),
        ...(method === 'GET'
          ? {}
          : { Origin: ORIGIN, 'Content-Type': 'application/json', 'X-CSRF-Token': c.csrf }),
        ...headers,
      }).map(([k, v]) => [k.toLowerCase(), v]),
    );
    const response = await inject(basePath + '/api/' + path, { method, body, headers: normalized });
    const cookie = response.headers.get('set-cookie');
    if (cookie) c.cookie = cookie.split(';')[0];
    const data = JSON.parse(response.body);
    if (data.csrf) c.csrf = data.csrf;
    return { status: response.status, data, headers: response.headers };
  }
  async function login(email) {
    const c = client(),
      r = await call(c, 'auth/login', { method: 'POST', body: { email, password: PASSWORD } });
    assert.equal(r.status, 200);
    return c;
  }
  return { repo, users, client, call, login, inject, reset, mailSettings, registrationEmail };
}
const project = () => ({
  id: randomUUID(),
  name: '팀 프로젝트',
  description: '',
  holidays: [],
  members: [{ id: 'm1', name: '개발자', grade: '고급', role: '개발', hours: 8, allocation: 100 }],
  tasks: [
    {
      id: 't1',
      name: '기능 개발',
      phase: '개발',
      owner: 'm1',
      start: '2026-10-19',
      end: '2026-10-23',
      predecessor: '',
      memo: '',
      items: [{ id: 'i1', title: '기능 구현', hours: 8, doneDate: null }],
    },
  ],
});
test('외부 계정 매핑은 관리자·CSRF 검증, 비밀 제외, 기존 사용자 ID 보존', async (t) => {
  const p = {
    id: 'company',
    key: 'company:key',
    label: '회사 SSO',
    type: 'oidc',
    clientSecret: 'private-secret',
    allowedDomains: ['example.com'],
    autoProvision: false,
  };
  const f = await fixture(t, { providers: [p] }),
    admin = await f.login('owner@example.com'),
    other = await f.login('other@example.com');
  const publicList = await f.call(f.client(), 'auth/providers');
  assert.equal(publicList.status, 200);
  assert.equal(JSON.stringify(publicList.data).includes('private-secret'), false);
  assert.equal((await f.call(other, 'auth/connections')).status, 403);
  const body = { provider: 'company', subject: 'stable-sub', email: 'other@example.com' };
  assert.equal(
    (
      await f.call(admin, 'auth/connections', {
        method: 'POST',
        body,
        headers: { 'X-CSRF-Token': 'bad' },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call(admin, 'auth/connections', {
        method: 'POST',
        body: { ...body, email: 'owner@example.com' },
      })
    ).status,
    403,
  );
  assert.equal((await f.call(admin, 'auth/connections', { method: 'POST', body })).status, 200);
  const list = await f.call(admin, 'auth/connections');
  assert.equal(list.data.identities[0].email, 'other@example.com');
  assert.equal(JSON.stringify(list.data).includes('private-secret'), false);
  const hash = 'external-session';
  const user = await f.repo.externalSession({
    providerKey: p.key,
    subject: 'stable-sub',
    email: 'other@example.com',
    name: 'external',
    autoProvision: false,
    hash,
    csrf: 'csrf',
    expires: new Date(Date.now() + 60000),
  });
  assert.equal(user.id, f.users[1].id);
  assert.equal((await f.call(admin, 'auth/connections', { method: 'DELETE', body })).status, 200);
  assert.equal(await f.repo.findSession(hash), null);
});
test('비밀번호 변경은 현재 비밀번호·확인을 검증하고 모든 세션을 종료', async (t) => {
  const f = await fixture(t),
    a = await f.login('owner@example.com'),
    b = await f.login('owner@example.com');
  const change = (body) => f.call(a, 'auth/password', { method: 'POST', body });
  assert.equal(
    (await change({ currentPassword: 'wrong', newPassword: 'new-password-12345' })).status,
    400,
  );
  assert.equal((await change({ currentPassword: PASSWORD, newPassword: 'short' })).status, 400);
  assert.equal((await change({ currentPassword: PASSWORD, newPassword: PASSWORD })).status, 400);
  assert.equal((await f.call(a, 'auth/me')).status, 200);
  const changed = await change({ currentPassword: PASSWORD, newPassword: 'new-password-12345' });
  assert.equal(changed.status, 200);
  assert.match(changed.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await f.call(a, 'auth/me')).status, 401);
  assert.equal((await f.call(b, 'auth/me')).status, 401);
  assert.equal(
    (
      await f.call(f.client(), 'auth/login', {
        method: 'POST',
        body: { email: 'owner@example.com', password: PASSWORD },
      })
    ).status,
    401,
  );
  const c = f.client();
  assert.equal(
    (
      await f.call(c, 'auth/login', {
        method: 'POST',
        body: { email: 'owner@example.com', password: 'new-password-12345' },
      })
    ).status,
    200,
  );
});
test('비밀번호 변경에 CSRF와 재시도 제한 적용', async (t) => {
  const f = await fixture(t),
    c = await f.login('owner@example.com');
  const body = { currentPassword: 'wrong', newPassword: 'new-password-12345' };
  assert.equal(
    (
      await f.call(c, 'auth/password', {
        method: 'POST',
        body,
        headers: { 'X-CSRF-Token': 'wrong' },
      })
    ).status,
    403,
  );
  for (let i = 0; i < 8; i++)
    assert.equal((await f.call(c, 'auth/password', { method: 'POST', body })).status, 400);
  assert.equal(
    (
      await f.call(c, 'auth/password', {
        method: 'POST',
        body: { ...body, currentPassword: PASSWORD },
      })
    ).status,
    429,
  );
});
test('관리자의 비활성화는 세션·로그인을 차단하고 재활성화 시 프로젝트 권한 유지', async (t) => {
  const f = await fixture(t),
    admin = await f.login('owner@example.com'),
    other = await f.login('other@example.com'),
    p = project();
  await f.call(admin, 'projects', { method: 'POST', body: { project: p } });
  await f.call(admin, 'projects/' + p.id + '/access', {
    method: 'POST',
    body: { email: 'other@example.com', role: 'editor' },
  });
  const target = 'users/' + f.users[1].id;
  assert.equal(
    (await f.call(other, target, { method: 'PATCH', body: { isActive: false } })).status,
    403,
  );
  assert.equal(
    (await f.call(admin, target, { method: 'PATCH', body: { isActive: false } })).data.user
      .isActive,
    false,
  );
  assert.equal((await f.call(other, 'auth/me')).status, 401);
  assert.equal(
    (
      await f.call(f.client(), 'auth/login', {
        method: 'POST',
        body: { email: 'other@example.com', password: PASSWORD },
      })
    ).status,
    401,
  );
  assert.equal(
    (await f.call(admin, target, { method: 'PATCH', body: { isActive: true } })).status,
    200,
  );
  const again = await f.login('other@example.com');
  assert.equal((await f.call(again, 'projects/' + p.id)).data.project._role, 'editor');
});
test('관리자 비밀번호 재설정은 기존 세션 종료·해시 비공개·관리자 보호', async (t) => {
  const f = await fixture(t),
    admin = await f.login('owner@example.com'),
    other = await f.login('other@example.com'),
    target = 'users/' + f.users[1].id;
  assert.equal(
    (await f.call(admin, 'users/' + f.users[0].id, { method: 'PATCH', body: { isActive: false } }))
      .status,
    403,
  );
  assert.equal(
    (
      await f.call(admin, 'users/' + f.users[0].id, {
        method: 'PATCH',
        body: { password: 'new-password-12345' },
      })
    ).status,
    403,
  );
  for (const body of [
    { isActive: 'false' },
    { isAdmin: true },
    { password: 'short' },
    { isActive: false, password: 'new-password-12345' },
  ])
    assert.equal((await f.call(admin, target, { method: 'PATCH', body })).status, 400);
  assert.equal(
    (await f.call(admin, 'users/' + randomUUID(), { method: 'PATCH', body: { isActive: false } }))
      .status,
    404,
  );
  const reset = await f.call(admin, target, {
    method: 'PATCH',
    body: { password: 'new-password-12345' },
  });
  assert.equal(reset.status, 200);
  assert.equal(JSON.stringify(reset.data).includes('password'), false);
  assert.equal((await f.call(other, 'auth/me')).status, 401);
  assert.equal(
    (
      await f.call(f.client(), 'auth/login', {
        method: 'POST',
        body: { email: 'other@example.com', password: PASSWORD },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await f.call(f.client(), 'auth/login', {
        method: 'POST',
        body: { email: 'other@example.com', password: 'new-password-12345' },
      })
    ).status,
    200,
  );
  const list = await f.call(admin, 'users');
  assert.equal(JSON.stringify(list.data).includes('password'), false);
});
test('로그인·쿠키·세션 만료·로그아웃', async (t) => {
  const f = await fixture(t),
    c = f.client();
  assert.equal((await f.call(c, 'projects')).status, 401);
  const r = await f.call(c, 'auth/login', {
    method: 'POST',
    body: { email: 'owner@example.com', password: PASSWORD },
  });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /HttpOnly/);
  assert.match(r.headers.get('set-cookie'), /SameSite=Lax/);
  assert.equal(JSON.stringify(r.data).includes('scrypt'), false);
  assert.equal((await f.call(c, 'auth/me')).data.user.isAdmin, true);
  [...f.repo.sessions.values()][0].expires = new Date(0);
  assert.equal((await f.call(c, 'auth/me')).status, 401);
  assert.equal(
    (
      await f.call(c, 'auth/login', {
        method: 'POST',
        body: { email: 'owner@example.com', password: PASSWORD },
      })
    ).status,
    200,
  );
  assert.equal((await f.call(c, 'auth/logout', { method: 'POST', body: {} })).status, 200);
  assert.equal((await f.call(c, 'auth/me')).status, 401);
});
test('교차 출처 요청·CSRF 누락은 거절', async (t) => {
  const f = await fixture(t),
    c = await f.login('owner@example.com');
  assert.equal(
    (
      await f.call(c, 'projects', {
        method: 'POST',
        body: { project: project() },
        headers: { Origin: 'https://evil.example' },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call(c, 'projects', {
        method: 'POST',
        body: { project: project() },
        headers: { 'X-CSRF-Token': 'invalid' },
      })
    ).status,
    403,
  );
  assert.equal((await f.call(c, 'projects')).data.projects.length, 0);
});
test('API 프로젝트 저장 계약: 생성·재조회·응답 유실 재시도·동시 수정 충돌', async (t) => {
  const f = await fixture(t),
    c = await f.login('owner@example.com'),
    p = project();
  const created = await f.call(c, 'projects', { method: 'POST', body: { project: p } });
  assert.equal(created.status, 201);
  assert.equal((await f.call(c, 'projects', { method: 'POST', body: { project: p } })).status, 201);
  assert.equal((await f.call(c, 'projects')).data.projects.length, 1);
  const changed = { ...p, name: '변경됨' };
  const saved = await f.call(c, 'projects/' + p.id, {
    method: 'PUT',
    body: { project: changed, revision: 1 },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.project._revision, 2);
  const conflict = await f.call(c, 'projects/' + p.id, {
    method: 'PUT',
    body: { project: { ...p, name: '덮어쓰기' }, revision: 1 },
  });
  assert.equal(conflict.status, 409);
  assert.equal((await f.call(c, 'projects/' + p.id)).data.project.name, '변경됨');
});
test('계정별 격리·조회자 쓰기 차단·편집 권한·공유 해제', async (t) => {
  const f = await fixture(t),
    owner = await f.login('owner@example.com'),
    other = await f.login('other@example.com'),
    p = project();
  await f.call(owner, 'projects', { method: 'POST', body: { project: p } });
  assert.equal((await f.call(other, 'projects/' + p.id)).status, 404);
  assert.equal((await f.call(other, 'projects')).data.projects.length, 0);
  await f.call(owner, 'projects/' + p.id + '/access', {
    method: 'POST',
    body: { email: 'other@example.com', role: 'viewer' },
  });
  assert.equal((await f.call(other, 'projects/' + p.id)).data.project._role, 'viewer');
  assert.equal(
    (await f.call(other, 'projects/' + p.id, { method: 'PUT', body: { project: p, revision: 1 } }))
      .status,
    403,
  );
  assert.equal((await f.call(other, 'projects/' + p.id + '/access')).status, 403);
  await f.call(owner, 'projects/' + p.id + '/access', {
    method: 'POST',
    body: { email: 'other@example.com', role: 'editor' },
  });
  assert.equal(
    (
      await f.call(other, 'projects/' + p.id, {
        method: 'PUT',
        body: { project: { ...p, name: '편집 가능' }, revision: 1 },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await f.call(owner, 'projects/' + p.id + '/access/' + f.users[1].id, {
        method: 'DELETE',
        body: {},
      })
    ).status,
    200,
  );
  assert.equal((await f.call(other, 'projects/' + p.id)).status, 404);
  assert.equal(
    (
      await f.call(owner, 'projects/' + p.id + '/access/' + f.users[0].id, {
        method: 'DELETE',
        body: {},
      })
    ).status,
    409,
  );
});
test('관리자만 계정 생성, 잘못된 데이터는 저장하지 않음', async (t) => {
  const f = await fixture(t),
    owner = await f.login('owner@example.com'),
    other = await f.login('other@example.com');
  const body = { email: 'new@example.com', name: '신규', password: PASSWORD };
  assert.equal((await f.call(other, 'users', { method: 'POST', body })).status, 403);
  assert.equal(
    (await f.call(owner, 'users', { method: 'POST', body: { ...body, password: '123' } })).status,
    400,
  );
  assert.equal((await f.call(owner, 'users', { method: 'POST', body })).status, 201);
  const p = project();
  p.tasks[0].items[0].hours = 0;
  assert.equal(
    (await f.call(owner, 'projects', { method: 'POST', body: { project: p } })).status,
    400,
  );
  assert.equal((await f.call(owner, 'projects')).data.projects.length, 0);
});
test('완료 체크·취소·삭제 전 값을 서버 이력에 보존', async (t) => {
  const f = await fixture(t),
    owner = await f.login('owner@example.com'),
    p = project();
  await f.call(owner, 'projects', { method: 'POST', body: { project: p } });
  p.tasks[0].items[0].doneDate = '2026-10-23';
  await f.call(owner, 'projects/' + p.id, { method: 'PUT', body: { project: p, revision: 1 } });
  p.tasks[0].items[0].doneDate = null;
  await f.call(owner, 'projects/' + p.id, { method: 'PUT', body: { project: p, revision: 2 } });
  p.tasks = [];
  await f.call(owner, 'projects/' + p.id, { method: 'PUT', body: { project: p, revision: 3 } });
  const events = (await f.call(owner, 'projects/' + p.id + '/events')).data.events;
  assert.ok(
    events.some((e) =>
      e.changes.some(
        (c) =>
          c.entity === 'item' && c.before?.doneDate === '2026-10-23' && c.after?.doneDate === null,
      ),
    ),
  );
  assert.ok(
    events.some((e) =>
      e.changes.some(
        (c) => c.entity === 'item' && c.action === 'delete' && c.before.title === '기능 구현',
      ),
    ),
  );
});
test('하위 경로 /pmcanvas에서 화면과 API 실행, 임의 파일은 비공개', async (t) => {
  const f = await fixture(t, { basePath: '/pmcanvas' }),
    c = await f.login('owner@example.com');
  assert.match(c.cookie, /pmcanvas_session/);
  assert.equal((await f.call(c, 'projects')).status, 200);
  assert.equal((await f.inject('/pmcanvas/')).status, 200);
  assert.equal((await f.inject('/pmcanvas/api-client.js')).status, 200);
  assert.equal((await f.inject('/pmcanvas/server/main.mjs')).status, 404);
  assert.equal((await f.inject('/api/projects')).status, 404);
});

test('JSON 객체가 아닌 요청은 400으로 응답', async (t) => {
  const f = await fixture(t),
    c = f.client();
  assert.equal((await f.call(c, 'auth/login', { method: 'POST', body: null })).status, 400);
  assert.equal((await f.call(c, 'auth/login', { method: 'POST', body: [] })).status, 400);
});

test('Excel API는 인증·CSRF·프로젝트 권한·출력 조건을 검증한다', async (t) => {
  const f = await fixture(t),
    owner = await f.login('owner@example.com'),
    other = await f.login('other@example.com'),
    p = project();
  await f.call(owner, 'projects', { method: 'POST', body: { project: p } });
  const path = 'projects/' + p.id + '/export.xlsx',
    body = { project: p, asOf: '2026-10-23', taskIds: ['t1'] };
  assert.equal((await f.call(f.client(), path, { method: 'POST', body })).status, 401);
  assert.equal((await f.call(other, path, { method: 'POST', body })).status, 404);
  assert.equal(
    (await f.call(owner, path, { method: 'POST', body, headers: { 'X-CSRF-Token': 'bad' } }))
      .status,
    403,
  );
  assert.equal(
    (await f.call(owner, path, { method: 'POST', body: { ...body, taskIds: ['missing'] } })).status,
    400,
  );
  assert.equal(
    (await f.call(owner, path, { method: 'POST', body: { ...body, asOf: 'bad' } })).status,
    400,
  );
  const response = await f.inject('/api/' + path, {
    method: 'POST',
    body,
    headers: {
      cookie: owner.cookie,
      origin: ORIGIN,
      'content-type': 'application/json',
      'x-csrf-token': owner.csrf,
    },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /spreadsheetml/);
  assert.match(response.headers.get('content-disposition'), /filename\*=UTF-8/);
  assert.ok(response.body.startsWith('PK'));
  assert.equal((await f.call(owner, 'projects/' + p.id)).data.project._revision, 1);
});

test('Excel 가져오기 API는 인증·CSRF·편집 권한과 파일 형식을 검증한다', async (t) => {
  const f = await fixture(t),
    owner = await f.login('owner@example.com'),
    viewer = await f.login('other@example.com'),
    p = project();
  await f.call(owner, 'projects', { method: 'POST', body: { project: p } });
  const path = 'projects/' + p.id + '/import-excel',
    body = { file: 'broken' };
  assert.equal((await f.call(f.client(), path, { method: 'POST', body })).status, 401);
  assert.equal((await f.call(viewer, path, { method: 'POST', body })).status, 404);
  await f.call(owner, 'projects/' + p.id + '/access', {
    method: 'POST',
    body: { email: 'other@example.com', role: 'viewer' },
  });
  assert.equal((await f.call(viewer, path, { method: 'POST', body })).status, 403);
  assert.equal(
    (await f.call(owner, path, { method: 'POST', body, headers: { 'X-CSRF-Token': 'bad' } }))
      .status,
    403,
  );
  assert.equal((await f.call(owner, path, { method: 'POST', body })).status, 400);
  const { projectWorkbook } = await import('../server/excel.mjs');
  const file = (await projectWorkbook(p, '2026-10-26')).toString('base64');
  const response = await f.call(owner, path, { method: 'POST', body: { file } });
  assert.equal(response.status, 200);
  assert.equal(response.data.sheets.find((s) => s.name === 'WBS').rows[1][2], '기능 개발');
  assert.equal((await f.call(owner, 'projects/' + p.id)).data.project._revision, 1);
});

const application = {
  name: '신규 팀원',
  email: 'new@example.com',
  password: PASSWORD,
  confirmPassword: PASSWORD,
};
test('회원가입: 승인 전 접근 차단, 관리자·CSRF 승인, 권한 위조 거절과 프로젝트 격리', async (t) => {
  const messages = [],
    f = await fixture(t, {
      basePath: '/pmcanvas',
      mailer: {
        async sendVerification(m) {
          messages.push(m);
        },
        async sendApproval(m) {
          messages.push(m);
        },
      },
    }),
    guest = f.client();
  const policy = await f.call(guest, 'auth/providers');
  assert.equal(policy.data.registration.mode, 'approval');
  const result = await f.call(guest, 'auth/register', {
    method: 'POST',
    body: { ...application, isAdmin: true, isActive: true, registrationPending: false },
  });
  assert.equal(result.status, 202);
  assert.equal(result.headers.get('set-cookie'), null);
  assert.equal('user' in result.data, false);
  const stored = await f.repo.findUserByEmail(application.email);
  assert.equal(stored.is_admin, false);
  assert.equal(stored.is_active, false);
  assert.equal(stored.registration_pending, true);
  assert.match(stored.password_hash, /^scrypt-v2:/);
  assert.equal((await f.call(guest, 'projects')).status, 401);
  const before = await f.call(guest, 'auth/login', { method: 'POST', body: application });
  assert.equal(before.status, 403);
  assert.equal(before.data.error.code, 'EMAIL_UNVERIFIED');
  assert.equal(f.repo.sessions.size, 0);
  assert.equal(
    (
      await f.call(guest, 'auth/login', {
        method: 'POST',
        body: { ...application, password: 'wrong' },
      })
    ).status,
    401,
  );
  const admin = await f.login('owner@example.com'),
    other = await f.login('other@example.com');
  const users = await f.call(admin, 'users');
  assert.equal(
    users.data.users.find((u) => u.email === application.email).registrationPending,
    true,
  );
  assert.equal(JSON.stringify(users.data).includes('scrypt-v2'), false);
  const route = 'users/' + stored.id;
  assert.equal(
    (await f.call(other, route, { method: 'PATCH', body: { isActive: true } })).status,
    403,
  );
  assert.equal(
    (
      await f.call(admin, route, {
        method: 'PATCH',
        body: { isActive: true },
        headers: { 'X-CSRF-Token': 'bad' },
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.call(admin, route, { method: 'PATCH', body: { isActive: true } })).data.error.code,
    'EMAIL_UNVERIFIED',
  );
  await f.registrationEmail.idle();
  const proof = new URL(messages[0].url).hash.slice('#verify-email='.length);
  assert.equal(
    (
      await f.call(guest, 'auth/verify-email', {
        method: 'POST',
        body: {
          token: proof,
          name: application.name,
          newPassword: PASSWORD,
          confirmPassword: PASSWORD,
        },
      })
    ).status,
    200,
  );
  assert.equal(
    (await f.call(guest, 'auth/login', { method: 'POST', body: application })).data.error.code,
    'APPROVAL_PENDING',
  );
  const approved = await f.call(admin, route, { method: 'PATCH', body: { isActive: true } });
  assert.equal(approved.data.user.registrationPending, false);
  assert.equal(approved.data.user.isActive, true);
  const login = await f.call(guest, 'auth/login', { method: 'POST', body: application });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.isAdmin, false);
  assert.deepEqual((await f.call(guest, 'projects')).data.projects, []);
  await f.registrationEmail.idle();
  assert.equal(messages.length, 2);
  assert.equal(f.repo.notices.get(stored.id).state, 'sent');
  assert.ok(f.repo.security.some((e) => e.kind === 'account.registration.requested'));
});
test('회원가입: 중복·기존 관리자·외부 계정에 같은 응답, 기존 정보와 비밀번호 보존', async (t) => {
  const f = await fixture(t),
    guest = f.client(),
    external = await f.repo.createUser({
      email: 'sso@example.com',
      name: '외부 계정',
      passwordHash: 'external-only',
    });
  f.repo.users.get(external.id).local_login = false;
  const before = structuredClone([...f.repo.users]);
  const first = await f.call(guest, 'auth/register', { method: 'POST', body: application });
  for (const email of [application.email, 'owner@example.com', 'sso@example.com']) {
    const result = await f.call(guest, 'auth/register', {
      method: 'POST',
      body: { ...application, email, name: '덮어쓰기 시도' },
    });
    assert.equal(result.status, 202);
    assert.deepEqual(result.data, first.data);
  }
  for (const [id, user] of before) assert.deepEqual(f.repo.users.get(id), user);
  assert.equal(f.repo.users.size, before.length + 1);
  assert.equal((await f.repo.findUserByEmail(application.email)).name, application.name);
});
test('회원가입: 비활성·회사 도메인·입력값·Origin 검사와 이메일별 반복 제한', async (t) => {
  const disabled = await fixture(t, {
    registration: registrationConfig({ REGISTRATION_MODE: 'disabled' }),
  });
  assert.equal(
    (await disabled.call(disabled.client(), 'auth/register', { method: 'POST', body: application }))
      .status,
    403,
  );
  assert.equal(disabled.repo.users.size, 2);
  const f = await fixture(t, {
      registration: registrationConfig({ REGISTRATION_DOMAINS: 'company.com' }),
    }),
    guest = f.client();
  assert.equal(
    (
      await f.call(guest, 'auth/register', {
        method: 'POST',
        body: application,
        headers: { Origin: 'https://attacker.example' },
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.call(guest, 'auth/register', { method: 'POST', body: application })).data.error.code,
    'REGISTRATION_DOMAIN',
  );
  const valid = { ...application, email: 'new@company.com' };
  for (const patch of [
    { name: ' ' },
    { password: 'short', confirmPassword: 'short' },
    { confirmPassword: 'different' },
  ])
    assert.equal(
      (
        await f.call(guest, 'auth/register', {
          method: 'POST',
          body: { ...valid, ...patch, email: Math.random() + '@company.com' },
        })
      ).status,
      400,
    );
  const result = await f.call(guest, 'auth/register', { method: 'POST', body: valid });
  assert.equal(result.status, 202);
  await f.call(guest, 'auth/register', { method: 'POST', body: valid });
  await f.call(guest, 'auth/register', { method: 'POST', body: valid });
  assert.equal((await f.call(guest, 'auth/register', { method: 'POST', body: valid })).status, 429);
  assert.equal(f.repo.users.size, 3);
});
test('회원가입 컨피그는 잘못된 모드·도메인을 거절한다', () => {
  assert.throws(() => registrationConfig({ REGISTRATION_MODE: 'open' }));
  assert.throws(() => registrationConfig({ REGISTRATION_DOMAINS: '*.company.com' }));
  assert.deepEqual(
    registrationConfig({ REGISTRATION_DOMAINS: ' Company.com,company.com,example.org ' }),
    { mode: 'approval', domains: ['company.com', 'example.org'] },
  );
});

test('회원가입: 신뢰 프록시의 IP별 가입 한도는 다른 사용자와 분리된다', async (t) => {
  const f = await fixture(t, { trustProxies: '127.0.0.1' }),
    guest = f.client(),
    headers = { 'X-Forwarded-For': '203.0.113.10' };
  for (let i = 0; i < 10; i++)
    assert.equal(
      (
        await f.call(guest, 'auth/register', {
          method: 'POST',
          body: { ...application, email: 'invalid' + i + '@example.com', name: '' },
          headers,
        })
      ).status,
      400,
    );
  assert.equal(
    (await f.call(guest, 'auth/register', { method: 'POST', body: application, headers })).status,
    429,
  );
  assert.equal(
    (
      await f.call(guest, 'auth/register', {
        method: 'POST',
        body: application,
        headers: { 'X-Forwarded-For': '203.0.113.11' },
      })
    ).status,
    202,
  );
});

const resetBody = (value) => ({
  token: value,
  newPassword: 'new-reset-password-12345',
  confirmPassword: 'new-reset-password-12345',
});
test('가입 이메일 인증 API: 비밀번호 없는 신청·재발송·Origin·만료 링크·기존 계정 보호·입력 제한', async (t) => {
  const messages = [],
    f = await fixture(t, {
      mailer: {
        async sendVerification(m) {
          messages.push(m);
        },
        async sendApproval() {},
      },
    }),
    guest = f.client();
  assert.equal(
    (
      await f.call(guest, 'auth/register', {
        method: 'POST',
        body: { name: '신청자', email: application.email },
      })
    ).status,
    202,
  );
  await f.registrationEmail.idle();
  const first = new URL(messages[0].url).hash.slice('#verify-email='.length);
  assert.equal((await f.inject('/api/auth/verify-email?token=' + first)).status, 401);
  assert.equal((await f.repo.findUserByEmail(application.email)).email_verified_at, null);
  const resend = (email) =>
    f.call(guest, 'auth/resend-verification', { method: 'POST', body: { email } });
  const response = await resend(application.email);
  assert.equal(response.status, 202);
  await f.registrationEmail.idle();
  assert.equal(messages.length, 2);
  assert.deepEqual((await resend('owner@example.com')).data, response.data);
  assert.deepEqual((await resend('missing@example.com')).data, response.data);
  await f.registrationEmail.idle();
  assert.equal(messages.length, 2);
  const proof = new URL(messages[1].url).hash.slice('#verify-email='.length),
    body = { token: proof, name: '메일 소유자', newPassword: PASSWORD, confirmPassword: PASSWORD };
  assert.equal(
    (
      await f.call(guest, 'auth/verify-email', {
        method: 'POST',
        body,
        headers: { Origin: 'https://evil.example' },
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.call(guest, 'auth/verify-email', { method: 'POST', body: { ...body, token: first } }))
      .data.error.code,
    'VERIFICATION_INVALID',
  );
  assert.equal(
    (
      await f.call(guest, 'auth/verify-email', {
        method: 'POST',
        body: { ...body, confirmPassword: 'different' },
      })
    ).data.error.code,
    'PASSWORD_MISMATCH',
  );
  assert.equal(
    (await f.call(guest, 'auth/verify-email', { method: 'POST', body: { ...body, name: ' ' } }))
      .data.error.code,
    'INVALID_NAME',
  );
  assert.equal((await f.call(guest, 'auth/verify-email', { method: 'POST', body })).status, 200);
  assert.equal(
    (await f.call(guest, 'auth/verify-email', { method: 'POST', body })).data.error.code,
    'VERIFICATION_INVALID',
  );
  assert.equal((await resend(application.email)).status, 202);
  await f.registrationEmail.idle();
  assert.equal(messages.length, 2);
  assert.equal((await resend(application.email)).status, 429);
});
test('SMTP 미설정 시 가입 접수 차단, 승인 메일 재시도는 관리자·CSRF·실패 상태 검사', async (t) => {
  const disabled = await fixture(t, {
    mailSettingsFactory: (repo) => new MailSettings({ repo, key: Buffer.alloc(32, 17) }),
  });
  assert.equal(
    (await disabled.call(disabled.client(), 'auth/providers')).data.registration.emailEnabled,
    false,
  );
  assert.equal(
    (await disabled.call(disabled.client(), 'auth/register', { method: 'POST', body: application }))
      .status,
    503,
  );
  assert.equal(disabled.repo.users.size, 2);
  const f = await fixture(t),
    admin = await f.login('owner@example.com'),
    other = await f.login('other@example.com'),
    id = f.users[1].id,
    route = 'users/' + id + '/approval-notice';
  assert.equal((await f.call(f.client(), route, { method: 'POST', body: {} })).status, 401);
  assert.equal((await f.call(other, route, { method: 'POST', body: {} })).status, 403);
  assert.equal(
    (await f.call(admin, route, { method: 'POST', body: {}, headers: { 'X-CSRF-Token': 'bad' } }))
      .status,
    403,
  );
  assert.equal((await f.call(admin, route, { method: 'POST', body: {} })).status, 409);
  Object.assign(f.users[1], { is_active: true, email_verified_at: new Date() });
  f.repo.notices.set(id, { state: 'failed', attempts: 3, available: 0 });
  assert.equal((await f.call(admin, route, { method: 'POST', body: {} })).status, 202);
  await f.registrationEmail.idle();
  assert.equal(f.repo.notices.get(id).state, 'sent');
});
const mailToken = (mail) => new URL(mail.url).hash.slice('#reset-password='.length);
test('관리자 승인 요청 재발송 API: 관리자·CSRF·Origin·실패 대상만 재발송', async (t) => {
  const requests = [],
    f = await fixture(t, {
      mailer: {
        async sendReviewRequest(m) {
          requests.push(m);
        },
      },
    }),
    admin = await f.login('owner@example.com'),
    other = await f.login('other@example.com');
  const u = await f.repo.createUser({
    email: 'review@example.com',
    name: '인증한 신청자',
    passwordHash: HASH,
    registrationPending: true,
  });
  f.repo.users.get(u.id).email_verified_at = new Date();
  f.repo.reviewNotices.set(u.id + '|' + f.users[0].id, {
    userId: u.id,
    recipientId: f.users[0].id,
    state: 'failed',
    attempts: 3,
    available: 0,
  });
  const route = 'users/' + u.id + '/review-notice';
  assert.equal((await f.call(f.client(), route, { method: 'POST', body: {} })).status, 401);
  assert.equal((await f.call(other, route, { method: 'POST', body: {} })).status, 403);
  assert.equal(
    (await f.call(admin, route, { method: 'POST', body: {}, headers: { 'X-CSRF-Token': 'bad' } }))
      .status,
    403,
  );
  assert.equal(
    (
      await f.call(admin, route, {
        method: 'POST',
        body: {},
        headers: { Origin: 'https://evil.example' },
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.call(admin, route, { method: 'POST', body: { to: 'attacker@example.com' } })).status,
    202,
  );
  await f.registrationEmail.idle();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].to, 'owner@example.com');
  assert.equal(requests[0].email, u.email);
  const list = await f.call(admin, 'users');
  assert.equal(list.data.users.find((x) => x.id === u.id).reviewMailStatus, 'sent');
  assert.equal(list.data.users.filter((x) => x.id === u.id).length, 1);
  assert.equal((await f.call(admin, route, { method: 'POST', body: {} })).status, 409);
  assert.ok(f.repo.security.some((e) => e.kind === 'account.review_notice.retried'));
});
test('이메일 재설정: 동일 접수 응답·Origin·확인값·세션 폐기·일회성 링크·자동 로그인 금지', async (t) => {
  const mails = [],
    f = await fixture(t, {
      basePath: '/pmcanvas',
      mailer: { sendReset: async (mail) => mails.push(mail) },
    }),
    a = await f.login('other@example.com'),
    b = await f.login('other@example.com'),
    guest = f.client();
  const request = (email) =>
    f.call(guest, 'auth/forgot-password', { method: 'POST', body: { email } });
  assert.equal(
    (
      await f.call(guest, 'auth/forgot-password', {
        method: 'POST',
        body: { email: 'other@example.com' },
        headers: { Origin: 'https://evil.example' },
      })
    ).status,
    403,
  );
  const known = await request('other@example.com'),
    unknown = await request('missing@example.com');
  assert.equal(known.status, 202);
  assert.deepEqual(known.data, unknown.data);
  assert.equal(known.headers.get('set-cookie'), null);
  assert.equal(JSON.stringify(known.data).includes('token'), false);
  await f.reset.idle();
  assert.equal(mails.length, 1);
  const value = mailToken(mails[0]);
  assert.equal(mails[0].url.startsWith('http://localhost:3000/pmcanvas/#reset-password='), true);
  assert.equal([...f.repo.resets.values()][0].hash.length, 64);
  assert.equal(JSON.stringify([...f.repo.resets.values()]).includes(value), false);
  const finish = (body) => f.call(guest, 'auth/reset-password', { method: 'POST', body });
  assert.equal((await finish({ ...resetBody(value), confirmPassword: 'wrong' })).status, 400);
  assert.equal(
    (await finish({ ...resetBody(value), newPassword: 'short', confirmPassword: 'short' })).status,
    400,
  );
  assert.equal((await f.call(a, 'auth/me')).status, 200);
  for (let i = 0; i < 8; i++)
    await f.repo.reserveAttempt(digest('local:other@example.com'), 8, 900000);
  const changed = await finish(resetBody(value));
  assert.equal(changed.status, 200);
  assert.match(changed.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal('csrf' in changed.data, false);
  assert.equal((await f.call(a, 'auth/me')).status, 401);
  assert.equal((await f.call(b, 'auth/me')).status, 401);
  assert.equal((await finish(resetBody(value))).data.error.code, 'RESET_INVALID');
  assert.equal(
    (
      await f.call(guest, 'auth/login', {
        method: 'POST',
        body: { email: 'other@example.com', password: PASSWORD },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await f.call(guest, 'auth/login', {
        method: 'POST',
        body: { email: 'other@example.com', password: resetBody(value).newPassword },
      })
    ).status,
    200,
  );
  assert.ok(f.repo.security.some((e) => e.kind === 'auth.password_reset.completed'));
  assert.equal(JSON.stringify(f.repo.security).includes(value), false);
});
test('이메일 재설정: 외부·비활성·가입 대기 계정 제외, 메일 실패와 비활성 설정·요청 제한', async (t) => {
  const mails = [],
    f = await fixture(t, { mailer: { sendReset: async (m) => mails.push(m) } }),
    guest = f.client();
  for (const [email, patch] of [
    ['inactive@example.com', { is_active: false }],
    ['external@example.com', { local_login: false }],
    ['pending@example.com', { registration_pending: true, is_active: false }],
  ]) {
    const user = await f.repo.createUser({ email, name: '제외 계정', passwordHash: HASH });
    Object.assign(f.repo.users.get(user.id), patch);
    assert.equal(
      (await f.call(guest, 'auth/forgot-password', { method: 'POST', body: { email } })).status,
      202,
    );
  }
  await f.reset.idle();
  assert.equal(mails.length, 0);
  for (let i = 0; i < 3; i++)
    assert.equal(
      (
        await f.call(guest, 'auth/forgot-password', {
          method: 'POST',
          body: { email: 'other@example.com' },
        })
      ).status,
      202,
    );
  assert.equal(
    (
      await f.call(guest, 'auth/forgot-password', {
        method: 'POST',
        body: { email: 'other@example.com' },
      })
    ).status,
    429,
  );
  await f.reset.idle();
  const disabled = await fixture(t);
  assert.equal(
    (
      await disabled.call(disabled.client(), 'auth/forgot-password', {
        method: 'POST',
        body: { email: 'other@example.com' },
      })
    ).status,
    503,
  );
  const failed = await fixture(t, {
    mailer: {
      sendReset: async () => {
        throw Error('smtp failure');
      },
    },
  });
  assert.equal(
    (
      await failed.call(failed.client(), 'auth/forgot-password', {
        method: 'POST',
        body: { email: 'other@example.com' },
      })
    ).status,
    202,
  );
  await failed.reset.idle();
  assert.equal(failed.repo.resets.size, 0);
  assert.ok(failed.repo.security.some((e) => e.kind === 'auth.password_reset.delivery_failed'));
});

const smtpInput = {
  revision: 0,
  enabled: true,
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  from: 'sender@example.com',
  authEnabled: true,
  username: 'smtp-user',
  password: 'smtp-test-secret',
};
test('SMTP 관리자 API: 관리자·CSRF·Origin·비밀 미노출·즉시 적용·테스트 수신자·요청 제한', async (t) => {
  const sent = [],
    f = await fixture(t, {
      mailSettingsFactory: (repo) =>
        new MailSettings({
          repo,
          key: Buffer.alloc(32, 5),
          makeMailer: (config) => ({
            sendTest: async (to) => sent.push(to),
            sendReset: async (m) => sent.push(m),
            close() {},
          }),
        }),
    }),
    guest = f.client(),
    admin = await f.login('owner@example.com'),
    other = await f.login('other@example.com');
  assert.equal((await f.call(guest, 'admin/mail-settings')).status, 401);
  assert.equal((await f.call(other, 'admin/mail-settings')).status, 403);
  assert.equal(
    (
      await f.call(admin, 'admin/mail-settings', {
        method: 'PUT',
        body: smtpInput,
        headers: { 'X-CSRF-Token': 'bad' },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call(admin, 'admin/mail-settings/test', {
        method: 'POST',
        body: { to: 'test@example.com' },
        headers: { Origin: 'https://evil.example' },
      })
    ).status,
    403,
  );
  assert.equal((await f.call(guest, 'auth/providers')).data.passwordReset.enabled, false);
  const saved = await f.call(admin, 'admin/mail-settings', { method: 'PUT', body: smtpInput });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.settings.hasPassword, true);
  assert.equal(JSON.stringify(saved.data).includes(smtpInput.password), false);
  const read = await f.call(admin, 'admin/mail-settings');
  assert.equal('password' in read.data.settings, false);
  assert.equal(JSON.stringify(f.repo.mailSettings).includes(smtpInput.password), false);
  assert.equal((await f.call(guest, 'auth/providers')).data.passwordReset.enabled, true);
  assert.equal(
    (await f.call(admin, 'admin/mail-settings', { method: 'PUT', body: smtpInput })).status,
    409,
  );
  assert.equal(
    (
      await f.call(other, 'admin/mail-settings/test', {
        method: 'POST',
        body: { to: 'test@example.com' },
      })
    ).status,
    403,
  );
  const first = await f.call(admin, 'admin/mail-settings/test', {
    method: 'POST',
    body: { to: 'test@example.com' },
  });
  assert.equal(first.status, 200);
  assert.deepEqual(sent, ['test@example.com']);
  assert.equal(
    (
      await f.call(admin, 'admin/mail-settings/test', {
        method: 'POST',
        body: { to: 'one,two@example.com' },
      })
    ).status,
    400,
  );
  for (let i = 0; i < 3; i++)
    assert.equal(
      (
        await f.call(admin, 'admin/mail-settings/test', {
          method: 'POST',
          body: { to: 'test@example.com' },
        })
      ).status,
      200,
    );
  assert.equal(
    (
      await f.call(admin, 'admin/mail-settings/test', {
        method: 'POST',
        body: { to: 'test@example.com' },
      })
    ).status,
    429,
  );
  assert.equal(sent.length, 4);
  assert.ok(f.repo.security.some((e) => e.kind === 'mail.settings.updated'));
  assert.ok(f.repo.security.some((e) => e.kind === 'mail.test.sent'));
  assert.equal(JSON.stringify(f.repo.security).includes(smtpInput.password), false);
});

test('운영 API: 가입 승인 권한·프로젝트 연결·거절·CSRF, 내 업무와 휴지통', async (t) => {
  const f = await fixture(t),
    admin = await f.login('owner@example.com'),
    other = await f.login('other@example.com'),
    p = project();
  await f.call(admin, 'projects', { method: 'POST', body: { project: p } });
  const applicant = await f.repo.createUser({
    email: 'apply@example.com',
    name: '신청',
    passwordHash: HASH,
    registrationPending: true,
  });
  f.repo.users.get(applicant.id).email_verified_at = new Date();
  const decision = { decision: 'approve', grants: [{ projectId: p.id, role: 'editor' }] };
  assert.equal(
    (
      await f.call(other, 'users/' + applicant.id + '/registration', {
        method: 'POST',
        body: decision,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call(admin, 'users/' + applicant.id + '/registration', {
        method: 'POST',
        body: decision,
        headers: { 'X-CSRF-Token': 'wrong' },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call(admin, 'users/' + applicant.id + '/registration', {
        method: 'POST',
        body: decision,
      })
    ).status,
    200,
  );
  const member = await f.login(applicant.email);
  assert.equal((await f.call(member, 'projects/' + p.id)).data.project._role, 'editor');
  assert.equal(
    (
      await f.call(admin, 'projects/' + p.id + '/member-accounts', {
        method: 'PUT',
        body: { memberId: 'm1', userId: applicant.id },
      })
    ).status,
    200,
  );
  assert.equal((await f.call(member, 'my-work')).data.projects[0].tasks[0].id, 't1');
  assert.equal((await f.call(other, 'my-work')).data.projects.length, 0);
  assert.equal(
    (await f.call(member, 'projects/' + p.id, { method: 'DELETE', body: { revision: 1 } })).status,
    403,
  );
  assert.equal(
    (await f.call(admin, 'projects/' + p.id, { method: 'DELETE', body: { revision: 1 } })).status,
    200,
  );
  assert.equal((await f.call(member, 'projects/' + p.id)).status, 404);
  assert.equal((await f.call(member, 'trash')).data.items.length, 0);
  assert.equal(
    (await f.call(admin, 'trash/project/' + p.id + '/restore', { method: 'POST', body: {} }))
      .status,
    200,
  );
  const rejected = await f.repo.createUser({
    email: 'reject@example.com',
    name: '거절',
    passwordHash: HASH,
    registrationPending: true,
  });
  assert.equal(
    (
      await f.call(admin, 'users/' + rejected.id + '/registration', {
        method: 'POST',
        body: { decision: 'reject', reason: '중복' },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await f.call(f.client(), 'auth/login', {
        method: 'POST',
        body: { email: rejected.email, password: PASSWORD },
      })
    ).data.error.code,
    'REGISTRATION_REJECTED',
  );
});
test('운영 API: 백업 설정은 관리자·입력·revision·CSRF·중복 요청을 검증', async (t) => {
  const f = await fixture(t),
    admin = await f.login('owner@example.com'),
    other = await f.login('other@example.com');
  assert.equal((await f.call(other, 'admin/backups')).status, 403);
  assert.equal((await f.call(f.client(), 'admin/backups')).status, 401);
  const b = { enabled: true, hour: 3, retentionDays: 14, verifyRestore: true, revision: 0 };
  assert.equal(
    (await f.call(admin, 'admin/backups', { method: 'PUT', body: { ...b, hour: 24 } })).status,
    400,
  );
  assert.equal((await f.call(admin, 'admin/backups', { method: 'PUT', body: b })).status, 200);
  assert.equal((await f.call(admin, 'admin/backups', { method: 'PUT', body: b })).status, 409);
  assert.equal(
    (
      await f.call(admin, 'admin/backups/run', {
        method: 'POST',
        body: {},
        headers: { 'X-CSRF-Token': 'bad' },
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.call(admin, 'admin/backups/run', { method: 'POST', body: {} })).status,
    202,
  );
  assert.equal(
    (await f.call(admin, 'admin/backups/run', { method: 'POST', body: {} })).status,
    409,
  );
});

test('회원가입은 이메일만 먼저 접수하고 이름·비밀번호는 인증 시 확정', async (t) => {
  const f = await fixture(t),
    email = 'email-first@example.com';
  const r = await f.call(f.client(), 'auth/register', { method: 'POST', body: { email } });
  assert.equal(r.status, 202);
  const u = await f.repo.findUserByEmail(email);
  assert.equal(u.name, '이메일 인증 대기');
  assert.equal(u.registration_pending, true);
  assert.equal(u.is_active, false);
  await f.registrationEmail.idle();
  assert.equal(
    (
      await f.call(f.client(), 'auth/register', {
        method: 'POST',
        body: { email: 'bad-name@example.com', name: '' },
      })
    ).status,
    400,
  );
});
