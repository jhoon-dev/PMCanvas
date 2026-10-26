import { createAuthUi } from './auth-ui.js';
import { dailyView, filteredTasks, recordCompletion } from './daily-view.js';
import { peopleView, memberEditor, updateMember } from './people-view.js';
import { escapeHtml as esc } from './html.js';
import { accountRows } from './account-ui.js';
import { createMailSettingsUi } from './mail-settings-ui.js';
import { createInfoDialog } from './info-dialog.js';
import { DraftStore } from './draft-store.js';
import { api } from './api-client.js';
import { workspaceOperations } from './operations-ui.js';
import { myWorkView } from './my-work-ui.js';
import { WbsView } from './wbs-view.js';
import { dashboardView } from './dashboard-view.js';
import { icon, num, btn, pageHead, empty, field } from './view-ui.js';
let currentUser = null,
  saveInFlight = false,
  mutationSequence = 0,
  fetchSequence = 0,
  myProjects = [],
  dailyMode = 'mine';
let reviewLanding = location.hash === '#registration-approvals';
import { csvText, wbsRows, completionRecords, completionRows } from './reports.js';
import {
  today,
  addDays,
  shiftWorkday,
  nextWorkday,
  validDate,
  progress,
  summary,
  validateProject,
} from './engine.js';
const $ = (s) => document.querySelector(s),
  uid = () => crypto.randomUUID(),
  TODAY = today();
let state = { version: 1, projects: [], activeId: null },
  storageError = '',
  view = normalizeView(location.hash.slice(1)),
  asOf = TODAY,
  ownerFilter = '',
  statusFilter = '',
  query = '',
  onlyPending = false,
  editor = null;
