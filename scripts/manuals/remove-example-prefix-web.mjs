// Historical local-data repair tool; review its scope before opting in.
import { repositoryRoot } from './paths.mjs';
process.chdir(repositoryRoot);
if (process.env.PMCANVAS_ALLOW_LOCAL_DATA_CHANGES !== '1')
  throw new Error(
    'Review scripts/manuals/README.md, then set PMCANVAS_ALLOW_LOCAL_DATA_CHANGES=1 to modify local data.',
  );
import assert from 'node:assert/strict';
import { createPool, PgRepository } from '/app/web/server/postgres.mjs';
import { cleanProject } from '/app/shared/model/project.mjs';
const pool = await createPool();
try {
  const repo = new PgRepository(pool);
  const projects = (
    await pool.query(
      "SELECT p.id,a.user_id FROM pm_projects p JOIN pm_project_access a ON a.project_id=p.id AND a.role='owner' WHERE p.name LIKE '%[예제]%' ORDER BY p.id",
    )
  ).rows;
  const result = [];
  for (const row of projects) {
    const before = await repo.getProject(row.user_id, row.id);
    const next = cleanProject(before);
    next.name = next.name
      .replaceAll('[예제]', '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    assert.ok(next.name, 'Keep a nonempty project name');
    const saved = await repo.updateProject(row.user_id, row.id, next, before._revision);
    const after = cleanProject(saved),
      previous = cleanProject(before);
    delete after.name;
    delete previous.name;
    assert.deepEqual(after, previous, 'Preserve every other project field');
    result.push({
      id: saved.id,
      before: before.name,
      after: saved.name,
      revision: saved._revision,
    });
  }
  assert.equal(
    Number(
      (await pool.query("SELECT count(*) AS n FROM pm_projects WHERE name LIKE '%[예제]%'")).rows[0]
        .n,
    ),
    0,
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await pool.end();
}
