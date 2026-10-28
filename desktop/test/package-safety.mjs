import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url),
  asar = require('@electron/asar');
const archive = path.resolve(process.argv[2] || 'dist/excel-0.2.0/win-unpacked/resources/app.asar');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const allowed = new Set(pkg.build.files);
assert.ok(
  [...allowed].every((file) => !file.includes('*')),
  'App source files must use an explicit allowlist.',
);
const files = asar
  .listPackage(archive)
  .map((file) => file.replaceAll('\\', '/').replace(/^\//, ''));
for (const file of files) {
  if (file.startsWith('node_modules/')) continue;
  const stat = asar.statFile(archive, path.normalize(file));
  if (stat.files) continue;
  assert.ok(allowed.has(file), 'Unexpected project file in package: ' + file);
}
for (const file of allowed) assert.ok(files.includes(file), 'Missing app module: ' + file);
for (const dependency of ['electron-builder', 'app-builder-lib', 'electron'])
  assert.ok(
    !files.includes('node_modules/' + dependency + '/package.json'),
    'Development dependency shipped: ' + dependency,
  );
const shipped = JSON.parse(asar.extractFile(archive, 'package.json'));
assert.equal(shipped.version, pkg.version);
assert.deepEqual(Object.keys(shipped.dependencies).sort(), ['@xmldom/xmldom', 'exceljs', 'yauzl']);
console.log('PASS: packaged file allowlist, required modules, production dependencies and version');
