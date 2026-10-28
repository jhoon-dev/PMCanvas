import { randomUUID } from 'node:crypto';
import { readBounded } from './file-io.mjs';
import { importFields, previewImport } from './app/shared/excel-import-model.js';

export function readExcelFile(file) {
  if (typeof file !== 'string' || !file.toLowerCase().endsWith('.xlsx'))
    throw Error('XLSX 파일을 선택해 주세요.');
  return readBounded(file, 4 * 1024 * 1024);
}
export class ExcelImportSession {
  constructor(document, job) {
    this.document = document;
    this.job = job;
  }
  async open(file, revision) {
    if (!this.document.project || revision !== this.document.revision)
      throw Error('문서가 변경되었습니다. 다시 시도해 주세요.');
    this.current = null;
    const sheets = JSON.parse(
      (await this.job('import', { file: readExcelFile(file).toString('base64') })).toString(),
    );
    if (revision !== this.document.revision)
      throw Error('문서가 변경되었습니다. 다시 시도해 주세요.');
    const id = randomUUID();
    this.current = { id, revision, sheets };
    return { id, sheets };
  }
  check(id, revision = this.document.revision) {
    if (
      !this.current ||
      id !== this.current.id ||
      revision !== this.current.revision ||
      revision !== this.document.revision
    )
      throw Error('문서나 Excel 파일이 변경되었습니다. 파일을 다시 선택해 주세요.');
    return this.current;
  }
  preview(id, options) {
    const state = this.check(id);
    state.preview = null;
    if (
      !options ||
      !Number.isInteger(options.sheet) ||
      !state.sheets[options.sheet] ||
      !['append', 'update'].includes(options.mode)
    )
      throw Error('시트와 가져오기 방식을 확인해 주세요.');
    const sheet = state.sheets[options.sheet];
    if (sheet.error) throw Error(sheet.error);
    const mapping = Object.fromEntries(
      importFields.map(([field]) => [field, options.mapping?.[field] ?? -1]),
    );
    const result = previewImport(this.document.project, sheet.rows.slice(1), mapping, {
      mode: options.mode,
    });
    state.preview = result;
    return { changes: result.changes, errors: result.errors };
  }
  apply(id, revision) {
    const state = this.check(id, revision);
    if (!state.preview || state.preview.errors.length)
      throw Error('오류 없는 미리보기를 먼저 확인해 주세요.');
    const result = this.document.replace(state.preview.project, revision);
    this.current = null;
    return result;
  }
  cancel(id) {
    if (this.current?.id === id) this.current = null;
  }
}
