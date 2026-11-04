import { openView } from './navigation.mjs';
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
  await expect(page.locator('#activeProjectName')).toHaveText('모바일 출시 <검토>');
  await page.getByRole('link', { name: '인력', exact: true }).click();
  await page
    .locator('.page-head')
    .getByRole('button', { name: '＋ 참여인력 추가', exact: true })
    .click();
  await page.locator('[name="name"]').fill('김담당');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByText('김담당', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '업무', exact: true }).click();
  await page
    .locator('.page-head')
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
  await expect(page.locator('[data-item]')).toHaveCount(2);
  await expect(page.locator('[data-item]:checked')).toHaveCount(1);
  await page.getByRole('link', { name: '현황', exact: true }).click();
  await expect(page.locator('.desktop-metric:first-child > strong')).toHaveText('25%');
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--safe-area-inset-top', '28px');
    document.documentElement.style.setProperty('--safe-area-inset-bottom', '24px');
  });
  await expect(page.locator('.app-header')).toHaveCSS('padding-top', '36px');
  await expect(page.locator('.bottom-nav')).toHaveCSS('padding-bottom', '32px');
  await page.screenshot({ path: testInfo.outputPath('overview.png'), fullPage: true });
  await page.context().setOffline(true);
  // The installed app bundles the UI; browser tests prove data access without a server.
  await openView(page, 'more');
  await page.getByRole('button', { name: '↶ 실행 취소', exact: true }).click();
  await page.getByRole('link', { name: '현황', exact: true }).click();
  await expect(page.locator('.desktop-metric:first-child > strong')).toHaveText('0%');
  await openView(page, 'more');
  await page.getByRole('button', { name: '↷ 다시 실행', exact: true }).click();
  await expect(page.locator('#content')).toHaveAttribute('aria-busy', 'false');
  await page.context().setOffline(false);
  await page.reload();
  await page.getByRole('link', { name: '현황', exact: true }).click();
  await expect(page.locator('.desktop-metric:first-child > strong')).toHaveText('25%');
  await page.getByRole('link', { name: '완료 체크', exact: true }).click();
  await page.getByLabel('할 일만', { exact: true }).uncheck();
  await expect(page.locator('[data-item]:checked')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('checklist.png'), fullPage: true });
  await openView(page, 'more');
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
  await expect(page.locator('#activeProjectName')).toHaveText('가져온 프로젝트');
  await page.getByRole('link', { name: '프로젝트 목록', exact: true }).click();
  await importProject(page, backup());
  await expect(page.locator('#activeProjectName')).toHaveText('가져온 프로젝트');
  await page.getByRole('link', { name: '프로젝트 목록', exact: true }).click();
  await expect(page.locator('.project-card')).toHaveCount(2);
  await importProject(page, '{broken');
  await expect(page.getByRole('status')).toContainText('JSON');
  await expect(page.locator('.project-card')).toHaveCount(2);
  await page.locator('.project-card').first().click();
  await openView(page, 'more');
  await page.getByRole('button', { name: '이 프로젝트 삭제', exact: true }).click();
  await page.locator('#confirmation').getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.locator('#activeProjectName')).toHaveText('가져온 프로젝트');
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
  await expect(page.locator('#activeProjectName')).toHaveText(value.project.name);
  await expect(page.locator('#content img')).toHaveCount(0);
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
  await page.getByRole('button', { name: '버리기', exact: true }).click();
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
  await expect(page.locator('#activeProjectName')).toHaveText('가져온 프로젝트');
  await openView(page, 'more');
  await page.getByRole('button', { name: '시간대 변경', exact: true }).click();
  await page.locator('[name="timeZone"]').fill('UTC');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.locator('#formError')).toContainText('시간대를 변경하지 못했습니다');
  await page.getByRole('button', { name: '입력 취소', exact: true }).click();
  await page.getByRole('button', { name: '버리기', exact: true }).click();
  await page.reload();
  await expect(page.locator('.date-caption')).toContainText('Asia/Seoul');
  await page.getByRole('link', { name: '현황', exact: true }).click();
  await expect(page.locator('.desktop-metric:first-child > strong')).toHaveText('100%');
});

