import { validateProject } from './engine.js';
import { validatePlanning } from './planning.js';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const copy = (v) => (v === undefined ? undefined : structuredClone(v));
const entities = new Set(['tasks', 'members', 'items']);

// A three-way merge never changes the inputs or trusts client-side permission metadata.
export function mergeProject(base, mine, latest, choices = {}) {
  if (!base || base.id !== mine.id || base.id !== latest.id) throw Error('프로젝트가 다릅니다.');
  const conflicts = [];
  function merge(a, b, c, path) {
    if (same(b, c)) return copy(b);
    if (same(a, b)) return copy(c);
    if (same(a, c)) return copy(b);
    if (entities.has(path.at(-1)) && [a, b, c].every(Array.isArray)) {
      const maps = [a, b, c].map((rows) => new Map(rows.map((row) => [row.id, row])));
      const ids = [...new Set([...c, ...b].map((row) => row.id))];
      // Preserve a sole local reorder; simultaneous conflicting orders require a choice.
      const shared = new Set(
        a.filter((x) => maps[1].has(x.id) && maps[2].has(x.id)).map((x) => x.id),
      );
      const orders = [a, b, c].map((rows) => rows.filter((x) => shared.has(x.id)).map((x) => x.id));
      const reorderedMine = !same(orders[0], orders[1]),
        reorderedServer = !same(orders[0], orders[2]);
      const chosen =
        reorderedMine && reorderedServer && !same(orders[1], orders[2])
          ? merge(orders[0], orders[1], orders[2], [...path, '$order'])
          : (reorderedMine ? b : c).map((x) => x.id);
      const order = [...chosen, ...ids];
      const rows = new Map(
        ids.map((id) => [
          id,
          merge(maps[0].get(id), maps[1].get(id), maps[2].get(id), [...path, id]),
        ]),
      );
      return [...new Set([...order, ...ids])]
        .map((id) => rows.get(id))
        .filter((v) => v !== undefined);
    }
    if ([a, b, c].every((v) => v && !Array.isArray(v) && typeof v === 'object')) {
      const out = {};
      for (const key of new Set([...Object.keys(a), ...Object.keys(b), ...Object.keys(c)])) {
        if (key.startsWith('_')) continue;
        const value = merge(a[key], b[key], c[key], [...path, key]);
        if (value !== undefined) out[key] = value;
      }
      return out;
    }
    const key = JSON.stringify(path);
    if (!['mine', 'server'].includes(choices[key]))
      conflicts.push({ key, path, base: copy(a), mine: copy(b), server: copy(c) });
    return copy(choices[key] === 'mine' ? b : c);
  }
  const project = merge(base, mine, latest, []);
  project.id = latest.id;
  project._revision = latest._revision;
  project._role = latest._role;
  delete project._wbsPendingCells;
  return { project, conflicts };
}
export function resolvedProject(base, mine, latest, choices) {
  if (latest._role === 'viewer') throw Error('조회자는 프로젝트를 수정할 수 없습니다.');
  const result = mergeProject(base, mine, latest, choices);
  if (result.conflicts.length) throw Error('충돌 항목마다 유지할 값을 선택해 주세요.');
  validateProject(result.project);
  validatePlanning(result.project);
  return result.project;
}
