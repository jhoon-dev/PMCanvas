import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DesktopAiSettings } from '../ai-settings.mjs';
import { DesktopWeeklyAi } from '../weekly-ai.mjs';
import { DesktopWorkspace } from '../workspace.mjs';
import { today } from '../app/shared/engine.js';

function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-ai-'));
  t.after(() => {
    if (
      path.dirname(folder) !== path.resolve(os.tmpdir()) ||
      !path.basename(folder).startsWith('pmcanvas-ai-')
    )
      throw Error('Unsafe AI fixture cleanup path');
    fs.rmSync(folder, { recursive: true, force: true });
  });
  const key = randomBytes(32);
  const storage = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (text) => {
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, iv);
      return Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()]);
    },
    decryptStringAsync: async (bytes) => {
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(-16));
      return {
        result: Buffer.concat([
          decipher.update(bytes.subarray(12, -16)),
          decipher.final(),
        ]).toString(),
        shouldReEncrypt: false,
      };
    },
  };
  const file = path.join(folder, 'ai-settings.json');
  const settings = new DesktopAiSettings({ file, storage, platform: 'win32' });
  return { folder, file, settings, storage };
}
const body = {
  revision: 0,
  model: 'gpt-4.1-mini',
  apiKey: 'test-only-desktop-ai-key',
  clearApiKey: false,
};
const response = () =>
  new Response(
    JSON.stringify({
      status: 'completed',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({ notes: 'This week', nextNotes: 'Next week' }),
            },
          ],
        },
      ],
    }),
  );

test('desktop AI keys stay encrypted, survive restart, preserve blank input, rotate, reject stale writes and delete', async (t) => {
  const f = fixture(t);
  assert.equal(f.settings.public().hasApiKey, false);
  assert.equal((await f.settings.save(body)).hasApiKey, true);
  assert.equal(fs.readFileSync(f.file, 'utf8').includes(body.apiKey), false);
  assert.deepEqual(f.settings.public(), { model: body.model, hasApiKey: true, revision: 1 });
  const restart = new DesktopAiSettings({ file: f.file, storage: f.storage, platform: 'win32' });
  assert.equal((await restart.credentials()).apiKey, body.apiKey);
  await restart.save({ ...body, revision: 1, apiKey: '' });
  assert.equal((await f.settings.credentials()).apiKey, body.apiKey);
  await assert.rejects(f.settings.save(body), /설정이 변경/);
  const concurrent = await Promise.allSettled(
    [f.settings, restart].map((s) =>
      s.save({ ...body, revision: 2, apiKey: 'replacement-test-key' }),
    ),
  );
  assert.equal(concurrent.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await restart.credentials()).apiKey, 'replacement-test-key');
  await restart.save({ ...body, revision: 3, apiKey: '', clearApiKey: true });
  assert.equal(f.settings.public().hasApiKey, false);
  assert.equal((await f.settings.credentials()).apiKey, '');
});
test('desktop AI fails closed when OS secure storage is unavailable and hides provider decrypt errors', async (t) => {
  const f = fixture(t);
  f.storage.isAsyncEncryptionAvailable = async () => false;
  await assert.rejects(f.settings.save(body), /보안 저장소/);
  assert.equal(fs.existsSync(f.file), false);
  f.storage.isAsyncEncryptionAvailable = async () => true;
  await f.settings.save(body);
  f.storage.decryptStringAsync = async () => {
    throw Error('echoed-secret-' + body.apiKey);
  };
  await assert.rejects(
    f.settings.credentials(),
    (e) => e.message.includes('다시 등록') && !e.message.includes(body.apiKey),
  );
  for (const patch of [{ apiKey: 'bad\nheader' }, { model: 'bad model' }, { clearApiKey: true }])
    await assert.rejects(f.settings.save({ ...body, revision: 1, ...patch }), /입력/);
});
test('desktop AI generates only from the main workspace, preserves project data, blocks duplicate/stale requests and rate limits', async (t) => {
  const f = fixture(t),
    workspace = new DesktopWorkspace(path.join(f.folder, 'workspace.json'));
  workspace.create({
    name: 'Local project',
    description: 'private description',
    members: [],
    tasks: [],
    holidays: [],
  });
  await f.settings.save(body);
  const input = {
    tabId: workspace.activeId,
    revision: workspace.revision,
    from: today(),
    to: today(),
    notes: 'Author context',
    language: 'en',
  };
  let release,
    calls = 0;
  const service = new DesktopWeeklyAi({
    workspace,
    settings: f.settings,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(options.headers.Authorization, 'Bearer ' + body.apiKey);
      const data = JSON.parse(JSON.parse(options.body).input);
      assert.equal(data.projectName, 'Local project');
      assert.equal(data.description, undefined);
      if (calls === 1)
        await new Promise((resolve) => {
          release = resolve;
        });
      return response();
    },
  });
  const before = JSON.stringify(workspace.snapshot());
  const pending = service.generate(input);
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(service.generate(input), /생성 중/);
  workspace.revision++;
  release();
  await assert.rejects(pending, /프로젝트가 변경/);
  workspace.revision--;
  const result = await service.generate(input);
  assert.equal(result.notes, 'This week');
  assert.equal(JSON.stringify(workspace.snapshot()), before);
  await assert.rejects(service.generate({ ...input, project: workspace.project }), /설명과 언어/);
  for (let i = 0; i < 3; i++) await service.generate(input);
  await assert.rejects(service.generate(input), /요청이 많/);
  assert.equal(calls, 5);
});
