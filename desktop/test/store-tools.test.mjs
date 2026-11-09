import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareStoreTools } from '../scripts/store-tools.mjs';

test('Store tools reject modified download bytes before extracting or running them', async (t) => {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-tools-test-'));
  t.after(() => {
    assert.equal(path.dirname(stage), path.resolve(os.tmpdir()));
    assert.ok(path.basename(stage).startsWith('pmcanvas-tools-test-'));
    fs.rmSync(stage, { recursive: true, force: true });
  });
  t.mock.method(globalThis, 'fetch', async () => new Response('modified executable'));
  await assert.rejects(() => prepareStoreTools(stage), /checksum mismatch/);
  assert.deepEqual(fs.readdirSync(stage), []);
});

test('Store tool HTTP errors cannot be treated as a downloaded executable', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('unavailable', { status: 504 }));
  await assert.rejects(() => prepareStoreTools('unused'), /download failed.*504/);
});
