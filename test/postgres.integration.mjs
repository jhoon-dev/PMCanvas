import { AdminMfa, totp } from '../server/admin-mfa.mjs';
import { BackupWorker } from '../server/backup-worker.mjs';
import { MailSettings } from '../server/mail-settings.mjs';
import { captureBaseline, setParent } from '../public/planning.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createPool, migrate, PgRepository } from '../server/postgres.mjs';
import { cleanProject } from '../server/project.mjs';
import { hashPassword, token, digest } from '../server/security.mjs';
import { pasteCells, duplicateTasks, reorderTasks, moveSchedule } from '../public/wbs-model.js';
test(
  '실제 PostgreSQL: 운영 알림 설정 충돌·실패 집계·원자 lease·확인 경합과 재시도 제한',
  { skip: process.env.RUN_POSTGRES_TESTS !== '1' },
  async () => {
    if (!/_test$/.test(process.env.PGDATABASE || ''))
      throw Error('Use a dedicated _test database.');
    const pool = await createPool(),
      repo = new PgRepository(pool);
    let admin;
    try {
      await migrate(pool);
      await pool.query('DELETE FROM pm_operation_alerts');
      admin = await repo.createUser({
        email: randomUUID() + '@example.com',
        name: '알림 테스트',
        passwordHash: 'unused',
        isAdmin: true,
      });
      const initial = (await repo.operationAlerts()).settings;
      const outcomes = await Promise.allSettled(
        [0, 1].map(() =>
          repo.saveAlertSettings(admin.id, {
            ...initial,
            enabled: true,
            recipients: ['alerts@example.com'],
          }),
        ),
      );
      assert.equal(outcomes.filter((x) => x.status === 'fulfilled').length, 1);
      await Promise.all(Array.from({ length: 20 }, () => repo.recordOperationFailure('backup')));
      assert.equal((await repo.operationAlerts()).alerts[0].occurrences, 20);
      const claimed = (
        await Promise.all([repo.claimOperationAlert(), repo.claimOperationAlert()])
      ).filter(Boolean);
      assert.equal(claimed.length, 1);
      assert.deepEqual(claimed[0].recipients, ['alerts@example.com']);
      await repo.recordOperationFailure('backup');
      await repo.finishOperationAlert(claimed[0], true);
      let row = (await repo.operationAlerts()).alerts[0];
      assert.equal(row.notified, 20);
      assert.equal(row.occurrences, 21);
      assert.equal(await repo.claimOperationAlert(), null);
      await repo.acknowledgeAlert(admin.id, 'backup', 20);
      row = (await repo.operationAlerts()).alerts[0];
      assert.equal(row.acknowledged, 20);
      assert.equal(row.occurrences, 21);
      for (let i = 0; i < 3; i++) {
        await pool.query("UPDATE pm_operation_alerts SET next_at=now()-interval '1 second'");
        const job = await repo.claimOperationAlert();
        assert.ok(job);
        await repo.finishOperationAlert(job, false);
      }
      await pool.query("UPDATE pm_operation_alerts SET next_at=now()-interval '1 second'");
      assert.equal(await repo.claimOperationAlert(), null);
      await repo.acknowledgeAlert(admin.id, 'backup', 21);
      await repo.recordOperationFailure('backup');
      assert.ok(await repo.claimOperationAlert());
    } finally {
      await pool.query('DELETE FROM pm_operation_alerts');
      await pool.query("UPDATE pm_alert_settings SET enabled=false,recipients='{}'");
      if (admin) await pool.query('DELETE FROM pm_users WHERE id=$1', [admin.id]);
      await pool.end();
    }
  },
);

test(
  '실제 PostgreSQL: WBS 일괄 입력·복제·행 이동·간트 일정 저장과 완료 기록 보존',
  { skip: process.env.RUN_POSTGRES_TESTS !== '1' },
  async () => {
    if (!/_test$/.test(process.env.PGDATABASE || ''))
      throw Error('Use a dedicated _test database.');
    const pool = await createPool(),
      repo = new PgRepository(pool),
      projectId = randomUUID();
    let user;
    try {
      await migrate(pool);
      user = await repo.createUser({
        email: randomUUID() + '@example.com',
        name: 'WBS 검증',
        passwordHash: 'not-used',
      });
      const p = cleanProject({
        name: '표 편집 검증',
        holidays: [],
        members: [
          { id: 'm', name: '개발자', role: '개발', grade: '중급', hours: 8, allocation: 100 },
        ],
        tasks: [
          {
            id: 't',
            name: '완료 업무',
            phase: '기획',
            owner: 'm',
            start: '2026-10-19',
            end: '2026-10-23',
            predecessor: '',
            memo: '',
            items: [{ id: 'i', title: '완료 기록 유지', hours: 8, doneDate: '2026-10-23' }],
          },
        ],
      });
      let saved = await repo.createProject(user.id, projectId, p);
      let edited = pasteCells(
        saved,
        ['t'],
        1,
        0,
        '설계\t설계\t개발자\t2026-10-26\t2026-10-28\t12\t1\t메모\n개발\t개발\t개발자\t2026-10-29\t2026-11-04\t24\t2\t',
      );
      edited = duplicateTasks(edited, ['t']);
      edited = reorderTasks(edited, [edited.tasks.at(-1).id], -1);
      saved = await repo.updateProject(user.id, projectId, cleanProject(edited), saved._revision);
      const design = edited.tasks.find((t) => t.name === '설계');
      edited = moveSchedule(saved, [design.id], 2, { cascade: true });
      saved = await repo.updateProject(user.id, projectId, cleanProject(edited), saved._revision);
      const loaded = await repo.getProject(user.id, projectId);
      assert.equal(loaded._revision, 3);
      assert.deepEqual(
        loaded.tasks.map((t) => t.id),
        edited.tasks.map((t) => t.id),
      );
      assert.equal(loaded.tasks.find((t) => t.id === 't').items[0].doneDate, '2026-10-23');
      assert.equal(loaded.tasks.find((t) => t.name === '완료 업무 (복사)').items[0].doneDate, null);
      assert.equal(loaded.tasks.find((t) => t.name === '설계').start, '2026-10-28');
      assert.equal(loaded.tasks.find((t) => t.name === '개발').start, '2026-11-02');
      assert.ok(
        (await repo.listEvents(user.id, projectId)).some((e) =>
          e.changes.some((c) => c.entity === 'task' && c.action === 'update'),
        ),
      );
    } finally {
      await pool.query('DELETE FROM pm_projects WHERE id=$1', [projectId]);
      if (user) await pool.query('DELETE FROM pm_users WHERE id=$1', [user.id]);
      await pool.end();
    }
  },
);

