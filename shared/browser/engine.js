import { projectHolidays } from './korean-holidays.js';
import { businessDate } from './business-clock.js';
import {
  LIMITS,
  predecessorIds,
  taskLeaves,
  summaryIds,
  taskView,
  taskIndex,
  executionTasks,
} from './task-model.js';
export const DAY = 86400000;
export const dateValue = (s) => Date.parse(s + 'T00:00:00Z');
export const validDate = (s) =>
  typeof s === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  s >= '1900-01-01' &&
  s <= '2200-12-31' &&
  Number.isFinite(dateValue(s)) &&
  new Date(dateValue(s)).toISOString().slice(0, 10) === s;
export const addDays = (s, n) => new Date(dateValue(s) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((dateValue(b) - dateValue(a)) / DAY);
export const today = () => businessDate();
export function working(s, h = []) {
  const d = new Date(dateValue(s)).getUTCDay();
  return d !== 0 && d !== 6 && !h.includes(s);
}
export function workdays(a, b, h = []) {
  if (b < a) return 0;
  const count = daysBetween(a, b) + 1;
  if (!Number.isFinite(count)) throw Error('날짜를 확인해 주세요.');
  let n = Math.floor(count / 7) * 5;
  const weekday = new Date(dateValue(a)).getUTCDay();
  for (let i = 0; i < count % 7; i++) if (![0, 6].includes((weekday + i) % 7)) n++;
  for (const d of new Set(h)) if (d >= a && d <= b && working(d)) n--;
  return n;
}
export function nextWorkday(s, h = []) {
  let d = s;
  for (let i = 0; i < 3700; i++, d = addDays(d, 1)) if (working(d, h)) return d;
  throw Error('근무일을 찾을 수 없습니다.');
}
export function shiftWorkday(s, n, h = []) {
  let d = s;
  for (let i = 0; i < Math.abs(n);) {
    d = addDays(d, n < 0 ? -1 : 1);
    if (working(d, h)) i++;
  }
  return d;
}
// Hours available on a working day. Consumers exclude weekends/project holidays.
// A member's period plan replaces their fixed allocation; gaps in that plan are zero.
export function capacityCalendar(project) {
  const members = new Map(project.members.map((m) => [m.id, m])),
    periods = new Map();
  for (const a of project.staffing?.assignments || []) {
    if (!periods.has(a.memberId)) periods.set(a.memberId, new Map());
    const events = periods.get(a.memberId),
      after = addDays(a.end, 1);
    for (const [date, delta, count] of [
      [a.start, a.allocation, 1],
      [after, -a.allocation, -1],
    ]) {
      const previous = events.get(date) || { delta: 0, count: 0 };
      events.set(date, { delta: previous.delta + delta, count: previous.count + count });
    }
  }
  const changes = new Map();
  for (const [id, events] of periods) {
    let allocation = 0,
      active = 0;
    changes.set(
      id,
      [...events.keys()].sort().map((date) => {
        const event = events.get(date);
        active += event.count;
        allocation = active ? Math.max(0, allocation + event.delta) : 0;
        return { date, allocation: Math.max(0, allocation) };
      }),
    );
  }
  const hours = (id, date) => {
    const member = members.get(id);
    if (!member) return 0;
    const rows = changes.get(id);
    if (!rows) return (member.hours * member.allocation) / 100;
    let lo = 0,
      hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (rows[mid].date <= date) lo = mid + 1;
      else hi = mid;
    }
    return (member.hours * (lo ? rows[lo - 1].allocation : 0)) / 100;
  };
  const segments = (id, from, to) => {
    if (to < from) return [];
    const dates = [
      from,
      ...(changes.get(id) || []).map((r) => r.date).filter((d) => d > from && d <= to),
      addDays(to, 1),
    ];
    return dates
      .slice(0, -1)
      .map((date, i) => ({ from: date, to: addDays(dates[i + 1], -1), capacity: hours(id, date) }));
  };
  return {
    hours,
    segments,
    hasPlan: (id) => changes.has(id),
    nextAvailable: (id, date) =>
      hours(id, date) > 0
        ? date
        : (changes.get(id) || []).find((r) => r.date > date && r.allocation > 0)?.date,
    totalHours: (id, from, to) =>
      segments(id, from, to).reduce(
        (n, s) => n + workdays(s.from, s.to, projectHolidays(project)) * s.capacity,
        0,
      ),
  };
}
export const taskHours = (t) => t.items.reduce((s, i) => s + i.hours, 0);
export const earned = (t, at) =>
  t.items.reduce((s, i) => s + (i.doneDate && i.doneDate <= at ? i.hours : 0), 0);
