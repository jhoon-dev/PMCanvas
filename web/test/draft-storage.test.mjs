import test from 'node:test';
import assert from 'node:assert/strict';
import { DraftStore } from '../public/draft-store.js';
import { screenProject } from './support/screen-fixtures.mjs';

const prefix = 'pmcanvas:draft:v1:',
  preference = 'pmcanvas:draft-persist:user';

function browserStorage(t) {
  const faults = { local: {}, session: {} };
  const make = (failures) =>
    Object.create({
      getItem(key) {
        return Object.hasOwn(this, key) ? this[key] : null;
      },
      setItem(key, value) {
        if (failures.set?.(key, value))
          throw new DOMException('Storage full', 'QuotaExceededError');
        this[key] = String(value);
      },
      removeItem(key) {
        if (failures.remove?.(key)) throw new Error('Storage unavailable');
        delete this[key];
      },
    });
  const local = make(faults.local),
    session = make(faults.session);
  for (const [name, value] of [
    ['localStorage', local],
    ['sessionStorage', session],
  ]) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else delete globalThis[name];
    });
  }
  const write = (storage, id, name = '내 초안', user = 'user') => {
    const base = { ...screenProject(), id },
      draft = { ...base, name };
    new DraftStore(user, storage).write(
      base,
      draft,
      new Map([['t1|memo', { id: 't1', field: 'memo', value: '미확정 입력' }]]),
    );
    return storage.getItem(prefix + user + ':' + id);
  };
  return { local, session, faults, write };
}

for (const on of [true, false]) {
  test(`초안 보관 전환 ${on}: 두 번째 복사가 실패하면 설정·전체 원본·기존 대상 사본을 보존`, (t) => {
    const f = browserStorage(t),
      source = on ? f.session : f.local,
      target = on ? f.local : f.session;
    f.local.setItem(preference, on ? 'no' : 'yes');
    f.write(source, 'p1');
    f.write(source, 'p2');
    f.write(target, 'p1', '기존 대상 사본');
    f.write(target, 'other', '다른 계정', 'other');
    const beforeSource = { ...source },
      beforeTarget = { ...target };
    f.faults[on ? 'local' : 'session'].set = (key) => key === prefix + 'user:p2';
    assert.throws(() => DraftStore.setPersistent('user', on), { name: 'QuotaExceededError' });
    assert.equal(DraftStore.persistent('user'), !on);
    assert.deepEqual({ ...source }, beforeSource);
    assert.deepEqual({ ...target }, beforeTarget);
    assert.equal(new DraftStore('user').read('p1').draft.name, '내 초안');
    assert.ok(new DraftStore('user').read('p2'));
  });

  test(`초안 보관 전환 ${on}: 성공하면 원본·미확정 입력·만료 시각을 그대로 이관하고 다른 계정을 보존`, (t) => {
    const f = browserStorage(t),
      source = on ? f.session : f.local,
      target = on ? f.local : f.session;
    f.local.setItem(preference, on ? 'no' : 'yes');
    const first = f.write(source, 'p1'),
      second = f.write(source, 'p2');
    const other = f.write(source, 'other', '다른 계정', 'other');
    DraftStore.setPersistent('user', on);
    assert.equal(DraftStore.persistent('user'), on);
    assert.equal(target.getItem(prefix + 'user:p1'), first);
    assert.equal(target.getItem(prefix + 'user:p2'), second);
    assert.equal(source.getItem(prefix + 'user:p1'), null);
    assert.equal(source.getItem(prefix + 'user:p2'), null);
    assert.equal(source.getItem(prefix + 'other:other'), other);
    assert.equal(new DraftStore('user').read('p1').pending.length, 1);
  });
}

test('보관 설정 저장 실패도 복사본을 되돌리고 원본과 이전 설정을 유지', (t) => {
  const f = browserStorage(t),
    original = f.write(f.session, 'p');
  f.faults.local.set = (key) => key === preference;
  assert.throws(() => DraftStore.setPersistent('user', true), { name: 'QuotaExceededError' });
  assert.equal(DraftStore.persistent('user'), false);
  assert.equal(f.session.getItem(prefix + 'user:p'), original);
  assert.equal(f.local.getItem(prefix + 'user:p'), null);
});

test('전환 완료 후 원본 정리 실패는 성공한 설정과 복구 가능한 대상 초안을 유지', (t) => {
  const f = browserStorage(t),
    original = f.write(f.session, 'p');
  f.faults.session.remove = () => true;
  assert.doesNotThrow(() => DraftStore.setPersistent('user', true));
  assert.equal(DraftStore.persistent('user'), true);
  assert.equal(f.local.getItem(prefix + 'user:p'), original);
  assert.ok(new DraftStore('user').read('p'));
});

function legacy(storage, now = Date.now()) {
  const base = screenProject();
  const value = {
    version: 1,
    projectId: base.id,
    userId: 'user',
    revision: base._revision,
    savedAt: new Date(now).toISOString(),
    draft: base,
    pending: [{ id: 't1', field: 'memo', value: '구형 미확정 입력' }],
  };
  storage.setItem(prefix + 'user:' + base.id, JSON.stringify(value));
  return { key: prefix + 'user:' + base.id, value };
}

test('탭 안의 구형 초안은 같은 저장소에서 변환한 사본을 지우지 않고 복구', (t) => {
  const f = browserStorage(t),
    { key, value } = legacy(f.session);
  const store = new DraftStore('user'),
    recovered = store.read(value.projectId);
  assert.equal(recovered.version, 2);
  assert.deepEqual(recovered.draft, value.draft);
  assert.deepEqual(recovered.pending, value.pending);
  assert.equal(recovered.expiresAt, Date.parse(value.savedAt) + 8 * 60 * 60 * 1000);
  const converted = f.session.getItem(key);
  DraftStore.cleanup();
  assert.equal(f.session.getItem(key), converted);
});

test('구형 초안 이관 중 공간이 부족하면 원본을 남기고 다음 정리에서 재시도', (t) => {
  const f = browserStorage(t),
    { key, value } = legacy(f.local),
    original = f.local.getItem(key);
  f.faults.session.set = () => true;
  DraftStore.cleanup();
  assert.equal(f.local.getItem(key), original);
  assert.equal(f.session.getItem(key), null);
  delete f.faults.session.set;
  DraftStore.cleanup();
  assert.equal(f.local.getItem(key), null);
  assert.deepEqual(new DraftStore('user').read(value.projectId).draft, value.draft);
});

test('같은 저장소의 구형 초안 변환 실패도 원본을 유지하고 만료·손상 사본만 정리', (t) => {
  const f = browserStorage(t),
    { key } = legacy(f.session),
    original = f.session.getItem(key);
  f.faults.session.set = () => true;
  DraftStore.cleanup();
  assert.equal(f.session.getItem(key), original);
  delete f.faults.session.set;
  legacy(f.local, Date.now() - 9 * 60 * 60 * 1000);
  f.local.setItem(prefix + 'user:broken', '{');
  DraftStore.cleanup();
  assert.equal(f.local.getItem(key), null);
  assert.equal(f.local.getItem(prefix + 'user:broken'), null);
  assert.equal(new DraftStore('user').read('screen-project').version, 2);
});
