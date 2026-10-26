import { escapeHtml as esc } from './html.js';
import { today, progress } from './engine.js';
const TODAY = today();
const palette = ['#416be8', '#27a498', '#ae7ad8', '#df9a40', '#de718c', '#66849e'];
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
function avatar(p, m, size = '') {
  const idx = p.members.findIndex((x) => x.id === m?.id),
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
function person(p, id) {
  const m = p.members.find((m) => m.id === id);
  return m
    ? '<span class="person">' + avatar(p, m, 'tiny') + esc(m.name) + '</span>'
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
function badge(t, asOf) {
  const v = progress(t, asOf);
  if (v === 1) return '<span class="badge green">완료</span>';
  if (t.end < asOf) return '<span class="badge red">지연</span>';
  if (v > 0) return '<span class="badge blue">진행 중</span>';
  return '<span class="badge neutral">예정</span>';
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
function dateToolbar(asOf, extra = '') {
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

export {
  palette,
  icon,
  pct,
  num,
  short,
  full,
  btn,
  avatar,
  person,
  meter,
  badge,
  pageHead,
  dateToolbar,
  empty,
};

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

export { field };
