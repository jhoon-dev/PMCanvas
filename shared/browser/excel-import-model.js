import { LIMITS, summaryIds, taskView } from './task-model.js';
import { ui } from './i18n.js';
import { columns, newTask, setCell, checkDraft } from './wbs-model.js';
import { hierarchy } from './planning.js';
import { taskHours } from './engine.js';
export const importFields = [
  ['id', '업무 ID (갱신용)'],
  ['parent', '상위 업무 ID'],
  ['kind', '업무 유형'],
  ['milestoneDone', '마일스톤 완료일'],
  ...columns,
];
export function suggestMapping(headers) {
  const aliases = {
    predecessor: ['선행 업무 ID'],
    id: ['업무 ID'],
    parent: ['상위 업무 ID'],
    hours: ['공수 (h)', '예상 공수 (h)'],
    start: ['계획 시작일'],
    end: ['계획 종료일'],
  };
  return Object.fromEntries(
    importFields.map(([key, label]) => [
      key,
      (aliases[key] || [])
        .map((a) => headers.findIndex((h) => [a, ui(a), ui(a, 'en')].includes(String(h).trim())))
        .find((i) => i >= 0) ??
        headers.findIndex((h) => [label, ui(label), ui(label, 'en')].includes(String(h).trim())),
    ]),
  );
}
export function previewImport(project, rows, mapping, { mode = 'append' } = {}) {
  if (
    !['append', 'update'].includes(mode) ||
    !Array.isArray(rows) ||
    rows.length > LIMITS.tasks ||
    rows.some((r) => !Array.isArray(r) || r.length > 40) ||
    !mapping ||
    typeof mapping !== 'object' ||
    importFields.some(
      ([key]) =>
        mapping[key] !== undefined &&
        (!Number.isInteger(mapping[key]) || mapping[key] < -1 || mapping[key] > 39),
    )
  )
    throw Error(ui('가져오기 설정과 행·열 개수를 확인해 주세요.'));
  const p = structuredClone(project),
    errors = [],
    changes = [],
    entries = [],
    seen = new Set();
  if (['name', 'start', 'end'].some((k) => !Number.isInteger(mapping[k]) || mapping[k] < 0))
    throw Error(ui('업무명·시작일·종료일 열을 연결해 주세요.'));
  if (mode === 'update' && mapping.id < 0)
    throw Error(ui('기존 업무 갱신에는 업무 ID 열이 필요합니다.'));
  rows.forEach((row, index) => {
    if (row.every((v) => v === '' || v == null)) return;
    const value = (key) => (mapping[key] >= 0 ? String(row[mapping[key]] ?? '').trim() : '');
    try {
      let task;
      if (mode === 'update') {
        const id = value('id');
        task = p.tasks.find((t) => t.id === id);
        if (!task) throw Error(ui('현재 프로젝트에 없는 업무 ID입니다.'));
        if (seen.has(id)) throw Error(ui('업무 ID가 중복됩니다.'));
        seen.add(id);
      } else {
        task = newTask(p);
        p.tasks.push(task);
      }
      const parentRefs = new Set(
        rows
          .map((r) => (mapping.parent >= 0 ? String(r[mapping.parent] ?? '').trim() : ''))
          .filter(Boolean),
      );
      if (
        mode === 'append' &&
        (value('kind') === 'summary' || (value('id') && parentRefs.has(value('id'))))
      ) {
        task.kind = 'summary';
        task.items = [];
        task.owner = '';
      }
      if (mode === 'append' && value('kind') === 'milestone') {
        task.kind = 'milestone';
        task.items = [];
        task.owner = '';
        task.doneDate = value('milestoneDone') || null;
      }
      if (mode === 'update' && task.kind === 'milestone' && mapping.milestoneDone >= 0)
        task.doneDate = value('milestoneDone') || null;
      entries.push({ task, row, index, value });
      for (const [field] of columns)
        if (!['predecessor'].includes(field) && mapping[field] >= 0) {
          const text = value(field);
          if (summaryIds(p).has(task.id) && ['owner', 'start', 'end', 'hours'].includes(field)) {
            const view = taskView(p, task);
            if (mode === 'append') {
              if (field === 'start' || field === 'end') task[field] = text;
            } else if (
              field === 'hours'
                ? Number(text) !== taskHours(view)
                : field === 'owner'
                  ? !['', '미지정', 'Unassigned', ui('미지정')].includes(text)
                  : text !== view[field]
            )
              throw Error(
                ui('요약 업무의 일정·공수는 하위 업무에서 계산합니다. 하위 업무를 수정해 주세요.'),
              );
            continue;
          }
          if (
            field === 'owner' &&
            (!text || text === '미지정' || text === 'Unassigned' || text === ui('미지정'))
          )
            task.owner = '';
          else if (mode === 'update' && field === 'hours' && Number(text) === taskHours(task))
            continue;
          else setCell(p, task, field, text);
        }
      checkDraft({
        ...p,
        tasks: [{ ...task, parentId: '', predecessor: '', predecessors: undefined }],
      });
      changes.push({
        row: index + 2,
        id: task.id,
        name: task.name,
        start: task.start,
        end: task.end,
      });
    } catch (error) {
      errors.push({ row: index + 2, message: ui(error.message) });
    }
  });
  // Resolve exported IDs and names only after every new row exists.
  const importedIds = new Map();
  for (const e of entries)
    if (e.value('id')) {
      if (importedIds.has(e.value('id')))
        errors.push({ row: e.index + 2, message: ui('업무 ID가 중복됩니다.') });
      importedIds.set(e.value('id'), e.task.id);
    }
  for (const e of entries)
    try {
      if (mapping.predecessor >= 0) {
        const text = e.value('predecessor');
        const resolved = text
          .split(/[,;\n]+/)
          .map((v) => v.trim())
          .filter(Boolean)
          .map((v) => importedIds.get(v) || v);
        setCell(p, e.task, 'predecessor', resolved.join(', '));
      }
      if (mapping.parent >= 0) {
        const parent = e.value('parent');
        e.task.parentId = importedIds.get(parent) || parent;
      }
    } catch (error) {
      errors.push({ row: e.index + 2, message: ui(error.message) });
    }
  try {
    checkDraft(p);
    hierarchy(p);
  } catch (error) {
    errors.push({ row: ui('전체'), message: ui(error.message) });
  }
  if (!changes.length) errors.push({ row: ui('전체'), message: ui('가져올 업무가 없습니다.') });
  return { project: p, errors, changes };
}
