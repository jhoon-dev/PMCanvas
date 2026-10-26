import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { totp } from '../../server/admin-mfa.mjs';
import { today } from '../../public/engine.js';
import { largeProject } from '../support/large-project.mjs';
const PASSWORD = 'preview-admin-password',
  api = 'http://localhost:4193/pmcanvas/api/',
  origin = 'http://localhost:4193';
async function login(page, email = 'member@example.com', password = PASSWORD) {
  await page.goto('./');
  await page.locator('#loginEmail').fill(email);
  await page.locator('#loginPassword').fill(password);
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST',
  );
  await page.locator('#loginForm button[type=submit],#loginForm button.primary').click();
  let session = await (await response).json();
  if (session.mfaRequired) {
    const enrollment = session.enrollment;
    let saved;
    if (!enrollment)
      saved = JSON.parse(
        await readFile(
          new URL('../../releases/.browser-admin-recovery.json', import.meta.url),
          'utf8',
        ),
      );
    const code = enrollment ? totp(session.secret) : saved.shift();
    await page.locator('#mfaCode').fill(code);
    const verified = page.waitForResponse((r) => r.url().endsWith('/api/auth/mfa/verify'));
    await page.locator('#mfaForm .primary').click();
    session = await (await verified).json();
    await mkdir(new URL('../../releases/', import.meta.url), { recursive: true });
    await writeFile(
      new URL('../../releases/.browser-admin-recovery.json', import.meta.url),
      JSON.stringify(enrollment ? session.recoveryCodes : saved),
      { mode: 0o600 },
    );
    if (enrollment) await page.locator('#closeInfo').click();
  }
  await expect(page.locator('#authGate')).toBeHidden();
  return session;
}
const pageErrors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
});
async function createProject(page, session, source = {}) {
  const p = {
    ...largeProject(),
    id: randomUUID(),
    tasks: largeProject().tasks.slice(0, 1),
    ...source,
  };
  delete p._revision;
  delete p._role;
  p.id = randomUUID();
  const r = await page.request.post(api + 'projects', {
    headers: { Origin: origin, 'X-CSRF-Token': session.csrf },
    data: { project: p },
  });
  expect(r.status()).toBe(201);
  return (await r.json()).project;
}
async function selectProject(page, p, view = 'tasks') {
  await page.reload();
  await expect(page.locator('#authGate')).toBeHidden();
  if (await page.locator('#projectSelect').isVisible())
    await page.locator('#projectSelect').selectOption(p.id);
  else await page.locator('#projectList [data-project="' + p.id + '"]').click();
  await page.locator('[data-view="' + view + '"]').click();
}

