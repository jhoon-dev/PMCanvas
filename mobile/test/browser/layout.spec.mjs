import { test, expect } from '@playwright/test';
import { openView } from './navigation.mjs';
import { today, addDays } from '../../../shared/browser/engine.js';
import { layoutProject as project } from './fixtures/layout-project.mjs';
import { PROJECT_SCREENS } from '../../../shared/browser/project-navigation.js';

async function start(page, value = project()) {
  await page.goto('/');
  await page.locator('#importFile').setInputFiles({
    name: 'layout.pmcanvas',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(value)),
  });
  await expect(page.locator('#activeProjectName')).toHaveText(value.name);
  await expect(page.locator('#content')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#navigation, .bottom-nav')).toHaveCount(0);
}

async function move(page, view) {
  await openView(page, view);
  await expect(page.locator('.project-heading h1')).toHaveText(PROJECT_SCREENS[view].title);
}

async function layoutFits(page) {
  const issues = await page.evaluate(() => {
    const problems = [];
    if (document.documentElement.scrollWidth > innerWidth) problems.push('page overflows');
    for (const el of document.querySelectorAll(
      '.workspace-brand, .workspace-files, #openWorkspaceMenu, .desktop-controls, .settings-card, .management-page, .mobile-form-actions, #editor .field',
    )) {
      const box = el.getBoundingClientRect();
      if (box.width && (box.left < -1 || box.right > innerWidth + 1))
        problems.push(el.className || el.id);
    }
    return problems;
  });
  expect(issues).toEqual([]);
}

test('every destination fits narrow phones, large phones and tablets with populated records', async ({
  page,
}, info) => {
  test.setTimeout(180000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await start(page);
  for (const width of [320, 360, 390, 430, 600, 768, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    for (const [view, screen] of Object.entries(PROJECT_SCREENS)) {
      await move(page, view);
      await expect(page.locator('.project-heading h1')).toHaveText(screen.title);
      await layoutFits(page);
      if (width === 320) await page.screenshot({ path: info.outputPath(view + '.png') });
    }
    const header = await page.locator('.mobile-header').evaluate((el) => {
      const brand = el.querySelector('.workspace-brand').getBoundingClientRect();
      const files = el.querySelector('.workspace-files').getBoundingClientRect();
      return { brand: brand.right, files: files.left };
    });
    expect(header.brand).toBeLessThanOrEqual(header.files);
  }
  expect(errors).toEqual([]);
});

test('WBS hierarchy controls stay inside their number column on a narrow phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const value = project();
  value.tasks.slice(0, 3).forEach((task) => {
    task.parentId = 'group';
  });
  value.tasks.unshift({
    id: 'group',
    name: '공통 플랫폼 개발',
    owner: '',
    phase: '개발',
    start: addDays(today(), -10),
    end: addDays(today(), 7),
    predecessor: '',
    memo: '',
    items: [],
  });
  await start(page, value);
  await move(page, 'planning');
  const fold = page.locator('[data-wbs-fold="group"]');
  const cell = fold.locator('..');
  const buttonBox = await fold.boundingBox(),
    cellBox = await cell.boundingBox();
  expect(buttonBox.width).toBeGreaterThanOrEqual(44);
  expect(buttonBox.x).toBeGreaterThanOrEqual(cellBox.x);
  expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(cellBox.x + cellBox.width);
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.wbs-grid [data-row="t0"][data-cell="name"]')).toHaveCount(0);
  await layoutFits(page);
});

test('task and personnel editors keep dates, item fields and actions usable in short phone viewports', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await start(page);
  await move(page, 'tasks');
  await page.locator('.page-head [data-action="task"]').click();
  for (const field of ['start', 'end']) {
    expect(
      (await page.locator('#editor [name="' + field + '"]').boundingBox()).width,
    ).toBeGreaterThanOrEqual(170);
  }
  const title = page.locator('#editor [name="itemTitle"]');
  await title.scrollIntoViewIfNeeded();
  expect((await title.boundingBox()).width).toBeGreaterThan(200);
  expect(
    (await page.locator('.item-editor .remove-item').boundingBox()).width,
  ).toBeGreaterThanOrEqual(44);
  for (let i = 0; i < 5; i++) await page.locator('#addItem').click();
  await page.setViewportSize({ width: 320, height: 360 });
  await expect
    .poll(async () => {
      const box = await page.locator('#editor .dialog-actions').boundingBox();
      return box.y >= 0 && box.y + box.height <= 360;
    })
    .toBe(true);
  await layoutFits(page);
  await page.screenshot({ path: info.outputPath('short-task-editor.png') });
  await page.getByRole('button', { name: '입력 취소', exact: true }).click();
  await page.getByRole('button', { name: '버리기', exact: true }).click();
  await move(page, 'people');
  await page.locator('.page-head [data-action="member"]').click();
  await layoutFits(page);
  await page.locator('[name="allocation"]').scrollIntoViewIfNeeded();
  expect((await page.locator('[name="allocation"]').boundingBox()).width).toBeGreaterThan(200);
});

