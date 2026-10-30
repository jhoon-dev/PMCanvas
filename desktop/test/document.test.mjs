import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  rmSync,
  mkdirSync,
  symlinkSync,
  linkSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DesktopDocument, parseDocument, serializeDocument, MAX_BYTES } from '../document.mjs';
import { assetPath } from '../assets.mjs';
import { summary } from '../app/shared/engine.js';

const fixture = () => ({
  id: 'project1',
  name: 'Desktop project',
  description: '',
  holidays: ['2026-10-09'],
  members: [{ id: 'm', name: '김담당', role: '개발', grade: '고급', hours: 8, allocation: 100 }],
  tasks: [
    {
      id: 't',
      name: '프로젝트 기능',
      phase: '개발',
      owner: 'm',
      start: '2026-10-19',
      end: '2026-10-23',
      predecessor: '',
      memo: '',
      items: [
        { id: 'i1', title: '작은 작업', hours: 2, doneDate: '2026-10-20' },
        { id: 'i2', title: '큰 작업', hours: 18, doneDate: null },
      ],
    },
  ],
});
function temporary(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-desktop-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
test('web backup round trip preserves calculations and hierarchy while removing access metadata', () => {
  const project = fixture();
  project._revision = 17;
  project._role = 'owner';
  project.tasks.push({
    ...structuredClone(project.tasks[0]),
    id: 'child',
    parentId: 't',
    items: [{ id: 'child-item', title: '하위 작업', hours: 4, doneDate: null }],
  });
  project.baseline = {
    name: '기준',
    createdAt: '2026-10-19T00:00:00Z',
    tasks: [
      { id: 't', name: '원계획', start: '2026-10-19', end: '2026-10-23', hours: 20, parentId: '' },
    ],
  };
  const restored = parseDocument(serializeDocument(project));
  assert.equal(restored._revision, undefined);
  assert.equal(restored._role, undefined);
  assert.equal(restored.id, project.id);
  assert.equal(restored.tasks[1].parentId, 't');
  assert.deepEqual(restored.baseline, project.baseline);
  assert.deepEqual(summary(restored, '2026-10-21'), summary(project, '2026-10-21'));
});
test('invalid formats, unfinished drafts, oversized input and broken dependencies cannot be opened', () => {
  assert.throws(() => parseDocument('{}'), /프로젝트 파일/);
  assert.throws(() => parseDocument('x'.repeat(MAX_BYTES + 1)), /8MB/);
  assert.throws(
    () => serializeDocument({ ...fixture(), _wbsPendingCells: [{ task: 't' }] }),
    /미확정 WBS/,
  );
  const project = fixture();
  project.tasks[0].predecessor = 'missing';
  assert.throws(() => serializeDocument(project), /선행 업무/);
});
test('new, commit, save, reopen and restart recovery preserve completion records', (t) => {
  const root = temporary(t),
    recoveryFile = path.join(root, 'profile/recovery.json');
  const document = new DesktopDocument(recoveryFile);
  assert.equal(document.recovery(), null);
  document.create(fixture());
  const changed = structuredClone(document.project);
  changed.tasks[0].items[1].doneDate = '2026-10-21';
  document.replace(changed, document.revision);
  assert.equal(document.dirty, true);
  const file = path.join(root, 'Project.pmcanvas');
  document.save(file);
  assert.equal(document.dirty, false);
  assert.equal(parseDocument(readFileSync(file)).tasks[0].items[1].doneDate, '2026-10-21');
  const restarted = new DesktopDocument(recoveryFile);
  restarted.restore(restarted.recovery());
  assert.equal(restarted.file, file);
  assert.equal(restarted.dirty, false);
  assert.equal(summary(restarted.project, '2026-10-21').progress, 1);
  restarted.open(file);
  assert.equal(restarted.snapshot().filename, 'Project.pmcanvas');
  assert.equal(
    readdirSync(root).some((entry) => entry.endsWith('.tmp')),
    false,
  );
});
test('web JSON import never overwrites its source and failed open keeps the current draft', (t) => {
  const root = temporary(t);
  const file = path.join(root, 'Web.json'),
    original = serializeDocument(fixture());
  writeFileSync(file, original);
  const document = new DesktopDocument(path.join(root, 'recovery.json'));
  document.open(file);
  assert.equal(document.file, null);
  assert.equal(document.dirty, true);
  assert.throws(() => document.save(), /파일 이름/);
  assert.equal(readFileSync(file, 'utf8'), original);
  const previous = document.snapshot();
  const broken = path.join(root, 'Broken.pmcanvas');
  writeFileSync(broken, '{}');
  assert.throws(() => document.open(broken));
  assert.deepEqual(document.snapshot(), previous);
});
test('external modifications and stale revisions cannot silently overwrite work', (t) => {
  const root = temporary(t),
    document = new DesktopDocument(path.join(root, 'recovery.json'));
  document.create(fixture());
  const oldRevision = document.revision;
  document.replace({ ...document.project, name: 'New name' }, oldRevision);
  assert.throws(() => document.replace(fixture(), oldRevision), /文書|문서/);
  const file = path.join(root, 'Project.pmcanvas');
  document.save(file);
  writeFileSync(file, 'external edit');
  document.replace({ ...document.project, name: 'More edits' }, document.revision);
  assert.throws(() => document.save(), /외부에서 변경/);
  assert.equal(readFileSync(file, 'utf8'), 'external edit');
  document.save(path.join(root, 'New.pmcanvas'));
  assert.equal(document.dirty, false);
});
test('failed recovery write does not accept a mutation; failed save preserves the draft', (t) => {
  const root = temporary(t),
    blocker = path.join(root, 'not-a-directory');
  writeFileSync(blocker, 'block');
  const document = new DesktopDocument(path.join(root, 'recovery.json'));
  document.create(fixture());
  const before = document.snapshot();
  document.recoveryFile = path.join(blocker, 'recovery.json');
  assert.throws(() => document.replace({ ...fixture(), name: 'Unsaved edit' }, document.revision));
  assert.deepEqual(document.snapshot(), before);
  document.recoveryFile = path.join(root, 'recovery.json');
  assert.throws(() => document.save(path.join(blocker, 'Project.pmcanvas')));
  assert.equal(document.dirty, true);
  assert.equal(document.file, null);
});
test('corrupted recovery is reported and left intact', (t) => {
  const root = temporary(t),
    file = path.join(root, 'recovery.json');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '{broken');
  const document = new DesktopDocument(file);
  assert.throws(() => document.recovery());
  assert.equal(readFileSync(file, 'utf8'), '{broken');
  assert.equal(existsSync(file), true);
  const backups = readdirSync(root).filter((name) => name.startsWith('recovery.json.invalid-'));
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(path.join(root, backups[0]), 'utf8'), '{broken');
  document.create(fixture());
  assert.equal(readFileSync(path.join(root, backups[0]), 'utf8'), '{broken');
  assert.equal(new DesktopDocument(file).recovery().project.name, fixture().name);
});

