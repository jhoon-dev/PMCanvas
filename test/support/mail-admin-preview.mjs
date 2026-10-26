// Disposable administrator UI verification. TLS mail is received on loopback only.
if (process.env.RUN_MAIL_ADMIN_PREVIEW !== '1') throw Error('Set RUN_MAIL_ADMIN_PREVIEW=1.');
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { MemoryRepository } from './memory-repository.mjs';
import { smtpFixture, verificationLink, mailText } from './smtp-fixture.mjs';
import { createMailer } from '../../server/mailer.mjs';
import { MailSettings } from '../../server/mail-settings.mjs';
import { RegistrationEmail } from '../../server/registration.mjs';
import { PasswordReset } from '../../server/password-reset.mjs';
import { AdminMfa } from '../../server/admin-mfa.mjs';
import { createApplication } from '../../server/http.mjs';
import { hashPassword } from '../../server/security.mjs';
const smtp = await smtpFixture(),
  key = Buffer.alloc(32, 7),
  hash = await hashPassword('preview-admin-password'),
  repo = new MemoryRepository([
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
  ]);
const makeMailer = (config) =>
  createMailer({
    ...config,
    transport: {
      ...config.transport,
      tls: { ...config.transport.tls, ca: smtp.ca, servername: 'localhost' },
    },
  });
if (process.env.RUN_WORKSPACE_PREVIEW === '1') {
  const admin = [...repo.users.values()].find((u) => u.is_admin),
    member = [...repo.users.values()].find((u) => !u.is_admin);
  for (const [name, verified] of [
    ['인증 완료 신청자', true],
    ['인증 대기 신청자', false],
  ]) {
    const u = await repo.createUser({
      email: verified ? 'verified@example.com' : 'unverified@example.com',
      name,
      passwordHash: hash,
      registrationPending: true,
    });
    if (verified) repo.users.get(u.id).email_verified_at = new Date();
  }
  const p = await repo.createProject(admin.id, randomUUID(), {
    name: '운영 기능 검증 프로젝트',
    description: '일회용 테스트',
    holidays: [],
    members: [{ id: 'm1', name: '담당자', role: '개발', grade: '중급', hours: 8, allocation: 100 }],
    tasks: [
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
  });
  await repo.grantAccess(admin.id, p.id, member.email, 'editor');
  await repo.setMemberAccount(admin.id, p.id, { memberId: 'm1', userId: admin.id });
}
const mailSettings = new MailSettings({ repo, key, makeMailer }),
  origin = 'http://localhost:4183',
  basePath = '/pmcanvas',
  passwordReset = new PasswordReset({ repo, mailer: mailSettings, origin, basePath });
if (process.env.RUN_REGISTRATION_REVIEW_PREVIEW === '1')
  await mailSettings.save([...repo.users.values()].find((u) => u.is_admin).id, {
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
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(
      JSON.stringify({
        port: smtp.port,
        count: smtp.messages.length,
        links: smtp.messages.map(verificationLink).filter(Boolean),
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
app.listen(4183, '127.0.0.1');
mailbox.listen(4182, '127.0.0.1');
console.log('Disposable SMTP admin preview: ' + origin + basePath + '/');
async function stop() {
  app.closeAllConnections();
  mailbox.closeAllConnections();
  app.close();
  mailbox.close();
  await registrationEmail.close();
  await passwordReset.idle();
  await smtp.close();
  process.exit(0);
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
setTimeout(stop, 10 * 60 * 1000).unref();
