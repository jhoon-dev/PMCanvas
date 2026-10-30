import test from 'node:test';
import assert from 'node:assert/strict';
import { DraftStore } from '../public/draft-store.js';
import { WbsWorkspace } from '../public/wbs-workspace.js';
import { mergeProject, resolvedProject } from '../public/project-merge.js';
import { screenProject } from './support/screen-fixtures.mjs';

function fixture() {
  const data = new Map(),
    storage = {
      getItem: (key) => data.get(key),
      setItem: (key, value) => data.set(key, value),
      removeItem: (key) => data.delete(key),
    },
    store = new DraftStore('user', storage),
    base = screenProject(),
    draft = structuredClone(base);
  draft.tasks[0].name = '복구할 내 변경';
  const workspace = (project, options = {}) => {
    const w = new WbsWorkspace({
      getDraftStore: () => store,
      toast() {},
      onRender() {},
      ...options,
    });
    w.ensure(project, '2026-10-26');
    return w;
  };
  return { data, store, base, draft, workspace };
}

test('재시작한 초안은 작성 당시 원본으로 병합해 다른 사용자의 메모·완료 기록을 보존', async () => {
  const f = fixture(),
    latest = structuredClone(f.base);
  latest._revision++;
  latest._role = 'editor';
  latest.tasks[0].memo = '다른 사용자의 메모';
  latest.tasks[0].items[1].doneDate = '2026-10-26';
  f.store.write(f.base, f.draft, new Map());
  let comparisons = 0;
  const w = f.workspace(latest, {
    onSave: async (project) => {
      if (project._revision !== latest._revision)
        throw Object.assign(Error('conflict'), { status: 409 });
      return { ...project, _revision: project._revision + 1 };
    },
    onConflict: async (base, mine) => {
      comparisons++;
      assert.equal(base._revision, f.base._revision);
      assert.deepEqual(mergeProject(base, mine, latest).conflicts, []);
      return { latest, project: resolvedProject(base, mine, latest, {}) };
    },
  });
  await w.action('recover');
  assert.equal(w.error, '');
  assert.equal(w.draft._role, 'editor');
  // Closing again before saving must retain the original merge base too.
  assert.equal(f.store.read(f.base.id).base.tasks[0].memo, '');
  await w.action('save');
  assert.equal(comparisons, 1);
  assert.equal(w.draft.tasks[0].name, f.draft.tasks[0].name);
  assert.equal(w.draft.tasks[0].memo, latest.tasks[0].memo);
  assert.equal(w.draft.tasks[0].items[1].doneDate, '2026-10-26');
  await w.action('save');
  assert.equal(w.dirty, false);
  assert.equal(w.base._revision, 3);
  assert.equal(f.store.read(f.base.id), null);
});

test('복구 후 같은 필드 변경은 충돌로 표시하고 미확정 셀과 명시적 선택을 보존', async () => {
  const f = fixture(),
    latest = structuredClone(f.base),
    pending = { id: 't2', field: 'memo', value: '아직 확정하지 않은 메모' };
  latest._revision++;
  latest.tasks[0].name = '서버의 이름';
  f.store.write(f.base, f.draft, new Map([['t2|memo', pending]]));
  const w = f.workspace(latest);
  await w.action('recover');
  assert.deepEqual([...w.pending.values()], [pending]);
  const result = mergeProject(w.base, w.draft, latest);
  assert.equal(result.conflicts.length, 1);
  assert.throws(() => resolvedProject(w.base, w.draft, latest, {}), /선택/);
  for (const side of ['mine', 'server'])
    assert.equal(
      resolvedProject(w.base, w.draft, latest, { [result.conflicts[0].key]: side }).tasks[0].name,
      side === 'mine' ? f.draft.tasks[0].name : latest.tasks[0].name,
    );
});

test('이전 형식은 같은 revision에서 복구하고 원본 없는 오래된 초안은 덮어쓰지 않고 보존', async () => {
  for (const revision of [1, 2]) {
    const f = fixture();
    f.store.write(f.base, f.draft, new Map());
    const key = f.store.key(f.base.id),
      legacy = JSON.parse(f.data.get(key));
    legacy.version = 2;
    delete legacy.base;
    f.data.set(key, JSON.stringify(legacy));
    const original = f.data.get(key),
      latest = { ...f.base, _revision: revision },
      w = f.workspace(latest);
    await w.action('recover');
    if (revision === 1) {
      assert.equal(w.error, '');
      assert.equal(w.draft.tasks[0].name, f.draft.tasks[0].name);
      assert.deepEqual(f.store.read(f.base.id).base, f.base);
    } else {
      assert.match(w.error, /원본.*보존/);
      assert.deepEqual(w.draft, latest);
      assert.equal(w.dirty, false);
      assert.equal(f.data.get(key), original);
      assert.ok(w.recovery);
    }
  }
});

test('복구 기준 원본의 프로젝트·revision이 다르면 거절하며 조회자는 복구하지 않음', async () => {
  for (const change of [(base) => (base.id = 'other'), (base) => base._revision++]) {
    const f = fixture();
    f.store.write(f.base, f.draft, new Map());
    const key = f.store.key(f.base.id),
      saved = JSON.parse(f.data.get(key));
    change(saved.base);
    f.data.set(key, JSON.stringify(saved));
    assert.throws(() => f.store.read(f.base.id), /복구 초안/);
  }
  const f = fixture();
  f.store.write(f.base, f.draft, new Map());
  const w = f.workspace({ ...f.base, _role: 'viewer' });
  await w.action('recover');
  assert.equal(w.dirty, false);
  assert.equal(w.draft.tasks[0].name, f.base.tasks[0].name);
  assert.ok(f.store.read(f.base.id));
});
