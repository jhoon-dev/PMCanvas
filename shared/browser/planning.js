import { projectHolidays } from './korean-holidays.js';
import {
  taskHours,
  earned,
  workdays,
  working,
  addDays,
  daysBetween,
  orderTasks,
  today,
  validDate,
  nextWorkday,
  capacityCalendar,
} from './engine.js';
import {
  LIMITS,
  normalizeTaskModel,
  taskView,
  summaryIds,
  predecessorIds,
  executionTasks,
  taskIndex,
} from './task-model.js';

export function hierarchy(project) {
  const map = new Map(project.tasks.map((t) => [t.id, t])),
    children = new Map(),
    info = new Map();
  for (const t of project.tasks) {
    const parent = t.parentId || '';
    if (parent && !map.has(parent)) throw Error('존재하지 않는 상위 업무입니다.');
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(t);
  }
  const visit = (t, path, ancestors) => {
    if (path.length > 20) throw Error('WBS 계층은 20단계까지 지원합니다.');
    if (ancestors.has(t.id)) throw Error('상위 업무가 순환합니다.');
    const next = new Set([...ancestors, t.id]);
    info.set(t.id, {
      number: path.join('.'),
      depth: path.length - 1,
      ancestors: [...ancestors],
      children: children.get(t.id) || [],
    });
    (children.get(t.id) || []).forEach((c, i) => visit(c, [...path, i + 1], next));
  };
  (children.get('') || []).forEach((t, i) => visit(t, [i + 1], new Set()));
  if (info.size !== map.size) throw Error('상위 업무가 순환합니다.');
  return info;
}
export function ordered(project) {
  const h = hierarchy(project),
    tasks = new Map(project.tasks.map((t) => [t.id, t]));
  return [...h.keys()].map((id) => tasks.get(id));
}
export function rollups(project, at = today(), tree = hierarchy(project)) {
  const index = taskIndex(project),
    summaries = index.summaries;
  const result = new Map(
    project.tasks.map((t) => [
      t.id,
      {
        hours: summaries.has(t.id) ? 0 : taskHours(t),
        done: summaries.has(t.id) ? 0 : earned(t, at),
        start: taskView(project, t, index).start,
        end: taskView(project, t, index).end,
        count: summaries.has(t.id) ? 0 : 1,
      },
    ]),
  );
  for (const id of [...tree.keys()].reverse()) {
    const node = tree.get(id),
      value = result.get(id);
    value.progress = value.hours ? value.done / value.hours : 0;
    const parent = result.get(node.ancestors.at(-1));
    if (parent) {
      parent.hours += value.hours;
      parent.done += value.done;
      parent.count += value.count;
      if (value.start < parent.start) parent.start = value.start;
      if (value.end > parent.end) parent.end = value.end;
    }
  }
  return result;
}
export function rollup(project, id, at = today()) {
  return rollups(project, at).get(id);
}
export function setParent(project, ids, direction) {
  const p = structuredClone(project),
    list = ordered(p),
    selected = new Set(ids),
    h = hierarchy(p);
  const roots = list.filter(
    (t) => selected.has(t.id) && !h.get(t.id).ancestors.some((id) => selected.has(id)),
  );
  if (!roots.length) throw Error('업무를 선택해 주세요.');
  for (const t of roots) {
    if (direction < 0) {
      const parent = p.tasks.find((x) => x.id === t.parentId);
      if (parent) t.parentId = parent.parentId || '';
    } else {
      const siblings = list.filter(
          (x) => (x.parentId || '') === (t.parentId || '') && !selected.has(x.id),
        ),
        prior = siblings.filter((x) => list.indexOf(x) < list.indexOf(t)).at(-1);
      if (!prior) throw Error('앞에 같은 수준의 업무가 있어야 들여쓸 수 있습니다.');
      t.parentId = prior.id;
    }
  }
  hierarchy(p);
  return normalizeTaskModel(p);
}
export function captureBaseline(project, name = '기준 계획') {
  const index = taskIndex(project);
  return {
    name,
    createdAt: new Date().toISOString(),
    tasks: project.tasks.map((task) => {
      const t = taskView(project, task, index);
      return {
        id: t.id,
        name: t.name,
        start: t.start,
        end: t.end,
        hours: taskHours(t),
        parentId: t.parentId || '',
        ...(t.kind === 'milestone' ? { kind: 'milestone' } : {}),
      };
    }),
  };
}
export function baselineDiff(project) {
  const index = taskIndex(project),
    old = new Map((project.baseline?.tasks || []).map((t) => [t.id, t])),
    current = new Set(project.tasks.map((t) => t.id));
  return {
    rows: project.tasks.map((t) => {
      const b = old.get(t.id);
      t = taskView(project, t, index);
      return {
        id: t.id,
        name: t.name,
        added: !b,
        start: b ? daysBetween(b.start, t.start) : null,
        end: b ? daysBetween(b.end, t.end) : null,
        hours: b ? taskHours(t) - b.hours : null,
        renamed: b && b.name !== t.name,
        reparented: b && (b.parentId || '') !== (t.parentId || ''),
      };
    }),
    removed: [...old.values()].filter((t) => !current.has(t.id)),
  };
}
export function criticalPath(project) {
  const tasks = orderTasks(executionTasks(project));
  if (!tasks.length) return { ids: new Set(), slack: {}, duration: 0 };
  const origin = tasks.map((t) => t.start).sort()[0],
    h = projectHolidays(project),
    early = Object.create(null),
    finish = Object.create(null),
    successors = new Map(tasks.map((t) => [t.id, []]));
  for (const t of tasks) {
    for (const id of predecessorIds(t)) successors.get(id).push(t.id);
    const release = workdays(origin, t.kind === 'milestone' ? t.start : addDays(t.start, -1), h),
      duration = t.kind === 'milestone' ? 0 : workdays(t.start, t.end, h);
    early[t.id] = Math.max(release, ...predecessorIds(t).map((id) => finish[id]));
    finish[t.id] = early[t.id] + duration;
  }
  const duration = Math.max(...Object.values(finish)),
    late = Object.create(null),
    slack = Object.create(null);
  for (const t of [...tasks].reverse()) {
    const next = successors.get(t.id),
      end = next.length ? Math.min(...next.map((id) => late[id])) : duration;
    late[t.id] = end - (finish[t.id] - early[t.id]);
    slack[t.id] = late[t.id] - early[t.id];
  }
  return { ids: new Set(tasks.filter((t) => slack[t.id] === 0).map((t) => t.id)), slack, duration };
}
export function scheduleWarnings(project) {
  const tasks = executionTasks(project),
    calendar = capacityCalendar(project),
    byId = new Map(tasks.map((t) => [t.id, t]));
  const dependencies = tasks.filter((t) =>
      predecessorIds(t).some((id) =>
        t.kind === 'milestone' ? t.start < byId.get(id)?.end : t.start <= byId.get(id)?.end,
      ),
    ),
    overloads = [];
  for (const member of project.members) {
    const events = new Map();
    for (const t of tasks.filter((t) => t.owner === member.id && t.kind !== 'milestone')) {
      const duration = workdays(t.start, t.end, projectHolidays(project));
      if (!duration) continue;
      const rate = taskHours(t) / duration;
      events.set(t.start, (events.get(t.start) || 0) + rate);
      const end = addDays(t.end, 1);
      events.set(end, (events.get(end) || 0) - rate);
    }
    const bounds = [...events.keys()].sort();
    if (bounds.length) {
      for (const s of calendar.segments(member.id, bounds[0], bounds.at(-1)))
        if (!events.has(s.from)) events.set(s.from, 0);
    }
    const dates = [...events.keys()].sort();
    let load = 0;
    for (let i = 0; i < dates.length - 1; i++) {
      load += events.get(dates[i]);
      const from = dates[i],
        to = addDays(dates[i + 1], -1),
        capacity = calendar.hours(member.id, from);
      if (load > capacity + 0.0001 && workdays(from, to, projectHolidays(project)) > 0) {
        const first = nextWorkday(from, projectHolidays(project));
        let last = to;
        while (!working(last, projectHolidays(project))) last = addDays(last, -1);
        overloads.push({
          memberId: member.id,
          name: member.name,
          from: first,
          to: last,
          load,
          capacity,
        });
      }
    }
  }
  return { dependencies, overloads };
}