test('peer screens open directly and personnel and reports stay out of settings', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const value = backup();
  value.project.tasks[0].items[0].doneDate = today();
  await importProject(page, value);
  for (const [label, heading] of [
    ['현황', '프로젝트 현황'],
    ['업무', '업무 · 일정'],
    ['완료 체크', '완료 체크'],
    ['인력', '참여인력'],
    ['보고서', '업무 · 완료 기록'],
    ['더보기', '설정 · 파일'],
  ]) {
    await openView(
      page,
      {
        현황: 'overview',
        업무: 'tasks',
        '완료 체크': 'daily',
        인력: 'people',
        보고서: 'reports',
        더보기: 'more',
      }[label],
    );
    await expect(page.locator('.project-heading h1')).toHaveText(heading);
    await expect(page.locator('#workspaceNavigation [aria-current="page"]')).toHaveCount(1);
    await expect(page.locator('#activeProjectName')).toHaveText('가져온 프로젝트');
    await noOverflow(page);
  }
  await expect(page.locator('.team-grid')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '업무 보고서 CSV', exact: true })).toHaveCount(0);
  await openView(page, 'reports');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '업무 보고서 CSV', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  await expect(page.locator('.completion-records')).toContainText('실기기 점검');
  const completedDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '완료 기록 CSV', exact: true }).click();
  expect((await completedDownload).suggestedFilename()).toContain('완료기록');
  await page.setViewportSize({ width: 320, height: 640 });
  await noOverflow(page);
  for (const link of await page.locator('#navigation a, #navigation button').all()) {
    const box = await link.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: testInfo.outputPath('reports-navigation.png'), fullPage: true });
});

test('quick task entry, draft protection, completion undo and filter recovery', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ 새 프로젝트', exact: true }).click();
  await page.locator('[name="name"]').fill('간단한 프로젝트');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: '첫 업무부터 시작해 보세요' })).toBeVisible();
  await page
    .locator('.page-head')
    .getByRole('button', { name: '＋ 업무 추가', exact: true })
    .click();
  await page.locator('[name="name"]').fill('회의 준비');
  await page.getByRole('button', { name: '입력 취소', exact: true }).click();
  await expect(page.getByRole('heading', { name: '변경사항을 버릴까요?' })).toBeVisible();
  await page.locator('#confirmation').getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.locator('[name="name"]')).toHaveValue('회의 준비');
  // A task name alone creates one checkable item with the default estimate.
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('link', { name: '완료 체크', exact: true }).click();
  await page.getByRole('checkbox', { name: /회의 준비/ }).check();
  await expect(page.locator('.check-task-head > strong')).toContainText('100%');
  await expect(page.getByRole('checkbox', { name: /회의 준비/ })).toBeChecked();
  await expect(page.locator('#toast')).toHaveCSS('opacity', '1');
  await page.getByRole('button', { name: '되돌리기', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /회의 준비/ })).not.toBeChecked();
  await expect(page.locator('.check-task-head > strong')).toContainText('0%');
  await page.getByRole('searchbox', { name: '업무 검색' }).fill('없는 업무');
  await expect(page.locator('.check-panel')).toHaveCount(0);
  await page
    .locator('.workspace-filters')
    .getByRole('button', { name: '필터 초기화', exact: true })
    .click();
  await expect(page.locator('.check-panel')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('checkbox', { name: /회의 준비/ })).not.toBeChecked();
});

test('long forms keep actions reachable in a short viewport and reveal invalid folded fields', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto('/');
  await importProject(page, backup());
  await page
    .locator('.page-head')
    .getByRole('button', { name: '＋ 업무 추가', exact: true })
    .click();
  await page.locator('[name="name"]').fill('짧은 화면에서도 저장');
  for (let index = 0; index < 5; index++) {
    await page.getByRole('button', { name: '＋ 세부 작업 추가', exact: true }).click();
  }
  const actions = await page.locator('#editor .dialog-actions').boundingBox();
  expect(actions.y).toBeGreaterThanOrEqual(0);
  expect(actions.y + actions.height).toBeLessThanOrEqual(480);
  await noOverflow(page);
  await page.getByRole('button', { name: '입력 취소', exact: true }).click();
  await page.getByRole('button', { name: '버리기', exact: true }).click();
  await page
    .locator('.page-head')
    .getByRole('button', { name: '＋ 업무 추가', exact: true })
    .click();
  await page.locator('[name="name"]').fill('일정 확인');
  await page.locator('[name="start"]').fill('');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.locator('[name="start"]')).toBeVisible();
  await expect(page.locator('#editor')).toBeVisible();
});
