import { today, validDate, addDays } from './engine.js';
import { ui, locale } from './i18n.js';
import { escapeHtml as esc } from './html.js';
import { koreanHolidays, HOLIDAY_FIRST_YEAR, HOLIDAY_LAST_YEAR } from './korean-holidays.js';

export function monthDays(month) {
  if (!validDate(month + '-01')) throw Error('Invalid calendar month');
  const first = new Date(month + '-01T00:00:00Z');
  const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return {
    offset: (first.getUTCDay() + 6) % 7,
    dates: Array.from({ length: count }, (_, i) => month + '-' + String(i + 1).padStart(2, '0')),
  };
}

export function moveMonth(month, delta) {
  const date = new Date(month + '-01T00:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
}

export function mountHolidayPicker(root, { at = today(), enabled = true } = {}) {
  const field = root.querySelector('textarea[name="holidays"]');
  if (!field) return;
  const selected = new Set(field.value.split(/[\s,]+/).filter(Boolean));
  const original = [...selected];
  if ([...selected].some((date) => !validDate(date))) throw Error(ui('휴무일을 확인해 주세요.'));
  let month = [...selected].sort()[0]?.slice(0, 7) || at.slice(0, 7);
  let focusDate = month === at.slice(0, 7) ? at : month + '-01';
  const host = document.createElement('section');
  host.className = 'holiday-picker';
  host.setAttribute('aria-labelledby', 'holidayTitle');
  field.closest('label').replaceWith(host);
  const dateFormatter = new Intl.DateTimeFormat(locale(), { dateStyle: 'full', timeZone: 'UTC' });
  const monthFormatter = new Intl.DateTimeFormat(locale(), { month: 'long', timeZone: 'UTC' });
  const weekdayFormatter = new Intl.DateTimeFormat(locale(), { weekday: 'short', timeZone: 'UTC' });
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    weekdayFormatter.format(new Date(addDays('2026-11-02', i) + 'T00:00:00Z')),
  );
  const fullDate = (date) => dateFormatter.format(new Date(date + 'T00:00:00Z'));
  const holidayLabel = (name) =>
    name
      .replace(' 대체공휴일', '')
      .split('·')
      .map((part) => ui(part))
      .join(' · ') + (name.endsWith(' 대체공휴일') ? ' · ' + ui('대체공휴일') : '');
  function render(focus = '') {
    const { dates, offset } = monthDays(month);
    const publicDays = new Map(
      koreanHolidays(Number(month.slice(0, 4))).map(({ date, name }) => [date, name]),
    );
    const selectedDates = [...selected].sort();
    host.innerHTML =
      '<h3 id="holidayTitle">' +
      esc(ui('프로젝트 휴무일')) +
      '</h3><label class="holiday-auto"><input type="checkbox" data-holiday-auto ' +
      (enabled ? 'checked' : '') +
      '>' +
      esc(ui('한국 공휴일 자동 반영')) +
      '</label><p class="form-hint">' +
      esc(
        ui(
          '공휴일과 대체공휴일은 자동으로 휴무에 반영됩니다. 회사별 추가 휴무일은 날짜를 눌러 지정하세요.',
        ),
      ) +
      '</p><p class="form-hint">' +
      esc(ui('달력의 날짜를 눌러 선택하거나 해제하세요. 토·일요일은 선택하지 않아도 휴무입니다.')) +
      '</p><p class="form-hint">' +
      esc(
        ui(
          '내장 달력: 2020–2050년 · 새 임시공휴일과 선거일은 온라인 갱신으로 반영합니다. 갱신 상태는 앱 설정에서 확인하세요.',
        ),
      ) +
      '</p>' +
      (enabled &&
      (Number(month.slice(0, 4)) < HOLIDAY_FIRST_YEAR ||
        Number(month.slice(0, 4)) > HOLIDAY_LAST_YEAR)
        ? '<p class="notice" role="status">' +
          esc(ui('이 연도는 자동 공휴일 지원 범위 밖입니다. 휴무일을 직접 지정해 주세요.')) +
          '</p>'
        : '') +
      '<input type="hidden" name="koreanHolidays" value="' +
      enabled +
      '"><input type="hidden" name="holidays"><div class="holiday-toolbar">' +
      '<button type="button" class="button small" data-holiday-prev aria-label="' +
      esc(ui('이전 달')) +
      '" ' +
      (month === '1900-01' ? 'disabled' : '') +
      '>‹</button>' +
      '<select data-holiday-year aria-label="' +
      esc(ui('휴무일 연도')) +
      '">' +
      Array.from(
        { length: 301 },
        (_, i) =>
          '<option value="' +
          (1900 + i) +
          '" ' +
          (String(1900 + i) === month.slice(0, 4) ? 'selected' : '') +
          '>' +
          (1900 + i) +
          '</option>',
      ).join('') +
      '</select>' +
      '<select data-holiday-month aria-label="' +
      esc(ui('휴무일 월')) +
      '">' +
      Array.from({ length: 12 }, (_, i) => {
        const value = String(i + 1).padStart(2, '0');
        return (
          '<option value="' +
          value +
          '" ' +
          (value === month.slice(5) ? 'selected' : '') +
          '>' +
          esc(monthFormatter.format(new Date(Date.UTC(2026, i, 1)))) +
          '</option>'
        );
      }).join('') +
      '</select>' +
      '<button type="button" class="button small" data-holiday-next aria-label="' +
      esc(ui('다음 달')) +
      '" ' +
      (month === '2200-12' ? 'disabled' : '') +
      '>›</button>' +
      '<button type="button" class="button small" data-holiday-today>' +
      esc(ui('이번 달')) +
      '</button></div>' +
      '<div class="holiday-weekdays" aria-hidden="true">' +
      weekdays.map((day) => '<span>' + esc(day) + '</span>').join('') +
      '</div>' +
      '<div class="holiday-days" role="group" aria-label="' +
      esc(ui('휴무일 선택')) +
      '">' +
      Array.from({ length: 42 }, (_, i) => {
        const date = dates[i - offset];
        if (!date) return '<span></span>';
        const chosen = selected.has(date);
        const holiday = publicDays.get(date);
        return (
          '<button type="button" class="holiday-day' +
          (i % 7 > 4 ? ' is-weekend' : '') +
          (holiday ? ' is-public-holiday' : '') +
          (date === at ? ' is-today' : '') +
          '" data-holiday-date="' +
          esc(date) +
          '" aria-pressed="' +
          (chosen || Boolean(enabled && holiday)) +
          '" aria-disabled="' +
          Boolean(enabled && holiday) +
          '" title="' +
          esc(holiday ? holidayLabel(holiday) : fullDate(date)) +
          '" aria-label="' +
          esc(fullDate(date) + (holiday ? ' · ' + holidayLabel(holiday) : '')) +
          '" tabindex="' +
          (date === focusDate ? '0' : '-1') +
          '">' +
          '<span>' +
          Number(date.slice(8)) +
          '</span>' +
          (holiday ? '<small>' + esc(holidayLabel(holiday)) + '</small>' : '') +
          '</button>'
        );
      }).join('') +
      '</div><p class="holiday-count" role="status">' +
      esc(ui('선택한 추가 휴무일')) +
      ' · ' +
      selectedDates.length +
      '</p>' +
      '<div class="holiday-selected">' +
      (selectedDates.length
        ? selectedDates
            .map(
              (date) =>
                '<button type="button" class="button small" data-holiday-remove="' +
                esc(date) +
                '" aria-label="' +
                esc(fullDate(date) + ' · ' + ui('추가 휴무일 해제')) +
                '">' +
                esc(date) +
                ' <span aria-hidden="true">×</span></button>',
            )
            .join('')
        : '<span class="form-hint">' + esc(ui('선택한 추가 휴무일이 없습니다.')) + '</span>') +
      '</div>';
    const unchanged =
      original.length === selected.size && original.every((date) => selected.has(date));
    host.querySelector('[name="holidays"]').value = (unchanged ? original : selectedDates).join(
      '\n',
    );
    if (focus) host.querySelector(focus)?.focus({ preventScroll: true });
  }
  function showMonth(next, focus = '[data-holiday-month]') {
    if (!validDate(next + '-01')) {
      render(focus);
      return;
    }
    month = next;
    focusDate = month === at.slice(0, 7) ? at : month + '-01';
    render(focus);
  }
  host.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const date = button.dataset.holidayDate || button.dataset.holidayRemove;
    if (date) {
      if (button.getAttribute('aria-disabled') === 'true') return;
      if (selected.has(date)) selected.delete(date);
      else selected.add(date);
      if (button.dataset.holidayDate) focusDate = date;
      render(
        button.dataset.holidayDate ? '[data-holiday-date="' + date + '"]' : '[data-holiday-month]',
      );
    } else if (button.hasAttribute('data-holiday-prev'))
      showMonth(moveMonth(month, -1), '[data-holiday-prev]');
    else if (button.hasAttribute('data-holiday-next'))
      showMonth(moveMonth(month, 1), '[data-holiday-next]');
    else if (button.hasAttribute('data-holiday-today'))
      showMonth(at.slice(0, 7), '[data-holiday-today]');
  });
  host.addEventListener('change', (event) => {
    if (event.target.hasAttribute('data-holiday-auto')) {
      enabled = event.target.checked;
      render('[data-holiday-auto]');
      return;
    }
    if (
      event.target.hasAttribute('data-holiday-month') ||
      event.target.hasAttribute('data-holiday-year')
    )
      showMonth(
        host.querySelector('[data-holiday-year]').value +
          '-' +
          host.querySelector('[data-holiday-month]').value,
        event.target.hasAttribute('data-holiday-year')
          ? '[data-holiday-year]'
          : '[data-holiday-month]',
      );
  });
  host.addEventListener('keydown', (event) => {
    const date = event.target.dataset.holidayDate;
    if (!date) return;
    let next;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (step) next = addDays(date, step);
    else if (event.key === 'Home') next = month + '-01';
    else if (event.key === 'End') next = monthDays(month).dates.at(-1);
    else if (event.key === 'PageUp' || event.key === 'PageDown') {
      const nextMonth = moveMonth(month, event.key === 'PageUp' ? -1 : 1);
      if (validDate(nextMonth + '-01'))
        next =
          monthDays(nextMonth).dates[
            Math.min(Number(date.slice(8)), monthDays(nextMonth).dates.length) - 1
          ];
    } else return;
    event.preventDefault();
    if (!next || !validDate(next)) return;
    focusDate = next;
    month = next.slice(0, 7);
    render('[data-holiday-date="' + next + '"]');
  });
  render();
}
