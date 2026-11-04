import { uid as projectUid } from './id.js';
import { ui } from './i18n.js';
import { escapeHtml as esc } from './html.js';
import { today, validateProject } from './engine.js';
import { validatePlanning } from './planning.js';
import { predecessorIds } from './task-model.js';
import { newTask, setCell } from './wbs-model.js';
import {
  cleanManagement,
  managementChange,
  weeklyDraft,
  weekRange,
  monthlyPlan,
} from './management.js';

const labels = {
  issue: '이슈',
  risk: '리스크',
  low: '낮음',
  medium: '보통',
  high: '높음',
  open: '미해결',
  doing: '조치 중',
  closed: '종료',
};
const pct = (n) => (100 * n).toFixed(1) + '%';
const num = (n) => Number(n.toFixed(2)).toLocaleString();
const input = (label, name, value = '', attrs = '') =>
  '<label class="field">' +
  esc(ui(label)) +
  '<input name="' +
  name +
  '" value="' +
  esc(value) +
  '" ' +
  attrs +
  '></label>';
const area = (label, name, value = '') =>
  '<label class="field">' +
  esc(ui(label)) +
  '<textarea name="' +
  name +
  '" maxlength="4000" rows="3">' +
  esc(value) +
  '</textarea></label>';
const select = (label, name, rows, value = '') =>
  '<label class="field">' +
  esc(ui(label)) +
  '<select name="' +
  name +
  '">' +
  rows
    .map(
      ([id, label]) =>
        '<option value="' +
        esc(id) +
        '" ' +
        (id === value ? 'selected' : '') +
        '>' +
        esc(label) +
        '</option>',
    )
    .join('') +
  '</select></label>';
const choice = (label, name, values, value) =>
  select(
    label,
    name,
    values.map((id) => [id, ui(labels[id])]),
    value,
  );
const submit = (label = '저장') =>
  '<button class="button primary" type="submit">' + esc(ui(label)) + '</button>';
const hidden = (id) => '<input type="hidden" name="id" value="' + esc(id || '') + '">';
const ownerRows = (p) => [['', ui('미지정')], ...p.members.map((m) => [m.id, m.name])];

