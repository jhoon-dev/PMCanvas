import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bulkProposal, bulkPreviewHtml } from '../app/bulk-ui.js';
import { captureBaseline, ordered } from '../app/shared/planning.js';
import { DesktopDocument } from '../document.mjs';

function fixture() {
  const task = (id) => ({
    id,
    name: id,
    owner: '',
    start: '2026-10-19',
    end: '2026-10-23',
    predecessor: '',
    items: [{ id: id + '-item', title: id, hours: 8, doneDate: '2026-10-20' }],
  });
  const project = {
    id: 'p',
    name: 'Bulk',
    description: '',
    members: [],
    holidays: [],
    tasks: [
      task('parent'),
      { ...task('child'), parentId: 'parent', predecessor: 'parent' },
      { ...task('follow'), predecessor: 'child' },
    ],
  };
  project.baseline = captureBaseline(project, 'Plan');
  return project;
}
test('bulk copies reconnect selected hierarchy/dependencies and reset only copied completion records', () => {
  const project = fixture(),
    before = structuredClone(project);
  let sequence = 0;
  const proposal = bulkProposal(project, ['parent', 'child'], 'duplicate', {
    id: () => 'copy-' + sequence++,
  });
  const copies = proposal.project.tasks.filter((task) => task.id.startsWith('copy-'));
  assert.equal(copies.length, 2);
  assert.equal(copies[1].parentId, copies[0].id);
  assert.equal(copies[1].predecessor, copies[0].id);
  assert.ok(copies.every((task) => task.items.every((item) => !item.doneDate)));
  assert.equal(proposal.project.tasks.find((task) => task.id === 'follow').predecessor, 'child');
  assert.deepEqual(proposal.project.baseline, project.baseline);
  assert.deepEqual(project, before);
  proposal.rows[0][0] = '<img src=x onerror=alert(1)>';
  assert.ok(bulkPreviewHtml(proposal).includes('&lt;img'));
  assert.ok(!bulkPreviewHtml(proposal).includes('<img'));
});
test('bulk deletion previews promoted children and detached dependencies and is one reversible document edit', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-bulk-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const doc = new DesktopDocument(path.join(root, 'recovery.json')),
    file = path.join(root, 'Project.pmcanvas');
  doc.create(fixture());
  doc.save(file);
  const before = structuredClone(doc.project),
    bytes = readFileSync(file);
  const proposal = bulkProposal(doc.project, ['parent'], 'remove');
  assert.equal(proposal.project.tasks[0].id, 'child');
  assert.equal(proposal.project.tasks[0].parentId, '');
  assert.equal(proposal.project.tasks[0].predecessor, '');
  assert.match(proposal.description, /하위 업무 1개/);
  assert.match(proposal.description, /후속 업무 1개/);
  assert.equal(proposal.project.tasks[0].items[0].doneDate, '2026-10-20');
  doc.replace(proposal.project, doc.revision);
  doc.undo(doc.revision);
  assert.deepEqual(doc.project, before);
  assert.equal(doc.dirty, false);
  assert.deepEqual(readFileSync(file), bytes);
});
test('bulk ordering moves a subtree among siblings and rejects empty/stale/no-op selections', () => {
  const project = fixture(),
    proposal = bulkProposal(project, ['follow'], 'up');
  assert.deepEqual(
    ordered(proposal.project).map((task) => task.id),
    ['follow', 'parent', 'child'],
  );
  assert.equal(proposal.project.tasks.find((task) => task.id === 'child').parentId, 'parent');
  assert.deepEqual(proposal.project.baseline, project.baseline);
  assert.throws(() => bulkProposal(project, [], 'remove'), /선택/);
  assert.throws(() => bulkProposal(project, ['missing'], 'duplicate'), /선택/);
  assert.throws(() => bulkProposal(project, ['parent'], 'up'), /이동/);
});
