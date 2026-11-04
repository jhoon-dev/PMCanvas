import { navigate, rendererCommand } from './ui-actions.mjs';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { DesktopWorkspace } from '../workspace.mjs';
import { assetPath } from '../assets.mjs';

const { chromium } = createRequire(new URL('../../web/package.json', import.meta.url))(
  '@playwright/test',
);
const root = fileURLToPath(new URL('../app/', import.meta.url));
const output = path.resolve('test-results/ux-flows');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const language of ['ko', 'en']) {
    const temporary = mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-ux-'));
    const document = new DesktopWorkspace(path.join(temporary, 'workspace.json'));
    const errors = [];
    const calls = [];
    let editing = false;
    let openError = false;
    let cancelCreation = false;
    let cancelClose = false;
    let releaseSave;
    const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
    page.setDefaultTimeout(10000);
    try {
      page.on('pageerror', (error) => errors.push(error.message));
      await page.exposeFunction('uxCall', async (method, ...args) => {
        calls.push(method);
        if (method === 'snapshot') return document.snapshot();
        if (method === 'settings') return { timeZone: 'Asia/Seoul' };
        if (method === 'setLanguage') return;
        if (method === 'editing') {
          editing = args[0];
          return;
        }
        if (method === 'newProject') {
          assert.equal(editing, false, 'Native leave checks run after releasing the editor lock.');
          if (cancelCreation) return null;
          return document.create(args[0]);
        }
        if (method === 'open') {
          if (openError) throw Error('파일을 열지 못했습니다. 다시 선택해 주세요.');
          return null;
        }
        if (method === 'save') {
          await new Promise((resolve) => {
            releaseSave = resolve;
          });
          return document.save(path.join(temporary, 'Saved.pmcanvas'));
        }
        if (method === 'closeProject') {
          assert.equal(editing, false);
          return cancelClose ? null : document.close();
        }
        throw Error('Unexpected UX test call: ' + method);
      });
      await page.addInitScript((selectedLanguage) => {
        localStorage.setItem('pmcanvas.language', selectedLanguage);
        window.desktop = Object.fromEntries(
          [
            'snapshot',
            'settings',
            'setLanguage',
            'editing',
            'newProject',
            'open',
            'save',
            'closeProject',
          ].map((method) => [method, (...args) => window.uxCall(method, ...args)]),
        );
        window.desktop.onCommand = (callback) => {
          window.uxCommand = callback;
        };
        window.desktop.onDocument = () => {};
      }, language);
      await page.route('https://desktop.test/**', async (route) => {
        const asset = assetPath('pmcanvas://desktop' + new URL(route.request().url()).pathname);
        if (!asset) return route.fulfill({ status: 404, body: 'Not found' });
        await route.fulfill({
          contentType: asset.endsWith('.html')
            ? 'text/html'
            : asset.endsWith('.css')
              ? 'text/css'
              : asset.endsWith('.png')
                ? 'image/png'
                : 'text/javascript',
          body: readFileSync(path.join(root, asset)),
        });
      });
      await page.goto('https://desktop.test/index.html');
      await page.locator('#content [data-command="new"]').waitFor();
      await rendererCommand(page, 'appSettings');
      assert.equal(await page.locator('#settingsPage').isVisible(), true);
      assert.equal(await page.locator('#projectWorkspace').isHidden(), true);
      assert.equal(await page.locator('#projectSidebar').isHidden(), true);
      assert.equal(await page.locator('#settingsSidebar').isVisible(), true);
      assert.equal(await page.locator('#languageSelect').isEnabled(), true);
      assert.equal(await page.locator('.desktop-sidebar #languageSelect').count(), 0);
      assert.equal(await page.locator('#content').isHidden(), true);
      assert.equal(await page.locator('#settingsPage [data-action="settings"]').count(), 0);
      await page.locator('#settingsBack').click();
      assert.equal(await page.locator('#content [data-command="new"]').isVisible(), true);
      assert.equal(await page.locator('[data-completion-hint], .desktop-footer').count(), 0);
      const initial = document.snapshot();
      const initialCalls = calls.length;
      for (const view of ['overview', 'tasks', 'daily', 'people', 'reports', 'management']) {
        const button = page.locator('[data-view="' + view + '"]');
        assert.equal(
          await button.isEnabled(),
          true,
          'Menus remain usable and explain prerequisites.',
        );
        await button.click();
        await page.locator('#actionGuideDialog[open]').waitFor();
        assert.equal(
          await page.locator('#actionGuidePrimary').innerText(),
          language === 'ko' ? '프로젝트 만들기' : 'Create project',
        );
        assert.equal(await page.locator('#actionGuideSecondary').isVisible(), true);
        assert.equal(await page.locator('[data-view].active').count(), 0);
        await page.locator('#actionGuideCancel').click();
        assert.equal(await button.evaluate((element) => element === document.activeElement), true);
      }
      for (const command of [
        'save',
        'saveAs',
        'exportWeb',
        'exportExcel',
        'importExcel',
        'exportTemplate',
      ]) {
        await page.evaluate((name) => window.uxCommand(name), command);
        await page.locator('#actionGuideDialog[open]').waitFor();
        await page.keyboard.press('Escape');
      }
      assert.equal(
        calls.length,
        initialCalls,
        'Missing-project actions do not invoke file operations.',
      );
      assert.deepEqual(document.snapshot(), initial);
      await page.locator('[data-view="tasks"]').click();
      await page.screenshot({ path: path.join(output, language + '-project-guide.png') });
      await page.locator('#actionGuidePrimary').click();
      await page.locator('#editorDialog[open]').waitFor();
      await page.locator('#dialogBody [name="name"]').fill('취소할 프로젝트');
      await page.locator('#cancelEditor').click();
      assert.deepEqual(
        document.snapshot(),
        initial,
        'Cancel never creates a project or recovery file.',
      );
      assert.equal(calls.includes('newProject'), false);
      assert.equal(editing, false);
      await page.locator('[data-view="reports"]').click();
      await page.locator('#actionGuideSecondary').click();
      await page.waitForFunction(() => !document.querySelector('#actionGuideDialog').open);
      assert.deepEqual(document.snapshot(), initial, 'Canceling Open keeps the welcome state.');
      openError = true;
      await page.locator('[data-view="reports"]').click();
      await page.locator('#actionGuideSecondary').click();
      await page.locator('#toast').filter({ hasText: '파일을 열지 못했습니다' }).waitFor();
      assert.equal(await page.locator('#content').evaluate((element) => element.inert), false);
      openError = false;
      await page.locator('#content [data-command="new"]').click();
      await page.locator('#dialogBody [name="name"]').fill('고객 프로젝트');
      await page.locator('#submitButton').click();
      await page.waitForFunction(() => !document.querySelector('#editorDialog').open);
      assert.equal(document.project.name, '고객 프로젝트');
      await page.setViewportSize({ width: 1440, height: 1000 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight),
        true,
        'An empty project must fit the viewport without a vertical scrollbar.',
      );
      await page.setViewportSize({ width: 1000, height: 720 });
      assert.equal(calls.filter((method) => method === 'newProject').length, 1);
      assert.equal(editing, false);
      await navigate(page, 'planning');
      for (const action of ['schedule', 'baseline']) {
        await page.locator('[data-action="' + action + '"]').click();
        await page.locator('#actionGuideDialog[open]').waitFor();
        assert.equal(await page.locator('#actionGuideSecondary').isHidden(), true);
        await page.locator('#actionGuideCancel').click();
      }
      await page.locator('[data-action="schedule"]').click();
      await page.locator('#actionGuidePrimary').click();
      await page.locator('#editorDialog[open]').waitFor();
      assert.equal(await page.locator('.remove-item').isDisabled(), true);
      await page.locator('#addItem').click();
      assert.equal(await page.locator('.remove-item:enabled').count(), 2);
      await page.locator('.remove-item').last().click();
      assert.equal(await page.locator('.item-editor').count(), 1);
      assert.equal(await page.locator('.remove-item').isDisabled(), true);
      await page.locator('#cancelEditor').click();
      await navigate(page, 'resources');
      await page.locator('.management-page-nav [data-management-pane="add"]').click();
      const staffing = page.locator('[data-pm-form="staffing"]');
      assert.equal(await staffing.locator('[name="memberId"]').count(), 0);
      await staffing.locator('[data-action="member"]').click();
      await page.locator('#editorDialog[open]').waitFor();
      await page.locator('#cancelEditor').click();
      await page.locator('[data-view="management"]').click();
      await page.locator('.management-page-nav [data-management-pane="add"]').click();
      const issue = page.locator('[data-pm-form="issue"]').first();
      await issue.locator('[name="title"]').fill('보존할 이슈 입력');
      await page.locator('[data-view="management"]').click();
      assert.equal(await issue.locator('[name="title"]').inputValue(), '보존할 이슈 입력');
      await page.locator('.management-page-nav [data-management-pane="list"]').click();
      await page.locator('#messageDialog[open] [data-response="1"]').click();
      assert.equal(await issue.locator('[name="title"]').inputValue(), '보존할 이슈 입력');
      assert.equal(await page.locator('[data-pm-form="issue"]').count(), 1);
      assert.equal(await page.locator('.management-page-nav [aria-current="page"]').count(), 0);
      await page.locator('[data-view="reports"]').click();
      await page.locator('#messageDialog[open] [data-response="1"]').click();
      assert.equal(
        await page.locator('[data-pm-form="issue"]').count(),
        1,
        'Unsaved issue input blocks leaving the screen.',
      );
      assert.equal(await issue.locator('[name="title"]').inputValue(), '보존할 이슈 입력');
      await issue.locator('[data-pm-reset]').click();
      await navigate(page, 'weekly');
      await page.locator('.management-page-nav [data-management-pane="add"]').click();
      const weekly = page.locator('[data-pm-form="weekly"]');
      await weekly.locator('[name="notes"]').fill('취소할 주간보고 입력');
      await page.locator('[data-view="reports"]').click();
      await page.keyboard.press('Escape');
      assert.equal(await weekly.locator('[name="notes"]').inputValue(), '취소할 주간보고 입력');
      await weekly.locator('[data-pm-reset]').click();
      assert.equal(await weekly.locator('[name="notes"]').inputValue(), '');
      assert.equal(editing, false);
      const beforeReplacement = document.snapshot();
      cancelCreation = true;
      await rendererCommand(page, 'new');
      await page.locator('#dialogBody [name="name"]').fill('보존할 새 프로젝트 입력');
      await page.locator('#submitButton').click();
      await page.waitForFunction(() => !document.querySelector('#editorForm').inert);
      assert.deepEqual(document.snapshot(), beforeReplacement);
      assert.equal(editing, true, 'Canceling the native leave prompt keeps the draft protected.');
      assert.equal(
        await page.locator('#dialogBody [name="name"]').inputValue(),
        '보존할 새 프로젝트 입력',
      );
      await page.locator('#cancelEditor').click();
      await page.evaluate(() => window.uxCommand('save'));
      await page
        .locator('#saveStatus')
        .filter({ hasText: language === 'ko' ? '처리 중' : 'Working' })
        .waitFor();
      assert.equal(await page.locator('#content').evaluate((element) => element.inert), true);
      await page.evaluate(() => window.uxCommand('new'));
      assert.equal(await page.locator('#editorDialog').evaluate((dialog) => dialog.open), false);
      await page.screenshot({ path: path.join(output, language + '-busy.png') });
      releaseSave();
      await page.locator('#saveStatus').waitFor({ state: 'hidden' });
      assert.equal(await page.locator('#content').evaluate((element) => element.inert), false);
      assert.equal(document.dirty, false);
      await page.locator('[data-view="tasks"]').click();
      await page.locator('#search').fill('보존할 필터');
      const beforeClose = document.snapshot();
      cancelClose = true;
      await rendererCommand(page, 'closeProject');
      await page.waitForFunction(() => !document.querySelector('#content').inert);
      assert.deepEqual(document.snapshot(), beforeClose);
      assert.equal(await page.locator('#search').inputValue(), '보존할 필터');
      cancelClose = false;
      await page.evaluate(() => window.uxCommand('closeProject'));
      await page.locator('#content [data-command="new"]').waitFor();
      assert.equal(document.project, null);
      assert.equal(await page.locator('[data-view].active').count(), 0);
      assert.equal(document.snapshot().canUndo, false);
      await page.waitForFunction(() => document.activeElement?.dataset.command === 'new');
      await page.screenshot({ path: path.join(output, language + '-closed-project.png') });
      assert.equal(await page.locator('[data-completion-hint], .desktop-footer').count(), 0);
      const closeCalls = calls.filter((method) => method === 'closeProject').length;
      await page.evaluate(() => window.uxCommand('closeProject'));
      await page
        .locator('#toast')
        .filter({
          hasText: language === 'ko' ? '열려 있는 프로젝트가 없습니다' : 'There is no open project',
        })
        .waitFor();
      assert.equal(calls.filter((method) => method === 'closeProject').length, closeCalls);
      await page.reload();
      await page.locator('#content [data-command="new"]').waitFor();
      assert.deepEqual(document.recovery(), {
        workspace: true,
        tabs: [],
        activeId: null,
        dirty: false,
      });
      await page.locator('[data-view="tasks"]').click();
      await page.locator('#actionGuideDialog[open]').waitFor();
      assert.deepEqual(errors, []);
      console.log(
        'PASS: ' +
          language +
          ' project guidance, creation/open cancellation, empty prerequisites, checklist and busy feedback',
      );
    } finally {
      releaseSave?.();
      await page.close();
      rmSync(temporary, { recursive: true, force: true });
    }
  }
} finally {
  await browser.close();
}
