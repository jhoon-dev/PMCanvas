import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  signingPolicy,
  releaseSource,
  verifiedReleaseSource,
  assertMainlineCommit,
  editableReleaseDraft,
  releaseJobs,
  releasePlan,
} from '../scripts/release-policy.mjs';

test('platform plans keep both default targets and require both Mac architectures without Windows signing', () => {
  assert.equal(releasePlan().jobs.length, 7);
  for (const mode of ['signed', 'unsigned']) {
    const mac = releasePlan({ mode, platform: 'mac' });
    assert.deepEqual(mac.builds.include, [{ os: 'macos-latest', target: 'mac' }]);
    assert.deepEqual(mac.systems, ['darwin-arm64', 'darwin-x64']);
    assert.ok(!mac.jobs.some((job) => job.startsWith(mode + ' (windows')));
    const win = releasePlan({ mode, platform: 'win' });
    assert.deepEqual(win.systems, ['win32-x64']);
    assert.equal(win.installs.include.length, 1);
    const run = {
      repository: { full_name: 'jhoon-dev/PMCanvas' },
      event: 'workflow_dispatch',
      path: '.github/workflows/desktop.yml',
      head_sha: 'a'.repeat(40),
      head_branch: 'main',
    };
    const jobs = mac.jobs.map((name) => ({ name, conclusion: 'success' }));
    assert.equal(verifiedReleaseSource(run, jobs, mac), run.head_sha);
    for (const missing of mac.jobs)
      assert.throws(
        () =>
          verifiedReleaseSource(
            run,
            jobs.filter((j) => j.name !== missing),
            mac,
          ),
        /Missing successful/,
      );
    assert.throws(
      () => verifiedReleaseSource(run, jobs, { mode, platform: 'all' }),
      /Missing successful/,
    );
    assert.throws(
      () =>
        verifiedReleaseSource(run, jobs, {
          mode: mode === 'signed' ? 'unsigned' : 'signed',
          platform: 'mac',
        }),
      /Missing successful/,
    );
  }
  assert.throws(() => releasePlan({ platform: 'linux' }), /Choose all/);
  assert.throws(() => releasePlan({ mode: 'other' }), /Choose signed/);
});

test('CI dispatch rejects mixed signing modes, unsafe run IDs and publication without a build', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-plan-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const output = path.join(temp, 'outputs'),
    summary = path.join(temp, 'summary');
  const env = {
    ...process.env,
    GITHUB_OUTPUT: output,
    GITHUB_STEP_SUMMARY: summary,
    PM_SIGNED: '',
    PM_UNSIGNED: '',
    PM_PUBLISH: '',
    PM_RELEASE_RUN_ID: '',
    PM_RELEASE_PLATFORM: '',
  };
  const run = (extra) =>
    execFileSync(process.execPath, ['desktop/scripts/ci-release-plan.mjs'], {
      cwd: new URL('../../', import.meta.url),
      env: { ...env, ...extra },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  for (const extra of [
    { PM_SIGNED: 'true', PM_UNSIGNED: 'true' },
    { PM_SIGNED: 'true', PM_RELEASE_PLATFORM: 'win' },
    { PM_SIGNED: 'true', PM_RELEASE_PLATFORM: 'all' },
    { PM_PUBLISH: 'true' },
    { PM_RELEASE_RUN_ID: '12\nextra=value' },
    { PM_RELEASE_PLATFORM: 'mac\nother' },
  ])
    assert.throws(() => run(extra));
  run({ PM_SIGNED: 'true', PM_PUBLISH: 'true', PM_RELEASE_PLATFORM: 'mac' });
  const lines = fs.readFileSync(output, 'utf8').trim().split('\n');
  assert.equal(lines[0], 'mode=signed');
  assert.deepEqual(
    JSON.parse(lines[1].slice('builds='.length)),
    releasePlan({ platform: 'mac' }).builds,
  );
  run({ PM_PUBLISH: 'true', PM_RELEASE_RUN_ID: '123' });
});

test('publication recovery requires all source checks and rejects another repository, workflow or event', () => {
  const run = {
    repository: { full_name: 'jhoon-dev/PMCanvas' },
    event: 'workflow_dispatch',
    path: '.github/workflows/desktop.yml',
    head_sha: 'a'.repeat(40),
    head_branch: 'main',
  };
  const jobs = releaseJobs.map((name) => ({ name, conclusion: 'success' }));
  assert.equal(verifiedReleaseSource(run, jobs), run.head_sha);
  for (const branch of [undefined, 'codex/unreviewed', 'refs/heads/main', 'Main'])
    assert.throws(
      () => verifiedReleaseSource({ ...run, head_branch: branch }, jobs),
      /verified desktop/,
    );
  assert.throws(
    () =>
      verifiedReleaseSource(
        run,
        jobs.filter((job) => job.name !== 'install (macos-15-intel)'),
      ),
    /Missing successful/,
  );
  assert.throws(
    () => verifiedReleaseSource({ ...run, event: 'pull_request' }, jobs),
    /verified desktop/,
  );
  assert.throws(
    () => verifiedReleaseSource({ ...run, repository: { full_name: 'other/project' } }, jobs),
    /verified desktop/,
  );
  assert.throws(
    () => verifiedReleaseSource({ ...run, path: '.github/workflows/other.yml' }, jobs),
    /verified desktop/,
  );
});

test('publication accepts current/older main commits but rejects unmerged, removed and unverifiable history', () => {
  const source = 'a'.repeat(40),
    main = 'b'.repeat(40);
  const proof = {
    status: 'ahead',
    ahead_by: 2,
    behind_by: 0,
    base_commit: { sha: source },
    merge_base_commit: { sha: source },
  };
  assert.doesNotThrow(() => assertMainlineCommit(source, main, proof));
  assert.doesNotThrow(() =>
    assertMainlineCommit(source, source, { ...proof, status: 'identical', ahead_by: 0 }),
  );
  for (const changed of [
    null,
    {},
    { ...proof, status: 'diverged' },
    { ...proof, status: 'behind' },
    { ...proof, behind_by: 1 },
    { ...proof, base_commit: { sha: main } },
    { ...proof, merge_base_commit: { sha: main } },
  ])
    assert.throws(() => assertMainlineCommit(source, main, changed), /current main history/);
  assert.throws(() => assertMainlineCommit(source, 'main', proof), /current main history/);
});
test('draft recovery resolves IDs from the release list and never overwrites a published or different source release', () => {
  const release = {
    id: 42,
    tag_name: 'desktop-v0.7.2',
    draft: true,
    target_commitish: 'a'.repeat(40),
  };
  assert.equal(editableReleaseDraft([release], 'desktop-v0.7.2', release.target_commitish).id, 42);
  assert.equal(
    editableReleaseDraft([release], 'desktop-v0.7.3', release.target_commitish),
    undefined,
  );
  assert.throws(
    () =>
      editableReleaseDraft(
        [{ ...release, draft: false }],
        release.tag_name,
        release.target_commitish,
      ),
    /unpublished/,
  );
  assert.throws(
    () => editableReleaseDraft([release], release.tag_name, 'b'.repeat(40)),
    /same source/,
  );
});
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
