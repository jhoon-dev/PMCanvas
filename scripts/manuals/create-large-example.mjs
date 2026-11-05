import { repositoryRoot } from './paths.mjs';
process.chdir(repositoryRoot);
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { today, addDays, shiftWorkday, summary } from '../../shared/browser/engine.js';
import { projectHolidays } from '../../shared/browser/korean-holidays.js';
import { captureBaseline, baselineDiff, scheduleWarnings } from '../../shared/browser/planning.js';
import { weeklyDraft, weekRange, monthlyPlan } from '../../shared/browser/management.js';
import { cleanProject } from '../../shared/model/project.mjs';
import { serializeDocument, parseDocument } from '../../desktop/document.mjs';

const directory = path.resolve('test-results/manuals/example');
fs.mkdirSync(directory, { recursive: true });
const manifestPath = path.join(directory, 'large-example-result.json');
const previous = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  : null;
if (previous && !process.argv.includes('--refresh')) {
  console.log(JSON.stringify(previous, null, 2));
  process.exit(0);
}
const at = today();
const project = {
  id: previous?.id || randomUUID(),
  name: '스마트워크 통합 플랫폼 구축',
  description:
    '화면 탐색과 프로젝트 관리 기능을 살펴보기 위한 가상 데이터입니다. 3단계 WBS, 계획 대비 지연·완료 실적, 인력 투입·이슈·리스크와 6주 보고서를 포함합니다.',
  demo: false,
  koreanHolidays: true,
  holidays: [],
  members: [],
  tasks: [],
};
const names = [
  '김하늘',
  '이서준',
  '박지민',
  '최서연',
  '정도윤',
  '강수빈',
  '조예린',
  '윤시우',
  '장민서',
  '임지호',
  '한유진',
  '오준호',
  '서지안',
  '신도현',
  '권채원',
  '황민재',
  '안서윤',
  '송지후',
];
const roles = [
  '프로젝트 관리',
  '서비스 기획',
  '업무 분석',
  'UX 설계',
  'UI 디자인',
  '디자인 시스템',
  '프론트엔드',
  '프론트엔드',
  '모바일',
  '백엔드',
  '백엔드',
  '데이터',
  '플랫폼',
  '인프라',
  '보안',
  '품질 관리',
  '통합 테스트',
  '운영 전환',
];
project.members = names.map((name, i) => ({
  id: 'member-' + (i + 1),
  name,
  role: roles[i],
  grade: ['특급', '고급', '중급'][i % 3],
  hours: 8,
  allocation: [100, 100, 80, 60, 100, 80][i % 6],
}));
const holidays = projectHolidays(project),
  day = (offset) => shiftWorkday(at, offset, holidays);