test(
  '실제 PostgreSQL: 외부 계정 생성·이메일 자동 연결 차단·권한·만료·세션 폐기',
  { skip: process.env.RUN_POSTGRES_TESTS !== '1' },
  async () => {
    if (!/_test$/.test(process.env.PGDATABASE || ''))
      throw Error('Use a dedicated _test database.');
    const pool = await createPool(),
      repo = new PgRepository(pool),
      suffix = randomUUID(),
      ids = [],
      providerKey = 'test:' + suffix;
    try {
      await migrate(pool);
      await migrate(pool);
      const passwordHash = await hashPassword('test-only-password-123');
      const admin = await repo.createUser({
        email: 'admin-' + suffix + '@example.com',
        name: '관리자',
        passwordHash,
        isAdmin: true,
      });
      ids.push(admin.id);
      const local = await repo.createUser({
        email: 'local-' + suffix + '@example.com',
        name: '기존 사용자',
        passwordHash,
      });
      ids.push(local.id);
      const login = async (subject, email, autoProvision = true) => {
        const hash = digest(token());
        const user = await repo.externalSession({
          providerKey,
          subject,
          email,
          name: '외부 사용자',
          autoProvision,
          hash,
          csrf: token(),
          expires: new Date(Date.now() + 60000),
        });
        return { hash, user };
      };
      await assert.rejects(
        login('local-subject', local.email),
        (e) => e.code === 'IDENTITY_UNLINKED',
      );
      await assert.rejects(
        login('missing', 'missing-' + suffix + '@example.com', false),
        (e) => e.code === 'IDENTITY_UNLINKED',
      );
      await assert.rejects(
        repo.linkIdentity(local.id, { providerKey, subject: 'local-subject', email: local.email }),
        (e) => e.status === 403,
      );
      await assert.rejects(
        repo.linkIdentity(admin.id, { providerKey, subject: 'admin-subject', email: admin.email }),
        (e) => e.code === 'ADMIN_PROTECTED',
      );
      await repo.linkIdentity(admin.id, {
        providerKey,
        subject: 'local-subject',
        email: local.email,
      });
      assert.equal((await login('local-subject', local.email)).user.id, local.id);
      await assert.rejects(
        repo.linkIdentity(admin.id, { providerKey, subject: 'local-subject', email: local.email }),
        (e) => e.status === 409,
      );
      const created = await login('new-subject', 'external-' + suffix + '@example.com');
      ids.push(created.user.id);
      assert.equal(created.user.localLogin, false);
      assert.equal(created.user.isAdmin, false);
      assert.equal(
        (await login('new-subject', 'renamed-' + suffix + '@example.com')).user.id,
        created.user.id,
      );
      const external = await repo.findUserByEmail(created.user.email);
      await assert.rejects(
        repo.createSession({
          hash: digest(token()),
          userId: external.id,
          csrf: token(),
          expires: new Date(Date.now() + 60000),
          passwordHash: external.password_hash,
        }),
        (e) => e.status === 401,
      );
      await assert.rejects(
        repo.manageUser(admin.id, external.id, { passwordHash }),
        (e) => e.code === 'EXTERNAL_PASSWORD',
      );
      await repo.manageUser(admin.id, external.id, { isActive: false });
      assert.equal(await repo.findSession(created.hash), null);
      await assert.rejects(
        login('new-subject', created.user.email),
        (e) => e.code === 'ACCOUNT_DISABLED',
      );
      await repo.manageUser(admin.id, external.id, { isActive: true });
      const active = await login('new-subject', created.user.email);
      await repo.unlinkIdentity(admin.id, providerKey, 'new-subject');
      assert.equal(await repo.findSession(active.hash), null);
      assert.ok(
        (await repo.listIdentities()).some(
          (i) => i.providerKey === providerKey && i.subject === 'local-subject',
        ),
      );
      const transient = 'flow:' + suffix;
      await repo.putTransient(transient, { browserHash: 'correct', nonce: 'nonce' });
      assert.equal(await repo.takeTransient(transient, 'incorrect'), null);
      const takes = await Promise.all([
        repo.takeTransient(transient, 'correct'),
        repo.takeTransient(transient, 'correct'),
      ]);
      assert.equal(takes.filter(Boolean).length, 1);
      await repo.putTransient(transient, { browserHash: 'correct' }, -1);
      assert.equal(await repo.takeTransient(transient, 'correct'), null);
    } finally {
      await pool.query('DELETE FROM pm_auth_transient WHERE key=$1', ['flow:' + suffix]);
      for (const id of ids.reverse()) await pool.query('DELETE FROM pm_users WHERE id=$1', [id]);
      await pool.end();
    }
  },
);
test(
  '실제 PostgreSQL: 마이그레이션·FK·트랜잭션·동시성·권한·완료 이력',
  { skip: process.env.RUN_POSTGRES_TESTS !== '1' },
  async (t) => {
    if (!/_test$/.test(process.env.PGDATABASE || ''))
      throw Error('Set PGDATABASE to a dedicated database ending in _test.');
    const pool = await createPool(),
      repo = new PgRepository(pool),
      suffix = randomUUID(),
      projectId = randomUUID();
    const ids = [];
    try {
      await migrate(pool);
      await migrate(pool);
      const user = await repo.createUser({
        email: 'owner-' + suffix + '@example.com',
        name: '소유자',
        passwordHash: 'not-used-in-this-test',
        isAdmin: false,
      });
      ids.push(user.id);
      const other = await repo.createUser({
        email: 'other-' + suffix + '@example.com',
        name: '다른 사용자',
        passwordHash: 'not-used-in-this-test',
      });
      ids.push(other.id);
      const p = cleanProject({
        name: '통합 검증',
        description: '',
        holidays: ['2026-10-26'],
        members: [{ id: 'm', name: '개발', grade: '중급', role: '개발', hours: 8, allocation: 50 }],
        tasks: [
          {
            id: 't',
            name: '업무',
            phase: '개발',
            owner: 'm',
            start: '2026-10-19',
            end: '2026-10-23',
            memo: '',
            items: [{ id: 'i', title: '세부 작업', hours: 8, doneDate: null }],
          },
        ],
      });
      const created = await repo.createProject(user.id, projectId, p);
      assert.equal(created._revision, 1);
      const loaded = await repo.getProject(user.id, projectId);
      assert.equal(loaded.tasks[0].start, '2026-10-19');
      assert.equal(loaded.members[0].allocation, 50);
      assert.equal(loaded.tasks[0].items[0].doneDate, null);
      await assert.rejects(repo.getProject(other.id, projectId), (e) => e.status === 404);
      await repo.grantAccess(user.id, projectId, other.email, 'viewer');
      await assert.rejects(repo.updateProject(other.id, projectId, p, 1), (e) => e.status === 403);
      await repo.grantAccess(user.id, projectId, other.email, 'editor');
      const a = structuredClone(p),
        b = structuredClone(p);
      a.name = 'A';
      b.name = 'B';
      const competing = await Promise.allSettled([
        repo.updateProject(user.id, projectId, a, 1),
        repo.updateProject(other.id, projectId, b, 1),
      ]);
      assert.equal(competing.filter((x) => x.status === 'fulfilled').length, 1);
      assert.equal(competing.find((x) => x.status === 'rejected').reason.status, 409);
      const current = await repo.getProject(user.id, projectId),
        invalid = cleanProject(current);
      invalid.tasks[0].owner = 'missing-member';
      await assert.rejects(
        repo.updateProject(user.id, projectId, invalid, current._revision),
        (e) => e.code === '23503',
      );
      const unchanged = await repo.getProject(user.id, projectId);
      assert.equal(unchanged._revision, current._revision);
      assert.equal(unchanged.tasks[0].owner, 'm');
      const done = cleanProject(unchanged);
      done.tasks[0].items[0].doneDate = '2026-10-23';
      const saved = await repo.updateProject(user.id, projectId, done, unchanged._revision);
      done.tasks[0].items[0].doneDate = null;
      await repo.updateProject(user.id, projectId, done, saved._revision);
      const events = await repo.listEvents(user.id, projectId);
      assert.ok(
        events.some((e) =>
          e.changes.some((c) => c.before?.doneDate === '2026-10-23' && c.after?.doneDate === null),
        ),
      );
      await repo.revokeAccess(user.id, projectId, other.id);
      await assert.rejects(repo.getProject(other.id, projectId), (e) => e.status === 404);
    } finally {
      await pool.query('DELETE FROM pm_projects WHERE id=$1', [projectId]);
      for (const id of ids) await pool.query('DELETE FROM pm_users WHERE id=$1', [id]);
      await pool.end();
    }
  },
);

