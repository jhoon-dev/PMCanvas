import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { preparePackage } from './package-source.mjs';

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
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json')));
preparePackage(path.dirname(root), root, pkg, {
  version: pkg.version,
  commit,
  development: true,
  dirty,
});
console.log('Desktop app prepared from canonical source modules.');
