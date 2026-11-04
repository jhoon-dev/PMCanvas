// Replies bypass the document-operation lock so save/close prompts cannot deadlock.
export class AppDialogs {
  constructor(send) {
    this.send = send;
    this.sequence = 0;
    this.requests = new Map();
    this.ready = false;
  }
  get pending() {
    return this.requests.size > 0;
  }
  show(options) {
    const buttons = options.buttons?.length ? options.buttons : ['확인'];
    const cancelId = options.cancelId ?? buttons.length - 1;
    const request = {
      ...options,
      buttons,
      cancelId,
      defaultId: options.defaultId ?? cancelId,
      id: ++this.sequence,
    };
    return new Promise((resolve) => {
      this.requests.set(request.id, { request, resolve });
      if (this.ready) this.send(request);
    });
  }
  connect() {
    if (this.ready) return;
    this.ready = true;
    for (const { request } of this.requests.values()) this.send(request);
  }
  respond(id, response) {
    const entry = this.requests.get(id);
    if (
      !entry ||
      !Number.isInteger(response) ||
      response < 0 ||
      response >= entry.request.buttons.length
    )
      return false;
    this.requests.delete(id);
    entry.resolve({ response });
    return true;
  }
  reset() {
    this.ready = false;
    for (const { request, resolve } of this.requests.values())
      resolve({ response: request.cancelId });
    this.requests.clear();
  }
}
