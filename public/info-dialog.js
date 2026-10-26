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
        toast('처리가 끝날 때까지 잠시 기다려 주세요.');
        return false;
      }
      return !dirty() || confirm('저장하지 않은 설정이 있습니다. 변경을 취소하고 이동할까요?');
    };
  }
  function resetGuard() {
    guard = () => true;
    changed = () => false;
    processing = () => false;
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
  return { canLeave, registerGuard, resetGuard, close };
}
