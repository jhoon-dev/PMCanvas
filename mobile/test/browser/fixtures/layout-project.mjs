import { today, addDays } from '../../../../shared/browser/engine.js';
import { weeklyDraft } from '../../../../shared/browser/management.js';

export function layoutProject({ longText = false } = {}) {
  const at = today();
  const value = {
    id: 'layout',
    name: '스마트워크 통합 플랫폼 구축 · 긴 프로젝트 이름과 모바일 정렬 검증',
    description: '여러 단계의 업무와 인력, 투입 계획, 이슈 및 주간보고를 확인합니다.',
    holidays: [],
    koreanHolidays: true,
    members: ['김하늘', '이서준', '박지민', '최서연'].map((name, index) => ({
      id: 'm' + index,
      name,
      role: '서비스 기획 및 플랫폼 개발',
      grade: '고급',
      hours: 8,
      allocation: 100,
    })),
    tasks: Array.from({ length: 12 }, (_, index) => ({
      id: 't' + index,
      name: '통합 플랫폼 / 인터페이스 정의와 개발 결과 검토 ' + (index + 1),
      phase: '공통 플랫폼 개발',
      owner: 'm' + (index % 4),
      start: addDays(at, -10),
      end: addDays(at, 7),
      predecessor: '',
      memo: '모바일과 데스크톱의 프로젝트 관리 기능을 확인합니다.',
      items: [
        { id: 'i' + index + 'a', title: '요구사항 및 인터페이스 검토', hours: 4, doneDate: at },
        { id: 'i' + index + 'b', title: '통합 구현과 결과 검증', hours: 8, doneDate: null },
      ],
    })),
    issues: [
      {
        id: 'issue',
        title: '외부 API 응답 규격 변경에 따른 인터페이스 조정',
        type: 'risk',
        impact: 'high',
        probability: 'medium',
        status: 'open',
        owner: 'm0',
        due: addDays(at, 7),
        action: '변경 규격 검토',
        taskId: 't0',
      },
    ],
    staffing: {
      hoursPerMM: 160,
      assignments: [
        { id: 'a', memberId: 'm0', start: addDays(at, -10), end: addDays(at, 20), allocation: 80 },
      ],
    },
  };
  value.tasks.push({
    id: 'milestone',
    name: '통합 플랫폼 / 단계 종료 검토 및 승인',
    kind: 'milestone',
    owner: 'm0',
    start: at,
    end: at,
    predecessor: '',
    phase: '검토',
    items: [],
    memo: '',
    doneDate: null,
  });
  if (longText) {
    value.name = '스마트워크 통합 플랫폼 구축 · GlobalEnterpriseWorkspaceAndOperations2026';
    value.description =
      '프로젝트의 업무 진행 상황과 참여인력별 투입 계획을 검토하고 글로벌 서비스 운영 전환을 준비합니다. 길이가 긴 설명도 화면 폭에 맞춰 자연스럽게 읽을 수 있어야 합니다.';
    value.members.forEach((member, index) => {
      member.name += ' · PlatformArchitectureLead' + (index + 1);
      member.role = '서비스 플랫폼 아키텍처 · 통합 검증 책임';
      member.grade = '특급 전문위원';
    });
    value.tasks.forEach((task, index) => {
      task.name =
        '글로벌 서비스 플랫폼 / 주문 처리 인터페이스 설계와 처리 결과 검증 ' +
        (index + 1) +
        ' · OrderProcessingIntegrationIdentifier2026';
      if (task.items.length) {
        task.items[0].title =
          '사용자 요청과 외부 연동 처리 결과를 확인하고 예외 상황에 대한 검증 기록을 정리합니다.';
        task.items[0].hours = 1234.5;
      }
    });
    value.issues[0].title = '외부 연동 규격 변경에 따른 서비스 플랫폼 인터페이스 조정 및 회귀 검증';
  }
  value.weeklyReports = [weeklyDraft(value, { from: addDays(at, -6), to: at, id: 'weekly' })];
  return value;
}
