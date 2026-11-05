import { test, expect } from '@playwright/test';
import { openView } from './navigation.mjs';
import { today, addDays } from '../../../shared/browser/engine.js';
import { weeklyDraft } from '../../../shared/browser/management.js';
import { PROJECT_SCREENS } from '../../../shared/browser/project-navigation.js';

function project() {
  const at = today();
  const value = {
    id: 'layout',
    name: '스마트워크 통합 플랫폼 구축 · 긴 프로젝트 이름과 모바일 정렬 검증',
    description: '여러 단계의 업무와 인력, 투입 계획, 이슈 및 주간보고를 확인합니다.',
    holidays: [],
    koreanHolidays: true,
    members: ['김하늘', '이서준', '박지민', '최서연'].map((name, index) => ({
      id: 'm' + index,
      name,
      role: '서비스 기획 및 플랫폼 개발',
      grade: '고급',
      hours: 8,
      allocation: 100,
    })),
    tasks: Array.from({ length: 12 }, (_, index) => ({
      id: 't' + index,
      name: '통합 플랫폼 / 인터페이스 정의와 개발 결과 검토 ' + (index + 1),
      phase: '공통 플랫폼 개발',
      owner: 'm' + (index % 4),
      start: addDays(at, -10),
      end: addDays(at, 7),
      predecessor: '',
      memo: '모바일과 데스크톱의 프로젝트 관리 기능을 확인합니다.',
      items: [
        { id: 'i' + index + 'a', title: '요구사항 및 인터페이스 검토', hours: 4, doneDate: at },
        { id: 'i' + index + 'b', title: '통합 구현과 결과 검증', hours: 8, doneDate: null },
      ],
    })),
    issues: [
      {
        id: 'issue',
        title: '외부 API 응답 규격 변경에 따른 인터페이스 조정',
        type: 'risk',
        impact: 'high',
        probability: 'medium',
        status: 'open',
        owner: 'm0',
        due: addDays(at, 7),
        action: '변경 규격 검토',
        taskId: 't0',
      },
    ],
    staffing: {
      hoursPerMM: 160,
      assignments: [
        { id: 'a', memberId: 'm0', start: addDays(at, -10), end: addDays(at, 20), allocation: 80 },
      ],
    },
  };
  value.tasks.push({
    id: 'milestone',
    name: '통합 플랫폼 / 단계 종료 검토 및 승인',
    kind: 'milestone',
    owner: 'm0',
    start: at,
    end: at,
    predecessor: '',
    phase: '검토',
    items: [],
    memo: '',
    doneDate: null,
  });
  value.weeklyReports = [weeklyDraft(value, { from: addDays(at, -6), to: at, id: 'weekly' })];
  return value;
}

async function start(page, value = project()) {
  await page.goto('/');
  await page.locator('#importFile').setInputFiles({
    name: 'layout.pmcanvas',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(value)),
  });
  await expect(page.locator('#activeProjectName')).toHaveText(project().name);
  await expect(page.locator('#content')).toHaveAttribute('aria-busy', 'false');
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
