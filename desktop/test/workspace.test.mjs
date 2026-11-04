import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  rmdirSync,
  mkdirSync,
  renameSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DesktopWorkspace } from '../workspace.mjs';
import { DesktopDocument } from '../document.mjs';
const project = (name) => ({
  id: 'same-id',
  name,
  description: '',
  holidays: [],
  members: [],
  tasks: [],
});
const fixture = (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-tabs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return {
    root,
    file: (name) => path.join(root, name),
    workspace: new DesktopWorkspace(path.join(root, 'workspace.json')),
  };
};

test('tabs retain independent drafts, checkpoints, undo and monotonic revisions even for equal project IDs', (t) => {
  const { workspace: w, file } = fixture(t);
  const a = w.create(project('A')).tabId;
  w.replace({ ...w.project, description: 'A edited' }, w.revision);
  const stale = w.revision,
    b = w.create(project('B')).tabId;
  assert.equal(w.snapshot().tabs.length, 2);
  assert.throws(() => w.replace(project('wrong'), stale), /변경/);
  assert.equal(w.snapshot().canUndo, false);
  w.save(file('B.pmcanvas'));
  assert.equal(w.dirty, false);
  assert.equal(w.anyDirty, true);
  w.activate(a);
  assert.equal(w.project.description, 'A edited');
  assert.equal(w.snapshot().canUndo, true);
  w.undo(w.revision);
  assert.equal(w.project.description, '');
  w.redo(w.revision);
  assert.equal(w.project.description, 'A edited');
  assert.throws(() => w.save(file('B.pmcanvas')), /다른 탭/);
  w.save(file('A.pmcanvas'));
  assert.equal(w.anyDirty, false);
  w.activate(b);
  assert.equal(w.project.name, 'B');
  assert.equal(w.snapshot().canUndo, false);
});

test('opening files deduplicates existing tabs without losing drafts and a failed multi-open is atomic', (t) => {
  const { workspace: w, file } = fixture(t);
  const a = w.create(project('A')).tabId;
  w.save(file('A.pmcanvas'));
  w.replace({ ...w.project, description: 'unsaved' }, w.revision);
  const bytes = readFileSync(file('A.pmcanvas'));
  w.create(project('B'));
  w.open(file('A.pmcanvas'));
  assert.equal(w.activeId, a);
  assert.equal(w.project.description, 'unsaved');
  assert.equal(w.tabs.size, 2);
  const before = w.snapshot(),
    recovery = readFileSync(file('workspace.json'));
  writeFileSync(file('Invalid.pmcanvas'), '{}');
  writeFileSync(file('New.pmcanvas'), bytes);
  assert.throws(() => w.openMany([file('New.pmcanvas'), file('Invalid.pmcanvas')]));
  assert.deepEqual(w.snapshot(), before);
  assert.deepEqual(readFileSync(file('workspace.json')), recovery);
  assert.deepEqual(readFileSync(file('A.pmcanvas')), bytes);
});

test('failed persistence preserves all tabs/history and closing selects a neighbour without changing files', (t) => {
  const { workspace: w, file } = fixture(t);
  const a = w.create(project('A')).tabId;
  w.save(file('A.pmcanvas'));
  const b = w.create(project('B')).tabId;
  w.replace({ ...w.project, description: 'changed' }, w.revision);
  const before = w.snapshot();
  renameSync(file('workspace.json'), file('original.json'));
  mkdirSync(file('workspace.json'));
  assert.throws(() => w.close());
  assert.deepEqual(w.snapshot(), before);
  assert.throws(() => w.replace({ ...w.project, name: 'lost' }, w.revision));
  assert.deepEqual(w.snapshot(), before);
  rmdirSync(file('workspace.json'));
  renameSync(file('original.json'), file('workspace.json'));
  w.close(b);
  assert.equal(w.activeId, a);
  assert.equal(w.project.name, 'A');
  w.close(a);
  assert.equal(w.project, null);
  assert.deepEqual(w.snapshot().tabs, []);
  assert.equal(JSON.parse(readFileSync(file('A.pmcanvas'))).project.name, 'A');
  const reopened = new DesktopWorkspace(file('workspace.json'));
  reopened.restore(reopened.recovery());
  assert.equal(reopened.project, null);
});

test('restart restores every dirty tab, reloads clean files, preserves missing-file copies and migrates legacy recovery', (t) => {
  const { file } = fixture(t);
  const legacy = new DesktopDocument(file('recovery.json'));
  legacy.create(project('Legacy'));
  const w = new DesktopWorkspace(file('workspace.json'));
  w.restore(w.recovery());
  const a = w.activeId;
  assert.equal(w.project.name, 'Legacy');
  w.save(file('A.pmcanvas'));
  w.create(project('B'));
  w.save(file('B.pmcanvas'));
  const b = w.activeId;
  w.replace({ ...w.project, description: 'dirty B' }, w.revision);
  w.activate(a);
  renameSync(file('A.pmcanvas'), file('Moved.pmcanvas'));
  const restarted = new DesktopWorkspace(file('workspace.json'));
  const restored = restarted.restore(restarted.recovery());
  assert.equal(restored.missing, true);
  assert.equal(restarted.tabs.size, 2);
  assert.equal(restarted.activeId, a);
  assert.equal(restarted.file, null);
  assert.equal(restarted.dirty, true);
  restarted.activate(b);
  assert.equal(restarted.project.description, 'dirty B');
  assert.equal(restarted.snapshot().canUndo, false);
  restarted.closeMany([a, b]);
  const empty = new DesktopWorkspace(file('workspace.json'));
  empty.restore(empty.recovery());
  assert.equal(empty.tabs.size, 0, 'Legacy recovery must not reopen deliberately closed tabs.');
});

test('corrupt workspace recovery is preserved before replacement', (t) => {
  const { file } = fixture(t),
    bytes = '{broken tabs';
  writeFileSync(file('workspace.json'), bytes);
  const w = new DesktopWorkspace(file('workspace.json'));
  assert.throws(() => w.recovery(), /복구/);
  assert.equal(readFileSync(file('workspace.json'), 'utf8'), bytes);
  assert.ok(
    readdirSync(path.dirname(file('workspace.json'))).some((name) => name.includes('invalid')),
  );
  w.create(project('Safe'));
  assert.equal(w.project.name, 'Safe');
});
