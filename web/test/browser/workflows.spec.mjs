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

test('다음 날 복귀 시 오늘 갱신·편집 내용 보존·과거 조회일 유지', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-25T14:59:50Z'));
  const session = await login(page);
  const p = await createProject(page, session, { name: '날짜 갱신 검증' });
  await selectProject(page, p, 'overview');
  await expect(page.locator('#reportDate')).toHaveValue('2026-10-25');
  await page.getByText('프로젝트 관리', { exact: true }).click();
  await page.locator('[data-action=settings]').click();
  const name = page.locator('#editorDialog [name=name]');
  await name.fill('자정에도 보존되는 입력');
  await page.clock.setFixedTime(new Date('2026-10-25T15:00:10Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(name).toHaveValue('자정에도 보존되는 입력');
  await expect(page.locator('#reportDate')).toHaveValue('2026-10-25');
  await page.locator('#closeDialog').click();
  await expect(page.locator('#reportDate')).toHaveValue('2026-10-26');
  await page.locator('#reportDate').fill('2026-10-24');
  await page.locator('#reportDate').press('Tab');
  await page.clock.setFixedTime(new Date('2026-10-26T15:00:10Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('#reportDate')).toHaveValue('2026-10-24');
  await page.locator('#reportDate').fill('2026-10-27');
  await page.locator('#reportDate').press('Tab');
  await expect(page.locator('#reportDate')).toHaveValue('2026-10-27');
});

test('프로젝트 목록은 요약·선택 상세만 동기화하고 캐시를 재사용', async ({ page }) => {
  const session = await login(page);
  const a = await createProject(page, session, { name: '요약 검증 A' }),
    b = await createProject(page, session, { name: '요약 검증 B' });
  let fullReads = 0;
  page.on('request', (request) => {
    if (request.method() === 'GET' && request.url().endsWith('/api/projects')) fullReads++;
  });
  const initial = page.waitForResponse((r) => r.url().endsWith('/workspace/sync'));
  await page.reload();
  const first = await (await initial).json();
  expect(first.projects.some((p) => 'tasks' in p)).toBe(false);
  expect(first.project).toBeTruthy();
  const change = page.waitForResponse((r) => r.url().endsWith('/workspace/sync'));
  await page.locator('#projectList [data-project="' + b.id + '"]').click();
  const selected = await (await change).json();
  expect(selected.project.id).toBe(b.id);
  await expect(page.locator('#breadcrumbProject')).toHaveText(b.name);
  const request = await page.request.post(api + 'workspace/sync', {
    headers: { Origin: origin, 'X-CSRF-Token': session.csrf },
    data: {
      activeId: b.id,
      known: [{ id: b.id, role: selected.project._role, revision: selected.project._revision }],
      mine: [],
    },
  });
  expect((await request.json()).project).toBeNull();
  await page.locator('#projectList [data-project="' + a.id + '"]').click();
  await expect(page.locator('#breadcrumbProject')).toHaveText(a.name);
  expect(fullReads).toBe(0);
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

test('계층 WBS 위로 이동은 하위 묶음과 함께 표시 순서를 바꾸고 서버에 보존', async ({ page }) => {
  const session = await login(page),
    source = largeProject(),
    base = source.tasks[0];
  const tasks = ['a', 'a1', 'b', 'b1'].map((id) => ({
    ...structuredClone(base),
    id,
    name: id,
    parentId: id === 'a1' ? 'a' : id === 'b1' ? 'b' : '',
    predecessor: id === 'b' ? 'a1' : '',
    items: [{ id: id + '-item', title: id, hours: 8, doneDate: '2026-10-20' }],
  }));
  const p = await createProject(page, session, { name: '계층 순서 검증', tasks });
  await selectProject(page, p);
  await page.locator('[data-wbs-select="b"]').check();
  const up = page.locator('[data-wbs-action=up]');
  await up.locator('xpath=ancestor::details[1]').locator('summary').click();
  await up.click();
  await expect(page.locator('[data-grid-row]').first()).toHaveAttribute('data-grid-row', 'b');
  await expect(page.locator('[data-grid-row]').nth(1)).toHaveAttribute('data-grid-row', 'b1');
  await page.locator('[data-wbs-action=save]').click();
  await expect(page.locator('.wbs-state')).toHaveText('저장됨');
  const after = (await (await page.request.get(api + 'projects/' + p.id)).json()).project;
  expect(after.tasks.map((task) => task.id)).toEqual(['b', 'b1', 'a', 'a1']);
  expect(after.tasks[0].predecessor).toBe('a1');
  expect(after.tasks[1].parentId).toBe('b');
  expect(after.tasks.every((task) => task.items[0].doneDate === '2026-10-20')).toBe(true);
  await selectProject(page, p);
  await expect(page.locator('[data-grid-row]').first()).toHaveAttribute('data-grid-row', 'b');
});

test('WBS 저장 응답 대기 중 키보드 실행 취소와 재저장을 차단하고 저장 결과를 보존', async ({
  page,
}) => {
  const session = await login(page),
    p = await createProject(page, session, { name: '저장 중 실행 취소 검증' });
  await selectProject(page, p);
  await page.locator('[data-cell=name]').fill('저장 중 유지할 업무명');
  await page.locator('[data-cell=name]').press('Tab');
  let release, intercepted;
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    intercepted = resolve;
  });
  let saves = 0;
  await page.route('**/api/projects/' + p.id, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    saves++;
    intercepted();
    await hold;
    await route.continue();
  });
  await page.locator('[data-wbs-action=save]').click();
  await started;
  try {
    await expect(page.locator('[data-cell=name]')).toBeDisabled();
    await expect(page.locator('#wbsCascade')).toBeDisabled();
    await page.locator('#wbsWorkspace').focus();
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+s');
    await expect(page.locator('[data-cell=name]')).toHaveValue('저장 중 유지할 업무명');
    expect(saves).toBe(1);
  } finally {
    release();
  }
  await expect(page.locator('.wbs-state')).toHaveText('저장됨');
  await expect(page.locator('[data-cell=name]')).toBeEnabled();
  const saved = (await (await page.request.get(api + 'projects/' + p.id)).json()).project;
  expect(saved.tasks[0].name).toBe('저장 중 유지할 업무명');
});

test('과부하 점검 화면은 주말·휴무일 경계를 제외하고 원래 업무 일정을 보존', async ({ page }) => {
  const session = await login(page),
    source = largeProject();
  const member = { ...source.members[0], name: '과부하 담당자' };
  const task = {
    ...source.tasks[0],
    start: '2026-10-24',
    end: '2026-10-28',
    items: [{ id: 'overload-item', title: '계획 작업', hours: 16, doneDate: null }],
  };
  const p = await createProject(page, session, {
    name: '과부하 경계 검증',
    members: [member],
    tasks: [task],
    holidays: ['2026-10-26', '2026-10-28'],
  });
  await selectProject(page, p);
  const review = page.locator('[data-panel="review"]');
  await review.locator('summary').first().click();
  await expect(review.locator('.wbs-review-content')).toContainText(
    '과부하 담당자 · 2026-10-27 ~ 2026-10-27 · 16.0 / 8.0h/일',
  );
  await expect(review).not.toContainText('2026-10-24 ~');
  const response = await page.request.get(api + 'projects/' + p.id);
  expect(response.status()).toBe(200);
  const after = (await response.json()).project;
  expect(after.tasks[0].start).toBe('2026-10-24');
  expect(after.tasks[0].end).toBe('2026-10-28');
  expect(after.holidays).toEqual(['2026-10-26', '2026-10-28']);
});

test('파일 메뉴 Excel 양식 다운로드·작성·미리보기·추가·저장은 원본 업무를 보존', async ({
  page,
}) => {
  const session = await login(page),
    p = await createProject(page, session, { name: 'Excel 양식 흐름' });
  await selectProject(page, p, 'overview');
  await page.locator('.top-file-menu summary').click();
  await page.locator('#excelImport').click();
  const event = page.waitForEvent('download');
  await page.getByText('Excel 입력 양식 받기', { exact: true }).click();
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(await (await event).path());
  book.getWorksheet('WBS').getRow(2).values = [
    'Excel에서 입력한 업무',
    '',
    new Date('2026-10-26'),
    new Date('2026-10-30'),
    8,
  ];
  await page.locator('#excelFile').setInputFiles({
    name: 'input.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await book.xlsx.writeBuffer()),
  });
  await expect(page.locator('#excelSheet')).toHaveValue('0');
  await page.locator('#excelPreview').click();
  await expect(page.locator('#excelResult')).toContainText('1개 업무 · 오류 0건');
  const before = (await (await page.request.get(api + 'projects/' + p.id)).json()).project;
  expect(before._revision).toBe(p._revision);
  await page.locator('#excelApply').click();
  await expect(page.locator('.wbs-state')).toHaveText('저장하지 않은 변경');
  await page.locator('[data-wbs-action=save]').click();
  await expect(page.locator('.wbs-state')).toHaveText('저장됨');
  const after = (await (await page.request.get(api + 'projects/' + p.id)).json()).project;
  expect(after.tasks.length).toBe(p.tasks.length + 1);
  expect(after.tasks[0].items).toEqual(p.tasks[0].items);
  if (
    !(await page.locator('.top-file-menu').getAttribute('open')) &&
    !(await page.locator('.top-file-menu').evaluate((el) => el.open))
  )
    await page.locator('.top-file-menu summary').click();
  const exported = page.waitForEvent('download');
  await page.locator('#excelExport').click();
  const resultBook = new ExcelJS.Workbook();
  await resultBook.xlsx.readFile(await (await exported).path());
  expect(resultBook.getWorksheet('WBS').rowCount).toBe(after.tasks.length + 1);
});

test('Excel 미리보기 후 초안이 변경되면 오래된 결과 적용을 차단', async ({ page }) => {
  const session = await login(page),
    p = await createProject(page, session);
  await selectProject(page, p);
  await page.evaluate(async (project) => {
    const { openExcelImport } = await import('./wbs-import.js');
    window.excelWorkspace = {
      draft: project,
      changed() {
        window.excelApplied = true;
      },
      options: { toast() {} },
    };
    openExcelImport(window.excelWorkspace, async () => ({
      sheets: [
        {
          name: 'WBS',
          rows: [
            ['업무명', '시작일', '종료일', '공수 (h)'],
            ['업무 추가', '2026-10-26', '2026-10-30', 8],
          ],
        },
      ],
    }));
  }, p);
  await page.locator('#excelFile').setInputFiles({
    name: 'fixture.xlsx',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('fixture'),
  });
  await expect(page.locator('#excelSheet')).toHaveValue('0');
  await page.locator('#excelPreview').click();
  await expect(page.locator('#excelApply')).toBeEnabled();
  await page.evaluate(() => {
    window.excelWorkspace.draft = {
      ...window.excelWorkspace.draft,
      name: '다른 사용자의 새 제목',
      _revision: 2,
    };
  });
  await page.locator('#excelApply').click();
  await expect(page.locator('#excelResult')).toContainText('프로젝트가 변경되었습니다');
  expect(await page.evaluate(() => !!window.excelApplied)).toBe(false);
  await expect(page.locator('#excelApply')).toBeDisabled();
});

test('Excel 읽기 중 설정 변경과 파일 재선택은 최신 파일만 반영', async ({ page }) => {
  const session = await login(page),
    p = await createProject(page, session);
  await selectProject(page, p);
  await page.evaluate(async (project) => {
    const { openExcelImport } = await import('./wbs-import.js');
    let count = 0;
    openExcelImport(
      { draft: project, changed() {}, options: { toast() {} } },
      () =>
        new Promise((resolve, reject) => {
          if (++count === 1) window.rejectOldExcel = reject;
          else window.resolveNewExcel = resolve;
        }),
    );
  }, p);
  await page.locator('#excelFile').setInputFiles({
    name: 'first.xlsx',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('first'),
  });
  await expect(page.locator('#excelPreview')).toBeDisabled();
  await page.locator('#excelMode').selectOption('update');
  await page.locator('#excelFile').setInputFiles({
    name: 'second.xlsx',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('second'),
  });
  await page.locator('#excelMode').selectOption('append');
  await page.evaluate(() => {
    window.rejectOldExcel(Error('old file error'));
    window.resolveNewExcel({
      sheets: [
        {
          name: 'WBS',
          rows: [
            ['업무명', '시작일', '종료일', '공수 (h)'],
            ['최신 파일 업무', '2026-10-26', '2026-10-30', 8],
          ],
        },
      ],
    });
  });
  await expect(page.locator('#excelPreview')).toBeEnabled();
  await page.locator('#excelPreview').click();
  await expect(page.locator('#excelResult')).toContainText('최신 파일 업무');
  await expect(page.locator('#excelApply')).toBeEnabled();
  await expect(page.locator('#excelResult')).not.toContainText('old file error');
});

test('저장 후 늦게 도착한 내 업무 응답은 최신 동기화 화면을 덮어쓰지 않음', async ({ page }) => {
  const session = await login(page);
  const p = await createProject(page, session, { name: '지연 응답 이전 프로젝트' });
  const next = await createProject(page, session, { name: '최신 동기화 프로젝트' });
  await selectProject(page, p);
  let release, requested;
  const waiting = new Promise((resolve) => {
    requested = resolve;
  });
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/my-work', async (route) => {
    requested();
    await held;
    await route.fulfill({
      json: { projects: [{ ...p, name: '이전 응답 노출 금지', _memberId: p.members[0].id }] },
    });
  });
  await page.locator('[data-cell=name]').fill('저장한 변경');
  await page.locator('[data-cell=name]').press('Control+s');
  await waiting;
  await expect(page.locator('.wbs-state')).toHaveText('저장됨');
  await page.locator('#projectList [data-project="' + next.id + '"]').click();
  await expect(page.locator('#breadcrumbProject')).toHaveText(next.name);
  await page.locator('[data-view=daily]').click();
  const finished = page.waitForEvent('requestfinished', {
    predicate: (r) => r.url().endsWith('/api/my-work'),
  });
  release();
  await finished;
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await expect(page.locator('#main')).not.toContainText('이전 응답 노출 금지');
});

