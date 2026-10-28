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
import { DesktopDocument, parseDocument, atomicWrite } from '../document.mjs';
import { assetPath } from '../assets.mjs';
import { buildReport } from '../reports.mjs';

const root = fileURLToPath(new URL('../app/', import.meta.url));
const temporary = mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-renderer-'));
const document = new DesktopDocument(path.join(temporary, 'recovery.json'));
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
      return document.create({
        name: '새 프로젝트',
        description: '',
        members: [],
        tasks: [],
        holidays: [],
      });
    if (method === 'replace') return document.replace(...args);
    if (method === 'save') return document.save(path.join(temporary, 'Project.pmcanvas'));
    if (method === 'exportReport') {
      const [options, revision] = args;
      assert.equal(revision, document.revision);
      atomicWrite(path.join(temporary, 'Report.csv'), buildReport(document.project, options).csv);
      return true;
    }
    throw Error('Unexpected test call: ' + method);
  });
  await page.addInitScript(() => {
    window.desktop = Object.fromEntries(
      ['snapshot', 'editing', 'newProject', 'replace', 'save', 'exportReport'].map((name) => [
        name,
        (...args) => window.desktopTestCall(name, ...args),
      ]),
    );
    window.desktop.onCommand = () => {};
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
  await page.getByRole('button', { name: '＋ 참여인력 추가', exact: true }).first().click();
  await page.locator('[name="name"]').fill('김담당');
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await page.getByRole('button', { name: '업무 · 일정', exact: true }).click();
  await page.getByRole('button', { name: '＋ 업무 추가', exact: true }).click();
  await page.locator('[name="name"]').fill('데스크톱 개발 <완료>');
  await page.locator('[name="start"]').fill('2026-10-19');
  await page.locator('[name="end"]').fill('2026-10-30');
  await page.locator('[name="itemTitle"]').fill('핵심 기능');
  await page.locator('[name="itemHours"]').fill('2');
  await page.getByRole('button', { name: '＋ 세부 작업 추가', exact: true }).click();
  await page.locator('[name="itemTitle"]').nth(1).fill('패키징');
  await page.locator('[name="itemHours"]').nth(1).fill('18');
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await page.getByRole('button', { name: '완료 체크', exact: true }).click();
  await page.locator('#reportDate').fill('2026-10-21');
  await page.locator('[data-check]').first().check();
  await page.getByRole('button', { name: '프로젝트 현황', exact: true }).click();
  await page.locator('#reportDate').fill('2026-10-21');
  await page.getByText('10%', { exact: true }).first().waitFor();
  assert.equal(document.project.tasks[0].items[0].doneDate, '2026-10-21');
  assert.equal(document.project.tasks[0].items[1].doneDate, null);
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByText('파일에 저장됨', { exact: true }).waitFor();
  assert.equal(
    parseDocument(readFileSync(path.join(temporary, 'Project.pmcanvas'))).name,
    'PC 출시 프로젝트',
  );
  await page.reload();
  await page.getByText('PC 출시 프로젝트', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: '업무 · 일정', exact: true }).click();
  await page.locator('#search').fill('없는 업무');
  await page.getByText('표시할 업무가 없습니다.', { exact: true }).waitFor();
  await page.locator('#search').fill('');
  await page.getByRole('button', { name: '데스크톱 개발 <완료>', exact: true }).click();
  await page.locator('[name="end"]').fill('2026-10-18');
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await page.locator('#formError').filter({ hasText: '확인' }).waitFor();
  assert.equal(document.project.tasks[0].end, '2026-10-30');
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await page.getByRole('button', { name: '보고서', exact: true }).click();
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
  await page.getByRole('button', { name: '프로젝트 현황', exact: true }).click();
  const screenshot = path.resolve('test-results/desktop-overview.png');
  mkdirSync(path.dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot, fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: new → member → task → completion → save → reload → filters → validation → CSV reports',
  );
  console.log('Screenshot: ' + screenshot);
} finally {
  await browser?.close();
  rmSync(temporary, { recursive: true, force: true });
}