export const progress = (t, at) =>
  t.kind === 'milestone'
    ? Number(Boolean(t.doneDate && t.doneDate <= at))
    : taskHours(t)
      ? earned(t, at) / taskHours(t)
      : 0;
export function planned(t, at, h = []) {
  const d = workdays(t.start, t.end, h);
  return d ? taskHours(t) * Math.min(1, workdays(t.start, at < t.end ? at : t.end, h) / d) : 0;
}
export function orderTasks(tasks) {
  const map = new Map(tasks.map((t) => [t.id, t])),
    out = [],
    visiting = new Set(),
    seen = new Set();
  function visit(t) {
    if (visiting.has(t.id)) throw Error('선행 업무가 서로 순환합니다. 연결을 확인해 주세요.');
    if (seen.has(t.id)) return;
    visiting.add(t.id);
    for (const id of predecessorIds(t)) {
      const p = map.get(id);
      if (!p) throw Error('존재하지 않는 선행 업무입니다.');
      visit(p);
    }
    visiting.delete(t.id);
    seen.add(t.id);
    out.push(t);
  }
  [...tasks]
    .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
    .forEach(visit);
  return out;
}
export function forecast(project, at) {
  const h = projectHolidays(project),
    index = taskIndex(project),
    calendar = capacityCalendar(project),
    members = new Map(project.members.map((m) => [m.id, m])),
    tasks = orderTasks(executionTasks(project, index)),
    results = Object.create(null),
    pace = Object.create(null),
    usage = new Map();
  const firstWindow = shiftWorkday(
    working(at, h) ? at : shiftWorkday(nextWorkday(at, h), -1, h),
    -9,
    h,
  );
  for (const member of project.members) {
    const owned = tasks.filter((t) => t.owner === member.id),
      earliest = owned.length
        ? owned.reduce((m, t) => (t.start < m ? t.start : m), owned[0].start)
        : at,
      from = earliest > firstWindow ? earliest : firstWindow;
    const actualDays = new Set(),
      done = owned.reduce(
        (sum, t) =>
          sum +
          t.items.reduce((s, i) => {
            if (i.doneDate && i.doneDate >= from && i.doneDate <= at) {
              actualDays.add(i.doneDate);
              return s + i.hours;
            }
            return s;
          }, 0),
        0,
      ),
      span = workdays(from, at, h);
    let expected = 0;
    for (const t of owned)
      expected += Math.max(0, planned(t, at, h) - planned(t, addDays(from, -1), h));
    const observed = span >= 3 && actualDays.size >= 2 && expected > 0 && done > 0;
    pace[member.id] = {
      observed,
      ratio: observed ? done / expected : 1,
      completedHours: done,
      windowDays: span,
      capacity: calendar.hours(member.id, at),
    };
  }
  for (const t of tasks) {
    if (t.kind === 'milestone') {
      const predecessors = predecessorIds(t).map((id) => results[id]);
      const actual = t.doneDate && t.doneDate <= at;
      const end = actual
        ? t.doneDate
        : predecessors.some((p) => !p.end)
          ? null
          : [t.end, addDays(at, 1), ...predecessors.map((p) => p.end)].sort().at(-1);
      results[t.id] = {
        start: end,
        end,
        method: actual ? 'actual' : 'milestone',
        remaining: 0,
        late: end ? Math.max(0, workdays(addDays(t.end, 1), end, h)) : 0,
      };
      continue;
    }
    const total = taskHours(t),
      done = earned(t, at),
      remaining = Math.max(0, total - done);
    if (remaining < 0.00001) {
      const dates = t.items
        .filter((i) => i.doneDate && i.doneDate <= at)
        .map((i) => i.doneDate)
        .sort();
      results[t.id] = {
        start: dates[0] || t.start,
        end: dates.at(-1) || t.end,
        method: 'actual',
        remaining: 0,
        late: Math.max(0, workdays(addDays(t.end, 1), dates.at(-1) || t.end, h)),
      };
      continue;
    }
    const member = members.get(t.owner),
      p = pace[t.owner],
      predecessors = predecessorIds(t).map((id) => results[id]),
      predEnd = predecessors
        .map((x) => x.end)
        .filter(Boolean)
        .sort()
        .at(-1);
    if (!member || !p || predecessors.some((x) => x.end === null)) {
      results[t.id] = {
        start: null,
        end: null,
        method: 'unavailable',
        reason: !member ? '담당자 미지정' : '선행 업무의 예상일 없음',
        remaining,
      };
      continue;
    }
    const nominal = total / Math.max(1, workdays(t.start, t.end, h)),
      dailyRate = nominal * p.ratio;
    let start = nextWorkday(
        [t.start, addDays(at, 1), predEnd ? addDays(predEnd, 1) : t.start].sort().at(-1),
        h,
      ),
      d = start,
      left = remaining,
      finish = null,
      first = null;
    const horizon = addDays(start, 3652);
    for (
      let guard = 0;
      guard < 3653 && d <= horizon && left > 0.00001;
      guard++, d = addDays(d, 1)
    ) {
      const capacity = calendar.hours(member.id, d);
      if (!capacity) {
        const next = calendar.nextAvailable(member.id, d);
        if (!next) break;
        d = addDays(next, -1);
        continue;
      }
      if (!working(d, h)) continue;
      const key = member.id + ':' + d,
        used = usage.get(key) || 0,
        amount = Math.min(left, dailyRate, Math.max(0, capacity - used));
      if (amount > 0) {
        first ??= d;
        left -= amount;
        usage.set(key, used + amount);
        finish = d;
      }
    }
    results[t.id] = {
      start: first || (calendar.hasPlan(member.id) ? null : start),
      end: left > 0.00001 ? null : finish,
      method: p.observed ? 'velocity' : 'plan',
      remaining,
      reason:
        left > 0.00001
          ? calendar.hasPlan(member.id)
            ? '투입 계획 또는 계산 범위 내 가용시간 부족'
            : '약 10년 계산 범위 초과'
          : null,
      late: left <= 0.00001 && finish ? Math.max(0, workdays(addDays(t.end, 1), finish, h)) : 0,
    };
  }
  const values = Object.values(results);
  for (const id of index.summaries) {
    const task = index.byId.get(id);
    if (!task) continue;
    const view = taskView(project, task, index),
      children = index.leavesOf(id).map((t) => results[t.id]),
      end =
        children.length && children.every((x) => x.end)
          ? children
              .map((x) => x.end)
              .sort()
              .at(-1)
          : null;
    results[id] = {
      start:
        children.length && children.every((x) => x.start)
          ? children.map((x) => x.start).sort()[0]
          : null,
      end,
      method: 'summary',
      remaining: children.reduce((n, x) => n + x.remaining, 0),
      late: end ? Math.max(0, workdays(addDays(view.end, 1), end, h)) : 0,
    };
  }
  const ends = values
    .map((x) => x.end)
    .filter(Boolean)
    .sort();
  return {
    tasks: results,
    pace,
    end: values.length && values.every((x) => x.end) ? ends.at(-1) : null,
    observed: values.some((x) => x.method === 'velocity'),
  };
}
export function summary(project, at) {
  const tasks = taskLeaves(project),
    total = tasks.reduce((s, t) => s + taskHours(t), 0),
    done = tasks.reduce((s, t) => s + earned(t, at), 0),
    plan = tasks.reduce((s, t) => s + planned(t, at, projectHolidays(project)), 0),
    f = forecast(project, at),
    starts = tasks.map((t) => t.start).sort(),
    ends = tasks.map((t) => t.end).sort();
  return {
    total,
    done,
    progress: total ? done / total : 0,
    planned: total ? plan / total : 0,
    completed: tasks.filter((t) => progress(t, at) === 1).length,
    overdue: tasks.filter((t) => t.end < at && progress(t, at) < 1).length,
    start: starts[0] || null,
    end: ends.at(-1) || null,
    forecast: f,
  };
}
export function validateProject(p) {
  if (p?.koreanHolidays !== undefined && typeof p.koreanHolidays !== 'boolean')
    throw Error('한국 공휴일 설정을 확인해 주세요.');
  const currentDay = today();
  if (
    !p ||
    typeof p !== 'object' ||
    !Array.isArray(p.members) ||
    !Array.isArray(p.tasks) ||
    typeof p.name !== 'string' ||
    !p.name.trim() ||
    p.name.length > 120
  )
    throw Error('프로젝트 형식 또는 이름이 올바르지 않습니다.');
  if (
    p.members.length > LIMITS.members ||
    p.tasks.length > LIMITS.tasks ||
    taskLeaves(p).length > LIMITS.workTasks ||
    summaryIds(p).size > LIMITS.summaries
  )
    throw Error('인력 200명, 실제 업무 500개와 요약 업무 500개까지 지원합니다.');
  if (
    p.holidays !== undefined &&
    (!Array.isArray(p.holidays) ||
      p.holidays.length > 3660 ||
      p.holidays.some((d) => !validDate(d)))
  )
    throw Error('휴무일 날짜를 확인해 주세요.');
  const dates = [
    ...p.tasks.flatMap((t) => [
      t.start,
      t.end,
      t.doneDate,
      ...(t.items || []).map((i) => i.doneDate),
    ]),
    ...(Array.isArray(p.baseline?.tasks) ? p.baseline.tasks.flatMap((t) => [t.start, t.end]) : []),
  ]
    .filter((d) => typeof d === 'string')
    .sort();
  if (dates.length && daysBetween(dates[0], dates.at(-1)) > 36525)
    throw Error('프로젝트 전체 일정과 기준 계획은 100년 이내로 설정해 주세요.');
  const memberIds = new Set(),
    taskIds = new Set(),
    itemIds = new Set(),
    summaries = summaryIds(p);
  for (const m of p.members) {
    if (
      typeof m.id !== 'string' ||
      memberIds.has(m.id) ||
      typeof m.name !== 'string' ||
      !m.name.trim() ||
      m.name.length > 80 ||
      !(m.hours > 0 && m.hours <= 16) ||
      !(m.allocation > 0 && m.allocation <= 100) ||
      typeof m.grade !== 'string' ||
      typeof m.role !== 'string'
    )
      throw Error('참여인력의 이름·근무시간·투입률을 확인해 주세요.');
    memberIds.add(m.id);
  }
  for (const t of p.tasks) {
    if (
      typeof t.id !== 'string' ||
      taskIds.has(t.id) ||
      typeof t.name !== 'string' ||
      !t.name.trim() ||
      t.name.length > 200 ||
      !validDate(t.start) ||
      !validDate(t.end) ||
      t.end < t.start ||
      daysBetween(t.start, t.end) > (summaries.has(t.id) ? 36525 : 3652) ||
      (t.kind !== 'milestone' && !workdays(t.start, t.end, p.holidays)) ||
      !Array.isArray(t.items) ||
      (!t.items.length && !summaries.has(t.id) && t.kind !== 'milestone') ||
      (t.kind === 'milestone' &&
        (t.items.length > 0 ||
          t.start !== t.end ||
          (t.doneDate != null && (!validDate(t.doneDate) || t.doneDate > currentDay)))) ||
      (summaries.has(t.id) && t.items.length > 0) ||
      t.items.length > LIMITS.items ||
      (t.kind !== undefined && !['summary', 'milestone'].includes(t.kind)) ||
      (t.predecessors !== undefined &&
        (!Array.isArray(t.predecessors) ||
          t.predecessors.length > LIMITS.tasks ||
          t.predecessors.some((id) => typeof id !== 'string' || !id) ||
          new Set(t.predecessors).size !== t.predecessors.length)) ||
      (!memberIds.has(t.owner) && t.owner !== '')
    )
      throw Error('업무 이름·담당자·일정·체크 항목을 확인해 주세요.');
    for (const i of t.items) {
      if (
        typeof i.id !== 'string' ||
        itemIds.has(i.id) ||
        typeof i.title !== 'string' ||
        !i.title.trim() ||
        i.title.length > 300 ||
        !Number.isFinite(i.hours) ||
        i.hours <= 0 ||
        i.hours > 10000 ||
        (i.doneDate && (!validDate(i.doneDate) || i.doneDate > currentDay))
      )
        throw Error('세부 작업의 이름·예상 시간·완료일을 확인해 주세요.');
      itemIds.add(i.id);
    }
    taskIds.add(t.id);
  }
  orderTasks(p.tasks);
  orderTasks(executionTasks(p));
  return p;
}
