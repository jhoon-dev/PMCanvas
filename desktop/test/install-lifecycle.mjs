// Destructive installation tests run only on fresh, disposable GitHub-hosted runners.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { screenProject } from '../../web/test/support/screen-fixtures.mjs';
import { captureBaseline } from '../app/shared/planning.js';
const { _electron: electron } = createRequire(new URL('../../web/package.json', import.meta.url))(
  '@playwright/test',
);
if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true' || !process.env.RUNNER_TEMP)
  throw Error('Installation lifecycle tests require an isolated GitHub-hosted runner.');
if (!['win32', 'darwin'].includes(process.platform)) throw Error('Windows or macOS required.');
const desktop = fileURLToPath(new URL('../', import.meta.url));
const version = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'))).version;
const platform = process.platform === 'win32' ? 'win' : 'mac';
const name = (v) =>
  'PMCanvas-Desktop-' +
  v +
  (platform === 'win' ? '-Windows-x64.exe' : '-macOS-' + process.arch + '.dmg');
const baselineHashes = {
  win: '82ca271d86dff7e87a7e1d47850d378aae817994cc2ed168b79e0e89d7c6666c',
  arm64: '118a23853c93414f080ead5399343099255f591eb22a1f2f258ebbb7e80239db',
  x64: '28cf717bb545d019dff7399e75df057e679ee26f0fd26c529acb7a80a2f69d8a',
};
const work = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'pmcanvas-install-'));
const install = path.join(work, platform === 'win' ? 'installed' : 'PM Canvas Desktop.app');
const projectFile = path.join(work, 'Documents', 'Preserved.pmcanvas');
const executable =
  platform === 'win'
    ? path.join(install, 'PM Canvas Desktop.exe')
    : path.join(install, 'Contents/MacOS/PM Canvas Desktop');