test('가입 → 로컬 인증 메일 → 관리자 MFA 승인 → 업무 등록·완료 → 보고서와 실제 Excel', async ({
  page,
  browser,
  request,
}) => {
  const email = 'browser-' + randomUUID() + '@example.com';
  await page.goto('./');
  await page.locator('#registerButton').click();
  await page.locator('#registrationForm [name=email]').fill(email);
  await page.locator('#registrationForm button.primary').click();
  await expect(page.locator('#registrationForm h1')).toHaveText('신청 완료');
  let link;
  await expect
    .poll(async () => {
      const box = await (await request.get('http://localhost:4192/')).json();
      link = box.verifications.find((m) => m.to === email)?.url;
      return !!link;
    })
    .toBe(true);
  await page.goto(link);
  await page.locator('#verifyEmailForm [name=name]').fill('브라우저 검증 사용자');
  await page.locator('#verifyEmailForm [name=newPassword]').fill(PASSWORD);
  await page.locator('#verifyEmailForm [name=confirmPassword]').fill(PASSWORD);
  await page.locator('#verifyEmailForm button.primary').click();
  await expect(page.locator('#verifyEmailForm h1')).toHaveText('이메일 인증 완료');
  const adminContext = await browser.newContext({ locale: 'ko-KR' }),
    admin = await adminContext.newPage();
  const adminSession = await login(admin, 'admin@example.com');
  await admin.locator('#accountButton').click();
  await admin.locator('[data-action=admin]').click();
  const applicant = admin.locator('.account-user').filter({ hasText: email });
  await applicant.getByRole('button', { name: '신청 검토', exact: true }).click();
  await admin.locator('#registrationDecision [value=approve]').click();
  await expect(admin.locator('#infoBody')).not.toContainText('가입 신청 검토');
  await expect
    .poll(
      async () => (await (await request.get('http://localhost:4192/')).json()).approvalRecipients,
    )
    .toContain(email);
  const headers = { Origin: origin, 'X-CSRF-Token': adminSession.csrf };
  const mail = (await (await admin.request.get(api + 'admin/mail-settings')).json()).settings;
  const broken = await admin.request.put(api + 'admin/mail-settings', {
    headers,
    data: { ...mail, port: 65530, password: '' },
  });
  expect(broken.ok()).toBe(true);
  expect(
    (
      await admin.request.post(api + 'admin/mail-settings/test', {
        headers,
        data: { to: 'admin@example.com' },
      })
    ).status(),
  ).toBe(502);
  const current = (await broken.json()).settings;
  expect(
    (
      await admin.request.put(api + 'admin/mail-settings', {
        headers,
        data: { ...mail, revision: current.revision, password: '' },
      })
    ).ok(),
  ).toBe(true);
  await admin.locator('[data-admin-tab=security]').click();
  await admin.getByText('운영 상태', { exact: true }).click();
  await admin.locator('[data-action=operation-alerts]').click();
  await expect(admin.locator('.operation-alert-list')).toContainText('메일 발송 실패');
  await admin.locator('#alertSettingsForm [name=enabled]').check();
  await admin.locator('#alertSettingsForm [name=recipients]').fill('admin@example.com');
  await admin.locator('#alertSettingsForm .primary').click();
  await expect(admin.locator('#toast')).toContainText('알림 설정을 저장');
  await admin.locator('[data-alert-ack=mail]').click();
  await expect(admin.locator('.operation-alert-list')).toContainText(
    '확인할 운영 실패 알림이 없습니다.',
  );
  await adminContext.close();
  await login(page, email);
  await page.locator('#newProjectSide').click();
  await page.locator('[name=name]').fill('브라우저 흐름 검증');
  await page.locator('#submitButton').click();
  await page.locator('[data-action=member]').first().click();
  await page.locator('[name=name]').fill('담당자');
  await page.locator('#submitButton').click();
  await page.locator('[data-view=tasks]').click();
  await page.locator('[data-wbs-action=add]').click();
  await page.locator('[data-cell=name]').fill('브라우저 업무');
  await page.locator('[data-cell=owner]').selectOption({ label: '담당자' });
  await page.locator('[data-cell=name]').press('Control+s');
  await expect(page.locator('.wbs-state')).toHaveText('저장됨');
  await page.locator('[data-view=daily]').click();
  await page.locator('[data-daily-mode=project]').click();
  await page.locator('[data-check-item]').check();
  await expect(page.locator('.check-task-progress strong')).toHaveText('100%');
  await page.locator('[data-action=history]').click();
  await expect(page.locator('.report-summary')).toContainText('1개 완료 · 8h');
  const csvEvent = page.waitForEvent('download');
  await page.locator('[data-action=export-history]').click();
  expect((await csvEvent).suggestedFilename()).toMatch(/\.csv$/);
  await page.locator('#closeInfo').click();
  await page.locator('[data-view=tasks]').click();
  await page.locator('[aria-label="WBS 더 보기"]').click();
  const excelEvent = page.waitForEvent('download');
  await page.locator('[data-action=export-excel]').click();
  const download = await excelEvent;
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(await download.path());
  expect(book.getWorksheet('WBS').getCell('C2').value).toBe('브라우저 업무');
  expect(book.getWorksheet('WBS').getCell('H2').value).toBe(1);
  await page.reload();
  await expect(page.locator('[data-progress]')).toHaveText('100%');
});

