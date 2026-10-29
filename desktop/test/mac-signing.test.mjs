import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { X509Certificate, generateKeyPairSync, randomBytes } from 'node:crypto';
import {
  quietRun,
  opensslPath,
  privatePath,
  secureDirectory,
  newWorkspace,
  createCsr,
  exportP12,
  registerP12,
  registerNotarization,
  officialAuthorities,
  locked,
  session,
  password,
  saveNew,
  digest,
} from '../scripts/mac-signing-core.mjs';
import { hiddenInput } from '../scripts/mac-signing-prompt.mjs';

const openssl = opensslPath();
const passA = 'Fixture-Key-A-Only-12345',
  passB = 'Fixture-P12-B-Only-67890';
function temp(t) {
  const base = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(base, 'pmcanvas-signing-test-'));
  t.after(() => {
    assert.equal(path.dirname(root), base);
    assert.ok(path.basename(root).startsWith('pmcanvas-signing-test-'));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  return root;
}
function authority(root) {
  const key = path.join(root, 'root.key.pem'),
    cert = path.join(root, 'root.cert.pem');
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: passA },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  saveNew(key, pair.privateKey);
  quietRun(
    openssl,
    [
      'req',
      '-new',
      '-x509',
      '-key',
      key,
      '-passin',
      'env:PM_SIGNING_INPASS',
      '-out',
      cert,
      '-days',
      '2',
      '-subj',
      '/CN=PMCanvas Test CA',
      '-addext',
      'basicConstraints=critical,CA:TRUE',
      '-addext',
      'keyUsage=critical,keyCertSign,cRLSign',
      '-addext',
      'subjectKeyIdentifier=hash',
    ],
    { secrets: { PM_SIGNING_INPASS: passA } },
  );
  return { key, file: cert, certificate: new X509Certificate(fs.readFileSync(cert)) };
}
function issue(
  folder,
  ca,
  { name = 'Developer ID Application: Fixture (TESTTEAM01)', days = '1' } = {},
) {
  const file = path.join(folder, 'issued-' + randomBytes(4).toString('hex') + '.cer');
  const extensions = path.join(folder, 'extensions-' + randomBytes(4).toString('hex') + '.cnf');
  saveNew(
    extensions,
    'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=codeSigning\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n',
  );
  quietRun(
    openssl,
    [
      'x509',
      '-req',
      '-in',
      path.join(folder, 'PMCanvas.certSigningRequest'),
      '-CA',
      ca.file,
      '-CAkey',
      ca.key,
      '-CAcreateserial',
      '-passin',
      'env:PM_SIGNING_INPASS',
      '-outform',
      'DER',
      '-out',
      file,
      '-days',
      days,
      '-sha256',
      '-subj',
      '/CN=' + name,
      '-extfile',
      extensions,
    ],
    { secrets: { PM_SIGNING_INPASS: passA } },
  );
  fs.unlinkSync(extensions);
  return file;
}
function bundle(t) {
  const root = temp(t),
    ca = authority(root),
    folder = newWorkspace(root);
  createCsr(folder, 'fixture+csr@example.com', passA, openssl);
  const cert = issue(folder, ca);
  const p12 = exportP12(folder, cert, passA, passB, [ca.certificate], openssl);
  return { root, ca, folder, cert, p12 };
}

test('signing commands suppress even failing subprocess output and keep credentials out of argv and parent environment', () => {
  const sentinel = 'SENSITIVE-SUBPROCESS-FIXTURE';
  const before = process.env.PM_SIGNING_INPASS;
  assert.throws(
    () =>
      quietRun('synthetic', ['-passin', 'env:PM_SIGNING_INPASS'], {
        input: sentinel,
        secrets: { PM_SIGNING_INPASS: sentinel },
        label: 'Safe failure',
        spawn: (_cmd, args, options) => {
          assert.ok(!JSON.stringify(args).includes(sentinel));
          assert.equal(options.input.toString(), sentinel);
          assert.equal(options.env.PM_SIGNING_INPASS, sentinel);
          assert.equal(options.stdio[1], 'pipe');
          return { status: 1, stdout: Buffer.from(sentinel), stderr: Buffer.from(sentinel) };
        },
      }),
    (error) =>
      error.message === 'Safe failure' &&
      !error.stack.includes(sentinel) &&
      !Object.hasOwn(error, 'stderr'),
  );
  assert.equal(process.env.PM_SIGNING_INPASS, before);
});

