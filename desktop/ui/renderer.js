import {
  workspaceTaskTable,
  workspaceOverview,
  workspaceTasks,
  workspaceDaily,
} from './shared/local-workspace-view.js';
import { SETTINGS_SECTIONS, PROJECT_VIEWS, PROJECT_COMMANDS } from './navigation.js';
import { PROJECT_SCREENS, projectNavigation } from './shared/project-navigation.js';
import { detachManagementLinks } from './shared/management.js';
import { managementView, installManagementUi } from './shared/management-ui.js';
import { taskView, summaryIds, taskLeaves, predecessorIds } from './shared/task-model.js';
import { today, validDate, summary, progress, addDays } from './shared/engine.js';
import { escapeHtml as esc } from './shared/html.js';
import { getLanguage, ui, localizeStatic, locale } from './shared/i18n.js';
import { setKoreanHolidayUpdates } from './shared/korean-holidays.js';
import { createHolidayUI } from './holiday-ui.js';
import { ReportClock } from './shared/report-clock.js';
import { getBusinessTimeZone, setBusinessTimeZone } from './shared/business-clock.js';
import { editorForm, itemEditor, applyEditor } from './shared/project-editor.js';
import { peopleView } from './shared/people-view.js';
import { completionRecords } from './shared/reports.js';
import { openExcelDialog } from './excel-ui.js';
import { createUpdateUI } from './update-ui.js';
import { createMessageDialog } from './dialog-ui.js';
import { mountHolidayPicker } from './holiday-picker.js';
import {
  planningView,
  parentField,
  scheduleForm,
  scheduleProposal,
  schedulePreviewHtml,
} from './planning-ui.js';
import { newTask } from './shared/wbs-model.js';
import { setParent, captureBaseline } from './shared/planning.js';
import { bulkProposal, bulkPreviewHtml } from './bulk-ui.js';
import {
  pct,
  num,
  person,
  meter,
  badge,
  pageHead,
  btn,
  empty,
  icon,
  projectStart,
} from './shared/view-ui.js';

const api = window.desktop;
const messageUI = createMessageDialog({ ui });
api.onDialog?.(async (request) => {
  const response = await messageUI.show(request);
  await api.respondDialog(request.id, response);
});
await api.dialogsReady?.();
const appSettings = (await api.settings?.()) || {};
const applicationInfo = (await api.info?.()) || {
  displayName: 'PM Canvas',
  version: '—',
  developer: '—',
};
const initialHolidayState = await api.holidayState?.();
if (initialHolidayState) setKoreanHolidayUpdates(initialHolidayState.holidays);
let holidayUI = null;
setBusinessTimeZone(appSettings.timeZone || 'Asia/Seoul');
const $ = (selector) => document.querySelector(selector);
const reportClock = new ReportClock();
let state = { project: null, revision: -1, dirty: false, filename: '' };
let view = sessionStorage.getItem('pmcanvas.desktop.settings') === 'open' ? 'settings' : 'overview',
  previousView = 'overview',
  reportDate = reportClock.reportDate,
  query = '',
  owner = '';
let settingsSection = sessionStorage.getItem('pmcanvas.desktop.settings.section') || 'general';
if (!SETTINGS_SECTIONS[settingsSection]) settingsSection = 'general';
let sentNavigation = '';
let managementPage = { pane: 'list', id: '' };
let editor = null,
  busy = false,
  toastTimer;
let reportFrom = addDays(today(), -6),
  reportTo = today(),
  reportOwner = '';
let followRange = true;
let datePaintPending = false;
let reportFormat = 'xlsx',
  importing = false;