test(
  '실제 PostgreSQL: 계정 마이그레이션·세션 폐기·비활성화·로그인 경합',
  { skip: process.env.RUN_POSTGRES_TESTS !== '1' },
  async () => {
    if (!/_test$/.test(process.env.PGDATABASE || ''))
      throw Error('Use a dedicated _test database.');
    const pool = await createPool(),
      repo = new PgRepository(pool),
      suffix = randomUUID(),
      ids = [];
    try {
      await migrate(pool);
      await migrate(pool);
      const hash = await hashPassword('original-password-123'),
        next = await hashPassword('updated-password-123');
      const admin = await repo.createUser({
        email: 'admin-' + suffix + '@example.com',
        name: '관리자',
        passwordHash: hash,
        isAdmin: true,
      });
      ids.push(admin.id);
      const user = await repo.createUser({
        email: 'member-' + suffix + '@example.com',
        name: '사용자',
        passwordHash: hash,
      });
      ids.push(user.id);
      assert.equal(user.isActive, true);
      const login = async (passwordHash = hash) => {
        const value = digest(token());
        await repo.createSession({
          hash: value,
          userId: user.id,
          csrf: token(),
          expires: new Date(Date.now() + 60000),
          passwordHash,
        });
        return value;
      };
      const first = await login(),
        second = await login();
      await repo.changePassword(user.id, hash, next);
      assert.equal(await repo.findSession(first), null);
      assert.equal(await repo.findSession(second), null);
      await assert.rejects(login(), (e) => e.status === 401);
      await assert.rejects(repo.changePassword(user.id, hash, next), (e) => e.status === 409);
      const third = await login(next);
      assert.equal((await repo.manageUser(admin.id, user.id, { isActive: false })).isActive, false);
      assert.equal(await repo.findSession(third), null);
      await assert.rejects(login(next), (e) => e.status === 401);
      await assert.rejects(
        repo.manageUser(user.id, admin.id, { isActive: false }),
        (e) => e.status === 403,
      );
      await assert.rejects(
        repo.manageUser(admin.id, admin.id, { isActive: false }),
        (e) => e.status === 403,
      );
      await repo.manageUser(admin.id, user.id, { isActive: true });
      const fourth = await login(next);
      assert.ok(await repo.findSession(fourth));
      await repo.manageUser(admin.id, user.id, { passwordHash: hash });
      assert.equal(await repo.findSession(fourth), null);
      await assert.rejects(login(next), (e) => e.status === 401);
      assert.ok(await repo.findSession(await login()));
    } finally {
      for (const id of ids.reverse()) await pool.query('DELETE FROM pm_users WHERE id=$1', [id]);
      await pool.end();
    }
  },
);

test(
  '실제 PostgreSQL: 계층·기준 계획 저장/재조회·수정 응답·이력 유지',
  { skip: process.env.RUN_POSTGRES_TESTS !== '1' },
  async () => {
    if (!/_test$/.test(process.env.PGDATABASE || ''))
      throw Error('Use a dedicated _test database.');
    const pool = await createPool(),
      repo = new PgRepository(pool),
      id = randomUUID();
    let user;
    try {
      await migrate(pool);
      user = await repo.createUser({
        email: randomUUID() + '@example.com',
        name: '계획 검증',
        passwordHash: 'not-used',
      });
      let p = cleanProject({
        name: '계층',
        description: '',
        holidays: [],
        members: [],
        tasks: ['a', 'b'].map((id) => ({
          id,
          name: id,
          phase: '',
          owner: '',
          start: '2026-10-26',
          end: '2026-10-27',
          predecessor: '',
          memo: '',
          items: [{ id: 'i' + id, title: id, hours: 8, doneDate: null }],
        })),
      });
      p = setParent(p, ['b'], 1);
      p.baseline = captureBaseline(p);
      let saved = await repo.createProject(user.id, id, cleanProject(p));
      assert.equal(saved.tasks[1].parentId, 'a');
      assert.deepEqual(saved.baseline, p.baseline);
      saved.tasks[1].end = '2026-10-28';
      saved = await repo.updateProject(user.id, id, cleanProject(saved), saved._revision);
      assert.equal(saved.tasks[1].parentId, 'a');
      assert.equal(saved.baseline.tasks[1].end, '2026-10-27');
      let loaded = await repo.getProject(user.id, id);
      assert.deepEqual(loaded.baseline, p.baseline);
      assert.equal(loaded.tasks[1].parentId, 'a');
      delete loaded.baseline;
      delete loaded.tasks[1].parentId;
      loaded = await repo.updateProject(user.id, id, cleanProject(loaded), loaded._revision);
      assert.equal(loaded.baseline, undefined);
      assert.equal(loaded.tasks[1].parentId, undefined);
      assert.ok(
        (await repo.listEvents(user.id, id)).some((e) =>
          e.changes.some((c) => c.entity === 'project' && c.after?.baseline === null),
        ),
      );
    } finally {
      await pool.query('DELETE FROM pm_projects WHERE id=$1', [id]);
      if (user) await pool.query('DELETE FROM pm_users WHERE id=$1', [user.id]);
      await pool.end();
    }
  },
);

test(
  '실제 PostgreSQL: 공유 시도 제한·MFA 원자 처리·복구 코드·감사 로그',
  { skip: process.env.RUN_POSTGRES_TESTS !== '1' },
  async () => {
    if (!/_test$/.test(process.env.PGDATABASE || ''))
      throw Error('Use a dedicated _test database.');
    const pool = await createPool(),
      repo = new PgRepository(pool),
      other = new PgRepository(pool),
      key = randomUUID();
    let user;
    try {
      await migrate(pool);
      const attempts = await Promise.allSettled(
        Array.from({ length: 12 }, (_, i) => (i % 2 ? repo : other).reserveAttempt(key, 8, 60000)),
      );
      assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 8);
      assert.equal(attempts.filter((r) => r.status === 'rejected').length, 4);
      user = await repo.createUser({
        email: randomUUID() + '@example.com',
        name: 'MFA 통합 검증',
        passwordHash: 'fixture-hash',
        isAdmin: true,
      });
      const stored = await repo.findUserByEmail(user.email),
        mfa = new AdminMfa(repo, Buffer.alloc(32, 4)),
        challenge = await mfa.begin(stored, null),
        otp = totp(challenge.secret);
      const result = await mfa.finish(challenge.challenge, otp);
      assert.equal(result.recoveryCodes.length, 10);
      await assert.rejects(mfa.finish(challenge.challenge, otp));
      const next = await mfa.begin(stored, null);
      const recoveries = await Promise.allSettled([
        mfa.finish(next.challenge, result.recoveryCodes[0]),
        mfa.finish(next.challenge, result.recoveryCodes[0]),
      ]);
      assert.equal(recoveries.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal((await repo.getMfa(user.id)).recovery_hashes.length, 9);
      await repo.securityEvent({
        actorId: user.id,
        kind: 'test.security.audit',
        details: { action: 'verified' },
      });
      assert.ok(
        (await repo.securityEvents()).some(
          (e) => e.actorId === user.id && e.kind === 'test.security.audit',
        ),
      );
    } finally {
      await pool.query('DELETE FROM pm_auth_attempts WHERE key=$1', [key]);
      if (user) {
        await pool.query('DELETE FROM pm_security_events WHERE actor_id=$1', [user.id]);
        await pool.query("DELETE FROM pm_auth_transient WHERE value->>'userId'=$1", [user.id]);
        await pool.query('DELETE FROM pm_users WHERE id=$1', [user.id]);
      }
      await pool.end();
    }
  },
);

