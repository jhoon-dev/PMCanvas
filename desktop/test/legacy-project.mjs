import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { screenProject } from '../../web/test/support/screen-fixtures.mjs';
import { cleanProject } from '../app/model/project.mjs';

export function legacyProject(name, baselineName) {
  const project = screenProject();
  delete project._role;
  delete project._revision;
  project.name = name;
  project.tasks[1].predecessor = '';
  project.tasks[1].parentId = project.tasks[0].id;
  // Match 0.7.1's baseline schema: parent rows still held their own work.
  // Using today's rollups here would discard the legacy parent's baseline effort.
  project.baseline = {
    name: baselineName,
    createdAt: '2026-10-26T00:00:00.000Z',
    tasks: project.tasks.map((t) => ({
      id: t.id,
      name: t.name,
      start: t.start,
      end: t.end,
      hours: t.items.reduce((n, i) => n + i.hours, 0),
      parentId: t.parentId || '',
    })),
  };
  return project;
}

export function assertUpgradedProject(actual, legacy) {
  assert.deepEqual(actual, { ...cleanProject(legacy), ...(legacy.id ? { id: legacy.id } : {}) });
  // Independently verify original records and baseline effort, beyond normalized shape.
  assert.deepEqual(
    actual.tasks.flatMap((t) => t.items),
    legacy.tasks.flatMap((t) => t.items),
  );
  assert.equal(actual.baseline.name, legacy.baseline.name);
  assert.equal(actual.baseline.createdAt, legacy.baseline.createdAt);
  for (const old of legacy.tasks.filter((t) => t.items.length)) {
    const task = actual.tasks.find((t) => t.items.some((i) => i.id === old.items[0].id));
    assert.ok(task, 'Legacy checklist must still belong to an executable task.');
    for (const key of ['owner', 'start', 'end']) assert.equal(task[key], old[key]);
    const baseline = actual.baseline.tasks.find((t) => t.id === task.id),
      original = legacy.baseline.tasks.find((t) => t.id === old.id);
    assert.ok(baseline);
    for (const key of ['hours', 'start', 'end']) assert.equal(baseline[key], original[key]);
  }
}

export function assertMigratedRecovery(recovery, legacy, file, savedHash) {
  assert.equal(recovery.version, 1);
  assert.equal(recovery.file, file);
  assert.equal(recovery.savedHash, savedHash);
  assert.equal(recovery.dirty, false);
  assertUpgradedProject(recovery.project, legacy);
  assert.equal(
    recovery.savedProjectHash,
    createHash('sha256').update(JSON.stringify(recovery.project)).digest('hex'),
  );
}
