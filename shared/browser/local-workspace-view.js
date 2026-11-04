// Shared by the offline desktop and mobile workspaces. Platform code owns
// navigation, persistence and input events; screen content stays identical.
import { taskView, taskLeaves, taskIndex } from './task-model.js';
import { taskHours, progress, daysBetween } from './engine.js';
import { escapeHtml as esc } from './html.js';
import { ui } from './i18n.js';
import { dashboardVisuals } from './dashboard-view.js';
import { person, num, pct, meter, badge, pageHead, btn, empty, projectStart } from './view-ui.js';

export function workspaceTaskTable(p, s, { asOf, tasks = p.tasks }) {
  const index = taskIndex(p);
  if (!tasks.length)
    return ui('<div class="desktop-note" style="padding:24px">표시할 업무가 없습니다.</div>');
  return (
    ui(
      '<div class="desktop-table-wrap workspace-results"><table class="desktop-table"><thead><tr><th>업무</th><th>담당자</th><th>계획 일정</th><th>공수</th><th>진척률</th><th>예상 완료일</th><th>상태</th></tr></thead><tbody>',
    ) +
    tasks
      .map((task) => taskView(p, task, index))
      .map(
        (task) =>
          '<tr><td data-label="업무"><button class="task-name" data-edit-task="' +
          esc(task.id) +
          '">' +
          esc(task.name) +
          '</button><span class="task-phase">' +
          esc(task.phase || ui('일반')) +
          '</span></td><td data-label="담당자">' +
          person(p, task.owner) +
          '</td><td data-label="계획 일정">' +
          task.start +
          '<br>' +
          task.end +
          '</td><td data-label="공수">' +
          num(taskHours(task)) +
          'h</td><td data-label="진척률">' +
          pct(progress(task, asOf)) +
          meter(progress(task, asOf)) +
          '</td><td data-label="예상 완료일">' +
          (s.forecast.tasks[task.id]?.end || ui('계산 대기')) +
          '</td><td data-label="상태">' +
          badge(task, asOf) +
          '</td></tr>',
      )
      .join('') +
    '</tbody></table></div>'
  );
}
export function workspaceGantt(p, tasks, asOf) {
  const index = taskIndex(p);
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
    ui('</span><span>계획 일정 · 파란색은 현재 진척률</span><span>') +
    end +
    '</span></div>' +
    tasks
      .map((task) => taskView(p, task, index))
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
          progress(task, asOf) * 100 +
          '%"></i></div></div></div>',
      )
      .join('') +
    '</div>'
  );
}
export function workspaceOverview(p, s, { asOf, controls = '' }) {
  const heading = pageHead(
    'PROJECT OVERVIEW',
    ui('프로젝트 현황'),
    p.description || ui('오늘의 기록으로 프로젝트의 다음 일정을 확인하세요.'),
    btn(ui('＋ 업무 추가'), 'task', 'primary'),
  );
  if (!p.tasks.length) return heading + projectStart(p);
  return (
    heading +
    controls +
    '<section class="desktop-summary-grid">' +
    ui('<article class="desktop-metric"><small>실제 진척률</small><strong>') +
    pct(s.progress) +
    '</strong>' +
    meter(s.progress) +
    ui('<p>계획 진척률 ') +
    pct(s.planned) +
    ui(' · 공수 가중</p></article>') +
    ui(
      '<article class="desktop-metric"><small>예상 완료일</small><strong style="font-size:23px">',
    ) +
    (s.forecast.end || ui('계산 대기')) +
    '</strong><p>' +
    (s.forecast.observed ? ui('최근 완료 속도 반영') : ui('계획 · 가용시간 기준 추정')) +
    '</p></article>' +
    ui('<article class="desktop-metric"><small>완료한 업무</small><strong>') +
    s.completed +
    '<span style="font-size:15px;color:#9aa3b4"> / ' +
    taskLeaves(p).length +
    '</span></strong><p>' +
    num(s.done) +
    'h / ' +
    num(s.total) +
    ui('h 완료</p></article>') +
    ui('<article class="desktop-metric"><small>기한을 넘긴 업무</small><strong>') +
    s.overdue +
    ui(
      '<span style="font-size:15px">개</span></strong><p>미완료 업무 중 계획 종료일 경과</p></article></section>',
    ) +
    dashboardVisuals(p, s, asOf) +
    ui(
      '<section class="panel"><div class="desktop-section-head"><h2>업무 진행 현황</h2><button class="button small" data-go="daily">완료 체크 →</button></div>',
    ) +
    workspaceTaskTable(p, s, { asOf }) +
    '</section>' +
    ui(
      '<p class="desktop-note">보고 기준일 업무 종료 기준으로 남은 작업을 다음 근무일부터 배정합니다. 예상 완료일은 계획 일정·담당자 가용시간·완료 기록을 바탕으로 계산합니다. 등급은 분류에만 사용합니다.<br>토·일요일과 프로젝트 설정의 휴무일을 제외합니다. 완료 기록이 부족하면 계획 기준으로 추정합니다.</p>',
    )
  );
}
export function workspaceTasks(p, s, { asOf, tasks = p.tasks, controls = '' }) {
  return (
    pageHead(
      'WORK & SCHEDULE',
      ui('업무 · 일정'),
      ui('업무 목록과 계획 간트를 확인하고, 업무 이름을 눌러 일정을 수정하세요.'),
      btn(ui('＋ 업무 추가'), 'task', 'primary'),
    ) +
    controls +
    '<section class="panel">' +
    workspaceTaskTable(p, s, { asOf, tasks }) +
    '</section>' +
    ui('<h2 style="font-size:15px;margin:28px 0 14px">계획 간트</h2>') +
    workspaceGantt(p, tasks, asOf) +
    ui(
      '<p class="desktop-note">업무 이름을 누르면 일정·담당자·선행 업무·체크리스트를 수정할 수 있습니다.</p>',
    )
  );
}
export function workspaceDaily(p, { asOf, tasks, controls = '' }) {
  return (
    pageHead(
      'DAILY CHECK-IN',
      ui('완료 체크'),
      ui('실제로 완료한 세부 작업만 체크하세요. 보고 기준일이 완료일로 기록됩니다.'),
      '',
    ) +
    ui(
      '<p class="desktop-note" data-completion-hint>완료한 작업을 체크하면 진척률과 예상 완료일이 함께 바뀝니다.</p>',
    ) +
    controls +
    (tasks.length
      ? tasks
          .map(
            (task) =>
              '<article class="panel check-panel"><div class="check-task-head"><div><span class="eyebrow">' +
              esc(task.phase || ui('일반')) +
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
              badge(task, asOf) +
              '</div></div><strong>' +
              pct(progress(task, asOf)) +
              '</strong></div><div class="check-items">' +
              (task.kind === 'milestone'
                ? [
                    {
                      id: '__milestone',
                      title: ui('마일스톤 완료'),
                      hours: 0,
                      doneDate: task.doneDate,
                    },
                  ]
                : task.items
              )
                .map((item) => {
                  const later = item.doneDate && item.doneDate > asOf;
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
                    (item.doneDate
                      ? (later ? ui('이후 완료 · ') : ui('완료 · ')) + item.doneDate
                      : '') +
                    '</small></label>'
                  );
                })
                .join('') +
              '</div></article>',
          )
          .join('')
      : p.tasks.length
        ? ui(
            '<div class="empty-state"><h3>검색 결과가 없습니다</h3><p>검색어나 담당자 필터를 바꿔 보세요.</p><button class="button" data-reset-filters>필터 초기화</button></div>',
          )
        : empty(
            ui('체크할 업무가 없습니다'),
            ui('업무와 세부 작업을 먼저 추가해 주세요.'),
            'task',
            ui('업무 추가'),
          ))
  );
}
