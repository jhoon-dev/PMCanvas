import { openView } from './navigation.mjs';
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { today, addDays, nextWorkday } from '../../../shared/browser/engine.js';
import { projectHolidays } from '../../../shared/browser/korean-holidays.js';
import { PROJECT_SCREENS } from '../../../shared/browser/project-navigation.js';
const require = createRequire(import.meta.url),
  ExcelJS = require('exceljs');
async function start(page, overrides = {}) {
  page.setDefaultTimeout(15000);
  await page.goto('/');
  await page.locator('#importFile').setInputFiles({
    name: 'parity.pmcanvas',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        id: 'parity',
        name: '공통 기능 검증',
        description: '',
        holidays: [],
        koreanHolidays: true,
        members: [
          { id: 'm', name: '김담당', role: '개발', grade: '중급', hours: 8, allocation: 100 },
        ],
        tasks: [
          {
            id: 't',
            name: '기능 개발',
            owner: 'm',
            phase: '개발',
            start: addDays(today(), -7),
            end: today(),
            predecessor: '',
            memo: '',
            items: [{ id: 'i', title: '완료 검증', hours: 8, doneDate: today() }],
          },
        ],
        ...overrides,
      }),
    ),
  });
  await expect(page.locator('#activeProjectName')).toHaveText('공통 기능 검증');
}

