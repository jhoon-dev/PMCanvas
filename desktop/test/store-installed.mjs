// Runs directly for the NSIS baseline, then inside the registered MSIX package identity.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { legacyProject, assertUpgradedProject, assertMigratedRecovery } from './legacy-project.mjs';
const { _electron: electron } = createRequire(new URL('../../web/package.json', import.meta.url))(
  '@playwright/test',
);
const [requestFile, resultFile] = process.argv.slice(2);
const request = JSON.parse(fs.readFileSync(requestFile));
let app;
try {
  if (
    request.ci?.GITHUB_ACTIONS !== 'true' ||
    request.ci?.CI !== 'true' ||
    request.ci?.RUNNER_ENVIRONMENT !== 'github-hosted' ||
    !/^\d+$/.test(request.ci?.GITHUB_RUN_ID || '') ||
    !path.isAbsolute(request.ci?.RUNNER_TEMP || '') ||
    process.platform !== 'win32'
  )
    throw Error('Store lifecycle tests require an isolated Windows CI runner.');
  assert.ok(path.resolve(request.work).startsWith(path.resolve(request.ci.RUNNER_TEMP) + path.sep));
  assert.ok(path.basename(request.work).startsWith('pmcanvas-msix-'));
  for (const key of ['CI', 'GITHUB_ACTIONS', 'GITHUB_RUN_ID', 'RUNNER_TEMP', 'RUNNER_ENVIRONMENT'])
    process.env[key] = request.ci[key];
  app = await electron.launch({ executablePath: request.executable, args: [], timeout: 40000 });
  const runtime = await app.evaluate(({ app }) => ({
    version: app.getVersion(),
    profile: app.getPath('userData'),
    home: app.getPath('home'),
    appData: app.getPath('appData'),
    sessionData: app.getPath('sessionData'),
    store: process.windowsStore === true,
    packaged: app.isPackaged,
  }));
  assert.equal(runtime.packaged, true);
  assert.equal(runtime.version, request.version);
  assert.equal(runtime.store, request.mode !== 'seed');
  const page = await app.firstWindow({ timeout: 20000 });
  page.setDefaultTimeout(20000);
  await page.locator('#content').waitFor();
  if (request.mode === 'seed') {
    const project = legacyProject('Store 전환 데이터 보존', 'Store 설치 전');
    const file = path.join(request.work, 'Documents', 'Preserved.pmcanvas');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, file);
    const saved = await page.evaluate(async (project) => {
      const created = await window.desktop.newProject();
      await window.desktop.replace(project, created.revision);
      return window.desktop.save();
    }, project);
    await page.evaluate(async () => {
      await window.desktop.setTimeZone('America/New_York');
      localStorage.setItem('pmcanvas.language', 'en');
    });
    await app.close();
    app = null;
    const expected = {
      project: saved.project,
      profile: runtime.profile,
      file,
      hashes: [
        file,
        path.join(runtime.profile, 'recovery.json'),
        path.join(runtime.profile, 'preferences.json'),
      ].map((file) => ({
        file,
        sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
      })),
    };
    fs.writeFileSync(request.expected, JSON.stringify(expected));
  } else {
    const expected = JSON.parse(fs.readFileSync(request.expected));
    const firstMigration = !expected.storeProfile;
    assert.equal(runtime.profile, path.join(runtime.home, 'PM Canvas', 'Profile'));
    assert.equal(runtime.sessionData, runtime.profile);
    assert.notEqual(runtime.profile, expected.profile, 'Store must migrate out of AppData.');
    assert.ok(!runtime.profile.startsWith(runtime.appData + path.sep));
    if (expected.storeProfile) assert.equal(runtime.profile, expected.storeProfile);
    await page.waitForFunction(
      () =>
        document.querySelector('[data-project-tab][aria-selected="true"] .project-tab-name')
          ?.textContent === 'Store 전환 데이터 보존',
    );
    assertUpgradedProject(
      (await page.evaluate(() => window.desktop.snapshot())).project,
      expected.project,
    );
    assert.equal(
      (await page.evaluate(() => window.desktop.settings())).timeZone,
      expected.timeZone || 'America/New_York',
    );
    assert.equal(await page.evaluate(() => localStorage.getItem('pmcanvas.language')), 'en');
    if (!expected.storeProfile) {
      // A new Store write, absent from the old EXE profile, must survive servicing.
      await page.evaluate(() => window.desktop.setTimeZone('Europe/London'));
      expected.timeZone = 'Europe/London';
      expected.storeProfile = runtime.profile;
    }
    const updates = await page.evaluate(() => window.desktop.checkUpdates());
    assert.equal(updates.channel, 'microsoft-store');
    assert.equal(updates.url, 'ms-windows-store://downloadsandupdates');
    assert.ok(['current', 'available', 'unsupported', 'error'].includes(updates.status));
    assert.ok(
      ['checked', 'query'].includes(updates.storeCheck),
      'Store discovery must reach the native update query.',
    );
    console.log('Store update discovery: ' + updates.status + ' / ' + updates.storeCheck);
    assert.notEqual(updates.storeCheck, 'runtime', 'WinRT types and helpers must be available.');
    assert.notEqual(
      updates.storeCheck,
      'identity',
      'The Store query subprocess must inherit package identity.',
    );
    // Exercise Excel's utility subprocess in the registered package, using a harmless save dialog stub.
    const file = path.join(request.work, 'Store-report.xlsx');
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, file);
    await page.evaluate(async () => {
      const snapshot = await window.desktop.snapshot();
      await window.desktop.exportReport(
        { kind: 'wbs', at: document.querySelector('#reportDate').value, format: 'xlsx' },
        snapshot.revision,
      );
    });
    for (let i = 0; i < 100 && !fs.existsSync(file); i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(fs.statSync(file).size > 1000, 'Packaged Store Excel export must complete.');
    const originalTab = (await page.evaluate(() => window.desktop.snapshot())).tabId;
    if (firstMigration) {
      const draft = await page.evaluate(
        (project) => window.desktop.newProject(project),
        legacyProject('Store 새 미저장 작업', 'Store에서 새로 생성'),
      );
      assert.equal(draft.dirty, true);
      expected.storeDraft = draft.project;
    } else {
      const snapshot = await page.evaluate(() => window.desktop.snapshot());
      const draftTab = snapshot.tabs.find((tab) => tab.name === expected.storeDraft.name);
      assert.ok(draftTab, 'New unsaved Store work must survive update and reinstall.');
      const draft = await page.evaluate((id) => window.desktop.activateTab(id), draftTab.id);
      assert.equal(draft.dirty, true);
      assert.deepEqual(draft.project, expected.storeDraft);
    }
    await page.evaluate((id) => window.desktop.activateTab(id), originalTab);
    await app.close();
    app = null;
    // Tab migration retains the original single-document recovery and writes a
    // separate workspace. Verify both, then preserve both through servicing.
    const recoveryFile = path.join(runtime.profile, 'workspace.json'),
      hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    for (const entry of expected.hashes)
      assert.equal(
        hash(entry.file),
        entry.sha256,
        'Opening/exporting must preserve original files and the migrated workspace.',
      );
    const recovery = JSON.parse(fs.readFileSync(recoveryFile));
    assert.equal(recovery.version, 1);
    assert.equal(recovery.tabs.length, 2);
    assert.equal(recovery.activeId, recovery.tabs[0].id);
    assertMigratedRecovery(
      recovery.tabs[0].document,
      expected.project,
      expected.file,
      expected.hashes.find((entry) => entry.file === expected.file).sha256,
    );
    assert.deepEqual(recovery.tabs[1].document.project, expected.storeDraft);
    assert.equal(recovery.tabs[1].document.dirty, true);
    assert.equal(recovery.tabs[1].document.file, null);
    for (const file of [
      recoveryFile,
      path.join(runtime.profile, 'recovery.json'),
      path.join(runtime.profile, 'preferences.json'),
    ])
      if (!expected.hashes.some((entry) => entry.file === file))
        expected.hashes.push({ file, sha256: hash(file) });
    fs.writeFileSync(request.expected, JSON.stringify(expected));
  }
  fs.writeFileSync(
    resultFile,
    JSON.stringify({ ok: true, version: runtime.version, store: runtime.store }),
  );
} catch (error) {
  fs.writeFileSync(resultFile, JSON.stringify({ ok: false, error: error.stack }));
  process.exitCode = 1;
} finally {
  if (app) await app.close().catch(() => app.process().kill('SIGKILL'));
}
