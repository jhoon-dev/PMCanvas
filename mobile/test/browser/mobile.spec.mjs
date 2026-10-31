import { test, expect } from '@playwright/test';
import { today, nextWorkday } from '../../../shared/browser/engine.js';

const backup = () => ({
  format: 'pm-canvas-project',
  version: 1,
  project: {
    id: 'original',
    name: '가져온 프로젝트',
    description: '',
    holidays: [],
    members: [],
    tasks: [
      {
        id: 'task',
        name: '배포 확인',
        phase: 'QA',
        owner: '',
        start: nextWorkday(today()),
        end: nextWorkday(today()),
        predecessor: '',
        memo: '',
        items: [{ id: 'item', title: '실기기 점검', hours: 4, doneDate: null }],
      },
    ],
  },
});
async function importProject(page, value, name = 'project.pmcanvas') {
  await page.locator('#importFile').setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)),
  });
}
async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('create, edit, check, reopen offline, undo and export a project on a phone', async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '개인정보처리방침', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '기기에 보관하는 정보', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '개인정보처리방침 닫기', exact: true }).click();
  await page.getByRole('button', { name: '＋ 새 프로젝트', exact: true }).click();
  await page.locator('[name="name"]').fill('모바일 출시 <검토>');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: '모바일 출시 <검토>' })).toBeVisible();
  await page.getByRole('link', { name: '더보기', exact: true }).click();
  await page.getByRole('button', { name: '＋ 추가', exact: true }).click();
  await page.locator('[name="name"]').fill('김담당');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByText('김담당', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '업무', exact: true }).click();
  await page
    .locator('.section-heading')
    .getByRole('button', { name: '＋ 업무 추가', exact: true })
    .click();
  await page.locator('[name="name"]').fill('아이폰 · 안드로이드 개발');
  await page.locator('[name="itemTitle"]').fill('현황 화면');
  await page.locator('[name="itemHours"]').fill('2');
  await page.getByRole('button', { name: '＋ 세부 작업 추가', exact: true }).click();
  await page.locator('[name="itemTitle"]').nth(1).fill('완료 체크');
  await page.locator('[name="itemHours"]').nth(1).fill('6');
  await noOverflow(page);
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '아이폰 · 안드로이드 개발', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: '완료 체크', exact: true }).click();
  await page.getByRole('checkbox', { name: /현황 화면/ }).click();
  await expect(page.locator('[data-item]')).toHaveCount(1);
  await page.getByRole('link', { name: '현황', exact: true }).click();
  await expect(page.locator('.hero-progress strong')).toHaveText('25%');
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--safe-area-inset-top', '28px');
    document.documentElement.style.setProperty('--safe-area-inset-bottom', '24px');
  });
  await expect(page.locator('.app-header')).toHaveCSS('padding-top', '48px');
  await expect(page.locator('.bottom-nav')).toHaveCSS('padding-bottom', '32px');
  await page.screenshot({ path: testInfo.outputPath('overview.png'), fullPage: true });
  await page.context().setOffline(true);
  // The installed app bundles the UI; browser tests prove data access without a server.
  await page.getByRole('link', { name: '더보기', exact: true }).click();
  await page.getByRole('button', { name: '↶ 실행 취소', exact: true }).click();
  await page.getByRole('link', { name: '현황', exact: true }).click();
  await expect(page.locator('.hero-progress strong')).toHaveText('0%');
  await page.getByRole('link', { name: '더보기', exact: true }).click();
  await page.getByRole('button', { name: '↷ 다시 실행', exact: true }).click();
  await expect(page.locator('#content')).toHaveAttribute('aria-busy', 'false');
  await page.context().setOffline(false);
  await page.reload();
  await page.getByRole('link', { name: '현황', exact: true }).click();
  await expect(page.locator('.hero-progress strong')).toHaveText('25%');
  await page.getByRole('link', { name: '완료 체크', exact: true }).click();
  await page.getByLabel('할 일만', { exact: true }).uncheck();
  await expect(page.locator('[data-item]:checked')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('checklist.png'), fullPage: true });
  await page.getByRole('link', { name: '더보기', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '프로젝트 내보내기', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pmcanvas$/);
  await page.getByRole('button', { name: '시간대 변경', exact: true }).click();
  await page.locator('[name="timeZone"]').fill('UTC');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.locator('#editor')).not.toBeVisible();
  await expect(page.locator('.date-caption')).toContainText('UTC');
  await page.reload();
  await expect(page.locator('.date-caption')).toContainText('UTC');
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('imports make independent copies and malformed input preserves existing projects', async ({
  page,
}) => {
  await page.goto('/');
  await importProject(page, backup());
  await expect(page.getByRole('heading', { name: '가져온 프로젝트' })).toBeVisible();
  await page.getByRole('link', { name: '← 프로젝트', exact: true }).click();
  await importProject(page, backup());
  await expect(page.getByRole('heading', { name: '가져온 프로젝트' })).toBeVisible();
  await page.getByRole('link', { name: '← 프로젝트', exact: true }).click();
  await expect(page.locator('.project-card')).toHaveCount(2);
  await importProject(page, '{broken');
  await expect(page.getByRole('status')).toContainText('JSON');
  await expect(page.locator('.project-card')).toHaveCount(2);
  await page.locator('.project-card').first().click();
  await page.getByRole('link', { name: '더보기', exact: true }).click();
  await page.getByRole('button', { name: '이 프로젝트 삭제', exact: true }).click();
  await page.locator('#confirmation').getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.getByRole('heading', { name: '가져온 프로젝트' })).toBeVisible();
  await page.getByRole('button', { name: '이 프로젝트 삭제', exact: true }).click();
  await page.locator('#confirmation').getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page.locator('.project-card')).toHaveCount(1);
});