test(
  '실제 PostgreSQL: 가입 신청 중복 원자성·대기 상태 제약·승인 전 세션 금지와 관리자 승인',
  { skip: process.env.RUN_POSTGRES_TESTS !== '1' },
  async () => {
    if (!/_test$/.test(process.env.PGDATABASE || ''))
      throw Error('Use a dedicated _test database.');
    const pool = await createPool(),
      repo = new PgRepository(pool),
      suffix = randomUUID(),
      ids = [];
    try {
      await migrate(pool);
      await migrate(pool);
      const admin = await repo.createUser({
        email: 'admin-' + suffix + '@example.com',
        name: '관리자',
        passwordHash: 'test-hash',
        isAdmin: true,
      });
      ids.push(admin.id);
      assert.equal(admin.registrationPending, false);
      const email = 'pending-' + suffix + '@example.com';
      const results = await Promise.allSettled(
        [0, 1].map(() =>
          repo.createUser({
            email,
            name: '가입 신청',
            passwordHash: 'test-hash',
            registrationPending: true,
          }),
        ),
      );
      for (const result of results) if (result.status === 'fulfilled') ids.push(result.value.id);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'EMAIL_EXISTS');
      const pending = await repo.findUserByEmail(email);
      assert.equal(pending.registration_pending, true);
      assert.equal(pending.is_active, false);
      assert.equal(pending.is_admin, false);
      assert.equal(
        (await repo.listUsers()).find((u) => u.id === pending.id).registrationPending,
        true,
      );
      await assert.rejects(
        pool.query('UPDATE pm_users SET is_active=true WHERE id=$1', [pending.id]),
        (e) => e.code === '23514',
      );
      const session = {
        hash: digest(token()),
        userId: pending.id,
        csrf: token(),
        expires: new Date(Date.now() + 60000),
        passwordHash: 'test-hash',
      };
      await assert.rejects(repo.createSession(session), (e) => e.status === 401);
      await assert.rejects(
        repo.manageUser(pending.id, pending.id, { isActive: true }),
        (e) => e.status === 403,
      );
      await assert.rejects(
        repo.manageUser(admin.id, pending.id, { isActive: true }),
        (e) => e.code === 'EMAIL_UNVERIFIED',
      );
      const verification = digest(token());
      await repo.issueEmailVerification({
        userId: pending.id,
        passwordHash: 'test-hash',
        hash: verification,
        expires: new Date(Date.now() + 60000),
      });
      await repo.consumeEmailVerification(verification, {
        name: '인증한 가입자',
        passwordHash: 'test-hash',
      });
      const approved = await repo.manageUser(admin.id, pending.id, { isActive: true });
      assert.equal(approved.registrationPending, false);
      assert.equal(approved.isActive, true);
      await repo.createSession(session);
      assert.equal((await repo.findSession(session.hash)).user.id, pending.id);
      assert.deepEqual(await repo.listProjects(pending.id), []);
      await repo.manageUser(admin.id, pending.id, { isActive: false });
      assert.equal(await repo.findSession(session.hash), null);
      assert.equal((await repo.findUserByEmail(email)).registration_pending, false);
    } finally {
      for (const id of ids.reverse()) await pool.query('DELETE FROM pm_users WHERE id=$1', [id]);
      await pool.end();
    }
  },
);

test(
  '실제 PostgreSQL: 이메일 인증 원자성·인증 전 활성화 제약·승인 알림 보관·작업 잠금·실패 복구',
  { skip: process.env.RUN_POSTGRES_TESTS !== '1' },
  async () => {
    if (!/_test$/.test(process.env.PGDATABASE || ''))
      throw Error('Use a dedicated _test database.');
    const pool = await createPool(),
      repo = new PgRepository(pool),
      other = new PgRepository(pool),
      ids = [];
    try {
      await migrate(pool);
      await migrate(pool);
      const suffix = randomUUID(),
        admin = await repo.createUser({
          email: 'verify-admin-' + suffix + '@example.com',
          name: '관리자',
          passwordHash: 'original',
          isAdmin: true,
        }),
        u = await repo.createUser({
          email: 'verify-' + suffix + '@example.com',
          name: '가입자',
          passwordHash: 'original',
          registrationPending: true,
        });
      ids.push(admin.id, u.id);
      assert.equal((await repo.findUserByEmail(admin.email)).email_verification_required, false);
      assert.equal((await repo.findUserByEmail(u.email)).email_verification_required, true);
      await assert.rejects(
        pool.query('UPDATE pm_users SET is_active=true,registration_pending=false WHERE id=$1', [
          u.id,
        ]),
        (e) => e.code === '23514',
      );
      const first = digest(token()),
        current = digest(token()),
        input = { userId: u.id, passwordHash: 'original', expires: new Date(Date.now() + 60000) };
      assert.equal(await repo.issueEmailVerification({ ...input, hash: first }), true);
      assert.equal(await repo.issueEmailVerification({ ...input, hash: current }), true);
      await assert.rejects(
        repo.consumeEmailVerification(first, { name: '본인', passwordHash: 'verified-hash' }),
        (e) => e.code === 'VERIFICATION_INVALID',
      );
      const results = await Promise.allSettled(
        [repo, other].map((r) =>
          r.consumeEmailVerification(current, {
            name: '메일 소유자',
            passwordHash: 'verified-hash',
          }),
        ),
      );
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(
        results.find((r) => r.status === 'rejected').reason.code,
        'VERIFICATION_INVALID',
      );
      const verified = await repo.findUserByEmail(u.email);
      assert.equal(verified.password_hash, 'verified-hash');
      assert.ok(verified.email_verified_at);
      assert.equal(verified.is_active, false);
      assert.equal(
        await repo.issueEmailVerification({
          ...input,
          hash: digest(token()),
          passwordHash: 'verified-hash',
        }),
        false,
      );
      const approved = await repo.manageUser(admin.id, u.id, { isActive: true });
      assert.equal(approved.approvalMailStatus, 'pending');
      await repo.manageUser(admin.id, u.id, { isActive: true });
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM pm_approval_notifications WHERE user_id=$1 AND kind='approval'",
            [u.id],
          )
        ).rows[0].n,
        1,
      );
      const claims = await Promise.all([
        repo.claimApprovalNotification(),
        other.claimApprovalNotification(),
      ]);
      assert.equal(claims.filter(Boolean).length, 1);
      const original = claims.find(Boolean);
      assert.equal(original.userId, u.id);
      await pool.query(
        "UPDATE pm_approval_notifications SET available_at=now()-interval '1 second' WHERE user_id=$1",
        [u.id],
      );
      const recovered = await other.claimApprovalNotification();
      assert.notEqual(recovered.lease, original.lease);
      await repo.finishApprovalNotification(u.id, original.lease, true);
      assert.equal(
        (await repo.listUsers()).find((x) => x.id === u.id).approvalMailStatus,
        'sending',
      );
      await repo.finishApprovalNotification(u.id, recovered.lease, false);
      await pool.query(
        "UPDATE pm_approval_notifications SET available_at=now()-interval '1 second' WHERE user_id=$1",
        [u.id],
      );
      const third = await repo.claimApprovalNotification();
      await repo.finishApprovalNotification(u.id, third.lease, false);
      assert.equal(
        (await repo.listUsers()).find((x) => x.id === u.id).approvalMailStatus,
        'failed',
      );
      assert.equal((await repo.findUserByEmail(u.email)).is_active, true);
      await assert.rejects(repo.retryApprovalNotification(u.id, u.id), (e) => e.status === 403);
      await repo.retryApprovalNotification(admin.id, u.id);
      const retried = await repo.claimApprovalNotification();
      await repo.finishApprovalNotification(u.id, retried.lease, true);
      assert.equal((await repo.listUsers()).find((x) => x.id === u.id).approvalMailStatus, 'sent');
      await assert.rejects(
        repo.retryApprovalNotification(admin.id, u.id),
        (e) => e.code === 'NOTICE_UNAVAILABLE',
      );
    } finally {
      for (const id of ids.reverse()) await pool.query('DELETE FROM pm_users WHERE id=$1', [id]);
      await pool.end();
    }
  },
);

