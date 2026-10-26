import { escapeHtml as esc } from './html.js';
import { addDays, daysBetween, workdays, taskHours, earned, planned, progress } from './engine.js';
import {
  palette,
  icon,
  pct,
  num,
  short,
  full,
  btn,
  avatar,
  meter,
  badge,
  pageHead,
  dateToolbar,
  empty,
} from './view-ui.js';
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

export function dashboardView(p, s, asOf) {
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
      asOf,
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
      .map((m) => avatar(p, m, 'tiny'))
      .join('') +
    '</span></div><div class="metric-foot">투입률 합계 <strong>' +
    num(eff) +
    '명분</strong></div><div class="subtle">등급은 인력 정보로만 사용합니다</div></article></section>' +
    '<section class="analysis-grid"><article class="panel chart-panel"><div class="panel-head"><div><h2>프로젝트 진척 추이</h2><p>계획과 실제의 차이를 확인하세요</p></div><div class="legend"><span class="plan-dot">계획</span><span class="actual-dot">실제</span><span class="forecast-dot">예상</span></div></div>' +
    progressChart(p, s, asOf) +
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
    gantt(p, s, asOf) +
    '</section>' +
    '<section class="bottom-grid"><article class="panel"><div class="panel-head"><div><h2>지금 확인할 업무 <span class="count">' +
    p.tasks.filter((t) => progress(t, asOf) < 1 && t.start <= asOf).length +
    '</span></h2></div>' +
    btn('매일 작업 체크 →', 'view:daily', 'link') +
    '</div>' +
    attention(p, s, asOf) +
    '</article><article class="panel"><div class="panel-head"><h2>참여인력별 진척</h2>' +
    btn('인력 관리 →', 'view:people', 'link') +
    '</div>' +
    peopleProgress(p, asOf) +
    '</article></section>'
  );
}
function progressChart(p, s, asOf) {
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
function gantt(p, s, asOf) {
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
          m = p.members.find((m) => m.id === t.owner),
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
function attention(p, s, asOf) {
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
              esc(p.members.find((m) => m.id === t.owner)?.name || '미지정') +
              ' · ' +
              short(t.end) +
              ' 계획 완료</small></span>' +
              badge(t, asOf) +
              '<span class="mini-progress">' +
              pct(progress(t, asOf)) +
              '</span></button>',
          )
          .join('') +
        '</div>'
    : '<div class="calm-state">현재 확인할 진행 업무가 없습니다.</div>';
}
function peopleProgress(p, asOf) {
  return p.members.length
    ? '<div class="people-progress">' +
        p.members
          .map((m) => {
            const ts = p.tasks.filter((t) => t.owner === m.id),
              total = ts.reduce((s, t) => s + taskHours(t), 0),
              done = ts.reduce((s, t) => s + earned(t, asOf), 0);
            return (
              '<div class="people-progress-row">' +
              avatar(p, m) +
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
