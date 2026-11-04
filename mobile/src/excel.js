import ExcelJS from 'exceljs/dist/exceljs.min.js';
import { Buffer } from 'buffer';
import { DOMParser } from '@xmldom/xmldom';
import { parseWorkbook } from '../../shared/node/excel-import.mjs';
import { buildWorkbook, buildTemplate, buildCompletionWorkbook } from '../../shared/node/excel.mjs';
import { browserZip } from './excel-zip.js';
import { shareFile } from './platform.js';
export async function readExcel(file) {
  if (file.size > 4 * 1024 * 1024) throw Error('Excel 파일은 4MB 이하로 선택해 주세요.');
  return {
    sheets: await parseWorkbook(
      ExcelJS,
      browserZip,
      DOMParser,
      Buffer.from(await file.arrayBuffer()),
    ),
  };
}
export async function exportExcel(
  project,
  { at, kind = 'wbs', from, to, owner = '', ids, draft = false } = {},
) {
  const bytes =
    kind === 'template'
      ? await buildTemplate(ExcelJS, project)
      : kind === 'completion'
        ? await buildCompletionWorkbook(ExcelJS, project, { from, to, owner })
        : await buildWorkbook(ExcelJS, project, at, ids, { draft });
  await shareFile(
    project.name +
      '-' +
      (kind === 'template' ? '입력양식' : kind === 'completion' ? '완료기록' : '업무현황') +
      '.xlsx',
    bytes,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
}
