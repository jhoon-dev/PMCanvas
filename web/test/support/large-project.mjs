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

export function hierarchyProject() {
  const project = {
    name: 'Hierarchy performance fixture',
    description: '',
    holidays: [],
    members: Array.from({ length: 15 }, (_, i) => ({
      id: 'm' + i,
      name: 'M',
      role: '',
      grade: '',
      hours: 8,
      allocation: 100,
    })),
    tasks: [],
  };
  for (let i = 0; i < 50; i++) {
    project.tasks.push({
      id: 's' + i,
      name: 'Summary',
      kind: 'summary',
      owner: '',
      phase: '',
      memo: '',
      start: '2026-11-02',
      end: '2026-11-06',
      predecessor: '',
      items: [],
    });
    for (let j = 0; j < 4; j++)
      project.tasks.push({
        id: 'w' + i + '-' + j,
        name: 'Work',
        parentId: 's' + i,
        owner: 'm' + ((i * 4 + j) % 15),
        phase: '',
        memo: '',
        start: '2026-11-02',
        end: '2026-11-06',
        predecessor: '',
        items: [{ id: 'i' + i + '-' + j, title: 'Work', hours: 40, doneDate: null }],
      });
  }
  return project;
}
