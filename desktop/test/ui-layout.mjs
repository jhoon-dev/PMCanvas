import { navigate, rendererCommand, appSection } from './ui-actions.mjs';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { DesktopWorkspace } from '../workspace.mjs';
import { assetPath } from '../assets.mjs';

const { chromium } = createRequire(new URL('../../web/package.json', import.meta.url))(
  '@playwright/test',
);
const audit = process.argv.includes('--audit');
const output = path.resolve('test-results/ui-layout', audit ? 'before' : 'after');
const root = fileURLToPath(new URL('../app/', import.meta.url));
const temporary = mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-layout-'));
const document = new DesktopWorkspace(path.join(temporary, 'workspace.json'));
document.create({
  id: 'layout-project',
  name: '고객 포털 구축 프로젝트',
  description: '기획부터 출시까지 일정과 참여인력의 진행 상황을 확인합니다.',
  holidays: [],
  members: ['김담당', '이기획', '박디자인'].map((name, i) => ({
    id: 'm' + i,
    name,
    role: ['개발', '기획', '디자인'][i],
    grade: '고급',
    hours: 8,
    allocation: 100,
  })),
  tasks: ['요구사항 정리', '서비스 화면 설계', '고객 포털 기능 구현 및 통합 검증'].map(
    (name, i) => ({
      id: 't' + i,
      name,
      phase: ['기획', '설계', '개발'][i],
      owner: 'm' + i,
      start: '2026-10-19',
      end: '2026-11-13',
      predecessor: '',
      memo: '',
      items: [
        { id: 'i' + i + 'a', title: '요구사항 검토 및 협의', hours: 8, doneDate: '2026-10-20' },
        { id: 'i' + i + 'b', title: '구현 결과 검토', hours: 16, doneDate: null },
      ],
    }),
  ),
});
document.save(path.join(temporary, 'Layout.pmcanvas'));
if (process.argv.includes('--many-tabs')) {
  const first = document.activeId;
  for (let index = 1; index < 20; index++) {
    document.create({
      name: '프로젝트 ' + (index + 1) + ' · 긴 프로젝트 이름과 세부 정보 검증',
      description: '',
      holidays: [],
      members: [],
      tasks: [],
    });
    document.save(path.join(temporary, 'Tab-' + index + '.pmcanvas'));
  }
  document.activate(first);
}
mkdirSync(output, { recursive: true });
const errors = [];
const findings = [];
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'ko-KR' });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.exposeFunction('layoutCall', (method, ...args) => {
    if (method === 'snapshot') return document.snapshot();
    if (method === 'settings') return { timeZone: 'Asia/Seoul', checkUpdatesOnStart: false };
    if (method === 'editing' || method === 'setLanguage') return;
    throw Error('Unexpected layout test call: ' + method);
  });
  await page.addInitScript(() => {
    window.desktop = Object.fromEntries(
      ['snapshot', 'settings', 'editing', 'setLanguage'].map((method) => [
        method,
        (...args) => window.layoutCall(method, ...args),
      ]),
    );
    window.desktop.onCommand = (callback) => {
      window.testCommand = callback;
    };
    window.desktop.onDocument = () => {};
    window.desktop.onDialog = (callback) => {
      window.testDialog = callback;
    };
    window.desktop.respondDialog = async () => {};
  });
  await page.route('https://desktop.test/**', async (route) => {
    const asset = assetPath('pmcanvas://desktop' + new URL(route.request().url()).pathname);
    if (!asset) return route.fulfill({ status: 404, body: 'Not found' });
    const contentType = asset.endsWith('.html')
      ? 'text/html'
      : asset.endsWith('.css')
        ? 'text/css'
        : asset.endsWith('.png')
          ? 'image/png'
          : 'text/javascript';
    await route.fulfill({ contentType, body: readFileSync(path.join(root, asset)) });
  });
  const capture = async (name) => {
    await page.screenshot({
      path: path.join(output, name + '.png'),
      fullPage: (await page.locator('dialog[open]').count()) === 0,
    });
    const problems = await page.evaluate(() => {
      const found = [];
      const visible = (el) =>
        el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
      if (document.documentElement.scrollWidth > innerWidth)
        found.push('Page overflows horizontally');
      const sidebar = document.querySelector('.desktop-sidebar');
      if (sidebar.scrollHeight > sidebar.clientHeight + 1)
        found.push('Sidebar navigation and settings do not fit the window height');
      for (const row of document.querySelectorAll('.desktop-controls label')) {
        if (!visible(row)) continue;
        const control = row.querySelector('input,select');
        const text = [...row.childNodes].find(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
        );
        if (!control || !text) continue;
        const range = document.createRange();
        range.selectNodeContents(text);
        const a = range.getBoundingClientRect(),
          b = control.getBoundingClientRect();
        if (Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) && b.left - a.right < 7)
          found.push('Filter label touches control: ' + text.textContent.trim());
      }
      for (const row of document.querySelectorAll(
        '.desktop-section-head,.page-head,.desktop-planning-tools,.desktop-bulk-tools',
      )) {
        if (!visible(row)) continue;
        const children = [...row.children].filter(visible);
        for (let i = 1; i < children.length; i++) {
          const a = children[i - 1].getBoundingClientRect(),
            b = children[i].getBoundingClientRect();
          if (Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1 && b.left - a.right < 7)
            found.push('Adjacent controls touch: ' + row.className);
        }
      }
      const main = document.querySelector('#content');
      const children = [...main.children].filter(visible);
      for (let i = 1; i < children.length; i++) {
        const a = children[i - 1],
          b = children[i];
        if (
          a.matches('.panel') &&
          b.matches('.panel') &&
          b.getBoundingClientRect().top - a.getBoundingClientRect().bottom < 16
        )
          found.push('Adjacent panels touch');
      }
      for (const body of document.querySelectorAll('dialog[open] .dialog-body')) {
        if (parseFloat(getComputedStyle(body).paddingBottom) < 20)
          found.push('Dialog content touches footer');
        if (body.scrollWidth > body.clientWidth + 1)
          found.push('Dialog body overflows horizontally');
      }
      const wbs = document.querySelector('.desktop-wbs-table');
      if (wbs && innerWidth <= 1150) {
        const container = wbs.closest('.desktop-table-wrap');
        container.scrollLeft = container.scrollWidth;
        for (const row of wbs.rows) {
          const first = row.cells[0].getBoundingClientRect();
          const second = row.cells[1].getBoundingClientRect();
          if (second.left < first.right - 1)
            found.push('WBS pinned columns overlap when scrolling horizontally');
        }
        container.scrollLeft = 0;
      }
      for (const row of document.querySelectorAll('.desktop-controls.desktop-report-filters')) {
        const box = row.getBoundingClientRect();
        for (const child of [...row.children].filter(visible)) {
          const control = child.getBoundingClientRect();
          if (control.top - box.top < 12 || box.bottom - control.bottom < 12)
            found.push('Report filters touch their container border');
        }
      }
      for (const unit of document.querySelectorAll('.desktop-metric strong > span')) {
        if (!visible(unit)) continue;
        const range = document.createRange();
        range.selectNodeContents(unit.parentElement.firstChild);
        if (unit.getBoundingClientRect().left - range.getBoundingClientRect().right < 6)
          found.push('Metric value touches unit');
      }
      for (const grid of document.querySelectorAll('.pm-fields')) {
        if (!visible(grid)) continue;
        const fields = [...grid.children].filter(visible);
        for (let i = 1; i < fields.length; i++) {
          const a = fields[i - 1].getBoundingClientRect(),
            b = fields[i].getBoundingClientRect();
          if (Math.abs(a.top - b.top) > 1 && b.top - a.bottom < 16)
            found.push('Management form rows have insufficient spacing');
        }
      }
      return [...new Set(found)];
    });
    findings.push(...problems.map((problem) => ({ screen: name, problem })));
  };
  for (const language of ['ko', 'en']) {
    await page.goto('https://desktop.test/index.html');
    await page.evaluate((value) => localStorage.setItem('pmcanvas.language', value), language);
    await page.reload();
    await page.locator('[data-project-tab]').first().waitFor();
    assert.equal(await page.locator('.desktop-file, #projectName, #fileName').count(), 0);
    assert.equal(await page.locator('#projectOptions, #projectTabs #saveStatus').count(), 0);
    assert.equal(await page.locator('#appHeader #projectTabs').count(), 1);
    assert.equal(await page.locator('#openSettings, [data-command="appSettings"]').count(), 0);
    for (const width of [1440, 1000, 984]) {
      await page.setViewportSize({ width, height: width < 1100 ? 720 : 1000 });
      for (const view of [
        'overview',
        'tasks',
        'planning',
        'milestones',
        'resources',
        'daily',
        'people',
        'reports',
        'management',
        'weekly',
      ]) {
        await navigate(page, view);
        assert.equal(
          await page.locator('[data-completion-hint]').count(),
          view === 'daily' ? 1 : 0,
        );
        await capture(language + '-' + width + '-' + view);
        assert.equal(await page.locator('.desktop-sidebar [data-view]').count(), 10);
        assert.equal(
          await page
            .locator('.desktop-toolbar, .action-menu, .desktop-subnav, .management-page-nav nav')
            .count(),
          0,
        );
        assert.equal(await page.locator('.desktop-sidebar [aria-current="page"]').count(), 1);
        assert.equal(
          await page.locator('#content .page-head h1').innerText(),
          await page.locator('#projectSidebar [data-view][aria-current="page"]').innerText(),
        );
        assert.equal(await page.locator('#settingsHeader').isHidden(), true);
        assert.equal(
          await page
            .locator('#projectTabs')
            .evaluate(
              (tabs) =>
                tabs.getBoundingClientRect().top ===
                document.querySelector('#appHeader').getBoundingClientRect().top,
            ),
          true,
        );
        assert.equal(
          await page
            .locator('#content .page-head h1')
            .evaluate(
              (heading) =>
                heading.getBoundingClientRect().top >=
                document.querySelector('#projectTabs').getBoundingClientRect().bottom,
            ),
          true,
          'Page heading must remain below the tab strip after navigating',
        );
        if (await page.locator('.desktop-subnav').count())
          assert.equal(
            await page
              .locator('.desktop-subnav')
              .evaluate(
                (nav) =>
                  nav.getBoundingClientRect().top >=
                  document.querySelector('#content .page-head').getBoundingClientRect().bottom,
              ),
            true,
          );

        for (const [section, forms] of Object.entries({
          management: ['issue'],
          weekly: ['weekly'],
          milestones: ['milestone'],
          resources: ['staffing', 'mm-basis'],
        })) {
          if (view !== section) continue;
          for (const form of ['issue', 'weekly', 'milestone', 'staffing', 'mm-basis'])
            assert.equal(await page.locator('[data-pm-form="' + form + '"]').count(), 0);
        }
        assert.equal(await page.locator('#pmManagement details').count(), 0);
        if (language === 'en' && view === 'reports') {
          assert.match(
            await page.locator('.desktop-report-summary').first().innerText(),
            /3 tasks/,
          );
          assert.match(
            await page.locator('.desktop-report-summary[role="status"]').innerText(),
            /0 records/,
          );
        }
      }
      await navigate(page, 'management');
      await page.locator('.management-page-nav [data-management-pane="add"]').click();
      await page.locator('[data-pm-form="issue"]').first().locator('[name="title"]').waitFor();
      await capture(language + '-' + width + '-management-forms');
      await navigate(page, 'milestones');
      await page.locator('.management-page-nav [data-management-pane="add"]').click();
      await capture(language + '-' + width + '-milestones-forms');
      await navigate(page, 'resources');
      await page.locator('.management-page-nav [data-management-pane="add"]').click();
      await capture(language + '-' + width + '-resources-forms');
      await page.locator('.management-page-nav [data-management-pane="list"]').click();
      await page.locator('.management-page-nav [data-management-pane="basis"]').click();
      await capture(language + '-' + width + '-resources-basis');
      await navigate(page, 'weekly');
      await page.locator('.management-page-nav [data-management-pane="add"]').click();
      await capture(language + '-' + width + '-weekly-compose');
      await navigate(page, 'planning');
      for (const action of ['task', 'baseline', 'schedule']) {
        await page
          .locator('[data-action="' + action + '"]')
          .first()
          .click();
        await page.locator('#editorDialog[open]').waitFor();
        await capture(language + '-' + width + '-dialog-' + action);
        if (action === 'task') {
          await page.locator('.task-details summary').click();
          await capture(language + '-' + width + '-dialog-task-details');
        }
        await page.locator('#cancelEditor').click();
      }
      await page.locator('[data-select-task]').first().check();
      await capture(language + '-' + width + '-bulk-tools');
      await page.locator('[data-bulk="duplicate"]').click();
      if (language === 'en') {
        assert.equal(await page.locator('#dialogTitle').innerText(), 'Duplicate selected tasks');
        assert.ok(
          (await page.locator('#dialogBody').innerText()).includes('Child tasks are copied too.'),
        );
      }
      await capture(language + '-' + width + '-dialog-bulk');
      await page.locator('#cancelEditor').click();
      await page.locator('[data-view="people"]').click();
      await page.locator('[data-action="member"]').first().click();
      await capture(language + '-' + width + '-dialog-member');
      await page.locator('#cancelEditor').click();
      await page.locator('[data-view="overview"]').click();
      await rendererCommand(page, 'projectSettings');
      await capture(language + '-' + width + '-dialog-project');
      await page.locator('#cancelEditor').click();
      await appSection(page, 'general');
      const activeTab = await page
        .locator('[data-project-tab][aria-selected="true"]')
        .getAttribute('data-project-tab');
      assert.equal(await page.locator('#projectWorkspace').isHidden(), true);
      assert.equal(await page.locator('#projectTabs').isHidden(), true);
      assert.equal(await page.locator('#projectSidebar').isHidden(), true);
      assert.equal(await page.locator('#settingsSidebar').isVisible(), true);
      assert.equal(await page.locator('main:visible').count(), 1);
      assert.equal(
        await page
          .locator('#settingsPage')
          .evaluate(
            (node) =>
              node.parentElement === document.querySelector('#projectWorkspace').parentElement,
          ),
        true,
      );
      assert.equal(
        await page.title(),
        language === 'ko'
          ? '앱 설정 · 일반 설정 — PM Canvas'
          : 'App settings · General settings — PM Canvas',
      );
      await capture(language + '-' + width + '-settings-page');
      for (const section of ['holidays', 'updates', 'about']) {
        await appSection(page, section);
        assert.equal(
          await page.locator('#settingsTitle').innerText(),
          await page.locator('[data-app-section="' + section + '"]').innerText(),
        );
        assert.equal(await page.locator('[data-settings-section]:visible').count(), 1);
        assert.equal(await page.locator('#projectOptions').count(), 0);
        assert.equal(await page.locator('#settingsHeader').isVisible(), true);
        await capture(language + '-' + width + '-settings-' + section);
      }

      await page.locator('#settingsBack').click();
      assert.equal(await page.locator('#projectWorkspace').isVisible(), true);
      assert.equal(await page.locator('#projectTabs').isVisible(), true);
      assert.equal(await page.locator('#projectSidebar').isVisible(), true);
      assert.equal(
        await page
          .locator('[data-project-tab][aria-selected="true"]')
          .getAttribute('data-project-tab'),
        activeTab,
      );
      await rendererCommand(page, 'timeZone');
      await capture(language + '-' + width + '-settings-timezone');
      await page.locator('#cancelTimeZone').click();
      await page.locator('#settingsBack').click();
      await page.evaluate((english) => {
        void window.testDialog({
          id: 1,
          title: english ? 'Save changes' : '변경사항 저장',
          message: english ? 'Save changes to this project?' : '프로젝트 변경사항을 저장할까요?',
          detail: english
            ? 'Changes will be lost if you do not save.'
            : '저장하지 않으면 이번 변경사항이 사라집니다.',
          buttons: english ? ['Save', 'Do not save', 'Cancel'] : ['저장', '저장하지 않음', '취소'],
          defaultId: 0,
          cancelId: 2,
        });
      }, language === 'en');
      await page.locator('#messageDialog[open]').waitFor();
      await capture(language + '-' + width + '-dialog-save-changes');
      await page.keyboard.press('Escape');
      await page.evaluate((english) => {
        void window.testDialog({
          id: 2,
          type: 'error',
          title: 'PM Canvas',
          message: english
            ? 'Could not open the project file.'
            : '프로젝트 파일을 열지 못했습니다.',
          buttons: [english ? 'OK' : '확인'],
        });
      }, language === 'en');
      await page.locator('#messageDialog[open]').waitFor();
      await capture(language + '-' + width + '-dialog-error');
      await page.keyboard.press('Escape');
      await page.evaluate(async () => {
        const { openExcelDialog } = await import('/excel-ui.js');
        openExcelDialog({
          api: { cancelExcel: async () => {} },
          loaded: {
            id: 'layout-excel',
            sheets: [{ name: 'WBS', rows: [['업무명', '담당자', '시작일', '종료일']] }],
          },
          revision: 1,
          onApply() {},
          onClose() {},
        });
      });
      await capture(language + '-' + width + '-dialog-excel');
      await page.locator('#excelClose').click();
    }
  }
  writeFileSync(path.join(output, 'findings.json'), JSON.stringify(findings, null, 2));
  assert.deepEqual(errors, [], 'Renderer must not report runtime errors');
  if (!audit) assert.deepEqual(findings, [], 'UI layout regressions');
  console.log(JSON.stringify({ output, findings, errors }, null, 2));
} finally {
  await browser?.close();
  rmSync(temporary, { recursive: true, force: true });
}
