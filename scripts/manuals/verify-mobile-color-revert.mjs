import { repositoryRoot } from './paths.mjs';
process.chdir(repositoryRoot);
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { screenProject } from '../../web/test/support/screen-fixtures.mjs';
const root = process.cwd(),
  { chromium } = createRequire(path.join(root, 'web/package.json'))('@playwright/test');
const server = spawn(
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
);
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch('http://127.0.0.1:4177')).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  assert.ok(ready);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
  await page.goto('http://127.0.0.1:4177');
  const project = screenProject();
  delete project._role;
  delete project._revision;
  await page.locator('#importFile').setInputFiles({
    name: 'sample.pmcanvas',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'pm-canvas-project', version: 3, project })),
  });
  await page.locator('.hero').waitFor();
  await page.locator('#toast').waitFor({ state: 'hidden' });
  const colors = await page.evaluate(() => ({
    canvas: getComputedStyle(document.documentElement).backgroundColor,
    accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    hero: getComputedStyle(document.querySelector('.hero')).backgroundImage,
    menuCount: document.querySelectorAll('#navigation a').length,
  }));
  assert.equal(colors.canvas, 'rgb(245, 246, 250)');
  assert.equal(colors.accent, '#5368dd');
  assert.ok(colors.hero.includes('83, 104, 217') && colors.hero.includes('102, 123, 231'));
  assert.equal(colors.menuCount, 6);
  const out = path.join(root, 'test-results', 'manuals', 'verify-mobile-color-revert');
  fs.mkdirSync(out, { recursive: true });
  await page.screenshot({ path: path.join(out, 'mobile-overview.png') });
  fs.writeFileSync(path.join(out, 'mobile-restored-colors.json'), JSON.stringify(colors, null, 2));
  console.log(JSON.stringify(colors));
} finally {
  await browser?.close();
  server.kill();
}