test('holiday-only project imports, warns and saves corrected dates without blocking navigation', async ({
  page,
}) => {
  await start(page, {
    tasks: [
      {
        id: 'holiday',
        name: '휴일 업무',
        owner: 'm',
        phase: '',
        start: '2026-10-09',
        end: '2026-10-09',
        predecessor: '',
        memo: '',
        items: [{ id: 'holiday-item', title: '보존할 작업', hours: 8, doneDate: null }],
      },
    ],
  });
  await move(page, 'planning');
  await page.locator('[data-panel=review] > summary').click();
  const warning = page.locator('[data-nonworking-task=holiday]');
  await expect(warning).toContainText('휴일 업무');
  await expect(warning).toContainText('2026-10-09 ~ 2026-10-09');
  await page.locator('[data-cell=end]').first().fill('2026-10-12');
  await page.locator('[data-cell=end]').first().press('Tab');
  await page.locator('[data-cell=start]').first().fill('2026-10-12');
  await page.locator('[data-cell=start]').first().press('Tab');
  await page.locator('[data-wbs-action=save]').click();
  await expect(warning).toHaveCount(0);
  await expect.poll(async () => (await stored(page)).tasks[0].start).toBe('2026-10-12');
  await page.reload();
  await expect(page.locator('[data-cell=start]').first()).toHaveValue('2026-10-12');
  expect((await stored(page)).tasks[0].items[0].hours).toBe(8);
});
async function move(page, view) {
  await openView(page, view);
  await expect(page.locator('#content')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#workspaceNavigation [aria-current="page"]')).toHaveAttribute(
    'data-view',
    view,
  );
  await expect(page.locator('.project-heading h1')).toHaveText(PROJECT_SCREENS[view].title);
}
async function stored(page) {
  return page.evaluate(
    async () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open('pmcanvas-mobile-v1', 1);
        r.onerror = reject;
        r.onsuccess = () => {
          const db = r.result,
            q = db.transaction('projects').objectStore('projects').getAll();
          q.onsuccess = () => {
            db.close();
            resolve(q.result[0].project);
          };
          q.onerror = reject;
        };
      }),
  );
}
test('common charts and management screens persist milestones, staffing, risks and immutable weekly reports', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await start(page);
  await expect(page.locator('[data-project-chart]')).toHaveCount(3);
  await page.setViewportSize({ width: 320, height: 700 });
  for (const view of [
    'overview',
    'tasks',
    'planning',
    'daily',
    'people',
    'milestones',
    'resources',
    'management',
    'weekly',
    'reports',
    'more',
  ]) {
    await move(page, view);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await move(page, 'milestones');
  await page.getByRole('button', { name: '마일스톤 추가', exact: true }).click();
  await page.locator('[name="name"]').fill('출시 승인');
  await page.locator('[data-pm-form="milestone"] button[type="submit"]').click();
  await expect(page.locator('.desktop-table')).toContainText('출시 승인');
  await move(page, 'resources');
  await page.getByRole('button', { name: '투입 기간 추가', exact: true }).click();
  await page.locator('[name="allocation"]').fill('50');
  await page.locator('[data-pm-form="staffing"] button[type="submit"]').click();
  await expect(page.locator('.desktop-table').first()).toContainText('50');
  await page.getByRole('button', { name: '환산 기준', exact: true }).click();
  await page.locator('[name="hoursPerMM"]').fill('150');
  await page.getByRole('button', { name: '환산 기준 저장', exact: true }).click();
  await expect.poll(async () => (await stored(page)).staffing.hoursPerMM).toBe(150);
  await move(page, 'management');
  await page.getByRole('button', { name: '이슈·리스크 추가', exact: true }).click();
  await page.locator('[name="title"]').fill('외부 연동 지연');
  await page.locator('[name="type"]').selectOption('risk');
  await openView(page, 'overview');
  await expect(page.locator('#confirmation')).toBeVisible();
  await page.locator('#confirmation').getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.locator('[name="title"]')).toHaveValue('외부 연동 지연');
  await expect(page.locator('#workspaceNavigation [aria-current="page"]')).toHaveAttribute(
    'data-view',
    'management',
  );
  await page.locator('[data-pm-form="issue"] button[type="submit"]').click();
  await expect(page.locator('.desktop-table')).toContainText('외부 연동 지연');
  await move(page, 'weekly');
  await page.getByRole('button', { name: '주간보고 작성', exact: true }).click();
  await page.locator('[name="notes"]').fill('공통 기능 검증 완료');
  await page.getByRole('button', { name: '주간보고 미리보기', exact: true }).click();
  await page.getByRole('button', { name: '이 내용으로 발행', exact: true }).click();
  await expect.poll(async () => (await stored(page)).weeklyReports?.length).toBe(1);
  const report = (await stored(page)).weeklyReports[0];
  await page.getByRole('button', { name: '보기', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '보고서 HTML 내려받기', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.html$/);
  await move(page, 'tasks');
  await page.getByRole('button', { name: '기능 개발', exact: true }).click();
  await page.locator('#editor [name="name"]').fill('기능 개발 수정');
  await page.locator('#editor').getByRole('button', { name: '저장', exact: true }).click();
  expect((await stored(page)).weeklyReports[0]).toEqual(report);
  await page.reload();
  await move(page, 'overview');
  await expect(page.locator('[data-project-chart]')).toHaveCount(3);
  await page.screenshot({ path: info.outputPath('common-overview.png'), fullPage: true });
  expect(errors).toEqual([]);
});
test('mobile WBS editing, guarded navigation, baseline, Excel export and safe Excel import use the common workflow', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await start(page);
  await move(page, 'planning');
  await page.locator('[data-cell="name"]').first().fill('WBS 수정');
  await page.locator('[data-cell="name"]').first().press('Tab');
  await openView(page, 'overview');
  await expect(page.getByRole('status').last()).toContainText('먼저 저장');
  await expect(page.locator('#workspaceNavigation [aria-current="page"]')).toHaveAttribute(
    'data-view',
    'planning',
  );
  await page.getByLabel('WBS 더 보기', { exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('[data-wbs-action="baseline"]').click();
  await page.locator('[data-wbs-action="save"]').click();
  await expect.poll(async () => (await stored(page)).tasks[0].name).toBe('WBS 수정');
  expect((await stored(page)).baseline.tasks[0].name).toBe('WBS 수정');
  await move(page, 'reports');
  const exported = page.waitForEvent('download');
  await page.getByRole('button', { name: '업무 보고서 Excel', exact: true }).click();
  const file = await exported,
    book = new ExcelJS.Workbook();
  await book.xlsx.readFile(await file.path());
  expect(book.getWorksheet('WBS').getRow(2).values.join(' ')).toContain('WBS 수정');
  const done = page.waitForEvent('download');
  await page.getByRole('button', { name: '완료 기록 Excel', exact: true }).click();
  expect((await done).suggestedFilename()).toContain('완료기록');
  const input = new ExcelJS.Workbook(),
    importDay = nextWorkday(today(), projectHolidays(await stored(page)));
  input.addWorksheet('WBS').addRows([
    ['업무명', '시작일', '종료일', '공수(h)'],
    ['Excel 추가 업무', importDay, importDay, 4],
  ]);
  await page.getByRole('button', { name: 'Excel 가져오기', exact: true }).click();
  await expect(page.locator('.excel-import-dialog')).toBeVisible();
  await page.locator('#excelFile').setInputFiles({
    name: 'import.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await input.xlsx.writeBuffer()),
  });
  await expect(page.locator('#excelSheet')).toContainText('WBS');
  await page.locator('#excelPreview').click();
  await expect(page.locator('#excelResult')).toContainText('오류 0건');
  await page.locator('#excelApply').click();
  await page.locator('[data-wbs-action="save"]').click();
  await expect.poll(async () => (await stored(page)).tasks.length).toBe(2);
  await page.reload();
  await expect(page.locator('[data-cell="name"]').last()).toHaveValue('Excel 추가 업무');
  await page.screenshot({ path: info.outputPath('common-wbs.png'), fullPage: true });
  expect(errors).toEqual([]);
});
