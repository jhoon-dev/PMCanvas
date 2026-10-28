import ExcelJS from 'exceljs';
import yauzl from 'yauzl';
import { DOMParser } from '@xmldom/xmldom';
import { parseWorkbook } from './app/node/excel-import.mjs';
import { buildWorkbook, buildTemplate, buildCompletionWorkbook } from './app/node/excel.mjs';

export async function performExcelJob(kind, input) {
  if (kind === 'import')
    return Buffer.from(
      JSON.stringify(
        await parseWorkbook(ExcelJS, yauzl, DOMParser, Buffer.from(input.file, 'base64')),
      ),
    );
  if (kind === 'template') return buildTemplate(ExcelJS, input.project);
  if (kind === 'export')
    return input.options.kind === 'completion'
      ? buildCompletionWorkbook(ExcelJS, input.project, input.options)
      : buildWorkbook(ExcelJS, input.project, input.options.at, undefined, { draft: input.dirty });
  throw Error('지원하지 않는 Excel 작업입니다.');
}
async function execute({ kind, input }) {
  try {
    const result = await performExcelJob(kind, input);
    process.stdout.write(result, () => process.exit(0));
  } catch (error) {
    process.stderr.write(String(error.message).slice(0, 500), () => process.exit(1));
  }
}
if (process.parentPort) process.parentPort.once('message', ({ data }) => void execute(data));
else if (process.argv[2] === '--excel-job') {
  let size = 0;
  const chunks = [];
  try {
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) throw Error('Excel 요청이 너무 큽니다.');
      chunks.push(chunk);
    }
    await execute(JSON.parse(Buffer.concat(chunks)));
  } catch (error) {
    process.stderr.write(error.message);
    process.exitCode = 1;
  }
}
