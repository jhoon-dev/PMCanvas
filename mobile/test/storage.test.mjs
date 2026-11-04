import { weeklyDraft } from '../../shared/browser/management.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { ProjectStore } from '../src/storage.mjs';

const project = () => ({ id: 'sample', name: '첫 프로젝트', members: [], tasks: [], holidays: [] });

test('committed projects survive a new store connection and are isolated by ID', async () => {
  const factory = new IDBFactory();
  const store = new ProjectStore(factory);
  const first = await store.save(project(), 0);
  assert.equal(first.revision, 1);
  await store.save({ ...project(), id: 'second', name: '두 번째' }, 0);
  const reopened = new ProjectStore(factory);
  assert.equal((await reopened.list()).length, 2);
  await reopened.remove('sample');
  assert.equal((await store.list())[0].id, 'second');
});
test('simultaneous editors cannot overwrite a newer committed revision', async () => {
  const factory = new IDBFactory(),
    a = new ProjectStore(factory),
    b = new ProjectStore(factory);
  await a.save(project(), 0);
  const outcomes = await Promise.allSettled([
    a.save({ ...project(), name: 'A 창 변경' }, 1),
    b.save({ ...project(), name: 'B 창 변경' }, 1),
  ]);
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
  assert.match(outcomes.find((result) => result.status === 'rejected').reason.message, /다른 창/);
  assert.equal((await a.list())[0].revision, 2);
});
test('validation and transaction aborts preserve previously committed data', async () => {
  const store = new ProjectStore(new IDBFactory());
  await store.save(project(), 0);
  await assert.rejects(store.save({ ...project(), name: '' }, 1));
  await assert.rejects(
    store.transaction('readwrite', (objectStore) => {
      objectStore.delete('sample');
      throw Error('Simulated failure before commit');
    }),
    /Simulated failure/,
  );
  assert.equal((await store.list())[0].project.name, '첫 프로젝트');
});

test('offline storage preserves published reports and aborts attempts to mutate a snapshot', async () => {
  const store = new ProjectStore(new IDBFactory()),
    p = project();
  p.weeklyReports = [
    weeklyDraft(p, {
      id: 'weekly',
      from: '2026-10-19',
      to: '2026-10-23',
      notes: 'Frozen',
      nextNotes: '',
    }),
  ];
  const first = await store.save(p, 0),
    invalid = structuredClone(first.project);
  invalid.weeklyReports[0].notes = 'Changed';
  await assert.rejects(store.save(invalid, 1), /발행한/);
  const reopened = (await new ProjectStore(store.factory).list())[0];
  assert.equal(reopened.revision, 1);
  assert.equal(reopened.project.weeklyReports[0].notes, 'Frozen');
});
