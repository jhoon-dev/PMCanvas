import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, LoginLimiter, sessionCookie } from '../server/security.mjs';
import { cleanProject, projectChanges } from '../server/project.mjs';
test('비밀번호는 scrypt 해시로 저장하고 잘못된 비밀번호·손상된 해시 거부', async () => {
  const hash = await hashPassword('valid-password-12345');
  assert.notEqual(hash, 'valid-password-12345');
  assert.equal(await verifyPassword('valid-password-12345', hash), true);
  assert.equal(await verifyPassword('wrong', hash), false);
  assert.equal(await verifyPassword('anything', 'malformed'), false);
  await assert.rejects(hashPassword('short'));
});
test('로그인 실패 제한은 시간창 이후 해제', () => {
  let now = 0;
  const limiter = new LoginLimiter({ limit: 2, windowMs: 100, now: () => now });
  limiter.failure('a');
  limiter.failure('a');
  assert.throws(
    () => limiter.check('a'),
    (e) => e.status === 429,
  );
  now = 101;
  assert.doesNotThrow(() => limiter.check('a'));
});
test('HTTPS 쿠키와 하위 경로를 유지', () => {
  const cookie = sessionCookie('token', { secure: true, basePath: '/pmcanvas' });
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Path=\/pmcanvas\//);
  assert.match(cookie, /HttpOnly/);
});
test('서버 검증은 문자열 숫자와 잘못된 ID를 거절하고 전달된 권한을 제거', () => {
  const p = {
    name: '프로젝트',
    description: '',
    holidays: [],
    members: [],
    tasks: [],
    _role: 'owner',
    _revision: 999,
  };
  assert.equal(cleanProject(p)._role, undefined);
  assert.equal(cleanProject(p)._revision, undefined);
  assert.throws(() =>
    cleanProject({
      ...p,
      members: [
        { id: 'm', name: '이름', role: '개발', grade: '중급', hours: '8', allocation: 100 },
      ],
    }),
  );
  assert.throws(() =>
    cleanProject({
      ...p,
      members: [
        { id: '../etc', name: '이름', role: '개발', grade: '중급', hours: 8, allocation: 100 },
      ],
    }),
  );
});
test('변경 이력은 삭제·완료 취소 전 정보를 보존', () => {
  const p = {
      name: 'p',
      description: '',
      holidays: [],
      demo: false,
      members: [],
      tasks: [
        {
          id: 't',
          name: 't',
          items: [{ id: 'i', title: '작업', hours: 8, doneDate: '2026-10-23' }],
        },
      ],
    },
    q = structuredClone(p);
  q.tasks[0].items[0].doneDate = null;
  const changes = projectChanges(p, q);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].before.doneDate, '2026-10-23');
  assert.equal(changes[0].after.doneDate, null);
});
