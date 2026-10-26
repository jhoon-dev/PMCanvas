const prefix = 'pmcanvas:draft:v1:',
  ttl = 8 * 60 * 60 * 1000;
export class DraftStore {
  constructor(userId, storage, now = () => Date.now()) {
    this.userId = userId;
    this.now = now;
    if (storage) {
      this.storage = storage;
      return;
    }
    DraftStore.cleanup();
    this.storage = DraftStore.persistent(userId)
      ? globalThis.localStorage
      : globalThis.sessionStorage;
  }
  static persistent(id) {
    return globalThis.localStorage?.getItem('pmcanvas:draft-persist:' + id) === 'yes';
  }
  static cleanup() {
    const now = Date.now();
    for (const storage of [globalThis.localStorage, globalThis.sessionStorage]) {
      if (!storage) continue;
      for (const key of Object.keys(storage).filter((k) => k.startsWith(prefix)))
        try {
          const value = JSON.parse(storage.getItem(key));
          if (value.version === 1) {
            value.version = 2;
            value.expiresAt = Date.parse(value.savedAt) + ttl;
            if (value.expiresAt > now)
              globalThis.sessionStorage?.setItem(key, JSON.stringify(value));
            storage.removeItem(key);
          } else if (!Number.isFinite(value.expiresAt) || value.expiresAt <= now)
            storage.removeItem(key);
        } catch {
          storage.removeItem(key);
        }
    }
  }
  static clearUser(id) {
    for (const storage of [globalThis.localStorage, globalThis.sessionStorage])
      if (storage)
        for (const key of Object.keys(storage))
          if (key.startsWith(prefix + id + ':')) storage.removeItem(key);
  }
  static setPersistent(id, on) {
    const old = new DraftStore(id),
      keys = Object.keys(old.storage).filter((k) => k.startsWith(prefix + id + ':'));
    globalThis.localStorage.setItem('pmcanvas:draft-persist:' + id, on ? 'yes' : 'no');
    const target = on ? globalThis.localStorage : globalThis.sessionStorage;
    for (const key of keys) {
      if (target !== old.storage) {
        target.setItem(key, old.storage.getItem(key));
        old.storage.removeItem(key);
      }
    }
  }
  key(id) {
    return 'pmcanvas:draft:v1:' + this.userId + ':' + id;
  }
  write(base, draft, pending) {
    this.storage.setItem(
      this.key(base.id),
      JSON.stringify({
        version: 2,
        projectId: base.id,
        userId: this.userId,
        revision: draft._revision,
        savedAt: new Date(this.now()).toISOString(),
        expiresAt: this.now() + ttl,
        draft,
        pending: [...pending.values()],
      }),
    );
  }
  read(id) {
    const raw = this.storage.getItem(this.key(id));
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!Number.isFinite(value.expiresAt) || value.expiresAt <= this.now()) {
      this.remove(id);
      return null;
    }
    if (
      value.version !== 2 ||
      value.userId !== this.userId ||
      value.projectId !== id ||
      value.draft?.id !== id ||
      !Array.isArray(value.pending) ||
      value.pending.length > 4000
    )
      throw Error('복구 초안 형식을 확인할 수 없습니다.');
    return value;
  }
  remove(id) {
    this.storage.removeItem(this.key(id));
  }
}
