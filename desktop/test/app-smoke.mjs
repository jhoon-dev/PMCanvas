// Requires desktop's Electron and the repository's Playwright dev dependency.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseDocument } from '../document.mjs';
import { today } from '../app/shared/engine.js';

const require = createRequire(import.meta.url);
const { _electron: electron } = createRequire(new URL('../../web/package.json', import.meta.url))(
  '@playwright/test',
);
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const installed = process.argv[2] === '--installed';
if (installed && !process.argv[3])
  throw Error('--installed requires the installed executable path.');
const appPath = !installed && process.argv[2] ? path.resolve(process.argv[2]) : root;
const temporary = mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-electron-'));
// Packaged apps honor this real preference as well; no startup outbound network in fixtures.
writeFileSync(
  path.join(temporary, 'preferences.json'),
  JSON.stringify({ timeZone: 'Asia/Seoul', checkUpdatesOnStart: false }),
);
let application;
let completed = false;
let stage = 'launch';
const watchdog = setTimeout(() => {
  console.error('Native smoke timed out at stage: ' + stage);
  application?.process().kill('SIGKILL');
  setTimeout(() => process.exit(1), 2000);
}, 240000);
watchdog.unref();
const checkpoint = (name) => {
  stage = name;
  console.log('Native smoke: ' + name);
};
const launch = () =>
  electron.launch({
    executablePath: installed ? path.resolve(process.argv[3]) : require('electron'),
    args: installed ? ['--user-data-dir=' + temporary] : [appPath],
    timeout: 30000,
    env: { ...process.env, PMCANVAS_DESKTOP_TEST: '1', PMCANVAS_DESKTOP_DATA: temporary },
  });
