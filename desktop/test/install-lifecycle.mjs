// Destructive installation tests run only on fresh, disposable GitHub-hosted runners.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { legacyProject, assertUpgradedProject } from './legacy-project.mjs';
import { verifyWindowsSignature, verifyMacApp } from '../scripts/verify-signatures.mjs';
import { buildLegacyFixture } from './legacy-fixture.mjs';
const { _electron: electron } = createRequire(new URL('../../web/package.json', import.meta.url))(
  '@playwright/test',
);
if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true' || !process.env.RUNNER_TEMP)
  throw Error('Installation lifecycle tests require an isolated GitHub-hosted runner.');
if (!['win32', 'darwin'].includes(process.platform)) throw Error('Windows or macOS required.');
const desktop = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json')));
const { version } = pkg;
const platform = process.platform === 'win32' ? 'win' : 'mac';
const mode = process.env.PM_INSTALLER_MODE || 'unsigned';
assert.ok(['signed', 'unsigned'].includes(mode));
const signed = mode === 'signed';
const name = (v) =>
  'PMCanvas-Desktop-' +
  v +
  (platform === 'win' ? '-Windows-x64.exe' : '-macOS-' + process.arch + '.dmg');

const work = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'pmcanvas-install-'));
const install = path.join(work, platform === 'win' ? 'installed' : 'PM Canvas Desktop.app');
const projectFile = path.join(work, 'Documents', 'Preserved.pmcanvas');
let installedProductName = 'PM Canvas Desktop';
const executable = () =>
  platform === 'win'
    ? path.join(install, installedProductName + '.exe')
    : path.join(install, 'Contents/MacOS', installedProductName);
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
async function prepareBaseline() {
  const fixture = await buildLegacyFixture();
  assert.equal(hash(fixture.installer), fixture.sha256);
  return fixture;
}

function findCurrent(folder, expectedName = name(version)) {
  const matches = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, entry.name);
      assert.equal(entry.isSymbolicLink(), false);
      if (entry.isDirectory()) visit(f);
      else if (entry.name === expectedName) matches.push(f);
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
  const current = path.basename(file) === name(version);
  installedProductName = current ? pkg.build.productName : 'PM Canvas Desktop';
  const currentSigned = signed && current;
  if (currentSigned && platform === 'win') verifyWindowsSignature(file);
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
      run('ditto', [path.join(mount, installedProductName + '.app'), install]);
    } finally {
      run('hdiutil', ['detach', mount]);
    }
  }
  assert.ok(fs.existsSync(executable()));
  if (currentSigned) {
    if (platform === 'win') verifyWindowsSignature(executable());
    else verifyMacApp(install);
  }
}
async function launch(expectedVersion) {
  application = await electron.launch({
    executablePath: executable(),
    args: [],
    timeout: 40000,
    env: Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !['GH_TOKEN', 'GITHUB_TOKEN'].includes(key)),
    ),
  });
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
    run(path.join(install, 'Uninstall ' + installedProductName + '.exe'), ['/S', '/currentuser'], {
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
  const baseline = await prepareBaseline();
  const artifactFolder = path.resolve(
    process.argv[2] || path.join(desktop, 'dist/lifecycle-artifact'),
  );
  const current = findCurrent(artifactFolder);
  let zipSha256;
  if (signed && platform === 'mac') {
    const zip = findCurrent(artifactFolder, name(version).replace(/\.dmg$/, '.zip'));
    const extracted = path.join(work, 'verified-zip');
    run('ditto', ['-x', '-k', zip, extracted]);
    verifyMacApp(path.join(extracted, pkg.build.productName + '.app'));
    zipSha256 = hash(zip);
  }
  installPackage(baseline.installer);
  checks.push('Installed a CI-only 0.7.1 fixture recreated from its pinned source commit.');
  let page = await launch('0.7.1');
  await page.locator('[data-command="new"]').first().waitFor();
  const project = legacyProject('설치·업데이트 데이터 보존', '설치 전 기준 계획');
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
    () =>
      document.querySelector('[data-project-tab][aria-selected="true"] .project-tab-name')
        ?.textContent === '설치·업데이트 데이터 보존',
  );
  assertUpgradedProject(
    (await page.evaluate(() => window.desktop.snapshot())).project,
    saved.project,
  );
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
    () =>
      document.querySelector('[data-project-tab][aria-selected="true"] .project-tab-name')
        ?.textContent === '설치·업데이트 데이터 보존',
  );
  assertUpgradedProject(
    (await page.evaluate(() => window.desktop.snapshot())).project,
    saved.project,
  );
  assert.equal((await page.evaluate(() => window.desktop.settings())).timeZone, 'America/New_York');
  assert.equal(await page.evaluate(() => localStorage.getItem('pmcanvas.language')), 'en');
  await close();
  checks.push('Reinstalled ' + version + ' and reopened the same project and settings.');
  const result = {
    commit: run('git', ['rev-parse', 'HEAD'], { cwd: desktop }).trim(),
    platform: process.platform,
    arch: process.arch,
    baseline: '0.7.1',
    baselineSourceCommit: baseline.sourceCommit,
    baselineInstallerSha256: baseline.sha256,
    version,
    mode,
    installerSha256: hash(current),
    signaturesVerified: signed,
    notarizationVerified: signed && platform === 'mac',
    ...(zipSha256 ? { zipSha256 } : {}),
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
