import { repositoryRoot } from './paths.mjs';
process.chdir(repositoryRoot);
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { parseDocument } from '../../desktop/document.mjs';
import { openView } from '../../mobile/test/browser/navigation.mjs';
import { DesktopWorkspace } from '../../desktop/workspace.mjs';
const root = path.resolve('.');
if (!process.argv[2] || process.argv.includes('--help')) {
  console.log(
    'Usage: node scripts/manuals/capture-release-manuals.mjs PROJECT.pmcanvas [OUTPUT_DIR]',
  );
  process.exit(process.argv.includes('--help') ? 0 : 1);
}
const project = parseDocument(readFileSync(process.argv[2]));
const output = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(root, 'test-results/manuals/release');
const versions = Object.fromEntries(
  ['desktop', 'web', 'mobile'].map((product) => [
    product,
    JSON.parse(readFileSync(path.join(root, product, 'package.json'), 'utf8')).version,
  ]),
);
async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}
const webPort = await freePort(),
  mailPort = await freePort(),
  mobilePort = await freePort();
const base = 'http://localhost:' + webPort + '/pmcanvas/',
  mobileBase = 'http://127.0.0.1:' + mobilePort;
delete project._role;
delete project._revision;
const require = createRequire(path.join(root, 'web/package.json'));
const { chromium, _electron: electron } = require('@playwright/test');
const temporary = mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-manual-capture-'));
const workspace = new DesktopWorkspace(path.join(temporary, 'workspace.json'));
workspace.create(project);
workspace.save(path.join(temporary, 'Capture.pmcanvas'));
writeFileSync(
  path.join(temporary, 'preferences.json'),
  JSON.stringify({ timeZone: 'Asia/Seoul', checkUpdatesOnStart: false, syncPublicHolidays: false }),
);
const servers = [
  spawn(process.execPath, ['test/support/mail-admin-preview.mjs'], {
    cwd: path.join(root, 'web'),
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      RUN_MAIL_ADMIN_PREVIEW: '1',
      RUN_REGISTRATION_REVIEW_PREVIEW: '1',
      RUN_WORKSPACE_PREVIEW: '1',
      RUN_WALKTHROUGH_PREVIEW: '1',
      RUN_E2E_POSTGRES: '0',
      PM_PREVIEW_PORT: String(webPort),
      PM_PREVIEW_MAIL_PORT: String(mailPort),
    },
  }),
  spawn(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      String(mobilePort),
      '--strictPort',
    ],
    { cwd: path.join(root, 'mobile'), windowsHide: true, stdio: 'ignore' },
  ),
];
let browser, app;
const errors = [],
  images = [];
for (const server of servers)
  server.on('error', () => errors.push('Private preview failed to start'));
async function ready(url, server) {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null || server.signalCode || server.pid === undefined)
      throw Error('Private preview failed to start');
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error('Preview failed');
}
function save(relative, bytes) {
  const target = path.join(output, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  images.push({ path: relative, sha256: createHash('sha256').update(bytes).digest('hex') });
  console.log('Captured ' + relative);
}
async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}
try {
  await Promise.all([ready(base + 'api/health', servers[0]), ready(mobileBase, servers[1])]);
  browser = await chromium.launch({ headless: true });
  app = await electron.launch({
    executablePath: createRequire(path.join(root, 'desktop/package.json'))('electron'),
    args: [path.join(root, 'desktop')],
    env: { ...process.env, PMCANVAS_DESKTOP_TEST: '1', PMCANVAS_DESKTOP_DATA: temporary },
    timeout: 30000,
  });
  const desktop = await app.firstWindow();
  desktop.setDefaultTimeout(20000);
  desktop.on('pageerror', (e) => errors.push(e.message));
  await desktop.locator('[data-project-tab]').first().waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setContentSize(1920, 1080);
    w.restore();
    w.showInactive();
    w.webContents.setBackgroundThrottling(false);
  });
  for (const language of ['ko', 'en']) {
    await desktop.evaluate((value) => localStorage.setItem('pmcanvas.language', value), language);
    await desktop.reload();
    for (const view of ['overview', 'planning', 'resources', 'management', 'weekly', 'reports']) {
      await desktop.locator('#projectSidebar [data-view="' + view + '"]').click();
      if (view === 'weekly')
        await desktop.locator('[data-management-pane="report"]').first().click();
      await settle(desktop);
      const bytes = await app.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0].webContents.capturePage())
          .toPNG()
          .toString('base64'),
      );
      save(
        'desktop/' + versions.desktop + '/images/' + language + '/' + view + '.png',
        Buffer.from(bytes, 'base64'),
      );
    }
  }
  await app.evaluate(({ app }) => app.exit(0));
  app = null;
  const web = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  web.on('pageerror', (e) => errors.push(e.message));
  await web.goto(base);
  await web.locator('#loginEmail').fill('member@example.com');
  await web.locator('#loginPassword').fill('preview-admin-password');
  const response = web.waitForResponse(
    (r) => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST',
  );
  await web.locator('#loginForm .primary').click();
  const session = await (await response).json();
  const result = await web.request.post(base + 'api/projects', {
    headers: { Origin: new URL(base).origin, 'X-CSRF-Token': session.csrf },
    data: { project: { ...project, id: randomUUID() } },
  });
  assert.equal(result.status(), 201);
  const saved = (await result.json()).project;
  await web.reload();
  await web.locator('#authGate').waitFor({ state: 'hidden' });
  await web.locator('[data-project="' + saved.id + '"]').click();
  for (const view of ['overview', 'tasks', 'resources', 'management', 'weekly', 'reports']) {
    await web.locator('[data-view="' + view + '"]').click();
    if (view === 'weekly') await web.locator('[data-management-pane="report"]').first().click();
    await settle(web);
    save(
      'web/' + versions.web + '/images/' + view + '.png',
      await web.screenshot({ animations: 'disabled' }),
    );
  }
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  mobile.on('pageerror', (e) => errors.push(e.message));
  await mobile.goto(mobileBase);
  await mobile.locator('#importFile').setInputFiles({
    name: 'Capture.pmcanvas',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'pm-canvas-project', version: 3, project })),
  });
  await mobile.locator('#activeProjectName').filter({ hasText: project.name }).waitFor();
  await mobile.locator('#toast').waitFor({ state: 'visible' });
  await mobile.locator('#toast').waitFor({ state: 'hidden' });
  for (const view of ['overview', 'planning', 'daily', 'resources', 'reports']) {
    await openView(mobile, view);
    await settle(mobile);
    save(
      'mobile/' + versions.mobile + '/images/' + view + '.png',
      await mobile.screenshot({ animations: 'disabled' }),
    );
  }
  assert.deepEqual(errors, []);
  writeFileSync(
    path.join(output, 'screenshots.json'),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        project: project.name,
        versions,
        viewport: { desktop: [1920, 1080], web: [1920, 1080], mobile: [390, 844] },
        images,
      },
      null,
      2,
    ) + '\n',
  );
  console.log('PASS: ' + images.length + ' screenshots, no renderer errors.');
} finally {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await browser?.close();
  await Promise.all(
    servers.map(async (server) => {
      if (server.exitCode === null && server.signalCode === null && server.pid !== undefined) {
        const exited = once(server, 'exit');
        server.kill();
        await exited;
      }
    }),
  );
  rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
