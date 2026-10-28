import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DesktopDocument } from '../document.mjs';
import { captureBaseline, baselineDiff, setParent, rollups } from '../app/shared/planning.js';
import { scheduleProposal } from '../app/planning-ui.js';

function fixture() {
  return {
    id: 'p',
    name: 'WBS lifecycle',
    description: '',
    holidays: [],
    members: [],
    tasks: ['parent', 'child', 'removed'].map((id) => ({
      id,
      name: id,
      owner: '',
      start: '2026-10-19',
      end: '2026-10-23',
      predecessor: '',
      items: [
        { id: id + '-item', title: id, hours: 8, doneDate: id === 'child' ? '2026-10-20' : null },
      ],
    })),
  };
}
function temporary(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-planning-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('desktop hierarchy and baseline survive save, open and restart with completion records intact', (t) => {
  const root = temporary(t),
    recovery = path.join(root, 'recovery.json'),
    file = path.join(root, 'WBS.pmcanvas');
  const doc = new DesktopDocument(recovery);
  const project = setParent(fixture(), ['child'], 1);
  project.baseline = captureBaseline(project, '승인 계획');
  doc.create(project);
  doc.save(file);
  const reopened = new DesktopDocument(recovery);
  reopened.open(file);
  assert.equal(reopened.project.tasks[1].parentId, 'parent');
  assert.equal(reopened.project.tasks[1].items[0].doneDate, '2026-10-20');
  assert.deepEqual(reopened.project.baseline, project.baseline);
  const total = rollups(reopened.project, '2026-10-21').get('parent');
  assert.equal(total.hours, 16);
  assert.equal(total.progress, 0.5);
  const restarted = new DesktopDocument(recovery);
  restarted.restore(restarted.recovery());
  assert.deepEqual(restarted.project, reopened.project);
  assert.equal(restarted.dirty, false);
});

test('desktop stores baseline differences for changed, added and deleted tasks without changing the snapshot', (t) => {
  const root = temporary(t),
    doc = new DesktopDocument(path.join(root, 'recovery.json'));
  const project = fixture();
  project.baseline = captureBaseline(project, '최초 계획');
  const baseline = structuredClone(project.baseline);
  doc.create(project);
  const next = structuredClone(doc.project);
  next.tasks[1].parentId = 'parent';
  next.tasks[1].name = '새 이름';
  next.tasks[1].end = '2026-10-26';
  next.tasks[1].items[0].hours = 10;
  next.tasks = next.tasks.filter((task) => task.id !== 'removed');
  next.tasks.push({
    ...structuredClone(next.tasks[0]),
    id: 'added',
    items: [{ id: 'new-item', title: '추가', hours: 4, doneDate: null }],
  });
  doc.replace(next, doc.revision);
  const diff = baselineDiff(doc.project);
  const child = diff.rows.find((row) => row.id === 'child');
  assert.equal(child.end, 3);
  assert.equal(child.hours, 2);
  assert.equal(child.renamed, true);
  assert.equal(child.reparented, true);
  assert.equal(diff.rows.find((row) => row.id === 'added').added, true);
  assert.deepEqual(
    diff.removed.map((row) => row.id),
    ['removed'],
  );
  assert.deepEqual(doc.project.baseline, baseline);
  assert.equal(doc.project.tasks[1].items[0].doneDate, '2026-10-20');
});

test('invalid hierarchy, invalid baseline and stale updates cannot change desktop recovery or document state', (t) => {
  const root = temporary(t),
    doc = new DesktopDocument(path.join(root, 'recovery.json'));
  doc.create(setParent(fixture(), ['child'], 1));
  const before = doc.snapshot(),
    recovery = doc.recovery();
  const invalid = structuredClone(doc.project);
  invalid.tasks[0].parentId = 'child';
  assert.throws(() => doc.replace(invalid, doc.revision), /순환/);
  invalid.tasks[0].parentId = 'missing';
  assert.throws(() => doc.replace(invalid, doc.revision), /상위 업무/);
  invalid.tasks[0].parentId = '';
  invalid.baseline = captureBaseline(invalid, '');
  assert.throws(() => doc.replace(invalid, doc.revision));
  invalid.baseline.name = '승인 계획';
  assert.throws(() => doc.replace(invalid, doc.revision - 1), /문서가 변경/);
  assert.deepEqual(doc.snapshot(), before);
  assert.deepEqual(doc.recovery(), recovery);
});

test('schedule preview includes cascading successors without mutating completion records or baseline', () => {
  const project = fixture();
  project.tasks[1].predecessor = 'parent';
  project.tasks[2].predecessor = 'child';
  project.holidays = ['2026-10-26'];
  project.baseline = captureBaseline(project, '승인');
  const before = structuredClone(project),
    form = new FormData();
  for (const [key, value] of Object.entries({
    scheduleTask: 'parent',
    scheduleMode: 'move',
    scheduleDays: '2',
    scheduleCascade: 'on',
  }))
    form.set(key, value);
  const proposal = scheduleProposal(project, form);
  assert.equal(proposal.changes.length, 3);
  assert.equal(proposal.project.tasks[1].start, '2026-10-27');
  assert.equal(proposal.project.tasks[1].items[0].doneDate, '2026-10-20');
  assert.deepEqual(proposal.project.baseline, project.baseline);
  assert.deepEqual(project, before);
  form.delete('scheduleCascade');
  assert.equal(scheduleProposal(project, form).changes.length, 1);
  form.set('scheduleDays', '1.5');
  assert.throws(() => scheduleProposal(project, form), /범위/);
  form.set('scheduleDays', '');
  assert.throws(() => scheduleProposal(project, form), /일수/);
});

test('whole-project schedule alignment previews conflicts, rejects impossible dates and leaves the source intact', () => {
  const project = fixture(),
    form = new FormData();
  project.tasks[1].predecessor = 'parent';
  form.set('scheduleMode', 'align');
  const proposal = scheduleProposal(project, form);
  assert.equal(proposal.changes.length, 1);
  assert.equal(proposal.project.tasks[1].start, '2026-10-26');
  assert.equal(project.tasks[1].start, '2026-10-19');
  form.set('scheduleMode', 'start');
  form.set('scheduleTask', 'parent');
  form.set('scheduleDays', '8');
  assert.throws(() => scheduleProposal(project, form), /일정|확인/);
});
