import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const releaseJobs = Object.freeze([
  'verify (windows-latest)',
  'verify (macos-latest)',
  'unsigned (windows-latest, win)',
  'unsigned (macos-latest, mac)',
  'install (windows-latest)',
  'install (macos-latest)',
  'install (macos-15-intel)',
]);
export function verifiedReleaseSource(run, jobs) {
  if (
    run.repository?.full_name?.toLowerCase() !== 'jhoon-dev/pmcanvas' ||
    run.event !== 'workflow_dispatch' ||
    run.path !== '.github/workflows/desktop.yml' ||
    !/^[a-f0-9]{40}$/.test(run.head_sha || '')
  )
    throw Error('Release source must be a verified desktop build run in this repository.');
  for (const name of releaseJobs)
    if (!jobs.some((job) => job.name === name && job.conclusion === 'success'))
      throw Error('Missing successful source job: ' + name);
  return run.head_sha;
}
export function editableReleaseDraft(releases, tag, commit) {
  const matches = releases.filter((release) => release.tag_name === tag);
  if (matches.length > 1) throw Error('Ambiguous release tag.');
  const release = matches[0];
  if (release && (!release.draft || release.target_commitish !== commit))
    throw Error('Only an unpublished draft with the same source commit can be resumed.');
  return release;
}

export function releaseSource(root, run = execFileSync) {
  if (
    run('git', ['status', '--porcelain', '--untracked-files=normal'], {
      cwd: root,
      encoding: 'utf8',
    }).trim()
  )
    throw Error(
      'Commit changes before building a desktop release. Use dist:win:dev for development builds.',
    );
  return run('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}
export function signingPolicy(target, env = process.env, platform = process.platform) {
  if (!['win', 'mac'].includes(target)) throw Error('Choose win or mac.');
  if (platform !== (target === 'win' ? 'win32' : 'darwin'))
    throw Error('Build on the target operating system.');
  const has = (key) => Boolean(env[key] && !/^(?:YOUR_|REPLACE_|<)/i.test(env[key]));
  const certificate =
    target === 'win'
      ? has('WIN_CSC_LINK') || has('CSC_LINK') || has('WIN_CSC_SHA1')
      : has('CSC_LINK') || has('CSC_NAME');
  if (!certificate)
    throw Error(
      'Signing certificate required: set ' +
        (target === 'win' ? 'WIN_CSC_LINK, CSC_LINK or WIN_CSC_SHA1' : 'CSC_LINK or CSC_NAME') +
        '.',
    );
  if (target === 'mac') {
    const api = ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'].every(has);
    const apple = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'].every(has);
    const keychain = ['APPLE_KEYCHAIN', 'APPLE_KEYCHAIN_PROFILE'].every(has);
    if (!api && !apple && !keychain)
      throw Error(
        'Notarization credentials required: configure the Apple API key, Apple ID, or keychain profile group.',
      );
    if (api && !fs.existsSync(path.resolve(env.APPLE_API_KEY)))
      throw Error('APPLE_API_KEY must point to an existing private .p8 file.');
  }
  return {
    forceCodeSigning: true,
    ...(target === 'win' && has('WIN_CSC_SHA1')
      ? { win: { signtoolOptions: { certificateSha1: env.WIN_CSC_SHA1 } } }
      : {}),
    ...(target === 'mac' ? { mac: { notarize: true, hardenedRuntime: true } } : {}),
  };
}
