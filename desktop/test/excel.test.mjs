import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ExcelJS from 'exceljs';
import { DesktopDocument } from '../document.mjs';
import { ExcelImportSession, readExcelFile } from '../excel-session.mjs';
import { createExcelJobs } from '../excel-jobs.mjs';
import { performExcelJob } from '../excel-worker.mjs';
import { suggestMapping } from '../app/shared/excel-import-model.js';

const project = () => ({
  id: 'desktop-project',
  name: '=1+1',
  description: '',
  holidays: [],
  members: [{ id: 'm', name: '담당자', grade: '중급', role: '개발', hours: 8, allocation: 100 }],
  tasks: [
    {
      id: 't',
      name: '기존 업무',
      phase: '',
      owner: 'm',
      start: '2026-10-26',
      end: '2026-10-30',
      predecessor: '',
      memo: '',
      items: [{ id: 'i', title: '완료한 항목', hours: 8, doneDate: '2026-10-26' }],
    },
  ],
});

test('English Excel jobs translate sheets and headers while retaining user content', async () => {
  const p = project();
  p.name = '저장';
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(
    await performExcelJob('export', {
      project: p,
      options: { kind: 'wbs', at: '2026-10-26', language: 'en' },
    }),
  );
  assert.ok(book.getWorksheet('Gantt'));
  assert.equal(book.getWorksheet('Guide').getCell('B2').value, '저장');
  assert.equal(book.getWorksheet('WBS').getCell('C2').value, '기존 업무');
  await book.xlsx.load(await performExcelJob('template', { project: p, language: 'en' }));
  assert.equal(book.getWorksheet('WBS').getCell('A1').value, 'Task name');
  assert.equal(book.getWorksheet('Team').getCell('A2').value, '담당자');
});
function fixture(t) {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-excel-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const document = new DesktopDocument(path.join(folder, 'recovery.json'));
  document.create(project());
  return { folder, document };
}

test('Excel 출력은 날짜·진척률·간트·안전한 문자열을 포함하고 문서를 바꾸지 않음', async (t) => {
  const { document } = fixture(t),
    before = document.snapshot();
  const bytes = await performExcelJob('export', {
    project: document.project,
    options: { kind: 'wbs', at: '2026-10-26' },
    dirty: true,
  });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  assert.ok(book.getWorksheet('간트'));
  assert.equal(book.getWorksheet('안내').getCell('B2').type, ExcelJS.ValueType.String);
  assert.equal(
    book.getWorksheet('WBS').getCell('E2').value.toISOString().slice(0, 10),
    '2026-10-26',
  );
  assert.deepEqual(document.snapshot(), before);
  const completion = await performExcelJob('export', {
    project: document.project,
    options: { kind: 'completion', from: '2026-10-26', to: '2026-10-26', owner: 'm' },
  });
  await book.xlsx.load(completion);
  assert.equal(book.worksheets[0].getCell('B2').value.toISOString().slice(0, 10), '2026-10-26');
});

test('네이티브 Excel 가져오기는 미리보기·확인 후에만 적용하고 원본 파일·완료 기록 보존', async (t) => {
  const { folder, document } = fixture(t);
  const bytes = await performExcelJob('template', { project: document.project }),
    book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  book.getWorksheet('WBS').getRow(2).values = [
    '추가 업무',
    '담당자',
    new Date('2026-10-26'),
    new Date('2026-10-30'),
    8,
  ];
  const file = path.join(folder, 'input.xlsx'),
    source = Buffer.from(await book.xlsx.writeBuffer());
  writeFileSync(file, source);
  const session = new ExcelImportSession(document, performExcelJob),
    before = document.snapshot();
  const loaded = await session.open(file, before.revision),
    sheet = loaded.sheets.findIndex((s) => s.name === 'WBS');
  const options = { sheet, mode: 'append', mapping: suggestMapping(loaded.sheets[sheet].rows[0]) };
  assert.deepEqual(session.preview(loaded.id, options).errors, []);
  assert.deepEqual(document.snapshot(), before);
  assert.throws(() => session.apply(loaded.id, before.revision - 1), /변경/);
  const result = session.apply(loaded.id, before.revision);
  assert.equal(result.project.tasks.length, 2);
  assert.equal(result.dirty, true);
  assert.deepEqual(result.project.tasks[0].items, before.project.tasks[0].items);
  assert.deepEqual(readFileSync(file), source);
  assert.throws(() => session.apply(loaded.id, result.revision), /변경/);
});

test('미리보기 후 문서 변경·취소·오류가 있는 Excel은 적용할 수 없음', async (t) => {
  const { folder, document } = fixture(t),
    file = path.join(folder, 'input.xlsx');
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet('WBS');
  sheet.addRow(['업무명', '시작일', '종료일']);
  sheet.addRow(['오류 업무', 'invalid', '2026-10-30']);
  writeFileSync(file, Buffer.from(await book.xlsx.writeBuffer()));
  const session = new ExcelImportSession(document, performExcelJob),
    loaded = await session.open(file, document.revision);
  const before = document.snapshot();
  assert.ok(
    session.preview(loaded.id, {
      sheet: 0,
      mode: 'append',
      mapping: suggestMapping(loaded.sheets[0].rows[0]),
    }).errors.length,
  );
  assert.throws(() => session.apply(loaded.id, document.revision), /미리보기/);
  document.replace({ ...document.project, name: '새로운 변경' }, document.revision);
  assert.throws(
    () => session.preview(loaded.id, { sheet: 0, mode: 'append', mapping: {} }),
    /변경/,
  );
  session.cancel(loaded.id);
  assert.equal(session.current, null);
  assert.equal(before.project.tasks.length, document.project.tasks.length);
  assert.throws(() => readExcelFile(folder));
  const huge = path.join(folder, 'huge.xlsx');
  writeFileSync(huge, Buffer.alloc(4 * 1024 * 1024 + 1));
  assert.throws(() => readExcelFile(huge), /제한|일반/);
});

test('Excel 작업 프로세스의 제한·출력 완료·재시도는 Node 실행에서도 유지', async (t) => {
  const fork = (file, _args, options) => {
    const child = spawn(process.execPath, [...options.execArgv, file, '--excel-job'], {
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.postMessage = (data) => child.stdin.end(JSON.stringify(data));
    return child;
  };
  const job = createExcelJobs(fork);
  const first = job('template', { project: project() });
  await assert.rejects(job('template', { project: project() }), /진행 중/);
  const bytes = await first;
  assert.equal(bytes.subarray(0, 2).toString(), 'PK');
  await assert.rejects(job('import', { file: Buffer.from('invalid').toString('base64') }));
  assert.equal((await job('template', { project: project() })).subarray(0, 2).toString(), 'PK');
  const timeout = createExcelJobs(fork, { timeout: 1 });
  await assert.rejects(timeout('template', { project: project() }), /시간/);
});
