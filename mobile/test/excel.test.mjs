import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DOMParser } from '@xmldom/xmldom';
import { parseWorkbook } from '../../shared/node/excel-import.mjs';
import { browserZip } from '../src/excel-zip.js';
import { buildWorkbook } from '../../shared/node/excel.mjs';
import { normalizeProject } from '../src/model.mjs';
const fixture = () =>
  normalizeProject({
    id: 'offline-excel',
    name: '공통 Excel',
    description: '',
    holidays: [],
    members: [],
    tasks: [
      {
        id: 'task',
        name: '현황 확인',
        owner: '',
        phase: '',
        start: '2026-10-29',
        end: '2026-10-30',
        predecessor: '',
        memo: '',
        items: [{ id: 'item', title: '검증', hours: 8, doneDate: null }],
      },
    ],
  });
const require = createRequire(import.meta.url),
  ExcelJS = require('exceljs'),
  JSZip = require('jszip');
const parse = (bytes) => parseWorkbook(ExcelJS, browserZip, DOMParser, bytes);
test('offline mobile Excel uses the common workbook and validator and preserves typed report values', async () => {
  const bytes = await buildWorkbook(ExcelJS, fixture(), '2026-10-30');
  const sheets = await parse(bytes);
  assert.ok(sheets.some((sheet) => sheet.name === 'WBS'));
  assert.ok(sheets.find((sheet) => sheet.name === 'WBS').rows.length > 1);
});
test('offline ZIP reader rejects CRC corruption, formulas, external XML, forged sizes and alternate path metadata', async () => {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('WBS').addRow(['업무명']);
  book.getWorksheet('WBS').addRow(['값']);
  const bytes = Buffer.from(await book.xlsx.writeBuffer());
  const zip = await JSZip.loadAsync(bytes);
  zip.file('xl/worksheets/sheet1.xml', '<!DOCTYPE test [<!ENTITY boom "x">]><test>&boom;</test>');
  await assert.rejects(parse(await zip.generateAsync({ type: 'nodebuffer' })), /DTD|엔티티/);
  const links = await JSZip.loadAsync(bytes);
  links.file(
    '_rels/.rels',
    '<Relationships><Relationship TargetMode="External" Target="https://example.com"/></Relationships>',
  );
  await assert.rejects(parse(await links.generateAsync({ type: 'nodebuffer' })), /외부 연결/);
  book.getWorksheet('WBS').getCell('A2').value = { formula: '1+1', result: 2 };
  await assert.rejects(parse(Buffer.from(await book.xlsx.writeBuffer())), /수식/);
  const stored = await (
    await JSZip.loadAsync(bytes)
  ).generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  let central = stored.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  const broken = Buffer.from(stored);
  broken.writeUInt32LE((broken.readUInt32LE(central + 16) ^ 1) >>> 0, central + 16);
  await assert.rejects(parse(broken), /체크섬/);
  const size = Buffer.from(stored);
  size.writeUInt32LE(1, central + 24);
  await assert.rejects(parse(size), /크기/);
  const macro = await JSZip.loadAsync(bytes);
  macro.file('xl/vbaProject.bin', 'macro');
  await assert.rejects(parse(await macro.generateAsync({ type: 'nodebuffer' })), /매크로|외부/);
});
