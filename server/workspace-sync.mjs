import { fail } from './errors.mjs';

const uuid = (value) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
export function workspaceRequest(body) {
  if (!body || (body.activeId != null && !uuid(body.activeId)))
    fail(400, 'INVALID_WORKSPACE', '프로젝트 조회 정보를 확인해 주세요.');
  const known = (name) => {
    const values = body[name] ?? [];
    if (!Array.isArray(values) || values.length > 5000)
      fail(400, 'INVALID_WORKSPACE', '프로젝트 조회 정보를 확인해 주세요.');
    const result = new Map();
    for (const value of values) {
      if (
        !value ||
        !uuid(value.id) ||
        result.has(value.id) ||
        !Number.isSafeInteger(value.revision) ||
        value.revision < 1 ||
        !['owner', 'editor', 'viewer'].includes(value.role) ||
        (value.memberId != null &&
          (typeof value.memberId !== 'string' || value.memberId.length > 256))
      )
        fail(400, 'INVALID_WORKSPACE', '프로젝트 조회 정보를 확인해 주세요.');
      result.set(value.id, value);
    }
    return result;
  };
  return { activeId: body.activeId ?? null, known: known('known'), mine: known('mine') };
}

export function projectSummary(row) {
  return { id: row.id, name: row.name, demo: row.demo, _revision: row.revision, _role: row.role };
}
const current = (known, row, mine = false) =>
  known?.revision === row.revision &&
  known.role === row.role &&
  (!mine || known.memberId === row.member_id);

// Rows and all hydrated documents are read in the same permission-filtered snapshot.
export async function syncWorkspace(rows, request, hydrate) {
  const active = rows.find((row) => row.id === request.activeId) ?? rows[0];
  const project =
    active && !current(request.known.get(active.id), active)
      ? (await hydrate([active], false))[0]
      : null;
  const mineRows = rows.filter((row) => row.member_id);
  const changed = mineRows.filter((row) => !current(request.mine.get(row.id), row, true));
  const reuse = changed.find((row) => project && row.id === project.id);
  const remaining = changed.filter((row) => row !== reuse);
  const documents = remaining.length ? await hydrate(remaining, true) : [];
  const byId = new Map(documents.map((p) => [p.id, p]));
  if (reuse) byId.set(project.id, project);
  return {
    projects: rows.map(projectSummary),
    activeId: active?.id ?? null,
    project,
    myWork: {
      ids: mineRows.map((row) => row.id),
      projects: changed.map((row) => ({
        ...byId.get(row.id),
        _memberId: row.member_id,
        tasks: byId.get(row.id).tasks.filter((task) => task.owner === row.member_id),
      })),
    },
  };
}