const project = () => state.projects.find((p) => p.id === state.activeId);
const wbs = new WbsView({
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
  $('#saveStatus').textContent = '서버 저장 중…';
  try {
    const result = await api('projects' + (p._revision ? '/' + p.id : ''), {
      method: p._revision ? 'PUT' : 'POST',
      body: { project: p, ...(p._revision ? { revision: p._revision } : {}) },
    });
    state.projects[state.projects.findIndex((x) => x.id === p.id)] = result.project;
    storageError = '';
    $('#saveStatus').textContent = '서버에 저장됨';
    $('#saveStatus').classList.remove('error');
    refreshMyWork();
    return true;
  } catch (error) {
    storageError = error.message;
    $('#saveStatus').textContent = '저장 실패 · 백업 필요';
    $('#saveStatus').classList.add('error');
    toast(error.message);
    if (error.status === 401) showAuth(error.message);
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
  document.body.dataset.appView = view;
  if (!state.projects.length) {
    $('#breadcrumbProject').textContent = '프로젝트 시작하기';
    $('#projectSelect').innerHTML = '';
    $('#projectList').innerHTML = '';
    $('#taskNavCount').textContent = '';
    $('#main').innerHTML =
      view === 'daily'
        ? myWorkView({ projects: myProjects, esc, progress, today: TODAY, projectMode: '' })
        : pageHead(
            'PROJECT WORKSPACE',
            '팀의 프로젝트를 시작하세요',
            '프로젝트를 만들고 팀원과 함께 업무를 관리하세요.',
            btn('새 프로젝트', 'project', 'primary'),
          ) +
          empty(
            '아직 접근할 수 있는 프로젝트가 없습니다',
            '새 프로젝트를 만들거나 소유자에게 공유 권한을 요청하세요.',
            'project',
            '새 프로젝트',
          );
    updateAccessUi();
    hydrateIcons();
    return;
  }
  if (!['overview', 'tasks', 'daily', 'people'].includes(view)) view = 'overview';
  const p = project(),
    s = summary(p, asOf);
  $('#breadcrumbProject').textContent =
    view === 'daily' && dailyMode === 'mine' ? '전체 프로젝트 · 내 업무' : p.name;
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
        (x.demo ? '<small>예시</small>' : '') +
        '</button>',
    )
    .join('');
  const notices =
    (storageError
      ? '<div class="notice error-notice" role="alert">' +
        esc(storageError) +
        ' ' +
        btn('다시 저장', 'retry-save', 'small') +
        ' ' +
        btn('서버 다시 읽기', 'reload-server', 'small') +
        '</div>'
      : '') +
    (p.demo
      ? '<div class="demo-notice"><span><span class="demo-pill">SAMPLE</span> 예시 데이터로 먼저 둘러보세요. 실제 업무는 새 프로젝트에서 시작할 수 있어요.</span>' +
        btn('새 프로젝트 만들기 ↗', 'project', 'link') +
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
function method() {
  openInfo(
    '진척률과 예상 완료일 계산',
    '<h3>진척률은 작업량으로 가중합니다</h3><p>전체 진척률 = 완료한 세부 작업의 예상 시간 합계 ÷ 전체 예상 시간 합계입니다. 2시간 작업과 20시간 작업은 다른 비중을 갖습니다. 체크 전에는 미완료, 체크 후에는 해당 작업량이 전부 반영됩니다.</p><h3>계획과 실제를 같은 기준일로 비교합니다</h3><p>보고 기준일은 그날의 업무 종료 시점입니다. 계획 진척률은 각 업무의 예상 공수를 계획 근무일에 균등 배분한 값입니다. 과거 기준일 조회 시 그날까지 완료된 체크만 반영합니다.</p><h3>완료 기록이 적을 때</h3><p>업무별 계획 속도(예상 공수 ÷ 계획 근무일)를 사용합니다. 남은 작업은 기준일 다음 근무일부터 배정합니다. 하루 근무시간 × 투입률을 넘지 않으며, 같은 담당자의 업무는 계획 시작일·선행 관계 순으로 가용시간을 나눠 씁니다.</p><h3>완료 기록이 쌓이면</h3><p>최근 최대 10근무일 동안 계획 대비 완료 작업량의 비율을 구해 계획 속도를 보정합니다. 최소 3근무일이 지나고, 서로 다른 2일 이상에 완료 기록이 있어야 적용합니다. 기록이 부족하면 계획 기준으로 표시합니다. 완료한 항목의 예상 공수를 사용하므로 실제 투입시간을 측정한 값은 아닙니다.</p><h3>일정 계산의 범위</h3><p>월–금 근무와 프로젝트에 등록한 휴무일을 반영합니다. 선행 업무가 끝난 다음 근무일에 후속 업무를 시작하는 관계(FS)를 지원합니다. 등급별 생산성 차이는 가정하지 않습니다. 담당자가 없거나 계산 범위를 넘으면 날짜 대신 계산 대기를 표시합니다.</p><h3>예상일은 현재 정보에 따른 추정입니다</h3><p>작업 난이도, 검토 대기, 외부 의존성 등 입력되지 않은 요인은 반영되지 않습니다. 일정 비교는 기준일 이후의 남은 업무를 재배치한 결과이며, 최적 자원 배치나 확정 납기일이 아닙니다.</p>',
  );
}
function help() {
  openInfo(
    '세 단계면 시작할 수 있어요',
    '<div class="help-step"><b>01</b><div><h3>참여인력 등록</h3><p>이름, 역할, 등급과 이 프로젝트에 투입할 비율을 입력합니다.</p></div></div><div class="help-step"><b>02</b><div><h3>업무와 세부 작업 등록</h3><p>예상 시작·종료일과 담당자를 정하고, 하루 단위로 완료 여부를 확인할 수 있게 작은 작업으로 나눕니다. 세부 작업마다 예상 시간을 입력합니다.</p></div></div><div class="help-step"><b>03</b><div><h3>매일 완료 체크</h3><p>매일 작업 체크에서 담당자를 선택하고 완료한 작업을 체크합니다. 대시보드에서 진척률과 예상 완료일을 확인합니다.</p></div></div><div class="notice">이 버전은 서버의 PostgreSQL에 저장됩니다. 소유자가 프로젝트 공유에서 편집자·조회자를 추가할 수 있습니다. 화면은 15초마다 갱신되며, 동시 수정은 충돌을 표시합니다. JSON 백업·불러오기를 지원합니다.</div>',
  );
}
function itemEditor(i = { id: uid(), title: '', hours: 4, doneDate: null }) {
  return (
    '<div class="item-editor" data-item-id="' +
    esc(i.id) +
    '" data-done-date="' +
    esc(i.doneDate || '') +
    '"><input name="itemTitle" value="' +
    esc(i.title) +
    '" placeholder="예: 로그인 API 구현" aria-label="세부 작업 이름" maxlength="300" required><input name="itemHours" value="' +
    i.hours +
    '" type="number" min=".1" max="10000" step=".1" aria-label="세부 작업 예상 시간" required><span>h</span><button type="button" class="icon-button remove-item" aria-label="세부 작업 삭제">×</button></div>'
  );
}
function openEditor(type, id = '') {
  if (wbs.dirty) {
    toast('WBS 변경사항을 먼저 저장하거나 취소해 주세요.');
    return;
  }
  if (type === 'project' && storageError) {
    toast('현재 변경사항을 먼저 백업하거나 저장해 주세요.');
    return;
  }
  if (type !== 'project' && project()?._role === 'viewer') {
    toast('조회자는 프로젝트를 수정할 수 없습니다.');
    return;
  }
  editor = { type, id };
  $('#formError').textContent = '';
  $('#deleteButton').hidden = type === 'settings' ? project()?._role !== 'owner' : !id;
  $('#deleteButton').textContent = type === 'settings' ? '프로젝트 삭제' : '삭제';
  $('#submitButton').textContent = type === 'project' ? '프로젝트 만들기' : '저장하기';
  const p = project();
  let body = '';
  if (type === 'project' || type === 'settings') {
    $('#dialogTitle').textContent = type === 'project' ? '새 프로젝트' : '프로젝트 설정';
    body =
      field(
        '프로젝트명',
        'name',
        type === 'project' ? '' : p.name,
        'text',
        'required maxlength="120" placeholder="예: 고객 포털 리뉴얼"',
      ) +
      '<label class="field">프로젝트 설명<textarea name="description" rows="2" maxlength="300">' +
      esc(type === 'project' ? '' : p.description) +
      '</textarea></label><label class="field">추가 휴무일 <span class="optional">선택</span><textarea name="holidays" rows="3" placeholder="2026-12-25&#10;2027-01-01">' +
      (type === 'project' ? '' : esc((p.holidays || []).join('\n'))) +
      '</textarea><small>월–금 근무 기준입니다. 공휴일·팀 휴무일을 한 줄에 하나씩 입력하세요.</small></label>';
  } else if (type === 'member') {
    const member = memberEditor(p, id);
    $('#dialogTitle').textContent = member.title;
    body = member.body;
  } else {
    const t = p.tasks.find((x) => x.id === id) || {
      name: '',
      owner: p.members[0]?.id || '',
      start: nextWorkday(TODAY, p.holidays),
      end: shiftWorkday(nextWorkday(TODAY, p.holidays), 4, p.holidays),
      phase: '개발',
      predecessor: '',
      items: [{ id: uid(), title: '', hours: 4, doneDate: null }],
      memo: '',
    };
    $('#dialogTitle').textContent = id ? '업무 수정' : '새 업무 추가';
    body =
      field(
        '업무명',
        'name',
        t.name,
        'text',
        'required maxlength="200" placeholder="예: 회원 관리 기능 개발"',
      ) +
      '<div class="form-grid"><label class="field">담당자<select name="owner"><option value="">미지정</option>' +
      p.members
        .map(
          (m) =>
            '<option value="' +
            esc(m.id) +
            '" ' +
            (m.id === t.owner ? 'selected' : '') +
            '>' +
            esc(m.name) +
            ' · ' +
            esc(m.grade) +
            '</option>',
        )
        .join('') +
      '</select></label>' +
      field('단계 / 분류', 'phase', t.phase, 'text', 'maxlength="50" list="phases"') +
      '</div><datalist id="phases"><option>기획</option><option>설계</option><option>디자인</option><option>개발</option><option>QA</option><option>오픈</option></datalist><div class="form-grid">' +
      field('예상 시작일', 'start', t.start, 'date', 'required') +
      field('예상 종료일', 'end', t.end, 'date', 'required') +
      '</div><label class="field">선행 업무 <span class="optional">선택</span><select name="predecessor"><option value="">없음</option>' +
      p.tasks
        .filter((x) => x.id !== id)
        .map(
          (x) =>
            '<option value="' +
            esc(x.id) +
            '" ' +
            (x.id === t.predecessor ? 'selected' : '') +
            '>' +
            esc(x.name) +
            '</option>',
        )
        .join('') +
      '</select><small>선행 업무가 끝난 다음 근무일에 시작합니다.</small></label><div class="items-title"><strong>세부 작업 체크리스트</strong><span>예상 공수 (h)</span></div><div id="itemEditors">' +
      t.items.map(itemEditor).join('') +
      '</div><button type="button" id="addItem" class="button ghost add-item">＋ 세부 작업 추가</button><label class="field">메모 <span class="optional">선택</span><textarea name="memo" rows="2" maxlength="2000">' +
      esc(t.memo || '') +
      '</textarea></label><p class="form-hint">작업을 실제로 완료했을 때 체크합니다. 세부 작업의 예상 시간이 진척률의 가중치가 됩니다.</p>';
  }
  $('#dialogBody').innerHTML = body;
  $('#editorDialog').showModal();
  setTimeout(() => $('#dialogBody input')?.focus(), 50);
}
$('#editorForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target),
    p = project(),
    value = (n) => String(f.get(n) || '').trim();
  let target = structuredClone(p),
    message = '저장했습니다.';
  try {
    if (editor.type === 'project' || editor.type === 'settings') {
      const holidays = [
        ...new Set(
          value('holidays')
            .split(/[\s,]+/)
            .filter(Boolean),
        ),
      ];
      if (holidays.some((d) => !validDate(d)))
        throw Error('휴무일을 YYYY-MM-DD 형식으로 입력해 주세요.');
      if (editor.type === 'project') {
        target = {
          id: uid(),
          name: value('name'),
          description: value('description'),
          demo: false,
          createdAt: TODAY,
          holidays,
          members: [],
          tasks: [],
        };
        validateProject(target);
        state.projects.push(target);
        state.activeId = target.id;
        view = 'people';
        location.hash = 'people';
        message = '새 프로젝트를 만들었습니다. 참여인력부터 추가해 보세요.';
      } else {
        target.name = value('name');
        target.description = value('description');
        target.holidays = holidays;
        validateProject(target);
        state.projects[state.projects.findIndex((x) => x.id === p.id)] = target;
      }
    } else if (editor.type === 'member') {
      updateMember(target, editor.id, f, uid);
      state.projects[state.projects.findIndex((x) => x.id === p.id)] = target;
    } else {
      const items = [...document.querySelectorAll('.item-editor')].map((row) => ({
        id: row.dataset.itemId,
        title: row.querySelector('[name=itemTitle]').value.trim(),
        hours: Number(row.querySelector('[name=itemHours]').value),
        doneDate: row.dataset.doneDate || null,
      }));
      if (!items.length) throw Error('체크할 세부 작업을 한 개 이상 추가해 주세요.');
      const t = {
        ...(editor.id ? target.tasks.find((t) => t.id === editor.id) : {}),
        id: editor.id || uid(),
        name: value('name'),
        owner: value('owner'),
        phase: value('phase'),
        start: value('start'),
        end: value('end'),
        predecessor: value('predecessor'),
        items,
        memo: value('memo'),
      };
      if (editor.id) target.tasks[target.tasks.findIndex((x) => x.id === editor.id)] = t;
      else target.tasks.push(t);
      validateProject(target);
      state.projects[state.projects.findIndex((x) => x.id === p.id)] = target;
    }
    const saved = await persist();
    $('#editorDialog').close();
    render();
    toast(saved ? message : '변경했지만 서버 저장에 실패했습니다. 백업을 내려받으세요.');
  } catch (error) {
    $('#formError').textContent = error.message;
  }
});
$('#deleteButton').addEventListener('click', async () => {
  if (editor.type === 'settings') {
    const p = project();
    if (!opsCanChange()) return;
    if (!confirm('프로젝트를 휴지통으로 이동할까요? 30일 동안 소유자가 복구할 수 있습니다.'))
      return;
    try {
      await api('projects/' + p.id, { method: 'DELETE', body: { revision: p._revision } });
      $('#editorDialog').close();
      await loadProjects({ force: true });
      toast('휴지통으로 이동했습니다. 파일 메뉴에서 복구할 수 있습니다.');
    } catch (error) {
      $('#formError').textContent = error.message;
    }
    return;
  }
  const p = project();
  if (editor.type === 'member' && p.tasks.some((t) => t.owner === editor.id)) {
    $('#formError').textContent = '담당 업무가 있는 인력입니다. 먼저 업무 담당자를 변경해 주세요.';
    return;
  }
  if (editor.type === 'task' && p.tasks.some((t) => t.predecessor === editor.id)) {
    $('#formError').textContent =
      '후속 업무가 연결되어 있습니다. 먼저 선행 업무 연결을 해제해 주세요.';
    return;
  }
  if (editor.type === 'task' && p.tasks.some((t) => t.parentId === editor.id)) {
    $('#formError').textContent =
      '하위 업무가 있습니다. 먼저 WBS에서 내어쓰기하거나 하위 업무를 정리해 주세요.';
    return;
  }
  if (
    !confirm(
      editor.type === 'task'
        ? '업무를 휴지통으로 이동할까요? 완료 기록을 포함해 30일 동안 복구할 수 있습니다.'
        : '이 참여인력을 삭제할까요?',
    )
  )
    return;
  if (editor.type === 'member') p.members = p.members.filter((m) => m.id !== editor.id);
  else p.tasks = p.tasks.filter((t) => t.id !== editor.id);
  const saved = await persist();
  $('#editorDialog').close();
  render();
  toast(saved ? '삭제했습니다.' : '서버에 저장하지 못했습니다. 현재 내용을 백업해 주세요.');
});
$('#dialogBody').addEventListener('click', (e) => {
  if (e.target.closest('#addItem')) {
    $('#itemEditors').insertAdjacentHTML('beforeend', itemEditor());
    $('#itemEditors').lastElementChild.querySelector('input').focus();
  }
  if (e.target.closest('.remove-item')) {
    const row = e.target.closest('.item-editor');
    if (row.dataset.doneDate && !confirm('완료 기록이 있는 세부 작업을 삭제할까요?')) return;
    row.remove();
  }
});
function normalizeView(value) {
  return ['overview', 'tasks', 'daily', 'people'].includes(value) ? value : 'overview';
}
function navigate(v) {
  v = normalizeView(v);
  if (wbs.dirty && v !== 'tasks') {
    toast('WBS 변경사항을 먼저 저장하거나 취소해 주세요.');
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
    ops.admin().catch((e) => toast(e.message));
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
      toast('현재 변경사항을 먼저 저장하거나 백업한 뒤 취소해 주세요.');
      return;
    }
    state.activeId = sw.dataset.project;
    ownerFilter = '';
    statusFilter = '';
    query = '';
    render();
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
  } else if (a === 'method') method();
  else if (a === 'export-excel') exportExcel();
  else if (a === 'export-wbs') exportWbs();
  else if (a === 'history') openHistory();
  else if (a === 'export-history') exportHistory();
  else if (a === 'retry-save')
    persist().then((saved) => {
      render();
      if (saved) toast('서버에 저장했습니다.');
    });
  else if (a === 'reload-server') reloadServer();
  else if (a === 'sharing') openSharing();
  else if (a === 'audit') openAudit();
  else if (a === 'connections') openConnections();
  else if (a === 'mail-settings') openMailSettings();
  else if (a === 'security-audit') openSecurityAudit();
  else if (a === 'logout') {
    if (saveInFlight) {
      toast('저장 완료 후 로그아웃해 주세요.');
      return;
    }
    if (
      (storageError || wbs.dirty) &&
      !confirm('미저장 변경사항과 보관 초안을 삭제하고 로그아웃할까요?')
    )
      return;
    api('auth/logout', { method: 'POST', body: {} })
      .then(() => {
        DraftStore.clearUser(currentUser.id);
        clearTimeout(wbs.draftTimer);
        wbs.draft = null;
        wbs.pending.clear();
        location.reload();
      })
      .catch((e) => toast(e.message));
  } else openEditor(a);
});
$('#main').addEventListener('change', async (e) => {
  const el = e.target;
  if (el.id === 'reportDate') {
    if (!validDate(el.value) || el.value > TODAY) {
      toast('오늘까지의 날짜만 조회할 수 있어요.');
      el.value = asOf;
      return;
    }
    asOf = el.value;
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
  if (el.dataset.checkItem)
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
  if (location.hash === '#registration-approvals') {
    reviewLanding = true;
    if (currentUser) showApprovalInbox().catch((error) => toast(error.message));
    else showAuth();
    return;
  }
  if (auth.handleHash()) return;
  const next = normalizeView(location.hash.slice(1));
  if (next === view) return;
  if (wbs.dirty && next !== 'tasks') {
    history.replaceState(null, '', '#tasks');
    toast('WBS 변경사항을 먼저 저장하거나 취소해 주세요.');
    return;
  }
  view = next;
  render();
});
$('#projectSelect').onchange = (e) => {
  if (storageError || wbs.dirty) {
    toast('WBS 변경사항을 먼저 저장하거나 취소해 주세요.');
    render();
    return;
  }
  state.activeId = e.target.value;
  ownerFilter = '';
  statusFilter = '';
  query = '';
  render();
};
$('#mobileNewProject').onclick = () => openEditor('project');
$('#closeDialog').onclick = $('#cancelDialog').onclick = () => $('#editorDialog').close();
$('#closeInfo').onclick = () => info.close();
$('#helpButton').onclick = help;
$('#methodFooter').onclick = method;
$('#newProjectSide').onclick = () => openEditor('project');
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
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('프로젝트 백업을 내려받았습니다.');
};
$('#importButton').onclick = () => {
  if (storageError || wbs.dirty) {
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
    if (data.format !== 'pm-canvas-project' || data.version !== 1)
      throw Error('PM Canvas 프로젝트 백업 파일이 아닙니다.');
    const p = validateProject(data.project);
    delete p._revision;
    delete p._role;
    p.id = uid();
    p.name = p.name + ' (불러옴)';
    if (p.name.length > 120) p.name = p.name.slice(0, 120);
    state.projects.push(p);
    state.activeId = p.id;
    ownerFilter = '';
    statusFilter = '';
    query = '';
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
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('CSV를 내려받았습니다. Excel에서 열 수 있어요.');
}
function exportWbs() {
  const p = view === 'tasks' ? wbs.snapshot() : project(),
    tasks = view === 'tasks' ? wbs.visible({ includeCollapsed: true }) : filterDailyTasks(p);
  if (!tasks.length) {
    toast('출력할 업무가 없습니다. 검색 조건을 확인해 주세요.');
    return;
  }
  downloadReport(wbsRows(p, asOf, summary(p, asOf).forecast, tasks), 'WBS-' + asOf);
}
function openHistory() {
  historyQuery = { from: addDays(asOf, -13), to: asOf, owner: ownerFilter };
  openInfo('일자별 완료 내역', '');
  $('#infoDialog').classList.add('report-dialog');
  renderHistory();
}
function renderHistory() {
  const p = project(),
    rows = completionRecords(p, historyQuery),
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
    if (next.to > asOf) throw Error('보고 기준일 이후의 날짜는 조회할 수 없습니다.');
    completionRecords(project(), next);
    historyQuery = next;
    renderHistory();
  } catch (error) {
    toast(error.message);
    renderHistory();
  }
});

