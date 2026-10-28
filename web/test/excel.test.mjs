import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { projectWorkbook } from '../server/excel.mjs';
const task = (id, start = '2026-10-19', end = '2026-10-23') => ({
  id,
  name: '=HYPERLINK("test")',
  phase: '개발',
  owner: 'm1',
  start,
  end,
  predecessor: '',
  memo: '한글 메모',
  items: [{ id: 'i' + id, title: '세부 구현', hours: 8, doneDate: '2026-10-19' }],
});
const project = {
  name: 'Excel 테스트',
  description: '일정 출력',
  holidays: [],
  members: [{ id: 'm1', name: '담당자', hours: 8, allocation: 100 }],
  tasks: [task('t1'), task('t2')],
};
test('Excel 출력: 선택 업무, 실제 날짜·숫자·진척률, 안전한 문자열과 간트', async () => {
  const buffer = await projectWorkbook(project, '2026-10-23', ['t1'], { draft: true });
  assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer);
  assert.deepEqual(
    book.worksheets.map((s) => s.name),
    ['안내', 'WBS', '세부 작업', '간트'],
  );
  const s = book.getWorksheet('WBS');
  assert.equal(s.rowCount, 2);
  assert.equal(s.getCell('C2').value, project.tasks[0].name);
  assert.equal(s.getCell('C2').type, ExcelJS.ValueType.String);
  assert.equal(s.getCell('E2').value.toISOString(), '2026-10-19T00:00:00.000Z');
  assert.equal(s.getCell('G2').value, 8);
  assert.equal(s.getCell('H2').value, 1);
  assert.equal(s.getCell('H2').numFmt, '0.0%');
  assert.equal(book.getWorksheet('안내').getCell('B5').value, '저장 전 초안');
  assert.equal(book.getWorksheet('세부 작업').rowCount, 2);
  assert.equal(book.getWorksheet('간트').getCell('C2').fill.fgColor.argb, 'FF238B68');
});
test('장기 간트는 120칸 이내로 축약하고 모든 업무의 끝을 포함', async () => {
  const p = { ...project, tasks: [task('t1', '2020-01-01', '2030-01-01')] };
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await projectWorkbook(p, '2026-10-23'));
  const s = book.getWorksheet('간트');
  assert.ok(s.columnCount <= 122);
  assert.equal(s.getCell(2, s.columnCount).fill.fgColor.argb, 'FF238B68');
});
