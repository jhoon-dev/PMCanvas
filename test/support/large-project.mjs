export function largeProject() {
  return {
    id: 'large-project',
    name: '500 task performance fixture',
    description: '',
    _revision: 1,
    _role: 'owner',
    holidays: [],
    members: Array.from({ length: 20 }, (_, i) => ({
      id: 'm' + i,
      name: 'Member ' + i,
      role: 'Developer',
      grade: 'Senior',
      hours: 8,
      allocation: 100,
    })),
    tasks: Array.from({ length: 500 }, (_, i) => ({
      id: 't' + i,
      name: 'Task ' + String(i).padStart(3, '0'),
      owner: 'm' + (i % 20),
      phase: 'Development',
      start: '2026-10-26',
      end: '2026-10-30',
      predecessor: '',
      parentId: i % 10 ? 't' + (i - (i % 10)) : '',
      memo: '',
      items: [{ id: 'i' + i, title: 'Work ' + i, hours: 8, doneDate: null }],
    })),
  };
}
