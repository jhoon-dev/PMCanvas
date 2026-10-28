import ExcelJS from 'exceljs';
import yauzl from 'yauzl';
import { DOMParser } from '@xmldom/xmldom';
import { fileJob } from './file-jobs.mjs';
import { parseWorkbook as parseShared } from '../../shared/node/excel-import.mjs';
export const parseWorkbook = (buffer) => parseShared(ExcelJS, yauzl, DOMParser, buffer);
export async function readWorkbook(base64) {
  if (
    typeof base64 !== 'string' ||
    base64.length > 5592408 ||
    base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  )
    throw Error('Excel 파일 형식을 확인해 주세요.');
  return JSON.parse((await fileJob('import', { file: base64 })).toString());
}
