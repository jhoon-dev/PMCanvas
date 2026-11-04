import { navigate, nativeCommand, commandIds, answerMessage, appSection } from './ui-actions.mjs';
// Requires desktop's Electron and the repository's Playwright dev dependency.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseDocument } from '../document.mjs';
import { DesktopWorkspace } from '../workspace.mjs';
import { today } from '../app/shared/engine.js';

const require = createRequire(import.meta.url);
const { _electron: electron, expect } = createRequire(
  new URL('../../web/package.json', import.meta.url),
)('@playwright/test');
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
    electron: process.versions.electron,
    node: process.versions.node,
  }));
  assert.equal(
    runtime.electron,
    JSON.parse(readFileSync(path.join(root, 'package.json'))).devDependencies.electron,
  );
  assert.ok(
    runtime.node.localeCompare('24.22.1', undefined, { numeric: true }) >= 0,
    'The bundled Node security baseline must be current.',
  );
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
  await page.locator('img.brand-symbol').evaluate(async (image) => {
    await image.decode();
    if (image.naturalWidth !== 256 || image.naturalHeight !== 256)
      throw Error('The packaged desktop icon did not load.');
  });
  await page.locator('#content [data-command="new"]').waitFor();
  await page.evaluate(() => localStorage.setItem('pmcanvas.language', 'ko'));
  await page.reload();
  checkpoint('language-reload');
  await page.getByRole('button', { name: '새 프로젝트 만들기', exact: true }).waitFor();
  const menus = await application.evaluate(({ Menu }) =>
    Menu.getApplicationMenu().items.map((item) => ({
      label: item.label,
      ids: item.submenu?.items.map((entry) => entry.id).filter(Boolean),
    })),
  );
  assert.deepEqual(
    menus.slice(-4).map((item) => item.label),
    ['파일', '편집', '보기', '도움말'],
  );
  assert.ok(menus.find((item) => item.label === '파일').ids.includes('file-save'));
  assert.ok(menus.find((item) => item.label === '파일').ids.includes('project-settings'));
  assert.ok(menus.find((item) => item.label === '파일').ids.includes('settings-open'));
  assert.ok(menus.find((item) => item.label === '편집').ids.includes('project-undo'));
  assert.ok(menus.find((item) => item.label === '보기').ids.includes('tab-next'));
  assert.equal(await page.locator('.desktop-toolbar,.action-menu').count(), 0);
  assert.deepEqual(
    await application.evaluate(
      ({ Menu }, ids) => ids.filter((id) => !Menu.getApplicationMenu().getMenuItemById(id)),
      Object.values(commandIds),
    ),
    [],
  );
  checkpoint('project-prerequisites');
  await nativeCommand(application, 'appSettings');
  assert.equal(await page.locator('#settingsPage').isVisible(), true);
  await expect
    .poll(() =>
      application.evaluate(({ Menu }) =>
        [
          'file-save',
          'file-save-as',
          'file-close-project',
          'project-settings',
          'file-import-excel',
          'file-export',
          'project-undo',
          'project-redo',
          'tab-next',
          'tab-previous',
        ].every((id) => !Menu.getApplicationMenu().getMenuItemById(id).enabled),
      ),
    )
    .toBe(true);
  assert.equal(await page.locator('#settingsNavigation [data-app-section]').count(), 4);
  assert.equal(await page.locator('.desktop-sidebar #languageSelect').count(), 0);
  await page.locator('#languageSelect').selectOption('en');
  await page.locator('#settingsTitle').filter({ hasText: 'General settings' }).waitFor();
  assert.equal(await page.locator('#settingsPage').isVisible(), true);
  await page.locator('#languageSelect').selectOption('ko');
  await page.locator('#settingsTitle').filter({ hasText: '설정' }).waitFor();
  await appSection(page, 'updates', application);
  await page.locator('#autoCheckUpdates').check();
  await page.waitForFunction(
    async () => (await window.desktop.settings()).checkUpdatesOnStart === true,
  );
  await page.locator('#autoCheckUpdates').uncheck();
  await page.waitForFunction(
    async () => (await window.desktop.settings()).checkUpdatesOnStart === false,
  );
  await page.locator('#settingsBack').click();
  await nativeCommand(application, 'about');
  await page.locator('#settingsTitle').filter({ hasText: '앱 정보' }).waitFor();
  assert.equal(
    await page.locator('#aboutVersion').innerText(),
    JSON.parse(readFileSync(path.join(root, 'package.json'))).version,
  );
  await page.locator('#settingsBack').click();
  const emptySnapshot = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(emptySnapshot.project, null);
  for (const command of ['save', 'saveAs', 'exportWeb', 'exportTemplate'])
    await assert.rejects(
      page.evaluate((name) => window.desktop[name](), command),
      /프로젝트를 먼저/,
    );
  await assert.rejects(
    page.evaluate(() => window.desktop.openExcel(-1)),
    /프로젝트를 먼저/,
  );
  await application.evaluate(({ Menu }) => {
    Menu.getApplicationMenu().getMenuItemById('file-save').click();
  });
  await page.locator('#actionGuideDialog[open]').waitFor();
  assert.equal(
    await page.locator('#actionGuideTitle').innerText(),
    '프로젝트를 먼저 생성해 주세요.',
  );
  await page.locator('#actionGuidePrimary').click();
  await page.locator('#editorDialog[open]').waitFor();
  await page.locator('[name="name"]').fill('취소할 프로젝트');
  await page.locator('#cancelEditor').click();
  assert.deepEqual(await page.evaluate(() => window.desktop.snapshot()), emptySnapshot);
  checkpoint('project-and-reports');
  assert.deepEqual(await page.evaluate(() => [typeof window.require, typeof window.process]), [
    'undefined',
    'undefined',
  ]);
  await application.evaluate(({ dialog }, root) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: root + '/Native.pmcanvas' });
    dialog.showMessageBox = async () => {
      throw Error('Unexpected native message box');
    };
  }, temporary);
  await page.getByRole('button', { name: '새 프로젝트 만들기', exact: true }).click();
  await page.locator('[name="name"]').fill('Native desktop');
  // File commands cannot replace a document while an editor is open.
  await assert.rejects(
    page.evaluate(() => window.desktop.open()),
    /입력창/,
  );
  await assert.rejects(
    page.evaluate((at) => window.desktop.exportReport({ kind: 'wbs', at }, 1), today()),
    /입력창/,
  );
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await nativeCommand(application, 'save');
  await page.waitForFunction(
    async () =>
      !(await window.desktop.snapshot()).dirty &&
      document.querySelector('#content').getAttribute('aria-busy') !== 'true',
  );
  assert.equal(
    parseDocument(readFileSync(path.join(temporary, 'Native.pmcanvas'))).name,
    'Native desktop',
  );
  const originalProject = await page.evaluate(() => window.desktop.snapshot());
  await navigate(page, 'resources');
  assert.equal(await page.locator('#pmManagement h1').innerText(), '투입 계획');
  assert.equal(await page.locator('[data-pm-form="weekly"],[data-pm-form="issue"]').count(), 0);
  await page.locator('[data-view="management"]').click();
  assert.equal(await page.locator('#pmManagement h1').innerText(), '이슈 · 리스크');
  assert.equal(
    await page.locator('[data-pm-form="milestone"],[data-pm-form="staffing"]').count(),
    0,
  );
  await page.locator('[data-view="overview"]').click();
  await page.evaluate(
    (snapshot) =>
      window.desktop.replace(
        { ...snapshot.project, description: '미저장 원본 보존' },
        snapshot.revision,
      ),
    originalProject,
  );
  await nativeCommand(application, 'new');
  await page.locator('#dialogBody [name="name"]').fill('두 번째 프로젝트');
  await page.locator('#submitButton').click();
  await page.waitForFunction(() => !document.querySelector('#editorDialog').open);
  const twoTabs = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(twoTabs.tabs.length, 2);
  await page.locator('[data-project-tab="' + originalProject.tabId + '"]').click();
  const retainedProject = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(retainedProject.project.name, 'Native desktop');
  assert.equal(retainedProject.project.description, '미저장 원본 보존');
  await answerMessage(page, 1, () =>
    page.evaluate((id) => window.desktop.closeProject(id), twoTabs.tabId),
  );
  const afterTabClose = await page.evaluate(() => window.desktop.snapshot());
  await page.evaluate((revision) => window.desktop.undo(revision), afterTabClose.revision);
  assert.deepEqual(
    (await page.evaluate(() => window.desktop.snapshot())).project,
    originalProject.project,
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
  await nativeCommand(application, 'importExcel');
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
  checkpoint('wbs-summary');
  const parentId = imported.project.tasks[0].id;
  await navigate(page, 'planning');
  await page.getByRole('button', { name: '＋ 업무 추가', exact: true }).click();
  await page.locator('[name="name"]').fill('Native child');
  await page.locator('.task-details summary').click();
  await page.locator('[name="parentId"]').selectOption(parentId);
  await page.locator('[name="start"]').fill('2026-10-26');
  await page.locator('[name="end"]').fill('2026-10-30');
  await page.locator('[name="itemTitle"]').fill('Native WBS work');
  await page.getByRole('button', { name: '적용', exact: true }).click();
  const grouped = await page.evaluate(() => window.desktop.snapshot()),
    childId = grouped.project.tasks.find((task) => task.name === 'Native child').id,
    ownWork = grouped.project.tasks.find(
      (task) => task.id !== childId && task.parentId === parentId,
    );
  assert.equal(grouped.project.tasks.length, 3);
  assert.equal(grouped.project.tasks.find((task) => task.id === parentId).kind, 'summary');
  assert.deepEqual(grouped.project.tasks.find((task) => task.id === parentId).items, []);
  assert.deepEqual(ownWork.items, imported.project.tasks[0].items);
  await page.getByRole('button', { name: '기준 계획 저장', exact: true }).click();
  await page.locator('[name="baselineName"]').fill('Native baseline');
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await page.getByText('Native baseline', { exact: true }).waitFor();
  checkpoint('schedule-preview');
  await page.getByRole('button', { name: 'Native child 일정 조정', exact: true }).click();
  await page.locator('#previewSchedule').click();
  // Moving the child also changes the parent's rolled-up end date.
  await page.getByText('변경할 일정 2개 · 아직 적용하지 않았습니다.', { exact: true }).waitFor();
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
  const plannedChild = planned.project.tasks.find((task) => task.id === childId);
  assert.equal(plannedChild.start, '2026-10-27');
  assert.equal(plannedChild.end, '2026-10-31');
  assert.deepEqual(
    planned.project.tasks.find((task) => task.id === ownWork.id),
    ownWork,
  );
  assert.deepEqual(planned.project.baseline, beforeSchedule.project.baseline);
  assert.equal(plannedChild.parentId, parentId);
  assert.equal(planned.project.tasks.find((task) => task.id === parentId).end, plannedChild.end);
  assert.equal(planned.project.baseline.tasks.length, 3);
  await assert.rejects(
    page.evaluate((revision) => window.desktop.undo(revision - 1), planned.revision),
    /문서가 변경/,
  );
  await nativeCommand(application, 'undo');
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
  checkpoint('bulk-copy-delete');
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
  assert.equal(copied.project.tasks.length, planned.project.tasks.length * 2);
  const copiedTasks = copied.project.tasks.filter(
    (task) => !planned.project.tasks.some((old) => old.id === task.id),
  );
  const copiedParent = copiedTasks.find((task) => task.kind === 'summary');
  assert.equal(copiedTasks.length, 3);
  assert.deepEqual(copiedParent.items, []);
  assert.ok(
    copiedTasks
      .filter((task) => task.id !== copiedParent.id)
      .every((task) => task.parentId === copiedParent.id),
  );
  await nativeCommand(application, 'undo');
  await page.getByText('프로젝트 변경을 되돌렸습니다.', { exact: true }).waitFor();
  assert.deepEqual((await page.evaluate(() => window.desktop.snapshot())).project, planned.project);
  await nativeCommand(application, 'redo');
  await page.getByText('프로젝트 변경을 다시 실행했습니다.', { exact: true }).waitFor();
  await page.locator('[data-select-task="' + copiedParent.id + '"]').check();
  await page.getByRole('button', { name: '선택 삭제', exact: true }).click();
  await page.getByRole('button', { name: '선택 업무 삭제', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#editorDialog').open);
  const removed = (await page.evaluate(() => window.desktop.snapshot())).project;
  assert.equal(removed.tasks.length, copied.project.tasks.length - 1);
  for (const task of copiedTasks.filter((task) => task.id !== copiedParent.id)) {
    const preserved = removed.tasks.find((row) => row.id === task.id);
    assert.deepEqual(preserved.items, task.items);
    assert.ok(!preserved.parentId);
  }
  await nativeCommand(application, 'undo');
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
  await nativeCommand(application, 'updates');
  await page.locator('#checkUpdates').click();
  await page.getByText('새 버전: 0.99.0', { exact: false }).waitFor();
  assert.equal(await application.evaluate(() => globalThis.__releasePages.length), 0);
  await page.locator('#openRelease').click();
  await page.locator('#settingsBack').click();
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
  checkpoint('privacy-policy');
  const beforePrivacy = await page.evaluate(() => window.desktop.snapshot());
  await nativeCommand(application, 'privacy');
  await expect
    .poll(() => application.evaluate(() => globalThis.__releasePages))
    .toEqual([
      'https://github.com/jhoon-dev/PMCanvas/releases/tag/desktop-v0.99.0',
      'https://github.com/jhoon-dev/PMCanvas/blob/main/desktop/PRIVACY.md',
    ]);
  assert.deepEqual(await page.evaluate(() => window.desktop.snapshot()), beforePrivacy);
  assert.deepEqual((await page.evaluate(() => window.desktop.snapshot())).project, finalProject);
  await application.evaluate(({ shell }) => {
    process.getBuiltinModule('https').get = globalThis.__updateRequest;
    shell.openExternal = globalThis.__updateShell;
  });
  const info = await page.evaluate(() => window.desktop.info());
  assert.equal(info.version, JSON.parse(readFileSync(path.join(root, 'package.json'))).version);
  assert.equal(info.displayName, 'PM Canvas');
  assert.equal(info.developer, 'jhoon-dev');
  assert.equal(info.brand, 'Toolmoa');
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
  await restored.waitForFunction(
    async () =>
      !(await window.desktop.snapshot()).dirty &&
      document.querySelector('#content').getAttribute('aria-busy') !== 'true',
  );
  await navigate(restored, 'planning');
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
  checkpoint('damaged-preferences');
  const savedProjectFile = readFileSync(path.join(temporary, 'Native.pmcanvas'));
  for (const corrupted of [
    '{invalid JSON',
    JSON.stringify({ timeZone: 'Bad/Zone', checkUpdatesOnStart: false }),
  ]) {
    await application.close();
    writeFileSync(path.join(temporary, 'preferences.json'), corrupted);
    application = await launch();
    const recovered = await application.firstWindow({ timeout: 15000 });
    await recovered.getByText('Native desktop', { exact: true }).first().waitFor();
    const settings = await recovered.evaluate(() => window.desktop.settings());
    assert.equal(settings.timeZone, 'Asia/Seoul');
    assert.equal(settings.checkUpdatesOnStart, false);
    assert.equal(settings.recovery.backupCreated, true);
    assert.deepEqual(
      (await recovered.evaluate(() => window.desktop.snapshot())).project,
      finalProject,
    );
    assert.equal(readFileSync(path.join(temporary, 'preferences.json'), 'utf8'), corrupted);
    assert.deepEqual(readFileSync(path.join(temporary, 'Native.pmcanvas')), savedProjectFile);
    await nativeCommand(application, 'appSettings');
    assert.equal(await recovered.locator('#settingsRecovery').isVisible(), true);
    await recovered.locator('#settingsBack').click();
  }
  checkpoint('close-project');
  const closePage = await application.firstWindow();
  await application.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => {
      throw Error('Unexpected native message box');
    };
  });
  await nativeCommand(application, 'projectSettings');
  const editingSnapshot = await closePage.evaluate(() => window.desktop.snapshot());
  await assert.rejects(
    closePage.evaluate(() => window.desktop.closeProject()),
    /입력창/,
  );
  assert.deepEqual(await closePage.evaluate(() => window.desktop.snapshot()), editingSnapshot);
  await closePage.locator('#cancelEditor').click();
  const originalBytes = readFileSync(path.join(temporary, 'Native.pmcanvas'));
  await closePage.evaluate(
    (snapshot) =>
      window.desktop.replace(
        { ...snapshot.project, description: '취소할 닫기 변경' },
        snapshot.revision,
      ),
    editingSnapshot,
  );
  const dirtyBeforeClose = await closePage.evaluate(() => window.desktop.snapshot());
  await answerMessage(closePage, 2, () => nativeCommand(application, 'closeProject'));
  await closePage.waitForFunction(() => !document.querySelector('#content').inert);
  assert.deepEqual(await closePage.evaluate(() => window.desktop.snapshot()), dirtyBeforeClose);
  await answerMessage(closePage, 1, () => nativeCommand(application, 'closeProject'));
  await closePage.locator('#content [data-command="new"]').waitFor();
  assert.equal((await closePage.evaluate(() => window.desktop.snapshot())).project, null);
  assert.deepEqual(readFileSync(path.join(temporary, 'Native.pmcanvas')), originalBytes);
  assert.equal(
    await application.evaluate(
      ({ Menu }) => Menu.getApplicationMenu().getMenuItemById('project-undo').enabled,
    ),
    false,
  );
  await application.evaluate(
    ({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    },
    path.join(temporary, 'Native.pmcanvas'),
  );
  await closePage.locator('#content [data-command="open"]').click();
  await closePage.locator('[data-project-tab]').waitFor();
  await answerMessage(closePage, 0, () =>
    closePage.evaluate(async () => {
      const snapshot = await window.desktop.snapshot();
      await window.desktop.replace(
        { ...snapshot.project, description: '저장하고 닫은 변경' },
        snapshot.revision,
      );
      await window.desktop.closeProject();
    }),
  );
  await closePage.locator('#content [data-command="new"]').waitFor();
  assert.equal(
    parseDocument(readFileSync(path.join(temporary, 'Native.pmcanvas'))).description,
    '저장하고 닫은 변경',
  );
  await closePage.evaluate(() =>
    window.desktop.newProject({
      name: '파일 저장 취소 검증',
      description: '',
      holidays: [],
      members: [],
      tasks: [],
    }),
  );
  await application.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true });
  });
  const unsavedBeforeClose = await closePage.evaluate(() => window.desktop.snapshot());
  assert.equal(
    await answerMessage(closePage, 0, () =>
      closePage.evaluate(() => window.desktop.closeProject()),
    ),
    null,
  );
  assert.deepEqual(await closePage.evaluate(() => window.desktop.snapshot()), unsavedBeforeClose);
  await answerMessage(closePage, 1, () => closePage.evaluate(() => window.desktop.closeProject()));
  await closePage.locator('#content [data-command="new"]').waitFor();
  await application.close();
  application = await launch();
  const closedRestart = await application.firstWindow();
  await closedRestart.locator('#content [data-command="new"]').waitFor();
  assert.equal((await closedRestart.evaluate(() => window.desktop.snapshot())).project, null);
  await closedRestart.locator('[data-view="tasks"]').click();
  await closedRestart.locator('#actionGuideDialog[open]').waitFor();
  await closedRestart.locator('#actionGuideCancel').click();
  checkpoint('custom-recovery-dialog');
  await application.close();
  const recoveryDocument = new DesktopWorkspace(path.join(temporary, 'workspace.json'));
  recoveryDocument.create({
    name: '미저장 복구 확인',
    description: '',
    holidays: [],
    members: [],
    tasks: [],
  });
  application = await launch();
  const dirtyRecovery = await application.firstWindow();
  await dirtyRecovery.locator('#messageDialog[open]').waitFor();
  assert.match(
    await dirtyRecovery.locator('#messageText').innerText(),
    /저장하지 않은 프로젝트 탭을 복구/,
  );
  await dirtyRecovery.locator('#messageDialog [data-response="0"]').click();
  await dirtyRecovery.getByText('미저장 복구 확인', { exact: true }).first().waitFor();
  assert.equal((await dirtyRecovery.evaluate(() => window.desktop.snapshot())).dirty, true);
  await answerMessage(dirtyRecovery, 1, () => nativeCommand(application, 'closeProject'));
  await dirtyRecovery.locator('#content [data-command="new"]').waitFor();
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