test(
  '실제 PostgreSQL: 관리자별 승인 요청 원자 보관·중복 방지·수신 권한·독립 재시도',
  { skip: process.env.RUN_POSTGRES_TESTS !== '1' },
  async () => {
    if (!/_test$/.test(process.env.PGDATABASE || ''))
      throw Error('Use a dedicated _test database.');
    const pool = await createPool(),
      repo = new PgRepository(pool),
      ids = [];
    try {
      await migrate(pool);
      const suffix = randomUUID(),
        add = async (name, isAdmin = false, pending = false) => {
          const u = await repo.createUser({
            email: name + '-' + suffix + '@example.com',
            name,
            passwordHash: 'hash',
            isAdmin,
            registrationPending: pending,
          });
          ids.push(u.id);
          return u;
        };
      const a = await add('admin1', true),
        b = await add('admin2', true),
        disabled = await add('disabled', true),
        u = await add('applicant', false, true);
      await pool.query('UPDATE pm_users SET is_active=false WHERE id=$1', [disabled.id]);
      const hash = digest(token());
      await repo.issueEmailVerification({
        userId: u.id,
        passwordHash: 'hash',
        hash,
        expires: new Date(Date.now() + 60000),
      });
      const results = await Promise.allSettled(
        [0, 1].map(() =>
          repo.consumeEmailVerification(hash, { name: '본인', passwordHash: 'verified' }),
        ),
      );
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM pm_approval_notifications WHERE user_id=$1 AND kind='review'",
            [u.id],
          )
        ).rows[0].n,
        2,
      );
      const claims = await Promise.all([
        repo.claimApprovalNotification(),
        repo.claimApprovalNotification(),
      ]);
      assert.deepEqual(new Set(claims.map((j) => j.recipientId)), new Set([a.id, b.id]));
      assert.ok(
        claims.every(
          (j) => j.kind === 'review' && j.applicantName === '본인' && j.applicantEmail === u.email,
        ),
      );
      assert.equal(await repo.claimApprovalNotification(), null);
      const success = claims.find((j) => j.recipientId === a.id),
        failure = claims.find((j) => j.recipientId === b.id);
      await repo.finishApprovalNotification(u.id, success.lease, true);
      await repo.finishApprovalNotification(u.id, failure.lease, false);
      for (let i = 0; i < 2; i++) {
        await pool.query(
          "UPDATE pm_approval_notifications SET available_at=now()-interval '1 second' WHERE user_id=$1 AND kind='review' AND recipient_id=$2",
          [u.id, b.id],
        );
        const job = await repo.claimApprovalNotification();
        await repo.finishApprovalNotification(u.id, job.lease, false);
      }
      assert.equal((await repo.listUsers()).find((x) => x.id === u.id).reviewMailStatus, 'failed');
      await assert.rejects(
        repo.retryApprovalNotification(u.id, u.id, 'review'),
        (e) => e.status === 403,
      );
      await repo.retryApprovalNotification(a.id, u.id, 'review');
      await pool.query('UPDATE pm_users SET is_admin=false WHERE id=$1', [b.id]);
      assert.equal(await repo.claimApprovalNotification(), null);
      await pool.query('UPDATE pm_users SET is_admin=true,is_active=false WHERE id=$1', [b.id]);
      assert.equal(await repo.claimApprovalNotification(), null);
      await pool.query('UPDATE pm_users SET is_active=true WHERE id=$1', [b.id]);
      const retried = await repo.claimApprovalNotification();
      assert.equal(retried.recipientId, b.id);
      await repo.finishApprovalNotification(u.id, retried.lease, true);
      assert.equal((await repo.listUsers()).filter((x) => x.id === u.id).length, 1);
      assert.equal((await repo.listUsers()).find((x) => x.id === u.id).reviewMailStatus, 'sent');
      await repo.manageUser(a.id, u.id, { isActive: true });
      await pool.query(
        "UPDATE pm_approval_notifications SET state='pending',available_at=now() WHERE user_id=$1 AND kind='review'",
        [u.id],
      );
      const approved = await repo.claimApprovalNotification();
      assert.equal(approved.kind, 'approval');
      assert.equal(approved.email, u.email);
      await repo.finishApprovalNotification(u.id, approved.lease, true);
      assert.equal(await repo.claimApprovalNotification(), null);
      await assert.rejects(
        repo.retryApprovalNotification(a.id, u.id, 'review'),
        (e) => e.code === 'NOTICE_UNAVAILABLE',
      );
    } finally {
      for (const id of ids.reverse()) await pool.query('DELETE FROM pm_users WHERE id=$1', [id]);
      await pool.end();
    }
  },
);
test(
  '실제 PostgreSQL: 010·011 업그레이드는 기존 발송 기록 보존·대기 신청 등록·지정 수신 주소 제약을 적용한다',
  { skip: process.env.RUN_POSTGRES_TESTS !== '1' },
  async () => {
    if (!/_test$/.test(process.env.PGDATABASE || ''))
      throw Error('Use a dedicated _test database.');
    const pool = await createPool(),
      c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        'CREATE TEMP TABLE pm_users(id uuid PRIMARY KEY,is_admin boolean,is_active boolean,registration_pending boolean,email_verified_at timestamptz)',
      );
      await c.query(
        "CREATE TEMP TABLE pm_approval_notifications(user_id uuid PRIMARY KEY REFERENCES pm_users(id),state text DEFAULT 'pending' CHECK (state IN ('pending','sending','sent','failed')),attempts integer DEFAULT 0,lease uuid,available_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now())",
      );
      const admin = randomUUID(),
        pending = randomUUID(),
        unverified = randomUUID(),
        approved = randomUUID(),
        inactive = randomUUID();
      await c.query(
        'INSERT INTO pm_users VALUES ($1,true,true,false,NULL),($2,false,false,true,now()),($3,false,false,true,NULL),($4,false,true,false,now()),($5,true,false,false,NULL)',
        [admin, pending, unverified, approved, inactive],
      );
      await c.query(
        "INSERT INTO pm_approval_notifications(user_id,state,attempts) VALUES ($1,'sent',2)",
        [approved],
      );
      await c.query(
        fs.readFileSync(
          new URL('../migrations/010_registration_review.sql', import.meta.url),
          'utf8',
        ),
      );
      const rows = (
        await c.query(
          'SELECT user_id,recipient_id,kind,state,attempts FROM pm_approval_notifications ORDER BY kind',
        )
      ).rows;
      assert.equal(rows.length, 2);
      assert.deepEqual(
        rows.find((r) => r.kind === 'approval'),
        { user_id: approved, recipient_id: approved, kind: 'approval', state: 'sent', attempts: 2 },
      );
      assert.equal(rows.find((r) => r.kind === 'review').user_id, pending);
      assert.equal(rows.find((r) => r.kind === 'review').recipient_id, admin);
      await c.query(
        fs.readFileSync(
          new URL('../migrations/011_review_recipients.sql', import.meta.url),
          'utf8',
        ),
      );
      assert.equal(
        (
          await c.query(
            "SELECT count(*)::int AS n FROM pm_approval_notifications WHERE state='sent' AND recipient_id=$1",
            [approved],
          )
        ).rows[0].n,
        1,
      );
      await c.query(
        "INSERT INTO pm_approval_notifications(user_id,kind,recipient_email) VALUES ($1,'review','team@example.com') ON CONFLICT DO NOTHING",
        [pending],
      );
      await c.query(
        "INSERT INTO pm_approval_notifications(user_id,kind,recipient_email) VALUES ($1,'review','team@example.com') ON CONFLICT DO NOTHING",
        [pending],
      );
      assert.equal(
        (
          await c.query(
            "SELECT count(*)::int AS n FROM pm_approval_notifications WHERE recipient_email='team@example.com'",
          )
        ).rows[0].n,
        1,
      );
    } finally {
      await c.query('ROLLBACK');
      c.release();
      await pool.end();
    }
  },
);

