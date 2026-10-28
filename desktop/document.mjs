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
} from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { cleanProject } from './app/model/project.mjs';
import { readBounded } from './file-io.mjs';

export const MAX_BYTES = 8 * 1024 * 1024;
const fingerprint = (bytes) => createHash('sha256').update(bytes).digest('hex');
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
    this.dirty = false;
    this.revision = 0;
  }
  snapshot() {
    return {
      project: structuredClone(this.project),
      revision: this.revision,
      filename: this.file ? path.basename(this.file) : '',
      dirty: this.dirty,
    };
  }
  writeRecovery(next) {
    mkdirSync(path.dirname(this.recoveryFile), { recursive: true });
    atomicWrite(this.recoveryFile, JSON.stringify({ version: 1, ...next }));
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
    return this.update({ project, file: this.file, savedHash: this.savedHash, dirty: true });
  }
  create(input) {
    const project = normalizeProject(input);
    return this.update({ project, file: null, savedHash: null, dirty: true });
  }
  open(file) {
    const bytes = readLimited(file);
    const project = parseDocument(bytes);
    // JSON is an import; Save always asks for a new .pmcanvas file.
    const native = path.extname(file).toLowerCase() === '.pmcanvas';
    return this.update({
      project,
      file: native ? file : null,
      savedHash: native ? fingerprint(bytes) : null,
      dirty: !native,
    });
  }
  save(file = this.file) {
    if (!this.project || !file) throw Error('저장할 프로젝트와 파일 이름을 확인해 주세요.');
    if (this.file && path.resolve(file) === path.resolve(this.file)) {
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
    this.dirty = false;
    this.revision++;
    this.writeRecovery({ project: this.project, file, savedHash: this.savedHash, dirty: false });
    return this.snapshot();
  }
  recovery() {
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
    return { project, file: value.file, savedHash: value.savedHash, dirty: value.dirty };
  }
  restore(value) {
    return this.update(value);
  }
}
