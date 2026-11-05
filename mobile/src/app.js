import { mountHolidayPicker } from '../../shared/browser/holiday-picker.js';
import { parentField } from '../../shared/browser/project-parent-field.js';
import {
  workspaceOverview,
  workspaceTasks,
  workspaceDaily,
} from '../../shared/browser/local-workspace-view.js';
import { peopleView } from '../../shared/browser/people-view.js';
import { pageHead } from '../../shared/browser/view-ui.js';
import { ProjectTools } from './project-tools.js';
import { PROJECT_SCREENS, projectNavigation } from '../../shared/browser/project-navigation.js';
import { taskView, taskLeaves, summaryIds } from '../../shared/browser/task-model.js';
import './mobile.css';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { escapeHtml as esc } from '../../shared/browser/html.js';
import { setLanguage } from '../../shared/browser/i18n.js';
import { today, summary, progress, validDate } from '../../shared/browser/engine.js';
import {
  setBusinessTimeZone,
  getBusinessTimeZone,
  validateTimeZone,
} from '../../shared/browser/business-clock.js';
import { editorForm, applyEditor, itemEditor } from '../../shared/browser/project-editor.js';
import {
  csvText,
  wbsRows,
  completionRecords,
  completionRows,
} from '../../shared/browser/reports.js';
import { icon, pct, num } from '../../shared/browser/view-ui.js';
import { ProjectStore } from './storage.mjs';
import {
  normalizeProject,
  parseProject,
  serializeProject,
  toggleItem,
  deleteEntity,
  MAX_BYTES,
} from './model.mjs';
import { shareFile } from './platform.js';
import { uid } from './id.mjs';
import { privacyContent } from './privacy.js';

setLanguage('ko');
try {
  setBusinessTimeZone(localStorage.getItem('pmcanvas.mobile.timezone') || 'Asia/Seoul');
} catch {}
const $ = (selector) => document.querySelector(selector);
const store = new ProjectStore();
let records = [],
  record = null,
  view = 'projects',
  editing = null,
  busy = false;
let query = '',
  owner = '',
  onlyOpen = false,
  completionDate = today(),
  lastDay = today();
let undo = [],
  redo = [],
  toastTimer,
  returnFocus = null,
  initialEditorFields = '';
const scrollPositions = new Map();
const mobileViews = projectNavigation('mobile').flatMap((group) => group.views);
const titles = Object.fromEntries(mobileViews.map((id) => [id, PROJECT_SCREENS[id].title]));
const projectTools = new ProjectTools({
  project: () => record?.project,
  revision: () => record?.revision,
  save,
  render,
  navigate,
  toast,
  edit: openEditor,
  reload: async () => {
    await route();
  },
  canChange: () => !busy && !editing,
  confirm: (message) => confirmDelete(message, { title: '변경사항 확인', action: '버리고 이동' }),
  onDate: (date) => {
    completionDate = date;
  },
});

