import { ui } from './i18n.js';
import { columns, newTask, setCell, checkDraft } from './wbs-model.js';
import { hierarchy } from './planning.js';
import { taskHours } from './engine.js';
export const importFields = [['id', '업무 ID (갱신용)'], ['parent', '상위 업무 ID'], ...columns];
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
    rows.length > 500 ||
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
      entries.push({ task, row, index, value });
      for (const [field] of columns)
        if (!['predecessor'].includes(field) && mapping[field] >= 0) {
          const text = value(field);
          if (
            field === 'owner' &&
            (!text || text === '미지정' || text === 'Unassigned' || text === ui('미지정'))
          )
            task.owner = '';
          else if (mode === 'update' && field === 'hours' && Number(text) === taskHours(task))
            continue;
          else setCell(p, task, field, text);
        }
      checkDraft({ ...p, tasks: [{ ...task, parentId: '', predecessor: '' }] });
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
        if (importedIds.has(text)) e.task.predecessor = importedIds.get(text);
        else setCell(p, e.task, 'predecessor', text);
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
