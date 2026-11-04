import { uid as projectUid } from './id.js';
import { projectHolidays } from './korean-holidays.js';
import { cleanManagement, detachManagementLinks } from './management.js';
import {
  normalizeTaskModel,
  predecessorIds,
  setPredecessors,
  summaryIds,
  descendants,
  executionTasks,
  taskView,
} from './task-model.js';
import { hierarchy, validatePlanning } from './planning.js';
import { ui } from './i18n.js';
import {
  today,
  validDate,
  addDays,
  daysBetween,
  nextWorkday,
  shiftWorkday,
  taskHours,
  validateProject,
  orderTasks,
} from './engine.js';

export const columns = [
  ['name', '업무명'],
  ['phase', '단계'],
  ['owner', '담당자'],
  ['start', '시작일'],
  ['end', '종료일'],
  ['hours', '공수(h)'],
  ['predecessor', '선행 업무'],
  ['memo', '메모'],
];
export function backupPendingCells(project) {
  const values = project._wbsPendingCells;
  if (values === undefined) return [];
  const tasks = new Set(project.tasks.map((task) => task.id)),
    seen = new Set();
  if (!Array.isArray(values) || values.length > 4000)
    throw Error(ui('백업의 미확정 셀 형식을 확인해 주세요.'));
  return values.map((cell) => {
    if (
      !cell ||
      !tasks.has(cell.id) ||
      !columns.some(([field]) => field === cell.field) ||
      typeof cell.value !== 'string' ||
      cell.value.length > 65536 ||
      seen.has(cell.id + '|' + cell.field)
    )
      throw Error(ui('백업의 미확정 셀 형식을 확인해 주세요.'));
    seen.add(cell.id + '|' + cell.field);
    return { id: cell.id, field: cell.field, value: cell.value };
  });
}
export function tsvText(rows) {
  return rows
    .map((row) =>
      row
        .map((value) => {
          let s = String(value ?? '');
          if (/^[\s]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
          return /[\t\r\n"]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
        })
        .join('\t'),
    )
    .join('\r\n');
}
const newId = projectUid;
export function newTask(
  project,
  { date = today(), id = newId, summary = false, milestone = false } = {},
) {
  const start = nextWorkday(date, projectHolidays(project));
  return {
    id: id(),
    name: ui(summary ? '새 요약 업무' : milestone ? '새 마일스톤' : '새 업무'),
    ...(milestone ? { kind: 'milestone', doneDate: null } : {}),
    ...(summary ? { kind: 'summary' } : {}),
    phase: '',
    owner: '',
    start,
    end: milestone ? start : shiftWorkday(start, 4, projectHolidays(project)),
    predecessor: '',
    memo: '',
    items:
      summary || milestone ? [] : [{ id: id(), title: ui('완료 확인'), hours: 8, doneDate: null }],
  };
}
export function checkDraft(project) {
  normalizeTaskModel(project);
  validateProject(project);
  validatePlanning(project);
  Object.assign(project, cleanManagement(project, project));
  for (const t of project.tasks)
    if ((t.phase || '').length > 50 || (t.memo || '').length > 2000)
      throw Error('단계는 50자, 메모는 2,000자까지 입력할 수 있습니다.');
  return project;
}
export function parseTsv(text) {
  if (typeof text !== 'string' || text.length > 1024 * 1024)
    throw Error('붙여넣기는 1MB 이하로 해 주세요.');
  const rows = [];
  let row = [],
    cell = '',
    quoted = false,
    closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
      continue;
    }
    if (c === '"' && !cell && !closed) {
      quoted = true;
      continue;
    }
    if (c === '\t' || c === '\r' || c === '\n') {
      row.push(cell);
      cell = '';
      closed = false;
      if (c !== '\t') {
        rows.push(row);
        row = [];
        if (c === '\r' && text[i + 1] === '\n') i++;
      }
    } else {
      if (closed) throw Error('따옴표로 묶인 셀 형식을 확인해 주세요.');
      cell += c;
    }
  }
  if (quoted) throw Error('닫히지 않은 따옴표가 있습니다.');
  row.push(cell);
  if (row.length > 1 || cell || !rows.length) rows.push(row);
  if (rows.length > 500) throw Error('한 번에 500행까지 붙여넣을 수 있습니다.');
  return rows;
}
export function normalizeDate(value) {
  const s = String(value).trim();
  const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\.?$/);
  const result = m ? m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0') : s;
  if (!validDate(result)) throw Error('날짜는 YYYY-MM-DD 또는 YYYY/MM/DD 형식으로 입력해 주세요.');
  return result;
}
function reference(rows, value, label) {
  if (
    !value ||
    value === '미지정' ||
    value === '없음' ||
    (['Unassigned', 'None'].includes(value) &&
      !rows.some((row) => row.name === value || row.id === value))
  )
    return '';
  const byId = rows.find((x) => x.id === value);
  if (byId) return byId.id;
  const matches = rows.filter((x) => x.name === value);
  if (matches.length === 1) return matches[0].id;
  throw Error(label + '을 찾을 수 없거나 같은 이름이 여러 개입니다: ' + value);
}
export function setCell(project, task, field, value) {
  value = String(value).trim();
  if (summaryIds(project).has(task.id) && ['owner', 'hours', 'start', 'end'].includes(field)) {
    const view = taskView(project, task);
    if (
      field === 'hours'
        ? Number(value) === taskHours(view)
        : field === 'owner'
          ? !value
          : normalizeDate(value) === view[field]
    )
      return;
    throw Error(
      '요약 업무의 일정·공수·진척률은 하위 업무에서 계산합니다. 하위 업무를 수정해 주세요.',
    );
  }
  if (field === 'owner') task.owner = reference(project.members, value, '담당자');
  else if (field === 'predecessor') {
    const values = project.tasks.some((t) => t.id === value || t.name === value)
      ? [value]
      : value.split(/[,;\n]+/);
    setPredecessors(
      task,
      values
        .map((v) => v.trim())
        .filter(Boolean)
        .map((v) =>
          /^[1-9]\d*$/.test(v)
            ? (project.tasks[Number(v) - 1]?.id ?? reference(project.tasks, v, '선행 업무'))
            : reference(project.tasks, v, '선행 업무'),
        )
        .filter(Boolean),
    );
  } else if (field === 'start' || field === 'end') {
    task[field] = normalizeDate(value);
    if (task.kind === 'milestone') task.start = task.end = task[field];
  } else if (field === 'hours') {
    if (task.kind === 'milestone' && Number(value) === 0) return;
    const hours = Number(value);
    if (!Number.isFinite(hours) || hours < 0.1 || hours > 10000)
      throw Error('공수는 0.1~10,000h로 입력해 주세요.');
    if (hours === taskHours(task)) return;
    if (task.items.length !== 1 || task.items[0].doneDate)
      throw Error('여러 세부 작업이나 완료 기록이 있는 업무의 공수는 상세 편집에서 수정해 주세요.');
    task.items[0].hours = hours;
  } else if (['name', 'phase', 'memo'].includes(field)) task[field] = value;
  else throw Error('편집할 수 없는 열입니다.');
}
export function alignSuccessors(project, changedIds = null) {
  const affected = changedIds
    ? new Set(changedIds.flatMap((id) => [id, ...descendants(project, id).map((t) => t.id)]))
    : null;
  const byId = new Map(project.tasks.map((t) => [t.id, t]));
  for (const row of orderTasks(executionTasks(project))) {
    const predecessors = predecessorIds(row);
    if (
      !predecessors.length ||
      (affected && !affected.has(row.id) && !predecessors.some((id) => affected.has(id)))
    )
      continue;
    const task = byId.get(row.id),
      end = predecessors
        .map((id) => byId.get(id).end)
        .sort()
        .at(-1),
      min =
        task.kind === 'milestone' ? end : nextWorkday(addDays(end, 1), projectHolidays(project));
    if (task.start < min) {
      const delta = daysBetween(task.start, min);
      task.start = min;
      task.end = addDays(task.end, delta);
    }
    affected?.add(task.id);
  }
  normalizeTaskModel(project);
  return project;
}
export function editCell(project, id, field, value, { cascade = false } = {}) {
  const p = structuredClone(project),
    task = p.tasks.find((t) => t.id === id);
  if (!task) throw Error('업무를 찾을 수 없습니다.');
  setCell(p, task, field, value);
  if (cascade && ['start', 'end', 'predecessor'].includes(field)) alignSuccessors(p, [id]);
  return checkDraft(p);
}
export function pasteCells(
  project,
  visibleIds,
  rowIndex,
  columnIndex,
  text,
  { cascade = false, id = newId, date = today(), layout = columns } = {},
) {
  const p = structuredClone(project),
    rows = parseTsv(text),
    ids = [...visibleIds],
    changed = [];
  if (columnIndex < 0 || columnIndex >= layout.length || rowIndex < 0 || rowIndex > ids.length)
    throw Error('붙여넣을 셀을 선택해 주세요.');
  if (
    columnIndex === 0 &&
    rows[0]?.length === layout.length &&
    rows[0].every((v, i) => v.trim() === layout[i][1] || v.trim() === ui(layout[i][1], 'en'))
  )
    rows.shift();
  const deferred = [];
  for (let r = 0; r < rows.length; r++) {
    if (rows[r].length + columnIndex > layout.length)
      throw Error(r + 1 + '행: 붙여넣기 열 수가 표 범위를 넘습니다.');
    let task = p.tasks.find((t) => t.id === ids[rowIndex + r]);
    if (!task) {
      task = newTask(p, { id, date });
      p.tasks.push(task);
      ids[rowIndex + r] = task.id;
    }
    changed.push(task.id);
    for (let c = 0; c < rows[r].length; c++) {
      const field = layout[columnIndex + c][0];
      try {
        if (field === 'predecessor') deferred.push([task, rows[r][c]]);
        else setCell(p, task, field, rows[r][c]);
      } catch (error) {
        throw Error(r + 1 + '행 ' + layout[columnIndex + c][1] + ': ' + error.message);
      }
    }
  }
  for (const [task, value] of deferred) setCell(p, task, 'predecessor', value);
  if (cascade) alignSuccessors(p, changed);
  return checkDraft(p);
}
export function moveSchedule(project, ids, delta, { mode = 'move', cascade = false } = {}) {
  if (
    !Number.isInteger(delta) ||
    Math.abs(delta) > 3652 ||
    !['move', 'start', 'end'].includes(mode)
  )
    throw Error('일정 조정 범위를 확인해 주세요.');
  const p = structuredClone(project),
    selected = new Set(ids.flatMap((id) => [id, ...descendants(p, id).map((t) => t.id)]));
  for (const t of p.tasks)
    if (selected.has(t.id) && !summaryIds(p).has(t.id)) {
      if (mode !== 'end') t.start = addDays(t.start, delta);
      if (mode !== 'start') t.end = addDays(t.end, delta);
      if (t.kind === 'milestone') t.start = t.end = mode === 'end' ? t.end : t.start;
    }
  if (cascade) alignSuccessors(p, [...selected]);
  return checkDraft(p);
}
export function duplicateTasks(project, ids, { id = newId } = {}) {
  const p = structuredClone(project),
    selected = new Set(ids.flatMap((id) => [id, ...descendants(p, id).map((t) => t.id)])),
    mapping = new Map(p.tasks.filter((t) => selected.has(t.id)).map((t) => [t.id, id()])),
    tasks = [];
  for (const t of p.tasks) {
    tasks.push(t);
    if (selected.has(t.id))
      tasks.push({
        ...structuredClone(t),
        id: mapping.get(t.id),
        name: (t.name + ' (복사)').slice(0, 200),
        ...(t.kind === 'milestone' ? { doneDate: null } : {}),
        parentId: mapping.get(t.parentId) || t.parentId || '',
        predecessor: mapping.get(t.predecessor) || t.predecessor,
        ...(t.predecessors
          ? { predecessors: t.predecessors.map((id) => mapping.get(id) || id) }
          : {}),
        items: t.items.map((i) => ({ ...i, id: id(), doneDate: null })),
      });
  }
  p.tasks = tasks;
  return checkDraft(p);
}
export function removeTasks(project, ids) {
  const p = structuredClone(project),
    selected = new Set(ids);
  p.tasks = p.tasks.filter((t) => !selected.has(t.id));
  detachManagementLinks(p);
  for (const t of p.tasks) {
    setPredecessors(
      t,
      predecessorIds(t).filter((id) => !selected.has(id)),
    );
    if (selected.has(t.parentId)) t.parentId = '';
  }
  return checkDraft(p);
}
export function reorderTasks(project, ids, direction) {
  const p = structuredClone(project),
    tree = hierarchy(p),
    requested = new Set(ids),
    selected = new Set(
      p.tasks
        .filter(
          (task) =>
            requested.has(task.id) && !tree.get(task.id).ancestors.some((id) => requested.has(id)),
        )
        .map((task) => task.id),
    ),
    siblings = new Map();
  for (const task of p.tasks) {
    const parent = task.parentId || '';
    if (!siblings.has(parent)) siblings.set(parent, []);
    siblings.get(parent).push(task);
  }
  let changed = false;
  for (const a of siblings.values()) {
    if (direction < 0) {
      for (let i = 1; i < a.length; i++)
        if (selected.has(a[i].id) && !selected.has(a[i - 1].id)) {
          [a[i - 1], a[i]] = [a[i], a[i - 1]];
          changed = true;
        }
    } else {
      for (let i = a.length - 2; i >= 0; i--)
        if (selected.has(a[i].id) && !selected.has(a[i + 1].id)) {
          [a[i], a[i + 1]] = [a[i + 1], a[i]];
          changed = true;
        }
    }
  }
  if (changed) {
    p.tasks = [];
    const visit = (parent) => {
      for (const task of siblings.get(parent) || []) {
        p.tasks.push(task);
        visit(task.id);
      }
    };
    visit('');
  }
  return checkDraft(p);
}
