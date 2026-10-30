import { hierarchy, rollups, criticalPath, baselineDiff } from '../browser/planning.js';
import { ui } from '../browser/i18n.js';
import { completionRecords } from '../browser/reports.js';
import {
  dateValue,
  addDays,
  daysBetween,
  forecast,
  taskHours,
  progress,
  earned,
  today,
} from '../browser/engine.js';

const date = (s) => (s ? new Date(dateValue(s)) : null);
const fill = (color) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: color } });
function sheet(book, name, headers, widths) {
  const s = book.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: {
      orientation: 'landscape',
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });
  s.columns = headers.map((header, i) => ({ header, width: widths[i] || 18 }));
  s.getRow(1).height = 30;
  s.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  s.getRow(1).fill = fill('FF243654');
  s.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  return s;
}

export async function buildTemplate(ExcelJS, project, { language = 'ko' } = {}) {
  const text = (s) => ui(s, language),
    book = new ExcelJS.Workbook();
  book.creator = 'PM Canvas';
  const input = sheet(
    book,
    'WBS',
    [
      '업무명',
      '담당자',
      '시작일',
      '종료일',
      '공수 (h)',
      '단계',
      '선행 업무',
      '메모',
      '업무 ID',
      '상위 업무 ID',
    ].map(text),
    [35, 20, 16, 16, 14, 18, 20, 40, 38, 38],
  );
  for (let n = 2; n <= 501; n++) {
    input.getCell(n, 3).numFmt = input.getCell(n, 4).numFmt = 'yyyy-mm-dd';
    input.getCell(n, 5).numFmt = '0.0';
  }
  const guide = sheet(book, text('안내'), [text('항목'), text('내용')], [25, 95]);
  for (const pair of [
    ['프로젝트', project.name],
    ['사용 안내', 'WBS 시트에 업무를 입력한 뒤 가져오기에서 미리보기를 확인하세요.'],
    ['담당자', '현재 프로젝트에 등록된 담당자 이름을 입력하거나 비워 두세요.'],
    [
      '업무 ID',
      '새 업무 추가에서는 비워 두어도 됩니다. 기존 업무 갱신에는 내보낸 업무 ID를 사용하세요.',
    ],
    ['주의', '수식·매크로·외부 연결은 지원하지 않습니다. 값으로 붙여넣으세요.'],
  ])
    row(guide, [text(pair[0]), pair[0] === '프로젝트' ? pair[1] : text(pair[1])]);
  if (project.members?.length) {
    const people = sheet(book, text('참여인력'), [text('담당자'), text('참여인력 ID')], [30, 38]);
    for (const m of project.members) row(people, [m.name, m.id]);
    book.definedNames.add(
      "'" + people.name + "'!$A$2:$A$" + (project.members.length + 1),
      'PMCanvasOwners',
    );
    for (let n = 2; n <= 501; n++)
      input.getCell(n, 2).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['PMCanvasOwners'],
      };
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

export async function buildCompletionWorkbook(
  ExcelJS,
  project,
  { from, to, owner = '', language = 'ko' },
) {
  const text = (s) => ui(s, language),
    book = new ExcelJS.Workbook();
  const s = sheet(
    book,
    text('완료 기록'),
    ['프로젝트', '완료일', '담당자', '업무명', '완료한 세부 작업', '예상 공수 (h)'].map(text),
    [30, 16, 20, 40, 50, 18],
  );
  for (const record of completionRecords(project, { from, to, owner })) {
    const r = row(s, [
      project.name,
      date(record.date),
      record.owner,
      record.task,
      record.title,
      record.hours,
    ]);
    r.getCell(2).numFmt = 'yyyy-mm-dd';
    r.getCell(6).numFmt = '0.0';
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}
function row(s, values) {
  const r = s.addRow(values);
  r.height = 30;
  r.alignment = { vertical: 'middle', wrapText: true };
  if (r.number % 2 === 0) r.fill = fill('FFF0F4FA');
  return r;
}
export async function buildWorkbook(
  ExcelJS,
  project,
  at,
  ids = project.tasks.map((t) => t.id),
  { draft = false, language = 'ko' } = {},
) {
  const text = (value) => ui(value, language),
    aggregate = rollups(project, at);
  const book = new ExcelJS.Workbook();
  book.creator = 'PMCanvas';
  book.created = new Date();
  const selected = new Set(ids),
    tasks = project.tasks.filter((t) => selected.has(t.id)),
    fc = forecast(project, at).tasks,
    tree = hierarchy(project),
    cp = criticalPath(project);
  const owners = new Map(project.members.map((m) => [m.id, m.name])),
    names = new Map(project.tasks.map((t) => [t.id, t.name]));
  const cover = sheet(book, text('안내'), [text('항목'), text('내용')], [26, 90]);
  for (const pair of [
    [text('프로젝트'), project.name],
    [text('설명'), project.description],
    [text('보고 기준일'), date(at)],
    [text('데이터'), draft ? text('저장 전 초안') : text('저장된 프로젝트')],
    [text('출력 업무 수'), tasks.length],
    [text('예상 공수 (h)'), tasks.reduce((n, t) => n + taskHours(t), 0)],
    [text('완료 공수 (h)'), tasks.reduce((n, t) => n + earned(t, at), 0)],
    [text('간트 범례'), text('파랑: 계획 / 초록: 완료 업무 / 주황: 예상 일정')],
    [
      text('사용 안내'),
      text(
        '현재 검색·담당자 조건에 해당하는 업무를 출력합니다. 예상 일정은 전체 프로젝트를 기준으로 계산합니다.',
      ),
    ],
    [
      text('일정 안내'),
      text(
        '날짜와 숫자는 Excel 데이터 형식입니다. Excel 수정 사항은 가져오기에서 미리보기를 확인하고 저장해야 반영됩니다.',
      ),
    ],
  ])
    row(cover, pair);
  cover.getCell('B4').numFmt = 'yyyy-mm-dd';
  const wbs = sheet(
    book,
    'WBS',
    [
      'WBS',
      text('단계'),
      text('업무명'),
      text('담당자'),
      text('시작일'),
      text('종료일'),
      text('공수 (h)'),
      text('진척률'),
      text('예상 완료일'),
      text('지연 (근무일)'),
      text('선행 업무'),
      text('메모'),
      text('업무 ID'),
      text('상위 업무 ID'),
      text('선행 업무 ID'),
      text('하위 포함 공수 (h)'),
      text('하위 포함 진척률'),
      text('임계 업무'),
    ],
    [9, 18, 38, 18, 15, 15, 14, 14, 16, 16, 30, 55],
  );
  for (const t of tasks) {
    const r = row(wbs, [
      tree.get(t.id).number,
      t.phase,
      t.name,
      owners.get(t.owner) || text('미지정'),
      date(t.start),
      date(t.end),
      taskHours(t),
      progress(t, at),
      date(fc[t.id]?.end),
      fc[t.id]?.late ?? null,
      names.get(t.predecessor) || '',
      t.memo,
      t.id,
      t.parentId || '',
      t.predecessor || '',
      aggregate.get(t.id).hours,
      aggregate.get(t.id).progress,
      cp.ids.has(t.id) ? text('예') : '',
    ]);
    r.getCell(17).numFmt = '0.0%';
    for (const c of [5, 6, 9]) r.getCell(c).numFmt = 'yyyy-mm-dd';
    r.getCell(7).numFmt = '0.0';
    r.getCell(8).numFmt = '0.0%';
  }
  const details = sheet(
    book,
    text('세부 작업'),
    ['WBS', text('업무명'), text('세부 작업'), text('공수 (h)'), text('완료일')],
    [9, 38, 55, 15, 15],
  );
  for (const t of tasks)
    for (const item of t.items) {
      const r = row(details, [
        tree.get(t.id).number,
        t.name,
        item.title,
        item.hours,
        date(item.doneDate),
      ]);
      r.getCell(4).numFmt = '0.0';
      r.getCell(5).numFmt = 'yyyy-mm-dd';
    }
  if (project.baseline) {
    const b = sheet(
      book,
      text('기준 계획 비교'),
      [
        text('업무 ID'),
        text('업무명'),
        text('변경'),
        text('시작 차이 (일)'),
        text('종료 차이 (일)'),
        text('공수 차이 (h)'),
      ],
      [20, 38, 18, 18, 18, 18],
    );
    const diff = baselineDiff(project);
    for (const r of diff.rows.filter((r) => selected.has(r.id)))
      row(b, [r.id, r.name, r.added ? text('추가') : text('기존'), r.start, r.end, r.hours]);
    for (const r of diff.removed) row(b, [r.id, r.name, text('삭제'), null, null, null]);
  }
  const dates = tasks
    .flatMap((t) => [t.start, t.end, fc[t.id]?.start, fc[t.id]?.end])
    .filter(Boolean)
    .sort();
  const first = dates[0] || at,
    last = dates.at(-1) || at;
  // At most 120 timeline buckets, including projects spanning many years.
  const step = Math.max(1, Math.ceil((daysBetween(first, last) + 1) / 120)),
    buckets = [];
  for (let d = first; d <= last; d = addDays(d, step)) buckets.push(d);
  const gantt = sheet(
    book,
    text('간트'),
    [text('업무명'), text('구분'), ...buckets.map((d) => date(d))],
    [38, 16, ...buckets.map(() => 12)],
  );
  gantt.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];
  for (let i = 3; i <= buckets.length + 2; i++) gantt.getCell(1, i).numFmt = 'mm-dd';
  for (const t of tasks)
    for (const [label, start, end, color] of [
      [text('계획'), t.start, t.end, progress(t, at) === 1 ? 'FF238B68' : 'FF416BE8'],
      [text('예상'), fc[t.id]?.start, fc[t.id]?.end, 'FFDF9A40'],
    ]) {
      const r = row(gantt, [t.name, label]);
      for (let i = 0; i < buckets.length; i++)
        if (start && end && start <= addDays(buckets[i], step - 1) && end >= buckets[i])
          r.getCell(i + 3).fill = fill(color);
    }
  row(cover, [
    text('간트 한 칸'),
    step === 1 ? text('1일') : text(`${step}일 (장기 일정 자동 축약)`),
  ]);
  return Buffer.from(await book.xlsx.writeBuffer());
}
