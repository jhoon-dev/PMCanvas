import { appSection, nativeCommand } from './ui-actions.mjs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { DesktopWorkspace } from '../workspace.mjs';
import { holidayFeed } from './holiday-feed-fixture.mjs';
const require = createRequire(import.meta.url);
const { _electron: electron } = createRequire(new URL('../../web/package.json', import.meta.url))(
  '@playwright/test',
);
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const temporary = mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-holiday-native-'));
writeFileSync(
  path.join(temporary, 'preferences.json'),
  JSON.stringify({ timeZone: 'Asia/Seoul', checkUpdatesOnStart: false }),
);
const w = new DesktopWorkspace(path.join(temporary, 'workspace.json'));
const p = {
  name: '자동 공휴일 검증',
  description: '',
  holidays: [],
  members: [{ id: 'm', name: '검증 담당자', role: '', grade: '', hours: 8, allocation: 100 }],
  tasks: [
    {
      id: 't',
      name: '검증 업무',
      phase: '',
      owner: 'm',
      start: '2026-11-04',
      end: '2026-11-04',
      predecessor: '',
      memo: '',
      items: [{ id: 'i', title: '작업', hours: 16, doneDate: null }],
    },
  ],
};
const a = w.create(p).tabId;
w.save(path.join(temporary, 'A.pmcanvas'));
const b = w.create({ ...p, name: '다른 프로젝트' }).tabId;
w.save(path.join(temporary, 'B.pmcanvas'));
const originals = ['A.pmcanvas', 'B.pmcanvas'].map((name) =>
  readFileSync(path.join(temporary, name)),
);
let app,
  page,
  completed = false;
