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
      for (const key of Object.keys(storage).filter((k) => k.startsWith(prefix))) {
        let value;
        try {
          value = JSON.parse(storage.getItem(key));
        } catch {
          storage.removeItem(key);
          continue;
        }
        if (value?.version === 1) {
          value.version = 2;
          value.expiresAt = Date.parse(value.savedAt) + ttl;
          if (!(value.expiresAt > now)) {
            storage.removeItem(key);
            continue;
          }
          const target = globalThis.sessionStorage;
          if (!target) continue;
          try {
            target.setItem(key, JSON.stringify(value));
          } catch {
            // A failed migration is retryable; it does not make the original invalid.
            continue;
          }
          if (target !== storage) storage.removeItem(key);
        } else if (!Number.isFinite(value?.expiresAt) || value.expiresAt <= now) {
          storage.removeItem(key);
        }
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
      target = on ? globalThis.localStorage : globalThis.sessionStorage,
      entries =
        target === old.storage
          ? []
          : Object.keys(old.storage)
              .filter((key) => key.startsWith(prefix + id + ':'))
              .map((key) => ({
                key,
                value: old.storage.getItem(key),
                previous: target.getItem(key),
              })),
      copied = [];
    try {
      for (const entry of entries) {
        target.setItem(entry.key, entry.value);
        copied.push(entry);
      }
      // Only switch readers after every draft has a complete copy in the target.
      globalThis.localStorage.setItem('pmcanvas:draft-persist:' + id, on ? 'yes' : 'no');
    } catch (error) {
      for (const { key, previous } of copied.reverse()) {
        try {
          if (previous === null) target.removeItem(key);
          else target.setItem(key, previous);
        } catch {
          // The unchanged preference still selects the untouched source copies.
        }
      }
      throw error;
    }
    for (const { key } of entries) {
      try {
        old.storage.removeItem(key);
      } catch {
        // The switch succeeded; leftover source copies retain their original expiry.
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
        version: 3,
        projectId: base.id,
        userId: this.userId,
        revision: draft._revision,
        savedAt: new Date(this.now()).toISOString(),
        expiresAt: this.now() + ttl,
        base,
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
      ![2, 3].includes(value.version) ||
      value.userId !== this.userId ||
      value.projectId !== id ||
      value.draft?.id !== id ||
      (value.version === 3 &&
        (value.base?.id !== id ||
          value.base._revision !== value.revision ||
          value.draft._revision !== value.revision)) ||
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
