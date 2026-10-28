// Disposable administrator UI verification. TLS mail is received on loopback only.
if (process.env.RUN_MAIL_ADMIN_PREVIEW !== '1') throw Error('Set RUN_MAIL_ADMIN_PREVIEW=1.');
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { MemoryRepository } from './memory-repository.mjs';
import { createPool, migrate, PgRepository } from '../../server/postgres.mjs';
import { smtpFixture, verificationLink, mailText } from './smtp-fixture.mjs';
import { createMailer } from '../../server/mailer.mjs';
import { MailSettings } from '../../server/mail-settings.mjs';
import { RegistrationEmail } from '../../server/registration.mjs';
import { PasswordReset } from '../../server/password-reset.mjs';
import { AdminMfa } from '../../server/admin-mfa.mjs';
import { createApplication } from '../../server/http.mjs';
import { hashPassword } from '../../server/security.mjs';
import { escapeHtml } from '../../public/html.js';
import { cleanProject } from '../../server/project.mjs';
const walkthrough = process.env.RUN_WALKTHROUGH_PREVIEW === '1';
const previewPort = Number(process.env.PM_PREVIEW_PORT || 4183),
  mailboxPort = Number(process.env.PM_PREVIEW_MAIL_PORT || 4182);
const smtp = await smtpFixture(),
  key = Buffer.alloc(32, 7),
  hash = await hashPassword('preview-admin-password'),
  users = [
    {
      id: randomUUID(),
      email: 'admin@example.com',
      name: '테스트 관리자',
      password_hash: hash,
      is_admin: true,
      is_active: true,
    },
    {
      id: randomUUID(),
      email: 'member@example.com',
      name: '테스트 일반 계정',
      password_hash: hash,
      is_admin: false,
      is_active: true,
    },
  ];
let pool, repo;
if (process.env.RUN_E2E_POSTGRES === '1') {
  if (
    process.env.PGDATABASE !== 'pmcanvas_e2e_test' ||
    !['localhost', '127.0.0.1'].includes(process.env.PGHOST)
  )
    throw Error('A local, dedicated pmcanvas_e2e_test database is required.');
  pool = await createPool();
  await migrate(pool);
  repo = new PgRepository(pool);
  if (await repo.countUsers()) throw Error('The browser fixture database must be empty.');
  for (const u of users)
    await repo.createUser({
      email: u.email,
      name: u.name,
      passwordHash: u.password_hash,
      isAdmin: u.is_admin,
    });
} else repo = new MemoryRepository(users);
const adminUser = await repo.findUserByEmail('admin@example.com');
const memberUser = await repo.findUserByEmail('member@example.com');
const makeMailer = (config) =>
  createMailer({
    ...config,
    transport: {
      ...config.transport,
      tls: { ...config.transport.tls, ca: smtp.ca, servername: 'localhost' },
    },
  });
if (process.env.RUN_WORKSPACE_PREVIEW === '1') {
  const admin = adminUser,
    member = memberUser;
  for (const [name, verified] of walkthrough
    ? []
    : [
        ['인증 완료 신청자', true],
        ['인증 대기 신청자', false],
      ]) {
    const u = await repo.createUser({
      email: verified ? 'verified@example.com' : 'unverified@example.com',
      name,
      passwordHash: hash,
      registrationPending: true,
    });
    if (verified) {
      if (pool) await pool.query('UPDATE pm_users SET email_verified_at=now() WHERE id=$1', [u.id]);
      else repo.users.get(u.id).email_verified_at = new Date();
    }
  }
  const p = await repo.createProject(
    admin.id,
    randomUUID(),
    cleanProject({
      name: walkthrough ? '우리 팀 첫 프로젝트' : '운영 기능 검증 프로젝트',
      description: '일회용 테스트',
      holidays: [],
      members: [
        { id: 'm1', name: '담당자', role: '개발', grade: '중급', hours: 8, allocation: 100 },
      ],
      tasks: walkthrough
        ? []
        : [
            {
              id: 't1',
              name: '내 담당 업무',
              phase: '개발',
              owner: 'm1',
              start: '2026-10-19',
              end: '2026-10-30',
              predecessor: '',
              memo: '',
              items: [{ id: 'i1', title: '완료 체크', hours: 8, doneDate: null }],
            },
          ],
    }),
  );
  await repo.grantAccess(admin.id, p.id, member.email, 'editor');
  await repo.setMemberAccount(admin.id, p.id, { memberId: 'm1', userId: admin.id });
}
const mailSettings = new MailSettings({ repo, key, makeMailer }),
  origin = 'http://localhost:' + previewPort,
  basePath = '/pmcanvas',
  passwordReset = new PasswordReset({ repo, mailer: mailSettings, origin, basePath });
