import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer as netServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { createApplication } from '../server/http.mjs';
import { hashPassword } from '../server/security.mjs';
import { MemoryRepository } from './support/memory-repository.mjs';
import { RegistrationEmail } from '../server/registration.mjs';
import { PasswordReset } from '../server/password-reset.mjs';
import { MailSettings } from '../server/mail-settings.mjs';
import { createMailer } from '../server/mailer.mjs';
import { smtpFixture, resetLink, verificationLink, mailText } from './support/smtp-fixture.mjs';
const networkTest = (name, fn) => test(name, { skip: process.env.RUN_HTTP_TESTS !== '1' }, fn);
const PASSWORD = 'a-test-password-12345',
  HASH = await hashPassword(PASSWORD);
const ORIGIN = 'http://localhost:3000';
async function fixture(t, { basePath = '', mailer = null, mailSettingsFactory = null } = {}) {
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
    server = createApplication({
      repo,
      origin: ORIGIN,
      basePath,
      passwordReset: reset,
      registrationEmail,
      mailSettings,
      logger: { error() {} },
    });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const base = 'http://127.0.0.1:' + server.address().port + basePath + '/api/';
  const client = () => ({ cookie: '', csrf: '' });
  async function call(c, path, { method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(c.cookie ? { Cookie: c.cookie } : {}),
        ...(method === 'GET'
          ? {}
          : { Origin: ORIGIN, 'Content-Type': 'application/json', 'X-CSRF-Token': c.csrf }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const cookie = response.headers.get('set-cookie');
    if (cookie) c.cookie = cookie.split(';')[0];
    const data = await response.json();
    if (data.csrf) c.csrf = data.csrf;
    return { status: response.status, data, headers: response.headers };
  }
  async function login(email) {
    const c = client(),
      r = await call(c, 'auth/login', { method: 'POST', body: { email, password: PASSWORD } });
    assert.equal(r.status, 200);
    return c;
  }
  return { repo, server, base, users, client, call, login, reset, mailSettings, registrationEmail };
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
networkTest('로그인·쿠키·세션 만료·로그아웃', async (t) => {
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
  assert.equal((await f.call(c, 'auth/logout', { method: 'POST', body: {} })).status, 200);
  assert.equal((await f.call(c, 'auth/me')).status, 401);
});
networkTest('교차 출처 요청·CSRF 누락은 거절', async (t) => {
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
networkTest('프로젝트 DB 계약: 생성·재조회·응답 유실 재시도·동시 수정 충돌', async (t) => {
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
networkTest('계정별 격리·조회자 쓰기 차단·편집 권한·공유 해제', async (t) => {
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
networkTest('관리자만 계정 생성, 잘못된 데이터는 저장하지 않음', async (t) => {
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
networkTest('완료 체크·취소·삭제 전 값을 서버 이력에 보존', async (t) => {
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
networkTest('하위 경로 /pmcanvas에서 화면과 API 실행, 임의 파일은 비공개', async (t) => {
  const f = await fixture(t, { basePath: '/pmcanvas' }),
    c = await f.login('owner@example.com');
  assert.match(c.cookie, /pmcanvas_session/);
  assert.equal((await f.call(c, 'projects')).status, 200);
  const origin = f.base.replace('/pmcanvas/api/', '');
  assert.equal((await fetch(origin + '/pmcanvas/')).status, 200);
  assert.equal((await fetch(origin + '/pmcanvas/api-client.js')).status, 200);
  assert.equal((await fetch(origin + '/pmcanvas/server/main.mjs')).status, 404);
  assert.equal((await fetch(origin + '/api/projects')).status, 404);
});

networkTest('회원가입 HTTP: 세션 없는 접수·승인 전 로그인 차단·승인 후 로그인', async (t) => {
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
    c = f.client(),
    body = {
      name: '가입 통신 검증',
      email: 'network@example.com',
      password: PASSWORD,
      confirmPassword: PASSWORD,
    };
  const applied = await f.call(c, 'auth/register', { method: 'POST', body });
  assert.equal(applied.status, 202);
  assert.equal(applied.headers.get('set-cookie'), null);
  assert.equal(
    (await f.call(c, 'auth/login', { method: 'POST', body })).data.error.code,
    'EMAIL_UNVERIFIED',
  );
  await f.registrationEmail.idle();
  const proof = new URL(messages[0].url).hash.slice('#verify-email='.length);
  assert.equal(
    (
      await f.call(c, 'auth/verify-email', {
        method: 'POST',
        body: { token: proof, name: body.name, newPassword: PASSWORD, confirmPassword: PASSWORD },
      })
    ).status,
    200,
  );
  assert.equal(
    (await f.call(c, 'auth/login', { method: 'POST', body })).data.error.code,
    'APPROVAL_PENDING',
  );
  const admin = await f.login('owner@example.com'),
    user = await f.repo.findUserByEmail(body.email);
  assert.equal(
    (await f.call(admin, 'users/' + user.id, { method: 'PATCH', body: { isActive: true } })).status,
    200,
  );
  const logged = await f.call(c, 'auth/login', { method: 'POST', body });
  assert.equal(logged.status, 200);
  assert.match(logged.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await f.call(c, 'auth/me')).data.user.email, body.email);
});

networkTest(
  '가입 이메일 HTTP·TLS SMTP: 인증 메일 수신·승인 전 차단·승인 알림 한 번 전달',
  async (t) => {
    const smtp = await smtpFixture();
    t.after(() => smtp.close());
    const f = await fixture(t, {
        basePath: '/pmcanvas',
        mailSettingsFactory: (repo) =>
          new MailSettings({
            repo,
            key: Buffer.alloc(32, 19),
            makeMailer: (config) =>
              createMailer({
                ...config,
                transport: {
                  ...config.transport,
                  tls: { ...config.transport.tls, ca: smtp.ca, servername: 'localhost' },
                },
              }),
          }),
      }),
      admin = await f.login('owner@example.com'),
      guest = f.client();
    await f.mailSettings.save(f.users[0].id, {
      revision: 0,
      enabled: true,
      host: '127.0.0.1',
      port: smtp.port,
      secure: true,
      from: 'sender@example.com',
      authEnabled: true,
      username: 'fixture',
      password: 'test-only-secret',
    });
    const email = 'new-network@example.com';
    assert.equal(
      (await f.call(guest, 'auth/register', { method: 'POST', body: { email, name: '가입자' } }))
        .status,
      202,
    );
    await f.registrationEmail.idle();
    assert.equal(smtp.messages.length, 1);
    const link = verificationLink(smtp.messages[0]);
    assert.equal(new URL(link).pathname, '/pmcanvas/');
    assert.equal(new URL(link).search, '');
    assert.ok(mailText(smtp.messages[0]).includes('30분'));
    const u = await f.repo.findUserByEmail(email),
      route = 'users/' + u.id;
    assert.equal(
      (await f.call(admin, route, { method: 'PATCH', body: { isActive: true } })).data.error.code,
      'EMAIL_UNVERIFIED',
    );
    const proof = {
      token: new URL(link).hash.slice('#verify-email='.length),
      name: '인증한 가입자',
      newPassword: PASSWORD,
      confirmPassword: PASSWORD,
    };
    assert.equal(
      (await f.call(guest, 'auth/verify-email', { method: 'POST', body: proof })).status,
      200,
    );
    await f.registrationEmail.idle();
    assert.equal(smtp.messages.length, 2);
    assert.ok(smtp.messages[1].includes('To: owner@example.com'));
    assert.ok(mailText(smtp.messages[1]).includes('인증한 가입자'));
    assert.ok(mailText(smtp.messages[1]).includes(email));
    assert.ok(mailText(smtp.messages[1]).includes('/pmcanvas/#registration-approvals'));
    assert.equal(mailText(smtp.messages[1]).includes(PASSWORD), false);
    assert.equal(
      (await f.call(guest, 'auth/verify-email', { method: 'POST', body: proof })).data.error.code,
      'VERIFICATION_INVALID',
    );
    await f.registrationEmail.idle();
    assert.equal(smtp.messages.length, 2);
    assert.equal(
      (await f.call(guest, 'auth/login', { method: 'POST', body: { email, password: PASSWORD } }))
        .data.error.code,
      'APPROVAL_PENDING',
    );
    assert.equal(
      (await f.call(admin, route, { method: 'PATCH', body: { isActive: true } })).status,
      200,
    );
    await f.registrationEmail.idle();
    assert.equal(smtp.messages.length, 3);
    assert.ok(mailText(smtp.messages[2]).includes('회원가입이 승인되었습니다'));
    assert.equal(mailText(smtp.messages[2]).includes(PASSWORD), false);
    assert.equal(
      (await f.call(guest, 'auth/login', { method: 'POST', body: { email, password: PASSWORD } }))
        .status,
      200,
    );
    await f.call(admin, route, { method: 'PATCH', body: { isActive: true } });
    await f.registrationEmail.idle();
    assert.equal(smtp.messages.length, 3);
  },
);

networkTest(
  '승인 요청 지정 수신자 HTTP·TLS SMTP: 여러 주소 개별 발송·중복 주소 제거·설정 변경 반영',
  async (t) => {
    const smtp = await smtpFixture();
    t.after(() => smtp.close());
    const f = await fixture(t, {
        basePath: '/pmcanvas',
        mailSettingsFactory: (repo) =>
          new MailSettings({
            repo,
            key: Buffer.alloc(32, 27),
            makeMailer: (config) =>
              createMailer({
                ...config,
                transport: {
                  ...config.transport,
                  tls: { ...config.transport.tls, ca: smtp.ca, servername: 'localhost' },
                },
              }),
          }),
      }),
      admin = await f.login('owner@example.com'),
      guest = f.client();
    const settings = {
      revision: 0,
      enabled: true,
      host: '127.0.0.1',
      port: smtp.port,
      secure: true,
      from: 'sender@example.com',
      authEnabled: true,
      username: 'fixture',
      password: 'test-only-secret',
      reviewRecipients: 'Inbox@example.com, security@example.com\ninbox@example.com',
    };
    const saved = await f.call(admin, 'admin/mail-settings', { method: 'PUT', body: settings });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.data.settings.reviewRecipients, [
      'inbox@example.com',
      'security@example.com',
    ]);
    assert.equal((await f.call(guest, 'admin/mail-settings')).status, 401);
    const publicPolicy = await f.call(guest, 'auth/providers');
    assert.equal(JSON.stringify(publicPolicy.data).includes('inbox@example.com'), false);
    const email = 'custom-review@example.com';
    await f.call(guest, 'auth/register', { method: 'POST', body: { email, name: '신청자' } });
    await f.registrationEmail.idle();
    const proof = {
      token: new URL(verificationLink(smtp.messages[0])).hash.slice('#verify-email='.length),
      name: '본인',
      newPassword: PASSWORD,
      confirmPassword: PASSWORD,
    };
    assert.equal(
      (await f.call(guest, 'auth/verify-email', { method: 'POST', body: proof })).status,
      200,
    );
    await f.registrationEmail.idle();
    assert.equal(smtp.messages.length, 3);
    assert.ok(smtp.messages[1].includes('To: inbox@example.com'));
    assert.ok(smtp.messages[2].includes('To: security@example.com'));
    assert.equal(smtp.messages[1].includes('security@example.com'), false);
    assert.equal(smtp.messages[2].includes('inbox@example.com'), false);
    await f.call(admin, 'admin/mail-settings', {
      method: 'PUT',
      body: { ...settings, revision: 1, password: '', reviewRecipients: 'new@example.com' },
    });
    f.registrationEmail.notify();
    await f.registrationEmail.idle();
    assert.equal(smtp.messages.length, 4);
    assert.ok(smtp.messages[3].includes('To: new@example.com'));
    const u = await f.repo.findUserByEmail(email);
    assert.equal(u.registration_pending, true);
    assert.equal(u.is_active, false);
  },
);

networkTest(
  '이메일 재설정 HTTP·TLS SMTP: 실제 메일 수신·링크 사용·새 비밀번호 로그인',
  async (t) => {
    const smtp = await smtpFixture();
    t.after(() => smtp.close());
    const mailer = createMailer({
      from: 'sender@example.com',
      transport: {
        host: '127.0.0.1',
        port: smtp.port,
        secure: true,
        auth: { user: 'fixture', pass: 'test-only-secret' },
        tls: { ca: smtp.ca, servername: 'localhost', rejectUnauthorized: true },
        connectionTimeout: 2000,
        socketTimeout: 3000,
        disableFileAccess: true,
        disableUrlAccess: true,
      },
    });
    t.after(() => mailer.close());
    await mailer.verify();
    const f = await fixture(t, { basePath: '/pmcanvas', mailer }),
      guest = f.client();
    const response = await f.call(guest, 'auth/forgot-password', {
      method: 'POST',
      body: { email: 'other@example.com' },
    });
    assert.equal(response.status, 202);
    await f.reset.idle();
    assert.equal(smtp.messages.length, 1);
    const link = resetLink(smtp.messages[0]);
    assert.equal(new URL(link).pathname, '/pmcanvas/');
    assert.equal(new URL(link).search, '');
    const value = new URL(link).hash.slice('#reset-password='.length),
      body = {
        token: value,
        newPassword: 'network-reset-password-123',
        confirmPassword: 'network-reset-password-123',
      };
    assert.equal(
      (await f.call(guest, 'auth/reset-password', { method: 'POST', body })).status,
      200,
    );
    assert.equal(
      (
        await f.call(guest, 'auth/login', {
          method: 'POST',
          body: { email: 'other@example.com', password: body.newPassword },
        })
      ).status,
      200,
    );
    assert.equal(
      (await f.call(guest, 'auth/reset-password', { method: 'POST', body })).data.error.code,
      'RESET_INVALID',
    );
  },
);

networkTest('SMTP STARTTLS 거절 시 평문 인증으로 전환하지 않는다', async (t) => {
  const commands = [],
    sockets = new Set(),
    server = netServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => {});
      socket.setEncoding('utf8');
      socket.write('220 localhost test\r\n');
      let buffer = '';
      socket.on('data', (chunk) => {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf('\r\n')) !== -1) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          commands.push(line);
          socket.write(
            line.startsWith('EHLO')
              ? '250-localhost\r\n250 AUTH PLAIN\r\n'
              : '502 STARTTLS not available\r\n',
          );
        }
      });
    });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(resolve);
      }),
  );
  const mailer = createMailer({
    from: 'sender@example.com',
    transport: {
      host: '127.0.0.1',
      port: server.address().port,
      secure: false,
      requireTLS: true,
      auth: { user: 'fixture', pass: 'test-only-secret' },
      connectionTimeout: 2000,
      socketTimeout: 2000,
    },
  });
  t.after(() => mailer.close());
  await assert.rejects(mailer.verify());
  assert.ok(commands.some((c) => c === 'STARTTLS'));
  assert.equal(
    commands.some((c) => c.startsWith('AUTH')),
    false,
  );
});

networkTest('관리자 SMTP 저장·테스트 메일 실제 TLS 수신·비밀번호 재설정에 즉시 사용', async (t) => {
  const smtp = await smtpFixture();
  t.after(() => smtp.close());
  const makeMailer = (config) =>
    createMailer({
      ...config,
      transport: {
        ...config.transport,
        tls: { ...config.transport.tls, ca: smtp.ca, servername: 'localhost' },
      },
    });
  const f = await fixture(t, {
      basePath: '/pmcanvas',
      mailSettingsFactory: (repo) =>
        new MailSettings({ repo, key: Buffer.alloc(32, 5), makeMailer }),
    }),
    admin = await f.login('owner@example.com');
  const settings = {
    revision: 0,
    enabled: true,
    host: '127.0.0.1',
    port: smtp.port,
    secure: true,
    from: 'sender@example.com',
    authEnabled: true,
    username: 'fixture',
    password: 'test-only-secret',
  };
  assert.equal(
    (await f.call(admin, 'admin/mail-settings', { method: 'PUT', body: settings })).status,
    200,
  );
  assert.equal(
    (
      await f.call(admin, 'admin/mail-settings/test', {
        method: 'POST',
        body: { to: 'receiver@example.com' },
      })
    ).status,
    200,
  );
  assert.equal(smtp.messages.length, 1);
  assert.equal(resetLink(smtp.messages[0]), undefined);
  assert.match(smtp.messages[0], /To: receiver@example.com/);
  const guest = f.client();
  assert.equal(
    (
      await f.call(guest, 'auth/forgot-password', {
        method: 'POST',
        body: { email: 'other@example.com' },
      })
    ).status,
    202,
  );
  await f.reset.idle();
  assert.equal(smtp.messages.length, 2);
  assert.ok(resetLink(smtp.messages[1]));
  const disabled = await f.call(admin, 'admin/mail-settings', {
    method: 'PUT',
    body: { ...settings, password: '', enabled: false, revision: 1 },
  });
  assert.equal(disabled.status, 200);
  assert.equal((await f.call(guest, 'auth/providers')).data.passwordReset.enabled, false);
});
