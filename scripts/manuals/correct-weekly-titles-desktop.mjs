// Historical local-data repair tool; review its scope before opting in.
import { repositoryRoot } from './paths.mjs';
process.chdir(repositoryRoot);
if (process.env.PMCANVAS_ALLOW_LOCAL_DATA_CHANGES !== '1')
  throw new Error(
    'Review scripts/manuals/README.md, then set PMCANVAS_ALLOW_LOCAL_DATA_CHANGES=1 to modify local data.',
  );
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { DesktopWorkspace } from '../../desktop/workspace.mjs';
import { atomicWrite, serializeDocument, parseDocument } from '../../desktop/document.mjs';
const profile = path.join(process.env.APPDATA, 'pmcanvas-desktop'),
  workspaceFile = path.join(profile, 'workspace.json');
const previous = JSON.parse(fs.readFileSync(workspaceFile, 'utf8'));
assert.ok(
  previous.tabs.every((tab) => !tab.document.dirty),
  'Keep unsaved work intact',
);
const directory = path.join(os.homedir(), 'Documents', 'PM Canvas Examples');
const files = new Set(previous.tabs.map((tab) => tab.document.file).filter(Boolean));
if (fs.existsSync(directory))
  for (const entry of fs.readdirSync(directory))
    if (entry.endsWith('.pmcanvas')) files.add(path.join(directory, entry));
const backup = path.resolve(
  'desktop/test-results/weekly-title-correction-' + new Date().toISOString().replaceAll(':', '-'),
);
fs.mkdirSync(backup, { recursive: true });
fs.copyFileSync(workspaceFile, path.join(backup, 'workspace.json'));
const result = [];
for (const file of files) {
  const bytes = fs.readFileSync(file),
    original = parseDocument(bytes),
    next = structuredClone(original);
  let count = 0;
  for (const report of next.weeklyReports || [])
    if (report.projectName.includes('[예제]')) {
      report.projectName = report.projectName
        .replaceAll('[예제]', '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      assert.ok(report.projectName);
      count++;
    }
  if (!count) continue;
  const comparison = structuredClone(next);
  comparison.weeklyReports = original.weeklyReports;
  assert.deepEqual(comparison, original, 'Change only the report project-name fields');
  for (let i = 0; i < next.weeklyReports.length; i++) {
    const report = structuredClone(next.weeklyReports[i]);
    report.projectName = original.weeklyReports[i].projectName;
    assert.deepEqual(report, original.weeklyReports[i]);
  }
  fs.writeFileSync(path.join(backup, result.length + '-' + path.basename(file)), bytes, {
    flag: 'wx',
  });
  const output = serializeDocument(next);
  assert.deepEqual(parseDocument(output), next);
  atomicWrite(file, output);
  result.push({ file, correctedReports: count });
}
const workspace = new DesktopWorkspace(workspaceFile);
workspace.restore(workspace.recovery());
for (const tab of previous.tabs) assert.ok(workspace.tabs.has(tab.id), 'Keep all existing tabs');
assert.equal(workspace.activeId, previous.activeId, 'Keep the active project');
for (const document of workspace.tabs.values())
  assert.ok(
    (document.project.weeklyReports || []).every(
      (report) => !report.projectName.includes('[예제]'),
    ),
  );
const generated = 'test-results/large-example-project.json';
if (fs.existsSync(generated)) {
  const p = JSON.parse(fs.readFileSync(generated, 'utf8'));
  for (const report of p.weeklyReports || [])
    report.projectName = report.projectName
      .replaceAll('[예제]', '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  fs.writeFileSync(generated, JSON.stringify(p, null, 2) + '\n');
}
console.log(JSON.stringify({ updated: result, backup }, null, 2));
