import {
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  mkdirSync,
  openSync,
  closeSync,
  fsyncSync,
  statSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { cleanProject } from './app/model/project.mjs';
import { readBounded, preserveInvalidFile } from './file-io.mjs';

export const MAX_BYTES = 8 * 1024 * 1024;
export const MAX_HISTORY_STEPS = 20;
const MAX_HISTORY_BYTES = 16 * 1024 * 1024;
const fingerprint = (bytes) => createHash('sha256').update(bytes).digest('hex');
const projectHash = (project) => fingerprint(JSON.stringify(project));
export function normalizeProject(value) {
  if (
    value?._wbsPendingCells !== undefined &&
    (!Array.isArray(value._wbsPendingCells) || value._wbsPendingCells.length)
  )
    throw Error('웹 버전에서 미확정 WBS 입력을 먼저 저장한 뒤 다시 백업해 주세요.');
  const project = cleanProject(value);
  const id =
    typeof value.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value.id)
      ? value.id
      : randomUUID();
  return { id, ...project };
}
export function parseDocument(bytes) {
  if (Buffer.byteLength(bytes) > MAX_BYTES)
    throw Error('8MB 이하의 프로젝트 파일을 선택해 주세요.');
  const value = JSON.parse(String(bytes).replace(/^\uFEFF/, ''));
  if (value?.format !== 'pm-canvas-project' || value.version !== 1)
    throw Error('PM Canvas 프로젝트 파일이 아닙니다.');
  return normalizeProject(value.project);
}
export function serializeDocument(project) {
  const document = JSON.stringify(
    {
      format: 'pm-canvas-project',
      version: 1,
      exportedAt: new Date().toISOString(),
      project: normalizeProject(project),
    },
    null,
    2,
  );
  if (Buffer.byteLength(document) > MAX_BYTES)
    throw Error('프로젝트 파일은 8MB까지 저장할 수 있습니다.');
  return document;
}
function readLimited(file, max = MAX_BYTES) {
  return readBounded(file, max);
}
function sameFile(left, right) {
  if (path.resolve(left) === path.resolve(right)) return true;
  try {
    if (realpathSync.native(left) === realpathSync.native(right)) return true;
    const a = statSync(left, { bigint: true }),
      b = statSync(right, { bigint: true });
    return a.ino !== 0n && a.ino === b.ino && a.dev === b.dev;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return false;
  }
}
export function atomicWrite(file, bytes) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, file);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      unlinkSync(temporary);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}
export class DesktopDocument {
  constructor(recoveryFile) {
    this.recoveryFile = recoveryFile;
    this.project = null;
    this.file = null;
    this.savedHash = null;
    this.savedProjectHash = null;
    this.dirty = false;
    this.revision = 0;
    this.undoStack = [];
    this.redoStack = [];
    this.recoveryChecked = false;
    this.recoveryProblem = false;
  }
  snapshot() {
    return {
      project: structuredClone(this.project),
      revision: this.revision,
      filename: this.file ? path.basename(this.file) : '',
      dirty: this.dirty,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    };
  }
  writeRecovery(next) {
    mkdirSync(path.dirname(this.recoveryFile), { recursive: true });
    if (!this.recoveryChecked) {
      try {
        this.recovery();
      } catch {
        /* Preservation below must succeed before replacing it. */
      }
    }
    if (this.recoveryProblem) {
      try {
        preserveInvalidFile(this.recoveryFile, MAX_BYTES * 2);
      } catch (error) {
        if (error.code !== 'ENOENT')
          throw Error(
            '손상된 복구 원본을 보존하지 못했습니다. 파일 접근 권한과 크기를 확인해 주세요.',
          );
      }
    }
    atomicWrite(
      this.recoveryFile,
      JSON.stringify({ version: 1, savedProjectHash: this.savedProjectHash, ...next }),
    );
    this.recoveryProblem = false;
  }
  update(next) {
    this.writeRecovery(next);
    Object.assign(this, next);
    this.revision++;
    return this.snapshot();
  }
  replace(input, revision) {
    if (revision !== this.revision) throw Error('문서가 변경되었습니다. 다시 시도해 주세요.');
    const project = normalizeProject(input);
    serializeDocument(project);
    project.id = this.project?.id || project.id;
    const previous = this.project;
    this.update({
      project,
      file: this.file,
      savedHash: this.savedHash,
      dirty: !this.file || projectHash(project) !== this.savedProjectHash,
    });
    if (previous && JSON.stringify(previous) !== JSON.stringify(project)) {
      this.pushHistory(this.undoStack, previous);
      this.redoStack = [];
    }
    return this.snapshot();
  }
  pushHistory(stack, project) {
    const json = JSON.stringify(project);
    stack.push({ json, bytes: Buffer.byteLength(json) });
    let size = stack.reduce((sum, entry) => sum + entry.bytes, 0);
    while (stack.length > MAX_HISTORY_STEPS || size > MAX_HISTORY_BYTES)
      size -= stack.shift().bytes;
  }
  resetHistory() {
    this.undoStack = [];
    this.redoStack = [];
    return this.snapshot();
  }
  changeHistory(direction, revision) {
    if (revision !== this.revision) throw Error('문서가 변경되었습니다. 다시 시도해 주세요.');
    const from = direction === 'undo' ? this.undoStack : this.redoStack;
    const to = direction === 'undo' ? this.redoStack : this.undoStack;
    if (!from.length) throw Error('되돌리거나 다시 실행할 변경이 없습니다.');
    const project = JSON.parse(from.at(-1).json),
      previous = this.project;
    // Write recovery first, so a failed write cannot consume history or accept a change.
    this.update({
      project,
      file: this.file,
      savedHash: this.savedHash,
      dirty: !this.file || projectHash(project) !== this.savedProjectHash,
    });
    from.pop();
    this.pushHistory(to, previous);
    return this.snapshot();
  }
  undo(revision) {
    return this.changeHistory('undo', revision);
  }
  redo(revision) {
    return this.changeHistory('redo', revision);
  }
  create(input) {
    const project = normalizeProject(input);
    this.update({ project, file: null, savedHash: null, savedProjectHash: null, dirty: true });
    return this.resetHistory();
  }
  open(file) {
    const bytes = readLimited(file);
    const project = parseDocument(bytes);
    // JSON is an import; Save always asks for a new .pmcanvas file.
    const native = path.extname(file).toLowerCase() === '.pmcanvas';
    this.update({
      project,
      file: native ? file : null,
      savedHash: native ? fingerprint(bytes) : null,
      savedProjectHash: native ? projectHash(project) : null,
      dirty: !native,
    });
    return this.resetHistory();
  }
  save(file = this.file) {
    if (!this.project || !file) throw Error('저장할 프로젝트와 파일 이름을 확인해 주세요.');
    if (this.file && sameFile(file, this.file)) {
      let currentHash;
      try {
        currentHash = fingerprint(readLimited(file));
      } catch {
        /* External removal. */
      }
      if (currentHash !== this.savedHash)
        throw Error('파일이 외부에서 변경되거나 이동되었습니다. 다른 이름으로 저장해 주세요.');
    }
    const bytes = serializeDocument(this.project);
    atomicWrite(file, bytes);
    // A recovery failure must not turn a successful save into an overwrite hazard.
    this.file = file;
    this.savedHash = fingerprint(bytes);
    this.savedProjectHash = projectHash(this.project);
    this.dirty = false;
    this.revision++;
    this.writeRecovery({ project: this.project, file, savedHash: this.savedHash, dirty: false });
    return this.snapshot();
  }
  recovery() {
    this.recoveryChecked = true;
    try {
      const result = this.readRecovery();
      this.recoveryProblem = false;
      return result;
    } catch {
      this.recoveryProblem = true;
      try {
        preserveInvalidFile(this.recoveryFile, MAX_BYTES * 2);
      } catch {
        throw Error(
          '손상된 복구 원본을 보존하지 못했습니다. 파일 접근 권한과 크기를 확인해 주세요.',
        );
      }
      throw Error(
        '복구 파일을 읽지 못했습니다. 원본은 별도 사본에 보관했습니다. 프로젝트 파일을 열거나 새 문서를 만들 수 있습니다.',
      );
    }
  }
  readRecovery() {
    let bytes;
    try {
      bytes = readLimited(this.recoveryFile, MAX_BYTES * 2);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    const value = JSON.parse(String(bytes));
    if (value.version !== 1 || typeof value.dirty !== 'boolean')
      throw Error('복구 파일 형식을 확인해 주세요.');
    const project = normalizeProject(value.project);
    if (value.file !== null && (typeof value.file !== 'string' || !path.isAbsolute(value.file)))
      throw Error('복구 파일 경로가 올바르지 않습니다.');
    if (value.savedHash !== null && !/^[a-f0-9]{64}$/.test(value.savedHash))
      throw Error('복구 파일의 저장 정보를 확인해 주세요.');
    if (
      value.savedProjectHash != null &&
      (typeof value.savedProjectHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.savedProjectHash))
    )
      throw Error('복구 파일의 저장 기준을 확인해 주세요.');
    return {
      project,
      file: value.file,
      savedHash: value.savedHash,
      dirty: value.dirty,
      savedProjectHash:
        value.savedProjectHash ?? (!value.dirty && value.file ? projectHash(project) : null),
    };
  }
  restore(value) {
    this.update(value);
    return this.resetHistory();
  }
}