for (const failedCreation of [false, true]) {
  test(
    'JSON 백업 미확정 입력 복구·수정·저장' + (failedCreation ? '·최초 생성 실패 후 재시도' : ''),
    async ({ page }) => {
      const session = await login(page);
      const p = await createProject(page, session, { name: '미확정 입력 백업' });
      await selectProject(page, p);
      await page.locator('[data-cell=start]').fill('2026-11-30');
      await page.locator('[data-cell=start]').press('Tab');
      await expect(page.locator('.wbs-error')).not.toBeEmpty();
      await page.locator('.top-file-menu summary').click();
      const downloading = page.waitForEvent('download');
      await page.locator('#backupButton').click();
      const file = await (await downloading).path();
      const backup = JSON.parse(await readFile(file, 'utf8'));
      expect(backup.project._wbsPendingCells[0].value).toBe('2026-11-30');
      await page.reload();
      await expect(page.locator('#authGate')).toBeHidden();
      let creationFailures = 0;
      if (failedCreation) {
        await page.route('**/api/projects', async (route) => {
          if (route.request().method() === 'POST' && creationFailures === 0) {
            creationFailures++;
            await route.fulfill({
              status: 503,
              json: { error: { code: 'UNAVAILABLE', message: 'test failure' } },
            });
          } else await route.continue();
        });
      }
      await page.locator('.top-file-menu summary').click();
      const chooser = page.waitForEvent('filechooser');
      await page.locator('#importButton').click();
      await (await chooser).setFiles(file);
      await expect(page.locator('#breadcrumbProject')).toContainText('(불러옴)');
      await expect(page.locator('[data-cell=start]')).toHaveValue('2026-11-30');
      await expect(page.locator('.wbs-state')).toHaveText('저장하지 않은 변경');
      await page.locator('[data-wbs-action=save]').click();
      await expect(page.locator('.wbs-error')).not.toBeEmpty();
      await page.locator('[data-cell=start]').fill(p.tasks[0].start);
      await page.locator('[data-cell=start]').press('Tab');
      await page.locator('[data-cell=name]').fill('복구 입력 수정 완료');
      await page.locator('[data-cell=name]').press('Tab');
      const saved = page.waitForResponse(
        (r) =>
          /\/api\/projects(?:\/[^/]+)?$/.test(r.url()) &&
          ['POST', 'PUT'].includes(r.request().method()) &&
          r.ok(),
      );
      await page.locator('[data-wbs-action=save]').click();
      const result = (await (await saved).json()).project;
      await expect(page.locator('.wbs-state')).toHaveText('저장됨');
      expect(result.id).not.toBe(p.id);
      expect(result.tasks[0].start).toBe(p.tasks[0].start);
      expect(result._wbsPendingCells).toBeUndefined();
      expect(creationFailures).toBe(failedCreation ? 1 : 0);
      const original = (await (await page.request.get(api + 'projects/' + p.id)).json()).project;
      expect(original._revision).toBe(p._revision);
      expect(original.tasks[0].start).toBe(p.tasks[0].start);
    },
  );
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
  await admin.getByText('메일 실패 상세', { exact: true }).click();
  await expect(admin.locator('#operationAlertsHost')).toContainText('SMTP 연결 실패');
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

test('새로고침으로 복구한 초안은 원래 버전과 비교해 충돌·서버 메모·완료 기록을 보존', async ({
  page,
}) => {
  const session = await login(page),
    p = await createProject(page, session, { name: '복구 병합 검증' });
  await selectProject(page, p);
  await page.locator('[data-cell=name]').fill('복구한 내 이름');
  await page.locator('[data-cell=name]').press('Tab');
  const server = structuredClone(p);
  server.tasks[0].name = '다른 기기에서 바꾼 이름';
  server.tasks[0].memo = '서버에서 보존할 메모';
  server.tasks[0].items[0].doneDate = today();
  expect(
    (
      await page.request.put(api + 'projects/' + p.id, {
        headers: { Origin: origin, 'X-CSRF-Token': session.csrf },
        data: { project: server, revision: p._revision },
      })
    ).ok(),
  ).toBe(true);
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.locator('#authGate')).toBeHidden();
  if (await page.locator('#projectSelect').isVisible())
    await page.locator('#projectSelect').selectOption(p.id);
  else await page.locator('#projectList [data-project="' + p.id + '"]').click();
  await expect(page.locator('.wbs-recovery')).toBeVisible();
  await page.locator('[data-wbs-action=recover]').click();
  await expect(page.locator('[data-cell=name]')).toHaveValue('복구한 내 이름');
  await page.locator('[data-wbs-action=save]').click();
  await expect(page.locator('.merge-dialog')).toBeVisible();
  await expect(page.locator('.merge-field')).toHaveCount(1);
  await page.locator('.merge-dialog input[value=mine]').check();
  await page.locator('#conflictForm .primary').click();
  await page.locator('[data-wbs-action=save]').click();
  await expect(page.locator('.wbs-state')).toHaveText('저장됨');
  const result = (await (await page.request.get(api + 'projects/' + p.id)).json()).project;
  expect(result.tasks[0].name).toBe('복구한 내 이름');
  expect(result.tasks[0].memo).toBe(server.tasks[0].memo);
  expect(result.tasks[0].items[0].doneDate).toBe(today());
  await expect(page.locator('.wbs-recovery')).toHaveCount(0);
});

