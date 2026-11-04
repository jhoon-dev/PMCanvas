import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { DesktopWorkspace } from '../workspace.mjs';
import { today, addDays } from '../app/shared/engine.js';
import { setBusinessTimeZone } from '../app/shared/business-clock.js';
const require = createRequire(import.meta.url);
const { _electron: electron } = createRequire(new URL('../../web/package.json', import.meta.url))(
  '@playwright/test',
);
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const temporary = mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-tab-settings-'));
const initialZone = 'Pacific/Kiritimati';
setBusinessTimeZone(initialZone);
const date = today(),
  w = new DesktopWorkspace(path.join(temporary, 'workspace.json'));
const first = w.create({
  name: 'Completed in inactive tab',
  description: '',
  holidays: [],
  members: [{ id: 'm', name: 'Member', role: '', grade: '', hours: 8, allocation: 100 }],
  tasks: [
    {
      id: 't',
      name: 'Task',
      phase: '',
      owner: 'm',
      start: addDays(date, -6),
      end: date,
      predecessor: '',
      memo: '',
      items: [{ id: 'i', title: 'Completed', hours: 8, doneDate: date }],
    },
  ],
}).tabId;
w.save(path.join(temporary, 'A.pmcanvas'));
w.create({ name: 'Active empty tab', description: '', holidays: [], members: [], tasks: [] });
w.save(path.join(temporary, 'B.pmcanvas'));
writeFileSync(
  path.join(temporary, 'preferences.json'),
  JSON.stringify({ timeZone: initialZone, checkUpdatesOnStart: false }),
);
let app;
try {
  app = await electron.launch({
    executablePath: require('electron'),
    args: [root],
    env: { ...process.env, PMCANVAS_DESKTOP_TEST: '1', PMCANVAS_DESKTOP_DATA: temporary },
    timeout: 30000,
  });
  const page = await app.firstWindow();
  await page.locator('[data-project-tab]').first().waitFor();
  await assert.rejects(page.evaluate(() => window.desktop.setTimeZone('Etc/GMT+12')));
  assert.equal((await page.evaluate(() => window.desktop.settings())).timeZone, initialZone);
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).tabs.length, 2);
  await page.evaluate((id) => window.desktop.closeProject(id), first);
  await page.evaluate(() => window.desktop.setTimeZone('Etc/GMT+12'));
  assert.equal((await page.evaluate(() => window.desktop.settings())).timeZone, 'Etc/GMT+12');
  console.log(
    'PASS: a timezone change validates inactive tabs and rolls back safely; a compatible workspace can change timezone.',
  );
} finally {
  await app?.close();
  if (
    path.dirname(temporary) !== path.resolve(os.tmpdir()) ||
    !path.basename(temporary).startsWith('pmcanvas-tab-settings-')
  )
    throw Error('Unsafe fixture cleanup path');
  rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
