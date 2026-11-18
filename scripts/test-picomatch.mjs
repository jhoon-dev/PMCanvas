import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const product = process.argv[2];
assert.ok(['desktop', 'mobile'].includes(product), 'Specify desktop or mobile.');
const vendor = path.join(root, 'vendor/picomatch');
const requireProduct = createRequire(path.join(root, product, 'package.json'));
const lock = requireProduct('./package-lock.json');
const pkg = requireProduct('./package.json');
assert.equal(pkg.overrides.picomatch, '$picomatch');
assert.equal(pkg.devDependencies.picomatch, 'file:../vendor/picomatch');
assert.equal(lock.packages['../vendor/picomatch'].version, '4.0.7-pmcanvas.1');
const realVendor = fs.realpathSync(vendor);
let instances = 0;
for (const [name, entry] of Object.entries(lock.packages)) {
  if (!name.startsWith('node_modules/')) continue;
  if (name.endsWith('/picomatch')) {
    assert.equal(entry.link, true, 'Registry picomatch must not reappear in the lock file.');
    assert.equal(fs.realpathSync(path.join(root, product, name)), realVendor);
    instances++;
  }
  // Resolve from every consumer, not just the direct development dependency.
  if (entry.dependencies?.picomatch || entry.peerDependencies?.picomatch) {
    const consumer = createRequire(path.join(root, product, name, 'package.json'));
    assert.equal(fs.realpathSync(path.dirname(consumer.resolve('picomatch'))), realVendor);
  }
}
assert.ok(instances > 0);
const pm = requireProduct('picomatch');
assert.equal(pm.isMatch('src/app.js', '**/*.js'), true);
assert.equal(pm.isMatch('src/.private.js', '**/*.js'), false);
assert.equal(pm.isMatch('src/.private.js', '**/*.js', { dot: true }), true);
assert.equal(pm.isMatch('src/app.ts', '**/*.{js,ts}'), true);
assert.equal(pm.isMatch('package.json', 'package.@(json|yaml)'), true);
assert.equal(pm.isMatch('abab', '+(ab)'), true);
assert.equal(pm.isMatch('abba', '+(a|b)'), true);
assert.equal(pm.isMatch('*a*a', '+(\\*a)'), true);
assert.ok(pm.makeRe('**/*.js').test('src/app.js'));
assert.equal(pm.scan('src/**/*.js').base, 'src');
assert.equal(typeof pm.parse('**/*.js').output, 'string');
assert.equal(requireProduct('picomatch/posix').isMatch('src/app.js', '**/*.js'), true);

// A subprocess timeout keeps a regression from hanging the CI runner itself.
execFileSync(
  process.execPath,
  [
    '-e',
    `
    const assert = require('node:assert/strict');
    const pm = require(${JSON.stringify(vendor)});
    for (const glob of ['+(*)', '+(*a)', '*(*)', '*(*a)', '+(*a|b)', '+(a*)', '+(a?)']) {
      for (const options of [{}, { fastpaths: false }, { maxExtglobRecursion: false }]) {
        const matches = pm(glob + 'z', options);
        assert.equal(matches('a'.repeat(64) + '!'), false);
        assert.equal(matches(glob + 'z'), true);
      }
    }
  `,
  ],
  { timeout: 5000, stdio: 'pipe' },
);
console.log(product + ': patched picomatch resolution, matching and ReDoS regressions passed.');
