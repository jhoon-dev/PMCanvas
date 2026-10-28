export function screenProject() {
  return {
    id: 'screen-project',
    name: '화면 회귀 검증',
    description: '계획·실적·담당자 표시',
    _role: 'owner',
    _revision: 1,
    holidays: ['2026-10-21'],
    members: [
      { id: 'm1', name: '김하늘', role: '개발', grade: '중급', hours: 8, allocation: 100 },
      { id: 'm2', name: '이바다', role: '기획', grade: '초급', hours: 8, allocation: 50 },
    ],
    tasks: [
      {
        id: 't1',
        name: '화면 설계',
        phase: '기획',
        owner: 'm2',
        start: '2026-10-19',
        end: '2026-10-23',
        predecessor: '',
        memo: '',
        items: [
          { id: 'i1', title: '초안', hours: 8, doneDate: '2026-10-20' },
          { id: 'i2', title: '검토', hours: 24, doneDate: null },
        ],
      },
      {
        id: 't2',
        name: '화면 구현',
        phase: '개발',
        owner: 'm1',
        start: '2026-10-26',
        end: '2026-10-30',
        predecessor: 't1',
        memo: '',
        items: [{ id: 'i3', title: '구현', hours: 16, doneDate: null }],
      },
      {
        id: 't3',
        name: '일정 확인',
        phase: '기획',
        owner: 'm1',
        start: '2026-10-19',
        end: '2026-10-20',
        predecessor: '',
        memo: '',
        items: [{ id: 'i4', title: '확인', hours: 8, doneDate: '2026-10-20' }],
      },
    ],
  };
}

export function screenCases() {
  const empty = { ...screenProject(), members: [], tasks: [] };
  const viewer = { ...screenProject(), _role: 'viewer' };
  viewer.tasks[1].owner = '';
  const escaped = screenProject();
  escaped.name =
    escaped.description =
    escaped.tasks[0].name =
    escaped.members[0].name =
      '\"><img src=x onerror=alert(1)><script>alert(1)</script>';
  return [
    { name: 'empty', p: empty, at: '2026-10-26' },
    { name: 'owner', p: screenProject(), at: '2026-10-26' },
    { name: 'historical', p: screenProject(), at: '2026-10-19' },
    { name: 'viewer-unassigned', p: viewer, at: '2026-10-26' },
    { name: 'escaped', p: escaped, at: '2026-10-26' },
  ];
}
