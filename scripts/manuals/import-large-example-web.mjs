// Historical local-data repair tool; review its scope before opting in.
import { repositoryRoot } from './paths.mjs';
process.chdir(repositoryRoot);
if (process.env.PMCANVAS_ALLOW_LOCAL_DATA_CHANGES !== '1')
  throw new Error(
    'Review scripts/manuals/README.md, then set PMCANVAS_ALLOW_LOCAL_DATA_CHANGES=1 to modify local data.',
  );
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createPool, PgRepository } from '/app/web/server/postgres.mjs';
import { cleanProject } from '/app/shared/model/project.mjs';
const input = JSON.parse(fs.readFileSync('/tmp/pmcanvas-large-example.json', 'utf8'));
const pool = await createPool();
try {
  const repo = new PgRepository(pool);
  const owner = await repo.findUserByEmail(process.env.ADMIN_EMAIL);
  assert.ok(owner?.is_active && owner?.is_admin, 'Existing local administrator required');
  const project = cleanProject(input);
  const created = await repo.createProject(owner.id, input.id, project);
  const saved = await repo.getProject(owner.id, input.id);
  assert.deepEqual(cleanProject(saved), project, 'Project must persist every record');
  console.log(
    JSON.stringify(
      {
        id: saved.id,
        name: saved.name,
        owner: owner.email,
        members: saved.members.length,
        tasks: saved.tasks.length,
        items: saved.tasks.reduce((n, t) => n + t.items.length, 0),
        issues: saved.issues.length,
        weeklyReports: saved.weeklyReports.length,
        revision: saved._revision,
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
