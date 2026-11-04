import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { DesktopDocument } from '../document.mjs';
import { answerMessage, nativeCommand } from './ui-actions.mjs';
const require = createRequire(import.meta.url);
const { _electron: electron } = createRequire(new URL('../../web/package.json', import.meta.url))(
  '@playwright/test',
);
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const temporary = mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-tab-native-'));
writeFileSync(
  path.join(temporary, 'preferences.json'),
  JSON.stringify({ timeZone: 'Asia/Seoul', checkUpdatesOnStart: false }),
);
const project = (name) => ({
  id: 'equal-id',
  name,
  description: '',
  holidays: [],
  members: [],
  tasks: [],
});
const savedC = new DesktopDocument(path.join(temporary, 'fixture-recovery.json'));
savedC.create(project('C · 기존 파일'));
savedC.save(path.join(temporary, 'C.pmcanvas'));
let application,
  page,
  complete = false;
const launch = async () => {
  console.log('Tabs smoke: launch');
  application = await electron.launch({
    executablePath: require('electron'),
    args: [root],
    env: { ...process.env, PMCANVAS_DESKTOP_TEST: '1', PMCANVAS_DESKTOP_DATA: temporary },
    timeout: 30000,
  });
  page = await application.firstWindow();
  page.setDefaultTimeout(12000);
  await page.waitForLoadState('load');
};
const snapshot = () => page.evaluate(() => window.desktop.snapshot());
const activate = async (id) => {
  await page.locator('[data-project-tab="' + id + '"]').click();
  await page.waitForFunction(
    (value) => document.querySelector('[aria-selected="true"]').dataset.projectTab === value,
    id,
  );
};
const edit = (description) =>
  page.evaluate(async (description) => {
    const s = await window.desktop.snapshot();
    return window.desktop.replace({ ...s.project, description }, s.revision);
  }, description);
