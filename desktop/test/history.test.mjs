import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DesktopDocument, MAX_HISTORY_STEPS, parseDocument } from '../document.mjs';

function setup(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-history-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const doc = new DesktopDocument(path.join(root, 'recovery.json'));
  doc.create({
    id: 'p',
    name: 'Original',
    description: '',
    members: [],
    holidays: [],
    tasks: [
      {
        id: 'task',
        name: 'Work',
        owner: '',
        start: '2026-10-19',
        end: '2026-10-23',
        items: [{ id: 'item', title: 'Done work', hours: 8, doneDate: '2026-10-20' }],
      },
    ],
  });
  return { root, doc, file: path.join(root, 'Project.pmcanvas') };
}
const rename = (doc, name) => doc.replace({ ...doc.project, name }, doc.revision);

test('undo/redo restores completion, hierarchy and baseline without changing saved file content', (t) => {
  const { doc, file } = setup(t);
  doc.save(file);
  const before = structuredClone(doc.project),
    changed = structuredClone(doc.project);
  changed.tasks[0].items[0].doneDate = null;
  changed.baseline = { name: 'Plan', createdAt: '2026-10-28T00:00:00Z', tasks: [] };
  changed.tasks.push({
    ...structuredClone(changed.tasks[0]),
    id: 'child',
    parentId: 'task',
    items: [{ id: 'child-item', title: 'Child', hours: 4, doneDate: null }],
  });
  doc.replace(changed, doc.revision);
  assert.equal(doc.snapshot().canUndo, true);
  doc.undo(doc.revision);
  assert.deepEqual(doc.project, before);
  assert.equal(doc.dirty, false);
  assert.equal(doc.snapshot().canRedo, true);
  doc.redo(doc.revision);
  assert.equal(doc.project.tasks[1].parentId, 'task');
  assert.equal(doc.project.tasks[0].items[0].doneDate, null);
  assert.equal(doc.dirty, true);
  assert.deepEqual(parseDocument(readFileSync(file)), before);
});

test('saved checkpoint follows Save As, and branching clears redo while external modifications remain protected', (t) => {
  const { doc, file, root } = setup(t);
  doc.save(file);
  rename(doc, 'Second');
  const copy = path.join(root, 'Copy.pmcanvas');
  doc.save(copy);
  doc.undo(doc.revision);
  assert.equal(doc.file, copy);
  assert.equal(doc.dirty, true);
  doc.redo(doc.revision);
  assert.equal(doc.dirty, false);
  doc.undo(doc.revision);
  rename(doc, 'Branch');
  assert.equal(doc.snapshot().canRedo, false);
  writeFileSync(copy, 'external content');
  assert.throws(() => doc.save(), /외부에서 변경/);
  assert.equal(readFileSync(copy, 'utf8'), 'external content');
});

test('history rejects stale revisions and recovery failure without consuming entries', (t) => {
  const { doc, root } = setup(t);
  rename(doc, 'Second');
  const before = doc.snapshot(),
    recovery = doc.recovery();
  assert.throws(() => doc.undo(doc.revision - 1), /문서가 변경/);
  const blocker = path.join(root, 'blocker');
  writeFileSync(blocker, 'file');
  const originalRecovery = doc.recoveryFile;
  doc.recoveryFile = path.join(blocker, 'recovery.json');
  assert.throws(() => doc.undo(doc.revision));
  assert.deepEqual(doc.snapshot(), before);
  doc.recoveryFile = originalRecovery;
  assert.deepEqual(doc.recovery(), recovery);
  doc.undo(doc.revision);
  assert.equal(doc.project.name, 'Original');
  assert.equal(doc.dirty, true, 'Unsaved new projects remain unsaved after undo.');
});

test('history is bounded and resets on open/create/restart; legacy recovery remains readable', (t) => {
  const { doc, file, root } = setup(t);
  doc.save(file);
  for (let i = 1; i <= 25; i++) rename(doc, 'Edit ' + i);
  for (let i = 0; i < MAX_HISTORY_STEPS; i++) doc.undo(doc.revision);
  assert.equal(doc.project.name, 'Edit 5');
  assert.equal(doc.snapshot().canUndo, false);
  doc.open(file);
  assert.equal(doc.snapshot().canRedo, false);
  rename(doc, 'Recovered edit');
  const restarted = new DesktopDocument(doc.recoveryFile);
  restarted.restore(restarted.recovery());
  assert.equal(restarted.snapshot().canUndo, false);
  rename(restarted, 'After restart');
  restarted.undo(restarted.revision);
  assert.equal(restarted.project.name, 'Recovered edit');
  assert.equal(restarted.dirty, true);
  const legacy = JSON.parse(readFileSync(doc.recoveryFile, 'utf8'));
  delete legacy.savedProjectHash;
  const legacyPath = path.join(root, 'legacy.json');
  writeFileSync(legacyPath, JSON.stringify(legacy));
  const old = new DesktopDocument(legacyPath);
  old.restore(old.recovery());
  assert.equal(old.project.name, 'Recovered edit');
  doc.create({ ...doc.project, name: 'New project' });
  assert.equal(doc.snapshot().canUndo, false);
});

test('no-op replacement does not add history or erase redo and missing originals remain unsaved', (t) => {
  const { doc, file } = setup(t);
  doc.save(file);
  rename(doc, 'Changed');
  doc.undo(doc.revision);
  doc.replace(doc.project, doc.revision);
  assert.equal(doc.snapshot().canRedo, true);
  assert.equal(doc.dirty, false);
  doc.restore({ ...doc.recovery(), file: null, savedHash: null, dirty: true });
  rename(doc, 'Different');
  doc.undo(doc.revision);
  assert.equal(doc.file, null);
  assert.equal(doc.dirty, true);
});
