import { repositoryRoot } from './paths.mjs';
process.chdir(repositoryRoot);
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { screenProject } from '../../web/test/support/screen-fixtures.mjs';
import { DesktopWorkspace } from '../../desktop/workspace.mjs';
import { managementChange } from '../../shared/browser/management.js';
const root = path.resolve('.');
const out = path.join(root, 'test-results', 'manuals', 'capture-desktop');
mkdirSync(out, { recursive: true });
const requireWeb = createRequire(path.join(root, 'web/package.json'));
const requireDesktop = createRequire(path.join(root, 'desktop/package.json'));
const { chromium, _electron: electron } = requireWeb('@playwright/test');
const temporary = mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-captures-'));
let p = screenProject();
p.id = randomUUID();
p.name = '고객 포털 구축 프로젝트';
p.description = '기획부터 출시까지 일정과 참여인력의 진행 상황을 확인합니다.';
delete p._role;
delete p._revision;
p = managementChange(p, 'issue', {
  id: 'sample-risk',
  title: '외부 API 연동 일정 확인',
  type: 'risk',
  impact: 'high',
  probability: 'medium',
  owner: 'm1',
  taskId: 't2',
  due: '2026-11-06',
  status: 'open',
  action: '파트너사와 연동 일정을 협의합니다.',
});
const workspace = new DesktopWorkspace(path.join(temporary, 'workspace.json'));
workspace.create(p);
workspace.save(path.join(temporary, 'CustomerPortal.pmcanvas'));
writeFileSync(
  path.join(temporary, 'preferences.json'),
  JSON.stringify({ timeZone: 'Asia/Seoul', checkUpdatesOnStart: false, syncPublicHolidays: false }),
);
const servers = [];
let browser, application;
const errors = [];
async function ready(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error('Preview did not start: ' + url);
}
async function capture(page, file) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: path.join(out, file), fullPage: false, animations: 'disabled' });
  console.log(file);
}
try {
  await (async () => {
    application = await electron.launch({
      executablePath: requireDesktop('electron'),
      args: [path.join(root, 'desktop')],
      env: { ...process.env, PMCANVAS_DESKTOP_TEST: '1', PMCANVAS_DESKTOP_DATA: temporary },
      timeout: 30000,
    });
    const page = await application.firstWindow();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (e) => errors.push('desktop: ' + e.message));
    await page.locator('[data-project-tab]').first().waitFor();
    await page.evaluate(() => localStorage.setItem('pmcanvas.language', 'ko'));
    await page.reload();
    console.log(
      await application.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.setContentSize(1440, 960);
        window.restore();
        window.showInactive();
        window.webContents.setBackgroundThrottling(false);
        return {
          visible: window.isVisible(),
          minimized: window.isMinimized(),
          size: window.getContentSize(),
        };
      }),
    );
    for (const [view, file] of [
      ['overview', 'desktop-overview.png'],
      ['management', 'desktop-issues.png'],
      ['reports', 'desktop-reports.png'],
    ]) {
      await page.locator('[data-view="' + view + '"]').click();
      const base64 = await application.evaluate(async ({ BrowserWindow }) => {
        const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage();
        return image.toPNG().toString('base64');
      });
      writeFileSync(path.join(out, file), Buffer.from(base64, 'base64'));
      console.log(file);
    }
  })();
  if (errors.length) throw Error(errors.join('\n'));
  console.log('Screenshots ready: ' + out);
} finally {
  await application?.close().catch(() => {});
  await browser?.close().catch(() => {});
  for (const server of servers) server.kill();
  rmSync(temporary, { recursive: true, force: true });
}
