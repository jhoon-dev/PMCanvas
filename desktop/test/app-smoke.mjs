// Requires desktop's Electron and the repository's Playwright dev dependency.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
let application;
const launch = () =>
  electron.launch({
    executablePath: installed ? path.resolve(process.argv[3]) : require('electron'),
    args: installed ? ['--user-data-dir=' + temporary] : [appPath],
    timeout: 30000,
    env: { ...process.env, PMCANVAS_DESKTOP_TEST: '1', PMCANVAS_DESKTOP_DATA: temporary },
  });
try {
  application = await launch();
  const runtime = await application.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    userData: app.getPath('userData'),
  }));
  assert.equal(
    path.resolve(runtime.userData),
    temporary,
    'Tests must use an isolated user profile.',
  );
  if (installed)
    assert.equal(runtime.packaged, true, 'Installed executable must run as a packaged app.');
  const page = await application.firstWindow({ timeout: 15000 });
  page.setDefaultTimeout(15000);
  await page.getByRole('button', { name: '새 프로젝트 만들기', exact: true }).waitFor();
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
  await page.evaluate(() => window.desktop.save());
  assert.equal(
    parseDocument(readFileSync(path.join(temporary, 'Native.pmcanvas'))).tasks[0].name,
    'Native Excel import',
  );
  await application.close();
  application = await launch();
  const restored = await application.firstWindow({ timeout: 15000 });
  restored.setDefaultTimeout(15000);
  await restored.getByText('Native desktop', { exact: true }).first().waitFor();
  await restored.getByText('파일에 저장됨', { exact: true }).waitFor();
  console.log(
    'PASS: native isolation, file save, protocol boundary, CSV/XLSX save, template, preview/import, source preservation, restart',
  );
} finally {
  await application?.close();
  rmSync(temporary, { recursive: true, force: true });
}