const busyButtons = new Set();
const collapsed = new Set();
const selected = new Set();
const tabViews = new Map();
function renderTabs() {
  const tabs = state.tabs || [];
  $('#projectTabs').hidden = view === 'settings';
  if ($('#projectTabs').hidden) return;
  $('#projectTabList').innerHTML = tabs
    .map(
      (tab) =>
        '<div class="project-tab' +
        (tab.id === state.tabId ? ' is-active' : '') +
        '">' +
        '<button type="button" role="tab" id="project-tab-' +
        esc(tab.id) +
        '" data-project-tab="' +
        esc(tab.id) +
        '" aria-selected="' +
        (tab.id === state.tabId) +
        '" aria-controls="content" tabindex="' +
        (tab.id === state.tabId ? '0' : '-1') +
        '" title="' +
        esc(tab.filename || tab.name) +
        '">' +
        (tab.dirty
          ? '<span class="tab-dirty" aria-label="' +
            esc(ui('저장되지 않은 변경사항')) +
            '">●</span>'
          : '') +
        '<span class="project-tab-name">' +
        esc(tab.name) +
        '</span></button>' +
        '<button type="button" class="project-tab-close" data-close-tab="' +
        esc(tab.id) +
        '" aria-label="' +
        esc(ui('프로젝트 닫기') + ' · ' + tab.name) +
        '">×</button></div>',
    )
    .join('');
  const active = $('#projectTabList [aria-selected="true"]');
  if (active) {
    const list = $('#projectTabList');
    const bounds = list.getBoundingClientRect(),
      tab = active.closest('.project-tab').getBoundingClientRect();
    if (tab.left < bounds.left) list.scrollLeft += tab.left - bounds.left;
    else if (tab.right > bounds.right) list.scrollLeft += tab.right - bounds.right;
  }
}
function rememberTab(key) {
  if (!key) return;
  tabViews.set(key, {
    view: view === 'settings' ? previousView : view,
    query,
    owner,
    reportDate,
    reportFrom,
    reportTo,
    reportOwner,
    followRange,
    reportFormat,
    collapsed: [...collapsed],
    selected: [...selected],
    managementPage: { ...managementPage },
  });
}
function restoreTab(key, first = false) {
  const saved = tabViews.get(key);
  view = first && view === 'settings' ? 'settings' : saved?.view || 'overview';
  previousView = saved?.view || 'overview';
  managementPage = saved?.managementPage || { pane: 'list', id: '' };
  query = saved?.query || '';
  owner = saved?.owner || '';
  reportOwner = saved?.reportOwner || '';
  reportClock.select(saved?.reportDate || today());
  reportDate = reportClock.reportDate;
  reportTo = saved?.reportTo || today();
  reportFrom = saved?.reportFrom || addDays(reportTo, -6);
  followRange = saved?.followRange ?? true;
  reportFormat = saved?.reportFormat || 'xlsx';
  collapsed.clear();
  selected.clear();
  saved?.collapsed.forEach((id) => collapsed.add(id));
  saved?.selected.forEach((id) => selected.add(id));
  schedulePreview = null;
  bulkPreview = null;
}
let schedulePreview = null;
let bulkPreview = null;
const projectCommands = new Set(PROJECT_COMMANDS);
function showGuide({ title, message, primary, secondary }) {
  $('#actionGuideTitle').textContent = ui(title);
  $('#actionGuideText').textContent = ui(message);
  for (const [id, action] of [
    ['actionGuidePrimary', primary],
    ['actionGuideSecondary', secondary],
  ]) {
    const button = $('#' + id);
    button.hidden = !action;
    if (!action) continue;
    button.textContent = ui(action.label);
    button.onclick = () => {
      $('#actionGuideDialog').close();
      void Promise.resolve()
        .then(action.run)
        .catch((error) => toast(ui(error.message)));
    };
  }
  if (!$('#actionGuideDialog').open) $('#actionGuideDialog').showModal();
  $('#actionGuidePrimary').focus();
}
function requireProject() {
  if (state.project) return true;
  showGuide({
    title: '프로젝트를 먼저 생성해 주세요.',
    message:
      '이 기능은 프로젝트가 있어야 사용할 수 있습니다. 새 프로젝트를 만들거나 기존 프로젝트 파일을 열어 주세요.',
    primary: { label: '프로젝트 만들기', run: () => command('new') },
    secondary: { label: '기존 프로젝트 열기', run: () => command('open') },
  });
  return false;
}
function syncSaveStatus() {
  $('#saveStatus').hidden = !busy;
  $('#saveStatus').textContent = busy
    ? ui('처리 중입니다. 잠시만 기다려 주세요.')
    : !state.project
      ? ui('프로젝트 파일을 열거나 새로 만드세요')
      : state.dirty
        ? ui('● 미저장 변경 · 복구 사본 보관됨')
        : ui('파일에 저장됨');
}
function syncEditorActions() {
  if (editor?.type === 'schedule') {
    const ready =
      schedulePreview?.revision === state.revision && schedulePreview.changes.length > 0;
    const hint = ready
      ? ui('미리보기 내용을 확인한 뒤 적용하세요.')
      : schedulePreview && !schedulePreview.changes.length
        ? ui('변경할 일정이 없습니다. 조정 방법이나 이동 일수를 바꿔 주세요.')
        : ui('일정 변경을 미리 본 뒤 적용할 수 있습니다.');
    $('#submitButton').disabled = busy || !ready;
    $('#submitButton').title = ready ? '' : ui('일정 변경 미리보기를 먼저 확인해 주세요.');
    $('#scheduleApplyHint').textContent = hint;
  }
  const rows = [...$('#dialogBody').querySelectorAll('.item-editor')];
  for (const row of rows) {
    const button = row.querySelector('.remove-item');
    button.disabled = busy || rows.length === 1;
    button.title = rows.length === 1 ? ui('세부 작업은 한 개 이상 필요합니다.') : '';
  }
}
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
    const oldKey = state.tabId || state.project?.id,
      nextKey = next.tabId || next.project?.id;
    if (nextKey !== oldKey) {
      rememberTab(oldKey);
      restoreTab(nextKey, state.revision < 0);
    }
    if (next.tabs)
      for (const key of tabViews.keys())
        if (!next.tabs.some((tab) => tab.id === key)) tabViews.delete(key);
    for (const id of selected)
      if (!next.project?.tasks.some((task) => task.id === id)) selected.delete(id);
    const calendarOnly =
      next.holidayCalendar &&
      next.tabId === state.tabId &&
      JSON.stringify(next.project) === JSON.stringify(state.project) &&
      next.revision !== state.revision;
    if (next.holidayCalendar) setKoreanHolidayUpdates(next.holidayCalendar.holidays);
    state = next;
    holidayUI?.accept(next.holidayCalendar);
    if (calendarOnly && !canPaintHolidays()) {
      datePaintPending = true;
      return;
    }
    render();
  }
}
function setBusy(value) {
  busy = value;
  $('#content').inert = value;
  $('#settingsPage').inert = value;
  $('#projectTabs').inert = value;
  $('#editorForm').inert = value;
  $('#content').setAttribute('aria-busy', String(value));
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
  syncSaveStatus();
  syncEditorActions();
  syncSettingsControls();
  if (!value) refreshDate();
}
function refreshDate({ paint = true } = {}) {
  holidayUI?.flush();
  const active = document.activeElement;
  const advance =
    !busy &&
    !managementUi.dirty() &&
    !managementUi.pending() &&
    !editor &&
    !importing &&
    !document.querySelector('dialog[open]') &&
    !active?.matches(
      'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]),textarea,select,[contenteditable="true"]',
    );
  const changed = reportClock.refresh({ advance });
  reportDate = reportClock.reportDate;
  let rangeChanged = false;
  if (advance && followRange && reportTo !== reportClock.today) {
    reportTo = reportClock.today;
    reportFrom = addDays(reportTo, -6);
    rangeChanged = true;
  }
  datePaintPending ||= changed.dayChanged || changed.reportChanged || rangeChanged;
  if (advance && paint && datePaintPending) {
    datePaintPending = false;
    render();
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
function controls(
  p,
  search = true,
  { matching = filtered(p).length, total = p.tasks.length } = {},
) {
  return (
    '<div class="desktop-controls' +
    (search ? '' : ' date-only') +
    '">' +
    (search
      ? ui(
          '<input type="search" id="search" aria-label="업무 검색" placeholder="업무 검색" value="',
        ) +
        esc(query) +
        '">' +
        ui('<select id="owner" aria-label="담당자 필터"><option value="">전체 담당자</option>') +
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
    ui('<label>보고 기준일 <input id="reportDate" aria-label="보고 기준일" type="date" value="') +
    reportDate +
    '" max="' +
    today() +
    '"></label>' +
    (search
      ? '<span class="filter-result">' +
        ui('검색 결과 ') +
        matching +
        ui(' / 전체 ') +
        total +
        '</span>' +
        (query || owner
          ? ui('<button class="button small ghost" data-reset-filters>필터 초기화</button>')
          : '')
      : '') +
    '</div>'
  );
}
function taskTable(p, s, tasks = p.tasks) {
  return workspaceTaskTable(p, s, { asOf: reportDate, tasks });
}
function overview(p, s) {
  return workspaceOverview(p, s, { asOf: reportDate, controls: controls(p, false) });
}
function tasksView(p, s) {
  return workspaceTasks(p, s, { asOf: reportDate, tasks: filtered(p), controls: controls(p) });
}
function daily(p) {
  const tasks = filtered(p).filter((task) => !summaryIds(p).has(task.id));
  return workspaceDaily(p, {
    asOf: reportDate,
    tasks,
    controls: controls(p, true, { matching: tasks.length, total: taskLeaves(p).length }),
  });
}
function reportsView(p, s) {
  const records = completionRecords(p, { from: reportFrom, to: reportTo, owner: reportOwner });
  const hours = records.reduce((sum, record) => sum + record.hours, 0);
  return (
    pageHead(
      'PROJECT REPORTS',
      ui('업무 · 완료 기록'),
      ui('업무 현황과 완료 기록을 확인하고 Excel 또는 CSV로 저장하세요.'),
      '',
    ) +
    ui(
      '<section class="panel desktop-report-panel"><div class="desktop-section-head"><h2>업무 현황</h2>',
    ) +
    ui(
      '<div class="desktop-controls desktop-report-actions"><label>파일 형식<select id="reportFormat" aria-label="보고서 파일 형식"><option value="xlsx" ',
    ) +
    (reportFormat === 'xlsx' ? 'selected' : '') +
    '>Excel (.xlsx)</option><option value="csv" ' +
    (reportFormat === 'csv' ? 'selected' : '') +
    ui(
      '>CSV</option></select></label><button class="button small" data-command="exportWbs">업무 현황 ',
    ) +
    reportFormat.toUpperCase() +
    ui(' 저장</button></div></div>') +
    '<div class="desktop-report-filters">' +
    controls(p, false) +
    '</div>' +
    ui('<p class="desktop-report-summary">전체 업무 ') +
    p.tasks.length +
    ui('개 · 실제 진척률 ') +
    pct(s.progress) +
    ui(' · 계획 진척률 ') +
    pct(s.planned) +
    '</p>' +
    taskTable(p, s) +
    '</section>' +
    ui(
      '<section class="panel desktop-report-panel"><div class="desktop-section-head"><h2>완료 기록</h2>',
    ) +
    ui('<button class="button small" data-command="exportCompletion">완료 기록 ') +
    reportFormat.toUpperCase() +
    ui(' 저장</button></div>') +
    '<div class="desktop-controls desktop-report-filters">' +
    ui('<label>조회 시작일 <input id="reportFrom" type="date" aria-label="조회 시작일" value="') +
    reportFrom +
    '" max="' +
    today() +
    '"></label>' +
    ui('<label>조회 종료일 <input id="reportTo" type="date" aria-label="조회 종료일" value="') +
    reportTo +
    '" max="' +
    today() +
    '"></label>' +
    ui(
      '<select id="reportOwner" aria-label="완료 기록 담당자"><option value="">전체 담당자</option>',
    ) +
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
    ui('</select></div><p class="desktop-report-summary" role="status">완료한 세부 작업 ') +
    records.length +
    ui('건 · ') +
    num(hours) +
    'h</p>' +
    (records.length
      ? ui(
          '<div class="desktop-table-wrap"><table class="desktop-table"><thead><tr><th>완료일</th><th>담당자</th><th>업무 / 세부 작업</th><th>공수</th></tr></thead><tbody>',
        ) +
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
      : ui('<p class="desktop-report-empty">선택한 기간과 담당자의 완료 기록이 없습니다.</p>')) +
    ui(
      '</section><p class="desktop-note">업무 현황은 보고 기준일까지, 완료 기록은 선택한 조회 기간에 완료한 작업을 집계합니다.<br>적용된 미저장 변경도 보고서에 포함됩니다. 보고서 저장 후에도 프로젝트 파일은 별도로 저장하세요.</p>',
    )
  );
}
function render() {
  refreshDate({ paint: false });
  const p = state.project;
  if (owner && !p?.members.some((member) => member.id === owner)) {
    owner = '';
    selected.clear();
  }
  if (reportOwner && !p?.members.some((member) => member.id === reportOwner)) reportOwner = '';
  syncSaveStatus();
  const settingsOpen = view === 'settings';
  $('#settingsHeader').hidden = !settingsOpen;
  $('#projectWorkspace').hidden = settingsOpen;
  $('#projectSidebar').hidden = settingsOpen;
  $('#settingsSidebar').hidden = !settingsOpen;
  $('#content').hidden = settingsOpen;
  $('#settingsPage').hidden = !settingsOpen;
  document.title = settingsOpen
    ? ui('앱 설정') + ' · ' + ui(SETTINGS_SECTIONS[settingsSection].title) + ' — PM Canvas'
    : p
      ? (state.dirty ? '● ' : '') +
        p.name +
        ' · ' +
        ui(PROJECT_VIEWS[view] || PROJECT_VIEWS.overview) +
        ' — PM Canvas'
      : 'PM Canvas';
  const navigation = {
    scope: settingsOpen ? 'settings' : 'projects',
    view: settingsOpen ? 'overview' : view,
    section: settingsSection,
  };
  const navigationKey = JSON.stringify(navigation);
  if (navigationKey !== sentNavigation && api.navigationContext) {
    sentNavigation = navigationKey;
    void api.navigationContext(navigation).catch(() => {
      sentNavigation = '';
    });
  }
  for (const button of document.querySelectorAll('[data-app-section]')) {
    const active = settingsOpen && button.dataset.appSection === settingsSection;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  }
  $('#settingsTitle').textContent = ui(SETTINGS_SECTIONS[settingsSection].title);
  $('#settingsTitle').nextElementSibling.textContent = ui(
    SETTINGS_SECTIONS[settingsSection].description,
  );
  for (const panel of document.querySelectorAll('[data-settings-section]'))
    panel.hidden = panel.dataset.settingsSection !== settingsSection;
  sessionStorage.setItem('pmcanvas.desktop.settings.section', settingsSection);
  renderTabs();
  document.querySelector('.skip-link').href = settingsOpen ? '#settingsPage' : '#content';
  if (settingsOpen) sessionStorage.setItem('pmcanvas.desktop.settings', 'open');
  else sessionStorage.removeItem('pmcanvas.desktop.settings');
  syncSettingsControls();
  document.querySelectorAll('[data-view]').forEach((button) => {
    const active = Boolean(p) && button.dataset.view === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  if (settingsOpen) return;
  if (!p) {
    $('#content').innerHTML = ui(
      '<section class="desktop-welcome"><span class="eyebrow">YOUR PROJECT, ON YOUR DESKTOP</span><h1>계획하고, 체크하고,<br>한눈에 확인하세요.</h1><p>참여인력과 업무 일정을 입력하고<br>완료한 작업을 기록하면 진척률과 예상 완료일을 계산합니다.<br>로그인이나 서버 설치 없이 이 PC에서 바로 시작하세요.</p><div class="head-actions"><button class="button primary" data-command="new">새 프로젝트 만들기</button><button class="button" data-command="open">프로젝트 파일 열기</button></div><p class="desktop-note">기존 웹 버전의 프로젝트 JSON 백업도 불러올 수 있습니다.</p></section>',
    );
    return;
  }
  const s = summary(p, reportDate);
  $('#content').innerHTML =
    view === 'management'
      ? managementView(p, reportDate, { section: 'issues', page: managementPage })
      : view === 'weekly'
        ? managementView(p, reportDate, { section: 'weekly', page: managementPage })
        : view === 'milestones'
          ? managementView(p, reportDate, { section: 'milestones', page: managementPage })
          : view === 'resources'
            ? managementView(p, reportDate, { section: 'staffing', page: managementPage })
            : view === 'planning'
              ? planningView(p, {
                  at: reportDate,
                  query,
                  owner,
                  collapsed,
                  selected,
                  controls: controls(p),
                })
              : view === 'reports'
                ? reportsView(p, s)
                : view === 'people'
                  ? peopleView(p, s, reportDate, { controls: controls(p, false) })
                  : view === 'daily'
                    ? daily(p)
                    : view === 'tasks'
                      ? tasksView(p, s)
                      : overview(p, s);
  const head = $('#content .page-head');
  if (head) head.querySelector('h1').textContent = ui(PROJECT_SCREENS[view].title);
  const all = document.querySelector('[data-select-visible]');
  if (all) all.indeterminate = selected.size > 0 && !all.checked;
  const staffing = $('#content [data-pm-form="staffing"]');
  if (staffing && !p.members.length)
    staffing.innerHTML = ui(
      '<h3>투입 기간 추가</h3><p class="form-hint">투입 기간을 등록하려면 참여인력을 먼저 추가해 주세요.</p><button type="button" class="button primary" data-action="member">＋ 참여인력 추가</button>',
    );
  for (const form of document.querySelectorAll('#pmManagement form')) {
    const submit = form.querySelector('button[type="submit"]');
    if (!submit) continue;
    const actions = document.createElement('div');
    actions.className = 'head-actions';
    submit.before(actions);
    actions.append(submit);
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'button';
    cancel.dataset.pmReset = '';
    cancel.textContent = ui('입력 취소');
    actions.append(cancel);
  }
}
async function openBulk(action) {
  if (busy || editor || importing || !state.project) return;
  try {
    const revision = state.revision,
      proposal = bulkProposal(state.project, [...selected], action);
    editor = { type: 'bulk' };
    await api.editing(true);
    bulkPreview = { ...proposal, revision };
    $('#dialogTitle').textContent = proposal.title;
    $('#dialogBody').innerHTML = bulkPreviewHtml(proposal);
    $('#formError').textContent = '';
    $('#deleteButton').hidden = true;
    $('#submitButton').textContent = action === 'remove' ? ui('선택 업무 삭제') : ui('적용');
    $('#editorDialog').showModal();
    $('#cancelEditor').focus();
  } catch (error) {
    if (editor?.type === 'bulk' && !$('#editorDialog').open) {
      editor = null;
      bulkPreview = null;
      await api.editing(false).catch(() => {});
    }
    toast(error.message);
  }
}
async function openEditor(type, id = '') {
  if (managementUi.dirty() || managementUi.pending()) {
    toast(ui('관리 입력을 먼저 저장하거나 취소해 주세요.'));
    return;
  }
  if (busy || editor || importing) return;
  if (type !== 'project' && !requireProject()) return;
  if (['schedule', 'baseline'].includes(type) && !state.project.tasks.length) {
    showGuide({
      title: '먼저 업무를 추가해 주세요.',
      message: '일정 조정과 기준 계획은 업무를 등록한 뒤 사용할 수 있습니다.',
      primary: { label: '업무 추가', run: () => openEditor('task') },
    });
    return;
  }
  await api.editing(true);
  editor = { type, id };
  schedulePreview = null;
  bulkPreview = null;
  $('#submitButton').textContent = ui('적용');
  $('#submitButton').disabled = false;
  $('#submitButton').title = '';
  const baseline = state.project?.baseline;
  const form =
    type === 'schedule'
      ? scheduleForm(state.project, id)
      : type === 'baseline'
        ? {
            title: baseline ? ui('기준 계획 교체') : ui('기준 계획 저장'),
            body:
              ui(
                '<label class="field">기준 계획 이름<input name="baselineName" required maxlength="80" value="',
              ) +
              esc(baseline?.name || ui('기준 계획')) +
              '"></label><p class="form-hint">' +
              (baseline
                ? ui(
                    '기존 기준 계획을 현재 업무 이름·계층·일정·공수로 교체합니다. 이전 기준 계획은 파일에 따로 보관해 주세요.',
                  )
                : ui('현재 업무 이름·계층·일정·공수를 보관합니다.')) +
              ui(' 프로젝트 파일에 보관하려면 적용 후 저장하세요.</p>'),
          }
        : editorForm(type, state.project, id, {
            extraFields: type === 'task' ? parentField(state.project, id) : '',
            expandDetails: Boolean(state.project?.tasks.find((task) => task.id === id)?.parentId),
          });
  $('#dialogTitle').textContent = form.title;
  $('#dialogBody').innerHTML = form.body;
  if (type === 'project' || type === 'settings') {
    $('#dialogBody [name="koreanHolidays"]')?.closest('label')?.remove();
    mountHolidayPicker($('#dialogBody'), {
      enabled: type === 'project' || state.project.koreanHolidays === true,
    });
  }
  $('#formError').textContent = '';
  $('#deleteButton').hidden = !id || !['task', 'member'].includes(type);
  $('#editorDialog').showModal();
  $('#dialogBody input')?.focus({ preventScroll: true });
  $('#dialogBody').scrollTop = 0;
  syncEditorActions();
}
async function closeEditor() {
  if (busy) return;
  await api.editing(false);
  editor = null;
  schedulePreview = null;
  bulkPreview = null;
  $('#editorDialog').close();
}
async function commit(project) {
  const next = await api.replace(project, state.revision);
  accept(next);
}
async function command(name, tabId) {
  if (messageUI.open) return;
  if (name === 'projects' && view !== 'settings') return;
  if (busy) {
    toast(ui('처리 중입니다. 잠시만 기다려 주세요.'));
    return;
  }
  if (managementUi.dirty() || managementUi.pending()) {
    toast(ui('관리 입력을 먼저 저장하거나 취소해 주세요.'));
    return;
  }
  if (
    ['appSettings', 'updates', 'timeZone', 'about'].includes(name) ||
    name.startsWith('settings:')
  ) {
    if (editor || importing) {
      toast(ui('입력창의 변경사항을 먼저 적용하거나 취소해 주세요.'));
      return;
    }
    if (view !== 'settings') previousView = view;
    if (name === 'updates') settingsSection = 'updates';
    if (name === 'timeZone') settingsSection = 'general';
    if (name === 'about') settingsSection = 'about';
    if (name.startsWith('settings:')) {
      const section = name.slice(9);
      if (!SETTINGS_SECTIONS[section]) return;
      settingsSection = section;
    }
    view = 'settings';
    render();
    $('#settingsPage').focus();
    window.scrollTo({ top: 0 });
    if (name === 'timeZone') $('#timeZoneInput').focus();
    if (settingsSection === 'updates') await updateUI.open(name === 'updates');
    return;
  }
  if (name === 'privacy') {
    await run(() => api.openPrivacyPolicy());
    return;
  }
  if (editor || importing) {
    toast(ui('입력창의 변경사항을 먼저 적용하거나 취소해 주세요.'));
    return;
  }
  if (name === 'projects') {
    returnToProject();
    return;
  }
  if (view === 'settings' && projectCommands.has(name)) {
    toast(ui('프로젝트 화면에서 사용할 수 있습니다.'));
    return;
  }
  if (
    projectCommands.has(name) &&
    !['closeProject', 'activateTab', 'nextTab', 'previousTab'].includes(name) &&
    !requireProject()
  )
    return;
  if (name === 'nextTab' || name === 'previousTab') {
    const tabs = state.tabs || [],
      index = tabs.findIndex((tab) => tab.id === state.tabId);
    if (tabs.length > 1)
      return command(
        'activateTab',
        tabs[(index + (name === 'nextTab' ? 1 : tabs.length - 1)) % tabs.length].id,
      );
    return;
  }
  if (name === 'projectSettings') {
    await openEditor('settings');
    return;
  }
  if (name === 'new') {
    await openEditor('project');
    return;
  }
  if (name === 'closeProject' && !state.project) {
    toast(ui('열려 있는 프로젝트가 없습니다.'));
    return;
  }
  const result = await run(async () => {
    if (name === 'closeProject') {
      const next = await api.closeProject(tabId);
      if (next) {
        accept(next);
        toast(ui('프로젝트를 닫았습니다.'));
      }
      return next;
    }
    if (name === 'activateTab') {
      const next = await api.activateTab(tabId);
      accept(next);
      return next;
    }
    if (name === 'undo' || name === 'redo') {
      const next = await api[name](state.revision);
      accept(next);
      toast(
        name === 'undo'
          ? ui('프로젝트 변경을 되돌렸습니다.')
          : ui('프로젝트 변경을 다시 실행했습니다.'),
      );
      return next;
    }
    if (name === 'open') {
      const next = await api.open();
      if (next) {
        accept(next);
      }
      return next;
    }
    if (name === 'save' || name === 'saveAs') {
      const next = await api[name]();
      if (next) {
        accept(next);
        toast(ui('프로젝트 파일을 저장했습니다.'));
      }
      return next;
    }
    if (name === 'exportWeb') {
      if (await api.exportWeb()) toast(ui('웹 버전용 JSON 파일을 저장했습니다.'));
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
          toast(ui('Excel 내용을 적용했습니다. 확인 후 파일을 저장해 주세요.'));
        },
        onClose: () => {
          importing = false;
          refreshDate();
        },
      });
    }
    if (name === 'exportTemplate' && (await api.exportTemplate(state.revision)))
      toast(ui('Excel 입력 양식을 저장했습니다.'));
    if (
      name === 'exportExcel' &&
      (await api.exportReport(
        { kind: 'wbs', at: reportDate, format: 'xlsx', language: getLanguage() },
        state.revision,
      ))
    )
      toast(ui('Excel 보고서를 저장했습니다.'));
    if (name === 'exportWbs' || name === 'exportCompletion') {
      const options =
        name === 'exportWbs'
          ? { kind: 'wbs', at: reportDate }
          : { kind: 'completion', from: reportFrom, to: reportTo, owner: reportOwner };
      options.format = reportFormat;
      options.language = getLanguage();
      if (await api.exportReport(options, state.revision))
        toast(
          reportFormat === 'csv'
            ? ui('CSV 보고서를 저장했습니다.')
            : ui('Excel 보고서를 저장했습니다.'),
        );
    }
    return null;
  });
  if (name === 'closeProject' && result?.project === null)
    $('#content [data-command="new"]')?.focus();
}
$('#projectTabList').addEventListener('keydown', async (event) => {
  const button = event.target.closest('[data-project-tab]');
  if (!button) return;
  const tabs = state.tabs || [],
    index = tabs.findIndex((tab) => tab.id === button.dataset.projectTab);
  let next;
  if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
  else if (event.key === 'ArrowLeft') next = tabs[(index + tabs.length - 1) % tabs.length];
  else if (event.key === 'Home') next = tabs[0];
  else if (event.key === 'End') next = tabs.at(-1);
  else if (event.key === 'Delete') {
    event.preventDefault();
    await command('closeProject', button.dataset.projectTab);
  } else return;
  event.preventDefault();
  if (next) await command('activateTab', next.id);
  $('#projectTabList [aria-selected="true"]')?.focus({ preventScroll: true });
});
document.addEventListener('click', async (event) => {
  const target = event.target.closest('button, [data-command]');
  if (!target || busy) return;
  if (target.dataset.projectTab) {
    await command('activateTab', target.dataset.projectTab);
    return;
  }
  if (target.dataset.closeTab) {
    await command('closeProject', target.dataset.closeTab);
    return;
  }
  if (target.dataset.appSection) {
    await command('settings:' + target.dataset.appSection);
    return;
  }
  if (target.dataset.managementPane) {
    const pane = target.dataset.managementPane,
      id = target.dataset.managementId || '';
    if (managementPage.pane === pane && managementPage.id === id) return;
    if (!(await managementUi.leave())) return;
    managementPage = { pane, id };
    render();
    window.scrollTo({ top: 0 });
    $('#content').focus({ preventScroll: true });
    return;
  }
  if (target.hasAttribute('data-pm-reset')) {
    managementUi.reset(target.closest('form'));
    toast(ui('입력을 취소했습니다. 다른 입력과 저장된 내용은 유지됩니다.'));
    return;
  }
  if (target.hasAttribute('data-reset-filters')) {
    query = '';
    owner = '';
    selected.clear();
    render();
    $('#search')?.focus();
    return;
  }
  if (target.dataset.action === 'summary') {
    void run(async () => {
      const p = structuredClone(state.project);
      p.tasks.push(newTask(p, { date: reportDate, summary: true }));
      await commit(p);
    });
    return;
  }
  if (target.dataset.bulk) {
    void openBulk(target.dataset.bulk);
    return;
  }
  if (target.hasAttribute('data-clear-selection')) {
    selected.clear();
    render();
    return;
  }
  if (target.dataset.shiftTask) {
    void openEditor('schedule', target.dataset.shiftTask);
    return;
  }
  if (target.hasAttribute('data-expand-all')) {
    selected.clear();
    collapsed.clear();
    render();
    return;
  }
  if (target.dataset.fold) {
    selected.clear();
    const id = target.dataset.fold;
    if (collapsed.has(id)) collapsed.delete(id);
    else collapsed.add(id);
    render();
    return;
  }
  if (target.dataset.indent || target.dataset.outdent) {
    const id = target.dataset.indent || target.dataset.outdent;
    void run(async () => {
      await commit(setParent(state.project, [id], target.dataset.indent ? 1 : -1));
    });
    return;
  }
  if (target.dataset.command) {
    if (!(await managementUi.leave())) return;
    void command(target.dataset.command);
    return;
  }
  const nextView = target.dataset.view || target.dataset.tab || target.dataset.go;
  if (nextView) {
    if (!requireProject() || nextView === view) return;
    if (nextView !== view && !(await managementUi.leave())) return;
    if (nextView !== view) {
      selected.clear();
      managementPage = { pane: 'list', id: '' };
    }
    view = nextView;
    render();
    window.scrollTo({ top: 0 });
    if (target.dataset.tab)
      $('#content [data-tab="' + nextView + '"]')?.focus({ preventScroll: true });
    if (target.dataset.go) $('#content').focus({ preventScroll: true });
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
  if (['member', 'task', 'settings', 'baseline', 'schedule'].includes(target.dataset.action))
    void openEditor(target.dataset.action);
});
document.addEventListener('input', (event) => {
  if (event.target.id !== 'search') return;
  query = event.target.value;
  selected.clear();
  const caret = event.target.selectionStart;
  render();
  $('#search').focus();
  $('#search').setSelectionRange(caret, caret);
});
document.addEventListener('change', async (event) => {
  if (event.target.dataset.selectTask || event.target.hasAttribute('data-select-visible')) {
    if (busy || editor || importing) return;
    const ids = event.target.hasAttribute('data-select-visible')
      ? [...document.querySelectorAll('[data-select-task]')].map(
          (input) => input.dataset.selectTask,
        )
      : [event.target.dataset.selectTask];
    for (const id of ids)
      if (event.target.checked) selected.add(id);
      else selected.delete(id);
    render();
    return;
  }
  if (event.target.id === 'reportFormat') {
    reportFormat = event.target.value === 'csv' ? 'csv' : 'xlsx';
    render();
    return;
  }
  if (['reportFrom', 'reportTo', 'reportOwner'].includes(event.target.id)) {
    const from = $('#reportFrom').value,
      to = $('#reportTo').value;
    if (!validDate(from) || !validDate(to) || from > to || to > today()) {
      toast(ui('오늘까지의 올바른 조회 기간을 선택해 주세요.'));
    } else {
      reportFrom = from;
      reportTo = to;
      reportOwner = $('#reportOwner').value;
      if (event.target.id !== 'reportOwner') followRange = false;
    }
    render();
    return;
  }
  if (event.target.id === 'owner') {
    selected.clear();
    owner = event.target.value;
    render();
  }
  if (event.target.id === 'reportDate') {
    const date = event.target.value;
    if (!reportClock.select(date)) {
      toast(ui('오늘까지의 날짜를 선택해 주세요.'));
      render();
      return;
    }
    reportDate = reportClock.reportDate;
    render();
  }
  if (!event.target.dataset.check || busy) return;
  refreshDate({ paint: false });
  const taskId = event.target.dataset.check;
  const itemId = event.target.dataset.item;
  const checked = event.target.checked;
  await run(async () => {
    const p = structuredClone(state.project);
    const task = p.tasks.find((task) => task.id === taskId);
    const item =
      task?.kind === 'milestone' && itemId === '__milestone'
        ? task
        : task?.items.find((item) => item.id === itemId);
    if (!item || item.doneDate > reportDate) throw Error(ui('완료 기록을 확인해 주세요.'));
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
    const form = new FormData(event.target);
    if (editor.type === 'project') {
      const draft = applyEditor(state.project, editor, form, []);
      await api.editing(false);
      try {
        const next = await api.newProject(draft.project);
        if (!next) {
          await api.editing(true);
          return;
        }
        accept(next);
        view = 'people';
        render();
      } catch (error) {
        await api.editing(true);
        throw error;
      }
      editor = null;
      $('#editorDialog').close();
      toast(ui('프로젝트를 만들었습니다. 참여인력이나 첫 업무를 추가해 보세요.'));
      return;
    }
    if (editor.type === 'bulk') {
      if (!bulkPreview || bulkPreview.revision !== state.revision)
        throw Error(ui('문서가 변경되었습니다. 취소한 뒤 변경 내용을 다시 확인해 주세요.'));
      await commit(bulkPreview.project);
      await api.editing(false);
      editor = null;
      bulkPreview = null;
      selected.clear();
      $('#editorDialog').close();
      render();
      toast(ui('선택 업무 변경을 적용했습니다. 확인 후 파일을 저장하세요.'));
      return;
    }
    if (editor.type === 'schedule') {
      const proposal = scheduleProposal(state.project, form);
      if (
        !schedulePreview ||
        schedulePreview.revision !== state.revision ||
        schedulePreview.signature !== proposal.signature
      )
        throw Error(ui('현재 입력으로 일정 변경 미리보기를 먼저 확인해 주세요.'));
      if (!proposal.changes.length) throw Error(ui('변경할 일정이 없습니다.'));
      await commit(proposal.project);
      await api.editing(false);
      editor = null;
      schedulePreview = null;
      $('#editorDialog').close();
      toast(ui('일정 변경을 적용했습니다. 확인 후 파일을 저장하세요.'));
      return;
    }
    const result =
      editor.type === 'baseline'
        ? {
            project: {
              ...structuredClone(state.project),
              baseline: captureBaseline(
                state.project,
                String(form.get('baselineName') || '').trim(),
              ),
            },
          }
        : applyEditor(state.project, editor, form, items);
    if (editor.type === 'task') {
      const task = editor.id
        ? result.project.tasks.find((task) => task.id === editor.id)
        : result.project.tasks.at(-1);
      task.parentId = String(form.get('parentId') || '');
    }
    await commit(result.project);
    await api.editing(false);
    editor = null;
    $('#editorDialog').close();
    toast(ui('변경사항을 적용했습니다. 파일에 보관하려면 저장하세요.'));
  } catch (error) {
    $('#formError').textContent = error.message;
  } finally {
    setBusy(false);
  }
});
$('#dialogBody').addEventListener('click', (event) => {
  if (event.target.closest('#previewSchedule') && editor?.type === 'schedule') {
    schedulePreview = null;
    $('#formError').textContent = '';
    $('#schedulePreview').innerHTML = '';
    if (!$('#editorForm').reportValidity()) return;
    try {
      schedulePreview = {
        ...scheduleProposal(state.project, new FormData($('#editorForm'))),
        revision: state.revision,
      };
      $('#schedulePreview').innerHTML = schedulePreviewHtml(schedulePreview.changes);
    } catch (error) {
      $('#formError').textContent = error.message;
    }
    syncEditorActions();
    return;
  }
  const add = event.target.closest('#addItem');
  const remove = event.target.closest('.remove-item');
  if (add) $('#itemEditors').insertAdjacentHTML('beforeend', itemEditor());
  if (remove) remove.closest('.item-editor').remove();
  syncEditorActions();
});
function invalidateSchedulePreview() {
  if (editor?.type !== 'schedule') return;
  schedulePreview = null;
  $('#schedulePreview').innerHTML = '';
  syncEditorActions();
  const align = $('#dialogBody [name="scheduleMode"]').value === 'align';
  for (const name of ['scheduleTask', 'scheduleDays', 'scheduleCascade'])
    $('#dialogBody [name="' + name + '"]').disabled = align;
}
$('#dialogBody').addEventListener('input', invalidateSchedulePreview);
$('#dialogBody').addEventListener('change', invalidateSchedulePreview);
$('#deleteButton').addEventListener('click', async () => {
  if (!editor || busy) return;
  const p = structuredClone(state.project),
    { type, id } = editor;
  if (type === 'member' && p.tasks.some((task) => task.owner === id)) {
    $('#formError').textContent = ui('담당 업무가 있는 인력입니다. 먼저 담당자를 변경해 주세요.');
    return;
  }
  if (
    type === 'task' &&
    p.tasks.some((task) => predecessorIds(task).includes(id) || task.parentId === id)
  ) {
    $('#formError').textContent = ui(
      '하위 또는 후속 업무가 연결되어 있습니다. 먼저 연결을 정리해 주세요.',
    );
    return;
  }
  if (
    !(await messageUI.confirm({
      title: ui('삭제 확인'),
      message: type === 'member' ? ui('이 참여인력을 삭제할까요?') : ui('이 업무를 삭제할까요?'),
      detail: type === 'task' ? ui('업무의 세부 작업과 완료 기록도 함께 삭제됩니다.') : '',
      action: ui('삭제'),
      dangerous: true,
    }))
  )
    return;
  await run(async () => {
    if (type === 'task') p.tasks = p.tasks.filter((task) => task.id !== id);
    else p.members = p.members.filter((member) => member.id !== id);
    detachManagementLinks(p);
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
$('#actionGuideCancel').onclick = () => $('#actionGuideDialog').close();
api.onCommand((name) => {
  void command(name);
});
api.onDocument(accept);
const updateUI = createUpdateUI({
  api,
  ui,
  settings: appSettings,
  onOpen: () => {
    void command('appSettings');
  },
  onError: (error) => toast(ui(error.message || '요청을 처리하지 못했습니다.')),
});
function syncSettingsControls() {
  holidayUI?.paint();
  const locked = busy || Boolean(editor) || importing || (state.anyDirty ?? state.dirty);
  $('#settingsProjectHint').hidden =
    settingsSection !== 'general' || !(state.anyDirty ?? state.dirty);
  for (const id of ['languageSelect', 'timeZoneInput', 'applyTimeZone', 'cancelTimeZone'])
    $('#' + id).disabled = locked;
}
function returnToProject() {
  if (busy) return;
  view = previousView;
  render();
  window.scrollTo({ top: 0 });
  $('#content').focus({ preventScroll: true });
}

$('#timeZoneInput').value = getBusinessTimeZone();
$('#cancelTimeZone').onclick = () => {
  $('#timeZoneInput').value = getBusinessTimeZone();
  $('#timeZoneError').textContent = '';
};
$('#timeZoneForm').onsubmit = async (event) => {
  event.preventDefault();
  if (busy || editor || importing || (state.anyDirty ?? state.dirty) || updateUI.pending()) {
    $('#timeZoneError').textContent = ui('변경사항을 저장하거나 취소한 뒤 시간대를 바꿔 주세요.');
    return;
  }
  setBusy(true);
  try {
    await api.setTimeZone($('#timeZoneInput').value);
    location.reload();
  } catch (error) {
    $('#timeZoneError').textContent = ui(error.message);
  } finally {
    setBusy(false);
  }
};
document.documentElement.lang = getLanguage();
localizeStatic(document.documentElement);
$('#projectNavigation').innerHTML = projectNavigation('desktop')
  .map(
    (group) =>
      '<div class="project-nav-group"><p class="navigation-label">' +
      esc(ui(group.title)) +
      '</p>' +
      group.views
        .map(
          (id) =>
            '<button type="button" data-view="' +
            id +
            '">' +
            icon(PROJECT_SCREENS[id].icon) +
            esc(ui(PROJECT_SCREENS[id].title)) +
            '</button>',
        )
        .join('') +
      '</div>',
  )
  .join('');
$('#settingsNavigation').innerHTML = Object.entries(SETTINGS_SECTIONS)
  .map(
    ([id, section]) =>
      '<button type="button" data-app-section="' + id + '">' + esc(ui(section.title)) + '</button>',
  )
  .join('');
$('#aboutVersion').textContent = applicationInfo.version || '—';
$('#aboutDeveloper').textContent = applicationInfo.developer || '—';

const managementUi = installManagementUi({
  confirmDiscard: (message) =>
    messageUI.confirm({
      title: ui('입력 취소'),
      message,
      action: ui('버리고 이동'),
      dangerous: true,
    }),
  project: () => state.project,
  getDate: () => reportDate,
  toast,
  canChange: () => !busy && !editor && !importing,
  onDirtyChange: (value) => void api.editing(value),
  savedMessage: '변경사항을 적용했습니다. 프로젝트 파일도 저장해 주세요.',
  publishedMessage: '주간보고를 발행했습니다. 프로젝트 파일도 저장해 주세요.',
  save: async (next) => {
    await api.editing(false);
    const accepted = await api.replace(next, state.revision);
    managementPage = { pane: 'list', id: '' };
    accept(accepted);
    window.scrollTo({ top: 0 });
  },
  exportReport: async (report) => {
    await api.editing(false);
    try {
      await api.exportReport({ kind: 'weekly', id: report.id, format: 'html' }, state.revision);
    } finally {
      await api.editing(managementUi.dirty());
    }
  },
});
function canPaintHolidays() {
  return (
    !busy &&
    !editor &&
    !importing &&
    !managementUi.dirty() &&
    !managementUi.pending() &&
    !document.querySelector('dialog[open]') &&
    !document.activeElement?.matches('input,textarea,select,[contenteditable="true"]')
  );
}
holidayUI = createHolidayUI({
  api,
  ui,
  locale,
  canApply: canPaintHolidays,
  onCalendar: () => {
    datePaintPending = true;
    refreshDate();
  },
});
holidayUI.accept(initialHolidayState);
$('#languageSelect').value = getLanguage();
$('#languageSelect').onchange = async (event) => {
  const next = event.target.value;
  if ($('#timeZoneInput').value !== getBusinessTimeZone()) {
    event.target.value = getLanguage();
    toast(ui('시간대 변경을 먼저 적용하거나 취소해 주세요.'));
    return;
  }
  if (
    busy ||
    editor ||
    importing ||
    (state.anyDirty ?? state.dirty) ||
    managementUi.dirty() ||
    managementUi.pending() ||
    updateUI.pending()
  ) {
    event.target.value = getLanguage();
    toast(ui('언어를 바꾸기 전에 변경사항을 저장하거나 취소해 주세요.'));
    return;
  }
  try {
    setBusy(true);
    await api.setLanguage?.(next);
    localStorage.setItem('pmcanvas.language', next);
    location.reload();
  } catch (error) {
    event.target.value = getLanguage();
    toast(error.message);
  } finally {
    setBusy(false);
  }
};
await api.setLanguage?.(getLanguage());
window.addEventListener('focus', () => refreshDate());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshDate();
});
document.addEventListener('focusout', () => setTimeout(() => refreshDate(), 150));
document.addEventListener('close', () => refreshDate(), true);
setInterval(() => refreshDate(), 30000);
accept(await api.snapshot());
await updateUI.initialise();
await holidayUI.initialise();
if (appSettings.recovery)
  toast(ui('설정 오류를 복구해 실행했습니다. 환경설정에서 내용을 확인해 주세요.'));
