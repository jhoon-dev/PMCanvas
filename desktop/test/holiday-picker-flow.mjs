import { createRequire } from 'node:module';
import { rendererCommand } from './ui-actions.mjs';
import { readFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { DesktopDocument, parseDocument } from '../document.mjs';
import { assetPath } from '../assets.mjs';
const { chromium } = createRequire(new URL('../../web/package.json', import.meta.url))(
  '@playwright/test',
);
const selectMonth = async (page, value) => {
  await page.locator('[data-holiday-year]').selectOption(value.slice(0, 4));
  await page.locator('[data-holiday-month]').selectOption(value.slice(5));
};
const root = fileURLToPath(new URL('../app/', import.meta.url));
const browser = await chromium.launch({ headless: true });
mkdirSync('test-results', { recursive: true });
try {
  for (const language of ['ko', 'en']) {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-holidays-'));
    const model = new DesktopDocument(path.join(directory, 'recovery.json'));
    const file = path.join(directory, 'Holidays.pmcanvas');
    const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
    const errors = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.exposeFunction('holidayCall', (name, ...args) => {
        if (name === 'snapshot') return model.snapshot();
        if (name === 'settings') return { timeZone: 'Asia/Seoul', checkUpdatesOnStart: false };
        if (name === 'editing' || name === 'setLanguage') return;
        if (name === 'newProject') return model.create(args[0]);
        if (name === 'replace') return model.replace(...args);
        if (name === 'save') return model.save(file);
        throw Error('Unexpected holiday call: ' + name);
      });
      await page.addInitScript((language) => {
        localStorage.setItem('pmcanvas.language', language);
        window.desktop = Object.fromEntries(
          ['snapshot', 'settings', 'editing', 'setLanguage', 'newProject', 'replace', 'save'].map(
            (name) => [name, (...args) => window.holidayCall(name, ...args)],
          ),
        );
        window.desktop.onCommand = (callback) => {
          window.testCommand = callback;
        };
        window.desktop.onDocument = () => {};
      }, language);
      await page.route('https://desktop.test/**', (route) => {
        const asset = assetPath('pmcanvas://desktop' + new URL(route.request().url()).pathname);
        return asset
          ? route.fulfill({
              body: readFileSync(path.join(root, asset)),
              contentType: asset.endsWith('.html')
                ? 'text/html'
                : asset.endsWith('.css')
                  ? 'text/css'
                  : asset.endsWith('.png')
                    ? 'image/png'
                    : 'text/javascript',
            })
          : route.fulfill({ status: 404 });
      });
      await page.goto('https://desktop.test/index.html');
      await page.locator('#content [data-command="new"]').click();
      await page.locator('[name="name"]').fill('휴무 달력 검증');
      assert.equal(await page.locator('textarea[name="holidays"]').count(), 0);
      await selectMonth(page, '2028-02');
      await page.locator('[data-holiday-date="2028-02-29"]').click();
      await page.locator('#submitButton').click();
      await page.waitForFunction(() => !document.querySelector('#editorDialog').open);
      assert.deepEqual(model.project.holidays, ['2028-02-29']);
      // Existing project files can have holidays in a different order.
      model.replace({ ...model.project, holidays: ['2028-12-25', '2028-02-29'] }, model.revision);
      model.save(file);
      await page.reload();
      const before = structuredClone(model.project);
      const open = async () => {
        await page.locator('[data-view="overview"]').click();
        await rendererCommand(page, 'projectSettings');
        await page.locator('.holiday-picker').waitFor();
      };
      await open();
      assert.equal(
        await page.locator('[data-holiday-date="2028-02-29"]').getAttribute('aria-pressed'),
        'true',
      );
      assert.equal(await page.locator('[data-holiday-remove]').count(), 2);
      await page.locator('[data-holiday-date="2028-02-29"]').click();
      await page.locator('#cancelEditor').click();
      assert.deepEqual(model.project, before);
      assert.equal(model.dirty, false);
      await open();
      await page.locator('#submitButton').click();
      await page.waitForFunction(() => !document.querySelector('#editorDialog').open);
      assert.deepEqual(model.project, before);
      assert.equal(model.dirty, false, 'Opening and applying an unchanged calendar is a no-op.');
      await open();
      await page.locator('[data-holiday-date="2028-02-29"]').click();
      await page.locator('[data-holiday-date="2028-02-28"]').click();
      await page.keyboard.press('ArrowRight');
      assert.equal(
        await page
          .locator('[data-holiday-date="2028-02-29"]')
          .evaluate((el) => el === document.activeElement),
        true,
      );
      await page.keyboard.press('Space');
      assert.equal(
        await page.locator('[data-holiday-date="2028-02-29"]').getAttribute('aria-pressed'),
        'true',
      );
      await page.keyboard.press('Space');
      await selectMonth(page, '2028-12');
      await page.locator('[data-holiday-remove="2028-12-25"]').click();
      await page.locator('[data-holiday-date="2028-12-26"]').click();
      await selectMonth(page, '2027-05');
      assert.equal(await page.locator('[data-holiday-auto]').isChecked(), true);
      assert.equal(
        await page.locator('[data-holiday-date="2027-05-03"]').getAttribute('aria-disabled'),
        'true',
      );
      assert.match(
        await page.locator('[data-holiday-date="2027-05-03"]').getAttribute('aria-label'),
        language === 'ko' ? /노동절/ : /Labour Day/,
      );
      const manualBefore = await page.locator('[name="holidays"]').inputValue();
      await page.locator('[data-holiday-date="2027-05-03"]').evaluate((button) => button.click());
      assert.equal(await page.locator('[name="holidays"]').inputValue(), manualBefore);
      await page.locator('.holiday-picker').scrollIntoViewIfNeeded();
      await page.screenshot({ path: 'test-results/public-holidays-' + language + '.png' });
      await page.locator('[data-holiday-auto]').uncheck();
      await selectMonth(page, '2027-01');
      await page.locator('[data-holiday-date="2027-01-01"]').click();
      await page.locator('.holiday-picker').scrollIntoViewIfNeeded();
      await page.screenshot({ path: 'test-results/holiday-calendar-' + language + '.png' });
      await page.locator('#submitButton').click();
      await page.waitForFunction(() => !document.querySelector('#editorDialog').open);
      assert.deepEqual(model.project.holidays, ['2027-01-01', '2028-02-28', '2028-12-26']);
      await rendererCommand(page, 'save');
      await page.waitForFunction(() =>
        document
          .querySelector('#saveStatus')
          .textContent.includes(
            document.documentElement.lang === 'en' ? 'Saved to file' : '파일에 저장됨',
          ),
      );
      assert.deepEqual(parseDocument(readFileSync(file)).holidays, model.project.holidays);
      await page.reload();
      await open();
      assert.equal(
        await page.locator('[data-holiday-date="2027-01-01"]').getAttribute('aria-pressed'),
        'true',
      );
      assert.equal(await page.locator('[data-holiday-remove]').count(), 3);
      assert.equal(await page.locator('[data-holiday-auto]').isChecked(), false);
      await page.locator('[data-holiday-auto]').check();
      await selectMonth(page, '1900-01');
      assert.match(
        await page.locator('.holiday-picker .notice').innerText(),
        language === 'ko' ? /지원 범위 밖/ : /outside/,
      );
      assert.equal(await page.locator('[data-holiday-prev]').isDisabled(), true);
      await selectMonth(page, '2200-12');
      assert.equal(await page.locator('[data-holiday-next]').isDisabled(), true);
      assert.deepEqual(errors, []);
      console.log(
        'PASS: ' +
          language +
          ' holiday creation, existing dates, cancel/no-op, multiple years, leap day, keyboard selection and save/reload',
      );
    } finally {
      await page.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
} finally {
  await browser.close();
}
