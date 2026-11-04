import test from 'node:test';
import assert from 'node:assert/strict';
import { AppDialogs } from '../dialogs.mjs';

test('dialogs wait for the renderer and accept only a matching valid button reply', async () => {
  const sent = [],
    broker = new AppDialogs((request) => sent.push(request));
  const result = broker.show({ buttons: ['Save', 'Discard', 'Cancel'], cancelId: 2 });
  assert.equal(sent.length, 0);
  broker.connect();
  broker.connect();
  assert.equal(sent.length, 1);
  assert.equal(broker.respond(sent[0].id, -1), false);
  assert.equal(broker.respond(sent[0].id, 3), false);
  assert.equal(broker.respond(sent[0].id, '0'), false);
  assert.equal(broker.respond(sent[0].id + 1, 1), false);
  assert.equal(broker.respond(sent[0].id, 0), true);
  assert.deepEqual(await result, { response: 0 });
  assert.equal(broker.respond(sent[0].id, 1), false);
  assert.equal(broker.pending, false);
});

test('reload or renderer loss cancels outstanding actions and rejects stale replies', async () => {
  const sent = [],
    broker = new AppDialogs((request) => sent.push(request));
  broker.connect();
  const first = broker.show({ buttons: ['Delete', 'Cancel'], cancelId: 1 });
  const second = broker.show({ buttons: ['Save', 'Discard', 'Cancel'], cancelId: 2 });
  broker.reset();
  assert.deepEqual(await first, { response: 1 });
  assert.deepEqual(await second, { response: 2 });
  const third = broker.show({ buttons: ['OK'] });
  assert.equal(sent.length, 2);
  assert.equal(broker.respond(sent[0].id, 0), false);
  broker.connect();
  assert.equal(sent.length, 3);
  assert.ok(sent[2].id > sent[1].id);
  broker.respond(sent[2].id, 0);
  assert.deepEqual(await third, { response: 0 });
});
