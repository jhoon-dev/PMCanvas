import { repositoryRoot } from './paths.mjs';
process.chdir(repositoryRoot);
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { screenProject } from '../../web/test/support/screen-fixtures.mjs';
import { DesktopWorkspace } from '../../desktop/workspace.mjs';
const root = path.resolve('.');
const out = path.join(root, 'test-results', 'manuals', 'check-typography-source');
mkdirSync(out, { recursive: true });
const require = createRequire(path.join(root, 'web/package.json'));
const { chromium, _electron: electron } = require('@playwright/test');
const temporary = mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-parity-capture-'));
const project = screenProject();
project.id = randomUUID();
project.name = '고객 포털 구축 프로젝트';
delete project._role;
delete project._revision;
const workspace = new DesktopWorkspace(path.join(temporary, 'workspace.json'));
workspace.create(project);
workspace.save(path.join(temporary, 'Capture.pmcanvas'));
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
let browser, app;
const errors = [];
async function ready(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error('Preview failed');
}
async function readable(page, name) {
  const result = await page.evaluate(() => {
    const small = [];
    let minimum = Infinity,
      count = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node; (node = walker.nextNode());) {
      if (!node.textContent.trim()) continue;
      const el = node.parentElement;
      if (!el || el.closest('script,style,.sr-only,[hidden]') || !el.checkVisibility()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (
        rect.width < 1 ||
        rect.height < 1 ||
        rect.bottom < 0 ||
        rect.top > innerHeight ||
        rect.right < 0 ||
        rect.left > innerWidth
      )
        continue;
      let size = parseFloat(getComputedStyle(el).fontSize);
      if (el instanceof SVGElement && el.getScreenCTM) {
        const m = el.getScreenCTM();
        if (m) size *= Math.hypot(m.c, m.d);
      }
      minimum = Math.min(minimum, size);
      count++;
      if (size < 11.99) small.push({ text: node.textContent.trim().slice(0, 60), size });
    }
    return { minimum, count, small };
  });
  writeFileSync(path.join(out, name + '-font-checks.json'), JSON.stringify(result, null, 2));
  assert.deepEqual(result.small, [], name + ' must display text at least 12px');
}
try {
  await Promise.all([
    ready('http://localhost:4193/pmcanvas/api/health'),
    ready('http://127.0.0.1:4177'),
  ]);
  console.log('Preview servers ready');
  browser = await chromium.launch({ headless: true });
  const results = await Promise.allSettled([
    (async () => {
      app = await electron.launch({
        executablePath: createRequire(path.join(root, 'desktop/package.json'))('electron'),
        args: [path.join(root, 'desktop'), '--user-data-dir=' + temporary],
        env: { ...process.env, PMCANVAS_DESKTOP_TEST: '1' },
        timeout: 30000,
      });
      const page = await app.firstWindow();
      page.setDefaultTimeout(15000);
      page.on('pageerror', (e) => errors.push(e.message));
      await page.locator('[data-project-tab]').first().waitFor();
      await page.evaluate(() => localStorage.setItem('pmcanvas.language', 'ko'));
      await page.reload();
      await app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0];
        w.setContentSize(1440, 1000);
        w.restore();
        w.showInactive();
        w.webContents.setBackgroundThrottling(false);
      });
      await page.locator('[data-view="overview"]').click();
      assert.equal(await page.locator('[data-project-chart]').count(), 3);
      assert.equal(await page.locator('[data-project-chart="progress"] svg').isVisible(), true);
      const palette = await page.evaluate(() => ({
        sidebar: getComputedStyle(document.querySelector('.desktop-sidebar')).backgroundColor,
      }));
      assert.equal(palette.sidebar, 'rgb(255, 255, 255)');
      assert.ok(!(await page.locator('.project-visuals').innerHTML()).match(/NaN|Infinity/));
      async function shot(name) {
        const base64 = await app.evaluate(async ({ BrowserWindow }) =>
          (await BrowserWindow.getAllWindows()[0].webContents.capturePage())
            .toPNG()
            .toString('base64'),
        );
        writeFileSync(path.join(out, name), Buffer.from(base64, 'base64'));
      }
      await readable(page, 'desktop');
      await shot('desktop-overview.png');
      await page
        .locator('.project-visuals')
        .evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.evaluate(() => window.scrollBy(0, -80));
      await shot('desktop-graphs.png');
      writeFileSync(
        path.join(out, 'installed-checks.json'),
        JSON.stringify({ charts: 3, palette, errors }, null, 2),
      );
    })(),
    (async () => {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul',
      });
      page.on('pageerror', (e) => errors.push(e.message));
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
        data: { project },
      });
      assert.equal(result.status(), 201);
      const saved = (await result.json()).project;
      await page.reload();
      await page.locator('#authGate').waitFor({ state: 'hidden' });
      await page.locator('[data-project="' + saved.id + '"]').click();
      await page.locator('[data-view="overview"]').click();
      await page.locator('.chart-wrap svg').waitFor();
      await page.evaluate(async () => await document.fonts.ready);
      await readable(page, 'web');
      await page.screenshot({ path: path.join(out, 'web-overview.png'), animations: 'disabled' });
    })(),
    (async () => {
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 1,
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul',
      });
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('http://127.0.0.1:4177');
      await page.locator('#importFile').setInputFiles({
        name: 'Capture.pmcanvas',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ format: 'pm-canvas-project', version: 3, project })),
      });
      await page.locator('[data-project-chart="progress"] svg').waitFor();
      assert.equal(await page.locator('[data-project-chart]').count(), 3);
      await page.locator('#toast').waitFor({ state: 'hidden' });
      await readable(page, 'mobile');
      await page.screenshot({
        path: path.join(out, 'mobile-overview.png'),
        animations: 'disabled',
      });
      await page
        .locator('.project-visuals')
        .evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await readable(page, 'mobile-graphs');
      await page.screenshot({ path: path.join(out, 'mobile-graphs.png'), animations: 'disabled' });
      await page.locator('#projectView').selectOption('planning');
      await page.locator('#wbsWorkspace').waitFor();
      await page.screenshot({ path: path.join(out, 'mobile-wbs.png'), animations: 'disabled' });
    })(),
  ]);
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  assert.deepEqual(errors, []);
  console.log('PASS: installed desktop graphs and three-platform screenshots: ' + out);
} catch (error) {
  console.error(error);
  throw error;
} finally {
  await app?.close().catch(() => {});
  await browser?.close().catch(() => {});
  for (const server of servers) server.kill();
  try {
    rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  } catch (error) {
    console.warn('Temporary capture profile retained: ' + temporary + ' ' + error.code);
  }
}
