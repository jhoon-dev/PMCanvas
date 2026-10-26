import { escapeHtml as esc } from './html.js';
import { today, progress } from './engine.js';
import { myWorkView } from './my-work-ui.js';
import {
  icon,
  pct,
  num,
  short,
  full,
  btn,
  person,
  badge,
  meter,
  pageHead,
  dateToolbar,
  empty,
} from './view-ui.js';
function filterControls(p, { query, ownerFilter, statusFilter }) {
  return (
    '<div class="filter-controls"><input type="search" id="taskSearch" placeholder="업무 검색" value="' +
    esc(query) +
    '" aria-label="업무 검색"><select id="ownerFilter" aria-label="담당자 필터"><option value="">전체 담당자</option>' +
    p.members
      .map(
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
export function filteredTasks(p, { asOf, ownerFilter = '', statusFilter = '', query = '' }) {
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
export function dailyView(
  p,
  {
    asOf,
    ownerFilter = '',
    statusFilter = '',
    query = '',
    onlyPending = false,
    dailyMode = 'mine',
    myProjects = [],
    currentDate = today(),
  },
) {
  const toggle =
    '<div class="daily-mode"><button class="button small ' +
    (dailyMode === 'mine' ? 'primary' : '') +
    '" data-daily-mode="mine">내 업무</button><button class="button small ' +
    (dailyMode === 'project' ? 'primary' : '') +
    '" data-daily-mode="project">프로젝트 전체</button></div>';
  if (dailyMode === 'mine')
    return myWorkView({
      projects: myProjects,
      esc,
      progress,
      today: currentDate,
      projectMode: toggle,
      canLink: p._role === 'owner',
    });
  const ts = filteredTasks(p, { asOf, ownerFilter, statusFilter, query }),
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
    dateToolbar(asOf, filterControls(p, { query, ownerFilter, statusFilter })) +
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
              person(p, t.owner) +
              '<span>' +
              short(t.start) +
              ' — ' +
              short(t.end) +
              '</span>' +
              badge(t, asOf) +
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

export async function recordCompletion({
  project: p,
  taskId,
  itemId,
  checked,
  asOf,
  currentDate = today(),
  persist,
  onRender,
  toast,
}) {
  const t = p.tasks.find((t) => t.id === taskId),
    i = t?.items.find((i) => i.id === itemId);
  if (!i) return;
  if (asOf > currentDate) {
    toast('미래 날짜에는 완료를 기록할 수 없습니다.');
    onRender();
    return;
  }
  i.doneDate = checked ? asOf : null;
  const saved = await persist();
  onRender();
  toast(
    saved
      ? i.doneDate
        ? '완료 기록을 저장했습니다. 진척률과 예상일을 갱신했어요.'
        : '완료 체크를 취소했습니다.'
      : '저장 실패 · 현재 데이터를 백업해 주세요.',
  );
}