test('초안 보관 전환의 저장 공간 오류는 체크박스·기존 초안을 유지하고 새로고침 후 복구', async ({
  page,
}) => {
  const session = await login(page),
    p = await createProject(page, session, { name: '보관 실패 복구' });
  await selectProject(page, p);
  await page.locator('[data-cell=name]').fill('공간 부족에도 보존할 이름');
  await page.locator('[data-cell=name]').press('Tab');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && key.startsWith('pmcanvas:draft:v1:'))
        throw new DOMException('Storage full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.locator('#accountButton').click();
  await page.locator('#draftPersist').click();
  await expect(page.locator('#draftPersist')).not.toBeChecked();
  await expect(page.locator('#toast')).toContainText('초안 보관 설정을 바꾸지 못했습니다');
  const stored = await page.evaluate(
    ({ user, project }) => ({
      preference: localStorage.getItem('pmcanvas:draft-persist:' + user),
      draft: JSON.parse(sessionStorage.getItem('pmcanvas:draft:v1:' + user + ':' + project)),
    }),
    { user: session.user.id, project: p.id },
  );
  expect(stored.preference).not.toBe('yes');
  expect(stored.draft.draft.tasks[0].name).toBe('공간 부족에도 보존할 이름');
  await page.locator('#closeInfo').click();
  page.once('dialog', (dialog) => dialog.accept());
  await selectProject(page, p);
  await page.locator('[data-wbs-action=recover]').click();
  await expect(page.locator('[data-cell=name]')).toHaveValue('공간 부족에도 보존할 이름');
  await page.locator('[data-wbs-action=save]').click();
  await expect(page.locator('.wbs-state')).toHaveText('저장됨');
});

