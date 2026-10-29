import { atomicWrite } from './document.mjs';
import { readBounded } from './file-io.mjs';

export class DesktopPreferences {
  constructor(file) {
    this.file = file;
    let stored = {};
    try {
      stored = JSON.parse(readBounded(file, 4096));
      if (!stored || Array.isArray(stored) || typeof stored !== 'object')
        throw Error('Invalid preferences.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    this.value = {
      ...stored,
      timeZone: stored.timeZone || 'Asia/Seoul',
      checkUpdatesOnStart:
        typeof stored.checkUpdatesOnStart === 'boolean' ? stored.checkUpdatesOnStart : true,
    };
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
      new Intl.DateTimeFormat('en', { timeZone: patch.timeZone });
    }
    const next = { ...this.value, ...patch };
    atomicWrite(this.file, JSON.stringify(next) + '\n');
    this.value = next;
    return { ...next };
  }
}
