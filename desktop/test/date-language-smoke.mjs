import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { assetPath } from '../assets.mjs';
import { screenProject } from '../../web/test/support/screen-fixtures.mjs';
const { chromium } = createRequire(new URL('../../web/package.json', import.meta.url))(
  '@playwright/test',
);
const root = fileURLToPath(new URL('../app/', import.meta.url));

async function harness(language = 'ko', timeZone = 'Asia/Seoul', offline = false, store = false) {
  let openedReleases = 0;
  let project = screenProject(),
    revision = 1,
    dirty = false;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-10-28T23:59:00+09:00') });
  await page.exposeFunction('fixtureCall', (name, ...args) => {
    if (name === 'checkUpdates') {
      if (offline) throw Error('offline');
      if (store)
        return {
          status: 'unsupported',
          channel: 'microsoft-store',
          currentVersion: '0.7.4',
          version: null,
          available: false,
          downloadAvailable: false,
        };
      return {
        status: 'available',
        channel: 'github',
        currentVersion: '0.7.2',
        version: '0.8.0',
        available: true,
        downloadAvailable: true,
      };
    }
    if (name === 'openRelease' || name === 'applyUpdate') {
      openedReleases++;
      return;
    }
    if (name === 'settings') return { timeZone };
    if (name === 'setTimeZone') {
      timeZone = new Intl.DateTimeFormat('en', { timeZone: args[0] }).resolvedOptions().timeZone;
      return { timeZone };
    }
    if (name === 'replace') {
      project = args[0];
      revision++;
      dirty = true;
    }
    if (name === 'save') {
      dirty = false;
      revision++;
    }
    if (name === 'setLanguage') return args[0];
    if (name === 'editing') return;
    return { project, revision, dirty, filename: 'synthetic.pmcanvas' };
  });
  await page.addInitScript((language) => {
    if (!localStorage.getItem('pmcanvas.language'))
      localStorage.setItem('pmcanvas.language', language);
    window.desktop = Object.fromEntries(
      [
        'snapshot',
        'replace',
        'editing',
        'save',
        'setLanguage',
        'settings',
        'setTimeZone',
        'checkUpdates',
        'openRelease',
        'applyUpdate',
      ].map((name) => [name, (...args) => window.fixtureCall(name, ...args)]),
    );
    window.desktop.onCommand = () => {};
    window.desktop.onDocument = () => {};
  }, language);
  await page.route('https://desktop.test/**', (route) => {
    const asset = assetPath('pmcanvas://desktop' + new URL(route.request().url()).pathname);
    return asset
      ? route.fulfill({
          contentType: asset.endsWith('.html')
            ? 'text/html'
            : asset.endsWith('.css')
              ? 'text/css'
              : 'text/javascript',
          body: fs.readFileSync(path.join(root, asset)),
        })
      : route.fulfill({ status: 404, body: 'Not found' });
  });
  await page.goto('https://desktop.test/index.html');
  await page.locator('#reportDate').waitFor();
  return { browser, page, errors, getProject: () => project, openedReleases: () => openedReleases };
}

test('manual update notices preserve projects, open links only on request and handle offline mode', async () => {
  for (const offline of [false, true]) {
    const h = await harness('en', 'Asia/Seoul', offline);
    try {
      const before = structuredClone(h.getProject());
      await h.page.getByText('File options', { exact: true }).click();
      await h.page.getByRole('button', { name: 'App settings', exact: true }).click();
      await h.page.locator('#checkUpdates').click();
      await h.page.waitForFunction(
        (offline) =>
          document
            .querySelector('#updateStatus')
            .textContent.includes(offline ? 'Could not check' : '0.8.0'),
        offline,
      );
      assert.match(
        await h.page.locator('#updateStatus').textContent(),
        offline ? /Could not check/ : /0.8.0/,
      );
      assert.equal(h.openedReleases(), 0);
      await h.page.locator('#openRelease').click();
      await h.page.locator('#closeUpdate').click();
      assert.equal(h.openedReleases(), 1);
      assert.deepEqual(h.getProject(), before);
      assert.deepEqual(h.errors, []);
    } finally {
      await h.browser.close();
    }
  }
});

