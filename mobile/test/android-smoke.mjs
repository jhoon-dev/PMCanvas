import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
const bootTimeout = Number(process.env.PM_ANDROID_BOOT_TIMEOUT_MS || 180000);
let device, page, projectId, environment;
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
async function attach() {
  page = await (await device.webView({ pkg: appId }, { timeout: 60000 })).page();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await expect(page.getByRole('button', { name: '＋ 새 프로젝트', exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => window.Capacitor.getPlatform()), 'android');
}
async function screenshot(label) {
  await mkdir(output, { recursive: true });
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
    await Promise.race([
      device.shell('uiautomator dump ' + file),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(Error('Android UI hierarchy did not become available within 30 seconds.')),
          30000,
        );
      }),
    ]);
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
async function nativeTap(selector) {
  const xml = await nativeHierarchy('native-navigation');
  const nodes = [...xml.matchAll(/<node\b[^>]*>/g)].map(([tag]) =>
    Object.fromEntries(
      [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]),
    ),
  );
  const matches = nodes.filter((node) =>
    Object.entries(selector).every(([key, value]) =>
      value instanceof RegExp ? value.test(node[key] || '') : node[key] === value,
    ),
  );
  assert.equal(matches.length, 1, `Expected one native control: ${JSON.stringify(selector)}`);
  const bounds = matches[0].bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  assert.ok(bounds, 'The native control must have screen bounds.');
  const [, left, top, right, bottom] = bounds.map(Number);
  await device.shell(
    `input tap ${Math.floor((left + right) / 2)} ${Math.floor((top + bottom) / 2)}`,
  );
}

try {
  const devices = await android.devices({ omitDriverInstall: true });
  const candidates = devices.filter(
    (entry) =>
      entry.serial().startsWith('emulator-') &&
      (!process.env.PM_ANDROID_SERIAL || entry.serial() === process.env.PM_ANDROID_SERIAL),
  );
  assert.equal(
    candidates.length,
    1,
    'Start one Android emulator, or set PM_ANDROID_SERIAL to its serial.',
  );
  device = candidates[0];
  device.setDefaultTimeout(30000);
  const version = (await device.shell('getprop ro.build.version.release')).toString().trim();
  environment = {
    android: version,
    sdk: (await device.shell('getprop ro.build.version.sdk')).toString().trim(),
    fingerprint: (await device.shell('getprop ro.build.fingerprint')).toString().trim(),
    apkSha256: createHash('sha256')
      .update(await readFile(apk))
      .digest('hex'),
  };
  console.log(`Device: ${device.serial()} / ${device.model()} / Android ${version}`);
  await step('wait for Android system startup to finish', async () => {
    await expect
      .poll(async () => (await device.shell('getprop sys.boot_completed')).toString().trim(), {
        timeout: bootTimeout,
        intervals: [1000, 2000, 5000],
      })
      .toBe('1');
    await expect
      .poll(async () => (await device.shell('getprop init.svc.bootanim')).toString().trim(), {
        timeout: bootTimeout,
        intervals: [1000, 2000, 5000],
      })
      .toBe('stopped');
  });
  await device.shell('input keyevent KEYCODE_WAKEUP');
  await step('install and launch the real APK', async () => {
    await device.installApk(await readFile(apk));
    await device.shell(`am force-stop ${appId}`);
    const launch = (await device.shell(`am start -W -n ${appId}/.MainActivity`)).toString();
    assert.doesNotMatch(launch, /Error|Exception/, launch);
    await attach();
    await screenshot('01-projects');
  });
  await step('create a project and member in the native WebView', async () => {
    await page.getByRole('button', { name: '＋ 새 프로젝트', exact: true }).click();
    await page.locator('[name="name"]').fill(name);
    await page.locator('[name="description"]').fill('Android 에뮬레이터 기능 검증');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    projectId = page.url().split('/').at(-1);
    await page.getByRole('link', { name: '더보기', exact: true }).click();
    await page.getByRole('button', { name: '＋ 추가', exact: true }).click();
    await page.locator('[name="name"]').fill('모바일 담당자');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await expect(page.getByText('모바일 담당자', { exact: true })).toBeVisible();
    await page.locator('.member-row').filter({ hasText: '모바일 담당자' }).click();
    await page.locator('[name="role"]').fill('Android QA');
    await page.locator('[name="hours"]').fill('6');
    await page.locator('[name="allocation"]').fill('80');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await expect(page.locator('.member-row')).toContainText('Android QA');
    await expect(page.locator('.member-row')).toContainText('6h / 일 · 80%');
  });
  await step('create and edit a task with a weighted checklist', async () => {
    await page.getByRole('link', { name: '업무', exact: true }).click();
    await page
      .locator('.section-heading')
      .getByRole('button', { name: '＋ 업무 추가', exact: true })
      .click();
    await page.locator('[name="name"]').fill('Android 주요 기능');
    await page.locator('[name="itemTitle"]').fill('프로젝트 저장');
    await page.locator('[name="itemHours"]').fill('2');
    await page.getByRole('button', { name: '＋ 세부 작업 추가', exact: true }).click();
    await page.locator('[name="itemTitle"]').nth(1).fill('파일 가져오기와 공유');
    await page.locator('[name="itemHours"]').nth(1).fill('6');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await page.getByRole('button', { name: 'Android 주요 기능', exact: true }).click();
    await page.locator('[name="name"]').fill('Android 주요 기능 검증');
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
    await page.getByRole('searchbox', { name: '업무 검색' }).fill('없는 업무');
    await expect(page.getByRole('heading', { name: '검색 결과가 없습니다' })).toBeVisible();
    await page.getByRole('searchbox', { name: '업무 검색' }).fill('');
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
    await page.locator('[name="name"]').fill('취소할 수정');
    await back();
    if (await page.locator('#editor').isVisible()) await back();
    await expect(page.locator('#editor')).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Android 주요 기능 검증', exact: true }),
    ).toBeVisible();
    await back();
    await expect(page.getByRole('heading', { name: '나의 프로젝트' })).toBeVisible();
  });
  await step('force-stop and relaunch restore persisted project and completion', async () => {
    await device.shell(`am force-stop ${appId}`);
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
      const xml = await nativeHierarchy('04-share');
      assert.match(xml, /chooser|resolver/i, 'Android share UI must be visible.');
      await screenshot('04-share');
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
    const xml = await nativeHierarchy('05-csv-share');
    assert.match(xml, /chooser|resolver/i);
    await screenshot('05-csv-share');
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
    await nativeHierarchy('06-picker-initial');
    await screenshot('06-picker-initial');
    await nativeTap({ 'content-desc': /Show roots|Open navigation drawer|루트 표시|탐색 창 열기/ });
    await nativeTap({ text: /^(Downloads|다운로드)$/ });
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
    await expect(page.locator('.hero-progress strong')).toHaveText('25%');
    await screenshot('08-original-preserved');
  });
  assert.deepEqual(errors, [], 'The installed app must not throw JavaScript errors.');
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
  if (device) {
    await screenshot('failure').catch(() => {});
    await nativeHierarchy('failure').catch(() => {});
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
        serial: device?.serial(),
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
  console.log('Android test artifacts: ' + output);
}