function setBusy(value) {
  saveInFlight = value;
  document.querySelector('.workspace').inert = value;
  document.querySelector('.sidebar').inert = value;
  $('#editorDialog').inert = value;
}
function updateAccessUi() {
  const p = project(),
    readOnly = p?._role === 'viewer';
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
      (currentUser?.name || '계정') +
      (account.dataset.pending ? ' · 승인 ' + account.dataset.pending : '');
  $('#saveStatus').textContent = saveInFlight
    ? '서버 저장 중…'
    : storageError
      ? '저장 실패 · 백업 필요'
      : wbs.dirty
        ? 'WBS 미저장 변경사항'
        : readOnly
          ? '조회 권한 · 서버 저장'
          : '서버에 저장됨';
  $('#saveStatus').classList.toggle('error', !!storageError);
  document.querySelector('.side-bottom small').textContent = readOnly
    ? '조회자 · 공동 프로젝트'
    : '팀과 함께하는 프로젝트';
}
function showAuth(message = '') {
  auth.show(message);
}
async function loadProjects({ force = false } = {}) {
  if (wbs.dirty || wbs.interacting) return false;
  const checkpoint = mutationSequence,
    request = ++fetchSequence;
  const [data, mine] = await Promise.all([api('projects'), api('my-work')]);
  if (
    wbs.dirty ||
    wbs.interacting ||
    request !== fetchSequence ||
    checkpoint !== mutationSequence ||
    (!force && (saveInFlight || storageError || $('#editorDialog').open))
  )
    return false;
  const previous = state.activeId;
  state = {
    version: 1,
    projects: data.projects,
    activeId: data.projects.some((p) => p.id === previous)
      ? previous
      : data.projects[0]?.id || null,
  };
  myProjects = mine.projects;
  storageError = '';
  render();
  ops.summary();
  return true;
}
async function boot() {
  try {
    const session = await api('auth/me');
    if (currentUser?.id !== session.user.id) {
      wbs.persistDraft();
      wbs.draft = null;
      wbs.base = null;
      wbs.pending.clear();
      wbs.recovery = null;
    }
    currentUser = session.user;
    await loadProjects();
    $('#authGate').hidden = true;
    await showApprovalInbox();
  } catch (error) {
    if (error.status === 401) showAuth($('#authError').textContent);
    else showAuth(error.message);
  }
}
async function reloadServer() {
  if (
    storageError &&
    !confirm(
      '현재 변경사항을 버리고 서버에서 다시 읽을까요? 필요한 내용은 먼저 JSON으로 백업하세요.',
    )
  )
    return;
  try {
    const loaded = await loadProjects({ force: true });
    if (loaded) toast('서버의 최신 내용을 읽었습니다.');
  } catch (error) {
    toast(error.message);
    if (error.status === 401) showAuth(error.message);
  }
}
async function openAccount() {
  if (!currentUser) return showAuth();
  openInfo(
    '계정 관리',
    '<p><strong>' +
      esc(currentUser.name) +
      '</strong><br>' +
      esc(currentUser.email) +
      '</p><button class="button" data-action="logout">로그아웃</button><section class="account-section"><label><input type="checkbox" id="draftPersist" ' +
      (DraftStore.persistent(currentUser.id) ? 'checked' : '') +
      '>브라우저를 닫은 후에도 초안 보관 (최대 8시간)</label><p>기본값은 현재 탭에서만 보관입니다. 보관 초안은 암호화되지 않으며 로그아웃 시 삭제됩니다.</p></section>' +
      (currentUser.isAdmin
        ? '<div class="admin-account-actions"><button class="button primary" data-action="admin">관리자 설정</button></div><p>관리자 인증 앱 MFA가 적용됩니다. 복구 코드는 한 번만 사용할 수 있습니다.</p>'
        : '') +
      (currentUser.localLogin === false
        ? '<section class="account-section"><p>외부 인증 계정입니다. 비밀번호는 회사 인증 서버에서 변경해 주세요.</p></section>'
        : '<section class="account-section"><details><summary>내 비밀번호 변경</summary><p class="subtle">변경하면 모든 기기에서 로그아웃됩니다.</p><form id="changePasswordForm" class="server-form">' +
          field(
            '현재 비밀번호',
            'currentPassword',
            '',
            'password',
            'required maxlength="256" autocomplete="current-password"',
          ) +
          field(
            '새 비밀번호',
            'newPassword',
            '',
            'password',
            'required minlength="12" maxlength="256" autocomplete="new-password"',
          ) +
          field(
            '새 비밀번호 확인',
            'confirmPassword',
            '',
            'password',
            'required minlength="12" maxlength="256" autocomplete="new-password"',
          ) +
          '<button class="button primary">비밀번호 변경</button><p class="account-result" role="status"></p></form></details></section>'),
  );
}
let knownUsers = [];
async function refreshUsers({ cached = false } = {}) {
  const list = $('#userList');
  if (!list) return;
  try {
    const { users } = cached ? { users: knownUsers } : await api('users');
    if (!list.isConnected) return;
    knownUsers = users;
    users.sort((a, b) => Number(b.registrationPending) - Number(a.registrationPending));
    list.innerHTML = accountRows(ops.filterUsers(users), field);
  } catch (error) {
    if (list.isConnected) list.textContent = error.message;
  }
}