test('calendar selectors, report filters and management actions align without clipping', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await start(page);
  await move(page, 'more');
  await page.getByRole('button', { name: '프로젝트 설정', exact: true }).click();
  for (const label of ['휴무일 연도', '휴무일 월']) {
    const selector = page.getByRole('combobox', { name: label, exact: true });
    await selector.scrollIntoViewIfNeeded();
    expect((await selector.boundingBox()).width).toBeGreaterThanOrEqual(68);
  }
  await page.getByRole('combobox', { name: '휴무일 연도', exact: true }).selectOption('2027');
  await page.getByRole('combobox', { name: '휴무일 월', exact: true }).selectOption('12');
  await layoutFits(page);
  await page.getByRole('button', { name: '입력 취소', exact: true }).click();
  await expect(page.locator('#editor')).not.toBeVisible();
  for (const [view, action] of [
    ['milestones', '마일스톤 추가'],
    ['resources', '투입 기간 추가'],
    ['resources', '환산 기준'],
    ['management', '이슈·리스크 추가'],
    ['weekly', '주간보고 작성'],
  ]) {
    await move(page, view);
    await page.getByRole('button', { name: action, exact: true }).click();
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    const buttons = page.locator('.mobile-form-actions .button');
    await expect(buttons).toHaveCount(2);
    const first = await buttons.nth(0).boundingBox();
    const second = await buttons.nth(1).boundingBox();
    expect(second.y).toBeGreaterThanOrEqual(first.y + first.height + 8);
    expect(Math.abs(first.width - second.width)).toBeLessThan(1);
    await layoutFits(page);
    await page.locator('.management-page-nav [data-management-pane="list"]').click();
    await expect(page.locator('.mobile-form-actions')).toHaveCount(0);
  }
  await move(page, 'reports');
  const all = page.locator('[data-project-tool="all-records"]');
  const owner = page.locator('#toolReportOwner');
  const allBox = await all.boundingBox(),
    ownerBox = await owner.boundingBox();
  expect(allBox.y).toBeGreaterThanOrEqual(ownerBox.y + ownerBox.height + 8);
  expect(Math.abs(allBox.width - ownerBox.width)).toBeLessThan(1);
});

test('dynamic month cards and weekly previews fit phones and WBS fields remain reachable when panned', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 320, height: 700 });
  await start(page);
  await move(page, 'resources');
  await page.locator('#pmPlanMonth').fill('2026-12');
  await page.locator('#pmPlanMonth').press('Tab');
  await expect(page.locator('#pmPlanResult table')).toHaveClass(/mobile-record-table/);
  await expect(page.locator('#pmPlanResult td[data-label="인력"]')).toHaveCount(4);
  await layoutFits(page);
  await move(page, 'management');
  const title = page.locator('td.mobile-record-title');
  const row = title.locator('..');
  expect(
    Math.abs((await title.boundingBox()).width - (await row.boundingBox()).width),
  ).toBeLessThan(1);
  await move(page, 'weekly');
  await page.getByRole('button', { name: '주간보고 작성', exact: true }).click();
  await page.getByRole('button', { name: '주간보고 미리보기', exact: true }).click();
  await expect(page.locator('#pmWeeklyPreview .pm-report')).toBeVisible();
  await layoutFits(page);
  await page.screenshot({ path: info.outputPath('weekly-preview.png') });
  await page.getByRole('button', { name: '입력 취소', exact: true }).click();
  await expect(page.locator('#pmWeeklyPreview')).toBeEmpty();
  await move(page, 'planning');
  const ownerField = page.locator('.wbs-grid [data-cell="owner"]').first();
  await expect(page.locator('#toast')).toBeHidden({ timeout: 10000 });
  await ownerField.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
  expect(
    await ownerField.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return hit === el || el.contains(hit);
    }),
  ).toBe(true);
  await layoutFits(page);
  await page.screenshot({ path: info.outputPath('wbs-panned.png') });
});

