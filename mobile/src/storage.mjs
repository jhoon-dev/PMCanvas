import { assertReportHistory } from '../../shared/browser/management.js';
import { normalizeProject } from './model.mjs';

const revisionConflict = () =>
  Error('다른 창에서 변경되었습니다. 프로젝트 목록에서 다시 열어 주세요.');

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
  async #write(id, expectedRevision, operation) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      // Wait for a durable commit and keep the revision check and write atomic.
      const tx = db.transaction('projects', 'readwrite', { durability: 'strict' });
      const store = tx.objectStore('projects');
      const request = store.get(id);
      let result, failure;
      request.onsuccess = () => {
        const previous = request.result;
        try {
          if (expectedRevision !== null && (previous?.revision ?? 0) !== expectedRevision)
            throw revisionConflict();
          result = operation(store, previous);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () =>
        reject(
          failure || tx.error || Error('기기에 저장하지 못했습니다. 저장 공간을 확인해 주세요.'),
        );
      tx.onerror = () => {};
    });
  }
  async save(input, expectedRevision = null) {
    const project = normalizeProject(input);
    return this.#write(project.id, expectedRevision, (store, previous) => {
      if (previous) assertReportHistory(previous.project, project);
      const record = {
        id: project.id,
        project,
        revision: (previous?.revision ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      };
      store.put(record);
      return record;
    });
  }
  async remove(id, expectedRevision) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw revisionConflict();
    await this.#write(id, expectedRevision, (store) => store.delete(id));
  }
}
