import { ui } from './i18n.js';
export function myWorkView({ projects, esc, progress, today, projectMode, canLink = false }) {
  const tasks = projects.flatMap((p) => p.tasks.map((t) => ({ p, t }))),
    pending = tasks.filter(({ t }) => progress(t, today) < 1),
    late = pending.filter(({ t }) => t.end < today),
    current = pending.filter(({ t }) => t.end >= today && t.start <= today),
    future = pending.filter(({ t }) => t.start > today);
  const cards = (rows) =>
    rows
      .sort((a, b) => a.t.end.localeCompare(b.t.end))
      .map(
        ({ p, t }) =>
          '<button class="my-work-card panel" data-my-project="' +
          esc(p.id) +
          '" data-my-task="' +
          esc(t.id) +
          '"><span><small>' +
          esc(p.name) +
          '</small><strong>' +
          esc(t.name) +
          '</strong><small>' +
          esc(t.start) +
          ' — ' +
          esc(t.end) +
          '</small></span><b>' +
          Math.round(progress(t, today) * 100) +
          '%</b></button>',
      )
      .join('');
  return (
    ui(
      '<section class="page-head"><div><span class="eyebrow">MY WORK</span><h1>내 업무</h1><p>여러 프로젝트의 담당 업무를 한곳에서 확인하고 완료하세요.</p></div></section>',
    ) +
    projectMode +
    ui('<div class="my-work-counts"><span>지연 <b>') +
    late.length +
    ui('</b></span><span>진행 일정 <b>') +
    current.length +
    ui('</b></span><span>예정 <b>') +
    future.length +
    '</b></span></div>' +
    (!tasks.length
      ? ui('<div class="empty-state"><h3>아직 연결된 내 업무가 없습니다</h3><p>') +
        (canLink
          ? ui('프로젝트 공유에서 참여인력에 내 계정을 연결하면 담당 업무가 표시됩니다.')
          : ui('프로젝트 소유자에게 참여인력과 내 계정 연결을 요청해 주세요.')) +
        '</p>' +
        (canLink
          ? ui('<button class="button primary" data-action="sharing">담당 계정 연결</button>')
          : '') +
        '</div>'
      : [
          [ui('지연된 업무'), late],
          [ui('진행 일정'), current],
          [ui('예정된 업무'), future],
        ]
          .map(([label, rows]) =>
            rows.length
              ? '<section class="my-work-section"><h2>' +
                label +
                ' <small>' +
                rows.length +
                '</small></h2>' +
                cards(rows) +
                '</section>'
              : '',
          )
          .join('') +
        ui('<details class="my-work-section"><summary>완료한 업무 ') +
        (tasks.length - pending.length) +
        ui('개</summary>') +
        cards(tasks.filter(({ t }) => progress(t, today) === 1)) +
        '</details>')
  );
}
