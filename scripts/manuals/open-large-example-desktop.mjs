// Historical local-data repair tool; review its scope before opting in.
import { repositoryRoot } from './paths.mjs';
process.chdir(repositoryRoot);
if (process.env.PMCANVAS_ALLOW_LOCAL_DATA_CHANGES !== '1')
  throw new Error(
    'Review scripts/manuals/README.md, then set PMCANVAS_ALLOW_LOCAL_DATA_CHANGES=1 to modify local data.',
  );
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DesktopWorkspace } from '../../desktop/workspace.mjs';
const profile = path.join(process.env.APPDATA, 'pmcanvas-desktop'),
  workspaceFile = path.join(profile, 'workspace.json');
const input = JSON.parse(fs.readFileSync('test-results/large-example-result.json', 'utf8'));
const previous = JSON.parse(fs.readFileSync(workspaceFile, 'utf8'));
assert.ok(
  previous.tabs.every((tab) => !tab.document.dirty),
  'Preserve unsaved work before adding a tab',
);
const digest = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const originals = previous.tabs
  .filter((tab) => tab.document.file && fs.existsSync(tab.document.file))
  .map((tab) => ({ file: tab.document.file, hash: digest(tab.document.file) }));
const backup = path.resolve(
  'desktop/test-results/example-add-' + new Date().toISOString().replaceAll(':', '-'),
);
fs.mkdirSync(backup, { recursive: true });
fs.copyFileSync(workspaceFile, path.join(backup, 'workspace.json'));
const workspace = new DesktopWorkspace(workspaceFile);
workspace.restore(workspace.recovery());
workspace.open(input.file);
assert.equal(workspace.project.id, input.id);
assert.equal(workspace.project.tasks.length, 186);
assert.equal(workspace.project.weeklyReports.length, 6);
for (const tab of previous.tabs)
  assert.ok(workspace.tabs.has(tab.id), 'Keep every existing project tab');
for (const item of originals)
  assert.equal(digest(item.file), item.hash, 'Keep existing project files unchanged');
const result = {
  id: workspace.project.id,
  name: workspace.project.name,
  file: workspace.file,
  tabs: workspace.tabs.size,
  existingTabsPreserved: previous.tabs.length,
  members: workspace.project.members.length,
  tasks: workspace.project.tasks.length,
  items: workspace.project.tasks.reduce((n, t) => n + t.items.length, 0),
  backup,
};
fs.writeFileSync('test-results/large-example-desktop-result.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