test('secret prompts do not echo keys or passwords and restore terminal mode on completion and cancellation', async () => {
  const input = new PassThrough(),
    output = new PassThrough();
  let printed = '';
  input.isTTY = output.isTTY = true;
  input.setRawMode = (raw) => {
    input.isRaw = raw;
  };
  output.on('data', (chunk) => {
    printed += chunk;
  });
  const answer = hiddenInput('Password: ', input, output);
  for (const ch of passA) input.emit('keypress', ch, {});
  input.emit('keypress', '\r', { name: 'return' });
  assert.equal(await answer, passA);
  assert.equal(input.isRaw, false);
  assert.equal(printed, 'Password: \n');
  const cancelled = hiddenInput('Again: ', input, output);
  input.emit('keypress', 'x', {});
  input.emit('keypress', '\x03', { ctrl: true, name: 'c' });
  await assert.rejects(cancelled, /취소/);
  assert.equal(input.isRaw, false);
  assert.ok(!printed.includes(passA));
  assert.throws(() => hiddenInput('No tty', new PassThrough(), output), /대화형/);
});

test('private workspaces reject repositories, worktrees, symlinks and nonprivate access; locks protect existing keys', (t) => {
  const root = temp(t),
    repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  saveNew(path.join(repo, '.git'), 'gitdir: elsewhere');
  assert.throws(() => newWorkspace(repo), /Git/);
  const inside = path.join(repo, 'nested');
  fs.mkdirSync(inside);
  assert.throws(() => newWorkspace(inside), /Git/);
  const link = path.join(root, 'link');
  fs.symlinkSync(root, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => privatePath(link, { directory: true }), /심볼릭/);
  const folder = newWorkspace(root);
  const exposed = newWorkspace(root);
  if (process.platform === 'win32')
    quietRun('icacls.exe', [exposed, '/grant', '*S-1-1-0:(OI)(CI)R']);
  else fs.chmodSync(exposed, 0o755);
  assert.throws(() => secureDirectory(exposed), /사용자 전용/);
  assert.throws(() => locked(folder, () => locked(folder, () => {})), /다른 설정/);
  assert.equal(fs.existsSync(path.join(folder, 'setup.lock')), false);
  createCsr(folder, 'fixture@example.com', passA, openssl);
  const before = fs.readFileSync(path.join(folder, 'developer-id.key.pem'));
  assert.throws(() => createCsr(folder, 'fixture@example.com', passB, openssl), /빈 새 작업/);
  assert.deepEqual(fs.readFileSync(path.join(folder, 'developer-id.key.pem')), before);
  assert.ok(before.toString().startsWith('-----BEGIN ENCRYPTED ' + 'PRIVATE KEY-----'));
  assert.equal(fs.existsSync(path.join(folder, 'request.conf')), false);
  const state = fs.readFileSync(path.join(folder, 'state.json'), 'utf8');
  assert.ok(
    !state.includes(passA) && !state.includes(passB) && !state.includes('fixture@example.com'),
  );
  fs.appendFileSync(path.join(folder, 'PMCanvas.certSigningRequest'), 'tampered');
  assert.throws(() => session(folder), /변경/);
});

