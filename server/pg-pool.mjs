import fs from 'node:fs';
export async function createPool(env = process.env) {
  const { Pool } = await import('pg'),
    mode = env.PGSSLMODE || 'disable';
  if (!['disable', 'verify-full'].includes(mode))
    throw Error('PGSSLMODE must be disable or verify-full.');
  const ssl =
    mode === 'verify-full'
      ? {
          rejectUnauthorized: true,
          ...(env.PGSSLROOTCERT ? { ca: fs.readFileSync(env.PGSSLROOTCERT, 'utf8') } : {}),
        }
      : false;
  const pool = new Pool({
    host: env.PGHOST || '127.0.0.1',
    port: Number(env.PGPORT || 5432),
    database: env.PGDATABASE || 'pmcanvas',
    user: env.PGUSER || 'pmcanvas',
    password: env.PGPASSWORD,
    ssl,
    max: 10,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    statement_timeout: 30000,
  });
  pool.on('error', (error) => console.error('PostgreSQL pool error:', error.code || error.name));
  return pool;
}
