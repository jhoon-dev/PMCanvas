import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeProject, resolvedProject } from '../public/project-merge.js';
import { conflictBody } from '../public/conflict-ui.js';
import { ui, setLanguage, getLanguage, rowLabel } from '../public/i18n.js';
import { editorForm } from '../public/project-editor.js';
import { WbsView } from '../public/wbs-view.js';
import { rollups, rollup } from '../public/planning.js';
import { editCell, pasteCells, columns } from '../public/wbs-model.js';
import { suggestMapping } from '../public/wbs-import.js';
import { screenProject } from './support/screen-fixtures.mjs';
import { largeProject } from './support/large-project.mjs';
import { OperationAlerts, alertConfig } from '../server/operation-alerts.mjs';
import { MailSettings } from '../server/mail-settings.mjs';
import { alertsBody } from '../public/alerts-ui.js';
import { buildWorkbook } from '../server/excel.mjs';
import ExcelJS from 'exceljs';
import { mailText } from './support/smtp-fixture.mjs';
import { errorMessage } from '../public/i18n.js';
test('한·영 혼합 메일은 quoted-printable과 base64에서 UTF-8을 보존', () => {
  const body = '30분 / 30 minutes. 회원가입이 승인되었습니다';
  const qp = [...Buffer.from(body)]
    .map((byte) => '=' + byte.toString(16).padStart(2, '0'))
    .join('');
  assert.equal(mailText('Content-Transfer-Encoding: quoted-printable\r\n\r\n' + qp), body);
  assert.equal(
    mailText('Content-Transfer-Encoding: base64\r\n\r\n' + Buffer.from(body).toString('base64')),
    body,
  );
});
test('영어 서버 오류는 원래 코드를 보존할 수 있는 영어 안내로 표시', () => {
  try {
    setLanguage('en');
    assert.equal(
      errorMessage('LOGIN_FAILED', '인증 정보가 다릅니다.'),
      'Check your email and password.',
    );
    assert.doesNotMatch(errorMessage('UNKNOWN_FAILURE', '알 수 없는 처리 오류'), /[가-힣]/);
  } finally {
    setLanguage('ko');
  }
});