function toast(message, canUndo = false) {
  $('#toastText').textContent = message;
  $('#toastUndo').hidden = !canUndo;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => {
      $('#toast').hidden = true;
    },
    canUndo ? 8000 : 5000,
  );
}
function errorText(error) {
  return error?.message || '작업하지 못했습니다. 다시 시도해 주세요.';
}
async function run(action) {
  if (busy) return;
  busy = true;
  $('#content').setAttribute('aria-busy', 'true');
  const controls = [
    ...document.querySelectorAll('button:not(:disabled), input[type="checkbox"]:not(:disabled)'),
  ].filter((element) => element.getClientRects().length);
  controls.forEach((element) => {
    element.disabled = true;
  });
  try {
    await action();
  } catch (error) {
    toast(errorText(error));
  } finally {
    busy = false;
    $('#content').setAttribute('aria-busy', 'false');
    controls.forEach((element) => {
      if (element.isConnected) element.disabled = false;
    });
  }
}
function button(label, action, style = '', extra = '') {
  return `<button class="button ${style}" data-action="${action}" ${extra}>${label}</button>`;
}
function empty(title, text, action = '') {
  return `<section class="empty-state">${icon('layers')}<h2>${title}</h2><p>${text}</p>${action}</section>`;
}
function meter(value) {
  return `<div class="meter" role="meter" aria-label="진척률" aria-valuenow="${Math.round(value * 100)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${value * 100}%"></span></div>`;
}
function filtered(project) {
  return project.tasks.filter(
    (task) =>
      (!query || task.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) &&
      (!owner || task.owner === owner),
  );
}
function projectList() {
  return `<section class="page-heading"><div><span class="eyebrow">YOUR WORKSPACE</span><h1>나의 프로젝트</h1><p>데스크톱과 같은 프로젝트를 이 기기에서 이어서 관리하세요.</p></div></section>
    <div class="project-actions">${button('＋ 새 프로젝트', 'new', 'primary')}${button(icon('upload') + ' 가져오기', 'import')}</div>
    ${
      records.length
        ? `<div class="project-list">${records
            .map((entry, index) => {
              try {
                const p = normalizeProject(entry.project),
                  s = summary(p, today());
                return `<button class="project-card" data-action="open" data-index="${index}"><span class="project-monogram">${esc(p.name.slice(0, 1))}</span><span class="project-card-body"><strong>${esc(p.name)}</strong><small>업무 ${p.tasks.length}개 · 참여인력 ${p.members.length}명</small>${meter(s.progress)}<span class="project-card-foot"><span>진척률 ${pct(s.progress)}</span><span>${s.overdue ? `지연 ${s.overdue}건` : '기기에 저장됨'}</span></span></span>${icon('arrow')}</button>`;
              } catch {
                return '<article class="settings-card"><h2>읽을 수 없는 프로젝트</h2><p>저장된 원본은 보존했습니다. 백업 파일을 가져와 복구해 주세요.</p></article>';
              }
            })
            .join('')}</div>`
        : empty(
            '첫 프로젝트를 시작하세요',
            '업무와 일정을 등록하고, 완료한 작업을 바로 체크하세요. 인터넷 연결 없이 사용할 수 있습니다.',
          )
    }
    <aside class="storage-note">${icon('check')}<div><strong>기기에 저장되는 프로젝트</strong><p>변경 내용은 이 기기에 자동 저장됩니다. 프로젝트 파일을 내보내 웹이나 데스크톱에서 이어서 사용할 수 있습니다.</p></div></aside>
    <p class="privacy-note">${button('개인정보처리방침', 'privacy', 'ghost')}</p>`;
}
function overview(p) {
  return workspaceOverview(p, summary(p, projectTools.at), {
    asOf: projectTools.at,
    controls: projectTools.controls('overview'),
  });
}
function tasks(p, daily) {
  const shown = filtered(p).filter(
    (task) =>
      !daily ||
      (!summaryIds(p).has(task.id) &&
        (!onlyOpen ||
          (task.kind === 'milestone'
            ? !task.doneDate
            : task.items.some((item) => !item.doneDate)))),
  );
  const controls = filters(p, daily);
  const markup = daily
    ? workspaceDaily(p, { asOf: projectTools.at, tasks: shown, controls })
    : workspaceTasks(p, summary(p, projectTools.at), {
        asOf: projectTools.at,
        tasks: shown,
        controls,
      });
  const offset = markup.indexOf(controls) + controls.length;
  return (
    markup.slice(0, offset) +
    '<div id="workspaceResults" class="workspace-results">' +
    markup.slice(offset) +
    '</div>'
  );
}
function filters(p, daily) {
  return `<div class="desktop-controls workspace-filters"><label class="search-control"><span>업무 검색</span><input id="search" type="search" placeholder="업무 검색" aria-label="업무 검색" value="${esc(query)}"></label><label><span>담당자</span><select id="owner" aria-label="담당자 필터"><option value="">전체 담당자</option>${p.members.map((m) => `<option value="${esc(m.id)}" ${owner === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>${projectTools.dateControl()}${daily ? `<label class="switch-label"><input id="onlyOpen" type="checkbox" ${onlyOpen ? 'checked' : ''}>할 일만</label>` : ''}<div class="filter-status"><span>검색 결과 ${filtered(p).length} / 전체 ${p.tasks.length}</span>${query || owner ? button('필터 초기화', 'clear-filters', 'small ghost') : ''}</div></div>`;
}
function people(p) {
  return peopleView(p, summary(p, projectTools.at), projectTools.at, {
    controls: projectTools.controls('people'),
  });
}
function reports() {
  return projectTools.reports();
}
function more(p) {
  return `<section class="settings-card"><h2>프로젝트</h2><p>${esc(p.description || '이 프로젝트의 일정과 참여인력을 관리하세요.')}</p>${button('프로젝트 설정', 'settings')}
    <div class="history-actions">${button('↶ 실행 취소', 'undo', '', undo.length ? '' : 'disabled')}${button('↷ 다시 실행', 'redo', '', redo.length ? '' : 'disabled')}</div></section>

    <section class="settings-card"><h2>파일 가져오기 · 내보내기</h2><p>프로젝트 파일은 웹과 데스크톱에서도 가져올 수 있습니다.</p><div class="stack-actions">${button(icon('download') + ' 프로젝트 내보내기', 'export')}${button(icon('upload') + ' 프로젝트 가져오기', 'import')}</div></section>
    <section class="settings-card"><h2>업무 기준 시간대</h2><p>${esc(getBusinessTimeZone())} 기준으로 오늘과 완료일을 계산합니다.</p>${button('시간대 변경', 'timezone')}</section>
    <p class="privacy-note">PM Canvas 0.3.1 · 기기에 자동 저장<br>계정이나 서버 연결 없이 동작합니다. 앱을 삭제하면 기기의 프로젝트도 삭제될 수 있으므로 파일을 내보내 보관하세요.</p>
    <p class="privacy-note">${button('개인정보처리방침', 'privacy', 'ghost')}</p>
    <div class="delete-project">${button('이 프로젝트 삭제', 'delete-project', 'danger ghost')}</div>`;
}
function render() {
  const p = record?.project;
  const active = Boolean(p && view !== 'projects');
  document.title = active ? p.name + ' · ' + titles[view] + ' — PM Canvas' : 'PM Canvas';
  document.body.classList.toggle('in-project', active);
  $('#activeProjectName').textContent = active ? p.name : '프로젝트 관리';
  $('#projectListLink').setAttribute(
    'aria-label',
    active ? '프로젝트 목록 · ' + p.name : '프로젝트 목록',
  );
  $('#openWorkspaceMenu').hidden = !active;
  $('#workspaceFiles').hidden = !active;
  $('#drawerProjectName').textContent = p?.name || '';
  $('#workspaceNavigation').innerHTML = active
    ? projectNavigation('mobile')
        .map(
          (group) =>
            `<section class="navigation-group"><h2>${esc(group.title)}</h2>${group.views
              .map(
                (id) =>
                  `<a href="#${id}/${esc(p.id)}" data-view="${id}" ${id === view ? 'aria-current="page"' : ''}>${icon(PROJECT_SCREENS[id].icon)}<span>${esc(PROJECT_SCREENS[id].title)}</span></a>`,
              )
              .join('')}</section>`,
        )
        .join('')
    : '';
  $('#workspaceFiles .menu-popover').innerHTML = active
    ? `${button('프로젝트 설정', 'settings')}${button('프로젝트 내보내기', 'export')}${button('프로젝트 가져오기', 'import')}<hr>${button('↶ 실행 취소', 'undo', '', undo.length ? '' : 'disabled')}${button('↷ 다시 실행', 'redo', '', redo.length ? '' : 'disabled')}`
    : '';
  if (!active) {
    $('#content').innerHTML = projectList();
    return;
  }
  let content =
    view === 'overview'
      ? overview(p)
      : view === 'tasks'
        ? tasks(p, false)
        : view === 'daily'
          ? tasks(p, true)
          : view === 'people'
            ? people(p)
            : view === 'reports'
              ? reports(p)
              : view === 'more'
                ? more(p)
                : projectTools.render(view);
  $('#content').innerHTML = content;
  if (!$('#content .page-head'))
    $('#content').insertAdjacentHTML(
      'afterbegin',
      pageHead('PROJECT WORKSPACE', titles[view], '', ''),
    );
  const heading = $('#content .page-head');
  heading.classList.add('project-heading');
  heading.querySelector('h1').textContent = titles[view];
  if (!['overview', 'tasks', 'daily', 'people'].includes(view))
    heading.after(document.createRange().createContextualFragment(projectTools.controls(view)));
  projectTools.attach(view);
}
async function route() {
  if (editing || $('#confirmation').open) {
    history.replaceState(
      null,
      '',
      `#${view}${record && view !== 'projects' ? '/' + record.id : ''}`,
    );
    return;
  }
  const [requested, id] = location.hash.slice(1).split('/');
  if ((requested !== view || id !== record?.id) && !(await projectTools.leave())) {
    history.replaceState(
      null,
      '',
      `#${view}${record && view !== 'projects' ? '/' + record.id : ''}`,
    );
    const picker = $('#projectView');
    if (picker) picker.value = view;
    return;
  }
  scrollPositions.set(`${view}/${record?.id || ''}`, window.scrollY);
  records = await store.list();
  const next = records.find((entry) => entry.id === id);
  if (next && Object.hasOwn(titles, requested)) {
    const changed = record?.id !== next.id || record?.revision !== next.revision;
    record = { ...next, project: normalizeProject(next.project) };
    if (changed) {
      $('#toast').hidden = true;
      undo = [];
      redo = [];
      query = '';
      owner = '';
    }
    projectTools.enter(requested, next.id);
    completionDate = projectTools.at;
    view = requested;
  } else {
    $('#toast').hidden = true;
    view = 'projects';
    record = null;
    undo = [];
    redo = [];
  }
  render();
  $('#content').focus({ preventScroll: true });
  window.scrollTo(0, scrollPositions.get(`${view}/${record?.id || ''}`) || 0);
}
function navigate(next, id = record?.id) {
  location.hash = next + (id ? '/' + id : '');
}
function trimHistory(stack) {
  while (stack.length > 20 || JSON.stringify(stack).length > 8 * 1024 * 1024) stack.shift();
}
async function save(project, history = true) {
  const previous = record?.project;
  const saved = await store.save(project, record?.id === project.id ? record.revision : 0);
  if (previous && (previous.weeklyReports?.length || 0) !== (project.weeklyReports?.length || 0)) {
    undo = [];
    redo = [];
    history = false;
  }
  if (history && previous?.id === project.id) {
    undo.push(previous);
    trimHistory(undo);
    redo = [];
  }
  record = saved;
  records = records.filter((entry) => entry.id !== saved.id);
  records.unshift(saved);
  render();
}
function openEditor(type, id = '') {
  if (projectTools.dirty() || projectTools.pending()) {
    toast('변경사항을 먼저 저장하거나 취소해 주세요.');
    return;
  }
  editing = { type, id };
  returnFocus = document.activeElement;
  const form = editorForm(type, record?.project || { members: [], tasks: [] }, id, {
    uid,
    extraFields: type === 'task' ? parentField(record.project, id) : '',
    expandDetails: Boolean(record?.project.tasks.find((task) => task.id === id)?.parentId),
  });
  $('#editorTitle').textContent = form.title;
  $('#editorBody').innerHTML = form.body;
  // Use the same complete form as desktop; only its scrolling layout changes.
  if (type === 'task' && !id) $('#editorBody [name="itemTitle"]')?.removeAttribute('required');
  if (type === 'project' || type === 'settings') {
    $('#editorBody [name="koreanHolidays"]')?.closest('label')?.remove();
    mountHolidayPicker($('#editorBody'), {
      enabled: type === 'project' || record.project.koreanHolidays === true,
    });
  }
  $('#formError').textContent = '';
  $('#deleteItem').hidden = !id || !['task', 'member'].includes(type);
  $('#editor').showModal();
  $('#editorBody').scrollTop = 0;
  initialEditorFields = editorFields();
  // On iOS, focusing a select while the dialog opens can retain its native
  // input session and swallow the next text-field tap. Let the user focus the
  // desired field after the sheet has opened.
  if (Capacitor.getPlatform() !== 'ios')
    $('#editorBody').querySelector('input,textarea,select')?.focus();
}
function editorFields() {
  return JSON.stringify([
    [...new FormData($('#editorForm')).entries()],
    [...$('#editorBody').querySelectorAll('.item-editor')].map((row) => [
      row.dataset.itemId,
      row.dataset.doneDate,
    ]),
  ]);
}
async function requestCloseEditor() {
  if (busy || !editing || $('#confirmation').open) return;
  if (
    editorFields() !== initialEditorFields &&
    !(await confirmAction(
      '저장하지 않은 입력이 있습니다. 계속 작성하거나 변경사항을 버릴 수 있습니다.',
      '변경사항을 버릴까요?',
      '버리기',
    ))
  )
    return;
  closeEditor();
}
function closeEditor() {
  editing = null;
  $('#editor').close();
}
$('#editor').addEventListener('close', () => {
  editing = null;
  if (returnFocus?.isConnected) returnFocus.focus();
});
$('#editor').addEventListener('cancel', (event) => {
  event.preventDefault();
  requestCloseEditor();
});
$('#closeEditor').onclick = $('#cancelEditor').onclick = () => {
  requestCloseEditor();
};
$('#editorForm').addEventListener(
  'invalid',
  (event) => {
    for (
      let parent = event.target.parentElement;
      parent && parent !== $('#editorBody');
      parent = parent.parentElement
    ) {
      if (parent.tagName === 'DETAILS') parent.open = true;
    }
  },
  true,
);
function updateEditorViewport() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  document.documentElement.style.setProperty('--editor-viewport-height', `${viewport.height}px`);
  document.documentElement.style.setProperty(
    '--editor-bottom',
    `${Math.max(0, innerHeight - viewport.height - viewport.offsetTop)}px`,
  );
}
window.visualViewport?.addEventListener('resize', updateEditorViewport);
updateEditorViewport();
if (Capacitor.getPlatform() === 'android') {
  // Keep the IME open until the button action. Blurring on pointer-down can
  // resize the dialog before pointer-up and swallow Save, Delete or Cancel.
  $('#editor').addEventListener('pointerdown', (event) => {
    if (
      event.target.closest('.dialog-actions button, #closeEditor') &&
      document.activeElement?.matches('input, textarea, select')
    )
      event.preventDefault();
  });
}
$('#editorBody').addEventListener('click', (event) => {
  if (event.target.closest('#addItem')) {
    if ($('#itemEditors').children.length >= 200)
      return toast('세부 작업은 200개까지 추가할 수 있습니다.');
    $('#itemEditors').insertAdjacentHTML(
      'beforeend',
      itemEditor({ id: uid(), title: '', hours: 4, doneDate: null }),
    );
    $('#itemEditors').lastElementChild.querySelector('input').focus();
  }
  event.target.closest('.remove-item')?.closest('.item-editor').remove();
  const itemTitles = [...$('#editorBody').querySelectorAll('[name="itemTitle"]')];
  itemTitles.forEach((input) => {
    input.required = Boolean(editing?.id || itemTitles.length > 1);
  });
});
$('#editorForm').addEventListener('submit', (event) => {
  event.preventDefault();
  run(async () => {
    try {
      if (editing.type === 'timezone') {
        const zone = new FormData(event.target).get('timeZone').trim();
        const validated = validateTimeZone(zone);
        const previous = getBusinessTimeZone();
        try {
          setBusinessTimeZone(validated);
          for (const entry of await store.list()) normalizeProject(entry.project);
          localStorage.setItem('pmcanvas.mobile.timezone', validated);
        } catch (error) {
          setBusinessTimeZone(previous);
          throw Error(
            '시간대를 변경하지 못했습니다. 완료 기록이 새 시간대의 오늘보다 늦지 않은지, 기기에 설정을 저장할 수 있는지 확인해 주세요.',
            { cause: error },
          );
        }
        if (projectTools.at === lastDay || projectTools.at > today()) projectTools.at = today();
        if (projectTools.range.to > projectTools.at)
          projectTools.range = { from: projectTools.at, to: projectTools.at, owner: '' };
        lastDay = today();
        completionDate = projectTools.at;
        closeEditor();
        render();
        return;
      }
      const items = [...document.querySelectorAll('.item-editor')].map((row) => ({
        id: row.dataset.itemId,
        title: row.querySelector('[name="itemTitle"]').value.trim(),
        hours: Number(row.querySelector('[name="itemHours"]').value),
        doneDate: row.dataset.doneDate || null,
      }));
      if (editing.type === 'task' && !editing.id && items.length === 1 && !items[0].title) {
        items[0].title = new FormData(event.target).get('name').trim();
      }
      const result = applyEditor(
        record?.project || {},
        editing,
        new FormData(event.target),
        items,
        { uid },
      );
      if (editing.type === 'task') {
        const task = editing.id
          ? result.project.tasks.find((task) => task.id === editing.id)
          : result.project.tasks.at(-1);
        task.parentId = String(new FormData(event.target).get('parentId') || '');
      }
      await save(result.project);
      closeEditor();
      if (result.created) navigate('overview', result.project.id);
      toast(result.message);
    } catch (error) {
      $('#formError').textContent = errorText(error);
    }
  });
});
async function confirmAction(message, title = '삭제할까요?', label = '삭제') {
  $('#confirmText').textContent = message;
  $('#confirmTitle').textContent = title;
  $('#confirmAccept').textContent = label;
  $('#confirmation').returnValue = 'cancel';
  $('#confirmation').showModal();
  return new Promise((resolve) =>
    $('#confirmation').addEventListener(
      'close',
      () => resolve($('#confirmation').returnValue === 'delete'),
      { once: true },
    ),
  );
}
const confirmDelete = (message, { title = '삭제할까요?', action = '삭제' } = {}) =>
  confirmAction(message, title, action);
