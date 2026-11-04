// Destinations are peers. Groups describe the work without adding a navigation step.
export const PROJECT_SCREENS = {
  overview: { title: '프로젝트 현황', short: '현황', icon: 'dashboard' },
  tasks: { title: '업무 · 일정', short: '업무', icon: 'layers' },
  planning: { title: 'WBS · 기준 계획', icon: 'layers' },
  milestones: { title: '마일스톤', icon: 'calendar', section: 'milestones' },
  daily: { title: '완료 체크', short: '완료 체크', icon: 'check' },
  people: { title: '참여인력', short: '인력', icon: 'users' },
  resources: { title: '투입 계획', icon: 'calendar', section: 'staffing' },
  management: { title: '이슈 · 리스크', icon: 'alert', section: 'issues' },
  reports: { title: '업무 · 완료 기록', short: '보고서', icon: 'download' },
  weekly: { title: '주간보고', icon: 'calendar', section: 'weekly' },
  more: { title: '설정 · 파일', short: '더보기', icon: 'settings' },
};
export const PROJECT_NAVIGATION = [
  { title: '프로젝트', views: ['overview'] },
  { title: '업무 · 일정', views: ['tasks', 'planning', 'milestones', 'daily'] },
  { title: '인력 · 투입', views: ['people', 'resources'] },
  { title: '보고서', views: ['management', 'reports', 'weekly'] },
  { title: '설정', views: ['more'] },
];
export function projectNavigation(platform) {
  const unsupported =
    platform === 'web' ? ['planning', 'more'] : platform === 'desktop' ? ['more'] : [];
  return PROJECT_NAVIGATION.map((group) => ({
    ...group,
    views: group.views.filter((id) => !unsupported.includes(id)),
  })).filter((group) => group.views.length);
}
