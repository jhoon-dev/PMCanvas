import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { _android as android } from 'playwright';
import { expect as playwrightExpect } from '@playwright/test';

const expect = playwrightExpect.configure({ timeout: 60000 });

const root = fileURLToPath(new URL('../', import.meta.url));
const appId = 'dev.jhoon.pmcanvas';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const name = 'PMCanvas-Android-' + stamp;
const output = path.join(root, 'test-results/android-native', stamp);
const apk =
  process.env.PM_ANDROID_APK ||
  path.join(root, 'android/app/build/outputs/apk/debug/app-debug.apk');
const steps = [],
  errors = [],
  consoleErrors = [];
const bootTimeout = Number(process.env.PM_ANDROID_BOOT_TIMEOUT_MS || 600000);
let device, page, projectId, environment, apkData, serial, previousIme;
const runFile = promisify(execFile);
const sdk =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  (process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android/Sdk'));
const adb = sdk
  ? path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
  : 'adb';
async function adbShell(...args) {
  return (await runFile(adb, ['-s', serial, 'shell', ...args], { timeout: 15000 })).stdout.trim();
}
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";

await mkdir(output, { recursive: true });
async function step(label, operation) {
  console.log('RUN  ' + label);
  const start = Date.now();
  try {
    await operation();
    steps.push({ label, status: 'passed', durationMs: Date.now() - start });
    console.log('PASS ' + label);
  } catch (error) {
    steps.push({ label, status: 'failed', durationMs: Date.now() - start, error: error.message });
    throw error;
  }
}
async function fillField(locator, value) {
  await locator.fill('');
  await expect(locator).toHaveValue('');
  if (value) await locator.fill(value);
  await locator.press('Tab');
  await expect(locator).toHaveValue(value);
}
async function attach() {
  page = await (await device.webView({ pkg: appId }, { timeout: 60000 })).page();
  page.setDefaultTimeout(60000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await expect(page.getByRole('button', { name: '＋ 새 프로젝트', exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => window.Capacitor.getPlatform()), 'android');
  environment.userAgent = await page.evaluate(() => navigator.userAgent);
}
async function screenshot(label, { webView = true } = {}) {
  await mkdir(output, { recursive: true });
  if (
    webView &&
    page &&
    !page.isClosed() &&
    (await page.evaluate(() => document.visibilityState)) === 'visible'
  ) {
    // Flush the WebView compositor before capturing the Android surface.
    await page.screenshot({ path: path.join(output, label + '-webview.png') });
  }
  await device.screenshot({ path: path.join(output, label + '.png') });
}
async function readExport(extension) {
  const text = (
    await device.shell(`run-as ${appId} cat ${quote('cache/exports/' + name + extension)}`)
  ).toString();
  await writeFile(path.join(output, 'project' + extension), text);
  return text;
}
async function nativeHierarchy(label) {
  const file = '/sdcard/pmcanvas-native-smoke.xml';
  let timeout;
  try {
    const result = await Promise.race([
      device.shell('uiautomator dump ' + file),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(Error('Android UI hierarchy did not become available within 30 seconds.')),
          30000,
        );
      }),
    ]);
    if (!/UI hier\w+ dumped to/.test(result.toString())) {
      // Android can briefly expose no accessibility root while opening a native activity.
      await writeFile(path.join(output, label + '-dump.txt'), result.toString());
      return '';
    }
  } finally {
    clearTimeout(timeout);
  }
  const xml = (await device.shell('cat ' + file)).toString();
  await writeFile(path.join(output, label + '.xml'), xml);
  return xml;
}
async function back() {
  await device.shell('input keyevent KEYCODE_BACK');
}
async function stopApp() {
  await device.shell(`am force-stop ${appId}`);
  await expect.poll(() => device.webViews().filter((view) => view.pkg() === appId).length).toBe(0);
}
async function waitForNative(label, pattern) {
  let xml;
  await expect
    .poll(async () => (xml = await nativeHierarchy(label)), { timeout: 90000 })
    .toMatch(pattern);
  return xml;
}
async function nativeTap(selector) {
  let matches;
  await expect
    .poll(
      async () => {
        const xml = await nativeHierarchy('native-navigation');
        const nodes = [...xml.matchAll(/<node\b[^>]*>/g)].map(([tag]) =>
          Object.fromEntries(
            [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]),
          ),
        );
        matches = nodes.filter((node) =>
          Object.entries(selector).every(([key, value]) =>
            value instanceof RegExp ? value.test(node[key] || '') : node[key] === value,
          ),
        );
        return matches.length;
      },
      { timeout: 60000 },
    )
    .toBe(1);
  const bounds = matches[0].bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  assert.ok(bounds, 'The native control must have screen bounds.');
  const [, left, top, right, bottom] = bounds.map(Number);
  await device.shell(
    `input tap ${Math.floor((left + right) / 2)} ${Math.floor((top + bottom) / 2)}`,
  );
}

