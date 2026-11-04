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
    assert.equal(
      runtime.profile,
      expected.profile,
      'MSIX must reuse the legacy application profile.',
    );
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
      'America/New_York',
    );
    assert.equal(await page.evaluate(() => localStorage.getItem('pmcanvas.language')), 'en');
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
    assert.equal(recovery.tabs.length, 1);
    assert.equal(recovery.activeId, recovery.tabs[0].id);
    assertMigratedRecovery(
      recovery.tabs[0].document,
      expected.project,
      expected.file,
      expected.hashes.find((entry) => entry.file === expected.file).sha256,
    );
    if (!expected.hashes.some((entry) => entry.file === recoveryFile))
      expected.hashes.push({ file: recoveryFile, sha256: hash(recoveryFile) });
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
