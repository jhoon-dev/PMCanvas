import ExcelJS from 'exceljs';
import {
  buildWorkbook as buildShared,
  buildTemplate as templateShared,
} from '../../shared/node/excel.mjs';
import { fileJob } from './file-jobs.mjs';
export const buildWorkbook = (...args) => buildShared(ExcelJS, ...args);
export const buildTemplate = (...args) => templateShared(ExcelJS, ...args);
export function projectWorkbook(project, at, ids = project.tasks.map((t) => t.id), options = {}) {
  return fileJob('export', { project, at, ids, options });
}
