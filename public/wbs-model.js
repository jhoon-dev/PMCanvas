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
const newId = () => crypto.randomUUID();
export function newTask(project, { date = today(), id = newId } = {}) {
  const start = nextWorkday(date, project.holidays);
  return {
    id: id(),
    name: ui('새 업무'),
    phase: '',
    owner: '',
    start,
    end: shiftWorkday(start, 4, project.holidays),
    predecessor: '',
    memo: '',
    items: [{ id: id(), title: ui('완료 확인'), hours: 8, doneDate: null }],
  };
}
export function checkDraft(project) {
  validateProject(project);
  validatePlanning(project);
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
  if (field === 'owner') task.owner = reference(project.members, value, '담당자');
  else if (field === 'predecessor')
    task.predecessor = /^[1-9]\d*$/.test(value)
      ? (project.tasks[Number(value) - 1]?.id ?? reference(project.tasks, value, '선행 업무'))
      : reference(project.tasks, value, '선행 업무');
  else if (field === 'start' || field === 'end') task[field] = normalizeDate(value);
  else if (field === 'hours') {
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
  const affected = changedIds ? new Set(changedIds) : null;
  for (const task of orderTasks(project.tasks)) {
    if (!task.predecessor || (affected && !affected.has(task.predecessor))) continue;
    const pred = project.tasks.find((t) => t.id === task.predecessor),
      min = nextWorkday(addDays(pred.end, 1), project.holidays);
    if (task.start < min) {
      const delta = daysBetween(task.start, min);
      task.start = min;
      task.end = addDays(task.end, delta);
    }
    affected?.add(task.id);
  }
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
    selected = new Set(ids);
  for (const t of p.tasks)
    if (selected.has(t.id)) {
      if (mode !== 'end') t.start = addDays(t.start, delta);
      if (mode !== 'start') t.end = addDays(t.end, delta);
    }
  if (cascade) alignSuccessors(p, ids);
  return checkDraft(p);
}
export function duplicateTasks(project, ids, { id = newId } = {}) {
  const p = structuredClone(project),
    selected = new Set(ids),
    mapping = new Map(p.tasks.filter((t) => selected.has(t.id)).map((t) => [t.id, id()])),
    tasks = [];
  for (const t of p.tasks) {
    tasks.push(t);
    if (selected.has(t.id))
      tasks.push({
        ...structuredClone(t),
        id: mapping.get(t.id),
        name: (t.name + ' (복사)').slice(0, 200),
        parentId: mapping.get(t.parentId) || t.parentId || '',
        predecessor: mapping.get(t.predecessor) || t.predecessor,
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
  for (const t of p.tasks) {
    if (selected.has(t.predecessor)) t.predecessor = '';
    if (selected.has(t.parentId)) t.parentId = '';
  }
  return checkDraft(p);
}
export function reorderTasks(project, ids, direction) {
  const p = structuredClone(project),
    selected = new Set(ids),
    a = p.tasks;
  if (direction < 0) {
    for (let i = 1; i < a.length; i++)
      if (selected.has(a[i].id) && !selected.has(a[i - 1].id)) [a[i - 1], a[i]] = [a[i], a[i - 1]];
  } else {
    for (let i = a.length - 2; i >= 0; i--)
      if (selected.has(a[i].id) && !selected.has(a[i + 1].id)) [a[i], a[i + 1]] = [a[i + 1], a[i]];
  }
  return checkDraft(p);
}
