import { ui } from './i18n.js';
import { importFields, suggestMapping, previewImport } from './excel-import-model.js';
export { importFields, suggestMapping, previewImport };
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export function openExcelImport(workspace, readFile, downloadTemplate) {
  const dialog = document.createElement('dialog');
  dialog.className = 'excel-import-dialog';
  document.body.append(dialog);
  let sheets = [],
    preview = null,
    fileRead = 0;
  dialog.innerHTML = ui(
    '<form method="dialog"><button class="button" value="cancel">닫기</button></form><h2>Excel 가져오기</h2><p>파일은 4MB 이하 · 머리글 1행 · 업무 500행까지. 미리보기 적용 후 WBS 저장으로 반영합니다. 갱신은 업무 ID가 일치하는 행만 수정하고, 생략한 업무는 유지합니다.</p><label>Excel 파일<input type="file" accept=".xlsx" id="excelFile"></label><label>시트<select id="excelSheet"></select></label><label>가져오기 방식<select id="excelMode"><option value="append">새 업무 추가</option><option value="update">기존 업무 갱신 (업무 ID)</option></select></label><div id="excelMapping"></div><button class="button" type="button" id="excelPreview">미리보기</button><button class="button primary" type="button" id="excelApply" disabled>초안에 적용</button><div id="excelResult" role="status"></div>',
  );
  const $ = (id) => dialog.querySelector('#' + id),
    invalidate = () => {
      preview = null;
      $('excelApply').disabled = true;
      $('excelResult').textContent = ui('열 연결을 확인한 뒤 미리보기를 눌러 주세요.');
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
          ui('"><option value="-1">가져오지 않음</option>') +
          headers
            .map(
              (h, i) =>
                '<option value="' +
                i +
                '" ' +
                (suggested[field] === i ? 'selected' : '') +
                '>' +
                esc(h || ui('열 ') + (i + 1)) +
                '</option>',
            )
            .join('') +
          '</select></label>',
      )
      .join('');
  };
  $('excelFile').onchange = async () => {
    invalidate();
    const request = ++fileRead,
      file = $('excelFile').files[0];
    sheets = [];
    $('excelSheet').innerHTML = '';
    $('excelMapping').innerHTML = '';
    $('excelPreview').disabled = false;
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      $('excelResult').textContent = ui('4MB 이하의 파일을 선택해 주세요.');
      return;
    }
    $('excelResult').textContent = ui('파일을 읽는 중…');
    $('excelPreview').disabled = true;
    try {
      const result = await readFile(file);
      if (request !== fileRead || !dialog.isConnected) return;
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
      if (request === fileRead && dialog.isConnected)
        $('excelResult').textContent = ui(error.message);
    } finally {
      if (request === fileRead && dialog.isConnected) $('excelPreview').disabled = false;
    }
  };
  $('excelSheet').onchange = setSheet;
  $('excelMode').onchange = invalidate;
  $('excelMapping').onchange = invalidate;
  $('excelPreview').onclick = () => {
    invalidate();
    try {
      const sheet = sheets[Number($('excelSheet').value)];
      if (!sheet) throw Error(ui('먼저 Excel 파일을 선택해 주세요.'));
      if (sheet.error) throw Error(sheet.error);
      preview = previewImport(workspace.draft, sheet.rows.slice(1), mapping(), {
        mode: $('excelMode').value,
      });
      preview.source = JSON.stringify(workspace.draft);
      $('excelResult').innerHTML =
        '<p>' +
        preview.changes.length +
        ui('개 업무 · 오류 ') +
        preview.errors.length +
        ui('건</p>') +
        preview.errors
          .map((e) => '<p class="wbs-error">' + esc(e.row) + ui('행: ') + esc(e.message) + '</p>')
          .join('') +
        ui(
          '<table><thead><tr><th>Excel 행</th><th>업무</th><th>시작일</th><th>종료일</th></tr></thead><tbody>',
        ) +
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
      $('excelResult').textContent = ui(error.message);
    }
  };
  $('excelApply').onclick = () => {
    if (!preview || preview.errors.length) return;
    try {
      if (preview.source !== JSON.stringify(workspace.draft)) {
        invalidate();
        throw Error(ui('프로젝트가 변경되었습니다. 미리보기를 다시 확인해 주세요.'));
      }
      workspace.changed(preview.project);
      workspace.options.toast(
        ui('가져온 업무를 초안에 적용했습니다. 확인 후 WBS 저장을 눌러 주세요.'),
      );
      dialog.close();
    } catch (error) {
      $('excelResult').textContent = ui(error.message);
    }
  };
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  if (downloadTemplate) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button';
    button.textContent = ui('Excel 입력 양식 받기');
    button.onclick = async () => {
      button.disabled = true;
      try {
        await downloadTemplate();
      } catch (error) {
        $('excelResult').textContent = ui(error.message);
      } finally {
        button.disabled = false;
      }
    };
    dialog.querySelector('h2').after(button);
  }
  dialog.showModal();
}