test('Store update notices use the Store library and preserve offline project data in both languages', async () => {
  for (const language of ['ko', 'en']) {
    const h = await harness(language, 'Asia/Seoul', false, true);
    try {
      const before = structuredClone(h.getProject());
      await h.page
        .getByText(language === 'en' ? 'File options' : '파일 옵션', { exact: true })
        .click();
      await h.page.locator('[data-command="appSettings"]').first().click();
      await h.page.locator('#checkUpdates').click();
      await h.page.waitForFunction(() =>
        document.querySelector('#updateStatus').textContent.includes('Microsoft Store'),
      );
      assert.match(await h.page.locator('#installUpdate').textContent(), /Microsoft Store/);
      assert.equal(await h.page.locator('#openRelease').isVisible(), false);
      assert.equal(h.openedReleases(), 0);
      await h.page.locator('#installUpdate').click();
      assert.equal(h.openedReleases(), 1);
      assert.deepEqual(h.getProject(), before);
      assert.deepEqual(h.errors, []);
    } finally {
      await h.browser.close();
    }
  }
});
test('business time zone settings survive reload, use the configured day and preserve project records', async () => {
  const { browser, page, errors, getProject } = await harness('en', 'America/New_York');
  try {
    const before = structuredClone(getProject());
    await page.clock.fastForward(120000);
    assert.equal(await page.locator('#reportDate').inputValue(), '2026-10-28');
    await page.getByText('File options', { exact: true }).click();
    await page.getByRole('button', { name: 'Business time zone', exact: true }).click();
    await page.locator('#timeZoneInput').fill('Asia/Seoul');
    await page.locator('#timeZoneForm').getByRole('button', { name: 'Apply', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#reportDate')?.value === '2026-10-29');
    assert.deepEqual(getProject(), before);
    await page.reload();
    await page.locator('#reportDate').waitFor();
    assert.equal(await page.locator('#reportDate').inputValue(), '2026-10-29');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
test('midnight, wake and timers advance the default reporting date and record the new completion day', async () => {
  const { browser, page, errors, getProject } = await harness();
  try {
    await page.clock.fastForward(120000);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByRole('button', { name: '완료 체크', exact: true }).click();
    assert.equal(await page.locator('#reportDate').inputValue(), '2026-10-29');
    await page.locator('[data-check="t1"][data-item="i2"]').check();
    await page.waitForFunction(async () => (await window.desktop.snapshot()).revision > 1);
    assert.equal(getProject().tasks[0].items[1].doneDate, '2026-10-29');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
test('historical dates stay fixed; midnight never replaces an open editor and default report range catches up after cancel', async () => {
  const { browser, page, errors } = await harness();
  try {
    await page.locator('#reportDate').fill('2026-10-21');
    await page.getByRole('button', { name: '업무 · 일정', exact: true }).click();
    await page.getByRole('button', { name: '화면 설계', exact: true }).click();
    await page.locator('[name="name"]').fill('보존할 입력');
    await page.clock.fastForward(120000);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert.equal(await page.locator('[name="name"]').inputValue(), '보존할 입력');
    await page.getByRole('button', { name: '취소', exact: true }).click();
    assert.equal(await page.locator('#reportDate').inputValue(), '2026-10-21');
    await page.getByRole('button', { name: '보고서', exact: true }).click();
    assert.equal(await page.locator('#reportTo').inputValue(), '2026-10-29');
    await page.locator('#reportFrom').fill('2026-10-19');
    await page.locator('#reportTo').fill('2026-10-21');
    await page.locator('#reportDate').click();
    await page.clock.fastForward(86400000);
    await page.getByRole('button', { name: '프로젝트 현황', exact: true }).click();
    await page.getByRole('button', { name: '보고서', exact: true }).click();
    assert.equal(await page.locator('#reportTo').inputValue(), '2026-10-21');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
test('English screens persist selection, protect open or unsaved edits, preserve Korean project data and hide unselected bulk actions', async () => {
  const { browser, page, errors, getProject } = await harness('en');
  try {
    await page.getByRole('button', { name: 'Open', exact: true }).waitFor();
    await page.getByText('File options', { exact: true }).click();
    await page.getByRole('button', { name: 'Privacy policy', exact: true }).waitFor();
    await page.getByText('File options', { exact: true }).click();
    await page.getByRole('button', { name: 'Project overview', exact: true }).waitFor();
    await page.getByText('화면 회귀 검증', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'WBS · Baseline', exact: true }).click();
    assert.equal(await page.locator('.desktop-bulk-tools').isHidden(), true);
    await page.getByRole('button', { name: '화면 설계', exact: true }).click();
    await page.locator('[name="name"]').fill('저장');
    await page.locator('#languageSelect').selectOption('ko');
    assert.equal(await page.locator('#languageSelect').inputValue(), 'en');
    assert.equal(await page.locator('[name="name"]').inputValue(), '저장');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#editorDialog').open);
    assert.equal(getProject().tasks[0].name, '저장');
    await page.locator('#languageSelect').selectOption('ko');
    assert.equal(await page.locator('#languageSelect').inputValue(), 'en');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Saved to file', { exact: true }).waitFor();
    await page.locator('#languageSelect').selectOption('ko');
    await page.getByRole('button', { name: '프로젝트 현황', exact: true }).waitFor();
    assert.equal(getProject().tasks[0].name, '저장');
    await page.reload();
    await page.getByRole('button', { name: '프로젝트 현황', exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('the default date waits for an open editor, then advances after cancel without losing input', async () => {
  const { browser, page, errors } = await harness();
  try {
    await page.getByRole('button', { name: '업무 · 일정', exact: true }).click();
    await page.getByRole('button', { name: '화면 설계', exact: true }).click();
    await page.locator('[name="name"]').fill('자정 입력');
    await page.clock.fastForward(120000);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert.equal(await page.locator('#reportDate').inputValue(), '2026-10-28');
    assert.equal(await page.locator('[name="name"]').inputValue(), '자정 입력');
    await page.getByRole('button', { name: '취소', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#reportDate').value === '2026-10-29');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