test('small screens, malicious text and failed writes keep a usable editor', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  const value = backup();
  value.project.name = '<img src=x onerror=alert(1)>';
  await importProject(page, value);
  await expect(page.getByRole('heading', { name: value.project.name })).toBeVisible();
  expect(await page.locator('img').count()).toBe(0);
  await page.getByRole('link', { name: '업무', exact: true }).click();
  await page.getByRole('button', { name: '배포 확인', exact: true }).click();
  await page.locator('[name="name"]').fill('저장되지 않을 변경');
  await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const req = indexedDB.open('pmcanvas-mobile-v1', 1);
      req.onsuccess = () => resolve(req.result);
    });
    await new Promise((resolve) => {
      const tx = db.transaction('projects', 'readwrite');
      const store = tx.objectStore('projects'),
        request = store.getAll();
      request.onsuccess = () => {
        const entry = request.result[0];
        entry.revision++;
        store.put(entry);
      };
      tx.oncomplete = resolve;
    });
    db.close();
  });
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.locator('#formError')).toContainText('다른 창');
  await expect(page.locator('[name="name"]')).toHaveValue('저장되지 않을 변경');
  await expect(page.locator('#editor')).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('small-editor.png'), fullPage: true });
  await page.getByRole('button', { name: '입력 취소', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: '배포 확인', exact: true })).toBeVisible();
});

test('changing the business timezone cannot invalidate saved completion records', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-30T16:00:00Z') });
  await page.goto('/');
  const value = backup();
  value.project.tasks[0].start = '2026-10-30';
  value.project.tasks[0].end = '2026-10-31';
  value.project.tasks[0].items[0].doneDate = '2026-10-31';
  await importProject(page, value);
  await expect(page.getByRole('heading', { name: '가져온 프로젝트' })).toBeVisible();
  await page.getByRole('link', { name: '더보기', exact: true }).click();
  await page.getByRole('button', { name: '시간대 변경', exact: true }).click();
  await page.locator('[name="timeZone"]').fill('UTC');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.locator('#formError')).toContainText('시간대를 변경하지 못했습니다');
  await page.getByRole('button', { name: '입력 취소', exact: true }).click();
  await page.reload();
  await expect(page.locator('.date-caption')).toContainText('Asia/Seoul');
  await page.getByRole('link', { name: '현황', exact: true }).click();
  await expect(page.locator('.hero-progress strong')).toHaveText('100%');
});
