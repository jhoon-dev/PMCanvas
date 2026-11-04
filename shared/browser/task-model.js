// Shared task semantics. No browser, storage or date dependencies.
export const LIMITS = Object.freeze({
  members: 200,
  tasks: 1000,
  workTasks: 500,
  summaries: 500,
  items: 200,
  baselineHours: 2000000,
});

export function predecessorIds(task) {
  return task.predecessors === undefined
    ? task.predecessor
      ? [task.predecessor]
      : []
    : task.predecessors;
}
export function setPredecessors(task, ids) {
  const values = [...new Set(ids)];
  task.predecessor = values[0] || '';
  if (values.length > 1) task.predecessors = values;
  else delete task.predecessors;
}
export function summaryIds(project) {
  return new Set([
    ...project.tasks.filter((t) => t.kind === 'summary').map((t) => t.id),
    ...project.tasks.map((t) => t.parentId).filter(Boolean),
  ]);
}
export function taskLeaves(project) {
  const summaries = summaryIds(project);
  return project.tasks.filter((t) => !summaries.has(t.id));
}
export function descendants(project, id) {
  const children = new Map();
  for (const t of project.tasks) {
    if (!children.has(t.parentId)) children.set(t.parentId, []);
    children.get(t.parentId).push(t);
  }
  const out = [],
    seen = new Set([id]);
  const visit = (parent) => {
    for (const t of children.get(parent) || []) {
      if (seen.has(t.id)) throw Error('상위 업무가 순환합니다.');
      seen.add(t.id);
      out.push(t);
      visit(t.id);
    }
  };
  visit(id);
  return out;
}
// One index per calculation/render. Do not cache by project identity: drafts mutate in place.
export function taskIndex(project) {
  const byId = new Map(project.tasks.map((t) => [t.id, t])),
    children = new Map(),
    summaries = summaryIds(project),
    leaves = new Map(),
    views = new Map(),
    visiting = new Set();
  for (const t of project.tasks) {
    if (!children.has(t.parentId)) children.set(t.parentId, []);
    children.get(t.parentId).push(t);
  }
  const leavesOf = (id) => {
    if (!byId.has(id)) throw Error('존재하지 않는 선행 업무입니다.');
    if (!summaries.has(id)) return [byId.get(id)];
    if (leaves.has(id)) return leaves.get(id);
    if (visiting.has(id)) throw Error('상위 업무가 순환합니다.');
    visiting.add(id);
    const result = (children.get(id) || []).flatMap((t) => leavesOf(t.id));
    visiting.delete(id);
    leaves.set(id, result);
    return result;
  };
  const view = (task) => {
    if (!summaries.has(task.id)) return task;
    if (!views.has(task.id)) {
      const rows = leavesOf(task.id);
      views.set(task.id, {
        ...task,
        items: rows.flatMap((t) => t.items),
        start: rows.length
          ? rows.reduce((d, t) => (t.start < d ? t.start : d), rows[0].start)
          : task.start,
        end: rows.length ? rows.reduce((d, t) => (t.end > d ? t.end : d), rows[0].end) : task.end,
      });
    }
    return views.get(task.id);
  };
  return { byId, summaries, leavesOf, view };
}
export function taskView(project, task, index = taskIndex(project)) {
  return index.view(task);
}
// Mutates only a caller-owned draft. IDs are deterministic across devices and reloads.
export function normalizeTaskModel(project) {
  const summaries = summaryIds(project),
    mapping = new Map(),
    used = new Set([...project.tasks, ...(project.baseline?.tasks || [])].map((t) => t.id));
  const converted = [];
  for (const task of project.tasks) {
    converted.push(task);
    if (!summaries.has(task.id)) continue;
    if (task.kind === 'milestone') throw Error('마일스톤 아래에는 하위 업무를 둘 수 없습니다.');
    if (task.items.length) {
      let suffix = 0,
        id;
      do {
        id = task.id.slice(0, 60) + '-work' + (suffix++ || '');
      } while (used.has(id));
      used.add(id);
      mapping.set(task.id, id);
      converted.push({
        ...structuredClone(task),
        id,
        kind: undefined,
        name: task.name.slice(0, 180) + ' · 기존 자체 작업',
        parentId: task.id,
      });
      delete converted.at(-1).kind;
      task.items = [];
      // Legacy dependencies belonged to the actual work, not the whole subtree.
      setPredecessors(task, []);
    }
    task.kind = 'summary';
    task.owner = '';
  }
  project.tasks = converted;
  for (const task of project.tasks)
    setPredecessors(
      task,
      predecessorIds(task).map((id) => mapping.get(id) || id),
    );
  if (project.baseline && mapping.size) {
    const original = [...project.baseline.tasks];
    for (const row of original) {
      if (!mapping.has(row.id)) continue;
      project.baseline.tasks.push({
        ...row,
        id: mapping.get(row.id),
        parentId: row.id,
        name: row.name.slice(0, 180) + ' · 기존 자체 작업',
      });
      row.hours = 0;
    }
    for (const row of original) {
      const descendantsOfRow = descendants({ tasks: project.baseline.tasks }, row.id);
      if (descendantsOfRow.length) {
        const parents = new Set(project.baseline.tasks.map((t) => t.parentId));
        const leaves = descendantsOfRow.filter((t) => !parents.has(t.id));
        row.hours = leaves.reduce((n, t) => n + t.hours, 0);
        row.start = leaves.map((t) => t.start).sort()[0];
        row.end = leaves
          .map((t) => t.end)
          .sort()
          .at(-1);
      }
    }
  }
  const index = taskIndex(project);
  for (const task of [...project.tasks].reverse()) {
    if (!summaries.has(task.id)) continue;
    if (task.kind === 'milestone') throw Error('마일스톤 아래에는 하위 업무를 둘 수 없습니다.');
    const view = taskView(project, task, index);
    task.start = view.start;
    task.end = view.end;
  }
  return project;
}

// Expand summary links onto executable leaves. Inherited links and hierarchy cycles
// are checked together with ordinary dependency cycles by orderTasks.
export function executionTasks(project, index = taskIndex(project)) {
  const { summaries, byId } = index;
  return project.tasks
    .filter((t) => !summaries.has(t.id))
    .map((task) => {
      const ids = [...predecessorIds(task)],
        seen = new Set([task.id]);
      let parent = task.parentId;
      while (parent) {
        if (seen.has(parent)) throw Error('상위 업무가 순환합니다.');
        seen.add(parent);
        const row = byId.get(parent);
        if (!row) throw Error('존재하지 않는 상위 업무입니다.');
        ids.push(...predecessorIds(row));
        parent = row.parentId;
      }
      const result = { ...task };
      setPredecessors(
        result,
        ids.flatMap((id) => index.leavesOf(id).map((t) => t.id)),
      );
      return result;
    });
}
