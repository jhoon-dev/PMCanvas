import { ui } from './i18n.js';
import { setBusinessTimeZone } from './business-clock.js';
import { installLanguage } from './i18n.js';
import { createProjectEditor } from './project-editor.js';
import { openConflict } from './conflict-ui.js';
import { createAlertsUi } from './alerts-ui.js';
import { createReportUi } from './report-ui.js';
import { createAdminUi } from './admin-ui.js';
import { createHelpUi } from './help-ui.js';
import { createAuthUi } from './auth-ui.js';
import { dailyView, filteredTasks, recordCompletion } from './daily-view.js';
import { peopleView } from './people-view.js';
import { escapeHtml as esc } from './html.js';
import { createInfoDialog } from './info-dialog.js';
import { DraftStore } from './draft-store.js';
import { api } from './api-client.js';
import { ReportClock } from './report-clock.js';
import { workspaceKnowledge, applyWorkspaceSync, WorkspaceReadGate } from './workspace-cache.js';
import { myWorkView } from './my-work-ui.js';
import { WbsView } from './wbs-view.js';
import { dashboardView } from './dashboard-view.js';
import { icon, btn, pageHead, empty } from './view-ui.js';
import { today, progress, summary } from './engine.js';
let currentUser = null,
  saveInFlight = false,
  mutationSequence = 0,
  myProjects = [],
  dailyMode = 'mine';
let reviewLanding = location.hash === '#registration-approvals';
let alertLanding = location.hash === '#operation-alerts';
const $ = (s) => document.querySelector(s);
const reportClock = new ReportClock();
let TODAY = reportClock.today;
let state = { version: 1, projects: [], activeId: null },
  storageError = '',
  view = normalizeView(location.hash.slice(1)),
  asOf = TODAY,
  ownerFilter = '',
  statusFilter = '',
  query = '',
  onlyPending = false;
