import { summary, today, validDate } from './app/shared/engine.js';
import { csvText, wbsRows, completionRecords, completionRows } from './app/shared/reports.js';
import { getLanguage, setLanguage, ui, supportedLanguages } from './app/shared/i18n.js';

// Build exports from the main process document, never renderer-provided CSV or file paths.
export function buildReport(project, options) {
  const language = options?.language ?? 'ko';
  if (!supportedLanguages.includes(language)) throw Error('Unsupported language.');
  const previous = getLanguage();
  setLanguage(language);
  try {
    return report(project, options);
  } finally {
    setLanguage(previous);
  }
}
function report(project, options) {
  if (!project) throw Error('프로젝트를 먼저 열어 주세요.');
  if (!options || typeof options !== 'object') throw Error('보고서 종류를 확인해 주세요.');
  let rows, label;
  if (options.kind === 'wbs') {
    if (!validDate(options.at) || options.at > today())
      throw Error('오늘까지의 보고 기준일을 선택해 주세요.');
    rows = wbsRows(project, options.at, summary(project, options.at).forecast);
    label = ui('업무현황') + '-' + options.at;
  } else if (options.kind === 'completion') {
    const { from, to, owner = '' } = options;
    if (!validDate(from) || !validDate(to) || from > to || to > today())
      throw Error('오늘까지의 올바른 조회 기간을 선택해 주세요.');
    if (typeof owner !== 'string' || (owner && !project.members.some((m) => m.id === owner)))
      throw Error('조회할 담당자를 확인해 주세요.');
    rows = completionRows(project, completionRecords(project, { from, to, owner }));
    label = ui('완료기록') + '-' + from + '-' + to;
  } else {
    throw Error('보고서 종류를 확인해 주세요.');
  }
  const name = project.name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 80) || 'Project';
  return { filename: 'PM-Canvas-' + name + '-' + label + '.csv', csv: csvText(rows) };
}
