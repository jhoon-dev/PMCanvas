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