async function openSharing() {
  const p = project();
  if (!p || p._role !== 'owner') {
    toast('소유자만 접근 권한을 관리할 수 있습니다.');
    return;
  }
  openInfo('프로젝트 공유', '<p>불러오는 중…</p>');
  try {
    const { access } = await api('projects/' + p.id + '/access');
    $('#infoBody').innerHTML =
      '<p class="subtle">참여인력 정보와 로그인 계정은 별도로 관리합니다. 등록된 계정의 이메일로 접근 권한을 부여하세요.</p>' +
      '<div class="sharing-list">' +
      access
        .map(
          (a) =>
            '<div class="sharing-row"><span><strong>' +
            esc(a.name) +
            '</strong><small>' +
            esc(a.email) +
            ' · ' +
            { owner: '소유자', editor: '편집자', viewer: '조회자' }[a.role] +
            '</small></span>' +
            (a.role === 'owner'
              ? ''
              : '<button class="button small" data-revoke-user="' +
                esc(a.id) +
                '">접근 해제</button>') +
            '</div>',
        )
        .join('') +
      '</div>' +
      '<form id="shareForm" class="server-form">' +
      field('사용자 이메일', 'email', '', 'email', 'required') +
      '<label class="field">권한<select name="role"><option value="editor">편집자 · 업무와 완료 체크 수정</option><option value="viewer">조회자 · 조회와 출력</option></select></label><button class="button primary">공유 권한 저장</button><p id="shareResult" role="status"></p></form>' +
      (await ops.mappings(p, access));
  } catch (error) {
    $('#infoBody').textContent = error.message;
  }
}
async function openConnections() {
  if (!currentUser?.isAdmin) return;
  openInfo('SSO 연결과 계정 매핑', '<p>불러오는 중…</p>');
  try {
    const { providers, identities } = await api('auth/connections');
    $('#infoBody').innerHTML =
      '<p>인증 연결은 서버의 AUTH_CONFIG_FILE 컨피그에서 설정합니다. 변경 후 앱을 재시작하세요.</p>' +
      (providers.length
        ? providers
            .map(
              (p) =>
                '<article class="connection-card"><strong>' +
                esc(p.label) +
                ' · ' +
                esc(p.type.toUpperCase()) +
                '</strong><p class="subtle">자동 계정 생성 ' +
                (p.autoProvision ? '사용' : '사용 안 함') +
                ' · 허용 도메인 ' +
                esc(p.allowedDomains.join(', ') || '개별 계정 매핑') +
                '</p>' +
                (p.callbackUrl
                  ? '<p>콜백 주소<br><code>' + esc(p.callbackUrl) + '</code></p>'
                  : '') +
                (p.metadataUrl
                  ? '<a class="button small" href="' +
                    esc(p.metadataUrl) +
                    '" target="_blank" rel="noopener">SAML SP 메타데이터</a>'
                  : '') +
                '</article>',
            )
            .join('')
        : '<div class="notice">등록된 인증 연결이 없습니다. 컨피그에 연결을 추가하면 이곳과 로그인 화면에 표시됩니다.</div>') +
      '<h3>연결된 외부 계정</h3>' +
      identities
        .map((i) => {
          const p = providers.find((p) => p.key === i.providerKey);
          return (
            '<article class="connection-card"><strong>' +
            esc(i.name) +
            ' · ' +
            esc(i.email) +
            '</strong><p>' +
            esc(p?.label || '이전 설정의 연결') +
            '</p><code>' +
            esc(i.subject) +
            '</code>' +
            (p
              ? '<div class="identity-actions"><button class="button small" data-unlink-provider="' +
                esc(p.id) +
                '" data-unlink-subject="' +
                esc(i.subject) +
                '">연결 해제</button></div>'
              : '') +
            '</article>'
          );
        })
        .join('') +
      (providers.length
        ? '<form id="linkIdentityForm" class="server-form"><h3>기존 계정에 외부 ID 연결</h3><p class="subtle">이메일만 일치한다고 자동 연결하지 않습니다. 인증 서버에서 확인한 불변 고유 ID를 입력하세요. OIDC는 sub, SAML은 영구 NameID, AD는 objectGUID의 base64:값입니다. 비상 복구용 관리자 계정에는 연결할 수 없습니다.</p><label class="field">인증 연결<select name="provider">' +
          providers
            .map((p) => '<option value="' + esc(p.id) + '">' + esc(p.label) + '</option>')
            .join('') +
          '</select></label>' +
          field('기존 사용자 이메일', 'email', '', 'email', 'required') +
          field(
            '외부 고유 ID',
            'subject',
            '',
            'text',
            'required maxlength="1024" autocomplete="off"',
          ) +
          '<button class="button primary">외부 계정 연결</button><p class="account-result" role="status"></p></form>'
        : '');
  } catch (error) {
    $('#infoBody').textContent = error.message;
  }
  ops.securityNav();
}
async function openAudit() {
  const p = project();
  if (!p) return;
  openInfo('프로젝트 변경 이력', '<p>불러오는 중…</p>');
  $('#infoDialog').classList.add('report-dialog');
  try {
    const { events } = await api('projects/' + p.id + '/events');
    const labels = { project: '프로젝트', member: '참여인력', task: '업무', item: '세부 작업' },
      actions = { create: '추가', update: '수정', delete: '삭제' };
    $('#infoBody').innerHTML =
      '<p class="subtle">최근 100건의 서버 저장 이력입니다. 완료 체크 취소·삭제 전 내용도 보관합니다.</p>' +
      (events.length
        ? events
            .map(
              (event) =>
                '<article class="audit-entry"><strong>' +
                esc(event.actor) +
                ' · ' +
                esc(new Date(event.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })) +
                '</strong><small>버전 ' +
                event.revision +
                ' · ' +
                esc(
                  {
                    'project.created': '프로젝트 생성',
                    'project.updated': '프로젝트 수정',
                    'access.granted': '접근 권한 부여',
                    'access.revoked': '접근 권한 해제',
                  }[event.type] || '변경',
                ) +
                '</small><ul>' +
                event.changes
                  .slice(0, 10)
                  .map(
                    (c) =>
                      '<li>' +
                      esc(labels[c.entity] || '접근 권한') +
                      ' ' +
                      esc(actions[c.action] || '변경') +
                      ' · ' +
                      esc(
                        c.after?.title ||
                          c.before?.title ||
                          c.after?.name ||
                          c.before?.name ||
                          c.email ||
                          c.userId ||
                          '',
                      ) +
                      (c.entity === 'item' && c.before?.doneDate !== c.after?.doneDate
                        ? ' <span class="muted">완료일 ' +
                          esc(c.before?.doneDate || '미완료') +
                          ' → ' +
                          esc(c.after?.doneDate || '미완료') +
                          '</span>'
                        : '') +
                      '</li>',
                  )
                  .join('') +
                '</ul>' +
                (event.changes.length > 10
                  ? '<p class="subtle">외 ' + (event.changes.length - 10) + '개 변경</p>'
                  : '') +
                '</article>',
            )
            .join('')
        : '<div class="calm-state">저장 이력이 없습니다.</div>');
  } catch (error) {
    $('#infoBody').textContent = error.message;
  }
}
$('#accountButton').addEventListener('click', openAccount);
$('#infoBody').addEventListener('submit', async (e) => {
  if (
    !['createUserForm', 'shareForm', 'changePasswordForm', 'linkIdentityForm'].includes(
      e.target.id,
    ) &&
    !e.target.dataset.resetUser
  )
    return;
  e.preventDefault();
  const form = e.target,
    data = new FormData(form),
    button = form.querySelector('button');
  button.disabled = true;
  try {
    if (form.id === 'linkIdentityForm') {
      await api('auth/connections', {
        method: 'POST',
        body: {
          provider: data.get('provider'),
          email: data.get('email'),
          subject: data.get('subject'),
        },
      });
      await openConnections();
      toast('외부 계정을 연결했습니다.');
    } else if (form.id === 'createUserForm') {
      await api('users', {
        method: 'POST',
        body: { name: data.get('name'), email: data.get('email'), password: data.get('password') },
      });
      form.reset();
      form.querySelector('.account-result').textContent =
        '계정을 만들었습니다. 프로젝트 공유에서 추가할 수 있습니다.';
      await refreshUsers();
    } else if (form.id === 'changePasswordForm') {
      if (saveInFlight || storageError || wbs.dirty)
        throw Error('현재 변경사항을 먼저 저장하거나 백업한 뒤 진행해 주세요.');
      if (data.get('newPassword') !== data.get('confirmPassword'))
        throw Error('새 비밀번호 확인이 일치하지 않습니다.');
      await api('auth/password', {
        method: 'POST',
        body: {
          currentPassword: data.get('currentPassword'),
          newPassword: data.get('newPassword'),
        },
      });
      form.reset();
      $('#infoDialog').close();
      showAuth('비밀번호를 변경했습니다. 새 비밀번호로 로그인해 주세요.');
    } else if (form.dataset.resetUser) {
      if (!confirm('이 사용자의 비밀번호를 재설정하고 모든 기기에서 로그아웃할까요?')) return;
      await api('users/' + form.dataset.resetUser, {
        method: 'PATCH',
        body: { password: data.get('password') },
      });
      form.reset();
      form.querySelector('.account-result').textContent =
        '비밀번호를 재설정했습니다. 사용자에게 새 비밀번호를 전달해 주세요.';
    } else {
      await api('projects/' + project().id + '/access', {
        method: 'POST',
        body: { email: data.get('email'), role: data.get('role') },
      });
      await openSharing();
      toast('프로젝트 접근 권한을 저장했습니다.');
    }
  } catch (error) {
    (form.querySelector('.account-result') || $('#shareResult')).textContent = error.message;
    if (error.status === 401) {
      $('#infoDialog').close();
      showAuth(error.message);
    }
  } finally {
    button.disabled = false;
  }
});
$('#infoBody').addEventListener('click', async (e) => {
  const unlink = e.target.closest('[data-unlink-provider]');
  if (unlink) {
    if (
      !confirm(
        '외부 계정 연결을 해제하고 이 사용자의 로그인 세션을 종료할까요? 자동 계정 생성을 사용하는 연결에서는 재로그인 시 새 계정 생성 정책이 적용됩니다.',
      )
    )
      return;
    unlink.disabled = true;
    try {
      await api('auth/connections', {
        method: 'DELETE',
        body: { provider: unlink.dataset.unlinkProvider, subject: unlink.dataset.unlinkSubject },
      });
      await openConnections();
    } catch (error) {
      toast(error.message);
      unlink.disabled = false;
    }
    return;
  }
  const reviewRetry = e.target.closest('[data-retry-review]');
  if (reviewRetry) {
    reviewRetry.disabled = true;
    try {
      await api('users/' + reviewRetry.dataset.retryReview + '/review-notice', {
        method: 'POST',
        body: {},
      });
      await refreshUsers();
      toast('관리자 승인 요청 메일 발송을 다시 요청했습니다.');
    } catch (error) {
      toast(error.message);
      reviewRetry.disabled = false;
    }
    return;
  }
  const retry = e.target.closest('[data-retry-notice]');
  if (retry) {
    retry.disabled = true;
    try {
      await api('users/' + retry.dataset.retryNotice + '/approval-notice', {
        method: 'POST',
        body: {},
      });
      await refreshUsers();
      toast('승인 안내 메일 발송을 다시 요청했습니다.');
    } catch (error) {
      toast(error.message);
      retry.disabled = false;
    }
    return;
  }
  const status = e.target.closest('[data-user-status]');
  if (status) {
    const isActive = status.dataset.nextActive === 'true';
    if (
      !confirm(
        status.dataset.registrationPending === 'true'
          ? '이메일과 소속을 확인한 계정의 가입을 승인할까요?'
          : isActive
            ? '이 계정을 다시 활성화할까요?'
            : '이 계정을 비활성화하고 모든 기기에서 로그아웃할까요? 프로젝트 데이터는 보존됩니다.',
      )
    )
      return;
    status.disabled = true;
    try {
      await api('users/' + status.dataset.userStatus, { method: 'PATCH', body: { isActive } });
      await refreshUsers();
      toast(
        status.dataset.registrationPending === 'true'
          ? '가입을 승인했습니다. 안내 메일을 발송합니다.'
          : isActive
            ? '계정을 활성화했습니다.'
            : '계정을 비활성화했습니다.',
      );
    } catch (error) {
      toast(error.message);
      status.disabled = false;
    }
    return;
  }
  const revoke = e.target.closest('[data-revoke-user]');
  if (!revoke) return;
  if (!confirm('이 사용자의 프로젝트 접근 권한을 해제할까요?')) return;
  revoke.disabled = true;
  try {
    await api('projects/' + project().id + '/access/' + revoke.dataset.revokeUser, {
      method: 'DELETE',
      body: {},
    });
    await openSharing();
  } catch (error) {
    toast(error.message);
    revoke.disabled = false;
  }
});
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
    $('#infoDialog').open ||
    !$('#authGate').hidden
  )
    return;
  try {
    await loadProjects();
  } catch (error) {
    if (error.status === 401) showAuth(error.message);
  }
}, 15000);

