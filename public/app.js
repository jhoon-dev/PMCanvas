import { DraftStore } from './draft-store.js';
import { api } from './api-client.js';
import { workspaceOperations, myWorkView } from './operations-ui.js';
import { WbsWorkspace } from './wbs-workspace.js';
let currentUser = null,
  saveInFlight = false,
  mutationSequence = 0,
  fetchSequence = 0,
  myProjects = [],
  dailyMode = 'mine';
const resetLanding = location.hash.startsWith('#reset-password'),
  verificationLanding = location.hash.startsWith('#verify-email');
let emailVerificationToken = location.hash.match(/^#verify-email=([A-Za-z0-9_-]{43})$/)?.[1] || '';
let passwordResetToken = location.hash.match(/^#reset-password=([A-Za-z0-9_-]{43})$/)?.[1] || '';
if (resetLanding || verificationLanding)
  history.replaceState(null, '', location.pathname + location.search);
let resetEmailEnabled = false,
  reviewLanding = location.hash === '#registration-approvals';
let loginProvider = '',
  registrationPolicy = { mode: 'disabled', domains: [] };
import { csvText, wbsRows, completionRecords, completionRows } from './reports.js';
import {
  today,
  addDays,
  daysBetween,
  workdays,
  working,
  shiftWorkday,
  nextWorkday,
  dateValue,
  validDate,
  taskHours,
  earned,
  progress,
  planned,
  summary,
  validateProject,
} from './engine.js';
const $ = (s) => document.querySelector(s),
  uid = () => crypto.randomUUID(),
  TODAY = today(),
  palette = ['#416be8', '#27a498', '#ae7ad8', '#df9a40', '#de718c', '#66849e'];
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const icons = {
  dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  layers: 'm12 3 9 5-9 5-9-5z M3 12l9 5 9-5 M3 16l9 5 9-5',
  check: 'M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  users:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  download: 'M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5',
  upload: 'M12 16V4 m-5 5 5-5 5 5 M4 16v5h16v-5',
  calendar: 'M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2',
  arrow: 'M7 17 17 7 M7 7h10v10',
  clock: 'M12 8v4l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
};
const icon = (s, cls = '') =>
  '<svg class="icon ' +
  cls +
  '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' +
  (icons[s] || icons.layers) +
  '"/></svg>';
const pct = (x) => Math.round(x * 100) + '%',
  num = (x) => Number(x.toFixed(1)).toLocaleString('ko-KR'),
  short = (d) => (d ? d.slice(5).replace('-', '.') : '—'),
  full = (d) => (d ? d.replaceAll('-', '. ') : '계산 대기');
const btn = (txt, action, cls = '') =>
  '<button class="button ' + cls + '" data-action="' + action + '">' + txt + '</button>';
let state = { version: 1, projects: [], activeId: null },
  storageError = '',
  view = normalizeView(location.hash.slice(1)),
  asOf = TODAY,
  ownerFilter = '',
  statusFilter = '',
  query = '',
  onlyPending = false,
  editor = null,
  chartTooltip = '';
const project = () => state.projects.find((p) => p.id === state.activeId),
  member = (id) => project().members.find((m) => m.id === id);
const wbs = new WbsWorkspace({
  getDraftStore: () => (currentUser ? new DraftStore(currentUser.id) : null),
  readExcel: async (file) => {
    const buffer = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (const b of buffer) binary += String.fromCharCode(b);
    return api('projects/' + project().id + '/import-excel', {
      method: 'POST',
      body: { file: btoa(binary) },
    });
  },
  toast,
  onStatus: updateAccessUi,
  onRender: render,
  onDetails: (id) => openEditor('task', id),
  onSave: async (draft) => {
    if (saveInFlight) throw Error('저장이 진행 중입니다.');
    mutationSequence++;
    setBusy(true);
    try {
      const { project: p } = await api('projects/' + draft.id, {
        method: 'PUT',
        body: { project: draft, revision: draft._revision },
      });
      state.projects[state.projects.findIndex((x) => x.id === p.id)] = p;
      storageError = '';
      refreshMyWork();
      return p;
    } catch (error) {
      if (error.status === 401) showAuth(error.message);
      throw error;
    } finally {
      setBusy(false);
    }
  },
  onReload: async (id) => {
    if (saveInFlight) throw Error('저장이 진행 중입니다.');
    mutationSequence++;
    setBusy(true);
    try {
      const { project: p } = await api('projects/' + id);
      state.projects[state.projects.findIndex((x) => x.id === id)] = p;
      storageError = '';
      return p;
    } finally {
      setBusy(false);
    }
  },
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
function avatar(m, size = '') {
  const idx = project().members.findIndex((x) => x.id === m?.id),
    c = palette[Math.max(0, idx) % palette.length];
  return (
    '<span class="avatar ' +
    size +
    '" style="--avatar:' +
    c +
    '">' +
    esc(m?.name.slice(-2) || '?') +
    '</span>'
  );
}
function person(id) {
  const m = member(id);
  return m
    ? '<span class="person">' + avatar(m, 'tiny') + esc(m.name) + '</span>'
    : '<span class="muted">미지정</span>';
}
function meter(value, cls = '') {
  return (
    '<div class="meter ' +
    cls +
    '"><i style="width:' +
    Math.min(100, Math.max(0, value * 100)) +
    '%"></i></div>'
  );
}
function badge(t) {
  const v = progress(t, asOf);
  if (v === 1) return '<span class="badge green">완료</span>';
  if (t.end < asOf) return '<span class="badge red">지연</span>';
  if (v > 0) return '<span class="badge blue">진행 중</span>';
  return '<span class="badge neutral">예정</span>';
}
function methodLabel(f) {
  return (
    {
      actual: '실제 완료',
      velocity: '최근 속도 반영',
      plan: '계획 기준 추정',
      unavailable: '계산 대기',
    }[f?.method] || '계산 대기'
  );
}
function pageHead(eyebrow, title, subtitle, buttons) {
  return (
    '<section class="page-head"><div><span class="eyebrow">' +
    eyebrow +
    '</span><h1>' +
    esc(title) +
    '</h1><p>' +
    esc(subtitle) +
    '</p></div><div class="head-actions">' +
    buttons +
    '</div></section>'
  );
}
function dateToolbar(extra = '') {
  return (
    '<div class="view-toolbar"><div class="date-control">' +
    icon('calendar') +
    '<label for="reportDate">보고 기준일</label><input id="reportDate" type="date" value="' +
    asOf +
    '" max="' +
    TODAY +
    '" aria-label="보고 기준일"><span class="date-tag">' +
    (asOf === TODAY ? '오늘' : '과거 조회') +
    '</span></div>' +
    extra +
    '</div>'
  );
}
function empty(title, body, action = 'task', label = '첫 업무 등록') {
  return (
    '<div class="empty-state">' +
    icon('layers') +
    '<h3>' +
    esc(title) +
    '</h3><p>' +
    esc(body) +
    '</p>' +
    btn('＋ ' + label, action, 'primary') +
    '</div>'
  );
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
  $('#breadcrumbProject').textContent = p.name;
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
      content = tasksView(p, s);
      break;
    case 'daily':
      content = dailyView(p, s);
      break;
    case 'people':
      content = peopleView(p, s);
      break;
    default:
      content = overview(p, s);
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
function overview(p, s) {
  const delta = s.planned - s.progress,
    forecast = s.forecast,
    late =
      s.end && forecast.end
        ? Math.max(0, workdays(addDays(s.end, 1), forecast.end, p.holidays))
        : 0;
  const completedToday = p.tasks.reduce(
      (n, t) => n + t.items.filter((i) => i.doneDate === asOf).length,
      0,
    ),
    pending = p.tasks.reduce(
      (n, t) => n + t.items.filter((i) => !i.doneDate && t.start <= asOf).length,
      0,
    ),
    eff = p.members.reduce((n, m) => n + m.allocation / 100, 0);
  return (
    pageHead(
      'PROJECT OVERVIEW',
      p.name,
      p.description || '팀의 오늘을 기록하고, 프로젝트의 내일을 확인하세요.',
      btn('＋ 업무 추가', 'quick-task', 'primary') +
        '<details class="action-menu"><summary class="button">프로젝트 관리</summary><div class="menu-popover">' +
        btn('변경 이력', 'audit') +
        (p._role === 'owner' ? btn('공유', 'sharing') : '') +
        btn('설정', 'settings') +
        '</div></details>',
    ) +
    dateToolbar(
      '<span class="period-label">프로젝트 기간 <strong>' +
        short(s.start) +
        ' — ' +
        short(s.end) +
        '</strong></span>',
    ) +
    '<section class="metric-grid"><article class="metric"><div class="metric-label">실제 진척률 <span class="metric-icon">' +
    icon('layers') +
    '</span></div><div class="metric-number">' +
    Math.round(s.progress * 100) +
    '<small>%</small><span class="metric-context">계획 ' +
    pct(s.planned) +
    '</span></div>' +
    meter(s.progress) +
    '<div class="metric-foot ' +
    (delta > 0.005 ? 'red-text' : 'green-text') +
    '">' +
    (s.total
      ? delta > 0.005
        ? '계획보다 ' + (delta * 100).toFixed(1) + '%p 늦어요'
        : delta < -0.005
          ? '계획보다 ' + (-delta * 100).toFixed(1) + '%p 앞서요'
          : '계획대로 진행 중'
      : '첫 업무를 등록해 주세요') +
    '</div></article>' +
    '<article class="metric"><div class="metric-label">예상 완료일 <span class="metric-icon">' +
    icon('calendar') +
    '</span></div><div class="metric-number date-number">' +
    (forecast.end ? short(forecast.end) : '—') +
    '<small>' +
    (forecast.end ? forecast.end.slice(0, 4) : '') +
    '</small></div><div class="metric-foot">' +
    (s.total
      ? '<span class="badge ' +
        (late ? 'amber' : 'green') +
        '">' +
        (forecast.end
          ? late
            ? '계획 대비 +' + late + '근무일'
            : '계획 기한 이내'
          : '담당자 확인 필요') +
        '</span>'
      : '계산할 업무가 없어요') +
    '</div><div class="subtle">' +
    (forecast.observed ? '최근 완료 속도를 반영한 추정' : '완료 기록이 적어 계획 기준으로 추정') +
    '</div></article>' +
    '<article class="metric"><div class="metric-label">완료한 업무 <span class="metric-icon">' +
    icon('check') +
    '</span></div><div class="metric-number">' +
    s.completed +
    '<small>/ ' +
    p.tasks.length +
    '</small></div><div class="metric-foot">' +
    (s.overdue
      ? '<span class="red-text">기한 지난 업무 ' + s.overdue + '개</span>'
      : '<span class="green-text">기한 지난 미완료 업무 없음</span>') +
    '</div><div class="subtle">기준일 완료 체크 ' +
    completedToday +
    '건 · 시작된 미완료 항목 ' +
    pending +
    '건</div></article>' +
    '<article class="metric"><div class="metric-label">함께하는 인력 <span class="metric-icon">' +
    icon('users') +
    '</span></div><div class="metric-number">' +
    p.members.length +
    '<small>명</small><span class="avatar-stack">' +
    p.members
      .slice(0, 3)
      .map((m) => avatar(m, 'tiny'))
      .join('') +
    '</span></div><div class="metric-foot">투입률 합계 <strong>' +
    num(eff) +
    '명분</strong></div><div class="subtle">등급은 인력 정보로만 사용합니다</div></article></section>' +
    '<section class="analysis-grid"><article class="panel chart-panel"><div class="panel-head"><div><h2>프로젝트 진척 추이</h2><p>계획과 실제의 차이를 확인하세요</p></div><div class="legend"><span class="plan-dot">계획</span><span class="actual-dot">실제</span><span class="forecast-dot">예상</span></div></div>' +
    progressChart(p, s) +
    '</article>' +
    '<article class="panel outlook"><span class="eyebrow">PROJECT OUTLOOK</span><div class="outlook-icon">' +
    icon('arrow') +
    '</div><h2>' +
    (s.total
      ? late
        ? '일정 점검이 필요해요'
        : '프로젝트의 다음을<br>차근차근 준비해요'
      : '작은 작업부터<br>시작해 보세요') +
    '</h2><p>' +
    (s.total
      ? forecast.end
        ? '현재 입력과 완료 기록 기준,<br><strong>' +
          full(forecast.end) +
          '</strong> 완료를 예상합니다.'
        : '담당자가 지정되지 않은 업무를 확인해 주세요.'
      : '참여인력을 추가하고, 업무를 체크 가능한 작은 단위로 나눠 보세요.') +
    '</p><div class="outlook-note">' +
    icon('clock') +
    '<span>' +
    (forecast.observed
      ? '최근 10근무일의 완료 기록을 반영'
      : '실적이 쌓이면 최근 완료 속도를 반영') +
    '</span></div>' +
    btn('계산 근거 보기 ↗', 'method', 'link') +
    '</article></section>' +
    '<section class="panel timeline-panel"><div class="panel-head"><div><h2>프로젝트 타임라인</h2><p>업무별 계획과 예상 종료일</p></div>' +
    btn('전체 업무 보기 →', 'view:tasks', 'link') +
    '</div>' +
    gantt(p, s) +
    '</section>' +
    '<section class="bottom-grid"><article class="panel"><div class="panel-head"><div><h2>지금 확인할 업무 <span class="count">' +
    p.tasks.filter((t) => progress(t, asOf) < 1 && t.start <= asOf).length +
    '</span></h2></div>' +
    btn('매일 작업 체크 →', 'view:daily', 'link') +
    '</div>' +
    attention(p, s) +
    '</article><article class="panel"><div class="panel-head"><h2>참여인력별 진척</h2>' +
    btn('인력 관리 →', 'view:people', 'link') +
    '</div>' +
    peopleProgress(p) +
    '</article></section>'
  );
}
function progressChart(p, s) {
  if (!s.total) return '<div class="chart-empty">업무를 등록하면 진척 추이가 표시됩니다.</div>';
  const from = s.start,
    to = [s.end, s.forecast.end, asOf].filter(Boolean).sort().at(-1),
    n = Math.max(1, daysBetween(from, to)),
    left = 42,
    right = 704,
    top = 16,
    bottom = 176,
    x = (d) => left + (daysBetween(from, d) / n) * (right - left),
    y = (v) => bottom - v * (bottom - top);
  const dates = [];
  for (let k = 0; k <= Math.min(n, 100); k++)
    dates.push(addDays(from, Math.round((n * k) / Math.min(n, 100))));
  if (!dates.includes(asOf) && asOf >= from && asOf <= to) dates.push(asOf);
  dates.sort();
  const planPoints = dates
      .map(
        (d) => x(d) + ',' + y(p.tasks.reduce((a, t) => a + planned(t, d, p.holidays), 0) / s.total),
      )
      .join(' '),
    actualPoints = dates
      .filter((d) => d <= asOf)
      .map((d) => x(d) + ',' + y(p.tasks.reduce((a, t) => a + earned(t, d), 0) / s.total))
      .join(' ');
  const ticks = [0, 0.25, 0.5, 0.75, 1]
    .map(
      (v) =>
        '<line x1="' +
        left +
        '" y1="' +
        y(v) +
        '" x2="' +
        right +
        '" y2="' +
        y(v) +
        '" class="chart-grid"/><text x="29" y="' +
        (y(v) + 4) +
        '" text-anchor="end">' +
        Math.round(v * 100) +
        '%</text>',
    )
    .join('');
  const labels = [0, 1, 2, 3, 4]
    .map((i) => {
      const d = addDays(from, Math.round((n * i) / 4));
      return '<text x="' + x(d) + '" y="204" text-anchor="middle">' + short(d) + '</text>';
    })
    .join('');
  const report =
    asOf >= from && asOf <= to
      ? '<line x1="' +
        x(asOf) +
        '" y1="' +
        top +
        '" x2="' +
        x(asOf) +
        '" y2="' +
        bottom +
        '" class="report-line"/><circle cx="' +
        x(asOf) +
        '" cy="' +
        y(s.progress) +
        '" r="5" fill="#3774e9" stroke="white" stroke-width="3"/>'
      : '';
  const projection =
    s.forecast.end && s.forecast.end > asOf && asOf >= from
      ? '<line x1="' +
        x(asOf) +
        '" y1="' +
        y(s.progress) +
        '" x2="' +
        x(s.forecast.end) +
        '" y2="' +
        y(1) +
        '" class="forecast-line"/>'
      : '';
  return (
    '<div class="chart-wrap"><svg viewBox="0 0 744 216" role="img" aria-label="예상 공수 기준 누적 계획 및 실제 진척률 추이">' +
    ticks +
    '<polyline points="' +
    planPoints +
    '" class="plan-line"/><polyline points="' +
    actualPoints +
    '" class="actual-line"/>' +
    projection +
    report +
    labels +
    '</svg></div><div class="chart-caption"><span>예상 공수로 가중한 누적 진척률</span><span>예상선은 계산된 완료일까지의 단순 추세</span></div>'
  );
}
function gantt(p, s) {
  if (!p.tasks.length)
    return empty(
      '프로젝트의 일정을 그려보세요',
      '업무와 계획 일정을 입력하면 타임라인이 만들어집니다.',
    );
  const from = s.start,
    to = [s.end, s.forecast.end, asOf].filter(Boolean).sort().at(-1),
    span = Math.max(7, daysBetween(from, to) + 1),
    width = Math.max(570, Math.min(1400, span * 23)),
    pos = (d) => (daysBetween(from, d) / span) * 100,
    bar = (a, b) =>
      'left:' +
      Math.max(0, pos(a)) +
      '%;width:' +
      Math.max(0.5, ((daysBetween(a, b) + 1) / span) * 100) +
      '%';
  const labels = Array.from({ length: Math.min(9, Math.ceil(span / 7) + 1) }, (_, i) => {
    const k = Math.round((i * (span - 1)) / Math.max(1, Math.min(9, Math.ceil(span / 7) + 1) - 1)),
      d = addDays(from, k);
    return '<span style="left:' + pos(d) + '%">' + short(d) + '</span>';
  }).join('');
  return (
    '<div class="gantt-scroll"><div class="gantt" style="--timeline-width:' +
    width +
    'px"><div class="gantt-top"><div>업무 / 담당자</div><div class="gantt-scale">' +
    labels +
    '</div></div>' +
    p.tasks
      .map((t, i) => {
        const v = progress(t, asOf),
          f = s.forecast.tasks[t.id],
          m = member(t.owner),
          color =
            palette[
              Math.max(
                0,
                p.members.findIndex((x) => x.id === t.owner),
              ) % palette.length
            ];
        return (
          '<div class="gantt-row"><button class="gantt-label" data-edit-task="' +
          esc(t.id) +
          '"><span class="wbs-no">' +
          String(i + 1).padStart(2, '0') +
          '</span><span>' +
          esc(t.name) +
          '<small>' +
          esc(m?.name || '미지정') +
          ' · ' +
          pct(v) +
          '</small></span></button><div class="gantt-track"><div class="gantt-baseline" style="' +
          bar(t.start, t.end) +
          '" title="계획 ' +
          t.start +
          ' ~ ' +
          t.end +
          '"></div>' +
          (f.end
            ? '<div class="gantt-forecast ' +
              (f.late ? 'late' : '') +
              '" style="' +
              bar(f.start, f.end) +
              '" title="' +
              methodLabel(f) +
              ': ' +
              f.end +
              '"></div>'
            : '') +
          '<div class="gantt-progress" style="' +
          bar(t.start, t.end) +
          ';--bar:' +
          color +
          '"><i style="width:' +
          v * 100 +
          '%"></i><span>' +
          pct(v) +
          '</span></div>' +
          (asOf >= from && daysBetween(from, asOf) <= span
            ? '<div class="gantt-today" style="left:' + pos(asOf) + '%"></div>'
            : '') +
          '</div></div>'
        );
      })
      .join('') +
    '</div></div><div class="gantt-foot"><span><i class="legend-bar"></i>계획 기간</span><span><i class="legend-bar filled"></i>완료 비율</span><span><i class="legend-outline"></i>예상 작업 기간</span><span class="muted">주말·등록 휴무일 제외 · ' +
    esc(asOf) +
    ' 기준</span></div>'
  );
}
function attention(p, s) {
  const ts = p.tasks
    .filter((t) => progress(t, asOf) < 1 && t.start <= asOf)
    .sort((a, b) => a.end.localeCompare(b.end))
    .slice(0, 4);
  return ts.length
    ? '<div class="attention-list">' +
        ts
          .map(
            (t) =>
              '<button class="attention-item" data-edit-task="' +
              esc(t.id) +
              '"><span class="task-square ' +
              (t.end < asOf ? 'amber-square' : '') +
              '">' +
              icon('layers') +
              '</span><span class="grow"><strong>' +
              esc(t.name) +
              '</strong><small>' +
              esc(member(t.owner)?.name || '미지정') +
              ' · ' +
              short(t.end) +
              ' 계획 완료</small></span>' +
              badge(t) +
              '<span class="mini-progress">' +
              pct(progress(t, asOf)) +
              '</span></button>',
          )
          .join('') +
        '</div>'
    : '<div class="calm-state">현재 확인할 진행 업무가 없습니다.</div>';
}
function peopleProgress(p) {
  return p.members.length
    ? '<div class="people-progress">' +
        p.members
          .map((m) => {
            const ts = p.tasks.filter((t) => t.owner === m.id),
              total = ts.reduce((s, t) => s + taskHours(t), 0),
              done = ts.reduce((s, t) => s + earned(t, asOf), 0);
            return (
              '<div class="people-progress-row">' +
              avatar(m) +
              '<div class="grow"><div class="person-line"><strong>' +
              esc(m.name) +
              '</strong><span>' +
              esc(m.role) +
              ' · ' +
              ts.length +
              '개 업무</span></div>' +
              meter(total ? done / total : 0) +
              '</div><strong class="person-percent">' +
              (total ? pct(done / total) : '—') +
              '</strong></div>'
            );
          })
          .join('') +
        '</div>'
    : '<div class="calm-state">참여인력을 추가해 주세요.</div>';
}
function filterControls() {
  return (
    '<div class="filter-controls"><input type="search" id="taskSearch" placeholder="업무 검색" value="' +
    esc(query) +
    '" aria-label="업무 검색"><select id="ownerFilter" aria-label="담당자 필터"><option value="">전체 담당자</option>' +
    project()
      .members.map(
        (m) =>
          '<option value="' +
          esc(m.id) +
          '" ' +
          (m.id === ownerFilter ? 'selected' : '') +
          '>' +
          esc(m.name) +
          '</option>',
      )
      .join('') +
    '</select><select id="statusFilter" aria-label="상태 필터"><option value="">전체 상태</option><option value="active" ' +
    (statusFilter === 'active' ? 'selected' : '') +
    '>진행 중</option><option value="late" ' +
    (statusFilter === 'late' ? 'selected' : '') +
    '>지연</option><option value="done" ' +
    (statusFilter === 'done' ? 'selected' : '') +
    '>완료</option></select></div>'
  );
}
function filteredTasks(p) {
  return p.tasks.filter(
    (t) =>
      (!ownerFilter || t.owner === ownerFilter) &&
      (!query || t.name.toLowerCase().includes(query.toLowerCase())) &&
      (!statusFilter ||
        (statusFilter === 'done'
          ? progress(t, asOf) === 1
          : statusFilter === 'late'
            ? t.end < asOf && progress(t, asOf) < 1
            : progress(t, asOf) > 0 && progress(t, asOf) < 1)),
  );
}
function tasksView(p, s) {
  return (
    pageHead('WORKSPACE', '업무와 일정', '업무를 입력하고, 일정을 조정하세요.', '') +
    dateToolbar() +
    wbs.markup(p, asOf)
  );
}
function dailyView(p, s) {
  const toggle =
    '<div class="daily-mode"><button class="button small ' +
    (dailyMode === 'mine' ? 'primary' : '') +
    '" data-daily-mode="mine">내 업무 모아보기</button><button class="button small ' +
    (dailyMode === 'project' ? 'primary' : '') +
    '" data-daily-mode="project">이 프로젝트 완료 체크</button></div>';
  if (dailyMode === 'mine')
    return myWorkView({ projects: myProjects, esc, progress, today: TODAY, projectMode: toggle });
  const ts = filteredTasks(p),
    items = ts.flatMap((t) => t.items.map((i) => ({ t, i }))),
    done = items.filter((x) => x.i.doneDate === asOf).length;
  return (
    pageHead(
      'DAILY CHECK-IN',
      '매일 작업 체크',
      '담당자를 선택하고, 실제로 완료한 작업만 체크해 주세요.',
      btn('완료 내역', 'history') + btn('＋ 업무 추가', 'task', 'primary'),
    ) +
    toggle +
    dateToolbar(filterControls()) +
    '<div class="daily-summary"><div class="daily-summary-icon">' +
    icon('check') +
    '</div><div><strong>' +
    full(asOf) +
    '의 완료 기록</strong><p>체크하면 완료일이 기록되고 진척률과 예상 완료일을 다시 계산합니다.</p></div><span class="daily-count">' +
    done +
    '<small>개 완료</small></span></div><div class="section-toolbar"><span>' +
    items.length +
    '개 체크 항목 · 예상 공수 기준으로 반영</span><label class="toggle-label"><input type="checkbox" id="onlyPending" ' +
    (onlyPending ? 'checked' : '') +
    '>미완료만 보기</label></div>' +
    (ts.length
      ? ts
          .map((t) => {
            const visible = t.items.filter((i) => !onlyPending || !i.doneDate || i.doneDate > asOf);
            if (!visible.length) return '';
            return (
              '<article class="panel check-panel"><div class="check-task-head"><div><span class="eyebrow">' +
              esc(t.phase || '일반') +
              '</span><h2>' +
              esc(t.name) +
              '</h2><div class="task-meta">' +
              person(t.owner) +
              '<span>' +
              short(t.start) +
              ' — ' +
              short(t.end) +
              '</span>' +
              badge(t) +
              '</div></div><div class="check-task-progress"><strong>' +
              pct(progress(t, asOf)) +
              '</strong>' +
              meter(progress(t, asOf)) +
              '</div></div><div class="check-items">' +
              visible
                .map((i) => {
                  const checked = i.doneDate && i.doneDate <= asOf,
                    future = i.doneDate && i.doneDate > asOf;
                  return (
                    '<label class="check-item ' +
                    (checked ? 'is-done' : '') +
                    '"><input type="checkbox" data-check-task="' +
                    esc(t.id) +
                    '" data-check-item="' +
                    esc(i.id) +
                    '" ' +
                    (checked ? 'checked' : '') +
                    ' ' +
                    (future ? 'disabled' : '') +
                    '><span class="check-box">' +
                    icon('check') +
                    '</span><span class="grow"><strong>' +
                    esc(i.title) +
                    '</strong><small>' +
                    (future
                      ? short(i.doneDate) + '에 완료된 작업'
                      : checked
                        ? short(i.doneDate) + ' 완료'
                        : '아직 완료하지 않은 작업') +
                    '</small></span><span class="effort-chip">' +
                    num(i.hours) +
                    'h</span></label>'
                  );
                })
                .join('') +
              '</div></article>'
            );
          })
          .join('')
      : empty('체크할 업무가 없습니다', '업무를 추가하거나 담당자·상태 필터를 변경해 주세요.')) +
    '<p class="view-note">완료 체크는 선택한 보고 기준일로 기록됩니다. 주말에도 실제로 완료한 작업을 기록할 수 있습니다.</p>'
  );
}
function peopleView(p, s) {
  return (
    pageHead(
      'PROJECT TEAM',
      '참여인력',
      '누가 어떤 일을 맡고 있는지, 투입 현황을 함께 확인하세요.',
      btn('＋ 참여인력 추가', 'member', 'primary'),
    ) +
    '<div class="notice">' +
    icon('users') +
    '<span>등급은 인력 분류에 사용합니다. 예상일은 근무시간·투입률·계획 일정·완료 기록으로 계산합니다.</span></div>' +
    (p.members.length
      ? '<section class="team-grid">' +
        p.members
          .map((m, idx) => {
            const ts = p.tasks.filter((t) => t.owner === m.id),
              total = ts.reduce((a, t) => a + taskHours(t), 0),
              done = ts.reduce((a, t) => a + earned(t, asOf), 0),
              pc = s.forecast.pace[m.id];
            return (
              '<article class="panel member-card"><div class="member-top">' +
              avatar(m, 'large') +
              '<button class="icon-button" data-edit-member="' +
              esc(m.id) +
              '" aria-label="' +
              esc(m.name) +
              ' 수정">' +
              icon('more') +
              '</button></div><h2>' +
              esc(m.name) +
              '</h2><div class="member-role">' +
              esc(m.role) +
              '<span>·</span><span class="grade">' +
              esc(m.grade) +
              '</span></div><div class="member-stats"><div><small>투입률</small><strong>' +
              m.allocation +
              '<em>%</em></strong></div><div><small>일 가용시간</small><strong>' +
              num((m.hours * m.allocation) / 100) +
              '<em>h</em></strong></div><div><small>담당 업무</small><strong>' +
              ts.length +
              '<em>개</em></strong></div></div><div class="member-progress-label"><span>담당 업무 진척률</span><strong>' +
              (total ? pct(done / total) : '—') +
              '</strong></div>' +
              meter(total ? done / total : 0) +
              '<div class="member-foot">' +
              num(done) +
              ' / ' +
              num(total) +
              'h 완료 작업량</div><div class="pace-note">' +
              (pc.observed
                ? '최근 속도 반영 · 계획 대비 ' + num(pc.ratio * 100) + '%'
                : '계획 기준 추정 · 완료 기록 수집 중') +
              '</div></article>'
            );
          })
          .join('') +
        '</section>'
      : empty(
          '함께할 인력을 추가해 주세요',
          '이름과 역할, 등급, 투입률만 입력하면 시작할 수 있어요.',
          'member',
          '참여인력 추가',
        ))
  );
}
function openInfo(title, body) {
  $('#infoDialog').classList.remove('report-dialog', 'mail-settings-dialog');
  $('#infoDialog .eyebrow').textContent = 'HOW IT WORKS';
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
const field = (label, name, value = '', type = 'text', extra = '') =>
  '<label class="field">' +
  label +
  '<input name="' +
  name +
  '" type="' +
  type +
  '" value="' +
  esc(value) +
  '" ' +
  extra +
  '></label>';
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
    const m = p.members.find((x) => x.id === id) || {
      name: '',
      role: '개발',
      grade: '중급',
      hours: 8,
      allocation: 100,
    };
    $('#dialogTitle').textContent = id ? '참여인력 수정' : '참여인력 추가';
    body =
      field('이름', 'name', m.name, 'text', 'required maxlength="80" placeholder="참여인력 이름"') +
      '<div class="form-grid">' +
      field('역할', 'role', m.role, 'text', 'required maxlength="40" list="roles"') +
      field('등급', 'grade', m.grade, 'text', 'required maxlength="40" list="grades"') +
      '</div><datalist id="roles"><option>PM</option><option>기획</option><option>개발</option><option>디자인</option><option>QA</option></datalist><datalist id="grades"><option>특급</option><option>고급</option><option>중급</option><option>초급</option></datalist><div class="form-grid">' +
      field(
        '하루 근무시간 (h)',
        'hours',
        m.hours,
        'number',
        'required min=".1" max="16" step=".1"',
      ) +
      field(
        '프로젝트 투입률 (%)',
        'allocation',
        m.allocation,
        'number',
        'required min="1" max="100" step="1"',
      ) +
      '</div><div class="notice">등급은 직접 입력할 수 있습니다. 예상일 계산에는 근무시간과 투입률이 반영됩니다.</div>';
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
      const m = {
        id: editor.id || uid(),
        name: value('name'),
        role: value('role'),
        grade: value('grade'),
        hours: Number(value('hours')),
        allocation: Number(value('allocation')),
      };
      if (editor.id) target.members[target.members.findIndex((x) => x.id === editor.id)] = m;
      else target.members.push(m);
      validateProject(target);
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
  if (el.dataset.checkItem) {
    const p = project(),
      t = p.tasks.find((t) => t.id === el.dataset.checkTask),
      i = t?.items.find((i) => i.id === el.dataset.checkItem);
    if (!i) return;
    if (asOf > TODAY) {
      toast('미래 날짜에는 완료를 기록할 수 없습니다.');
      render();
      return;
    }
    i.doneDate = el.checked ? asOf : null;
    const saved = await persist();
    render();
    toast(
      saved
        ? i.doneDate
          ? '완료 기록을 저장했습니다. 진척률과 예상일을 갱신했어요.'
          : '완료 체크를 취소했습니다.'
        : '저장 실패 · 현재 데이터를 백업해 주세요.',
    );
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
  if (location.hash === '#registration-approvals') {
    reviewLanding = true;
    if (currentUser) showApprovalInbox().catch((error) => toast(error.message));
    else showAuth();
    return;
  }
  if (location.hash.startsWith('#verify-email')) {
    const value = location.hash.match(/^#verify-email=([A-Za-z0-9_-]{43})$/)?.[1] || '';
    history.replaceState(null, '', location.pathname + location.search);
    if (wbs.dirty || storageError || saveInFlight) {
      toast('현재 변경사항을 저장한 뒤 인증 링크를 다시 열어 주세요.');
      return;
    }
    emailVerificationToken = value;
    showEmailVerification();
    return;
  }
  if (location.hash.startsWith('#reset-password')) {
    const value = location.hash.match(/^#reset-password=([A-Za-z0-9_-]{43})$/)?.[1] || '';
    history.replaceState(null, '', location.pathname + location.search);
    if (wbs.dirty || storageError || saveInFlight) {
      toast('현재 변경사항을 저장한 뒤 이메일의 재설정 링크를 다시 열어 주세요.');
      return;
    }
    passwordResetToken = value;
    showPasswordReset();
    return;
  }
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
$('#closeInfo').onclick = () => $('#infoDialog').close();
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
    tasks = view === 'tasks' ? wbs.visible({ includeCollapsed: true }) : filteredTasks(p);
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
  $('#authGate').hidden = false;
  $('#forgotPasswordForm')?.remove();
  $('#resetPasswordForm')?.remove();
  $('#registrationForm')?.remove();
  $('#verifyEmailForm')?.remove();
  $('#resendVerificationForm')?.remove();
  $('#loginForm').hidden = false;
  $('#authError').textContent = message;
  if (currentUser) $('#loginEmail').value = currentUser.email;
}
async function initializeAuthentication() {
  const messages = {
    SSO_FAILED: '외부 인증에 실패했거나 요청이 만료되었습니다. 다시 시작해 주세요.',
    IDENTITY_UNLINKED: '관리자에게 외부 계정 연결을 요청해 주세요.',
    DOMAIN_DENIED: '허용된 조직 계정이 아닙니다.',
    ACCOUNT_DISABLED: '비활성화된 계정입니다. 관리자에게 문의해 주세요.',
    UNVERIFIED_EMAIL: '인증 서버의 이메일 검증 설정을 관리자에게 확인해 주세요.',
  };
  const url = new URL(location.href),
    error = url.searchParams.get('authError');
  if (error) {
    $('#authError').textContent = messages[error] || messages.SSO_FAILED;
    url.searchParams.delete('authError');
    history.replaceState(null, '', url);
  }
  try {
    const { providers, registration, passwordReset } = await api('auth/providers');
    resetEmailEnabled = !!passwordReset?.enabled;
    registrationPolicy = registration || registrationPolicy;
    $('#registerButton').hidden = registrationPolicy.mode !== 'approval';
    $('#registrationDisabled').hidden = registrationPolicy.mode === 'approval';
    if (!providers.length) return;
    const group = document.createElement('div');
    group.className = 'federated-logins';
    group.innerHTML = providers
      .filter((p) => p.type !== 'ldap')
      .map(
        (p) =>
          '<button type="button" class="button sso-login" data-sso-provider="' +
          esc(p.id) +
          '">' +
          esc(p.label) +
          '로 로그인</button>',
      )
      .join('');
    const directory = providers.filter((p) => p.type === 'ldap');
    if (directory.length)
      group.innerHTML +=
        '<label class="field">로그인 방식<select id="loginProvider"><option value="">PM Canvas 계정</option>' +
        directory
          .map((p) => '<option value="' + esc(p.id) + '">' + esc(p.label) + '</option>')
          .join('') +
        '</select></label>';
    $('#loginEmail').closest('label').before(group);
    group.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sso-provider]');
      if (!b) return;
      if (storageError || saveInFlight || wbs.dirty) {
        $('#authError').textContent =
          '현재 변경사항을 먼저 저장하거나 백업한 뒤 외부 로그인을 진행해 주세요.';
        return;
      }
      location.assign(new URL('./api/auth/sso/' + b.dataset.ssoProvider + '/start', location.href));
    });
    group.querySelector('select')?.addEventListener('change', (e) => {
      loginProvider = e.target.value;
      const input = $('#loginEmail');
      input.type = loginProvider ? 'text' : 'email';
      input.closest('label').firstChild.textContent = loginProvider
        ? '디렉터리 사용자명'
        : '이메일';
      input.value = '';
      $('#authError').textContent = '';
    });
  } catch {
    $('#authError').textContent =
      '외부 인증 목록을 불러오지 못했습니다. 연결을 확인하거나 PM Canvas 계정으로 로그인해 주세요.';
  }
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
async function refreshUsers() {
  const list = $('#userList');
  if (!list) return;
  try {
    const { users } = await api('users');
    if (!list.isConnected) return;
    users.sort((a, b) => Number(b.registrationPending) - Number(a.registrationPending));
    const visible = ops.filterUsers(users),
      pending = users.filter((u) => u.registrationPending).length;
    list.innerHTML =
      (!$('#userTools') && pending
        ? '<p class="notice">가입 신청 ' +
          pending +
          '명 · 이메일 인증 완료 후 승인할 수 있습니다.</p>'
        : '') +
        visible
          .map((u) => {
            const label = u.registrationPending ? '가입 승인' : u.isActive ? '비활성화' : '활성화';
            return (
              '<article class="account-user"><div class="sharing-row"><span><strong>' +
              esc(u.name) +
              '</strong><small>' +
              esc(u.email) +
              ' · ' +
              (u.isAdmin
                ? '관리자'
                : u.registrationPending
                  ? u.emailVerified
                    ? '이메일 인증 완료 · 승인 대기'
                    : '이메일 인증 대기'
                  : u.registrationRejected
                    ? '가입 거절'
                    : u.isActive
                      ? '활성'
                      : '비활성') +
              '</small></span>' +
              (u.isAdmin
                ? '<span class="badge neutral">관리자</span>'
                : u.registrationPending
                  ? '<button class="button small primary" data-registration-review="' +
                    esc(u.id) +
                    '">신청 검토</button>'
                  : u.registrationRejected
                    ? '<span class="badge neutral">가입 거절</span>'
                    : '<button class="button small" data-user-status="' +
                      esc(u.id) +
                      '" data-registration-pending="false" data-next-active="' +
                      !u.isActive +
                      '" aria-label="' +
                      esc(u.name) +
                      ' ' +
                      label +
                      '">' +
                      label +
                      '</button>') +
              '</div>' +
              (u.registrationRejected
                ? '<p class="subtle">거절 사유: ' + esc(u.rejectionReason || '미입력') + '</p>'
                : '') +
              (u.registrationPending && u.reviewMailStatus
                ? '<p class="subtle">관리자 승인 요청 · ' +
                  {
                    pending: '발송 대기 · 실패 시 자동 재시도',
                    sending: '발송 중',
                    sent: 'SMTP 전달 완료',
                    failed: '일부 또는 전체 발송 실패',
                  }[u.reviewMailStatus] +
                  (u.reviewMailStatus === 'failed'
                    ? ' <button class="auth-link" data-retry-review="' +
                      esc(u.id) +
                      '">실패한 메일 다시 보내기</button>'
                    : '') +
                  '</p>'
                : '') +
              (u.approvalMailStatus
                ? '<p class="subtle">승인 안내 메일 · ' +
                  {
                    pending: '발송 대기 · 실패 시 자동 재시도',
                    sending: '발송 중',
                    sent: 'SMTP 전달 완료',
                    failed: '발송 실패',
                  }[u.approvalMailStatus] +
                  (u.approvalMailStatus === 'failed' && u.isActive
                    ? ' <button class="auth-link" data-retry-notice="' +
                      esc(u.id) +
                      '">다시 보내기</button>'
                    : '') +
                  '</p>'
                : '') +
              (u.isAdmin || u.registrationPending
                ? ''
                : u.localLogin === false
                  ? '<p class="subtle">외부 인증 전용 계정</p>'
                  : '<details><summary>비밀번호 재설정 · ' +
                    esc(u.name) +
                    '</summary><p class="subtle">새 비밀번호는 사용자에게 직접 전달하세요. 모든 기존 세션이 종료됩니다.</p><form class="server-form" data-reset-user="' +
                    esc(u.id) +
                    '">' +
                    field(
                      '새 임시 비밀번호',
                      'password',
                      '',
                      'password',
                      'required minlength="12" maxlength="256" autocomplete="new-password"',
                    ) +
                    '<button class="button">비밀번호 재설정</button><p class="account-result" role="status"></p></form></details>') +
              '</article>'
            );
          })
          .join('') || '<p class="subtle">해당하는 계정이 없습니다.</p>';
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
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = e.target.querySelector('button');
  button.disabled = true;
  try {
    const email = $('#loginEmail').value;
    if (
      (storageError || wbs.dirty) &&
      currentUser &&
      email.trim().toLowerCase() !== currentUser.email
    )
      throw Error('저장하지 못한 변경사항이 있습니다. 기존 계정으로 다시 로그인해 주세요.');
    if ((storageError || wbs.dirty) && loginProvider)
      throw Error('현재 변경사항을 먼저 저장하거나 백업해 주세요.');
    const session = await api(loginProvider ? 'auth/directory' : 'auth/login', {
      method: 'POST',
      body: loginProvider
        ? { provider: loginProvider, username: email, password: $('#loginPassword').value }
        : { email, password: $('#loginPassword').value },
    });
    $('#loginPassword').value = '';
    if (session.mfaRequired) {
      showMfaLogin(session);
      return;
    }
    await completeBrowserLogin(session);
  } catch (error) {
    $('#authError').textContent = error.message;
    if (error.code === 'EMAIL_UNVERIFIED') {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'auth-link';
      link.dataset.resendVerification = '';
      link.textContent = '인증 메일 다시 받기';
      $('#authError').append(link);
    }
  } finally {
    button.disabled = false;
  }
});
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
initializeAuthentication().finally(() =>
  verificationLanding ? showEmailVerification() : resetLanding ? showPasswordReset() : boot(),
);

let exportingExcel = false;
async function exportExcel() {
  if (exportingExcel) return;
  try {
    if (view === 'tasks') wbs.commitAll();
    const p = view === 'tasks' ? wbs.snapshot() : project(),
      taskIds = (view === 'tasks' ? wbs.visible({ includeCollapsed: true }) : filteredTasks(p)).map(
        (t) => t.id,
      ),
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
async function completeBrowserLogin(session) {
  if (currentUser?.id !== session.user.id) {
    wbs.persistDraft();
    if (currentUser) DraftStore.clearUser(currentUser.id);
    wbs.draft = null;
    wbs.base = null;
    wbs.pending.clear();
    wbs.recovery = null;
  }
  currentUser = session.user;
  $('#authGate').hidden = true;
  $('#loginForm').hidden = false;
  $('#mfaForm')?.remove();
  if (storageError || wbs.dirty) render();
  else await loadProjects();
  if (session.recoveryCodes) {
    openInfo(
      'MFA 복구 코드를 보관하세요',
      '<p>인증 앱을 사용할 수 없을 때 아래 코드를 한 번씩 사용할 수 있습니다. 안전한 오프라인 장소에 보관하세요. 이 화면에서만 표시합니다.</p><pre>' +
        session.recoveryCodes.map(esc).join('\n') +
        '</pre>',
    );
    if (reviewLanding)
      $('#infoDialog').addEventListener(
        'close',
        () => {
          showApprovalInbox().catch((error) => toast(error.message));
        },
        { once: true },
      );
  } else await showApprovalInbox();
}
function showMfaLogin(challenge) {
  $('#loginForm').hidden = true;
  $('#mfaForm')?.remove();
  const form = document.createElement('form');
  form.id = 'mfaForm';
  form.className = 'auth-card';
  form.innerHTML =
    '<h2>관리자 2단계 인증</h2>' +
    (challenge.enrollment
      ? '<p>인증 앱에 아래 설정 키를 등록하고 표시되는 6자리 코드를 입력하세요.</p><label class="field">설정 키<input id="mfaSecret" readonly value="' +
        esc(challenge.secret) +
        '"></label><p>계정: PMCanvas · SHA1 · 6자리 · 30초</p>'
      : '<p>인증 앱 코드 또는 일회용 복구 코드를 입력하세요.</p>') +
    '<label class="field">인증 코드<input id="mfaCode" autocomplete="one-time-code" maxlength="64" required autofocus></label><p class="form-error" role="alert"></p><button class="button primary">인증</button><button class="button" type="button" id="cancelMfa">다시 로그인</button>';
  $('#authGate').append(form);
  $('#mfaCode').focus();
  $('#cancelMfa').onclick = () => {
    form.remove();
    $('#loginForm').hidden = false;
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      const session = await api('auth/mfa/verify', {
        method: 'POST',
        body: { challenge: challenge.challenge, code: $('#mfaCode').value },
      });
      await completeBrowserLogin(session);
    } catch (error) {
      form.querySelector('.form-error').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
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

function returnToLogin(email = '') {
  $('#registrationForm')?.remove();
  $('#forgotPasswordForm')?.remove();
  $('#resetPasswordForm')?.remove();
  $('#verifyEmailForm')?.remove();
  $('#resendVerificationForm')?.remove();
  passwordResetToken = '';
  emailVerificationToken = '';
  $('#loginForm').hidden = false;
  $('#loginPassword').value = '';
  $('#authError').textContent = '';
  if (email) {
    loginProvider = '';
    const select = $('#loginProvider');
    if (select) select.value = '';
    $('#loginEmail').type = 'email';
    $('#loginEmail').closest('label').firstChild.textContent = '이메일';
    $('#loginEmail').value = email;
    $('#loginPassword').focus();
  } else $('#loginEmail').focus();
}
$('#registerButton').addEventListener('click', () => {
  if (registrationPolicy.mode !== 'approval') return;
  if (currentUser && (storageError || wbs.dirty)) {
    toast('현재 계정의 변경사항을 먼저 저장하거나 백업해 주세요.');
    return;
  }
  $('#loginForm').hidden = true;
  $('#loginPassword').value = '';
  $('#registrationForm')?.remove();
  const form = document.createElement('form');
  form.id = 'registrationForm';
  form.className = 'auth-card';
  form.innerHTML =
    '<span class="eyebrow">PM CANVAS</span><h1>회원가입</h1><p>이메일 인증과 관리자 승인 후 사용할 수 있어요.</p>' +
    (registrationPolicy.domains.length
      ? '<p class="registration-domains">가입 가능 이메일: ' +
        registrationPolicy.domains.map(esc).join(', ') +
        '</p>'
      : '') +
    field('이름', 'name', '', 'text', 'required maxlength="80" autocomplete="name"') +
    field('이메일', 'email', '', 'email', 'required maxlength="254" autocomplete="email"') +
    '<small>메일의 인증 링크에서 로그인 비밀번호를 설정합니다.</small><p class="form-error" role="alert"></p><button class="button primary" type="submit">인증 메일 보내기</button><button class="auth-link" type="button" data-resend-verification>이미 신청했나요? 인증 메일 다시 받기</button><button class="auth-link" type="button" data-registration-back>로그인으로 돌아가기</button>';
  $('#authGate').append(form);
  form.elements.name.focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const button = form.querySelector('[type=submit]'),
      error = form.querySelector('.form-error'),
      data = new FormData(form);
    error.textContent = '';

    button.disabled = true;
    try {
      const result = await api('auth/register', { method: 'POST', body: Object.fromEntries(data) });
      const email = String(data.get('email'));
      form.reset();
      form.innerHTML =
        '<span class="eyebrow">PM CANVAS</span><h1>신청 완료</h1><p role="status">' +
        esc(result.message) +
        '</p><small>인증 링크는 30분 동안 유효합니다. 승인 결과도 메일로 알려드립니다.</small><button class="auth-link" type="button" data-resend-verification>인증 메일 다시 받기</button><button class="button primary" type="button" data-registration-back>로그인으로 돌아가기</button>';
      form.querySelector('[data-registration-back]').dataset.email = email;
      form.querySelector('[data-resend-verification]').dataset.email = email;
      form.querySelector('h1').tabIndex = -1;
      form.querySelector('h1').focus();
    } catch (err) {
      error.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  };
});
$('#authGate').addEventListener('click', (e) => {
  const button = e.target.closest('[data-registration-back]');
  if (button) returnToLogin(button.dataset.email || '');
});

function authFlowForm(id) {
  $('#authGate').hidden = false;
  $('#loginForm').hidden = true;
  $('#loginPassword').value = '';
  for (const key of [
    'registrationForm',
    'forgotPasswordForm',
    'resetPasswordForm',
    'verifyEmailForm',
    'resendVerificationForm',
    'mfaForm',
  ])
    $('#' + key)?.remove();
  const form = document.createElement('form');
  form.id = id;
  form.className = 'auth-card';
  $('#authGate').append(form);
  return form;
}
function showResendVerification(email = '') {
  if (currentUser && (storageError || wbs.dirty)) {
    toast('현재 변경사항을 먼저 저장하거나 백업해 주세요.');
    return;
  }
  emailVerificationToken = '';
  const form = authFlowForm('resendVerificationForm');
  form.innerHTML =
    '<span class="eyebrow">PM CANVAS</span><h1>인증 메일 다시 받기</h1><p>가입 신청에 사용한 이메일을 입력하세요.</p>' +
    field('이메일', 'email', email, 'email', 'required maxlength="254" autocomplete="email"') +
    '<p class="form-error" role="alert"></p><button type="submit" class="button primary">인증 메일 보내기</button><button type="button" class="auth-link" data-registration-back>로그인으로 돌아가기</button>';
  form.elements.email.focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const button = form.querySelector('[type=submit]'),
      error = form.querySelector('.form-error');
    button.disabled = true;
    error.textContent = '';
    try {
      const result = await api('auth/resend-verification', {
        method: 'POST',
        body: { email: form.elements.email.value },
      });
      form.reset();
      form.innerHTML =
        '<span class="eyebrow">PM CANVAS</span><h1>메일을 확인해 주세요</h1><p role="status">' +
        esc(result.message) +
        '</p><small>가장 최근에 받은 링크를 30분 안에 사용하세요.</small><button type="button" class="button primary" data-registration-back>로그인으로 돌아가기</button>';
      form.querySelector('h1').tabIndex = -1;
      form.querySelector('h1').focus();
    } catch (err) {
      error.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  };
}
function showEmailVerification() {
  const form = authFlowForm('verifyEmailForm');
  form.innerHTML =
    '<span class="eyebrow">PM CANVAS</span><h1>이메일 인증</h1><p>본인의 이름과 로그인 비밀번호를 설정하면 인증이 완료됩니다.</p>' +
    field('이름', 'name', '', 'text', 'required maxlength="80" autocomplete="name"') +
    field(
      '로그인 비밀번호',
      'newPassword',
      '',
      'password',
      'required minlength="12" maxlength="256" autocomplete="new-password"',
    ) +
    field(
      '비밀번호 확인',
      'confirmPassword',
      '',
      'password',
      'required minlength="12" maxlength="256" autocomplete="new-password"',
    ) +
    '<small>비밀번호는 12자 이상으로 설정하세요. 인증 후 관리자 승인이 필요합니다.</small><p class="form-error" role="alert">' +
    (emailVerificationToken ? '' : '유효하지 않은 링크입니다. 인증 메일을 다시 요청해 주세요.') +
    '</p><button type="submit" class="button primary" ' +
    (emailVerificationToken ? '' : 'disabled') +
    '>이메일 인증 완료</button><button type="button" class="auth-link" data-resend-verification>인증 메일 다시 받기</button><button type="button" class="auth-link" data-registration-back>로그인으로 돌아가기</button>';
  form.elements.name.focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const button = form.querySelector('[type=submit]'),
      error = form.querySelector('.form-error'),
      data = new FormData(form);
    error.textContent = '';
    if (data.get('newPassword') !== data.get('confirmPassword')) {
      error.textContent = '비밀번호 확인이 일치하지 않습니다.';
      form.elements.confirmPassword.focus();
      return;
    }
    button.disabled = true;
    try {
      const result = await api('auth/verify-email', {
        method: 'POST',
        body: { ...Object.fromEntries(data), token: emailVerificationToken },
      });
      emailVerificationToken = '';
      form.reset();
      form.innerHTML =
        '<span class="eyebrow">PM CANVAS</span><h1>이메일 인증 완료</h1><p role="status">' +
        esc(result.message) +
        '</p><button type="button" class="button primary" data-registration-back>로그인으로 돌아가기</button>';
      form.querySelector('h1').tabIndex = -1;
      form.querySelector('h1').focus();
    } catch (err) {
      error.textContent = err.message;
      if (err.code === 'VERIFICATION_INVALID') {
        emailVerificationToken = '';
        form.reset();
      }
    } finally {
      button.disabled = !emailVerificationToken;
    }
  };
}
$('#authGate').addEventListener('click', (e) => {
  const b = e.target.closest('[data-resend-verification]');
  if (b) showResendVerification(b.dataset.email || (!loginProvider ? $('#loginEmail').value : ''));
});
function showForgotPassword() {
  if (currentUser && (storageError || wbs.dirty)) {
    toast('현재 변경사항을 먼저 저장하거나 백업해 주세요.');
    return;
  }
  passwordResetToken = '';
  const form = authFlowForm('forgotPasswordForm');
  form.innerHTML =
    '<span class="eyebrow">PM CANVAS</span><h1>비밀번호 찾기</h1><p>가입한 이메일로 재설정 링크를 보내드려요.</p>' +
    field('이메일', 'email', '', 'email', 'required maxlength="254" autocomplete="email"') +
    '<small>회사 SSO·AD 계정은 회사 인증 서비스에서 변경하세요.</small><p class="form-error" role="alert">' +
    (resetEmailEnabled
      ? ''
      : '현재 이메일 재설정을 사용할 수 없습니다. 관리자에게 문의해 주세요.') +
    '</p><button type="submit" class="button primary" ' +
    (resetEmailEnabled ? '' : 'disabled') +
    '>재설정 메일 보내기</button><button type="button" class="auth-link" data-registration-back>로그인으로 돌아가기</button>';
  if (!loginProvider) form.elements.email.value = $('#loginEmail').value;
  form.elements.email.focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const button = form.querySelector('[type=submit]'),
      error = form.querySelector('.form-error');
    button.disabled = true;
    error.textContent = '';
    try {
      const result = await api('auth/forgot-password', {
        method: 'POST',
        body: { email: form.elements.email.value },
      });
      form.reset();
      form.innerHTML =
        '<span class="eyebrow">PM CANVAS</span><h1>메일을 확인해 주세요</h1><p role="status">' +
        esc(result.message) +
        '</p><small>링크는 15분 동안 사용할 수 있어요.</small><button type="button" class="button primary" data-registration-back>로그인으로 돌아가기</button>';
      form.querySelector('h1').tabIndex = -1;
      form.querySelector('h1').focus();
    } catch (err) {
      error.textContent = err.message;
    } finally {
      button.disabled = !resetEmailEnabled;
    }
  };
}
$('#forgotPasswordButton').addEventListener('click', showForgotPassword);
function showPasswordReset() {
  const form = authFlowForm('resetPasswordForm');
  form.innerHTML =
    '<span class="eyebrow">PM CANVAS</span><h1>새 비밀번호 설정</h1><p>변경하면 모든 기기에서 로그아웃됩니다.</p>' +
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
    '<small>12자 이상으로 입력하세요.</small><p class="form-error" role="alert">' +
    (passwordResetToken ? '' : '유효하지 않은 링크입니다. 비밀번호 재설정을 다시 요청해 주세요.') +
    '</p><button type="submit" class="button primary" ' +
    (passwordResetToken ? '' : 'disabled') +
    '>비밀번호 변경</button><button type="button" class="auth-link" data-request-reset>재설정 메일 다시 요청</button><button type="button" class="auth-link" data-registration-back>로그인으로 돌아가기</button>';
  form.elements.newPassword.focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const button = form.querySelector('[type=submit]'),
      error = form.querySelector('.form-error'),
      password = form.elements.newPassword.value,
      confirmPassword = form.elements.confirmPassword.value;
    error.textContent = '';
    if (password !== confirmPassword) {
      error.textContent = '비밀번호 확인이 일치하지 않습니다.';
      form.elements.confirmPassword.focus();
      return;
    }
    button.disabled = true;
    try {
      await api('auth/reset-password', {
        method: 'POST',
        body: { token: passwordResetToken, newPassword: password, confirmPassword },
      });
      passwordResetToken = '';
      form.reset();
      form.innerHTML =
        '<span class="eyebrow">PM CANVAS</span><h1>비밀번호를 변경했습니다</h1><p role="status">새 비밀번호로 다시 로그인해 주세요.</p><button class="button primary" type="button" data-registration-back>로그인하기</button>';
      form.querySelector('h1').tabIndex = -1;
      form.querySelector('h1').focus();
    } catch (err) {
      error.textContent = err.message;
      if (err.code === 'RESET_INVALID') {
        passwordResetToken = '';
        form.reset();
      }
    } finally {
      button.disabled = !passwordResetToken;
    }
  };
}
$('#authGate').addEventListener('click', (e) => {
  if (e.target.closest('[data-request-reset]')) showForgotPassword();
});

async function openMailSettings() {
  if (!currentUser?.isAdmin) return;
  openInfo('이메일 발송 설정', '<div id="mailSettingsHost">불러오는 중…</div>');
  $('#infoDialog').classList.add('mail-settings-dialog');
  $('#infoDialog .eyebrow').textContent = '관리자 설정';
  const host = $('#mailSettingsHost'),
    q = (selector) => host.querySelector(selector);
  try {
    let { settings } = await api('admin/mail-settings');
    if (!host.isConnected) return;
    let busy = false;
    host.innerHTML =
      '<p>가입 인증·관리자 승인 요청·승인 안내·비밀번호 재설정에 사용할 메일 서버를 설정하세요. 저장하면 바로 적용됩니다.</p><form id="mailSettingsForm" class="server-form"><fieldset class="smtp-fields"><label class="mail-flag"><input name="enabled" type="checkbox">이메일 발송 사용</label><label class="field">승인 요청 수신 이메일<textarea name="reviewRecipients" rows="2" maxlength="4096" placeholder="admin@example.com, team@example.com" aria-describedby="reviewRecipientsHint"></textarea></label><p class="subtle" id="reviewRecipientsHint">쉼표나 줄바꿈으로 구분해 최대 10개. 비워두면 활성 관리자들의 등록 이메일로 보냅니다.</p><div class="mail-settings-grid">' +
      field(
        'SMTP 서버',
        'host',
        '',
        'text',
        'maxlength="253" placeholder="smtp.example.com" autocomplete="off"',
      ) +
      field('포트', 'port', '', 'number', 'required min="1" max="65535"') +
      '<label class="field">보안 연결<select name="security"><option value="starttls">STARTTLS · 보통 587번</option><option value="tls">TLS · 보통 465번</option></select></label>' +
      field(
        '발신 이메일',
        'from',
        '',
        'email',
        'maxlength="254" placeholder="pmcanvas@example.com"',
      ) +
      '</div><label class="mail-flag"><input name="authEnabled" type="checkbox">SMTP 인증 사용</label><div class="mail-settings-grid" id="smtpAuthFields">' +
      field('인증 계정', 'username', '', 'text', 'maxlength="254" autocomplete="off"') +
      field(
        'SMTP 비밀번호',
        'smtpPassword',
        '',
        'password',
        'maxlength="4096" autocomplete="new-password"',
      ) +
      '</div><p class="subtle" id="smtpPasswordHint"></p></fieldset><div class="mail-save-row"><button type="submit" class="button primary">설정 저장</button><span id="mailEnabledStatus" class="subtle"></span></div><p class="account-result" role="status" id="mailSaveResult"></p></form><section class="account-section"><h3>테스트 메일</h3><p class="subtle" id="mailTestHint"></p><form id="mailTestForm" class="server-form">' +
      field(
        '받는 이메일',
        'to',
        currentUser.email,
        'email',
        'required maxlength="254" autocomplete="email"',
      ) +
      '<button class="button" type="submit">테스트 메일 보내기</button><p class="account-result" role="status" id="mailTestResult"></p></form></section>';
    const form = q('#mailSettingsForm'),
      test = q('#mailTestForm'),
      e = form.elements;
    const value = () => ({
      enabled: e.enabled.checked,
      host: e.host.value.trim(),
      port: Number(e.port.value),
      secure: e.security.value === 'tls',
      from: e.from.value.trim(),
      authEnabled: e.authEnabled.checked,
      username: e.username.value.trim(),
      password: e.smtpPassword.value,
      reviewRecipients: e.reviewRecipients.value,
      revision: settings.revision,
    });
    const dirty = () => {
      const v = value();
      return (
        !!v.password ||
        v.reviewRecipients.trim() !== (settings.reviewRecipients || []).join(', ') ||
        ['enabled', 'host', 'port', 'secure', 'from', 'authEnabled', 'username'].some(
          (k) => v[k] !== settings[k],
        )
      );
    };
    const refresh = () => {
      const changed = dirty();
      form.querySelector('[type=submit]').disabled = busy || !changed;
      test.querySelector('[type=submit]').disabled = busy || changed || !settings.enabled;
      q('#mailTestHint').textContent = changed
        ? '변경한 설정을 먼저 저장해 주세요.'
        : settings.enabled
          ? '저장된 설정으로 테스트 메일을 보냅니다.'
          : '이메일 발송을 켜고 저장하면 테스트할 수 있어요.';
      e.host.required = e.from.required = e.enabled.checked;
      e.username.required = e.enabled.checked && e.authEnabled.checked;
      e.username.disabled = e.smtpPassword.disabled = !e.authEnabled.checked;
      q('#smtpAuthFields').hidden = !e.authEnabled.checked;
      q('#smtpPasswordHint').textContent = !e.authEnabled.checked
        ? '인증을 끄고 저장하면 등록된 계정과 비밀번호를 삭제합니다.'
        : settings.hasPassword
          ? '비밀번호가 등록되어 있습니다. 빈칸이면 기존 값을 유지합니다. 서버나 계정을 바꿀 때는 다시 입력하세요.'
          : '인증을 사용하는 메일 서버라면 비밀번호를 입력하세요.';
    };
    const populate = () => {
      e.enabled.checked = settings.enabled;
      e.host.value = settings.host;
      e.port.value = settings.port;
      e.security.value = settings.secure ? 'tls' : 'starttls';
      e.from.value = settings.from;
      e.authEnabled.checked = settings.authEnabled;
      e.username.value = settings.username;
      e.reviewRecipients.value = (settings.reviewRecipients || []).join(', ');
      e.smtpPassword.value = '';
      e.smtpPassword.placeholder = settings.hasPassword ? '등록됨 · 변경할 때만 입력' : '';
      q('#smtpPasswordHint').textContent = settings.hasPassword
        ? '비밀번호가 등록되어 있습니다. 빈칸이면 기존 값을 유지합니다. 서버나 계정을 바꿀 때는 다시 입력하세요.'
        : '인증을 사용하는 메일 서버라면 비밀번호를 입력하세요.';
      q('#mailEnabledStatus').textContent = settings.enabled ? '발송 사용 중' : '발송 중지';
      refresh();
    };
    form.addEventListener('input', () => {
      q('#mailTestResult').textContent = '';
      refresh();
    });
    form.addEventListener('change', (event) => {
      if (event.target === e.security) e.port.value = e.security.value === 'tls' ? '465' : '587';
      refresh();
    });
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      const data = value();
      q('fieldset').disabled = true;
      refresh();
      q('#mailSaveResult').textContent = '저장 중…';
      try {
        ({ settings } = await api('admin/mail-settings', { method: 'PUT', body: data }));
        resetEmailEnabled = settings.enabled;
        if (host.isConnected) {
          populate();
          q('#mailSaveResult').textContent = '저장했습니다. 새 설정이 적용됐습니다.';
          q('#mailTestResult').textContent = '';
        }
      } catch (error) {
        if (host.isConnected) {
          q('#mailSaveResult').textContent = error.message;
          if (error.status === 401) {
            e.smtpPassword.value = '';
            $('#infoDialog').close();
            showAuth(error.message);
          }
        }
      } finally {
        busy = false;
        if (host.isConnected) {
          q('fieldset').disabled = false;
          refresh();
        }
      }
    };
    test.onsubmit = async (event) => {
      event.preventDefault();
      if (busy || dirty() || !settings.enabled) return;
      busy = true;
      refresh();
      test.elements.to.disabled = true;
      q('#mailTestResult').textContent = '테스트 메일 발송 중…';
      try {
        const result = await api('admin/mail-settings/test', {
          method: 'POST',
          body: { to: test.elements.to.value },
        });
        if (host.isConnected) q('#mailTestResult').textContent = result.message;
      } catch (error) {
        if (host.isConnected) {
          q('#mailTestResult').textContent = error.message;
          if (error.status === 401) {
            $('#infoDialog').close();
            showAuth(error.message);
          }
        }
      } finally {
        busy = false;
        if (host.isConnected) {
          test.elements.to.disabled = false;
          refresh();
        }
      }
    };
    populate();
    e.host.focus();
  } catch (error) {
    if (host.isConnected) host.textContent = error.message;
  }
}

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
const ops = workspaceOperations({
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
