import { randomUUID } from 'node:crypto';
import { fail } from './errors.mjs';
import { deletedTaskBundle, restoreTaskBundle } from './workspace-model.mjs';
export class WorkspaceOperations {
  async decideRegistration(actorId, targetId, { decision, reason, grants }) {
    return this.transaction(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(726534011)');
      const actor = (
        await c.query('SELECT * FROM pm_users WHERE id=$1 FOR NO KEY UPDATE', [actorId])
      ).rows[0];
      if (!actor?.is_admin || !actor.is_active) fail(403, 'FORBIDDEN', '관리자 권한이 필요합니다.');
      const u = (await c.query('SELECT * FROM pm_users WHERE id=$1 FOR NO KEY UPDATE', [targetId]))
        .rows[0];
      if (!u?.registration_pending || u.is_admin)
        fail(409, 'REGISTRATION_CHANGED', '이미 처리했거나 가입 대기 상태가 아닌 계정입니다.');
      if (decision === 'approve' && !u.email_verified_at)
        fail(409, 'EMAIL_UNVERIFIED', '이메일 인증을 완료한 계정만 승인할 수 있습니다.');
      const projects = [];
      for (const g of grants) {
        const p = await this.access(c, actorId, g.projectId, 'owner', true);
        projects.push({ ...g, project: p });
      }
      const count = Number(
        (
          await c.query(
            'SELECT count(*) AS n FROM pm_project_access WHERE user_id=$1 AND NOT(project_id=ANY($2::uuid[]))',
            [targetId, projects.map((g) => g.projectId)],
          )
        ).rows[0].n,
      );
      if (count + projects.length > 100)
        fail(400, 'PROJECT_LIMIT', '계정당 프로젝트 한도를 초과합니다.');
      await c.query(
        'UPDATE pm_users SET registration_pending=false,registration_rejected=$2,rejection_reason=$3,is_active=$4 WHERE id=$1',
        [targetId, decision === 'reject', reason, decision === 'approve'],
      );
      await c.query('DELETE FROM pm_email_verifications WHERE user_id=$1', [targetId]);
      await c.query('DELETE FROM pm_sessions WHERE user_id=$1', [targetId]);
      if (decision === 'approve') {
        for (const g of projects) {
          const old = (
            await c.query('SELECT role FROM pm_project_access WHERE project_id=$1 AND user_id=$2', [
              g.projectId,
              targetId,
            ])
          ).rows[0]?.role;
          if (old === 'owner') fail(409, 'OWNER_IMMUTABLE', '소유자 권한은 변경할 수 없습니다.');
          await c.query(
            'INSERT INTO pm_project_access(project_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role',
            [g.projectId, targetId, g.role],
          );
          await this.event(c, g.projectId, actorId, g.project.revision, 'access.granted', [
            { email: u.email, before: old || null, after: g.role },
          ]);
        }
        await c.query(
          'INSERT INTO pm_approval_notifications(user_id,recipient_id) VALUES ($1,$1) ON CONFLICT DO NOTHING',
          [targetId],
        );
      } else
        await c.query(
          "UPDATE pm_approval_notifications SET state='cancelled',lease=NULL WHERE user_id=$1 AND kind='review' AND state<>'sent'",
          [targetId],
        );
      return { ok: true };
    });
  }
  async adminSummary() {
    const r = (
      await this.pool.query(
        'SELECT count(*) FILTER (WHERE registration_pending AND email_verified_at IS NOT NULL)::int AS pending,count(*) FILTER (WHERE registration_pending AND email_verified_at IS NULL)::int AS unverified FROM pm_users',
      )
    ).rows[0];
    return r;
  }
  async memberAccounts(userId, id) {
    return this.transaction(async (c) => {
      await this.access(c, userId, id, 'owner');
      return (
        await c.query(
          'SELECT member_id AS "memberId",user_id AS "userId" FROM pm_member_accounts WHERE project_id=$1',
          [id],
        )
      ).rows;
    }, true);
  }
  async setMemberAccount(actorId, id, { memberId, userId }) {
    return this.transaction(async (c) => {
      const p = await this.access(c, actorId, id, 'owner', true);
      if (
        !(await c.query('SELECT id FROM pm_members WHERE project_id=$1 AND id=$2', [id, memberId]))
          .rowCount
      )
        fail(404, 'MEMBER_NOT_FOUND', '참여인력을 찾을 수 없습니다.');
      if (
        userId &&
        !(
          await c.query(
            'SELECT a.user_id FROM pm_project_access a JOIN pm_users u ON u.id=a.user_id WHERE a.project_id=$1 AND a.user_id=$2 AND u.is_active',
            [id, userId],
          )
        ).rowCount
      )
        fail(400, 'MEMBER_ACCOUNT', '프로젝트에 공유된 활성 계정을 선택해 주세요.');
      await c.query(
        'DELETE FROM pm_member_accounts WHERE project_id=$1 AND (member_id=$2 OR user_id=$3)',
        [id, memberId, userId || null],
      );
      if (userId)
        await c.query(
          'INSERT INTO pm_member_accounts(project_id,member_id,user_id) VALUES ($1,$2,$3)',
          [id, memberId, userId],
        );
      await this.event(c, id, actorId, p.revision, 'member.account_linked', [
        { memberId, userId: userId || null },
      ]);
      return { ok: true };
    });
  }
  async myWork(userId) {
    return this.transaction(async (c) => {
      const rows = (
          await c.query(
            'SELECT p.*,a.role,m.member_id FROM pm_projects p JOIN pm_project_access a ON a.project_id=p.id JOIN pm_member_accounts m ON m.project_id=p.id AND m.user_id=a.user_id WHERE a.user_id=$1 AND p.deleted_at IS NULL ORDER BY p.name',
            [userId],
          )
        ).rows,
        projects = [];
      for (const row of rows) {
        const p = await this.hydrate(c, row);
        p.tasks = p.tasks.filter((t) => t.owner === row.member_id);
        projects.push(p);
      }
      return projects;
    }, true);
  }
  async captureDeletedTasks(c, id, actorId, before, after) {
    const bundle = deletedTaskBundle(before, after);
    if (bundle)
      await c.query(
        'INSERT INTO pm_deleted_tasks(id,project_id,document,deleted_by) VALUES ($1,$2,$3::jsonb,$4)',
        [randomUUID(), id, JSON.stringify(bundle), actorId],
      );
  }
  async cleanupTrash() {
    await this.pool.query("DELETE FROM pm_deleted_tasks WHERE deleted_at<now()-interval '30 days'");
    await this.pool.query("DELETE FROM pm_projects WHERE deleted_at<now()-interval '30 days'");
  }
  async trashProject(userId, id, revision) {
    return this.transaction(async (c) => {
      const p = await this.access(c, userId, id, 'owner', true);
      if (p.revision !== revision)
        fail(
          409,
          'REVISION_CONFLICT',
          '프로젝트가 변경되었습니다. 새로 읽은 뒤 다시 시도해 주세요.',
        );
      await c.query('UPDATE pm_projects SET deleted_at=now(),revision=revision+1 WHERE id=$1', [
        id,
      ]);
      await this.event(c, id, userId, p.revision + 1, 'project.trashed', []);
      return { ok: true };
    });
  }
  async listTrash(userId) {
    await this.cleanupTrash();
    const projects = (
      await this.pool.query(
        'SELECT p.id,p.id AS "projectId",p.name,\'project\' AS type,p.deleted_at AS "deletedAt",p.deleted_at+interval \'30 days\' AS "expiresAt" FROM pm_projects p JOIN pm_project_access a ON a.project_id=p.id WHERE a.user_id=$1 AND a.role=\'owner\' AND p.deleted_at IS NOT NULL',
        [userId],
      )
    ).rows;
    const tasks = (
      await this.pool.query(
        "SELECT t.id,t.project_id AS \"projectId\",p.name,'tasks' AS type,t.deleted_at AS \"deletedAt\",t.deleted_at+interval '30 days' AS \"expiresAt\",jsonb_array_length(t.document->'tasks') AS count FROM pm_deleted_tasks t JOIN pm_projects p ON p.id=t.project_id JOIN pm_project_access a ON a.project_id=p.id WHERE a.user_id=$1 AND a.role IN ('owner','editor') AND p.deleted_at IS NULL",
        [userId],
      )
    ).rows;
    return [...projects, ...tasks].sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
  }
  async restoreTrash(userId, type, id) {
    return this.transaction(async (c) => {
      if (type === 'project') {
        const row = (
          await c.query(
            "SELECT p.*,a.role FROM pm_projects p JOIN pm_project_access a ON a.project_id=p.id WHERE p.id=$1 AND a.user_id=$2 AND a.role='owner' AND p.deleted_at>now()-interval '30 days' FOR UPDATE OF p",
            [id, userId],
          )
        ).rows[0];
        if (!row) fail(404, 'TRASH_NOT_FOUND', '복구할 프로젝트가 없거나 보관 기간이 지났습니다.');
        await c.query('UPDATE pm_projects SET deleted_at=NULL,revision=revision+1 WHERE id=$1', [
          id,
        ]);
        await this.event(c, id, userId, row.revision + 1, 'project.restored', []);
        return { ok: true, projectId: id, adjustments: [] };
      }
      const entry = (
        await c.query(
          "SELECT project_id FROM pm_deleted_tasks WHERE id=$1 AND deleted_at>now()-interval '30 days'",
          [id],
        )
      ).rows[0];
      if (!entry) fail(404, 'TRASH_NOT_FOUND', '복구할 업무가 없거나 보관 기간이 지났습니다.');
      const row = await this.access(c, userId, entry.project_id, 'editor', true),
        record = (
          await c.query(
            "SELECT document FROM pm_deleted_tasks WHERE id=$1 AND deleted_at>now()-interval '30 days' FOR UPDATE",
            [id],
          )
        ).rows[0];
      if (!record) fail(409, 'TRASH_CHANGED', '이미 복구한 업무입니다.');
      const before = await this.hydrate(c, row),
        restored = restoreTaskBundle(before, record.document);
      await this.writeDocument(c, row.id, restored.project);
      await c.query('UPDATE pm_projects SET revision=revision+1,updated_at=now() WHERE id=$1', [
        row.id,
      ]);
      await c.query('DELETE FROM pm_deleted_tasks WHERE id=$1', [id]);
      await this.event(
        c,
        row.id,
        userId,
        row.revision + 1,
        'tasks.restored',
        record.document.tasks.map((t) => ({
          entity: 'task',
          action: 'restore',
          after: { id: t.id, name: t.name },
        })),
      );
      return { ok: true, projectId: row.id, adjustments: restored.adjustments };
    });
  }
  async backupStatus() {
    const settings = (
      await this.pool.query(
        'SELECT enabled,hour,retention_days AS "retentionDays",verify_restore AS "verifyRestore",revision,next_run_at AS "nextRunAt",requested,worker_seen_at AS "workerSeenAt",lease_until AS "leaseUntil" FROM pm_backup_settings WHERE id=true',
      )
    ).rows[0];
    const runs = (
      await this.pool.query(
        'SELECT id,started_at AS "startedAt",finished_at AS "finishedAt",state,filename,bytes,verified,message FROM pm_backup_runs ORDER BY started_at DESC LIMIT 20',
      )
    ).rows;
    return { settings, runs };
  }
  async saveBackupSettings(actorId, b) {
    return this.transaction(async (c) => {
      const a = (
        await c.query('SELECT is_admin,is_active FROM pm_users WHERE id=$1 FOR NO KEY UPDATE', [
          actorId,
        ])
      ).rows[0];
      if (!a?.is_admin || !a.is_active) fail(403, 'FORBIDDEN', '관리자 권한이 필요합니다.');
      const r = await c.query(
        "UPDATE pm_backup_settings SET enabled=$2,hour=$3,retention_days=$4,verify_restore=$5,revision=revision+1,updated_by=$1,next_run_at=((date_trunc('day',now() AT TIME ZONE 'Asia/Seoul')+($3::integer*interval '1 hour')+CASE WHEN extract(hour FROM now() AT TIME ZONE 'Asia/Seoul')>=$3::integer THEN interval '1 day' ELSE interval '0 day' END) AT TIME ZONE 'Asia/Seoul') WHERE id=true AND revision=$6 RETURNING id",
        [actorId, b.enabled, b.hour, b.retentionDays, b.verifyRestore, b.revision],
      );
      if (!r.rowCount)
        fail(409, 'BACKUP_CONFLICT', '다른 관리자가 설정을 변경했습니다. 다시 열어 주세요.');
      return { ok: true };
    });
  }
  async requestBackup(actorId) {
    return this.transaction(async (c) => {
      const a = (
        await c.query('SELECT is_admin,is_active FROM pm_users WHERE id=$1 FOR NO KEY UPDATE', [
          actorId,
        ])
      ).rows[0];
      if (!a?.is_admin || !a.is_active) fail(403, 'FORBIDDEN', '관리자 권한이 필요합니다.');
      const r = await c.query(
        'UPDATE pm_backup_settings SET requested=true WHERE id=true AND NOT requested AND (lease_until IS NULL OR lease_until<now()) RETURNING id',
      );
      if (!r.rowCount) fail(409, 'BACKUP_RUNNING', '이미 백업 요청이 대기 중이거나 실행 중입니다.');
      return { ok: true };
    });
  }
}
