import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { preparePackage } from '../scripts/package-source.mjs';
import { verifyPackage } from './package-safety.mjs';
const asar = createRequire(import.meta.url)('@electron/asar');

test('release packaging rejects ignored generated tampering and verifies the exact committed inputs', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-provenance-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const desktop = path.join(root, 'desktop');
  fs.mkdirSync(path.join(desktop, 'ui'), { recursive: true });
  const pkg = {
    version: '1.0.0',
    main: 'main.mjs',
    dependencies: { fixture: '1.0.0' },
    build: {
      files: ['package.json', 'main.mjs', 'app/renderer.js', 'app/build-info.json'],
    },
  };
  fs.writeFileSync(path.join(desktop, 'package.json'), JSON.stringify(pkg));
  fs.writeFileSync(path.join(desktop, 'main.mjs'), 'export const version=1;\n');
  fs.writeFileSync(path.join(desktop, 'ui/renderer.js'), 'console.log("canonical");\n');
  fs.writeFileSync(path.join(root, '.gitignore'), 'desktop/app/\npayload/\n*.asar\n');
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-qm', 'source');
  const commit = git('rev-parse', 'HEAD').trim();
  const provenance = { version: pkg.version, commit, development: false, dirty: false };
  const payload = path.join(root, 'payload');
  preparePackage(root, payload, pkg, provenance, commit);
  let archive = path.join(root, 'original.asar');
  await asar.createPackage(payload, archive);
  assert.equal(verifyPackage(archive, { root, commit }).commit, commit);
  fs.appendFileSync(path.join(payload, 'app/renderer.js'), '// uncommitted payload\n');
  archive = path.join(root, 'tampered.asar');
  await asar.createPackage(payload, archive);
  assert.equal(git('status', '--porcelain').trim(), '');
  assert.throws(() => verifyPackage(archive, { root, commit }), /Packaged source differs/);
  assert.throws(() => verifyPackage(archive, { root }), /Packaged source differs/);
  // A subsequent prepare cannot inherit the generated payload, even with a dirty working input.
  fs.writeFileSync(path.join(desktop, 'ui/renderer.js'), 'uncommitted working source');
  preparePackage(root, payload, pkg, provenance, commit);
  archive = path.join(root, 'isolated.asar');
  await asar.createPackage(payload, archive);
  verifyPackage(archive, { root, commit });
  fs.writeFileSync(
    path.join(payload, 'app/build-info.json'),
    JSON.stringify({ ...provenance, development: true }),
  );
  archive = path.join(root, 'wrong-provenance.asar');
  await asar.createPackage(payload, archive);
  assert.throws(() => verifyPackage(archive, { root, commit }));
});
