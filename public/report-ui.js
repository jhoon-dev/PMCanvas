import { escapeHtml as esc } from './html.js';
import { num } from './view-ui.js';
import { today, addDays, summary, validateProject } from './engine.js';
import { csvText, wbsRows, completionRecords, completionRows } from './reports.js';
export function historyBody(p, historyQuery, asOf) {
  const rows = completionRecords(p, historyQuery),
    hours = rows.reduce((s, r) => s + r.hours, 0);
  const body =
    '<div class="report-filters">' +
    '<label class="field">시작일<input id="historyFrom" type="date" value="' +
    esc(historyQuery.from) +
    '" max="' +
    esc(asOf) +
    '" required></label>' +
    '<label class="field">종료일<input id="historyTo" type="date" value="' +
    esc(historyQuery.to) +
    '" max="' +
    asOf +
    '" required></label>' +
    '<label class="field">담당자<select id="historyOwner"><option value="">전체 담당자</option>' +
    p.members
      .map(
        (m) =>
          '<option value="' +
          esc(m.id) +
          '" ' +
          (m.id === historyQuery.owner ? 'selected' : '') +
          '>' +
          esc(m.name) +
          '</option>',
      )
      .join('') +
    '</select></label></div>' +
    '<div class="report-summary"><strong>' +
    rows.length +
    '개 완료 · ' +
    num(hours) +
    'h 예상 공수</strong><button class="button small" data-action="export-history" ' +
    (!rows.length ? 'disabled' : '') +
    '>CSV 출력</button></div>' +
    '<p class="subtle">완료한 항목에 배정된 예상 공수입니다. 실제 근무시간 합계는 아닙니다.</p>' +
    (rows.length
      ? '<div class="table-scroll"><table class="task-table report-table"><thead><tr><th>완료일</th><th>담당자</th><th>업무 / 세부 작업</th><th>예상 공수</th></tr></thead><tbody>' +
        rows
          .slice(0, 200)
          .map(
            (r) =>
              '<tr><td class="nowrap">' +
              esc(r.date) +
              '</td><td>' +
              esc(r.owner) +
              '</td><td><small class="cell-sub">' +
              esc(r.task) +
              '</small><strong>' +
              esc(r.title) +
              '</strong></td><td class="nowrap">' +
              num(r.hours) +
              'h</td></tr>',
          )
          .join('') +
        '</tbody></table></div>'
      : '<div class="calm-state">선택한 기간에 완료한 작업이 없습니다.</div>') +
    (rows.length > 200
      ? '<p class="subtle">최근 200건을 표시합니다. CSV에는 조회된 ' +
        rows.length +
        '건을 모두 출력합니다.</p>'
      : '') +
    '<p class="view-note">현재 남아 있는 완료 기록을 조회합니다. 체크 취소·작업 삭제는 이 내역에 반영됩니다. 변경 전 기록은 대시보드의 변경 이력에서 확인할 수 있습니다.</p>';

  return body;
}
export function importedProject(data, uid = () => crypto.randomUUID()) {
  if (data.format !== 'pm-canvas-project' || data.version !== 1)
    throw Error('PM Canvas 프로젝트 백업 파일이 아닙니다.');
  const p = validateProject(data.project);
  delete p._revision;
  delete p._role;
  p.id = uid();
  p.name = p.name + ' (불러옴)';
  if (p.name.length > 120) p.name = p.name.slice(0, 120);

  return p;
}
export function createReportUi({
  api,
  project,
  wbs,
  getView,
  getDate,
  getOwner,
  filterDailyTasks,
  hasStorageError,
  persist,
  render,
  toast,
  showAuth,
  openInfo,
  onImport,
  currentDate = today(),
  document = globalThis.document,
  URL = globalThis.URL,
  schedule = setTimeout,
  uid = () => crypto.randomUUID(),
}) {
  const $ = (s) => document.querySelector(s),
    TODAY = currentDate;
  $('#backupButton').onclick = () => {
    const p = wbs.dirty && wbs.draft.id === project()?.id ? wbs.snapshot() : project();
    if (!p) {
      toast('백업할 프로젝트가 없습니다.');
      return;
    }
    const blob = new Blob(
        [
          JSON.stringify(
            {
              format: 'pm-canvas-project',
              version: 1,
              exportedAt: new Date().toISOString(),
              project: p,
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
      url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = 'PM-Canvas-' + p.name.replace(/[\\/:*?"<>|]/g, '_') + '-' + TODAY + '.json';
    a.click();
    schedule(() => URL.revokeObjectURL(url), 1000);
    toast('프로젝트 백업을 내려받았습니다.');
  };
  $('#importButton').onclick = () => {
    if (hasStorageError() || wbs.dirty) {
      toast('현재 변경사항을 먼저 저장하거나 백업한 뒤 취소해 주세요.');
      return;
    }
    $('#importFile').click();
  };
  $('#importFile').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (file.size > 8 * 1024 * 1024) throw Error('8MB 이하의 백업 파일을 선택해 주세요.');
      const data = JSON.parse(await file.text());
      const p = importedProject(data, uid);
      onImport(p);
      const saved = await persist();
      render();
      toast(
        saved
          ? '기존 프로젝트를 유지하고 백업을 새 프로젝트로 불러왔습니다.'
          : '불러왔지만 저장에 실패했습니다. 백업을 보관해 주세요.',
      );
    } catch (error) {
      toast('불러오기 실패: ' + error.message);
    }
    e.target.value = '';
  };

  // Reports use the same task data and calculation results as the dashboard.
  let historyQuery;
  function downloadReport(rows, label) {
    const blob = new Blob([csvText(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = 'PM-Canvas-' + project().name.replace(/[\\/:*?"<>|]/g, '_') + '-' + label + '.csv';
    document.body.append(a);
    a.click();
    a.remove();
    schedule(() => URL.revokeObjectURL(url), 1000);
    toast('CSV를 내려받았습니다. Excel에서 열 수 있어요.');
  }
  function exportWbs() {
    const p = getView() === 'tasks' ? wbs.snapshot() : project(),
      tasks = getView() === 'tasks' ? wbs.visible({ includeCollapsed: true }) : filterDailyTasks(p);
    if (!tasks.length) {
      toast('출력할 업무가 없습니다. 검색 조건을 확인해 주세요.');
      return;
    }
    downloadReport(
      wbsRows(p, getDate(), summary(p, getDate()).forecast, tasks),
      'WBS-' + getDate(),
    );
  }
  function openHistory() {
    historyQuery = { from: addDays(getDate(), -13), to: getDate(), owner: getOwner() };
    openInfo('일자별 완료 내역', '');
    $('#infoDialog').classList.add('report-dialog');
    renderHistory();
  }
  function renderHistory() {
    const body = historyBody(project(), historyQuery, getDate());
    $('#infoBody').innerHTML = body;
  }
  function exportHistory() {
    downloadReport(
      completionRows(project(), completionRecords(project(), historyQuery)),
      '완료내역-' + historyQuery.from + '_' + historyQuery.to,
    );
  }
  $('#infoBody').addEventListener('change', (e) => {
    if (!['historyFrom', 'historyTo', 'historyOwner'].includes(e.target.id)) return;
    const next = {
      from: $('#historyFrom').value,
      to: $('#historyTo').value,
      owner: $('#historyOwner').value,
    };
    try {
      if (next.to > getDate()) throw Error('보고 기준일 이후의 날짜는 조회할 수 없습니다.');
      completionRecords(project(), next);
      historyQuery = next;
      renderHistory();
    } catch (error) {
      toast(error.message);
      renderHistory();
    }
  });

  let exportingExcel = false;
  async function exportExcel() {
    if (exportingExcel) return;
    try {
      if (getView() === 'tasks') wbs.commitAll();
      const p = getView() === 'tasks' ? wbs.snapshot() : project(),
        taskIds = (
          getView() === 'tasks' ? wbs.visible({ includeCollapsed: true }) : filterDailyTasks(p)
        ).map((t) => t.id),
        at = getDate();
      if (!taskIds.length) {
        toast('출력할 업무가 없습니다. 검색 조건을 확인해 주세요.');
        return;
      }
      exportingExcel = true;
      const blob = await api('projects/' + p.id + '/export.xlsx', {
        method: 'POST',
        responseType: 'blob',
        body: { project: p, taskIds, asOf: at },
      });
      const url = URL.createObjectURL(blob),
        a = document.createElement('a');
      a.href = url;
      a.download = 'PMCanvas-' + p.name.replace(/[\\/:*?"<>|]/g, '_') + '-' + at + '.xlsx';
      document.body.append(a);
      a.click();
      a.remove();
      schedule(() => URL.revokeObjectURL(url), 1000);
      toast('Excel 파일을 내려받았습니다.');
    } catch (e) {
      if (e.status === 401) showAuth();
      toast(e.message);
    } finally {
      exportingExcel = false;
    }
  }

  return { wbs: exportWbs, excel: exportExcel, history: openHistory, historyCsv: exportHistory };
}
