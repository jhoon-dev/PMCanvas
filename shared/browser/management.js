import { projectHolidays } from './korean-holidays.js';
import {
  addDays,
  daysBetween,
  validDate,
  workdays,
  taskHours,
  earned,
  planned,
  progress,
  today,
  capacityCalendar,
} from './engine.js';
import { taskLeaves, predecessorIds } from './task-model.js';

const check = (ok, message) => {
  if (!ok) throw Error(message);
};
const identifier = (s) => typeof s === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(s);
const string = (s, max, required = false) =>
  typeof s === 'string' && s.length <= max && (!required || s.trim());
const canonical = (value) =>
  JSON.stringify(value, (_, v) =>
    v && !Array.isArray(v) && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
export function weekRange(at = today()) {
  check(validDate(at), '보고 날짜를 확인해 주세요.');
  const weekday = new Date(at + 'T00:00:00Z').getUTCDay();
  const from = addDays(at, -((weekday + 6) % 7));
  return { from, to: at, nextFrom: addDays(from, 7), nextTo: addDays(from, 13) };
}

export function cleanManagement(input, project) {
  const out = {},
    members = new Set(project.members.map((m) => m.id)),
    tasks = new Set(project.tasks.map((t) => t.id));
  if (input.issues !== undefined) {
    check(
      Array.isArray(input.issues) && input.issues.length <= 500,
      '이슈·리스크는 500개까지 지원합니다.',
    );
    const seen = new Set();
    out.issues = input.issues.map((r) => {
      check(r && identifier(r.id) && !seen.has(r.id), '이슈 ID가 잘못되었거나 중복됩니다.');
      seen.add(r.id);
      check(
        string(r.title, 200, true) &&
          ['issue', 'risk'].includes(r.type) &&
          ['low', 'medium', 'high'].includes(r.impact) &&
          ['open', 'doing', 'closed'].includes(r.status) &&
          (r.owner === '' || members.has(r.owner)) &&
          (r.taskId === '' || tasks.has(r.taskId)) &&
          (r.due === '' || validDate(r.due)) &&
          string(r.action, 4000) &&
          (r.type !== 'risk' || ['low', 'medium', 'high'].includes(r.probability)),
        '이슈의 제목·유형·영향·담당자·기한·연결 업무를 확인해 주세요.',
      );
      return {
        id: r.id,
        title: r.title.trim(),
        type: r.type,
        impact: r.impact,
        probability: r.type === 'risk' ? r.probability : '',
        owner: r.owner,
        taskId: r.taskId,
        due: r.due,
        status: r.status,
        action: r.action,
      };
    });
  }
  if (input.staffing !== undefined) {
    const s = input.staffing;
    check(
      s &&
        Number.isFinite(s.hoursPerMM) &&
        s.hoursPerMM >= 1 &&
        s.hoursPerMM <= 400 &&
        Array.isArray(s.assignments) &&
        s.assignments.length <= 2000,
      'M/M 환산 기준과 투입 계획을 확인해 주세요.',
    );
    const seen = new Set();
    const assignments = s.assignments.map((a) => {
      check(
        a &&
          identifier(a.id) &&
          !seen.has(a.id) &&
          members.has(a.memberId) &&
          validDate(a.start) &&
          validDate(a.end) &&
          a.start <= a.end &&
          daysBetween(a.start, a.end) <= 3652 &&
          Number.isFinite(a.allocation) &&
          a.allocation > 0 &&
          a.allocation <= 100,
        '투입 기간·인력·투입률을 확인해 주세요.',
      );
      seen.add(a.id);
      return {
        id: a.id,
        memberId: a.memberId,
        start: a.start,
        end: a.end,
        allocation: a.allocation,
      };
    });
    for (const member of project.members) {
      const events = new Map();
      for (const a of assignments.filter((a) => a.memberId === member.id)) {
        events.set(a.start, (events.get(a.start) || 0) + a.allocation);
        const after = addDays(a.end, 1);
        events.set(after, (events.get(after) || 0) - a.allocation);
      }
      let allocation = 0;
      for (const date of [...events.keys()].sort()) {
        allocation += events.get(date);
        check(
          allocation <= 100 + 0.00001,
          '같은 인력의 겹치는 투입률 합계는 100%를 넘을 수 없습니다.',
        );
      }
    }
    out.staffing = { hoursPerMM: s.hoursPerMM, assignments };
  }
  if (input.weeklyReports !== undefined) {
    check(
      Array.isArray(input.weeklyReports) && input.weeklyReports.length <= 100,
      '발행 주간보고는 프로젝트당 100개까지 보관합니다.',
    );
    const seen = new Set();
    out.weeklyReports = input.weeklyReports.map((r) => {
      check(
        r &&
          identifier(r.id) &&
          !seen.has(r.id) &&
          validDate(r.from) &&
          validDate(r.to) &&
          r.from <= r.to &&
          daysBetween(r.from, r.to) <= 6 &&
          string(r.projectName, 120, true) &&
          string(r.notes, 4000) &&
          string(r.nextNotes, 4000) &&
          typeof r.publishedAt === 'string' &&
          r.publishedAt.length <= 40 &&
          Number.isFinite(Date.parse(r.publishedAt)),
        '주간보고 형식을 확인해 주세요.',
      );
      seen.add(r.id);
      const s = r.snapshot;
      check(
        s &&
          s.version === 1 &&
          string(s.baselineName, 80) &&
          validDate(s.nextFrom) &&
          validDate(s.nextTo) &&
          s.nextFrom <= s.nextTo &&
          ['total', 'done', 'plan', 'progress', 'plannedProgress'].every(
            (k) => Number.isFinite(s.metrics?.[k]) && s.metrics[k] >= 0,
          ) &&
          s.metrics.progress <= 1 &&
          s.metrics.plannedProgress <= 1,
        '주간보고 수치를 확인해 주세요.',
      );
      const rows = (name, limit = 1000) => {
        check(Array.isArray(s[name]) && s[name].length <= limit, '주간보고 목록을 확인해 주세요.');
        return s[name].map((v) => {
          check(
            v &&
              identifier(v.id) &&
              string(v.name, 300, true) &&
              string(v.owner, 80) &&
              validDate(v.start) &&
              validDate(v.end) &&
              v.start <= v.end &&
              Number.isFinite(v.hours) &&
              v.hours >= 0 &&
              Number.isFinite(v.progress) &&
              v.progress >= 0 &&
              v.progress <= 1,
            '주간보고 업무를 확인해 주세요.',
          );
          return {
            id: v.id,
            name: v.name,
            owner: v.owner,
            start: v.start,
            end: v.end,
            hours: v.hours,
            progress: v.progress,
          };
        });
      };
      check(Array.isArray(s.curve) && s.curve.length <= 8, '주간보고 추이를 확인해 주세요.');
      const curve = s.curve.map((v) => {
        check(
          validDate(v.date) &&
            ['planned', 'actual'].every((k) => Number.isFinite(v[k]) && v[k] >= 0 && v[k] <= 1) &&
            (v.baseline === null ||
              (Number.isFinite(v.baseline) && v.baseline >= 0 && v.baseline <= 1)),
          '주간보고 추이 수치를 확인해 주세요.',
        );
        return { date: v.date, planned: v.planned, actual: v.actual, baseline: v.baseline };
      });
      check(Array.isArray(s.issues) && s.issues.length <= 500, '주간보고 이슈를 확인해 주세요.');
      const issues = s.issues.map((v) => {
        check(
          identifier(v.id) &&
            string(v.title, 200, true) &&
            string(v.owner, 80) &&
            string(v.action, 4000) &&
            ['issue', 'risk'].includes(v.type) &&
            ['low', 'medium', 'high'].includes(v.impact) &&
            ['open', 'doing', 'closed'].includes(v.status) &&
            (v.due === '' || validDate(v.due)),
          '주간보고 이슈를 확인해 주세요.',
        );
        return {
          id: v.id,
          title: v.title,
          type: v.type,
          impact: v.impact,
          status: v.status,
          owner: v.owner,
          due: v.due,
          action: v.action,
        };
      });
      return {
        id: r.id,
        from: r.from,
        to: r.to,
        projectName: r.projectName,
        publishedAt: r.publishedAt,
        notes: r.notes,
        nextNotes: r.nextNotes,
        snapshot: {
          version: 1,
          baselineName: s.baselineName,
          nextFrom: s.nextFrom,
          nextTo: s.nextTo,
          metrics: {
            total: s.metrics.total,
            done: s.metrics.done,
            plan: s.metrics.plan,
            progress: s.metrics.progress,
            plannedProgress: s.metrics.plannedProgress,
          },
          curve,
          completed: rows('completed'),
          ongoing: rows('ongoing'),
          nextTasks: rows('nextTasks'),
          milestones: rows('milestones'),
          issues,
        },
      };
    });
  }
  return out;
}

export function assertReportHistory(before, after) {
  const reports = new Map((after.weeklyReports || []).map((r) => [r.id, r]));
  for (const report of before.weeklyReports || [])
    if (!reports.has(report.id) || canonical(report) !== canonical(reports.get(report.id)))
      throw Object.assign(
        new Error('발행한 주간보고는 수정·삭제할 수 없습니다. 정정 보고서를 새로 발행해 주세요.'),
        { status: 400, code: 'PUBLISHED_REPORT_IMMUTABLE' },
      );
}

export function weeklyDraft(
  project,
  {
    from,
    to,
    notes = '',
    nextNotes = '',
    id = crypto.randomUUID(),
    publishedAt = new Date().toISOString(),
    currentDate = today(),
  },
) {
  check(
    validDate(from) &&
      validDate(to) &&
      from <= to &&
      daysBetween(from, to) <= 6 &&
      to <= currentDate,
    '주간보고는 오늘까지의 1~7일 기간으로 발행해 주세요.',
  );
  const tasks = taskLeaves(project),
    members = new Map(project.members.map((m) => [m.id, m.name]));
  const nextFrom = addDays(from, 7),
    nextTo = addDays(from, 13);
  const row = (t) => ({
    id: t.id,
    name: t.name,
    owner: members.get(t.owner) || '',
    start: t.start,
    end: t.end,
    hours: taskHours(t),
    progress: progress(t, to),
  });
  const total = tasks.reduce((n, t) => n + taskHours(t), 0),
    done = tasks.reduce((n, t) => n + earned(t, to), 0),
    plan = tasks.reduce((n, t) => n + planned(t, to, projectHolidays(project)), 0);
  const baselineParents = new Set((project.baseline?.tasks || []).map((t) => t.parentId));
  const base = (project.baseline?.tasks || []).filter((t) => !baselineParents.has(t.id));
  const baseTotal = base.reduce((n, t) => n + t.hours, 0);
  const curve = Array.from({ length: daysBetween(from, to) + 2 }, (_, n) => {
    const date = addDays(from, n - 1);
    const baseline = base.reduce(
      (n, t) =>
        n +
        t.hours *
          Math.min(
            1,
            workdays(t.start, date < t.end ? date : t.end, projectHolidays(project)) /
              Math.max(1, workdays(t.start, t.end, projectHolidays(project))),
          ),
      0,
    );
    return {
      date,
      planned: total
        ? tasks.reduce((n, t) => n + planned(t, date, projectHolidays(project)), 0) / total
        : 0,
      actual: total ? tasks.reduce((n, t) => n + earned(t, date), 0) / total : 0,
      baseline: baseTotal ? baseline / baseTotal : null,
    };
  });
  const report = {
    id,
    from,
    to,
    projectName: project.name,
    publishedAt,
    notes,
    nextNotes,
    snapshot: {
      version: 1,
      baselineName: project.baseline?.name || '',
      nextFrom,
      nextTo,
      metrics: {
        total,
        done,
        plan,
        progress: total ? done / total : 0,
        plannedProgress: total ? plan / total : 0,
      },
      curve,
      completed: tasks
        .filter((t) =>
          t.kind === 'milestone'
            ? t.doneDate >= from && t.doneDate <= to
            : t.items.some((i) => i.doneDate >= from && i.doneDate <= to),
        )
        .map(row),
      ongoing: tasks.filter((t) => t.start <= to && progress(t, to) < 1).map(row),
      nextTasks: tasks
        .filter((t) => t.start <= nextTo && t.end >= nextFrom && progress(t, to) < 1)
        .map(row),
      milestones: tasks.filter((t) => t.kind === 'milestone').map(row),
      issues: (project.issues || [])
        .filter((i) => i.status !== 'closed')
        .map((i) => ({
          id: i.id,
          title: i.title,
          type: i.type,
          impact: i.impact,
          status: i.status,
          due: i.due,
          action: i.action,
          owner: members.get(i.owner) || '',
        })),
    },
  };
  return cleanManagement({ weeklyReports: [report] }, project).weeklyReports[0];
}

export function monthlyPlan(project, month) {
  check(/^\d{4}-\d{2}$/.test(month) && validDate(month + '-01'), '조회 월을 확인해 주세요.');
  const from = month + '-01',
    to = addDays(
      new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 1))
        .toISOString()
        .slice(0, 10),
      -1,
    );
  const hoursPerMM = project.staffing?.hoursPerMM || 160,
    calendar = capacityCalendar(project);
  const rows = project.members.map((m) => {
    const hours = calendar.totalHours(m.id, from, to);
    const workload = taskLeaves(project)
      .filter((t) => t.owner === m.id)
      .reduce(
        (n, t) =>
          n +
          planned(t, to, projectHolidays(project)) -
          planned(t, addDays(from, -1), projectHolidays(project)),
        0,
      );
    return {
      id: m.id,
      name: m.name,
      basis: calendar.hasPlan(m.id) ? 'period' : 'default',
      hours,
      mm: hours / hoursPerMM,
      workload,
    };
  });
  const estimatedHours = rows.reduce((n, r) => n + (r.basis === 'default' ? r.hours : 0), 0);
  return {
    from,
    to,
    hoursPerMM,
    rows,
    hours: rows.reduce((n, r) => n + r.hours, 0),
    mm: rows.reduce((n, r) => n + r.mm, 0),
    estimatedHours,
    estimatedMM: estimatedHours / hoursPerMM,
  };
}

