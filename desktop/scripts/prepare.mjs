import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
let commit = null,
  dirty = true;
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  dirty = Boolean(
    execFileSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim(),
  );
} catch {}
// Copy explicit shared modules only; never copy secrets or workspace data.
const shared = [
  'engine.js',
  'planning.js',
  'html.js',
  'i18n.js',
  'locales/en.js',
  'locales/desktop-en.js',
  'view-ui.js',
  'people-view.js',
  'project-editor.js',
  'reports.js',
  'wbs-model.js',
  'report-clock.js',
  'excel-import-model.js',
  'styles.css',
];
mkdirSync(path.join(root, 'app/shared'), { recursive: true });
writeFileSync(
  path.join(root, 'app/build-info.json'),
  JSON.stringify(
    {
      version: JSON.parse(readFileSync(path.join(root, 'package.json'))).version,
      commit,
      development: true,
      dirty,
    },
    null,
    2,
  ) + '\n',
);
mkdirSync(path.join(root, 'app/model'), { recursive: true });
mkdirSync(path.join(root, 'app/node'), { recursive: true });
for (const file of ['excel.mjs', 'excel-import.mjs']) {
  const source = readFileSync(path.join(root, '../shared/node', file), 'utf8');
  writeFileSync(path.join(root, 'app/node', file), source.replaceAll('../browser/', '../shared/'));
}
for (const file of shared) {
  const target = path.join(root, 'app/shared', file);
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(path.join(root, '../shared/browser', file), target);
}
for (const file of ['project.mjs', 'errors.mjs']) {
  const source = readFileSync(path.join(root, '../shared/model', file), 'utf8');
  writeFileSync(path.join(root, 'app/model', file), source.replaceAll('../browser/', '../shared/'));
}
for (const file of [
  'index.html',
  'renderer.js',
  'excel-ui.js',
  'planning-ui.js',
  'bulk-ui.js',
  'desktop.css',
])
  cpSync(path.join(root, 'ui', file), path.join(root, 'app', file));
console.log('Desktop app prepared from explicit shared modules.');
