import { atomicWrite } from './document.mjs';
import { readBounded } from './file-io.mjs';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

function timeZone(value) {
  if (typeof value !== 'string' || !value || value.length > 100 || value !== value.trim())
    throw Error('Invalid time zone.');
  return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
}

export class DesktopPreferences {
  constructor(file) {
    this.file = file;
    this.recovery = null;
    let stored = {};
    try {
      stored = JSON.parse(readBounded(file, 4096));
      if (!stored || Array.isArray(stored) || typeof stored !== 'object')
        throw Error('Invalid preferences.');
    } catch (error) {
      if (error.code !== 'ENOENT') this.recovery = { backupCreated: false };
    }
    if (!stored || Array.isArray(stored) || typeof stored !== 'object') stored = {};
    let zone = 'Asia/Seoul';
    try {
      zone = timeZone(stored.timeZone ?? zone);
    } catch {
      this.recovery = { backupCreated: false };
    }
    if (stored.checkUpdatesOnStart !== undefined && typeof stored.checkUpdatesOnStart !== 'boolean')
      this.recovery = { backupCreated: false };
    this.value = {
      ...stored,
      timeZone: zone,
      checkUpdatesOnStart:
        typeof stored.checkUpdatesOnStart === 'boolean'
          ? stored.checkUpdatesOnStart
          : !this.recovery,
    };
    if (this.recovery) {
      try {
        this.preserve();
      } catch {
        /* Keep the original untouched and allow an in-memory startup. */
      }
    }
  }
  preserve() {
    const bytes = readBounded(this.file, 65536);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const backup = this.file + '.invalid-' + hash;
    try {
      fs.writeFileSync(backup, bytes, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (
        error.code !== 'EEXIST' ||
        fs.lstatSync(backup).isSymbolicLink() ||
        !readBounded(backup, 65536).equals(bytes)
      )
        throw error;
    }
    this.recovery.backupCreated = true;
  }
  update(patch) {
    if (
      !patch ||
      typeof patch !== 'object' ||
      Array.isArray(patch) ||
      Object.keys(patch).some((key) => !['timeZone', 'checkUpdatesOnStart'].includes(key))
    )
      throw Error('Invalid preferences.');
    if ('checkUpdatesOnStart' in patch && typeof patch.checkUpdatesOnStart !== 'boolean')
      throw Error('Invalid update preference.');
    if ('timeZone' in patch) {
      if (typeof patch.timeZone !== 'string' || patch.timeZone.length > 100)
        throw Error('Invalid time zone.');
      timeZone(patch.timeZone);
    }
    const next = { ...this.value, ...patch };
    const bytes = JSON.stringify(next) + '\n';
    if (Buffer.byteLength(bytes) > 4096) throw Error('Settings are too large.');
    if (this.recovery) {
      try {
        this.preserve();
      } catch {
        throw Error('원래 설정 파일을 보존하지 못했습니다. 파일 접근 권한과 크기를 확인해 주세요.');
      }
    }
    atomicWrite(this.file, bytes);
    this.value = next;
    this.recovery = null;
    return { ...next };
  }
}
