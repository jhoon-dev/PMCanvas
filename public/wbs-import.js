import { columns, newTask, setCell, checkDraft } from './wbs-model.js';
import { hierarchy } from './planning.js';
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
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
        .map((a) => headers.findIndex((h) => String(h).trim() === a))
        .find((i) => i >= 0) ?? headers.findIndex((h) => label === String(h).trim()),
    ]),
  );
}
export function previewImport(project, rows, mapping, { mode = 'append' } = {}) {
  const p = structuredClone(project),
    errors = [],
    changes = [],
    entries = [],
    seen = new Set();
  if (['name', 'start', 'end'].some((k) => !Number.isInteger(mapping[k]) || mapping[k] < 0))
    throw Error('업무명·시작일·종료일 열을 연결해 주세요.');
  if (mode === 'update' && mapping.id < 0)
    throw Error('기존 업무 갱신에는 업무 ID 열이 필요합니다.');
  rows.forEach((row, index) => {
    if (row.every((v) => v === '' || v == null)) return;
    const value = (key) => (mapping[key] >= 0 ? String(row[mapping[key]] ?? '').trim() : '');
    try {
      let task;
      if (mode === 'update') {
        const id = value('id');
        task = p.tasks.find((t) => t.id === id);
        if (!task) throw Error('현재 프로젝트에 없는 업무 ID입니다.');
        if (seen.has(id)) throw Error('업무 ID가 중복됩니다.');
        seen.add(id);
      } else {
        task = newTask(p);
        p.tasks.push(task);
      }
      entries.push({ task, row, index, value });
      for (const [field] of columns)
        if (!['predecessor'].includes(field) && mapping[field] >= 0) {
          const text = value(field);
          if (field === 'owner' && (!text || text === '미지정')) task.owner = '';
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
      errors.push({ row: index + 2, message: error.message });
    }
  });
  // Resolve exported IDs and names only after every new row exists.
  const importedIds = new Map();
  for (const e of entries)
    if (e.value('id')) {
      if (importedIds.has(e.value('id')))
        errors.push({ row: e.index + 2, message: '업무 ID가 중복됩니다.' });
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
      errors.push({ row: e.index + 2, message: error.message });
    }
  try {
    checkDraft(p);
    hierarchy(p);
  } catch (error) {
    errors.push({ row: '전체', message: error.message });
  }
  if (!changes.length) errors.push({ row: '전체', message: '가져올 업무가 없습니다.' });
  return { project: p, errors, changes };
}

export function openExcelImport(workspace, readFile) {
  const dialog = document.createElement('dialog');
  dialog.className = 'excel-import-dialog';
  document.body.append(dialog);
  let sheets = [],
    preview = null,
    version = 0;
  dialog.innerHTML =
    '<form method="dialog"><button class="button" value="cancel">닫기</button></form><h2>Excel 가져오기</h2><p>파일은 4MB 이하 · 머리글 1행 · 업무 500행까지. 미리보기 적용 후 WBS 저장으로 반영합니다. 갱신은 업무 ID가 일치하는 행만 수정하고, 생략한 업무는 유지합니다.</p><label>Excel 파일<input type="file" accept=".xlsx" id="excelFile"></label><label>시트<select id="excelSheet"></select></label><label>가져오기 방식<select id="excelMode"><option value="append">새 업무 추가</option><option value="update">기존 업무 갱신 (업무 ID)</option></select></label><div id="excelMapping"></div><button class="button" type="button" id="excelPreview">미리보기</button><button class="button primary" type="button" id="excelApply" disabled>초안에 적용</button><div id="excelResult" role="status"></div>';
  const $ = (id) => dialog.querySelector('#' + id),
    invalidate = () => {
      version++;
      preview = null;
      $('excelApply').disabled = true;
      $('excelResult').textContent = '열 연결을 확인한 뒤 미리보기를 눌러 주세요.';
    };
  const mapping = () =>
    Object.fromEntries(
      [...dialog.querySelectorAll('[data-map]')].map((el) => [el.dataset.map, Number(el.value)]),
    );
  const setSheet = () => {
    invalidate();
    const active = sheets[Number($('excelSheet').value)];
    if (active?.error) $('excelResult').textContent = active.error;
    const headers = active?.rows[0] || [],
      suggested = suggestMapping(headers);
    $('excelMapping').innerHTML = importFields
      .map(
        ([field, label]) =>
          '<label>' +
          label +
          '<select data-map="' +
          field +
          '"><option value="-1">가져오지 않음</option>' +
          headers
            .map(
              (h, i) =>
                '<option value="' +
                i +
                '" ' +
                (suggested[field] === i ? 'selected' : '') +
                '>' +
                esc(h || '열 ' + (i + 1)) +
                '</option>',
            )
            .join('') +
          '</select></label>',
      )
      .join('');
  };
  $('excelFile').onchange = async () => {
    invalidate();
    const request = version,
      file = $('excelFile').files[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      $('excelResult').textContent = '4MB 이하의 파일을 선택해 주세요.';
      return;
    }
    $('excelResult').textContent = '파일을 읽는 중…';
    try {
      const result = await readFile(file);
      if (request !== version || !dialog.isConnected) return;
      sheets = result.sheets;
      $('excelSheet').innerHTML = sheets
        .map(
          (s, i) =>
            '<option value="' +
            i +
            '" ' +
            (s.name === 'WBS' ? 'selected' : '') +
            '>' +
            esc(s.name) +
            '</option>',
        )
        .join('');
      setSheet();
    } catch (error) {
      $('excelResult').textContent = error.message;
    }
  };
  $('excelSheet').onchange = setSheet;
  $('excelMode').onchange = invalidate;
  $('excelMapping').onchange = invalidate;
  $('excelPreview').onclick = () => {
    invalidate();
    try {
      const sheet = sheets[Number($('excelSheet').value)];
      if (!sheet) throw Error('먼저 Excel 파일을 선택해 주세요.');
      if (sheet.error) throw Error(sheet.error);
      preview = previewImport(workspace.draft, sheet.rows.slice(1), mapping(), {
        mode: $('excelMode').value,
      });
      $('excelResult').innerHTML =
        '<p>' +
        preview.changes.length +
        '개 업무 · 오류 ' +
        preview.errors.length +
        '건</p>' +
        preview.errors
          .map((e) => '<p class="wbs-error">' + esc(e.row) + '행: ' + esc(e.message) + '</p>')
          .join('') +
        '<table><thead><tr><th>Excel 행</th><th>업무</th><th>시작일</th><th>종료일</th></tr></thead><tbody>' +
        preview.changes
          .slice(0, 500)
          .map(
            (c) =>
              '<tr><td>' +
              c.row +
              '</td><td>' +
              esc(c.name) +
              '</td><td>' +
              esc(c.start) +
              '</td><td>' +
              esc(c.end) +
              '</td></tr>',
          )
          .join('') +
        '</tbody></table>';
      $('excelApply').disabled = preview.errors.length > 0;
    } catch (error) {
      $('excelResult').textContent = error.message;
    }
  };
  $('excelApply').onclick = () => {
    if (!preview || preview.errors.length) return;
    try {
      workspace.changed(preview.project);
      workspace.options.toast('가져온 업무를 초안에 적용했습니다. 확인 후 WBS 저장을 눌러 주세요.');
      dialog.close();
    } catch (error) {
      $('excelResult').textContent = error.message;
    }
  };
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
}
