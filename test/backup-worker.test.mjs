import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BackupWorker, automaticBackupFile } from '../server/backup-worker.mjs';
import { migrationFiles } from '../server/migrations.mjs';
const expectedVersions = migrationFiles().map(({ version }) => version);
async function fixture(t, { failAt = '', verify = true, versions = expectedVersions } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pmcanvas-backup-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const key = path.join(directory, 'test.key');
  await fs.writeFile(key, Buffer.alloc(32, 1));
  const calls = [],
    queries = [];
  const worker = new BackupWorker({
    pool: {
      async query(sql, args) {
        queries.push({ sql, args });
      },
    },
    env: { BACKUP_DIR: directory, BACKUP_KEY_FILE: key, PGDATABASE: 'source_test' },
    command: async (cmd, args) => {
      calls.push([cmd, args]);
      if (cmd === failAt) throw Error('private password must not leak');
      if (cmd === 'pg_dump') await fs.writeFile(args[2], 'dump');
    },
    connect: async () => ({
      async query(sql) {
        if (sql.includes('pm_schema_migrations'))
          return { rows: versions.map((version) => ({ version })) };
        return { rows: [{ users: 1, tasks: 1, orphaned: 0 }] };
      },
      async end() {},
    }),
  });
  return {
    worker,
    directory,
    calls,
    queries,
    job: { id: randomUUID(), verify_restore: verify, retention_days: 14 },
  };
}
test('백업은 격리 DB에서 복원 점검하고 덤프 폴더에 암호화 키를 쓰지 않음', async (t) => {
  const f = await fixture(t);
  await f.worker.execute(f.job);
  assert.deepEqual(
    f.calls.map((c) => c[0]),
    ['pg_dump', 'pg_restore', 'createdb', 'pg_restore', 'dropdb'],
  );
  assert.notEqual(f.calls[2][1].at(-1), 'source_test');
  assert.equal(f.calls[3][1].includes('--single-transaction'), true);
  assert.ok(f.queries.some((q) => q.sql.includes("state='success'") && q.args[3] === true));
  assert.equal((await fs.readdir(f.directory)).includes('keys'), false);
  assert.match(f.queries.find((q) => q.sql.includes('key_fingerprint')).args[1], /^[a-f0-9]{64}$/);
  assert.ok((await fs.readdir(f.directory)).some(automaticBackupFile));
});

for (const [name, versions] of [
  ['최신 버전 누락', expectedVersions.slice(0, -1)],
  [
    '같은 개수지만 중간 버전 누락',
    expectedVersions.map((v) => (v === 2 ? 999 : v)).sort((a, b) => a - b),
  ],
  ['배포 버전보다 새로운 스키마', [...expectedVersions, expectedVersions.at(-1) + 1]],
]) {
  test('복원 점검은 마이그레이션 불일치를 거부: ' + name, async (t) => {
    const f = await fixture(t, { versions });
    await f.worker.execute(f.job);
    assert.ok(
      f.queries.some(
        (q) => q.sql.includes("state='failed'") && q.args[3].includes('복원 데이터 확인'),
      ),
    );
    assert.equal(
      f.queries.some((q) => q.sql.includes("state='success'")),
      false,
    );
    assert.ok(f.calls.some((c) => c[0] === 'dropdb'));
  });
}
test('DB 생성 실패 시 기존 DB를 지우지 않으며 오류에 비밀값을 노출하지 않음', async (t) => {
  const f = await fixture(t, { failAt: 'createdb' });
  await f.worker.execute(f.job);
  assert.equal(
    f.calls.some((c) => c[0] === 'dropdb'),
    false,
  );
  const failure = f.queries.find((q) => q.sql.includes("state='failed'"));
  assert.ok(failure);
  assert.equal(JSON.stringify(failure).includes('private password'), false);
});
test('복원 실패 시 생성한 임시 DB만 정리하고 성공을 기록하지 않음', async (t) => {
  const f = await fixture(t);
  const command = f.worker.command;
  f.worker.command = async (c, a, e) => {
    if (c === 'pg_restore' && a.includes('--dbname')) throw Error('restore failed');
    return command(c, a, e);
  };
  await f.worker.execute(f.job);
  assert.ok(f.calls.some((c) => c[0] === 'dropdb'));
  assert.equal(
    f.queries.some((q) => q.sql.includes("state='success'")),
    false,
  );
});
test('보관 기간 정리는 자동 덤프만 삭제하고 수동 백업·키를 보존', async (t) => {
  const f = await fixture(t),
    old = 'pmcanvas-auto-2026-01-01T00-00-00-000Z-' + randomUUID() + '.dump';
  const manual = path.join(f.directory, 'pmcanvas-manual.dump');
  await fs.writeFile(path.join(f.directory, old), 'old');
  await fs.writeFile(manual, 'manual');
  await fs.utimes(path.join(f.directory, old), new Date(0), new Date(0));
  await fs.utimes(manual, new Date(0), new Date(0));
  await f.worker.retain(14);
  assert.equal((await fs.readdir(f.directory)).includes(old), false);
  assert.equal(await fs.readFile(manual, 'utf8'), 'manual');
  assert.deepEqual(await fs.readFile(path.join(f.directory, 'test.key')), Buffer.alloc(32, 1));
});