if (process.env.RUN_REGISTRATION_REVIEW_PREVIEW === '1')
  await mailSettings.save(adminUser.id, {
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
const registrationEmail = new RegistrationEmail({ repo, mailer: mailSettings, origin, basePath });
registrationEmail.start();
const app = createApplication({
    repo,
    origin,
    basePath,
    passwordReset,
    registrationEmail,
    mailSettings,
    adminMfa: new AdminMfa(repo, key),
  }),
  mailbox = http.createServer((req, res) => {
    if (req.url === '/inbox' && walkthrough) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'",
      );
      res.end(
        `<!doctype html>
        <html lang="ko">
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>PMCanvas 데모 메일함</title>
        <style>
          body {
            font: 16px system-ui;
            max-width: 900px;
            margin: 48px auto;
            padding: 24px;
            background: #f5f7fb;
            color: #18263c;
          }
          article {
            background: white;
            border: 1px solid #dce3ee;
            border-radius: 12px;
            padding: 24px;
            margin: 20px 0;
          }
          pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; line-height: 1.7; }
          a {
            display: inline-block;
            padding: 12px 18px;
            background: #245bd6;
            color: white;
            border-radius: 8px;
            text-decoration: none;
          }
        </style>
        <h1>데모 메일함</h1>
        <p>실제 외부 메일은 발송하지 않습니다. 새 메일은 화면을 새로고침하면 표시됩니다.</p>${
          smtp.messages
            .slice()
            .reverse()
            .map((m) => {
              const body = mailText(m),
                link =
                  verificationLink(m) ||
                  body.match(/https?:\/\/[^\s<>]+#registration-approvals/)?.[0];
              const action = verificationLink(m) ? '이메일 인증하기' : '가입 승인 요청 열기';
              return `<article>
                <pre>${escapeHtml(body)}</pre>
                ${link ? `<a href="${escapeHtml(link)}">${action}</a>` : ''}
              </article>`;
            })
            .join('') || '<article>아직 도착한 메일이 없습니다.</article>'
        }</html>`,
      );
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(
      JSON.stringify({
        port: smtp.port,
        count: smtp.messages.length,
        links: smtp.messages.map(verificationLink).filter(Boolean),
        verifications: smtp.messages
          .filter((m) => verificationLink(m))
          .map((m) => ({ to: m.match(/^To: (.+)$/im)?.[1].trim(), url: verificationLink(m) })),
        approvalRecipients: smtp.messages
          .filter((m) => mailText(m).includes('회원가입이 승인되었습니다'))
          .map((m) => m.match(/^To: (.+)$/im)?.[1].trim()),
        reviewLinks: smtp.messages
          .map((m) => mailText(m).match(/https?:\/\/[^\s<>]+#registration-approvals/)?.[0])
          .filter(Boolean),
        reviewTo: smtp.messages
          .filter((m) => mailText(m).includes('#registration-approvals'))
          .map((m) => m.match(/^To: (.+)$/im)?.[1].trim()),
        reviewCount: smtp.messages.filter((m) => mailText(m).includes('#registration-approvals'))
          .length,
        approvalCount: smtp.messages.filter((m) =>
          mailText(m).includes('회원가입이 승인되었습니다'),
        ).length,
      }),
    );
  });
app.listen(previewPort, '127.0.0.1');
mailbox.listen(mailboxPort, '127.0.0.1');
console.log('Disposable SMTP admin preview: ' + origin + basePath + '/');
async function stop() {
  app.closeAllConnections();
  mailbox.closeAllConnections();
  app.close();
  mailbox.close();
  await registrationEmail.close();
  await passwordReset.idle();
  await smtp.close();
  await pool?.end();
  process.exit(0);
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
setTimeout(stop, (walkthrough ? 60 : 10) * 60 * 1000).unref();
