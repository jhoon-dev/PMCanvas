import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { signingPolicy, releaseSource } from '../scripts/release-policy.mjs';
import { verifySignatures } from '../scripts/verify-signatures.mjs';

test('release verification checks timestamped Authenticode and both macOS signatures, Gatekeeper and stapled tickets', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-signature-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'setup.exe'), 'fixture');
  const calls = [];
  const run = (...args) => calls.push(args);
  verifySignatures('win', root, run);
  assert.equal(calls.length, 2);
  assert.ok(
    calls.every(
      ([cmd, args, options]) =>
        cmd === 'powershell.exe' &&
        args.at(-1).includes('TimeStamperCertificate') &&
        options.env.PM_SIGNATURE_FILE.endsWith('.exe'),
    ),
  );
  calls.length = 0;
  verifySignatures('mac', root, run);
  assert.deepEqual(
    calls.map(([command]) => command),
    ['codesign', 'spctl', 'xcrun', 'codesign', 'spctl', 'xcrun'],
  );
  for (const target of ['win', 'mac'])
    assert.throws(
      () =>
        verifySignatures(target, root, () => {
          throw Error('signature rejected');
        }),
      /signature rejected/,
    );
  assert.throws(() => verifySignatures('unknown', root, run), /Unsupported/);
});

test('desktop release refuses dirty, staged and untracked source and records the exact clean commit', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-release-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git('init', '-q');
    fs.writeFileSync(path.join(root, 'source.txt'), 'original');
    git('add', '.');
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.com',
      'commit',
      '-qm',
      'fixture',
    );
    assert.equal(releaseSource(root), git('rev-parse', 'HEAD').trim());
    fs.writeFileSync(path.join(root, 'source.txt'), 'changed');
    assert.throws(() => releaseSource(root), /Commit changes/);
    git('add', '.');
    assert.throws(() => releaseSource(root), /Commit changes/);
    git('restore', '--staged', 'source.txt');
    fs.writeFileSync(path.join(root, 'source.txt'), 'original');
    fs.writeFileSync(path.join(root, 'untracked.txt'), 'new');
    assert.throws(() => releaseSource(root), /Commit changes/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('formal releases require signing and complete notarization credentials without exposing values', () => {
  assert.throws(() => signingPolicy('win', {}, 'win32'), /certificate required/);
  assert.throws(
    () => signingPolicy('win', { CSC_LINK: 'YOUR_CERT' }, 'win32'),
    /certificate required/,
  );
  assert.throws(() => signingPolicy('mac', { CSC_LINK: 'synthetic' }, 'win32'), /target operating/);
  assert.deepEqual(signingPolicy('win', { WIN_CSC_LINK: 'synthetic' }, 'win32'), {
    forceCodeSigning: true,
  });
  assert.equal(
    signingPolicy('win', { WIN_CSC_SHA1: 'a'.repeat(40) }, 'win32').win.signtoolOptions
      .certificateSha1,
    'a'.repeat(40),
  );
  assert.throws(
    () =>
      signingPolicy('mac', { CSC_LINK: 'synthetic', APPLE_ID: 'fixture@example.com' }, 'darwin'),
    /Notarization credentials/,
  );
  const config = signingPolicy(
    'mac',
    {
      CSC_LINK: 'synthetic',
      APPLE_ID: 'fixture@example.com',
      APPLE_APP_SPECIFIC_PASSWORD: 'synthetic',
      APPLE_TEAM_ID: 'fixture',
    },
    'darwin',
  );
  assert.equal(config.forceCodeSigning, true);
  assert.equal(config.mac.notarize, true);
  assert.equal(config.mac.hardenedRuntime, true);
});