const save = async (name) => {
  await application.evaluate(
    ({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    },
    path.join(temporary, name + '.pmcanvas'),
  );
  await page.evaluate(() => window.desktop.save());
};
const watchdog = setTimeout(() => application?.process().kill('SIGKILL'), 240000);
watchdog.unref();
try {
  await launch();
  await page.locator('#content [data-command="new"]').waitFor();
  await page.evaluate(() => localStorage.setItem('pmcanvas.language', 'ko'));
  await page.reload();
  await page.locator('#content [data-command="new"]').click();
  await page.locator('[name="name"]').fill('A · 첫 프로젝트');
  await page.locator('#submitButton').click();
  await page.waitForFunction(() => !document.querySelector('#editorDialog').open);
  const a = (await snapshot()).tabId;
  console.log('Tabs smoke: created A');
  await edit('A 미저장 기록');
  await page.locator('[data-view="tasks"]').click();
  await page.locator('#search').fill('A 검색어');
  await nativeCommand(application, 'appSettings');
  assert.equal(await page.locator('#projectTabs').isHidden(), true);
  assert.equal(await page.locator('#projectSidebar').isHidden(), true);
  assert.equal(await page.title(), '앱 설정 · 일반 설정 — PM Canvas');
  await page.locator('#settingsBack').click();
  assert.equal(await page.locator('#search').inputValue(), 'A 검색어');
  assert.equal((await snapshot()).tabId, a);
  await page.locator('[data-command="new"].project-tab-new').click();
  await page.locator('[name="name"]').fill('B · 두 번째 프로젝트');
  await page.locator('#submitButton').click();
  await page.waitForFunction(() => !document.querySelector('#editorDialog').open);
  const b = (await snapshot()).tabId;
  console.log('Tabs smoke: created B');
  assert.equal((await snapshot()).tabs.length, 2);
  await save('B');
  const diskB = readFileSync(path.join(temporary, 'B.pmcanvas'));
  await activate(a);
  assert.equal((await snapshot()).project.description, 'A 미저장 기록');
  assert.equal(await page.locator('#search').inputValue(), 'A 검색어');
  const stale = (await snapshot()).revision;
  await activate(b);
  await assert.rejects(
    page.evaluate(({ p, r }) => window.desktop.replace(p, r), { p: project('Stale'), r: stale }),
    /변경/,
  );
  assert.equal((await snapshot()).canUndo, false);
  await edit('B 변경 보관');
  await page.locator('[data-view="overview"]').click();
  await nativeCommand(application, 'projectSettings');
  await assert.rejects(
    page.evaluate((id) => window.desktop.activateTab(id), a),
    /입력창/,
  );
  await page.locator('#cancelEditor').click();
  await activate(a);
  await page.evaluate(async () => {
    const s = await window.desktop.snapshot();
    await window.desktop.undo(s.revision);
  });
  assert.equal((await snapshot()).project.description, '');
  await page.evaluate(async () => {
    const s = await window.desktop.snapshot();
    await window.desktop.redo(s.revision);
  });
  await save('A');
  await application.evaluate(
    ({ dialog }, files) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
    },
    [path.join(temporary, 'B.pmcanvas'), path.join(temporary, 'C.pmcanvas')],
  );
  await page.evaluate(() => window.desktop.open());
  const c = (await snapshot()).tabId;
  console.log('Tabs smoke: opened C');
  assert.equal((await snapshot()).tabs.length, 3);
  await activate(b);
  assert.equal((await snapshot()).project.description, 'B 변경 보관');
  await assert.rejects(
    page.evaluate(() => window.desktop.saveAs()),
    /다른 탭/,
  ); // Save picker still points at A.
  await activate(c);
  await answerMessage(page, 2, () => page.evaluate((id) => window.desktop.closeProject(id), b));
  assert.equal((await snapshot()).tabId, c);
  assert.equal((await snapshot()).tabs.length, 3);
  await answerMessage(page, 1, () => page.evaluate((id) => window.desktop.closeProject(id), b));
  assert.equal((await snapshot()).tabId, c);
  assert.deepEqual(readFileSync(path.join(temporary, 'B.pmcanvas')), diskB);
  await edit('C 복구 기록');
  await activate(a);
  await edit('A 복구 기록');
  await page.screenshot({ path: path.join(root, 'test-results/project-tabs-ko.png') });
  const recoveryBefore = JSON.parse(readFileSync(path.join(temporary, 'workspace.json')));
  console.log('Tabs smoke: recovery restart');
  await application.evaluate(({ app }) => app.exit(0));

  await launch();
  await page.locator('#messageDialog[open]').waitFor();
  assert.match(await page.locator('#messageText').innerText(), /프로젝트 탭을 복구/);
  await page.locator('#messageDialog [data-response="0"]').click();
  assert.equal((await snapshot()).tabs.length, 2);
  assert.equal((await snapshot()).tabId, a);
  assert.equal((await snapshot()).project.description, 'A 복구 기록');
  // Discarding one tab followed by cancelling another quit prompt must retain both.
  await application.evaluate(({ BrowserWindow }) => {
    setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 0);
  });
  await page.locator('#messageDialog[open]').waitFor();
  await page.locator('#messageDialog [data-response="1"]').click();
  await page.waitForFunction(() =>
    document.querySelector('#messageDetail').textContent.includes('C ·'),
  );
  await page.locator('#messageDialog [data-response="2"]').click();
  await page.waitForFunction(() => !document.querySelector('#messageDialog').open);
  assert.equal((await snapshot()).tabs.length, 2);
  assert.ok((await snapshot()).tabs.every((tab) => tab.dirty));
  const recoveryAfter = JSON.parse(readFileSync(path.join(temporary, 'workspace.json')));
  console.log('Tabs smoke: cancelled quit retained all drafts');
  assert.deepEqual(recoveryAfter.tabs, recoveryBefore.tabs);
  await answerMessage(page, 1, () => page.evaluate((id) => window.desktop.closeProject(id), c));
  await answerMessage(page, 0, () => page.evaluate(() => window.desktop.closeProject()));
  await page.locator('#content [data-command="new"]').waitFor();
  assert.equal((await snapshot()).project, null);
  await application.close();
  application = null;
  await launch();
  await page.locator('#content [data-command="new"]').waitFor();
  assert.deepEqual((await snapshot()).tabs, []);
  const manyFiles = [];
  console.log('Tabs smoke: 20 tabs and English layout');
  for (let index = 0; index < 20; index++) {
    const doc = new DesktopDocument(path.join(temporary, 'fixture-recovery.json'));
    doc.create(project('프로젝트 ' + (index + 1) + ' · 긴 프로젝트 이름과 세부 정보 검증'));
    const file = path.join(temporary, 'Tab-' + index + '.pmcanvas');
    doc.save(file);
    manyFiles.push(file);
  }
  await application.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
  }, manyFiles);
  await page.evaluate(() => window.desktop.open());
  await page.evaluate(() => localStorage.setItem('pmcanvas.language', 'en'));
  await page.reload();
  await page.locator('[data-project-tab]').first().waitFor();
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1000, 760),
  );
  assert.equal((await snapshot()).tabs.length, 20);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
  );
  const lastId = (await snapshot()).tabId;
  await page.locator('[data-project-tab]').first().click();
  await page.locator('[data-project-tab][aria-selected="true"]').focus();
  await page.keyboard.press('End');
  await page.waitForFunction(
    (id) => document.querySelector('[aria-selected="true"]').dataset.projectTab === id,
    lastId,
  );
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(
    (id) => document.querySelector('[aria-selected="true"]').dataset.projectTab !== id,
    lastId,
  );
  await application.evaluate(({ Menu }) =>
    Menu.getApplicationMenu().getMenuItemById('tab-next').click(),
  );
  await page.waitForFunction(
    (id) => document.querySelector('[aria-selected="true"]').dataset.projectTab === id,
    lastId,
  );
  // Hidden Windows Electron windows can stop producing capture frames after a
  // native resize. Layout screenshots are verified separately in Chromium.
  for (const tab of (await snapshot()).tabs)
    await page.evaluate((id) => window.desktop.closeProject(id), tab.id);
  await page.locator('#content [data-command="new"]').waitFor();
  console.log(
    'PASS: real Electron multi-project creation/open/deduplication, tab UI state, isolated undo/checkpoints, save collision, inactive close, recovery and cancelled multi-tab quit',
  );
  complete = true;
} catch (error) {
  console.error('Tabs smoke failed:', error.stack || error.message);
  throw error;
} finally {
  clearTimeout(watchdog);
  if (application) {
    if (!complete) await application.evaluate(({ app }) => app.exit(0)).catch(() => {});
    else await application.close();
  }
  if (
    path.dirname(temporary) !== path.resolve(os.tmpdir()) ||
    !path.basename(temporary).startsWith('pmcanvas-tab-native-')
  )
    throw Error('Unsafe fixture cleanup path');
  try {
    rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch (error) {
    console.warn('Temporary fixture retained:', error.code);
  }
}