export function validatePlanning(project) {
  hierarchy(project);
  const b = project.baseline;
  if (b == null) return project;
  if (
    typeof b !== 'object' ||
    typeof b.name !== 'string' ||
    !b.name.trim() ||
    b.name.length > 80 ||
    typeof b.createdAt !== 'string' ||
    b.createdAt.length > 40 ||
    !Number.isFinite(Date.parse(b.createdAt)) ||
    !Array.isArray(b.tasks) ||
    b.tasks.length > LIMITS.tasks
  )
    throw Error('기준 계획 형식을 확인해 주세요.');
  const seen = new Set(),
    parents = new Set(b.tasks.map((t) => t.parentId));
  for (const t of b.tasks) {
    if (
      typeof t.id !== 'string' ||
      seen.has(t.id) ||
      typeof t.name !== 'string' ||
      !t.name.trim() ||
      t.name.length > 200 ||
      !validDate(t.start) ||
      !validDate(t.end) ||
      t.start > t.end ||
      !Number.isFinite(t.hours) ||
      t.hours < 0 ||
      t.hours > LIMITS.baselineHours * (parents.has(t.id) ? LIMITS.workTasks : 1)
    )
      throw Error('기준 계획의 업무를 확인해 주세요.');
    seen.add(t.id);
  }
  return project;
}
