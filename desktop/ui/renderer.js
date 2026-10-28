import {
  today,
  validDate,
  summary,
  progress,
  taskHours,
  daysBetween,
  addDays,
} from './shared/engine.js';
import { escapeHtml as esc } from './shared/html.js';
import { setLanguage } from './shared/i18n.js';
import { editorForm, itemEditor, applyEditor } from './shared/project-editor.js';
import { peopleView } from './shared/people-view.js';
import { completionRecords } from './shared/reports.js';
import { openExcelDialog } from './excel-ui.js';
import { pct, num, person, meter, badge, pageHead, btn, empty } from './shared/view-ui.js';

setLanguage('ko');
const api = window.desktop;
const $ = (selector) => document.querySelector(selector);
let state = { project: null, revision: -1, dirty: false, filename: '' };
let view = 'overview',
  reportDate = today(),
  query = '',
  owner = '';
let editor = null,
  busy = false,
  toastTimer;
let reportFrom = addDays(today(), -6),
  reportTo = today(),
  reportOwner = '';
let reportFormat = 'xlsx',
  importing = false;
const busyButtons = new Set();
function toast(text) {
  $('#toast').textContent = text;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $('#toast').hidden = true;
  }, 5000);
}
function accept(next) {
  if (next && next.revision >= state.revision) {
    state = next;
    render();
  }
}
function setBusy(value) {
  busy = value;
  if (value) {
    document.querySelectorAll('button:not(:disabled)').forEach((button) => {
      busyButtons.add(button);
      button.disabled = true;
    });
  } else {
    busyButtons.forEach((button) => {
      button.disabled = false;
    });
    busyButtons.clear();
  }
}
async function run(operation) {
  if (busy) return null;
  setBusy(true);
  try {
    return await operation();
  } catch (error) {
    toast(error.message);
    return null;
  } finally {
    setBusy(false);
  }
}
function filtered(p) {
  return p.tasks.filter(
    (task) =>
      (!query || task.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) &&
      (!owner || task.owner === owner),
  );
}
function controls(p, search = true) {
  return (
    '<div class="desktop-controls">' +
    (search
      ? '<input type="search" id="search" aria-label="업무 검색" placeholder="업무 검색" value="' +
        esc(query) +
        '">' +
        '<select id="owner" aria-label="담당자 필터"><option value="">전체 담당자</option>' +
        p.members
          .map(
            (member) =>
              '<option value="' +
              esc(member.id) +
              '" ' +
              (owner === member.id ? 'selected' : '') +
              '>' +
              esc(member.name) +
              '</option>',
          )
          .join('') +
        '</select>'
      : '') +
    '<label>보고 기준일 <input id="reportDate" aria-label="보고 기준일" type="date" value="' +
    reportDate +
    '" max="' +
    today() +
    '"></label></div>'
  );
}
function taskTable(p, s, tasks = p.tasks) {
  if (!tasks.length)
    return '<div class="desktop-note" style="padding:24px">표시할 업무가 없습니다.</div>';
  return (
    '<div class="desktop-table-wrap"><table class="desktop-table"><thead><tr><th>업무</th><th>담당자</th><th>계획 일정</th><th>공수</th><th>진척률</th><th>예상 완료일</th><th>상태</th></tr></thead><tbody>' +
    tasks
      .map(
        (task) =>
          '<tr><td><button class="task-name" data-edit-task="' +
          esc(task.id) +
          '">' +
          esc(task.name) +
          '</button><span class="task-phase">' +
          esc(task.phase || '일반') +
          '</span></td><td>' +
          person(p, task.owner) +
          '</td><td>' +
          task.start +
          '<br>' +
          task.end +
          '</td><td>' +
          num(taskHours(task)) +
          'h</td><td>' +
          pct(progress(task, reportDate)) +
          meter(progress(task, reportDate)) +
          '</td><td>' +
          (s.forecast.tasks[task.id]?.end || '계산 대기') +
          '</td><td>' +
          badge(task, reportDate) +
          '</td></tr>',
      )
      .join('') +
    '</tbody></table></div>'
  );
}
function gantt(p, tasks) {
  if (!tasks.length) return '';
  const start = tasks.map((task) => task.start).sort()[0];
  const end = tasks
    .map((task) => task.end)
    .sort()
    .at(-1);
  const span = Math.max(1, daysBetween(start, end) + 1);
  return (
    '<div class="panel desktop-gantt"><div class="desktop-gantt-period"><span>' +
    start +
    '</span><span>계획 일정 · 파란색은 현재 진척률</span><span>' +
    end +
    '</span></div>' +
    tasks
      .map(
        (task) =>
          '<div class="desktop-gantt-row"><span title="' +
          esc(task.name) +
          '">' +
          esc(task.name) +
          '</span><div class="desktop-gantt-track"><div class="desktop-gantt-bar" title="' +
          task.start +
          ' ~ ' +
          task.end +
          '" style="left:' +
          (daysBetween(start, task.start) / span) * 100 +
          '%;width:' +
          ((daysBetween(task.start, task.end) + 1) / span) * 100 +
          '%"><i style="width:' +
          progress(task, reportDate) * 100 +
          '%"></i></div></div></div>',
      )
      .join('') +
    '</div>'
  );
}
function overview(p, s) {
  return (
    pageHead(
      'PROJECT OVERVIEW',
      p.name,
      p.description || '오늘의 기록으로 프로젝트의 다음 일정을 확인하세요.',
      btn('프로젝트 설정', 'settings') + btn('＋ 업무 추가', 'task', 'primary'),
    ) +
    controls(p, false) +
    '<section class="desktop-summary-grid">' +
    '<article class="desktop-metric"><small>실제 진척률</small><strong>' +
    pct(s.progress) +
    '</strong>' +
    meter(s.progress) +
    '<p>계획 진척률 ' +
    pct(s.planned) +
    ' · 공수 가중</p></article>' +
    '<article class="desktop-metric"><small>예상 완료일</small><strong style="font-size:23px">' +
    (s.forecast.end || '계산 대기') +
    '</strong><p>' +
    (s.forecast.observed ? '최근 완료 속도 반영' : '계획 · 가용시간 기준 추정') +
    '</p></article>' +
    '<article class="desktop-metric"><small>완료한 업무</small><strong>' +
    s.completed +
    '<span style="font-size:15px;color:#9aa3b4"> / ' +
    p.tasks.length +
    '</span></strong><p>' +
    num(s.done) +
    'h / ' +
    num(s.total) +
    'h 완료</p></article>' +
    '<article class="desktop-metric"><small>기한을 넘긴 업무</small><strong>' +
    s.overdue +
    '<span style="font-size:15px">개</span></strong><p>미완료 업무 중 계획 종료일 경과</p></article></section>' +
    '<section class="panel"><div class="desktop-section-head"><h2>업무 진행 현황</h2><button class="button small" data-go="daily">완료 체크 →</button></div>' +
    taskTable(p, s) +
    '</section>' +
    '<p class="desktop-note">예상 완료일은 계획 일정·담당자 가용시간·완료 기록을 바탕으로 계산합니다. 등급은 분류에만 사용합니다.<br>토·일요일과 프로젝트 설정의 휴무일을 제외합니다. 완료 기록이 부족하면 계획 기준으로 추정합니다.</p>'
  );
}
function tasksView(p, s) {
  const tasks = filtered(p);
  return (
    pageHead(
      'WORK & SCHEDULE',
      '업무 · 일정',
      '담당자와 계획을 정하고, 세부 작업 단위로 완료를 기록하세요.',
      btn('＋ 업무 추가', 'task', 'primary'),
    ) +
    controls(p) +
    '<section class="panel">' +
    taskTable(p, s, tasks) +
    '</section>' +
    '<h2 style="font-size:15px;margin:28px 0 14px">계획 간트</h2>' +
    gantt(p, tasks) +
    '<p class="desktop-note">업무 이름을 누르면 일정·담당자·선행 업무·체크리스트를 수정할 수 있습니다.</p>'
  );
}
function daily(p) {
  const tasks = filtered(p);
  return (
    pageHead(
      'DAILY CHECK-IN',
      '완료 체크',
      '실제로 완료한 세부 작업만 체크하세요. 보고 기준일이 완료일로 기록됩니다.',
      '',
    ) +
    controls(p) +
    (tasks.length
      ? tasks
          .map(
            (task) =>
              '<article class="panel check-panel"><div class="check-task-head"><div><span class="eyebrow">' +
              esc(task.phase || '일반') +
              '</span><h2><button class="task-name" data-edit-task="' +
              esc(task.id) +
              '">' +
              esc(task.name) +
              '</button></h2><div class="task-meta">' +
              person(p, task.owner) +
              '<span>' +
              task.start +
              ' — ' +
              task.end +
              '</span>' +
              badge(task, reportDate) +
              '</div></div><strong>' +
              pct(progress(task, reportDate)) +
              '</strong></div><div class="check-items">' +
              task.items
                .map((item) => {
                  const later = item.doneDate && item.doneDate > reportDate;
                  return (
                    '<label class="check-item ' +
                    (item.doneDate && !later ? 'is-done' : '') +
                    '"><input type="checkbox" data-check="' +
                    esc(task.id) +
                    '" data-item="' +
                    esc(item.id) +
                    '" ' +
                    (item.doneDate && !later ? 'checked' : '') +
                    ' ' +
                    (later ? 'disabled' : '') +
                    '><span>' +
                    esc(item.title) +
                    '</span><small>' +
                    num(item.hours) +
                    'h</small><small class="desktop-check-date">' +
                    (item.doneDate ? (later ? '이후 완료 · ' : '완료 · ') + item.doneDate : '') +
                    '</small></label>'
                  );
                })
                .join('') +
              '</div></article>',
          )
          .join('')
      : empty(
          '체크할 업무가 없습니다',
          '업무와 세부 작업을 먼저 추가해 주세요.',
          'task',
          '업무 추가',
        ))
  );
}
function reportsView(p, s) {
  const records = completionRecords(p, { from: reportFrom, to: reportTo, owner: reportOwner });
  const hours = records.reduce((sum, record) => sum + record.hours, 0);
  return (
    pageHead(
      'PROJECT REPORTS',
      '보고서',
      '업무 현황과 완료 기록을 확인하고 Excel 또는 CSV로 저장하세요.',
      '',
    ) +
    '<section class="panel desktop-report-panel"><div class="desktop-section-head"><h2>업무 현황</h2>' +
    '<div class="desktop-controls"><label>파일 형식<select id="reportFormat" aria-label="보고서 파일 형식"><option value="xlsx" ' +
    (reportFormat === 'xlsx' ? 'selected' : '') +
    '>Excel (.xlsx)</option><option value="csv" ' +
    (reportFormat === 'csv' ? 'selected' : '') +
    '>CSV</option></select></label><button class="button small" data-command="exportWbs">업무 현황 ' +
    reportFormat.toUpperCase() +
    ' 저장</button></div></div>' +
    '<div class="desktop-report-filters">' +
    controls(p, false) +
    '</div>' +
    '<p class="desktop-report-summary">전체 업무 ' +
    p.tasks.length +
    '개 · 실제 진척률 ' +
    pct(s.progress) +
    ' · 계획 진척률 ' +
    pct(s.planned) +
    '</p>' +
    taskTable(p, s) +
    '</section>' +
    '<section class="panel desktop-report-panel"><div class="desktop-section-head"><h2>완료 기록</h2>' +
    '<button class="button small" data-command="exportCompletion">완료 기록 ' +
    reportFormat.toUpperCase() +
    ' 저장</button></div>' +
    '<div class="desktop-controls desktop-report-filters">' +
    '<label>조회 시작일 <input id="reportFrom" type="date" aria-label="조회 시작일" value="' +
    reportFrom +
    '" max="' +
    today() +
    '"></label>' +
    '<label>조회 종료일 <input id="reportTo" type="date" aria-label="조회 종료일" value="' +
    reportTo +
    '" max="' +
    today() +
    '"></label>' +
    '<select id="reportOwner" aria-label="완료 기록 담당자"><option value="">전체 담당자</option>' +
    p.members
      .map(
        (member) =>
          '<option value="' +
          esc(member.id) +
          '" ' +
          (reportOwner === member.id ? 'selected' : '') +
          '>' +
          esc(member.name) +
          '</option>',
      )
      .join('') +
    '</select></div><p class="desktop-report-summary" role="status">완료한 세부 작업 ' +
    records.length +
    '건 · ' +
    num(hours) +
    'h</p>' +
    (records.length
      ? '<div class="desktop-table-wrap"><table class="desktop-table"><thead><tr><th>완료일</th><th>담당자</th><th>업무 / 세부 작업</th><th>공수</th></tr></thead><tbody>' +
        records
          .map(
            (record) =>
              '<tr><td>' +
              record.date +
              '</td><td>' +
              esc(record.owner) +
              '</td><td><strong>' +
              esc(record.task) +
              '</strong><br>' +
              esc(record.title) +
              '</td><td>' +
              num(record.hours) +
              'h</td></tr>',
          )
          .join('') +
        '</tbody></table></div>'
      : '<p class="desktop-report-empty">선택한 기간과 담당자의 완료 기록이 없습니다.</p>') +
    '</section><p class="desktop-note">업무 현황은 보고 기준일까지, 완료 기록은 선택한 조회 기간에 완료한 작업을 집계합니다.<br>적용된 미저장 변경도 보고서에 포함됩니다. 보고서 저장 후에도 프로젝트 파일은 별도로 저장하세요.</p>'
  );
}
function render() {
  const p = state.project;
  if (reportOwner && !p?.members.some((member) => member.id === reportOwner)) reportOwner = '';
  $('#projectName').textContent = p?.name || '프로젝트를 열어 주세요';
  $('#fileName').textContent =
    state.filename || (p ? '새 프로젝트 · 파일 저장 필요' : '내 PC에서 편하게 관리하세요');
  $('#saveStatus').textContent = p
    ? state.dirty
      ? '● 미저장 변경 · 복구 사본 보관됨'
      : '파일에 저장됨'
    : '프로젝트 파일을 열거나 새로 만드세요';
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
    button.setAttribute('aria-current', button.dataset.view === view ? 'page' : 'false');
  });
  if (!p) {
    $('#content').innerHTML =
      '<section class="desktop-welcome"><span class="eyebrow">YOUR PROJECT, ON YOUR DESKTOP</span><h1>계획하고, 체크하고,<br>한눈에 확인하세요.</h1><p>참여인력과 업무 일정을 입력하고<br>완료한 작업을 기록하면 진척률과 예상 완료일을 계산합니다.<br>로그인이나 서버 설치 없이 이 PC에서 바로 시작하세요.</p><div class="head-actions"><button class="button primary" data-command="new">새 프로젝트 만들기</button><button class="button" data-command="open">프로젝트 파일 열기</button></div><p class="desktop-note">기존 웹 버전의 프로젝트 JSON 백업도 불러올 수 있습니다.</p></section>';
    return;
  }
  const s = summary(p, reportDate);
  $('#content').innerHTML =
    view === 'reports'
      ? reportsView(p, s)
      : view === 'people'
        ? peopleView(p, s, reportDate)
        : view === 'daily'
          ? daily(p)
          : view === 'tasks'
            ? tasksView(p, s)
            : overview(p, s);
}
async function openEditor(type, id = '') {
  if (busy || !state.project || editor) return;
  await api.editing(true);
  editor = { type, id };
  const form = editorForm(type, state.project, id);
  $('#dialogTitle').textContent = form.title;
  $('#dialogBody').innerHTML = form.body;
  $('#formError').textContent = '';
  $('#deleteButton').hidden = !id;
  $('#editorDialog').showModal();
  $('#dialogBody input')?.focus();
}
async function closeEditor() {
  if (busy) return;
  await api.editing(false);
  editor = null;
  $('#editorDialog').close();
}
async function commit(project) {
  const next = await api.replace(project, state.revision);
  accept(next);
}
async function command(name) {
  if (editor || importing) {
    toast('입력창의 변경사항을 먼저 적용하거나 취소해 주세요.');
    return;
  }
  const result = await run(async () => {
    if (name === 'new') {
      const next = await api.newProject();
      if (next) {
        query = '';
        owner = '';
        view = 'people';
        accept(next);
      }
      return next;
    }
    if (name === 'open') {
      const next = await api.open();
      if (next) {
        query = '';
        owner = '';
        view = 'overview';
        accept(next);
      }
      return next;
    }
    if (name === 'save' || name === 'saveAs') {
      const next = await api[name]();
      if (next) {
        accept(next);
        toast('프로젝트 파일을 저장했습니다.');
      }
      return next;
    }
    if (name === 'exportWeb') {
      if (await api.exportWeb()) toast('웹 버전용 JSON 파일을 저장했습니다.');
    }
    if (name === 'importExcel') {
      const loaded = await api.openExcel(state.revision);
      if (!loaded) return null;
      importing = true;
      openExcelDialog({
        api,
        loaded,
        revision: state.revision,
        onApply: (next) => {
          accept(next);
          toast('Excel 내용을 적용했습니다. 확인 후 파일을 저장해 주세요.');
        },
        onClose: () => {
          importing = false;
        },
      });
    }
    if (name === 'exportTemplate' && (await api.exportTemplate(state.revision)))
      toast('Excel 입력 양식을 저장했습니다.');
    if (
      name === 'exportExcel' &&
      (await api.exportReport({ kind: 'wbs', at: reportDate, format: 'xlsx' }, state.revision))
    )
      toast('Excel 보고서를 저장했습니다.');
    if (name === 'exportWbs' || name === 'exportCompletion') {
      const options =
        name === 'exportWbs'
          ? { kind: 'wbs', at: reportDate }
          : { kind: 'completion', from: reportFrom, to: reportTo, owner: reportOwner };
      options.format = reportFormat;
      if (await api.exportReport(options, state.revision))
        toast(
          reportFormat === 'csv' ? 'CSV 보고서를 저장했습니다.' : 'Excel 보고서를 저장했습니다.',
        );
    }
    return null;
  });
  if (name === 'new' && result) await openEditor('settings');
}
document.addEventListener('click', (event) => {
  const target = event.target.closest('button, [data-command]');
  if (!target || busy) return;
  if (target.dataset.command) {
    void command(target.dataset.command);
    return;
  }
  const nextView = target.dataset.view || target.dataset.go;
  if (nextView) {
    view = nextView;
    render();
    return;
  }
  if (target.dataset.editTask) {
    void openEditor('task', target.dataset.editTask);
    return;
  }
  if (target.dataset.editMember) {
    void openEditor('member', target.dataset.editMember);
    return;
  }
  if (['member', 'task', 'settings'].includes(target.dataset.action))
    void openEditor(target.dataset.action);
});
document.addEventListener('input', (event) => {
  if (event.target.id !== 'search') return;
  query = event.target.value;
  const caret = event.target.selectionStart;
  render();
  $('#search').focus();
  $('#search').setSelectionRange(caret, caret);
});
document.addEventListener('change', async (event) => {
  if (event.target.id === 'reportFormat') {
    reportFormat = event.target.value === 'csv' ? 'csv' : 'xlsx';
    render();
    return;
  }
  if (['reportFrom', 'reportTo', 'reportOwner'].includes(event.target.id)) {
    const from = $('#reportFrom').value,
      to = $('#reportTo').value;
    if (!validDate(from) || !validDate(to) || from > to || to > today()) {
      toast('오늘까지의 올바른 조회 기간을 선택해 주세요.');
    } else {
      reportFrom = from;
      reportTo = to;
      reportOwner = $('#reportOwner').value;
    }
    render();
    return;
  }
  if (event.target.id === 'owner') {
    owner = event.target.value;
    render();
  }
  if (event.target.id === 'reportDate') {
    const date = event.target.value;
    if (!validDate(date) || date > today()) {
      toast('오늘까지의 날짜를 선택해 주세요.');
      render();
      return;
    }
    reportDate = date;
    render();
  }
  if (!event.target.dataset.check || busy) return;
  const taskId = event.target.dataset.check;
  const itemId = event.target.dataset.item;
  const checked = event.target.checked;
  await run(async () => {
    const p = structuredClone(state.project);
    const item = p.tasks
      .find((task) => task.id === taskId)
      ?.items.find((item) => item.id === itemId);
    if (!item || item.doneDate > reportDate) throw Error('완료 기록을 확인해 주세요.');
    item.doneDate = checked ? reportDate : null;
    await commit(p);
  });
  render();
});
$('#editorForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || !editor) return;
  setBusy(true);
  try {
    const items = [...$('#dialogBody').querySelectorAll('.item-editor')].map((row) => ({
      id: row.dataset.itemId,
      title: row.querySelector('[name="itemTitle"]').value.trim(),
      hours: Number(row.querySelector('[name="itemHours"]').value),
      doneDate: row.dataset.doneDate || null,
    }));
    const result = applyEditor(state.project, editor, new FormData(event.target), items);
    await commit(result.project);
    await api.editing(false);
    editor = null;
    $('#editorDialog').close();
    toast('변경사항을 적용했습니다. 파일에 보관하려면 저장하세요.');
  } catch (error) {
    $('#formError').textContent = error.message;
  } finally {
    setBusy(false);
  }
});
$('#dialogBody').addEventListener('click', (event) => {
  const add = event.target.closest('#addItem');
  const remove = event.target.closest('.remove-item');
  if (add) $('#itemEditors').insertAdjacentHTML('beforeend', itemEditor());
  if (remove) remove.closest('.item-editor').remove();
});
$('#deleteButton').addEventListener('click', async () => {
  if (!editor || busy) return;
  const p = structuredClone(state.project),
    { type, id } = editor;
  if (type === 'member' && p.tasks.some((task) => task.owner === id)) {
    $('#formError').textContent = '담당 업무가 있는 인력입니다. 먼저 담당자를 변경해 주세요.';
    return;
  }
  if (type === 'task' && p.tasks.some((task) => task.predecessor === id || task.parentId === id)) {
    $('#formError').textContent =
      '하위 또는 후속 업무가 연결되어 있습니다. 먼저 연결을 정리해 주세요.';
    return;
  }
  if (!confirm('이 항목을 삭제할까요? 업무를 삭제하면 완료 기록도 함께 삭제됩니다.')) return;
  await run(async () => {
    if (type === 'task') p.tasks = p.tasks.filter((task) => task.id !== id);
    else p.members = p.members.filter((member) => member.id !== id);
    await commit(p);
    await api.editing(false);
    editor = null;
    $('#editorDialog').close();
  });
});
$('#cancelEditor').onclick = () => {
  void closeEditor();
};
$('#closeEditor').onclick = () => {
  void closeEditor();
};
$('#editorDialog').addEventListener('cancel', (event) => {
  event.preventDefault();
  void closeEditor();
});
api.onCommand((name) => {
  void command(name);
});
api.onDocument(accept);
accept(await api.snapshot());
