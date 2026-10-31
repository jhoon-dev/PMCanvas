import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProject,
  parseProject,
  serializeProject,
  toggleItem,
  deleteEntity,
  MAX_BYTES,
} from '../src/model.mjs';
import { today, summary, nextWorkday } from '../../shared/browser/engine.js';

export function fixture() {
  return {
    id: 'project-1',
    name: '모바일 개발',
    description: '현장 업무',
    holidays: [],
    members: [
      { id: 'member-1', name: '김담당', role: '개발', grade: '중급', hours: 8, allocation: 100 },
    ],
    tasks: [
      {
        id: 'task-1',
        name: '앱 개발',
        owner: 'member-1',
        phase: '개발',
        start: nextWorkday(today()),
        end: nextWorkday(today()),
        predecessor: '',
        memo: '',
        items: [
          { id: 'item-1', title: '로그인', hours: 2, doneDate: null },
          { id: 'item-2', title: '현황', hours: 6, doneDate: null },
        ],
      },
      {
        id: 'task-2',
        parentId: 'task-1',
        name: '배포',
        owner: '',
        phase: '배포',
        start: nextWorkday(today()),
        end: nextWorkday(today()),
        predecessor: 'task-1',
        memo: '',
        items: [{ id: 'item-3', title: '검증', hours: 2, doneDate: null }],
      },
    ],
  };
}

test('desktop file envelope and web JSON preserve WBS, baseline and completion records', () => {
  const project = toggleItem(fixture(), 'task-1', 'item-1');
  project.baseline = {
    name: '출시 계획',
    createdAt: new Date().toISOString(),
    tasks: project.tasks.map((t) => ({
      id: t.id,
      name: t.name,
      start: t.start,
      end: t.end,
      hours: 8,
      parentId: t.parentId || '',
    })),
  };
  const roundtrip = parseProject('\uFEFF' + serializeProject(project));
  assert.deepEqual(roundtrip, normalizeProject(project));
  assert.deepEqual(parseProject(JSON.stringify(project)), roundtrip);
  assert.equal(summary(roundtrip, today()).progress, 0.2);
});
test('invalid imports reject cyclic dependencies, pending web edits, future completions and unknown formats', () => {
  const p = fixture();
  p.tasks[0].predecessor = 'task-2';
  assert.throws(() => normalizeProject(p), /순환/);
  assert.throws(
    () => parseProject(JSON.stringify({ ...fixture(), _wbsPendingCells: [{}] })),
    /미확정/,
  );
  assert.throws(() => parseProject('{'), /JSON/);
  assert.throws(
    () =>
      parseProject(JSON.stringify({ format: 'pm-canvas-project', version: 2, project: fixture() })),
    /버전/,
  );
  assert.throws(() => parseProject(' '.repeat(MAX_BYTES + 1)), /8MB/);
  assert.throws(() => toggleItem(fixture(), 'task-1', 'item-1', '2999-01-01'), /오늘/);
});
test('completion toggles retain immutable input and clear the original completion date', () => {
  const project = fixture();
  const checked = toggleItem(project, 'task-1', 'item-1');
  assert.equal(project.tasks[0].items[0].doneDate, null);
  assert.equal(checked.tasks[0].items[0].doneDate, today());
  assert.equal(toggleItem(checked, 'task-1', 'item-1').tasks[0].items[0].doneDate, null);
  assert.throws(() => toggleItem(project, 'missing', 'item-1'));
});
test('deleting a parent task preserves children and detaches predecessor references', () => {
  const project = deleteEntity(fixture(), 'task', 'task-1');
  assert.equal(project.tasks.length, 1);
  assert.equal(project.tasks[0].id, 'task-2');
  assert.equal(project.tasks[0].parentId, undefined);
  assert.equal(project.tasks[0].predecessor, '');
  assert.equal(project.tasks[0].items.length, 1);
});
test('deleting a member keeps their work and removes dangling ownership', () => {
  const original = fixture();
  const project = deleteEntity(original, 'member', 'member-1');
  assert.equal(project.members.length, 0);
  assert.equal(project.tasks.length, 2);
  assert.equal(project.tasks[0].owner, '');
  assert.equal(original.tasks[0].owner, 'member-1');
});