// A single update path powers web and native editors, preserving unknown project metadata.
export function managementChange(project, action, data, options = {}) {
  const p = structuredClone(project);
  if (action === 'issue') {
    const rows = p.issues || [],
      index = rows.findIndex((r) => r.id === data.id);
    if (index < 0) rows.push(data);
    else rows[index] = data;
    p.issues = rows;
  } else if (action === 'remove-issue') p.issues = (p.issues || []).filter((r) => r.id !== data.id);
  else if (action === 'staffing') {
    p.staffing = {
      hoursPerMM: Number(data.hoursPerMM),
      assignments: [...(p.staffing?.assignments || []), data.assignment],
    };
  } else if (action === 'mm-basis')
    p.staffing = {
      hoursPerMM: Number(data.hoursPerMM),
      assignments: p.staffing?.assignments || [],
    };
  else if (action === 'remove-assignment') {
    if (p.staffing)
      p.staffing.assignments = (p.staffing.assignments || []).filter((a) => a.id !== data.id);
  } else if (action === 'publish')
    p.weeklyReports = [...(p.weeklyReports || []), weeklyDraft(p, { ...data, ...options })];
  else throw Error('관리 작업을 확인해 주세요.');
  Object.assign(p, cleanManagement(p, p));
  assertReportHistory(project, p);
  return p;
}

export function detachManagementLinks(project) {
  const members = new Set(project.members.map((m) => m.id)),
    tasks = new Set(project.tasks.map((t) => t.id));
  for (const r of project.issues || []) {
    if (!members.has(r.owner)) r.owner = '';
    if (!tasks.has(r.taskId)) r.taskId = '';
  }
  if (project.staffing)
    project.staffing.assignments = project.staffing.assignments.filter((a) =>
      members.has(a.memberId),
    );
  return project;
}