let exportingExcel = false;
async function exportExcel() {
  if (exportingExcel) return;
  try {
    if (view === 'tasks') wbs.commitAll();
    const p = view === 'tasks' ? wbs.snapshot() : project(),
      taskIds = (
        view === 'tasks' ? wbs.visible({ includeCollapsed: true }) : filterDailyTasks(p)
      ).map((t) => t.id),
      at = asOf;
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
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Excel 파일을 내려받았습니다.');
  } catch (e) {
    if (e.status === 401) showAuth();
    toast(e.message);
  } finally {
    exportingExcel = false;
  }
}

window.addEventListener('pagehide', () => wbs.persistDraft());

async function showApprovalInbox() {
  if (!reviewLanding || !currentUser) return;
  if (storageError || wbs.dirty || saveInFlight) {
    toast('현재 변경사항을 저장한 뒤 승인 요청 링크를 다시 열어 주세요.');
    return;
  }
  reviewLanding = false;
  if (location.hash === '#registration-approvals')
    history.replaceState(null, '', location.pathname + location.search);
  if (!currentUser.isAdmin) {
    toast('가입 승인 목록은 관리자만 확인할 수 있습니다.');
    return;
  }
  await ops.admin('pending');
}
$('#infoBody').addEventListener('change', (e) => {
  if (e.target.id === 'draftPersist')
    try {
      DraftStore.setPersistent(currentUser.id, e.target.checked);
      wbs.persistDraft();
    } catch {
      e.target.checked = !e.target.checked;
      toast('초안 보관 설정을 바꾸지 못했습니다. 저장 공간 설정을 확인해 주세요.');
    }
});
async function openSecurityAudit() {
  try {
    const { events } = await api('auth/security-events');
    openInfo(
      '인증·계정 관리 감사 로그',
      '<p>최근 200건 · 보관 기간 90일 · IP는 해시로 저장합니다. 비밀번호·MFA 키·인증 코드는 기록하지 않습니다.</p>' +
        events
          .map(
            (e) =>
              '<article class="audit-entry"><strong>' +
              esc(e.kind) +
              '</strong><small>' +
              esc(new Date(e.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })) +
              '</small><p>' +
              esc(e.details.code || e.details.change || '') +
              '</p></article>',
          )
          .join(''),
    );
  } catch (error) {
    toast(error.message);
  }
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
    toast('현재 변경사항을 먼저 저장하거나 취소해 주세요.');
    return false;
  }
  return true;
}
async function refreshMyWork() {
  try {
    const r = await api('my-work');
    myProjects = r.projects;
    if (view === 'daily' && dailyMode === 'mine') render();
  } catch {
    /* A successful project save is independent of this read. */
  }
}
const info = createInfoDialog({ toast });
const openMailSettings = createMailSettingsUi({
  api,
  field,
  openInfo,
  user: () => currentUser,
  onEnabled: (enabled) => {
    auth.setMailEnabled(enabled);
  },
  showAuth,
  registerGuard: info.registerGuard,
});
const ops = workspaceOperations({
  dialog: info,
  api,
  esc,
  field,
  openInfo,
  toast,
  user: () => currentUser,
  projects: () => state.projects,
  refreshUsers,
  openMail: openMailSettings,
  openConnections,
  openAudit: openSecurityAudit,
  canChange: opsCanChange,
  reload: async (id) => {
    await loadProjects({ force: true });
    if (id && state.projects.some((p) => p.id === id)) {
      state.activeId = id;
      render();
    }
  },
  openTask: (projectId, taskId) => {
    if (!opsCanChange()) return;
    state.activeId = projectId;
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
const trashButton = document.createElement('button');
trashButton.className = 'button ghost small';
trashButton.textContent = '휴지통';
trashButton.id = 'trashButton';
trashButton.onclick = () => {
  trashButton.closest('details').open = false;
  ops.trash();
};
document.querySelector('.top-file-menu .menu-popover').append(trashButton);

function filterDailyTasks(p) {
  return filteredTasks(p, { asOf, ownerFilter, statusFilter, query });
}
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
    }
    currentUser = nextUser;
  },
  refreshWorkspace: async () => {
    if (storageError || wbs.dirty) render();
    else await loadProjects();
  },
  openInfo,
  approvalPending: () => reviewLanding,
  onApproval: showApprovalInbox,
  toast,
});
auth.start(boot);