test('같은 탭에서 변환한 구형 초안은 새로고침 후 복구·저장이 가능', async ({ page }) => {
  const session = await login(page),
    p = await createProject(page, session, { name: '구형 초안 이관' });
  await selectProject(page, p);
  await page.evaluate(
    ({ user, project }) => {
      const draft = structuredClone(project);
      draft.tasks[0].name = '구형 초안의 입력';
      sessionStorage.setItem(
        'pmcanvas:draft:v1:' + user + ':' + project.id,
        JSON.stringify({
          version: 1,
          projectId: project.id,
          userId: user,
          revision: project._revision,
          savedAt: new Date().toISOString(),
          draft,
          pending: [],
        }),
      );
    },
    { user: session.user.id, project: p },
  );
  await selectProject(page, p);
  await expect(page.locator('.wbs-recovery')).toBeVisible();
  await page.locator('[data-wbs-action=recover]').click();
  await expect(page.locator('[data-cell=name]')).toHaveValue('구형 초안의 입력');
  await page.locator('[data-wbs-action=save]').click();
  await expect(page.locator('.wbs-state')).toHaveText('저장됨');
  const saved = (await (await page.request.get(api + 'projects/' + p.id)).json()).project;
  expect(saved.tasks[0].name).toBe('구형 초안의 입력');
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

test('간결한 시작 안내·업무 상세·필터 초기화는 기존 입력과 완료 기록을 보존', async ({ page }) => {
  const session = await login(page);
  const p = await createProject(page, session, { name: '쉬운 업무 입력', tasks: [], members: [] });
  await selectProject(page, p, 'overview');
  await expect(page.locator('.project-start')).toContainText('첫 업무부터 시작해 보세요');
  await expect(page.locator('.metric-grid')).toHaveCount(0);
  await page.getByRole('button', { name: '첫 업무 등록', exact: true }).click();
  await page.locator('[data-cell=name]').fill('사용성 점검');
  await page.locator('[data-cell=name]').press('Tab');
  await page.locator('[data-wbs-action=save]').click();
  await expect(page.locator('.wbs-state')).toHaveText('저장됨');
  await page.locator('[data-wbs-detail]').click();
  await expect(page.locator('.task-details')).not.toHaveAttribute('open');
  await expect(page.locator('[name=name]')).toBeFocused();
  await expect(page.locator('[name=predecessor]')).toBeHidden();
  await page.screenshot({ path: test.info().outputPath('simple-task.png'), fullPage: true });
  await page.locator('.task-details summary').click();
  await page.locator('[name=phase]').fill('사용성');
  await page.locator('[name=memo]').fill('보존할 메모 <내용>');
  await page.locator('.task-details summary').click();
  await page.locator('#submitButton').click();
  await expect(page.locator('#editorDialog')).not.toBeVisible();
  await page.locator('[data-wbs-detail]').click();
  await expect(page.locator('.task-details')).toHaveAttribute('open');
  await expect(page.locator('[name=memo]')).toHaveValue('보존할 메모 <내용>');
  await expect(page.locator('[name=phase]')).toHaveValue('사용성');
  expect(await page.locator('#dialogBody').evaluate((el) => el.scrollTop)).toBe(0);
  const saveButton = await page.locator('#submitButton').boundingBox();
  expect(saveButton.y + saveButton.height).toBeLessThanOrEqual(page.viewportSize().height);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileSave = await page.locator('#submitButton').boundingBox();
  expect(mobileSave.y + mobileSave.height).toBeLessThanOrEqual(844);
  expect(await page.locator('#dialogBody').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: test.info().outputPath('task-details-mobile.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: test.info().outputPath('task-details.png'), fullPage: true });
  await page.locator('#closeDialog').click();
  await page.locator('[data-cell=name]').fill('저장 전 입력');
  await page.locator('[data-cell=name]').press('Tab');
  await page.locator('#wbsQuery').fill('찾을 수 없는 업무');
  await expect(page.locator('[data-cell=name]')).toHaveCount(0);
  await page.getByRole('button', { name: '필터 초기화', exact: true }).click();
  await expect(page.locator('#wbsQuery')).toBeFocused();
  await expect(page.locator('[data-cell=name]')).toHaveValue('저장 전 입력');
  await expect(page.locator('.wbs-state')).toHaveText('저장하지 않은 변경');
  await page.locator('[data-wbs-action=save]').click();
  await expect(page.locator('.wbs-state')).toHaveText('저장됨');
  await page.locator('[data-view=daily]').click();
  await page.locator('[data-daily-mode=project]').click();
  await page.locator('[data-check-item]').check();
  await expect(page.locator('.check-task-progress strong')).toHaveText('100%');
  await page.locator('[data-view=overview]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: test.info().outputPath('simple-overview-mobile.png'),
    fullPage: true,
  });
});

for (const kind of ['project', 'task'])
  test('편집창 새로고침 보호: ' + kind, async ({ page }) => {
    const session = await login(page),
      p = await createProject(page, session, { name: '편집 보호 ' + kind });
    await selectProject(page, p, kind === 'project' ? 'overview' : 'tasks');
    if (kind === 'project') {
      await page.getByText('프로젝트 관리', { exact: true }).click();
      await page.locator('[data-action=settings]').click();
    } else await page.locator('[data-wbs-detail]').first().click();
    const input = page.locator('#dialogBody [name=name]'),
      original = await input.inputValue();
    const protectedByGuard = () =>
      page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      });
    expect(await protectedByGuard()).toBe(false);
    await input.fill(original + ' 변경');
    expect(await protectedByGuard()).toBe(true);
    await input.fill(original);
    expect(await protectedByGuard()).toBe(false);
    if (kind === 'task') {
      await page.locator('#addItem').click();
      expect(await protectedByGuard()).toBe(true);
      await page.locator('.remove-item').last().click();
      expect(await protectedByGuard()).toBe(false);
    }
    await input.fill(original + ' 보존할 입력');
    const confirmation = page.waitForEvent('dialog');
    await page.evaluate(() => {
      setTimeout(() => location.reload(), 0);
    });
    const dialog = await confirmation;
    expect(dialog.type()).toBe('beforeunload');
    await dialog.dismiss();
    await expect(input).toHaveValue(original + ' 보존할 입력');
    await page.locator('#cancelDialog').click();
    expect(await protectedByGuard()).toBe(false);
    const server = (await (await page.request.get(api + 'projects/' + p.id)).json()).project;
    expect(server).toEqual(p);
  });

const unloadGuard = (page) =>
  page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });

test('계정 비밀번호 입력은 새로고침·닫기 취소로 보존하고 요청 처리 중 이동을 막는다', async ({
  page,
}) => {
  await login(page);
  await page.locator('#accountButton').click();
  await page.getByText('내 비밀번호 변경', { exact: true }).click();
  const form = page.locator('#changePasswordForm');
  expect(await unloadGuard(page)).toBe(false);
  await form.locator('[name=currentPassword]').fill(PASSWORD);
  await form.locator('[name=newPassword]').fill('fixture-new-password');
  await form.locator('[name=confirmPassword]').fill('fixture-new-password');
  expect(await unloadGuard(page)).toBe(true);
  const reloadDialog = page.waitForEvent('dialog');
  await page.evaluate(() => {
    setTimeout(() => location.reload(), 0);
  });
  const reload = await reloadDialog;
  expect(reload.type()).toBe('beforeunload');
  await reload.dismiss();
  await expect(form.locator('[name=newPassword]')).toHaveValue('fixture-new-password');
  const closeDialog = page.waitForEvent('dialog');
  const close = page.locator('#closeInfo').click();
  await (await closeDialog).dismiss();
  await close;
  await expect(form).toBeVisible();
  let release, entered;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  await page.route('**/api/auth/password', async (route) => {
    entered();
    await gate;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'TEST_BUSY', message: '테스트 요청 실패' } }),
    });
  });
  try {
    await form.locator('button').click();
    await started;
    await expect(form).toHaveAttribute('data-submitting', 'true');
    await page.locator('#closeInfo').click();
    await expect(form).toBeVisible();
    expect(await unloadGuard(page)).toBe(true);
  } finally {
    release();
  }
  await expect(form.locator('button')).toBeEnabled();
  await expect(form.locator('[name=newPassword]')).toHaveValue('fixture-new-password');
  await form.locator('[name=currentPassword]').fill('');
  await form.locator('[name=newPassword]').fill('');
  await form.locator('[name=confirmPassword]').fill('');
  expect(await unloadGuard(page)).toBe(false);
  await page.locator('#closeInfo').click();
  expect(await unloadGuard(page)).toBe(false);
});