$('#deleteItem').onclick = async () => {
  if (!editing || busy) return;
  if (
    !(await confirmDelete(
      editing.type === 'member'
        ? '참여인력을 삭제하면 담당 업무가 미지정으로 바뀝니다.'
        : '업무와 세부 작업을 삭제합니다. 하위 업무는 유지하고 선행 연결은 해제합니다.',
    ))
  )
    return;
  run(async () => {
    await save(deleteEntity(record.project, editing.type, editing.id));
    closeEditor();
    toast('삭제했습니다. 상단 파일 메뉴에서 실행 취소할 수 있습니다.');
  });
};
function showWorkspaceMenu() {
  if (busy || editing || !record || $('#workspaceDrawer').open) return;
  $('#workspaceDrawer').showModal();
  $('#openWorkspaceMenu').setAttribute('aria-expanded', 'true');
}
$('#openWorkspaceMenu').onclick = showWorkspaceMenu;
$('#closeWorkspaceMenu').onclick = () => $('#workspaceDrawer').close();
$('#workspaceDrawer').addEventListener('close', () =>
  $('#openWorkspaceMenu').setAttribute('aria-expanded', 'false'),
);
$('#workspaceDrawer').addEventListener('click', (event) => {
  if (event.target === $('#workspaceDrawer') || event.target.closest('a'))
    $('#workspaceDrawer').close();
});
document.addEventListener('click', (event) => {
  if (event.target.closest('[data-reset-filters]') && !busy && !editing) {
    query = '';
    owner = '';
    render();
    return;
  }
  if (busy && event.target.closest('a[href^="#"]')) {
    event.preventDefault();
    return;
  }
  const go = event.target.closest('[data-go]');
  if (go && !busy && !editing) return navigate(go.dataset.go);
  const member = event.target.closest('[data-edit-member]');
  if (member && !busy && !editing) return openEditor('member', member.dataset.editMember);
  const chartTask = event.target.closest('[data-edit-task]');
  if (chartTask && !busy && !editing) {
    openEditor('task', chartTask.dataset.editTask);
    return;
  }
  const target = event.target.closest('[data-action]');
  if (!target || busy || editing) return;
  const action = target.dataset.action;
  $('#workspaceFiles').open = false;
  if (action === 'privacy') {
    $('#privacyBody').innerHTML = privacyContent;
    $('#privacyDialog').showModal();
    return;
  }
  if (action === 'new') return openEditor('project');
  if (action === 'open') return navigate('overview', records[Number(target.dataset.index)].id);
  if (action === 'import') return $('#importFile').click();
  if (action === 'export-excel') {
    void projectTools.excel().catch((error) => toast(errorText(error)));
    return;
  }
  if (action === 'export-wbs') {
    void projectTools.exportCsv().catch((error) => toast(errorText(error)));
    return;
  }
  if (action === 'task' || action === 'add-task' || action === 'edit-task')
    return openEditor('task', target.dataset.id);
  if (action === 'member' || action === 'add-member' || action === 'edit-member')
    return openEditor('member', target.dataset.id);
  if (action === 'settings') return openEditor('settings');
  if (action === 'clear-filters') {
    query = '';
    owner = '';
    render();
    return;
  }
  if (action === 'timezone') {
    returnFocus = target;
    editing = { type: 'timezone' };
    $('#editorTitle').textContent = '업무 기준 시간대';
    $('#editorBody').innerHTML =
      `<label class="field">IANA Time Zone<input name="timeZone" value="${esc(getBusinessTimeZone())}" required maxlength="100" placeholder="Asia/Seoul"></label><p class="form-hint">예: Asia/Seoul, America/New_York, UTC. 저장된 일정은 바뀌지 않습니다.</p>`;
    $('#formError').textContent = '';
    $('#deleteItem').hidden = true;
    $('#editor').showModal();
    initialEditorFields = editorFields();
    return;
  }
  if (action === 'delete-project') {
    confirmDelete('이 기기에 저장된 프로젝트를 삭제합니다. 필요한 파일을 먼저 내보내 주세요.').then(
      (confirmed) => {
        if (confirmed)
          run(async () => {
            await store.remove(record.id);
            navigate('projects', '');
          });
      },
    );
    return;
  }
  run(async () => {
    if (action === 'undo' || action === 'redo') {
      const source = action === 'undo' ? undo : redo,
        destination = action === 'undo' ? redo : undo;
      if (!source.length) return;
      const previous = record.project;
      await save(source.at(-1), false);
      source.pop();
      destination.push(previous);
      trimHistory(destination);
      render();
      toast(action === 'undo' ? '변경사항을 되돌렸습니다.' : '변경사항을 다시 적용했습니다.');
    } else if (action === 'export') {
      await shareFile(record.project.name + '.pmcanvas', serializeProject(record.project));
    } else if (action === 'csv') {
      await projectTools.exportCsv();
    } else if (action === 'completion-csv') {
      await projectTools.exportCsv(true);
    } else if (action === 'retry') await route();
  });
});
function refreshFilteredScreen() {
  const fragment = document
    .createRange()
    .createContextualFragment(tasks(record.project, view === 'daily'));
  $('#workspaceResults').replaceWith(fragment.querySelector('#workspaceResults'));
  $('.filter-status').replaceWith(fragment.querySelector('.filter-status'));
}
document.addEventListener('input', (event) => {
  if (event.target.id !== 'search') return;
  query = event.target.value;
  refreshFilteredScreen();
});
document.addEventListener('change', (event) => {
  const element = event.target;
  if (element.id === 'owner') {
    owner = element.value;
    refreshFilteredScreen();
  }
  if (element.id === 'onlyOpen') {
    onlyOpen = element.checked;
    refreshFilteredScreen();
  }
  if (element.id === 'completionDate') {
    if (!validDate(element.value) || element.value > today()) {
      element.value = completionDate;
      toast('오늘까지의 날짜를 선택해 주세요.');
      return;
    }
    completionDate = element.value;
    projectTools.at = element.value;
  }
  if (element.dataset.item) {
    if (busy) {
      element.checked = !element.checked;
      return;
    }
    run(async () => {
      try {
        await save(
          toggleItem(
            record.project,
            element.dataset.task || element.dataset.check,
            element.dataset.item,
            completionDate,
          ),
        );
        toast(element.checked ? '완료를 기록했습니다.' : '완료를 취소했습니다.', true);
      } catch (error) {
        element.checked = !element.checked;
        throw error;
      }
    });
  }
});
$('#importFile').addEventListener('change', (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  run(async () => {
    if (file.size > MAX_BYTES) throw Error('8MB 이하의 프로젝트 파일을 선택해 주세요.');
    const project = parseProject(await file.text());
    // Every import creates a copy; it can never overwrite the current project's changes.
    project.id = uid();
    await save(project, false);
    undo = [];
    redo = [];
    navigate('overview', project.id);
    toast('프로젝트를 새 사본으로 가져왔습니다.');
  });
});
function refreshDate() {
  if (
    today() !== lastDay &&
    !editing &&
    !$('#confirmation').open &&
    !busy &&
    !projectTools.dirty() &&
    !projectTools.pending() &&
    !document.activeElement?.matches('input,textarea,select')
  ) {
    if (projectTools.at === lastDay) projectTools.at = today();
    lastDay = today();
    completionDate = today();
    render();
  }
}
window.addEventListener('hashchange', () => {
  run(route);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshDate();
});
window.addEventListener('focus', refreshDate);
$('#closePrivacy').onclick = () => $('#privacyDialog').close();
setInterval(refreshDate, 60000);
if (Capacitor.isNativePlatform()) {
  App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) refreshDate();
  }).catch((error) => toast(errorText(error)));
  App.addListener('backButton', () => {
    if (busy) return;
    if ($('#privacyDialog').open) return $('#privacyDialog').close();
    if ($('#confirmation').open) return $('#confirmation').close('cancel');
    if ($('#workspaceDrawer').open) return $('#workspaceDrawer').close();
    if ($('#editor').open) return requestCloseEditor();
    if (view !== 'projects') navigate('projects', '');
    else App.minimizeApp();
  }).catch((error) => toast(errorText(error)));
}
try {
  await route();
  navigator.storage?.persist?.().catch(() => {});
} catch (error) {
  $('#content').innerHTML = empty(
    '저장소를 열지 못했습니다',
    '기기의 저장 공간과 브라우저 설정을 확인한 뒤 다시 시도해 주세요.',
    button('다시 시도', 'retry', 'primary'),
  );
  toast(errorText(error));
}