const project = () => state.projects.find((p) => p.id === state.activeId);
const savedProjects = new Map();
const workspaceReads = new WorkspaceReadGate();
function clearAccountWorkspace() {
  mutationSequence++;
  workspaceReads.invalidate();
  state = { version: 1, projects: [], activeId: null };
  myProjects = [];
  storageError = '';
  savedProjects.clear();
}
const wbs = new WbsView({
  resolveConflict: openConflict,
  getDraftStore: () => (currentUser ? new DraftStore(currentUser.id) : null),
  getProject: project,
  request: api,
  isSaving: () => saveInFlight,
  onMutation: () => {
    mutationSequence++;
    setBusy(true);
  },
  onSettled: () => setBusy(false),
  acceptProject: (p) => {
    savedProjects.set(p.id, structuredClone(p));
    state.projects[state.projects.findIndex((x) => x.id === p.id)] = p;
    storageError = '';
  },
  onSaved: refreshMyWork,
  onAuth: showAuth,
  toast,
  onStatus: updateAccessUi,
  onRender: render,
  onDetails: (id) => openEditor('task', id),
});
async function persist() {
  const p = project();
  if (!p || saveInFlight) return false;
  mutationSequence++;
  setBusy(true);
  $('#saveStatus').textContent = ui('서버 저장 중…');
  try {
    const result = await api('projects' + (p._revision ? '/' + p.id : ''), {
      method: p._revision ? 'PUT' : 'POST',
      body: { project: p, ...(p._revision ? { revision: p._revision } : {}) },
    });
    state.projects[state.projects.findIndex((x) => x.id === p.id)] = result.project;
    wbs.rebaseCreatedProject(result.project);
    savedProjects.set(p.id, structuredClone(result.project));
    storageError = '';
    $('#saveStatus').textContent = ui('서버에 저장됨');
    $('#saveStatus').classList.remove('error');
    refreshMyWork();
    return true;
  } catch (error) {
    storageError = ui(error.message);
    if (error.status === 409 && savedProjects.has(p.id)) {
      try {
        const { project: latest } = await api('projects/' + p.id);
        const resolved = await openConflict(savedProjects.get(p.id), p, latest);
        if (resolved) {
          savedProjects.set(p.id, structuredClone(latest));
          state.projects[state.projects.findIndex((x) => x.id === p.id)] = resolved.project;
          storageError = ui('선택한 변경을 초안에 반영했습니다. 확인 후 저장해 주세요.');
        }
      } catch (conflictError) {
        storageError = ui(conflictError.message);
      }
    }
    $('#saveStatus').textContent = ui('저장 실패 · 백업 필요');
    $('#saveStatus').classList.add('error');
    toast(storageError);
    if (error.status === 401) showAuth(ui(error.message));
    return false;
  } finally {
    setBusy(false);
  }
}
function toast(text) {
  $('#toast').textContent = text;
  $('#toast').classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 3500);
}
function render() {
  refreshDate(false);
  document.body.dataset.appView = view;
  if (!state.projects.length) {
    $('#breadcrumbProject').textContent = ui('프로젝트 시작하기');
    $('#projectSelect').innerHTML = '';
    $('#projectList').innerHTML = '';
    $('#taskNavCount').textContent = '';
    $('#main').innerHTML =
      view === 'daily'
        ? myWorkView({ projects: myProjects, esc, progress, today: TODAY, projectMode: '' })
        : pageHead(
            'PROJECT WORKSPACE',
            ui('팀의 프로젝트를 시작하세요'),
            ui('프로젝트를 만들고 팀원과 함께 업무를 관리하세요.'),
            btn(ui('새 프로젝트'), 'project', 'primary'),
          ) +
          empty(
            ui('아직 접근할 수 있는 프로젝트가 없습니다'),
            ui('새 프로젝트를 만들거나 소유자에게 공유 권한을 요청하세요.'),
            'project',
            ui('새 프로젝트'),
          );
    updateAccessUi();
    hydrateIcons();
    return;
  }
  if (!['overview', 'tasks', 'daily', 'people'].includes(view)) view = 'overview';
  const p = project(),
    s = summary(p, asOf);
  $('#breadcrumbProject').textContent =
    view === 'daily' && dailyMode === 'mine' ? ui('전체 프로젝트 · 내 업무') : p.name;
  $('#projectSelect').innerHTML = state.projects
    .map(
      (x) =>
        '<option value="' +
        esc(x.id) +
        '" ' +
        (x.id === p.id ? 'selected' : '') +
        '>' +
        esc(x.name) +
        '</option>',
    )
    .join('');
  $('#taskNavCount').textContent = p.tasks.length || '';
  document
    .querySelectorAll('[data-view]')
    .forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('#projectList').innerHTML = state.projects
    .map(
      (x) =>
        '<button class="project-switch ' +
        (x.id === p.id ? 'selected' : '') +
        '" data-project="' +
        esc(x.id) +
        '"><span class="project-bullet"></span>' +
        esc(x.name) +
        (x.demo ? ui('<small>예시</small>') : '') +
        '</button>',
    )
    .join('');
  const notices =
    (storageError
      ? '<div class="notice error-notice" role="alert">' +
        esc(storageError) +
        ' ' +
        btn(ui('다시 저장'), 'retry-save', 'small') +
        ' ' +
        btn(ui('서버 다시 읽기'), 'reload-server', 'small') +
        '</div>'
      : '') +
    (p.demo
      ? ui(
          '<div class="demo-notice"><span><span class="demo-pill">SAMPLE</span> 예시 데이터로 먼저 둘러보세요. 실제 업무는 새 프로젝트에서 시작할 수 있어요.</span>',
        ) +
        btn(ui('새 프로젝트 만들기 ↗'), 'project', 'link') +
        '</div>'
      : '');
  let content;
  switch (view) {
    case 'tasks':
      content = wbs.render(p, asOf);
      break;
    case 'daily':
      content = dailyView(p, {
        asOf,
        currentDate: TODAY,
        ownerFilter,
        statusFilter,
        query,
        onlyPending,
        dailyMode,
        myProjects,
      });
      break;
    case 'people':
      content = peopleView(p, s, asOf);
      break;
    default:
      content = dashboardView(p, s, asOf);
  }
  $('#main').innerHTML = notices + content;
  hydrateIcons();
  updateAccessUi();
  if (view === 'tasks') wbs.attach();
}
function hydrateIcons() {
  document.querySelectorAll('[data-icon]').forEach((e) => {
    e.innerHTML = icon(e.dataset.icon);
  });
}
function openInfo(title, body) {
  info.resetGuard();
  $('#infoDialog').classList.remove('report-dialog', 'mail-settings-dialog');
  $('#infoDialog .eyebrow').textContent = 'PM CANVAS';
  $('#infoTitle').textContent = title;
  $('#infoBody').innerHTML = body;
  $('#infoDialog').showModal();
}
function openEditor(type, id = '') {
  editorUi.open(type, id);
}
function normalizeView(value) {
  return ['overview', 'tasks', 'daily', 'people'].includes(value) ? value : 'overview';
}
function navigate(v) {
  v = normalizeView(v);
  if (wbs.dirty && v !== 'tasks') {
    toast(ui('WBS 변경사항을 먼저 저장하거나 취소해 주세요.'));
    return;
  }
  view = v;
  ownerFilter = '';
  statusFilter = '';
  query = '';
  location.hash = v;
  render();
}
document.addEventListener('click', (e) => {
  const daily = e.target.closest('[data-daily-mode]');
  if (daily) {
    dailyMode = daily.dataset.dailyMode;
    ownerFilter = '';
    query = '';
    statusFilter = '';
    render();
    return;
  }
  if (e.target.closest('[data-action="admin"]')) {
    admin.open().catch((e) => toast(e.message));
    return;
  }
  const nav = e.target.closest('[data-view]');
  if (nav) {
    navigate(nav.dataset.view);
    return;
  }
  const sw = e.target.closest('[data-project]');
  if (sw) {
    if (storageError || wbs.dirty) {
      toast(ui('현재 변경사항을 먼저 저장하거나 백업한 뒤 취소해 주세요.'));
      return;
    }
    selectProject(sw.dataset.project).catch((error) => toast(ui(error.message)));
    return;
  }
  const task = e.target.closest('[data-edit-task]');
  if (task) {
    openEditor('task', task.dataset.editTask);
    return;
  }
  const m = e.target.closest('[data-edit-member]');
  if (m) {
    openEditor('member', m.dataset.editMember);
    return;
  }
  const a = e.target.closest('[data-action]')?.dataset.action;
  if (!a) return;
  if (a.startsWith('view:')) navigate(a.slice(5));
  else if (a === 'quick-task') {
    navigate('tasks');
    wbs.action('add');
  } else if (a === 'method') helpUi.method();
  else if (a === 'export-excel') reports.excel();
  else if (a === 'import-excel' && project()) {
    navigate('tasks');
    wbs.action('import-excel');
  } else if (a === 'export-wbs') reports.wbs();
  else if (a === 'history') reports.history();
  else if (a === 'export-history') reports.historyCsv();
  else if (a === 'retry-save')
    persist().then((saved) => {
      render();
      if (saved) toast(ui('서버에 저장했습니다.'));
    });
  else if (a === 'reload-server') reloadServer();
  else if (a === 'sharing') admin.sharing();
  else if (a === 'audit') admin.audit();
  else if (a === 'connections') admin.connections();
  else if (a === 'mail-settings') admin.mail();
  else if (a === 'security-audit') admin.securityAudit();
  else if (a === 'operation-alerts') alertsUi();
  else if (a === 'logout') admin.logout();
  else openEditor(a);
});
$('#main').addEventListener('change', async (e) => {
  const el = e.target;
  if (el.id === 'reportDate') {
    if (!reportClock.select(el.value)) {
      toast(ui('오늘까지의 날짜만 조회할 수 있어요.'));
      el.value = asOf;
      return;
    }
    TODAY = reportClock.today;
    asOf = reportClock.reportDate;
    render();
  }
  if (el.id === 'ownerFilter') {
    ownerFilter = el.value;
    render();
  }
  if (el.id === 'statusFilter') {
    statusFilter = el.value;
    render();
  }
  if (el.id === 'onlyPending') {
    onlyPending = el.checked;
    render();
  }
  if (el.dataset.checkItem) {
    refreshDate(false);
    await recordCompletion({
      project: project(),
      taskId: el.dataset.checkTask,
      itemId: el.dataset.checkItem,
      checked: el.checked,
      asOf,
      currentDate: TODAY,
      persist,
      onRender: render,
      toast,
    });
  }
});
$('#main').addEventListener('input', (e) => {
  if (e.target.id === 'taskSearch') {
    const pos = e.target.selectionStart;
    query = e.target.value;
    render();
    $('#taskSearch').focus();
    $('#taskSearch').setSelectionRange(pos, pos);
  }
});
window.addEventListener('hashchange', () => {
  if (location.hash === '#operation-alerts') {
    alertLanding = true;
    if (currentUser) showApprovalInbox().catch((error) => toast(ui(error.message)));
    else showAuth();
    return;
  }
  if (location.hash === '#registration-approvals') {
    reviewLanding = true;
    if (currentUser) showApprovalInbox().catch((error) => toast(ui(error.message)));
    else showAuth();
    return;
  }
  if (auth.handleHash()) return;
  const next = normalizeView(location.hash.slice(1));
  if (next === view) return;
  if (wbs.dirty && next !== 'tasks') {
    history.replaceState(null, '', '#tasks');
    toast(ui('WBS 변경사항을 먼저 저장하거나 취소해 주세요.'));
    return;
  }
  view = next;
  render();
});
$('#projectSelect').onchange = async (e) => {
  if (storageError || wbs.dirty) {
    toast(ui('WBS 변경사항을 먼저 저장하거나 취소해 주세요.'));
    render();
    return;
  }
  try {
    await selectProject(e.target.value);
  } catch (error) {
    toast(ui(error.message));
    render();
  }
};
async function selectProject(id) {
  ownerFilter = '';
  statusFilter = '';
  query = '';
  const loaded = await loadProjects({ activeId: id });
  if (!loaded) $('#projectSelect').value = state.activeId ?? '';
  return loaded;
}
$('#mobileNewProject').onclick = () => openEditor('project');
$('#closeInfo').onclick = () => info.close();
$('#newProjectSide').onclick = () => openEditor('project');
$('#excelExport').onclick = () => reports.excel();
function setBusy(value) {
  saveInFlight = value;
  document.querySelector('.workspace').inert = value;
  document.querySelector('.sidebar').inert = value;
  $('#editorDialog').inert = value;
}
function updateAccessUi() {
  const p = project(),
    readOnly = p?._role === 'viewer';
  $('#excelExport').disabled = !p;
  $('#excelImport').disabled = !p || readOnly;
  document
    .querySelectorAll('[data-edit-task],[data-edit-member],[data-check-item]')
    .forEach((el) => {
      if (readOnly) el.disabled = true;
    });
  document
    .querySelectorAll(
      '[data-action="task"],[data-action="quick-task"],[data-action="member"],[data-action="settings"]',
    )
    .forEach((el) => {
      el.disabled = readOnly;
    });
  const account = $('#accountButton');
  if (account)
    account.textContent =
      (currentUser?.name || ui('계정')) +
      (account.dataset.pending ? ui(' · 승인 ') + account.dataset.pending : '') +
      (account.dataset.alerts ? ui(' · 운영 알림 ') + account.dataset.alerts : '');
  $('#saveStatus').textContent = saveInFlight
    ? ui('서버 저장 중…')
    : storageError
      ? ui('저장 실패 · 백업 필요')
      : wbs.dirty
        ? ui('WBS 미저장 변경사항')
        : readOnly
          ? ui('조회 권한 · 서버 저장')
          : ui('서버에 저장됨');
  $('#saveStatus').classList.toggle('error', !!storageError);
  document.querySelector('.side-bottom small').textContent = readOnly
    ? ui('조회자 · 공동 프로젝트')
    : ui('팀과 함께하는 프로젝트');
}
function showAuth(message = '') {
  auth.show(message);
}
async function loadProjects({ force = false, activeId = state.activeId } = {}) {
  if (wbs.dirty || wbs.interacting) return false;
  const request = workspaceReads.begin(currentUser?.id, mutationSequence);
  const data = await api('workspace/sync', {
    method: 'POST',
    body: {
      activeId,
      known: force ? [] : workspaceKnowledge(state.projects),
      mine: force ? [] : workspaceKnowledge(myProjects),
    },
  });
  if (
    wbs.dirty ||
    wbs.interacting ||
    !workspaceReads.accepts(request, currentUser?.id, mutationSequence) ||
    (!force && (saveInFlight || storageError || document.querySelector('dialog[open]')))
  )
    return false;
  const updated = applyWorkspaceSync(state, myProjects, data);
  state = updated.state;
  myProjects = updated.myProjects;
  savedProjects.clear();
  for (const p of state.projects) if (!p._summary) savedProjects.set(p.id, structuredClone(p));
  storageError = '';
  if (force || updated.changed) render();
  admin.summary();
  return true;
}
async function boot() {
  try {
    const session = await api('auth/me');
    setBusinessTimeZone(session.timeZone || 'Asia/Seoul');
    reportClock.refresh();
    TODAY = reportClock.today;
    asOf = reportClock.reportDate;
    if (currentUser?.id !== session.user.id) {
      wbs.persistDraft();
      wbs.draft = null;
      wbs.base = null;
      wbs.pending.clear();
      wbs.recovery = null;
      clearAccountWorkspace();
    }
    currentUser = session.user;
    await loadProjects();
    $('#authGate').hidden = true;
    await showApprovalInbox();
  } catch (error) {
    if (error.status === 401) showAuth($('#authError').textContent);
    else showAuth(ui(error.message));
  }
}
async function reloadServer() {
  if (
    storageError &&
    !confirm(
      ui('현재 변경사항을 버리고 서버에서 다시 읽을까요? 필요한 내용은 먼저 JSON으로 백업하세요.'),
    )
  )
    return;
  try {
    const loaded = await loadProjects({ force: true });
    if (loaded) toast(ui('서버의 최신 내용을 읽었습니다.'));
  } catch (error) {
    toast(ui(error.message));
    if (error.status === 401) showAuth(ui(error.message));
  }
}
window.addEventListener('beforeunload', (e) => {
  if (saveInFlight || storageError || wbs.dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});
setInterval(async () => {
  if (
    !currentUser ||
    saveInFlight ||
    storageError ||
    wbs.dirty ||
    wbs.interacting ||
    document.visibilityState !== 'visible' ||
    $('#editorDialog').open ||
    document.querySelector('dialog[open]') ||
    !$('#authGate').hidden
  )
    return;
  try {
    await loadProjects();
  } catch (error) {
    if (error.status === 401) showAuth(ui(error.message));
  }
}, 15000);

window.addEventListener('pagehide', () => wbs.persistDraft());

let datePaintPending = false;
function refreshDate(paint = true) {
  const advance =
    !saveInFlight &&
    !storageError &&
    !wbs.dirty &&
    !wbs.interacting &&
    !$('#editorDialog').open &&
    !$('#infoDialog').open &&
    !document.activeElement?.matches(
      'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]),textarea,select,[contenteditable="true"]',
    );
  const changed = reportClock.refresh({ advance });
  TODAY = reportClock.today;
  asOf = reportClock.reportDate;
  datePaintPending ||= changed.dayChanged || changed.reportChanged;
  if (!paint) {
    if (advance) datePaintPending = false;
    return;
  }
  if (advance && datePaintPending) {
    datePaintPending = false;
    render();
  }
}
window.addEventListener('focus', () => refreshDate());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshDate();
});
document.addEventListener('focusout', () => setTimeout(() => refreshDate(), 150));
document.addEventListener('close', () => refreshDate(), true);
setInterval(() => refreshDate(), 30000);

