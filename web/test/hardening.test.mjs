import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, scryptSync } from 'node:crypto';
import { once } from 'node:events';
import { createApplication } from '../server/http.mjs';
import { hashPassword, verifyPassword } from '../server/security.mjs';
import { AdminMfa, totp, base32, seal, unseal } from '../server/admin-mfa.mjs';
import { MemoryRepository } from './support/memory-repository.mjs';
import { cleanProject } from '../server/project.mjs';
import { workdays } from '../public/engine.js';
import { clientAddress, proxyList } from '../server/request-security.mjs';
import { DraftStore } from '../public/draft-store.js';
import { projectWorkbook } from '../server/excel.mjs';
import { parseWorkbook } from '../server/excel-import.mjs';
import ExcelJS from 'exceljs';
const PASSWORD = 'hardening-test-password',
  HASH = await hashPassword(PASSWORD),
  origin = 'http://localhost:3000';
async function fixture(t, { trustProxies = '', legacy = false } = {}) {
  const salt = 'a'.repeat(32),
    old =
      'scrypt-v1:' +
      salt +
      ':' +
      scryptSync(PASSWORD, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  const users = [
    {
      id: randomUUID(),
      email: 'admin@example.com',
      name: '관리자',
      password_hash: legacy ? old : HASH,
      is_admin: true,
    },
    {
      id: randomUUID(),
      email: 'user@example.com',
      name: '사용자',
      password_hash: legacy ? old : HASH,
      is_admin: false,
    },
  ];
  const repo = new MemoryRepository(users),
    mfa = new AdminMfa(repo, Buffer.alloc(32, 9), { now: () => 1761523200000 }),
    server = createApplication({
      repo,
      origin,
      adminMfa: mfa,
      trustProxies,
      logger: { error() {} },
    });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    return new Promise((r) => server.close(r));
  });
  const url = 'http://127.0.0.1:' + server.address().port + '/api/';
  const call = async (path, body, headers = {}) => {
    const r = await fetch(url + path, {
      method: body ? 'POST' : 'GET',
      headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers.get('set-cookie')?.split(';')[0],
    };
  };
  return {
    repo,
    mfa,
    users,
    call,
    login: (email = 'admin@example.com', headers = {}) =>
      call('auth/login', { email, password: PASSWORD }, headers),
    verify: (challenge, code) => call('auth/mfa/verify', { challenge, code }),
  };
}
test('RFC 6238 벡터와 AES-GCM MFA 키 암호화·변조 거절', () => {
  assert.equal(totp(base32(Buffer.from('12345678901234567890')), 1, 8), '94287082');
  const key = randomBytes(32),
    value = seal('secret', key);
  assert.equal(unseal(value, key), 'secret');
  assert.throws(() => unseal(value, randomBytes(32)));
});
test('MFA 등록 전 세션 금지, 등록·재사용 거절·일회용 복구 코드·감사 로그', async (t) => {
  const f = await fixture(t),
    start = await f.login();
  assert.equal(start.status, 200);
  assert.equal(start.cookie, undefined);
  assert.equal(start.data.enrollment, true);
  assert.equal((await f.call('auth/me')).status, 401);
  const otp = totp(start.data.secret, Math.floor(f.mfa.now() / 30000)),
    done = await f.verify(start.data.challenge, otp);
  assert.equal(done.status, 200);
  assert.equal(done.data.recoveryCodes.length, 10);
  assert.ok(done.cookie);
  assert.equal((await f.verify(start.data.challenge, otp)).status, 401);
  const next = await f.login();
  assert.equal(next.data.secret, undefined);
  assert.equal((await f.verify(next.data.challenge, otp)).status, 401);
  const recovery = await f.verify(next.data.challenge, done.data.recoveryCodes[0]);
  assert.equal(recovery.status, 200);
  const third = await f.login();
  assert.equal((await f.verify(third.data.challenge, done.data.recoveryCodes[0])).status, 401);
  const state = await f.repo.getMfa(f.users[0].id);
  assert.equal(state.recovery_hashes.length, 9);
  assert.ok(!state.secret.includes(start.data.secret));
  const log = JSON.stringify(await f.repo.securityEvents());
  assert.ok(log.includes('auth.mfa.enrolled'));
  assert.ok(!log.includes(PASSWORD));
  assert.ok(!log.includes(start.data.secret));
  assert.ok(!log.includes(done.data.recoveryCodes[0]));
  const nonAdmin = await f.login('user@example.com');
  assert.equal(
    (await f.call('auth/security-events', undefined, { Cookie: nonAdmin.cookie })).status,
    403,
  );
});
test('MFA 실패 5회 제한과 만료 요청으로 세션 생성 금지', async (t) => {
  const f = await fixture(t),
    start = await f.login(),
    wrong =
      totp(start.data.secret, Math.floor(f.mfa.now() / 30000)) === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++)
    assert.equal((await f.verify(start.data.challenge, wrong)).status, 401);
  assert.equal(
    (await f.verify(start.data.challenge, totp(start.data.secret, Math.floor(f.mfa.now() / 30000))))
      .data.error.code,
    'MFA_EXPIRED',
  );
  assert.equal(f.repo.sessions.size, 0);
});
test('동시 로그인 12회 중 8회만 검증, 제한은 핸들러 간에도 공유', async (t) => {
  const f = await fixture(t),
    r = await Promise.all(
      Array.from({ length: 12 }, () =>
        f.call('auth/login', { email: 'user@example.com', password: 'wrong-password' }),
      ),
    );
  assert.equal(r.filter((v) => v.status === 401).length, 8);
  assert.equal(r.filter((v) => v.status === 429).length, 4);
});
test('신뢰한 프록시의 사용자 IP 분리, 직접 전달한 헤더는 무시', async (t) => {
  assert.equal(
    clientAddress(
      { socket: { remoteAddress: '198.51.100.3' }, headers: { 'x-forwarded-for': '203.0.113.1' } },
      proxyList(),
    ),
    '198.51.100.3',
  );
  assert.throws(() =>
    clientAddress(
      { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': 'bad, address' } },
      proxyList('127.0.0.1'),
    ),
  );
  const f = await fixture(t, { trustProxies: '127.0.0.1' });
  for (let i = 0; i < 40; i++)
    assert.equal(
      (
        await f.call(
          'auth/login',
          { email: 'unknown' + i + '@example.com', password: 'wrong-password' },
          { 'X-Forwarded-For': '203.0.113.1' },
        )
      ).status,
      401,
    );
  assert.equal(
    (await f.login('user@example.com', { 'X-Forwarded-For': '198.51.100.2' })).status,
    200,
  );
});
test('기존 scrypt-v1 비밀번호 검증과 성공 시 v2 업그레이드', async (t) => {
  const f = await fixture(t, { legacy: true });
  assert.ok(await verifyPassword(PASSWORD, f.users[1].password_hash));
  assert.equal((await f.login('user@example.com')).status, 200);
  assert.ok(f.users[1].password_hash.startsWith('scrypt-v2:'));
});
test('원거리 날짜 데이터 거절과 긴 근무일 계산의 상수 시간 처리', () => {
  const p = {
    name: '범위',
    members: [],
    tasks: [
      {
        id: 't',
        name: 't',
        owner: '',
        phase: '',
        start: '9990-01-01',
        end: '9990-01-01',
        predecessor: '',
        memo: '',
        items: [{ id: 'i', title: 'i', hours: 1, doneDate: null }],
      },
    ],
  };
  assert.throws(() => cleanProject(p));
  const start = performance.now();
  assert.ok(workdays('2000-01-01', '9990-01-01') > 1000000);
  assert.ok(performance.now() - start < 100);
  assert.equal(workdays('2026-10-19', '2026-10-23', ['2026-10-20', '2026-10-20']), 4);
});
test('복구 초안 8시간 후 만료, 원문 영구 보관 금지', () => {
  const data = new Map(),
    storage = {
      getItem: (k) => data.get(k),
      setItem: (k, v) => data.set(k, v),
      removeItem: (k) => data.delete(k),
    };
  let now = 1000;
  const s = new DraftStore('u', storage, () => now);
  s.write({ id: 'p', _revision: 1 }, { id: 'p', _revision: 1, name: 'private' }, new Map());
  assert.ok(s.read('p'));
  now += 8 * 60 * 60 * 1000 + 1;
  assert.equal(s.read('p'), null);
  assert.equal(data.size, 0);
});
test('압축 크기 메타데이터 위조는 실제 스트림 크기 검증에서 거절', async () => {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('업무').addRow(['검증']);
  const buffer = Buffer.from(await book.xlsx.writeBuffer());
  let offset = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  while (offset >= 0 && offset < buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const len = buffer.readUInt16LE(offset + 28),
      name = buffer.subarray(offset + 46, offset + 46 + len).toString();
    if (name === 'xl/worksheets/sheet1.xml') {
      buffer.writeUInt32LE(1, offset + 24);
      break;
    }
    offset += 46 + len + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  await assert.rejects(parseWorkbook(buffer));
});
test('Excel 출력은 별도 프로세스에서 실행하며 동시 작업 2개 제한', async () => {
  const p = {
    name: '작업 예산',
    description: '',
    holidays: [],
    members: [],
    tasks: [
      {
        id: 't',
        name: '업무',
        phase: '',
        owner: '',
        start: '2026-10-26',
        end: '2026-10-27',
        predecessor: '',
        memo: '',
        items: [{ id: 'i', title: '구현', hours: 8, doneDate: null }],
      },
    ],
  };
  let ticks = 0;
  const timer = setInterval(() => ticks++, 10);
  try {
    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () => projectWorkbook(p, '2026-10-26')),
    );
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2);
    assert.equal(results.find((r) => r.status === 'rejected').reason.status, 429);
    assert.ok(ticks > 0);
  } finally {
    clearInterval(timer);
  }
});
