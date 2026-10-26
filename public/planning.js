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
} from './engine.js';

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
  const result = new Map(
    project.tasks.map((t) => [
      t.id,
      { hours: taskHours(t), done: earned(t, at), start: t.start, end: t.end, count: 1 },
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
  const h = hierarchy(project),
    tasks = project.tasks.filter((t) => t.id === id || h.get(t.id).ancestors.includes(id));
  const hours = tasks.reduce((n, t) => n + taskHours(t), 0),
    done = tasks.reduce((n, t) => n + earned(t, at), 0);
  return {
    hours,
    done,
    progress: hours ? done / hours : 0,
    start: tasks.map((t) => t.start).sort()[0],
    end: tasks
      .map((t) => t.end)
      .sort()
      .at(-1),
    count: tasks.length,
  };
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
  return p;
}
export function captureBaseline(project, name = '기준 계획') {
  return {
    name,
    createdAt: new Date().toISOString(),
    tasks: project.tasks.map((t) => ({
      id: t.id,
      name: t.name,
      start: t.start,
      end: t.end,
      hours: taskHours(t),
      parentId: t.parentId || '',
    })),
  };
}
export function baselineDiff(project) {
  const old = new Map((project.baseline?.tasks || []).map((t) => [t.id, t])),
    current = new Set(project.tasks.map((t) => t.id));
  return {
    rows: project.tasks.map((t) => {
      const b = old.get(t.id);
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
  if (!project.tasks.length) return { ids: new Set(), slack: {}, duration: 0 };
  const tasks = orderTasks(project.tasks),
    origin = tasks.map((t) => t.start).sort()[0],
    h = project.holidays || [],
    early = Object.create(null),
    finish = Object.create(null),
    successors = new Map(tasks.map((t) => [t.id, []]));
  for (const t of tasks) {
    if (t.predecessor) successors.get(t.predecessor).push(t.id);
    const release = workdays(origin, addDays(t.start, -1), h),
      duration = workdays(t.start, t.end, h);
    early[t.id] = Math.max(release, t.predecessor ? finish[t.predecessor] : 0);
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
  const dependencies = project.tasks.filter(
      (t) => t.predecessor && t.start <= project.tasks.find((p) => p.id === t.predecessor)?.end,
    ),
    overloads = [];
  for (const member of project.members) {
    const events = new Map(),
      capacity = (member.hours * member.allocation) / 100;
    for (const t of project.tasks.filter((t) => t.owner === member.id)) {
      const rate = taskHours(t) / workdays(t.start, t.end, project.holidays);
      events.set(t.start, (events.get(t.start) || 0) + rate);
      const end = addDays(t.end, 1);
      events.set(end, (events.get(end) || 0) - rate);
    }
    const dates = [...events.keys()].sort();
    let load = 0;
    for (let i = 0; i < dates.length - 1; i++) {
      load += events.get(dates[i]);
      const from = dates[i],
        to = addDays(dates[i + 1], -1);
      if (load > capacity + 0.0001 && workdays(from, to, project.holidays) > 0)
        overloads.push({ memberId: member.id, name: member.name, from, to, load, capacity });
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
    b.tasks.length > 500
  )
    throw Error('기준 계획 형식을 확인해 주세요.');
  const seen = new Set();
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
      t.hours > 2000000
    )
      throw Error('기준 계획의 업무를 확인해 주세요.');
    seen.add(t.id);
  }
  return project;
}