test('CSR and P12 round trip preserves the key and uploads only the encrypted bundle and matching password through stdin', (t) => {
  const { folder, p12 } = bundle(t),
    calls = [];
  const run = (cmd, args, options) => {
    calls.push({ cmd, args, input: options.input });
    return Buffer.alloc(0);
  };
  registerP12(folder, passB, run, openssl);
  const sets = calls.filter((item) => item.args[0] === 'secret');
  assert.deepEqual(
    sets.map((item) => item.args[2]),
    ['MAC_CSC_LINK', 'MAC_CSC_KEY_PASSWORD'],
  );
  assert.equal(sets[0].input, fs.readFileSync(p12).toString('base64'));
  assert.equal(sets[1].input, passB);
  for (const item of calls) {
    assert.ok(!item.args.includes('--body'));
    assert.ok(!JSON.stringify(item.args).includes(passB));
    if (item.args.includes('--repo'))
      assert.equal(item.args[item.args.indexOf('--repo') + 1], 'github.com/jhoon-dev/PMCanvas');
  }
  const before = digest(fs.readFileSync(p12));
  assert.throws(() => registerP12(folder, 'Wrong-Password-Here-1234', run, openssl), /암호/);
  assert.equal(digest(fs.readFileSync(p12)), before);
  fs.appendFileSync(p12, 'tampered');
  assert.throws(() => registerP12(folder, passB, run, openssl), /변경/);
});

test('P12 conversion rejects wrong keys, wrong certificate purposes, untrusted issuers and expired certificates without deleting originals', (t) => {
  const root = temp(t),
    ca = authority(root),
    folder = newWorkspace(root),
    other = newWorkspace(root);
  createCsr(folder, 'fixture@example.com', passA, openssl);
  createCsr(other, 'other@example.com', passA, openssl);
  for (const [cert, authorities, pattern] of [
    [issue(other, ca), [ca.certificate], /一致|일치/],
    [
      issue(folder, ca, { name: 'Developer ID Installer: Fixture' }),
      [ca.certificate],
      /Application/,
    ],
    [issue(folder, ca), [], /Apple/],
    [issue(folder, ca, { days: '0' }), [ca.certificate], /만료/],
  ])
    assert.throws(() => exportP12(folder, cert, passA, passB, authorities, openssl), pattern);
  assert.equal(fs.existsSync(path.join(folder, 'PMCanvas-DeveloperID.p12')), false);
  assert.equal(fs.existsSync(path.join(folder, 'setup.lock')), false);
  assert.ok(session(folder).publicKeySha256);
  for (const value of ['short', 'contains space password', '한글암호테스트입니다123456'])
    assert.throws(() => password(value));
});

test('notarization registration validates P8 files and checks both scopes for mixed credentials without deleting secrets', (t) => {
  const root = temp(t),
    file = path.join(root, 'test.p8');
  saveNew(
    file,
    generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }).privateKey,
  );
  const config = {
    mode: 'api',
    keyFile: file,
    keyId: 'BAD',
    issuer: '00000000-0000-0000-0000-000000000000',
  };
  // Key IDs are ten characters; keep this fixture intentionally invalid first.
  assert.throws(
    () =>
      registerNotarization(config, () => {
        throw Error('should not reach GitHub');
      }),
    /Key ID/,
  );
  config.keyId = 'ABCDEFGHIJ';
  const calls = [];
  const clean = (_cmd, args, options) => {
    calls.push({ args, input: options.input });
    return Buffer.from(args[0] === 'secret' && args[1] === 'list' ? '[]' : '');
  };
  registerNotarization(config, clean);
  assert.deepEqual(
    calls.filter((item) => item.args[1] === 'set').map((item) => item.args[2]),
    ['APPLE_API_KEY_BASE64', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'],
  );
  const mixed = (_cmd, args) =>
    Buffer.from(args[1] === 'list' && !args.includes('--env') ? '[{"name":"APPLE_ID"}]' : '[]');
  assert.throws(() => registerNotarization(config, mixed), /다른 공증/);
  const apple = {
    mode: 'apple',
    email: 'fixture@example.com',
    teamId: 'TESTTEAM01',
    appPassword: 'aaaa-bbbb-cccc-dddd',
  };
  calls.length = 0;
  registerNotarization(apple, clean);
  assert.deepEqual(
    calls.filter((item) => item.args[1] === 'set').map((item) => item.args[2]),
    ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'],
  );
  assert.ok(calls.every((item) => !JSON.stringify(item.args).includes(apple.appPassword)));
});

