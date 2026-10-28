export const DEFAULT_TIME_ZONE = 'Asia/Seoul';
export function validateTimeZone(value) {
  if (typeof value !== 'string' || value.length > 100 || !value || value !== value.trim())
    throw Error('올바른 IANA 시간대를 입력해 주세요.');
  try {
    return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    throw Error('올바른 IANA 시간대를 입력해 주세요.');
  }
}
let timeZone = validateTimeZone(
  (typeof process !== 'undefined' && process.env?.PM_TIME_ZONE) || DEFAULT_TIME_ZONE,
);
let formatter = new Intl.DateTimeFormat('sv-SE', { timeZone });
export const getBusinessTimeZone = () => timeZone;
export function setBusinessTimeZone(value) {
  const next = validateTimeZone(value);
  formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: next });
  timeZone = next;
  return timeZone;
}
export const businessDate = (date = new Date(), zone = timeZone) =>
  (zone === timeZone
    ? formatter
    : new Intl.DateTimeFormat('sv-SE', { timeZone: validateTimeZone(zone) })
  ).format(date);