test('long Korean text, identifiers and badges reflow without clipped content at phone and tablet boundaries', async ({
  page,
}, info) => {
  test.setTimeout(180000);
  await start(page, project({ longText: true }));
  for (const width of [320, 359, 361, 390, 600, 601, 768, 900]) {
    await page.setViewportSize({ width, height: 812 });
    for (const view of ['overview', 'tasks', 'daily', 'people', 'management']) {
      await move(page, view);
      await layoutFits(page);
      const overflow = await page.locator('#content').evaluate((root) =>
        [
          ...root.querySelectorAll(
            '.desktop-metric, .desktop-metric strong, .check-panel, .check-task-head, .check-item, .member-card, .member-role, .member-stats, .project-card, .page-head, .head-actions, .button',
          ),
        ]
          .filter((el) => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2)
          .map((el) => ({
            selector: el.className,
            text: el.textContent.trim().slice(0, 60),
            width: el.clientWidth,
            scroll: el.scrollWidth,
          })),
      );
      expect(overflow, view + ' at ' + width).toEqual([]);
      if (width <= 760 && ['tasks', 'management'].includes(view)) {
        const hiddenColumns = await page.locator('#content').evaluate((root) =>
          [
            ...root.querySelectorAll(
              '.workspace-results .desktop-table td, .mobile-record-table td',
            ),
          ]
            .filter((el) => {
              const box = el.getBoundingClientRect();
              return box.width && (box.left < 0 || box.right > innerWidth);
            })
            .map((el) => el.dataset.label),
        );
        expect(hiddenColumns).toEqual([]);
      }
      if (view === 'people') {
        const rows = await page
          .locator('.member-stats')
          .evaluateAll((elements) =>
            elements.map((el) =>
              [...el.querySelectorAll('strong')].map((value) => value.getBoundingClientRect().top),
            ),
          );
        for (const row of rows) expect(Math.max(...row) - Math.min(...row)).toBeLessThan(1);
      }
      const splitWords = await page.locator('#content').evaluate((root) => {
        const split = [],
          range = document.createRange();
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode,
            parent = node.parentElement;
          if (!parent || parent.closest('select, textarea, svg, .desktop-table, .pm-table-scroll'))
            continue;
          const style = getComputedStyle(parent),
            box = parent.getBoundingClientRect();
          if (!box.width || style.whiteSpace === 'nowrap') continue;
          for (const match of node.textContent.matchAll(/[가-힣]{2,8}/g)) {
            range.setStart(node, match.index);
            range.setEnd(node, match.index + match[0].length);
            const lines = [...range.getClientRects()].filter((rect) => rect.width > 0);
            // A short word that fits on a line should not be broken into syllables.
            if (
              new Set(lines.map((rect) => Math.round(rect.top))).size > 1 &&
              box.width > match[0].length * parseFloat(style.fontSize)
            )
              split.push(match[0]);
          }
        }
        return split;
      });
      expect(splitWords, view + ' at ' + width).toEqual([]);
      if (width === 390 && ['daily', 'people'].includes(view))
        await page.screenshot({ path: info.outputPath('long-' + view + '.png') });
    }
  }
});

test('the top menu retains all destinations and file actions without reserving a bottom navigation area', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await start(page);
  await page.evaluate(() =>
    document.documentElement.style.setProperty('--safe-area-inset-bottom', '24px'),
  );
  await expect(page.locator('#content')).toHaveCSS('padding-bottom', '56px');
  await page.getByRole('button', { name: '프로젝트 메뉴 열기', exact: true }).click();
  await expect(page.locator('#workspaceNavigation a')).toHaveCount(11);
  await page.locator('#workspaceNavigation [data-view="more"]').click();
  await expect(page.locator('.project-heading h1')).toHaveText('설정 · 파일');
  await expect(page.locator('#toast')).toBeHidden({ timeout: 10000 });
  await page
    .getByRole('button', { name: '이 프로젝트 삭제', exact: true })
    .scrollIntoViewIfNeeded();
  expect(
    await page.getByRole('button', { name: '이 프로젝트 삭제', exact: true }).evaluate((el) => {
      const box = el.getBoundingClientRect();
      return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === el;
    }),
  ).toBe(true);
  await page.getByLabel('프로젝트 파일과 설정', { exact: true }).click();
  await page
    .locator('#workspaceFiles')
    .getByRole('button', { name: '프로젝트 설정', exact: true })
    .click();
  await expect(page.locator('#editorTitle')).toHaveText('프로젝트 설정');
  await page.getByRole('button', { name: '입력 취소', exact: true }).click();
  await page.locator('#projectListLink').click();
  await expect(page.locator('.project-card')).toHaveCount(1);
});
