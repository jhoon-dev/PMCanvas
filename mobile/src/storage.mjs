import { normalizeProject } from './model.mjs';

export class ProjectStore {
  constructor(factory = globalThis.indexedDB, name = 'pmcanvas-mobile-v1') {
    this.factory = factory;
    this.name = name;
    this.connection = null;
  }
  async open() {
    if (this.connection) return this.connection;
    this.connection = await new Promise((resolve, reject) => {
      const request = this.factory.open(this.name, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('projects', { keyPath: 'id' });
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          this.connection = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(Error('다른 PM Canvas 창을 닫고 다시 열어 주세요.'));
    });
    return this.connection;
  }
  async transaction(mode, operation) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(
        'projects',
        mode,
        mode === 'readwrite' ? { durability: 'strict' } : undefined,
      );
      let request;
      try {
        request = operation(transaction.objectStore('projects'));
      } catch (error) {
        transaction.abort();
        reject(error);
        return;
      }
      // Publish state only after commit, including quota/disk failures.
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () =>
        reject(
          transaction.error || Error('기기에 저장하지 못했습니다. 저장 공간을 확인해 주세요.'),
        );
      transaction.onerror = () => {};
    });
  }
  async list() {
    return (await this.transaction('readonly', (store) => store.getAll())).sort((a, b) =>
      String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')),
    );
  }
  async save(input, expectedRevision = null) {
    const project = normalizeProject(input);
    const db = await this.open();
    return new Promise((resolve, reject) => {
      // A native force-stop can interrupt Chromium's relaxed WAL flush. Confirm
      // the durable commit before publishing "saved" or allowing another action.
      const tx = db.transaction('projects', 'readwrite', { durability: 'strict' });
      const store = tx.objectStore('projects');
      const request = store.get(project.id);
      let record, failure;
      request.onsuccess = () => {
        const previous = request.result;
        if (expectedRevision !== null && (previous?.revision ?? 0) !== expectedRevision) {
          failure = Error('다른 창에서 변경되었습니다. 프로젝트 목록에서 다시 열어 주세요.');
          tx.abort();
          return;
        }
        record = {
          id: project.id,
          project,
          revision: (previous?.revision ?? 0) + 1,
          updatedAt: new Date().toISOString(),
        };
        store.put(record);
      };
      tx.oncomplete = () => resolve(record);
      tx.onabort = () =>
        reject(
          failure || tx.error || Error('기기에 저장하지 못했습니다. 저장 공간을 확인해 주세요.'),
        );
      tx.onerror = () => {};
    });
  }
  async remove(id) {
    await this.transaction('readwrite', (store) => store.delete(id));
  }
}
