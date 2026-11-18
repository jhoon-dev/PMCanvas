import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { DesktopWorkspace } from '../workspace.mjs';
import { today } from '../app/shared/engine.js';
import { appSection, nativeCommand, navigate } from './ui-actions.mjs';

// The real Windows DPAPI provider is exercised without a live OpenAI key or request.
if (process.platform !== 'win32') {
  console.log(
    'SKIP: native AI credential test requires Windows; provider-independent tests cover other platforms.',
  );
} else {
  const require = createRequire(import.meta.url);
  const { _electron: electron, expect } = createRequire(
    new URL('../../web/package.json', import.meta.url),
  )('@playwright/test');
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-ai-native-'));
  const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
  const output = path.join(root, 'test-results/ai-native');
  mkdirSync(output, { recursive: true });
  const installed = process.argv[2] === '--installed' ? process.argv[3] : null;
  const key = 'test-only-native-api-key';
  writeFileSync(
    path.join(temporary, 'preferences.json'),
    JSON.stringify({
      timeZone: 'Asia/Seoul',
      checkUpdatesOnStart: false,
      syncPublicHolidays: false,
    }),
  );
  const workspace = new DesktopWorkspace(path.join(temporary, 'workspace.json'));
  workspace.create({
    name: 'Desktop AI test',
    description: 'Private description',
    members: [],
    tasks: [],
    holidays: [],
  });
  workspace.save(path.join(temporary, 'AI.pmcanvas'));
  let application;
  let completed = false;
  let stage = 'launch';
  const checkpoint = (name) => {
    stage = name;
    console.log('Native AI: ' + name);
  };
  const watchdog = setTimeout(() => {
    console.error('Native AI timed out at: ' + stage);
    process.exitCode = 1;
    application?.process().kill('SIGKILL');
    setTimeout(() => process.exit(1), 2000);
  }, 180000);
  watchdog.unref();
  const launch = async () => {
    application = await electron.launch({
      timeout: 60000,
      executablePath: installed || require('electron'),
      args: installed ? ['--user-data-dir=' + temporary, '--lang=en-US'] : [root, '--lang=en-US'],
      env: { ...process.env, PMCANVAS_DESKTOP_TEST: '1', PMCANVAS_DESKTOP_DATA: temporary },
    });
    const page = await application.firstWindow();
    page.setDefaultTimeout(15000);
    await page.locator('[data-project-tab]').first().waitFor();
    await page.evaluate(() => localStorage.setItem('pmcanvas.language', 'ko'));
    await page.reload();
    await page.locator('[data-project-tab]').first().waitFor();
    return page;
  };
  try {
    let page = await launch();
    checkpoint('save-key');
    await appSection(page, 'ai', application);
    const form = page.locator('#aiSettingsForm');
    await form.locator('[name=apiKey]').fill(key);
    await form.locator('[type=submit]').click();
    await expect(page.locator('#aiSettingsStatus')).toContainText('저장했습니다');
    await expect(form.locator('[name=apiKey]')).toHaveValue('');
    checkpoint('reopen-settings');
    await appSection(page, 'general', application);
    await expect(page.locator('#languageSelect')).toBeEnabled();
    await appSection(page, 'ai', application);
    assert.ok(!readFileSync(path.join(temporary, 'ai-settings.json'), 'utf8').includes(key));
    assert.deepEqual(await page.evaluate(() => window.desktop.aiSettings()), {
      model: 'gpt-4.1-mini',
      hasApiKey: true,
      revision: 1,
    });
    await page.screenshot({ path: path.join(output, 'settings.png') });
    checkpoint('first-close');
    await application.close();
    application = null;
    checkpoint('restart');
    page = await launch();
    await application.evaluate(() => {
      globalThis.aiTestRequests = [];
      globalThis.fetch = async (url, options) => {
        const request = JSON.parse(options.body);
        globalThis.aiTestRequests.push({
          url,
          authorization: options.headers.Authorization,
          context: JSON.parse(request.input),
          store: request.store,
        });
        if (globalThis.aiTestRequests.length === 1)
          return new Response('private provider detail', { status: 401 });
        return new Response(
          JSON.stringify({
            status: 'completed',
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [
                  {
                    type: 'output_text',
                    text: JSON.stringify({ notes: '금주 AI 초안', nextNotes: '차주 AI 초안' }),
                  },
                ],
              },
            ],
          }),
        );
      };
    });
    if (await page.locator('#settingsPage').isVisible())
      await page.locator('#settingsBack').click();
    await navigate(page, 'weekly');
    await page.locator('[data-management-pane=add]').click();
    const weekly = page.locator('[data-pm-form=weekly]');
    await weekly.locator('[name=from]').fill(today());
    await weekly.locator('[name=to]').fill(today());
    await weekly.locator('[name=notes]').fill('기존 금주 설명');
    checkpoint('provider-failure');
    await weekly.locator('[data-pm-ai-draft]').click();
    await expect(page.locator('#pmManagement .pm-error')).toContainText(
      'AI 초안을 생성하지 못했습니다',
    );
    await expect(weekly.locator('[name=notes]')).toHaveValue('기존 금주 설명');
    checkpoint('generate-draft');
    await weekly.locator('[data-pm-ai-draft]').click();
    await expect(weekly.locator('[name=nextNotes]')).toHaveValue('차주 AI 초안');
    assert.equal(
      (await page.evaluate(() => window.desktop.snapshot())).project.weeklyReports?.length || 0,
      0,
    );
    const requests = await application.evaluate(() => globalThis.aiTestRequests);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].authorization, 'Bearer ' + key);
    assert.equal(requests[1].context.projectName, 'Desktop AI test');
    assert.equal(requests[1].context.description, undefined);
    assert.equal(requests[1].store, false);
    await page.screenshot({ path: path.join(output, 'draft.png') });
    await page.getByRole('button', { name: '입력 취소', exact: true }).click();
    checkpoint('delete-key');
    await appSection(page, 'ai', application);
    await page.locator('#aiSettingsForm [name=clearApiKey]').check();
    await page.locator('#aiSettingsForm [type=submit]').click();
    await expect(page.locator('#aiSettingsStatus')).toContainText('저장했습니다');
    assert.equal((await page.evaluate(() => window.desktop.aiSettings())).hasApiKey, false);
    assert.ok(!readFileSync(path.join(temporary, 'AI.pmcanvas'), 'utf8').includes(key));
    completed = true;
    console.log(
      'PASS: native encrypted AI settings, restart, draft generation, failure preserves input, key deletion and no project mutation.',
    );
  } catch (error) {
    console.error('Native AI failed at: ' + stage, error.stack || error.message);
    throw error;
  } finally {
    checkpoint('final-close');
    if (application && !completed) {
      await Promise.race([
        application.evaluate(({ app }) => app.exit(0)).catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
      if (application.process().exitCode === null) application.process().kill('SIGKILL');
    }
    if (completed) await application?.close();
    clearTimeout(watchdog);
    if (
      path.dirname(temporary) !== path.resolve(os.tmpdir()) ||
      !path.basename(temporary).startsWith('pmcanvas-ai-native-')
    )
      throw Error('Unsafe AI fixture cleanup path');
    rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}