test(
  '실제 PostgreSQL: 재설정 링크 교체·동시 소비·세션 폐기·비밀번호 변경·비활성화 경합',
  { skip: process.env.RUN_POSTGRES_TESTS !== '1' },
  async () => {
    if (!/_test$/.test(process.env.PGDATABASE || ''))
      throw Error('Use a dedicated _test database.');
    const pool = await createPool(),
      repo = new PgRepository(pool),
      other = new PgRepository(pool),
      ids = [];
    try {
      await migrate(pool);
      await migrate(pool);
      const suffix = randomUUID(),
        admin = await repo.createUser({
          email: 'reset-admin-' + suffix + '@example.com',
          name: '관리자',
          passwordHash: 'original-hash',
          isAdmin: true,
        }),
        user = await repo.createUser({
          email: 'reset-user-' + suffix + '@example.com',
          name: '사용자',
          passwordHash: 'original-hash',
        });
      ids.push(admin.id, user.id);
      const issue = (
        hash,
        expires = new Date(Date.now() + 60000),
        passwordHash = 'original-hash',
      ) => repo.issuePasswordReset({ userId: user.id, passwordHash, hash, expires });
      const first = digest(token()),
        current = digest(token());
      assert.equal(await issue(first), true);
      assert.equal(await issue(current), true);
      await assert.rejects(
        repo.consumePasswordReset(first, 'new-hash'),
        (e) => e.code === 'RESET_INVALID',
      );
      const session = {
        hash: digest(token()),
        userId: user.id,
        csrf: token(),
        expires: new Date(Date.now() + 60000),
        passwordHash: 'original-hash',
      };
      await repo.createSession(session);
      const results = await Promise.allSettled([
        repo.consumePasswordReset(current, 'new-hash'),
        other.consumePasswordReset(current, 'other-new-hash'),
      ]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'RESET_INVALID');
      assert.equal(await repo.findSession(session.hash), null);
      const stored = await repo.findUserByEmail(user.email),
        stale = digest(token());
      assert.equal(await issue(stale, new Date(Date.now() + 60000), stored.password_hash), true);
      await repo.changePassword(user.id, stored.password_hash, 'original-hash');
      await assert.rejects(
        repo.consumePasswordReset(stale, 'new-hash'),
        (e) => e.code === 'RESET_INVALID',
      );
      const expired = digest(token());
      await issue(expired, new Date(Date.now() - 1000));
      await assert.rejects(
        repo.consumePasswordReset(expired, 'new-hash'),
        (e) => e.code === 'RESET_INVALID',
      );
      const disabled = digest(token());
      await issue(disabled);
      await repo.manageUser(admin.id, user.id, { isActive: false });
      await repo.manageUser(admin.id, user.id, { isActive: true });
      await assert.rejects(
        repo.consumePasswordReset(disabled, 'new-hash'),
        (e) => e.code === 'RESET_INVALID',
      );
      assert.equal(
        await repo.issuePasswordReset({
          userId: user.id,
          passwordHash: 'wrong-snapshot',
          hash: digest(token()),
          expires: new Date(Date.now() + 60000),
        }),
        false,
      );
    } finally {
      for (const id of ids.reverse()) await pool.query('DELETE FROM pm_users WHERE id=$1', [id]);
      await pool.end();
    }
  },
);

test(
  '실제 PostgreSQL: 수신 주소 변경과 인증 경합·대기 작업 전환·완료 중복 방지·기본 관리자 복원',
  { skip: process.env.RUN_POSTGRES_TESTS !== '1' },
  async () => {
    if (!/_test$/.test(process.env.PGDATABASE || ''))
      throw Error('Use a dedicated _test database.');
    const pool = await createPool(),
      repo = new PgRepository(pool),
      ids = [];
    try {
      await migrate(pool);
      await migrate(pool);
      const suffix = randomUUID(),
        admin = await repo.createUser({
          email: 'routing-admin-' + suffix + '@example.com',
          name: '관리자',
          passwordHash: 'hash',
          isAdmin: true,
        }),
        u = await repo.createUser({
          email: 'routing-user-' + suffix + '@example.com',
          name: '신청자',
          passwordHash: 'hash',
          registrationPending: true,
        });
      ids.push(admin.id, u.id);
      const service = new MailSettings({ repo, key: Buffer.alloc(32, 31) }),
        body = {
          revision: 0,
          enabled: false,
          host: '',
          port: 587,
          secure: false,
          from: '',
          authEnabled: false,
          username: '',
          password: '',
          reviewRecipients: ['review@example.com'],
        },
        hash = digest(token());
      await repo.issueEmailVerification({
        userId: u.id,
        passwordHash: 'hash',
        hash,
        expires: new Date(Date.now() + 60000),
      });
      await Promise.all([
        service.save(admin.id, body),
        repo.consumeEmailVerification(hash, { name: '본인', passwordHash: 'verified' }),
      ]);
      const first = await repo.claimApprovalNotification();
      assert.equal(first.email, 'review@example.com');
      assert.equal(first.recipientId, null);
      assert.equal((await repo.listUsers()).filter((x) => x.id === u.id).length, 1);
      await service.save(admin.id, {
        ...body,
        revision: 1,
        reviewRecipients: ['next@example.com', 'second@example.com'],
      });
      await repo.finishApprovalNotification(u.id, first.lease, true);
      assert.equal(
        (
          await pool.query(
            "SELECT state FROM pm_approval_notifications WHERE user_id=$1 AND recipient_email='review@example.com'",
            [u.id],
          )
        ).rows[0].state,
        'cancelled',
      );
      const jobs = await Promise.all([
        repo.claimApprovalNotification(),
        repo.claimApprovalNotification(),
      ]);
      assert.deepEqual(
        new Set(jobs.map((j) => j.email)),
        new Set(['next@example.com', 'second@example.com']),
      );
      for (const j of jobs) await repo.finishApprovalNotification(u.id, j.lease, true);
      await service.save(admin.id, {
        ...body,
        revision: 2,
        reviewRecipients: ['second@example.com', 'next@example.com'],
      });
      assert.equal(await repo.claimApprovalNotification(), null);
      await service.save(admin.id, { ...body, revision: 3, reviewRecipients: [] });
      const fallback = await repo.claimApprovalNotification();
      assert.equal(fallback.email, admin.email);
      await repo.finishApprovalNotification(u.id, fallback.lease, true);
      await service.save(admin.id, { ...body, revision: 4, reviewRecipients: [admin.email] });
      assert.equal(await repo.claimApprovalNotification(), null);
      const restarted = new MailSettings({
        repo: new PgRepository(pool),
        key: Buffer.alloc(32, 31),
      });
      assert.deepEqual((await restarted.public()).reviewRecipients, [admin.email]);
      await repo.manageUser(admin.id, u.id, { isActive: true });
      await service.save(admin.id, {
        ...body,
        revision: 5,
        reviewRecipients: ['after-approval@example.com'],
      });
      const approved = await repo.claimApprovalNotification();
      assert.equal(approved.kind, 'approval');
      assert.equal(approved.email, u.email);
      await repo.finishApprovalNotification(u.id, approved.lease, true);
      assert.equal(await repo.claimApprovalNotification(), null);
    } finally {
      await pool.query('DELETE FROM pm_mail_settings WHERE id=true');
      for (const id of ids.reverse()) await pool.query('DELETE FROM pm_users WHERE id=$1', [id]);
      await pool.end();
    }
  },
);

test(
  '실제 PostgreSQL: 관리자 SMTP 암호화·재시작 복구·권한·동시 설정 저장 충돌',
  { skip: process.env.RUN_POSTGRES_TESTS !== '1' },
  async () => {
    if (!/_test$/.test(process.env.PGDATABASE || ''))
      throw Error('Use a dedicated _test database.');
    const pool = await createPool(),
      repo = new PgRepository(pool),
      ids = [];
    try {
      await migrate(pool);
      await migrate(pool);
      const suffix = randomUUID(),
        admin = await repo.createUser({
          email: 'smtp-admin-' + suffix + '@example.com',
          name: '관리자',
          passwordHash: 'fixture',
          isAdmin: true,
        }),
        user = await repo.createUser({
          email: 'smtp-user-' + suffix + '@example.com',
          name: '일반 사용자',
          passwordHash: 'fixture',
        });
      ids.push(admin.id, user.id);
      const key = Buffer.alloc(32, 23),
        service = new MailSettings({ repo, key }),
        body = {
          revision: 0,
          enabled: true,
          host: 'smtp.example.com',
          port: 587,
          secure: false,
          from: 'sender@example.com',
          authEnabled: true,
          username: 'fixture',
          password: 'test-only-smtp-secret',
        };
      await assert.rejects(service.save(user.id, body), (e) => e.status === 403);
      await service.save(admin.id, body);
      const row = await repo.getMailSettings();
      assert.equal(row.revision, 1);
      assert.equal(JSON.stringify(row).includes(body.password), false);
      let restoredPassword;
      const restarted = new MailSettings({
        repo: new PgRepository(pool),
        key,
        makeMailer: (config) => ({
          sendTest: async () => {
            restoredPassword = config.transport.auth.pass;
          },
          close() {},
        }),
      });
      await restarted.test('recipient@example.com');
      assert.equal(restoredPassword, body.password);
      assert.equal((await restarted.public()).hasPassword, true);
      const attempts = await Promise.allSettled([
        service.save(admin.id, { ...body, password: '', revision: 1 }),
        restarted.save(admin.id, { ...body, password: '', revision: 1 }),
      ]);
      assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(attempts.find((r) => r.status === 'rejected').reason.code, 'MAIL_CONFLICT');
      assert.equal((await service.public()).revision, 2);
    } finally {
      await pool.query('DELETE FROM pm_mail_settings WHERE id=true');
      for (const id of ids.reverse()) await pool.query('DELETE FROM pm_users WHERE id=$1', [id]);
      await pool.end();
    }
  },
);