try {
  console.log('Native smoke: launch');
  application = await launch();
  console.log('Native smoke: connected');
  application.process().stderr?.on('data', (data) => process.stderr.write(data));
  const runtime = await application.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    userData: app.getPath('userData'),
  }));
  assert.equal(
    realpathSync(runtime.userData),
    realpathSync(temporary),
    'Tests must use an isolated user profile.',
  );
  if (installed)
    assert.equal(runtime.packaged, true, 'Installed executable must run as a packaged app.');
  const page = await application.firstWindow({ timeout: 15000 });
  console.log('Native smoke: window');
  page.setDefaultTimeout(15000);
  await page.waitForLoadState('load');
  console.log('Native smoke: loaded');
  checkpoint('initial-content');
  await page.locator('#content [data-command="new"]').waitFor();
  await page.evaluate(() => localStorage.setItem('pmcanvas.language', 'ko'));
  await page.reload();
  checkpoint('language-reload');
  await page.getByRole('button', { name: '새 프로젝트 만들기', exact: true }).waitFor();
  checkpoint('project-and-reports');
  assert.deepEqual(await page.evaluate(() => [typeof window.require, typeof window.process]), [
    'undefined',
    'undefined',
  ]);
  await application.evaluate(({ dialog }, root) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: root + '/Native.pmcanvas' });
    dialog.showMessageBox = async () => ({ response: 2 });
  }, temporary);
  await page.getByRole('button', { name: '새 프로젝트 만들기', exact: true }).click();
  await page.locator('[name="name"]').fill('Native desktop');
  // File commands cannot replace a document while an editor is open.
  assert.equal(await page.evaluate(() => window.desktop.open()), null);
  await assert.rejects(
    page.evaluate((at) => window.desktop.exportReport({ kind: 'wbs', at }, 1), today()),
    /입력창/,
  );
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByText('파일에 저장됨', { exact: true }).waitFor();
  assert.equal(
    parseDocument(readFileSync(path.join(temporary, 'Native.pmcanvas'))).name,
    'Native desktop',
  );
  const inaccessible = await application.evaluate(async ({ net }) => {
    const response = await net.fetch('pmcanvas://desktop/model/project.mjs');
    return response.status;
  });
  assert.equal(inaccessible, 404);
  const before = await page.evaluate(() => window.desktop.snapshot());
  await application.evaluate(({ dialog }, root) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: root + '/Report' });
  }, temporary);
  await assert.rejects(
    page.evaluate(
      ({ at, revision }) => window.desktop.exportReport({ kind: 'wbs', at }, revision - 1),
      { at: today(), revision: before.revision },
    ),
    /문서가 변경/,
  );
  assert.equal(
    await page.evaluate(
      ({ at, revision }) => window.desktop.exportReport({ kind: 'wbs', at }, revision),
      { at: today(), revision: before.revision },
    ),
    true,
  );
  assert.ok(
    readFileSync(path.join(temporary, 'Report.csv'), 'utf8').startsWith('\uFEFF"프로젝트"'),
  );
  assert.deepEqual(await page.evaluate(() => window.desktop.snapshot()), before);
  await application.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true });
  });
  assert.equal(
    await page.evaluate(
      ({ at, revision }) => window.desktop.exportReport({ kind: 'wbs', at }, revision),
      { at: today(), revision: before.revision },
    ),
    false,
  );
  assert.deepEqual(await page.evaluate(() => window.desktop.snapshot()), before);
  await application.evaluate(({ dialog }, root) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: root + '/Workbook' });
  }, temporary);
  assert.equal(
    await page.evaluate(
      ({ at, revision }) =>
        window.desktop.exportReport({ kind: 'wbs', at, format: 'xlsx' }, revision),
      { at: today(), revision: before.revision },
    ),
    true,
  );
  const workbook = new ExcelJS.Workbook();
  checkpoint('excel');
  await workbook.xlsx.readFile(path.join(temporary, 'Workbook.xlsx'));
  assert.ok(workbook.getWorksheet('WBS'));
  assert.deepEqual(await page.evaluate(() => window.desktop.snapshot()), before);
  await application.evaluate(({ dialog }, root) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: root + '/Template.xlsx' });
  }, temporary);
  assert.equal(
    await page.evaluate((revision) => window.desktop.exportTemplate(revision), before.revision),
    true,
  );
  await workbook.xlsx.readFile(path.join(temporary, 'Template.xlsx'));
  workbook.getWorksheet('WBS').getRow(2).values = [
    'Native Excel import',
    '',
    new Date('2026-10-26'),
    new Date('2026-10-30'),
    8,
  ];
  const input = Buffer.from(await workbook.xlsx.writeBuffer());
  writeFileSync(path.join(temporary, 'Input.xlsx'), input);
  await application.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root + '/Input.xlsx'] });
  }, temporary);
  if (!(await page.locator('details.action-menu').evaluate((menu) => menu.open)))
    await page.getByText('파일 옵션', { exact: true }).click();
  await page.getByRole('button', { name: 'Excel 가져오기', exact: true }).click();
  await page.locator('#excelPreview').click();
  await page.getByText('1개 업무 · 오류 0건', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.desktop.snapshot()), before);
  await page.locator('#excelApply').click();
  await page.locator('#excelApply').waitFor({ state: 'detached' });
  const imported = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(imported.project.tasks.length, 1);
  assert.equal(imported.dirty, true);
  assert.equal(
    parseDocument(readFileSync(path.join(temporary, 'Native.pmcanvas'))).tasks.length,
    0,
  );
  assert.deepEqual(readFileSync(path.join(temporary, 'Input.xlsx')), input);
  await page.getByRole('button', { name: 'WBS · 기준 계획', exact: true }).click();
  await page.getByRole('button', { name: '＋ 업무 추가', exact: true }).click();
  await page.locator('[name="name"]').fill('Native child');
  await page.locator('[name="parentId"]').selectOption(imported.project.tasks[0].id);
  await page.locator('[name="itemTitle"]').fill('Native WBS work');
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await page.getByRole('button', { name: '기준 계획 저장', exact: true }).click();
  await page.locator('[name="baselineName"]').fill('Native baseline');
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await page.getByText('Native baseline', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Native child 일정 조정', exact: true }).click();
  await page.locator('#previewSchedule').click();
  await page.getByText('변경할 일정 1개 · 아직 적용하지 않았습니다.', { exact: true }).waitFor();
  const beforeSchedule = await page.evaluate(() => window.desktop.snapshot());
  // Simulate a native document update while the schedule preview is open.
  await page.evaluate(
    (snapshot) => window.desktop.replace(snapshot.project, snapshot.revision),
    beforeSchedule,
  );
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await page.locator('#formError').filter({ hasText: '미리보기' }).waitFor();
  assert.deepEqual(
    (await page.evaluate(() => window.desktop.snapshot())).project,
    beforeSchedule.project,
  );
  await page.locator('#previewSchedule').click();
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#editorDialog').open);
  const planned = await page.evaluate(() => window.desktop.snapshot());
  assert.notEqual(planned.project.tasks[1].start, beforeSchedule.project.tasks[1].start);
  assert.deepEqual(planned.project.baseline, beforeSchedule.project.baseline);
  assert.equal(planned.project.tasks[1].parentId, planned.project.tasks[0].id);
  assert.equal(planned.project.baseline.tasks.length, 2);
  await assert.rejects(
    page.evaluate((revision) => window.desktop.undo(revision - 1), planned.revision),
    /문서가 변경/,
  );
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await page.getByText('프로젝트 변경을 되돌렸습니다.', { exact: true }).waitFor();
  assert.deepEqual(
    (await page.evaluate(() => window.desktop.snapshot())).project,
    beforeSchedule.project,
  );
  assert.equal(
    await application.evaluate(
      ({ Menu }) => Menu.getApplicationMenu().getMenuItemById('project-redo').enabled,
    ),
    true,
  );
  await application.evaluate(({ Menu }) =>
    Menu.getApplicationMenu().getMenuItemById('project-redo').click(),
  );
  await page.getByText('프로젝트 변경을 다시 실행했습니다.', { exact: true }).waitFor();
  assert.deepEqual((await page.evaluate(() => window.desktop.snapshot())).project, planned.project);
  await page.getByRole('button', { name: 'Native child', exact: true }).click();
  await assert.rejects(
    page.evaluate(async () => {
      const current = await window.desktop.snapshot();
      return window.desktop.undo(current.revision);
    }),
    /입력창/,
  );
  assert.equal(
    await application.evaluate(
      ({ Menu }) => Menu.getApplicationMenu().getMenuItemById('project-undo').enabled,
    ),
    false,
  );
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await page.locator('[data-select-visible]').check();
  await page.getByRole('button', { name: '선택 복제', exact: true }).click();
  await page.evaluate(async () => {
    const snapshot = await window.desktop.snapshot();
    await window.desktop.replace(snapshot.project, snapshot.revision);
  });
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await page.locator('#formError').filter({ hasText: '문서가 변경' }).waitFor();
  assert.deepEqual((await page.evaluate(() => window.desktop.snapshot())).project, planned.project);
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await page.getByRole('button', { name: '선택 복제', exact: true }).click();
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#editorDialog').open);
  const copied = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(copied.project.tasks.length, 4);
  const copiedTasks = copied.project.tasks.filter(
    (task) => !planned.project.tasks.some((old) => old.id === task.id),
  );
  assert.equal(copiedTasks[1].parentId, copiedTasks[0].id);
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await page.getByText('프로젝트 변경을 되돌렸습니다.', { exact: true }).waitFor();
  assert.deepEqual((await page.evaluate(() => window.desktop.snapshot())).project, planned.project);
  await page.getByRole('button', { name: '다시 실행', exact: true }).click();
  await page.getByText('프로젝트 변경을 다시 실행했습니다.', { exact: true }).waitFor();
  await page.locator('[data-select-task="' + copiedTasks[0].id + '"]').check();
  await page.getByRole('button', { name: '선택 삭제', exact: true }).click();
  await page.getByRole('button', { name: '선택 업무 삭제', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#editorDialog').open);
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).project.tasks.length, 3);
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await page.getByText('프로젝트 변경을 되돌렸습니다.', { exact: true }).waitFor();
  const finalProject = (await page.evaluate(() => window.desktop.snapshot())).project;
  checkpoint('final-save-and-language');
  assert.deepEqual(finalProject, copied.project);
  await page.evaluate(() => window.desktop.save());
  checkpoint('manual-update-notice');
  await application.evaluate(({ shell }) => {
    const https = process.getBuiltinModule('https'),
      { EventEmitter } = process.getBuiltinModule('events');
    globalThis.__updateRequest = https.get;
    globalThis.__updateShell = shell.openExternal;
    globalThis.__releasePages = [];
    https.get = (_url, _options, callback) => {
      const req = new EventEmitter();
      req.destroy = (error) => {
        req.emit('error', error);
        req.emit('close');
      };
      queueMicrotask(() => {
        const res = new EventEmitter();
        res.statusCode = 200;
        callback(res);
        const tag = 'desktop-v0.99.0';
        res.emit(
          'data',
          Buffer.from(
            JSON.stringify([
              {
                tag_name: tag,
                html_url: 'https://github.com/jhoon-dev/PMCanvas/releases/tag/' + tag,
                assets: [],
                draft: false,
                prerelease: false,
              },
            ]),
          ),
        );
        res.emit('end');
        req.emit('close');
      });
      return req;
    };
    shell.openExternal = async (url) => {
      globalThis.__releasePages.push(url);
    };
  });
  if (!(await page.locator('details.action-menu').evaluate((menu) => menu.open)))
    await page.getByText('파일 옵션', { exact: true }).click();
  await page.getByRole('button', { name: '앱 설정', exact: true }).click();
  await page.locator('#checkUpdates').click();
  await page.getByText('새 버전: 0.99.0', { exact: false }).waitFor();
  assert.equal(await application.evaluate(() => globalThis.__releasePages.length), 0);
  await page.locator('#openRelease').click();
  await page.locator('#closeUpdate').click();
  assert.equal((await page.evaluate(() => window.desktop.settings())).checkUpdatesOnStart, false);
  await page.evaluate(() => window.desktop.setUpdatePreference(true));
  assert.equal((await page.evaluate(() => window.desktop.settings())).checkUpdatesOnStart, true);
  await assert.rejects(page.evaluate(() => window.desktop.setUpdatePreference('false')));
  await assert.rejects(
    page.evaluate(() => window.desktop.applyUpdate()),
    /Download|다운로드/,
  );
  await page.evaluate(async () => {
    const snapshot = await window.desktop.snapshot();
    await window.desktop.replace(
      { ...snapshot.project, description: 'Temporary update guard check' },
      snapshot.revision,
    );
  });
  await assert.rejects(
    page.evaluate(() => window.desktop.applyUpdate()),
    /저장|취소/,
  );
  await page.evaluate(async () => window.desktop.undo((await window.desktop.snapshot()).revision));
  assert.deepEqual((await page.evaluate(() => window.desktop.snapshot())).project, finalProject);
  assert.deepEqual(await application.evaluate(() => globalThis.__releasePages), [
    'https://github.com/jhoon-dev/PMCanvas/releases/tag/desktop-v0.99.0',
  ]);
  assert.deepEqual((await page.evaluate(() => window.desktop.snapshot())).project, finalProject);
  await application.evaluate(({ shell }) => {
    process.getBuiltinModule('https').get = globalThis.__updateRequest;
    shell.openExternal = globalThis.__updateShell;
  });
  const info = await page.evaluate(() => window.desktop.info());
  assert.equal(info.version, JSON.parse(readFileSync(path.join(root, 'package.json'))).version);
  await assert.rejects(
    page.evaluate(() => window.desktop.setLanguage('invalid')),
    /언어/,
  );
  await page.evaluate(() => window.desktop.editing(true));
  await assert.rejects(
    page.evaluate(() => window.desktop.applyUpdate()),
    /저장|입력/,
  );
  await assert.rejects(
    page.evaluate(() => window.desktop.setLanguage('en')),
    /언어/,
  );
  await page.evaluate(() => window.desktop.editing(false));
  await page.evaluate(() => window.desktop.setLanguage('en'));
  assert.equal(
    await application.evaluate(
      ({ Menu }) => Menu.getApplicationMenu().getMenuItemById('project-undo').label,
    ),
    'Undo project change',
  );
  await application.evaluate(({ dialog }, root) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: root + '/English.csv' });
  }, temporary);
  await page.evaluate(async (at) => {
    const snapshot = await window.desktop.snapshot();
    await window.desktop.exportReport({ kind: 'wbs', at, format: 'csv' }, snapshot.revision);
  }, today());
  assert.ok(
    readFileSync(path.join(temporary, 'English.csv'), 'utf8').startsWith(
      '\uFEFF"Project","Reporting date"',
    ),
  );
  await page.evaluate(() => window.desktop.setLanguage('ko'));
  checkpoint('business-time-zone');
  await assert.rejects(
    page.evaluate(() => window.desktop.setTimeZone('Bad/Zone')),
    /IANA/,
  );
  await page.evaluate(() => window.desktop.editing(true));
  await assert.rejects(
    page.evaluate(() => window.desktop.setTimeZone('UTC')),
    /저장|취소/,
  );
  await page.evaluate(() => window.desktop.editing(false));
  const beforeZone = await page.evaluate(() => window.desktop.snapshot());
  await page.evaluate(() => window.desktop.setTimeZone('Pacific/Kiritimati'));
  assert.deepEqual(
    (await page.evaluate(() => window.desktop.snapshot())).project,
    beforeZone.project,
  );
  assert.equal(
    parseDocument(readFileSync(path.join(temporary, 'Native.pmcanvas'))).tasks[0].name,
    'Native Excel import',
  );
  const savedPreferences = JSON.parse(readFileSync(path.join(temporary, 'preferences.json')));
  assert.equal(savedPreferences.checkUpdatesOnStart, true);
  assert.equal(savedPreferences.timeZone, 'Pacific/Kiritimati');
  await page.evaluate(() => window.desktop.setUpdatePreference(false));
  await application.close();
  checkpoint('restart');
  application = await launch();
  const restored = await application.firstWindow({ timeout: 15000 });
  restored.setDefaultTimeout(15000);
  await restored.getByText('Native desktop', { exact: true }).first().waitFor();
  await restored.getByText('파일에 저장됨', { exact: true }).waitFor();
  await restored.getByRole('button', { name: 'WBS · 기준 계획', exact: true }).click();
  await restored.getByText('Native baseline', { exact: true }).waitFor();
  await restored.getByRole('button', { name: 'Native child', exact: true }).waitFor();
  const afterRestart = await restored.evaluate(() => window.desktop.snapshot());
  assert.equal(
    (await restored.evaluate(() => window.desktop.settings())).timeZone,
    'Pacific/Kiritimati',
  );
  assert.deepEqual(afterRestart.project, finalProject);
  assert.equal(
    (await restored.evaluate(() => window.desktop.settings())).checkUpdatesOnStart,
    false,
  );
  assert.equal(afterRestart.canUndo, false);
  assert.equal(afterRestart.canRedo, false);
  console.log(
    'PASS: native isolation, reports, WBS, schedule, history/menu, bulk copy/delete/revision guard, save/restart',
  );
  completed = true;
} catch (error) {
  console.error('Native smoke failed at stage: ' + stage, error.stack || error.message);
  throw error;
} finally {
  // Failed tests can leave a temporary unsaved editor open; do not hang on its close prompt.
  if (application && !completed) {
    await Promise.race([
      application.evaluate(({ app }) => app.exit(0)).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    const child = application.process();
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGKILL');
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
    }
  }
  if (completed) await application?.close();
  clearTimeout(watchdog);
  if (
    path.dirname(temporary) !== path.resolve(os.tmpdir()) ||
    !path.basename(temporary).startsWith('pmcanvas-electron-')
  )
    throw Error('Unsafe temporary cleanup path.');
  try {
    rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {
    console.warn('Temporary test profile remains locked; original test result preserved.');
  }
}
