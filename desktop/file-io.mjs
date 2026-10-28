import { openSync, fstatSync, readSync, closeSync, constants } from 'node:fs';

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