const phases = [
  [
    '착수 · 요구사항',
    -52,
    ['프로젝트 운영 체계', '사용자 인터뷰', '업무 프로세스 분석', '요구사항·범위 확정'],
  ],
  [
    'UX · 서비스 설계',
    -38,
    ['정보 구조·사용 흐름', '사용자 화면 설계', '디자인 시스템', '접근성·사용성 검토'],
  ],
  [
    '공통 플랫폼 개발',
    -22,
    ['인증·권한 관리', '공통 UI 컴포넌트', '파일·알림 서비스', '데이터·운영 기반'],
  ],
  [
    '핵심 서비스 개발',
    -10,
    ['프로젝트·일정 관리', '협업·승인 프로세스', '현황·분석 대시보드', '모바일 업무 처리'],
  ],
  [
    '통합 검증 · 안정화',
    12,
    ['통합 시나리오 검증', '성능·부하 검증', '보안 취약점 점검', '사용자 인수 테스트'],
  ],
  ['오픈 · 운영 전환', 34, ['데이터 이관', '서비스 오픈 준비', '사용자 교육', '운영 인수·안정화']],
];
const verbs = [
  [
    '운영 현황 조사',
    '이해관계자 요구 수집',
    '상세 요구사항 작성',
    '업무 범위 조정',
    '검토 회의·승인',
    '산출물 확정',
  ],
  [
    '사용 흐름 정리',
    '화면·정책 설계',
    '프로토타입 제작',
    '상세 디자인 적용',
    '사용성 검증',
    '리뷰·수정 반영',
  ],
  [
    '인터페이스 정의',
    '상세 구조 설계',
    '핵심 기능 구현',
    '연동·예외 처리',
    '자동 검증 작성',
    '코드 리뷰·보완',
  ],
  [
    '처리 시나리오 정리',
    '화면·API 설계',
    '업무 기능 구현',
    '공통 서비스 연동',
    '단위·회귀 검증',
    '리뷰·보완',
  ],
  [
    '검증 범위·환경 준비',
    '테스트 데이터 구성',
    '시나리오 검증 수행',
    '결함 분석·수정',
    '재검증·증적 정리',
    '최종 품질 검토',
  ],
  [
    '이행 계획 수립',
    '리허설·절차 점검',
    '배포·전환 실행',
    '사용자 안내·교육',
    '운영 지표 확인',
    '결과 보고·인수',
  ],
];
const itemLabels = [
  '준비·자료 분석',
  '상세 설계·작업 정의',
  '주요 작업 수행',
  '예외·보완 작업',
  '검증·리뷰',
  '산출물 정리',
];
for (let phase = 0; phase < phases.length; phase++) {
  const [title, offset, modules] = phases[phase],
    phaseId = 'phase-' + phase;
  project.tasks.push({
    id: phaseId,
    kind: 'summary',
    name: title,
    phase: title,
    owner: '',
    start: day(offset),
    end: day(offset + 30),
    predecessor: '',
    memo: '하위 모듈의 기간·공수·진척률을 자동 집계합니다.',
    items: [],
  });
  const leafIds = [];
  for (let module = 0; module < modules.length; module++) {
    const groupId = phaseId + '-module-' + module;
    project.tasks.push({
      id: groupId,
      parentId: phaseId,
      kind: 'summary',
      name: modules[module],
      phase: title,
      owner: '',
      start: day(offset + module * 2),
      end: day(offset + module * 2 + 22),
      predecessor: '',
      memo: '상세 업무 6개를 묶은 요약 업무입니다.',
      items: [],
    });
    for (let step = 0; step < 6; step++) {
      const index = phase * 24 + module * 6 + step,
        id = groupId + '-task-' + step;
      const start = day(offset + module * 3 + step * 6),
        end = shiftWorkday(start, 3 + (index % 3), holidays);
      const ratio =
        end < at ? (index % 13 === 0 ? 0.5 : 1) : start <= at ? 0.2 + (index % 4) * 0.15 : 0;
      const completed = Math.floor(ratio * 6);
      const predecessors = step ? [groupId + '-task-' + (step - 1)] : [];
      if (phase > 0 && module === 0 && step === 0)
        predecessors.push('phase-' + (phase - 1) + '-module-0-task-3');
      project.tasks.push({
        id,
        parentId: groupId,
        name: modules[module] + ' / ' + verbs[phase][step],
        phase: title,
        owner: project.members[(phase * 3 + module * 2 + Math.floor(step / 2)) % 18].id,
        start,
        end,
        predecessor: predecessors[0] || '',
        ...(predecessors.length > 1 ? { predecessors } : {}),
        memo:
          '담당자 협의 → 작업 수행 → 검증 → 산출물 검토 순으로 진행합니다. ' +
          (ratio > 0 && ratio < 1
            ? '일부 미완료 항목이 있어 후속 일정과 자원 투입을 확인해 주세요.'
            : '연관 문서와 검증 결과는 업무 완료 시 함께 정리합니다.'),
        items: itemLabels.map((label, k) => ({
          id: id + '-item-' + k,
          title: label,
          hours: [4, 8, 6, 8, 4, 2][(k + index) % 6],
          doneDate:
            k < completed
              ? [shiftWorkday(start, Math.min(k, 3 + (index % 3)), holidays), at].sort()[0]
              : null,
        })),
      });
      leafIds.push(id);
    }
  }
  for (let gate = 0; gate < 2; gate++) {
    const date = project.tasks.find((t) => t.id === leafIds[gate ? 23 : 11]).end;
    project.tasks.push({
      id: phaseId + '-gate-' + gate,
      parentId: phaseId,
      kind: 'milestone',
      name: title + ' / ' + (gate ? '단계 종료 승인' : '중간 검토 승인'),
      phase: title,
      owner: project.members[phase * 3].id,
      start: date,
      end: date,
      predecessor: leafIds[gate ? 23 : 11],
      memo: '관련 산출물과 검증 결과를 확인하는 승인 시점입니다.',
      doneDate: phase < 2 && gate === 0 && date < at ? date : null,
      items: [],
    });
  }
}
project.staffing = {
  hoursPerMM: 160,
  assignments: project.members.flatMap((m, index) =>
    [
      [-60, -1, m.allocation],
      [0, 29, Math.max(40, m.allocation - 20)],
      [30, 365, index < 3 ? 60 : m.allocation],
    ].map(([from, to, allocation], n) => ({
      id: m.id + '-period-' + n,
      memberId: m.id,
      start: day(from),
      end: day(to),
      allocation,
    })),
  ),
};
const issueTitles = [
  '외부 API 응답 규격 변경',
  '주요 화면 사용성 보완',
  '테스트 데이터 확보 지연',
  '권한 정책 예외 처리',
  '배포 환경 설정 누락',
  '성능 목표 미충족',
  '사용자 교육 일정 조정',
  '이관 데이터 품질 확인',
  '알림 중복 발송 점검',
  '모바일 화면 호환성 검토',
  '승인 시나리오 누락',
  '운영 문서 보완',
];
const work = project.tasks.filter((t) => t.items.length);
project.issues = Array.from({ length: 36 }, (_, i) => ({
  id: 'issue-' + i,
  title: issueTitles[i % 12] + ' · ' + ['공통', '핵심 서비스', '전환 준비'][Math.floor(i / 12)],
  type: i % 2 ? 'risk' : 'issue',
  impact: ['high', 'medium', 'low'][i % 3],
  probability: i % 2 ? ['high', 'medium', 'low'][Math.floor(i / 2) % 3] : '',
  owner: project.members[i % 18].id,
  taskId: work[(i * 7) % work.length].id,
  due: day(-10 + i),
  status: ['open', 'doing', 'closed'][Math.floor(i / 4) % 3],
  action: [
    '담당 조직과 조치 범위·기한을 협의하고 영향 업무를 추적합니다.',
    '재현 결과를 분석해 수정 작업과 검증 항목을 반영합니다.',
    '수정 및 재검증을 완료하고 증적을 확인했습니다.',
  ][Math.floor(i / 4) % 3],
}));
let clean = { id: project.id, ...cleanProject(project) };
clean.baseline = captureBaseline(clean, '착수 승인 기준 계획 v1.0');
for (const [index, task] of clean.tasks.entries())
  if (task.items.length && index % 11 === 0) {
    task.end = shiftWorkday(task.end, 3, holidays);
  }
