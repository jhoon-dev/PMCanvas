import { navigate, rendererCommand } from './ui-actions.mjs';
// Renderer integration against the real document model; no Electron test substitute in production.
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../../web/package.json', import.meta.url))(
  '@playwright/test',
);
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseDocument, atomicWrite } from '../document.mjs';
import { DesktopWorkspace } from '../workspace.mjs';
import { assetPath } from '../assets.mjs';
import { buildReport } from '../reports.mjs';

const root = fileURLToPath(new URL('../app/', import.meta.url));
const temporary = mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-renderer-'));
const document = new DesktopWorkspace(path.join(temporary, 'workspace.json'));
const errors = [];
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'ko-KR' });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.exposeFunction('desktopTestCall', (method, ...args) => {
    if (method === 'snapshot') return document.snapshot();
    if (method === 'editing') return;
    if (method === 'newProject')
      return document.create(
        args[0] || {
          name: '새 프로젝트',
          description: '',
          members: [],
          tasks: [],
          holidays: [],
        },
      );
    if (method === 'replace') return document.replace(...args);
    if (method === 'undo' || method === 'redo') return document[method](...args);
    if (method === 'save') return document.save(path.join(temporary, 'Project.pmcanvas'));
    if (method === 'exportReport') {
      const [options, revision] = args;
      assert.equal(revision, document.revision);
      const report = buildReport(document.project, options);
      atomicWrite(
        path.join(temporary, options.kind === 'weekly' ? 'Report.html' : 'Report.csv'),
        options.kind === 'weekly' ? report.html : report.csv,
      );
      return true;
    }
    throw Error('Unexpected test call: ' + method);
  });
  await page.addInitScript(() => {
    window.desktop = Object.fromEntries(
      ['snapshot', 'editing', 'newProject', 'replace', 'undo', 'redo', 'save', 'exportReport'].map(
        (name) => [name, (...args) => window.desktopTestCall(name, ...args)],
      ),
    );
    window.desktop.onCommand = (callback) => {
      window.testCommand = callback;
    };
    window.desktop.onDocument = () => {};
  });
  // Fulfill local assets in memory. No listener or outbound network is needed.
  await page.route('https://desktop.test/**', async (route) => {
    const asset = assetPath('pmcanvas://desktop' + new URL(route.request().url()).pathname);
    if (!asset) {
      await route.fulfill({ status: 404, body: 'Not found' });
      return;
    }
    const type = asset.endsWith('.html')
      ? 'text/html'
      : asset.endsWith('.css')
        ? 'text/css'
        : 'text/javascript';
    await route.fulfill({
      contentType: type + '; charset=utf-8',
      body: readFileSync(path.join(root, asset)),
    });
  });
  await page.goto('https://desktop.test/index.html');
  await page.getByRole('button', { name: '새 프로젝트 만들기', exact: true }).click();
  await page.locator('[name="name"]').fill('PC 출시 프로젝트');
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await page.getByRole('button', { name: '프로젝트 현황', exact: true }).click();
  await page.getByText('첫 업무부터 시작해 보세요', { exact: true }).waitFor();
  assert.equal(await page.locator('.desktop-summary-grid').count(), 0);
  mkdirSync(path.resolve('test-results'), { recursive: true });
  await page.screenshot({
    path: path.resolve('test-results/ux-desktop-start.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: '＋ 참여인력 추가', exact: true }).first().click();
  await page.locator('[name="name"]').fill('김담당');
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await page.getByRole('button', { name: '업무 · 일정', exact: true }).click();
  await page.getByRole('button', { name: '＋ 업무 추가', exact: true }).click();
  assert.equal(await page.locator('.task-details').getAttribute('open'), null);
  assert.equal(
    await page.locator('[name="name"]').evaluate((el) => el === document.activeElement),
    true,
  );
  assert.equal(await page.locator('[name="predecessor"]').isVisible(), false);
  await page.locator('[name="name"]').fill('데스크톱 개발 <완료>');
  await page.locator('[name="start"]').fill('2026-10-19');
  await page.locator('[name="end"]').fill('2026-10-30');
  await page.locator('[name="itemTitle"]').fill('핵심 기능');
  await page.locator('[name="itemHours"]').fill('2');
  await page.getByRole('button', { name: '＋ 세부 작업 추가', exact: true }).click();
  await page.locator('[name="itemTitle"]').nth(1).fill('패키징');
  await page.locator('[name="itemHours"]').nth(1).fill('18');
  await page.screenshot({ path: path.resolve('test-results/ux-desktop-task.png'), fullPage: true });
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await page.getByRole('button', { name: '완료 체크', exact: true }).click();
  await page.locator('#reportDate').fill('2026-10-21');
  assert.equal(
    await page
      .locator('[data-check]')
      .first()
      .evaluate((el) => getComputedStyle(el).opacity),
    '1',
  );
  await page.locator('[data-check]').first().check();
  await page.getByRole('button', { name: '프로젝트 현황', exact: true }).click();
  await page.locator('#reportDate').fill('2026-10-21');
  await page.getByText('10%', { exact: true }).first().waitFor();
  assert.equal(document.project.tasks[0].items[0].doneDate, '2026-10-21');
  assert.equal(document.project.tasks[0].items[1].doneDate, null);
  assert.equal(await page.locator('[data-project-chart]').count(), 3);
  assert.equal(await page.locator('[data-project-chart="progress"] svg').isVisible(), true);
  assert.ok(!(await page.locator('.project-visuals').innerHTML()).match(/NaN|Infinity/));
  await rendererCommand(page, 'save');
  await page.waitForFunction(
    async () =>
      !(await window.desktop.snapshot()).dirty &&
      document.querySelector('#content').getAttribute('aria-busy') !== 'true',
  );
  assert.equal(
    parseDocument(readFileSync(path.join(temporary, 'Project.pmcanvas'))).name,
    'PC 출시 프로젝트',
  );
  await page.reload();
  await page.getByText('PC 출시 프로젝트', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: '업무 · 일정', exact: true }).click();
  await page.locator('#search').fill('없는 업무');
  await page.getByText('표시할 업무가 없습니다.', { exact: true }).waitFor();
  const beforeReset = document.revision;
  await page.getByRole('button', { name: '필터 초기화', exact: true }).click();
  assert.equal(document.revision, beforeReset);
  assert.equal(await page.locator('#search').inputValue(), '');
  await page.getByRole('button', { name: '데스크톱 개발 <완료>', exact: true }).click();
  await page.locator('[name="end"]').fill('2026-10-18');
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await page.locator('#formError').filter({ hasText: '확인' }).waitFor();
  assert.equal(document.project.tasks[0].end, '2026-10-30');
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await page.getByRole('button', { name: '업무 · 완료 기록', exact: true }).click();
  await page.locator('#reportFormat').selectOption('csv');
  await page.locator('#reportFrom').fill('2026-10-19');
  await page.locator('#reportTo').fill('2026-10-21');
  await page.getByText('완료한 세부 작업 1건 · 2h', { exact: true }).waitFor();
  await page.getByRole('button', { name: '완료 기록 CSV 저장', exact: true }).click();
  await page.getByText('CSV 보고서를 저장했습니다.', { exact: true }).waitFor();
  assert.ok(readFileSync(path.join(temporary, 'Report.csv'), 'utf8').includes('"핵심 기능","2"'));
  await page.locator('#reportFrom').fill('2026-10-22');
  await page.getByText('오늘까지의 올바른 조회 기간을 선택해 주세요.', { exact: true }).waitFor();
  assert.equal(await page.locator('#reportFrom').inputValue(), '2026-10-19');
  await page.locator('#reportFrom').fill('2026-10-21');
  await page.locator('#reportTo').fill('2026-10-21');
  await page.locator('#reportOwner').selectOption(document.project.members[0].id);
  await page.getByRole('button', { name: '업무 현황 CSV 저장', exact: true }).click();
  await page.getByText('CSV 보고서를 저장했습니다.', { exact: true }).waitFor();
  assert.ok(readFileSync(path.join(temporary, 'Report.csv'), 'utf8').includes('"10"'));
  assert.equal(document.dirty, false);
  mkdirSync(path.resolve('test-results'), { recursive: true });
  await page.screenshot({ path: path.resolve('test-results/desktop-reports.png'), fullPage: true });
  await page.setViewportSize({ width: 1000, height: 720 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({
    path: path.resolve('test-results/desktop-reports-compact.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await navigate(page, 'planning');
  await page.getByRole('button', { name: '＋ 업무 추가', exact: true }).click();
  await page.locator('[name="name"]').fill('하위 업무');
  await page.locator('.task-details summary').click();
  await page.locator('[name="parentId"]').selectOption(document.project.tasks[0].id);
  await page.locator('[name="start"]').fill('2026-10-19');
  await page.locator('[name="end"]').fill('2026-10-30');
  await page.locator('[name="itemTitle"]').fill('하위 기능');
  await page.locator('[name="itemHours"]').fill('4');
  await page.getByRole('button', { name: '적용', exact: true }).click();
  const parentId = document.project.tasks[0].id,
    childId = document.project.tasks.find((task) => task.name === '하위 업무').id,
    ownId = parentId + '-work';
  assert.equal(document.project.tasks.find((task) => task.id === childId).parentId, parentId);
  await page
    .locator('[data-wbs-row="' + parentId + '"]')
    .getByText('24h', { exact: true })
    .waitFor();
  await page.locator('[data-fold]').click();
  assert.equal(await page.locator('[data-wbs-row]').count(), 1);
  await page.locator('#search').fill('하위 업무');
  assert.equal(await page.locator('[data-wbs-row]').count(), 2);
  await page.locator('#search').fill('');
  assert.equal(await page.locator('[data-wbs-row]').count(), 1);
  await page.getByRole('button', { name: '모두 펼치기', exact: true }).click();
  await page.getByRole('button', { name: '하위 업무 내어쓰기', exact: true }).click();
  await page
    .locator('[data-wbs-row="' + childId + '"] .desktop-wbs-number')
    .filter({ hasText: /^2$/ })
    .waitFor();
  assert.equal(document.project.tasks.find((task) => task.id === childId).parentId, undefined);
  await page.getByRole('button', { name: '하위 업무 들여쓰기', exact: true }).click();
  await page
    .locator('[data-wbs-row="' + childId + '"] .desktop-wbs-number')
    .filter({ hasText: /^1\.2$/ })
    .waitFor();
  await page.getByRole('button', { name: '기준 계획 저장', exact: true }).click();
  await page.locator('[name="baselineName"]').fill('승인 계획 <기준>');
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await page.getByText('승인 계획 <기준>', { exact: true }).waitFor();
  await page.getByRole('button', { name: '하위 업무', exact: true }).click();
  assert.equal(await page.locator('[name="parentId"] option').count(), 3);
  await page.locator('[name="end"]').fill('2026-11-02');
  await page.locator('[name="itemHours"]').fill('6');
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await page
    .locator('[data-baseline-row="' + childId + '"]')
    .getByText('+3일', { exact: true })
    .waitFor();
  await page
    .locator('[data-baseline-row="' + childId + '"]')
    .getByText('+2h', { exact: true })
    .waitFor();
  await page.getByRole('button', { name: '데스크톱 개발 <완료>', exact: true }).click();
  assert.equal(
    await page.locator('[name="parentId"] option').count(),
    1,
    'Descendants cannot become parents.',
  );
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await page.getByRole('button', { name: '기준 계획 교체', exact: true }).click();
  await page.getByRole('button', { name: '취소', exact: true }).click();
  assert.equal(document.project.baseline.tasks.find((task) => task.id === childId).hours, 4);
  await rendererCommand(page, 'save');
  await page.waitForFunction(
    async () =>
      !(await window.desktop.snapshot()).dirty &&
      document.querySelector('#content').getAttribute('aria-busy') !== 'true',
  );
  await page.reload();
  await navigate(page, 'planning');
  await page.getByText('승인 계획 <기준>', { exact: true }).waitFor();
  assert.equal(
    document.project.tasks.find((task) => task.id === ownId).items[0].doneDate,
    '2026-10-21',
  );
  await page.screenshot({
    path: path.resolve('test-results/desktop-planning.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1000, height: 720 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({
    path: path.resolve('test-results/desktop-planning-compact.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '기준 계획 교체', exact: true }).click();
  await page.locator('[name="baselineName"]').fill('변경 승인 계획');
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await page.getByText('변경 승인 계획', { exact: true }).waitFor();
  assert.equal(document.project.baseline.tasks.find((task) => task.id === childId).hours, 6);
  assert.equal(
    document.project.baseline.tasks.find((task) => task.id === childId).end,
    '2026-11-02',
  );
  await page
    .locator('[data-baseline-row="' + childId + '"]')
    .getByText('변경 없음', { exact: true })
    .waitFor();
  await rendererCommand(page, 'save');
  await page.waitForFunction(
    async () =>
      !(await window.desktop.snapshot()).dirty &&
      document.querySelector('#content').getAttribute('aria-busy') !== 'true',
  );
  await page.getByRole('button', { name: '프로젝트 현황', exact: true }).click();
  await navigate(page, 'planning');
  assert.ok(await page.locator('.desktop-critical').count());
  await page.getByRole('button', { name: '하위 업무', exact: true }).click();
  await page.locator('[name="predecessor"]').selectOption(ownId);
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await page.locator('[data-dependency="' + childId + '"]').waitFor();
  const beforeSchedule = structuredClone(document.project);
  await page.getByRole('button', { name: '하위 업무 일정 조정', exact: true }).click();
  assert.equal(await page.locator('#submitButton').isDisabled(), true);
  assert.ok((await page.locator('#submitButton').getAttribute('title')).includes('미리보기'));
  await page.locator('#previewSchedule').click();
  await page.getByText('변경할 일정 2개 · 아직 적용하지 않았습니다.', { exact: true }).waitFor();
  assert.deepEqual(document.project, beforeSchedule);
  await page.locator('[name="scheduleDays"]').fill('2');
  assert.equal(await page.locator('#schedulePreview').textContent(), '');
  assert.equal(await page.locator('#submitButton').isDisabled(), true);
  await page.getByRole('button', { name: '취소', exact: true }).click();
  assert.deepEqual(document.project, beforeSchedule);
  await page.getByRole('button', { name: '하위 업무 일정 조정', exact: true }).click();
  await page.locator('[name="scheduleMode"]').selectOption('align');
  assert.equal(await page.locator('[name="scheduleDays"]').isDisabled(), true);
  await page.locator('#previewSchedule').click();
  await page.getByText('변경할 일정 2개 · 아직 적용하지 않았습니다.', { exact: true }).waitFor();
  await page.screenshot({
    path: path.resolve('test-results/desktop-schedule-preview.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#editorDialog').open);
  assert.equal(document.project.tasks.find((task) => task.id === childId).start, '2026-11-02');
  assert.equal(await page.locator('[data-dependency]').count(), 0);
  assert.deepEqual(document.project.baseline, beforeSchedule.baseline);
  assert.equal(
    document.project.tasks.find((task) => task.id === ownId).items[0].doneDate,
    '2026-10-21',
  );
  await page.getByRole('button', { name: '하위 업무 일정 조정', exact: true }).click();
  await page.locator('[name="scheduleMode"]').selectOption('align');
  await page.locator('#previewSchedule').click();
  await page.getByText('변경할 일정 0개 · 아직 적용하지 않았습니다.', { exact: true }).waitFor();
  assert.equal(await page.locator('#submitButton').isDisabled(), true);
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await rendererCommand(page, 'save');
  await page.waitForFunction(
    async () =>
      !(await window.desktop.snapshot()).dirty &&
      document.querySelector('#content').getAttribute('aria-busy') !== 'true',
  );
  await page.reload();
  await navigate(page, 'planning');
  assert.equal(document.project.tasks.find((task) => task.id === childId).start, '2026-11-02');
  await page.screenshot({
    path: path.resolve('test-results/desktop-schedule.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1000, height: 720 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({
    path: path.resolve('test-results/desktop-schedule-compact.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '프로젝트 현황', exact: true }).click();
  const screenshot = path.resolve('test-results/desktop-overview.png');
  const savedProject = structuredClone(document.project);
  const savedBytes = readFileSync(path.join(temporary, 'Project.pmcanvas'));
  await page.getByRole('button', { name: '완료 체크', exact: true }).click();
  await page.locator('[data-check]').first().uncheck();
  await page.screenshot({
    path: path.resolve('test-results/ux-desktop-completion.png'),
    fullPage: true,
  });
  assert.equal(document.project.tasks.find((task) => task.id === ownId).items[0].doneDate, null);
  await rendererCommand(page, 'undo');
  await page.waitForFunction(
    async () =>
      !(await window.desktop.snapshot()).dirty &&
      document.querySelector('#content').getAttribute('aria-busy') !== 'true',
  );
  assert.deepEqual(document.project, savedProject);
  await rendererCommand(page, 'redo');
  assert.equal(document.project.tasks.find((task) => task.id === ownId).items[0].doneDate, null);
  await rendererCommand(page, 'undo');
  await page.waitForFunction(
    async () =>
      !(await window.desktop.snapshot()).dirty &&
      document.querySelector('#content').getAttribute('aria-busy') !== 'true',
  );
  assert.deepEqual(readFileSync(path.join(temporary, 'Project.pmcanvas')), savedBytes);
  await page.getByRole('button', { name: '프로젝트 현황', exact: true }).click();
  await page.getByRole('button', { name: '데스크톱 개발 <완료>', exact: true }).click();
  assert.equal(await page.locator('#editorDialog').evaluate((dialog) => dialog.open), true);
  await page.locator('[name="name"]').fill('분기한 새 업무 이름');
  await page.getByRole('button', { name: '적용', exact: true }).click();
  assert.equal(document.snapshot().canRedo, false);
  await rendererCommand(page, 'undo');
  await page.waitForFunction(
    async () =>
      !(await window.desktop.snapshot()).dirty &&
      document.querySelector('#content').getAttribute('aria-busy') !== 'true',
  );
  assert.deepEqual(document.project, savedProject);
  mkdirSync(path.dirname(screenshot), { recursive: true });
  await navigate(page, 'people');
  await page.getByRole('button', { name: '＋ 참여인력 추가', exact: true }).first().click();
  await page.locator('[name="name"]').fill('추가 참여인력');
  await page.getByRole('button', { name: '적용', exact: true }).click();
  const addedMember = document.project.members.at(-1).id;
  await page.getByRole('button', { name: '업무 · 일정', exact: true }).click();
  await page.locator('#owner').selectOption(addedMember);
  await rendererCommand(page, 'undo');
  await page.waitForFunction(
    async () =>
      !(await window.desktop.snapshot()).dirty &&
      document.querySelector('#content').getAttribute('aria-busy') !== 'true',
  );
  assert.equal(await page.locator('#owner').inputValue(), '');
  assert.deepEqual(document.project, savedProject);
  await navigate(page, 'planning');
  await page.locator('[data-select-visible]').check();
  await page.getByText('선택 3개', { exact: true }).waitFor();
  await page.getByRole('button', { name: '선택 복제', exact: true }).click();
  assert.deepEqual(document.project, savedProject);
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await page.getByRole('button', { name: '선택 복제', exact: true }).click();
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#editorDialog').open);
  assert.equal(document.project.tasks.length, 6);
  const copies = document.project.tasks.filter(
    (task) => !savedProject.tasks.some((old) => old.id === task.id),
  );
  assert.equal(copies[1].parentId, copies[0].id);
  assert.ok(copies.every((task) => task.items.every((item) => !item.doneDate)));
  assert.deepEqual(document.project.baseline, savedProject.baseline);
  const copiedProject = structuredClone(document.project);
  await page.locator('[data-select-task="' + copies[0].id + '"]').check();
  await page.getByRole('button', { name: '선택 위로', exact: true }).click();
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#editorDialog').open);
  assert.equal(document.project.tasks[0].id, copies[0].id);
  assert.equal(document.project.tasks[1].id, copies[1].id);
  await rendererCommand(page, 'undo');
  assert.deepEqual(document.project, copiedProject);
  await page.locator('[data-select-task="' + copies[0].id + '"]').check();
  await page.getByRole('button', { name: '선택 삭제', exact: true }).click();
  await page.getByText(/미선택 하위 업무 2개는 최상위로/).waitFor();
  await page.screenshot({
    path: path.resolve('test-results/desktop-bulk-delete.png'),
    fullPage: true,
  });
  assert.deepEqual(document.project, copiedProject);
  await page.getByRole('button', { name: '선택 업무 삭제', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#editorDialog').open);
  assert.equal(document.project.tasks.length, 5);
  assert.equal(document.project.tasks.find((task) => task.id === copies[1].id).parentId, undefined);
  assert.equal(
    document.project.tasks.find((task) => task.id === ownId).items[0].doneDate,
    '2026-10-21',
  );
  await rendererCommand(page, 'undo');
  assert.deepEqual(document.project, copiedProject);
  await page.locator('[data-select-task="' + copies[0].id + '"]').check();
  await page.locator('#search').fill('하위 업무');
  assert.equal(await page.locator('.desktop-bulk-tools').isHidden(), true);
  assert.equal(
    await page
      .getByRole('button', { name: '선택 삭제', exact: true, includeHidden: true })
      .isDisabled(),
    true,
  );
  await page.locator('#search').fill('');
  await rendererCommand(page, 'save');
  await page.waitForFunction(
    async () =>
      !(await window.desktop.snapshot()).dirty &&
      document.querySelector('#content').getAttribute('aria-busy') !== 'true',
  );
  await page.reload();
  await navigate(page, 'planning');
  assert.deepEqual(document.project, copiedProject);
  await page.screenshot({ path: path.resolve('test-results/desktop-bulk.png'), fullPage: true });
  await page.setViewportSize({ width: 1000, height: 720 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({
    path: path.resolve('test-results/desktop-bulk-compact.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '프로젝트 현황', exact: true }).click();
  assert.equal(await page.locator('.desktop-toolbar, .action-menu').count(), 0);
  await page.screenshot({ path: screenshot, fullPage: true });
  await navigate(page, 'planning');
  const beforeSummary = structuredClone(document.project);
  await page.getByRole('button', { name: '요약 업무 추가', exact: true }).click();
  await page.getByRole('button', { name: '새 요약 업무', exact: true }).waitFor();
  assert.equal(document.project.tasks.at(-1).kind, 'summary');
  assert.deepEqual(document.project.tasks.at(-1).items, []);
  await rendererCommand(page, 'undo');
  assert.deepEqual(document.project, beforeSummary);
  await navigate(page, 'milestones');
  assert.equal(await page.locator('#pmManagement h1').innerText(), '마일스톤');
  assert.equal(await page.locator('[data-pm-form="weekly"],[data-pm-form="issue"]').count(), 0);
  assert.equal(await page.locator('#pmManagement details, #pmManagement form').count(), 0);
  await page.locator('.management-page-nav [data-management-pane="add"]').click();
  const milestone = page.locator('[data-pm-form="milestone"]').first();
  await milestone.locator('[name="name"]').fill('출시 승인');
  await milestone.locator('[name="start"]').fill('2026-11-13');
  await milestone.locator('button[type="submit"]').click();
  await page.getByText('출시 승인', { exact: true }).waitFor();
  assert.equal(await page.locator('#pmManagement form').count(), 0);
  await page.locator('[data-management-pane="edit"]').click();
  await page.locator('[data-pm-form="milestone"] [name="name"]').fill('출시 승인 수정');
  await page.locator('[data-pm-form="milestone"] button[type="submit"]').click();
  await page.getByText('출시 승인 수정', { exact: true }).waitFor();
  await navigate(page, 'resources');
  await page.locator('.management-page-nav [data-management-pane="add"]').click();
  const staffing = page.locator('[data-pm-form="staffing"]');
  await staffing.locator('[name="start"]').fill('2026-11-02');
  await staffing.locator('[name="end"]').fill('2026-11-30');
  await staffing.locator('[name="allocation"]').fill('50');
  await staffing.locator('button[type="submit"]').click();
  await page.locator('[data-pm-remove-assignment]').waitFor();
  const staffingPlan = structuredClone(document.project.staffing);
  assert.equal(staffingPlan.assignments[0].allocation, 50);
  assert.ok(
    document.project.tasks.some(
      (task) => task.kind === 'milestone' && task.name === '출시 승인 수정',
    ),
  );
  await page.screenshot({
    path: path.resolve('test-results/desktop-resources.png'),
    fullPage: true,
  });
  await navigate(page, 'management');
  assert.equal(await page.locator('#pmManagement h1').innerText(), '이슈 · 리스크');
  assert.equal(
    await page
      .locator('[data-pm-form="milestone"],[data-pm-form="staffing"],[data-pm-form="mm-basis"]')
      .count(),
    0,
  );
  await page.locator('.management-page-nav [data-management-pane="add"]').click();
  const issue = page.locator('[data-pm-form=issue]').first();
  await issue.locator('[name=title]').fill('데스크톱 이슈');
  await issue.locator('button[type=submit]').click();
  await page.getByText('데스크톱 이슈', { exact: false }).first().waitFor();
  assert.equal(document.project.issues[0].title, '데스크톱 이슈');
  await page.locator('[data-management-pane="edit"]').click();
  await page.locator('[data-pm-form="issue"] [name="action"]').fill('수정 화면에서 조치 기록');
  await page.locator('[data-pm-form="issue"] button[type="submit"]').click();
  await page.locator('.management-page-nav [data-management-pane="add"]').waitFor();
  assert.equal(document.project.issues[0].action, '수정 화면에서 조치 기록');
  await navigate(page, 'weekly');
  await page.locator('.management-page-nav [data-management-pane="add"]').click();
  const weekly = page.locator('[data-pm-form=weekly]');
  await weekly.locator('[name=notes]').fill('데스크톱 발행 검증');
  await weekly.locator('button[type=submit]').click();
  await page.locator('[data-pm-publish]').click();
  await page.locator('[data-management-pane="report"]').waitFor();
  assert.equal(document.project.weeklyReports.length, 1);
  await page.locator('[data-management-pane="report"]').click();
  await page.locator('[data-pm-export]').click();
  await page.waitForTimeout(100);
  assert.ok(
    readFileSync(path.join(temporary, 'Report.html'), 'utf8').includes('데스크톱 발행 검증'),
  );
  const published = structuredClone(document.project.weeklyReports[0]);
  await rendererCommand(page, 'undo');
  assert.deepEqual(document.project.weeklyReports[0], published);
  assert.deepEqual(document.project.staffing, staffingPlan);
  await page.screenshot({
    path: path.resolve('test-results/desktop-issues-reports.png'),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await navigate(page, 'tasks');
  await page.locator('[data-action="task"]').first().click();
  await page.locator('[name="name"]').fill('삭제 확인 검증');
  await page.locator('[name="itemTitle"]').fill('검증용 세부 작업');
  await page.locator('#submitButton').click();
  await page.getByRole('button', { name: '삭제 확인 검증', exact: true }).click();
  const beforeDeletion = structuredClone(document.project);
  await page.locator('#deleteButton').click();
  await page.locator('#messageDialog[open]').waitFor();
  assert.equal(
    await page
      .locator('#messageDialog [data-response="1"]')
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.keyboard.press('Escape');
  assert.deepEqual(document.project, beforeDeletion);
  assert.equal(
    await page.locator('#deleteButton').evaluate((el) => el === document.activeElement),
    true,
  );
  await page.locator('#deleteButton').click();
  await page.screenshot({ path: path.resolve('test-results/desktop-delete-confirmation.png') });
  await page.locator('#messageDialog [data-response="0"]').click();
  await page.waitForFunction(() => !document.querySelector('#editorDialog').open);
  assert.equal(
    document.project.tasks.some((task) => task.name === '삭제 확인 검증'),
    false,
  );
  console.log(
    'PASS: editing, reports, WBS, schedule, history, bulk copy/order/delete previews, filtering, save/reload and preservation',
  );
  console.log('Screenshot: ' + screenshot);
} finally {
  await browser?.close();
  rmSync(temporary, { recursive: true, force: true });
}