test('official CA downloads use only pinned Apple URLs and reject replacements and oversized responses', async () => {
  await assert.rejects(
    () =>
      officialAuthorities(async (url, options) => {
        assert.match(url, /^https:\/\/www\.apple\.com\/certificateauthority\/DeveloperID/);
        assert.equal(options.redirect, 'error');
        return { ok: true, body: [Buffer.from('not an Apple CA')] };
      }),
    /지문/,
  );
  await assert.rejects(
    () => officialAuthorities(async () => ({ ok: true, body: [Buffer.alloc(32769)] })),
    /크기/,
  );
});

test('CLI refuses secret arguments and redirected input without echoing the supplied value', () => {
  const script = new URL('../scripts/setup-mac-signing.mjs', import.meta.url);
  const leaked = 'Do-Not-Echo-This-Argument-1234';
  const run = spawnSync(process.execPath, [fileURLToPath(script), '--password', leaked], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(run.status, 1);
  assert.ok(!run.stdout.includes(leaked) && !run.stderr.includes(leaked));
  const redirected = spawnSync(process.execPath, [fileURLToPath(script)], {
    encoding: 'utf8',
    windowsHide: true,
    input: leaked,
  });
  assert.equal(redirected.status, 1);
  assert.ok(!redirected.stdout.includes(leaked) && !redirected.stderr.includes(leaked));
  assert.ok(!redirected.stdout.includes('개인 키 암호 A:'));
});

test('parent Node child_process tracing is rejected before any secret-bearing subprocess can start', () => {
  const module = new URL('../scripts/mac-signing-core.mjs', import.meta.url).href;
  const sentinel = 'Private-Parent-Tracing-Fixture';
  const source = `import {quietRun} from ${JSON.stringify(module)};
    try { quietRun('unused', [], {secrets:{PM_SIGNING_INPASS:${JSON.stringify(sentinel)}}}); }
    catch { process.stdout.write('blocked'); process.exitCode=1; }`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    env: { ...process.env, NODE_DEBUG: 'child_process' },
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(run.status, 1);
  assert.equal(run.stdout, 'blocked');
  assert.ok(!run.stderr.includes(sentinel));
});

test(
  'CI macOS imports the Windows-compatible P12 into an isolated disposable keychain',
  {
    skip:
      process.platform !== 'darwin' ||
      process.env.GITHUB_ACTIONS !== 'true' ||
      process.env.RUNNER_ENVIRONMENT !== 'github-hosted',
  },
  (t) => {
    const { folder, p12 } = bundle(t);
    const keychain = path.join(folder, 'interop.keychain-db'),
      fixturePassword = randomBytes(24).toString('hex');
    quietRun('security', ['create-keychain', '-p', fixturePassword, keychain]);
    try {
      quietRun('security', ['unlock-keychain', '-p', fixturePassword, keychain]);
      quietRun('security', ['import', p12, '-k', keychain, '-P', passB, '-T', '/usr/bin/codesign']);
      const exported = path.join(folder, 'roundtrip.p12');
      quietRun('security', [
        'export',
        '-k',
        keychain,
        '-t',
        'identities',
        '-f',
        'pkcs12',
        '-P',
        fixturePassword,
        '-o',
        exported,
      ]);
      assert.ok(fs.statSync(exported).size > 1000);
    } finally {
      quietRun('security', ['delete-keychain', keychain]);
    }
  },
);