function versions() {
  const base = screenProject(),
    mine = structuredClone(base),
    latest = structuredClone(base);
  latest._revision++;
  return { base, mine, latest };
}
test('3방향 병합은 서로 다른 필드·완료 기록을 보존하고 서버 revision과 권한만 사용', () => {
  const { base, mine, latest } = versions(),
    before = structuredClone(base);
  mine.tasks[0].name = '내 이름';
  mine._role = 'owner';
  latest._role = 'editor';
  latest.tasks[0].memo = '다른 메모';
  latest.tasks[0].items[1].doneDate = '2026-10-26';
  const r = resolvedProject(base, mine, latest, {});
  assert.equal(r.tasks[0].name, '내 이름');
  assert.equal(r.tasks[0].memo, '다른 메모');
  assert.equal(r.tasks[0].items[1].doneDate, '2026-10-26');
  assert.equal(r._role, 'editor');
  assert.equal(r._revision, 2);
  assert.deepEqual(base, before);
});
test('같은 필드 충돌은 명시적 선택 없이는 확정되지 않고 각 선택을 보존', () => {
  const { base, mine, latest } = versions();
  mine.tasks[0].name = '내 이름';
  latest.tasks[0].name = '서버 이름';
  const { conflicts } = mergeProject(base, mine, latest);
  assert.equal(conflicts.length, 1);
  assert.throws(() => resolvedProject(base, mine, latest, {}), /선택/);
  for (const side of ['mine', 'server'])
    assert.equal(
      resolvedProject(base, mine, latest, { [conflicts[0].key]: side }).tasks[0].name,
      side === 'mine' ? '내 이름' : '서버 이름',
    );
  latest._role = 'viewer';
  assert.throws(
    () => resolvedProject(base, mine, latest, { [conflicts[0].key]: 'mine' }),
    /조회자/,
  );
});
test('동시 추가는 모두 보존하고 삭제와 수정·동시 재정렬은 비교 대상으로 유지', () => {
  const { base, mine, latest } = versions();
  mine.tasks.push({
    ...structuredClone(base.tasks[2]),
    id: 'mine',
    items: [{ id: 'mine-item', title: 'mine', hours: 4, doneDate: null }],
  });
  latest.tasks.push({
    ...structuredClone(base.tasks[2]),
    id: 'remote',
    items: [{ id: 'remote-item', title: 'server', hours: 4, doneDate: null }],
  });
  const merged = mergeProject(base, mine, latest);
  assert.equal(merged.conflicts.length, 0);
  assert.equal(merged.project.tasks.length, 5);
  const deleted = versions();
  deleted.mine.tasks.splice(2, 1);
  deleted.latest.tasks[2].memo = '새 메모';
  const conflict = mergeProject(deleted.base, deleted.mine, deleted.latest).conflicts;
  assert.equal(conflict.length, 1);
  assert.equal(
    resolvedProject(deleted.base, deleted.mine, deleted.latest, { [conflict[0].key]: 'mine' }).tasks
      .length,
    2,
  );
  const reordered = versions();
  reordered.mine.tasks.reverse();
  [reordered.latest.tasks[0], reordered.latest.tasks[1]] = [
    reordered.latest.tasks[1],
    reordered.latest.tasks[0],
  ];
  assert.ok(
    mergeProject(reordered.base, reordered.mine, reordered.latest).conflicts.some(
      (c) => c.path.at(-1) === '$order',
    ),
  );
});
test('병합 결과의 삭제 참조·계층 순환은 거부하고 비교 화면은 HTML을 이스케이프', () => {
  const { base, mine, latest } = versions();
  mine.tasks[0].name = '<img src=x onerror=alert(1)>';
  latest.tasks[0].name = '서버';
  const html = conflictBody(base, mine, latest);
  assert.equal(html.includes('<img'), false);
  assert.match(html, /&lt;img/);
  const r = versions();
  r.mine.tasks[0].parentId = 't2';
  r.latest.tasks[1].parentId = 't1';
  assert.throws(() => resolvedProject(r.base, r.mine, r.latest, {}), /순환/);
});
test('한·영 UI는 입력 데이터와 option의 저장 값을 번역하지 않고 레이블만 변경', () => {
  try {
    setLanguage('en');
    assert.equal(ui('프로젝트 한눈에'), 'Project overview');
    assert.equal(rowLabel(1, '업무명'), 'Row 1 Task name');
    assert.equal(
      ui('<option value="개발">개발</option>'),
      '<option value="개발">Development</option>',
    );
    const p = screenProject();
    p.name = '프로젝트 한눈에';
    p.tasks[0].name = '완료';
    p.tasks[0].memo = '서버 변경';
    const original = structuredClone(p);
    const html = editorForm('task', p, 't1').body;
    assert.match(html, /value="완료"/);
    assert.match(html, />서버 변경<\/textarea>/);
    assert.match(html, /Task name/);
    assert.deepEqual(p, original);
    assert.throws(() => setLanguage('xx'));
    assert.equal(getLanguage(), 'en');
  } finally {
    setLanguage('ko');
  }
});
test('한·영 가져오기 열과 붙여넣기 머리글을 모두 해석하며 업무 데이터는 그대로 보존', () => {
  try {
    setLanguage('en');
    const m = suggestMapping(['업무 ID', '업무명', '계획 시작일', '계획 종료일']);
    assert.equal(m.id, 0);
    assert.equal(m.name, 1);
    assert.equal(m.start, 2);
    const en = suggestMapping(['Task ID', 'Task name', 'Start date', 'Finish date', 'Effort (h)']);
    assert.equal(en.name, 1);
    assert.equal(en.hours, 4);
    const p = { ...screenProject(), tasks: [] },
      layout = columns.filter(([key]) => !['phase', 'predecessor', 'memo'].includes(key));
    const result = pasteCells(
      p,
      [],
      0,
      0,
      layout.map((c) => ui(c[1])).join('\t') + '\n기획\t김하늘\t2026-10-26\t2026-10-30\t8',
      { layout },
    );
    assert.equal(result.tasks[0].name, '기획');
    assert.equal(result.tasks.length, 1);
    assert.equal(p.tasks.length, 0);
  } finally {
    setLanguage('ko');
  }
});
test('영어 Excel은 헤더·시트만 현지화하며 한국어 업무명·메모와 날짜·공수를 보존', async () => {
  const p = screenProject();
  p.tasks[0].name = '완료';
  p.tasks[0].memo = '프로젝트';
  const b = new ExcelJS.Workbook();
  await b.xlsx.load(await buildWorkbook(p, '2026-10-26', ['t1'], { language: 'en' }));
  assert.ok(b.getWorksheet('Guide'));
  assert.ok(b.getWorksheet('Gantt'));
  assert.equal(b.getWorksheet('WBS').getCell('C1').value, 'Task name');
  assert.equal(b.getWorksheet('WBS').getCell('C2').value, '완료');
  assert.equal(b.getWorksheet('WBS').getCell('L2').value, '프로젝트');
  assert.ok(b.getWorksheet('WBS').getCell('E2').value instanceof Date);
});
test('500개 업무의 일괄 집계는 기존 집계와 같고 프로젝트·보고일·수정마다 캐시를 갱신', () => {
  const p = largeProject(),
    at = '2026-10-26',
    aggregates = rollups(p, at);
  for (const id of ['t0', 't1', 't490', 't499'])
    assert.deepEqual(aggregates.get(id), rollup(p, id, at));
  const view = new WbsView({});
  view.render(p, at);
  const before = view.context();
  assert.equal(view.context(), before);
  view.changed(editCell(view.draft, 't499', 'name', 'changed'), { paint: false });
  assert.notEqual(view.context(), before);
  const updated = view.context();
  view.at = '2026-10-27';
  assert.notEqual(view.context(), updated);
  assert.equal(p.tasks[499].name, 'Task 499');
});
test('운영 알림 설정은 수신자 중복을 제거하고 잘못된 값·권한 주입 필드를 거부', () => {
  assert.deepEqual(
    alertConfig({ enabled: true, revision: 0, recipients: 'A@example.com,a@example.com' })
      .recipients,
    ['a@example.com'],
  );
  for (const body of [
    null,
    { enabled: 'true', revision: 0 },
    { enabled: true, revision: -1 },
    { enabled: true, revision: 0, recipients: 'a@example.com\r\nBcc: x@example.com' },
  ])
    assert.throws(() => alertConfig(body));
});
test('운영 알림 발송은 중복 tick을 합치고 수신자별로 발송하며 비밀이나 원문 오류를 넣지 않음', async () => {
  let release,
    claimed = 0;
  const sent = [],
    finished = [];
  const repo = {
    async claimOperationAlert() {
      if (claimed++) return null;
      return {
        kind: 'backup',
        occurrences: 3,
        lease: 'lease',
        recipients: ['a@example.com', 'b@example.com'],
      };
    },
    async finishOperationAlert(job, ok) {
      finished.push(ok);
    },
  };
  const mailer = {
    enabled: async () => true,
    sendOperationAlert: (message) => {
      sent.push(message);
      return sent.length === 1 ? new Promise((r) => (release = r)) : Promise.resolve();
    },
  };
  const service = new OperationAlerts({
    repo,
    mailer,
    origin: 'https://example.com',
    basePath: '/pmcanvas',
  });
  const first = service.tick();
  await new Promise((r) => setImmediate(r));
  const second = service.tick();
  release();
  await Promise.all([first, second]);
  assert.equal(sent.length, 2);
  assert.deepEqual(finished, [true]);
  assert.equal(sent[0].url, 'https://example.com/pmcanvas/#operation-alerts');
  assert.deepEqual(Object.keys(sent[0]).sort(), ['count', 'kind', 'to', 'url']);
});
test('SMTP 장애의 알림 발송 실패는 재귀 실패 알림을 만들지 않고 미발송 상태를 보존', async () => {
  const recorded = [];
  let finished,
    claimed = false;
  const repo = {
    getMailSettings: async () => null,
    recordOperationFailure: async (kind) => recorded.push(kind),
    claimOperationAlert: async () =>
      claimed
        ? null
        : ((claimed = true),
          { kind: 'mail', occurrences: 1, lease: 'x', recipients: ['a@example.com'] }),
    finishOperationAlert: async (job, sent) => {
      finished = sent;
    },
  };
  const settings = new MailSettings({
    repo,
    key: Buffer.alloc(32, 7),
    legacy: {
      config: {
        enabled: true,
        host: 'localhost',
        port: 465,
        secure: true,
        from: 'sender@example.com',
        authEnabled: false,
      },
      password: '',
    },
    makeMailer: () => ({
      sendReset: async () => {
        throw Error('private SMTP detail');
      },
      sendOperationAlert: async () => {
        throw Error('private SMTP detail');
      },
      close() {},
    }),
  });
  await assert.rejects(settings.sendReset({ to: 'a@example.com', url: 'https://example.com' }));
  assert.deepEqual(recorded, ['mail']);
  const alerts = new OperationAlerts({ repo, mailer: settings, origin: 'https://example.com' });
  await alerts.tick();
  assert.equal(finished, false);
  assert.deepEqual(recorded, ['mail']);
});
test('알림 UI는 수신 주소·시각을 이스케이프하고 SMTP 장애 한계를 표시', () => {
  const html = alertsBody({
    settings: { enabled: false, recipients: ['</textarea><script>bad</script>'] },
    alerts: [{ kind: 'mail', occurrences: 1, acknowledged: 0, lastAt: '<img src=x>', attempts: 3 }],
  });
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('<img'), false);
  assert.match(html, /SMTP/);
  assert.match(html, /재시도 한도/);
});