test('사용자 추가 입력은 관리자 탭 전환을 취소하면 유지하고 명시적으로 버리면 초기화한다', async ({
  page,
}) => {
  await login(page, 'admin@example.com');
  await page.locator('#accountButton').click();
  await page.locator('[data-action=admin]').click();
  await page.getByText('사용자 직접 추가', { exact: true }).click();
  const form = page.locator('#createUserForm');
  await form.locator('[name=name]').fill('입력 보존 검증');
  await form.locator('[name=email]').fill('unsaved@example.test');
  expect(await unloadGuard(page)).toBe(true);
  const cancelDialog = page.waitForEvent('dialog');
  const cancelled = page.locator('[data-admin-tab=mail]').click();
  await (await cancelDialog).dismiss();
  await cancelled;
  await expect(form.locator('[name=name]')).toHaveValue('입력 보존 검증');
  const acceptDialog = page.waitForEvent('dialog');
  const accepted = page.locator('[data-admin-tab=mail]').click();
  await (await acceptDialog).accept();
  await accepted;
  await expect(page.locator('#mailSettingsForm')).toBeVisible();
  expect(await unloadGuard(page)).toBe(false);
  await page.locator('[data-admin-tab=users]').click();
  await page.getByText('사용자 직접 추가', { exact: true }).click();
  await expect(form.locator('[name=name]')).toHaveValue('');
  await expect(form.locator('[name=email]')).toHaveValue('');
  expect(await unloadGuard(page)).toBe(false);
});
