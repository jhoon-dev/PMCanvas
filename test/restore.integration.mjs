import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createPool, migrate, PgRepository } from '../server/postgres.mjs';
import { createApplication } from '../server/http.mjs';
import { AdminMfa, totp } from '../server/admin-mfa.mjs';
import { MailSettings } from '../server/mail-settings.mjs';
import { createMailer } from '../server/mailer.mjs';
import { hashPassword } from '../server/security.mjs';
import { restoreCleanupSql } from '../server/restore-safety.mjs';
import { today } from '../public/engine.js';
import { screenProject } from './support/screen-fixtures.mjs';
import { smtpFixture } from './support/smtp-fixture.mjs';

const execute = promisify(execFile);
const origin = 'http://localhost:3000';
test(
  '실제 복원: 로그인·MFA·SMTP 복호화/TLS 발송·완료 기록·공유 권한·이전 인증 무효화',
  {
    skip: process.env.RUN_RESTORE_TESTS !== '1',
    timeout: 120000,
  },
  async () => {
    if (
      !/_test$/.test(process.env.PGDATABASE || '') ||
      !['localhost', '127.0.0.1', '::1', 'db'].includes(process.env.PGHOST || '127.0.0.1')
    )
      throw Error('Recovery rehearsal requires a local dedicated _test database.');
    const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
    const source = `pmcanvas_rehearsal_source_${suffix}_test`,
      target = `pmcanvas_rehearsal_target_${suffix}_test`;
    const created = [],
      pools = [],
      services = [];
    const key = randomBytes(32),
      password = 'restore-fixture-password';
    const coordinator = await createPool();
    let directory, smtp;
    const start = async (pool, encryptionKey = key) => {
      const repo = new PgRepository(pool);
      const mailer = new MailSettings({
        repo,
        key: encryptionKey,
        makeMailer: (config) =>
          createMailer({
            ...config,
            transport: {
              ...config.transport,
              tls: { ca: smtp.ca, servername: 'localhost', rejectUnauthorized: true },
            },
          }),
      });
      const server = createApplication({
        repo,
        origin,
        basePath: '/pmcanvas',
        adminMfa: new AdminMfa(repo, encryptionKey),
        mailSettings: mailer,
        logger: { error() {} },
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const service = {
        server,
        base: `http://127.0.0.1:${server.address().port}/pmcanvas/api/`,
        mailer,
      };
      services.push(service);
      return service;
    };
    const call = async (service, client, resource, method = 'GET', body) => {
      const r = await fetch(service.base + resource, {
        method,
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          ...(client.cookie ? { Cookie: client.cookie } : {}),
          ...(client.csrf ? { 'X-CSRF-Token': client.csrf } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await r.json();
      if (r.ok && data.csrf) {
        client.csrf = data.csrf;
        client.cookie = r.headers.get('set-cookie')?.split(';')[0] ?? client.cookie;
      }
      return { status: r.status, data };
    };
    try {
      directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pmcanvas-recovery-'));
      smtp = await smtpFixture();
      await coordinator.query(`CREATE DATABASE "${source}"`);
      created.push(source);
      const sourcePool = await createPool({ ...process.env, PGDATABASE: source });
      pools.push(sourcePool);
      await migrate(sourcePool);
      const repo = new PgRepository(sourcePool),
        passwordHash = await hashPassword(password);
      await repo.createUser({
        email: 'admin@restore.example',
        name: '복원 관리자',
        passwordHash,
        isAdmin: true,
      });
      await repo.createUser({
        email: 'viewer@restore.example',
        name: '복원 조회자',
        passwordHash,
        isAdmin: false,
      });
      const original = await start(sourcePool),
        admin = {};
      const begun = await call(original, admin, 'auth/login', 'POST', {
        email: 'admin@restore.example',
        password,
      });
      assert.equal(begun.status, 200);
      assert.equal(begun.data.enrollment, true);
      const secret = begun.data.secret;
      const enrolled = await call(original, admin, 'auth/mfa/verify', 'POST', {
        challenge: begun.data.challenge,
        code: totp(secret, Math.floor(Date.now() / 30000) - 1),
      });
      assert.equal(enrolled.status, 200);
      assert.ok(admin.cookie);
      const oldRecovery = enrolled.data.recoveryCodes[0];
      const oldSession = { ...admin };
      const p = { ...screenProject(), id: randomUUID(), name: '복원 전용 업무' };
      delete p._revision;
      delete p._role;
      p.tasks[0].items[0].doneDate = today();
      const saved = await call(original, admin, 'projects', 'POST', { project: p });
      assert.equal(saved.status, 201);
      assert.equal(
        (
          await call(original, admin, `projects/${p.id}/access`, 'POST', {
            email: 'viewer@restore.example',
            role: 'viewer',
          })
        ).status,
        200,
      );
      const settings = await original.mailer.public();
      assert.equal(
        (
          await call(original, admin, 'admin/mail-settings', 'PUT', {
            ...settings,
            enabled: true,
            host: '127.0.0.1',
            port: smtp.port,
            secure: true,
            authEnabled: true,
            username: 'fixture',
            password: 'test-only-secret',
            from: 'sender@example.com',
          })
        ).status,
        200,
      );
      const encrypted = await repo.getMailSettings();
      assert.equal(JSON.stringify(encrypted).includes('test-only-secret'), false);
      const oldChallenge = (
        await call(original, {}, 'auth/login', 'POST', { email: 'admin@restore.example', password })
      ).data.challenge;
      const dump = path.join(directory, 'fixture.dump');
      await execute('pg_dump', ['-Fc', '--file', dump], {
        env: { ...process.env, PGDATABASE: source },
        timeout: 60000,
      });
      await coordinator.query(`CREATE DATABASE "${target}"`);
      created.push(target);
      await execute(
        'pg_restore',
        [
          '--no-owner',
          '--no-acl',
          '--exit-on-error',
          '--single-transaction',
          '--dbname',
          target,
          dump,
        ],
        { env: process.env, timeout: 60000 },
      );
      const restoredPool = await createPool({ ...process.env, PGDATABASE: target });
      pools.push(restoredPool);
      await restoredPool.query(restoreCleanupSql);
      const restored = await start(restoredPool),
        user = {};
      assert.equal((await call(restored, oldSession, 'auth/me')).status, 401);
      assert.equal(
        (
          await call(restored, {}, 'auth/mfa/verify', 'POST', {
            challenge: oldChallenge,
            code: totp(secret),
          })
        ).status,
        401,
      );
      const login = await call(restored, user, 'auth/login', 'POST', {
        email: 'admin@restore.example',
        password,
      });
      assert.equal(login.status, 200);
      assert.equal(login.data.enrollment, false);
      assert.equal(
        (
          await call(restored, user, 'auth/mfa/verify', 'POST', {
            challenge: login.data.challenge,
            code: oldRecovery,
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await call(restored, user, 'auth/mfa/verify', 'POST', {
            challenge: login.data.challenge,
            code: totp(secret),
          })
        ).status,
        200,
      );
      const work = await call(restored, user, `projects/${p.id}`);
      assert.equal(work.status, 200);
      assert.equal(work.data.project.tasks[0].items[0].doneDate, p.tasks[0].items[0].doneDate);
      assert.equal(work.data.project.tasks[0].name, p.tasks[0].name);
      const testMail = await call(restored, user, 'admin/mail-settings/test', 'POST', {
        to: 'receiver@example.com',
      });
      assert.equal(testMail.status, 200);
      assert.equal(smtp.messages.length, 1);
      assert.match(smtp.messages[0], /receiver@example\.com/);
      const wrongKey = new MailSettings({
        repo: new PgRepository(restoredPool),
        key: randomBytes(32),
      });
      await assert.rejects(wrongKey.current(), (e) => e.code === 'MAIL_KEY');
      const viewer = {};
      assert.equal(
        (
          await call(restored, viewer, 'auth/login', 'POST', {
            email: 'viewer@restore.example',
            password,
          })
        ).status,
        200,
      );
      const read = await call(restored, viewer, `projects/${p.id}`);
      assert.equal(read.status, 200);
      assert.equal(read.data.project._role, 'viewer');
      assert.equal(
        (
          await call(restored, viewer, `projects/${p.id}`, 'PUT', {
            revision: read.data.project._revision,
            project: read.data.project,
          })
        ).status,
        403,
      );
    } finally {
      for (const service of services) {
        service.server.closeAllConnections();
        await new Promise((resolve) => service.server.close(resolve));
        service.mailer.close();
      }
      for (const pool of pools) await pool.end();
      if (smtp) await smtp.close();
      for (const name of created.reverse()) {
        if (!/^pmcanvas_rehearsal_(?:source|target)_[a-f0-9]{16}_test$/.test(name))
          throw Error('Unsafe rehearsal cleanup target.');
        await coordinator.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      }
      await coordinator.end();
      if (directory) await fs.rm(directory, { recursive: true, force: true });
    }
  },
);
