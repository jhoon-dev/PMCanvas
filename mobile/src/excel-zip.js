import { Buffer } from 'buffer';
import { Inflate } from 'fflate';
class Emitter {
  constructor() {
    this.listeners = new Map();
    this.destroyed = false;
  }
  on(name, callback) {
    const list = this.listeners.get(name) || [];
    list.push(callback);
    this.listeners.set(name, list);
    return this;
  }
  emit(name, ...args) {
    for (const callback of this.listeners.get(name) || []) callback(...args);
  }
  destroy() {
    this.destroyed = true;
  }
}
function checkExtra(buffer, from, length) {
  const end = from + length;
  let cursor = from;
  while (cursor < end) {
    if (cursor + 4 > end) throw Error('압축 메타데이터가 손상되었습니다.');
    const id = buffer.readUInt16LE(cursor),
      size = buffer.readUInt16LE(cursor + 2);
    if (id === 1 || id === 0x7075 || cursor + 4 + size > end)
      throw Error('지원하지 않는 압축 메타데이터입니다.');
    cursor += 4 + size;
  }
}
function entriesFrom(buffer) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--)
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0 || end + 22 + buffer.readUInt16LE(end + 20) !== buffer.length)
    throw Error('압축 파일이 손상되었습니다.');
  const count = buffer.readUInt16LE(end + 10),
    central = buffer.readUInt32LE(end + 16),
    centralSize = buffer.readUInt32LE(end + 12);
  if (
    count > 2000 ||
    buffer.readUInt16LE(end + 4) ||
    buffer.readUInt16LE(end + 6) ||
    buffer.readUInt16LE(end + 8) !== count ||
    central + centralSize !== end
  )
    throw Error('지원하지 않는 압축 형식입니다.');
  const entries = [],
    ranges = [];
  let cursor = central;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50)
      throw Error('압축 파일이 손상되었습니다.');
    const nameLength = buffer.readUInt16LE(cursor + 28),
      extra = buffer.readUInt16LE(cursor + 30),
      comment = buffer.readUInt16LE(cursor + 32),
      next = cursor + 46 + nameLength + extra + comment;
    if (next > end) throw Error('압축 파일이 손상되었습니다.');
    const fileName = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'),
      offset = buffer.readUInt32LE(cursor + 42),
      flags = buffer.readUInt16LE(cursor + 8),
      method = buffer.readUInt16LE(cursor + 10),
      compressedSize = buffer.readUInt32LE(cursor + 20),
      uncompressedSize = buffer.readUInt32LE(cursor + 24);
    if (offset + 30 > central || buffer.readUInt32LE(offset) !== 0x04034b50)
      throw Error('압축 항목이 손상되었습니다.');
    const localNameLength = buffer.readUInt16LE(offset + 26),
      localExtra = buffer.readUInt16LE(offset + 28),
      dataOffset = offset + 30 + localNameLength + localExtra,
      dataEnd = dataOffset + compressedSize;
    checkExtra(buffer, cursor + 46 + nameLength, extra);
    checkExtra(buffer, offset + 30 + localNameLength, localExtra);
    if (
      dataOffset > central ||
      dataEnd > central ||
      buffer.readUInt16LE(offset + 6) !== flags ||
      buffer.readUInt16LE(offset + 8) !== method ||
      buffer.subarray(offset + 30, offset + 30 + localNameLength).toString('utf8') !== fileName
    )
      throw Error('압축 항목이 일치하지 않습니다.');
    if (ranges.some(([start, end]) => offset < end && dataEnd > start))
      throw Error('중복된 압축 항목입니다.');
    ranges.push([offset, dataEnd]);
    entries.push({
      fileName,
      generalPurposeBitFlag: flags,
      compressionMethod: method,
      compressedSize,
      uncompressedSize,
      externalFileAttributes: buffer.readUInt32LE(cursor + 38),
      crc32: buffer.readUInt32LE(cursor + 16),
      dataOffset,
    });
    cursor = next;
  }
  if (cursor !== end) throw Error('압축 파일이 손상되었습니다.');
  return entries;
}
// Feed the existing CRC/XML/content validator with bounded browser ZIP streams.
export const browserZip = {
  fromBuffer(input, _options, callback) {
    try {
      const buffer = Buffer.from(input),
        entries = entriesFrom(buffer),
        zip = new Emitter();
      let index = 0;
      zip.close = () => {
        zip.destroyed = true;
      };
      zip.readEntry = () =>
        queueMicrotask(() => {
          if (!zip.destroyed)
            index < entries.length ? zip.emit('entry', entries[index++]) : zip.emit('end');
        });
      zip.openReadStream = (entry, accept) => {
        const stream = new Emitter();
        accept(null, stream);
        queueMicrotask(() => {
          try {
            let size = 0;
            const data = (chunk) => {
              if (stream.destroyed || zip.destroyed) return;
              size += chunk.length;
              if (size > entry.uncompressedSize || size > 32 * 1024 * 1024)
                throw Error('Excel 압축 해제 크기 제한을 초과했습니다.');
              stream.emit('data', Buffer.from(chunk));
            };
            const compressed = buffer.subarray(
              entry.dataOffset,
              entry.dataOffset + entry.compressedSize,
            );
            if (entry.compressionMethod === 0) {
              for (
                let offset = 0;
                offset < compressed.length && !stream.destroyed && !zip.destroyed;
                offset += 32768
              )
                data(compressed.subarray(offset, offset + 32768));
            } else if (entry.compressionMethod === 8) {
              const inflate = new Inflate((chunk) => data(chunk));
              // Bound allocations even when the ZIP header lies about inflated size.
              for (
                let offset = 0;
                offset < compressed.length && !stream.destroyed && !zip.destroyed;
                offset += 256
              )
                inflate.push(
                  compressed.subarray(offset, offset + 256),
                  offset + 256 >= compressed.length,
                );
              if (!compressed.length) inflate.push(new Uint8Array(), true);
            } else throw Error('지원하지 않는 압축 형식입니다.');
            if (!stream.destroyed && !zip.destroyed) {
              if (size !== entry.uncompressedSize)
                throw Error('압축 해제 크기가 올바르지 않습니다.');
              stream.emit('end');
            }
          } catch (error) {
            if (!stream.destroyed && !zip.destroyed) stream.emit('error', error);
          }
        });
      };
      callback(null, zip);
    } catch (error) {
      callback(error);
    }
  },
};