test('case, directory alias and hard-link paths cannot bypass external-edit protection', (t) => {
  const root = temporary(t),
    directory = path.join(root, 'files');
  mkdirSync(directory);
  const alias = path.join(root, 'alias');
  symlinkSync(directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
  for (const kind of ['case', 'directory', 'hardlink']) {
    const file = path.join(directory, kind + '.pmcanvas');
    writeFileSync(file, serializeDocument(fixture()));
    let target = path.join(directory, kind.toUpperCase() + '.pmcanvas');
    if (kind === 'case' && !existsSync(target)) continue; // Case-sensitive volumes have two distinct names.
    if (kind === 'directory') target = path.join(alias, kind + '.pmcanvas');
    if (kind === 'hardlink') {
      target = path.join(root, 'linked.pmcanvas');
      linkSync(file, target);
    }
    const doc = new DesktopDocument(path.join(root, 'recovery-' + kind + '.json'));
    doc.open(file);
    doc.replace({ ...doc.project, name: 'unsaved change' }, doc.revision);
    writeFileSync(file, 'external edit');
    const before = doc.snapshot();
    assert.throws(() => doc.save(target), /외부에서 변경/);
    assert.equal(readFileSync(file, 'utf8'), 'external edit');
    assert.equal(readFileSync(target, 'utf8'), 'external edit');
    assert.deepEqual(doc.snapshot(), before);
    doc.save(path.join(root, kind + '-copy.pmcanvas'));
    assert.equal(doc.dirty, false);
  }
});

test('corrupt recovery is preserved before the first write and a failed backup cannot accept a new document', (t) => {
  const root = temporary(t),
    file = path.join(root, 'recovery.json');
  writeFileSync(file, 'first corrupt data');
  const doc = new DesktopDocument(file);
  doc.create(fixture()); // Even a caller that did not run startup recovery must preserve it.
  const backup = readdirSync(root).find((name) => name.startsWith('recovery.json.invalid-'));
  assert.equal(readFileSync(path.join(root, backup), 'utf8'), 'first corrupt data');
  writeFileSync(file, 'second corrupt data');
  const restarted = new DesktopDocument(file);
  assert.throws(() => restarted.recovery(), /별도 사본/);
  const second = readdirSync(root)
    .filter((name) => name.startsWith('recovery.json.invalid-'))
    .find((name) => name !== backup);
  writeFileSync(path.join(root, second), 'broken backup');
  assert.throws(() => restarted.create(fixture()), /보존하지 못했습니다/);
  assert.equal(restarted.project, null);
  assert.equal(readFileSync(file, 'utf8'), 'second corrupt data');
  assert.equal(readFileSync(path.join(root, backup), 'utf8'), 'first corrupt data');
});
test('custom protocol exposes only renderer assets, never native model, preload or secrets', () => {
  assert.equal(assetPath('pmcanvas://desktop/index.html'), 'index.html');
  assert.equal(assetPath('pmcanvas://desktop/icon.png'), 'icon.png');
  assert.equal(assetPath('pmcanvas://desktop/shared/engine.js'), 'shared/engine.js');
  for (const url of [
    'pmcanvas://desktop/model/project.mjs',
    'pmcanvas://desktop/preload.cjs',
    'pmcanvas://desktop/%2e%2e%2f.env',
    'pmcanvas://other/index.html',
    'https://desktop/index.html',
    'pmcanvas://desktop/shared/%2e%2e%2fmodel/project.mjs',
  ])
    assert.equal(assetPath(url), null, url);
});
