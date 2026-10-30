import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { assetPath } from '../assets.mjs';
const { chromium } = createRequire(new URL('../../web/package.json', import.meta.url))(
  '@playwright/test',
);
const root = fileURLToPath(new URL('../app/', import.meta.url));
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'ko-KR' });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://desktop.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/test-update-bootstrap.js') {
      return route.fulfill({
        contentType: 'text/javascript',
        body: `
        import {createUpdateUI} from './update-ui.js';
        import {ui,getLanguage,localizeStatic} from './shared/i18n.js';
        document.documentElement.lang=getLanguage();
        localizeStatic(document.documentElement);
        window.calls={checks:0,downloads:0,installs:0,pages:0};
        window.update={status:'idle',channel:'github',currentVersion:'0.8.0',available:false,downloadAvailable:false};
        window.api={
          onUpdate(cb){window.publishUpdate=value=>{window.update=value;cb(value)}},
          async updateState(){return window.update},
          async checkUpdates(){window.calls.checks++; if(window.offline)throw Error('offline');
            window.publishUpdate({...window.update,status:'checking'});
            await new Promise(resolve=>setTimeout(resolve,60));
            const value={...window.update,status:'available',available:true,downloadAvailable:true,version:'0.9.0',checkedAt:Date.now()};
            window.publishUpdate(value);return value;
          },
          async setUpdatePreference(enabled){localStorage.setItem('test.update-auto',String(enabled));return {checkUpdatesOnStart:enabled}},
          async downloadUpdate(){window.calls.downloads++;window.publishUpdate({...window.update,status:'downloading',progress:{received:5,total:10}});
            await new Promise(resolve=>setTimeout(resolve,100));
            window.publishUpdate({...window.update,status:'downloaded',progress:null});return window.update;
          },
          async applyUpdate(){if(window.dirty)throw Error(ui('변경사항과 입력창을 먼저 저장하거나 취소한 뒤 업데이트해 주세요.'));window.calls.installs++},
          async openRelease(){window.calls.pages++}
        };
        window.updateUI=createUpdateUI({api:window.api,ui,settings:{checkUpdatesOnStart:localStorage.getItem('test.update-auto')!=='false'},
          onOpen:()=>window.updateUI.open(),onError:error=>{document.querySelector('#toast').textContent=error.message;document.querySelector('#toast').hidden=false}});
        document.querySelector('[data-command="appSettings"]').onclick=()=>window.updateUI.open();
        await window.updateUI.initialise(); window.updateReady=true;
      `,
      });
    }
    const asset = assetPath('pmcanvas://desktop' + url.pathname);
    if (!asset) return route.fulfill({ status: 404, body: 'Not found' });
    let bytes = readFileSync(path.join(root, asset));
    if (asset === 'index.html')
      bytes = Buffer.from(bytes.toString().replace('./renderer.js', './test-update-bootstrap.js'));
    return route.fulfill({
      contentType: asset.endsWith('.html')
        ? 'text/html'
        : asset.endsWith('.css')
          ? 'text/css'
          : 'text/javascript',
      body: bytes,
    });
  });
  await page.goto('https://desktop.test/index.html');
  await page.waitForFunction(() => window.updateReady);
  assert.equal(await page.locator('#updateNotice').isVisible(), false);
  assert.equal(await page.locator('#updateDialog').evaluate((dialog) => dialog.open), false);
  await page.evaluate(() => {
    document.querySelector('#dialogBody').innerHTML =
      '<input id="draftName" value="작업 중인 입력">';
    document.querySelector('#editorDialog').showModal();
    document.querySelector('#draftName').focus();
    window.publishUpdate({
      ...window.update,
      status: 'available',
      available: true,
      downloadAvailable: true,
      version: '0.9.0',
    });
  });
  assert.equal(await page.locator('#editorDialog').evaluate((dialog) => dialog.open), true);
  assert.equal(await page.locator('#draftName').inputValue(), '작업 중인 입력');
  assert.equal(await page.locator('#updateDialog').evaluate((dialog) => dialog.open), false);
  assert.deepEqual(await page.evaluate(() => window.calls), {
    checks: 0,
    downloads: 0,
    installs: 0,
    pages: 0,
  });
  await page.evaluate(() => document.querySelector('#editorDialog').close());
  await page.locator('#dismissUpdate').click();
  await page.evaluate(() => window.publishUpdate({ ...window.update }));
  assert.equal(await page.locator('#updateNotice').isVisible(), false);
  await page.evaluate(() => window.publishUpdate({ ...window.update, version: '0.10.0' }));
  assert.equal(await page.locator('#updateNotice').isVisible(), true);
  mkdirSync(path.resolve('test-results'), { recursive: true });
  await page.screenshot({ path: 'test-results/desktop-update-banner.png', fullPage: true });
  await page.locator('#showUpdate').click();
  await page.locator('#autoCheckUpdates').uncheck();
  await page.waitForFunction(() => localStorage.getItem('test.update-auto') === 'false');
  await page.locator('#checkUpdates').click();
  await page.waitForFunction(() =>
    document.querySelector('#updateStatus').textContent.includes('0.9.0'),
  );
  await page.locator('#installUpdate').click();
  await page.waitForFunction(
    () => document.querySelector('#installUpdate').textContent === '설치 파일 열기',
  );
  assert.equal(await page.evaluate(() => window.calls.installs), 0);
  await page.evaluate(() => {
    window.dirty = true;
  });
  await page.locator('#installUpdate').click();
  await page
    .getByText('변경사항과 입력창을 먼저 저장하거나 취소한 뒤 업데이트해 주세요.', { exact: true })
    .waitFor();
  assert.equal(await page.evaluate(() => window.calls.installs), 0);
  await page.evaluate(() => {
    window.dirty = false;
  });
  await page.locator('#installUpdate').click();
  await page.waitForFunction(() => window.calls.installs === 1);
  await page.evaluate(() =>
    window.publishUpdate({ ...window.update, status: 'error', error: 'verification' }),
  );
  assert.equal(await page.locator('#openRelease').isVisible(), false);
  assert.equal(await page.locator('#installUpdate').textContent(), '업데이트 다운로드');
  await page
    .getByText(
      '업데이트의 발행자를 확인하지 못했습니다. 설치를 중단했습니다. 나중에 다시 확인해 주세요.',
      {
        exact: true,
      },
    )
    .waitFor();
  await page.locator('#installUpdate').click();
  await page.waitForFunction(() => window.update.status === 'downloaded');
  assert.equal(await page.evaluate(() => window.calls.downloads), 2);
  assert.equal(await page.evaluate(() => window.calls.installs), 1);
  await page.screenshot({ path: 'test-results/desktop-update-settings.png', fullPage: true });
  await page.setViewportSize({ width: 1000, height: 720 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({
    path: 'test-results/desktop-update-settings-compact.png',
    fullPage: true,
  });
  await page.locator('#closeUpdate').click();
  await page.evaluate(() =>
    window.publishUpdate({
      ...window.update,
      status: 'unsupported',
      channel: 'microsoft-store',
      available: false,
      downloadAvailable: false,
      version: null,
    }),
  );
  await page.locator('details.action-menu summary').click();
  await page.getByRole('button', { name: '앱 설정', exact: true }).click();
  assert.equal(await page.locator('#openRelease').isVisible(), false);
  assert.equal(await page.locator('#installUpdate').textContent(), 'Microsoft Store에서 업데이트');
  await page.locator('#installUpdate').click();
  assert.equal(await page.evaluate(() => window.calls.downloads), 2);
  await page.evaluate(() =>
    window.publishUpdate({
      ...window.update,
      status: 'unsupported',
      channel: 'mac-app-store',
      available: false,
      downloadAvailable: false,
      version: null,
    }),
  );
  assert.equal(await page.locator('#installUpdate').textContent(), 'Mac App Store에서 업데이트');
  assert.equal(await page.locator('#openRelease').isVisible(), false);
  await page.locator('#installUpdate').click();
  assert.equal(await page.evaluate(() => window.calls.downloads), 2);
  await page
    .getByText('Mac App Store에서 업데이트를 확인할 수 있습니다.', { exact: true })
    .waitFor();
  await page.locator('#closeUpdate').click();
  await page.evaluate(() => {
    localStorage.setItem('pmcanvas.language', 'en');
  });
  await page.reload();
  await page.waitForFunction(() => window.updateReady);
  await page.locator('details.action-menu summary').click();
  await page.getByRole('button', { name: 'App settings', exact: true }).click();
  assert.equal(await page.locator('#autoCheckUpdates').isChecked(), false);
  await page.evaluate(() => {
    window.offline = true;
  });
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await page
    .getByText('Could not check for updates. Check your connection or try again later.', {
      exact: true,
    })
    .waitFor();
  await page.evaluate(() => {
    window.offline = false;
  });
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('#updateStatus').textContent.includes('0.9.0'),
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: passive startup banner, active editor preservation, dismissal, settings persistence, download/explicit install, Store routing, English and offline retry',
  );
} finally {
  await browser.close();
}
