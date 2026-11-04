import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  DesktopDocument,
  atomicWrite,
  sameFile,
  serializeDocument,
  validateRecoveryRecord,
} from './document.mjs';
import { readBounded, preserveInvalidFile } from './file-io.mjs';

export const MAX_TABS = 20;
const MAX_WORKSPACE_BYTES = 64 * 1024 * 1024;
const record = (doc) => ({
  version: 1,
  project: doc.project,
  file: doc.file,
  savedHash: doc.savedHash,
  savedProjectHash: doc.savedProjectHash,
  dirty: doc.dirty,
});

// Each document keeps its own checkpoint/history; the workspace supplies one IPC revision
// and one atomic recovery transaction for the complete set of open tabs.
export class DesktopWorkspace {
  constructor(recoveryFile) {
    this.recoveryFile = recoveryFile;
    this.legacy = new DesktopDocument(path.join(path.dirname(recoveryFile), 'recovery.json'));
    this.tabs = new Map();
    this.activeId = null;
    this.revision = 0;
    this.checked = false;
    this.problem = false;
  }
  get active() {
    return this.tabs.get(this.activeId);
  }
  get project() {
    return this.active?.project || null;
  }
  get file() {
    return this.active?.file || null;
  }
  get dirty() {
    return Boolean(this.active?.dirty);
  }
  get anyDirty() {
    return [...this.tabs.values()].some((doc) => doc.dirty);
  }
  snapshot() {
    return {
      ...(this.active?.snapshot() || {
        project: null,
        filename: '',
        dirty: false,
        canUndo: false,
        canRedo: false,
      }),
      revision: this.revision,
      tabId: this.activeId,
      anyDirty: this.anyDirty,
      tabs: [...this.tabs].map(([id, doc]) => ({
        id,
        name: doc.project.name,
        filename: doc.file ? path.basename(doc.file) : '',
        dirty: doc.dirty,
      })),
    };
  }
  persist(tabs = this.tabs, activeId = this.activeId, pendingId, pending) {
    if (!this.checked) this.recovery();
    mkdirSync(path.dirname(this.recoveryFile), { recursive: true });
    if (this.problem) preserveInvalidFile(this.recoveryFile, MAX_WORKSPACE_BYTES);
    const bytes = JSON.stringify({
      version: 1,
      activeId,
      tabs: [...tabs].map(([id, doc]) => ({
        id,
        document: { ...record(doc), ...(id === pendingId ? pending : {}) },
      })),
    });
    if (Buffer.byteLength(bytes) > MAX_WORKSPACE_BYTES)
      throw Error(
        '열린 프로젝트의 전체 크기가 64MB를 넘습니다. 일부 프로젝트를 저장하고 닫아 주세요.',
      );
    atomicWrite(this.recoveryFile, bytes);
    this.problem = false;
  }
  detached() {
    const doc = new DesktopDocument(this.legacy.recoveryFile);
    doc.writeRecovery = () => {};
    return doc;
  }
  bind(id, doc) {
    doc.writeRecovery = (next) => this.persist(this.tabs, this.activeId, id, next);
  }
  add(doc) {
    if (this.tabs.size >= MAX_TABS) throw Error('프로젝트는 한 번에 20개까지 열 수 있습니다.');
    const id = randomUUID(),
      tabs = new Map(this.tabs).set(id, doc);
    this.persist(tabs, id);
    this.tabs = tabs;
    this.activeId = id;
    this.bind(id, doc);
    this.revision++;
    return this.snapshot();
  }
  create(project) {
    const doc = this.detached();
    doc.create(project);
    return this.add(doc);
  }
  open(file) {
    return this.openMany([file]);
  }
  openMany(files) {
    const tabs = new Map(this.tabs);
    let activeId = this.activeId;
    for (const file of files) {
      const existing = [...tabs].find(([, doc]) => doc.file && sameFile(file, doc.file));
      if (existing) {
        activeId = existing[0];
        continue;
      }
      if (tabs.size >= MAX_TABS) throw Error('프로젝트는 한 번에 20개까지 열 수 있습니다.');
      const doc = this.detached();
      doc.open(file);
      activeId = randomUUID();
      tabs.set(activeId, doc);
    }
    this.persist(tabs, activeId);
    this.tabs = tabs;
    this.activeId = activeId;
    for (const [id, doc] of tabs) this.bind(id, doc);
    this.revision++;
    return this.snapshot();
  }
  activate(id) {
    if (!this.tabs.has(id)) throw Error('열려 있는 프로젝트를 선택해 주세요.');
    if (id !== this.activeId) {
      this.persist(this.tabs, id);
      this.activeId = id;
      this.revision++;
    }
    return this.snapshot();
  }
  close(id = this.activeId) {
    return this.closeMany([id]);
  }
  closeMany(ids) {
    const tabs = new Map(this.tabs),
      oldIds = [...tabs.keys()],
      oldIndex = oldIds.indexOf(this.activeId);
    for (const id of ids) tabs.delete(id);
    const activeId = tabs.has(this.activeId)
      ? this.activeId
      : [...tabs.keys()][Math.min(oldIndex, tabs.size - 1)] || null;
    this.persist(tabs, activeId);
    this.tabs = tabs;
    this.activeId = activeId;
    this.revision++;
    return this.snapshot();
  }
  assertRevision(revision) {
    if (revision !== this.revision) throw Error('문서가 변경되었습니다. 다시 시도해 주세요.');
    if (!this.active) throw Error('프로젝트를 먼저 생성해 주세요.');
  }
  mutate(method, args) {
    const doc = this.active,
      before = doc.revision;
    try {
      doc[method](...args);
    } finally {
      if (doc.revision !== before) this.revision++;
    }
    return this.snapshot();
  }
  replace(project, revision) {
    this.assertRevision(revision);
    return this.mutate('replace', [project, this.active.revision]);
  }
  undo(revision) {
    this.assertRevision(revision);
    return this.mutate('undo', [this.active.revision]);
  }
  redo(revision) {
    this.assertRevision(revision);
    return this.mutate('redo', [this.active.revision]);
  }
  save(file = this.file) {
    this.assertRevision(this.revision);
    if (!file) throw Error('저장할 프로젝트와 파일 이름을 확인해 주세요.');
    if (
      [...this.tabs].some(
        ([id, doc]) => id !== this.activeId && doc.file && sameFile(file, doc.file),
      )
    )
      throw Error('다른 탭에서 열려 있는 파일입니다. 다른 이름으로 저장해 주세요.');
    return this.mutate('save', [file]);
  }
  recovery() {
    this.checked = true;
    let bytes;
    try {
      bytes = readBounded(this.recoveryFile, MAX_WORKSPACE_BYTES);
    } catch (error) {
      if (error.code === 'ENOENT') return this.legacy.recovery();
      this.problem = true;
      throw error;
    }
    try {
      const value = JSON.parse(String(bytes));
      if (value.version !== 1 || !Array.isArray(value.tabs) || value.tabs.length > MAX_TABS)
        throw Error('Invalid workspace');
      const ids = new Set();
      const tabs = value.tabs.map(({ id, document }) => {
        if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id) || ids.has(id))
          throw Error('Invalid tab');
        ids.add(id);
        const validated = validateRecoveryRecord(document);
        if (!validated) throw Error('Empty tab');
        serializeDocument(validated.project);
        return { id, document: validated };
      });
      if ((tabs.length && !ids.has(value.activeId)) || (!tabs.length && value.activeId !== null))
        throw Error('Invalid active tab');
      return {
        workspace: true,
        tabs,
        activeId: value.activeId,
        dirty: tabs.some((tab) => tab.document.dirty),
      };
    } catch {
      this.problem = true;
      preserveInvalidFile(this.recoveryFile, MAX_WORKSPACE_BYTES);
      throw Error('프로젝트 탭 복구 정보를 읽지 못했습니다. 원본은 별도 사본에 보관했습니다.');
    }
  }
  restore(value, restoreAccess = () => {}) {
    if (!value.workspace) {
      const doc = this.detached();
      doc.restore(value);
      return this.add(doc);
    }
    const tabs = new Map();
    let missing = false;
    for (const entry of value.tabs) {
      const doc = this.detached(),
        saved = entry.document;
      try {
        if (saved.file) restoreAccess(saved.file);
      } catch {
        /* A later save can request access. */
      }
      if (!saved.dirty && saved.file) {
        try {
          doc.open(saved.file);
        } catch {
          doc.restore({
            ...saved,
            file: null,
            savedHash: null,
            savedProjectHash: null,
            dirty: true,
          });
          missing = true;
        }
      } else doc.restore(saved);
      // Never restore the same writable file in two independent tabs.
      if (
        doc.file &&
        [...tabs.values()].some((other) => other.file && sameFile(doc.file, other.file))
      ) {
        doc.file = null;
        doc.savedHash = null;
        doc.savedProjectHash = null;
        doc.dirty = true;
      }
      tabs.set(entry.id, doc);
    }
    this.persist(tabs, value.activeId);
    this.tabs = tabs;
    this.activeId = value.activeId;
    for (const [id, doc] of tabs) this.bind(id, doc);
    this.revision++;
    return { ...this.snapshot(), missing };
  }
}
