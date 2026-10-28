import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { signingPolicy, releaseSource } from '../scripts/release-policy.mjs';

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