try {
  const listed = (await runFile(adb, ['devices'])).stdout;
  const candidates = [...listed.matchAll(/^(emulator-\d+)\s+device\s*$/gm)]
    .map((match) => match[1])
    .filter((entry) => !process.env.PM_ANDROID_SERIAL || entry === process.env.PM_ANDROID_SERIAL);
  assert.equal(
    candidates.length,
    1,
    'Start one Android emulator, or set PM_ANDROID_SERIAL to its serial.',
  );
  serial = candidates[0];
  const version = await adbShell('getprop', 'ro.build.version.release');
  apkData = await readFile(apk);
  environment = {
    android: version,
    sdk: await adbShell('getprop', 'ro.build.version.sdk'),
    fingerprint: await adbShell('getprop', 'ro.build.fingerprint'),
    apkSha256: createHash('sha256').update(apkData).digest('hex'),
  };
  console.log(`Device: ${serial} / Android ${version}`);
  await step('wait for Android system startup to finish', async () => {
    await expect
      .poll(() => adbShell('getprop', 'sys.boot_completed'), {
        timeout: bootTimeout,
        intervals: [1000, 2000, 5000],
      })
      .toBe('1');
    await expect
      .poll(() => adbShell('getprop', 'init.svc.bootanim'), {
        timeout: bootTimeout,
        intervals: [1000, 2000, 5000],
      })
      .toBe('stopped');
  });
  previousIme = await adbShell('settings', 'get', 'secure', 'show_ime_with_hard_keyboard');
  await adbShell('settings', 'put', 'secure', 'show_ime_with_hard_keyboard', '0');
  // WebView discovery polls the guest frequently; start it only after OS startup.
  device = (await android.devices({ omitDriverInstall: true })).find(
    (entry) => entry.serial() === serial,
  );
  assert.ok(device, 'The selected emulator must remain connected after boot.');
  device.setDefaultTimeout(30000);
  await device.shell('input keyevent KEYCODE_WAKEUP');
  await step('install and launch the real APK', async () => {
    await device.installApk(apkData);
    await stopApp();
    const launch = (await device.shell(`am start -W -n ${appId}/.MainActivity`)).toString();
    assert.doesNotMatch(launch, /Error|Exception/, launch);
    await attach();
    await screenshot('01-projects');
  });
  await step(
    'create a durable project, immediately restart, then create and edit a member',
    async () => {
      await page.getByRole('button', { name: '＋ 새 프로젝트', exact: true }).click();
      await fillField(page.locator('[name="name"]'), name);
      await fillField(page.locator('[name="description"]'), 'Android 에뮬레이터 기능 검증');
      await page.getByRole('button', { name: '저장', exact: true }).click();
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
      projectId = page.url().split('/').at(-1);
      await stopApp();
      await device.shell(`am start -n ${appId}/.MainActivity`);
      await attach();
      await page.getByRole('button', { name: new RegExp(name) }).click();
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
      await page.getByRole('link', { name: '더보기', exact: true }).click();
      await page.getByRole('button', { name: '＋ 추가', exact: true }).click();
      await fillField(page.locator('[name="name"]'), '모바일 담당자');
      await page.getByRole('button', { name: '저장', exact: true }).click();
      await expect(page.getByText('모바일 담당자', { exact: true })).toBeVisible();
      await page.locator('.member-row').filter({ hasText: '모바일 담당자' }).click();
      await fillField(page.locator('[name="role"]'), 'Android QA');
      await fillField(page.locator('[name="hours"]'), '6');
      await fillField(page.locator('[name="allocation"]'), '80');
      await page.getByRole('button', { name: '저장', exact: true }).click();
      await expect(page.locator('.member-row')).toContainText('Android QA');
      await expect(page.locator('.member-row')).toContainText('6h / 일 · 80%');
    },
  );
  await step('create and edit a task with a weighted checklist', async () => {
    await page.getByRole('link', { name: '업무', exact: true }).click();
    await page
      .locator('.section-heading')
      .getByRole('button', { name: '＋ 업무 추가', exact: true })
      .click();
    await fillField(page.locator('[name="name"]'), 'Android 주요 기능');
    await fillField(page.locator('[name="itemTitle"]'), '프로젝트 저장');
    await fillField(page.locator('[name="itemHours"]'), '2');
    await page.getByRole('button', { name: '＋ 세부 작업 추가', exact: true }).click();
    await fillField(page.locator('[name="itemTitle"]').nth(1), '파일 가져오기와 공유');
    await fillField(page.locator('[name="itemHours"]').nth(1), '6');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await page.getByRole('button', { name: 'Android 주요 기능', exact: true }).click();
    await fillField(page.locator('[name="name"]'), 'Android 주요 기능 검증');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Android 주요 기능 검증', exact: true }),
    ).toBeVisible();
  });
  await step('check an item, filter tasks and calculate 25 percent progress', async () => {
    await page.getByRole('link', { name: '완료 체크', exact: true }).click();
    await page.getByRole('checkbox', { name: /프로젝트 저장/ }).click();
    await expect(page.locator('[data-item]')).toHaveCount(1);
    await page.getByLabel('할 일만', { exact: true }).uncheck();
    await expect(page.locator('[data-item]:checked')).toHaveCount(1);
    await screenshot('02-checklist');
    await page.getByRole('link', { name: '업무', exact: true }).click();
    await fillField(page.getByRole('searchbox', { name: '업무 검색' }), '없는 업무');
    await expect(page.getByRole('heading', { name: '검색 결과가 없습니다' })).toBeVisible();
    await fillField(page.getByRole('searchbox', { name: '업무 검색' }), '');
    const ownerId = await page.locator('#owner option').nth(1).getAttribute('value');
    await page.getByLabel('담당자 필터').selectOption(ownerId);
    await expect(page.locator('.task-card')).toHaveCount(1);
    await page.getByLabel('담당자 필터').selectOption('');
    await page.getByRole('link', { name: '현황', exact: true }).click();
    await expect(page.locator('.hero-progress strong')).toHaveText('25%');
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await screenshot('03-overview');
  });
  await step('undo and redo while network requests are offline', async () => {
    await page.context().setOffline(true);
    try {
      await page.getByRole('link', { name: '더보기', exact: true }).click();
      await page.getByRole('button', { name: '↶ 실행 취소', exact: true }).click();
      await page.getByRole('link', { name: '현황', exact: true }).click();
      await expect(page.locator('.hero-progress strong')).toHaveText('0%');
      await page.getByRole('link', { name: '더보기', exact: true }).click();
      await page.getByRole('button', { name: '↷ 다시 실행', exact: true }).click();
      await page.getByRole('link', { name: '현황', exact: true }).click();
      await expect(page.locator('.hero-progress strong')).toHaveText('25%');
    } finally {
      await page.context().setOffline(false);
    }
  });
  await step('Android Back cancels editing without losing the saved project', async () => {
    await page.getByRole('link', { name: '업무', exact: true }).click();
    await page.getByRole('button', { name: 'Android 주요 기능 검증', exact: true }).click();
    await fillField(page.locator('[name="name"]'), '취소할 수정');
    await back();
    try {
      await expect(page.locator('#editor')).not.toBeVisible({ timeout: 3000 });
    } catch {
      // If the software keyboard consumed Back, the second press closes the editor.
      await back();
    }
    await expect(page.locator('#editor')).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Android 주요 기능 검증', exact: true }),
    ).toBeVisible();
    await back();
    await expect(page.getByRole('heading', { name: '나의 프로젝트' })).toBeVisible();
  });
  await step('force-stop and relaunch restore persisted project and completion', async () => {
    await stopApp();
    await device.shell(`am start -n ${appId}/.MainActivity`);
    await attach();
    await page.getByRole('button', { name: new RegExp(name) }).click();
    await expect(page.locator('.hero-progress strong')).toHaveText('25%');
  });
  await step(
    'native project sharing writes a valid backup and opens Android Sharesheet',
    async () => {
      await page.getByRole('link', { name: '더보기', exact: true }).click();
      await page.getByRole('button', { name: '프로젝트 내보내기', exact: true }).click();
      const xml = await waitForNative('04-share', /chooser|resolver/i);
      assert.match(xml, /chooser|resolver/i, 'Android share UI must be visible.');
      await screenshot('04-share', { webView: false });
      const backup = JSON.parse(await readExport('.pmcanvas'));
      assert.equal(backup.format, 'pm-canvas-project');
      assert.equal(backup.project.name, name);
      assert.equal(backup.project.tasks[0].items[0].hours, 2);
      assert.ok(backup.project.tasks[0].items[0].doneDate);
      await back();
      await expect(
        page.getByRole('button', { name: '프로젝트 내보내기', exact: true }),
      ).toBeEnabled();
    },
  );
  await step('native CSV sharing writes a report', async () => {
    await page.getByRole('button', { name: '업무 보고서 CSV', exact: true }).click();
    const xml = await waitForNative('05-csv-share', /chooser|resolver/i);
    assert.match(xml, /chooser|resolver/i);
    await screenshot('05-csv-share', { webView: false });
    const listing = (await device.shell(`run-as ${appId} ls cache/exports`)).toString();
    const file = listing
      .split(/\r?\n/)
      .find((entry) => entry.startsWith(name + '-') && entry.endsWith('.csv'));
    assert.ok(file, 'CSV report must exist in the app cache.');
    const csv = (
      await device.shell(`run-as ${appId} cat ${quote('cache/exports/' + file)}`)
    ).toString();
    assert.ok(csv.includes('Android 주요 기능 검증'));
    await writeFile(path.join(output, 'report.csv'), csv);
    await back();
    await expect(
      page.getByRole('button', { name: '프로젝트 가져오기', exact: true }),
    ).toBeEnabled();
  });
  await step('the Android document picker imports an exported pmcanvas file', async () => {
    await device.push(
      await readFile(path.join(output, 'project.pmcanvas')),
      '/sdcard/Download/PMCanvas-Native-Smoke.pmcanvas',
    );
    await page.getByRole('button', { name: '프로젝트 가져오기', exact: true }).click();
    await waitForNative('06-picker-initial', /documentsui/i);
    await screenshot('06-picker-initial', { webView: false });
    await nativeTap({ 'content-desc': /Show roots|Open navigation drawer|루트 표시|탐색 창 열기/ });
    await nativeTap({ text: /^(Downloads|다운로드)$/, 'resource-id': 'android:id/title' });
    await screenshot('06-picker-downloads', { webView: false });
    await nativeTap({ text: 'PMCanvas-Native-Smoke.pmcanvas', enabled: 'true' });
    await expect(page.locator('.hero-progress strong')).toHaveText('25%');
    const importedId = page.url().split('/').at(-1);
    assert.notEqual(importedId, projectId, 'Import must create a copy.');
    await screenshot('07-imported');
    await page.getByRole('link', { name: '← 프로젝트', exact: true }).click();
    await expect(page.locator('.project-card').filter({ hasText: name })).toHaveCount(2);
  });
  await step('delete task, member and imported project without changing the original', async () => {
    await page.locator('.project-card').filter({ hasText: name }).first().click();
    await page.getByRole('link', { name: '업무', exact: true }).click();
    await page.getByRole('button', { name: 'Android 주요 기능 검증', exact: true }).click();
    await page.locator('#deleteItem').click();
    await page.locator('#confirmation').getByRole('button', { name: '취소', exact: true }).click();
    await expect(page.locator('#editor')).toBeVisible();
    await page.locator('#deleteItem').click();
    await page.locator('#confirmation').getByRole('button', { name: '삭제', exact: true }).click();
    await expect(page.locator('.task-card')).toHaveCount(0);
    await page.getByRole('link', { name: '더보기', exact: true }).click();
    await page.locator('.member-row').click();
    await page.locator('#deleteItem').click();
    await page.locator('#confirmation').getByRole('button', { name: '삭제', exact: true }).click();
    await expect(page.locator('.member-row')).toHaveCount(0);
    await page.getByRole('button', { name: '이 프로젝트 삭제', exact: true }).click();
    await page.locator('#confirmation').getByRole('button', { name: '삭제', exact: true }).click();
    await expect(page.locator('.project-card').filter({ hasText: name })).toHaveCount(1);
    await page.locator('.project-card').filter({ hasText: name }).click();
    assert.equal(page.url().split('/').at(-1), projectId, 'The original project must remain.');
    await expect(page.locator('.hero-progress strong')).toHaveText('25%');
    await screenshot('08-original-preserved');
  });
  assert.deepEqual(errors, [], 'The installed app must not throw JavaScript errors.');
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
  if (device) {
    await screenshot('failure', { webView: false }).catch(() => {});
    await nativeHierarchy('failure').catch(() => {});
  }
  if (page && !page.isClosed()) {
    await writeFile(
      path.join(output, 'page-state.json'),
      JSON.stringify(
        await page.evaluate(() => ({
          url: location.href,
          text: document.body.innerText,
          invalidFields: [...document.querySelectorAll(':invalid')].map((element) => ({
            name: element.name,
            value: element.value,
            message: element.validationMessage,
          })),
        })),
        null,
        2,
      ),
    ).catch(() => {});
  }
} finally {
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, 'results.json'),
    JSON.stringify(
      {
        appId,
        project: name,
        apk,
        serial,
        model: device?.model(),
        environment,
        steps,
        errors,
        consoleErrors,
      },
      null,
      2,
    ) + '\n',
  );
  await device?.close();
  if (previousIme !== undefined) {
    await (
      previousIme === 'null'
        ? adbShell('settings', 'delete', 'secure', 'show_ime_with_hard_keyboard')
        : adbShell('settings', 'put', 'secure', 'show_ime_with_hard_keyboard', previousIme)
    ).catch(() => {});
  }
  console.log('Android test artifacts: ' + output);
}
