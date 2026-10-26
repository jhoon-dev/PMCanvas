import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runtimeIdentity, prepareRuntimeStorage } from '../scripts/runtime-storage.mjs';
import { migrationFiles } from '../server/migrations.mjs';
import { backupSettings } from '../server/workspace-model.mjs';
import { escapeHtml } from '../public/html.js';
import { accountRows } from '../public/account-ui.js';
import { backupOverview, backupRunRows } from '../public/backup-settings-ui.js';
import { myWorkView } from '../public/my-work-ui.js';

function folder(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-maintenance-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test('Linux 실행 계정은 호스트 UID/GID를 따르며 root와 잘못된 설정을 거절', () => {
  assert.deepEqual(runtimeIdentity({}, { uid: 1001, gid: 1002 }), {
    PM_RUN_UID: '1001',
    PM_RUN_GID: '1002',
  });
  assert.deepEqual(runtimeIdentity({}, { uid: 0, gid: 0 }), {
    PM_RUN_UID: '1000',
    PM_RUN_GID: '1000',
  });
  for (const value of ['0', '-1', 'root', '1000:0', '2147483648'])
    assert.throws(() => runtimeIdentity({ PM_RUN_UID: value }));
});
test('기존 백업 키는 무결성 확인 후 별도 폴더로 이동하고 재실행해도 보존', (t) => {
  const root = folder(t),
    key = Buffer.alloc(32, 7),
    name = 'key-' + createHash('sha256').update(key).digest('hex') + '.bin';
  fs.mkdirSync(path.join(root, 'backups', 'keys'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backups', 'keys', name), key);
  assert.equal(prepareRuntimeStorage(root), 1);
  assert.equal(fs.existsSync(path.join(root, 'backups', 'keys')), false);
  assert.deepEqual(fs.readFileSync(path.join(root, 'recovery-keys', name)), key);
  assert.equal(prepareRuntimeStorage(root), 0);
});
test('손상되거나 알 수 없는 기존 키는 지우거나 덮어쓰지 않음', (t) => {
  const root = folder(t);
  fs.mkdirSync(path.join(root, 'backups', 'keys'), { recursive: true });
  const key = path.join(root, 'backups', 'keys', 'unknown.bin');
  fs.writeFileSync(key, 'preserve');
  assert.throws(() => prepareRuntimeStorage(root));
  assert.equal(fs.readFileSync(key, 'utf8'), 'preserve');
});
test('마이그레이션은 번호 순서로 발견하고 중복·누락·이름 오류를 거절', (t) => {
  const root = folder(t);
  for (const file of ['002_next.sql', '001_first.sql'])
    fs.writeFileSync(path.join(root, file), 'SELECT 1;');
  assert.deepEqual(
    migrationFiles(root).map((f) => f.version),
    [1, 2],
  );
  fs.writeFileSync(path.join(root, '002_duplicate.sql'), '');
  assert.throws(() => migrationFiles(root));
  fs.unlinkSync(path.join(root, '002_duplicate.sql'));
  fs.writeFileSync(path.join(root, '004_gap.sql'), '');
  assert.throws(() => migrationFiles(root));
});
test('백업 시간대는 IANA 이름만 허용하고 생략하면 기존 값을 유지', () => {
  const b = { enabled: true, verifyRestore: true, hour: 3, retentionDays: 14, revision: 0 };
  assert.equal(backupSettings({ ...b, timeZone: 'America/New_York' }).timeZone, 'America/New_York');
  assert.equal(backupSettings(b).timeZone, undefined);
  for (const zone of ['Mars/Space', "UTC');DELETE", '', null])
    assert.throws(
      () => backupSettings({ ...b, timeZone: zone }),
      (e) => e.status === 400,
    );
});
test('사용자·거절 사유·백업 오류·내 업무 화면은 HTML과 속성 삽입을 이스케이프', () => {
  const attack = '\"><img src=x onerror=alert(1)><script>alert(1)</script>';
  const users = accountRows(
      [
        {
          id: attack,
          name: attack,
          email: attack,
          registrationRejected: true,
          rejectionReason: attack,
        },
      ],
      () => '',
    ),
    runs = backupRunRows([{ state: 'failed', message: attack, keyFingerprint: attack }], 'UTC'),
    overview = backupOverview({
      settings: { timeZone: 'UTC' },
      runs: [{ state: 'failed', message: attack }],
    }),
    mine = myWorkView({
      projects: [
        {
          id: attack,
          name: attack,
          tasks: [{ id: attack, name: attack, start: '2026-10-01', end: '2026-10-20' }],
        },
      ],
      esc: escapeHtml,
      progress: () => 0,
      today: '2026-10-26',
      projectMode: '',
    });
  for (const html of [users, runs, overview, mine]) {
    assert.equal(html.includes('<img'), false);
    assert.equal(html.includes('<script'), false);
    assert.ok(html.includes('&lt;'));
  }
});
