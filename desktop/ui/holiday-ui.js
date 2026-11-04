import { setKoreanHolidayUpdates } from './shared/korean-holidays.js';
export function createHolidayUI({ api, ui, locale, canApply, onCalendar }) {
  const $ = (id) => document.getElementById(id);
  let state = null,
    waiting = null,
    requesting = false;
  function paint() {
    const checkbox = $('autoSyncHolidays'),
      button = $('refreshHolidays');
    if (!checkbox || !button) return;
    checkbox.checked = state?.enabled !== false;
    checkbox.disabled = requesting || !api.setHolidayPreference;
    button.disabled = requesting || Boolean(state?.checking) || !api.refreshHolidays;
    const message = state?.checking
      ? '공휴일 정보를 확인하고 있습니다.'
      : state?.enabled === false
        ? '자동 갱신이 꺼져 있습니다. 마지막으로 받은 공휴일 정보를 사용합니다.'
        : state?.pending
          ? '새 공휴일 정보를 받았습니다. 입력을 마치면 일정에 반영합니다.'
          : ['storage', 'cache'].includes(state?.error)
            ? '공휴일 정보를 저장하지 못해 기존 달력을 사용하고 있습니다. 자동으로 다시 시도합니다.'
            : state?.error
              ? '연결하지 못해 저장된 공휴일 정보를 사용하고 있습니다. 자동으로 다시 시도합니다.'
              : state?.checkedAt
                ? '공휴일 정보가 일정에 반영되어 있습니다.'
                : '연결되면 새로 지정된 공휴일 정보를 자동으로 확인합니다.';
    $('holidaySyncStatus').textContent = ui(message);
    $('holidaySyncChecked').textContent = state?.checkedAt
      ? ui('최근 갱신') +
        ' · ' +
        new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(state.checkedAt),
        )
      : ui('아직 갱신하지 않았습니다. 내장 공휴일 달력을 사용합니다.');
  }
  function flush() {
    if (!waiting || !canApply()) return;
    const next = waiting;
    waiting = null;
    if (setKoreanHolidayUpdates(next.holidays || [])) onCalendar();
  }
  function accept(next) {
    if (!next) return;
    state = next;
    waiting = next;
    paint();
    flush();
  }
  $('refreshHolidays').onclick = async () => {
    if (requesting || !api.refreshHolidays) return;
    requesting = true;
    paint();
    try {
      accept(await api.refreshHolidays(true));
    } catch {
      state = { ...state, error: 'unavailable' };
    } finally {
      requesting = false;
      paint();
    }
  };
  $('autoSyncHolidays').onchange = async (event) => {
    const enabled = event.target.checked;
    requesting = true;
    paint();
    try {
      accept(await api.setHolidayPreference(enabled));
    } catch {
      state = { ...state, error: 'unavailable' };
    } finally {
      requesting = false;
      paint();
    }
  };
  api.onHolidayCalendar?.(accept);
  window.addEventListener('online', () => {
    if (state?.enabled === false || !api.refreshHolidays) return;
    void api
      .refreshHolidays?.(Boolean(state?.error))
      .then(accept)
      .catch(() => {});
  });
  return { accept, flush, paint, initialise: async () => accept(await api.holidayState?.()) };
}
