export function createMessageDialog({ root = document, ui }) {
  const dialog = root.createElement('dialog');
  dialog.id = 'messageDialog';
  dialog.className = 'desktop-dialog desktop-message-dialog';
  dialog.setAttribute('aria-labelledby', 'messageTitle');
  dialog.setAttribute('aria-describedby', 'messageText');
  dialog.innerHTML =
    '<div class="dialog-head"><h2 id="messageTitle"></h2></div><div class="dialog-body"><p id="messageText"></p><p id="messageDetail"></p></div><div class="dialog-foot"></div>';
  root.body.append(dialog);
  const queue = [];
  let active = null;
  function next() {
    if (active || !queue.length) return;
    active = queue.shift();
    const { options } = active;
    active.focus = root.activeElement;
    dialog.querySelector('#messageTitle').textContent = options.title || ui('알림');
    dialog.querySelector('#messageText').textContent = options.message || '';
    const detail = dialog.querySelector('#messageDetail');
    detail.textContent = options.detail || '';
    detail.hidden = !options.detail;
    const footer = dialog.querySelector('.dialog-foot');
    footer.replaceChildren();
    const buttons = options.buttons || [ui('확인')];
    // Secondary/cancel actions precede the main action, as in every editor dialog.
    const primary = options.primaryId ?? (buttons.length > 1 ? 0 : buttons.length - 1);
    const order = buttons
      .map((_, i) => i)
      .filter((i) => i !== primary)
      .concat(primary);
    for (const index of order) {
      const button = root.createElement('button');
      button.type = 'button';
      button.dataset.response = String(index);
      button.textContent = buttons[index];
      button.className =
        'button' + (index === primary ? (options.type === 'warning' ? ' danger' : ' primary') : '');
      button.onclick = () => finish(index);
      footer.append(button);
    }
    dialog.showModal();
    dialog
      .querySelector('[data-response="' + (options.defaultId ?? options.cancelId ?? 0) + '"]')
      ?.focus();
  }
  function finish(response) {
    if (!active) return;
    const current = active;
    active = null;
    dialog.close();
    if (current.focus?.isConnected) current.focus.focus();
    current.resolve(response);
    queueMicrotask(next);
  }
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    finish(active?.options.cancelId ?? 0);
  });
  return {
    get open() {
      return Boolean(active);
    },
    show(options) {
      return new Promise((resolve) => {
        queue.push({ options, resolve });
        next();
      });
    },
    async confirm({ title, message, detail, action = ui('확인'), dangerous = false }) {
      return (
        (await this.show({
          title,
          message,
          detail,
          type: dangerous ? 'warning' : 'question',
          buttons: [action, ui('취소')],
          primaryId: 0,
          defaultId: 1,
          cancelId: 1,
        })) === 0
      );
    },
  };
}
