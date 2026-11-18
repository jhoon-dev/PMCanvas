// Application, project, and page navigation use separate owners and landmarks.
export const SETTINGS_SECTIONS = {
  general: { title: '일반 설정', description: '앱의 표시 언어와 업무 기준 시간대를 설정합니다.' },
  holidays: {
    title: '공휴일 갱신',
    description: '모든 프로젝트에서 사용하는 공휴일 데이터를 관리합니다.',
  },
  ai: {
    title: 'AI 연결 설정',
    description: 'API 키를 등록하면 주간보고 AI 초안을 생성할 수 있습니다.',
  },
  updates: { title: '업데이트', description: '앱의 새 버전 확인과 설치를 관리합니다.' },
  about: { title: '앱 정보', description: '앱 버전과 제작자, 개인정보처리방침을 확인합니다.' },
};
import { PROJECT_SCREENS } from './shared/project-navigation.js';
export const PROJECT_VIEWS = Object.fromEntries(
  Object.entries(PROJECT_SCREENS).map(([id, screen]) => [id, screen.title]),
);
export const PROJECT_COMMANDS = [
  'save',
  'saveAs',
  'closeProject',
  'projectSettings',
  'undo',
  'redo',
  'importExcel',
  'exportWeb',
  'exportExcel',
  'exportTemplate',
  'exportWbs',
  'exportCompletion',
  'activateTab',
  'nextTab',
  'previousTab',
];
