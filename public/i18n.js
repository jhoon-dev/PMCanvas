import english from './locales/en.js';
const preferenceKey = 'pmcanvas.language';
export const supportedLanguages = ['ko', 'en'];
function initialLanguage() {
  if (typeof window === 'undefined') return 'ko';
  try {
    const saved = window.localStorage.getItem(preferenceKey);
    if (supportedLanguages.includes(saved)) return saved;
  } catch {}
  return window.navigator?.language?.startsWith('en') ? 'en' : 'ko';
}
let language = initialLanguage();
export const getLanguage = () => language;
export const locale = () => (language === 'en' ? 'en-US' : 'ko-KR');
export function setLanguage(value) {
  if (!supportedLanguages.includes(value)) throw Error('Unsupported language.');
  language = value;
}
const cache = new Map();
const pattern = new RegExp(
  Object.keys(english)
    .sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|'),
  'g',
);
// Call on authored UI literals only, before concatenating escaped user data.
export function ui(value, selectedLanguage = language) {
  const text = String(value ?? '');
  if (selectedLanguage === 'ko' || !/[가-힣]/.test(text)) return text;
  if (cache.has(text)) return cache.get(text);
  const protectedValues = [];
  const safe = text.replace(/\b(value|data-[\w-]+)=(["'])(.*?)\2/g, (all) => {
    const token = '\u0001' + protectedValues.length + '\u0002';
    protectedValues.push(all);
    return token;
  });
  const result = safe
    .replace(pattern, (key) => english[key])
    .replace(/\u0001(\d+)\u0002/g, (_, i) => protectedValues[Number(i)]);
  if (cache.size >= 4096) cache.clear();
  cache.set(text, result);
  return result;
}
export function localizeStatic(root) {
  for (const node of root.querySelectorAll('*')) {
    if (node.closest('script,style,.language-control')) continue;
    for (const attribute of ['aria-label', 'title', 'placeholder', 'content'])
      if (node.hasAttribute(attribute))
        node.setAttribute(attribute, ui(node.getAttribute(attribute)));
    for (const child of node.childNodes)
      if (child.nodeType === 3) child.textContent = ui(child.textContent);
  }
}
export function installLanguage({ canChange, toast }) {
  document.documentElement.lang = language;
  localizeStatic(document.documentElement);
  document.querySelectorAll('.language-select').forEach((select) => {
    select.value = language;
    select.onchange = () => {
      const next = select.value;
      if (!canChange()) {
        select.value = language;
        toast(ui('언어를 바꾸기 전에 변경사항을 저장하거나 취소해 주세요.'));
        return;
      }
      try {
        window.localStorage.setItem(preferenceKey, next);
        window.location.reload();
      } catch {
        select.value = language;
        toast(ui('언어 설정을 저장하지 못했습니다. 브라우저 저장소 설정을 확인해 주세요.'));
      }
    };
  });
}
export function rowLabel(row, label) {
  return language === 'en' ? 'Row ' + row + ' ' + ui(label) : row + '행 ' + label;
}
export function errorMessage(code, message) {
  const translated = ui(message || '요청을 처리하지 못했습니다.');
  if (language === 'ko' || !/[가-힣]/.test(translated)) return translated;
  const common = {
    LOGIN_FAILED: 'Check your email and password.',
    AUTH_REQUIRED: 'Please sign in again.',
    RATE_LIMIT: 'Too many requests. Please try again later.',
    CSRF_FAILED: 'Your security token has expired. Refresh and sign in again.',
    FORBIDDEN: 'You do not have access to this action.',
    REGISTRATION_PENDING: 'Your registration is awaiting administrator approval.',
    EMAIL_UNVERIFIED: 'Verify your email before signing in.',
    REGISTRATION_DOMAIN: 'Use an email address from an allowed organization.',
    INVALID_PASSWORD: 'Use a password with at least 12 characters.',
    PASSWORD_MISMATCH: 'Passwords do not match.',
    MFA_FAILED: 'Check your authenticator code or recovery code.',
    MFA_REPLAY: 'This code has already been used. Enter a new code.',
    REVISION_CONFLICT: 'Someone else saved first. Compare your changes before saving.',
    MAIL_TEST_FAILED:
      'Could not send the test email. Check SMTP settings and recipient permissions.',
    MAIL_CONFIG: 'Check the SMTP server, sender and authentication settings.',
  };
  return (
    common[code] ||
    'Could not complete the request. Check your input and try again.' +
      (/^[A-Z0-9_]{1,64}$/.test(code || '') ? ' (' + code + ')' : '')
  );
}
