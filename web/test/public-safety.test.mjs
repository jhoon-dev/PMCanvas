import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { crc32 } from 'node:zlib';
import {
  exampleHost,
  inspectPublicFile,
  checkPublicRepository,
  checkPublicArchive,
  requirePublicSafety,
} from '../scripts/public-safety.mjs';

const inspect = (file, text) => inspectPublicFile(file, Buffer.from(text));

test('Apple signing keys and provisioning files are private; desktop signing examples receive secret checks', () => {
  for (const file of ['signing/key.p8', 'signing/app.mobileprovision', 'signing/app.pfx']) {
    assert.equal(inspect(file, 'synthetic')[0].rule, 'PRIVATE_OR_ARCHIVE_FILE');
  }
  assert.equal(
    inspect('desktop/.env.example', 'CSC_KEY_PASSWORD=visible-fixture')[0].rule,
    'INLINE_PRIVATE_SETTING',
  );
  assert.deepEqual(inspect('desktop/.env.example', 'CSC_KEY_PASSWORD=\nAPPLE_API_KEY=\n'), []);
});

// Stored ZIP fixture with correct directory, sizes and checksums; no production files.
function archive(entries) {
  const local = [],
    central = [];
  let offset = 0;
  for (const { name, text = '', attributes = 0, flags = 0x800, badChecksum = false } of entries) {
    const filename = Buffer.from(name),
      data = Buffer.from(text);
    const checksum = badChecksum ? (crc32(data) + 1) >>> 0 : crc32(data);
    const header = Buffer.alloc(30),
      index = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(flags, 6);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    index.writeUInt32LE(0x02014b50);
    index.writeUInt16LE(0x0314, 4);
    index.writeUInt16LE(20, 6);
    index.writeUInt16LE(flags, 8);
    index.writeUInt32LE(checksum, 16);
    index.writeUInt32LE(data.length, 20);
    index.writeUInt32LE(data.length, 24);
    index.writeUInt16LE(filename.length, 28);
    index.writeUInt32LE(attributes, 38);
    index.writeUInt32LE(offset, 42);
    local.push(header, filename, data);
    central.push(index, filename);
    offset += header.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

test('공개 예제: 예약 도메인·loopback·문서 전용 IP만 호스트로 허용', () => {
  for (const host of [
    'localhost',
    '127.0.0.1',
    '::1',
    '[::1]',
    'pm.example.com',
    'company.example',
    'pm.test',
    '198.51.100.7',
    '203.0.113.9',
  ])
    assert.equal(exampleHost(host), true, host);
  for (const host of [
    'example.com.privatecorp.tld',
    '10.21.22.23',
    '192.168.4.6',
    '198.51.101.7',
    'fd00::123',
    'privatecorp.tld',
    'examplecom',
  ])
    assert.equal(exampleHost(host), false, host);
});

test('공개 예제: 개인 호스트·이메일·IP·홈 경로·인라인 비밀값을 값 없이 보고', () => {
  for (const [file, text, rule] of [
    ['docs/setup.md', 'PGHOST=db.privatecorp.tld PGPORT=35432', 'NON_EXAMPLE_DOMAIN'],
    ['README.md', 'db.privatecorp.tld:35432', 'NON_EXAMPLE_DOMAIN'],
    ['README.md', 'admin@privatecorp.tld', 'NON_EXAMPLE_DOMAIN'],
    ['README.md', 'https://privatecorp.tld/setup', 'NON_EXAMPLE_HOST'],
    ['.env.example', 'PGHOST=10.21.22.23', 'NON_EXAMPLE_IP'],
    ['.env.example', 'PGHOST=fd00::123', 'NON_EXAMPLE_ENDPOINT'],
    ['config/mail.example.json', '{"host":"smtp.privatecorp.tld"}', 'NON_EXAMPLE_DOMAIN'],
    ['config/auth.example.json', '{"clientSecret":"private-value-for-test"}', 'INLINE_SECRET'],
    ['.env.example', 'PGPASSWORD=private-value-for-test', 'INLINE_PRIVATE_SETTING'],
    ['.env.example', 'PGPASSWORD="private-value-for-test"', 'INLINE_PRIVATE_SETTING'],
    ['compose.yml', "PGPASSWORD: 'private-value-for-test'", 'INLINE_PRIVATE_SETTING'],
    ['.env.example', 'PGHOST="private-box"', 'NON_EXAMPLE_ENDPOINT'],
    ['config/mail.example.json', '{"host":"private-box"}', 'NON_EXAMPLE_CONFIG_ENDPOINT'],
    [
      'config/auth.example.json',
      '{"searchBase":"DC=privatecorp,DC=tld"}',
      'NON_EXAMPLE_CONFIG_ENDPOINT',
    ],
    [
      'config/auth.example.json',
      '{"issuer":"https://login.microsoftonline.com/actual-tenant/v2.0"}',
      'NON_EXAMPLE_TENANT',
    ],
    ['README.md', 'postgresql://user:private-value-for-test@db/pmcanvas', 'URL_CREDENTIALS'],
    ['README.md', 'C:\\Users\\private-person\\Desktop', 'PERSONAL_HOME_PATH'],
  ]) {
    const findings = inspect(file, text);
    assert.ok(
      findings.some((finding) => finding.rule === rule),
      `${file}: ${rule}`,
    );
    assert.throws(
      () => requirePublicSafety({ findings }),
      (error) =>
        !error.message.includes('private-value-for-test') &&
        !error.message.includes('db.privatecorp.tld'),
    );
  }
});

test('공개 예제: 빈 값·환경 변수·공식 문서·Entra 예제는 정상 통과', () => {
  for (const [file, text] of [
    ['.env.example', 'PGPASSWORD=\nADMIN_PASSWORD=\nADMIN_EMAIL=\nPGHOST=localhost\nPGPORT=5432'],
    ['.env.example', 'PGPASSWORD=${DB_PASSWORD:?Set the password first}'],
    ['.env.example', 'PGPASSWORD="${DB_PASSWORD}"\nPGHOST="localhost"'],
    ['compose.external.yml', 'PGPASSWORD: ${BACKUP_PGPASSWORD:-${PGPASSWORD}}'],
    ['README.md', 'https://github.com/example/project and https://playwright.dev/docs/ci'],
    [
      'README.md',
      'server/federation.mjs config/auth.example.json dockerfile.backup blame.ignoreRevsFile',
    ],
    [
      'desktop/README.md',
      'dist/win-unpacked/resources/app.asar "PM Canvas Desktop.exe" ' +
        'test/windows-install-check.ps1 build/installer.nsh test/registry-check.nsi C:\\Projects\\Project.pmcanvas',
    ],
    [
      'config/auth.example.json',
      '{"issuer":"https://login.microsoftonline.com/YOUR-TENANT-ID/v2.0","clientSecret":"YOUR-SECRET"}',
    ],
    ['compose.yml', 'PUBLIC_ORIGIN: ${PUBLIC_ORIGIN:-http://localhost:3000}'],
    [
      'compose.yml',
      'DATABASE_URL: postgresql://pmcanvas:${DB_PASSWORD:?Set a password}@db/pmcanvas',
    ],
  ])
    assert.deepEqual(inspect(file, text), [], file);
  assert.ok(
    inspect('.env.example', 'PGPASSWORD=${DB_PASSWORD:-literal-default}').some(
      (row) => row.rule === 'INLINE_PRIVATE_SETTING',
    ),
  );
  assert.ok(
    inspect('.env.example', 'PGPASSWORD=${BACKUP_PASSWORD:-${DB_PASSWORD:-literal-default}}').some(
      (row) => row.rule === 'INLINE_PRIVATE_SETTING',
    ),
  );
  assert.ok(
    inspect('README.md', 'postgresql://user:literal-default@${PGHOST}/pmcanvas').some(
      (row) => row.rule === 'URL_CREDENTIALS',
    ),
  );
});

test('공개 소스: 개인 키와 접근 토큰은 문서 이외의 파일에서도 거부', () => {
  const key = [
    '-----BEGIN ',
    'PRIVATE KEY-----\n',
    'A'.repeat(40),
    '\n-----END ',
    'PRIVATE KEY-----',
  ].join('');
  for (const [value, rule] of [
    [key, 'PRIVATE_KEY'],
    ['ghp_' + 'a'.repeat(36), 'ACCESS_TOKEN'],
  ]) {
    assert.equal(inspect('public/accident.js', value)[0].rule, rule);
  }
});

test('공개 저장소: ignored 실제 설정은 읽지 않고, 강제 추적 시 이름만으로 거부', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-public-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  fs.writeFileSync(path.join(root, '.gitignore'), '.env\n');
  fs.writeFileSync(path.join(root, '.env'), 'PGPASSWORD=private-fixture-value');
  fs.writeFileSync(path.join(root, 'README.md'), 'https://pm.example.com\n');
  fs.writeFileSync(path.join(root, '.env.example'), 'PGHOST=127.0.0.1\nPGPASSWORD=\n');
  assert.deepEqual(checkPublicRepository(root).findings, []);
  fs.writeFileSync(path.join(root, 'new-document.md'), 'https://db.privatecorp.tld');
  assert.ok(checkPublicRepository(root).findings.some((row) => row.file === 'new-document.md'));
  fs.unlinkSync(path.join(root, 'new-document.md'));
  execFileSync('git', ['add', '--force', '.env'], { cwd: root });
  const result = checkPublicRepository(root);
  assert.deepEqual(result.findings, [{ file: '.env', line: 1, rule: 'PRIVATE_ENV' }]);
  assert.throws(
    () => requirePublicSafety(result),
    (error) => !error.message.includes('private-fixture-value'),
  );
});

test('공개 ZIP: 문서 내용과 개인 설정·키·덤프·내장 저장소·대소문자 변형 차단', async () => {
  const safe = await checkPublicArchive(
    archive([
      { name: 'README.md', text: 'https://pm.example.com' },
      { name: '.env.example', text: 'PGHOST=localhost\nPGPASSWORD=\n' },
      { name: 'config/' },
      { name: 'config/mail.example.json', text: '{"enabled":false,"host":"smtp.example.com"}' },
      { name: 'certs/' },
      { name: 'certs/.gitkeep' },
    ]),
  );
  assert.deepEqual(safe.findings, []);
  for (const name of [
    '.env',
    'nested/.env.production',
    'config/mail.json',
    'Config/mail.json',
    'config/secrets/mfa.key',
    'certs/server.crt',
    'backups/data.dump',
    'recovery-keys/key.bin',
    '.git/config',
    'nested/node_modules/private.txt',
  ]) {
    const result = await checkPublicArchive(archive([{ name, text: 'private-fixture-value' }]));
    assert.ok(result.findings.length, name);
  }
  const leaked = await checkPublicArchive(
    archive([{ name: 'docs/setup.md', text: 'PGHOST=db.privatecorp.tld' }]),
  );
  assert.ok(leaked.findings.some((row) => row.rule === 'NON_EXAMPLE_DOMAIN'));
});

test('공개 ZIP: 경로 탈출·중복·심볼릭 링크·암호화·손상·크기 초과 거부', async () => {
  for (const entries of [
    [{ name: '../outside.txt' }],
    [{ name: '/absolute.txt' }],
    [{ name: 'README.md.' }],
    [{ name: 'NUL.txt' }],
    [{ name: 'README.md' }, { name: 'readme.md' }],
    [{ name: 'private.txt', flags: 0x801 }],
    [{ name: 'README.md', text: 'text', badChecksum: true }],
    [{ name: 'README.md', text: 'x'.repeat(2 * 1024 * 1024 + 1) }],
  ])
    await assert.rejects(async () =>
      requirePublicSafety(await checkPublicArchive(archive(entries))),
    );
  const symlink = await checkPublicArchive(
    archive([{ name: 'README.md', text: '.env', attributes: (0xa1ff << 16) >>> 0 }]),
  );
  assert.equal(symlink.findings[0].rule, 'SYMLINK');
  await assert.rejects(checkPublicArchive(Buffer.from('not a zip')));
});

test('상위 폴더와 무관하게 실제 설정·비밀 폴더 차단, 배포 예제 내용도 검사', async () => {
  for (const name of [
    'bundle/config/mail.json',
    'public/config/mail.json',
    'bundle/Config/auth.json',
    'public/config/secrets/smtp-password.txt',
    'bundle/secrets/token.txt',
    'bundle/certs/root.crt',
  ]) {
    assert.ok(inspect(name, 'synthetic-review-fixture').length, name);
    const result = await checkPublicArchive(archive([{ name, text: 'synthetic-review-fixture' }]));
    assert.ok(result.findings.length, name);
  }
  const name = 'bundle/config/mail.example.json';
  assert.deepEqual(inspect(name, '{"host":"smtp.example.com"}'), []);
  assert.ok(inspect(name, '{"host":"private-box","password":"synthetic-review-fixture"}').length);
  assert.deepEqual(
    (
      await checkPublicArchive(
        archive([
          { name: 'bundle/' },
          { name: 'bundle/config/' },
          { name, text: '{"host":"smtp.example.com"}' },
        ]),
      )
    ).findings,
    [],
  );
});

test('공개 저장소: 이동한 추적 파일은 새 경로를 검사하고 삭제한 경로는 제외한다', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-public-move-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  fs.writeFileSync(path.join(root, 'README.md'), 'https://pm.example.com\n');
  execFileSync('git', ['add', 'README.md'], { cwd: root });
  fs.mkdirSync(path.join(root, 'web'));
  fs.renameSync(path.join(root, 'README.md'), path.join(root, 'web/README.md'));
  assert.deepEqual(checkPublicRepository(root).findings, []);
  fs.writeFileSync(path.join(root, 'web/README.md'), 'https://db.privatecorp.tld');
  assert.ok(checkPublicRepository(root).findings.some((row) => row.file === 'web/README.md'));
});