test(
  '실제 PostgreSQL: 가입 승인·프로젝트 일괄 권한의 원자성, 거절과 관리자 격리',
  { skip: process.env.RUN_POSTGRES_TESTS !== '1' },
  async () => {
    if (!/_test$/.test(process.env.PGDATABASE || ''))
      throw Error('Dedicated _test database required');
    const pool = await createPool(),
      repo = new PgRepository(pool),
      ids = [],
      projects = [],
      suffix = randomUUID();
    const make = async (name, extra = {}) => {
      const u = await repo.createUser({
        email: name + suffix + '@example.com',
        name,
        passwordHash: 'unused',
        ...extra,
      });
      ids.push(u.id);
      return u;
    };
    try {
      await migrate(pool);
      const admin = await make('admin', { isAdmin: true }),
        other = await make('other'),
        pending = await make('pending', { registrationPending: true }),
        rejected = await make('rejected', { registrationPending: true });
      const a = randomUUID(),
        b = randomUUID();
      projects.push(a, b);
      await repo.createProject(admin.id, a, cleanProject({ name: 'own', members: [], tasks: [] }));
      await repo.createProject(
        other.id,
        b,
        cleanProject({ name: 'other', members: [], tasks: [] }),
      );
      const approve = (grants) =>
        repo.decideRegistration(admin.id, pending.id, { decision: 'approve', reason: '', grants });
      await assert.rejects(approve([]), (e) => e.code === 'EMAIL_UNVERIFIED');
      await pool.query('UPDATE pm_users SET email_verified_at=now() WHERE id=$1', [pending.id]);
      await assert.rejects(
        approve([
          { projectId: a, role: 'editor' },
          { projectId: b, role: 'viewer' },
        ]),
        (e) => e.status === 404,
      );
      assert.equal((await repo.findUserByEmail(pending.email)).registration_pending, true);
      assert.equal(
        (
          await pool.query('SELECT count(*) AS n FROM pm_project_access WHERE user_id=$1', [
            pending.id,
          ])
        ).rows[0].n,
        '0',
      );
      await assert.rejects(
        repo.decideRegistration(other.id, pending.id, {
          decision: 'approve',
          reason: '',
          grants: [],
        }),
        (e) => e.status === 403,
      );
      const outcomes = await Promise.allSettled([
        approve([{ projectId: a, role: 'editor' }]),
        approve([]),
      ]);
      assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal((await repo.getProject(pending.id, a))._role, 'editor');
      assert.equal(
        (
          await pool.query(
            'SELECT count(*) AS n FROM pm_approval_notifications WHERE user_id=$1 AND kind=$2',
            [pending.id, 'approval'],
          )
        ).rows[0].n,
        '1',
      );
      await repo.decideRegistration(admin.id, rejected.id, {
        decision: 'reject',
        reason: '중복 신청',
        grants: [],
      });
      const u = await repo.findUserByEmail(rejected.email);
      assert.equal(u.registration_rejected, true);
      assert.equal(u.is_active, false);
      await assert.rejects(
        repo.manageUser(admin.id, u.id, { isActive: true }),
        (e) => e.code === 'REGISTRATION_REJECTED',
      );
    } finally {
      for (const id of projects) await pool.query('DELETE FROM pm_projects WHERE id=$1', [id]);
      for (const id of ids) await pool.query('DELETE FROM pm_users WHERE id=$1', [id]);
      await pool.end();
    }
  },
);

test(
  '실제 PostgreSQL: 내 업무 매핑은 명시적·프로젝트별 격리, 전체 저장 보존과 공유 해제 정리',
  { skip: process.env.RUN_POSTGRES_TESTS !== '1' },
  async () => {
    if (!/_test$/.test(process.env.PGDATABASE || ''))
      throw Error('Dedicated _test database required');
    const pool = await createPool(),
      repo = new PgRepository(pool),
      ids = [],
      projectId = randomUUID();
    try {
      await migrate(pool);
      for (const name of ['owner', 'member', 'outsider'])
        ids.push(
          (
            await repo.createUser({
              email: randomUUID() + '@example.com',
              name,
              passwordHash: 'unused',
            })
          ).id,
        );
      const [owner, member, outsider] = ids;
      let p = await repo.createProject(
        owner,
        projectId,
        cleanProject({
          name: '명시적 연결',
          members: [
            { id: 'm', name: '담당', role: '개발', grade: '중급', hours: 8, allocation: 100 },
          ],
          tasks: [
            {
              id: 't',
              name: '내 업무',
              owner: 'm',
              start: '2026-10-19',
              end: '2026-10-23',
              items: [{ id: 'i', title: '완료', hours: 8, doneDate: '2026-10-23' }],
            },
          ],
        }),
      );
      await repo.grantAccess(
        owner,
        projectId,
        (await pool.query('SELECT email FROM pm_users WHERE id=$1', [member])).rows[0].email,
        'editor',
      );
      assert.deepEqual(await repo.myWork(member), []);
      await assert.rejects(
        repo.setMemberAccount(member, projectId, { memberId: 'm', userId: member }),
        (e) => e.status === 403,
      );
      await assert.rejects(
        repo.setMemberAccount(owner, projectId, { memberId: 'm', userId: outsider }),
        (e) => e.status === 400,
      );
      await repo.setMemberAccount(owner, projectId, { memberId: 'm', userId: member });
      assert.equal((await repo.myWork(member))[0].tasks[0].id, 't');
      assert.deepEqual(await repo.myWork(outsider), []);
      p.name = '다른 변경';
      p = await repo.updateProject(owner, projectId, cleanProject(p), p._revision);
      assert.equal((await repo.memberAccounts(owner, projectId)).length, 1);
      await repo.revokeAccess(owner, projectId, member);
      assert.deepEqual(await repo.myWork(member), []);
      assert.deepEqual(await repo.memberAccounts(owner, projectId), []);
    } finally {
      await pool.query('DELETE FROM pm_projects WHERE id=$1', [projectId]);
      for (const id of ids) await pool.query('DELETE FROM pm_users WHERE id=$1', [id]);
      await pool.end();
    }
  },
);

