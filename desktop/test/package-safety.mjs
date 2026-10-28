import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sourceBytes } from '../scripts/package-source.mjs';

const require = createRequire(import.meta.url),
  asar = require('@electron/asar');
export function verifyPackage(
  archive,
  {
    root = path.resolve(fileURLToPath(new URL('../../', import.meta.url))),
    commit = null,
    development = false,
  } = {},
) {
  if (commit && !/^[a-f0-9]{40}$/.test(commit)) throw Error('Invalid expected source commit.');
  const pkg = JSON.parse(sourceBytes(root, 'package.json', commit));
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
  const provenance = JSON.parse(asar.extractFile(archive, path.normalize('app/build-info.json')));
  assert.equal(provenance.version, pkg.version);
  assert.equal(typeof provenance.development, 'boolean');
  assert.ok(provenance.commit === null || /^[a-f0-9]{40}$/.test(provenance.commit));
  assert.deepEqual(shipped.dependencies, pkg.dependencies);
  assert.equal(shipped.main, pkg.main);
  if (commit) {
    assert.equal(provenance.commit, commit);
    assert.equal(provenance.development, development);
    assert.equal(provenance.dirty, false);
  }
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
  for (const file of allowed) {
    if (file === 'package.json' || file === 'app/build-info.json') continue;
    assert.equal(
      digest(asar.extractFile(archive, path.normalize(file))),
      digest(sourceBytes(root, file, commit)),
      'Packaged source differs: ' + file,
    );
  }
  return { commit: provenance.commit, development: provenance.development };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyPackage(path.resolve(process.argv[2] || 'dist/win-unpacked/resources/app.asar'), {
    commit: process.argv[3] || null,
    development: process.argv[4] === '--development',
  });
  console.log('PASS: package matches canonical source, provenance, allowlist and runtime metadata');
}
