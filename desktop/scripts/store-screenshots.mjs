import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { screenProject } from '../../web/test/support/screen-fixtures.mjs';

if (process.platform !== 'darwin') throw Error('Capture Mac Store screenshots on macOS.');
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { _electron: electron } = createRequire(new URL('../../web/package.json', import.meta.url))(
  '@playwright/test',
);
const temporary = mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-store-screenshots-'));
const output = path.join(root, 'test-results/mac-store-screenshots');
mkdirSync(output, { recursive: true });
writeFileSync(
  path.join(temporary, 'preferences.json'),
  JSON.stringify({ timeZone: 'Asia/Seoul', checkUpdatesOnStart: false }),
);
let application;
const timeout = setTimeout(() => application?.process().kill('SIGKILL'), 120000);
try {
  application = await electron.launch({
    executablePath: require('electron'),
    args: [root, '--user-data-dir=' + temporary],
    env: { ...process.env, PMCANVAS_DESKTOP_TEST: '1', PMCANVAS_DESKTOP_DATA: temporary },
  });
  const page = await application.firstWindow();
  await page.waitForLoadState('load');
  await page.evaluate(() => localStorage.setItem('pmcanvas.language', 'ko'));
  await page.reload();
  await page.locator('#content [data-command="new"]').waitFor();
  await application.evaluate(({ BrowserWindow, dialog }, folder) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 900);
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath: folder + '/Sample.pmcanvas',
    });
  }, temporary);
  const project = screenProject();
  project.name = '고객 포털 리뉴얼';
  project.description = '기획과 개발 일정을 함께 관리하는 예제 프로젝트';
  delete project._role;
  delete project._revision;
  await page.evaluate(async (sample) => {
    await window.desktop.newProject();
    const state = await window.desktop.snapshot();
    await window.desktop.replace(sample, state.revision);
    await window.desktop.save();
  }, project);
  await page.getByText(project.name, { exact: true }).first().waitFor();
  assert.deepEqual(await page.evaluate(() => [innerWidth, innerHeight]), [1440, 900]);
  for (const view of ['overview', 'planning', 'tasks', 'people']) {
    await page.locator(`[data-view="${view}"]`).click();
    await page.locator(`[data-view="${view}"][aria-current="page"]`).waitFor();
    await page.screenshot({ path: path.join(output, 'PMCanvas-Mac-' + view + '.png') });
  }
  writeFileSync(
    path.join(output, 'screenshots.json'),
    JSON.stringify(
      {
        platform: process.platform,
        width: 1440,
        height: 900,
        syntheticSampleData: true,
        source: 'Actual Electron app on macOS; shared interface with MAS build',
        sandboxRuntimeVerified: false,
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Captured four Mac app screenshots using an isolated sample project.');
} finally {
  clearTimeout(timeout);
  if (application) await application.close();
  rmSync(temporary, { recursive: true, force: true });
}