const launch = async () => {
  app = await electron.launch({
    executablePath: require('electron'),
    args: [root],
    env: { ...process.env, PMCANVAS_DESKTOP_TEST: '1', PMCANVAS_DESKTOP_DATA: temporary },
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.locator('[data-project-tab]').first().waitFor();
};
const inject = async (holidays) =>
  app.evaluate(
    (_electron, text) => {
      globalThis.fetch = async () =>
        new Response(text, { headers: { 'Content-Type': 'text/calendar' } });
    },
    holidayFeed(holidays, new Date().getUTCFullYear()),
  );
const snapshot = () => page.evaluate(() => window.desktop.snapshot());
const watchdog = setTimeout(() => app?.process().kill('SIGKILL'), 120000);
watchdog.unref();
try {
  await launch();
  await page.evaluate(() => localStorage.setItem('pmcanvas.language', 'ko'));
  await page.reload();
  const before = await snapshot();
  await inject([{ date: '2026-11-05', name: '임시공휴일' }]);
  const firstRefresh = await page.evaluate(() => window.desktop.refreshHolidays());
  assert.equal(firstRefresh.error, null);
  assert.ok(firstRefresh.holidays.some((row) => row.date === '2026-11-05'));
  console.log('Native holiday sync: first refresh applied');
  await page.getByText('2026-11-06', { exact: true }).first().waitFor();
  assert.deepEqual((await snapshot()).project, before.project);
  assert.equal((await snapshot()).dirty, false);
  assert.equal((await snapshot()).canUndo, false);
  await page.locator('[data-project-tab="' + a + '"]').click();
  await page.getByText('2026-11-06', { exact: true }).first().waitFor();
  await nativeCommand(app, 'projectSettings');
  await page.locator('[name="name"]').fill('저장하면 안 되는 입력');
  const editing = await snapshot();
  await inject([
    { date: '2026-11-05', name: '임시공휴일' },
    { date: '2026-11-06', name: '대통령 선거일' },
  ]);
  const held = await page.evaluate(() => window.desktop.refreshHolidays());
  assert.equal(held.pending, true);
  assert.equal((await snapshot()).revision, editing.revision);
  assert.equal(await page.locator('[name="name"]').inputValue(), '저장하면 안 되는 입력');
  await page.locator('#cancelEditor').click();
  await page.getByText('2026-11-09', { exact: true }).first().waitFor();
  assert.equal((await snapshot()).project.name, '자동 공휴일 검증');
  await appSection(page, 'holidays', app);
  await page.waitForFunction(() =>
    document.querySelector('#holidaySyncChecked').textContent.includes('최근 갱신'),
  );
  assert.equal(await page.locator('#autoSyncHolidays').isChecked(), true);
  const cached = readFileSync(path.join(temporary, 'public-holidays.json'));
  await app.evaluate(() => {
    globalThis.fetch = async () => {
      throw Error('offline');
    };
  });
  await page.locator('#refreshHolidays').click();
  await page.waitForFunction(() =>
    document.querySelector('#holidaySyncStatus').textContent.includes('연결하지 못해'),
  );
  assert.deepEqual(readFileSync(path.join(temporary, 'public-holidays.json')), cached);
  await page.locator('#autoSyncHolidays').uncheck();
  await page.waitForFunction(() =>
    document.querySelector('#holidaySyncStatus').textContent.includes('자동 갱신이 꺼져'),
  );
  assert.equal(
    JSON.parse(readFileSync(path.join(temporary, 'preferences.json'))).syncPublicHolidays,
    false,
  );
  await page.locator('#autoSyncHolidays').check();
  await page.waitForFunction(() => !document.querySelector('#autoSyncHolidays').disabled);
  await app.close();
  app = null;
  await launch();
  if (await page.locator('#settingsBack').isVisible()) await page.locator('#settingsBack').click();
  await page.getByText('2026-11-09', { exact: true }).first().waitFor();
  const restored = await page.evaluate(() => window.desktop.holidayState());
  assert.ok(restored.checkedAt);
  assert.ok(restored.holidays.some((row) => row.date === '2026-11-06'));
  await app.evaluate(
    ({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    },
    path.join(temporary, 'Report.xlsx'),
  );
  await page.evaluate(async () => {
    const s = await window.desktop.snapshot();
    await window.desktop.exportReport(
      { kind: 'wbs', at: '2026-11-03', format: 'xlsx' },
      s.revision,
    );
  });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(readFileSync(path.join(temporary, 'Report.xlsx')));
  const values = [];
  book.eachSheet((sheet) =>
    sheet.eachRow((row) =>
      row.eachCell((cell) => {
        if (cell.value instanceof Date) values.push(cell.value.toISOString().slice(0, 10));
        else values.push(String(cell.value));
      }),
    ),
  );
  assert.ok(
    values.includes('2026-11-09'),
    'Excel worker must receive the same downloaded calendar as the UI/main process.',
  );
  for (const [index, name] of ['A.pmcanvas', 'B.pmcanvas'].entries())
    assert.deepEqual(readFileSync(path.join(temporary, name)), originals[index]);
  await appSection(page, 'general', app);
  await page.locator('#languageSelect').selectOption('en');
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  await appSection(page, 'holidays', app);
  assert.equal(await page.locator('#holidaySyncTitle').innerText(), 'Public holiday data');
  assert.match(await page.locator('#holidaySyncChecked').innerText(), /Last refreshed/);
  assert.equal((await snapshot()).tabs.length, 2);
  assert.equal((await snapshot()).anyDirty, false);
  console.log(
    'PASS: real Electron live holiday refresh, all tabs, deferred application during edits, offline restart, preference persistence, English/Korean settings, original files and Excel worker calculations.',
  );
  completed = true;
} catch (error) {
  console.error(error.stack || error);
  if (page && !page.isClosed())
    console.error(
      'UI diagnostic:',
      await page
        .locator('#content')
        .innerText()
        .catch(() => ''),
    );
  throw error;
} finally {
  clearTimeout(watchdog);
  if (app) {
    if (completed) await app.close();
    else await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
  if (
    path.dirname(temporary) !== path.resolve(os.tmpdir()) ||
    !path.basename(temporary).startsWith('pmcanvas-holiday-native-')
  )
    throw Error('Unsafe fixture cleanup');
  try {
    rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch (error) {
    console.warn('Temporary fixture retained:', error.code);
  }
}
