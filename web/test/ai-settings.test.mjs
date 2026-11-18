import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AiSettings } from '../server/ai-settings.mjs';
import { WeeklyReportAi } from '../server/weekly-report-ai.mjs';
import { MemoryRepository } from './support/memory-repository.mjs';

const input = {
  model: 'gpt-4.1-mini',
  apiKey: 'test-only-api-secret',
  clearApiKey: false,
  revision: 0,
};
function fixture(legacy = {}) {
  const admin = randomUUID(),
    member = randomUUID();
  const repo = new MemoryRepository([{ id: admin, is_admin: true }, { id: member }]);
  const key = Buffer.alloc(32, 21);
  return { admin, member, repo, key, settings: new AiSettings({ repo, key, ...legacy }) };
}
test('AI settings encrypt keys, preserve blank input, survive restart and atomically reject competing saves', async () => {
  const f = fixture();
  assert.equal((await f.settings.public()).hasApiKey, false);
  await assert.rejects(f.settings.save(f.member, input), (e) => e.status === 403);
  const saved = await f.settings.save(f.admin, input);
  assert.deepEqual(saved, { model: input.model, hasApiKey: true, revision: 1 });
  assert.equal(JSON.stringify(await f.repo.getAiSettings()).includes(input.apiKey), false);
  const restarted = new AiSettings({ repo: f.repo, key: f.key });
  assert.equal((await restarted.credentials()).apiKey, input.apiKey);
  const attempts = await Promise.allSettled(
    [f.settings, restarted].map((s) => s.save(f.admin, { ...input, apiKey: '', revision: 1 })),
  );
  assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(attempts.find((r) => r.status === 'rejected').reason.code, 'AI_CONFLICT');
  assert.equal((await restarted.credentials()).apiKey, input.apiKey);
  await assert.rejects(
    new AiSettings({ repo: f.repo, key: Buffer.alloc(32, 22) }).credentials(),
    (e) => e.code === 'AI_KEY' && !e.message.includes(input.apiKey),
  );
  f.repo.aiSettings.api_key_encrypted = 'tampered';
  await assert.rejects(restarted.credentials(), (e) => e.code === 'AI_KEY');
  await restarted.save(f.admin, { ...input, revision: 2 });
  assert.equal((await restarted.credentials()).apiKey, input.apiKey);
});
test('Saved AI settings apply to the existing generator immediately, rotate and clear without environment fallback', async () => {
  const f = fixture({ apiKey: 'legacy-test-key' }),
    requests = [];
  const ai = new WeeklyReportAi({
    settings: f.settings,
    fetchImpl: async (url, options) => {
      requests.push({
        authorization: options.headers.Authorization,
        model: JSON.parse(options.body).model,
      });
      return new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({ notes: 'Draft', nextNotes: 'Next' }),
                },
              ],
            },
          ],
        }),
      );
    },
  });
  assert.equal(await ai.isConfigured(), true);
  await f.settings.save(f.admin, input);
  await ai.generate({});
  await f.settings.save(f.admin, {
    ...input,
    revision: 1,
    apiKey: 'replacement-test-key',
    model: 'gpt-4.1',
  });
  await ai.generate({});
  assert.deepEqual(requests, [
    { authorization: 'Bearer ' + input.apiKey, model: input.model },
    { authorization: 'Bearer replacement-test-key', model: 'gpt-4.1' },
  ]);
  await f.settings.save(f.admin, { ...input, apiKey: '', clearApiKey: true, revision: 2 });
  assert.equal(await ai.isConfigured(), false);
  assert.equal((await f.settings.credentials()).apiKey, '');
  assert.equal(
    (await new AiSettings({ repo: f.repo, key: f.key, apiKey: 'legacy-test-key' }).credentials())
      .apiKey,
    '',
  );
  await assert.rejects(ai.generate({}), (e) => e.code === 'AI_NOT_CONFIGURED');
  assert.equal(requests.length, 2);
  for (const patch of [
    { model: 'bad model' },
    { apiKey: 'key\r\ninjection' },
    { apiKey: 'x'.repeat(4097) },
    { clearApiKey: 'true' },
    { clearApiKey: true },
    { revision: null },
  ])
    await assert.rejects(
      f.settings.save(f.admin, { ...input, revision: 3, ...patch }),
      (e) => e.code === 'AI_CONFIG',
    );
});