function issueForm(
  p,
  r = {
    title: '',
    type: 'issue',
    impact: 'medium',
    probability: 'medium',
    owner: '',
    due: '',
    status: 'open',
    action: '',
    taskId: '',
  },
) {
  return (
    '<form data-pm-form="issue">' +
    hidden(r.id) +
    input('제목', 'title', r.title, 'required maxlength="200"') +
    '<div class="pm-fields">' +
    choice('유형', 'type', ['issue', 'risk'], r.type) +
    choice('영향도', 'impact', ['low', 'medium', 'high'], r.impact) +
    choice(
      '발생 가능성 (리스크)',
      'probability',
      ['low', 'medium', 'high'],
      r.probability || 'medium',
    ) +
    select('담당자', 'owner', ownerRows(p), r.owner) +
    input('기한', 'due', r.due, 'type="date"') +
    choice('상태', 'status', ['open', 'doing', 'closed'], r.status) +
    select(
      '관련 업무',
      'taskId',
      [['', ui('없음')], ...p.tasks.map((t) => [t.id, t.name])],
      r.taskId,
    ) +
    '</div>' +
    area('조치 내용·해결 결과', 'action', r.action) +
    submit() +
    '</form>'
  );
}
function milestoneForm(p, t, at) {
  return (
    '<form data-pm-form="milestone">' +
    hidden(t?.id) +
    '<div class="pm-fields">' +
    input('마일스톤명', 'name', t?.name || '', 'required maxlength="200"') +
    select('담당자', 'owner', ownerRows(p), t?.owner || '') +
    input('목표일', 'start', t?.start || at, 'type="date" required') +
    input('실제 완료일', 'doneDate', t?.doneDate || '', 'type="date" max="' + today() + '"') +
    input('선행 업무 ID (쉼표 구분)', 'predecessor', t ? predecessorIds(t).join(', ') : '') +
    '</div>' +
    submit() +
    '</form>'
  );
}
export function weeklyBody(report) {
  const s = report.snapshot,
    m = s.metrics;
  const list = (title, rows) =>
    '<section><h3>' +
    esc(ui(title)) +
    '</h3>' +
    (rows.length
      ? '<ul>' +
        rows
          .map(
            (r) =>
              '<li>' +
              esc(r.name) +
              ' · ' +
              esc(r.owner || ui('미지정')) +
              ' · ' +
              r.start +
              ' ~ ' +
              r.end +
              ' · ' +
              pct(r.progress) +
              '</li>',
          )
          .join('') +
        '</ul>'
      : '<p>' + esc(ui('없음')) + '</p>') +
    '</section>';
  const points = (key) =>
    s.curve
      .filter((r) => r[key] !== null)
      .map((r, n) => 20 + (n * 560) / Math.max(1, s.curve.length - 1) + ',' + (170 - r[key] * 140))
      .join(' ');
  return (
    '<article class="pm-report"><h2>' +
    esc(report.projectName) +
    ' · ' +
    esc(ui('주간보고')) +
    '</h2><p>' +
    report.from +
    ' ~ ' +
    report.to +
    ' · ' +
    esc(ui('발행')) +
    ' ' +
    esc(report.publishedAt) +
    '</p>' +
    '<p>' +
    esc(ui('현재 계획')) +
    ' ' +
    pct(m.plannedProgress) +
    ' · ' +
    esc(ui('실제 진척')) +
    ' ' +
    pct(m.progress) +
    ' · ' +
    num(m.done) +
    ' / ' +
    num(m.total) +
    'h</p>' +
    '<svg class="pm-curve" viewBox="0 0 600 200" role="img" aria-label="' +
    esc(ui('누적 계획·실제 진척 추이')) +
    '"><path d="M20 20V170H580" fill="none" stroke="#9aa3b4"/><polyline points="' +
    points('planned') +
    '" fill="none" stroke="#999" stroke-width="3"/><polyline points="' +
    points('actual') +
    '" fill="none" stroke="#2865d9" stroke-width="3"/>' +
    (s.baselineName
      ? '<polyline points="' +
        points('baseline') +
        '" fill="none" stroke="#a763c2" stroke-dasharray="5 4" stroke-width="2"/>'
      : '') +
    '</svg>' +
    '<p>' +
    esc(ui('회색: 현재 계획 · 파랑: 실제 진척 · 보라: 기준 계획')) +
    ' ' +
    esc(s.baselineName) +
    '</p><p class="pm-note">' +
    esc(
      ui(
        '현재 계획과 실제 진척은 현재 범위의 예상 공수 기준입니다. 기준 계획은 저장 당시 범위의 별도 비율입니다. 실제 투입시간이 아닙니다.',
      ),
    ) +
    '</p>' +
    '<h3>' +
    esc(ui('금주 설명')) +
    '</h3><p class="pm-narrative">' +
    esc(report.notes) +
    '</p>' +
    list('금주 완료 기록이 있는 업무', s.completed) +
    list('진행·미완료 업무', s.ongoing) +
    '<h3>' +
    esc(ui('차주 계획')) +
    ' (' +
    s.nextFrom +
    ' ~ ' +
    s.nextTo +
    ')</h3><p class="pm-narrative">' +
    esc(report.nextNotes) +
    '</p>' +
    list('차주 예정 업무', s.nextTasks) +
    '<h3>' +
    esc(ui('발행 시점의 주요 이슈·리스크')) +
    '</h3><ul>' +
    s.issues
      .map(
        (r) =>
          '<li><strong>' +
          esc(r.title) +
          '</strong> · ' +
          esc(ui(labels[r.type])) +
          ' · ' +
          esc(ui(labels[r.impact])) +
          ' · ' +
          esc(r.owner) +
          ' · ' +
          esc(r.due) +
          '<p class="pm-narrative">' +
          esc(r.action) +
          '</p></li>',
      )
      .join('') +
    '</ul>' +
    list('마일스톤', s.milestones) +
    '</article>'
  );
}
export function weeklyHtml(report) {
  return (
    '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    esc(report.projectName) +
    ' ' +
    report.to +
    '</title><style>body{font:15px/1.6 system-ui;max-width:900px;margin:24px auto;padding:20px;color:#17233b}svg{width:100%;max-height:240px}.pm-narrative{white-space:pre-wrap;overflow-wrap:anywhere}section{break-inside:avoid}@media print{body{margin:0}}</style><body>' +
    weeklyBody(report) +
    '</body></html>'
  );
}
export function managementView(p, at = today(), { section = 'all', page = null } = {}) {
  const showMilestones = ['all', 'planning', 'milestones'].includes(section),
    showStaffing = ['all', 'planning', 'staffing'].includes(section),
    showIssues = ['all', 'reports', 'issues'].includes(section),
    showWeekly = ['all', 'reports', 'weekly'].includes(section);
  const heading = {
    reports: ['이슈 · 보고', '이슈·리스크와 주간보고를 관리하세요.'],
    planning: ['계획 · 투입', '마일스톤과 인력 투입 기간, 월별 계획 M/M을 관리하세요.'],
    milestones: ['마일스톤', '업무의 주요 목표일과 실제 완료일을 관리하세요.'],
    staffing: ['투입 계획', '인력별 투입 기간과 투입률을 설정하고 월별 계획 M/M을 확인하세요.'],
    issues: ['이슈 · 리스크', '발생한 문제와 예상 위험의 담당자·기한·조치 상태를 관리하세요.'],
    weekly: ['주간보고', '기간별 진행 상황을 검토하고 주간보고를 발행하세요.'],
    all: ['프로젝트 관리', '마일스톤·이슈·주간보고·월별 투입 계획'],
  }[section];
  if (page && ['issues', 'milestones', 'weekly', 'staffing'].includes(section))
    return managementPageView(p, at, section, page, heading);
  const range = weekRange(at),
    plan = showStaffing ? monthlyPlan(p, at.slice(0, 7)) : null,
    readOnly = p._role === 'viewer';
  const issues = p.issues || [],
    milestones = p.tasks.filter((t) => t.kind === 'milestone');
  return (
    '<section id="pmManagement" class="pm-management"><header class="page-head"><div><h1>' +
    esc(ui(heading[0])) +
    '</h1><p>' +
    esc(ui(heading[1])) +
    '</p></div></header><p class="pm-error" role="alert"></p>' +
    (showMilestones
      ? '<details open><summary>' +
        esc(ui('마일스톤')) +
        ' (' +
        milestones.length +
        ')</summary><p>' +
        esc(
          ui('공수와 자원을 사용하지 않는 완료 시점입니다. 목표일은 휴일도 지정할 수 있습니다.'),
        ) +
        '</p>' +
        '<fieldset ' +
        (readOnly ? 'disabled' : '') +
        '><details><summary>' +
        esc(ui('마일스톤 추가')) +
        '</summary>' +
        milestoneForm(p, null, at) +
        '</details>' +
        milestones
          .map(
            (t) =>
              '<details><summary>' +
              esc(t.name) +
              ' · ' +
              t.start +
              ' · ' +
              esc(t.doneDate || ui('미완료')) +
              '</summary>' +
              milestoneForm(p, t, at) +
              '</details>',
          )
          .join('') +
        '</fieldset></details>'
      : '') +
    (showIssues
      ? '<details open><summary>' +
        esc(ui('이슈·리스크')) +
        ' (' +
        issues.length +
        ')</summary><fieldset ' +
        (readOnly ? 'disabled' : '') +
        '><details><summary>' +
        esc(ui('이슈·리스크 추가')) +
        '</summary>' +
        issueForm(p) +
        '</details>' +
        issues
          .map(
            (i) =>
              '<details><summary>' +
              esc(ui(labels[i.type])) +
              ' · ' +
              esc(i.title) +
              ' · ' +
              esc(ui(labels[i.status])) +
              ' · ' +
              esc(ui(labels[i.impact])) +
              '</summary>' +
              issueForm(p, i) +
              '</details>',
          )
          .join('') +
        '</fieldset></details>'
      : '') +
    (showWeekly
      ? '<details open><summary>' +
        esc(ui('주간보고')) +
        '</summary><p>' +
        esc(
          ui(
            '미리보기로 검토한 뒤 발행하세요. 발행한 보고서는 작업·계획·이슈를 바꿔도 유지되며 수정·삭제할 수 없습니다. 정정 시 새 보고서를 발행하세요.',
          ),
        ) +
        '</p><fieldset ' +
        (readOnly ? 'disabled' : '') +
        '><form data-pm-form="weekly"><div class="pm-fields">' +
        input('금주 시작일', 'from', range.from, 'type="date" required') +
        input('금주 종료일', 'to', range.to, 'type="date" required max="' + today() + '"') +
        '</div>' +
        area('금주 설명', 'notes') +
        area('차주 설명', 'nextNotes') +
        submit('주간보고 미리보기') +
        '</form><div id="pmWeeklyPreview"></div></fieldset>' +
        [...(p.weeklyReports || [])]
          .reverse()
          .map(
            (r) =>
              '<details data-pm-report="' +
              esc(r.id) +
              '"><summary>' +
              r.from +
              ' ~ ' +
              r.to +
              ' · ' +
              esc(r.publishedAt) +
              '</summary><button type="button" class="button" data-pm-export="' +
              esc(r.id) +
              '">' +
              esc(ui('보고서 HTML 내려받기')) +
              '</button>' +
              '<div data-pm-report-body="' +
              esc(r.id) +
              '"></div>' +
              '</details>',
          )
          .join('') +
        '</details>'
      : '') +
    (showStaffing
      ? '<details open><summary>' +
        esc(ui('월별 계획 M/M')) +
        '</summary><p>' +
        esc(
          ui(
            '기간별 계획이 있으면 계획 투입률을 사용하고 기간 밖은 0%입니다. 계획이 없거나 마지막 기간을 삭제하면 인력의 기본 투입률을 사용합니다. 예측·과부하·계획 M/M에 함께 적용됩니다. 160h는 편집 가능한 환산 기준이며 실제 투입 실적은 수집하지 않습니다.',
          ),
        ) +
        '</p>' +
        '<fieldset ' +
        (readOnly ? 'disabled' : '') +
        '><form data-pm-form="mm-basis">' +
        input(
          '1 M/M 기준 시간',
          'hoursPerMM',
          plan.hoursPerMM,
          'type="number" min="1" max="400" step="0.1" required',
        ) +
        submit('환산 기준 저장') +
        '</form><form data-pm-form="staffing"><h3>' +
        esc(ui('투입 기간 추가')) +
        '</h3><div class="pm-fields">' +
        select(
          '인력',
          'memberId',
          p.members.map((m) => [m.id, m.name]),
        ) +
        input('투입 시작일', 'start', at, 'type="date" required') +
        input('투입 종료일', 'end', at, 'type="date" required') +
        input(
          '투입률 (%)',
          'allocation',
          100,
          'type="number" min="0.1" max="100" step="0.1" required',
        ) +
        '</div>' +
        submit() +
        '</form></fieldset>' +
        '<label class="field">' +
        esc(ui('조회 월')) +
        '<input type="month" id="pmPlanMonth" value="' +
        at.slice(0, 7) +
        '"></label><div id="pmPlanResult">' +
        monthlyTable(p, at.slice(0, 7)) +
        '</div>' +
        '<ul>' +
        (p.staffing?.assignments || [])
          .map(
            (a) =>
              '<li>' +
              esc(p.members.find((m) => m.id === a.memberId)?.name) +
              ' · ' +
              a.start +
              ' ~ ' +
              a.end +
              ' · ' +
              a.allocation +
              '% ' +
              (readOnly
                ? ''
                : '<button type="button" class="button small" data-pm-remove-assignment="' +
                  esc(a.id) +
                  '">' +
                  esc(ui('삭제')) +
                  '</button>') +
              '</li>',
          )
          .join('') +
        '</ul></details>'
      : '') +
    '</section>'
  );
}
function managementPageView(p, at, section, page, heading) {
  const readOnly = p._role === 'viewer';
  const records =
    section === 'issues'
      ? p.issues || []
      : section === 'milestones'
        ? p.tasks.filter((t) => t.kind === 'milestone')
        : section === 'weekly'
          ? [...(p.weeklyReports || [])].reverse()
          : p.staffing?.assignments || [];
  const record = records.find((r) => r.id === page.id);
  const panes =
    section === 'weekly'
      ? ['list', 'add', 'report']
      : section === 'staffing'
        ? ['list', 'add', 'basis']
        : ['list', 'add', 'edit'];
  let pane = panes.includes(page.pane) ? page.pane : 'list';
  if (
    (['edit', 'report'].includes(pane) && !record) ||
    (readOnly && ['add', 'edit', 'basis'].includes(pane))
  )
    pane = 'list';
  const labelsForSection = {
    issues: ['이슈·리스크 목록', '이슈·리스크 추가', '이슈·리스크 수정'],
    milestones: ['마일스톤 목록', '마일스톤 추가', '마일스톤 수정'],
    weekly: ['발행 목록', '주간보고 작성', '보고서 보기'],
    staffing: ['투입 목록 · 월별 계획', '투입 기간 추가', '환산 기준'],
  }[section];
  const action = (label, target, id = '') =>
    '<button type="button" class="button small" data-management-pane="' +
    target +
    '" data-management-id="' +
    esc(id) +
    '">' +
    esc(ui(label)) +
    '</button>';
  const nav =
    '<div class="management-page-nav head-actions">' +
    (pane === 'list'
      ? (!readOnly
          ? action(labelsForSection[1], 'add').replace('button small', 'button primary')
          : '') + (section === 'staffing' && !readOnly ? action('환산 기준', 'basis') : '')
      : action('← 목록으로', 'list')) +
    '</div>';
  const table = (headers, rows) =>
    rows.length
      ? '<div class="desktop-table-wrap"><table class="desktop-table"><thead><tr>' +
        headers.map((h) => '<th>' + esc(ui(h)) + '</th>').join('') +
        '</tr></thead><tbody>' +
        rows
          .map((cells) => '<tr>' + cells.map((cell) => '<td>' + cell + '</td>').join('') + '</tr>')
          .join('') +
        '</tbody></table></div>'
      : '<p class="management-empty">' + esc(ui('등록된 항목이 없습니다.')) + '</p>';
  const owner = (id) => esc(p.members.find((m) => m.id === id)?.name || ui('미지정'));
  let body = '',
    title = labelsForSection[0];
  if (pane === 'list') {
    if (section === 'issues')
      body = table(
        ['유형', '제목', '담당자', '기한', '상태', '영향도', '작업'],
        records.map((r) => [
          esc(ui(labels[r.type])),
          esc(r.title),
          owner(r.owner),
          esc(r.due || '—'),
          esc(ui(labels[r.status])),
          esc(ui(labels[r.impact])),
          readOnly ? '' : action('수정', 'edit', r.id),
        ]),
      );
    if (section === 'milestones')
      body = table(
        ['마일스톤명', '담당자', '목표일', '실제 완료일', '작업'],
        records.map((r) => [
          esc(r.name),
          owner(r.owner),
          esc(r.start),
          esc(r.doneDate || ui('미완료')),
          readOnly ? '' : action('수정', 'edit', r.id),
        ]),
      );
    if (section === 'weekly')
      body = table(
        ['기간', '발행', '작업'],
        records.map((r) => [
          esc(r.from + ' ~ ' + r.to),
          esc(r.publishedAt),
          action('보기', 'report', r.id),
        ]),
      );
    if (section === 'staffing')
      body =
        '<p>' +
        esc(
          ui(
            '기간별 계획이 있으면 계획 투입률을 사용하고 기간 밖은 0%입니다. 계획이 없거나 마지막 기간을 삭제하면 인력의 기본 투입률을 사용합니다. 예측·과부하·계획 M/M에 함께 적용됩니다. 160h는 편집 가능한 환산 기준이며 실제 투입 실적은 수집하지 않습니다.',
          ),
        ) +
        '</p><label class="field">' +
        esc(ui('조회 월')) +
        '<input type="month" id="pmPlanMonth" value="' +
        at.slice(0, 7) +
        '"></label><div id="pmPlanResult">' +
        monthlyTable(p, at.slice(0, 7)) +
        '</div><h3>' +
        esc(ui('투입 기간 목록')) +
        '</h3>' +
        table(
          ['인력', '투입 시작일', '투입 종료일', '투입률 (%)', '작업'],
          records.map((r) => [
            owner(r.memberId),
            esc(r.start),
            esc(r.end),
            esc(r.allocation),
            readOnly
              ? ''
              : '<button type="button" class="button small" data-pm-remove-assignment="' +
                esc(r.id) +
                '">' +
                esc(ui('삭제')) +
                '</button>',
          ]),
        );
  } else if (pane === 'report') {
    title = labelsForSection[2];
    body =
      '<button type="button" class="button" data-pm-export="' +
      esc(record.id) +
      '">' +
      esc(ui('보고서 HTML 내려받기')) +
      '</button><div data-pm-report-body="' +
      esc(record.id) +
      '">' +
      weeklyBody(record) +
      '</div>';
  } else {
    title = pane === 'add' ? labelsForSection[1] : labelsForSection[2];
    if (section === 'issues') body = issueForm(p, pane === 'edit' ? record : undefined);
    if (section === 'milestones')
      body =
        '<p>' +
        esc(
          ui('공수와 자원을 사용하지 않는 완료 시점입니다. 목표일은 휴일도 지정할 수 있습니다.'),
        ) +
        '</p>' +
        milestoneForm(p, pane === 'edit' ? record : null, at);
    if (section === 'weekly') {
      const range = weekRange(at);
      body =
        '<p>' +
        esc(
          ui(
            '미리보기로 검토한 뒤 발행하세요. 발행한 보고서는 작업·계획·이슈를 바꿔도 유지되며 수정·삭제할 수 없습니다. 정정 시 새 보고서를 발행하세요.',
          ),
        ) +
        '</p><form data-pm-form="weekly"><div class="pm-fields">' +
        input('금주 시작일', 'from', range.from, 'type="date" required') +
        input('금주 종료일', 'to', range.to, 'type="date" required max="' + today() + '"') +
        '</div>' +
        area('금주 설명', 'notes') +
        area('차주 설명', 'nextNotes') +
        submit('주간보고 미리보기') +
        '</form><div id="pmWeeklyPreview"></div>';
    }
    if (section === 'staffing')
      body =
        pane === 'basis'
          ? '<form data-pm-form="mm-basis">' +
            input(
              '1 M/M 기준 시간',
              'hoursPerMM',
              monthlyPlan(p, at.slice(0, 7)).hoursPerMM,
              'type="number" min="1" max="400" step="0.1" required',
            ) +
            submit('환산 기준 저장') +
            '</form>'
          : '<form data-pm-form="staffing"><div class="pm-fields">' +
            select(
              '인력',
              'memberId',
              p.members.map((m) => [m.id, m.name]),
            ) +
            input('투입 시작일', 'start', at, 'type="date" required') +
            input('투입 종료일', 'end', at, 'type="date" required') +
            input(
              '투입률 (%)',
              'allocation',
              100,
              'type="number" min="0.1" max="100" step="0.1" required',
            ) +
            '</div>' +
            submit() +
            '</form>';
  }
  return (
    '<section id="pmManagement" class="pm-management"><header class="page-head"><div><h1>' +
    esc(ui(heading[0])) +
    '</h1><p>' +
    esc(ui(heading[1])) +
    '</p></div>' +
    nav +
    '</header><p class="pm-error" role="alert"></p>' +
    '<section class="panel management-page"><h2>' +
    esc(ui(title)) +
    '</h2>' +
    body +
    '</section></section>'
  );
}
function monthlyTable(p, month) {
  const result = monthlyPlan(p, month);
  return (
    '<div class="pm-table-scroll"><table><caption>' +
    result.from +
    ' ~ ' +
    result.to +
    ' · 1 M/M = ' +
    result.hoursPerMM +
    'h</caption><thead><tr>' +
    ['인력', '투입 계획(h)', '계획 M/M', '업무 계획 공수(h)', '집계 기준']
      .map((l) => '<th>' + esc(ui(l)) + '</th>')
      .join('') +
    '</tr></thead><tbody>' +
    result.rows
      .map(
        (r) =>
          '<tr><td>' +
          esc(r.name) +
          '</td><td>' +
          num(r.hours) +
          '</td><td>' +
          num(r.mm) +
          '</td><td>' +
          num(r.workload) +
          '</td><td>' +
          esc(ui(r.basis === 'period' ? '기간별 계획' : '기본 투입률로 추정')) +
          '</td></tr>',
      )
      .join('') +
    '</tbody><tfoot><tr><th>' +
    esc(ui('합계')) +
    '</th><td>' +
    num(result.hours) +
    '</td><td>' +
    num(result.mm) +
    '</td><td></td><td>' +
    (result.estimatedHours > 0 ? esc(ui('추정값 포함')) : '') +
    '</td></tr></tfoot></table></div>' +
    (result.estimatedHours > 0
      ? '<p class="form-hint pm-plan-estimate-note">' +
        esc(ui('합계에 기본 투입률로 추정한 값이 포함됩니다.')) +
        ' ' +
        num(result.estimatedHours) +
        'h · ' +
        num(result.estimatedMM) +
        ' M/M. ' +
        esc(
          ui(
            '투입 기간이 없는 인력은 업무 기간 밖에서도 기본 투입률로 계산합니다. 실제 투입 실적이나 등록한 기간별 계획을 뜻하지 않습니다.',
          ),
        ) +
        '</p>'
      : '')
  );
}
export function applyManagementForm(p, kind, form, { at = today(), uid = projectUid } = {}) {
  const v = (key) => String(form.get(key) || '').trim();
  if (kind === 'milestone') {
    const next = structuredClone(p),
      existing = next.tasks.find((t) => t.id === v('id'));
    if (existing && existing.kind !== 'milestone') throw Error('마일스톤을 확인해 주세요.');
    const t = existing || newTask(p, { id: uid, milestone: true });
    t.name = v('name');
    t.owner = v('owner');
    t.start = t.end = v('start');
    t.doneDate = v('doneDate') || null;
    if (!existing) next.tasks.push(t);
    setCell(next, t, 'predecessor', v('predecessor'));
    validateProject(next);
    validatePlanning(next);
    return next;
  }
  if (kind === 'issue')
    return managementChange(p, kind, {
      id: v('id') || uid(),
      title: v('title'),
      type: v('type'),
      impact: v('impact'),
      probability: v('probability'),
      owner: v('owner'),
      taskId: v('taskId'),
      due: v('due'),
      status: v('status'),
      action: v('action'),
    });
  if (kind === 'staffing')
    return managementChange(p, kind, {
      hoursPerMM: p.staffing?.hoursPerMM || 160,
      assignment: {
        id: uid(),
        memberId: v('memberId'),
        start: v('start'),
        end: v('end'),
        allocation: Number(v('allocation')),
      },
    });
  if (kind === 'mm-basis')
    return managementChange(p, kind, { hoursPerMM: Number(v('hoursPerMM')) });
  throw Error('관리 입력을 확인해 주세요.');
}
export function installManagementUi({
  document = globalThis.document,
  project,
  save,
  toast,
  getDate = today,
  canChange = () => true,
  onDirtyChange = () => {},
  confirmDiscard = (message) => globalThis.confirm(message),
  exportReport = null,
  savedMessage = '저장했습니다.',
  publishedMessage = '주간보고를 발행했습니다.',
}) {
  let preview = null,
    pending = false;
  const dirty = () => Boolean(document.querySelector('#pmManagement [data-pm-dirty]'));
  const persist = async (next, submitted = null) => {
    const drafts = [...document.querySelectorAll('#pmManagement form[data-pm-dirty]')]
      .filter((f) => f !== submitted)
      .map((f) => ({
        kind: f.dataset.pmForm,
        id: new FormData(f).get('id') || '',
        values: [...new FormData(f)],
      }));
    await save(next);
    for (const draft of drafts) {
      const form = [...document.querySelectorAll('#pmManagement form')].find(
        (f) => f.dataset.pmForm === draft.kind && (new FormData(f).get('id') || '') === draft.id,
      );
      if (!form) continue;
      for (const [name, value] of draft.values) {
        const control = form.elements.namedItem(name);
        if (control) control.value = value;
      }
      form.dataset.pmDirty = 'true';
      for (
        let parent = form.parentElement;
        parent && parent.id !== 'pmManagement';
        parent = parent.parentElement
      )
        if (parent.tagName === 'DETAILS') parent.open = true;
    }
    onDirtyChange(dirty());
  };
  const fail = (error) => {
    const el = document.querySelector('#pmManagement .pm-error');
    if (el) el.textContent = ui(error.message);
    toast(ui(error.message));
  };
  const change = async (operation) => {
    if (pending || project()?._role === 'viewer' || !canChange()) return;
    const root = document.querySelector('#pmManagement');
    pending = true;
    if (root) root.inert = true;
    try {
      await operation();
    } catch (error) {
      fail(error);
    } finally {
      pending = false;
      if (root?.isConnected) root.inert = false;
      onDirtyChange(dirty());
    }
  };
  document.addEventListener(
    'toggle',
    (event) => {
      const details = event.target;
      if (!details.open || !details.dataset?.pmReport) return;
      const host = details.querySelector('[data-pm-report-body]'),
        report = project()?.weeklyReports?.find((r) => r.id === details.dataset.pmReport);
      if (host && report && !host.hasChildNodes()) host.innerHTML = weeklyBody(report);
    },
    true,
  );
  document.addEventListener('input', (event) => {
    const form = event.target.closest('#pmManagement form');
    if (form) {
      form.dataset.pmDirty = 'true';
      onDirtyChange(true);
    }
    if (form?.dataset.pmForm === 'weekly') {
      preview = null;
      const host = document.querySelector('#pmWeeklyPreview');
      if (host) host.innerHTML = '';
    }
  });
  document.addEventListener('change', (event) => {
    if (event.target.id === 'pmPlanMonth')
      try {
        document.querySelector('#pmPlanResult').innerHTML = monthlyTable(
          project(),
          event.target.value,
        );
      } catch (e) {
        fail(e);
      }
    const form = event.target.closest('#pmManagement form');
    if (form) {
      form.dataset.pmDirty = 'true';
      onDirtyChange(true);
    }
  });
  document.addEventListener('submit', (event) => {
    const form = event.target.closest('#pmManagement form');
    if (!form) return;
    event.preventDefault();
    void change(async () => {
      const f = new FormData(form),
        p = project();
      if (form.dataset.pmForm === 'weekly') {
        const report = weeklyDraft(p, Object.fromEntries(f));
        preview = { report, project: JSON.stringify(p), fields: JSON.stringify([...f]) };
        document.querySelector('#pmWeeklyPreview').innerHTML =
          weeklyBody(report) +
          '<button type="button" class="button primary" data-pm-publish>' +
          esc(ui('이 내용으로 발행')) +
          '</button>';
      } else {
        await persist(applyManagementForm(p, form.dataset.pmForm, f, { at: getDate() }), form);
        onDirtyChange(dirty());
        toast(ui(savedMessage));
      }
    });
  });
  document.addEventListener('click', (event) => {
    const publish = event.target.closest('[data-pm-publish]'),
      remove = event.target.closest('[data-pm-remove-assignment]'),
      exportButton = event.target.closest('[data-pm-export]');
    if (exportButton) {
      const report = project()?.weeklyReports?.find((r) => r.id === exportButton.dataset.pmExport);
      if (!report) return;
      if (exportReport) {
        void exportReport(report).catch(fail);
        return;
      }
      const url = URL.createObjectURL(
          new Blob([weeklyHtml(report)], { type: 'text/html;charset=utf-8' }),
        ),
        a = document.createElement('a');
      a.href = url;
      a.download = 'PM-Weekly-' + report.to + '.html';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    if (!publish && !remove) return;
    void change(async () => {
      const p = project();
      if (remove)
        await persist(
          managementChange(p, 'remove-assignment', { id: remove.dataset.pmRemoveAssignment }),
        );
      else {
        const form = document.querySelector('[data-pm-form="weekly"]');
        if (
          !preview ||
          preview.project !== JSON.stringify(p) ||
          preview.fields !== JSON.stringify([...new FormData(form)])
        )
          throw Error('내용이 변경되었습니다. 주간보고를 다시 미리보기 해 주세요.');
        const next = structuredClone(p);
        next.weeklyReports = [...(p.weeklyReports || []), preview.report];
        Object.assign(next, cleanManagement(next, next));
        await persist(next, form);
        onDirtyChange(dirty());
        preview = null;
        toast(ui(publishedMessage));
      }
    });
  });
  return {
    dirty,
    pending: () => pending,
    reset: (form) => {
      if (pending || !form?.matches('#pmManagement form')) return;
      form.reset();
      delete form.dataset.pmDirty;
      if (form.dataset.pmForm === 'weekly') {
        preview = null;
        const host = document.querySelector('#pmWeeklyPreview');
        if (host) host.innerHTML = '';
      }
      const error = document.querySelector('#pmManagement .pm-error');
      if (error) error.textContent = '';
      onDirtyChange(dirty());
    },
    leave: () => {
      if (pending) return false;
      if (!dirty()) return true;
      const finish = (confirmed) => {
        if (!confirmed) return false;
        document.querySelectorAll('#pmManagement [data-pm-dirty]').forEach((form) => {
          form.reset();
          delete form.dataset.pmDirty;
        });
        preview = null;
        const host = document.querySelector('#pmWeeklyPreview');
        if (host) host.innerHTML = '';
        onDirtyChange(false);
        return true;
      };
      const decision = confirmDiscard(ui('저장하지 않은 관리 입력을 버리고 이동할까요?'));
      return decision?.then ? decision.then(finish) : finish(decision);
    },
  };
}
