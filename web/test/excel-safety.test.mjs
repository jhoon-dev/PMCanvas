import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { buildTemplate, buildWorkbook } from '../server/excel.mjs';
import { parseWorkbook } from '../server/excel-import.mjs';
import { previewImport, suggestMapping } from '../public/wbs-import.js';
import { screenProject } from './support/screen-fixtures.mjs';

test('Excel 입력 양식은 날짜·공수·담당자 목록을 제공하고 값 입력 후 추가 가능', async () => {
  const p = screenProject(),
    before = structuredClone(p),
    bytes = await buildTemplate(p);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  const sheet = book.getWorksheet('WBS');
  assert.equal(sheet.getCell('C2').numFmt, 'yyyy-mm-dd');
  assert.equal(sheet.getCell('B2').dataValidation.type, 'list');
  sheet.getRow(2).values = [
    '양식에서 입력',
    '김하늘',
    new Date('2026-10-26'),
    new Date('2026-10-30'),
    8,
  ];
  const sheets = await parseWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  const input = sheets.find((s) => s.name === 'WBS');
  const result = previewImport(p, input.rows.slice(1), suggestMapping(input.rows[0]));
  assert.deepEqual(result.errors, []);
  assert.equal(result.project.tasks.length, p.tasks.length + 1);
  assert.equal(result.project.tasks.at(-1).owner, 'm1');
  assert.deepEqual(p, before);
});

test('영어 내보내기 재가져오기는 언어와 무관하게 열을 연결하고 완료된 복수 세부 작업을 보존', async () => {
  const p = screenProject();
  p.tasks[0].owner = '';
  const sheets = await parseWorkbook(
    await buildWorkbook(p, '2026-10-26', undefined, { language: 'en' }),
  );
  const input = sheets.find((s) => s.name === 'WBS'),
    mapping = suggestMapping(input.rows[0]);
  input.rows[1][mapping.name] = 'Excel에서 수정';
  const result = previewImport(p, input.rows.slice(1), mapping, { mode: 'update' });
  assert.deepEqual(result.errors, []);
  assert.equal(result.project.tasks[0].name, 'Excel에서 수정');
  assert.deepEqual(result.project.tasks[0].items, p.tasks[0].items);
  assert.equal(result.project.tasks[0].owner, '');
});

test('손상된 CRC는 압축 크기가 정상이어도 거절', async () => {
  const bytes = await buildTemplate(screenProject());
  const offset = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bytes.writeUInt32LE((bytes.readUInt32LE(offset + 16) ^ 1) >>> 0, offset + 16);
  await assert.rejects(parseWorkbook(bytes), /체크섬/);
});

for (const attack of [
  'external',
  'encoded-external',
  'macro',
  'embedded',
  'doctype',
  'case-collision',
]) {
  test('Excel 비활성 콘텐츠·잘못된 아카이브 거절: ' + attack, async () => {
    const zip = await JSZip.loadAsync(await buildTemplate(screenProject()));
    if (attack === 'external' || attack === 'encoded-external') {
      const file = 'xl/_rels/workbook.xml.rels';
      const xml = await zip.file(file).async('string');
      zip.file(
        file,
        xml.replace(
          '</Relationships>',
          '<Relationship Id="evil" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="https://example.com/linked.xlsx" TargetMode="' +
            (attack === 'external' ? 'External' : '&#69;xternal') +
            '"/></Relationships>',
        ),
      );
    }
    if (attack === 'macro') {
      const file = '[Content_Types].xml',
        xml = await zip.file(file).async('string');
      zip.file(
        file,
        xml.replace(
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
          'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
        ),
      );
    }
    if (attack === 'embedded') zip.file('xl/embeddings/package.bin', 'not executable');
    if (attack === 'doctype') {
      const file = 'xl/worksheets/sheet1.xml',
        xml = await zip.file(file).async('string');
      zip.file(
        file,
        xml.replace(
          '?>',
          '?><!DOCTYPE worksheet [<!ENTITY x SYSTEM "https://example.com/entity">]>',
        ),
      );
    }
    if (attack === 'case-collision')
      zip.file('XL/WORKBOOK.XML', await zip.file('xl/workbook.xml').async('string'));
    await assert.rejects(parseWorkbook(await zip.generateAsync({ type: 'nodebuffer' })));
  });
}
