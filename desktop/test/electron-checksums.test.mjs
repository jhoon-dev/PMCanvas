import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

test('all desktop build targets verify Electron using hashes from the locked npm package', () => {
  const require = createRequire(import.meta.url);
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
  const runtime = require('electron/package.json');
  const upstream = require('electron/checksums.json');
  assert.equal(runtime.version, pkg.devDependencies.electron);
  assert.equal(pkg.build.electronDownload.unsafelyDisableChecksums, undefined);
  for (const target of [
    'win32-x64',
    'win32-arm64',
    'darwin-x64',
    'darwin-arm64',
    'mas-x64',
    'mas-arm64',
  ]) {
    const name = `electron-v${runtime.version}-${target}.zip`;
    assert.match(pkg.build.electronDownload.checksums[name], /^[a-f0-9]{64}$/);
    assert.equal(pkg.build.electronDownload.checksums[name], upstream[name]);
  }
});
