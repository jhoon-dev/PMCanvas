import { progress, planned, taskHours, workdays, addDays, validDate } from './engine.js';
import { ui } from './i18n.js';
import { hierarchy } from './planning.js';

// Quote every value and force formula-like user text to plain text in Excel.
export function csvText(rows) {
  return (
    '\uFEFF' +
    rows
      .map((row) =>
        row
          .map((value) => {
            let text = String(value ?? '');
            if (/^[\s]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = "'" + text;
            return '"' + text.replaceAll('"', '""') + '"';
          })
          .join(','),
      )
      .join('\r\n') +
    '\r\n'
  );
}

export function wbsRows(project, at, forecast, tasks = project.tasks) {
  const tree = hierarchy(project);
  const header = [
    '프로젝트',
    '보고 기준일',
    'WBS',
    '단계',
    '업무명',
    '담당자',
    '등급',
    '투입률 (%)',
    '계획 시작일',
    '계획 종료일',
    '예상 공수 (h)',
    '계획 진척률 (%)',
    '실제 진척률 (%)',
    '상태',
    '예상 완료일',
    '계획 대비 지연 (근무일)',
    '추정 방법',
    '선행 업무',
    '메모',
  ];
  const methods = {
    actual: '실제 완료',
    velocity: '최근 속도 반영',
    plan: '계획 기준 추정',
    unavailable: '계산 대기',
  };
  return [
    header.map((label) => ui(label)),
    ...tasks.map((task) => {
      const member = project.members.find((m) => m.id === task.owner);
      const f = forecast.tasks[task.id];
      const total = taskHours(task),
        actual = progress(task, at);
      return [
        project.name,
        at,
        tree.get(task.id).number,
        task.phase || '',
        task.name,
        member?.name || ui('미지정'),
        member?.grade || '',
        member?.allocation ?? '',
        task.start,
        task.end,
        total,
        total ? +((planned(task, at, project.holidays) / total) * 100).toFixed(1) : 0,
        +(actual * 100).toFixed(1),
        ui(actual === 1 ? '완료' : task.end < at ? '지연' : actual > 0 ? '진행 중' : '예정'),
        f?.end || '',
        f?.end ? Math.max(0, workdays(addDays(task.end, 1), f.end, project.holidays)) : '',
        ui(methods[f?.method] || '계산 대기'),
        project.tasks.find((t) => t.id === task.predecessor)?.name || '',
        task.memo || '',
      ];
    }),
  ];
}

export function completionRecords(project, { from, to, owner = '' }) {
  if (!validDate(from) || !validDate(to) || from > to)
    throw Error('조회 시작일과 종료일을 확인해 주세요.');
  return project.tasks
    .flatMap((task) => {
      if (owner && task.owner !== owner) return [];
      const member = project.members.find((m) => m.id === task.owner);
      return task.items
        .filter((item) => item.doneDate && item.doneDate >= from && item.doneDate <= to)
        .map((item) => ({
          date: item.doneDate,
          taskId: task.id,
          task: task.name,
          phase: task.phase || '',
          owner: member?.name || ui('미지정'),
          grade: member?.grade || '',
          title: item.title,
          hours: item.hours,
        }));
    })
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        a.task.localeCompare(b.task, 'ko') ||
        a.title.localeCompare(b.title, 'ko'),
    );
}

export function completionRows(project, records) {
  return [
    [
      '프로젝트',
      '완료일',
      '담당자',
      '등급',
      '단계',
      '업무명',
      '완료한 세부 작업',
      '예상 공수 (h)',
    ].map((label) => ui(label)),
    ...records.map((r) => [
      project.name,
      r.date,
      r.owner,
      r.grade,
      r.phase,
      r.task,
      r.title,
      r.hours,
    ]),
  ];
}
