import { validDate } from '../public/engine.js';
import { validateProject } from '../public/engine.js';
import { hierarchy } from '../public/planning.js';
import { fail } from './errors.mjs';
export const uuid = (value) =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const id = (value) => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value))
    fail(400, 'INVALID_ID', '항목 ID가 올바르지 않습니다.');
  return value;
};
const text = (value, max, optional = false) => {
  if (optional && value == null) return '';
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim()))
    fail(400, 'INVALID_PROJECT', '입력한 텍스트의 길이와 형식을 확인해 주세요.');
  return value;
};
const finite = (value, min, max) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    fail(400, 'INVALID_PROJECT', '시간과 투입률을 확인해 주세요.');
  return value;
};
export function cleanProject(input) {
  try {
    if (
      !input ||
      typeof input !== 'object' ||
      !Array.isArray(input.members) ||
      !Array.isArray(input.tasks)
    )
      fail(400, 'INVALID_PROJECT', '프로젝트 형식을 확인해 주세요.');
    if (input.members.length > 200 || input.tasks.length > 500)
      fail(400, 'INVALID_PROJECT', '인력 200명, 업무 500개까지 지원합니다.');
    const p = {
      name: text(input.name, 120),
      description: text(input.description, 300, true),
      demo: input.demo === true,
      holidays: input.holidays ?? [],
      members: input.members.map((m) => ({
        id: id(m.id),
        name: text(m.name, 80),
        role: text(m.role, 40, true),
        grade: text(m.grade, 40, true),
        hours: finite(m.hours, 0.1, 16),
        allocation: finite(m.allocation, 1, 100),
      })),
      tasks: input.tasks.map((t) => {
        if (!Array.isArray(t.items) || t.items.length > 200)
          fail(400, 'INVALID_PROJECT', '세부 작업은 업무당 200개까지 지원합니다.');
        return {
          ...(t.parentId ? { parentId: id(t.parentId) } : {}),
          id: id(t.id),
          name: text(t.name, 200),
          phase: text(t.phase, 50, true),
          owner: t.owner === '' ? '' : id(t.owner),
          start: t.start,
          end: t.end,
          predecessor: t.predecessor ? id(t.predecessor) : '',
          memo: text(t.memo, 2000, true),
          items: t.items.map((i) => ({
            id: id(i.id),
            title: text(i.title, 300),
            hours: finite(i.hours, 0.1, 10000),
            doneDate: i.doneDate == null ? null : i.doneDate,
          })),
        };
      }),
    };
    hierarchy(p);
    if (input.baseline != null) {
      const b = input.baseline;
      if (
        !b ||
        typeof b !== 'object' ||
        !Array.isArray(b.tasks) ||
        b.tasks.length > 500 ||
        typeof b.createdAt !== 'string' ||
        b.createdAt.length > 40 ||
        !Number.isFinite(Date.parse(b.createdAt))
      )
        fail(400, 'INVALID_BASELINE', '기준 계획 형식을 확인해 주세요.');
      const seen = new Set();
      p.baseline = {
        name: text(b.name, 80),
        createdAt: b.createdAt,
        tasks: b.tasks.map((t) => {
          const key = id(t.id);
          if (
            seen.has(key) ||
            !validDate(t.start) ||
            !validDate(t.end) ||
            t.start > t.end ||
            !Number.isFinite(t.hours) ||
            t.hours < 0 ||
            t.hours > 2000000
          )
            fail(400, 'INVALID_BASELINE', '기준 계획의 업무를 확인해 주세요.');
          seen.add(key);
          return {
            id: key,
            name: text(t.name, 200),
            start: t.start,
            end: t.end,
            hours: t.hours,
            parentId: t.parentId ? id(t.parentId) : '',
          };
        }),
      };
    }
    validateProject(p);
    return p;
  } catch (error) {
    if (error.status) throw error;
    fail(400, 'INVALID_PROJECT', error.message || '프로젝트를 확인해 주세요.');
  }
}
export function projectChanges(before, after) {
  const changes = [];
  const add = (entity, oldRows, newRows) => {
    const old = new Map(oldRows.map((x) => [x.id, x])),
      next = new Map(newRows.map((x) => [x.id, x]));
    for (const key of new Set([...old.keys(), ...next.keys()])) {
      const a = old.get(key) ?? null,
        b = next.get(key) ?? null;
      if (JSON.stringify(a) !== JSON.stringify(b))
        changes.push({
          entity,
          id: key,
          action: !a ? 'create' : !b ? 'delete' : 'update',
          before: a,
          after: b,
        });
    }
  };
  const meta = (p) =>
    p
      ? {
          id: 'project',
          name: p.name,
          description: p.description,
          holidays: p.holidays,
          demo: p.demo,
          baseline: p.baseline ?? null,
        }
      : null;
  add('project', before ? [meta(before)] : [], [meta(after)]);
  add(
    'member',
    (before?.members || []).map((m, position) => ({ ...m, position })),
    after.members.map((m, position) => ({ ...m, position })),
  );
  const taskMeta = (t, position) => {
    const { items, ...rest } = t;
    return { ...rest, position };
  };
  add('task', (before?.tasks || []).map(taskMeta), after.tasks.map(taskMeta));
  const items = (p) =>
    (p?.tasks || []).flatMap((t) =>
      t.items.map((i, position) => ({ ...i, taskId: t.id, position })),
    );
  add('item', items(before), items(after));
  return changes;
}
