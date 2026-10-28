function inspectZip(buffer) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--)
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw Error('유효한 XLSX 파일이 아닙니다.');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16),
    size = 0;
  if (count > 2000 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6))
    throw Error('지원하지 않는 압축 형식입니다.');
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50)
      throw Error('압축 파일이 손상되었습니다.');
    size += buffer.readUInt32LE(offset + 24);
    const len = buffer.readUInt16LE(offset + 28),
      name = buffer.subarray(offset + 46, offset + 46 + len).toString();
    if (
      size > 32 * 1024 * 1024 ||
      buffer.readUInt16LE(offset + 8) & 1 ||
      /vbaProject|externalLinks|\.\.\//i.test(name)
    )
      throw Error('압축 해제 크기 초과 또는 매크로·외부 연결 파일은 가져올 수 없습니다.');
    offset += 46 + len + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
}
export async function parseWorkbook(ExcelJS, yauzl, DOMParser, buffer) {
  if (buffer.length > 4 * 1024 * 1024) throw Error('Excel 파일은 4MB 이하로 선택해 주세요.');
  inspectZip(buffer);
  await validateInflation(yauzl, DOMParser, buffer);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer);
  if (book.worksheets.length > 12) throw Error('시트는 12개까지 지원합니다.');
  return book.worksheets.map((sheet) => {
    if (sheet.rowCount > 501 || sheet.columnCount > 40)
      return {
        name: sheet.name,
        rows: [],
        error: '이 시트는 머리글 포함 501행·40열 제한을 초과합니다.',
      };
    const rows = [];
    for (let n = 1; n <= sheet.rowCount; n++) {
      const values = [];
      for (let c = 1; c <= sheet.columnCount; c++) {
        const cell = sheet.getCell(n, c),
          v = cell.value;
        if (v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v || 'error' in v))
          throw Error(sheet.name + ' ' + cell.address + ': 수식·오류 셀을 값으로 바꿔 주세요.');
        const value =
          v instanceof Date
            ? v.toISOString().slice(0, 10)
            : typeof v === 'object' && v !== null
              ? cell.text
              : (v ?? '');
        if (String(value).length > 2000)
          throw Error(sheet.name + ' ' + cell.address + ': 셀은 2,000자까지 지원합니다.');
        values.push(value);
      }
      rows.push(values);
    }
    return { name: sheet.name, rows };
  });
}
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function checkXml(DOMParser, bytes, name) {
  const text = bytes.toString('utf8');
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(text)) throw Error('XML DTD·엔티티는 가져올 수 없습니다.');
  const doc = new DOMParser({
    onError: () => {
      throw Error('Excel XML이 손상되었습니다.');
    },
  }).parseFromString(text, 'application/xml');
  if (!doc.documentElement) throw Error('Excel XML이 손상되었습니다.');
  for (const node of Array.from(doc.getElementsByTagName('*'))) {
    if (
      node.localName === 'Relationship' &&
      (node.getAttribute('TargetMode') || '').toLowerCase() === 'external'
    )
      throw Error('외부 연결이 포함된 Excel 파일은 가져올 수 없습니다.');
    const type = node.getAttribute('ContentType') || '';
    if (/macroenabled|vba|oleobject|activex|externallink/i.test(type))
      throw Error('매크로·내장 개체는 가져올 수 없습니다.');
  }
}
async function validateInflation(yauzl, DOMParser, buffer) {
  return new Promise((resolve, reject) =>
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, zip) => {
        if (error) return reject(Error('유효한 XLSX 파일이 아닙니다.'));
        let total = 0,
          count = 0,
          settled = false,
          active;
        const names = new Set();
        const fail = (e) => {
          if (settled) return;
          settled = true;
          active?.destroy();
          zip.close();
          reject(e);
        };
        zip.on('error', fail);
        zip.on('end', () => {
          if (settled) return;
          if (!names.has('[content_types].xml') || !names.has('xl/workbook.xml'))
            return fail(Error('Excel 통합문서가 아닙니다.'));
          settled = true;
          resolve();
        });
        zip.on('entry', (entry) => {
          const name = entry.fileName,
            lower = name.toLowerCase();
          const parts = name.replace(/\/$/, '').split('/');
          if (
            ++count > 2000 ||
            names.has(lower) ||
            entry.uncompressedSize > 32 * 1024 * 1024 ||
            entry.generalPurposeBitFlag & 1 ||
            ![0, 8].includes(entry.compressionMethod) ||
            ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000 ||
            name.includes('\\') ||
            name.startsWith('/') ||
            parts.some((p) => !p || p === '.' || p === '..' || p.includes(':')) ||
            /vbaproject|externallinks|macrosheets|embeddings|activex/i.test(lower)
          )
            return fail(Error('지원하지 않는 압축 항목·매크로·외부 연결입니다.'));
          names.add(lower);
          const critical = lower === '[content_types].xml' || lower.endsWith('.rels');
          const xml = critical || lower.endsWith('.xml');
          let crc = 0xffffffff,
            size = 0;
          const chunks = [];
          zip.openReadStream(entry, (error, stream) => {
            if (error) return fail(error);
            if (settled) {
              stream.destroy();
              return;
            }
            active = stream;
            stream.on('error', fail);
            stream.on('data', (chunk) => {
              total += chunk.length;
              size += chunk.length;
              if (total > 32 * 1024 * 1024 || (critical && size > 1024 * 1024))
                return fail(Error('Excel 압축 해제 크기 제한을 초과했습니다.'));
              for (const byte of chunk) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
              if (xml) chunks.push(chunk);
            });
            stream.on('end', () => {
              if (settled) return;
              try {
                if ((crc ^ 0xffffffff) >>> 0 !== entry.crc32 >>> 0)
                  throw Error('Excel 압축 파일의 체크섬이 올바르지 않습니다.');
                if (xml) {
                  const bytes = Buffer.concat(chunks),
                    text = bytes.toString('utf8');
                  if (text.includes('\0') || /<!\s*(?:DOCTYPE|ENTITY)/i.test(text))
                    throw Error('XML DTD·엔티티 또는 지원하지 않는 인코딩입니다.');
                  if (critical) checkXml(DOMParser, bytes, name);
                }
                zip.readEntry();
              } catch (e) {
                fail(e);
              }
            });
          });
        });
        zip.readEntry();
      },
    ),
  );
}