test('동시 수정은 비교·선택 후 저장하며 서버의 완료 기록과 메모를 보존', async ({
  page,
  browser,
}) => {
  const session = await login(page),
    p = await createProject(page, session, { name: '동시 수정 검증' });
  await selectProject(page, p);
  await page.locator('[data-cell=name]').fill('내가 바꾼 이름');
  await page.locator('[data-cell=name]').press('Tab');
  const other = await browser.newPage({ locale: 'ko-KR' });
  const otherSession = await login(other);
  const server = structuredClone(p);
  server.tasks[0].name = '서버에서 바꾼 이름';
  server.tasks[0].memo = '서버 메모';
  server.tasks[0].items[0].doneDate = today();
  const saved = await other.request.put(api + 'projects/' + p.id, {
    headers: { Origin: origin, 'X-CSRF-Token': otherSession.csrf },
    data: { project: server, revision: p._revision },
  });
  expect(saved.status()).toBe(200);
  await page.locator('[data-wbs-action=save]').click();
  await expect(page.locator('.merge-dialog')).toBeVisible();
  await expect(page.locator('.merge-field')).toHaveCount(1);
  await page.locator('.merge-dialog input[value=mine]').check();
  await page.locator('#conflictForm .primary').click();
  await expect(page.locator('[data-cell=name]')).toHaveValue('내가 바꾼 이름');
  await page.locator('[data-wbs-action=save]').click();
  await expect(page.locator('.wbs-state')).toHaveText('저장됨');
  const result = await (await page.request.get(api + 'projects/' + p.id)).json();
  expect(result.project.tasks[0].memo).toBe('서버 메모');
  expect(result.project.tasks[0].items[0].doneDate).toBe(today());
  await page.locator('[data-view=overview]').click();
  await page.getByText('프로젝트 관리', { exact: true }).click();
  await page.locator('[data-action=settings]').click();
  await page.locator('#editorForm [name=name]').fill('내 프로젝트 이름');
  const newer = structuredClone(result.project);
  newer.name = '서버 프로젝트 이름';
  newer.tasks[0].memo = '서버에서 다시 수정';
  expect(
    (
      await other.request.put(api + 'projects/' + p.id, {
        headers: { Origin: origin, 'X-CSRF-Token': otherSession.csrf },
        data: { project: newer, revision: newer._revision },
      })
    ).ok(),
  ).toBe(true);
  await page.locator('#submitButton').click();
  await expect(page.locator('.merge-dialog')).toBeVisible();
  await page.locator('.merge-dialog input[value=mine]').check();
  await page.locator('#conflictForm .primary').click();
  await expect(page.locator('#editorDialog')).toBeHidden();
  await page.locator('[data-action=retry-save]').click();
  await expect(page.locator('#saveStatus')).toHaveText('서버에 저장됨');
  const final = (await (await page.request.get(api + 'projects/' + p.id)).json()).project;
  expect(final.name).toBe('내 프로젝트 이름');
  expect(final.tasks[0].memo).toBe('서버에서 다시 수정');
  expect(final.tasks[0].items[0].doneDate).toBe(today());
  await other.close();
});

test('영어 UI·언어 유지·사용자 데이터 보존·미저장 언어 전환 차단', async ({ page }) => {
  await page.goto('./');
  await page.locator('#loginForm .language-select').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#registerButton')).toHaveText('New here? Register');
  const session = await login(page),
    p = await createProject(page, session, {
      name: '프로젝트 한눈에',
      description: '저장',
      tasks: [{ ...largeProject().tasks[0], name: '완료', memo: '서버 변경' }],
    });
  await selectProject(page, p);
  await expect(page.locator('[data-cell=name]')).toHaveValue('완료');
  await expect(page.locator('#main h1')).toHaveText('Tasks and schedule');
  await expect(page.getByRole('textbox', { name: 'Row 1 Task name', exact: true })).toBeVisible();
  await page.screenshot({ path: '.playwright-mcp/v0.20.0/english.png' });
  await page.locator('[data-cell=name]').fill('바꾼 이름');
  await page.locator('.top-actions .language-select').selectOption('ko');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('[data-cell=name]')).toHaveValue('바꾼 이름');
  await expect(page.locator('#toast')).toContainText('Save or discard');
  await page.locator('[data-cell=name]').press('Control+s');
  await expect(page.locator('.wbs-state')).toHaveText('Saved');
  await page.locator('.top-actions .language-select').selectOption('ko');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
});

test('390px 모바일 내 업무: 넘침 없음·터치 영역·키보드 탐색·완료 체크', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const session = await login(page);
  const p = await createProject(page, session, { name: '모바일 사용성' });
  await selectProject(page, p, 'daily');
  await page.locator('[data-daily-mode=project]').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const target = await page.locator('.check-item').boundingBox();
  expect(target.height).toBeGreaterThanOrEqual(44);
  await page.locator('[data-check-item]').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.check-task-progress strong')).toHaveText('100%');
  await page.screenshot({ path: test.info().outputPath('mobile.png'), fullPage: true });
});

test('500개 업무 입력·검색·간트 렌더링', async ({ page }) => {
  const session = await login(page),
    p = await createProject(page, session, largeProject());
  await selectProject(page, p);
  await expect(page.locator('[data-cell=name]')).toHaveCount(500);
  await page.locator('#wbsQuery').fill('Task 499');
  await expect(page.locator('[data-cell=name]')).toHaveCount(1);
  await page.locator('[data-cell=name]').fill('Edited 499');
  await page.locator('[data-cell=name]').press('Tab');
  await page.locator('[data-wbs-action=save]').click();
  await expect(page.locator('.wbs-state')).toHaveText('저장됨');
  await page.screenshot({ path: test.info().outputPath('large-project.png') });
});
