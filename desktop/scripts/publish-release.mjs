import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { verifiedReleaseSource, editableReleaseDraft, releasePlan } from './release-policy.mjs';
import { stageReleaseArtifacts } from './release-evidence.mjs';

// Both modes require successful builds and every selected architecture's real installation test.
if (process.env.GITHUB_ACTIONS !== 'true' || !/^\d+$/.test(process.env.GITHUB_RUN_ID || ''))
  throw Error('An explicitly dispatched GitHub run is required.');
const root = fileURLToPath(new URL('../../', import.meta.url));
const gh = (args) =>
  execFileSync('gh', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 4 * 1024 * 1024,
  });
const plan = releasePlan({
  mode: process.env.PM_RELEASE_MODE || 'unsigned',
  platform: process.env.PM_RELEASE_PLATFORM || 'all',
});
const runId = process.env.PM_RELEASE_RUN_ID || process.env.GITHUB_RUN_ID;
assert.match(runId, /^\d+$/);
const sourceRun = JSON.parse(gh(['api', 'repos/jhoon-dev/PMCanvas/actions/runs/' + runId]));
const jobs = JSON.parse(
  gh(['api', 'repos/jhoon-dev/PMCanvas/actions/runs/' + runId + '/jobs?per_page=100']),
).jobs;
const commit = verifiedReleaseSource(sourceRun, jobs, plan);
const sourcePackage = JSON.parse(
  gh(['api', 'repos/jhoon-dev/PMCanvas/contents/desktop/package.json?ref=' + commit]),
);
const pkg = JSON.parse(Buffer.from(sourcePackage.content, 'base64'));
const version = pkg.version;
assert.match(version, /^\d+\.\d+\.\d+$/);
const tag = 'desktop-v' + version;
const findRelease = () =>
  editableReleaseDraft(
    JSON.parse(gh(['api', 'repos/jhoon-dev/PMCanvas/releases?per_page=100'])),
    tag,
    commit,
  );
// Fail before downloading large installers when this version is already public.
let release = findRelease();
const work = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'pmcanvas-release-'));
const downloads = path.join(work, 'artifacts'),
  stage = path.join(work, 'verified');
fs.mkdirSync(stage);
gh([
  'run',
  'download',
  runId,
  '--pattern',
  'PMCanvas-' + plan.mode + '-*',
  '--pattern',
  'install-lifecycle-*',
  '--dir',
  downloads,
]);
const files = [];
function visit(folder) {
  for (const e of fs.readdirSync(folder, { withFileTypes: true })) {
    assert.equal(e.isSymbolicLink(), false);
    const f = path.join(folder, e.name);
    if (e.isDirectory()) visit(f);
    else files.push(f);
  }
}
visit(downloads);
const { uploads, sums, evidence } = await stageReleaseArtifacts(files, stage, {
  pkg,
  commit,
  plan,
});
fs.writeFileSync(path.join(stage, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
uploads.push(path.join(stage, 'SHA256SUMS.txt'));
const validation = path.join(stage, 'desktop-' + version + '-install-validation.json');
fs.writeFileSync(
  validation,
  JSON.stringify(
    {
      version,
      commit,
      mode: plan.mode,
      platforms: plan.platforms,
      runId,
      publicationRunId: process.env.GITHUB_RUN_ID,
      results: evidence,
    },
    null,
    2,
  ) + '\n',
);
uploads.push(validation);
const notes = path.join(stage, 'notes.txt');
const targets = plan.platforms
  .map((target) => (target === 'win' ? 'Windows x64' : 'Mac Apple Silicon(arm64)·Intel(x64)'))
  .join(', ');
const trust =
  plan.mode === 'signed'
    ? '정식 인증서 서명을 검증했습니다.' +
      (plan.platforms.includes('mac')
        ? ' Mac 파일은 Developer ID 서명·Gatekeeper·공증 티켓을 DMG와 ZIP의 앱에서 확인했습니다.'
        : '')
    : '정식 인증서 서명·공증 없는 빌드입니다.' +
      (plan.platforms.includes('mac') ? ' Mac은 실행용 ad-hoc 서명만 적용했습니다.' : '');
fs.writeFileSync(
  notes,
  `PM Canvas Desktop ${version}\n\n${targets} 설치 파일과 SHA-256을 제공합니다. ${trust}\n\n` +
    `검증: 선택한 ${evidence.length}개 운영체제/아키텍처에서 0.7.1 설치 → ${version} 업데이트 → 제거 → 재설치를 실제 수행하고 ` +
    '프로젝트·복구·언어·시간대·완료 기록·계층·기준 계획 보존을 확인했습니다. 상세 결과는 install-validation JSON을 확인하세요. ' +
    '프로젝트를 설치 폴더 밖에 저장하고 앱을 종료한 뒤 설치하세요. 파일 옵션 → 앱 설정 → 업데이트 확인에서 새 버전을 확인하고 업데이트를 진행할 수 있습니다.\n',
);
if (!release)
  gh([
    'release',
    'create',
    tag,
    '--target',
    commit,
    '--title',
    'PM Canvas Desktop ' + version + ' — ' + plan.mode,
    '--notes-file',
    notes,
    '--draft',
    '--latest=false',
  ]);
gh(['release', 'upload', tag, ...uploads, '--clobber']);
release = findRelease();
assert.ok(release?.id);
assert.equal(release.draft, true);
const uploaded = JSON.parse(gh(['api', 'repos/jhoon-dev/PMCanvas/releases/' + release.id]));
// A resumed draft must not contain stale unsigned or unselected-platform assets.
assert.equal(uploaded.assets.length, uploads.length);
for (const file of uploads) {
  const asset = uploaded.assets.find((a) => a.name === path.basename(file));
  assert.ok(asset);
  assert.equal(asset.size, fs.statSync(file).size);
  assert.equal(
    asset.digest,
    'sha256:' + createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  );
}
gh(['release', 'edit', tag, '--notes-file', notes, '--draft=false', '--latest=true']);
console.log(
  `PASS: ${plan.mode} installers, checksums and ${evidence.length} installation results published at https://github.com/jhoon-dev/PMCanvas/releases/tag/` +
    tag,
);
