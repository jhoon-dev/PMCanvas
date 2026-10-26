import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createPool } from './pg-pool.mjs';
import { migrationFiles } from './migrations.mjs';
import { recordFailure } from './operation-alerts.mjs';

export function runCommand(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'ignore', shell: false, timeout: 600000 });
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? resolve() : reject(Error('Backup command failed'))));
  });
}
export function automaticBackupFile(name) {
  return /^pmcanvas-auto-\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9-]{36}\.dump$/.test(name);
}
export class BackupWorker {
  constructor({ pool, env = process.env, command = runCommand, connect = createPool }) {
    this.pool = pool;
    this.env = env;
    this.command = command;
    this.connect = connect;
    this.directory = path.resolve(env.BACKUP_DIR || '/backups');
  }
  async claim() {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('UPDATE pm_backup_settings SET worker_seen_at=now() WHERE id=true');
      const s = (await c.query('SELECT * FROM pm_backup_settings WHERE id=true FOR UPDATE'))
        .rows[0];
      if (s?.lease_id && (!s.lease_until || new Date(s.lease_until) <= new Date())) {
        await c.query(
          "UPDATE pm_backup_runs SET state='failed',finished_at=now(),message='작업 서비스가 중단되어 실행을 완료하지 못했습니다.' WHERE id=$1 AND state='running'",
          [s.lease_id],
        );
        await c.query('UPDATE pm_backup_settings SET lease_id=NULL,lease_until=NULL WHERE id=true');
        s.lease_id = null;
        s.lease_until = null;
        await recordFailure(c, 'backup');
      }
      if (
        !s ||
        (s.lease_until && new Date(s.lease_until) > new Date()) ||
        !(s.requested || (s.enabled && new Date(s.next_run_at) <= new Date()))
      ) {
        await c.query('COMMIT');
        return null;
      }
      await c.query(
        "UPDATE pm_backup_runs SET state='failed',finished_at=now(),message='작업 서비스가 중단되어 실행을 완료하지 못했습니다.' WHERE state='running'",
      );
      const id = randomUUID();
      await c.query(
        "UPDATE pm_backup_settings SET lease_id=$1,lease_until=now()+interval '30 minutes',requested=false,next_run_at=pm_next_backup_at(hour,time_zone) WHERE id=true",
        [id],
      );
      await c.query("INSERT INTO pm_backup_runs(id,state) VALUES ($1,'running')", [id]);
      await c.query('COMMIT');
      return { ...s, id };
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  async retain(days) {
    for (const entry of await fs.readdir(this.directory, { withFileTypes: true })) {
      if (!entry.isFile() || !automaticBackupFile(entry.name)) continue;
      const file = path.join(this.directory, entry.name),
        stat = await fs.lstat(file);
      if (stat.isFile() && stat.mtimeMs < Date.now() - days * 86400000) await fs.unlink(file);
    }
  }
  async execute(job) {
    const filename =
        'pmcanvas-auto-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + job.id + '.dump',
      file = path.join(this.directory, filename),
      target = 'pmcanvas_verify_' + job.id.replaceAll('-', '');
    let stage = '준비',
      created = false,
      verified = false,
      bytes = 0;
    const heartbeat = setInterval(
      () =>
        this.pool
          .query(
            "UPDATE pm_backup_settings SET lease_until=now()+interval '30 minutes',worker_seen_at=now() WHERE id=true AND lease_id=$1",
            [job.id],
          )
          .catch(() => {}),
      30000,
    );
    heartbeat.unref();
    try {
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      const key = await fs.readFile(this.env.BACKUP_KEY_FILE || '/run/secrets/mfa.key');
      if (key.length !== 32) throw Error('Invalid key');
      // Record only an identifier; decryption keys are stored separately from dumps.
      await this.pool.query('UPDATE pm_backup_runs SET key_fingerprint=$2 WHERE id=$1', [
        job.id,
        createHash('sha256').update(key).digest('hex'),
      ]);
      stage = 'DB 백업';
      await this.command('pg_dump', ['-Fc', '--file', file], this.env);
      await fs.chmod(file, 0o600);
      bytes = (await fs.stat(file)).size;
      if (!bytes) throw Error('Empty dump');
      stage = '백업 파일 확인';
      await this.command('pg_restore', ['--list', file], this.env);
      if (job.verify_restore) {
        stage = '복원 점검용 DB 생성';
        if (!/^pmcanvas_verify_[a-f0-9]{32}$/.test(target) || target === this.env.PGDATABASE)
          throw Error('Invalid target');
        const owner = this.env.BACKUP_RESTORE_OWNER || 'pmcanvas';
        if (!/^[a-z][a-z0-9_]{0,62}$/.test(owner)) throw Error('Invalid owner');
        await this.command('createdb', ['--owner', owner, target], this.env);
        created = true;
        stage = '별도 DB 복원';
        await this.command(
          'pg_restore',
          [
            '--no-owner',
            '--no-acl',
            '--role',
            owner,
            '--exit-on-error',
            '--single-transaction',
            '--dbname',
            target,
            file,
          ],
          this.env,
        );
        stage = '복원 데이터 확인';
        const check = await this.connect({ ...this.env, PGDATABASE: target });
        try {
          const expected = migrationFiles().map(({ version }) => version);
          const versions = (
            await check.query('SELECT version FROM pm_schema_migrations ORDER BY version')
          ).rows.map(({ version }) => Number(version));
          const r = (
            await check.query(
              "SELECT (SELECT count(*) FROM pm_users) AS users,(SELECT count(*) FROM pm_tasks) AS tasks,(SELECT count(*) FROM pm_projects p WHERE NOT EXISTS(SELECT 1 FROM pm_project_access a WHERE a.project_id=p.id AND a.role='owner')) AS orphaned",
            )
          ).rows[0];
          if (
            versions.length !== expected.length ||
            versions.some((version, index) => version !== expected[index]) ||
            Number(r.orphaned) !== 0
          )
            throw Error('Invalid restored data');
          verified = true;
        } finally {
          await check.end();
        }
      }
      stage = '보관 기간 정리';
      await this.retain(job.retention_days);
      if (created) {
        stage = '점검용 DB 정리';
        await this.command('dropdb', ['--force', target], this.env);
        created = false;
      }
      await this.pool.query(
        "UPDATE pm_backup_runs SET state='success',finished_at=now(),filename=$2,bytes=$3,verified=$4,message='' WHERE id=$1",
        [job.id, filename, bytes, verified],
      );
    } catch {
      let cleanupFailed = false;
      if (created)
        try {
          await this.command('dropdb', ['--force', target], this.env);
        } catch {
          cleanupFailed = true;
        }
      await this.pool.query(
        "UPDATE pm_backup_runs SET state='failed',finished_at=now(),filename=$2,bytes=$3,verified=false,message=$4 WHERE id=$1",
        [
          job.id,
          bytes ? filename : null,
          bytes,
          stage +
            ' 단계에서 실패했습니다.' +
            (cleanupFailed ? ' 점검용 DB 수동 정리가 필요합니다.' : ''),
        ],
      );
      await recordFailure(this.pool, /복원|점검/.test(stage) ? 'restore' : 'backup').catch(
        () => {},
      );
    } finally {
      clearInterval(heartbeat);
      await this.pool.query(
        'UPDATE pm_backup_settings SET lease_id=NULL,lease_until=NULL,worker_seen_at=now() WHERE id=true AND lease_id=$1',
        [job.id],
      );
    }
  }
  async tick() {
    const job = await this.claim();
    if (job) await this.execute(job);
    return !!job;
  }
}
async function main() {
  process.umask(0o077);
  const pool = await createPool(),
    worker = new BackupWorker({ pool });
  if (process.argv.includes('--once')) {
    try {
      await worker.tick();
    } finally {
      await pool.end();
    }
    return;
  }
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  while (!stopped) {
    try {
      await worker.tick();
    } catch {
      console.error('Backup worker could not complete its database operation.');
    }
    if (!stopped) await new Promise((r) => setTimeout(r, 30000));
  }
  await pool.end();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => {
    console.error('Backup worker failed.');
    process.exitCode = 1;
  });
