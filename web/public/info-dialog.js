import { ui } from './i18n.js';
export function createInfoDialog({ toast, confirm = window.confirm.bind(window) }) {
  const dialog = document.querySelector('#infoDialog');
  let guard = () => true;
  let changed = () => false,
    processing = () => false;
  function canLeave() {
    return guard();
  }
  function registerGuard({ dirty = () => false, busy = () => false } = {}) {
    changed = dirty;
    processing = busy;
    guard = () => {
      if (busy()) {
        toast(ui('처리가 끝날 때까지 잠시 기다려 주세요.'));
        return false;
      }
      return !dirty() || confirm(ui('저장하지 않은 입력이 있습니다. 입력을 버리고 이동할까요?'));
    };
  }
  function resetGuard() {
    guard = () => true;
    changed = () => false;
    processing = () => false;
  }
  function guardForms(root) {
    // Compare with DOM defaults; never persist or copy password values to storage.
    registerGuard({
      dirty: () =>
        Array.from(root.querySelectorAll('form input[name],form textarea[name]')).some((input) =>
          ['checkbox', 'radio'].includes(input.type)
            ? input.checked !== input.defaultChecked
            : input.value !== input.defaultValue,
        ),
      busy: () => !!root.querySelector('form[data-submitting="true"]'),
    });
  }
  function close() {
    if (canLeave()) dialog.close();
  }
  dialog.addEventListener('cancel', (event) => {
    if (!canLeave()) event.preventDefault();
  });
  dialog.addEventListener('close', resetGuard);
  window.addEventListener('beforeunload', (event) => {
    if (dialog.open && (changed() || processing())) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  return { canLeave, registerGuard, guardForms, resetGuard, close };
}
