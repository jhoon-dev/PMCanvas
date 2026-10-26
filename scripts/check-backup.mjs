// CI-only verification of the backup sidecar against a disposable database.
import assert from 'node:assert/strict';
import { createPool } from '../server/pg-pool.mjs';
if (!/_test$/.test(process.env.PGDATABASE || '')) throw Error('Dedicated _test database required.');
const pool = await createPool();
try {
  const run = (
    await pool.query(
      'SELECT state,verified,bytes FROM pm_backup_runs ORDER BY started_at DESC LIMIT 1',
    )
  ).rows[0];
  assert.equal(run?.state, 'success');
  assert.equal(run.verified, true);
  assert.ok(Number(run.bytes) > 0);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM pg_database WHERE datname LIKE 'pmcanvas_verify_%'",
      )
    ).rows[0].n,
    0,
  );
  console.log(
    'Backup sidecar: actual dump, isolated restore, data checks and temporary database cleanup passed.',
  );
} finally {
  await pool.end();
}
