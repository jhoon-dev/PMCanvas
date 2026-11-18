import test from 'node:test';
import assert from 'node:assert/strict';
import { WeeklyReportAi, weeklyReportContext } from '../server/weekly-report-ai.mjs';
import { cleanProject } from '../server/project.mjs';
import { weeklyDraft } from '../public/management.js';

const period = { from: '2026-10-19', to: '2026-10-23' };
const fixture = () =>
  cleanProject({
    name: '프로젝트',
    description: 'private project description',
    members: [{ id: 'm', name: '담당자', role: '개발', grade: '', hours: 8, allocation: 100 }],
    holidays: [],
    tasks: [
      {
        id: 't',
        name: '부분 완료 업무',
        owner: 'm',
        start: period.from,
        end: period.to,
        memo: 'private task memo',
        phase: '',
        predecessor: '',
        items: [
          { id: 'a', title: '부분', hours: 8, doneDate: '2026-10-20' },
          { id: 'b', title: '미완료', hours: 8, doneDate: null },
        ],
      },
    ],
    issues: [
      {
        id: 'risk',
        title: '외부 API',
        type: 'risk',
        probability: 'high',
        impact: 'high',
        owner: 'm',
        due: period.to,
        status: 'open',
        action: '일정 확인',
        taskId: 't',
      },
    ],
  });
const response = (draft = { notes: '금주 초안', nextNotes: '차주 초안' }, extra = {}) =>
  new Response(
    JSON.stringify({
      status: 'completed',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: JSON.stringify(draft) }],
        },
      ],
      ...extra,
    }),
  );

test('AI context uses engine snapshots, preserves partial progress and excludes private/unrelated fields', () => {
  const p = fixture();
  p.weeklyReports = [weeklyDraft(p, { ...period, notes: 'private report history' })];
  const context = weeklyReportContext(p, { ...period, notes: '작성자 메모', language: 'en' });
  assert.deepEqual(context.metrics, weeklyDraft(p, period).snapshot.metrics);
  assert.equal(context.completed.rows[0].progress, 0.5);
  assert.equal(context.completed.rows[0].owner, '담당자');
  assert.equal(context.issues.rows[0].action, '일정 확인');
  assert.equal(context.authorNotes.notes, '작성자 메모');
  const serialized = JSON.stringify(context);
  for (const privateText of [
    'private project description',
    'private task memo',
    'private report history',
  ])
    assert.equal(serialized.includes(privateText), false);
});

test('AI context bounds lists and issue actions and explicitly reports omissions', () => {
  const p = fixture(),
    original = p.tasks[0];
  p.tasks = Array.from({ length: 60 }, (_, i) => ({ ...original, id: 't' + i }));
  p.issues[0].action = 'a'.repeat(1000);
  const context = weeklyReportContext(p, period);
  assert.equal(context.completed.total, 60);
  assert.equal(context.completed.omitted, 20);
  assert.equal(context.completed.rows.length, 40);
  assert.equal(context.issues.rows[0].action.length, 600);
  assert.equal(context.issues.rows[0].actionTruncated, true);
});

test('AI context rejects future/long/reversed/invalid periods and invalid narrative input', () => {
  for (const body of [
    { from: '2099-01-01', to: '2099-01-02' },
    { ...period, to: '2026-10-27' },
    { ...period, to: '2026-10-18' },
    { ...period, from: 'invalid' },
    { ...period, notes: 'x'.repeat(4001) },
    { ...period, nextNotes: null },
    { ...period, language: 'fr' },
  ])
    assert.throws(
      () => weeklyReportContext(fixture(), body),
      (e) => e.status === 400,
    );
});

test('AI sends bounded server context via strict Responses JSON schema without storage or retries', async () => {
  let calls = 0;
  const ai = new WeeklyReportAi({
    apiKey: 'test-only-key',
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(options.headers.Authorization, 'Bearer test-only-key');
      assert.equal(options.redirect, 'error');
      const body = JSON.parse(options.body);
      assert.equal(body.store, false);
      assert.equal(body.text.format.strict, true);
      assert.deepEqual(body.text.format.schema.required, ['notes', 'nextNotes']);
      assert.equal(body.max_output_tokens, 4000);
      assert.equal(JSON.parse(body.input).language, 'ko');
      assert.match(body.instructions, /untrusted/);
      return response({ notes: '  금주 초안  ', nextNotes: '차주 초안' });
    },
  });
  assert.deepEqual(await ai.generate(weeklyReportContext(fixture(), period)), {
    notes: '금주 초안',
    nextNotes: '차주 초안',
  });
  assert.equal(calls, 1);
});

test('AI disabled, provider errors, refusals, incomplete and invalid output are actionable and sanitized', async () => {
  await assert.rejects(new WeeklyReportAi().generate({}), (e) => e.code === 'AI_NOT_CONFIGURED');
  const cases = [
    [() => new Response('provider private detail', { status: 401 }), 'AI_UNAVAILABLE'],
    [
      () => {
        throw Error('private network detail');
      },
      'AI_UNAVAILABLE',
    ],
    [() => new Response('invalid json'), 'AI_UNAVAILABLE'],
    [() => new Response('x'.repeat(128 * 1024 + 1)), 'AI_UNAVAILABLE'],
    [() => response(undefined, { output: [null] }), 'AI_INVALID_OUTPUT'],
    [
      () =>
        response(
          {},
          {
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'refusal', refusal: 'private refusal' }],
              },
            ],
          },
        ),
      'AI_REFUSED',
    ],
    [() => response(undefined, { status: 'incomplete' }), 'AI_INVALID_OUTPUT'],
    [() => response({ notes: 'x'.repeat(4001), nextNotes: 'ok' }), 'AI_INVALID_OUTPUT'],
    [() => response({ notes: 'ok', nextNotes: ' ' }), 'AI_INVALID_OUTPUT'],
    [() => response({ notes: 'ok', nextNotes: 'ok', unexpected: true }), 'AI_INVALID_OUTPUT'],
    [() => response(null), 'AI_INVALID_OUTPUT'],
  ];
  for (const [fetchImpl, code] of cases) {
    const ai = new WeeklyReportAi({ apiKey: 'test-only-key', fetchImpl });
    await assert.rejects(ai.generate({}), (e) => e.code === code && !e.message.includes('private'));
  }
});

test('AI timeout aborts the provider request', async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const ai = new WeeklyReportAi({
      apiKey: 'test-only-key',
      timeoutMs: 10,
      fetchImpl: async (_, { signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    });
    await assert.rejects(ai.generate({}), (e) => e.code === 'AI_TIMEOUT' && e.status === 504);
  } finally {
    clearTimeout(keepAlive);
  }
});
