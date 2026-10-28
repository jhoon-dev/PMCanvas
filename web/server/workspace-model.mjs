import { cleanProject, uuid } from './project.mjs';
import { fail } from './errors.mjs';

export function registrationDecision(body) {
  if (!['approve', 'reject'].includes(body.decision))
    fail(400, 'INVALID_DECISION', '승인 또는 거절을 선택해 주세요.');
  const reason = body.reason ?? '',
    grants = body.grants ?? [];
  if (
    typeof reason !== 'string' ||
    reason.length > 500 ||
    !Array.isArray(grants) ||
    grants.length > 20 ||
    (body.decision === 'reject' && grants.length)
  )
    fail(400, 'INVALID_DECISION', '거절 사유와 프로젝트 선택을 확인해 주세요.');
  const ids = new Set();
  for (const g of grants) {
    if (!g || !uuid(g.projectId) || !['editor', 'viewer'].includes(g.role) || ids.has(g.projectId))
      fail(400, 'INVALID_GRANT', '프로젝트와 편집자·조회자 권한을 확인해 주세요.');
    ids.add(g.projectId);
  }
  return {
    decision: body.decision,
    reason: reason.trim(),
    grants: grants
      .map((g) => ({ projectId: g.projectId, role: g.role }))
      .sort((a, b) => a.projectId.localeCompare(b.projectId)),
  };
}
export function deletedTaskBundle(before, after) {
  const ids = new Set(
    before.tasks.filter((t) => !after.tasks.some((n) => n.id === t.id)).map((t) => t.id),
  );
  if (!ids.size) return null;
  return {
    tasks: before.tasks.filter((t) => ids.has(t.id)),
    positions: Object.fromEntries(before.tasks.map((t, i) => [t.id, i])),
    links: before.tasks
      .filter((t) => !ids.has(t.id) && (ids.has(t.predecessor) || ids.has(t.parentId)))
      .map((t) => ({ id: t.id, predecessor: t.predecessor, parentId: t.parentId })),
  };
}
export function restoreTaskBundle(current, bundle) {
  const p = structuredClone(current),
    adjustments = [],
    ids = new Set(p.tasks.map((t) => t.id)),
    members = new Set(p.members.map((m) => m.id));
  if (bundle.tasks.some((t) => ids.has(t.id)))
    fail(409, 'RESTORE_CONFLICT', '같은 ID의 업무가 이미 있습니다. 현재 업무를 확인해 주세요.');
  for (const t of bundle.tasks) ids.add(t.id);
  for (const saved of bundle.tasks) {
    const t = structuredClone(saved);
    if (t.owner && !members.has(t.owner)) {
      t.owner = '';
      adjustments.push(t.name + ' · 담당자 미지정');
    }
    if (t.predecessor && !ids.has(t.predecessor)) {
      t.predecessor = '';
      adjustments.push(t.name + ' · 선행 연결 해제');
    }
    if (t.parentId && !ids.has(t.parentId)) {
      delete t.parentId;
      adjustments.push(t.name + ' · 상위 연결 해제');
    }
    p.tasks.splice(Math.min(bundle.positions[t.id] ?? p.tasks.length, p.tasks.length), 0, t);
  }
  for (const link of bundle.links || []) {
    const t = p.tasks.find((t) => t.id === link.id);
    if (!t) continue;
    if (!t.predecessor && ids.has(link.predecessor)) t.predecessor = link.predecessor;
    if (!t.parentId && ids.has(link.parentId)) t.parentId = link.parentId;
  }
  return { project: cleanProject(p), adjustments };
}
export function backupSettings(body) {
  if (body.timeZone !== undefined) {
    try {
      if (
        typeof body.timeZone !== 'string' ||
        body.timeZone.length > 100 ||
        !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(body.timeZone)
      )
        throw Error();
      new Intl.DateTimeFormat('en', { timeZone: body.timeZone });
    } catch {
      fail(400, 'INVALID_BACKUP_SETTINGS', '올바른 IANA 시간대를 입력해 주세요.');
    }
  }
  if (
    typeof body.enabled !== 'boolean' ||
    typeof body.verifyRestore !== 'boolean' ||
    !Number.isInteger(body.hour) ||
    body.hour < 0 ||
    body.hour > 23 ||
    !Number.isInteger(body.retentionDays) ||
    body.retentionDays < 1 ||
    body.retentionDays > 365 ||
    !Number.isSafeInteger(body.revision) ||
    body.revision < 0
  )
    fail(400, 'INVALID_BACKUP_SETTINGS', '백업 시간·보관 일수·복원 점검 설정을 확인해 주세요.');
  return {
    enabled: body.enabled,
    hour: body.hour,
    retentionDays: body.retentionDays,
    verifyRestore: body.verifyRestore,
    revision: body.revision,
    ...(body.timeZone === undefined ? {} : { timeZone: body.timeZone }),
  };
}