const monday = weekRange(at).from;
clean.weeklyReports = Array.from({ length: 6 }, (_, i) => {
  const from = addDays(monday, -7 * (6 - i)),
    to = addDays(from, 6);
  return weeklyDraft(clean, {
    id: 'weekly-' + i,
    from,
    to,
    publishedAt: to + 'T08:00:00.000Z',
    notes:
      i +
      1 +
      '주차 예제 보고서: 핵심 산출물 검토와 완료 실적을 확인했습니다. 단계별 잔여 작업과 지연 업무를 추적합니다.',
    nextNotes:
      '차주 계획: 연동 검증·미완료 작업 보완·리스크 조치를 진행하고 담당자별 투입 계획을 조정합니다.',
  });
});
clean = { id: clean.id, ...cleanProject(clean) };

const file = previous?.file || path.join(directory, 'PMCanvas-대규모-예제-' + at + '.pmcanvas');
if (!summary(clean, at).forecast.end) throw Error('Example must have a usable forecast');
if (
  previous &&
  JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8')).project) !==
    JSON.stringify(
      JSON.parse(fs.readFileSync(path.join(directory, 'large-example-project.json'), 'utf8')),
    )
)
  throw Error('The example file was edited; preserve it.');
fs.writeFileSync(file, serializeDocument(clean), { flag: previous ? 'w' : 'wx' });
const roundtrip = parseDocument(fs.readFileSync(file));
if (JSON.stringify(roundtrip) !== JSON.stringify(clean)) throw Error('Example roundtrip mismatch');
fs.writeFileSync(
  path.resolve(path.join(directory, 'large-example-project.json')),
  JSON.stringify(clean),
  { flag: previous ? 'w' : 'wx' },
);
const metrics = summary(clean, at),
  warnings = scheduleWarnings(clean);
const result = {
  id: clean.id,
  name: clean.name,
  file,
  asOf: at,
  members: clean.members.length,
  tasks: clean.tasks.length,
  workTasks: work.length,
  summaries: clean.tasks.filter((t) => t.kind === 'summary').length,
  milestones: clean.tasks.filter((t) => t.kind === 'milestone').length,
  items: clean.tasks.reduce((n, t) => n + t.items.length, 0),
  issues: clean.issues.length,
  staffingPeriods: clean.staffing.assignments.length,
  weeklyReports: clean.weeklyReports.length,
  progress: metrics.progress,
  planned: metrics.planned,
  forecastEnd: metrics.forecast.end,
  overdue: metrics.overdue,
  baselineChanges: baselineDiff(clean).rows.filter((r) => r.end).length,
  dependencyWarnings: warnings.dependencies.length,
  monthlyPlanMM: monthlyPlan(clean, at.slice(0, 7)).mm,
};
fs.writeFileSync(manifestPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
