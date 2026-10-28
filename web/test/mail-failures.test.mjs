import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMailFailure } from '../server/mail-failures.mjs';
import { MailSettings } from '../server/mail-settings.mjs';
import { createMailer } from '../server/mailer.mjs';
import { MemoryRepository } from './support/memory-repository.mjs';
import { alertsBody } from '../public/alerts-ui.js';

test('메일 분류는 연결·TLS·인증·명확한 수신자 거부를 구분하고 원문을 보관하지 않음', () => {
  const cases = [
    [
      {
        code: 'EENVELOPE',
        command: 'RCPT TO',
        responseCode: 550,
        response: '550 5.1.7 bad sender',
      },
      'other',
    ],
    [
      {
        code: 'EENVELOPE',
        command: 'RCPT TO',
        responseCode: 552,
        response: '552 5.2.3 message too large',
      },
      'other',
    ],
    [{ code: 'ECONNECTION' }, 'connection'],
    [{ code: 'EDNS' }, 'connection'],
    [{ code: 'ETIMEDOUT' }, 'connection'],
    [{ responseCode: 421, command: 'RCPT TO' }, 'connection'],
    [{ code: 'ETLS' }, 'tls'],
    [{ code: 'ESOCKET', originalCode: 'CERT_HAS_EXPIRED' }, 'tls'],
    [{ code: 'ESOCKET', cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' } }, 'tls'],
    [{ code: 'ESOCKET', originalCode: 'ERR_SSL_WRONG_VERSION_NUMBER' }, 'tls'],
    [{ code: 'EAUTH' }, 'auth'],
    [{ code: 'EENVELOPE', responseCode: 530 }, 'auth'],
    [{ command: 'AUTH PLAIN', responseCode: 454 }, 'auth'],
    [
      {
        code: 'EENVELOPE',
        command: 'RCPT TO',
        responseCode: 550,
        response: '550 5.1.1 unknown private@example.com',
      },
      'recipient',
    ],
    [
      {
        code: 'EENVELOPE',
        command: 'RCPT TO',
        responseCode: 552,
        response: '552 5.2.2 mailbox full',
      },
      'recipient',
    ],
    [
      {
        code: 'EENVELOPE',
        command: 'MAIL FROM',
        responseCode: 550,
        response: '550 5.1.7 sender refused',
      },
      'other',
    ],
    [
      {
        code: 'EENVELOPE',
        command: 'RCPT TO',
        responseCode: 550,
        response: '550 5.7.1 relay denied',
      },
      'other',
    ],
    [
      {
        code: 'EENVELOPE',
        command: 'RCPT TO',
        responseCode: 450,
        response: '450 4.1.1 temporary failure',
      },
      'other',
    ],
    [
      { code: 'EENVELOPE', command: 'RCPT TO', responseCode: 550, response: '550 refused' },
      'other',
    ],
    [{}, 'other'],
  ];
  for (const [error, category] of cases) {
    const result = classifyMailFailure(
      { ...error, message: 'private password must not leak' },
      'sendReset',
    );
    assert.equal(result.category, category);
    assert.deepEqual(Object.keys(result).sort(), ['category', 'method', 'responseCode']);
    assert.doesNotMatch(JSON.stringify(result), /private|password|@/);
  }
});

test('수신자 거부는 기록·집계만 남기고 인증·정책 실패는 운영 알림에 별도 반영', async () => {
  const repo = new MemoryRepository();
  let error;
  const settings = new MailSettings({
    repo,
    key: Buffer.alloc(32, 3),
    legacy: {
      config: {
        enabled: true,
        host: 'localhost',
        port: 465,
        secure: true,
        from: 'sender@example.com',
        authEnabled: false,
      },
      password: '',
    },
    makeMailer: () => ({
      sendReset: async () => {
        throw error;
      },
      close() {},
    }),
  });
  for (const e of [
    {
      code: 'EENVELOPE',
      command: 'RCPT TO',
      responseCode: 550,
      response: '550 5.1.1 private@example.com',
    },
    { code: 'EAUTH', responseCode: 535 },
    {
      code: 'EENVELOPE',
      command: 'RCPT TO',
      responseCode: 550,
      response: '550 5.7.1 policy denied',
    },
  ]) {
    error = Object.assign(Error('private password'), e);
    await assert.rejects(
      settings.sendReset({ to: 'receiver@example.com', url: 'https://example.com' }),
    );
  }
  const state = await repo.operationAlerts();
  assert.equal(state.alerts.find((a) => a.kind === 'mail').occurrences, 2);
  assert.equal(state.mailFailures.find((row) => row.category === 'recipient').occurrences, 1);
  const events = await repo.securityEvents();
  assert.equal(events.filter((e) => e.kind === 'mail.delivery.failed').length, 3);
  assert.doesNotMatch(JSON.stringify(events), /private|password|receiver@/);
});

test('SMTP 반환값의 구조화된 수신 거부 오류를 보존하고 알림 화면 상세는 이스케이프', async () => {
  const error = Object.assign(Error('sensitive response'), {
    code: 'EENVELOPE',
    command: 'RCPT TO',
    responseCode: 550,
    response: '550 5.1.1 no mailbox',
  });
  const mailer = createMailer(
    { from: 'sender@example.com', transport: {} },
    {
      createTransport: () => ({
        sendMail: async () => ({
          accepted: [],
          rejected: ['receiver@example.com'],
          rejectedErrors: [error],
        }),
      }),
    },
  );
  await assert.rejects(
    mailer.sendReset({ to: 'receiver@example.com', url: 'https://example.com' }),
    (e) => e === error,
  );
  const html = alertsBody({
    settings: { enabled: false, recipients: [] },
    alerts: [],
    mailFailures: [{ category: 'recipient', occurrences: 1, lastAt: '<img src=x>' }],
  });
  assert.match(html, /수신자 거부/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img/);
});
