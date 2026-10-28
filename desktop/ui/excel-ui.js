import { importFields, suggestMapping } from './shared/excel-import-model.js';
import { escapeHtml as esc } from './shared/html.js';
import { ui } from './shared/i18n.js';

export function openExcelDialog({ api, loaded, revision, onApply, onClose }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'desktop-dialog';
  dialog.innerHTML = ui(
    '<div class="dialog-head"><h2>Excel 가져오기</h2><button type="button" class="button" id="excelClose">닫기</button></div><div class="dialog-body"><p>열을 연결하고 미리보기를 확인한 뒤 적용하세요. 파일 저장은 따로 진행합니다.</p><label class="field">시트<select id="excelSheet"></select></label><label class="field">가져오기 방식<select id="excelMode"><option value="append">새 업무 추가</option><option value="update">기존 업무 갱신 (업무 ID)</option></select></label><div id="excelMapping" class="form-grid"></div><p id="excelResult" role="status"></p><div id="excelRows" class="desktop-table-wrap"></div></div><div class="dialog-foot"><button type="button" class="button" id="excelPreview">미리보기</button><button type="button" class="button primary" id="excelApply" disabled>프로젝트에 적용</button></div>',
  );
  document.body.append(dialog);
  const $ = (id) => dialog.querySelector('#' + id);
  let version = 0,
    busy = false,
    applied = false;
  const invalidate = () => {
    version++;
    $('excelApply').disabled = true;
    $('excelRows').innerHTML = '';
    $('excelResult').textContent = ui('열 연결을 확인한 뒤 미리보기를 눌러 주세요.');
  };
  const setSheet = () => {
    invalidate();
    const headers = loaded.sheets[Number($('excelSheet').value)]?.rows[0] || [],
      suggested = suggestMapping(headers);
    $('excelMapping').innerHTML = importFields
      .map(
        ([field, label]) =>
          '<label class="field">' +
          esc(ui(label)) +
          '<select data-map="' +
          field +
          ui('"><option value="-1">가져오지 않음</option>') +
          headers
            .map(
              (h, n) =>
                '<option value="' +
                n +
                '" ' +
                (suggested[field] === n ? 'selected' : '') +
                '>' +
                esc(h || ui('열 ') + (n + 1)) +
                '</option>',
            )
            .join('') +
          '</select></label>',
      )
      .join('');
  };
  $('excelSheet').innerHTML = loaded.sheets
    .map(
      (s, n) =>
        '<option value="' +
        n +
        '" ' +
        (s.name === 'WBS' ? 'selected' : '') +
        '>' +
        esc(s.name) +
        '</option>',
    )
    .join('');
  setSheet();
  $('excelSheet').onchange = setSheet;
  $('excelMode').onchange = invalidate;
  $('excelMapping').onchange = invalidate;
  const buttons = (value) => {
    busy = value;
    $('excelPreview').disabled = value;
    $('excelClose').disabled = value;
  };
  $('excelPreview').onclick = async () => {
    invalidate();
    const request = version;
    buttons(true);
    try {
      const result = await api.previewExcel(loaded.id, {
        sheet: Number($('excelSheet').value),
        mode: $('excelMode').value,
        mapping: Object.fromEntries(
          [...dialog.querySelectorAll('[data-map]')].map((el) => [
            el.dataset.map,
            Number(el.value),
          ]),
        ),
      });
      if (request !== version || !dialog.isConnected) return;
      $('excelResult').textContent =
        result.changes.length + ui('개 업무 · 오류 ') + result.errors.length + ui('건');
      $('excelRows').innerHTML =
        result.errors
          .map((e) => '<p class="error">' + esc(e.row) + ui('행: ') + esc(e.message) + '</p>')
          .join('') +
        ui(
          '<table class="desktop-table"><thead><tr><th>Excel 행</th><th>업무</th><th>시작일</th><th>종료일</th></tr></thead><tbody>',
        ) +
        result.changes
          .map(
            (c) =>
              '<tr><td>' +
              esc(c.row) +
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
      $('excelApply').disabled = result.errors.length > 0;
    } catch (error) {
      $('excelResult').textContent = error.message;
    } finally {
      buttons(false);
    }
  };
  $('excelApply').onclick = async () => {
    buttons(true);
    $('excelApply').disabled = true;
    try {
      const next = await api.applyExcel(loaded.id, revision);
      applied = true;
      onApply(next);
      dialog.close();
    } catch (error) {
      $('excelResult').textContent = error.message;
    } finally {
      buttons(false);
    }
  };
  $('excelClose').onclick = () => dialog.close();
  dialog.addEventListener('cancel', (event) => {
    if (busy) event.preventDefault();
  });
  dialog.addEventListener(
    'close',
    () => {
      if (!applied) void api.cancelExcel(loaded.id).catch(() => {});
      dialog.remove();
      onClose();
    },
    { once: true },
  );
  dialog.showModal();
  $('excelSheet').focus();
  return dialog;
}
