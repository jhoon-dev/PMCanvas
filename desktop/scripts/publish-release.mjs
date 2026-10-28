import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { verifiedReleaseSource, editableReleaseDraft } from './release-policy.mjs';

// Publishing is explicitly dispatched and gated by all three real installation jobs.
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
const runId = process.env.PM_RELEASE_RUN_ID || process.env.GITHUB_RUN_ID;
assert.match(runId, /^\d+$/);
const sourceRun = JSON.parse(gh(['api', 'repos/jhoon-dev/PMCanvas/actions/runs/' + runId]));
const jobs = JSON.parse(
  gh(['api', 'repos/jhoon-dev/PMCanvas/actions/runs/' + runId + '/jobs?per_page=100']),
).jobs;
const commit = verifiedReleaseSource(sourceRun, jobs);
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
const work = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'pmcanvas-release-'));
const downloads = path.join(work, 'artifacts'),
  stage = path.join(work, 'verified');
fs.mkdirSync(stage);
gh([
  'run',
  'download',
  runId,
  '--pattern',
  'PMCanvas-unsigned-*',
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
const manifests = files.filter((f) => path.basename(f) === 'unsigned-manifest.json');
assert.equal(manifests.length, 2);
const uploads = [],
  sums = [],
  platforms = new Set();
const add = (file, name = path.basename(file)) => {
  assert.equal(path.basename(name), name);
  const target = path.join(stage, name);
  fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
  uploads.push(target);
};
for (const file of manifests) {
  const manifest = JSON.parse(fs.readFileSync(file));
  assert.equal(manifest.version, version);
  assert.equal(manifest.product, pkg.name);
  assert.equal(manifest.commit, commit);
  assert.equal(manifest.signed, false);
  assert.equal(manifest.notarized, false);
  assert.ok(['win', 'mac'].includes(manifest.platform));
  assert.equal(manifest.macAdHoc, manifest.platform === 'mac');
  assert.equal(platforms.has(manifest.platform), false);
  platforms.add(manifest.platform);
  assert.equal(manifest.artifacts.length, manifest.platform === 'win' ? 1 : 4);
  const expected = new Set(
    manifest.platform === 'win'
      ? ['PMCanvas-Desktop-' + version + '-Windows-x64.exe']
      : ['arm64', 'x64'].flatMap((arch) =>
          ['dmg', 'zip'].map((ext) => 'PMCanvas-Desktop-' + version + '-macOS-' + arch + '.' + ext),
        ),
  );
  for (const asset of manifest.artifacts) {
    assert.ok(expected.delete(asset.name));
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    const data = path.join(path.dirname(file), asset.name),
      digest = createHash('sha256');
    for await (const chunk of fs.createReadStream(data)) digest.update(chunk);
    assert.equal(digest.digest('hex'), asset.sha256);
    assert.equal(
      fs.readFileSync(data + '.sha256', 'utf8').trim(),
      asset.sha256 + '  ' + asset.name,
    );
    add(data);
    add(data + '.sha256');
    sums.push(asset.sha256 + '  ' + asset.name);
  }
  assert.equal(expected.size, 0);
  add(file, 'desktop-' + version + '-' + manifest.platform + '-manifest.json');
}
const evidence = files
  .filter((f) => /^install-lifecycle-(win32|darwin)-(x64|arm64)\.json$/.test(path.basename(f)))
  .map((file) => JSON.parse(fs.readFileSync(file)));
assert.equal(evidence.length, 3);
const systems = new Set(['win32-x64', 'darwin-arm64', 'darwin-x64']);
for (const item of evidence) {
  assert.ok(systems.delete(item.platform + '-' + item.arch));
  assert.equal(item.version, version);
  assert.equal(item.commit, commit);
  assert.equal(item.baseline, '0.7.1');
  assert.equal(item.checks.length, 5);
  assert.match(item.projectSha256, /^[a-f0-9]{64}$/);
}
assert.equal(systems.size, 0);
fs.writeFileSync(path.join(stage, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
uploads.push(path.join(stage, 'SHA256SUMS.txt'));
const validation = path.join(stage, 'desktop-' + version + '-install-validation.json');
fs.writeFileSync(
  validation,
  JSON.stringify(
    { version, commit, runId, publicationRunId: process.env.GITHUB_RUN_ID, results: evidence },
    null,
    2,
  ) + '\n',
);
uploads.push(validation);
const notes = path.join(stage, 'notes.txt');
fs.writeFileSync(
  notes,
  '수동 업데이트 안내를 추가한 PM Canvas Desktop ' +
    version +
    '입니다. 파일 옵션 → 업데이트 확인에서 정식 데스크톱 버전과 공식 다운로드 페이지를 확인합니다. 오프라인 편집·저장은 유지하며 자동 설치나 프로젝트 전송은 하지 않습니다.\n\nWindows x64, Mac Apple Silicon(arm64)·Intel(x64) 설치 파일과 SHA-256을 제공합니다. 정식 인증서 서명·공증 없는 빌드이며 Mac은 실행용 ad-hoc 서명만 적용했습니다.\n\n검증: 세 운영체제/아키텍처에서 0.7.1 설치 → ' +
    version +
    ' 업데이트 → 제거 → 재설치를 실제 수행하고 프로젝트·복구·언어·시간대·완료 기록·계층·기준 계획 보존을 확인했습니다. 상세 결과는 install-validation JSON을 확인하세요. 프로젝트를 설치 폴더 밖에 저장하고 앱을 종료한 뒤 설치하세요.\n',
);
const existing = findRelease();
if (existing) {
  assert.equal(existing.draft, true, 'Published releases are never overwritten.');
  assert.equal(existing.target_commitish, commit);
} else
  gh([
    'release',
    'create',
    tag,
    '--target',
    commit,
    '--title',
    'PM Canvas Desktop ' + version + ' — unsigned',
    '--notes-file',
    notes,
    '--draft',
    '--latest=false',
  ]);
gh(['release', 'upload', tag, ...uploads, '--clobber']);
const release = findRelease();
assert.ok(release?.id);
assert.equal(release.draft, true);
const uploaded = JSON.parse(gh(['api', 'repos/jhoon-dev/PMCanvas/releases/' + release.id]));
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
  'PASS: verified installers, checksums and three installation results published at https://github.com/jhoon-dev/PMCanvas/releases/tag/' +
    tag,
);
