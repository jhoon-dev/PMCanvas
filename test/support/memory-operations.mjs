import { randomUUID } from 'node:crypto';
import { fail } from '../../server/errors.mjs';
import { deletedTaskBundle, restoreTaskBundle } from '../../server/workspace-model.mjs';
import { alertConfig, alertKinds } from '../../server/operation-alerts.mjs';
export class MemoryOperations {
  async operationAlerts() {
    this.alertSettings ??= { enabled: false, recipients: [], revision: 0 };
    this.operationFailures ??= new Map();
    return {
      settings: structuredClone(this.alertSettings),
      alerts: structuredClone([...this.operationFailures.values()]),
    };
  }
  async recordOperationFailure(kind) {
    if (!alertKinds.includes(kind)) throw Error('Invalid operation alert kind.');
    await this.operationAlerts();
    const now = new Date().toISOString(),
      old = this.operationFailures.get(kind);
    this.operationFailures.set(
      kind,
      old
        ? { ...old, occurrences: old.occurrences + 1, lastAt: now }
        : {
            kind,
            occurrences: 1,
            acknowledged: 0,
            notified: 0,
            attempts: 0,
            firstAt: now,
            lastAt: now,
          },
    );
  }
  async saveAlertSettings(actor, body) {
    this.admin(actor);
    await this.operationAlerts();
    const b = alertConfig(body);
    if (b.revision !== this.alertSettings.revision) fail(409, 'ALERT_CONFLICT', '알림 설정 충돌');
    this.alertSettings = { ...b, revision: b.revision + 1 };
    return this.operationAlerts();
  }
  async acknowledgeAlert(actor, kind, count) {
    this.admin(actor);
    await this.operationAlerts();
    if (!alertKinds.includes(kind) || !Number.isSafeInteger(count) || count < 1)
      fail(400, 'INVALID_ALERT', '잘못된 알림');
    const row = this.operationFailures.get(kind);
    if (row) row.acknowledged = Math.max(row.acknowledged, Math.min(row.occurrences, count));
    return this.operationAlerts();
  }
  admin(id) {
    const u = this.users.get(id);
    if (!u?.is_admin || u.is_active === false) fail(403, 'FORBIDDEN', '관리자 필요');
  }
  async adminSummary() {
    const all = [...this.users.values()];
    return {
      pending: all.filter((u) => u.registration_pending && u.email_verified_at).length,
      unverified: all.filter((u) => u.registration_pending && !u.email_verified_at).length,
    };
  }
  async decideRegistration(actor, id, { decision, reason, grants }) {
    this.admin(actor);
    const u = this.users.get(id);
    if (!u?.registration_pending || u.is_admin) fail(409, 'REGISTRATION_CHANGED', '이미 처리');
    if (decision === 'approve' && !u.email_verified_at) fail(409, 'EMAIL_UNVERIFIED', '인증 필요');
    for (const g of grants) this.access(actor, g.projectId, 'owner');
    Object.assign(u, {
      registration_pending: false,
      registration_rejected: decision === 'reject',
      rejection_reason: reason,
      is_active: decision === 'approve',
    });
    this.verifications.delete(id);
    this.revokeSessions(id);
    if (decision === 'approve') {
      for (const g of grants) this.projects.get(g.projectId).roles[id] = g.role;
      this.notices.set(id, { state: 'pending', attempts: 0, available: 0 });
    } else
      for (const n of this.reviewNotices.values())
        if (n.userId === id && n.state !== 'sent') n.state = 'cancelled';
    return { ok: true };
  }
  async memberAccounts(user, id) {
    this.access(user, id, 'owner');
    return structuredClone(this.links?.get(id) || []);
  }
  async setMemberAccount(user, id, { memberId, userId }) {
    const p = this.access(user, id, 'owner');
    if (!p.data.members.some((m) => m.id === memberId)) fail(404, 'MEMBER_NOT_FOUND', '인력 없음');
    if (userId && (!p.roles[userId] || this.users.get(userId)?.is_active === false))
      fail(400, 'MEMBER_ACCOUNT', '공유된 활성 계정 필요');
    this.links ??= new Map();
    const rows = (this.links.get(id) || []).filter(
      (l) => l.memberId !== memberId && l.userId !== userId,
    );
    if (userId) rows.push({ memberId, userId });
    this.links.set(id, rows);
    return { ok: true };
  }
  async myWork(user) {
    return [...this.projects.values()]
      .filter(
        (p) =>
          !p.deletedAt && p.roles[user] && this.links?.get(p.id)?.some((l) => l.userId === user),
      )
      .map((p) => {
        const result = this.document(p, user),
          memberId = this.links.get(p.id).find((l) => l.userId === user).memberId;
        result.tasks = result.tasks.filter((t) => t.owner === memberId);
        return result;
      });
  }
  captureTasks(user, p, after) {
    const document = deletedTaskBundle(p.data, after);
    if (document) {
      this.trash ??= new Map();
      this.trash.set(randomUUID(), {
        projectId: p.id,
        document,
        deletedAt: new Date().toISOString(),
      });
    }
  }
  async trashProject(user, id, revision) {
    const p = this.access(user, id, 'owner');
    if (p.revision !== revision) fail(409, 'REVISION_CONFLICT', '버전 충돌');
    p.deletedAt = new Date().toISOString();
    p.revision++;
    return { ok: true };
  }
  async listTrash(user) {
    return [
      ...[...this.projects.values()]
        .filter((p) => p.deletedAt && p.roles[user] === 'owner')
        .map((p) => ({
          id: p.id,
          projectId: p.id,
          name: p.data.name,
          type: 'project',
          deletedAt: p.deletedAt,
        })),
      ...[...(this.trash || [])]
        .filter(([, t]) => {
          const p = this.projects.get(t.projectId);
          return p && !p.deletedAt && ['owner', 'editor'].includes(p.roles[user]);
        })
        .map(([id, t]) => ({
          id,
          projectId: t.projectId,
          name: this.projects.get(t.projectId).data.name,
          type: 'tasks',
          deletedAt: t.deletedAt,
          count: t.document.tasks.length,
        })),
    ]
      .map((t) => ({
        ...t,
        expiresAt: new Date(new Date(t.deletedAt).getTime() + 30 * 86400000).toISOString(),
      }))
      .filter((t) => new Date(t.expiresAt) > new Date());
  }
  async restoreTrash(user, type, id) {
    if (type === 'project') {
      const p = this.projects.get(id);
      if (!p?.deletedAt || p.roles[user] !== 'owner') fail(404, 'TRASH_NOT_FOUND', '없음');
      p.deletedAt = null;
      p.revision++;
      return { ok: true, projectId: id, adjustments: [] };
    }
    const t = this.trash?.get(id);
    if (!t) fail(404, 'TRASH_NOT_FOUND', '없음');
    const p = this.access(user, t.projectId, 'editor'),
      r = restoreTaskBundle(p.data, t.document);
    p.data = r.project;
    p.revision++;
    this.trash.delete(id);
    return { ok: true, projectId: p.id, adjustments: r.adjustments };
  }
  async backupStatus() {
    this.backup ??= {
      enabled: true,
      hour: 3,
      retentionDays: 14,
      verifyRestore: true,
      revision: 0,
      nextRunAt: new Date().toISOString(),
      requested: false,
    };
    return { settings: structuredClone(this.backup), runs: [] };
  }
  async saveBackupSettings(actor, b) {
    this.admin(actor);
    await this.backupStatus();
    if (this.backup.revision !== b.revision) fail(409, 'BACKUP_CONFLICT', '충돌');
    Object.assign(this.backup, b, { revision: b.revision + 1 });
    return { ok: true };
  }
  async requestBackup(actor) {
    this.admin(actor);
    await this.backupStatus();
    if (this.backup.requested) fail(409, 'BACKUP_RUNNING', '실행 중');
    this.backup.requested = true;
    return { ok: true };
  }
}
