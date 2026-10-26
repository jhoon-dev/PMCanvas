import test from 'node:test';
import assert from 'node:assert/strict';
test('API 클라이언트: 하위 경로·CSRF·세션 쿠키·충돌 메시지', { concurrency: false }, async (t) => {
  const savedLocation = globalThis.location;
  globalThis.location = { href: 'https://example.com/pmcanvas/#daily' };
  t.after(() => {
    if (savedLocation === undefined) delete globalThis.location;
    else globalThis.location = savedLocation;
  });
  const requests = [];
  let mode = 'login';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url: String(url), options });
    if (mode === 'login')
      return new Response(JSON.stringify({ user: { id: 'u' }, csrf: 'csrf-token' }), {
        status: 200,
      });
    if (mode === 'conflict')
      return new Response(
        JSON.stringify({
          error: { code: 'REVISION_CONFLICT', message: '다른 사용자가 먼저 수정했습니다.' },
        }),
        { status: 409 },
      );
    throw Error('offline');
  });
  const { api } = await import('../public/api-client.js?client-test');
  await api('auth/login', {
    method: 'POST',
    body: { email: 'a@example.com', password: 'test-password' },
  });
  assert.equal(requests[0].url, 'https://example.com/pmcanvas/api/auth/login');
  assert.equal(requests[0].options.credentials, 'same-origin');
  assert.equal(requests[0].options.cache, 'no-store');
  mode = 'conflict';
  await assert.rejects(
    api('projects/123', { method: 'PUT', body: { revision: 1 } }),
    (e) => e.status === 409 && e.code === 'REVISION_CONFLICT',
  );
  assert.equal(requests[1].options.headers['X-CSRF-Token'], 'csrf-token');
  mode = 'offline';
  await assert.rejects(api('projects'), (e) => e.status === 0 && e.message.includes('다시 시도'));
});
