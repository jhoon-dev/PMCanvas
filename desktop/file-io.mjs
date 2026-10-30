import { openSync, fstatSync, readSync, closeSync, constants } from 'node:fs';
import { lstatSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export function preserveInvalidFile(file, max) {
  const original = lstatSync(file);
  if (!original.isFile() || original.isSymbolicLink()) throw Error('Invalid recovery file.');
  const bytes = readBounded(file, max);
  const backup = file + '.invalid-' + createHash('sha256').update(bytes).digest('hex');
  try {
    writeFileSync(backup, bytes, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = lstatSync(backup);
    if (
      !existing.isFile() ||
      existing.isSymbolicLink() ||
      existing.nlink !== 1 ||
      !readBounded(backup, max).equals(bytes)
    )
      throw error;
  }
  return backup;
}

export function readBounded(file, max) {
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NONBLOCK || 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > max)
      throw Error('크기 제한 이내의 일반 파일을 선택해 주세요.');
    const bytes = Buffer.alloc(max + 1);
    let size = 0,
      n;
    while ((n = readSync(fd, bytes, size, bytes.length - size, null)) > 0) {
      size += n;
      if (size > max) throw Error('파일 크기 제한을 초과했습니다.');
    }
    return bytes.subarray(0, size);
  } finally {
    closeSync(fd);
  }
}