async function showApprovalInbox() {
  if (alertLanding && currentUser && !storageError && !wbs.dirty && !saveInFlight) {
    alertLanding = false;
    history.replaceState(null, '', location.pathname + location.search);
    if (currentUser.isAdmin) await alertsUi();
    else toast(ui('관리자 권한이 필요합니다.'));
    return;
  }
  if (!reviewLanding || !currentUser) return;
  if (storageError || wbs.dirty || saveInFlight) {
    toast(ui('현재 변경사항을 저장한 뒤 승인 요청 링크를 다시 열어 주세요.'));
    return;
  }
  reviewLanding = false;
  if (location.hash === '#registration-approvals')
    history.replaceState(null, '', location.pathname + location.search);
  if (!currentUser.isAdmin) {
    toast(ui('가입 승인 목록은 관리자만 확인할 수 있습니다.'));
    return;
  }
  await admin.open('pending');
}
document.addEventListener('click', (e) => {
  document.querySelectorAll('.action-menu[open]').forEach((menu) => {
    if (!menu.contains(e.target) || e.target.closest('button')) menu.open = false;
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  document.querySelectorAll('.action-menu[open]').forEach((menu) => {
    if (menu.contains(document.activeElement)) {
      menu.open = false;
      menu.querySelector('summary')?.focus();
      e.preventDefault();
    }
  });
});

function opsCanChange() {
  if (wbs.dirty || storageError || saveInFlight) {
    toast(ui('현재 변경사항을 먼저 저장하거나 취소해 주세요.'));
    return false;
  }
  return true;
}
async function refreshMyWork() {
  const request = workspaceReads.begin(currentUser?.id, mutationSequence);
  try {
    const r = await api('my-work');
    if (!workspaceReads.accepts(request, currentUser?.id, mutationSequence)) return;
    myProjects = r.projects;
    if (view === 'daily' && dailyMode === 'mine') render();
  } catch {
    /* A successful project save is independent of this read. */
  }
}
const info = createInfoDialog({ toast });
const alertsUi = createAlertsUi({
  api,
  user: () => currentUser,
  openInfo,
  dialog: info,
  toast,
  onChange: () => admin.summary(),
});
function filterDailyTasks(p) {
  return filteredTasks(p, { asOf, ownerFilter, statusFilter, query });
}
const editorUi = createProjectEditor({
  failureMessage: () => storageError,
  project,
  wbs,
  hasStorageError: () => !!storageError,
  canChange: opsCanChange,
  api,
  persist,
  render,
  toast,
  currentDate: today,
  onCreate(p) {
    state.projects.push(p);
    state.activeId = p.id;
    view = 'people';
    location.hash = 'people';
  },
  onReplace(p) {
    state.projects[state.projects.findIndex((x) => x.id === p.id)] = p;
  },
  reload: () => loadProjects({ force: true }),
});
const reports = createReportUi({
  api,
  project,
  wbs,
  getView: () => view,
  getDate: () => asOf,
  getOwner: () => ownerFilter,
  filterDailyTasks,
  hasStorageError: () => !!storageError,
  persist,
  render,
  toast,
  showAuth,
  openInfo,
  currentDate: today,
  onPendingRestored: () => navigate('tasks'),
  onImport(p) {
    state.projects.push(p);
    state.activeId = p.id;
    ownerFilter = '';
    statusFilter = '';
    query = '';
  },
});
const helpUi = createHelpUi(openInfo);
const admin = createAdminUi({
  api,
  user: () => currentUser,
  project,
  projects: () => state.projects,
  wbs,
  hasUnsaved: () => !!(storageError || wbs.dirty),
  isBusy: () => saveInFlight,
  openInfo,
  toast,
  showAuth,
  dialog: info,
  canChange: opsCanChange,
  onMailEnabled: (enabled) => auth.setMailEnabled(enabled),
  reload: async (id) => {
    await loadProjects({ force: true, activeId: id ?? state.activeId });
  },

  openTask: async (projectId, taskId) => {
    if (!opsCanChange()) return;
    try {
      if (!(await loadProjects({ activeId: projectId }))) return;
    } catch (error) {
      toast(ui(error.message));
      return;
    }
    dailyMode = 'project';
    navigate('daily');
    const selected = project()?.tasks.find((task) => task.id === taskId);
    if (selected) {
      ownerFilter = selected.owner;
      query = selected.name;
      render();
    }
    const task = [...document.querySelectorAll('[data-check-task]')].find(
      (el) => el.dataset.checkTask === taskId,
    );
    task?.closest('.check-panel')?.scrollIntoView({ block: 'center' });
  },
});
const auth = createAuthUi({
  api,
  user: () => currentUser,
  hasUnsaved: () => !!(storageError || wbs.dirty),
  isBusy: () => saveInFlight,
  acceptUser(nextUser) {
    if (currentUser?.id !== nextUser.id) {
      wbs.persistDraft();
      if (currentUser) DraftStore.clearUser(currentUser.id);
      wbs.draft = null;
      wbs.base = null;
      wbs.pending.clear();
      wbs.recovery = null;
      clearAccountWorkspace();
    }
    currentUser = nextUser;
  },
  refreshWorkspace: async () => {
    if (storageError || wbs.dirty) render();
    else await loadProjects();
  },
  openInfo,
  approvalPending: () => reviewLanding || alertLanding,
  onApproval: showApprovalInbox,
  toast,
});
installLanguage({
  toast,
  canChange: () =>
    !saveInFlight &&
    !storageError &&
    !wbs.dirty &&
    !$('#editorDialog').open &&
    !$('#infoDialog').open &&
    !document.querySelector('dialog[open]') &&
    ($('#authGate').hidden ||
      ![...document.querySelectorAll('#authGate input:not([readonly])')].some(
        (input) => input.value,
      )),
});
auth.start(boot);
