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
  const result = await repo.transaction(async (c) => {
    const rows = (
      await c.query(
        "SELECT * FROM pm_projects p WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p.planning->'management'->'weeklyReports','[]'::jsonb)) r WHERE r->>'projectName' LIKE '%[예제]%') FOR UPDATE",
      )
    ).rows;
    const updated = [];
    for (const row of rows) {
      const reports = structuredClone(row.planning.management.weeklyReports),
        changes = [];
      for (const report of reports) {
        if (!report.projectName.includes('[예제]')) continue;
        const before = structuredClone(report),
          name = report.projectName
            .replaceAll('[예제]', '')
            .replace(/\s{2,}/g, ' ')
            .trim();
        assert.ok(name, 'Keep a nonempty project name');
        report.projectName = name;
        const comparison = structuredClone(report);
        comparison.projectName = before.projectName;
        assert.deepEqual(
          comparison,
          before,
          'Preserve report metrics, content, dates and snapshot',
        );
        changes.push({
          entity: 'weekly-report',
          id: report.id,
          action: 'update',
          before: { projectName: before.projectName },
          after: { projectName: name },
          reason: '프로젝트 제목의 예제 표시 제거',
        });
      }
      const owner = (
        await c.query(
          "SELECT a.user_id FROM pm_project_access a JOIN pm_users u ON u.id=a.user_id WHERE a.project_id=$1 AND a.role='owner' AND u.is_active ORDER BY a.user_id LIMIT 1",
          [row.id],
        )
      ).rows[0];
      assert.ok(owner, 'Active project owner required');
      const change = await c.query(
        "UPDATE pm_projects SET planning=jsonb_set(planning,'{management,weeklyReports}',$2::jsonb),revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$3 RETURNING revision",
        [row.id, JSON.stringify(reports), row.revision],
      );
      assert.equal(change.rowCount, 1);
      await repo.event(
        c,
        row.id,
        owner.user_id,
        change.rows[0].revision,
        'project.updated',
        changes,
      );
      const document = await repo.hydrate(c, {
        ...row,
        planning: {
          ...row.planning,
          management: { ...row.planning.management, weeklyReports: reports },
        },
        role: 'owner',
      });
      cleanProject(document);
      updated.push({
        id: row.id,
        name: row.name,
        correctedReports: changes.length,
        revision: change.rows[0].revision,
      });
    }
    return updated;
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await pool.end();
}
