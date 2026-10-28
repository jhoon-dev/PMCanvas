import { createPool, migrate } from '../server/postgres.mjs';
const pool = await createPool();
try {
  await migrate(pool);
  console.log('Database migrations applied.');
} finally {
  await pool.end();
}