test(
  '실제 PostgreSQL: 업무·프로젝트 휴지통의 권한·완료 기록·충돌·30일 만료',
  { skip: process.env.RUN_POSTGRES_TESTS !== '1' },
  async () => {
    if (!/_test$/.test(process.env.PGDATABASE || ''))
      throw Error('Dedicated _test database required');
    const pool = await createPool(),
      repo = new PgRepository(pool),
      ids = [],
      projectId = randomUUID();
    try {
      await migrate(pool);
      for (const name of ['owner', 'editor', 'viewer'])
        ids.push(
          (
            await repo.createUser({
              email: randomUUID() + '@example.com',
              name,
              passwordHash: 'unused',
            })
          ).id,
        );
      const [owner, editor, viewer] = ids;
      let p = await repo.createProject(
        owner,
        projectId,
        cleanProject({
          name: '휴지통',
          members: [],
          tasks: [
            {
              id: 't',
              name: '기록',
              owner: '',
              predecessor: '',
              start: '2026-10-19',
              end: '2026-10-23',
              items: [{ id: 'i', title: '완료 기록', hours: 8, doneDate: '2026-10-23' }],
            },
          ],
        }),
      );
      for (const [user, role] of [
        [editor, 'editor'],
        [viewer, 'viewer'],
      ])
        await repo.grantAccess(
          owner,
          projectId,
          (await pool.query('SELECT email FROM pm_users WHERE id=$1', [user])).rows[0].email,
          role,
        );
      p.tasks = [];
      p = await repo.updateProject(editor, projectId, cleanProject(p), p._revision);
      let trash = await repo.listTrash(editor);
      assert.equal(trash.length, 1);
      assert.deepEqual(await repo.listTrash(viewer), []);
      await assert.rejects(
        repo.restoreTrash(viewer, 'tasks', trash[0].id),
        (e) => e.status === 403,
      );
      await repo.restoreTrash(editor, 'tasks', trash[0].id);
      p = await repo.getProject(owner, projectId);
      assert.equal(p.tasks[0].items[0].doneDate, '2026-10-23');
      assert.equal(p._revision, 3);
      await assert.rejects(
        repo.restoreTrash(editor, 'tasks', trash[0].id),
        (e) => e.status === 404,
      );
      await assert.rejects(
        repo.trashProject(editor, projectId, p._revision),
        (e) => e.status === 403,
      );
      await assert.rejects(
        repo.trashProject(owner, projectId, 1),
        (e) => e.code === 'REVISION_CONFLICT',
      );
      await repo.trashProject(owner, projectId, p._revision);
      assert.deepEqual(await repo.listProjects(editor), []);
      await assert.rejects(repo.getProject(owner, projectId), (e) => e.status === 404);
      assert.deepEqual(await repo.listTrash(editor), []);
      await repo.restoreTrash(owner, 'project', projectId);
      assert.equal((await repo.getProject(viewer, projectId)).tasks[0].id, 't');
      p = await repo.getProject(owner, projectId);
      await repo.trashProject(owner, projectId, p._revision);
      await pool.query("UPDATE pm_projects SET deleted_at=now()-interval '31 days' WHERE id=$1", [
        projectId,
      ]);
      assert.deepEqual(await repo.listTrash(owner), []);
      assert.equal(
        (await pool.query('SELECT id FROM pm_projects WHERE id=$1', [projectId])).rowCount,
        1,
      );
      await repo.cleanupTrash();
      assert.equal(
        (await pool.query('SELECT id FROM pm_projects WHERE id=$1', [projectId])).rowCount,
        0,
      );
    } finally {
      await pool.query('DELETE FROM pm_projects WHERE id=$1', [projectId]);
      for (const id of ids) await pool.query('DELETE FROM pm_users WHERE id=$1', [id]);
      await pool.end();
    }
  },
);

test(
  '실제 PostgreSQL: 관리자 백업 설정 충돌·실행 중복 방지·작업 lease',
  { skip: process.env.RUN_POSTGRES_TESTS !== '1' },
  async () => {
    if (!/_test$/.test(process.env.PGDATABASE || ''))
      throw Error('Dedicated _test database required');
    const pool = await createPool(),
      repo = new PgRepository(pool),
      ids = [];
    try {
      await migrate(pool);
      for (const isAdmin of [true, false])
        ids.push(
          (
            await repo.createUser({
              email: randomUUID() + '@example.com',
              name: '백업',
              passwordHash: 'unused',
              isAdmin,
            })
          ).id,
        );
      const [admin, other] = ids,
        s = (await repo.backupStatus()).settings,
        b = { enabled: true, hour: 4, retentionDays: 7, verifyRestore: true, revision: s.revision };
      await assert.rejects(repo.saveBackupSettings(other, b), (e) => e.status === 403);
      await repo.saveBackupSettings(admin, b);
      await assert.rejects(repo.saveBackupSettings(admin, b), (e) => e.code === 'BACKUP_CONFLICT');
      await repo.requestBackup(admin);
      await assert.rejects(repo.requestBackup(admin), (e) => e.code === 'BACKUP_RUNNING');
      await pool.query(
        "UPDATE pm_backup_settings SET requested=false,lease_until=now()+interval '5 minutes' WHERE id=true",
      );
      await assert.rejects(repo.requestBackup(admin), (e) => e.code === 'BACKUP_RUNNING');
      await pool.query(
        'UPDATE pm_backup_settings SET requested=true,lease_until=NULL WHERE id=true',
      );
      const worker = new BackupWorker({ pool }),
        claims = await Promise.all([worker.claim(), worker.claim()]);
      assert.equal(claims.filter(Boolean).length, 1);
      const first = claims.find(Boolean);
      await pool.query(
        "UPDATE pm_backup_settings SET requested=true,lease_until=now()-interval '1 minute' WHERE id=true",
      );
      const second = await worker.claim();
      assert.ok(second);
      assert.notEqual(second.id, first.id);
      await pool.query(
        "UPDATE pm_backup_settings SET enabled=false,requested=false,lease_until=now()-interval '1 minute' WHERE id=true",
      );
      assert.equal(await worker.claim(), null);
      assert.equal(
        (await pool.query('SELECT state FROM pm_backup_runs WHERE id=$1', [second.id])).rows[0]
          .state,
        'failed',
      );
      assert.equal(
        (await pool.query('SELECT state FROM pm_backup_runs WHERE id=$1', [first.id])).rows[0]
          .state,
        'failed',
      );
      await pool.query('DELETE FROM pm_backup_runs WHERE id=ANY($1::uuid[])', [
        [first.id, second.id],
      ]);
    } finally {
      await pool.query(
        'UPDATE pm_backup_settings SET requested=false,lease_until=NULL,updated_by=NULL WHERE id=true',
      );
      for (const id of ids) await pool.query('DELETE FROM pm_users WHERE id=$1', [id]);
      await pool.end();
    }
  },
);

test(
  '실제 PostgreSQL: 예약 시간대·일광절약 전환과 설정 값 보존',
  { skip: process.env.RUN_POSTGRES_TESTS !== '1' },
  async () => {
    if (!/_test$/.test(process.env.PGDATABASE || ''))
      throw Error('Dedicated _test database required');
    const pool = await createPool(),
      repo = new PgRepository(pool);
    let admin;
    try {
      await migrate(pool);
      const schedule = async (hour, zone, at) =>
        (await pool.query('SELECT pm_next_backup_at($1,$2,$3)::text AS at', [hour, zone, at]))
          .rows[0].at;
      assert.equal(
        new Date(await schedule(3, 'Asia/Seoul', '2026-10-26T04:00:00Z')).toISOString(),
        '2026-10-26T18:00:00.000Z',
      );
      assert.equal(
        new Date(await schedule(3, 'UTC', '2026-10-26T04:00:00Z')).toISOString(),
        '2026-10-27T03:00:00.000Z',
      );
      assert.equal(
        new Date(await schedule(2, 'America/New_York', '2026-03-08T06:00:00Z')).toISOString(),
        '2026-03-08T07:00:00.000Z',
      );
      admin = await repo.createUser({
        email: randomUUID() + '@example.com',
        name: '시간대',
        passwordHash: 'unused',
        isAdmin: true,
      });
      let s = (await repo.backupStatus()).settings;
      await repo.saveBackupSettings(admin.id, { ...s, timeZone: 'UTC' });
      s = (await repo.backupStatus()).settings;
      assert.equal(s.timeZone, 'UTC');
      delete s.timeZone;
      await repo.saveBackupSettings(admin.id, s);
      assert.equal((await repo.backupStatus()).settings.timeZone, 'UTC');
      await assert.rejects(
        repo.saveBackupSettings(admin.id, { ...s, timeZone: 'Mars/Space' }),
        (e) => e.code === 'INVALID_BACKUP_SETTINGS',
      );
    } finally {
      await pool.query(
        "UPDATE pm_backup_settings SET updated_by=NULL,time_zone='Asia/Seoul' WHERE id=true",
      );
      if (admin) await pool.query('DELETE FROM pm_users WHERE id=$1', [admin.id]);
      await pool.end();
    }
  },
);
