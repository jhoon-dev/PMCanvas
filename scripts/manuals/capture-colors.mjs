import { repositoryRoot } from './paths.mjs';
process.chdir(repositoryRoot);
import assert from 'node:assert/strict';
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
const out = path.join(root, 'test-results', 'manuals', 'capture-colors');
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
const servers = [
  spawn(process.execPath, ['test/support/e2e-server.mjs'], {
    cwd: path.join(root, 'web'),
    windowsHide: true,
    stdio: 'ignore',
  }),
  spawn(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      '4177',
      '--strictPort',
    ],
    { cwd: path.join(root, 'mobile'), windowsHide: true, stdio: 'ignore' },
  ),
];
let browser, application;
const errors = [];
const roles = [];
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
  const colors = await page.evaluate(() => {
    const get = (selector, property) => {
      const element = document.querySelector(selector);
      return element ? getComputedStyle(element)[property] : null;
    };
    return {
      canvas: get('html', 'backgroundColor'),
      surface: get('.desktop-metric,.metric,.panel,.hero,.settings-card', 'backgroundColor'),
      primary: get('.button.primary', 'backgroundColor'),
      navigation: get('.desktop-sidebar,.sidebar', 'backgroundColor'),
      progress: get('.hero .meter > span', 'backgroundColor'),
    };
  });
  assert.equal(colors.canvas, 'rgb(245, 247, 251)', file + ' canvas');
  assert.equal(colors.surface, 'rgb(255, 255, 255)', file + ' card surface');
  if (colors.primary) assert.equal(colors.primary, 'rgb(55, 116, 233)', file + ' primary action');
  if (colors.navigation)
    assert.equal(
      colors.navigation,
      file === 'web-phone-reports.png' ? 'rgb(255, 255, 255)' : 'rgb(20, 43, 65)',
      file + ' navigation',
    );
  if (colors.progress) assert.equal(colors.progress, 'rgb(78, 130, 232)', file + ' progress');
  roles.push({ file, ...colors });
  if (page.url().startsWith('pmcanvas:')) {
    const base64 = await application.evaluate(async ({ BrowserWindow }) => {
      const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage();
      return image.toPNG().toString('base64');
    });
    writeFileSync(path.join(out, file), Buffer.from(base64, 'base64'));
  } else
    await page.screenshot({ path: path.join(out, file), fullPage: false, animations: 'disabled' });
  console.log(file);
}
try {
  await Promise.all([
    ready('http://localhost:4193/pmcanvas/api/health'),
    ready('http://127.0.0.1:4177'),
  ]);
  browser = await chromium.launch({ headless: true });
  await Promise.all([
    (async () => {
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
      await application.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.setContentSize(1440, 960);
        window.restore();
        window.showInactive();
        window.webContents.setBackgroundThrottling(false);
      });
      for (const [view, file] of [
        ['overview', 'desktop-overview.png'],
        ['management', 'desktop-issues.png'],
        ['reports', 'desktop-reports.png'],
      ]) {
        await page.locator('[data-view="' + view + '"]').click();
        await capture(page, file);
      }
    })(),
    (async () => {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 960 },
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul',
      });
      page.on('pageerror', (e) => errors.push('web: ' + e.message));
      const base = 'http://localhost:4193/pmcanvas/';
      await page.goto(base);
      await page.locator('#loginEmail').fill('member@example.com');
      await page.locator('#loginPassword').fill('preview-admin-password');
      const response = page.waitForResponse(
        (r) => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST',
      );
      await page.locator('#loginForm .primary').click();
      const session = await (await response).json();
      const result = await page.request.post(base + 'api/projects', {
        headers: { Origin: 'http://localhost:4193', 'X-CSRF-Token': session.csrf },
        data: { project: p },
      });
      if (result.status() !== 201)
        throw Error(
          'Sample project creation failed: ' + result.status() + ' ' + (await result.text()),
        );
      const saved = (await result.json()).project;
      await page.reload();
      await page.locator('#authGate').waitFor({ state: 'hidden' });
      await page.locator('[data-project="' + saved.id + '"]').click();
      for (const [view, file] of [
        ['overview', 'web-overview.png'],
        ['management', 'web-issues.png'],
        ['reports', 'web-reports.png'],
      ]) {
        await page.locator('[data-view="' + view + '"]').click();
        await capture(page, file);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('#viewSelect').selectOption('reports');
      await capture(page, 'web-phone-reports.png');
    })(),
    (async () => {
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul',
      });
      page.on('pageerror', (e) => errors.push('mobile: ' + e.message));
      await page.goto('http://127.0.0.1:4177');
      await page.locator('#importFile').setInputFiles({
        name: 'CustomerPortal.pmcanvas',
        mimeType: 'application/json',
        buffer: Buffer.from(
          JSON.stringify({ format: 'pm-canvas-project', version: 3, project: p }),
        ),
      });
      await page.locator('.project-heading h1').waitFor();
      await page.locator('#toast').waitFor({ state: 'hidden', timeout: 10000 });
      for (const [label, file] of [
        ['현황', 'mobile-overview.png'],
        ['인력', 'mobile-people.png'],
        ['보고서', 'mobile-reports.png'],
      ]) {
        await page.getByRole('link', { name: label, exact: true }).click();
        await capture(page, file);
      }
    })(),
  ]);
  if (errors.length) throw Error(errors.join('\n'));
  writeFileSync(path.join(out, 'color-checks.json'), JSON.stringify(roles, null, 2));
  console.log('Screenshots and cross-platform color checks ready: ' + out);
} finally {
  await application?.close().catch(() => {});
  await browser?.close().catch(() => {});
  for (const server of servers) server.kill();
  rmSync(temporary, { recursive: true, force: true });
}