const registry =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\df0635bf-66e1-510a-b0e5-9ed63f670162';
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 180000,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const checks = [];
let application, profile;
const safeInstallPath = () => {
  assert.ok(path.resolve(install).startsWith(path.resolve(work) + path.sep));
  assert.ok(path.resolve(work).startsWith(path.resolve(process.env.RUNNER_TEMP) + path.sep));
  assert.ok(path.basename(work).startsWith('pmcanvas-install-'));
};
function absentInstallation() {
  assert.equal(fs.existsSync(install), false);
  if (platform === 'win') {
    let present = false;
    try {
      run('reg', ['query', registry]);
      present = true;
    } catch {}
    assert.equal(present, false, 'Refuse to touch an existing installed application.');
  }
  for (const name of ['pmcanvas-desktop', 'PM Canvas Desktop']) {
    const folder =
      platform === 'win'
        ? path.join(process.env.APPDATA, name)
        : path.join(os.homedir(), 'Library/Application Support', name);
    assert.equal(
      fs.existsSync(folder),
      false,
      'The runner must not contain pre-existing user data.',
    );
  }
}
async function downloadBaseline() {
  const file = path.join(work, name('0.7.1'));
  const res = await fetch(
    'https://github.com/jhoon-dev/PMCanvas/releases/download/desktop-v0.7.1/' + name('0.7.1'),
    { signal: AbortSignal.timeout(180000) },
  );
  assert.equal(res.ok, true, 'Baseline installer download failed.');
  const fd = fs.openSync(file, 'wx', 0o600);
  let size = 0;
  try {
    for await (const chunk of res.body) {
      size += chunk.length;
      assert.ok(size < 256 * 1024 * 1024);
      fs.writeSync(fd, chunk);
    }
  } finally {
    fs.closeSync(fd);
  }
  assert.equal(
    hash(file),
    baselineHashes[platform === 'win' ? 'win' : process.arch],
    'Pinned baseline checksum mismatch.',
  );
  return file;
}
function findCurrent(folder) {
  const matches = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(f);
      else if (entry.name === name(version)) matches.push(f);
    }
  };
  visit(folder);
  assert.equal(matches.length, 1, 'Exactly one current installer is required.');
  const file = matches[0];
  const sidecar = fs.readFileSync(file + '.sha256', 'utf8').trim();
  assert.equal(sidecar, hash(file) + '  ' + path.basename(file));
  return file;
}
function installPackage(file) {
  safeInstallPath();
  if (platform === 'win') run(file, ['/S', '/currentuser', '/D=' + install]);
  else {
    const mount = path.join(work, 'mounted-dmg');
    fs.mkdirSync(mount, { recursive: true });
    run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, file]);
    try {
      if (fs.existsSync(install)) {
        safeInstallPath();
        fs.rmSync(install, { recursive: true });
      }
      run('ditto', [path.join(mount, 'PM Canvas Desktop.app'), install]);
    } finally {
      run('hdiutil', ['detach', mount]);
    }
  }
  assert.ok(fs.existsSync(executable));
}
async function launch(expectedVersion) {
  application = await electron.launch({ executablePath: executable, args: [], timeout: 40000 });
  const details = await application.evaluate(({ app }) => ({
    version: app.getVersion(),
    profile: app.getPath('userData'),
    packaged: app.isPackaged,
  }));
  assert.equal(details.packaged, true);
  assert.equal(details.version, expectedVersion);
  if (profile) assert.equal(details.profile, profile);
  else profile = details.profile;
  const page = await application.firstWindow({ timeout: 20000 });
  page.setDefaultTimeout(20000);
  await page.locator('#content').waitFor();
  await page.waitForFunction(() => typeof window.desktop?.snapshot === 'function');
  return page;
}
async function close() {
  await application?.close();
  application = null;
}
function preservedFiles() {
  return [projectFile, path.join(profile, 'recovery.json'), path.join(profile, 'preferences.json')];
}
function snapshot() {
  return preservedFiles().map((file) => ({ file, sha256: hash(file) }));
}
function unchanged(before) {
  for (const f of before)
    assert.equal(hash(f.file), f.sha256, 'Preserved file changed during installation/removal.');
}
function removeInstallation() {
  safeInstallPath();
  if (platform === 'win')
    run(path.join(install, 'Uninstall PM Canvas Desktop.exe'), ['/S', '/currentuser'], {
      cwd: work,
    });
  else fs.rmSync(install, { recursive: true });
}
async function waitRemoved() {
  for (let i = 0; i < 100 && fs.existsSync(install); i++)
    await new Promise((r) => setTimeout(r, 200));
  assert.equal(fs.existsSync(install), false, 'Installation folder remains after removal.');
  if (platform === 'win') {
    let present = false;
    try {
      run('reg', ['query', registry]);
      present = true;
    } catch {}
    assert.equal(present, false, 'Uninstall registry remains.');
  }
}
try {
  absentInstallation();
  const baseline = await downloadBaseline();
  const current = findCurrent(
    path.resolve(process.argv[2] || path.join(desktop, 'dist/lifecycle-artifact')),
  );
  installPackage(baseline);
  checks.push('Installed the checksum-pinned 0.7.1 installer.');
  let page = await launch('0.7.1');
  await page.locator('[data-command="new"]').first().waitFor();
  const project = screenProject();
  delete project._role;
  delete project._revision;
  project.name = '설치·업데이트 데이터 보존';
  project.tasks[1].predecessor = '';
  project.tasks[1].parentId = project.tasks[0].id;
  project.baseline = captureBaseline(project, '설치 전 기준 계획');
  fs.mkdirSync(path.dirname(projectFile), { recursive: true });
  await application.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, projectFile);
  const saved = await page.evaluate(async (project) => {
    const created = await window.desktop.newProject();
    await window.desktop.replace(project, created.revision);
    return window.desktop.save();
  }, project);
  await page.evaluate(async () => {
    await window.desktop.setTimeZone('America/New_York');
    localStorage.setItem('pmcanvas.language', 'en');
  });
  await close();
  let before = snapshot();
  installPackage(current);
  unchanged(before);
  checks.push(
    'Upgraded 0.7.1 to ' + version + ' with project/recovery/preferences byte-identical.',
  );
  page = await launch(version);
  await page.waitForFunction(
    () => document.querySelector('#projectName')?.textContent === '설치·업데이트 데이터 보존',
  );
  assert.deepEqual((await page.evaluate(() => window.desktop.snapshot())).project, saved.project);
  assert.equal((await page.evaluate(() => window.desktop.settings())).timeZone, 'America/New_York');
  assert.equal(await page.evaluate(() => localStorage.getItem('pmcanvas.language')), 'en');
  await close();
  checks.push(
    'The installed app reopened the same Korean tasks, hierarchy, baseline, completion records, language and time zone.',
  );
  before = snapshot();
  removeInstallation();
  await waitRemoved();
  unchanged(before);
  checks.push(
    'Removed the application without deleting project, recovery, preferences or language storage.',
  );
  installPackage(current);
  unchanged(before);
  page = await launch(version);
  await page.waitForFunction(
    () => document.querySelector('#projectName')?.textContent === '설치·업데이트 데이터 보존',
  );
  assert.deepEqual((await page.evaluate(() => window.desktop.snapshot())).project, saved.project);
  assert.equal((await page.evaluate(() => window.desktop.settings())).timeZone, 'America/New_York');
  assert.equal(await page.evaluate(() => localStorage.getItem('pmcanvas.language')), 'en');
  await close();
  checks.push('Reinstalled ' + version + ' and reopened the same project and settings.');
  const result = {
    commit: run('git', ['rev-parse', 'HEAD'], { cwd: desktop }).trim(),
    platform: process.platform,
    arch: process.arch,
    baseline: '0.7.1',
    version,
    checks,
    projectSha256: hash(projectFile),
    verifiedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.join(desktop, 'test-results'), { recursive: true });
  fs.writeFileSync(
    path.join(
      desktop,
      'test-results/install-lifecycle-' + process.platform + '-' + process.arch + '.json',
    ),
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(checks.map((c) => 'PASS: ' + c).join('\n'));
} finally {
  if (application) {
    await application.evaluate(({ app }) => app.exit(0)).catch(() => {});
    application.process().kill('SIGKILL');
  }
  // Runner teardown removes the installed fixture/profile; never recursively clean a host profile.
}
